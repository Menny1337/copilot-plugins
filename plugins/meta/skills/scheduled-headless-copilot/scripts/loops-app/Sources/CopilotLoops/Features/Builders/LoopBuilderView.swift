import SwiftUI
import LoopsModels

// MARK: - Root builder

/// The public entry view for the create/edit flow. Composes the four steps
/// (Configure → Permissions → Schedule → Review), owns the step indicator, and
/// exposes Cancel / Back / Continue / Save Draft / Preflight controls. All
/// side-effects flow through `LoopBuilderCallbacks`.
///
/// AppModel integration:
///   ```swift
///   LoopBuilderView(
///       state: LoopBuilderState(mode: .create, kind: .copilot,
///                               inventory: model.inventory,
///                               now: { .now },
///                               idGenerator: model.newLoopID),
///       callbacks: model.builderCallbacks
///   )
///   ```
struct LoopBuilderView: View {
    @ObservedObject var state: LoopBuilderState
    let callbacks: LoopBuilderCallbacks

    init(state: LoopBuilderState, callbacks: LoopBuilderCallbacks) {
        self.state = state
        self.callbacks = callbacks
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            footer
        }
        .frame(minWidth: ManagerLayout.builderMinWidth, minHeight: ManagerLayout.builderMinHeight)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(headerTitle)
                    .font(.title2.weight(.semibold))
                Text(headerSubtitle)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            BuilderStepIndicator(state: state)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    private var headerTitle: String {
        switch state.mode {
        case .create:
            return state.kind == .copilot ? "New Copilot loop" : "New script loop"
        case .edit:
            return "Editing \(state.name.isEmpty ? state.loopID : state.name)"
        }
    }

    private var headerSubtitle: String {
        switch state.currentStep {
        case .configure: return "Step 1 of 4 · Configure the loop"
        case .permissions: return "Step 2 of 4 · Review required permissions"
        case .schedule: return "Step 3 of 4 · Confirm the schedule and policy"
        case .review: return "Step 4 of 4 · Preflight and enable"
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        switch state.currentStep {
        case .configure:
            switch state.kind {
            case .copilot:
                CopilotConfigureView(state: state, callbacks: callbacks)
            case .script:
                ScriptConfigureView(state: state, callbacks: callbacks)
            }
        case .permissions:
            PermissionsStepView(state: state)
        case .schedule:
            SchedulePolicyView(state: state)
        case .review:
            PermissionReviewView(state: state, callbacks: callbacks)
        }
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 10) {
            Button(role: .cancel) {
                callbacks.dismiss()
            } label: {
                Text("Cancel")
            }
            .keyboardShortcut(.cancelAction)

            Button {
                Task {
                    let definition = state.buildDefinition()
                    do {
                        try await callbacks.saveDraft(definition)
                        let pending = state.snapshotPendingSecrets()
                        if !pending.isEmpty {
                            try await callbacks.storePendingSecrets(pending)
                            state.clearPendingSecretValues(for: pending)
                        }
                    } catch {
                        state.lastActionError = error.localizedDescription
                    }
                }
            } label: {
                Label("Save draft", systemImage: "tray.and.arrow.down")
            }
            .disabled(state.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Spacer()

            if state.currentStep != .configure {
                Button {
                    state.retreat()
                } label: {
                    Label("Back", systemImage: "chevron.left")
                }
            }

            if state.currentStep != .review {
                Button {
                    state.advance()
                } label: {
                    Label("Continue", systemImage: "chevron.right")
                        .labelStyle(.titleAndIcon)
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(!state.canAdvance(from: state.currentStep))
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }
}

#if DEBUG
struct LoopBuilderView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            preview(kind: .copilot, mode: .create).previewDisplayName("New Copilot")
            preview(kind: .script, mode: .create).previewDisplayName("New Script").preferredColorScheme(.dark)
            preview(kind: .copilot, mode: .edit(originalID: "nightly-dependency-report")).previewDisplayName("Edit Copilot")
        }
        .frame(width: 860, height: 720)
        .previewLayout(.sizeThatFits)
    }

    static func preview(kind: LoopKind, mode: BuilderMode) -> some View {
        let existing: LoopDefinition? = {
            if case .edit = mode { return LoopsPreviewData.dependencyLoop }
            return nil
        }()
        let state = LoopBuilderState(
            mode: mode,
            kind: kind,
            existing: existing,
            inventory: LoopsPreviewData.builderInventory,
            now: { Date(timeIntervalSince1970: 1_755_000_000) },
            idGenerator: { "loop-preview" }
        )
        if case .create = mode, kind == .copilot {
            state.name = "Nightly dependency report"
            state.syncAutoID()
            state.installedPlugin = "core-agents"
            state.agent = "core-agents:researcher"
            state.skill = "research-methodology"
            state.model = "gpt-5.6-sol"
            state.copilotWorkingDirectory = "/Users/USERNAME/Repos/web-app"
            state.prompt = "Summarize dependency drift and open follow-up issues."
        }
        return LoopBuilderView(state: state, callbacks: LoopBuilderCallbacks())
    }
}

extension LoopsPreviewData {
    /// Preview inventory used by builder previews. Lives on `LoopsPreviewData`
    /// as an extension to avoid touching `Shared/PreviewData.swift`.
    static var builderInventory: InventoryResponse {
        InventoryResponse(
            plugins: [
                PluginInventoryItem(name: "core-agents", enabled: true, version: "0.8.1"),
                PluginInventoryItem(name: "meta", enabled: true, version: "0.4.0"),
            ],
            skills: [
                SkillInventoryItem(name: "research-methodology", enabled: true, plugin: "meta"),
                SkillInventoryItem(name: "code-reviewer", enabled: true, plugin: "meta"),
            ],
            agents: [
                AgentInventoryItem(name: "core-agents:researcher", enabled: true, plugin: "core-agents"),
                AgentInventoryItem(name: "meta:agent-architect", enabled: true, plugin: "meta"),
            ]
        )
    }
}
#endif
