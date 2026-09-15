import Foundation
#if canImport(Darwin)
import Darwin
#endif

/// Incrementally tails a log file, delivering appended bytes as they arrive.
///
/// Handles the full rotation lifecycle: writes/extends stream new bytes;
/// truncation or recreation (a shorter file) resets the read offset; and
/// rename/delete/revoke tears down the stale descriptor and polls until the
/// path is re-created, then resumes following the new inode.
public final class LogTailer: @unchecked Sendable {
    private let url: URL
    private let queue: DispatchQueue
    private let onChunk: @Sendable (Data) -> Void
    private let reopenInterval: TimeInterval

    private let lock = NSLock()
    private var offset: UInt64
    private var lastInode: UInt64?
    private var fileHandle: FileHandle?
    private var source: DispatchSourceFileSystemObject?
    private var reopenTimer: DispatchSourceTimer?

    /// Test-only seam invoked on the tailer queue after the DispatchSource is
    /// armed but before the initial availability read. Lets tests write into the
    /// arm→prime window deterministically. Nil in production.
    public var onArmedForTesting: (@Sendable () -> Void)?

    public init(
        url: URL,
        startAtEnd: Bool = false,
        reopenInterval: TimeInterval = 0.25,
        queue: DispatchQueue = DispatchQueue(label: "com.copilotplugins.copilot-loops.logtailer"),
        onChunk: @escaping @Sendable (Data) -> Void
    ) {
        self.url = url
        self.queue = queue
        self.onChunk = onChunk
        self.reopenInterval = reopenInterval
        self.offset = 0
        if startAtEnd, let opened = Self.openAndStat(url) {
            defer { try? opened.handle.close() }
            self.offset = opened.size
            self.lastInode = opened.inode
        }
    }

    /// Race-safe bootstrap seam: start following from an explicit byte offset and
    /// (optionally) the inode captured alongside it. The intended sequence is
    ///   stat S → read a bounded suffix ending at S → `LogTailer(offset: S, ...)`.
    /// The tailer arms its source first, then emits only bytes appended since S,
    /// so a write landing between the snapshot and the source arm is still
    /// delivered. Inode replacement or truncation resets to 0 as usual.
    public init(
        url: URL,
        startOffset: UInt64,
        inode: UInt64? = nil,
        reopenInterval: TimeInterval = 0.25,
        queue: DispatchQueue = DispatchQueue(label: "com.copilotplugins.copilot-loops.logtailer"),
        onChunk: @escaping @Sendable (Data) -> Void
    ) {
        self.url = url
        self.queue = queue
        self.onChunk = onChunk
        self.reopenInterval = reopenInterval
        self.offset = startOffset
        self.lastInode = inode
    }

    /// A bounded snapshot of a log's tail: the last `≤ maxBytes` bytes ending at
    /// the file's current size, plus that end offset and the inode observed at
    /// stat time. Feed `endOffset`/`inode` into `LogTailer(url:startOffset:inode:)`.
    public struct BoundedSuffix: Sendable, Equatable {
        public let data: Data
        public let endOffset: UInt64
        public let inode: UInt64

        public init(data: Data, endOffset: UInt64, inode: UInt64) {
            self.data = data
            self.endOffset = endOffset
            self.inode = inode
        }
    }

    /// Reads at most `maxBytes` from the end of the file (never an unbounded
    /// initial read), returning the suffix bytes, the end offset `S` (file size),
    /// and the inode. Opens the file first and `fstat`s that exact descriptor so
    /// the size/inode and the bytes read all come from the same inode — an
    /// inode replacement racing this call cannot pair an old size/inode with a
    /// new file. Returns `nil` if the file cannot be opened/stat'd.
    public static func readBoundedSuffix(url: URL, maxBytes: Int) -> BoundedSuffix? {
        guard let opened = openAndStat(url) else { return nil }
        defer { try? opened.handle.close() }
        let size = opened.size
        let cap = UInt64(max(0, maxBytes))
        let readLength = min(cap, size)
        let start = size - readLength

        var data = Data()
        if readLength > 0, (try? opened.handle.seek(toOffset: start)) != nil {
            data = (try? opened.handle.read(upToCount: Int(readLength))) ?? Data()
        }
        return BoundedSuffix(data: data, endOffset: size, inode: opened.inode)
    }

    /// An open descriptor paired with the `fstat` of that exact descriptor.
    private struct OpenedFile {
        let handle: FileHandle
        let size: UInt64
        let inode: UInt64
    }

    /// Opens `url` for reading, then `fstat`s the resulting descriptor so size
    /// and inode describe the very inode the descriptor points at (no
    /// stat-then-open TOCTOU window). Returns `nil` if open or fstat fails.
    private static func openAndStat(_ url: URL) -> OpenedFile? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        var info = stat()
        guard fstat(handle.fileDescriptor, &info) == 0 else {
            try? handle.close()
            return nil
        }
        let size = UInt64(max(0, Int64(info.st_size)))
        let inode = UInt64(info.st_ino)
        return OpenedFile(handle: handle, size: size, inode: inode)
    }

    /// Reads any bytes appended since the last read, transparently resetting when
    /// the file has been replaced by a new inode (rotation) — regardless of
    /// whether the replacement is larger or smaller — or truncated in place.
    /// The size/inode used for those decisions and the bytes read all come from
    /// a single opened descriptor (`fstat`), so an inode replacement racing this
    /// call cannot mis-pair size/inode with a different file. Returns empty
    /// `Data` when there is nothing new.
    @discardableResult
    public func readAvailable() -> Data {
        lock.lock()
        defer { lock.unlock() }

        guard let opened = Self.openAndStat(url) else { return Data() }
        defer { try? opened.handle.close() }

        if let lastInode, lastInode != opened.inode {
            // The path now points at a different inode (delete + recreate,
            // atomic rename-into-place). Always restart from the beginning even
            // when the new file is larger than the old read offset.
            offset = 0
        } else if opened.size < offset {
            // Same inode, but shrank: truncated/rewritten in place.
            offset = 0
        }
        lastInode = opened.inode

        guard opened.size > offset else { return Data() }

        do {
            try opened.handle.seek(toOffset: offset)
        } catch {
            return Data()
        }
        let data = (try? opened.handle.readToEnd()) ?? Data()
        offset += UInt64(data.count)
        return data
    }

    public func start() {
        queue.async { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let running = self.source != nil || self.reopenTimer != nil
            self.lock.unlock()
            guard !running else { return }

            if FileManager.default.fileExists(atPath: self.url.path) {
                self.startFollowing()
            } else {
                self.startReopenPolling()
            }
        }
    }

    public func stop() {
        queue.async { [weak self] in
            self?.teardown()
        }
    }

    private func emitAvailable() {
        let data = readAvailable()
        if !data.isEmpty { onChunk(data) }
    }

    /// Arms the DispatchSource FIRST, then reads already-present bytes. Arming
    /// before the initial read closes the window where a write landing between
    /// the read and the source install would be missed until a later write.
    /// The armed source and the initial read both observe such a write, and the
    /// monotonic offset prevents duplication.
    private func startFollowing() {
        guard setupSource() else {
            startReopenPolling()
            return
        }
        onArmedForTesting?()
        emitAvailable()
    }

    @discardableResult
    private func setupSource() -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            return false
        }
        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: handle.fileDescriptor,
            eventMask: [.write, .extend, .delete, .rename, .revoke],
            queue: queue
        )
        src.setEventHandler { [weak self] in
            guard let self, let source = self.currentSource() else { return }
            let mask = source.data
            if mask.contains(.delete) || mask.contains(.rename) || mask.contains(.revoke) {
                self.handleRotation()
            } else {
                self.emitAvailable()
            }
        }
        // Capture `handle` strongly so it stays alive until the cancel handler
        // runs and closes the fd deterministically. Clearing `fileHandle` before
        // `cancel()` must not drop the last strong reference. No retain cycle:
        // the handle does not reference the source.
        src.setCancelHandler { [handle] in
            try? handle.close()
        }

        lock.lock()
        fileHandle = handle
        source = src
        lock.unlock()

        src.resume()
        return true
    }

    private func currentSource() -> DispatchSourceFileSystemObject? {
        lock.lock()
        defer { lock.unlock() }
        return source
    }

    private func handleRotation() {
        lock.lock()
        let src = source
        source = nil
        fileHandle = nil
        lock.unlock()
        src?.cancel()
        startReopenPolling()
    }

    private func startReopenPolling() {
        lock.lock()
        if reopenTimer != nil {
            lock.unlock()
            return
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        reopenTimer = timer
        lock.unlock()

        timer.schedule(deadline: .now() + reopenInterval, repeating: reopenInterval)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            guard FileManager.default.fileExists(atPath: self.url.path) else { return }
            self.lock.lock()
            let t = self.reopenTimer
            self.reopenTimer = nil
            self.lock.unlock()
            t?.cancel()
            self.startFollowing()
        }
        timer.resume()
    }

    private func teardown() {
        lock.lock()
        let src = source
        let timer = reopenTimer
        source = nil
        reopenTimer = nil
        fileHandle = nil
        lock.unlock()
        src?.cancel()
        timer?.cancel()
    }

    deinit { teardown() }
}
