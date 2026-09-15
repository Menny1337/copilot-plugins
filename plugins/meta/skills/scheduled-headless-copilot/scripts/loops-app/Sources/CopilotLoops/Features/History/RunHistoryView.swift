import LoopsModels
import SwiftUI

struct RunHistoryView: View {
    @ObservedObject var model: RunHistoryViewModel

    init(model: RunHistoryViewModel) {
        self.model = model
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LoopsSectionHeader("History", subtitle: "Newest first run records, bounded logs, and artifacts")
            RunHistoryFilters(model: model)
            HStack(alignment: .top, spacing: ManagerLayout.columnGap) {
                RunHistoryList(model: model)
                    .frame(minWidth: HistoryLayout.runListMinWidth, maxWidth: .infinity)
                RunHistoryInspector(model: model)
                    .frame(
                        minWidth: HistoryLayout.inspectorMinWidth,
                        idealWidth: HistoryLayout.inspectorIdealWidth,
                        maxWidth: HistoryLayout.inspectorMaxWidth
                    )
            }
        }
        .padding(ManagerLayout.screenPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct RunHistoryFilters: View {
    @ObservedObject var model: RunHistoryViewModel

    var body: some View {
        LoopsCard {
            HStack(spacing: HistoryLayout.filterSpacing) {
                TextField("Search runs", text: $model.searchText)
                    .textFieldStyle(.roundedBorder)
                    .frame(
                        minWidth: HistoryLayout.searchFieldMinWidth,
                        maxWidth: HistoryLayout.searchFieldMaxWidth
                    )
                    .accessibilityLabel("Search runs")
                Picker("Loop", selection: $model.selectedLoopID) {
                    Text("All loops").tag(Optional<String>.none)
                    ForEach(model.loops) { loop in
                        Text(loop.name).tag(Optional(loop.id))
                    }
                }
                .frame(
                    minWidth: HistoryLayout.loopFilterMinWidth,
                    maxWidth: HistoryLayout.loopFilterMaxWidth
                )
                Picker("Status", selection: $model.selectedStatus) {
                    Text("Any status").tag(Optional<RunStatus>.none)
                    ForEach(RunStatus.allCases, id: \.rawValue) { status in
                        Text(status.displayName).tag(Optional(status))
                    }
                }
                .frame(
                    minWidth: HistoryLayout.statusFilterMinWidth,
                    maxWidth: HistoryLayout.statusFilterMaxWidth
                )
                Picker("Date", selection: $model.dateFilter) {
                    ForEach(RunHistoryDateFilter.allCases) { filter in
                        Text(filter.title).tag(filter)
                    }
                }
                .frame(
                    minWidth: HistoryLayout.dateFilterMinWidth,
                    maxWidth: HistoryLayout.dateFilterMaxWidth
                )
                Spacer(minLength: HistoryLayout.filterTrailingGap)
                // Drops out instead of forcing the filter bar wider than the
                // detail column when the window is near its minimum width.
                ViewThatFits(in: .horizontal) {
                    Label("\(model.visibleRuns.count) of \(model.filteredRuns.count)", systemImage: "line.3.horizontal.decrease.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .fixedSize()
                        .accessibilityLabel("\(model.visibleRuns.count) of \(model.filteredRuns.count) runs shown")
                    Color.clear
                        .frame(width: 0, height: 0)
                        .accessibilityHidden(true)
                }
            }
        }
    }
}

private struct RunHistoryList: View {
    @ObservedObject var model: RunHistoryViewModel

    var body: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 8) {
                RunHistoryHeaderRow()
                Divider()
                if model.visibleRuns.isEmpty {
                    LoopsEmptyState(
                        title: "No matching runs",
                        message: "Adjust search, loop, status, or date filters.",
                        systemImage: "clock.arrow.circlepath"
                    )
                } else {
                    ScrollView {
                        LazyVStack(spacing: 4) {
                            ForEach(model.visibleRuns, id: \.loopRunKey) { run in
                                RunHistoryRow(
                                    model: model,
                                    run: run,
                                    isSelected: run.loopRunKey == model.selectedRunKey
                                )
                            }
                        }
                    }
                    HStack {
                        Text(model.hasMore ? "More runs are available." : "End of filtered history.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Load more") { model.loadMore() }
                            .disabled(!model.hasMore)
                            .keyboardShortcut("l", modifiers: [.command])
                    }
                    .padding(.top, 4)
                }
            }
        }
    }
}

private struct RunHistoryHeaderRow: View {
    var body: some View {
        HStack(spacing: HistoryLayout.columnSpacing) {
            Text("Status").frame(width: HistoryLayout.statusColumnWidth, alignment: .leading)
            Text("Loop").frame(minWidth: HistoryLayout.loopColumnMinWidth, maxWidth: .infinity, alignment: .leading)
            Text("Started").frame(width: HistoryLayout.startedColumnWidth, alignment: .leading)
            Text("Duration").frame(width: HistoryLayout.durationColumnWidth, alignment: .leading)
            Text("Artifacts").frame(width: HistoryLayout.artifactsColumnWidth, alignment: .leading)
        }
        .font(.caption.weight(.semibold))
        .lineLimit(1)
        .foregroundStyle(.secondary)
        .padding(.horizontal, HistoryLayout.rowHorizontalPadding)
    }
}

private struct RunHistoryRow: View {
    @ObservedObject var model: RunHistoryViewModel
    let run: RunRecord
    let isSelected: Bool

    var body: some View {
        Button {
            model.select(run)
        } label: {
            HStack(alignment: .center, spacing: HistoryLayout.columnSpacing) {
                LoopsStatusPill(title: run.status.displayName, systemImage: run.status.systemImage, tint: run.status.tint)
                    .frame(width: HistoryLayout.statusColumnWidth, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(model.loopName(for: run.loopId))
                            .font(.callout.weight(.medium))
                            .lineLimit(1)
                        if let lineage = model.lineageText(for: run) {
                            Text(lineage)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Text("\(run.trigger.rawValue) • \(model.attemptText(for: run)) • \(run.id)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(minWidth: HistoryLayout.loopColumnMinWidth, maxWidth: .infinity, alignment: .leading)
                Text(model.startedText(for: run))
                    .font(.caption.monospacedDigit())
                    .lineLimit(1)
                    .frame(width: HistoryLayout.startedColumnWidth, alignment: .leading)
                Text(model.durationText(for: run))
                    .font(.caption.monospacedDigit())
                    .lineLimit(1)
                    .frame(width: HistoryLayout.durationColumnWidth, alignment: .leading)
                RunHistoryArtifactSummary(artifacts: model.artifacts(for: run))
                    .frame(width: HistoryLayout.artifactsColumnWidth, alignment: .leading)
            }
            .padding(.horizontal, HistoryLayout.rowHorizontalPadding)
            .padding(.vertical, 7)
            .background(isSelected ? Color.accentColor.opacity(0.16) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(run.status.displayName), \(model.loopName(for: run.loopId)), \(model.durationText(for: run))")
    }
}

private struct RunHistoryArtifactSummary: View {
    let artifacts: [CopilotLoopArtifact]

    var body: some View {
        if artifacts.isEmpty {
            Text("—")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else {
            HStack(spacing: 4) {
                ForEach(Array(artifacts.prefix(3))) { artifact in
                    Image(systemName: artifact.kind.systemImage)
                        .foregroundStyle(.secondary)
                }
                Text("\(artifacts.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .accessibilityLabel("\(artifacts.count) artifacts available")
        }
    }
}

private struct RunHistoryInspector: View {
    @ObservedObject var model: RunHistoryViewModel

    var body: some View {
        LoopsCard {
            if let run = model.selectedRun {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top, spacing: 8) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.loopName(for: run.loopId))
                                .font(.headline)
                                .lineLimit(2)
                            Text(run.id)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        Button("Retry") { model.retry(run) }
                            .disabled(!model.canRetry(run))
                    }
                    RunHistoryMetadata(model: model, run: run)
                    RunHistoryArtifacts(model: model, run: run)
                    Picker("Detail", selection: $model.selectedDetailTab) {
                        ForEach(RunHistoryDetailTab.allCases) { tab in
                            Label(tab.title, systemImage: tab.systemImage).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)
                    RunHistoryDetailText(model: model, run: run)
                    Button("Copy tab text") { model.copyDetailText() }
                        .disabled(model.data(for: run).text(for: model.selectedDetailTab).isEmpty)
                }
            } else {
                LoopsEmptyState(
                    title: "Select a run",
                    message: "Run details, bounded event/log streams, retry actions, and artifacts appear here.",
                    systemImage: "sidebar.right"
                )
            }
        }
    }
}

private struct RunHistoryMetadata: View {
    @ObservedObject var model: RunHistoryViewModel
    let run: RunRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                LoopsStatusPill(title: run.status.displayName, systemImage: run.status.systemImage, tint: run.status.tint)
                Spacer()
                Text(model.durationText(for: run))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            metadataRow("Trigger", run.trigger.rawValue)
            metadataRow("Attempts", model.attemptText(for: run))
            metadataRow("Session", run.sessionId)
            if let retry = model.lineageText(for: run) { metadataRow("Lineage", retry) }
            if let exitCode = run.exitCode { metadataRow("Exit", "\(exitCode)") }
            if let signal = run.signal { metadataRow("Signal", signal) }
        }
        .font(.caption)
    }

    private func metadataRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(.secondary)
                .frame(width: 60, alignment: .leading)
            Text(value)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }
}

private struct RunHistoryArtifacts: View {
    @ObservedObject var model: RunHistoryViewModel
    let run: RunRecord

    var body: some View {
        let artifacts = model.artifacts(for: run)
        VStack(alignment: .leading, spacing: 6) {
            Text("Artifacts")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if artifacts.isEmpty {
                Text("No artifacts detected in supplied bounded text.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 112), spacing: 6)], alignment: .leading, spacing: 6) {
                    ForEach(artifacts) { artifact in
                        Button {
                            model.open(artifact)
                        } label: {
                            Label(artifact.displayValue, systemImage: artifact.kind.systemImage)
                                .lineLimit(1)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
            }
        }
    }
}

private struct RunHistoryDetailText: View {
    @ObservedObject var model: RunHistoryViewModel
    let run: RunRecord

    var body: some View {
        let data = model.data(for: run)
        let text = data.text(for: model.selectedDetailTab)
        VStack(alignment: .leading, spacing: 6) {
            if model.selectedDetailTab == .events {
                let issues = LiveRunEventParser.timeline(for: run, eventsJSONL: data.eventsJSONL).issues
                ForEach(issues) { issue in
                    Label(issue.message, systemImage: issue.severity == .error ? "exclamationmark.triangle.fill" : "info.circle")
                        .font(.caption)
                        .foregroundStyle(issue.severity == .error ? LoopsPalette.failure : LoopsPalette.warning)
                }
            }
            ScrollView {
                if text.isEmpty {
                    LoopsEmptyState(
                        title: "No \(model.selectedDetailTab.title)",
                        message: "The AppModel can supply bounded detail text for this run when available.",
                        systemImage: model.selectedDetailTab.systemImage
                    )
                } else {
                    Text(text)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .padding(9)
                }
            }
            .frame(minHeight: 190, maxHeight: 260)
            .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.4), lineWidth: 0.5)
            }
        }
    }
}

private struct RunHistoryPreviewHost: View {
    @StateObject private var model = RunHistoryViewModel(
        loops: [LoopsPreviewData.dependencyLoop, LoopsPreviewData.maintenanceLoop, LoopsPreviewData.draftLoop],
        runs: RunHistoryPreviewHost.previewRuns,
        runDataByKey: RunHistoryPreviewHost.previewRunData,
        initialLimit: 10
    )

    var body: some View {
        RunHistoryView(model: model)
            .frame(width: 1040, height: 640)
    }

    static let previewRuns: [RunRecord] = {
        let base = [LoopsPreviewData.runningRun, LoopsPreviewData.failedRun, LoopsPreviewData.successfulRun]
        let statuses: [RunStatus] = [.timedOut, .cancelled, .skippedOverlap, .skippedMissed, .skippedPaused, .approvalBlocked, .launchFailed]
        let extras = statuses.enumerated().map { index, status in
            RunRecord(
                id: "run-preview-\(status.rawValue)",
                loopId: index.isMultiple(of: 2) ? LoopsPreviewData.dependencyLoop.id : LoopsPreviewData.maintenanceLoop.id,
                sessionId: "44444444-4444-4444-8444-4444444444\(String(format: "%02d", index))",
                trigger: index.isMultiple(of: 2) ? .schedule : .retry,
                status: status,
                scheduledFor: "2026-07-2\(index)T01:00:00Z",
                startedAt: "2026-07-2\(index)T01:00:02Z",
                endedAt: "2026-07-2\(index)T01:03:02Z",
                exitCode: status == .launchFailed ? 127 : nil,
                retryOf: index == 1 ? LoopsPreviewData.failedRun.id : nil,
                attempts: [RunAttempt(number: 1, startedAt: "2026-07-2\(index)T01:00:02Z", endedAt: "2026-07-2\(index)T01:03:02Z")]
            )
        }
        return base + extras
    }()

    static let previewRunData: [CopilotLoopRunKey: RunHistoryRunData] = [
        LoopsPreviewData.successfulRun.loopRunKey: RunHistoryRunData(
            eventsJSONL: """
            {"ts":"2026-07-24T01:00:03Z","phase":"preflight","message":"Validated approvals"}
            {"ts":"2026-07-24T01:00:04Z","phase":"running","message":"Created report"}
            {"ts":"2026-07-24T01:04:18Z","phase":"terminal","status":"succeeded","sessionId":"11111111-1111-4111-8111-111111111111"}
            """,
            stdout: "Created pull request https://github.com/acme/web-app/pull/42\nM reports/dependency-report.md\nCommit abcdef1234567890abcdef1234567890abcdef12\n",
            copilotJSONL: #"{"changedFile":"reports/dependency-report.md","sessionId":"11111111-1111-4111-8111-111111111111"}"#
        ),
        LoopsPreviewData.failedRun.loopRunKey: RunHistoryRunData(
            eventsJSONL: """
            {"ts":"2026-07-24T02:30:02Z","phase":"starting","message":"Launching script"}
            {"ts":"2026-07-24T02:30:11Z","phase":"terminal","status":"failed"}
            """,
            stderr: "fatal: not a git repository\n"
        ),
    ]
}

struct RunHistoryView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            RunHistoryPreviewHost()
                .previewDisplayName("History — Light")
            RunHistoryPreviewHost()
                .preferredColorScheme(.dark)
                .previewDisplayName("History — Dark")
        }
    }
}
