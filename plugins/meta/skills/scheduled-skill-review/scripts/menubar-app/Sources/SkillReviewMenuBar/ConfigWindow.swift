import AppKit
import SwiftUI

/// Native settings window for the daemon config. A presentation layer over
/// `daemon-ctl.sh config-get`/`config-set` (via `ConfigModel`); it never writes
/// config.json directly. Mirrors the menu-bar dropdown's visual language.
struct ConfigWindow: View {
    static let windowID = "skill-review-settings"

    @ObservedObject var model: ConfigModel
    var autoLoad = true

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            body(for: model.loadState)
            Divider()
            footer
        }
        .frame(minWidth: 520, idealWidth: 540, minHeight: 560, idealHeight: 780)
        .task { if autoLoad { await model.load() } }
        .onDisappear { NSApp.setActivationPolicy(.accessory) }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "testtube.2")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.teal)
            VStack(alignment: .leading, spacing: 0) {
                Text(Constants.displayName).font(.title3.bold())
                Text("Settings").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    // MARK: Body states

    @ViewBuilder
    private func body(for state: ConfigModel.LoadState) -> some View {
        switch state {
        case .idle, .loading:
            ProgressView("Loading config…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.largeTitle)
                    .foregroundStyle(.orange)
                Text("Couldn't load config").font(.headline)
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                Button("Retry") { Task { await model.load() } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            form
        }
    }

    // MARK: Form

    private var form: some View {
        Form {
            Section("General") {
                Toggle(isOn: $model.config.enabled) {
                    Label("Daemon enabled", systemImage: "gearshape")
                }
                Picker(selection: $model.config.notify) {
                    Text("Auto").tag("auto")
                    Text("None").tag("none")
                } label: {
                    Label("Notifications", systemImage: "bell")
                }
                .pickerStyle(.menu)
                .fixedSize()
            }

            Section("Schedule") {
                NumberRow(icon: "clock", title: "Hour", value: $model.config.schedule.hour, range: 0...23)
                NumberRow(icon: "clock", title: "Minute", value: $model.config.schedule.minute, range: 0...59)
                WeekdayRow(weekdays: $model.config.schedule.weekdays)
            }

            Section("Deployment") {
                Toggle(isOn: $model.config.autoDeploy) {
                    Label("Auto-deploy passing changes", systemImage: "arrow.triangle.branch")
                }
                Toggle(isOn: $model.config.autoRevert) {
                    Label("Auto-revert regressions", systemImage: "arrow.uturn.backward")
                }
                Picker(selection: $model.config.deployMode) {
                    Text("Auto").tag("auto")
                    Text("PR").tag("pr")
                } label: {
                    Label("Default policy", systemImage: "slider.horizontal.3")
                }
                .pickerStyle(.segmented)
                Picker(selection: $model.config.revertDeployMode) {
                    Text("Auto").tag("auto")
                    Text("PR").tag("pr")
                    Text("Per-unit").tag("unit")
                } label: {
                    Label("Reverts", systemImage: "arrow.uturn.backward")
                }
                .pickerStyle(.segmented)
                NumberRow(icon: "speedometer", title: "Concurrency", value: $model.config.concurrency, range: 1...16)
            }

            Section("Selection & tuning") {
                NumberRow(icon: "chart.bar", title: "Signal threshold", value: $model.config.signalThreshold, range: 1...100)
                NumberRow(icon: "clock.arrow.circlepath", title: "Observation window", value: $model.config.observationWindowDays, range: 0...365, suffix: "days")
                NumberRow(icon: "calendar.badge.clock", title: "First-run lookback", value: $model.config.firstRunLookbackDays, range: 0...365, suffix: "days")
                NumberRow(icon: "person.2", title: "Max first-run sessions", value: $model.config.maxFirstRunSessions, range: 1...100_000)
            }

            Section {
                UnitScopeRow(title: "Include", items: $model.config.include)
                UnitScopeRow(title: "Exclude", items: $model.config.exclude)
                UnitScopeRow(title: "Auto-merge", items: Binding(
                    get: { model.config.autoMergeUnits },
                    set: { model.setAutoMergeUnits($0) }
                ))
                UnitScopeRow(title: "Review via PR", items: Binding(
                    get: { model.config.prUnits },
                    set: { model.setPRUnits($0) }
                ))
            } header: {
                Text("Unit scope")
            } footer: {
                Text("Include limits eligibility to listed units; Exclude always skips. A unit in Review via PR opens a PR instead of auto-merging.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Paths & identity") {
                TextRow(icon: "folder", title: "Repo directory", text: $model.config.repoDir, placeholder: "/path/to/git/worktree")
                TextRow(icon: "tag", title: "Marketplace name", text: $model.config.marketplaceName, placeholder: "optional")
                TextRow(icon: "person.crop.circle", title: "gh account", text: $model.config.ghAccount, placeholder: "optional")
            }
        }
        .formStyle(.grouped)
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 12) {
            Button {
                model.openRawConfig()
            } label: {
                Label("Edit raw JSON…", systemImage: "doc.plaintext")
            }
            .buttonStyle(.link)

            Spacer(minLength: 0)

            saveStatus
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    /// Autosave indicator — the window writes every change automatically, so this
    /// reflects progress instead of offering a Save button.
    @ViewBuilder
    private var saveStatus: some View {
        switch model.saveState {
        case .saving:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Saving…").font(.caption).foregroundStyle(.secondary)
            }
        case .saved:
            Label("Saved", systemImage: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.green)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)
                .lineLimit(2)
        case .idle:
            Text("Changes save automatically")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Reusable rows

/// A label + orange value + stepper row, matching the menu bar's accent colour.
private struct NumberRow: View {
    let icon: String
    let title: String
    @Binding var value: Int
    let range: ClosedRange<Int>
    var suffix: String = ""

    var body: some View {
        HStack {
            Label(title, systemImage: icon)
            Spacer(minLength: 12)
            Text(suffix.isEmpty ? "\(value)" : "\(value) \(suffix)")
                .foregroundStyle(.orange)
                .monospacedDigit()
            Stepper("", value: $value, in: range)
                .labelsHidden()
        }
    }
}

/// A label + trailing text field row.
private struct TextRow: View {
    let icon: String
    let title: String
    @Binding var text: String
    var placeholder: String = ""

    var body: some View {
        LabeledContent {
            TextField(placeholder, text: $text)
                .textFieldStyle(.roundedBorder)
                .frame(minWidth: 220)
        } label: {
            Label(title, systemImage: icon)
        }
    }
}

/// Seven circular weekday toggles (Sun…Sat = JS getDay 0…6); empty = every day.
private struct WeekdayRow: View {
    @Binding var weekdays: [Int]

    private let labels = ["S", "M", "T", "W", "T", "F", "S"]
    private let names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label("Days of week", systemImage: "calendar")
                Spacer(minLength: 12)
                HStack(spacing: 6) {
                    ForEach(0..<7, id: \.self) { day in
                        dayButton(day)
                    }
                }
            }
            Text("Empty = every day — mirrors the launchd plist")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func dayButton(_ day: Int) -> some View {
        let on = weekdays.contains(day)
        return Button {
            toggle(day)
        } label: {
            Text(labels[day])
                .font(.system(size: 12, weight: .semibold))
                .frame(width: 26, height: 26)
                .background(on ? Color.accentColor : Color.secondary.opacity(0.15))
                .foregroundStyle(on ? Color.white : Color.primary)
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
        .help(names[day])
    }

    private func toggle(_ day: Int) {
        if let index = weekdays.firstIndex(of: day) {
            weekdays.remove(at: index)
        } else {
            weekdays = (weekdays + [day]).sorted()
        }
    }
}

/// A labelled, editable list of unit names rendered as removable chips.
private struct UnitScopeRow: View {
    let title: String
    @Binding var items: [String]
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(title, systemImage: "tag")
                Spacer(minLength: 0)
            }
            if !items.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(items, id: \.self) { item in
                        chip(item)
                    }
                }
            }
            HStack(spacing: 6) {
                TextField("Add unit…", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 200)
                    .onSubmit(add)
                Button("Add", action: add)
                    .disabled(trimmed.isEmpty)
            }
        }
        .padding(.vertical, 2)
    }

    private func chip(_ item: String) -> some View {
        HStack(spacing: 4) {
            Text(item).font(.callout)
            Button {
                items.removeAll { $0 == item }
            } label: {
                Image(systemName: "minus.circle.fill")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .padding(.leading, 9)
        .padding(.trailing, 5)
        .padding(.vertical, 3)
        .background(Color.secondary.opacity(0.15))
        .clipShape(Capsule())
    }

    private var trimmed: String { draft.trimmingCharacters(in: .whitespaces) }

    private func add() {
        let value = trimmed
        guard !value.isEmpty else { return }
        if !items.contains(value) { items.append(value) }
        draft = ""
    }
}

/// Minimal wrapping layout for the unit chips (macOS 13+ Layout protocol).
private struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        let width = maxWidth.isFinite ? maxWidth : x
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
