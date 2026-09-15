import AppKit
import Foundation
import LoopsIdentity
import LoopsClient
import LoopsModels
import UserNotifications

private struct RunFileLocations: Sendable {
    var stdoutPath: String?
    var stderrPath: String?
    var copilotJSONLPath: String?
    var eventsPath: String?
    var cliLogPath: String?
}

@MainActor
final class AppModel: ObservableObject {
    static let showMenuBarIconKey = "CopilotLoopsShowMenuBarIcon"

    @Published var navigation = LoopsNavigationState()
    @Published private(set) var loopStates: [LoopState] = []
    @Published private(set) var recentRuns: [RunRecord] = []
    @Published private(set) var inventory = InventoryResponse()
    @Published private(set) var templates = TemplatesResponse()
    @Published private(set) var settings = AppSettings()
    @Published private(set) var isLoading = true
    @Published private(set) var isRefreshing = false
    @Published var errorMessage: String?
    @Published private(set) var liveRunModel: LiveRunViewModel?
    @Published private(set) var requestedTemplateID: String?

    private let environment: any LoopsEnvironment
    private let control: any ControlClient
    private let secrets: any SecretsClient
    private let notifications: any NotificationServiceProtocol
    private let stateRoot: URL

    private var watcher: RootDirectoryWatcher?
    private var started = false
    private var refreshRunning = false
    private var refreshRequested = false
    private var establishedHistoryBaseline = false
    private var cachedHistoryViewModel: RunHistoryViewModel?
    private var cachedSettingsViewModel: SettingsViewModel?
    private var runFiles: [CopilotLoopRunKey: RunFileLocations] = [:]
    private var historyLoads: Set<CopilotLoopRunKey> = []
    private var liveTailers: [LogTailer] = []
    private var notificationAuthStatus: UNAuthorizationStatus = .notDetermined
    private var notificationDeliveryError: String?
    private var keychainHealth = "Not checked"
    private var keychainError: String?
    private var controlDiagnostics: DiagnosticsResponse?
    private var controlDiagnosticsError: String?

    init(
        environment: any LoopsEnvironment = LiveLoopsEnvironment(),
        notifications: any NotificationServiceProtocol = NotificationService()
    ) {
        self.environment = environment
        self.control = environment.controlClient
        self.secrets = environment.secretsClient
        self.notifications = notifications
        self.stateRoot = (try? environment.runtimeResolver.stateRoot())
            ?? FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".copilot", isDirectory: true)
                .appendingPathComponent("scheduled-tasks", isDirectory: true)
                .appendingPathComponent("copilot-loops", isDirectory: true)

        if UserDefaults.standard.object(forKey: Self.showMenuBarIconKey) == nil {
            UserDefaults.standard.set(true, forKey: Self.showMenuBarIconKey)
        }
        start()
    }

    deinit {
        watcher?.stop()
        liveTailers.forEach { $0.stop() }
    }

    var dashboardSnapshot: DashboardSnapshot {
        DashboardSnapshot.build(from: loopStates, runs: recentRuns)
    }

    var menuBarSnapshot: MenuBarSnapshot {
        MenuBarSnapshot.build(from: loopStates)
    }

    func start() {
        guard !started else { return }
        started = true

        let watcher = environment.makeStateWatcher { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.requestOperationalRefresh()
            }
        }
        self.watcher = watcher
        do {
            try watcher.start()
        } catch {
            present(error)
        }

        Task {
            await refreshSettings()
            await reconcileManagedLoops()
            await refreshOperational()
            await refreshInventory()
            await refreshTemplates()
            notificationAuthStatus = await notifications.checkAuthorization()
            notificationDeliveryError = await notifications.getRecentError()
            synchronizeSettingsViewModel()
            isLoading = false
        }
    }

    func select(_ section: LoopsSection) {
        navigation.select(section)
        handleNavigationChange()
        if section == .settings {
            Task { await refreshDiagnostics() }
        }
    }

    func showLoop(_ id: String) {
        navigation.push(.loopDetail(loopID: id))
    }

    func createLoop(kind: LoopKind) {
        requestedTemplateID = nil
        navigation.push(.newLoop(kind: kind))
    }

    func createLoop(templateID: String) {
        requestedTemplateID = templateID
        let kind: LoopKind = templateID == "repository-maintenance" || templateID == "blank-script"
            ? .script
            : .copilot
        navigation.push(.newLoop(kind: kind))
    }

    func editLoop(_ id: String) {
        requestedTemplateID = nil
        navigation.push(.editLoop(loopID: id))
    }

    func showLiveRun(_ loopID: String) {
        guard let state = loopStates.first(where: { $0.id == loopID }),
              let runID = state.currentRunID
        else {
            present("No active run is available for this loop.")
            return
        }
        navigation.push(.runDetail(loopID: loopID, runID: runID))
    }

    func handleNavigationChange() {
        guard case .runDetail = navigation.current else {
            stopLiveTailers()
            liveRunModel = nil
            return
        }
    }

    func state(for id: String) -> LoopState? {
        loopStates.first { $0.id == id }
    }

    func historyViewModel() -> RunHistoryViewModel {
        if let cachedHistoryViewModel { return cachedHistoryViewModel }
        let model = RunHistoryViewModel(
            loopStates: loopStates,
            runs: recentRuns,
            callbacks: RunHistoryCallbacks(
                retry: { [weak self] key, _ in self?.retry(loopID: key.loopID, runID: key.runID) },
                openArtifact: { [weak self] key, artifact in self?.openArtifact(key: key, artifact: artifact) },
                copy: { [weak self] _, text in self?.copy(text) },
                loadMore: { _ in }
            )
        )
        cachedHistoryViewModel = model
        if let selected = model.selectedRunKey {
            loadHistoryData(for: selected)
        }
        return model
    }

    func settingsViewModel() -> SettingsViewModel {
        if let cachedSettingsViewModel { return cachedSettingsViewModel }
        let model = SettingsViewModel(
            settings: settings,
            showMenuBarIcon: UserDefaults.standard.bool(forKey: Self.showMenuBarIconKey),
            notificationAuthStatus: notificationAuthStatus,
            notificationDeliveryError: notificationDeliveryError,
            systemDiagnostics: systemDiagnostics(),
            managedSecrets: managedSecrets(),
            keychainHealth: keychainHealth,
            keychainError: keychainError,
            onSave: { [weak self] settings, showIcon in
                guard let self else { return }
                try await self.save(settings: settings, showMenuBarIcon: showIcon)
            },
            onRequestNotificationAuth: { [weak self] in
                guard let self else { return .notDetermined }
                return try await self.requestNotificationAuthorization()
            },
            onCheckNotificationAuth: { [weak self] in
                guard let self else { return .notDetermined }
                return await self.checkNotificationAuthorization()
            },
            onOpenSystemSettings: {
                guard let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")
                else { return }
                NSWorkspace.shared.open(url)
            },
            onDeleteSecret: { [weak self] item in
                guard let self else { return }
                try await self.secrets.delete(loopID: item.loopID, name: item.envName)
            },
            onCopyDiagnostic: { [weak self] value in self?.copy(value) },
            onOpenPath: { [weak self] path in self?.openDiagnosticPath(path) }
        )
        cachedSettingsViewModel = model
        return model
    }

    func makeBuilderState(kind: LoopKind, editingLoopID: String?) -> LoopBuilderState {
        let existing = editingLoopID.flatMap { state(for: $0)?.definition }
        let builder = LoopBuilderState(
            mode: existing.map { .edit(originalID: $0.id) } ?? .create,
            kind: existing?.kind ?? kind,
            existing: existing,
            inventory: inventory
        )
        if existing == nil {
            applyTemplate(requestedTemplateID, to: builder)
        }
        requestedTemplateID = nil
        return builder
    }

    func builderCallbacks(for builder: LoopBuilderState) -> LoopBuilderCallbacks {
        LoopBuilderCallbacks(
            saveDraft: { [weak self, weak builder] definition in
                guard let self else { return }
                let warning = try await self.persistDraft(definition)
                builder?.markIdentityPersisted()
                let removedNames = builder?.secretNamesToDelete(afterSaving: definition) ?? []
                builder?.markSecretNamesDeleted(removedNames)
                if let warning {
                    self.present(warning)
                }
            },
            preflight: { [weak self] definition in
                guard let self else {
                    throw ControlClientError.runtime("Copilot Loops closed before preflight completed.")
                }
                return try await self.control.preflight(loop: definition)
            },
            approve: { [weak self] definition, fingerprint in
                guard let self else { return }
                if let current = self.state(for: definition.id),
                   current.definition.approval.fingerprint == fingerprint,
                   current.currentFingerprint == fingerprint,
                   [.ready, .enabled, .paused].contains(current.definition.lifecycle) {
                    return
                }
                _ = try await self.control.approve(id: definition.id, expectedFingerprint: fingerprint)
                await self.refreshOperational()
            },
            enable: { [weak self] definition in
                guard let self else { return }
                let lifecycle = self.state(for: definition.id)?.definition.lifecycle
                switch lifecycle {
                case .ready:
                    _ = try await self.control.enable(id: definition.id)
                case .enabled, .paused:
                    break
                default:
                    throw ControlClientError.runtime("Loop \(definition.id) is not approved and ready to enable.")
                }
                await self.refreshOperational()
                self.navigation.popToRoot()
                self.navigation.push(.loopDetail(loopID: definition.id))
            },
            dismiss: { [weak self] in
                _ = self?.navigation.pop()
            },
            computeHash: { path, expectShebang in
                await BuilderHasher.hash(path: path, expectShebang: expectShebang)
            },
            pickPath: { request in
                await BuilderPathPicker.pickPath(request)
            },
            storePendingSecrets: { [weak self] pending in
                guard let self else { return }
                for item in pending {
                    try await self.secrets.set(loopID: item.loopID, name: item.name, value: item.value)
                }
            },
            refreshInventory: { [weak self, weak builder] in
                guard let self else { return }
                let paths = builder?.localPluginPaths.compactMap { row -> String? in
                    let path = row.path.trimmingCharacters(in: .whitespacesAndNewlines)
                    return path.isEmpty ? nil : path
                } ?? []
                await self.refreshInventory(localPluginDirectories: paths)
                builder?.inventory = self.inventory
            }
        )
    }

    func requestOperationalRefresh() {
        if refreshRunning {
            refreshRequested = true
            return
        }
        Task { await refreshOperational() }
    }

    func refreshOperational() async {
        guard !refreshRunning else {
            refreshRequested = true
            return
        }
        refreshRunning = true
        isRefreshing = true

        do {
            let response = try await control.listLoops()
            loopStates = response.loops
            if !response.errors.isEmpty {
                present(response.errors.map(\.message).joined(separator: "\n"))
            }
            cachedHistoryViewModel?.loops = response.loops.map(\.definition)
            updateLiveState()
        } catch {
            present(error)
        }

        do {
            let history = try await loadHistory()
            apply(history: history)
            if establishedHistoryBaseline {
                await processNotifications(for: history.runs.map(\.run))
            } else {
                let createdBaseline = await notifications.prime(
                    with: loopStates,
                    runs: history.runs.map(\.run)
                )
                establishedHistoryBaseline = true
                if !createdBaseline {
                    await processNotifications(for: history.runs.map(\.run))
                }
            }
        } catch {
            present(error)
        }

        synchronizeSettingsViewModel()
        refreshRunning = false
        isRefreshing = false
        if refreshRequested {
            refreshRequested = false
            requestOperationalRefresh()
        }
    }

    func refreshInventory(localPluginDirectories: [String] = []) async {
        do {
            inventory = try await control.inventory(localPluginDirectories: localPluginDirectories)
            if !inventory.errors.isEmpty {
                present(inventory.errors.map { issue in
                    if let remedy = issue.remedy, !remedy.isEmpty {
                        return "\(issue.message) \(remedy)"
                    }
                    return issue.message
                }.joined(separator: "\n"))
            }
        } catch {
            present(error)
        }
    }

    func refreshSettings() async {
        do {
            settings = try await control.getSettings().settings
            synchronizeSettingsViewModel()
        } catch {
            present(error)
        }
    }

    func refreshTemplates() async {
        do {
            let payload = try JSONEncoder().encode(EmptyRequest())
            templates = try await control.invoke(
                TemplatesResponse.self,
                ControlInvocation(command: "templates", payload: payload)
            )
        } catch {
            present(error)
        }
    }

    private func reconcileManagedLoops() async {
        do {
            let response = try await control.reconcile()
            if !response.errors.isEmpty {
                present(response.errors.map(\.message).joined(separator: "\n"))
            }
        } catch {
            present(error)
        }
    }

    func runNow(loopID: String) {
        performMutation {
            _ = try await self.control.runNow(id: loopID)
        }
    }

    func enable(loopID: String) {
        performMutation {
            _ = try await self.control.enable(id: loopID)
        }
    }

    func pause(loopID: String) {
        performMutation {
            _ = try await self.control.pause(id: loopID)
        }
    }

    func resume(loopID: String) {
        performMutation {
            _ = try await self.control.resume(id: loopID)
        }
    }

    func togglePause(loopID: String, paused: Bool) {
        paused ? pause(loopID: loopID) : resume(loopID: loopID)
    }

    func pauseAll() {
        let ids = loopStates
            .filter { $0.definition.lifecycle == .enabled }
            .map(\.id)
        performBatch(ids: ids, action: { try await self.control.pause(id: $0) })
    }

    func resumeAll() {
        let ids = loopStates
            .filter { $0.definition.lifecycle == .paused }
            .map(\.id)
        performBatch(ids: ids, action: { try await self.control.resume(id: $0) })
    }

    func archive(loopID: String) {
        performMutation {
            _ = try await self.control.archive(id: loopID)
            self.navigation.popToRoot()
        }
    }

    func purge(loopID: String) {
        guard let state = state(for: loopID), state.definition.lifecycle == .archived else {
            present("Archive this loop before purging it.")
            return
        }
        performMutation {
            _ = try await self.control.purge(id: loopID, confirm: true)
            self.navigation.popToRoot()
        }
    }

    func stop(loopID: String) {
        performMutation {
            _ = try await self.control.stop(id: loopID)
        }
    }

    func retry(loopID: String, runID: String) {
        performMutation {
            _ = try await self.control.retry(id: loopID, runId: runID)
        }
    }

    func loadHistoryData(for key: CopilotLoopRunKey) {
        guard cachedHistoryViewModel?.runDataByKey[key] == nil,
              !historyLoads.contains(key),
              let locations = runFiles[key]
        else { return }

        historyLoads.insert(key)
        let root = stateRoot
        Task {
            let data = await Task.detached(priority: .utility) {
                RunHistoryRunData(
                    eventsJSONL: Self.readOptional(locations.eventsPath, root: root, limit: 256 * 1024),
                    stdout: Self.readOptional(locations.stdoutPath, root: root, limit: 512 * 1024),
                    stderr: Self.readOptional(locations.stderrPath, root: root, limit: 512 * 1024),
                    copilotJSONL: Self.readOptional(locations.copilotJSONLPath, root: root, limit: 512 * 1024),
                    paths: Self.streamPaths(locations)
                )
            }.value
            historyLoads.remove(key)
            cachedHistoryViewModel?.runDataByKey[key] = data
        }
    }

    func loadLiveRun(loopID: String, runID: String) async {
        let requestedKey = CopilotLoopRunKey(loopID: loopID, runID: runID)
        if liveRunModel?.runKey == requestedKey { return }

        stopLiveTailers()
        liveRunModel = nil
        do {
            var detail: LoopDetail?
            var run: RunRecord?
            for attempt in 0..<10 {
                guard !Task.isCancelled else { return }
                let candidate = try await control.showLoop(id: loopID)
                detail = candidate
                run = candidate.recentRuns.first(where: { $0.id == runID })
                    ?? (candidate.state.lastRun?.id == runID ? candidate.state.lastRun : nil)
                if run != nil { break }
                if attempt < 9 {
                    do {
                        try await Task.sleep(nanoseconds: 200_000_000)
                    } catch {
                        return
                    }
                }
            }
            guard var detail, let run else {
                throw ControlClientError.runtime("Run \(runID) did not publish its live state.")
            }

            applyExpectedLivePaths(to: &detail, loopID: loopID, runID: runID)
            let snapshots = await loadLiveSnapshots(detail: detail)
            let model = LiveRunViewModel(
                loopState: detail.state,
                run: run,
                stdout: snapshots.stdout?.text ?? "",
                stderr: snapshots.stderr?.text ?? "",
                copilotJSONL: snapshots.copilot?.text ?? "",
                eventsJSONL: snapshots.events?.text ?? "",
                stdoutPath: detail.stdoutPath,
                stderrPath: detail.stderrPath,
                copilotJSONLPath: detail.copilotJsonlPath,
                eventsPath: detail.eventsPath,
                callbacks: LiveRunCallbacks(
                    stop: { [weak self] key, _ in self?.stop(loopID: key.loopID) },
                    copy: { [weak self] _, text in self?.copy(text) },
                    openArtifact: { [weak self] key, artifact in self?.openArtifact(key: key, artifact: artifact) },
                    openLog: { [weak self] _, path in self?.openManagedLog(path) }
                )
            )
            liveRunModel = model
            startLiveTailers(detail: detail, snapshots: snapshots, model: model)
        } catch {
            present(error)
        }
    }

    private func applyExpectedLivePaths(to detail: inout LoopDetail, loopID: String, runID: String) {
        let runRoot = stateRoot
            .appendingPathComponent("tasks", isDirectory: true)
            .appendingPathComponent(loopID, isDirectory: true)
            .appendingPathComponent("runs", isDirectory: true)
            .appendingPathComponent(runID, isDirectory: true)

        detail.eventsPath = detail.eventsPath
            ?? runRoot.appendingPathComponent("events.jsonl").path
        detail.stderrPath = detail.stderrPath
            ?? runRoot.appendingPathComponent("stderr.log").path
        switch detail.state.definition.kind {
        case .copilot:
            detail.copilotJsonlPath = detail.copilotJsonlPath
                ?? runRoot.appendingPathComponent("copilot.jsonl").path
        case .script:
            detail.stdoutPath = detail.stdoutPath
                ?? runRoot.appendingPathComponent("stdout.log").path
        }
    }

    func copy(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    private func loadHistory() async throws -> HistoryResponse {
        try await control.history(count: 200)
    }

    private func persistDraft(_ definition: LoopDefinition) async throws -> String? {
        let response: LoopMutationResponse
        if loopStates.contains(where: { $0.id == definition.id }) {
            response = try await control.updateLoop(definition)
        } else {
            response = try await control.createLoop(definition)
        }
        await refreshOperational()
        return response.warning
    }

    private func applyTemplate(_ templateID: String?, to builder: LoopBuilderState) {
        let templateID = templateID ?? (builder.kind == .copilot ? "blank-copilot" : "blank-script")
        let defaultModel = settings.defaultModel ?? "gpt-5.6-sol"

        switch templateID {
        case "nightly-dependency-report":
            builder.name = "Nightly dependency report"
            builder.installedPlugin = "core-agents"
            builder.agent = "core-agents:researcher"
            builder.skill = "research-methodology"
            builder.model = defaultModel
            builder.prompt = "Review dependency manifests and write a concise markdown report."
            builder.scheduleKind = .dailyCalendar
            builder.calendarTime = calendarTime(hour: 1, minute: 0)
            builder.environmentRows = [BuilderEnvRow(name: "REPORT_FORMAT", value: "markdown")]
            builder.secretRows = [BuilderSecretRow(name: "REPORT_TOKEN")]
        case "repository-maintenance":
            builder.name = "Repository maintenance"
            builder.scriptMode = .scriptFile
            builder.scriptArguments = [
                BuilderArgumentRow(value: "--prune"),
                BuilderArgumentRow(value: "--stats"),
            ]
            builder.permissionProfile = .custom
            builder.scheduleKind = .weekdayCalendar
            builder.calendarTime = calendarTime(hour: 2, minute: 30)
            builder.selectedWeekdays = [1, 2, 3, 4, 5]
            builder.environmentRows = [BuilderEnvRow(name: "DRY_RUN", value: "false")]
            builder.timeoutSeconds = 3_600
        case "scheduled-skill-review":
            builder.name = "Scheduled skill review"
            builder.installedPlugin = "meta"
            builder.skill = "agent-skill-audit"
            builder.model = defaultModel
            builder.prompt = "Audit the selected Copilot skill or agent for routing, frontmatter, overlap, security, and discoverability. Produce a concise actionable report."
            builder.scheduleKind = .weekdayCalendar
            builder.calendarTime = calendarTime(hour: 9, minute: 0)
            builder.selectedWeekdays = [1]
        case "blank-script":
            builder.permissionProfile = .custom
            builder.timeoutSeconds = settings.defaultTimeoutSeconds
        case "blank-copilot":
            builder.model = defaultModel
            builder.prompt = "Describe the unattended task to automate."
            builder.timeoutSeconds = settings.defaultTimeoutSeconds
        default:
            present("Unknown template \(templateID); opened a blank builder instead.")
            if builder.kind == .copilot {
                builder.model = defaultModel
                builder.prompt = "Describe the unattended task to automate."
            } else {
                builder.permissionProfile = .custom
            }
        }
        builder.syncAutoID()
    }

    private func calendarTime(hour: Int, minute: Int) -> Date {
        var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        components.hour = hour
        components.minute = minute
        components.second = 0
        return Calendar.current.date(from: components) ?? Date()
    }

    private func apply(history: HistoryResponse) {
        recentRuns = history.runs.map(\.run)
        runFiles = Dictionary(
            history.runs.map { item in
                (
                    item.run.loopRunKey,
                    RunFileLocations(
                        stdoutPath: item.stdoutPath,
                        stderrPath: item.stderrPath,
                        copilotJSONLPath: item.copilotJsonlPath,
                        eventsPath: item.eventsPath,
                        cliLogPath: item.cliLogPath
                    )
                )
            },
            uniquingKeysWith: { first, _ in first }
        )

        if let model = cachedHistoryViewModel {
            model.runs = recentRuns
            if model.selectedRun == nil {
                model.selectedRunKey = recentRuns.first?.loopRunKey
            }
            if let selected = model.selectedRunKey {
                loadHistoryData(for: selected)
            }
        }
        updateLiveState()
        if !history.errors.isEmpty {
            present(history.errors.map(\.message).joined(separator: "\n"))
        }
    }

    private func processNotifications(for runs: [RunRecord]) async {
        let definitions = Dictionary(uniqueKeysWithValues: loopStates.map { ($0.id, $0.definition) })
        for run in runs where run.status.isTerminalOutcome {
            guard let loop = definitions[run.loopId] else { continue }
            await notifications.process(run: run, loop: loop, settings: settings)
        }
        notificationDeliveryError = await notifications.getRecentError()
    }

    private func performMutation(_ operation: @escaping () async throws -> Void) {
        Task {
            do {
                try await operation()
                await refreshOperational()
            } catch {
                present(error)
            }
        }
    }

    private func performBatch(
        ids: [String],
        action: @escaping (String) async throws -> LoopMutationResponse
    ) {
        Task {
            var failures: [String] = []
            for id in ids {
                do {
                    _ = try await action(id)
                } catch {
                    failures.append("\(id): \(error.localizedDescription)")
                }
            }
            await refreshOperational()
            if !failures.isEmpty {
                present(failures.joined(separator: "\n"))
            }
        }
    }

    private func save(settings: AppSettings, showMenuBarIcon: Bool) async throws {
        let response = try await control.setSettings(settings)
        self.settings = response.settings
        UserDefaults.standard.set(showMenuBarIcon, forKey: Self.showMenuBarIconKey)
        synchronizeSettingsViewModel()
    }

    private func requestNotificationAuthorization() async throws -> UNAuthorizationStatus {
        let status = try await notifications.requestAuthorization()
        notificationAuthStatus = status
        notificationDeliveryError = await notifications.getRecentError()
        synchronizeSettingsViewModel()
        return status
    }

    private func checkNotificationAuthorization() async -> UNAuthorizationStatus {
        let status = await notifications.checkAuthorization()
        notificationAuthStatus = status
        notificationDeliveryError = await notifications.getRecentError()
        synchronizeSettingsViewModel()
        return status
    }

    private func refreshDiagnostics() async {
        notificationAuthStatus = await notifications.checkAuthorization()
        notificationDeliveryError = await notifications.getRecentError()
        do {
            let payload = try JSONEncoder().encode(DiagnosticsRequest())
            controlDiagnostics = try await control.invoke(
                DiagnosticsResponse.self,
                ControlInvocation(command: "diagnostics", payload: payload)
            )
            controlDiagnosticsError = nil
        } catch {
            controlDiagnosticsError = error.localizedDescription
        }
        do {
            _ = try await secrets.exists(loopID: "healthcheck", name: "HEALTHCHECK")
            keychainHealth = "Healthy"
            keychainError = nil
        } catch {
            keychainHealth = "Unavailable"
            keychainError = error.localizedDescription
        }
        synchronizeSettingsViewModel()
    }

    private func synchronizeSettingsViewModel() {
        cachedSettingsViewModel?.synchronize(
            settings: settings,
            showMenuBarIcon: UserDefaults.standard.bool(forKey: Self.showMenuBarIconKey),
            notificationAuthStatus: notificationAuthStatus,
            notificationDeliveryError: notificationDeliveryError,
            systemDiagnostics: systemDiagnostics(),
            managedSecrets: managedSecrets(),
            keychainHealth: keychainHealth,
            keychainError: keychainError
        )
    }

    private func managedSecrets() -> [ManagedSecretItem] {
        loopStates.flatMap { state in
            state.definition.environment.secretNames.map { name in
                ManagedSecretItem(
                    account: "\(state.id):\(name)",
                    loopID: state.id,
                    loopName: state.definition.name,
                    envName: name
                )
            }
        }
        .sorted {
            if $0.loopID != $1.loopID { return $0.loopID < $1.loopID }
            return $0.envName < $1.envName
        }
    }

    private func systemDiagnostics() -> [String: String] {
        var values: [String: String] = [
            "State root": stateRoot.path,
            "App bundle": Bundle.main.bundleURL.path,
            "App version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "source build",
        ]
        do {
            let identity = try environment.runtimeResolver.identity()
            let launchAgents = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/LaunchAgents", isDirectory: true)
            values["Identity profile"] = identity.sourcePath
            values["Identity namespace"] = identity.namespace
            values["App LaunchAgent"] = launchAgents
                .appendingPathComponent("\(identity.appLabel).plist").path
            values["Task LaunchAgents"] = launchAgents
                .appendingPathComponent("\(identity.taskLabelPrefix)<loop-id>.plist").path
        } catch {
            values["Identity profile"] = error.localizedDescription
        }
        do {
            let resolution = try environment.runtimeResolver.resolve()
            values["Control executable"] = resolution.executableURL.path
            values["Control arguments"] = resolution.argumentPrefix.joined(separator: " ")
        } catch {
            values["Runtime resolution"] = error.localizedDescription
        }
        if let client = secrets as? KeychainSecretsClient {
            do {
                values["Keychain helper"] = try client.resolveHelper().path
            } catch {
                values["Keychain helper"] = error.localizedDescription
            }
        }
        if let runtime = controlDiagnostics?.runtime {
            values["Runtime state root"] = runtime.stateRoot ?? stateRoot.path
            if let launchPath = runtime.launchPath {
                values["Runtime PATH"] = launchPath
            }
            addDiagnostic("Installed app", runtime.app, to: &values)
            addDiagnostic("Control plane", runtime.control, to: &values)
            addDiagnostic("Runner", runtime.runner, to: &values)
            addDiagnostic("Node", runtime.node, to: &values)
            addDiagnostic("Secrets helper", runtime.helper, to: &values)
            addDiagnostic("Copilot CLI", runtime.copilot, to: &values)
            addDiagnostic("launchctl", runtime.launchctl, to: &values)
        }
        if let error = controlDiagnosticsError {
            values["Control diagnostics error"] = error
        }
        if let errors = controlDiagnostics?.errors, !errors.isEmpty {
            values["Managed loop errors"] = errors.map(\.message).joined(separator: " | ")
        }
        if let warnings = controlDiagnostics?.warnings, !warnings.isEmpty {
            values["Managed loop warnings"] = warnings.map(\.message).joined(separator: " | ")
        }
        return values
    }

    private func addDiagnostic(
        _ label: String,
        _ info: DiagnosticsPathInfo?,
        to values: inout [String: String]
    ) {
        guard let info else { return }
        if let path = info.path {
            values["\(label) path"] = path
        }
        if let error = info.error, !error.isEmpty {
            values["\(label) health"] = error
        } else if info.exists == false {
            values["\(label) health"] = "Missing"
        } else if info.executable == false {
            values["\(label) health"] = "Present but not executable"
        } else if info.exists == true {
            values["\(label) health"] = "Healthy"
        }
    }

    private func updateLiveState() {
        guard let model = liveRunModel,
              let state = loopStates.first(where: { $0.id == model.run.loopId })
        else { return }
        model.update(loopState: state)
        if let run = recentRuns.first(where: { $0.loopRunKey == model.runKey }) {
            model.update(run: run)
        }
    }

    private struct LiveSnapshots {
        var stdout: AppFileAccess.BoundedSnapshot?
        var stderr: AppFileAccess.BoundedSnapshot?
        var copilot: AppFileAccess.BoundedSnapshot?
        var events: AppFileAccess.BoundedSnapshot?
    }

    private func loadLiveSnapshots(detail: LoopDetail) async -> LiveSnapshots {
        let root = stateRoot
        return await Task.detached(priority: .utility) {
            LiveSnapshots(
                stdout: Self.snapshotOptional(detail.stdoutPath, root: root, limit: 512 * 1024),
                stderr: Self.snapshotOptional(detail.stderrPath, root: root, limit: 512 * 1024),
                copilot: Self.snapshotOptional(detail.copilotJsonlPath, root: root, limit: 512 * 1024),
                events: Self.snapshotOptional(detail.eventsPath, root: root, limit: 256 * 1024)
            )
        }.value
    }

    private func startLiveTailers(
        detail: LoopDetail,
        snapshots: LiveSnapshots,
        model: LiveRunViewModel
    ) {
        stopLiveTailers()
        addLiveTailer(path: detail.stdoutPath, snapshot: snapshots.stdout) { [weak model] text in
            model?.append(text, to: .stdout)
        }
        addLiveTailer(path: detail.stderrPath, snapshot: snapshots.stderr) { [weak model] text in
            model?.append(text, to: .stderr)
        }
        addLiveTailer(path: detail.copilotJsonlPath, snapshot: snapshots.copilot) { [weak model] text in
            model?.append(text, to: .copilotJSONL)
        }
        addLiveTailer(path: detail.eventsPath, snapshot: snapshots.events) { [weak model] text in
            model?.appendEvents(text)
        }
    }

    private func addLiveTailer(
        path: String?,
        snapshot: AppFileAccess.BoundedSnapshot?,
        append: @escaping @MainActor (String) -> Void
    ) {
        guard let path,
              let url = try? AppFileAccess.validatedURL(
                  path: path,
                  inside: stateRoot,
                  mustExist: false
              )
        else { return }

        let tailer = LogTailer(
            url: url,
            startOffset: snapshot?.endOffset ?? 0,
            inode: snapshot?.inode
        ) { data in
            let text = String(decoding: data, as: UTF8.self)
            Task { @MainActor in append(text) }
        }
        liveTailers.append(tailer)
        tailer.start()
    }

    private func stopLiveTailers() {
        liveTailers.forEach { $0.stop() }
        liveTailers.removeAll()
    }

    private func openArtifact(key: CopilotLoopRunKey, artifact: CopilotLoopArtifact) {
        switch artifact.kind {
        case .githubPullRequest:
            guard let components = URLComponents(string: artifact.value),
                  components.scheme?.lowercased() == "https",
                  components.host?.lowercased() == "github.com",
                  components.user == nil,
                  components.password == nil,
                  let url = components.url
            else {
                present("Refusing to open an invalid pull request URL.")
                return
            }
            NSWorkspace.shared.open(url)
        case .changedFile:
            guard let state = state(for: key.loopID) else {
                present("The loop definition is no longer available.")
                return
            }
            do {
                let url = try AppFileAccess.changedFileURL(
                    reference: artifact.value,
                    workingDirectory: workingDirectory(for: state.definition)
                )
                NSWorkspace.shared.activateFileViewerSelecting([url])
            } catch {
                present(error)
            }
        case .commitSHA, .copilotSessionID:
            copy(artifact.value)
        }
    }

    private func openManagedLog(_ path: String) {
        do {
            let url = try AppFileAccess.validatedURL(path: path, inside: stateRoot)
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } catch {
            present(error)
        }
    }

    private func openDiagnosticPath(_ path: String) {
        guard path.hasPrefix("/") else {
            present("This diagnostic value is not a file path.")
            return
        }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard FileManager.default.fileExists(atPath: url.path) else {
            present("Diagnostic path does not exist: \(url.path)")
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    private func workingDirectory(for loop: LoopDefinition) -> String {
        switch loop.execution {
        case .copilot(let value): return value.workingDirectory
        case .scriptFile(let value): return value.workingDirectory
        case .executable(let value): return value.workingDirectory
        }
    }

    nonisolated private static func readOptional(_ path: String?, root: URL, limit: Int) -> String {
        guard let path else { return "" }
        return (try? AppFileAccess.readBoundedTail(path: path, inside: root, maxBytes: limit)) ?? ""
    }

    nonisolated private static func snapshotOptional(
        _ path: String?,
        root: URL,
        limit: Int
    ) -> AppFileAccess.BoundedSnapshot? {
        guard let path else { return nil }
        return try? AppFileAccess.readBoundedSnapshot(path: path, inside: root, maxBytes: limit)
    }

    nonisolated private static func streamPaths(_ locations: RunFileLocations) -> [LiveRunStream: String] {
        var paths: [LiveRunStream: String] = [:]
        if let path = locations.stdoutPath { paths[.stdout] = path }
        if let path = locations.stderrPath { paths[.stderr] = path }
        if let path = locations.copilotJSONLPath { paths[.copilotJSONL] = path }
        return paths
    }

    private func present(_ error: Error) {
        present(error.localizedDescription)
    }

    private func present(_ message: String) {
        guard !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        errorMessage = message
    }
}
