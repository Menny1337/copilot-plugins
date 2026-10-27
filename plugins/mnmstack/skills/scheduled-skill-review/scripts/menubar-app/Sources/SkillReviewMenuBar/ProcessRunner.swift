import Foundation

struct ProcessOutput: Sendable {
    let stdout: Data
    let stderr: Data
    let exitCode: Int32

    var stderrText: String {
        String(data: stderr, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
}

enum ProcessRunnerError: LocalizedError {
    case nonZeroExit(executable: String, arguments: [String], code: Int32, stderr: String)

    var errorDescription: String? {
        switch self {
        case .nonZeroExit(let executable, let arguments, let code, let stderr):
            let command = ([executable] + arguments).joined(separator: " ")
            return stderr.isEmpty ? "\(command) exited \(code)" : "\(command) exited \(code): \(stderr)"
        }
    }
}

struct ProcessRunner {
    static func environment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let inherited = env["PATH"] ?? ""
        env["PATH"] = inherited.isEmpty ? Constants.mandatoryPath : Constants.mandatoryPath + ":" + inherited
        return env
    }

    static func run(_ executableURL: URL, arguments: [String], stdin: Data? = nil) async throws -> ProcessOutput {
        try await Task.detached(priority: .utility) {
            let process = Process()
            process.executableURL = executableURL
            process.arguments = arguments
            process.environment = environment()

            let stdout = Pipe()
            let stderr = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr

            let stdinPipe = Pipe()
            if stdin != nil {
                process.standardInput = stdinPipe
            }

            try process.run()

            if let stdin {
                let handle = stdinPipe.fileHandleForWriting
                handle.write(stdin)
                try? handle.close()
            }

            process.waitUntilExit()

            let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
            let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
            return ProcessOutput(stdout: stdoutData, stderr: stderrData, exitCode: process.terminationStatus)
        }.value
    }

    static func runOrThrow(_ executableURL: URL, arguments: [String], stdin: Data? = nil) async throws -> ProcessOutput {
        let output = try await run(executableURL, arguments: arguments, stdin: stdin)
        guard output.exitCode == 0 else {
            throw ProcessRunnerError.nonZeroExit(
                executable: executableURL.path,
                arguments: arguments,
                code: output.exitCode,
                stderr: output.stderrText
            )
        }
        return output
    }
}
