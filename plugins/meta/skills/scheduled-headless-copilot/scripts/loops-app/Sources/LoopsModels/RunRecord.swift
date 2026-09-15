import Foundation

public enum RunTrigger: String, Codable, Sendable {
    case schedule
    case manual
    case retry
}

public enum RunStatus: String, Codable, CaseIterable, Sendable {
    case starting
    case running
    case stopping
    case succeeded
    case failed
    case timedOut
    case cancelled
    case skippedOverlap
    case skippedMissed
    case skippedPaused
    case approvalBlocked
    case launchFailed

    /// Human-readable status vocabulary. Lives in the model layer because the
    /// manager's column-width contract has to measure the longest label.
    public var displayName: String {
        switch self {
        case .starting: return "Starting"
        case .running: return "Running"
        case .stopping: return "Stopping"
        case .succeeded: return "Succeeded"
        case .failed: return "Failed"
        case .timedOut: return "Timed out"
        case .cancelled: return "Cancelled"
        case .skippedOverlap: return "Skipped overlap"
        case .skippedMissed: return "Skipped missed run"
        case .skippedPaused: return "Skipped while paused"
        case .approvalBlocked: return "Approval blocked"
        case .launchFailed: return "Launch failed"
        }
    }
}

public struct RunAttempt: Codable, Equatable, Sendable {
    public var number: Int
    public var startedAt: String
    public var endedAt: String?
    public var exitCode: Int?
    public var signal: String?

    public init(
        number: Int,
        startedAt: String,
        endedAt: String? = nil,
        exitCode: Int? = nil,
        signal: String? = nil
    ) {
        self.number = number
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.exitCode = exitCode
        self.signal = signal
    }

    private enum CodingKeys: String, CodingKey {
        case number, startedAt, endedAt, exitCode, signal
    }

    // Explicit encode so schema-required nullable keys are always present.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(number, forKey: .number)
        try container.encode(startedAt, forKey: .startedAt)
        try container.encode(endedAt, forKey: .endedAt)
        try container.encode(exitCode, forKey: .exitCode)
        try container.encode(signal, forKey: .signal)
    }
}

public struct RunRecord: Codable, Identifiable, Equatable, Sendable {
    public var schemaVersion: Int
    public var id: String
    public var loopId: String
    public var sessionId: String
    public var trigger: RunTrigger
    public var status: RunStatus
    public var scheduledFor: String?
    public var startedAt: String?
    public var endedAt: String?
    public var exitCode: Int?
    public var signal: String?
    public var retryOf: String?
    public var attempts: [RunAttempt]

    public init(
        id: String,
        loopId: String,
        sessionId: String,
        trigger: RunTrigger,
        status: RunStatus,
        scheduledFor: String? = nil,
        startedAt: String? = nil,
        endedAt: String? = nil,
        exitCode: Int? = nil,
        signal: String? = nil,
        retryOf: String? = nil,
        attempts: [RunAttempt] = [],
        schemaVersion: Int = 1
    ) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.loopId = loopId
        self.sessionId = sessionId
        self.trigger = trigger
        self.status = status
        self.scheduledFor = scheduledFor
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.exitCode = exitCode
        self.signal = signal
        self.retryOf = retryOf
        self.attempts = attempts
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, id, loopId, sessionId, trigger, status
        case scheduledFor, startedAt, endedAt, exitCode, signal, retryOf, attempts
    }

    // Explicit encode so all schema-required nullable keys (`scheduledFor`,
    // `startedAt`, `endedAt`, `exitCode`, `signal`, `retryOf`) are always present
    // as JSON null when nil, matching Node's canonical run schema.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(id, forKey: .id)
        try container.encode(loopId, forKey: .loopId)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(trigger, forKey: .trigger)
        try container.encode(status, forKey: .status)
        try container.encode(scheduledFor, forKey: .scheduledFor)
        try container.encode(startedAt, forKey: .startedAt)
        try container.encode(endedAt, forKey: .endedAt)
        try container.encode(exitCode, forKey: .exitCode)
        try container.encode(signal, forKey: .signal)
        try container.encode(retryOf, forKey: .retryOf)
        try container.encode(attempts, forKey: .attempts)
    }
}
