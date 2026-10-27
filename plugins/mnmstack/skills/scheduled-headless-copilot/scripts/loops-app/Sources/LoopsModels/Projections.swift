import Foundation

/// Pure, deterministic helpers that project raw contracts into UI-facing values.
///
/// Everything here is intentionally free of global state: callers inject the
/// reference `Date` and `Calendar`, which keeps the logic unit-testable without
/// depending on the wall clock or the machine time zone.
public enum LoopProjection {
    /// Parses an ISO-8601 timestamp, tolerating both fractional-second and
    /// whole-second forms emitted across the control plane.
    public static func parseTimestamp(_ string: String?) -> Date? {
        guard let string, !string.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: string) { return date }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: string)
    }

    /// Formats a `Date` as an ISO-8601 UTC timestamp (whole seconds).
    public static func formatTimestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    /// True when the approved capability fingerprint no longer matches the
    /// current fingerprint reported by the control plane.
    public static func approvalDrift(for state: LoopState) -> Bool {
        guard let current = state.currentFingerprint else { return false }
        guard let approved = state.definition.approval.fingerprint else {
            // No approval recorded yet, but a fingerprint exists: treat as drift
            // only when the loop expects approval (ready/enabled/paused).
            switch state.definition.lifecycle {
            case .ready, .enabled, .paused: return true
            case .draft, .needsReview, .archived: return false
            }
        }
        return approved != current
    }

    /// Computes the next fire `Date` for a schedule at or after `reference`.
    /// Returns `nil` for manual schedules and past `once` schedules.
    public static func nextFireDate(
        for schedule: LoopSchedule,
        after reference: Date,
        calendar: Calendar = .current
    ) -> Date? {
        switch schedule {
        case .manual:
            return nil

        case .once(let scheduledAt, _):
            guard let date = parseTimestamp(scheduledAt) else { return nil }
            return date >= reference ? date : nil

        case .interval(let seconds, _):
            guard seconds > 0 else { return nil }
            return reference.addingTimeInterval(TimeInterval(seconds))

        case .calendar(let hour, let minute, let weekdays, _):
            return nextCalendarFire(
                hour: hour,
                minute: minute,
                weekdays: weekdays,
                after: reference,
                calendar: calendar
            )
        }
    }

    private static func nextCalendarFire(
        hour: Int,
        minute: Int,
        weekdays: [Int],
        after reference: Date,
        calendar: Calendar
    ) -> Date? {
        // Schedule weekdays are 0=Sunday..6=Saturday; Calendar uses 1=Sunday..7=Saturday.
        let allowed = Set(weekdays.map { ($0 % 7) + 1 })
        // Search today plus the next 7 days to cover any weekday set.
        for dayOffset in 0...7 {
            guard
                let dayStart = calendar.date(byAdding: .day, value: dayOffset, to: reference),
                let candidate = calendar.date(
                    bySettingHour: hour,
                    minute: minute,
                    second: 0,
                    of: dayStart
                )
            else { continue }

            if candidate <= reference { continue }
            if !allowed.isEmpty {
                let weekday = calendar.component(.weekday, from: candidate)
                if !allowed.contains(weekday) { continue }
            }
            return candidate
        }
        return nil
    }

    /// Derives a coarse health signal for dashboards and list rows.
    public static func health(for state: LoopState) -> LoopHealth {
        switch state.definition.lifecycle {
        case .archived:
            return .idle
        case .draft, .needsReview:
            return .blocked
        default:
            break
        }

        if approvalDrift(for: state) { return .blocked }
        if state.isRunning { return .ok }
        if state.definition.lifecycle == .paused { return .idle }

        guard let status = state.lastRun?.status else { return .idle }
        switch status {
        case .succeeded:
            return .ok
        case .failed, .timedOut, .launchFailed, .approvalBlocked:
            return .failing
        case .cancelled, .skippedOverlap, .skippedMissed, .skippedPaused:
            return .warning
        case .starting, .running, .stopping:
            return .ok
        }
    }

    /// Human-readable one-line status summary for a loop.
    public static func statusSummary(for state: LoopState, now: Date = Date()) -> String {
        if approvalDrift(for: state) { return "Approval required — configuration changed" }

        switch state.definition.lifecycle {
        case .draft:
            return "Draft"
        case .needsReview:
            return "Needs review"
        case .archived:
            return "Archived"
        case .paused:
            return "Paused"
        case .ready, .enabled:
            break
        }

        if state.isRunning { return "Running" }

        // A ready loop is approved but not enabled, so it does not own a
        // schedule slot yet — never surface a future scheduled run for it.
        if state.definition.lifecycle == .ready {
            return "Ready to enable"
        }

        // Enabled loops report a next run only from the persisted, still-future
        // `nextScheduledAt`. This keeps the projection truthful to observed
        // state — it never synthesizes a fire time from the schedule (the
        // Schedules feature owns that deterministic formula projection).
        if let next = state.nextScheduledAt.flatMap(parseTimestamp), next > now {
            return "Next run \(relativeDescription(from: now, to: next))"
        }

        if case .manual = state.definition.schedule {
            return "Manual"
        }
        return "Idle"
    }

    /// Compact relative description such as "in 2h 5m" or "3m ago".
    public static func relativeDescription(from reference: Date, to target: Date) -> String {
        let seconds = Int(target.timeIntervalSince(reference).rounded())
        let magnitude = abs(seconds)
        let phrase = durationPhrase(seconds: magnitude)
        return seconds >= 0 ? "in \(phrase)" : "\(phrase) ago"
    }

    private static func durationPhrase(seconds: Int) -> String {
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        let remMinutes = minutes % 60
        if hours < 24 {
            return remMinutes == 0 ? "\(hours)h" : "\(hours)h \(remMinutes)m"
        }
        let days = hours / 24
        let remHours = hours % 24
        return remHours == 0 ? "\(days)d" : "\(days)d \(remHours)h"
    }

    /// Total wall-clock duration of a run, when both endpoints are known.
    public static func runDuration(_ run: RunRecord) -> TimeInterval? {
        guard
            let start = parseTimestamp(run.startedAt),
            let end = parseTimestamp(run.endedAt)
        else { return nil }
        return end.timeIntervalSince(start)
    }
}
