import Foundation

enum ScriptDiscoveryError: LocalizedError {
    case notFound
    case invalidConfig(URL)
    case configuredScriptMissing(URL)

    var errorDescription: String? {
        switch self {
        case .notFound:
            return "Cannot find daemon-ctl.sh — run menubar-install.sh"
        case .invalidConfig(let url):
            return "Cannot read \(url.path)"
        case .configuredScriptMissing(let url):
            return "Cannot find daemon-ctl.sh at \(url.path) — run menubar-install.sh"
        }
    }
}

struct ScriptDiscovery {
    struct MenubarConfig: Decodable {
        let scriptDir: String
    }

    var environment: [String: String] = ProcessInfo.processInfo.environment
    var fileManager: FileManager = .default

    func resolveDaemonControlScript() throws -> URL {
        if let scriptDir = environment[Constants.scriptDirEnvironmentKey], !scriptDir.isEmpty {
            return try daemonControlScript(in: URL(fileURLWithPath: scriptDir.expandingTildeInPath, isDirectory: true))
        }

        let configURL = Constants.workspaceURL.appendingPathComponent(Constants.menubarConfigFileName)
        if fileManager.fileExists(atPath: configURL.path) {
            do {
                let data = try Data(contentsOf: configURL)
                let config = try JSONDecoder().decode(MenubarConfig.self, from: data)
                return try daemonControlScript(in: URL(fileURLWithPath: config.scriptDir.expandingTildeInPath, isDirectory: true))
            } catch let error as ScriptDiscoveryError {
                throw error
            } catch {
                throw ScriptDiscoveryError.invalidConfig(configURL)
            }
        }

        throw ScriptDiscoveryError.notFound
    }

    private func daemonControlScript(in scriptDir: URL) throws -> URL {
        let scriptURL = scriptDir.appendingPathComponent(Constants.daemonControlScriptName)
        guard fileManager.fileExists(atPath: scriptURL.path) else {
            throw ScriptDiscoveryError.configuredScriptMissing(scriptURL)
        }
        return scriptURL
    }
}
