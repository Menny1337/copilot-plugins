import Foundation

public enum LoopKind: String, Codable, CaseIterable, Sendable {
    case copilot
    case script
}

public enum LoopLifecycle: String, Codable, CaseIterable, Sendable {
    case draft
    case needsReview
    case ready
    case enabled
    case paused
    case archived
}

public enum LoopSchedule: Codable, Equatable, Sendable {
    case manual
    case once(scheduledAt: String, graceSeconds: Int)
    case calendar(hour: Int, minute: Int, weekdays: [Int], graceSeconds: Int)
    case interval(seconds: Int, graceSeconds: Int)

    private enum CodingKeys: String, CodingKey {
        case kind, scheduledAt, graceSeconds, hour, minute, weekdays, seconds
    }

    private enum Kind: String, Codable {
        case manual, once, calendar, interval
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .manual:
            self = .manual
        case .once:
            self = .once(
                scheduledAt: try container.decode(String.self, forKey: .scheduledAt),
                graceSeconds: try container.decode(Int.self, forKey: .graceSeconds)
            )
        case .calendar:
            self = .calendar(
                hour: try container.decode(Int.self, forKey: .hour),
                minute: try container.decode(Int.self, forKey: .minute),
                weekdays: try container.decode([Int].self, forKey: .weekdays),
                graceSeconds: try container.decode(Int.self, forKey: .graceSeconds)
            )
        case .interval:
            self = .interval(
                seconds: try container.decode(Int.self, forKey: .seconds),
                graceSeconds: try container.decode(Int.self, forKey: .graceSeconds)
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .manual:
            try container.encode(Kind.manual, forKey: .kind)
        case .once(let scheduledAt, let graceSeconds):
            try container.encode(Kind.once, forKey: .kind)
            try container.encode(scheduledAt, forKey: .scheduledAt)
            try container.encode(graceSeconds, forKey: .graceSeconds)
        case .calendar(let hour, let minute, let weekdays, let graceSeconds):
            try container.encode(Kind.calendar, forKey: .kind)
            try container.encode(hour, forKey: .hour)
            try container.encode(minute, forKey: .minute)
            try container.encode(weekdays, forKey: .weekdays)
            try container.encode(graceSeconds, forKey: .graceSeconds)
        case .interval(let seconds, let graceSeconds):
            try container.encode(Kind.interval, forKey: .kind)
            try container.encode(seconds, forKey: .seconds)
            try container.encode(graceSeconds, forKey: .graceSeconds)
        }
    }
}

public struct PluginSelection: Codable, Equatable, Sendable {
    public var installedPlugin: String?
    public var localPluginDirectories: [String]

    public init(installedPlugin: String? = nil, localPluginDirectories: [String] = []) {
        self.installedPlugin = installedPlugin
        self.localPluginDirectories = localPluginDirectories
    }
}

public struct CopilotExecution: Codable, Equatable, Sendable {
    public var prompt: String
    public var model: String
    public var workingDirectory: String
    public var extraPaths: [String]
    public var localPluginDirectories: [String]
    public var installedPlugin: String?
    public var agent: String?
    public var skill: String?

    public init(
        prompt: String,
        model: String,
        workingDirectory: String,
        extraPaths: [String] = [],
        localPluginDirectories: [String] = [],
        installedPlugin: String? = nil,
        agent: String? = nil,
        skill: String? = nil
    ) {
        self.prompt = prompt
        self.model = model
        self.workingDirectory = workingDirectory
        self.extraPaths = extraPaths
        self.localPluginDirectories = localPluginDirectories
        self.installedPlugin = installedPlugin
        self.agent = agent
        self.skill = skill
    }
}

public struct ScriptFileExecution: Codable, Equatable, Sendable {
    public var path: String
    public var arguments: [String]
    public var workingDirectory: String
    public var contentHash: String

    public init(
        path: String,
        workingDirectory: String,
        arguments: [String] = [],
        contentHash: String
    ) {
        self.path = path
        self.arguments = arguments
        self.workingDirectory = workingDirectory
        self.contentHash = contentHash
    }
}

public struct ExecutableExecution: Codable, Equatable, Sendable {
    public var path: String
    public var arguments: [String]
    public var workingDirectory: String
    public var executableHash: String?

    public init(
        path: String,
        workingDirectory: String,
        arguments: [String] = [],
        executableHash: String? = nil
    ) {
        self.path = path
        self.arguments = arguments
        self.workingDirectory = workingDirectory
        self.executableHash = executableHash
    }

    private enum CodingKeys: String, CodingKey {
        case path, arguments, workingDirectory, executableHash
    }

    // Explicit encode so the schema-required `executableHash` is always present
    // (encoded as JSON null when nil), matching Node's canonical manifests.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(path, forKey: .path)
        try container.encode(arguments, forKey: .arguments)
        try container.encode(workingDirectory, forKey: .workingDirectory)
        try container.encode(executableHash, forKey: .executableHash)
    }
}

public enum LoopExecution: Codable, Equatable, Sendable {
    case copilot(CopilotExecution)
    case scriptFile(ScriptFileExecution)
    case executable(ExecutableExecution)

    private enum CodingKeys: String, CodingKey {
        case type
    }

    private enum Kind: String, Codable {
        case copilot, scriptFile, executable
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .type) {
        case .copilot:
            self = .copilot(try CopilotExecution(from: decoder))
        case .scriptFile:
            self = .scriptFile(try ScriptFileExecution(from: decoder))
        case .executable:
            self = .executable(try ExecutableExecution(from: decoder))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .copilot(let value):
            try container.encode(Kind.copilot, forKey: .type)
            try value.encode(to: encoder)
        case .scriptFile(let value):
            try container.encode(Kind.scriptFile, forKey: .type)
            try value.encode(to: encoder)
        case .executable(let value):
            try container.encode(Kind.executable, forKey: .type)
            try value.encode(to: encoder)
        }
    }
}

public struct PermissionConfig: Codable, Equatable, Sendable {
    public enum Profile: String, Codable, Sendable {
        case fullAutonomy
        case custom
    }

    public var profile: Profile
    /// Legacy schema key for full tool autonomy. Paths and URLs remain separately scoped.
    public var allowAll: Bool
    public var allowTools: [String]
    public var denyTools: [String]
    public var allowUrls: [String]
    public var denyUrls: [String]

    public init(
        profile: Profile = .custom,
        allowAll: Bool = false,
        allowTools: [String] = [],
        denyTools: [String] = [],
        allowUrls: [String] = [],
        denyUrls: [String] = []
    ) {
        self.profile = profile
        self.allowAll = allowAll
        self.allowTools = allowTools
        self.denyTools = denyTools
        self.allowUrls = allowUrls
        self.denyUrls = denyUrls
    }
}

public struct EnvironmentConfig: Codable, Equatable, Sendable {
    public var plain: [String: String]
    public var secretNames: [String]

    public init(plain: [String: String] = [:], secretNames: [String] = []) {
        self.plain = plain
        self.secretNames = secretNames
    }
}

public struct RetryPolicy: Codable, Equatable, Sendable {
    public var maxRetries: Int
    public var backoffSeconds: Int

    public init(maxRetries: Int = 0, backoffSeconds: Int = 60) {
        self.maxRetries = maxRetries
        self.backoffSeconds = backoffSeconds
    }
}

public struct NotificationPolicy: Codable, Equatable, Sendable {
    public var onFailure: Bool
    public var onSuccess: Bool

    public init(onFailure: Bool = true, onSuccess: Bool = false) {
        self.onFailure = onFailure
        self.onSuccess = onSuccess
    }
}

public struct RetentionPolicy: Codable, Equatable, Sendable {
    public var days: Int
    public var maxRuns: Int

    public init(days: Int = 30, maxRuns: Int = 100) {
        self.days = days
        self.maxRuns = maxRuns
    }
}

public struct Approval: Codable, Equatable, Sendable {
    public var fingerprint: String?
    public var approvedAt: String?

    public init(fingerprint: String? = nil, approvedAt: String? = nil) {
        self.fingerprint = fingerprint
        self.approvedAt = approvedAt
    }

    private enum CodingKeys: String, CodingKey {
        case fingerprint, approvedAt
    }

    // Explicit encode so both keys are always present (null when nil), matching
    // the canonical schema which requires `fingerprint` and `approvedAt`.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(fingerprint, forKey: .fingerprint)
        try container.encode(approvedAt, forKey: .approvedAt)
    }
}

public struct LoopDefinition: Codable, Identifiable, Equatable, Sendable {
    public var schemaVersion: Int
    public var id: String
    public var name: String
    public var kind: LoopKind
    public var lifecycle: LoopLifecycle
    public var schedule: LoopSchedule
    public var execution: LoopExecution
    public var permissions: PermissionConfig
    public var environment: EnvironmentConfig
    public var timeoutSeconds: Int
    public var retry: RetryPolicy
    public var overlapPolicy: String
    public var notifications: NotificationPolicy
    public var retention: RetentionPolicy
    public var approval: Approval
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String,
        name: String,
        kind: LoopKind,
        lifecycle: LoopLifecycle,
        schedule: LoopSchedule,
        execution: LoopExecution,
        permissions: PermissionConfig = PermissionConfig(),
        environment: EnvironmentConfig = EnvironmentConfig(),
        timeoutSeconds: Int = 1800,
        retry: RetryPolicy = RetryPolicy(),
        overlapPolicy: String = "skip",
        notifications: NotificationPolicy = NotificationPolicy(),
        retention: RetentionPolicy = RetentionPolicy(),
        approval: Approval = Approval(),
        createdAt: String,
        updatedAt: String,
        schemaVersion: Int = 1
    ) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.name = name
        self.kind = kind
        self.lifecycle = lifecycle
        self.schedule = schedule
        self.execution = execution
        self.permissions = permissions
        self.environment = environment
        self.timeoutSeconds = timeoutSeconds
        self.retry = retry
        self.overlapPolicy = overlapPolicy
        self.notifications = notifications
        self.retention = retention
        self.approval = approval
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
