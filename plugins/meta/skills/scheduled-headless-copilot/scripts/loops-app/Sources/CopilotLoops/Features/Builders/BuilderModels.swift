import Foundation
import LoopsModels

// MARK: - Steps + mode

/// The four ordered authoring steps: Configure → Permissions → Schedule → Review.
enum BuilderStep: Int, CaseIterable, Identifiable, Hashable {
    case configure
    case permissions
    case schedule
    case review

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .configure: return "Configure"
        case .permissions: return "Permissions"
        case .schedule: return "Schedule"
        case .review: return "Review"
        }
    }

    var systemImage: String {
        switch self {
        case .configure: return "slider.horizontal.3"
        case .permissions: return "hand.raised.fill"
        case .schedule: return "calendar"
        case .review: return "checkmark.seal"
        }
    }
}

/// Whether the builder is authoring a brand-new loop or editing an existing one.
enum BuilderMode: Equatable {
    case create
    case edit(originalID: String)

    var isEdit: Bool {
        if case .edit = self { return true }
        return false
    }
}

// MARK: - Path row

/// Editable, identified path row backing extra paths / local plugin directories.
struct BuilderPathRow: Identifiable, Equatable {
    var id: String
    var path: String

    init(id: String = UUID().uuidString, path: String = "") {
        self.id = id
        self.path = path
    }
}

// MARK: - Script + argument rows

enum ScriptExecutionMode: String, CaseIterable, Identifiable, Hashable {
    /// A managed script file (path + arguments). Never a shell command string.
    case scriptFile
    /// A direct executable with discrete argv.
    case executable

    var id: String { rawValue }

    var title: String {
        switch self {
        case .scriptFile: return "Script file"
        case .executable: return "Executable + arguments"
        }
    }

    var subtitle: String {
        switch self {
        case .scriptFile:
            return "Run a script file directly (never a shell command string)."
        case .executable:
            return "Launch an executable with an explicit argument list."
        }
    }
}

/// A single positional argument row. Order matters and is preserved by the row
/// collection; never join arguments into a shell string.
struct BuilderArgumentRow: Identifiable, Equatable {
    var id: String
    var value: String

    init(id: String = UUID().uuidString, value: String = "") {
        self.id = id
        self.value = value
    }
}

// MARK: - Environment rows

/// A plain (non-secret) environment variable row. Value is safe to persist in
/// the loop definition.
struct BuilderEnvRow: Identifiable, Equatable {
    var id: String
    var name: String
    var value: String

    init(id: String = UUID().uuidString, name: String = "", value: String = "") {
        self.id = id
        self.name = name
        self.value = value
    }
}

/// A secret environment variable row. Only the `name` is persisted in the loop
/// definition (via `EnvironmentConfig.secretNames`). The transient `value`
/// lives on the row for entry, is delivered to the integrator through the
/// `LoopBuilderCallbacks.storePendingSecrets` closure, and is then cleared.
///
/// `value` intentionally participates in `Equatable` so bindings work — but
/// `debugDescription` never includes it, and there is no `Codable`
/// conformance so secret values cannot round-trip through JSON.
struct BuilderSecretRow: Identifiable, Equatable, CustomDebugStringConvertible {
    var id: String
    var name: String
    /// Transient, never copied into `LoopDefinition` or previews. Cleared after
    /// the pending payload has been handed off.
    var value: String
    /// `true` once the integrator has confirmed the secret is stored (or
    /// pre-populated for an existing loop). Purely a UI hint.
    var isStored: Bool

    init(
        id: String = UUID().uuidString,
        name: String = "",
        value: String = "",
        isStored: Bool = false
    ) {
        self.id = id
        self.name = name
        self.value = value
        self.isStored = isStored
    }

    var debugDescription: String {
        "BuilderSecretRow(id: \(id), name: \(name), isStored: \(isStored), value: <redacted>)"
    }
}

/// A payload the integrator writes to the `SecretsClient`. Constructed only at
/// hand-off; `value` never enters the loop definition or preview data.
struct PendingSecret: Equatable, CustomDebugStringConvertible {
    let loopID: String
    let name: String
    let value: Data

    var debugDescription: String {
        "PendingSecret(loopID: \(loopID), name: \(name), value: <\(value.count) bytes redacted>)"
    }
}

// MARK: - Permissions

enum PermissionProfile: String, CaseIterable, Identifiable, Hashable {
    case fullAutonomy
    case custom

    var id: String { rawValue }

    var title: String {
        switch self {
        case .fullAutonomy: return "Full tool autonomy"
        case .custom: return "Custom allow/deny"
        }
    }

    var subtitle: String {
        switch self {
        case .fullAutonomy:
            return "Recommended default. Any tool can run without confirmation; files and URLs remain scoped."
        case .custom:
            return "Restrict tools or URLs by adding explicit allow/deny entries."
        }
    }
}

// MARK: - Schedule inputs

/// The schedule kinds the builder exposes. Distinct from `LoopSchedule`
/// (Codable, associated-values) so bindings stay simple.
enum ScheduleKind: String, CaseIterable, Identifiable, Hashable {
    case manual
    case oneTime
    case dailyCalendar
    case weekdayCalendar
    case interval

    var id: String { rawValue }

    var title: String {
        switch self {
        case .manual: return "Manual"
        case .oneTime: return "One-time"
        case .dailyCalendar: return "Every day"
        case .weekdayCalendar: return "Selected weekdays"
        case .interval: return "Interval"
        }
    }

    var subtitle: String {
        switch self {
        case .manual: return "Run only when triggered explicitly."
        case .oneTime: return "Fires once at a specific local date and time (minute precision)."
        case .dailyCalendar: return "Every day at the same local time."
        case .weekdayCalendar: return "Only on the selected weekdays, at the same local time."
        case .interval: return "Repeat on a fixed interval (60 seconds or longer)."
        }
    }
}

/// Snapshot of the file/executable hash computation, produced by the injected
/// hash callback. `problems` describe *actionable* issues (unreadable,
/// non-executable, no shebang) that the review step needs to surface.
struct BuilderHashResult: Equatable {
    var path: String
    var hash: String
    var problems: [BuilderHashProblem]

    init(path: String, hash: String, problems: [BuilderHashProblem] = []) {
        self.path = path
        self.hash = hash
        self.problems = problems
    }
}

/// Actionable hash-time problems. The builder shows these inline on the script
/// step and repeats them on review.
enum BuilderHashProblem: Equatable {
    case missing
    case unreadable(reason: String)
    case notExecutable
    case missingShebang

    var message: String {
        switch self {
        case .missing:
            return "File does not exist at that path."
        case .unreadable(let reason):
            return "Cannot read file: \(reason)"
        case .notExecutable:
            return "File is not marked executable (chmod +x)."
        case .missingShebang:
            return "Script has no `#!` shebang on the first line."
        }
    }

    var systemImage: String {
        switch self {
        case .missing, .unreadable: return "xmark.octagon.fill"
        case .notExecutable: return "lock.fill"
        case .missingShebang: return "text.badge.xmark"
        }
    }
}
