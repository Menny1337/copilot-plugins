import Combine
import Foundation
import LoopsModels

enum RunHistoryDateFilter: String, CaseIterable, Identifiable {
    case all
    case today
    case lastSevenDays
    case lastThirtyDays

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "Any date"
        case .today: return "Today"
        case .lastSevenDays: return "7 days"
        case .lastThirtyDays: return "30 days"
        }
    }

    func includes(_ date: Date?, now: Date = Date(), calendar: Calendar = .current) -> Bool {
        guard let date else { return self == .all }
        switch self {
        case .all:
            return true
        case .today:
            return calendar.isDate(date, inSameDayAs: now)
        case .lastSevenDays:
            return date >= now.addingTimeInterval(-7 * 24 * 60 * 60)
        case .lastThirtyDays:
            return date >= now.addingTimeInterval(-30 * 24 * 60 * 60)
        }
    }
}

enum RunHistoryDetailTab: String, CaseIterable, Identifiable {
    case events
    case stdout
    case stderr
    case copilotJSONL

    var id: String { rawValue }

    var title: String {
        switch self {
        case .events: return "Events"
        case .stdout: return "stdout"
        case .stderr: return "stderr"
        case .copilotJSONL: return "Copilot JSONL"
        }
    }

    var systemImage: String {
        switch self {
        case .events: return "list.bullet.rectangle"
        case .stdout: return LiveRunStream.stdout.systemImage
        case .stderr: return LiveRunStream.stderr.systemImage
        case .copilotJSONL: return LiveRunStream.copilotJSONL.systemImage
        }
    }
}

struct CopilotLoopRunKey: Hashable, Identifiable, Codable, CustomStringConvertible {
    static let separator = "\u{1F}"

    var loopID: String
    var runID: String

    init(loopID: String, runID: String) {
        self.loopID = loopID
        self.runID = runID
    }

    init(_ run: RunRecord) {
        self.init(loopID: run.loopId, runID: run.id)
    }

    var id: String { rawValue }
    var rawValue: String { "\(loopID)\(Self.separator)\(runID)" }
    var description: String { "\(loopID)/\(runID)" }
}

extension RunRecord {
    var loopRunKey: CopilotLoopRunKey { CopilotLoopRunKey(self) }
}

struct RunHistoryRunData: Equatable {
    var eventsJSONL: String
    var stdout: String
    var stderr: String
    var copilotJSONL: String
    var paths: [LiveRunStream: String]

    init(
        eventsJSONL: String = "",
        stdout: String = "",
        stderr: String = "",
        copilotJSONL: String = "",
        paths: [LiveRunStream: String] = [:]
    ) {
        self.eventsJSONL = eventsJSONL
        self.stdout = stdout
        self.stderr = stderr
        self.copilotJSONL = copilotJSONL
        self.paths = paths
    }

    func text(for tab: RunHistoryDetailTab) -> String {
        switch tab {
        case .events: return eventsJSONL
        case .stdout: return stdout
        case .stderr: return stderr
        case .copilotJSONL: return copilotJSONL
        }
    }

    var combinedArtifactText: String {
        [eventsJSONL, stdout, stderr, copilotJSONL]
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }

    var hasAnyLogText: Bool { !combinedArtifactText.isEmpty }
}

struct RunHistoryPageRequest: Equatable {
    var offset: Int
    var limit: Int
    var searchText: String
    var loopID: String?
    var status: RunStatus?
    var dateFilter: RunHistoryDateFilter
}

struct RunHistoryCallbacks {
    var retry: (CopilotLoopRunKey, RunRecord) -> Void = { _, _ in }
    var openArtifact: (CopilotLoopRunKey, CopilotLoopArtifact) -> Void = { _, _ in }
    var copy: (CopilotLoopRunKey?, String) -> Void = { _, _ in }
    var loadMore: (RunHistoryPageRequest) -> Void = { _ in }

    static let none = RunHistoryCallbacks()
}

@MainActor
final class RunHistoryViewModel: ObservableObject {
    @Published var loops: [LoopDefinition]
    @Published var runs: [RunRecord]
    @Published var runDataByKey: [CopilotLoopRunKey: RunHistoryRunData]
    @Published var searchText: String
    @Published var selectedLoopID: String?
    @Published var selectedStatus: RunStatus?
    @Published var dateFilter: RunHistoryDateFilter
    @Published var visibleLimit: Int
    @Published var selectedRunKey: CopilotLoopRunKey?
    @Published var selectedDetailTab: RunHistoryDetailTab

    let pageSize: Int
    private let callbacks: RunHistoryCallbacks

    init(
        loops: [LoopDefinition],
        runs: [RunRecord],
        runDataByKey: [CopilotLoopRunKey: RunHistoryRunData] = [:],
        searchText: String = "",
        selectedLoopID: String? = nil,
        selectedStatus: RunStatus? = nil,
        dateFilter: RunHistoryDateFilter = .all,
        initialLimit: Int = 25,
        pageSize: Int = 25,
        selectedRunKey: CopilotLoopRunKey? = nil,
        callbacks: RunHistoryCallbacks = .none
    ) {
        self.loops = loops.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        self.runs = runs
        self.runDataByKey = runDataByKey
        self.searchText = searchText
        self.selectedLoopID = selectedLoopID
        self.selectedStatus = selectedStatus
        self.dateFilter = dateFilter
        self.visibleLimit = min(max(1, initialLimit), 500)
        self.pageSize = min(max(1, pageSize), 200)
        self.selectedRunKey = selectedRunKey ?? runs.sortedNewestFirst().first?.loopRunKey
        self.selectedDetailTab = .events
        self.callbacks = callbacks
    }

    convenience init(
        loopStates: [LoopState],
        runs: [RunRecord],
        runDataByKey: [CopilotLoopRunKey: RunHistoryRunData] = [:],
        searchText: String = "",
        selectedLoopID: String? = nil,
        selectedStatus: RunStatus? = nil,
        dateFilter: RunHistoryDateFilter = .all,
        initialLimit: Int = 25,
        pageSize: Int = 25,
        selectedRunKey: CopilotLoopRunKey? = nil,
        callbacks: RunHistoryCallbacks = .none
    ) {
        self.init(
            loops: loopStates.map(\.definition),
            runs: runs,
            runDataByKey: runDataByKey,
            searchText: searchText,
            selectedLoopID: selectedLoopID,
            selectedStatus: selectedStatus,
            dateFilter: dateFilter,
            initialLimit: initialLimit,
            pageSize: pageSize,
            selectedRunKey: selectedRunKey,
            callbacks: callbacks
        )
    }

    var filteredRuns: [RunRecord] {
        runs.sortedNewestFirst().filter { run in
            if let selectedLoopID, run.loopId != selectedLoopID { return false }
            if let selectedStatus, run.status != selectedStatus { return false }
            if !dateFilter.includes(date(for: run)) { return false }
            if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return searchableText(for: run).localizedCaseInsensitiveContains(searchText)
            }
            return true
        }
    }

    var visibleRuns: [RunRecord] { Array(filteredRuns.prefix(visibleLimit)) }
    var hasMore: Bool { filteredRuns.count > visibleLimit }
    var selectedRun: RunRecord? {
        guard let selectedRunKey else { return nil }
        return visibleRuns.first { $0.loopRunKey == selectedRunKey }
            ?? filteredRuns.first { $0.loopRunKey == selectedRunKey }
    }

    func loopName(for loopID: String) -> String {
        loops.first { $0.id == loopID }?.name ?? loopID
    }

    func select(_ run: RunRecord) {
        selectedRunKey = run.loopRunKey
    }

    func data(for run: RunRecord) -> RunHistoryRunData {
        runDataByKey[run.loopRunKey] ?? RunHistoryRunData()
    }

    func artifacts(for run: RunRecord) -> [CopilotLoopArtifact] {
        CopilotLoopArtifactDetector.detect(in: data(for: run).combinedArtifactText)
    }

    func artifactCountText(for run: RunRecord) -> String {
        let count = artifacts(for: run).count
        if count == 0 { return "—" }
        return "\(count)"
    }

    func retry(_ run: RunRecord) {
        guard canRetry(run) else { return }
        callbacks.retry(run.loopRunKey, run)
    }

    func canRetry(_ run: RunRecord) -> Bool {
        run.status.canRetryFromHistory
    }

    func open(_ artifact: CopilotLoopArtifact) {
        guard let run = selectedRun else { return }
        callbacks.openArtifact(run.loopRunKey, artifact)
    }

    func copyDetailText() {
        guard let run = selectedRun else { return }
        callbacks.copy(run.loopRunKey, data(for: run).text(for: selectedDetailTab))
    }

    func loadMore() {
        let offset = visibleLimit
        visibleLimit = min(visibleLimit + pageSize, 10_000)
        callbacks.loadMore(
            RunHistoryPageRequest(
                offset: offset,
                limit: pageSize,
                searchText: searchText,
                loopID: selectedLoopID,
                status: selectedStatus,
                dateFilter: dateFilter
            )
        )
    }

    func startedText(for run: RunRecord, now: Date = Date()) -> String {
        guard let date = date(for: run) else { return "—" }
        return LoopProjection.relativeDescription(from: now, to: date)
    }

    func durationText(for run: RunRecord, now: Date = Date()) -> String {
        if let duration = LoopProjection.runDuration(run) {
            return LiveRunViewModel.formatDuration(duration)
        }
        if run.status.isActiveOutcome, let start = LoopProjection.parseTimestamp(run.startedAt) {
            return LiveRunViewModel.formatDuration(now.timeIntervalSince(start))
        }
        return "—"
    }

    func attemptText(for run: RunRecord) -> String {
        let attempts = run.attempts.count
        guard attempts > 0 else { return "No attempts" }
        return attempts == 1 ? "1 attempt" : "\(attempts) attempts"
    }

    func lineageText(for run: RunRecord) -> String? {
        guard let retryOf = run.retryOf, !retryOf.isEmpty else { return nil }
        return "Retry of \(retryOf)"
    }

    private func date(for run: RunRecord) -> Date? {
        LoopProjection.parseTimestamp(run.startedAt)
            ?? LoopProjection.parseTimestamp(run.scheduledFor)
            ?? LoopProjection.parseTimestamp(run.endedAt)
    }

    private func searchableText(for run: RunRecord) -> String {
        [
            run.id,
            run.loopId,
            loopName(for: run.loopId),
            run.sessionId,
            run.status.displayName,
            run.trigger.rawValue,
            run.retryOf ?? "",
        ].joined(separator: " ")
    }
}

private extension Array where Element == RunRecord {
    func sortedNewestFirst() -> [RunRecord] {
        sorted { lhs, rhs in
            sortDate(lhs) > sortDate(rhs)
        }
    }

    func sortDate(_ run: RunRecord) -> Date {
        LoopProjection.parseTimestamp(run.startedAt)
            ?? LoopProjection.parseTimestamp(run.scheduledFor)
            ?? LoopProjection.parseTimestamp(run.endedAt)
            ?? .distantPast
    }
}

extension RunStatus {
    var canRetryFromHistory: Bool {
        switch self {
        case .failed, .timedOut, .cancelled, .launchFailed:
            return true
        case .starting, .running, .stopping, .succeeded, .skippedOverlap, .skippedMissed, .skippedPaused, .approvalBlocked:
            return false
        }
    }
}
