import Foundation

/// Client for the sandbox-signed `CopilotLoopsSecrets` keychain helper. Secret
/// values are delivered on stdin only — never as process arguments — and never
/// appear in thrown error text.
public protocol SecretsClient: Sendable {
    /// Stores `value` for `loopID`/`name`. The bytes are written to the helper's
    /// stdin and are never placed in argv or surfaced in errors.
    func set(loopID: String, name: String, value: Data) async throws

    /// Returns whether a secret exists for `loopID`/`name`.
    func exists(loopID: String, name: String) async throws -> Bool

    /// Deletes the secret for `loopID`/`name` (no-op if absent).
    func delete(loopID: String, name: String) async throws
}

public enum SecretsClientError: LocalizedError, Equatable {
    case invalidAccount(loopID: String, name: String)
    case helperNotFound(searched: [String])
    case helperFailed(command: String, exitCode: Int32, detail: String)
    case timedOut(command: String, seconds: Int)
    case launchFailed(command: String, detail: String)

    public var errorDescription: String? {
        switch self {
        case .invalidAccount(let loopID, let name):
            return "Invalid secret account: loop id '\(loopID)' and name '\(name)' must form loop-id:ENV_NAME"
        case .helperNotFound(let searched):
            let list = searched.isEmpty ? "(none)" : searched.joined(separator: ", ")
            return "Could not locate CopilotLoopsSecrets helper. Searched: \(list)"
        case .helperFailed(let command, let exitCode, let detail):
            return detail.isEmpty
                ? "Secrets helper '\(command)' failed with exit \(exitCode)"
                : "Secrets helper '\(command)' failed with exit \(exitCode): \(detail)"
        case .timedOut(let command, let seconds):
            return "Secrets helper '\(command)' timed out after \(seconds)s"
        case .launchFailed(let command, let detail):
            return "Could not launch secrets helper '\(command)': \(detail)"
        }
    }
}

/// Production `SecretsClient` that shells out to the signed keychain helper.
public struct KeychainSecretsClient: SecretsClient {
    // Matches the helper's own account validation exactly.
    private static let accountPattern =
        #"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?:[A-Za-z_][A-Za-z0-9_]*$"#

    private let explicitHelperPath: String?
    private let breadcrumbHelperPath: String?
    private let bundleHelperURL: URL?
    private let environment: [String: String]
    private let timeout: TimeInterval
    private let fileExists: @Sendable (String) -> Bool

    public init(
        explicitHelperPath: String? = nil,
        breadcrumb: RuntimeBreadcrumb? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        bundleHelperURL: URL? = KeychainSecretsClient.defaultBundleHelperURL(),
        timeout: TimeInterval = 15,
        fileExists: @escaping @Sendable (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }
    ) {
        self.explicitHelperPath = explicitHelperPath
        self.breadcrumbHelperPath = breadcrumb?.secretsHelperPath
        self.bundleHelperURL = bundleHelperURL
        self.environment = environment
        self.timeout = timeout
        self.fileExists = fileExists
    }

    /// `<bundle>/Contents/Helpers/CopilotLoopsSecrets` relative to the running
    /// bundle (the `.app` in production).
    public static func defaultBundleHelperURL() -> URL? {
        Bundle.main.bundleURL
            .appendingPathComponent("Contents/Helpers/CopilotLoopsSecrets", isDirectory: false)
    }

    private func homeApplicationsHelperPath() -> String {
        let home = environment["HOME"] ?? NSHomeDirectory()
        return home + "/Applications/CopilotLoops.app/Contents/Helpers/CopilotLoopsSecrets"
    }

    /// Resolution order: breadcrumb path, current bundle Helpers, then
    /// `~/Applications/CopilotLoops.app/...`. An injected explicit path (tests)
    /// takes precedence over all. Relative candidates are rejected — never
    /// resolved against the process working directory.
    public func resolveHelper() throws -> URL {
        var searched: [String] = []
        let candidates: [String?] = [
            explicitHelperPath,
            breadcrumbHelperPath,
            bundleHelperURL?.path,
            homeApplicationsHelperPath(),
        ]
        for candidate in candidates {
            guard let candidate, !candidate.isEmpty else { continue }
            // Refuse relative paths: Process would resolve them against cwd,
            // which is unstable for a launched .app and a security hazard.
            guard candidate.hasPrefix("/") else {
                searched.append("(rejected relative) \(candidate)")
                continue
            }
            searched.append(candidate)
            if fileExists(candidate) { return URL(fileURLWithPath: candidate) }
        }
        throw SecretsClientError.helperNotFound(searched: searched)
    }

    static func account(loopID: String, name: String) throws -> String {
        let account = "\(loopID):\(name)"
        guard account.range(of: accountPattern, options: .regularExpression) != nil else {
            throw SecretsClientError.invalidAccount(loopID: loopID, name: name)
        }
        return account
    }

    // MARK: SecretsClient

    public func set(loopID: String, name: String, value: Data) async throws {
        let account = try Self.account(loopID: loopID, name: name)
        _ = try await runHelper(command: "set", account: account, stdin: value)
    }

    public func exists(loopID: String, name: String) async throws -> Bool {
        let account = try Self.account(loopID: loopID, name: name)
        let output = try await runHelper(command: "exists", account: account, stdin: nil)
        let text = String(data: output.stdout, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text == "true"
    }

    public func delete(loopID: String, name: String) async throws {
        let account = try Self.account(loopID: loopID, name: name)
        _ = try await runHelper(command: "delete", account: account, stdin: nil)
    }

    private func runHelper(command: String, account: String, stdin: Data?) async throws -> ProcessOutput {
        let helper = try resolveHelper()
        // Direct argv only: <command> <loop-id:ENV_NAME>. The secret value, when
        // present, is passed exclusively via stdin.
        let output: ProcessOutput
        do {
            output = try await ProcessRunner.run(
                helper,
                arguments: [command, account],
                environment: environment,
                stdin: stdin,
                timeout: timeout
            )
        } catch let error as ProcessRunnerError {
            switch error {
            case .timedOut:
                throw SecretsClientError.timedOut(command: command, seconds: Int(timeout))
            case .nonZeroExit(_, _, let code, let detail):
                throw SecretsClientError.helperFailed(command: command, exitCode: code, detail: detail)
            }
        } catch {
            throw SecretsClientError.launchFailed(command: command, detail: error.localizedDescription)
        }

        guard output.exitCode == 0 else {
            // stderr never contains the secret value (never written to argv/stdout
            // by the helper), so it is safe to surface as sanitized detail.
            throw SecretsClientError.helperFailed(
                command: command,
                exitCode: output.exitCode,
                detail: output.stderrText
            )
        }
        return output
    }
}
