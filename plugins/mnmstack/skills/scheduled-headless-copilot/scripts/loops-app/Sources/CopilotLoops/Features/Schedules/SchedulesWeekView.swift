import SwiftUI
import LoopsModels

struct SchedulesWeekView: View {
    let states: [LoopState]
    let referenceDate: Date
    let todayReference: Date
    let calendar: Calendar
    let weekRangeText: String

    let onSelect: (String) -> Void
    let onRunNow: (String) -> Void
    let onTogglePause: (String, Bool) -> Void

    // Project occurrences for the displayed week
    // We limit interval projections so we don't flood the UI
    struct Occurrence: Identifiable {
        var id: String { "\(state.id)-\(date.timeIntervalSince1970)" }
        let date: Date
        let state: LoopState
    }

    private var daysInWeek: [Date] {
        let start = calendar.date(from: calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: referenceDate)) ?? referenceDate
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    private func occurrences(for day: Date) -> [Occurrence] {
        let dayStart = calendar.startOfDay(for: day)
        let nextDay = calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart

        var results: [Occurrence] = []

        for state in states {
            guard state.definition.lifecycle == .enabled || state.definition.lifecycle == .paused || state.isRunning else {
                continue
            }

            switch state.definition.schedule {
            case .manual:
                continue

            case .once(let scheduledAt, _):
                if let d = LoopProjection.parseTimestamp(scheduledAt), d >= dayStart && d < nextDay {
                    results.append(Occurrence(date: d, state: state))
                }

            case .calendar(let hour, let minute, let weekdays, _):
                // Schedule weekdays: 0=Sunday..6=Saturday; Calendar: 1=Sunday..7=Saturday.
                let allowed = Set(weekdays.map { ($0 % 7) + 1 })
                let weekday = calendar.component(.weekday, from: dayStart)
                if allowed.isEmpty || allowed.contains(weekday) {
                    if let d = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: dayStart) {
                        results.append(Occurrence(date: d, state: state))
                    }
                }

            case .interval(_, _):
                // Just put one representation for the day based on nextScheduledAt
                // (Without a baseline, we do not invent an interval sequence)
                if let nextStr = state.nextScheduledAt, let nextD = LoopProjection.parseTimestamp(nextStr) {
                    if nextD >= dayStart && nextD < nextDay {
                        results.append(Occurrence(date: nextD, state: state))
                    }
                }
            }
        }

        return results.sorted { $0.date < $1.date }
    }

    var body: some View {
        VStack(spacing: 0) {
            Text(weekRangeText)
                .font(.headline)
                .padding(.vertical, 12)

            ScrollView {
                VStack(spacing: 20) {
                    ForEach(daysInWeek, id: \.self) { day in
                        let items = occurrences(for: day)
                        let isToday = calendar.isDate(day, inSameDayAs: todayReference)
                        if !items.isEmpty || isToday {
                            DaySection(
                                day: day,
                                isToday: isToday,
                                occurrences: items,
                                onSelect: onSelect,
                                onRunNow: onRunNow,
                                onTogglePause: onTogglePause
                            )
                        }
                    }
                }
                .padding()
            }
        }
    }
}

private struct DaySection: View {
    let day: Date
    let isToday: Bool
    let occurrences: [SchedulesWeekView.Occurrence]

    let onSelect: (String) -> Void
    let onRunNow: (String) -> Void
    let onTogglePause: (String, Bool) -> Void

    private var dateHeader: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMM d"
        return formatter.string(from: day)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(dateHeader)
                    .font(.title3.weight(.medium))
                    .foregroundStyle(isToday ? Color.accentColor : Color.primary)

                if isToday {
                    Text("Today")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.accentColor, in: Capsule())
                }

                Spacer()
            }

            if occurrences.isEmpty {
                Text("No scheduled runs")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 8)
                    .padding(.horizontal, 12)
            } else {
                ForEach(occurrences) { occ in
                    OccurrenceRow(
                        occurrence: occ,
                        onSelect: { onSelect(occ.state.id) },
                        onRunNow: { onRunNow(occ.state.id) },
                        onTogglePause: onTogglePause
                    )
                }
            }
        }
    }
}

private struct OccurrenceRow: View {
    let occurrence: SchedulesWeekView.Occurrence
    let onSelect: () -> Void
    let onRunNow: () -> Void
    let onTogglePause: (String, Bool) -> Void

    @State private var isHovered = false

    private var timeText: String {
        if case .interval(let secs, _) = occurrence.state.definition.schedule {
            return "Every \(secs)s"
        }
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: occurrence.date)
    }

    var body: some View {
        let isPaused = occurrence.state.definition.lifecycle == .paused
        let isRunning = occurrence.state.isRunning
        let canRunNow = [.ready, .enabled, .paused].contains(occurrence.state.definition.lifecycle)
        let canPause = occurrence.state.definition.lifecycle == .enabled
        let canResume = isPaused
        let stateId = occurrence.state.id

        HStack(spacing: 0) {
            Button(action: onSelect) {
                HStack(spacing: 16) {
                    Text(timeText)
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(Color.secondary)
                        .frame(width: 80, alignment: .leading)

                    Image(systemName: isPaused ? "pause.circle.fill" : (isRunning ? "play.circle.fill" : "clock.fill"))
                        .font(.system(size: 16))
                        .foregroundStyle(isPaused ? LoopsPalette.inactive : (isRunning ? LoopsPalette.running : LoopsPalette.success))
                        .accessibilityLabel(isPaused ? "Paused" : (isRunning ? "Running" : "Enabled"))

                    Text(occurrence.state.definition.name)
                        .font(.headline)
                        .foregroundStyle(isPaused ? .secondary : .primary)

                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            HStack(spacing: 8) {
                if canRunNow {
                    Button(action: onRunNow) {
                        Image(systemName: "play.fill")
                            .accessibilityLabel("Run Now")
                    }
                    .buttonStyle(.plain)
                    .padding(6)
                    .background(Color.secondary.opacity(0.1))
                    .clipShape(Circle())
                    .help("Run Now")
                }

                if canPause || canResume {
                    Button(action: {
                        if canPause { onTogglePause(stateId, true) }
                        else if canResume { onTogglePause(stateId, false) }
                    }) {
                        Image(systemName: isPaused ? "play.pause.fill" : "pause.fill")
                            .accessibilityLabel(isPaused ? "Resume" : "Pause")
                    }
                    .buttonStyle(.plain)
                    .padding(6)
                    .background(Color.secondary.opacity(0.1))
                    .clipShape(Circle())
                    .help(isPaused ? "Resume" : "Pause")
                }
            }
            .padding(.trailing, 16)
        }
        .padding(.vertical, 12)
        .padding(.leading, 16)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isHovered ? Color.accentColor : Color.secondary.opacity(0.2), lineWidth: isHovered ? 2 : 1)
        )
        .onHover { isHovered = $0 }
    }
}
