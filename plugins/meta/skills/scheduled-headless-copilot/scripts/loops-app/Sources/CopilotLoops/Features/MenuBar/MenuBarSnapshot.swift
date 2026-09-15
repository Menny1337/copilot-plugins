import Foundation
import LoopsModels

// MARK: - RunNowItem

/// A loop eligible for an immediate manual trigger.
struct RunNowItem: Identifiable, Equatable {
    let id: String
    let name: String
}

// MARK: - MenuAggregateStatus

/// Coarse aggregate health shown in the menu-bar icon and popover header.
enum MenuAggregateStatus: Equatable {
    case running(count: Int)
    case failing
    case idle

    var label: String {
        switch self {
        case .running: return "Running"
        case .failing: return "Failing"
        case .idle:    return "Idle"
        }
    }

    var systemImage: String {
        switch self {
        case .running: return "play.circle.fill"
        case .failing: return "exclamationmark.circle.fill"
        case .idle:    return "circle"
        }
    }
}

// MARK: - MenuBarSnapshot

/// Lightweight projection for the menu-bar popover. Build it from `AppModel`
/// and pass it into `MenuBarPopover`; the popover never touches the wall clock
/// or projection helpers directly.
///
/// **Integrator contract:**
/// ```swift
/// MenuBarPopover(
///     snapshot: appModel.menuBarSnapshot,
///     onPauseAll:  { appModel.pauseAll() },
///     onResumeAll: { appModel.resumeAll() },
///     onRunNow:    { id in appModel.runNow(loopID: id) },
///     onOpenApp:   { NSApp.activate(ignoringOtherApps: true) },
///     onHistory:   { appModel.navigate(to: .section(.history)) },
///     onSettings:  { appModel.navigate(to: .section(.settings)) },
///     onQuit:      { NSApp.terminate(nil) }
/// )
/// ```
struct MenuBarSnapshot: Equatable {
    let aggregateStatus: MenuAggregateStatus
    /// Loops actively running right now.
    let runningCount: Int
    /// Loops whose last run ended in a terminal failure state.
    let failedCount: Int
    /// e.g. "Today 22:00 (in 11h 58m)" — nil when no upcoming fire is known.
    let nextRunDescription: String?
    /// True when every non-archived, non-draft loop is currently paused.
    let allPaused: Bool
    /// True when any loop has lifecycle == .paused.
    let hasResumable: Bool
    /// True when any loop has lifecycle == `.enabled` (and can therefore be paused).
    let hasPausable: Bool
    /// Loops eligible for an immediate run-now trigger.
    let runNowEligible: [RunNowItem]

    static let empty = MenuBarSnapshot(
        aggregateStatus: .idle,
        runningCount: 0,
        failedCount: 0,
        nextRunDescription: nil,
        allPaused: false,
        hasResumable: false,
        hasPausable: false,
        runNowEligible: []
    )

    // MARK: Builder

    /// Derives all display-ready fields from raw model data.
    ///
    /// - Parameters:
    ///   - states: All loop states from the control plane.
    ///   - now:    Reference date for relative-time labels and scheduling lookups.
    ///   - calendar: Calendar for day-boundary checks. Defaults to `.current`.
    static func build(
        from states: [LoopState],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> MenuBarSnapshot {

        let runningCount = states.filter(\.isRunning).count

        let failedStatuses: Set<RunStatus> = [.failed, .launchFailed, .timedOut, .approvalBlocked]
        let failedCount = states.filter { s in
            guard let status = s.lastRun?.status else { return false }
            return !s.isRunning && failedStatuses.contains(status)
        }.count

        // hasPausable: only .enabled loops can be paused; .ready loops do not
        // own schedule slots and cannot be paused by the scheduler or the user.
        let enabledLoops = states.filter { $0.definition.lifecycle == .enabled }
        // hasResumable: only .paused loops can be resumed.
        let pausedLoops  = states.filter { $0.definition.lifecycle == .paused }

        let hasPausable  = !enabledLoops.isEmpty
        let hasResumable = !pausedLoops.isEmpty
        // allPaused: true when there are scheduled loops (enabled or paused) but
        // none are currently .enabled — i.e. all have been paused. Drives the
        // Pause all / Resume all toggle in the popover.
        let allPaused = !pausedLoops.isEmpty && enabledLoops.isEmpty

        // Next run: only .enabled loops with a persisted future nextScheduledAt.
        // Do not invent a fire date from the schedule formula, and do not include
        // .ready or .paused loops which do not own a pending schedule slot.
        let nextRunDesc: String? = states
            .filter { s in
                !s.isRunning && s.definition.lifecycle == .enabled
            }
            .compactMap { s -> Date? in
                guard let str = s.nextScheduledAt,
                      let d = LoopProjection.parseTimestamp(str),
                      d > now else { return nil }
                return d
            }
            .min()
            .map { date in
                let absLabel = DashboardSnapshot.formatShortDate(date, now: now, calendar: calendar)
                let relLabel = LoopProjection.relativeDescription(from: now, to: date)
                return "\(absLabel) (\(relLabel))"
            }

        // Run now is valid for .enabled, .ready, and .paused loops: a manual trigger
        // works even when the scheduler would normally skip the loop. Draft and
        // archived loops, and any loop with approval drift, are excluded.
        let runNowLifecycles: Set<LoopLifecycle> = [.enabled, .ready, .paused]
        let runNowEligible: [RunNowItem] = states
            .filter { s in
                !s.isRunning &&
                runNowLifecycles.contains(s.definition.lifecycle) &&
                !LoopProjection.approvalDrift(for: s)
            }
            .sorted { $0.definition.name < $1.definition.name }
            .map { RunNowItem(id: $0.id, name: $0.definition.name) }

        let aggregateStatus: MenuAggregateStatus
        if runningCount > 0 {
            aggregateStatus = .running(count: runningCount)
        } else if failedCount > 0 {
            aggregateStatus = .failing
        } else {
            aggregateStatus = .idle
        }

        return MenuBarSnapshot(
            aggregateStatus: aggregateStatus,
            runningCount: runningCount,
            failedCount: failedCount,
            nextRunDescription: nextRunDesc,
            allPaused: allPaused,
            hasResumable: hasResumable,
            hasPausable: hasPausable,
            runNowEligible: runNowEligible
        )
    }
}
