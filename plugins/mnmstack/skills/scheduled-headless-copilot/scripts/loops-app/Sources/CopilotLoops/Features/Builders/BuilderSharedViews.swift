import SwiftUI
import LoopsModels

// MARK: - Step indicator

/// Compact wizard step indicator used at the top of every builder view. Steps
/// the user has already visited become tap-targets; future steps are inert.
struct BuilderStepIndicator: View {
    @ObservedObject var state: LoopBuilderState

    var body: some View {
        HStack(spacing: 6) {
            ForEach(BuilderStep.allCases) { step in
                Button {
                    state.jump(to: step)
                } label: {
                    HStack(spacing: 8) {
                        stepBadge(step)
                        Text(step.title)
                            .font(.callout.weight(step == state.currentStep ? .semibold : .regular))
                            .foregroundStyle(step == state.currentStep ? Color.primary : .secondary)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(step == state.currentStep ? LoopsPalette.identity.opacity(0.14) : Color.clear)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!state.visitedSteps.contains(step) && step != state.currentStep)
                .accessibilityLabel("Step \(step.rawValue + 1): \(step.title)")
                .accessibilityAddTraits(step == state.currentStep ? .isSelected : [])

                if step != BuilderStep.allCases.last {
                    Rectangle()
                        .fill(Color(nsColor: .separatorColor))
                        .frame(height: 1)
                        .frame(maxWidth: 16)
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func stepBadge(_ step: BuilderStep) -> some View {
        let isCurrent = step == state.currentStep
        let isVisited = state.visitedSteps.contains(step)
        ZStack {
            Circle()
                .fill(isCurrent ? LoopsPalette.identity : (isVisited ? LoopsPalette.identity.opacity(0.25) : Color(nsColor: .separatorColor).opacity(0.4)))
                .frame(width: 22, height: 22)
            Text("\(step.rawValue + 1)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(isCurrent ? .white : (isVisited ? Color.primary : .secondary))
        }
    }
}

// MARK: - Issue banners

/// Inline error/warning list surfaced above form sections that produce issues.
struct BuilderIssueList: View {
    let issues: [BuilderIssue]

    var body: some View {
        if issues.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(issues) { issue in
                    Label {
                        Text(issue.message)
                            .font(.callout)
                    } icon: {
                        Image(systemName: issue.severity == .error
                              ? "exclamationmark.triangle.fill"
                              : "info.circle.fill")
                            .foregroundStyle(issue.severity == .error ? LoopsPalette.failure : LoopsPalette.warning)
                    }
                    .accessibilityLabel("\(issue.severity == .error ? "Error" : "Warning"): \(issue.message)")
                }
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill((issues.contains(where: { $0.severity == .error })
                           ? LoopsPalette.failure
                           : LoopsPalette.warning).opacity(0.10))
            )
        }
    }
}

extension View {
    /// Attach a red border + focus ring when there's a field-level issue.
    @ViewBuilder
    func builderFieldError(_ hasError: Bool) -> some View {
        overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(hasError ? LoopsPalette.failure : Color.clear, lineWidth: hasError ? 1 : 0)
        )
    }
}

// MARK: - Path row list

/// A dynamic list of absolute-path rows with a picker button per row.
struct BuilderPathList: View {
    let title: String
    let addTitle: String
    let pickerTitle: String
    let helpText: String
    let pickerKind: BuilderPickerRequest.Kind
    @Binding var rows: [BuilderPathRow]
    var issueFor: (String) -> BuilderIssue?
    var onPickPath: (BuilderPickerRequest) async -> String?
    var onAdd: () -> Void
    var onRemove: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.semibold))
            if !helpText.isEmpty {
                Text(helpText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach($rows) { $row in
                HStack(spacing: 8) {
                    TextField("/absolute/path", text: $row.path)
                        .textFieldStyle(.roundedBorder)
                        .builderFieldError(issueFor(row.id) != nil)
                    Button {
                        Task {
                            if let picked = await onPickPath(
                                BuilderPickerRequest(
                                    title: pickerTitle,
                                    kind: pickerKind,
                                    initialDirectory: row.path.isEmpty ? nil : row.path
                                )
                            ) {
                                row.path = picked
                            }
                        }
                    } label: {
                        Image(systemName: "folder")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Choose path")
                    Button(role: .destructive) {
                        onRemove(row.id)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Remove path row")
                }
                if let issue = issueFor(row.id) {
                    Text(issue.message)
                        .font(.caption)
                        .foregroundStyle(issue.severity == .error ? LoopsPalette.failure : LoopsPalette.warning)
                        .padding(.leading, 4)
                }
            }
            Button {
                onAdd()
            } label: {
                Label(addTitle, systemImage: "plus")
                    .font(.callout)
            }
            .buttonStyle(.borderless)
        }
    }
}

// MARK: - Argument row list

/// A dynamic list of argv rows (each row is exactly one positional argument;
/// never a shell string). Rows are visually sequenced but drag-reorder is
/// intentionally omitted for now — the order comes from the underlying array.
struct BuilderArgumentList: View {
    let title: String
    let addTitle: String
    let placeholder: String
    @Binding var rows: [BuilderArgumentRow]
    var issueFor: (String) -> BuilderIssue?
    var onAdd: () -> Void
    var onRemove: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.semibold))
            ForEach(Array($rows.enumerated()), id: \.element.id) { index, $row in
                HStack(spacing: 8) {
                    Text("\(index + 1).")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 22, alignment: .trailing)
                    TextField(placeholder, text: $row.value)
                        .textFieldStyle(.roundedBorder)
                        .builderFieldError(issueFor(row.id) != nil)
                    Button(role: .destructive) {
                        onRemove(row.id)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Remove argument")
                }
                if let issue = issueFor(row.id) {
                    Text(issue.message)
                        .font(.caption)
                        .foregroundStyle(LoopsPalette.failure)
                        .padding(.leading, 30)
                }
            }
            Button {
                onAdd()
            } label: {
                Label(addTitle, systemImage: "plus")
                    .font(.callout)
            }
            .buttonStyle(.borderless)
        }
    }
}

// MARK: - Environment list

/// Non-secret env rows. The `value` is safe to persist; the row is displayed
/// as a plain `TextField`.
struct BuilderEnvironmentList: View {
    @ObservedObject var state: LoopBuilderState
    var issues: [BuilderIssue]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Environment (plain)")
                .font(.subheadline.weight(.semibold))
            if state.environmentRows.isEmpty {
                Text("No plain environment variables set.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach($state.environmentRows) { $row in
                HStack(spacing: 8) {
                    TextField("NAME", text: $row.name)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 160)
                        .builderFieldError(nameIssue(rowID: row.id) != nil)
                    TextField("value", text: $row.value)
                        .textFieldStyle(.roundedBorder)
                    Button(role: .destructive) {
                        state.removeEnvRow(id: row.id)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Remove environment row")
                }
                if let issue = nameIssue(rowID: row.id) {
                    Text(issue.message)
                        .font(.caption)
                        .foregroundStyle(LoopsPalette.failure)
                        .padding(.leading, 4)
                }
            }
            Button {
                state.addEnvRow()
            } label: {
                Label("Add variable", systemImage: "plus")
                    .font(.callout)
            }
            .buttonStyle(.borderless)
        }
    }

    private func nameIssue(rowID: String) -> BuilderIssue? {
        issues.first {
            if case .envRowName(let id) = $0.field { return id == rowID }
            return false
        }
    }
}

// MARK: - Secret list

/// Secret env rows. Values live in transient `SecureField` state only; the
/// `LoopBuilderState.snapshotPendingSecrets()` helper is the only path off the
/// form. Debug descriptions and previews never contain the value.
struct BuilderSecretList: View {
    @ObservedObject var state: LoopBuilderState
    var issues: [BuilderIssue]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("Environment (secrets)")
                    .font(.subheadline.weight(.semibold))
                Image(systemName: "lock.shield")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            Text("Only the name is persisted in the loop definition. Enter a new value to rotate a stored secret, or remove its row to delete it after the updated draft is persisted.")
                .font(.caption)
                .foregroundStyle(.secondary)
            if state.secretRows.isEmpty {
                Text("No secret environment variables.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach($state.secretRows) { $row in
                HStack(spacing: 8) {
                    TextField("NAME", text: $row.name)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 160)
                        .builderFieldError(nameIssue(rowID: row.id) != nil)
                        .disabled(row.isStored)
                        .help(row.isStored ? "Stored secret names cannot be renamed. Remove and re-add to rotate." : "")
                    SecureField(row.isStored ? "•••••• (stored)" : "value", text: $row.value)
                        .textFieldStyle(.roundedBorder)
                        .builderFieldError(valueIssue(rowID: row.id) != nil)
                    if row.isStored {
                        LoopsStatusPill(title: "Stored", systemImage: "checkmark.seal", tint: LoopsPalette.success)
                    }
                    Button(role: .destructive) {
                        state.removeSecretRow(id: row.id)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(row.isStored ? "Remove stored secret on save" : "Remove secret row")
                }
                if let issue = nameIssue(rowID: row.id) ?? valueIssue(rowID: row.id) {
                    Text(issue.message)
                        .font(.caption)
                        .foregroundStyle(issue.severity == .error ? LoopsPalette.failure : LoopsPalette.warning)
                        .padding(.leading, 4)
                }
            }
            Button {
                state.addSecretRow()
            } label: {
                Label("Add secret", systemImage: "plus")
                    .font(.callout)
            }
            .buttonStyle(.borderless)
        }
    }

    private func nameIssue(rowID: String) -> BuilderIssue? {
        issues.first {
            if case .secretRowName(let id) = $0.field { return id == rowID }
            return false
        }
    }

    private func valueIssue(rowID: String) -> BuilderIssue? {
        issues.first {
            if case .secretRowValue(let id) = $0.field { return id == rowID }
            return false
        }
    }
}
