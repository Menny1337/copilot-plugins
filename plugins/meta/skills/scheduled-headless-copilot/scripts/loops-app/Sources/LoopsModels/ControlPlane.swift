import Foundation

// MARK: - Error envelope

/// Structured error emitted by the `loops-ctl.mjs` control plane. Mirrors the
/// `UserError` shape (`name` + `message` + `context`) and tolerates an optional
/// machine-readable `code`.
public struct ControlError: Codable, Equatable, Sendable, Error {
    public var name: String
    public var message: String
    public var code: String?
    public var context: [String: JSONValue]

    public init(
        name: String = "Error",
        message: String,
        code: String? = nil,
        context: [String: JSONValue] = [:]
    ) {
        self.name = name
        self.message = message
        self.code = code
        self.context = context
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Error"
        self.message = try container.decodeIfPresent(String.self, forKey: .message) ?? ""
        // Node error codes may be strings (e.g. "overlap") or integers (e.g. a
        // launchctl exit code). Normalize both to String without failing.
        if let stringCode = try? container.decodeIfPresent(String.self, forKey: .code) {
            self.code = stringCode
        } else if let intCode = try? container.decodeIfPresent(Int.self, forKey: .code) {
            self.code = String(intCode)
        } else {
            self.code = nil
        }
        self.context = try container.decodeIfPresent([String: JSONValue].self, forKey: .context) ?? [:]
    }

    private enum CodingKeys: String, CodingKey {
        case name, message, code, context
    }
}

extension ControlError: LocalizedError {
    public var errorDescription: String? {
        message.isEmpty ? name : message
    }
}

/// Top-level failure envelope. Feature modules emit `{ "ok": false, "error": {...} }`.
public struct ControlErrorEnvelope: Codable, Equatable, Sendable {
    public var ok: Bool
    public var error: ControlError

    public init(ok: Bool = false, error: ControlError) {
        self.ok = ok
        self.error = error
    }
}

/// A non-fatal, per-item problem reported alongside successful data (e.g. a loop
/// directory that failed to parse during `list`). Tolerant so the CLI can add
/// fields later.
public struct ControlIssue: Codable, Equatable, Sendable {
    public var id: String?
    public var message: String
    public var code: String?
    public var context: [String: JSONValue]

    public init(
        id: String? = nil,
        message: String,
        code: String? = nil,
        context: [String: JSONValue] = [:]
    ) {
        self.id = id
        self.message = message
        self.code = code
        self.context = context
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decodeIfPresent(String.self, forKey: .id)
        self.message = try container.decodeIfPresent(String.self, forKey: .message) ?? ""
        self.code = try container.decodeIfPresent(String.self, forKey: .code)
        self.context = try container.decodeIfPresent([String: JSONValue].self, forKey: .context) ?? [:]
    }

    private enum CodingKeys: String, CodingKey {
        case id, message, code, context
    }
}

// MARK: - Aggregate loop state

public enum LoopHealth: String, Codable, CaseIterable, Sendable {
    case ok
    case warning
    case failing
    case idle
    case blocked
}

/// Runtime state for a single loop: the manifest plus the latest observed run,
/// derived scheduling hints, and the control plane's current capability
/// fingerprint (used to detect approval drift).
public struct LoopState: Codable, Identifiable, Equatable, Sendable {
    public var definition: LoopDefinition
    public var lastRun: RunRecord?
    public var isRunning: Bool
    public var nextScheduledAt: String?
    public var currentFingerprint: String?
    public var stage: String?
    public var currentRunID: String?
    public var reconciliationError: String?

    public var id: String { definition.id }

    public init(
        definition: LoopDefinition,
        lastRun: RunRecord? = nil,
        isRunning: Bool = false,
        nextScheduledAt: String? = nil,
        currentFingerprint: String? = nil,
        stage: String? = nil,
        currentRunID: String? = nil,
        reconciliationError: String? = nil
    ) {
        self.definition = definition
        self.lastRun = lastRun
        self.isRunning = isRunning
        self.nextScheduledAt = nextScheduledAt
        self.currentFingerprint = currentFingerprint
        self.stage = stage
        self.currentRunID = currentRunID
        self.reconciliationError = reconciliationError
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.definition = try container.decode(LoopDefinition.self, forKey: .definition)
        self.lastRun = try container.decodeIfPresent(RunRecord.self, forKey: .lastRun)
        self.isRunning = try container.decodeIfPresent(Bool.self, forKey: .isRunning) ?? false
        self.nextScheduledAt = try container.decodeIfPresent(String.self, forKey: .nextScheduledAt)
        self.currentFingerprint = try container.decodeIfPresent(String.self, forKey: .currentFingerprint)
        self.stage = try container.decodeIfPresent(String.self, forKey: .stage)
        self.currentRunID = try container.decodeIfPresent(String.self, forKey: .currentRunID)
        self.reconciliationError = try container.decodeIfPresent(String.self, forKey: .reconciliationError)
    }

    private enum CodingKeys: String, CodingKey {
        case definition, lastRun, isRunning, nextScheduledAt, currentFingerprint
        case stage, currentRunID, reconciliationError
    }
}

// MARK: - List

/// Response for the `list` command.
public struct LoopListResponse: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var loops: [LoopState]
    public var errors: [ControlIssue]

    public init(schemaVersion: Int = 1, loops: [LoopState], errors: [ControlIssue] = []) {
        self.schemaVersion = schemaVersion
        self.loops = loops
        self.errors = errors
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        self.loops = try container.decodeIfPresent([LoopState].self, forKey: .loops) ?? []
        self.errors = try container.decodeIfPresent([ControlIssue].self, forKey: .errors) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, loops, errors
    }
}

// MARK: - Detail

/// Response for the `show` command: full runtime state plus recent run history
/// and explicit log file locations for tailing. Every path is optional because
/// a run may not have produced a given stream yet.
public struct LoopDetail: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var state: LoopState
    public var recentRuns: [RunRecord]
    public var stdoutPath: String?
    public var stderrPath: String?
    public var copilotJsonlPath: String?
    public var eventsPath: String?
    public var cliLogPath: String?

    public init(
        schemaVersion: Int = 1,
        state: LoopState,
        recentRuns: [RunRecord] = [],
        stdoutPath: String? = nil,
        stderrPath: String? = nil,
        copilotJsonlPath: String? = nil,
        eventsPath: String? = nil,
        cliLogPath: String? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.state = state
        self.recentRuns = recentRuns
        self.stdoutPath = stdoutPath
        self.stderrPath = stderrPath
        self.copilotJsonlPath = copilotJsonlPath
        self.eventsPath = eventsPath
        self.cliLogPath = cliLogPath
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        self.state = try container.decode(LoopState.self, forKey: .state)
        self.recentRuns = try container.decodeIfPresent([RunRecord].self, forKey: .recentRuns) ?? []
        self.stdoutPath = try container.decodeIfPresent(String.self, forKey: .stdoutPath)
        self.stderrPath = try container.decodeIfPresent(String.self, forKey: .stderrPath)
        self.copilotJsonlPath = try container.decodeIfPresent(String.self, forKey: .copilotJsonlPath)
        self.eventsPath = try container.decodeIfPresent(String.self, forKey: .eventsPath)
        self.cliLogPath = try container.decodeIfPresent(String.self, forKey: .cliLogPath)
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, state, recentRuns
        case stdoutPath, stderrPath, copilotJsonlPath, eventsPath, cliLogPath
    }
}

// MARK: - Aggregate (dashboard)

/// Dashboard-level rollup across all managed loops.
public struct LoopAggregate: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var totalLoops: Int
    public var lifecycleCounts: [String: Int]
    public var lastRunStatusCounts: [String: Int]
    public var runningLoopIds: [String]
    public var needsAttentionLoopIds: [String]
    public var nextScheduledAt: String?

    public init(
        schemaVersion: Int = 1,
        totalLoops: Int = 0,
        lifecycleCounts: [String: Int] = [:],
        lastRunStatusCounts: [String: Int] = [:],
        runningLoopIds: [String] = [],
        needsAttentionLoopIds: [String] = [],
        nextScheduledAt: String? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.totalLoops = totalLoops
        self.lifecycleCounts = lifecycleCounts
        self.lastRunStatusCounts = lastRunStatusCounts
        self.runningLoopIds = runningLoopIds
        self.needsAttentionLoopIds = needsAttentionLoopIds
        self.nextScheduledAt = nextScheduledAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        self.totalLoops = try container.decodeIfPresent(Int.self, forKey: .totalLoops) ?? 0
        self.lifecycleCounts = try container.decodeIfPresent([String: Int].self, forKey: .lifecycleCounts) ?? [:]
        self.lastRunStatusCounts = try container.decodeIfPresent([String: Int].self, forKey: .lastRunStatusCounts) ?? [:]
        self.runningLoopIds = try container.decodeIfPresent([String].self, forKey: .runningLoopIds) ?? []
        self.needsAttentionLoopIds = try container.decodeIfPresent([String].self, forKey: .needsAttentionLoopIds) ?? []
        self.nextScheduledAt = try container.decodeIfPresent(String.self, forKey: .nextScheduledAt)
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, totalLoops, lifecycleCounts, lastRunStatusCounts
        case runningLoopIds, needsAttentionLoopIds, nextScheduledAt
    }
}

// MARK: - Inventory

/// A plugin discovered in the Copilot environment. `name` and `enabled` are
/// stable; everything else is optional because the CLI may omit it.
public struct PluginInventoryItem: Codable, Equatable, Sendable {
    public var name: String
    public var enabled: Bool
    public var version: String?
    public var scope: String?
    public var description: String?
    public var source: String?

    public init(
        name: String,
        enabled: Bool,
        version: String? = nil,
        scope: String? = nil,
        description: String? = nil,
        source: String? = nil
    ) {
        self.name = name
        self.enabled = enabled
        self.version = version
        self.scope = scope
        self.description = description
        self.source = source
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.name = try container.decode(String.self, forKey: .name)
        self.enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        self.version = try container.decodeIfPresent(String.self, forKey: .version)
        self.scope = try container.decodeIfPresent(String.self, forKey: .scope)
        self.description = try container.decodeIfPresent(String.self, forKey: .description)
        self.source = try container.decodeIfPresent(String.self, forKey: .source)
    }

    private enum CodingKeys: String, CodingKey {
        case name, enabled, version, scope, description, source
    }
}

/// A skill discovered in the Copilot environment.
public struct SkillInventoryItem: Codable, Equatable, Sendable {
    public var name: String
    public var enabled: Bool
    public var plugin: String?
    public var description: String?
    public var userInvocable: Bool?
    public var source: String?
    public var path: String?

    public init(
        name: String,
        enabled: Bool,
        plugin: String? = nil,
        description: String? = nil,
        userInvocable: Bool? = nil,
        source: String? = nil,
        path: String? = nil
    ) {
        self.name = name
        self.enabled = enabled
        self.plugin = plugin
        self.description = description
        self.userInvocable = userInvocable
        self.source = source
        self.path = path
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.name = try container.decode(String.self, forKey: .name)
        self.enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        self.plugin = try container.decodeIfPresent(String.self, forKey: .plugin)
        self.description = try container.decodeIfPresent(String.self, forKey: .description)
        self.userInvocable = try container.decodeIfPresent(Bool.self, forKey: .userInvocable)
        self.source = try container.decodeIfPresent(String.self, forKey: .source)
        self.path = try container.decodeIfPresent(String.self, forKey: .path)
    }

    private enum CodingKeys: String, CodingKey {
        case name, enabled, plugin, description, userInvocable, source, path
    }
}

/// An agent discovered in the Copilot environment.
public struct AgentInventoryItem: Codable, Equatable, Sendable {
    public var name: String
    public var enabled: Bool
    public var plugin: String?
    public var description: String?
    public var source: String?
    public var path: String?

    public init(
        name: String,
        enabled: Bool,
        plugin: String? = nil,
        description: String? = nil,
        source: String? = nil,
        path: String? = nil
    ) {
        self.name = name
        self.enabled = enabled
        self.plugin = plugin
        self.description = description
        self.source = source
        self.path = path
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.name = try container.decode(String.self, forKey: .name)
        self.enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        self.plugin = try container.decodeIfPresent(String.self, forKey: .plugin)
        self.description = try container.decodeIfPresent(String.self, forKey: .description)
        self.source = try container.decodeIfPresent(String.self, forKey: .source)
        self.path = try container.decodeIfPresent(String.self, forKey: .path)
    }

    private enum CodingKeys: String, CodingKey {
        case name, enabled, plugin, description, source, path
    }
}

/// A non-fatal problem encountered while gathering inventory (e.g. a plugin
/// directory that failed to load).
public struct InventoryIssue: Codable, Equatable, Sendable {
    public var type: String?
    public var message: String
    public var remedy: String?
    public var source: String?
    public var code: String?
    public var path: String?

    public init(
        message: String,
        type: String? = nil,
        remedy: String? = nil,
        source: String? = nil,
        code: String? = nil,
        path: String? = nil
    ) {
        self.type = type
        self.message = message
        self.remedy = remedy
        self.source = source
        self.code = code
        self.path = path
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.type = try container.decodeIfPresent(String.self, forKey: .type)
        self.message = try container.decodeIfPresent(String.self, forKey: .message) ?? ""
        self.remedy = try container.decodeIfPresent(String.self, forKey: .remedy)
        self.source = try container.decodeIfPresent(String.self, forKey: .source)
        self.code = try container.decodeIfPresent(String.self, forKey: .code)
        self.path = try container.decodeIfPresent(String.self, forKey: .path)
    }

    private enum CodingKeys: String, CodingKey {
        case type, message, remedy, source, code, path
    }
}

/// Environment inventory used to populate pickers when authoring loops. Matches
/// the Node shape `{ schemaVersion, plugins, skills, agents, errors }`.
public struct InventoryResponse: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var plugins: [PluginInventoryItem]
    public var skills: [SkillInventoryItem]
    public var agents: [AgentInventoryItem]
    public var errors: [InventoryIssue]

    public init(
        schemaVersion: Int = 1,
        plugins: [PluginInventoryItem] = [],
        skills: [SkillInventoryItem] = [],
        agents: [AgentInventoryItem] = [],
        errors: [InventoryIssue] = []
    ) {
        self.schemaVersion = schemaVersion
        self.plugins = plugins
        self.skills = skills
        self.agents = agents
        self.errors = errors
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        self.plugins = try container.decodeIfPresent([PluginInventoryItem].self, forKey: .plugins) ?? []
        self.skills = try container.decodeIfPresent([SkillInventoryItem].self, forKey: .skills) ?? []
        self.agents = try container.decodeIfPresent([AgentInventoryItem].self, forKey: .agents) ?? []
        self.errors = try container.decodeIfPresent([InventoryIssue].self, forKey: .errors) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, plugins, skills, agents, errors
    }
}

// MARK: - Settings

/// App-level settings persisted by the control plane.
public struct AppSettings: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var notificationsEnabled: Bool
    public var launchAtLogin: Bool
    public var defaultModel: String?
    public var defaultTimeoutSeconds: Int
    public var stateRoot: String?

    public init(
        schemaVersion: Int = 1,
        notificationsEnabled: Bool = true,
        launchAtLogin: Bool = true,
        defaultModel: String? = nil,
        defaultTimeoutSeconds: Int = 1800,
        stateRoot: String? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.notificationsEnabled = notificationsEnabled
        self.launchAtLogin = launchAtLogin
        self.defaultModel = defaultModel
        self.defaultTimeoutSeconds = defaultTimeoutSeconds
        self.stateRoot = stateRoot
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        self.notificationsEnabled = try container.decodeIfPresent(Bool.self, forKey: .notificationsEnabled) ?? true
        self.launchAtLogin = try container.decodeIfPresent(Bool.self, forKey: .launchAtLogin) ?? true
        self.defaultModel = try container.decodeIfPresent(String.self, forKey: .defaultModel)
        self.defaultTimeoutSeconds = try container.decodeIfPresent(Int.self, forKey: .defaultTimeoutSeconds) ?? 1800
        self.stateRoot = try container.decodeIfPresent(String.self, forKey: .stateRoot)
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, notificationsEnabled, launchAtLogin
        case defaultModel, defaultTimeoutSeconds, stateRoot
    }
}

/// Response wrapper for `settings-get` / `settings-set`.
public struct SettingsResponse: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var settings: AppSettings

    public init(schemaVersion: Int = 1, settings: AppSettings) {
        self.schemaVersion = schemaVersion
        self.settings = settings
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        self.settings = try container.decode(AppSettings.self, forKey: .settings)
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, settings
    }
}

// MARK: - Generic success envelope

/// Envelope for mutation commands that return a payload under `data`.
public struct ControlEnvelope<Payload: Codable & Sendable>: Codable, Sendable {
    public var ok: Bool
    public var data: Payload?
    public var error: ControlError?

    public init(ok: Bool = true, data: Payload? = nil, error: ControlError? = nil) {
        self.ok = ok
        self.data = data
        self.error = error
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // Fail closed: a machine response without an explicit `ok` is malformed
        // and must not be treated as success.
        self.ok = try container.decode(Bool.self, forKey: .ok)
        self.data = try container.decodeIfPresent(Payload.self, forKey: .data)
        self.error = try container.decodeIfPresent(ControlError.self, forKey: .error)
    }

    private enum CodingKeys: String, CodingKey {
        case ok, data, error
    }
}

extension ControlEnvelope: Equatable where Payload: Equatable {}

// MARK: - Mutation & preflight payloads

/// Payload returned by mutation commands (`create`, `update`, `approve`,
/// `enable`, `pause`, `resume`, `archive`, `run-now`, `stop`, `retry`, `purge`).
/// Tolerant: `loop` is optional so purge/stop need not fabricate one, and
/// `secretNames`/`purged`/`stopped` let the app react (e.g. delete Keychain
/// accounts for a purged loop).
public struct LoopMutationResponse: Codable, Equatable, Sendable {
    public var loop: LoopDefinition?
    public var schedule: JSONValue?
    public var request: JSONValue?
    public var warning: String?
    public var secretNames: [String]?
    public var purged: String?
    public var stopped: Bool?

    public init(
        loop: LoopDefinition? = nil,
        schedule: JSONValue? = nil,
        request: JSONValue? = nil,
        warning: String? = nil,
        secretNames: [String]? = nil,
        purged: String? = nil,
        stopped: Bool? = nil
    ) {
        self.loop = loop
        self.schedule = schedule
        self.request = request
        self.warning = warning
        self.secretNames = secretNames
        self.purged = purged
        self.stopped = stopped
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.loop = try container.decodeIfPresent(LoopDefinition.self, forKey: .loop)
        self.schedule = try container.decodeIfPresent(JSONValue.self, forKey: .schedule)
        self.request = try container.decodeIfPresent(JSONValue.self, forKey: .request)
        self.warning = try container.decodeIfPresent(String.self, forKey: .warning)
        self.secretNames = try container.decodeIfPresent([String].self, forKey: .secretNames)
        self.purged = try container.decodeIfPresent(String.self, forKey: .purged)
        self.stopped = try container.decodeIfPresent(Bool.self, forKey: .stopped)
    }

    private enum CodingKeys: String, CodingKey {
        case loop, schedule, request, warning, secretNames, purged, stopped
    }
}

/// Payload returned by `preflight`: a normalized loop, its capability
/// fingerprint, a redacted command preview, a capability summary, and both
/// `warnings` and `errors`. Preflight `errors` arrive inside a *successful*
/// control envelope (a failing preflight does not fail the control process), so
/// UI must treat a non-empty `errors` as fail-closed and never infer success
/// from `warnings`/`fingerprint` alone.
public struct PreflightResponse: Codable, Equatable, Sendable {
    public var loop: LoopDefinition?
    public var fingerprint: String?
    public var redactedCommand: [String]?
    public var capabilitySummary: JSONValue?
    public var warnings: [String]
    public var errors: [String]

    public init(
        loop: LoopDefinition? = nil,
        fingerprint: String? = nil,
        redactedCommand: [String]? = nil,
        capabilitySummary: JSONValue? = nil,
        warnings: [String] = [],
        errors: [String] = []
    ) {
        self.loop = loop
        self.fingerprint = fingerprint
        self.redactedCommand = redactedCommand
        self.capabilitySummary = capabilitySummary
        self.warnings = warnings
        self.errors = errors
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.loop = try container.decodeIfPresent(LoopDefinition.self, forKey: .loop)
        self.fingerprint = try container.decodeIfPresent(String.self, forKey: .fingerprint)
        self.redactedCommand = try container.decodeIfPresent([String].self, forKey: .redactedCommand)
        self.capabilitySummary = try container.decodeIfPresent(JSONValue.self, forKey: .capabilitySummary)
        self.warnings = try container.decodeIfPresent([String].self, forKey: .warnings) ?? []
        self.errors = try container.decodeIfPresent([String].self, forKey: .errors) ?? []
    }

    /// True when preflight reported blocking errors; the builder must treat this
    /// as a failed preflight even though the envelope succeeded.
    public var hasBlockingErrors: Bool { !errors.isEmpty }

    private enum CodingKeys: String, CodingKey {
        case loop, fingerprint, redactedCommand, capabilitySummary, warnings, errors
    }
}

// MARK: - History

/// A single historical run plus its per-run log locations.
public struct HistoryRunItem: Codable, Equatable, Sendable {
    public var loopId: String
    public var run: RunRecord
    public var stdoutPath: String?
    public var stderrPath: String?
    public var copilotJsonlPath: String?
    public var eventsPath: String?
    public var cliLogPath: String?

    public init(
        loopId: String,
        run: RunRecord,
        stdoutPath: String? = nil,
        stderrPath: String? = nil,
        copilotJsonlPath: String? = nil,
        eventsPath: String? = nil,
        cliLogPath: String? = nil
    ) {
        self.loopId = loopId
        self.run = run
        self.stdoutPath = stdoutPath
        self.stderrPath = stderrPath
        self.copilotJsonlPath = copilotJsonlPath
        self.eventsPath = eventsPath
        self.cliLogPath = cliLogPath
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.loopId = try container.decode(String.self, forKey: .loopId)
        self.run = try container.decode(RunRecord.self, forKey: .run)
        self.stdoutPath = try container.decodeIfPresent(String.self, forKey: .stdoutPath)
        self.stderrPath = try container.decodeIfPresent(String.self, forKey: .stderrPath)
        self.copilotJsonlPath = try container.decodeIfPresent(String.self, forKey: .copilotJsonlPath)
        self.eventsPath = try container.decodeIfPresent(String.self, forKey: .eventsPath)
        self.cliLogPath = try container.decodeIfPresent(String.self, forKey: .cliLogPath)
    }

    private enum CodingKeys: String, CodingKey {
        case loopId, run, stdoutPath, stderrPath, copilotJsonlPath, eventsPath, cliLogPath
    }
}

/// Response for `history`: recent runs (optionally scoped to one loop).
public struct HistoryResponse: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var loopId: String?
    public var requestedCount: Int
    public var count: Int
    public var runs: [HistoryRunItem]
    public var errors: [ControlIssue]
    public var stateRoot: String?

    public init(
        schemaVersion: Int = 1,
        loopId: String? = nil,
        requestedCount: Int = 0,
        count: Int = 0,
        runs: [HistoryRunItem] = [],
        errors: [ControlIssue] = [],
        stateRoot: String? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.loopId = loopId
        self.requestedCount = requestedCount
        self.count = count
        self.runs = runs
        self.errors = errors
        self.stateRoot = stateRoot
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        self.loopId = try container.decodeIfPresent(String.self, forKey: .loopId)
        self.requestedCount = try container.decodeIfPresent(Int.self, forKey: .requestedCount) ?? 0
        self.count = try container.decodeIfPresent(Int.self, forKey: .count) ?? 0
        self.runs = try container.decodeIfPresent([HistoryRunItem].self, forKey: .runs) ?? []
        self.errors = try container.decodeIfPresent([ControlIssue].self, forKey: .errors) ?? []
        self.stateRoot = try container.decodeIfPresent(String.self, forKey: .stateRoot)
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, loopId, requestedCount, count, runs, errors, stateRoot
    }
}

// MARK: - Diagnostics

/// Health of a resolved runtime path (`binarySummary` in `diagnostics.mjs`):
/// `path`, `exists`, `executable`, `kind`, `error`. Tolerant so extra
/// provenance fields the Node summary spreads are ignored without failing.
public struct DiagnosticsPathInfo: Codable, Equatable, Sendable {
    public var path: String?
    public var exists: Bool?
    public var executable: Bool?
    public var kind: String?
    public var error: String?

    public init(
        path: String? = nil,
        exists: Bool? = nil,
        executable: Bool? = nil,
        kind: String? = nil,
        error: String? = nil
    ) {
        self.path = path
        self.exists = exists
        self.executable = executable
        self.kind = kind
        self.error = error
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.path = try container.decodeIfPresent(String.self, forKey: .path)
        self.exists = try container.decodeIfPresent(Bool.self, forKey: .exists)
        self.executable = try container.decodeIfPresent(Bool.self, forKey: .executable)
        self.kind = try container.decodeIfPresent(String.self, forKey: .kind)
        self.error = try container.decodeIfPresent(String.self, forKey: .error)
    }

    private enum CodingKeys: String, CodingKey {
        case path, exists, executable, kind, error
    }
}

/// The `runtime` block of the diagnostics response: resolved paths and their
/// health for the Settings view. Matches `diagnostics.mjs`: `stateRoot`,
/// `launchPath`, `breadcrumb` (kept as `JSONValue`), and typed path entries for
/// `app`, `control`, `runner`, `node`, `helper`, `copilot`, `launchctl`.
public struct RuntimeDiagnostics: Codable, Equatable, Sendable {
    public var stateRoot: String?
    public var launchPath: String?
    public var breadcrumb: JSONValue?
    public var app: DiagnosticsPathInfo?
    public var control: DiagnosticsPathInfo?
    public var runner: DiagnosticsPathInfo?
    public var node: DiagnosticsPathInfo?
    public var helper: DiagnosticsPathInfo?
    public var copilot: DiagnosticsPathInfo?
    public var launchctl: DiagnosticsPathInfo?

    public init(
        stateRoot: String? = nil,
        launchPath: String? = nil,
        breadcrumb: JSONValue? = nil,
        app: DiagnosticsPathInfo? = nil,
        control: DiagnosticsPathInfo? = nil,
        runner: DiagnosticsPathInfo? = nil,
        node: DiagnosticsPathInfo? = nil,
        helper: DiagnosticsPathInfo? = nil,
        copilot: DiagnosticsPathInfo? = nil,
        launchctl: DiagnosticsPathInfo? = nil
    ) {
        self.stateRoot = stateRoot
        self.launchPath = launchPath
        self.breadcrumb = breadcrumb
        self.app = app
        self.control = control
        self.runner = runner
        self.node = node
        self.helper = helper
        self.copilot = copilot
        self.launchctl = launchctl
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.stateRoot = try container.decodeIfPresent(String.self, forKey: .stateRoot)
        self.launchPath = try container.decodeIfPresent(String.self, forKey: .launchPath)
        self.breadcrumb = try container.decodeIfPresent(JSONValue.self, forKey: .breadcrumb)
        self.app = try container.decodeIfPresent(DiagnosticsPathInfo.self, forKey: .app)
        self.control = try container.decodeIfPresent(DiagnosticsPathInfo.self, forKey: .control)
        self.runner = try container.decodeIfPresent(DiagnosticsPathInfo.self, forKey: .runner)
        self.node = try container.decodeIfPresent(DiagnosticsPathInfo.self, forKey: .node)
        self.helper = try container.decodeIfPresent(DiagnosticsPathInfo.self, forKey: .helper)
        self.copilot = try container.decodeIfPresent(DiagnosticsPathInfo.self, forKey: .copilot)
        self.launchctl = try container.decodeIfPresent(DiagnosticsPathInfo.self, forKey: .launchctl)
    }

    private enum CodingKeys: String, CodingKey {
        case stateRoot, launchPath, breadcrumb
        case app, control, runner, node, helper, copilot, launchctl
    }
}

/// Response for `diagnostics`: a tolerant health snapshot. `runtime`/`settings`/
/// `inventory` are typed where practical; the top-level `app` daemon block and
/// `loops` stay `JSONValue` to avoid data loss. `settings` is the full
/// `SettingsResponse` wrapper (`{schemaVersion, settings}`), not a bare
/// `AppSettings`. `errors` and `warnings` are always preserved.
public struct DiagnosticsResponse: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var runtime: RuntimeDiagnostics?
    public var app: JSONValue?
    public var settings: SettingsResponse?
    public var inventory: InventoryResponse?
    public var loops: JSONValue?
    public var errors: [ControlIssue]
    public var warnings: [ControlIssue]

    public init(
        schemaVersion: Int = 1,
        runtime: RuntimeDiagnostics? = nil,
        app: JSONValue? = nil,
        settings: SettingsResponse? = nil,
        inventory: InventoryResponse? = nil,
        loops: JSONValue? = nil,
        errors: [ControlIssue] = [],
        warnings: [ControlIssue] = []
    ) {
        self.schemaVersion = schemaVersion
        self.runtime = runtime
        self.app = app
        self.settings = settings
        self.inventory = inventory
        self.loops = loops
        self.errors = errors
        self.warnings = warnings
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        self.runtime = try container.decodeIfPresent(RuntimeDiagnostics.self, forKey: .runtime)
        self.app = try container.decodeIfPresent(JSONValue.self, forKey: .app)
        self.settings = try container.decodeIfPresent(SettingsResponse.self, forKey: .settings)
        self.inventory = try container.decodeIfPresent(InventoryResponse.self, forKey: .inventory)
        self.loops = try container.decodeIfPresent(JSONValue.self, forKey: .loops)
        self.errors = try container.decodeIfPresent([ControlIssue].self, forKey: .errors) ?? []
        self.warnings = try container.decodeIfPresent([ControlIssue].self, forKey: .warnings) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, runtime, app, settings, inventory, loops, errors, warnings
    }
}

// MARK: - Templates

/// A loop template. Structured input/notes/defaults are kept as `JSONValue` to
/// preserve the Node payload without data loss.
public struct TemplateItem: Codable, Equatable, Sendable {
    public var key: String
    public var title: String?
    public var kind: String?
    public var description: String?
    public var requiredInputs: JSONValue?
    public var optionalInputs: JSONValue?
    public var notes: JSONValue?
    public var defaults: JSONValue?

    public init(
        key: String,
        title: String? = nil,
        kind: String? = nil,
        description: String? = nil,
        requiredInputs: JSONValue? = nil,
        optionalInputs: JSONValue? = nil,
        notes: JSONValue? = nil,
        defaults: JSONValue? = nil
    ) {
        self.key = key
        self.title = title
        self.kind = kind
        self.description = description
        self.requiredInputs = requiredInputs
        self.optionalInputs = optionalInputs
        self.notes = notes
        self.defaults = defaults
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.key = try container.decode(String.self, forKey: .key)
        self.title = try container.decodeIfPresent(String.self, forKey: .title)
        self.kind = try container.decodeIfPresent(String.self, forKey: .kind)
        self.description = try container.decodeIfPresent(String.self, forKey: .description)
        self.requiredInputs = try container.decodeIfPresent(JSONValue.self, forKey: .requiredInputs)
        self.optionalInputs = try container.decodeIfPresent(JSONValue.self, forKey: .optionalInputs)
        self.notes = try container.decodeIfPresent(JSONValue.self, forKey: .notes)
        self.defaults = try container.decodeIfPresent(JSONValue.self, forKey: .defaults)
    }

    private enum CodingKeys: String, CodingKey {
        case key, title, kind, description, requiredInputs, optionalInputs, notes, defaults
    }
}

/// Response for `templates`.
public struct TemplatesResponse: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var templates: [TemplateItem]
    public var errors: [ControlIssue]

    public init(
        schemaVersion: Int = 1,
        templates: [TemplateItem] = [],
        errors: [ControlIssue] = []
    ) {
        self.schemaVersion = schemaVersion
        self.templates = templates
        self.errors = errors
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        self.templates = try container.decodeIfPresent([TemplateItem].self, forKey: .templates) ?? []
        self.errors = try container.decodeIfPresent([ControlIssue].self, forKey: .errors) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, templates, errors
    }
}

// MARK: - Request payloads (JSON stdin)

/// The control plane accepts JSON on stdin only — never positional loop IDs.
/// These `Encodable` payloads model each command's request body.
public struct LoopIDRequest: Codable, Equatable, Sendable {
    public var id: String
    public init(id: String) { self.id = id }
}

public struct LoopBodyRequest: Codable, Equatable, Sendable {
    public var loop: LoopDefinition
    public init(loop: LoopDefinition) { self.loop = loop }
}

public struct PreflightRequest: Codable, Equatable, Sendable {
    public var loop: LoopDefinition?
    public var id: String?
    public init(loop: LoopDefinition? = nil, id: String? = nil) {
        self.loop = loop
        self.id = id
    }
}

public struct ApproveRequest: Codable, Equatable, Sendable {
    public var id: String
    public var expectedFingerprint: String
    public init(id: String, expectedFingerprint: String) {
        self.id = id
        self.expectedFingerprint = expectedFingerprint
    }
}

public struct RetryRequest: Codable, Equatable, Sendable {
    public var id: String
    public var runId: String
    public init(id: String, runId: String) {
        self.id = id
        self.runId = runId
    }
}

public struct PurgeRequest: Codable, Equatable, Sendable {
    public var id: String
    public var confirm: Bool
    public init(id: String, confirm: Bool) {
        self.id = id
        self.confirm = confirm
    }
}

public struct InventoryRequest: Codable, Equatable, Sendable {
    public var localPluginDirectories: [String]
    public init(localPluginDirectories: [String] = []) {
        self.localPluginDirectories = localPluginDirectories
    }
}

public struct SettingsRequest: Codable, Equatable, Sendable {
    public var settings: AppSettings
    public init(settings: AppSettings) { self.settings = settings }
}

/// An empty JSON object payload (`{}`), used by commands like `reconcile`.
public struct EmptyRequest: Codable, Equatable, Sendable {
    public init() {}
}

public struct HistoryRequest: Codable, Equatable, Sendable {
    public var id: String?
    public var count: Int
    public init(id: String? = nil, count: Int) {
        self.id = id
        self.count = count
    }
}

public struct DiagnosticsRequest: Codable, Equatable, Sendable {
    public var id: String?
    public init(id: String? = nil) { self.id = id }
}
