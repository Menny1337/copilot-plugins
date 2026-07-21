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

    @Published var config = Config()
    @Published private(set) var loadState: LoadState = .idle
    @Published private(set) var saveState: SaveState = .idle

    private let control: ConfigControlling
    private let daemonControl: DaemonControlling
    private var lastPersisted: Config?
    private var autosaveEnabled = false
    private var isPersisting = false
    private var cancellables = Set<AnyCancellable>()
    private var savedResetTask: Task<Void, Never>?

    init(control: ConfigControlling = ShellConfigControl(), daemonControl: DaemonControlling = ShellDaemonControl()) {
        self.control = control
        self.daemonControl = daemonControl
        configureAutosave()
    }

    /// Pre-loaded model for offscreen snapshot rendering (no daemon-ctl call and
    /// autosave stays disabled so renders never touch config.json).
    init(snapshot config: Config) {
        self.control = ShellConfigControl()
        self.daemonControl = ShellDaemonControl()
        self.config = config
        self.lastPersisted = config
        self.loadState = .loaded
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
            saveState = .saving
            do {
                let normalized = try await control.save(attempt)
                if config == attempt, config != normalized {
                    config = normalized
                }
                lastPersisted = normalized
                saveState = .saved
                scheduleSavedReset()
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
}
