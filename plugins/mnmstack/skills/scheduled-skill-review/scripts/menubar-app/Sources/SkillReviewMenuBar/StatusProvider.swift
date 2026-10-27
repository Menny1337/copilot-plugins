import Foundation

protocol StatusProviding {
    func fetch() async -> Result<Status, Error>
}

struct ShellStatusProvider: StatusProviding {
    var discovery = ScriptDiscovery()

    func fetch() async -> Result<Status, Error> {
        do {
            let scriptURL = try discovery.resolveDaemonControlScript()
            let output = try await ProcessRunner.runOrThrow(scriptURL, arguments: ["status"])
            let decoder = JSONDecoder()
            let status = try decoder.decode(Status.self, from: output.stdout)
            return .success(status)
        } catch {
            return .failure(error)
        }
    }
}
