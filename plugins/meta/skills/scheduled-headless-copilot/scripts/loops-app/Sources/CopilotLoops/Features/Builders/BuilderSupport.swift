import AppKit
import CryptoKit
import Foundation

// MARK: - Hashing

/// Deterministic SHA-256 hasher used for script content + executable identity.
/// Isolated as a plain namespace with a `@MainActor`-independent async entry
/// point so previews and tests can inject the same helper the AppModel uses.
enum BuilderHasher {

    /// Chunk size used while streaming a file into `SHA256`. 1 MiB keeps
    /// hashing memory-bounded even for multi-hundred-megabyte executables.
    static let chunkSize = 1 * 1024 * 1024

    /// Hash the file at `path`. Returns problems (`missing`, `unreadable`,
    /// `notExecutable`, `missingShebang`) that must be surfaced next to the
    /// picker and repeated on the review step.
    ///
    /// The `expectShebang` flag differentiates script files (shebang required)
    /// from raw executables (shebang optional).
    static func hash(path: String, expectShebang: Bool) async -> BuilderHashResult {
        await Task.detached(priority: .userInitiated) { () -> BuilderHashResult in
            var problems: [BuilderHashProblem] = []
            let manager = FileManager.default
            var isDirectory: ObjCBool = false
            guard manager.fileExists(atPath: path, isDirectory: &isDirectory), !isDirectory.boolValue else {
                return BuilderHashResult(path: path, hash: "", problems: [.missing])
            }

            let url = URL(fileURLWithPath: path)

            if let attributes = try? manager.attributesOfItem(atPath: path),
               let permissions = attributes[.posixPermissions] as? NSNumber {
                // 0o111 = any-execute bit.
                if (permissions.uint16Value & 0o111) == 0 {
                    problems.append(.notExecutable)
                }
            }

            // Peek the first two bytes for the shebang check *before* the
            // streaming digest, so we can bail early on unreadable files.
            let handle: FileHandle
            do {
                handle = try FileHandle(forReadingFrom: url)
            } catch {
                return BuilderHashResult(
                    path: path,
                    hash: "",
                    problems: [.unreadable(reason: error.localizedDescription)]
                )
            }
            defer { try? handle.close() }

            if expectShebang {
                do {
                    let prefix = try handle.read(upToCount: 2) ?? Data()
                    if prefix.count < 2
                        || prefix[prefix.startIndex] != 0x23 /* # */
                        || prefix[prefix.index(after: prefix.startIndex)] != 0x21 /* ! */ {
                        problems.append(.missingShebang)
                    }
                    try handle.seek(toOffset: 0)
                } catch {
                    return BuilderHashResult(
                        path: path,
                        hash: "",
                        problems: [.unreadable(reason: error.localizedDescription)]
                    )
                }
            }

            // Stream chunks into the digest to keep peak memory bounded.
            var digest = SHA256()
            do {
                while true {
                    let chunk = try handle.read(upToCount: BuilderHasher.chunkSize) ?? Data()
                    if chunk.isEmpty { break }
                    digest.update(data: chunk)
                }
            } catch {
                return BuilderHashResult(
                    path: path,
                    hash: "",
                    problems: [.unreadable(reason: error.localizedDescription)]
                )
            }

            let hexed = digest.finalize().map { String(format: "%02x", $0) }.joined()
            return BuilderHashResult(path: path, hash: hexed, problems: problems)
        }.value
    }
}

// MARK: - NSOpenPanel wrapper

/// Panel presentation wrapped as an `async` call so callers can drive it from
/// a task. Runs on the main actor because `NSOpenPanel` is a UI object.
@MainActor
enum BuilderPathPicker {
    static func pickPath(_ request: BuilderPickerRequest) async -> String? {
        let panel = NSOpenPanel()
        panel.title = request.title
        panel.prompt = "Choose"
        panel.allowsMultipleSelection = false
        panel.canChooseFiles = request.kind == .file
        panel.canChooseDirectories = request.kind == .directory
        panel.canCreateDirectories = false
        panel.resolvesAliases = true
        panel.treatsFilePackagesAsDirectories = false
        if let initial = request.initialDirectory, !initial.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: initial, isDirectory: request.kind == .directory)
        }
        let response = panel.runModal()
        guard response == .OK, let url = panel.url else { return nil }
        return url.path
    }
}
