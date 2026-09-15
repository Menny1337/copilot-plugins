import SwiftUI
import LoopsModels

// MARK: - Preflight & Review

/// The final review step. Runs preflight through the injected callback,
/// surfaces every warning + error, shows the exact redacted argv (never any
/// secret values), and gates Enable behind an explicit acknowledgement.
struct PermissionReviewView: View {
    @ObservedObject var state: LoopBuilderState
    let callbacks: LoopBuilderCallbacks

    /// The definition assembled from the current form. Recomputed every render
    /// so the preview stays in sync as the user backtracks through steps.
    private var currentDefinition: LoopDefinition { state.buildDefinition() }

    /// Every field-level validation issue across the entire form. The review
    /// screen must repeat these so the user doesn't have to hunt for them.
    private var validationIssues: [BuilderIssue] {
        state.validate().filter { $0.step != .review }
    }

    private var hasBlockingIssues: Bool {
        validationIssues.contains(where: { $0.severity == .error })
    }

    /// The approved fingerprint (if any) from the underlying loop. Used to
    /// highlight capability drift.
    private var approvedFingerprint: String? { state.originalDefinition?.approval.fingerprint }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerCard
                preflightCard
                capabilityCard
                argvCard
                pathsCard
                environmentCard
                policyCard
                validationCard
                enableCard
            }
            .padding(20)
        }
    }

    // MARK: Header

    private var headerCard: some View {
        LoopsCard {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Image(systemName: state.kind == .copilot ? "sparkles" : "terminal")
                            .foregroundStyle(LoopsPalette.identity)
                        Text(currentDefinition.name)
                            .font(.title3.weight(.semibold))
                        LoopsStatusPill(
                            title: currentDefinition.lifecycle.displayName,
                            systemImage: "clock",
                            tint: currentDefinition.lifecycle.tint
                        )
                    }
                    Text("ID: \(currentDefinition.id)")
                        .font(.callout.monospaced())
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    Task { await runPreflight() }
                } label: {
                    if state.isRunningPreflight {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Run preflight", systemImage: "wand.and.stars")
                    }
                }
                .disabled(state.isRunningPreflight || hasBlockingIssues)
                .accessibilityLabel("Run preflight")
            }
        }
    }

    /// Preflight is the single point where the draft is committed to disk and
    /// any transient secret values are handed to `SecretsClient`. Order matters:
    ///
    /// 1. `saveDraft` persists the current definition so the loop id exists on
    ///    disk before we touch any keychain account (avoids clobbering a
    ///    different loop's stored secret when a fresh id happens to collide).
    /// 2. `storePendingSecrets` writes the transient values so preflight's
    ///    secret-existence check on the control plane can see them.
    /// 3. `clearPendingSecretValues` wipes the in-memory values on success so
    ///    they never live longer than necessary.
    /// 4. `preflight` runs and, when the envelope succeeds, we record the
    ///    exact definition sent as the snapshot the review card compares
    ///    against for drift detection.
    ///
    /// If step 1 or 2 fails we surface the error and abort — preflight is not
    /// run, `preflightSnapshot` is left unchanged, and `fingerprintAcknowledged`
    /// stays false. Once preflight succeeds Approve+Enable does **not** re-run
    /// secret storage. Any subsequent form or secret-value change invalidates
    /// the snapshot (via `hasDrift` / `hasPendingSecretChanges`) and forces a
    /// fresh Run Preflight.
    private func runPreflight() async {
        state.isRunningPreflight = true
        state.lastPreflightError = nil
        defer { state.isRunningPreflight = false }

        let sent = state.buildDefinition()

        // 1. Persist the draft first. A failure here means the id or shape is
        //    already unacceptable on disk, so we must not go further.
        do {
            try await callbacks.saveDraft(sent)
        } catch {
            state.lastPreflightError = "Failed to persist draft before preflight: \(error.localizedDescription)"
            return
        }

        // 2. Store any transient secret values before preflight, so the
        //    control plane's secret-existence check will pass.
        let pending = state.snapshotPendingSecrets()
        if !pending.isEmpty {
            do {
                try await callbacks.storePendingSecrets(pending)
            } catch {
                state.lastPreflightError = "Failed to store pending secrets before preflight: \(error.localizedDescription)"
                return
            }
            // 3. Wipe the transient values on success so the SecureFields
            //    do not retain them for the rest of the session.
            state.clearPendingSecretValues(for: pending)
        }

        // 4. Now the disk state matches `sent`; run preflight and capture
        //    the snapshot the review card compares against for drift.
        do {
            let response = try await callbacks.preflight(sent)
            state.preflight = response
            state.recordPreflightSnapshot(sent)
            // A new preflight resets the acknowledgement checkbox: the user
            // must re-confirm the capability fingerprint.
            state.fingerprintAcknowledged = false
        } catch {
            state.lastPreflightError = "Preflight failed: \(error.localizedDescription)"
        }
    }

    // MARK: Preflight

    private var preflightCard: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 10) {
                LoopsSectionHeader("Preflight", subtitle: preflightSubtitle)
                if let error = state.lastPreflightError {
                    Label(error, systemImage: "xmark.octagon.fill")
                        .foregroundStyle(LoopsPalette.failure)
                        .font(.callout)
                        .accessibilityLabel("Preflight error: \(error)")
                }
                if let preflight = state.preflight {
                    // Errors first — these are fail-closed even when the
                    // envelope succeeded.
                    if !preflight.errors.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Label("Preflight reported \(preflight.errors.count) blocking error\(preflight.errors.count == 1 ? "" : "s").",
                                  systemImage: "xmark.octagon.fill")
                                .foregroundStyle(LoopsPalette.failure)
                                .font(.callout.weight(.semibold))
                            ForEach(Array(preflight.errors.enumerated()), id: \.offset) { _, message in
                                Label(message, systemImage: "circle.fill")
                                    .labelStyle(.titleOnly)
                                    .font(.callout)
                                    .padding(.leading, 8)
                                    .foregroundStyle(LoopsPalette.failure)
                            }
                        }
                        .padding(10)
                        .background(LoopsPalette.failure.opacity(0.10),
                                    in: RoundedRectangle(cornerRadius: 8))
                    }
                    if preflight.warnings.isEmpty {
                        if preflight.errors.isEmpty {
                            Label("No warnings or errors reported by preflight.",
                                  systemImage: "checkmark.seal.fill")
                                .foregroundStyle(LoopsPalette.success)
                                .font(.callout)
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(Array(preflight.warnings.enumerated()), id: \.offset) { _, warning in
                                Label(warning, systemImage: "exclamationmark.triangle.fill")
                                    .foregroundStyle(LoopsPalette.warning)
                                    .font(.callout)
                            }
                        }
                    }
                    if hasDrift {
                        Label("The form has changed since the last preflight. Re-run preflight before enabling.",
                              systemImage: "arrow.triangle.2.circlepath")
                            .foregroundStyle(LoopsPalette.operational)
                            .font(.callout)
                    } else if hasPendingSecretChanges {
                        Label("A secret value was entered or rotated since the last preflight. Re-run preflight so the new value is stored before enabling.",
                              systemImage: "lock.rotation")
                            .foregroundStyle(LoopsPalette.operational)
                            .font(.callout)
                    }
                } else if state.lastPreflightError == nil {
                    Text("Preflight has not been run yet. Run it before enabling the loop so the CLI can validate paths, plugins, and inventory.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    /// True when the current form differs from the snapshot captured on the
    /// most recent successful preflight.
    private var hasDrift: Bool {
        guard state.preflightSnapshot != nil else { return false }
        return !state.matchesPreflightSnapshot(currentDefinition)
    }

    private var preflightSubtitle: String {
        if state.isRunningPreflight { return "Contacting control plane…" }
        if state.preflight != nil { return "Latest control-plane verdict." }
        return "Not yet run for the current draft."
    }

    // MARK: Capability fingerprint

    private var capabilityCard: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 8) {
                LoopsSectionHeader("Capability fingerprint")
                if let current = state.preflight?.fingerprint {
                    fingerprintRow(label: "Current", value: current, tint: fingerprintTint(current: current))
                    if let approved = approvedFingerprint {
                        fingerprintRow(label: "Approved", value: approved, tint: LoopsPalette.inactive)
                        if approved != current {
                            Label("The current fingerprint differs from the last approval. Enabling will require a fresh approval.",
                                  systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(LoopsPalette.operational)
                                .font(.callout)
                        }
                    }
                } else {
                    Text("No fingerprint yet — run preflight to compute one.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                if let hash = state.scriptHash, !hash.hash.isEmpty {
                    Divider()
                    HStack(spacing: 6) {
                        Image(systemName: "number.square")
                            .foregroundStyle(LoopsPalette.identity)
                        Text("Executable/script SHA-256:")
                            .font(.callout)
                        Text(hash.hash)
                            .font(.callout.monospaced())
                            .textSelection(.enabled)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    if !hash.problems.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(hash.problems, id: \.message) { problem in
                                Label(problem.message, systemImage: problem.systemImage)
                                    .font(.caption)
                                    .foregroundStyle(LoopsPalette.failure)
                            }
                        }
                    }
                }
            }
        }
    }

    private func fingerprintTint(current: String) -> Color {
        guard let approved = approvedFingerprint else { return LoopsPalette.identity }
        return approved == current ? LoopsPalette.success : LoopsPalette.operational
    }

    private func fingerprintRow(label: String, value: String, tint: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 76, alignment: .leading)
            Text(value)
                .font(.callout.monospaced())
                .foregroundStyle(tint)
                .textSelection(.enabled)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }

    // MARK: Argv preview

    private var argvCard: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 8) {
                LoopsSectionHeader(
                    "Redacted command",
                    subtitle: "Exactly what the runner will invoke, as reported by preflight. Secret values are never included."
                )
                if let argv = state.preflight?.redactedCommand, !argv.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(argv.enumerated()), id: \.offset) { index, argument in
                            HStack(alignment: .top, spacing: 8) {
                                Text("\(index).")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                    .frame(width: 26, alignment: .trailing)
                                Text(argument)
                                    .font(.callout.monospaced())
                                    .textSelection(.enabled)
                                    .lineLimit(4)
                            }
                        }
                    }
                    .padding(10)
                    .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
                } else {
                    Text("No exact command available yet. Run preflight — the control plane returns the authoritative argv. The builder never guesses.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                if !currentDefinition.environment.secretNames.isEmpty {
                    Text("Secret names delivered via env (values redacted): \(currentDefinition.environment.secretNames.joined(separator: ", "))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: Paths

    private var pathsCard: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 8) {
                LoopsSectionHeader("Filesystem authority")
                pathRow("Working directory", workingDirectory)
                if !extraPaths.isEmpty {
                    pathRow("Extra paths", extraPaths.joined(separator: "\n"))
                }
                if !localPluginPaths.isEmpty {
                    pathRow("Local plugin dirs", localPluginPaths.joined(separator: "\n"))
                }
                if let installed = installedPluginName {
                    pathRow("Installed plugin", installed)
                }
            }
        }
    }

    private func pathRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 140, alignment: .leading)
            Text(value)
                .font(.callout.monospaced())
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var workingDirectory: String {
        switch currentDefinition.execution {
        case .copilot(let value): return value.workingDirectory
        case .scriptFile(let value): return value.workingDirectory
        case .executable(let value): return value.workingDirectory
        }
    }

    private var extraPaths: [String] {
        if case .copilot(let value) = currentDefinition.execution { return value.extraPaths }
        return []
    }

    private var localPluginPaths: [String] {
        if case .copilot(let value) = currentDefinition.execution { return value.localPluginDirectories }
        return []
    }

    private var installedPluginName: String? {
        if case .copilot(let value) = currentDefinition.execution { return value.installedPlugin }
        return nil
    }

    // MARK: Environment

    private var environmentCard: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 8) {
                LoopsSectionHeader("Environment")
                if currentDefinition.environment.plain.isEmpty
                    && currentDefinition.environment.secretNames.isEmpty {
                    Text("No custom environment.").font(.callout).foregroundStyle(.secondary)
                }
                if !currentDefinition.environment.plain.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Plain")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        ForEach(currentDefinition.environment.plain.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                            HStack(alignment: .top) {
                                Text(key).font(.callout.monospaced()).frame(width: 160, alignment: .leading)
                                Text(value).font(.callout.monospaced()).textSelection(.enabled)
                            }
                        }
                    }
                }
                if !currentDefinition.environment.secretNames.isEmpty {
                    Divider()
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Secrets (names only)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        ForEach(currentDefinition.environment.secretNames, id: \.self) { name in
                            HStack {
                                Image(systemName: "lock.shield")
                                    .foregroundStyle(LoopsPalette.identity)
                                Text(name).font(.callout.monospaced())
                                Spacer()
                                Text("value redacted")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: Policy

    private var policyCard: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 8) {
                LoopsSectionHeader("Timeout, retries, retention")
                summaryRow("Timeout", "\(currentDefinition.timeoutSeconds) seconds")
                summaryRow("Retries", "\(currentDefinition.retry.maxRetries) (backoff \(currentDefinition.retry.backoffSeconds)s)")
                summaryRow("Retention", "\(currentDefinition.retention.days) days · max \(currentDefinition.retention.maxRuns) runs")
                summaryRow("Notify on failure", currentDefinition.notifications.onFailure ? "Yes" : "No")
                summaryRow("Notify on success", currentDefinition.notifications.onSuccess ? "Yes" : "No")
                summaryRow("Schedule", scheduleSummary)
            }
        }
    }

    private func summaryRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 160, alignment: .leading)
            Text(value)
                .font(.callout)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var scheduleSummary: String {
        switch currentDefinition.schedule {
        case .manual: return "Manual"
        case .once(let scheduledAt, let grace):
            return "Once at \(scheduledAt) (grace \(grace)s)"
        case .calendar(let hour, let minute, let weekdays, let grace):
            let timeString = String(format: "%02d:%02d", hour, minute)
            if weekdays.isEmpty {
                return "Every day at \(timeString) (grace \(grace)s)"
            }
            return "Weekdays \(weekdays.map(weekdayName).joined(separator: ",")) at \(timeString) (grace \(grace)s)"
        case .interval(let seconds, let grace):
            return "Every \(seconds) seconds (grace \(grace)s)"
        }
    }

    private func weekdayName(_ index: Int) -> String {
        switch index {
        case 0: return "Sun"; case 1: return "Mon"; case 2: return "Tue"; case 3: return "Wed"
        case 4: return "Thu"; case 5: return "Fri"; case 6: return "Sat"
        default: return String(index)
        }
    }

    // MARK: Validation summary

    private var validationCard: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 8) {
                LoopsSectionHeader("Form validation")
                if validationIssues.isEmpty {
                    Label("No form errors.", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(LoopsPalette.success)
                        .font(.callout)
                } else {
                    ForEach(validationIssues) { issue in
                        Label(issue.message, systemImage: issue.severity == .error ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(issue.severity == .error ? LoopsPalette.failure : LoopsPalette.warning)
                            .font(.callout)
                    }
                }
            }
        }
    }

    // MARK: Enable

    private var enableCard: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 12) {
                LoopsSectionHeader(
                    "Approve and enable",
                    subtitle: "Enabling starts the runner at the next scheduled tick."
                )
                Toggle(isOn: $state.fingerprintAcknowledged) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("I have reviewed every capability above.")
                            .font(.callout.weight(.semibold))
                        Text("The current fingerprint becomes the approved fingerprint. Changing any capability afterwards will require re-approval.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox)
                .disabled(state.preflight?.fingerprint == nil)
                .accessibilityLabel("Acknowledge capability fingerprint")

                if let error = state.lastActionError {
                    Label(error, systemImage: "xmark.octagon.fill")
                        .foregroundStyle(LoopsPalette.failure)
                        .font(.callout)
                }

                HStack(spacing: 10) {
                    Button {
                        Task { await performEnable() }
                    } label: {
                        if state.isPerformingAction {
                            ProgressView().controlSize(.small)
                        } else {
                            Label("Approve and enable", systemImage: "checkmark.seal.fill")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!isEnableReady)
                    .accessibilityLabel("Approve and enable")
                    Text(enableStatusHint)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    /// True when the user has entered a secret value that has not yet been
    /// pushed through `storePendingSecrets`. Because `runPreflight` is the
    /// only path that persists values, any non-empty pending set here means
    /// the form has drifted since the last preflight and a fresh Run
    /// Preflight is required before Enable.
    private var hasPendingSecretChanges: Bool {
        !state.snapshotPendingSecrets().isEmpty
    }

    private var isEnableReady: Bool {
        !state.isPerformingAction
            && !hasBlockingIssues
            && !hasDrift
            && !hasPendingSecretChanges
            && preflightHasNoErrors
            && state.preflight != nil
            && (state.preflight?.fingerprint != nil)
            && state.fingerprintAcknowledged
    }

    private var preflightHasNoErrors: Bool {
        !(state.preflight?.hasBlockingErrors ?? true)
    }

    private var enableStatusHint: String {
        if hasBlockingIssues { return "Resolve form errors first." }
        if state.preflight == nil { return "Run preflight to persist the draft and compute the capability fingerprint." }
        if !preflightHasNoErrors { return "Preflight reported blocking errors — resolve them and re-run." }
        if hasDrift { return "Form has changed since preflight — re-run and re-acknowledge." }
        if hasPendingSecretChanges { return "Secret values changed since preflight — re-run to store them and re-acknowledge." }
        if state.preflight?.fingerprint == nil { return "Preflight did not return a fingerprint." }
        if !state.fingerprintAcknowledged { return "Acknowledge the fingerprint above to enable." }
        return "Ready to enable."
    }

    private func performEnable() async {
        state.enableAttempted = true
        state.isPerformingAction = true
        state.lastActionError = nil
        defer { state.isPerformingAction = false }
        do {
            let definition = state.buildDefinition()
            // Safety net: if the form changed since preflight, refuse instead
            // of silently approving a different definition than the server
            // fingerprinted. `runPreflight` is the only path that persists
            // draft state and secret values.
            guard state.matchesPreflightSnapshot(definition) else {
                state.lastActionError = "Form changed since preflight. Re-run preflight and re-acknowledge before enabling."
                return
            }
            // Any transient secret values present here mean the user rotated
            // after preflight — those must go through Run Preflight so the
            // control plane's secret-existence check can see them.
            guard state.snapshotPendingSecrets().isEmpty else {
                state.lastActionError = "Secret values have changed since preflight. Re-run preflight to persist them before enabling."
                return
            }
            guard let fingerprint = state.preflight?.fingerprint else {
                state.lastActionError = "Preflight did not return a fingerprint."
                return
            }
            // Secrets are already persisted (they went through
            // `storePendingSecrets` inside `runPreflight`) and the draft was
            // saved at that time too. Approve and enable operate purely on
            // the snapshotted definition.
            try await callbacks.approve(definition, fingerprint)
            try await callbacks.enable(definition)
        } catch {
            state.lastActionError = error.localizedDescription
        }
    }
}

#if DEBUG
struct PermissionReviewView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            preview(fingerprintMatch: true).previewDisplayName("Approved fingerprint")
            preview(fingerprintMatch: false).previewDisplayName("Drift").preferredColorScheme(.dark)
            previewNoPreflight().previewDisplayName("No preflight yet")
        }
        .frame(width: 780, height: 900)
        .previewLayout(.sizeThatFits)
    }

    static func preview(fingerprintMatch: Bool) -> some View {
        let existing = LoopsPreviewData.dependencyLoop
        let state = LoopBuilderState(
            mode: .edit(originalID: existing.id),
            kind: .copilot,
            existing: existing,
            inventory: InventoryResponse(),
            now: { Date(timeIntervalSince1970: 1_755_000_000) },
            idGenerator: { existing.id }
        )
        state.currentStep = .review
        state.fingerprintAcknowledged = false
        let fingerprint = fingerprintMatch
            ? (existing.approval.fingerprint ?? String(repeating: "a", count: 64))
            : String(repeating: "c", count: 64)
        state.preflight = PreflightResponse(
            loop: existing,
            fingerprint: fingerprint,
            redactedCommand: [
                "copilot", "-p", "--autopilot", "--allow-all-tools",
                "--model", "gpt-5.6-sol",
                "--agent", "core-agents:researcher",
                "--add-dir", "/Users/USERNAME/Repos/web-app",
                "\"Summarize dependency drift…\"",
            ],
            warnings: fingerprintMatch ? [] : ["Working directory changed since approval."],
            errors: []
        )
        state.recordPreflightSnapshot(state.buildDefinition())
        return PermissionReviewView(state: state, callbacks: LoopBuilderCallbacks())
    }

    static func previewNoPreflight() -> some View {
        let state = LoopBuilderState(
            mode: .create,
            kind: .script,
            now: { Date(timeIntervalSince1970: 1_755_000_000) },
            idGenerator: { "maintenance" }
        )
        state.name = "Repository maintenance"
        state.syncAutoID()
        state.scriptMode = .scriptFile
        state.scriptPath = "/Users/USERNAME/scripts/repo-maintenance.sh"
        state.scriptWorkingDirectory = "/Users/USERNAME/Repos/web-app"
        state.scriptArguments = [BuilderArgumentRow(value: "--prune")]
        state.scriptHash = BuilderHashResult(
            path: state.scriptPath,
            hash: String(repeating: "d", count: 64),
            problems: [.missingShebang]
        )
        state.currentStep = .review
        return PermissionReviewView(state: state, callbacks: LoopBuilderCallbacks())
    }
}
#endif
