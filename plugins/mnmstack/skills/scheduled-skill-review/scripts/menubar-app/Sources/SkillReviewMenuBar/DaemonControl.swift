import Foundation

enum DaemonControlError: LocalizedError {
    case reviewDidNotStart

    var errorDescription: String? {
        "The review did not start. Another review cycle may already be running."
    }
}

protocol DaemonControlling {
    func pause() async throws
    func resume() async throws
    func reconcile() async throws
    func runNow() async throws
    func reviewUnit(_ name: String) async throws -> String
    func openLatestDigest() async throws
    func openConfig() async throws
    func openWorkspace() async throws
    func openPR(_ url: String) async throws
}

struct ShellDaemonControl: DaemonControlling {
    var discovery = ScriptDiscovery()

    func pause() async throws {
        try await runDaemonCommand("pause")
    }

    func resume() async throws {
        try await runDaemonCommand("resume")
    }

    func reconcile() async throws {
        try await runDaemonCommand("reconcile")
    }

    func runNow() async throws {
        let commandURL = Constants.workspaceURL.appendingPathComponent(Constants.runNowCommandFileName)
        try await open(arguments: ["-a", "Terminal", commandURL.path])
    }

    func reviewUnit(_ name: String) async throws -> String {
        let output = try await runDaemonCommand("review-unit", arguments: [name])
        let summary = String(data: output.stdout, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !summary.isEmpty else { throw DaemonControlError.reviewDidNotStart }
        return summary
    }

    func openLatestDigest() async throws {
        try await open(arguments: [Constants.workspaceURL.appendingPathComponent("latest-digest.md").path])
    }

    func openConfig() async throws {
        try await open(arguments: [Constants.workspaceURL.appendingPathComponent("config.json").path])
    }

    func openWorkspace() async throws {
        try await open(arguments: [Constants.workspaceURL.path])
    }

    func openPR(_ url: String) async throws {
        try await open(arguments: [url])
    }

    @discardableResult
    private func runDaemonCommand(_ subcommand: String, arguments: [String] = []) async throws -> ProcessOutput {
        let scriptURL = try discovery.resolveDaemonControlScript()
        return try await ProcessRunner.runOrThrow(scriptURL, arguments: [subcommand] + arguments)
    }

    private func open(arguments: [String]) async throws {
        _ = try await ProcessRunner.runOrThrow(URL(fileURLWithPath: "/usr/bin/open"), arguments: arguments)
    }
}
