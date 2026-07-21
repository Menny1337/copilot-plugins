import Foundation

protocol DaemonControlling {
    func pause() async throws
    func resume() async throws
    func reconcile() async throws
    func runNow() async throws
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

    private func runDaemonCommand(_ subcommand: String) async throws {
        let scriptURL = try discovery.resolveDaemonControlScript()
        _ = try await ProcessRunner.runOrThrow(scriptURL, arguments: [subcommand])
    }

    private func open(arguments: [String]) async throws {
        _ = try await ProcessRunner.runOrThrow(URL(fileURLWithPath: "/usr/bin/open"), arguments: arguments)
    }
}
