import AppKit
import LoopsModels
import SwiftUI

struct ManagerWindow: View {
    @ObservedObject var model: AppModel

    var body: some View {
        NavigationSplitView {
            List(selection: sectionSelection) {
                Section("Copilot Loops") {
                    ForEach(LoopsSection.allCases) { section in
                        Label(section.title, systemImage: section.systemImage)
                            .tag(Optional(section))
                    }
                }
            }
            .navigationTitle("Copilot Loops")
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 7) {
                    if model.isRefreshing {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: model.menuBarSnapshot.aggregateStatus.systemImage)
                            .foregroundStyle(statusColor)
                    }
                    Text(statusText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 0)
                }
                .padding(10)
                .background(.regularMaterial)
            }
            .navigationSplitViewColumnWidth(
                min: ManagerLayout.sidebarMinWidth,
                ideal: ManagerLayout.sidebarIdealWidth,
                max: ManagerLayout.sidebarMaxWidth
            )
        } detail: {
            NavigationStack(path: $model.navigation.path) {
                sectionView(model.navigation.selectedSection)
                    .navigationDestination(for: LoopsRoute.self) { route in
                        destinationView(route)
                    }
            }
            // The window minimum lives on the detail column, never on the
            // `NavigationSplitView` itself: a minimum frame on the split view is
            // laid out at its own minimum and centered when the window is
            // narrower, which pushes the sidebar's leading edge out of the
            // window and clips its labels.
            .frame(
                minWidth: ManagerLayout.detailMinWidth,
                maxWidth: .infinity,
                minHeight: ManagerLayout.detailMinHeight,
                maxHeight: .infinity
            )
        }
        .toolbar {
            ToolbarItemGroup {
                Button {
                    model.requestOperationalRefresh()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(model.isRefreshing)
                .help("Refresh managed loop state")

                Menu {
                    Button("Copilot loop", systemImage: "sparkles") {
                        model.createLoop(kind: .copilot)
                    }
                    Button("Script or executable loop", systemImage: "terminal") {
                        model.createLoop(kind: .script)
                    }
                } label: {
                    Label("New loop", systemImage: "plus")
                }
            }
        }
        .task { model.start() }
        .onChange(of: model.navigation.path) { _ in
            model.handleNavigationChange()
        }
        .alert("Copilot Loops", isPresented: errorPresented) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "Unknown error")
        }
    }

    private var sectionSelection: Binding<LoopsSection?> {
        Binding(
            get: { model.navigation.selectedSection },
            set: { selection in
                if let selection { model.select(selection) }
            }
        )
    }

    private var errorPresented: Binding<Bool> {
        Binding(
            get: { model.errorMessage != nil },
            set: { visible in
                if !visible { model.errorMessage = nil }
            }
        )
    }

    private var statusText: String {
        let snapshot = model.menuBarSnapshot
        switch snapshot.aggregateStatus {
        case .running(let count): return count == 1 ? "1 loop running" : "\(count) loops running"
        case .failing: return "\(snapshot.failedCount) need attention"
        case .idle: return "\(model.loopStates.count) managed loops"
        }
    }

    private var statusColor: Color {
        switch model.menuBarSnapshot.aggregateStatus {
        case .running: return LoopsPalette.success
        case .failing: return LoopsPalette.failure
        case .idle: return LoopsPalette.inactive
        }
    }

    @ViewBuilder
    private func sectionView(_ section: LoopsSection) -> some View {
        switch section {
        case .dashboard:
            TimelineView(.periodic(from: Date(), by: 1)) { context in
                DashboardView(
                    snapshot: DashboardSnapshot.build(
                        from: model.loopStates,
                        runs: model.recentRuns,
                        now: context.date
                    ),
                    onLoopSelected: model.showLoop,
                    onNewLoop: { model.createLoop(kind: .copilot) },
                    onAllLoops: { model.select(.schedules) }
                )
            }
        case .schedules:
            SchedulesView(
                states: model.loopStates,
                onSelect: model.showLoop,
                onNewLoop: { model.createLoop(kind: .copilot) },
                onRunNow: { model.runNow(loopID: $0) },
                onTogglePause: { model.togglePause(loopID: $0, paused: $1) }
            )
        case .library:
            LibraryView(
                templateItems: model.templates.templates,
                issues: model.templates.errors,
                onUseTemplate: model.createLoop(templateID:),
                onCreateBlank: model.createLoop(kind:)
            )
        case .history:
            HistoryScreen(model: model)
        case .settings:
            SettingsView(viewModel: model.settingsViewModel())
        }
    }

    @ViewBuilder
    private func destinationView(_ route: LoopsRoute) -> some View {
        switch route {
        case .section(let section):
            sectionView(section)
        case .loopDetail(let loopID):
            if let state = model.state(for: loopID) {
                LoopDetailView(
                    state: state,
                    callbacks: LoopDetailCallbacks(
                        edit: model.editLoop,
                        enable: { model.enable(loopID: $0) },
                        runNow: { model.runNow(loopID: $0) },
                        pause: { model.pause(loopID: $0) },
                        resume: { model.resume(loopID: $0) },
                        openLiveRun: model.showLiveRun,
                        archive: { model.archive(loopID: $0) },
                        purge: { model.purge(loopID: $0) }
                    )
                )
            } else {
                MissingRouteView(
                    title: "Loop not found",
                    message: "The loop may have been archived, purged, or changed on disk."
                )
            }
        case .runDetail(let loopID, let runID):
            LiveRunRouteView(model: model, loopID: loopID, runID: runID)
        case .newLoop(let kind):
            BuilderRouteView(model: model, kind: kind, editingLoopID: nil)
        case .editLoop(let loopID):
            if let state = model.state(for: loopID) {
                BuilderRouteView(model: model, kind: state.definition.kind, editingLoopID: loopID)
            } else {
                MissingRouteView(
                    title: "Loop not found",
                    message: "The loop can no longer be edited because its definition is unavailable."
                )
            }
        }
    }
}

private struct HistoryScreen: View {
    @ObservedObject var appModel: AppModel
    @ObservedObject private var historyModel: RunHistoryViewModel

    init(model: AppModel) {
        self.appModel = model
        self.historyModel = model.historyViewModel()
    }

    var body: some View {
        RunHistoryView(model: historyModel)
            .onAppear {
                if let key = historyModel.selectedRunKey {
                    appModel.loadHistoryData(for: key)
                }
            }
            .onChange(of: historyModel.selectedRunKey) { key in
                if let key { appModel.loadHistoryData(for: key) }
            }
    }
}

private struct LiveRunRouteView: View {
    @ObservedObject var model: AppModel
    let loopID: String
    let runID: String

    var body: some View {
        Group {
            if let runModel = model.liveRunModel,
               runModel.runKey == CopilotLoopRunKey(loopID: loopID, runID: runID) {
                LiveRunView(model: runModel)
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Loading live run…")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: "\(loopID):\(runID)") {
            await model.loadLiveRun(loopID: loopID, runID: runID)
        }
    }
}

private struct BuilderRouteView: View {
    @ObservedObject var appModel: AppModel
    @StateObject private var builder: LoopBuilderState

    init(model: AppModel, kind: LoopKind, editingLoopID: String?) {
        self.appModel = model
        self._builder = StateObject(
            wrappedValue: model.makeBuilderState(kind: kind, editingLoopID: editingLoopID)
        )
    }

    var body: some View {
        LoopBuilderView(state: builder, callbacks: appModel.builderCallbacks(for: builder))
    }
}

private struct MissingRouteView: View {
    let title: String
    let message: String

    var body: some View {
        LoopsEmptyState(title: title, message: message, systemImage: "questionmark.folder")
    }
}

struct MenuBarRoot: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 30)) { context in
            VStack(spacing: 0) {
                if let error = model.errorMessage {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(LoopsPalette.failure)
                        .lineLimit(3)
                        .padding(10)
                        .frame(width: 300, alignment: .leading)
                        .background(LoopsPalette.failure.opacity(0.08))
                }
                MenuBarPopover(
                    snapshot: MenuBarSnapshot.build(from: model.loopStates, now: context.date),
                    onPauseAll: model.pauseAll,
                    onResumeAll: model.resumeAll,
                    onRunNow: { model.runNow(loopID: $0) },
                    onOpenApp: openManager,
                    onHistory: {
                        model.select(.history)
                        openManager()
                    },
                    onSettings: {
                        model.select(.settings)
                        openManager()
                    },
                    onQuit: { NSApp.terminate(nil) }
                )
            }
        }
        .task { model.start() }
    }

    private func openManager() {
        openWindow(id: CopilotLoopsApp.managerWindowID)
        NSApp.activate(ignoringOtherApps: true)
    }
}

struct MenuBarStatusLabel: View {
    let snapshot: MenuBarSnapshot

    var body: some View {
        Image(systemName: "infinity")
            .symbolRenderingMode(.monochrome)
            .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        switch snapshot.aggregateStatus {
        case .running(let count): return "Copilot Loops, \(count) running"
        case .failing: return "Copilot Loops, attention required"
        case .idle: return "Copilot Loops, idle"
        }
    }
}
