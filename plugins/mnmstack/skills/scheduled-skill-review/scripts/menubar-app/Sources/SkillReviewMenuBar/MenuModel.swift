import Foundation
import SwiftUI

@MainActor
final class MenuModel: ObservableObject {
    @Published private(set) var status = Status()
    @Published private(set) var lastError: String?

    private let statusProvider: StatusProviding
    private let daemonControl: DaemonControlling
    private var timerTask: Task<Void, Never>?
    private var watcher: WorkspaceWatcher?

    init(statusProvider: StatusProviding = ShellStatusProvider(), daemonControl: DaemonControlling = ShellDaemonControl()) {
        self.statusProvider = statusProvider
        self.daemonControl = daemonControl
        startRefreshTimer()
        startWatcher()
        Task { await refresh() }
    }

    /// Static model for offscreen snapshot rendering (no timer, watcher, or
    /// refresh). Used by the `--snapshot` dev mode to render mockups.
    init(snapshotStatus: Status) {
        self.statusProvider = ShellStatusProvider()
        self.daemonControl = ShellDaemonControl()
        self.status = snapshotStatus
    }

    deinit {
        timerTask?.cancel()
        watcher?.stop()
    }

    func refresh() async {
        switch await statusProvider.fetch() {
        case .success(let status):
            self.status = status
            self.lastError = nil
        case .failure(let error):
            self.lastError = error.localizedDescription
        }
    }

    func pause() {
        runAction { try await self.daemonControl.pause() }
    }

    func resume() {
        runAction { try await self.daemonControl.resume() }
    }

    func reconcile() {
        runAction { try await self.daemonControl.reconcile() }
    }

    func runNow() {
        runAction { try await self.daemonControl.runNow() }
    }

    func openLatestDigest() {
        runAction { try await self.daemonControl.openLatestDigest() }
    }

    func openWorkspace() {
        runAction { try await self.daemonControl.openWorkspace() }
    }

    func openPR(_ url: String) {
        runAction { try await self.daemonControl.openPR(url) }
    }

    private func runAction(_ action: @escaping () async throws -> Void) {
        Task {
            do {
                try await action()
            } catch {
                self.lastError = error.localizedDescription
            }
            await refresh()
        }
    }

    private func startRefreshTimer() {
        timerTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(Constants.refreshSeconds * 1_000_000_000))
                guard !Task.isCancelled else { break }
                await self?.refresh()
            }
        }
    }

    private func startWatcher() {
        let watcher = WorkspaceWatcher { [weak self] in
            Task { await self?.refresh() }
        }
        self.watcher = watcher
        watcher.start()
    }
}
