import Foundation
import LoopsModels

// MARK: - LoopKind display helpers

extension LoopKind {
    /// Short label such as "Copilot Loop" or "Script Loop".
    var kindDisplayName: String {
        switch self {
        case .copilot: return "Copilot Loop"
        case .script: return "Script Loop"
        }
    }

    /// SF Symbol representing the loop kind.
    var kindSystemImage: String {
        switch self {
        case .copilot: return "sparkles"
        case .script: return "terminal"
        }
    }
}

// MARK: - Item types

/// A loop that is actively running right now.
struct RunningLoopItem: Identifiable, Equatable {
    let id: String
    let name: String
    let kind: LoopKind
    /// Pre-formatted elapsed string, e.g. "04:12 elapsed".
    let elapsedLabel: String
    let currentRunID: String?
}

/// A loop scheduled to fire in the near future.
struct UpNextLoopItem: Identifiable, Equatable {
    let id: String
    let name: String
    let kind: LoopKind
    /// e.g. "Copilot Loop · skill-review.yml"
    let subtitle: String
    /// Absolute label, e.g. "Today 22:00" or "Wed 18:00".
    let scheduledDateLabel: String
    /// Relative label, e.g. "in 11h 58m".
    let relativeLabel: String
    let scheduledAt: Date
}

/// A loop that requires the user's attention (failing or blocked).
struct AttentionLoopItem: Identifiable, Equatable {
    let id: String
    let name: String
    let kind: LoopKind
    let subtitle: String
    let lastRunStatus: RunStatus?
    /// Full description, e.g. "Last run failed · Today 09:12".
    let detailLabel: String
}

/// A single run entry for the recent-activity feed.
struct ActivityItem: Identifiable, Equatable {
    let id: String
    let loopId: String
    let loopName: String
    let status: RunStatus
    /// e.g. "Today 01:00"
    let startedLabel: String?
    /// e.g. "04:15" (mm:ss or hh:mm:ss)
    let durationLabel: String?
}

/// A compact summary row for the all-loops section.
struct LoopSummaryItem: Identifiable, Equatable {
    let id: String
    let name: String
    let kind: LoopKind
    let lifecycle: LoopLifecycle
    let health: LoopHealth
    let statusSummary: String
    /// e.g. "Today 22:00" — nil for manual schedules with no pending fire date.
    let nextRunLabel: String?
}

// MARK: - DashboardSnapshot

/// Pure, deterministic projection of `[LoopState]` + `[RunRecord]` into
/// display-ready data. Build once in `AppModel` and pass into `DashboardView`;
/// the view never calls projections or touches the wall clock directly.
///
/// **Integrator contract:**
/// ```swift
/// let snapshot = DashboardSnapshot.build(from: appModel.loops, runs: appModel.recentRuns, now: Date())
/// DashboardView(snapshot: snapshot, onLoopSelected: ..., onNewLoop: ..., onAllLoops: ...)
/// ```
struct DashboardSnapshot: Equatable {
    let runningCount: Int
    let upNextCount: Int
    let needsAttentionCount: Int

    let runningLoops: [RunningLoopItem]
    let upNextLoops: [UpNextLoopItem]
    let needsAttentionLoops: [AttentionLoopItem]
    let recentActivity: [ActivityItem]
    let allLoops: [LoopSummaryItem]

    let totalLoops: Int
    /// Closest upcoming absolute run label, e.g. "Today 22:00". Nil when no
    /// scheduled fires are known.
    let nextRunDescription: String?

    static let empty = DashboardSnapshot(
        runningCount: 0, upNextCount: 0, needsAttentionCount: 0,
        runningLoops: [], upNextLoops: [], needsAttentionLoops: [],
        recentActivity: [], allLoops: [], totalLoops: 0, nextRunDescription: nil
    )

    // MARK: Builder

    /// Derives all display-ready sections from raw model data.
    ///
    /// - Parameters:
    ///   - states: All loop states from the control plane.
    ///   - runs:   Recent run records for the activity feed. Sorting is applied internally.
    ///   - now:    Reference date for relative-time labels and scheduling lookups.
    ///   - calendar: Calendar for day-boundary checks. Defaults to `.current`.
    static func build(
        from states: [LoopState],
        runs: [RunRecord] = [],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> DashboardSnapshot {

        // ── Running now ───────────────────────────────────────────────────────
        // Index the supplied runs by compound key "loopId:runId" so we can find
        // the active run via (loopId, currentRunID). state.lastRun reflects the
        // previous *terminal* run — not the in-progress one — so we cannot use it
        // for elapsed time.
        let runStartMap: [String: String] = Dictionary(
            uniqueKeysWithValues: runs.compactMap { r -> (String, String)? in
                guard let startedAt = r.startedAt else { return nil }
                return ("\(r.loopId):\(r.id)", startedAt)
            }
        )

        let runningLoops: [RunningLoopItem] = states
            .filter(\.isRunning)
            .sorted { $0.definition.name < $1.definition.name }
            .map { s in
                let elapsedLabel: String
                if let currentRunID = s.currentRunID,
                   let startStr = runStartMap["\(s.id):\(currentRunID)"],
                   let start = LoopProjection.parseTimestamp(startStr) {
                    let elapsed = max(0, Int(now.timeIntervalSince(start)))
                    elapsedLabel = "\(formatElapsed(elapsed)) elapsed"
                } else {
                    elapsedLabel = "Elapsed unavailable"
                }
                return RunningLoopItem(
                    id: s.id,
                    name: s.definition.name,
                    kind: s.definition.kind,
                    elapsedLabel: elapsedLabel,
                    currentRunID: s.currentRunID
                )
            }

        // ── Up next ───────────────────────────────────────────────────────────
        let upNextLoops: [UpNextLoopItem] = states
            .filter { s in
                !s.isRunning &&
                s.definition.lifecycle == .enabled &&
                LoopProjection.health(for: s) != .blocked
            }
            .compactMap { s -> UpNextLoopItem? in
                // Only use the persisted nextScheduledAt. Do not derive from the
                // schedule formula: an .enabled loop without a persisted slot has no
                // guaranteed upcoming fire time. Ignore stale dates before now.
                guard let str = s.nextScheduledAt,
                      let next = LoopProjection.parseTimestamp(str),
                      next > now else { return nil }
                let exec = executionLabel(s.definition.execution)
                return UpNextLoopItem(
                    id: s.id,
                    name: s.definition.name,
                    kind: s.definition.kind,
                    subtitle: "\(s.definition.kind.kindDisplayName) · \(exec)",
                    scheduledDateLabel: formatShortDate(next, now: now, calendar: calendar),
                    relativeLabel: LoopProjection.relativeDescription(from: now, to: next),
                    scheduledAt: next
                )
            }
            .sorted { $0.scheduledAt < $1.scheduledAt }

        // ── Needs attention ───────────────────────────────────────────────────
        let needsAttentionLoops: [AttentionLoopItem] = states
            .filter { s in
                let h = LoopProjection.health(for: s)
                return (h == .failing || h == .blocked) && s.definition.lifecycle != .archived
            }
            .sorted { $0.definition.name < $1.definition.name }
            .map { s -> AttentionLoopItem in
                let exec = executionLabel(s.definition.execution)
                let subtitle = "\(s.definition.kind.kindDisplayName) · \(exec)"

                let reason: String
                if LoopProjection.approvalDrift(for: s) {
                    reason = "Approval required"
                } else if s.definition.lifecycle == .needsReview {
                    reason = "Needs review"
                } else if s.definition.lifecycle == .draft {
                    reason = "Draft — not yet enabled"
                } else {
                    switch s.lastRun?.status {
                    case .failed, .launchFailed: reason = "Last run failed"
                    case .timedOut:              reason = "Last run timed out"
                    case .approvalBlocked:       reason = "Approval blocked"
                    default: reason = LoopProjection.statusSummary(for: s, now: now)
                    }
                }

                let timeNote: String?
                if let endStr = s.lastRun?.endedAt,
                   let endDate = LoopProjection.parseTimestamp(endStr) {
                    timeNote = formatShortDate(endDate, now: now, calendar: calendar)
                } else {
                    timeNote = nil
                }

                let detail: String
                if let t = timeNote { detail = "\(reason) · \(t)" }
                else { detail = reason }

                return AttentionLoopItem(
                    id: s.id,
                    name: s.definition.name,
                    kind: s.definition.kind,
                    subtitle: subtitle,
                    lastRunStatus: s.lastRun?.status,
                    detailLabel: detail
                )
            }

        // ── Recent activity ───────────────────────────────────────────────────
        let nameMap = Dictionary(uniqueKeysWithValues: states.map { ($0.id, $0.definition.name) })
        let recentActivity: [ActivityItem] = Array(
            runs
                .sorted { lhs, rhs in
                    let l = LoopProjection.parseTimestamp(lhs.startedAt) ?? .distantPast
                    let r = LoopProjection.parseTimestamp(rhs.startedAt) ?? .distantPast
                    if l != r { return l > r }
                    // Stable tie-breaks: loop name ascending, then run ID descending
                    let lName = nameMap[lhs.loopId] ?? lhs.loopId
                    let rName = nameMap[rhs.loopId] ?? rhs.loopId
                    if lName != rName { return lName < rName }
                    return lhs.id > rhs.id
                }
                .prefix(20)
                .map { run -> ActivityItem in
                    let startDate = LoopProjection.parseTimestamp(run.startedAt)
                    let dur = LoopProjection.runDuration(run)
                    return ActivityItem(
                        // Compound identity: prevents collisions across loops that
                        // could share a run ID and provides stable ForEach diffing.
                        id: "\(run.loopId):\(run.id)",
                        loopId: run.loopId,
                        loopName: nameMap[run.loopId] ?? run.loopId,
                        status: run.status,
                        startedLabel: startDate.map { formatShortDate($0, now: now, calendar: calendar) },
                        durationLabel: dur.map(formatDuration)
                    )
                }
        )

        // ── All loops ─────────────────────────────────────────────────────────
        let allLoops: [LoopSummaryItem] = states
            .sorted { $0.definition.name < $1.definition.name }
            .map { s -> LoopSummaryItem in
                // Show nextRunLabel only for .enabled loops with a persisted future
                // fire date. .ready, .paused, .draft, and .archived loops do not
                // own a schedule slot and must not claim a next run time.
                let nextLabel: String?
                if s.definition.lifecycle == .enabled,
                   let str = s.nextScheduledAt,
                   let d = LoopProjection.parseTimestamp(str),
                   d > now {
                    nextLabel = formatShortDate(d, now: now, calendar: calendar)
                } else {
                    nextLabel = nil
                }
                return LoopSummaryItem(
                    id: s.id,
                    name: s.definition.name,
                    kind: s.definition.kind,
                    lifecycle: s.definition.lifecycle,
                    health: LoopProjection.health(for: s),
                    statusSummary: LoopProjection.statusSummary(for: s, now: now),
                    nextRunLabel: nextLabel
                )
            }

        let nextRunDesc = upNextLoops.first.map { "Next run: \($0.scheduledDateLabel)" }

        return DashboardSnapshot(
            runningCount: runningLoops.count,
            upNextCount: upNextLoops.count,
            needsAttentionCount: needsAttentionLoops.count,
            runningLoops: runningLoops,
            upNextLoops: upNextLoops,
            needsAttentionLoops: needsAttentionLoops,
            recentActivity: recentActivity,
            allLoops: allLoops,
            totalLoops: states.count,
            nextRunDescription: nextRunDesc
        )
    }

    // MARK: Private formatting helpers

    private static func executionLabel(_ execution: LoopExecution) -> String {
        switch execution {
        case .copilot(let c):
            if let s = c.skill { return s }
            if let a = c.agent { return a }
            if let p = c.installedPlugin { return p }
            return c.model
        case .scriptFile(let s):
            return (s.path as NSString).lastPathComponent
        case .executable(let e):
            return (e.path as NSString).lastPathComponent
        }
    }

    private static func formatElapsed(_ seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
        return String(format: "%02d:%02d", m, s)
    }

    private static func formatDuration(_ interval: TimeInterval) -> String {
        let total = max(0, Int(interval.rounded()))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
        return String(format: "%02d:%02d", m, s)
    }

    static func formatShortDate(_ date: Date, now: Date, calendar: Calendar) -> String {
        let tz = calendar.timeZone
        let timeFmt = DateFormatter()
        timeFmt.dateFormat = "HH:mm"
        timeFmt.timeZone = tz
        timeFmt.calendar = calendar
        let timeStr = timeFmt.string(from: date)
        if calendar.isDate(date, inSameDayAs: now) { return "Today \(timeStr)" }
        let diff = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: date)
        ).day ?? 0
        if diff == 1 { return "Tomorrow \(timeStr)" }
        if diff == -1 { return "Yesterday \(timeStr)" }
        let dayFmt = DateFormatter()
        dayFmt.dateFormat = "EEE"
        dayFmt.timeZone = tz
        dayFmt.calendar = calendar
        return "\(dayFmt.string(from: date)) \(timeStr)"
    }
}
