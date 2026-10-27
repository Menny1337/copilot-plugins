import SwiftUI
import LoopsModels

// MARK: - Schedule & policy step

/// Schedule step: manual / one-time (minute precision, local) /
/// calendar daily / calendar weekdays / interval (>= 60s), plus timeout,
/// retries+backoff, notifications, and retention.
struct SchedulePolicyView: View {
    @ObservedObject var state: LoopBuilderState

    private var issues: [BuilderIssue] { state.validate(step: .schedule) }

    private static let weekdayLabels: [(index: Int, short: String, long: String)] = [
        (0, "Sun", "Sunday"),
        (1, "Mon", "Monday"),
        (2, "Tue", "Tuesday"),
        (3, "Wed", "Wednesday"),
        (4, "Thu", "Thursday"),
        (5, "Fri", "Friday"),
        (6, "Sat", "Saturday"),
    ]

    var body: some View {
        Form {
            scheduleKindSection
            scheduleDetailSection
            timeoutSection
            retrySection
            notificationsSection
            retentionSection
        }
        .formStyle(.grouped)
    }

    // MARK: Schedule kind

    private var scheduleKindSection: some View {
        Section {
            Picker("", selection: $state.scheduleKind) {
                ForEach(ScheduleKind.allCases) { kind in
                    Text(kind.title).tag(kind)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .accessibilityLabel("Schedule kind")
            Text(state.scheduleKind.subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
        } header: {
            Text("Schedule kind")
        }
    }

    // MARK: Schedule detail

    private var scheduleDetailSection: some View {
        Section {
            switch state.scheduleKind {
            case .manual:
                Text("Runs are triggered manually from the Library, menu-bar popover, or `loops-ctl run-now`.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            case .oneTime:
                oneTimeDetail
            case .dailyCalendar:
                calendarDetail(weekdays: false)
            case .weekdayCalendar:
                calendarDetail(weekdays: true)
            case .interval:
                intervalDetail
            }
            graceRow
        } header: {
            Text("Timing")
        } footer: {
            Text("Times are stored as local wall-clock unless otherwise noted. Grace seconds allow a late run to still fire after a wake-from-sleep or a reboot.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var oneTimeDetail: some View {
        VStack(alignment: .leading, spacing: 8) {
            DatePicker(
                "Fires at",
                selection: $state.oneTimeDate,
                displayedComponents: [.date, .hourAndMinute]
            )
            .datePickerStyle(.compact)
            .builderFieldError(issue(field: .scheduleTime) != nil)
            .accessibilityLabel("One-time schedule fire date")
            BuilderIssueList(issues: [issue(field: .scheduleTime)].compactMap { $0 })
        }
    }

    private func calendarDetail(weekdays: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            DatePicker(
                "Fires at",
                selection: $state.calendarTime,
                displayedComponents: [.hourAndMinute]
            )
            .datePickerStyle(.compact)
            .accessibilityLabel("Calendar schedule fire time")

            if weekdays {
                HStack(spacing: 6) {
                    ForEach(Self.weekdayLabels, id: \.index) { entry in
                        Button {
                            state.toggleWeekday(entry.index)
                        } label: {
                            Text(entry.short)
                                .font(.caption.weight(.medium))
                                .frame(minWidth: 34)
                                .padding(.vertical, 6)
                                .background(
                                    RoundedRectangle(cornerRadius: 6)
                                        .fill(state.selectedWeekdays.contains(entry.index)
                                              ? LoopsPalette.identity
                                              : Color(nsColor: .separatorColor).opacity(0.3))
                                )
                                .foregroundStyle(state.selectedWeekdays.contains(entry.index) ? Color.white : Color.primary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(entry.long)
                        .accessibilityAddTraits(state.selectedWeekdays.contains(entry.index) ? .isSelected : [])
                    }
                }
                BuilderIssueList(issues: [issue(field: .scheduleWeekdays)].compactMap { $0 })
            }
        }
    }

    private var intervalDetail: some View {
        VStack(alignment: .leading, spacing: 8) {
            Stepper(
                value: $state.intervalSeconds,
                in: 60...31_536_000,
                step: 60
            ) {
                HStack {
                    Text("Every")
                    Text(intervalDescription(seconds: state.intervalSeconds))
                        .font(.callout.weight(.semibold))
                        .monospacedDigit()
                }
            }
            .builderFieldError(issue(field: .scheduleInterval) != nil)
            .accessibilityLabel("Interval seconds")
            BuilderIssueList(issues: [issue(field: .scheduleInterval)].compactMap { $0 })
        }
    }

    // Grace only makes sense for schedules that actually fire on a wall
    // clock; manual loops are user-triggered so we hide the row entirely.
    @ViewBuilder
    private var graceRow: some View {
        if state.scheduleKind != .manual {
            HStack {
                Text("Grace window")
                    .foregroundStyle(.secondary)
                Spacer()
                Stepper("\(state.graceSeconds) s", value: $state.graceSeconds, in: 0...3600, step: 30)
                    .accessibilityLabel("Grace window seconds")
            }
        }
    }

    private func intervalDescription(seconds: Int) -> String {
        if seconds >= 3600 && seconds % 3600 == 0 {
            let hours = seconds / 3600
            return hours == 1 ? "1 hour" : "\(hours) hours"
        }
        if seconds >= 60 && seconds % 60 == 0 {
            let minutes = seconds / 60
            return minutes == 1 ? "1 minute" : "\(minutes) minutes"
        }
        return "\(seconds) seconds"
    }

    // MARK: Timeout

    private var timeoutSection: some View {
        Section {
            HStack {
                Text("Run timeout").foregroundStyle(.secondary)
                Spacer()
                Stepper(
                    value: $state.timeoutSeconds,
                    in: 0...604_800,
                    step: 60
                ) {
                    Text(timeoutLabel(state.timeoutSeconds))
                        .monospacedDigit()
                }
                .accessibilityLabel("Timeout seconds")
            }
            BuilderIssueList(issues: [issue(field: .timeout)].compactMap { $0 })
        } header: {
            Text("Timeout")
        } footer: {
            Text("0 seconds means \"no timeout\"; runs may block indefinitely. Otherwise the loop is terminated after the configured window.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func timeoutLabel(_ seconds: Int) -> String {
        if seconds <= 0 { return "No timeout" }
        return "\(seconds) s"
    }

    // MARK: Retries

    private var retrySection: some View {
        Section {
            HStack {
                Text("Max retries").foregroundStyle(.secondary)
                Spacer()
                Stepper("\(state.maxRetries)", value: $state.maxRetries, in: 0...5)
                    .accessibilityLabel("Maximum retries")
            }
            HStack {
                Text("Backoff seconds").foregroundStyle(.secondary)
                Spacer()
                Stepper(
                    "\(state.backoffSeconds) s",
                    value: $state.backoffSeconds,
                    in: 0...86_400,
                    step: 15
                )
                .accessibilityLabel("Backoff seconds")
            }
            BuilderIssueList(issues: [
                issue(field: .retries),
                issue(field: .backoff),
            ].compactMap { $0 })
        } header: {
            Text("Retries")
        }
    }

    // MARK: Notifications

    private var notificationsSection: some View {
        Section {
            Toggle("Notify on failure", isOn: $state.notifyOnFailure)
                .accessibilityLabel("Notify on failure")
            Toggle("Notify on success", isOn: $state.notifyOnSuccess)
                .accessibilityLabel("Notify on success")
        } header: {
            Text("Notifications")
        }
    }

    // MARK: Retention

    private var retentionSection: some View {
        Section {
            HStack {
                Text("Retention days").foregroundStyle(.secondary)
                Spacer()
                Stepper(
                    "\(state.retentionDays) days",
                    value: $state.retentionDays,
                    in: 1...3650
                )
                .accessibilityLabel("Retention in days")
            }
            HStack {
                Text("Max runs kept").foregroundStyle(.secondary)
                Spacer()
                Stepper(
                    "\(state.retentionMaxRuns) runs",
                    value: $state.retentionMaxRuns,
                    in: 1...10_000,
                    step: 10
                )
                .accessibilityLabel("Maximum runs kept")
            }
            BuilderIssueList(issues: [issue(field: .retention)].compactMap { $0 })
        } header: {
            Text("Retention")
        } footer: {
            Text("Default is 30 days / 100 runs. Run artifacts older than either bound are pruned by the reconciler. Days ≤ 3650, runs ≤ 10,000.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func issue(field: BuilderIssue.Field) -> BuilderIssue? {
        issues.first(where: { $0.field == field })
    }
}

#if DEBUG
struct SchedulePolicyView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            preview(kind: .weekdayCalendar).previewDisplayName("Weekday calendar")
            preview(kind: .interval).previewDisplayName("Interval").preferredColorScheme(.dark)
            preview(kind: .manual).previewDisplayName("Manual")
        }
        .frame(width: 620, height: 680)
        .previewLayout(.sizeThatFits)
    }

    static func preview(kind: ScheduleKind) -> some View {
        let state = LoopBuilderState(
            mode: .create,
            kind: .copilot,
            now: { Date(timeIntervalSince1970: 1_755_000_000) }
        )
        state.scheduleKind = kind
        return SchedulePolicyView(state: state)
    }
}
#endif
