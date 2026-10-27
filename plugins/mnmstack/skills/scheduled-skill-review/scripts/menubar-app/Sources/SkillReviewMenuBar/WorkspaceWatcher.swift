import CoreServices
import Foundation

final class WorkspaceWatcher {
    private let workspaceURL: URL
    private let onChange: @MainActor () -> Void
    private var stream: FSEventStreamRef?
    private let queue = DispatchQueue(label: "com.copilotplugins.skill-review.menubar.fsevents")
    private let debounceQueue = DispatchQueue(label: "com.copilotplugins.skill-review.menubar.debounce")
    private var debounceWorkItem: DispatchWorkItem?

    init(workspaceURL: URL = Constants.workspaceURL, onChange: @escaping @MainActor () -> Void) {
        self.workspaceURL = workspaceURL
        self.onChange = onChange
    }

    deinit {
        stop()
    }

    func start() {
        guard stream == nil, FileManager.default.fileExists(atPath: workspaceURL.path) else { return }

        let callback: FSEventStreamCallback = { _, info, eventCount, eventPaths, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<WorkspaceWatcher>.fromOpaque(info).takeUnretainedValue()
            let paths = unsafeBitCast(eventPaths, to: NSArray.self) as? [String] ?? []
            watcher.handle(paths: Array(paths.prefix(eventCount)))
        }

        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )

        guard let createdStream = FSEventStreamCreate(
            kCFAllocatorDefault,
            callback,
            &context,
            [workspaceURL.path] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.1,
            UInt32(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes)
        ) else { return }

        stream = createdStream
        FSEventStreamSetDispatchQueue(createdStream, queue)
        FSEventStreamStart(createdStream)
    }

    func stop() {
        debounceWorkItem?.cancel()
        debounceWorkItem = nil
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    private func handle(paths: [String]) {
        let relevant = paths.contains { path in
            Constants.watchedFileNames.contains(URL(fileURLWithPath: path).lastPathComponent)
        }
        guard relevant else { return }

        debounceWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            DispatchQueue.main.async {
                self.onChange()
            }
        }
        debounceWorkItem = workItem
        debounceQueue.asyncAfter(deadline: .now() + Constants.debounceSeconds, execute: workItem)
    }
}
