import SwiftUI
import LoopsModels

// MARK: - Script configure step

/// Configure step for `LoopKind.script`: mode switch (script file vs
/// executable+argv), file picker + hash computation, editable argv rows,
/// working directory, plain env rows, and secret-name/value rows.
struct ScriptConfigureView: View {
    @ObservedObject var state: LoopBuilderState
    let callbacks: LoopBuilderCallbacks

    private var issues: [BuilderIssue] { state.validate(step: .configure) }

    var body: some View {
        Form {
            identitySection
            modeSection
            executableSection
            argumentsSection
            workingDirectorySection
            environmentSection
            secretsSection
        }
        .formStyle(.grouped)
    }

    // MARK: Identity

    private var identitySection: some View {
        Section {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Loop name").font(.caption).foregroundStyle(.secondary)
                    TextField("Repository maintenance", text: $state.name)
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
                    TextField("repository-maintenance", text: $state.loopID)
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
        }
    }

    // MARK: Mode picker

    private var modeSection: some View {
        Section {
            Picker("", selection: $state.scriptMode) {
                ForEach(ScriptExecutionMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .accessibilityLabel("Script execution mode")
            .onChange(of: state.scriptMode) { _ in
                // Mode flip invalidates any hash whose recorded path no
                // longer matches the newly-active field.
                state.invalidateHashIfStale()
            }
            Text(state.scriptMode.subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
        } header: {
            Text("Execution mode")
        } footer: {
            Text("Never accept a shell command string. Every argument is captured on its own row so it is delivered directly as argv.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: Executable / script picker

    private var executableSection: some View {
        Section {
            switch state.scriptMode {
            case .scriptFile:
                filePickerRow(
                    title: "Script file",
                    placeholder: "/Users/USERNAME/scripts/repo-maintenance.sh",
                    path: $state.scriptPath,
                    fieldError: issue(field: .scriptPath) != nil,
                    expectShebang: true
                )
            case .executable:
                filePickerRow(
                    title: "Executable",
                    placeholder: "/usr/bin/git",
                    path: $state.executablePath,
                    fieldError: issue(field: .executablePath) != nil,
                    expectShebang: false
                )
            }

            hashStatus

            let field: BuilderIssue.Field = state.scriptMode == .scriptFile ? .scriptPath : .executablePath
            BuilderIssueList(issues: issues.filter { $0.field == field })
        } header: {
            Text(state.scriptMode == .scriptFile ? "Script file" : "Executable")
        } footer: {
            Text("The SHA-256 becomes part of the approval fingerprint. The review step re-shows this hash and refuses to enable if it has changed since approval.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func filePickerRow(
        title: String,
        placeholder: String,
        path: Binding<String>,
        fieldError: Bool,
        expectShebang: Bool
    ) -> some View {
        HStack(spacing: 8) {
            TextField(placeholder, text: path)
                .textFieldStyle(.roundedBorder)
                .builderFieldError(fieldError)
                .accessibilityLabel(title)
                .onChange(of: path.wrappedValue) { _ in
                    // Any manual edit to the path invalidates a cached hash
                    // computed for the previous file.
                    state.invalidateHashIfStale()
                }
            Button {
                Task {
                    if let picked = await callbacks.pickPath(
                        BuilderPickerRequest(
                            title: "Choose \(title.lowercased())",
                            kind: .file,
                            initialDirectory: path.wrappedValue.isEmpty ? nil : path.wrappedValue
                        )
                    ) {
                        path.wrappedValue = picked
                        state.invalidateHashIfStale()
                        await refreshHash(expectShebang: expectShebang, path: picked)
                    }
                }
            } label: {
                Image(systemName: "folder")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Choose \(title.lowercased())")
            Button {
                Task { await refreshHash(expectShebang: expectShebang, path: path.wrappedValue) }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.borderless)
            .disabled(path.wrappedValue.isEmpty || state.isHashing)
            .accessibilityLabel("Recompute hash")
        }
    }

    @MainActor
    private func refreshHash(expectShebang: Bool, path: String) async {
        guard !path.isEmpty else {
            state.scriptHash = nil
            return
        }
        state.isHashing = true
        defer { state.isHashing = false }
        // Callback-supplied hasher first; fall back to bundled hasher.
        var result = await callbacks.computeHash(path, expectShebang)
        if result.hash.isEmpty && result.problems.isEmpty {
            result = await BuilderHasher.hash(path: path, expectShebang: expectShebang)
        }
        state.scriptHash = result
    }

    @ViewBuilder
    private var hashStatus: some View {
        if state.isHashing {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Computing SHA-256…").font(.caption).foregroundStyle(.secondary)
            }
        } else if let hash = state.scriptHash, !hash.hash.isEmpty {
            HStack(spacing: 6) {
                Image(systemName: "number.square")
                    .foregroundStyle(LoopsPalette.identity)
                Text("SHA-256: \(hash.hash.prefix(12))…\(hash.hash.suffix(6))")
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .accessibilityLabel("SHA-256 hash \(hash.hash)")
                Spacer()
            }
        } else if !state.currentPath.isEmpty {
            Text("Hash not computed yet — pick or refresh the file to hash it.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: Arguments

    private var argumentsSection: some View {
        Section {
            if state.scriptArguments.isEmpty {
                Text("No arguments — the script/executable runs with an empty argv list.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            BuilderArgumentList(
                title: "Arguments (argv)",
                addTitle: "Add argument",
                placeholder: "--stats",
                rows: $state.scriptArguments,
                issueFor: { id in
                    issues.first { if case .argument(let rowID) = $0.field { return rowID == id }; return false }
                },
                onAdd: { state.addArgumentRow(\.scriptArguments) },
                onRemove: { state.removeArgumentRow(id: $0, from: \.scriptArguments) }
            )
        } header: {
            Text("Arguments")
        }
    }

    // MARK: Working directory

    private var workingDirectorySection: some View {
        Section {
            HStack(spacing: 8) {
                TextField("/Users/USERNAME/projects", text: $state.scriptWorkingDirectory)
                    .textFieldStyle(.roundedBorder)
                    .builderFieldError(issue(field: .workingDirectory) != nil)
                    .accessibilityLabel("Working directory")
                Button {
                    Task {
                        if let picked = await callbacks.pickPath(
                            BuilderPickerRequest(
                                title: "Choose working directory",
                                kind: .directory,
                                initialDirectory: state.scriptWorkingDirectory.isEmpty ? nil : state.scriptWorkingDirectory
                            )
                        ) {
                            state.scriptWorkingDirectory = picked
                        }
                    }
                } label: {
                    Image(systemName: "folder")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Choose working directory")
            }
            BuilderIssueList(issues: [issue(field: .workingDirectory)].compactMap { $0 })
        } header: {
            Text("Working directory")
        }
    }

    // MARK: Environment

    private var environmentSection: some View {
        Section {
            BuilderEnvironmentList(state: state, issues: issues)
        } header: {
            Text("Environment (plain)")
        } footer: {
            Text("Plain values are persisted verbatim in the loop definition. Use secret rows below for credentials.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var secretsSection: some View {
        Section {
            BuilderSecretList(
                state: state,
                issues: issues
            )
        } header: {
            Text("Environment (secrets)")
        } footer: {
            Text("Values are entered into `SecureField` and handed to the secrets helper on save. They never enter the loop definition, previews, or logs.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func issue(field: BuilderIssue.Field) -> BuilderIssue? {
        issues.first(where: { $0.field == field })
    }
}

// MARK: - Convenience

private extension LoopBuilderState {
    /// The currently-active path field for the script view (script vs executable).
    var currentPath: String {
        scriptMode == .scriptFile ? scriptPath : executablePath
    }
}

#if DEBUG
struct ScriptConfigureView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            preview(mode: .scriptFile)
                .previewDisplayName("Script file")
            preview(mode: .executable)
                .previewDisplayName("Executable")
                .preferredColorScheme(.dark)
        }
        .frame(width: 720, height: 720)
        .previewLayout(.sizeThatFits)
    }

    static func preview(mode: ScriptExecutionMode) -> some View {
        let state = LoopBuilderState(
            mode: .create,
            kind: .script,
            now: { Date(timeIntervalSince1970: 1_755_000_000) },
            idGenerator: { "repository-maintenance" }
        )
        state.name = "Repository maintenance"
        state.syncAutoID()
        state.scriptMode = mode
        if mode == .scriptFile {
            state.scriptPath = "/Users/USERNAME/scripts/repo-maintenance.sh"
            state.scriptHash = BuilderHashResult(
                path: state.scriptPath,
                hash: String(repeating: "a", count: 64)
            )
        } else {
            state.executablePath = "/usr/bin/git"
            state.scriptHash = BuilderHashResult(
                path: state.executablePath,
                hash: String(repeating: "b", count: 64)
            )
        }
        state.scriptWorkingDirectory = "/Users/USERNAME/Repos/web-app"
        state.scriptArguments = [
            BuilderArgumentRow(value: "--prune"),
            BuilderArgumentRow(value: "--vacuum"),
        ]
        state.environmentRows = [
            BuilderEnvRow(name: "DRY_RUN", value: "false"),
        ]
        state.secretRows = [
            BuilderSecretRow(name: "REPORT_TOKEN", isStored: true),
        ]
        return ScriptConfigureView(state: state, callbacks: LoopBuilderCallbacks())
    }
}
#endif
