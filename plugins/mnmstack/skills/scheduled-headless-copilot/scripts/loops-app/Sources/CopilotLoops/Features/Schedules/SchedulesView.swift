import SwiftUI
import LoopsModels

public struct SchedulesView: View {
    public let states: [LoopState]
    public let referenceDate: Date
    public let calendar: Calendar

    public let onSelect: (String) -> Void
    public let onNewLoop: () -> Void
    public let onRunNow: (String) -> Void
    public let onTogglePause: (String, Bool) -> Void

    @State private var isListView: Bool = false
    @State private var weekOffset: Int = 0

    public init(
        states: [LoopState],
        referenceDate: Date = Date(),
        calendar: Calendar = .current,
        onSelect: @escaping (String) -> Void,
        onNewLoop: @escaping () -> Void,
        onRunNow: @escaping (String) -> Void,
        onTogglePause: @escaping (String, Bool) -> Void
    ) {
        self.states = states
        self.referenceDate = referenceDate
        self.calendar = calendar
        self.onSelect = onSelect
        self.onNewLoop = onNewLoop
        self.onRunNow = onRunNow
        self.onTogglePause = onTogglePause
    }

    private var displayedDate: Date {
        calendar.date(byAdding: .weekOfYear, value: weekOffset, to: referenceDate) ?? referenceDate
    }

    private var weekRangeText: String {
        let start = calendar.date(from: calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: displayedDate)) ?? displayedDate
        let end = calendar.date(byAdding: .day, value: 6, to: start) ?? displayedDate

        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none

        return "\(formatter.string(from: start)) - \(formatter.string(from: end))"
    }

    public var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Schedules")
                        .font(.title.weight(.semibold))
                    HStack(spacing: 6) {
                        Image(systemName: "globe")
                        Text("Local time")
                            .fontWeight(.medium)
                        Text("(\(calendar.timeZone.identifier)) — macOS owns DST behavior.")
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }

                Spacer()

                if !isListView {
                    HStack(spacing: 0) {
                        Button(action: { weekOffset -= 1 }) {
                            Image(systemName: "chevron.left")
                                .padding(6)
                        }
                        .buttonStyle(.plain)

                        Button(action: { weekOffset = 0 }) {
                            Text("Today")
                                .font(.subheadline)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)

                        Button(action: { weekOffset += 1 }) {
                            Image(systemName: "chevron.right")
                                .padding(6)
                        }
                        .buttonStyle(.plain)
                    }
                    .background(Color.secondary.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .padding(.trailing, 8)
                }

                Picker("View", selection: $isListView) {
                    Image(systemName: "calendar").tag(false)
                    Image(systemName: "list.bullet").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 100)

                Button(action: onNewLoop) {
                    Image(systemName: "plus")
                        .accessibilityLabel("New Loop")
                }
                .buttonStyle(.borderedProminent)
                .padding(.leading, 8)
            }
            .padding()

            Divider()

            if states.isEmpty {
                LoopsEmptyState(
                    title: "No Loops Scheduled",
                    message: "Create a new loop from the library or customize a blank script/copilot loop.",
                    systemImage: "calendar.badge.plus"
                )
            } else {
                if isListView {
                    SchedulesListView(
                        states: states,
                        referenceDate: referenceDate,
                        calendar: calendar,
                        onSelect: onSelect,
                        onRunNow: onRunNow,
                        onTogglePause: onTogglePause
                    )
                } else {
                    SchedulesWeekView(
                        states: states,
                        referenceDate: displayedDate,
                        todayReference: referenceDate,
                        calendar: calendar,
                        weekRangeText: weekRangeText,
                        onSelect: onSelect,
                        onRunNow: onRunNow,
                        onTogglePause: onTogglePause
                    )
                }
            }
        }
        .background(Color(nsColor: .underPageBackgroundColor))
    }
}

struct NextRunView: View {
    let next: Date
    var body: some View {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short

        return VStack(alignment: .trailing, spacing: 2) {
            Text("Next Run")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(formatter.string(from: next))
                .font(.subheadline.weight(.medium))
        }
        .padding(.trailing, 16)
    }
}

// MARK: - List View

struct SchedulesListView: View {
    let states: [LoopState]
    let referenceDate: Date
    let calendar: Calendar
    let onSelect: (String) -> Void
    let onRunNow: (String) -> Void
    let onTogglePause: (String, Bool) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(states) { state in
                    ScheduleListRow(
                        state: state,
                        referenceDate: referenceDate,
                        calendar: calendar,
                        onSelect: { onSelect(state.id) },
                        onRunNow: { onRunNow(state.id) },
                        onTogglePause: onTogglePause
                    )
                }
            }
            .padding()
        }
    }
}

struct ScheduleListRow: View {
    let state: LoopState
    let referenceDate: Date
    let calendar: Calendar
    let onSelect: () -> Void
    let onRunNow: () -> Void
    let onTogglePause: (String, Bool) -> Void

    @State private var isHovered = false

    var scheduleText: String {
        switch state.definition.schedule {
        case .manual:
            return "Manual"
        case .once(let dateStr, _):
            if let date = LoopProjection.parseTimestamp(dateStr) {
                let formatter = DateFormatter()
                formatter.dateStyle = .medium
                formatter.timeStyle = .short
                return "Once at \(formatter.string(from: date))"
            }
            return "Once"
        case .calendar(let hour, let minute, let weekdays, _):
            let timeStr = String(format: "%02d:%02d", hour, minute)
            if weekdays.isEmpty {
                return "Daily at \(timeStr)"
            } else {
                let symbols = calendar.shortWeekdaySymbols
                let days = weekdays.map { symbols[($0 % 7)] }.joined(separator: ", ")
                return "Days \(days) at \(timeStr)"
            }
        case .interval(let seconds, _):
            return "Every \(seconds)s"
        }
    }

    var stateStatus: (title: String, icon: String, color: Color) {
        if state.isRunning {
            return ("Running", "play.circle.fill", LoopsPalette.running)
        }
        switch state.definition.lifecycle {
        case .paused:
            return ("Paused", "pause.circle.fill", LoopsPalette.inactive)
        case .draft, .needsReview:
            return ("Needs Attention", "exclamationmark.triangle.fill", LoopsPalette.operational)
        case .enabled:
            return ("Upcoming", "clock.fill", LoopsPalette.success)
        default:
            return ("Ready", "checkmark.circle.fill", LoopsPalette.identity)
        }
    }

    var body: some View {
        let status = stateStatus
        let isPaused = state.definition.lifecycle == .paused
        let canRunNow = [.ready, .enabled, .paused].contains(state.definition.lifecycle)
        let canPause = state.definition.lifecycle == .enabled
        let canResume = isPaused
        let stateId = state.id

        HStack(spacing: 0) {
            Button(action: onSelect) {
                HStack(spacing: 16) {
                    Image(systemName: status.icon)
                        .font(.system(size: 20))
                        .foregroundStyle(status.color)
                        .frame(width: 24)
                        .accessibilityLabel(status.title)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(state.definition.name)
                            .font(.headline)
                        Text(scheduleText)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    if let nextStr = state.nextScheduledAt, let next = LoopProjection.parseTimestamp(nextStr), state.definition.lifecycle == .enabled && !state.isRunning {
                        NextRunView(next: next)
                    }

                    LoopsStatusPill(
                        title: status.title,
                        systemImage: status.icon,
                        tint: status.color
                    )
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
            .padding(.leading, 16)
        }
        .padding()
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isHovered ? Color.accentColor : Color.secondary.opacity(0.2), lineWidth: isHovered ? 2 : 1)
        )
        .onHover { isHovered = $0 }
    }
}

// MARK: - Previews

struct SchedulesView_Previews: PreviewProvider {
    static var previews: some View {
        SchedulesView(
            states: LoopsPreviewData.loopStates,
            referenceDate: Date(timeIntervalSince1970: 1_784_905_200),
            calendar: .current,
            onSelect: { _ in },
            onNewLoop: { },
            onRunNow: { _ in },
            onTogglePause: { _, _ in }
        )
        .frame(width: 800, height: 600)
    }
}
