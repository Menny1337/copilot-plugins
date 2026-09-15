import SwiftUI
import LoopsModels

// MARK: - Copilot configure step

/// Configure step for `LoopKind.copilot`: name/id, installed plugin + local
/// plugin directories, agent, skill, model, working directory + extras, and a
/// bounded prompt editor. Inventory errors are always surfaced (never rendered
/// as a successful-but-empty list).
struct CopilotConfigureView: View {
    @ObservedObject var state: LoopBuilderState
    let callbacks: LoopBuilderCallbacks

    private var issues: [BuilderIssue] { state.validate(step: .configure) }

    var body: some View {
        Form {
            identitySection
            provenanceSection
            agentSkillModelSection
            workingDirectorySection
            environmentSection
            secretsSection
            promptSection
        }
        .formStyle(.grouped)
    }

    private var environmentSection: some View {
        Section {
            BuilderEnvironmentList(state: state, issues: issues)
        } header: {
            Text("Environment (plain)")
        } footer: {
            Text("Plain values are retained in the loop definition. Use secret rows for credentials.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var secretsSection: some View {
        Section {
            BuilderSecretList(state: state, issues: issues)
        } header: {
            Text("Environment (secrets)")
        } footer: {
            Text("Secret values are stored through the Keychain helper on save and never enter the loop definition or command line.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: Identity

    private var identitySection: some View {
        Section {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Loop name").font(.caption).foregroundStyle(.secondary)
                    TextField("Nightly dependency report", text: $state.name)
                        .textFieldStyle(.roundedBorder)
                        .builderFieldError(issue(field: .name) != nil)
                        .onChange(of: state.name) { _ in state.syncAutoID() }
                        .accessibilityLabel("Loop name")
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Text("Loop id").font(.caption).foregroundStyle(.secondary)
                        if state.identityLocked {
                            Image(systemName: "lock.fill")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    TextField("nightly-dependency-report", text: $state.loopID)
                        .textFieldStyle(.roundedBorder)
                        .builderFieldError(issue(field: .id) != nil)
                        .disabled(state.identityLocked)
                        .onChange(of: state.loopID) { _ in
                            guard !state.identityLocked else { return }
                            state.idIsAutoDerived = false
                        }
                        .accessibilityLabel(state.identityLocked
                            ? "Loop id (immutable in edit mode)"
                            : "Loop id")
                        .help(state.identityLocked ? "Loop ids are immutable after the draft is persisted." : "")
                }
            }
            BuilderIssueList(issues: [issue(field: .name), issue(field: .id)].compactMap { $0 })
        } header: {
            Text("Identity")
        } footer: {
            Text("The id becomes the loop's on-disk file and is used across every log, secret, and control-plane command.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: Provenance

    private var provenanceSection: some View {
        Section {
            inventoryErrorBanner

            HStack(spacing: 12) {
                Text("Installed plugin").font(.caption).foregroundStyle(.secondary).frame(width: 130, alignment: .leading)
                Picker("", selection: $state.installedPlugin) {
                    Text("None").tag("")
                    ForEach(state.inventory.plugins, id: \.name) { plugin in
                        Text(pluginLabel(plugin)).tag(plugin.name)
                    }
                }
                .labelsHidden()
                .disabled(state.inventory.plugins.isEmpty && state.inventory.errors.isEmpty)
                if state.inventory.plugins.isEmpty && state.inventory.errors.isEmpty {
                    LoopsStatusPill(title: "Inventory empty", systemImage: "exclamationmark.triangle", tint: LoopsPalette.warning)
                }
            }

            BuilderPathList(
                title: "Local plugin directories",
                addTitle: "Add local plugin directory",
                pickerTitle: "Choose plugin directory",
                helpText: "Explicit `--plugin-dir` paths passed to copilot for out-of-tree plugins.",
                pickerKind: .directory,
                rows: $state.localPluginPaths,
                issueFor: { id in
                    issues.first { if case .pluginPath(let rowID) = $0.field { return rowID == id }; return false }
                },
                onPickPath: callbacks.pickPath,
                onAdd: { state.addPathRow(\.localPluginPaths) },
                onRemove: { state.removePathRow(id: $0, from: \.localPluginPaths) }
            )
        } header: {
            Text("Plugin provenance")
        } footer: {
            Text("The installed-plugin picker is provenance/validation only — the Copilot CLI has no `--plugin` flag. Only the local plugin directories map to `--plugin-dir` when the loop runs.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var inventoryErrorBanner: some View {
        if !state.inventory.errors.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Label {
                    Text("Inventory reported \(state.inventory.errors.count) issue\(state.inventory.errors.count == 1 ? "" : "s"). Fix before relying on the pickers.")
                        .font(.callout.weight(.semibold))
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(LoopsPalette.warning)
                }
                ForEach(state.inventory.errors.indices, id: \.self) { index in
                    let error = state.inventory.errors[index]
                    VStack(alignment: .leading, spacing: 2) {
                        Text(error.message).font(.caption)
                        if let remedy = error.remedy {
                            Text("Try: \(remedy)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.leading, 22)
                }
                Button {
                    Task { await callbacks.refreshInventory() }
                } label: {
                    Label("Refresh inventory", systemImage: "arrow.clockwise")
                        .font(.caption)
                }
                .buttonStyle(.borderless)
            }
            .padding(10)
            .background(LoopsPalette.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private func pluginLabel(_ plugin: PluginInventoryItem) -> String {
        var pieces: [String] = [plugin.name]
        if let version = plugin.version { pieces.append("v\(version)") }
        if plugin.enabled == false { pieces.append("(disabled)") }
        return pieces.joined(separator: " ")
    }

    // MARK: Agent + Skill + Model

    private var agentSkillModelSection: some View {
        Section {
            skillExplanationBanner
            manualComboRow(
                label: "Agent",
                placeholder: "core-agents:researcher",
                items: filteredAgents,
                selection: $state.agent,
                fieldError: issue(field: .agent) != nil
            )
            manualComboRow(
                label: "Skill",
                placeholder: "research-methodology",
                items: filteredSkills,
                selection: $state.skill,
                fieldError: issue(field: .skill) != nil
            )
            manualComboRow(
                label: "Model",
                placeholder: "gpt-5.6-sol",
                items: modelOptions,
                selection: $state.model,
                fieldError: issue(field: .model) != nil
            )
            BuilderIssueList(issues: [
                issue(field: .agent),
                issue(field: .skill),
                issue(field: .model),
            ].compactMap { $0 })
        } header: {
            Text("Agent, skill, and model")
        }
    }

    /// Enabled agents; when an installed plugin is picked, only agents from
    /// that plugin are surfaced. Explicitly disabled inventory items are
    /// omitted (validation forbids them and their presence would confuse the
    /// picker). Manual entry via the trailing `TextField` remains available.
    private var filteredAgents: [String] {
        let trimmedPlugin = state.installedPlugin.trimmingCharacters(in: .whitespacesAndNewlines)
        return state.inventory.agents
            .filter { $0.enabled }
            .filter { trimmedPlugin.isEmpty || $0.plugin == trimmedPlugin }
            .map { $0.name }
    }

    private var filteredSkills: [String] {
        let trimmedPlugin = state.installedPlugin.trimmingCharacters(in: .whitespacesAndNewlines)
        return state.inventory.skills
            .filter { $0.enabled }
            .filter { trimmedPlugin.isEmpty || $0.plugin == trimmedPlugin }
            .map { $0.name }
    }

    private var skillExplanationBanner: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text("Skills are enforced through the prompt, not a `--skill` flag.")
                    .font(.callout.weight(.semibold))
                Text("The Copilot CLI has no `--skill` argument. The builder adds guidance to the prompt so the selected skill is invoked; there is nothing sandboxing this at the CLI level. Agents map to the real `--agent` flag.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: "info.circle.fill")
                .foregroundStyle(LoopsPalette.identity)
        }
        .padding(10)
        .background(LoopsPalette.identity.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
    }

    private var modelOptions: [String] {
        // A tiny curated list; the manual field lets the user type any other
        // model name. Keeping it here avoids depending on the settings.
        [
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "claude-sonnet-5",
            "claude-opus-5",
        ]
    }

    @ViewBuilder
    private func manualComboRow(
        label: String,
        placeholder: String,
        items: [String],
        selection: Binding<String>,
        fieldError: Bool
    ) -> some View {
        HStack(spacing: 12) {
            Text(label).font(.caption).foregroundStyle(.secondary).frame(width: 90, alignment: .leading)
            Picker("", selection: selection) {
                Text("Type manually").tag("")
                ForEach(items, id: \.self) { item in
                    Text(item).tag(item)
                }
            }
            .labelsHidden()
            .frame(maxWidth: 260)
            TextField(placeholder, text: selection)
                .textFieldStyle(.roundedBorder)
                .builderFieldError(fieldError)
                .accessibilityLabel("\(label) (manual entry)")
        }
    }

    // MARK: Working directory + extras

    private var workingDirectorySection: some View {
        Section {
            HStack(spacing: 8) {
                TextField("/Users/USERNAME/Repos/web-app", text: $state.copilotWorkingDirectory)
                    .textFieldStyle(.roundedBorder)
                    .builderFieldError(issue(field: .workingDirectory) != nil)
                    .accessibilityLabel("Working directory")
                Button {
                    Task {
                        if let picked = await callbacks.pickPath(
                            BuilderPickerRequest(
                                title: "Choose working directory",
                                kind: .directory,
                                initialDirectory: state.copilotWorkingDirectory.isEmpty ? nil : state.copilotWorkingDirectory
                            )
                        ) {
                            state.copilotWorkingDirectory = picked
                        }
                    }
                } label: {
                    Image(systemName: "folder")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Choose working directory")
            }
            BuilderIssueList(issues: [issue(field: .workingDirectory)].compactMap { $0 })

            BuilderPathList(
                title: "Extra --add-dir paths",
                addTitle: "Add extra path",
                pickerTitle: "Choose extra path",
                helpText: "Additional directories the loop should be able to read/write.",
                pickerKind: .directory,
                rows: $state.copilotExtraPaths,
                issueFor: { id in
                    issues.first { if case .extraPath(let rowID) = $0.field { return rowID == id }; return false }
                },
                onPickPath: callbacks.pickPath,
                onAdd: { state.addPathRow(\.copilotExtraPaths) },
                onRemove: { state.removePathRow(id: $0, from: \.copilotExtraPaths) }
            )
        } header: {
            Text("Working directory")
        }
    }

    // MARK: Prompt

    private var promptSection: some View {
        Section {
            ZStack(alignment: .topLeading) {
                TextEditor(text: $state.prompt)
                    .font(.body.monospaced())
                    .frame(minHeight: 160, maxHeight: 320)
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(issue(field: .prompt) != nil ? LoopsPalette.failure : Color(nsColor: .separatorColor).opacity(0.6), lineWidth: 0.5)
                    )
                    .accessibilityLabel("Prompt editor")
                if state.prompt.isEmpty {
                    Text("Describe the work the loop should do each run…")
                        .font(.body.monospaced())
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 14)
                        .allowsHitTesting(false)
                }
            }
            HStack {
                Text("\(state.prompt.count) characters")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            BuilderIssueList(issues: [issue(field: .prompt)].compactMap { $0 })
        } header: {
            Text("Prompt")
        } footer: {
            Text("Everything above the fold is delivered to `copilot -p`. The selected skill/agent is instructed in the prompt because the CLI has no dedicated flags.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func issue(field: BuilderIssue.Field) -> BuilderIssue? {
        issues.first(where: { $0.field == field })
    }
}

#if DEBUG
struct CopilotConfigureView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            makePreview(colorScheme: .light)
            makePreview(colorScheme: .dark).preferredColorScheme(.dark)
        }
        .frame(width: 720, height: 640)
        .previewLayout(.sizeThatFits)
    }

    static func makePreview(colorScheme: ColorScheme) -> some View {
        let state = LoopBuilderState(
            mode: .create,
            kind: .copilot,
            existing: nil,
            inventory: previewInventory,
            now: { Date(timeIntervalSince1970: 1_755_000_000) },
            idGenerator: { "nightly-dependency-report" }
        )
        state.name = "Nightly dependency report"
        state.syncAutoID()
        state.installedPlugin = "core-agents"
        state.agent = "core-agents:researcher"
        state.skill = "research-methodology"
        state.model = "gpt-5.6-sol"
        state.copilotWorkingDirectory = "/Users/USERNAME/Repos/web-app"
        state.prompt = "Summarize dependency drift and open follow-up issues."
        return CopilotConfigureView(state: state, callbacks: LoopBuilderCallbacks())
    }

    static var previewInventory: InventoryResponse {
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
