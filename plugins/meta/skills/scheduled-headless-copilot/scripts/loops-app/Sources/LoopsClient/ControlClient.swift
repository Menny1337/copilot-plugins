import Foundation
import LoopsModels

/// A single control-plane command invocation: `<command> [arguments...]` with an
/// optional JSON payload delivered on stdin.
public struct ControlInvocation: Sendable {
    public var command: String
    public var arguments: [String]
    public var payload: Data?

    public init(command: String, arguments: [String] = [], payload: Data? = nil) {
        self.command = command
        self.arguments = arguments
        self.payload = payload
    }
}

public enum ControlClientError: LocalizedError {
    case decoding(command: String, underlying: String)
    case runtime(String)

    public var errorDescription: String? {
        switch self {
        case .decoding(let command, let underlying):
            return "Failed to decode \(command) response: \(underlying)"
        case .runtime(let message):
            return message
        }
    }
}

/// Abstracts the `loops-ctl.mjs` control plane. Conformers implement the single
/// primitive `invokeRaw`; typed accessors are provided as protocol extensions so
/// mocks only need to fake raw bytes.
public protocol ControlClient: Sendable {
    /// Runs a command and returns raw stdout bytes on success. Throws a
    /// `ControlError` for structured control-plane failures.
    func invokeRaw(_ invocation: ControlInvocation) async throws -> Data
}

extension ControlClient {
    private var decoder: JSONDecoder { JSONDecoder() }

    /// Decodes the locked wire envelope `{ ok, data, error }`, requires
    /// `ok == true && data != nil`, and returns the unwrapped payload. Any
    /// `{ ok:false, error }` (or a missing payload) throws the nested
    /// `ControlError`.
    public func invoke<T: Codable & Sendable>(
        _ type: T.Type,
        _ invocation: ControlInvocation
    ) async throws -> T {
        let data = try await invokeRaw(invocation)
        let envelope: ControlEnvelope<T>
        do {
            envelope = try decoder.decode(ControlEnvelope<T>.self, from: data)
        } catch {
            throw ControlClientError.decoding(
                command: invocation.command,
                underlying: String(describing: error)
            )
        }
        guard envelope.ok, let payload = envelope.data else {
            throw envelope.error ?? ControlError(
                name: "ControlPlaneError",
                message: "\(invocation.command) returned no data",
                code: "empty-envelope"
            )
        }
        return payload
    }

    private func encode<R: Encodable>(_ request: R) throws -> Data {
        try JSONEncoder().encode(request)
    }

    // MARK: Reads

    public func listLoops() async throws -> LoopListResponse {
        try await invoke(LoopListResponse.self, ControlInvocation(command: "list"))
    }

    public func showLoop(id: String) async throws -> LoopDetail {
        try await invoke(
            LoopDetail.self,
            ControlInvocation(command: "show", payload: try encode(LoopIDRequest(id: id)))
        )
    }

    public func aggregate() async throws -> LoopAggregate {
        try await invoke(LoopAggregate.self, ControlInvocation(command: "aggregate"))
    }

    public func inventory(localPluginDirectories: [String] = []) async throws -> InventoryResponse {
        try await invoke(
            InventoryResponse.self,
            ControlInvocation(
                command: "inventory",
                payload: try encode(InventoryRequest(localPluginDirectories: localPluginDirectories))
            )
        )
    }

    public func getSettings() async throws -> SettingsResponse {
        try await invoke(SettingsResponse.self, ControlInvocation(command: "settings-get"))
    }

    public func setSettings(_ settings: AppSettings) async throws -> SettingsResponse {
        try await invoke(
            SettingsResponse.self,
            ControlInvocation(
                command: "settings-set",
                payload: try encode(SettingsRequest(settings: settings))
            )
        )
    }

    public func preflight(loop: LoopDefinition? = nil, id: String? = nil) async throws -> PreflightResponse {
        try await invoke(
            PreflightResponse.self,
            ControlInvocation(
                command: "preflight",
                payload: try encode(PreflightRequest(loop: loop, id: id))
            )
        )
    }

    public func reconcile() async throws -> LoopListResponse {
        try await invoke(
            LoopListResponse.self,
            ControlInvocation(command: "reconcile", payload: try encode(EmptyRequest()))
        )
    }

    /// Recent run history, optionally scoped to one loop. `count` is clamped to
    /// the supported 1...200 range and travels (with any id) in the JSON stdin
    /// payload — never as argv.
    public func history(id: String? = nil, count: Int) async throws -> HistoryResponse {
        let clamped = min(200, max(1, count))
        return try await invoke(
            HistoryResponse.self,
            ControlInvocation(
                command: "history",
                payload: try encode(HistoryRequest(id: id, count: clamped))
            )
        )
    }

    /// Environment/runtime health snapshot for the Settings view. An optional
    /// loop id scopes the snapshot and travels in the JSON stdin payload.
    public func diagnostics(id: String? = nil) async throws -> DiagnosticsResponse {
        try await invoke(
            DiagnosticsResponse.self,
            ControlInvocation(
                command: "diagnostics",
                payload: try encode(DiagnosticsRequest(id: id))
            )
        )
    }

    /// Available loop templates.
    public func templates() async throws -> TemplatesResponse {
        try await invoke(
            TemplatesResponse.self,
            ControlInvocation(command: "templates", payload: try encode(EmptyRequest()))
        )
    }

    // MARK: Lifecycle mutations (JSON stdin only — never argv loop IDs)

    /// Low-level mutation entry point: encodes an arbitrary request payload and
    /// returns the tolerant `LoopMutationResponse`. IDs travel in the payload.
    public func mutate<R: Encodable>(
        _ command: String,
        request: R
    ) async throws -> LoopMutationResponse {
        try await invoke(
            LoopMutationResponse.self,
            ControlInvocation(command: command, payload: try encode(request))
        )
    }

    public func createLoop(_ loop: LoopDefinition) async throws -> LoopMutationResponse {
        try await mutate("create", request: LoopBodyRequest(loop: loop))
    }

    public func updateLoop(_ loop: LoopDefinition) async throws -> LoopMutationResponse {
        try await mutate("update", request: LoopBodyRequest(loop: loop))
    }

    public func approve(id: String, expectedFingerprint: String) async throws -> LoopMutationResponse {
        try await mutate("approve", request: ApproveRequest(id: id, expectedFingerprint: expectedFingerprint))
    }

    public func enable(id: String) async throws -> LoopMutationResponse {
        try await mutate("enable", request: LoopIDRequest(id: id))
    }

    public func pause(id: String) async throws -> LoopMutationResponse {
        try await mutate("pause", request: LoopIDRequest(id: id))
    }

    public func resume(id: String) async throws -> LoopMutationResponse {
        try await mutate("resume", request: LoopIDRequest(id: id))
    }

    public func archive(id: String) async throws -> LoopMutationResponse {
        try await mutate("archive", request: LoopIDRequest(id: id))
    }

    public func runNow(id: String) async throws -> LoopMutationResponse {
        try await mutate("run-now", request: LoopIDRequest(id: id))
    }

    public func stop(id: String) async throws -> LoopMutationResponse {
        try await mutate("stop", request: LoopIDRequest(id: id))
    }

    public func retry(id: String, runId: String) async throws -> LoopMutationResponse {
        try await mutate("retry", request: RetryRequest(id: id, runId: runId))
    }

    public func purge(id: String, confirm: Bool) async throws -> LoopMutationResponse {
        try await mutate("purge", request: PurgeRequest(id: id, confirm: confirm))
    }
}

/// Shell-backed control client that resolves the stable `loops-ctl.mjs` runtime
/// and executes it through `ProcessRunner` (which drains stdout/stderr
/// concurrently). Structured control-plane failures are surfaced as
/// `ControlError`.
public struct ShellControlClient: ControlClient {
    private let resolver: RuntimeResolver
    private let environment: [String: String]

    public init(
        resolver: RuntimeResolver = RuntimeResolver(),
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) {
        self.resolver = resolver
        self.environment = environment
    }

    public func invokeRaw(_ invocation: ControlInvocation) async throws -> Data {
        let resolution: RuntimeResolver.Resolution
        do {
            resolution = try resolver.resolve()
        } catch {
            throw ControlClientError.runtime(error.localizedDescription)
        }

        var env = environment
        if env["COPILOT_LOOPS_HOME"] == nil {
            env["COPILOT_LOOPS_HOME"] = resolution.stateRoot.path
        }

        let arguments = resolution.argumentPrefix + [invocation.command] + invocation.arguments
        let output = try await ProcessRunner.run(
            resolution.executableURL,
            arguments: arguments,
            environment: env,
            stdin: invocation.payload
        )

        guard output.exitCode == 0 else {
            throw Self.mapFailure(
                stdout: output.stdout,
                stderr: output.stderr,
                exitCode: output.exitCode,
                command: invocation.command
            )
        }
        return output.stdout
    }

    /// Extracts a `ControlError` from a non-zero exit. Decodes the locked failure
    /// envelope `{ ok:false, error:{...} }` from either stream, then falls back
    /// to a bare error object or the raw stderr text. Exposed for testing.
    public static func mapFailure(
        stdout: Data,
        stderr: Data,
        exitCode: Int32,
        command: String
    ) -> Error {
        let decoder = JSONDecoder()
        for data in [stdout, stderr] where !data.isEmpty {
            if let envelope = try? decoder.decode(ControlErrorEnvelope.self, from: data),
               !envelope.ok {
                return envelope.error
            }
            if let error = try? decoder.decode(ControlError.self, from: data),
               !error.message.isEmpty {
                return error
            }
        }
        let text = String(data: stderr, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let message = text.isEmpty ? "\(command) exited \(exitCode)" : text
        return ControlError(
            name: "ControlPlaneError",
            message: message,
            code: "exit-\(exitCode)"
        )
    }
}
