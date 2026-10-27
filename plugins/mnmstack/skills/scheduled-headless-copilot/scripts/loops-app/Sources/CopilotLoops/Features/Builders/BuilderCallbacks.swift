import Foundation
import LoopsModels

// MARK: - Callback bundle

/// Externally supplied side-effect surface for the loop builder. Views never
/// perform IO themselves; they invoke these closures so the AppModel can hold
/// all persistence, control-plane, and secrets-store wiring.
///
/// Every closure has a safe no-op default so tests, previews, and progressive
/// integrations can override only the pieces they care about.
struct LoopBuilderCallbacks {
    /// Persist a draft loop (typically written to the loops state root without
    /// enabling it). The builder invokes this on the "Save draft" toolbar
    /// action.
    var saveDraft: (LoopDefinition) async throws -> Void

    /// Ask the control plane for a preflight verdict for the draft loop.
    var preflight: (LoopDefinition) async throws -> PreflightResponse

    /// Approve the draft loop at the supplied capability fingerprint. Called
    /// from the review step when the user acknowledges the fingerprint.
    var approve: (LoopDefinition, _ fingerprint: String) async throws -> Void

    /// Move the loop to the `enabled` lifecycle. Called from the review step
    /// once approval has succeeded.
    var enable: (LoopDefinition) async throws -> Void

    /// Cancel/dismiss the builder without saving.
    var dismiss: () -> Void

    /// Compute the SHA-256 of the file at `path`, and return any actionable
    /// problems (unreadable, non-executable, no shebang) discovered while
    /// hashing. `expectShebang` differentiates script-file mode (`true`) from
    /// raw executable mode (`false`) so the check cannot be confused between
    /// the two modes. Implemented by `BuilderHasher` in production; injectable
    /// so tests supply deterministic values.
    var computeHash: (_ path: String, _ expectShebang: Bool) async -> BuilderHashResult

    /// Present an `NSOpenPanel` to pick a single file or directory. Returns an
    /// absolute path or `nil` when the user cancels.
    var pickPath: (BuilderPickerRequest) async -> String?

    /// Hand off pending secret payloads for storage via `SecretsClient`. Values
    /// leave the builder here and are cleared from row state on return.
    var storePendingSecrets: ([PendingSecret]) async throws -> Void

    /// Refresh the plugin/skill/agent inventory. The builder shell drives this
    /// so the AppModel can decide whether to re-query.
    var refreshInventory: () async -> Void

    init(
        saveDraft: @escaping (LoopDefinition) async throws -> Void = { _ in },
        preflight: @escaping (LoopDefinition) async throws -> PreflightResponse = { _ in PreflightResponse() },
        approve: @escaping (LoopDefinition, String) async throws -> Void = { _, _ in },
        enable: @escaping (LoopDefinition) async throws -> Void = { _ in },
        dismiss: @escaping () -> Void = {},
        computeHash: @escaping (String, Bool) async -> BuilderHashResult = { path, _ in
            BuilderHashResult(path: path, hash: "")
        },
        pickPath: @escaping (BuilderPickerRequest) async -> String? = { _ in nil },
        storePendingSecrets: @escaping ([PendingSecret]) async throws -> Void = { _ in },
        refreshInventory: @escaping () async -> Void = {}
    ) {
        self.saveDraft = saveDraft
        self.preflight = preflight
        self.approve = approve
        self.enable = enable
        self.dismiss = dismiss
        self.computeHash = computeHash
        self.pickPath = pickPath
        self.storePendingSecrets = storePendingSecrets
        self.refreshInventory = refreshInventory
    }
}

/// Configuration for a single file-picker invocation. The builder never opens
/// a panel directly; it asks the AppModel via `pickPath`.
struct BuilderPickerRequest: Equatable {
    enum Kind: Equatable {
        case file
        case directory
    }

    var title: String
    var kind: Kind
    /// Starting directory (absolute path) when known — otherwise the panel
    /// starts at the current user's home.
    var initialDirectory: String?

    init(title: String, kind: Kind, initialDirectory: String? = nil) {
        self.title = title
        self.kind = kind
        self.initialDirectory = initialDirectory
    }
}

// MARK: - Validation issues

/// Field-level validation error attached to a specific step. The builder
/// surfaces these inline near the offending field and disables Continue when
/// the current step still has any.
struct BuilderIssue: Identifiable, Equatable {
    enum Severity: Equatable { case error, warning }

    enum Field: Hashable {
        case name
        case id
        case workingDirectory
        case model
        case prompt
        case agent
        case skill
        case scriptPath
        case executablePath
        case argument(id: String)
        case envRowName(id: String)
        case envRowValue(id: String)
        case secretRowName(id: String)
        case secretRowValue(id: String)
        case extraPath(id: String)
        case pluginPath(id: String)
        case allowTool(id: String)
        case denyTool(id: String)
        case allowUrl(id: String)
        case denyUrl(id: String)
        case scheduleTime
        case scheduleWeekdays
        case scheduleInterval
        case timeout
        case retries
        case backoff
        case retention
    }

    var step: BuilderStep
    var field: Field
    var severity: Severity
    var message: String

    /// Deterministic id derived from step + field key so SwiftUI `ForEach`
    /// does not re-create rows every render pass.
    var id: String { "\(step.rawValue)-\(BuilderIssue.fieldKey(field))" }

    init(
        step: BuilderStep,
        field: Field,
        severity: Severity = .error,
        message: String
    ) {
        self.step = step
        self.field = field
        self.severity = severity
        self.message = message
    }

    private static func fieldKey(_ field: Field) -> String {
        switch field {
        case .name: return "name"
        case .id: return "id"
        case .workingDirectory: return "workingDirectory"
        case .model: return "model"
        case .prompt: return "prompt"
        case .agent: return "agent"
        case .skill: return "skill"
        case .scriptPath: return "scriptPath"
        case .executablePath: return "executablePath"
        case .argument(let id): return "argument-\(id)"
        case .envRowName(let id): return "envRowName-\(id)"
        case .envRowValue(let id): return "envRowValue-\(id)"
        case .secretRowName(let id): return "secretRowName-\(id)"
        case .secretRowValue(let id): return "secretRowValue-\(id)"
        case .extraPath(let id): return "extraPath-\(id)"
        case .pluginPath(let id): return "pluginPath-\(id)"
        case .allowTool(let id): return "allowTool-\(id)"
        case .denyTool(let id): return "denyTool-\(id)"
        case .allowUrl(let id): return "allowUrl-\(id)"
        case .denyUrl(let id): return "denyUrl-\(id)"
        case .scheduleTime: return "scheduleTime"
        case .scheduleWeekdays: return "scheduleWeekdays"
        case .scheduleInterval: return "scheduleInterval"
        case .timeout: return "timeout"
        case .retries: return "retries"
        case .backoff: return "backoff"
        case .retention: return "retention"
        }
    }
}
