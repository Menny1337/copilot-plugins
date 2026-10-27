import Foundation

/// Reads and writes the daemon config through `daemon-ctl.sh`, keeping the app a
/// pure presentation layer over the scripts (no direct config.json writes here).
protocol ConfigControlling {
    func load() async throws -> Config
    /// Persists `config` and returns the resulting effective config (the script
    /// echoes it back with any normalization applied).
    @discardableResult
    func save(_ config: Config) async throws -> Config
}

struct ShellConfigControl: ConfigControlling {
    var discovery = ScriptDiscovery()

    func load() async throws -> Config {
        let scriptURL = try discovery.resolveDaemonControlScript()
        let output = try await ProcessRunner.runOrThrow(scriptURL, arguments: ["config-get"])
        return try JSONDecoder().decode(Config.self, from: output.stdout)
    }

    @discardableResult
    func save(_ config: Config) async throws -> Config {
        let scriptURL = try discovery.resolveDaemonControlScript()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(config)
        let output = try await ProcessRunner.runOrThrow(scriptURL, arguments: ["config-set"], stdin: data)
        return try JSONDecoder().decode(Config.self, from: output.stdout)
    }
}
