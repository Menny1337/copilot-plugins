import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Native settings window for the daemon config. A presentation layer over
/// `daemon-ctl.sh config-get`/`config-set` (via `ConfigModel`); it never writes
/// config.json directly. Mirrors the menu-bar dropdown's visual language.
struct ConfigWindow: View {
    static let windowID = "skill-review-settings"

    @ObservedObject var model: ConfigModel
    var autoLoad = true
    @State private var searchText = ""
    @State private var editingUnit: ReviewUnit?
    @State private var typeFilter = UnitTypeFilter.all
    @State private var sourceFilter = UnitSourceFilter.all
    @State private var policyFilter = UnitPolicyFilter.all
    @State private var availabilityFilter = UnitAvailabilityFilter.all
    @State private var showingSources = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            body(for: model.loadState)
            Divider()
            footer
        }
        .frame(minWidth: 760, idealWidth: 820, minHeight: 620, idealHeight: 820)
        .task { if autoLoad { await model.load() } }
        .onDisappear { NSApp.setActivationPolicy(.accessory) }
        .sheet(item: $editingUnit) { unit in
            UnitSettingsSheet(unit: unit, model: model)
        }
        .sheet(isPresented: $showingSources) {
            SkillSourcesSheet(model: model)
        }
        .alert("Skill action failed", isPresented: Binding(
            get: { model.unitActionError != nil },
            set: { if !$0 { model.unitActionError = nil } }
        )) {
            Button("OK") { model.unitActionError = nil }
        } message: {
            Text(model.unitActionError ?? "Unknown error")
        }
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

            reviewedUnitsSection

            Section("Paths & identity") {
                TextRow(icon: "folder", title: "Repo directory", text: $model.config.repoDir, placeholder: "/path/to/git/worktree")
                TextRow(icon: "tag", title: "Marketplace name", text: $model.config.marketplaceName, placeholder: "optional")
                TextRow(icon: "person.crop.circle", title: "gh account", text: $model.config.ghAccount, placeholder: "optional")
            }
        }
        .formStyle(.grouped)
    }

    private var reviewedUnitsSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    TextField("", text: $searchText, prompt: Text("Search skills and agents"))
                        .labelsHidden()
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 280)
                    Text(visibleUnitCountText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 12)
                    filterMenu
                    if !model.config.skillPaths.isEmpty || !model.config.skillFolders.isEmpty {
                        Button("Sources…") { showingSources = true }
                    }
                    Button("Refresh") {
                        Task { await model.reloadUnits() }
                    }
                    Menu("Add") {
                        Button("SKILL.md…", action: chooseSkill)
                        Button("Skills folder…", action: chooseSkillsFolder)
                    }
                }

                catalogContent
            }
            .padding(.vertical, 2)
        } header: {
            Text("Skills & agents under review")
        } footer: {
            Text("Add individual SKILL.md files or folders from anywhere on this Mac. Folder sources include the selected folder and its immediate child skill folders, and update automatically when skills are added.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var filterMenu: some View {
        Menu {
            Picker("Type", selection: $typeFilter) {
                ForEach(UnitTypeFilter.allCases) { filter in
                    Text(filter.label).tag(filter)
                }
            }
            Picker("Source", selection: $sourceFilter) {
                ForEach(UnitSourceFilter.allCases) { filter in
                    Text(filter.label).tag(filter)
                }
            }
            Picker("Policy", selection: $policyFilter) {
                ForEach(UnitPolicyFilter.allCases) { filter in
                    Text(filter.label).tag(filter)
                }
            }
            Picker("Availability", selection: $availabilityFilter) {
                ForEach(UnitAvailabilityFilter.allCases) { filter in
                    Text(filter.label).tag(filter)
                }
            }
            if hasActiveFilters {
                Divider()
                Button("Clear filters", action: clearFilters)
            }
        } label: {
            Text(activeFilterCount == 0 ? "Filters" : "Filters (\(activeFilterCount))")
        }
        .fixedSize()
    }

    @ViewBuilder
    private var catalogContent: some View {
        switch model.catalogState {
        case .idle, .loading:
            ProgressView("Loading reviewed units…")
                .frame(maxWidth: .infinity, minHeight: 120)
        case .failed(let message):
            VStack(spacing: 8) {
                Text("Couldn't load reviewed units")
                    .font(.headline)
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("Retry") { Task { await model.reloadUnits() } }
            }
            .frame(maxWidth: .infinity, minHeight: 120)
        case .loaded:
            if filteredUnits.isEmpty {
                VStack(spacing: 8) {
                    Text(model.units.isEmpty ? "No reviewed units" : "No matching units")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    if hasActiveFilters {
                        Button("Clear filters", action: clearFilters)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 150)
            } else {
                unitsList
            }
        }
    }

    private var unitsList: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text("Unit")
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("Policy")
                    .frame(width: 165, alignment: .leading)
                Text("Actions")
                    .frame(width: 230, alignment: .leading)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(Color(nsColor: .controlBackgroundColor))

            ForEach(Array(filteredUnits.enumerated()), id: \.element.id) { index, unit in
                HStack(spacing: 12) {
                    unitIdentity(unit)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    policyPicker(for: unit)
                        .frame(width: 165, alignment: .leading)
                    unitActions(unit)
                        .frame(width: 230, alignment: .leading)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .frame(minHeight: 47)
                .background(rowBackground(at: index))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay {
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color.secondary.opacity(0.18), lineWidth: 1)
        }
    }

    private func unitIdentity(_ unit: ReviewUnit) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(unit.name)
                    .font(.body.weight(.medium))
                if !unit.isSkill {
                    Text(unit.typeLabel)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Text(unit.displayPath)
                .font(.caption)
                .foregroundColor(unit.exists ? .secondary : .orange)
                .lineLimit(1)
                .help(unit.path)
            if unit.conflict {
                Text("Duplicate unit name — remove one source before running")
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        }
    }

    private func unitActions(_ unit: ReviewUnit) -> some View {
        HStack(spacing: 8) {
            Button("Edit") { editingUnit = unit }
                .buttonStyle(.bordered)
            runControl(for: unit)
            Menu {
                Button("Open \(unit.typeLabel) file") {
                    model.openUnitFile(unit)
                }
                .disabled(!unit.exists)
                if unit.isExternal {
                    Divider()
                    if unit.isFolderSource {
                        Button("Exclude from review loop") {
                            model.setEligibility(.excluded, for: unit)
                        }
                    } else {
                        Button("Remove from review loop", role: .destructive) {
                            model.removeExternalSkill(unit)
                        }
                    }
                }
            } label: {
                Text("More")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
        .controlSize(.small)
    }

    private func rowBackground(at index: Int) -> Color {
        let colors = NSColor.alternatingContentBackgroundColors
        guard !colors.isEmpty else { return Color(nsColor: .textBackgroundColor) }
        return Color(nsColor: colors[index % colors.count])
    }

    @ViewBuilder
    private func policyPicker(for unit: ReviewUnit) -> some View {
        if unit.isExternal {
            Text("Edit in place")
                .font(.callout)
                .foregroundStyle(.secondary)
        } else {
            Picker("", selection: Binding(
                get: { model.policy(for: unit) },
                set: { model.setPolicy($0, for: unit) }
            )) {
                Text(defaultPolicyLabel).tag(UnitPolicy.defaultPolicy)
                Text("Auto-merge").tag(UnitPolicy.autoMerge)
                Text("Review via PR").tag(UnitPolicy.reviewPR)
            }
            .labelsHidden()
            .pickerStyle(.menu)
        }
    }

    @ViewBuilder
    private func runControl(for unit: ReviewUnit) -> some View {
        switch model.runState(for: unit) {
        case .running:
            HStack(spacing: 5) {
                ProgressView().controlSize(.small)
                Text("Running…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(minWidth: 82)
        case .completed:
            Text("Completed")
                .font(.caption)
                .foregroundStyle(.green)
                .frame(minWidth: 82)
        case .failed(let message):
            Button("Retry") { model.runUnit(unit) }
                .buttonStyle(.bordered)
                .help(message)
        case nil:
            Button("Run now") { model.runUnit(unit) }
                .buttonStyle(.bordered)
                .disabled(!unit.canRun || model.hasRunningUnit)
        }
    }

    private var filteredUnits: [ReviewUnit] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return model.units.filter {
            matchesSearch($0, query: query) &&
            matchesType($0) &&
            matchesSource($0) &&
            matchesPolicy($0) &&
            matchesAvailability($0)
        }
    }

    private var visibleUnitCountText: String {
        if hasActiveFilters {
            return "\(filteredUnits.count) of \(model.units.count) shown"
        }
        return "\(model.units.count) units"
    }

    private var activeFilterCount: Int {
        [
            typeFilter != .all,
            sourceFilter != .all,
            policyFilter != .all,
            availabilityFilter != .all,
        ].filter { $0 }.count
    }

    private var hasActiveFilters: Bool {
        activeFilterCount > 0 || !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func matchesSearch(_ unit: ReviewUnit, query: String) -> Bool {
        query.isEmpty ||
        unit.name.localizedCaseInsensitiveContains(query) ||
        unit.path.localizedCaseInsensitiveContains(query) ||
        unit.type.localizedCaseInsensitiveContains(query)
    }

    private func matchesType(_ unit: ReviewUnit) -> Bool {
        switch typeFilter {
        case .all: true
        case .skills: unit.isSkill
        case .agents: !unit.isSkill
        }
    }

    private func matchesSource(_ unit: ReviewUnit) -> Bool {
        switch sourceFilter {
        case .all: true
        case .marketplace: !unit.isExternal
        case .external: unit.isExternal
        }
    }

    private func matchesPolicy(_ unit: ReviewUnit) -> Bool {
        switch policyFilter {
        case .all:
            true
        case .defaultPolicy:
            !unit.isExternal && model.policy(for: unit) == .defaultPolicy
        case .autoMerge:
            !unit.isExternal && model.policy(for: unit) == .autoMerge
        case .reviewPR:
            !unit.isExternal && model.policy(for: unit) == .reviewPR
        case .editInPlace:
            unit.isExternal
        }
    }

    private func matchesAvailability(_ unit: ReviewUnit) -> Bool {
        switch availabilityFilter {
        case .all: true
        case .ready: unit.canRun && model.isEligible(unit)
        case .excluded: !model.isEligible(unit)
        case .issues: !unit.canRun
        }
    }

    private func clearFilters() {
        searchText = ""
        typeFilter = .all
        sourceFilter = .all
        policyFilter = .all
        availabilityFilter = .all
    }

    private var defaultPolicyLabel: String {
        model.config.deployMode == "pr" ? "Default (PR)" : "Default (auto)"
    }

    private func chooseSkill() {
        let panel = NSOpenPanel()
        panel.title = "Add skill"
        panel.message = "Choose a SKILL.md file to add to the review loop."
        panel.prompt = "Add skill"
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText]

        let defaultDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".copilot", isDirectory: true)
        if FileManager.default.fileExists(atPath: defaultDirectory.path) {
            panel.directoryURL = defaultDirectory
        } else {
            panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser
        }

        let completion: (NSApplication.ModalResponse) -> Void = { response in
            guard response == .OK, let url = panel.url else { return }
            Task { @MainActor in model.addExternalSkill(at: url) }
        }
        if let window = NSApp.keyWindow {
            panel.beginSheetModal(for: window, completionHandler: completion)
        } else {
            panel.begin(completionHandler: completion)
        }
    }

    private func chooseSkillsFolder() {
        let panel = NSOpenPanel()
        panel.title = "Add skills folder"
        panel.message = "Choose a folder containing SKILL.md or immediate child skill folders."
        panel.prompt = "Add folder"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false

        let copilotDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".copilot", isDirectory: true)
        let skillsDirectory = copilotDirectory.appendingPathComponent("skills", isDirectory: true)
        if FileManager.default.fileExists(atPath: skillsDirectory.path) {
            panel.directoryURL = skillsDirectory
        } else if FileManager.default.fileExists(atPath: copilotDirectory.path) {
            panel.directoryURL = copilotDirectory
        } else {
            panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser
        }

        let completion: (NSApplication.ModalResponse) -> Void = { response in
            guard response == .OK, let url = panel.url else { return }
            Task { @MainActor in model.addExternalSkillFolder(at: url) }
        }
        if let window = NSApp.keyWindow {
            panel.beginSheetModal(for: window, completionHandler: completion)
        } else {
            panel.begin(completionHandler: completion)
        }
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

private enum UnitTypeFilter: String, CaseIterable, Identifiable {
    case all, skills, agents
    var id: Self { self }
    var label: String {
        switch self {
        case .all: "All types"
        case .skills: "Skills"
        case .agents: "Agents"
        }
    }
}

private enum UnitSourceFilter: String, CaseIterable, Identifiable {
    case all, marketplace, external
    var id: Self { self }
    var label: String {
        switch self {
        case .all: "All sources"
        case .marketplace: "Marketplace"
        case .external: "External"
        }
    }
}

private enum UnitPolicyFilter: String, CaseIterable, Identifiable {
    case all, defaultPolicy, autoMerge, reviewPR, editInPlace
    var id: Self { self }
    var label: String {
        switch self {
        case .all: "All policies"
        case .defaultPolicy: "Default"
        case .autoMerge: "Auto-merge"
        case .reviewPR: "Review via PR"
        case .editInPlace: "Edit in place"
        }
    }
}

private enum UnitAvailabilityFilter: String, CaseIterable, Identifiable {
    case all, ready, excluded, issues
    var id: Self { self }
    var label: String {
        switch self {
        case .all: "All availability"
        case .ready: "Ready"
        case .excluded: "Excluded"
        case .issues: "Issues"
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

private struct UnitSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    let unit: ReviewUnit
    @ObservedObject var model: ConfigModel

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section("Unit") {
                    LabeledContent("Name", value: unit.name)
                    LabeledContent("Type", value: unit.typeLabel)
                    LabeledContent("Source", value: sourceLabel)
                    LabeledContent("Path") {
                        Text(unit.displayPath)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    if unit.isFolderSource {
                        LabeledContent("Source folder") {
                            Text(ReviewUnit.abbreviateHome(in: unit.sourceRoot))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                }

                Section("Review settings") {
                    Picker("Eligibility", selection: Binding(
                        get: { model.eligibility(for: unit) },
                        set: { model.setEligibility($0, for: unit) }
                    )) {
                        Text("Default").tag(UnitEligibility.defaultScope)
                        Text("Included").tag(UnitEligibility.included)
                        Text("Excluded").tag(UnitEligibility.excluded)
                    }
                    .pickerStyle(.menu)

                    if unit.isExternal {
                        LabeledContent("Change handling", value: "Edit in place")
                        Text("External skills bypass marketplace commits, pull requests, and plugin deployment.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Deployment policy", selection: Binding(
                            get: { model.policy(for: unit) },
                            set: { model.setPolicy($0, for: unit) }
                        )) {
                            Text(defaultPolicyLabel).tag(UnitPolicy.defaultPolicy)
                            Text("Auto-merge").tag(UnitPolicy.autoMerge)
                            Text("Review via PR").tag(UnitPolicy.reviewPR)
                        }
                        .pickerStyle(.menu)
                    }

                    Text(eligibilityHelp)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Button("Open \(unit.typeLabel) file") {
                        model.openUnitFile(unit)
                    }
                    .disabled(!unit.exists)
                }
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                if unit.isExternal {
                    if unit.isFolderSource {
                        Button("Exclude this skill") {
                            model.setEligibility(.excluded, for: unit)
                            dismiss()
                        }
                    } else {
                        Button("Remove from review loop", role: .destructive) {
                            model.removeExternalSkill(unit)
                            dismiss()
                        }
                    }
                }
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(16)
        }
        .frame(minWidth: 480, idealWidth: 520, minHeight: 360, idealHeight: 420)
    }

    private var sourceLabel: String {
        switch unit.source {
        case "marketplace": unit.plugin.isEmpty ? "Marketplace" : unit.plugin
        case "external": unit.isFolderSource ? "External skills folder" : "External file"
        default: "Configured override"
        }
    }

    private var defaultPolicyLabel: String {
        model.config.deployMode == "pr" ? "Default (Review via PR)" : "Default (Auto-merge)"
    }

    private var eligibilityHelp: String {
        if model.config.include.isEmpty {
            return "Default units are eligible unless explicitly excluded."
        }
        return "An Include allowlist is active. Only units marked Included are eligible; Excluded always wins."
    }
}

private struct SkillSourcesSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: ConfigModel

    var body: some View {
        VStack(spacing: 0) {
            Form {
                if model.config.skillPaths.isEmpty && model.config.skillFolders.isEmpty {
                    Text("No external skill sources are configured.")
                        .foregroundStyle(.secondary)
                }

                if !model.config.skillPaths.isEmpty {
                    Section("Individual SKILL.md files") {
                        ForEach(model.config.skillPaths, id: \.self) { path in
                            sourceRow(path: path) {
                                model.removeSkillPath(path)
                            }
                        }
                    }
                }

                if !model.config.skillFolders.isEmpty {
                    Section {
                        ForEach(model.config.skillFolders, id: \.self) { path in
                            sourceRow(path: path) {
                                model.removeSkillFolder(path)
                            }
                        }
                    } header: {
                        Text("Skills folders")
                    } footer: {
                        Text("Each folder contributes its own SKILL.md and immediate child folders containing SKILL.md.")
                    }
                }
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(16)
        }
        .frame(minWidth: 560, idealWidth: 620, minHeight: 320, idealHeight: 430)
    }

    private func sourceRow(path: String, remove: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            Text(ReviewUnit.abbreviateHome(in: path))
                .lineLimit(1)
                .truncationMode(.middle)
                .help(path)
                .textSelection(.enabled)
            Spacer(minLength: 12)
            Button("Remove", role: .destructive, action: remove)
        }
    }
}
