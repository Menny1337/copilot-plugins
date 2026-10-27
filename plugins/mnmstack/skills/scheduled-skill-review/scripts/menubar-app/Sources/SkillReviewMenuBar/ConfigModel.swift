import AppKit
import Combine
import Foundation
import SwiftUI

/// Backing model for the native settings window. Loads the effective config on
/// appear and autosaves every edit back through `daemon-ctl.sh` (debounced and
/// serialized) — there is no explicit Save button.
@MainActor
final class ConfigModel: ObservableObject {
    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    enum SaveState: Equatable {
        case idle
        case saving
        case saved
        case failed(String)
    }

    enum CatalogState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    enum UnitRunState: Equatable {
        case running
        case completed
        case failed(String)
    }

    @Published var config = Config()
    @Published private(set) var loadState: LoadState = .idle
    @Published private(set) var saveState: SaveState = .idle
    @Published private(set) var units: [ReviewUnit] = []
    @Published private(set) var catalogState: CatalogState = .idle
    @Published private(set) var unitRunStates: [String: UnitRunState] = [:]
    @Published var unitActionError: String?

    private let control: ConfigControlling
    private let daemonControl: DaemonControlling
    private let unitCatalogControl: UnitCatalogControlling
    private var lastPersisted: Config?
    private var autosaveEnabled = false
    private var isPersisting = false
    private var cancellables = Set<AnyCancellable>()
    private var savedResetTask: Task<Void, Never>?

    init(
        control: ConfigControlling = ShellConfigControl(),
        daemonControl: DaemonControlling = ShellDaemonControl(),
        unitCatalogControl: UnitCatalogControlling = ShellUnitCatalogControl()
    ) {
        self.control = control
        self.daemonControl = daemonControl
        self.unitCatalogControl = unitCatalogControl
        configureAutosave()
    }

    /// Pre-loaded model for offscreen snapshot rendering (no daemon-ctl call and
    /// autosave stays disabled so renders never touch config.json).
    init(snapshot config: Config, units: [ReviewUnit] = []) {
        self.control = ShellConfigControl()
        self.daemonControl = ShellDaemonControl()
        self.unitCatalogControl = ShellUnitCatalogControl()
        self.config = config
        self.units = units
        self.lastPersisted = config
        self.loadState = .loaded
        self.catalogState = .loaded
        configureAutosave()
    }

    var isLoaded: Bool { loadState == .loaded }

    /// Subscribes to `config` edits and triggers a debounced autosave. The first
    /// emission (the initial default) is dropped; `removeDuplicates` plus the
    /// `lastPersisted` guard keep programmatic reloads from looping.
    private func configureAutosave() {
        $config
            .dropFirst()
            .removeDuplicates()
            .debounce(for: .milliseconds(600), scheduler: RunLoop.main)
            .sink { [weak self] _ in
                guard let self, self.autosaveEnabled else { return }
                guard self.config != self.lastPersisted else { return }
                Task { await self.persist() }
            }
            .store(in: &cancellables)
    }

    func load() async {
        autosaveEnabled = false
        loadState = .loading
        saveState = .idle
        do {
            let cfg = try await control.load()
            config = cfg
            lastPersisted = cfg
            loadState = .loaded
            autosaveEnabled = true
            await reloadUnits()
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    /// Keep `autoMergeUnits` and `prUnits` mutually exclusive in the UI (matching
    /// `config-set`), with the most recent edit winning so the form never shows a
    /// unit in both lists.
    func setAutoMergeUnits(_ units: [String]) {
        config.autoMergeUnits = units
        config.prUnits.removeAll { units.contains($0) }
    }

    func setPRUnits(_ units: [String]) {
        config.prUnits = units
        config.autoMergeUnits.removeAll { units.contains($0) }
    }

    func policy(for unit: ReviewUnit) -> UnitPolicy {
        if config.prUnits.contains(unit.name) { return .reviewPR }
        if config.autoMergeUnits.contains(unit.name) { return .autoMerge }
        return .defaultPolicy
    }

    func setPolicy(_ policy: UnitPolicy, for unit: ReviewUnit) {
        config.autoMergeUnits.removeAll { $0 == unit.name }
        config.prUnits.removeAll { $0 == unit.name }
        switch policy {
        case .defaultPolicy:
            break
        case .autoMerge:
            config.autoMergeUnits.append(unit.name)
        case .reviewPR:
            config.prUnits.append(unit.name)
        }
    }

    func eligibility(for unit: ReviewUnit) -> UnitEligibility {
        if config.exclude.contains(unit.name) { return .excluded }
        if config.include.contains(unit.name) { return .included }
        return .defaultScope
    }

    func setEligibility(_ eligibility: UnitEligibility, for unit: ReviewUnit) {
        config.include.removeAll { $0 == unit.name }
        config.exclude.removeAll { $0 == unit.name }
        switch eligibility {
        case .defaultScope:
            break
        case .included:
            config.include.append(unit.name)
        case .excluded:
            config.exclude.append(unit.name)
        }
    }

    func isEligible(_ unit: ReviewUnit) -> Bool {
        if config.exclude.contains(unit.name) { return false }
        return config.include.isEmpty || config.include.contains(unit.name)
    }

    func addExternalSkill(at selectedURL: URL) {
        do {
            let url = selectedURL.standardizedFileURL.resolvingSymlinksInPath()
            let name = try ReviewUnit.skillName(at: url)
            if config.skillPaths.contains(url.path) {
                throw ReviewUnitError.alreadyAdded(url.path)
            }
            if units.contains(where: { $0.name == name }) {
                throw ReviewUnitError.duplicateName(name)
            }
            config.skillPaths.append(url.path)
            units.append(ReviewUnit(
                name: name,
                path: url.path,
                source: "external",
                sourceKind: "file",
                sourceRoot: url.path
            ))
            units.sort(by: unitSort)
        } catch {
            unitActionError = error.localizedDescription
        }
    }

    func addExternalSkillFolder(at selectedURL: URL) {
        do {
            let folder = selectedURL.standardizedFileURL.resolvingSymlinksInPath()
            if config.skillFolders.contains(folder.path) {
                throw ReviewUnitError.folderAlreadyAdded(folder.path)
            }
            let discovered = try ReviewUnit.skillFiles(in: folder)
            let existingPaths = Set(units.filter(\.isSkill).map(\.path))
            var discoveredNames = Set<String>()
            for skill in discovered where !existingPaths.contains(skill.url.path) {
                if !discoveredNames.insert(skill.name).inserted ||
                    units.contains(where: { $0.name == skill.name }) {
                    throw ReviewUnitError.duplicateName(skill.name)
                }
            }
            config.skillFolders.append(folder.path)
        } catch {
            unitActionError = error.localizedDescription
        }
    }

    func removeExternalSkill(_ unit: ReviewUnit) {
        guard unit.isExternal else { return }
        if unit.isFolderSource {
            setEligibility(.excluded, for: unit)
            return
        }
        config.skillPaths.removeAll { $0 == unit.sourceRoot }
        config.include.removeAll { $0 == unit.name }
        config.exclude.removeAll { $0 == unit.name }
        config.autoMergeUnits.removeAll { $0 == unit.name }
        config.prUnits.removeAll { $0 == unit.name }
        units.removeAll { $0.id == unit.id }
    }

    func removeSkillPath(_ path: String) {
        let names = units
            .filter { $0.isExternal && !$0.isFolderSource && $0.sourceRoot == path }
            .map(\.name)
        config.skillPaths.removeAll { $0 == path }
        units.removeAll { $0.isExternal && !$0.isFolderSource && $0.sourceRoot == path }
        clearOverrides(for: names)
    }

    func removeSkillFolder(_ path: String) {
        let names = units
            .filter { $0.isFolderSource && $0.sourceRoot == path }
            .map(\.name)
        config.skillFolders.removeAll { $0 == path }
        units.removeAll { $0.isFolderSource && $0.sourceRoot == path }
        clearOverrides(for: names)
    }

    func openUnitFile(_ unit: ReviewUnit) {
        guard unit.exists, !unit.path.isEmpty else {
            unitActionError = ReviewUnitError.cannotOpen(unit.displayPath).localizedDescription
            return
        }
        if !NSWorkspace.shared.open(URL(fileURLWithPath: unit.path)) {
            unitActionError = ReviewUnitError.cannotOpen(unit.displayPath).localizedDescription
        }
    }

    func runUnit(_ unit: ReviewUnit) {
        guard unit.canRun, !hasRunningUnit else { return }
        unitRunStates[unit.id] = .running
        Task {
            do {
                _ = try await daemonControl.reviewUnit(unit.name)
                unitRunStates[unit.id] = .completed
                scheduleRunStateReset(for: unit.id)
            } catch {
                unitRunStates[unit.id] = .failed(error.localizedDescription)
            }
        }
    }

    func runState(for unit: ReviewUnit) -> UnitRunState? {
        unitRunStates[unit.id]
    }

    var hasRunningUnit: Bool {
        unitRunStates.values.contains(.running)
    }

    func reloadUnits() async {
        catalogState = .loading
        do {
            units = try await unitCatalogControl.load().sorted(by: unitSort)
            catalogState = .loaded
        } catch {
            catalogState = .failed(error.localizedDescription)
        }
    }

    func openRawConfig() {
        Task {
            do {
                try await daemonControl.openConfig()
            } catch {
                saveState = .failed(error.localizedDescription)
            }
        }
    }

    /// Serialized autosave: persists the current config, folds in any server-side
    /// normalization, and re-runs if the user edited again mid-flight.
    private func persist() async {
        guard !isPersisting else { return }
        isPersisting = true
        defer { isPersisting = false }

        repeat {
            let attempt = config
            let sourcesChanged =
                attempt.skillPaths != lastPersisted?.skillPaths ||
                attempt.skillFolders != lastPersisted?.skillFolders
            saveState = .saving
            do {
                let normalized = try await control.save(attempt)
                if config == attempt, config != normalized {
                    config = normalized
                }
                lastPersisted = normalized
                saveState = .saved
                scheduleSavedReset()
                if sourcesChanged { await reloadUnits() }
            } catch {
                saveState = .failed(error.localizedDescription)
                return
            }
        } while config != lastPersisted
    }

    private func scheduleSavedReset() {
        savedResetTask?.cancel()
        savedResetTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled else { return }
            if self?.saveState == .saved { self?.saveState = .idle }
        }
    }

    private func scheduleRunStateReset(for id: String) {
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            if self?.unitRunStates[id] == .completed {
                self?.unitRunStates[id] = nil
            }
        }
    }

    private func unitSort(_ lhs: ReviewUnit, _ rhs: ReviewUnit) -> Bool {
        let order = ["skill": 0, "agent": 1, "unknown": 2]
        let left = order[lhs.type, default: 2]
        let right = order[rhs.type, default: 2]
        if left != right { return left < right }
        return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
    }

    private func clearOverrides(for names: [String]) {
        let removed = Set(names)
        config.include.removeAll { removed.contains($0) }
        config.exclude.removeAll { removed.contains($0) }
        config.autoMergeUnits.removeAll { removed.contains($0) }
        config.prUnits.removeAll { removed.contains($0) }
    }
}
