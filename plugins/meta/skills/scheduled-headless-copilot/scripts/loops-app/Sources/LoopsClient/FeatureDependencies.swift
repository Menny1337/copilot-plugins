import Foundation
import LoopsModels

/// Dependency surface that UI feature modules consume. Feature owners depend on
/// this protocol rather than concrete types, so they can build and preview their
/// screens (dashboard, library, history, settings) without editing the central
/// `App.swift` shell. A test double can conform with in-memory fakes.
public protocol LoopsEnvironment: Sendable {
    /// Control-plane accessor for reads and mutations.
    var controlClient: ControlClient { get }

    /// Resolver for the stable runtime, exposed so features can surface the
    /// resolved state root (e.g. to build log paths).
    var runtimeResolver: RuntimeResolver { get }

    /// Keychain-backed secrets client for authoring loop secret values.
    var secretsClient: SecretsClient { get }

    /// Creates a watcher over the loops state root, delivering debounced batches
    /// of changed paths.
    func makeStateWatcher(handler: @escaping @Sendable ([String]) -> Void) -> RootDirectoryWatcher

    /// Creates a tailer for a run log file.
    func makeLogTailer(
        url: URL,
        startAtEnd: Bool,
        onChunk: @escaping @Sendable (Data) -> Void
    ) -> LogTailer
}

extension LoopsEnvironment {
    /// Convenience: tail a log file from the beginning.
    public func makeLogTailer(
        url: URL,
        onChunk: @escaping @Sendable (Data) -> Void
    ) -> LogTailer {
        makeLogTailer(url: url, startAtEnd: false, onChunk: onChunk)
    }
}

/// Production environment wiring a `ShellControlClient` and the runtime resolver.
public struct LiveLoopsEnvironment: LoopsEnvironment {
    public let controlClient: ControlClient
    public let runtimeResolver: RuntimeResolver
    public let secretsClient: SecretsClient
    private let debounceInterval: TimeInterval

    public init(
        resolver: RuntimeResolver = RuntimeResolver(),
        environment: [String: String] = ProcessInfo.processInfo.environment,
        debounceInterval: TimeInterval = 0.3
    ) {
        self.runtimeResolver = resolver
        self.controlClient = ShellControlClient(resolver: resolver, environment: environment)
        // Best-effort breadcrumb load so the secrets helper path (if recorded)
        // is used; the client still falls back to bundle/home locations.
        let breadcrumb = try? resolver.loadBreadcrumb()
        self.secretsClient = KeychainSecretsClient(
            breadcrumb: breadcrumb,
            environment: environment
        )
        self.debounceInterval = debounceInterval
    }

    private func stateRootURL() -> URL {
        if let resolved = try? runtimeResolver.resolve() { return resolved.stateRoot }
        if let root = try? runtimeResolver.stateRoot() { return root }
        // Last-resort default when the environment is misconfigured; the watcher
        // will surface a descriptive error on start if this path is unusable.
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".copilot", isDirectory: true)
            .appendingPathComponent("scheduled-tasks", isDirectory: true)
            .appendingPathComponent("copilot-loops", isDirectory: true)
    }

    public func makeStateWatcher(
        handler: @escaping @Sendable ([String]) -> Void
    ) -> RootDirectoryWatcher {
        RootDirectoryWatcher(
            root: stateRootURL().appendingPathComponent("tasks", isDirectory: true),
            debounceInterval: debounceInterval,
            pathFilter: { Self.isControlStateMetadata($0) },
            handler: handler
        )
    }

    /// Path filter for the state watcher: admit only control/state metadata
    /// (`loop.json`, `state.json`, `run.json` / `run-*.json`, approval and manual
    /// markers, generated launchd `.plist`, and task directories) while excluding
    /// the high-frequency live-log streams (stdout/stderr/copilot/events/cli,
    /// `.log`/`.jsonl`). Live logs are followed separately via `LogTailer`, so
    /// their continuous writes can never starve the trailing-edge debounce.
    public static func isControlStateMetadata(_ path: String) -> Bool {
        let name = (path as NSString).lastPathComponent
        let lower = name.lowercased()

        // Exclude live log streams explicitly (these are the starvation source).
        if lower.hasSuffix(".log") || lower.hasSuffix(".jsonl") { return false }
        for prefix in ["stdout", "stderr", "copilot", "events", "cli"] where lower.hasPrefix(prefix) {
            return false
        }

        // Admit control/state metadata.
        if lower == "loop.json" || lower == "state.json" || lower == "run.json" { return true }
        if lower.hasPrefix("run") && lower.hasSuffix(".json") { return true } // run-<id>.json
        if lower.hasPrefix("approval") { return true }                        // approval.blocked / .json
        if lower.hasPrefix("manual") { return true }                          // manual trigger markers
        if lower.hasSuffix(".plist") { return true }                          // generated launchd plist

        // Admit task directories (extensionless path components) so task
        // create/remove is observed.
        return (name as NSString).pathExtension.isEmpty
    }

    public func makeLogTailer(
        url: URL,
        startAtEnd: Bool,
        onChunk: @escaping @Sendable (Data) -> Void
    ) -> LogTailer {
        LogTailer(url: url, startAtEnd: startAtEnd, onChunk: onChunk)
    }
}
