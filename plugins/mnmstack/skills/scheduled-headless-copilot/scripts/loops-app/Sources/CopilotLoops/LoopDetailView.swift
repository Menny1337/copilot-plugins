import LoopsModels
import SwiftUI

struct LoopDetailCallbacks {
    var edit: (String) -> Void
    var enable: (String) -> Void
    var runNow: (String) -> Void
    var pause: (String) -> Void
    var resume: (String) -> Void
    var openLiveRun: (String) -> Void
    var archive: (String) -> Void
    var purge: (String) -> Void
}

struct LoopDetailView: View {
    let state: LoopState
    let callbacks: LoopDetailCallbacks

    @State private var confirmingArchive = false
    @State private var confirmingPurge = false

    private var lifecycle: LoopLifecycle { state.definition.lifecycle }
    private var approvalCurrent: Bool {
        guard let approved = state.definition.approval.fingerprint,
              let current = state.currentFingerprint,
              !approved.isEmpty,
              !current.isEmpty
        else { return false }
        return approved == current
    }
    private var canRunNow: Bool {
        [.ready, .enabled, .paused].contains(lifecycle) && approvalCurrent && !state.isRunning
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                statusCards
                definitionCard
                approvalCard
                destructiveActions
            }
            .padding(20)
            .frame(maxWidth: 980, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .confirmationDialog(
            "Archive \(state.definition.name)?",
            isPresented: $confirmingArchive,
            titleVisibility: .visible
        ) {
            Button("Archive", role: .destructive) { callbacks.archive(state.id) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The schedule will be unloaded. The loop definition and history are preserved.")
        }
        .confirmationDialog(
            "Permanently purge \(state.definition.name)?",
            isPresented: $confirmingPurge,
            titleVisibility: .visible
        ) {
            Button("Purge loop and history", role: .destructive) { callbacks.purge(state.id) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This deletes the archived loop, its run history, and its Keychain secret items. This cannot be undone.")
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 14) {
            LoopKindIcon(kind: state.definition.kind, size: 42)
            VStack(alignment: .leading, spacing: 5) {
                Text(state.definition.name)
                    .font(.largeTitle.weight(.semibold))
                HStack(spacing: 8) {
                    LoopsStatusPill(
                        title: lifecycle.displayName,
                        systemImage: lifecycle == .enabled ? "checkmark.circle.fill" : "circle",
                        tint: lifecycle.tint
                    )
                    Text(state.id)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
            Spacer()
            actionButtons
        }
    }

    @ViewBuilder
    private var actionButtons: some View {
        HStack {
            Button("Edit", systemImage: "pencil") { callbacks.edit(state.id) }
                .disabled(state.isRunning || lifecycle == .archived)

            if state.isRunning {
                Button("Open live run", systemImage: "waveform.path.ecg") {
                    callbacks.openLiveRun(state.id)
                }
                .buttonStyle(.borderedProminent)
            } else {
                Button("Run now", systemImage: "play.fill") { callbacks.runNow(state.id) }
                    .disabled(!canRunNow)
            }

            switch lifecycle {
            case .ready:
                Button("Enable", systemImage: "checkmark.circle") { callbacks.enable(state.id) }
                    .disabled(!approvalCurrent)
            case .enabled:
                Button("Pause", systemImage: "pause.fill") { callbacks.pause(state.id) }
            case .paused:
                Button("Resume", systemImage: "play.circle") { callbacks.resume(state.id) }
            case .draft, .needsReview, .archived:
                EmptyView()
            }
        }
    }

    private var statusCards: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 12)], spacing: 12) {
            LoopsMetricTile(
                title: "Status",
                value: LoopProjection.statusSummary(for: state),
                systemImage: state.isRunning ? "play.circle.fill" : "circle",
                tint: state.isRunning ? LoopsPalette.running : lifecycle.tint
            )
            LoopsMetricTile(
                title: "Next scheduled run",
                value: nextRunText,
                systemImage: "calendar.badge.clock",
                tint: LoopsPalette.operational
            )
            LoopsMetricTile(
                title: "Last outcome",
                value: state.lastRun?.status.displayName ?? "No runs",
                systemImage: state.lastRun?.status.systemImage ?? "clock",
                tint: state.lastRun?.status.tint ?? LoopsPalette.inactive
            )
        }
    }

    private var nextRunText: String {
        guard lifecycle == .enabled,
              let date = LoopProjection.parseTimestamp(state.nextScheduledAt),
              date > Date()
        else { return "None" }
        return DateFormatter.localizedString(from: date, dateStyle: .short, timeStyle: .short)
    }

    private var definitionCard: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 12) {
                LoopsSectionHeader("Configuration")
                detailRow("Kind", state.definition.kind == .copilot ? "Copilot" : "Script")
                detailRow("Schedule", scheduleDescription)
                detailRow("Execution", executionDescription)
                detailRow("Working directory", workingDirectory)
                detailRow("Timeout", timeoutDescription)
                detailRow("Retries", retryDescription)
                detailRow("Overlap", "Skip and record overlapping scheduled fires")
                detailRow("Retention", "\(state.definition.retention.days) days, up to \(state.definition.retention.maxRuns) runs")
                if !state.definition.environment.secretNames.isEmpty {
                    detailRow("Keychain secrets", state.definition.environment.secretNames.sorted().joined(separator: ", "))
                }
                if let error = state.reconciliationError, !error.isEmpty {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(LoopsPalette.failure)
                        .textSelection(.enabled)
                }
            }
        }
    }

    private var approvalCard: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 10) {
                LoopsSectionHeader("Capability approval")
                Label(
                    approvalCurrent ? approvalStatusText : "No current capability approval; review this loop before enabling it",
                    systemImage: approvalCurrent ? "checkmark.shield.fill" : "lock.trianglebadge.exclamationmark"
                )
                .foregroundStyle(approvalCurrent ? LoopsPalette.success : LoopsPalette.operational)
                if let fingerprint = state.definition.approval.fingerprint {
                    Text(fingerprint)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                } else {
                    Text("No approved fingerprint")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var destructiveActions: some View {
        if lifecycle == .archived {
            LoopsCard {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Permanently remove this loop")
                            .font(.headline)
                        Text("Keychain items are deleted before loop data.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Purge…", role: .destructive) { confirmingPurge = true }
                }
            }
        } else {
            LoopsCard {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Archive this loop")
                            .font(.headline)
                        Text("Unload its schedule while preserving definition and history.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Archive…", role: .destructive) { confirmingArchive = true }
                        .disabled(state.isRunning)
                }
            }
        }
    }

    private func detailRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title)
                .foregroundStyle(.secondary)
                .frame(width: 145, alignment: .leading)
            Text(value)
                .textSelection(.enabled)
            Spacer(minLength: 0)
        }
        .font(.callout)
    }

    private var scheduleDescription: String {
        switch state.definition.schedule {
        case .manual:
            return "Manual only"
        case .once(let scheduledAt, let grace):
            return "Once at \(scheduledAt), \(grace)s grace"
        case .calendar(let hour, let minute, let weekdays, let grace):
            let symbols = Calendar.current.shortWeekdaySymbols
            let days = weekdays.isEmpty
                ? "every day"
                : weekdays.map { symbols.indices.contains($0) ? symbols[$0] : String($0) }.joined(separator: ", ")
            return String(format: "%02d:%02d local time, %@, %ds grace", hour, minute, days, grace)
        case .interval(let seconds, let grace):
            return "Every \(seconds)s, \(grace)s grace"
        }
    }

    private var executionDescription: String {
        switch state.definition.execution {
        case .copilot(let execution):
            return "Copilot model \(execution.model)"
        case .scriptFile(let execution):
            return execution.path
        case .executable(let execution):
            return ([execution.path] + execution.arguments).joined(separator: " ")
        }
    }

    private var workingDirectory: String {
        switch state.definition.execution {
        case .copilot(let execution): return execution.workingDirectory
        case .scriptFile(let execution): return execution.workingDirectory
        case .executable(let execution): return execution.workingDirectory
        }
    }

    private var timeoutDescription: String {
        state.definition.timeoutSeconds == 0 ? "No timeout" : "\(state.definition.timeoutSeconds) seconds"
    }

    private var retryDescription: String {
        let retry = state.definition.retry
        guard retry.maxRetries > 0 else { return "Disabled" }
        return "\(retry.maxRetries), \(retry.backoffSeconds)s backoff"
    }

    private var approvalStatusText: String {
        "Approval matches the current capability fingerprint"
    }
}
