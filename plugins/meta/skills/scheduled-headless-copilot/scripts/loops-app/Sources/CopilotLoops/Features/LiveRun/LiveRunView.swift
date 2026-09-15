import LoopsModels
import SwiftUI

struct LiveRunView: View {
    @ObservedObject var model: LiveRunViewModel

    init(model: LiveRunViewModel) {
        self.model = model
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LiveRunHeader(model: model)
            HStack(alignment: .top, spacing: 14) {
                LiveRunPhaseTimeline(result: model.timeline)
                    .frame(width: 230)
                LiveRunLogPanel(model: model)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .contain)
    }
}

private struct LiveRunHeader: View {
    @ObservedObject var model: LiveRunViewModel

    var body: some View {
        LoopsCard {
            TimelineView(.periodic(from: Date(), by: 1)) { context in
                HStack(alignment: .center, spacing: 14) {
                    Image(systemName: "infinity")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(LoopsPalette.identity)
                        .frame(width: 42, height: 42)
                        .background(LoopsPalette.identity.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 8) {
                            Text("Live Run: \(model.title)")
                                .font(.title3.weight(.semibold))
                                .lineLimit(1)
                            LoopsStatusPill(
                                title: model.status.displayName,
                                systemImage: model.status.systemImage,
                                tint: model.status.tint
                            )
                        }
                        HStack(spacing: 14) {
                            Label("Elapsed \(model.elapsedText(now: context.date))", systemImage: "timer")
                            Label("Run \(model.runKey.description)", systemImage: "number")
                                .lineLimit(1)
                            if model.stopRequested {
                                Label("Stop requested", systemImage: "stop.circle")
                                    .foregroundStyle(LoopsPalette.warning)
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 12)
                    Button(role: .destructive) {
                        model.requestStop()
                    } label: {
                        Label(model.stopRequested ? "Stopping…" : "Stop", systemImage: "stop.fill")
                    }
                    .keyboardShortcut(".", modifiers: .command)
                    .disabled(!model.canStop)
                    .accessibilityHint("Requests cancellation through the supplied stop callback.")
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct LiveRunPhaseTimeline: View {
    let result: LiveRunTimelineResult

    var body: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 12) {
                LoopsSectionHeader("Phases", subtitle: "events.jsonl timeline")
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(result.phases) { snapshot in
                        LiveRunPhaseRow(snapshot: snapshot)
                    }
                }
                if !result.issues.isEmpty {
                    Divider()
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(result.issues) { issue in
                            Label(issue.message, systemImage: issue.severity == .error ? "exclamationmark.triangle.fill" : "info.circle")
                                .font(.caption)
                                .foregroundStyle(issue.severity == .error ? LoopsPalette.failure : LoopsPalette.warning)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .accessibilityLabel("Timeline issues")
                }
            }
        }
    }
}

private struct LiveRunPhaseRow: View {
    let snapshot: LiveRunPhaseSnapshot

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: snapshot.state.systemImage)
                .foregroundStyle(snapshot.state.tint)
                .font(.system(size: 13, weight: .semibold))
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(snapshot.phase.title)
                        .font(.caption.weight(.semibold))
                    if let timestamp = snapshot.timestamp {
                        Text(timestamp)
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Text(snapshot.detail ?? snapshot.state.label)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(snapshot.phase.title), \(snapshot.state.label)")
    }
}

private struct LiveRunLogPanel: View {
    @ObservedObject var model: LiveRunViewModel

    var body: some View {
        LoopsCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Picker("Stream", selection: $model.selectedStream) {
                        ForEach(LiveRunStream.allCases) { stream in
                            Label(stream.title, systemImage: stream.systemImage).tag(stream)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 430)
                    Toggle("Follow tail", isOn: $model.followTail)
                        .toggleStyle(.checkbox)
                    Spacer(minLength: 8)
                    Button("Copy visible") { model.copySelectedText() }
                        .keyboardShortcut("c", modifiers: [.command, .shift])
                    Button("Open log") { model.openSelectedLog() }
                        .disabled(model.selectedPath == nil)
                }
                LiveRunStreamWarning(log: model.log(for: model.selectedStream))
                LiveRunLogText(model: model)
                    .frame(minHeight: 280)
                LiveRunArtifactsBar(artifacts: model.selectedArtifacts, open: model.open(_:))
            }
        }
    }
}

private struct LiveRunStreamWarning: View {
    let log: BoundedLiveRunLog

    var body: some View {
        if log.isTruncated {
            Label(
                "Showing the newest bounded tail; dropped \(log.droppedLines) lines / \(log.droppedBytes) bytes in memory.",
                systemImage: "scissors"
            )
            .font(.caption)
            .foregroundStyle(LoopsPalette.warning)
            .accessibilityLabel("Log buffer truncated")
        }
    }
}

private struct LiveRunLogText: View {
    @ObservedObject var model: LiveRunViewModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let tailID = "live-run-log-tail"

    var body: some View {
        let text = model.selectedText
        ScrollViewReader { proxy in
            ScrollView {
                if text.isEmpty {
                    LoopsEmptyState(
                        title: "No \(model.selectedStream.title) yet",
                        message: "The integrator can append bounded chunks as the LogTailer observes this stream.",
                        systemImage: model.selectedStream.systemImage
                    )
                } else {
                    Text(text)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .padding(10)
                }
                Color.clear.frame(height: 1).id(tailID)
            }
            .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.4), lineWidth: 0.5)
            }
            .onAppear { scrollToTail(proxy) }
            .onChange(of: text) { _ in scrollToTail(proxy) }
            .onChange(of: model.selectedStream) { _ in scrollToTail(proxy) }
        }
    }

    private func scrollToTail(_ proxy: ScrollViewProxy) {
        guard model.followTail else { return }
        DispatchQueue.main.async {
            if reduceMotion {
                proxy.scrollTo(tailID, anchor: .bottom)
            } else {
                withAnimation(.easeOut(duration: 0.15)) {
                    proxy.scrollTo(tailID, anchor: .bottom)
                }
            }
        }
    }
}

private struct LiveRunArtifactsBar: View {
    let artifacts: [CopilotLoopArtifact]
    let open: (CopilotLoopArtifact) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Detected artifacts")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if artifacts.isEmpty {
                Text("No artifacts detected in the bounded selected stream.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(artifacts) { artifact in
                            Button {
                                open(artifact)
                            } label: {
                                Label(artifact.displayValue, systemImage: artifact.kind.systemImage)
                                    .lineLimit(1)
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .accessibilityLabel("Open \(artifact.kind.title) \(artifact.displayValue)")
                        }
                    }
                }
            }
        }
    }
}

private extension LiveRunPhaseState {
    var label: String {
        switch self {
        case .waiting: return "Waiting"
        case .active: return "Active"
        case .complete: return "Complete"
        case .skipped: return "Skipped"
        case .issue: return "Issue"
        }
    }

    var tint: Color {
        switch self {
        case .waiting: return LoopsPalette.inactive
        case .active: return LoopsPalette.running
        case .complete: return LoopsPalette.success
        case .skipped: return LoopsPalette.inactive
        case .issue: return LoopsPalette.failure
        }
    }

    var systemImage: String {
        switch self {
        case .waiting: return "circle"
        case .active: return "largecircle.fill.circle"
        case .complete: return "checkmark.circle.fill"
        case .skipped: return "minus.circle"
        case .issue: return "xmark.circle.fill"
        }
    }
}

private struct LiveRunPreviewHost: View {
    @StateObject private var model = LiveRunViewModel(
        loop: LoopsPreviewData.dependencyLoop,
        run: LoopsPreviewData.runningRun,
        stdout: "10:01:58  Starting run (run_8F3A7)\n10:01:59  Initializing Copilot agent…\n10:02:00  Fetching repository acme/web-app…\n10:02:04  Analyzing dependencies…\n10:02:31  Found 37 outdated packages\n10:02:45  Writing reports/dependency-report.md\n10:02:46  Created pull request https://github.com/acme/web-app/pull/42\n",
        stderr: "",
        copilotJSONL: #"{"type":"assistant.message","sessionId":"33333333-3333-4333-8333-333333333333","message":"Created PR"}"# + "\n",
        eventsJSONL: """
        {"ts":"2026-07-24T15:00:02Z","phase":"preflight","message":"Validated approvals"}
        {"ts":"2026-07-24T15:00:03Z","phase":"starting","message":"Launching Copilot"}
        {"ts":"2026-07-24T15:00:05Z","phase":"running","message":"Agent is producing output"}
        """
    )

    var body: some View {
        LiveRunView(model: model)
            .frame(width: 920, height: 560)
    }
}

struct LiveRunView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            LiveRunPreviewHost()
                .previewDisplayName("Live Run — Light")
            LiveRunPreviewHost()
                .preferredColorScheme(.dark)
                .previewDisplayName("Live Run — Dark")
        }
    }
}
