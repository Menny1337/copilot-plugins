import Foundation
import LoopsIdentity

/// On-disk breadcrumb written by the packaged build / installer that records
/// where the stable `loops-ctl.mjs` runtime lives, so the sandboxed app bundle
/// can locate the control plane without hardcoded paths.
public struct RuntimeBreadcrumb: Codable, Equatable, Sendable {
    public var loopsCtlPath: String
    public var nodePath: String?
    public var stateRoot: String?
    public var runtimePath: String?
    public var secretsHelperPath: String?
    public var appPath: String?

    public init(
        loopsCtlPath: String,
        nodePath: String? = nil,
        stateRoot: String? = nil,
        runtimePath: String? = nil,
        secretsHelperPath: String? = nil,
        appPath: String? = nil
    ) {
        self.loopsCtlPath = loopsCtlPath
        self.nodePath = nodePath
        self.stateRoot = stateRoot
        self.runtimePath = runtimePath
        self.secretsHelperPath = secretsHelperPath
        self.appPath = appPath
    }
}

public enum RuntimeResolverError: LocalizedError, Equatable {
    case controlPlaneNotFound(searched: [String])
    case breadcrumbUnreadable(path: String, underlying: String)
    case invalidStateRoot(value: String)
    case invalidControlPath(value: String)
    case invalidNodePath(value: String)

    public var errorDescription: String? {
        switch self {
        case .controlPlaneNotFound(let searched):
            let list = searched.isEmpty ? "(none)" : searched.joined(separator: ", ")
            return "Could not locate loops-ctl.mjs. Searched: \(list)"
        case .breadcrumbUnreadable(let path, let underlying):
            return "Runtime breadcrumb at \(path) is unreadable: \(underlying)"
        case .invalidStateRoot(let value):
            return "State root must be a literal absolute path (no '~' or relative paths); got '\(value)'. Set COPILOT_LOOPS_HOME (or the breadcrumb stateRoot) to an absolute path."
        case .invalidControlPath(let value):
            return "loops-ctl.mjs path must be a literal absolute path (no '~' or relative paths); got '\(value)'."
        case .invalidNodePath(let value):
            return "node path must be a literal absolute path (no '~' or relative paths); got '\(value)'."
        }
    }
}

/// Resolves the runtime location of `loops-ctl.mjs` and the `node` executable.
///
/// Resolution order (first match wins):
///   1. an explicitly injected `loops-ctl.mjs` path,
///   2. the `COPILOT_LOOPS_CTL` environment variable,
///   3. a JSON breadcrumb file (injected URL, else `<stateRoot>/runtime.json`).
///
/// The resolver validates that the resolved script exists on disk.
public struct RuntimeResolver: Sendable {
    public struct Resolution: Equatable, Sendable {
        /// Executable to launch (`node`, or `/usr/bin/env` when using PATH lookup).
        public let executableURL: URL
        /// Argument vector prefix, e.g. `["loops-ctl.mjs"]` or `["node", "loops-ctl.mjs"]`.
        public let argumentPrefix: [String]
        public let stateRoot: URL

        public init(executableURL: URL, argumentPrefix: [String], stateRoot: URL) {
            self.executableURL = executableURL
            self.argumentPrefix = argumentPrefix
            self.stateRoot = stateRoot
        }
    }

    private let explicitControlPath: String?
    private let breadcrumbURL: URL?
    private let environment: [String: String]
    private let fileExists: @Sendable (String) -> Bool

    public init(
        explicitControlPath: String? = nil,
        breadcrumbURL: URL? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileExists: @escaping @Sendable (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }
    ) {
        self.explicitControlPath = explicitControlPath
        self.breadcrumbURL = breadcrumbURL
        self.environment = environment
        self.fileExists = fileExists
    }

    /// Literal absolute path check. launchd does not expand `~`, and Node/the
    /// installer require literal absolute paths, so `~/...` and relative paths
    /// are treated as invalid rather than expanded or resolved against cwd.
    private static func isAbsolute(_ path: String) -> Bool {
        path.hasPrefix("/")
    }

    /// Mirrors `paths.mjs`: `COPILOT_LOOPS_HOME` (when set) or the default under
    /// `~/.copilot`. When the variable is present it must be a literal absolute
    /// path — empty, `~`-prefixed, or relative values fail closed.
    public func stateRoot() throws -> URL {
        do {
            return try LoopsIdentity.stateRoot(environment: environment)
        } catch LoopsIdentityError.invalidStateRoot(let value) {
            throw RuntimeResolverError.invalidStateRoot(value: value)
        } catch LoopsIdentityError.invalidHome(let value) {
            throw RuntimeResolverError.invalidStateRoot(value: value)
        }
    }

    public func identity() throws -> LoopsIdentity {
        try LoopsIdentity.load(environment: environment)
    }

    private func defaultBreadcrumbURL() throws -> URL {
        try stateRoot().appendingPathComponent("runtime.json", isDirectory: false)
    }

    public func loadBreadcrumb() throws -> RuntimeBreadcrumb? {
        let url: URL
        if let breadcrumbURL {
            url = breadcrumbURL
        } else {
            url = try defaultBreadcrumbURL()
        }
        guard fileExists(url.path) else { return nil }
        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode(RuntimeBreadcrumb.self, from: data)
        } catch {
            throw RuntimeResolverError.breadcrumbUnreadable(
                path: url.path,
                underlying: error.localizedDescription
            )
        }
    }

    public func resolve() throws -> Resolution {
        var searched: [String] = []
        let breadcrumb = try loadBreadcrumb()

        let controlPath = try resolveControlPath(breadcrumb: breadcrumb, searched: &searched)
        let (executableURL, argumentPrefix) = try resolveExecutable(
            breadcrumb: breadcrumb,
            controlPath: controlPath
        )

        let root: URL
        if let rootPath = breadcrumb?.stateRoot {
            // A breadcrumb-provided state root must be a literal absolute path.
            // A corrupt relative value surfaces an error rather than silently
            // falling back to cwd or the default location.
            guard Self.isAbsolute(rootPath) else {
                throw RuntimeResolverError.invalidStateRoot(value: rootPath)
            }
            root = URL(fileURLWithPath: rootPath).standardizedFileURL
        } else {
            root = try stateRoot()
        }

        return Resolution(
            executableURL: executableURL,
            argumentPrefix: argumentPrefix,
            stateRoot: root
        )
    }

    private func resolveControlPath(
        breadcrumb: RuntimeBreadcrumb?,
        searched: inout [String]
    ) throws -> String {
        let candidates: [String?] = [
            explicitControlPath,
            environment["COPILOT_LOOPS_CTL"],
            breadcrumb?.loopsCtlPath,
        ]
        for candidate in candidates {
            guard let candidate, !candidate.isEmpty else { continue }
            // A present-but-relative candidate is corrupt configuration: fail
            // closed instead of resolving it against the working directory.
            guard Self.isAbsolute(candidate) else {
                throw RuntimeResolverError.invalidControlPath(value: candidate)
            }
            searched.append(candidate)
            if fileExists(candidate) { return candidate }
        }
        throw RuntimeResolverError.controlPlaneNotFound(searched: searched)
    }

    private func resolveExecutable(
        breadcrumb: RuntimeBreadcrumb?,
        controlPath: String
    ) throws -> (URL, [String]) {
        if let nodePath = environment["COPILOT_LOOPS_NODE"] ?? breadcrumb?.nodePath,
           !nodePath.isEmpty {
            guard Self.isAbsolute(nodePath) else {
                throw RuntimeResolverError.invalidNodePath(value: nodePath)
            }
            if fileExists(nodePath) {
                return (URL(fileURLWithPath: nodePath), [controlPath])
            }
            // Absolute but missing: fall through to PATH lookup below.
        }
        // Fall back to PATH lookup via /usr/bin/env so a login-shell node is found.
        return (URL(fileURLWithPath: "/usr/bin/env"), ["node", controlPath])
    }
}
