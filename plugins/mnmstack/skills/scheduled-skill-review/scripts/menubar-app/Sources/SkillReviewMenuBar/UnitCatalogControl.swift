import Foundation

protocol UnitCatalogControlling {
    func load() async throws -> [ReviewUnit]
}

struct ShellUnitCatalogControl: UnitCatalogControlling {
    var discovery = ScriptDiscovery()

    func load() async throws -> [ReviewUnit] {
        let scriptURL = try discovery.resolveDaemonControlScript()
        let output = try await ProcessRunner.runOrThrow(scriptURL, arguments: ["unit-catalog"])
        return try JSONDecoder().decode(ReviewUnitCatalog.self, from: output.stdout).units
    }
}
