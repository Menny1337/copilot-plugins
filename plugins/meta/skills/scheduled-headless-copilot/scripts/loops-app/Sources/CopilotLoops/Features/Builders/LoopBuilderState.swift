import AppKit
import Combine
import Foundation
import LoopsModels
import SwiftUI

/// Central authoring state for the loop builder. A plain `ObservableObject`
/// (macOS 13 baseline) that owns every field bound by the four wizard steps.
///
/// The state pattern is intentionally thin: view builders manipulate this
/// object directly through `@ObservedObject` bindings, and the class exposes
/// deterministic helpers (`buildDefinition`, `validate`, `advance`) that keep
/// side-effect wiring outside SwiftUI views. `now` and `idGenerator` are
/// injected so previews and tests are deterministic.
@MainActor
final class LoopBuilderState: ObservableObject {

    // MARK: Configuration

    /// Injected timestamp source (defaults to `Date.init`). Used for
    /// created/updated stamps and one-time schedule defaults.
    let now: () -> Date
    let createdAt: String

    /// Stable suffix returned exactly once at init time by the injected id
    /// generator. Used to guarantee a valid loop id even before the user has
    /// typed a name. Never regenerated afterwards, so the auto-derived id
    /// stays stable across the entire authoring session.
    let stableIDSuffix: String

    let mode: BuilderMode

    /// Maximum loop id length enforced by validation. Matches the on-disk
    /// filename budget and the control-plane account regex.
    static let maxLoopIDLength = 64
    /// Maximum human-readable name length surfaced in the UI.
    static let maxNameLength = 120

    // MARK: Step & lifecycle

    @Published var currentStep: BuilderStep = .configure
    @Published var visitedSteps: Set<BuilderStep> = [.configure]

    // MARK: Identity

    @Published var kind: LoopKind
    @Published var name: String = ""
    @Published var loopID: String = ""
    @Published var idIsAutoDerived: Bool = true
    @Published private(set) var hasPersistedIdentity: Bool = false

    var identityLocked: Bool { mode.isEdit || hasPersistedIdentity }

    // MARK: Copilot configure

    @Published var installedPlugin: String = ""
    @Published var localPluginPaths: [BuilderPathRow] = []
    @Published var agent: String = ""
    @Published var skill: String = ""
    @Published var model: String = ""
    @Published var copilotWorkingDirectory: String = ""
    @Published var copilotExtraPaths: [BuilderPathRow] = []
    @Published var prompt: String = ""

    /// Populated by the AppModel; the configure step surfaces `errors` when
    /// non-empty and refuses to render an empty picker as a "clean" list.
    @Published var inventory: InventoryResponse = InventoryResponse()

    // MARK: Script configure

    @Published var scriptMode: ScriptExecutionMode = .scriptFile
    @Published var scriptPath: String = ""
    @Published var executablePath: String = ""
    @Published var scriptArguments: [BuilderArgumentRow] = []
    @Published var scriptWorkingDirectory: String = ""
    @Published var environmentRows: [BuilderEnvRow] = []
    @Published var secretRows: [BuilderSecretRow] = []
    @Published private(set) var removedStoredSecretNames: Set<String> = []
    @Published var scriptHash: BuilderHashResult?
    @Published var isHashing: Bool = false

    // MARK: Permissions

    @Published var permissionProfile: PermissionProfile = .fullAutonomy
    @Published var allowTools: [BuilderArgumentRow] = []
    @Published var denyTools: [BuilderArgumentRow] = []
    @Published var allowUrls: [BuilderArgumentRow] = []
    @Published var denyUrls: [BuilderArgumentRow] = []

    // MARK: Schedule & policy

    @Published var scheduleKind: ScheduleKind = .manual
    @Published var oneTimeDate: Date
    /// Local wall-clock hour + minute for calendar schedules.
    @Published var calendarTime: Date
    /// Backed by ISO weekday indices 0=Sun..6=Sat (matches `LoopSchedule`).
    @Published var selectedWeekdays: Set<Int> = [1, 2, 3, 4, 5]
    @Published var intervalSeconds: Int = 3600
    /// Timeout in seconds. `0` means "no timeout" (unbounded). Never coerced
    /// upward when building the definition.
    @Published var timeoutSeconds: Int = 1800
    @Published var maxRetries: Int = 0
    @Published var backoffSeconds: Int = 60
    @Published var notifyOnFailure: Bool = true
    @Published var notifyOnSuccess: Bool = false
    @Published var retentionDays: Int = 30
    @Published var retentionMaxRuns: Int = 100
    @Published var graceSeconds: Int = 300

    // MARK: Review

    @Published var preflight: PreflightResponse?
    @Published var lastPreflightError: String?
    @Published var isRunningPreflight: Bool = false
    @Published var fingerprintAcknowledged: Bool = false
    @Published var enableAttempted: Bool = false
    @Published var lastActionError: String?
    @Published var isPerformingAction: Bool = false

    /// The exact `LoopDefinition` that was sent to preflight most recently.
    /// The review screen compares this against the current form to detect
    /// drift; any drift invalidates the fingerprint acknowledgement so the
    /// user must re-run preflight before Enable is allowed.
    @Published var preflightSnapshot: LoopDefinition?

    // MARK: Persistent record

    /// The original definition when editing, so the review screen can compare
    /// approved vs current fingerprints and highlight capability drift.
    let originalDefinition: LoopDefinition?

    // MARK: Init

    init(
        mode: BuilderMode,
        kind: LoopKind,
        existing: LoopDefinition? = nil,
        inventory: InventoryResponse = InventoryResponse(),
        now: @escaping () -> Date = Date.init,
        idGenerator: (() -> String)? = nil
    ) {
        self.mode = mode
        self.kind = kind
        self.originalDefinition = existing
        self.inventory = inventory
        self.now = now
        // Call the injected generator exactly once, so the auto-derived id
        // stays stable even when the user clears the name mid-authoring.
        let defaultGenerator: () -> String = {
            "loop-" + UUID().uuidString.lowercased().prefix(8)
        }
        let rawSuffix = (idGenerator ?? defaultGenerator)()
        self.stableIDSuffix = LoopBuilderState.slug(from: rawSuffix)

        let referenceDate = now()
        self.createdAt = existing?.createdAt ?? LoopProjection.formatTimestamp(referenceDate)
        // Default one-time schedule is one hour ahead of the injected `now`
        // (minute-aligned so the DatePicker starts on an editable minute).
        let hourAhead = referenceDate.addingTimeInterval(3600)
        self.oneTimeDate = LoopBuilderState.floorToMinute(hourAhead, calendar: .current)
        // Default calendar time is 09:00 local on the injected `now` date.
        var components = Calendar.current.dateComponents([.year, .month, .day], from: referenceDate)
        components.hour = 9
        components.minute = 0
        self.calendarTime = Calendar.current.date(from: components) ?? referenceDate

        if let existing {
            hydrate(from: existing)
            hasPersistedIdentity = true
        } else {
            // Pre-populate the id with the stable suffix so the first
            // Continue press has a valid slug even if the user has not typed
            // a name yet.
            self.loopID = stableIDSuffix
        }
    }

    // MARK: Hydration from LoopDefinition

    /// Populate all @Published fields from an existing loop (edit mode).
    /// Secret values remain empty — the builder never re-reads secret values
    /// from `SecretsClient`; it only exposes stored *names*.
    private func hydrate(from loop: LoopDefinition) {
        name = loop.name
        loopID = loop.id
        idIsAutoDerived = false
        kind = loop.kind

        switch loop.execution {
        case .copilot(let value):
            installedPlugin = value.installedPlugin ?? ""
            localPluginPaths = value.localPluginDirectories.map { BuilderPathRow(path: $0) }
            agent = value.agent ?? ""
            skill = value.skill ?? ""
            model = value.model
            copilotWorkingDirectory = value.workingDirectory
            copilotExtraPaths = value.extraPaths.map { BuilderPathRow(path: $0) }
            prompt = value.prompt
        case .scriptFile(let value):
            scriptMode = .scriptFile
            scriptPath = value.path
            scriptArguments = value.arguments.map { BuilderArgumentRow(value: $0) }
            scriptWorkingDirectory = value.workingDirectory
            scriptHash = BuilderHashResult(path: value.path, hash: value.contentHash)
        case .executable(let value):
            scriptMode = .executable
            executablePath = value.path
            scriptArguments = value.arguments.map { BuilderArgumentRow(value: $0) }
            scriptWorkingDirectory = value.workingDirectory
            if let hash = value.executableHash {
                scriptHash = BuilderHashResult(path: value.path, hash: hash)
            }
        }

        environmentRows = loop.environment.plain
            .sorted { $0.key < $1.key }
            .map { BuilderEnvRow(name: $0.key, value: $0.value) }

        secretRows = loop.environment.secretNames.map {
            BuilderSecretRow(name: $0, value: "", isStored: true)
        }

        permissionProfile = loop.permissions.profile == .fullAutonomy ? .fullAutonomy : .custom
        allowTools = loop.permissions.allowTools.map { BuilderArgumentRow(value: $0) }
        denyTools = loop.permissions.denyTools.map { BuilderArgumentRow(value: $0) }
        allowUrls = loop.permissions.allowUrls.map { BuilderArgumentRow(value: $0) }
        denyUrls = loop.permissions.denyUrls.map { BuilderArgumentRow(value: $0) }

        switch loop.schedule {
        case .manual:
            scheduleKind = .manual
        case .once(let scheduledAt, let grace):
            scheduleKind = .oneTime
            if let date = LoopProjection.parseTimestamp(scheduledAt) {
                oneTimeDate = LoopBuilderState.floorToMinute(date, calendar: .current)
            }
            graceSeconds = grace
        case .calendar(let hour, let minute, let weekdays, let grace):
            scheduleKind = weekdays.isEmpty ? .dailyCalendar : .weekdayCalendar
            selectedWeekdays = Set(weekdays)
            var components = Calendar.current.dateComponents(
                [.year, .month, .day],
                from: now()
            )
            components.hour = hour
            components.minute = minute
            if let date = Calendar.current.date(from: components) {
                calendarTime = date
            }
            graceSeconds = grace
        case .interval(let seconds, let grace):
            scheduleKind = .interval
            intervalSeconds = max(60, seconds)
            graceSeconds = grace
        }

        timeoutSeconds = loop.timeoutSeconds
        maxRetries = loop.retry.maxRetries
        backoffSeconds = loop.retry.backoffSeconds
        notifyOnFailure = loop.notifications.onFailure
        notifyOnSuccess = loop.notifications.onSuccess
        retentionDays = loop.retention.days
        retentionMaxRuns = loop.retention.maxRuns
    }

    // MARK: ID slugging

    /// Rebuild `loopID` from `name` when the user hasn't customised it. Called
    /// automatically as the user types in the name field. In edit mode the id
    /// is immutable — the field is disabled in the view and this becomes a
    /// no-op regardless.
    func syncAutoID() {
        guard !identityLocked else { return }
        guard idIsAutoDerived else { return }
        let base = LoopBuilderState.slug(from: name)
        if base.isEmpty {
            // Fall back to the stable suffix so the id is always valid.
            loopID = stableIDSuffix
        } else {
            loopID = LoopBuilderState.capIDLength(base)
        }
    }

    func markIdentityPersisted() {
        hasPersistedIdentity = true
        idIsAutoDerived = false
    }

    /// Deterministic slugger: lowercase, replace non-alphanumeric with `-`,
    /// trim leading/trailing dashes, collapse runs. Does **not** cap length —
    /// use `capIDLength` to enforce the loop-id budget.
    static func slug(from raw: String) -> String {
        let lowered = raw.lowercased()
        let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789")
        var scalars: [Character] = []
        var lastWasDash = false
        for character in lowered {
            if allowed.contains(character) {
                scalars.append(character)
                lastWasDash = false
            } else if !lastWasDash {
                scalars.append("-")
                lastWasDash = true
            }
        }
        while scalars.first == "-" { scalars.removeFirst() }
        while scalars.last == "-" { scalars.removeLast() }
        return String(scalars)
    }

    /// Enforce `maxLoopIDLength` and trim any dash the truncation introduced
    /// so the id remains regex-legal.
    static func capIDLength(_ raw: String) -> String {
        guard raw.count > maxLoopIDLength else { return raw }
        var truncated = raw.prefix(maxLoopIDLength)
        while truncated.last == "-" { truncated = truncated.dropLast() }
        return String(truncated)
    }

    /// Floors a date to whole-minute precision (seconds & nanoseconds cleared)
    /// so one-time schedule serialization matches what the control plane
    /// expects.
    static func floorToMinute(_ date: Date, calendar: Calendar) -> Date {
        let components = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute],
            from: date
        )
        return calendar.date(from: components) ?? date
    }

    // MARK: Row mutation helpers (kept on the state so views stay declarative)

    func addPathRow(_ keyPath: ReferenceWritableKeyPath<LoopBuilderState, [BuilderPathRow]>) {
        self[keyPath: keyPath].append(BuilderPathRow())
    }

    func removePathRow(id: String, from keyPath: ReferenceWritableKeyPath<LoopBuilderState, [BuilderPathRow]>) {
        self[keyPath: keyPath].removeAll { $0.id == id }
    }

    func addArgumentRow(_ keyPath: ReferenceWritableKeyPath<LoopBuilderState, [BuilderArgumentRow]>) {
        self[keyPath: keyPath].append(BuilderArgumentRow())
    }

    func removeArgumentRow(id: String, from keyPath: ReferenceWritableKeyPath<LoopBuilderState, [BuilderArgumentRow]>) {
        self[keyPath: keyPath].removeAll { $0.id == id }
    }

    func addEnvRow() { environmentRows.append(BuilderEnvRow()) }

    func removeEnvRow(id: String) { environmentRows.removeAll { $0.id == id } }

    func addSecretRow() { secretRows.append(BuilderSecretRow()) }

    func removeSecretRow(id: String) {
        if let row = secretRows.first(where: { $0.id == id }), row.isStored {
            let name = row.name.trimmingCharacters(in: .whitespacesAndNewlines)
            if !name.isEmpty {
                removedStoredSecretNames.insert(name)
            }
        }
        secretRows.removeAll { $0.id == id }
    }

    func secretNamesToDelete(afterSaving definition: LoopDefinition) -> [String] {
        let retained = Set(definition.environment.secretNames)
        return removedStoredSecretNames.filter { !retained.contains($0) }.sorted()
    }

    func markSecretNamesDeleted(_ names: [String]) {
        removedStoredSecretNames.subtract(names)
    }

    func toggleWeekday(_ weekday: Int) {
        if selectedWeekdays.contains(weekday) {
            selectedWeekdays.remove(weekday)
        } else {
            selectedWeekdays.insert(weekday)
        }
    }

    // MARK: Definition assembly

    /// The stable id used for pending secrets / preflight requests. Falls back
    /// to a placeholder before the name has been entered so the review step
    /// never emits an empty account.
    var effectiveLoopID: String {
        if !loopID.isEmpty { return loopID }
        let derived = LoopBuilderState.slug(from: name)
        if !derived.isEmpty { return derived }
        return "new-loop"
    }

    /// Build a fresh `LoopDefinition` from the current form. Only invoked when
    /// validation reports no errors; still tolerant so the review step can
    /// preview a partially-completed loop.
    func buildDefinition() -> LoopDefinition {
        let currentTime = LoopProjection.formatTimestamp(now())
        let scheduleValue = buildSchedule()
        let executionValue = buildExecution()
        let permissionsValue = buildPermissions()
        let environmentValue = buildEnvironment()

        return LoopDefinition(
            id: effectiveLoopID,
            name: nameForDefinition(),
            kind: kind,
            lifecycle: buildLifecycle(),
            schedule: scheduleValue,
            execution: executionValue,
            permissions: permissionsValue,
            environment: environmentValue,
            // Canonical timeout bound: 0...604800. 0 explicitly means "no
            // timeout"; do not coerce it up to 1.
            timeoutSeconds: min(604_800, max(0, timeoutSeconds)),
            retry: RetryPolicy(
                maxRetries: min(5, max(0, maxRetries)),
                backoffSeconds: min(86_400, max(0, backoffSeconds))
            ),
            overlapPolicy: originalDefinition?.overlapPolicy ?? "skip",
            notifications: NotificationPolicy(
                onFailure: notifyOnFailure,
                onSuccess: notifyOnSuccess
            ),
            retention: RetentionPolicy(
                days: min(3650, max(1, retentionDays)),
                maxRuns: min(10_000, max(1, retentionMaxRuns))
            ),
            approval: originalDefinition?.approval ?? Approval(),
            createdAt: createdAt,
            updatedAt: currentTime
        )
    }

    private func nameForDefinition() -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? effectiveLoopID : trimmed
    }

    private func buildLifecycle() -> LoopLifecycle {
        if let existing = originalDefinition {
            switch existing.lifecycle {
            case .enabled, .paused: return .needsReview
            default: return existing.lifecycle
            }
        }
        return .needsReview
    }

    private func buildExecution() -> LoopExecution {
        switch kind {
        case .copilot:
            return .copilot(CopilotExecution(
                prompt: prompt,
                model: model.trimmingCharacters(in: .whitespacesAndNewlines),
                workingDirectory: copilotWorkingDirectory,
                extraPaths: copilotExtraPaths.compactMap { $0.trimmed },
                localPluginDirectories: localPluginPaths.compactMap { $0.trimmed },
                installedPlugin: installedPlugin.trimmedOrNil,
                agent: agent.trimmedOrNil,
                skill: skill.trimmedOrNil
            ))
        case .script:
            switch scriptMode {
            case .scriptFile:
                return .scriptFile(ScriptFileExecution(
                    path: scriptPath,
                    workingDirectory: scriptWorkingDirectory,
                    arguments: scriptArguments.map(\.value),
                    // Never attach a hash that was computed for a different
                    // path or is not a canonical 64-char hex string.
                    contentHash: hashForActivePath(scriptPath) ?? ""
                ))
            case .executable:
                return .executable(ExecutableExecution(
                    path: executablePath,
                    workingDirectory: scriptWorkingDirectory,
                    arguments: scriptArguments.map(\.value),
                    executableHash: hashForActivePath(executablePath)
                ))
            }
        }
    }

    /// Returns the SHA-256 attached to `scriptHash` only when its `path`
    /// matches the current field value AND the hex payload looks valid.
    /// Otherwise the caller receives `nil` and the definition carries no hash
    /// (which validation rejects as an error, exactly as required).
    private func hashForActivePath(_ activePath: String) -> String? {
        guard let hash = scriptHash else { return nil }
        guard hash.path == activePath else { return nil }
        guard LoopBuilderState.isValidSHA256Hex(hash.hash) else { return nil }
        return hash.hash
    }

    /// True when `raw` is a lowercase 64-hex SHA-256 digest.
    static func isValidSHA256Hex(_ raw: String) -> Bool {
        guard raw.count == 64 else { return false }
        return raw.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil
    }

    private func buildPermissions() -> PermissionConfig {
        switch permissionProfile {
        case .fullAutonomy:
            return PermissionConfig(profile: .fullAutonomy, allowAll: true)
        case .custom:
            return PermissionConfig(
                profile: .custom,
                allowAll: false,
                allowTools: allowTools.compactMap { $0.trimmed },
                denyTools: denyTools.compactMap { $0.trimmed },
                allowUrls: allowUrls.compactMap { $0.trimmed },
                denyUrls: denyUrls.compactMap { $0.trimmed }
            )
        }
    }

    private func buildEnvironment() -> EnvironmentConfig {
        var plain: [String: String] = [:]
        for row in environmentRows {
            let trimmedName = row.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedName.isEmpty else { continue }
            plain[trimmedName] = row.value
        }
        let secretNames = secretRows
            .map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return EnvironmentConfig(plain: plain, secretNames: secretNames)
    }

    private func buildSchedule() -> LoopSchedule {
        let grace = min(3600, max(0, graceSeconds))
        switch scheduleKind {
        case .manual:
            // Grace is meaningless without a fired schedule; Node ignores it
            // for manual loops. Emit 0 so the on-disk form is stable.
            return .manual
        case .oneTime:
            // Normalize to whole-minute precision — Node's schedule schema
            // rejects sub-minute components.
            let normalized = LoopBuilderState.floorToMinute(oneTimeDate, calendar: .current)
            return .once(
                scheduledAt: LoopProjection.formatTimestamp(normalized),
                graceSeconds: grace
            )
        case .dailyCalendar:
            let components = Calendar.current.dateComponents([.hour, .minute], from: calendarTime)
            return .calendar(
                hour: components.hour ?? 0,
                minute: components.minute ?? 0,
                weekdays: [],
                graceSeconds: grace
            )
        case .weekdayCalendar:
            let components = Calendar.current.dateComponents([.hour, .minute], from: calendarTime)
            return .calendar(
                hour: components.hour ?? 0,
                minute: components.minute ?? 0,
                weekdays: selectedWeekdays.sorted(),
                graceSeconds: grace
            )
        case .interval:
            return .interval(
                seconds: min(31_536_000, max(60, intervalSeconds)),
                graceSeconds: grace
            )
        }
    }

    // MARK: Pending secrets

    /// Snapshot the pending secret payloads (name + non-empty value entries).
    /// The array is safe to hand to `SecretsClient` via
    /// `LoopBuilderCallbacks.storePendingSecrets`.
    func snapshotPendingSecrets() -> [PendingSecret] {
        secretRows.compactMap { row in
            let trimmedName = row.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedName.isEmpty else { return nil }
            guard !row.value.isEmpty else { return nil }
            return PendingSecret(
                loopID: effectiveLoopID,
                name: trimmedName,
                value: Data(row.value.utf8)
            )
        }
    }

    /// Clear the transient value buffer once pending secrets have been handed
    /// to the integrator. `isStored` flips to `true` on rows that had a value.
    func clearPendingSecretValues(for stored: [PendingSecret]) {
        let storedNames = Set(stored.map { $0.name })
        for index in secretRows.indices {
            let name = secretRows[index].name.trimmingCharacters(in: .whitespacesAndNewlines)
            if storedNames.contains(name) {
                secretRows[index].value = ""
                secretRows[index].isStored = true
            }
        }
    }

    // MARK: Hash invalidation

    /// Drop any cached hash whose recorded path differs from the currently
    /// active path for the selected script mode. Called from the view whenever
    /// the path field or the mode switches so a stale hash can never end up
    /// approving a different file.
    func invalidateHashIfStale() {
        guard let hash = scriptHash else { return }
        let expectedPath: String
        switch scriptMode {
        case .scriptFile: expectedPath = scriptPath
        case .executable: expectedPath = executablePath
        }
        if hash.path != expectedPath {
            scriptHash = nil
        }
    }

    // MARK: Preflight snapshot

    /// Record the exact definition that was sent to preflight. The review
    /// screen uses this to detect drift (any subsequent field change
    /// invalidates the fingerprint acknowledgement).
    func recordPreflightSnapshot(_ definition: LoopDefinition) {
        preflightSnapshot = definition
    }

    /// True when `candidate` matches the last snapshot, ignoring the
    /// per-build `updatedAt` field which naturally changes on every rebuild.
    func matchesPreflightSnapshot(_ candidate: LoopDefinition) -> Bool {
        guard var snapshot = preflightSnapshot else { return false }
        snapshot = normalizeForComparison(snapshot)
        let normalizedCandidate = normalizeForComparison(candidate)
        return snapshot == normalizedCandidate
    }

    private func normalizeForComparison(_ definition: LoopDefinition) -> LoopDefinition {
        LoopDefinition(
            id: definition.id,
            name: definition.name,
            kind: definition.kind,
            lifecycle: definition.lifecycle,
            schedule: definition.schedule,
            execution: definition.execution,
            permissions: definition.permissions,
            environment: definition.environment,
            timeoutSeconds: definition.timeoutSeconds,
            retry: definition.retry,
            overlapPolicy: definition.overlapPolicy,
            notifications: definition.notifications,
            retention: definition.retention,
            approval: definition.approval,
            createdAt: definition.createdAt,
            updatedAt: "" // masked
        )
    }
}

// MARK: - Row trimming helpers

private extension BuilderArgumentRow {
    var trimmed: String? {
        let value = self.value.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}

private extension BuilderPathRow {
    var trimmed: String? {
        let value = path.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}

private extension String {
    var trimmedOrNil: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
