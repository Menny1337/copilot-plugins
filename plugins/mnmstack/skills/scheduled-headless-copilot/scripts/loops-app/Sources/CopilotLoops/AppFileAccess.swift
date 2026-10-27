import Darwin
import Foundation

enum AppFileAccessError: LocalizedError {
    case pathOutsideRoot(String)
    case missingFile(String)
    case unreadableFile(String)

    var errorDescription: String? {
        switch self {
        case .pathOutsideRoot(let path):
            return "Refusing to open a path outside its managed root: \(path)"
        case .missingFile(let path):
            return "File does not exist: \(path)"
        case .unreadableFile(let path):
            return "File is not readable: \(path)"
        }
    }
}

enum AppFileAccess {
    struct BoundedSnapshot {
        var text: String
        var endOffset: UInt64
        var inode: UInt64
    }

    static func validatedURL(path: String, inside root: URL, mustExist: Bool = true) throws -> URL {
        guard path.hasPrefix("/") else {
            throw AppFileAccessError.pathOutsideRoot(path)
        }

        let resolvedRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let resolvedURL = URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath()
        let rootPrefix = resolvedRoot.path.hasSuffix("/") ? resolvedRoot.path : resolvedRoot.path + "/"
        guard resolvedURL.path == resolvedRoot.path || resolvedURL.path.hasPrefix(rootPrefix) else {
            throw AppFileAccessError.pathOutsideRoot(path)
        }
        if mustExist, !FileManager.default.fileExists(atPath: resolvedURL.path) {
            throw AppFileAccessError.missingFile(resolvedURL.path)
        }
        return resolvedURL
    }

    static func changedFileURL(reference: String, workingDirectory: String) throws -> URL {
        guard workingDirectory.hasPrefix("/") else {
            throw AppFileAccessError.pathOutsideRoot(workingDirectory)
        }
        let root = URL(fileURLWithPath: workingDirectory, isDirectory: true)
        let candidate = reference.hasPrefix("/")
            ? reference
            : root.appendingPathComponent(reference, isDirectory: false).path
        return try validatedURL(path: candidate, inside: root)
    }

    static func readBoundedTail(path: String, inside root: URL, maxBytes: Int) throws -> String {
        try readBoundedSnapshot(path: path, inside: root, maxBytes: maxBytes).text
    }

    static func readBoundedSnapshot(
        path: String,
        inside root: URL,
        maxBytes: Int
    ) throws -> BoundedSnapshot {
        let url = try validatedURL(path: path, inside: root)
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isReadableKey])
        guard values.isRegularFile == true, values.isReadable != false else {
            throw AppFileAccessError.unreadableFile(url.path)
        }

        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var fileStat = stat()
        guard fstat(handle.fileDescriptor, &fileStat) == 0, fileStat.st_size >= 0 else {
            throw AppFileAccessError.unreadableFile(url.path)
        }

        let byteLimit = UInt64(max(1, maxBytes))
        let endOffset = UInt64(fileStat.st_size)
        let start = endOffset > byteLimit ? endOffset - byteLimit : 0
        try handle.seek(toOffset: UInt64(start))
        var data = try handle.read(upToCount: Int(endOffset - start)) ?? Data()

        if start > 0, let newline = data.firstIndex(of: 0x0A) {
            data.removeSubrange(data.startIndex...newline)
        }
        return BoundedSnapshot(
            text: String(decoding: data, as: UTF8.self),
            endOffset: endOffset,
            inode: UInt64(fileStat.st_ino)
        )
    }
}
