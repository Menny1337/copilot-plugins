import CoreServices
import Foundation

public enum RootWatcherError: LocalizedError, Equatable {
    case cannotCreateRoot(path: String, underlying: String)
    case rootNotDirectory(path: String)
    case streamCreationFailed(path: String)

    public var errorDescription: String? {
        switch self {
        case .cannotCreateRoot(let path, let underlying):
            return "Could not create watch root at \(path): \(underlying)"
        case .rootNotDirectory(let path):
            return "Watch root at \(path) exists but is not a directory"
        case .streamCreationFailed(let path):
            return "Failed to create FSEvents stream for \(path)"
        }
    }
}

/// Coalesces bursts of signals into a single trailing-edge invocation. Exposed
/// `flush()` / `cancel()` make the coalescing behaviour deterministically
/// testable without depending on wall-clock timing.
public final class Debouncer: @unchecked Sendable {
    private let interval: TimeInterval
    private let queue: DispatchQueue
    private let action: @Sendable () -> Void
    private let lock = NSLock()
    private var workItem: DispatchWorkItem?

    public init(
        interval: TimeInterval,
        queue: DispatchQueue = DispatchQueue(label: "com.copilotplugins.copilot-loops.debouncer"),
        action: @escaping @Sendable () -> Void
    ) {
        self.interval = interval
        self.queue = queue
        self.action = action
    }

    /// Schedules the action, cancelling any previously pending invocation.
    public func signal() {
        let item = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.lock.lock()
            self.workItem = nil
            self.lock.unlock()
            self.action()
        }
        lock.lock()
        workItem?.cancel()
        workItem = item
        lock.unlock()
        queue.asyncAfter(deadline: .now() + interval, execute: item)
    }

    /// Cancels any pending invocation without firing.
    public func cancel() {
        lock.lock()
        workItem?.cancel()
        workItem = nil
        lock.unlock()
    }

    /// Fires the pending action immediately (if any) and clears it. Returns
    /// whether an invocation was pending.
    @discardableResult
    public func flush() -> Bool {
        lock.lock()
        let pending = workItem
        workItem = nil
        lock.unlock()
        guard let pending else { return false }
        pending.cancel()
        action()
        return true
    }

    public var hasPending: Bool {
        lock.lock()
        defer { lock.unlock() }
        return workItem != nil
    }
}

/// Watches a directory tree via FSEvents and delivers debounced batches of
/// changed paths. The watch root is parameterized so it can point at any state
/// directory (e.g. the loops `tasks/` tree).
public final class RootDirectoryWatcher: @unchecked Sendable {
    private let root: URL
    private let queue: DispatchQueue
    private let handler: @Sendable ([String]) -> Void
    private let latency: CFTimeInterval
    private let pathFilter: @Sendable (String) -> Bool

    private let lock = NSLock()
    private var pendingPaths: Set<String> = []
    private var stream: FSEventStreamRef?
    private var debouncer: Debouncer!

    public init(
        root: URL,
        debounceInterval: TimeInterval = 0.3,
        latency: CFTimeInterval = 0.1,
        queue: DispatchQueue = DispatchQueue(label: "com.copilotplugins.copilot-loops.fsevents"),
        pathFilter: @escaping @Sendable (String) -> Bool = { _ in true },
        handler: @escaping @Sendable ([String]) -> Void
    ) {
        self.root = root
        self.queue = queue
        self.handler = handler
        self.latency = latency
        self.pathFilter = pathFilter

        // Capture self weakly so the watcher owns the debouncer without a cycle;
        // the debouncer drains the accumulated path set on the trailing edge.
        self.debouncer = Debouncer(interval: debounceInterval, queue: queue) { [weak self] in
            self?.drainPending()
        }
    }

    private func drainPending() {
        lock.lock()
        let paths = pendingPaths
        pendingPaths.removeAll(keepingCapacity: true)
        lock.unlock()
        guard !paths.isEmpty else { return }
        handler(Array(paths).sorted())
    }

    /// Accumulates matching changed paths and arms the debouncer. The filter is
    /// applied BEFORE anything is buffered or the debounce is signalled, so a
    /// stream of excluded paths (e.g. continuous stdout/stderr log writes) can
    /// never keep re-arming the trailing-edge debounce and starve delivery of
    /// real control/state changes. Public so callers (and tests) can drive
    /// batching without a live FSEvents stream.
    public func ingest(_ paths: [String]) {
        let matching = paths.filter(pathFilter)
        guard !matching.isEmpty else { return }
        lock.lock()
        pendingPaths.formUnion(matching)
        lock.unlock()
        debouncer.signal()
    }

    /// Immediately delivers any accumulated paths, bypassing the debounce delay.
    public func flush() {
        debouncer.flush()
    }

    public func start() throws {
        lock.lock()
        let alreadyRunning = stream != nil
        lock.unlock()
        guard !alreadyRunning else { return }

        try ensureWatchRoot()

        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )

        let callback: FSEventStreamCallback = { _, info, count, eventPaths, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<RootDirectoryWatcher>.fromOpaque(info).takeUnretainedValue()
            guard count > 0, let paths = unsafeBitCast(eventPaths, to: NSArray.self) as? [String] else {
                return
            }
            watcher.ingest(paths)
        }

        let flags = UInt32(
            kFSEventStreamCreateFlagUseCFTypes
                | kFSEventStreamCreateFlagFileEvents
                | kFSEventStreamCreateFlagNoDefer
        )

        guard let created = FSEventStreamCreate(
            kCFAllocatorDefault,
            callback,
            &context,
            [root.path] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            latency,
            flags
        ) else {
            throw RootWatcherError.streamCreationFailed(path: root.path)
        }

        FSEventStreamSetDispatchQueue(created, queue)
        FSEventStreamStart(created)

        lock.lock()
        stream = created
        lock.unlock()
    }

    /// Ensures the watch root exists as a directory before the stream is created.
    /// A fresh install with no tasks yet would otherwise silently watch a
    /// non-existent path; this surfaces the problem as a thrown error instead.
    private func ensureWatchRoot() throws {
        let fileManager = FileManager.default
        var isDirectory: ObjCBool = false
        if fileManager.fileExists(atPath: root.path, isDirectory: &isDirectory) {
            guard isDirectory.boolValue else {
                throw RootWatcherError.rootNotDirectory(path: root.path)
            }
            return
        }
        do {
            try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        } catch {
            throw RootWatcherError.cannotCreateRoot(
                path: root.path,
                underlying: error.localizedDescription
            )
        }
    }

    public func stop() {
        lock.lock()
        let current = stream
        stream = nil
        lock.unlock()
        debouncer.cancel()
        guard let current else { return }
        FSEventStreamStop(current)
        FSEventStreamInvalidate(current)
        FSEventStreamRelease(current)
    }

    deinit { stop() }
}
