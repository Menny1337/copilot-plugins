import Foundation
import UserNotifications
import LoopsModels

public protocol NotificationCenterProtocol: Sendable {
    func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool
    func notificationSettings() async -> UNNotificationSettings
    func add(_ request: UNNotificationRequest) async throws
}

extension UNUserNotificationCenter: NotificationCenterProtocol {}

public protocol NotificationServiceProtocol: Sendable {
    func requestAuthorization() async throws -> UNAuthorizationStatus
    func checkAuthorization() async -> UNAuthorizationStatus
    func process(run: RunRecord, loop: LoopDefinition, settings: AppSettings) async
    func prime(with loops: [LoopState], runs: [RunRecord]) async -> Bool
    func getRecentError() async -> String?
}

public actor NotificationService: NotificationServiceProtocol {
    private let center: NotificationCenterProtocol
    private let defaults: UserDefaults
    private let dedupeKey = "CopilotLoopsNotificationDedupe"
    private let primedKey = "CopilotLoopsNotificationsPrimed"
    private let maxDedupeEntries = 500
    private var lastError: String?

    public init(center: NotificationCenterProtocol = UNUserNotificationCenter.current(), defaults: UserDefaults = .standard) {
        self.center = center
        self.defaults = defaults
    }

    public func prime(with loops: [LoopState], runs: [RunRecord]) async -> Bool {
        guard !defaults.bool(forKey: primedKey) else { return false }

        var recent = defaults.stringArray(forKey: dedupeKey) ?? []
        for run in runs where isTerminal(status: run.status) {
            let entry = "\(run.loopId)-\(run.id)-\(run.status.rawValue)"
            if !recent.contains(entry) {
                recent.append(entry)
            }
        }
        for state in loops {
            if let run = state.lastRun, isTerminal(status: run.status) {
                let entry = "\(state.definition.id)-\(run.id)-\(run.status.rawValue)"
                if !recent.contains(entry) {
                    recent.append(entry)
                }
            }
        }

        if recent.count > maxDedupeEntries {
            recent.removeFirst(recent.count - maxDedupeEntries)
        }

        defaults.set(recent, forKey: dedupeKey)
        defaults.set(true, forKey: primedKey)
        return true
    }

    public func requestAuthorization() async throws -> UNAuthorizationStatus {
        do {
            _ = try await center.requestAuthorization(options: [.alert, .sound])
            let status = await checkAuthorization()
            return status
        } catch {
            lastError = error.localizedDescription
            throw error
        }
    }

    public func checkAuthorization() async -> UNAuthorizationStatus {
        let settings = await center.notificationSettings()
        let status = settings.authorizationStatus
        if status == .authorized || status == .provisional {
            lastError = nil
        } else if status == .denied {
            lastError = "Notifications are disabled in System Settings"
        }
        return status
    }

    public func getRecentError() async -> String? {
        return lastError
    }

    public func process(run: RunRecord, loop: LoopDefinition, settings: AppSettings) async {
        guard isTerminal(status: run.status) else { return }
        guard shouldNotify(for: run.status, loop: loop) else { return }

        let dedupeEntry = "\(loop.id)-\(run.id)-\(run.status.rawValue)"
        var recent = defaults.stringArray(forKey: dedupeKey) ?? []

        if recent.contains(dedupeEntry) {
            return
        }

        recent.append(dedupeEntry)
        if recent.count > maxDedupeEntries {
            recent.removeFirst(recent.count - maxDedupeEntries)
        }
        defaults.set(recent, forKey: dedupeKey)

        let isPrimed = defaults.bool(forKey: primedKey)
        if isPrimed && settings.notificationsEnabled {
            do {
                try await deliver(run: run, loop: loop)
                lastError = nil
            } catch {
                lastError = error.localizedDescription
            }
        }
    }

    private func isTerminal(status: RunStatus) -> Bool {
        switch status {
        case .succeeded, .failed, .timedOut, .cancelled, .skippedOverlap, .skippedMissed, .skippedPaused, .approvalBlocked, .launchFailed:
            return true
        case .starting, .running, .stopping:
            return false
        }
    }

    private func shouldNotify(for status: RunStatus, loop: LoopDefinition) -> Bool {
        switch status {
        case .failed, .timedOut, .launchFailed, .approvalBlocked, .skippedMissed, .skippedOverlap:
            return loop.notifications.onFailure
        case .succeeded:
            return loop.notifications.onSuccess
        case .cancelled, .skippedPaused:
            return false
        default:
            return false
        }
    }

    private func deliver(run: RunRecord, loop: LoopDefinition) async throws {
        let content = UNMutableNotificationContent()
        content.title = loop.name.isEmpty ? "Copilot Loop" : loop.name

        switch run.status {
        case .failed:
            content.body = "Run failed"
        case .timedOut:
            content.body = "Run timed out"
        case .launchFailed:
            content.body = "Failed to launch"
        case .approvalBlocked:
            content.body = "Blocked pending approval"
        case .skippedMissed:
            content.body = "Missed schedule"
        case .skippedOverlap:
            content.body = "Skipped due to overlap"
        case .succeeded:
            content.body = "Run succeeded"
        default:
            content.body = "Status: \(run.status.rawValue)"
        }

        let request = UNNotificationRequest(
            identifier: "loop-\(loop.id)-run-\(run.id)",
            content: content,
            trigger: nil
        )

        try await center.add(request)
    }
}
