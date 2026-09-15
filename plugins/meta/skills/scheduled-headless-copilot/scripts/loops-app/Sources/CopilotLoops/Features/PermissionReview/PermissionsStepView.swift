import SwiftUI
import LoopsModels

// MARK: - Permissions step

/// Permissions step. Full tool autonomy is the visually prominent orange default;
/// the custom profile reveals allow/deny tool + URL editors.
struct PermissionsStepView: View {
    @ObservedObject var state: LoopBuilderState

    private var issues: [BuilderIssue] { state.validate(step: .permissions) }

    var body: some View {
        Form {
            if state.kind == .script {
                scriptAuthorityCard
            } else {
                profileSection
                if state.permissionProfile == .custom {
                    customToolsSection
                    customUrlsSection
                }
            }
        }
        .formStyle(.grouped)
    }

    // MARK: Script authority explanation

    /// Script and executable loops don't use Copilot's tool/URL gating. The
    /// hashed executable + argv approval on the review step is what actually
    /// scopes the loop's authority; we surface that here so users don't look
    /// for controls that don't apply.
    private var scriptAuthorityCard: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label {
                    Text("Script loops inherit the user's OS authority.")
                        .font(.callout.weight(.semibold))
                } icon: {
                    Image(systemName: "person.badge.key.fill")
                        .foregroundStyle(LoopsPalette.operational)
                }
                Text("The approved executable + argv + SHA-256 is the whole permission surface. The Copilot allow/deny tool and URL flags do not apply — the OS runs the binary directly with the working directory and environment you configured.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Text("Review the exact command, hash, and capability fingerprint on the next step. Any change to the file requires re-approval.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(12)
            .background(LoopsPalette.operational.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
        } header: {
            Text("OS authority")
        }
    }

    // MARK: Profile picker

    private var profileSection: some View {
        Section {
            VStack(spacing: 10) {
                ForEach(PermissionProfile.allCases) { profile in
                    profileButton(profile)
                }
            }
        } header: {
            Text("Permission profile")
        } footer: {
            Text("Full tool autonomy is selected by default because loops run headless. Files remain limited to the working directory and approved extra paths; URLs still require explicit custom rules.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func profileButton(_ profile: PermissionProfile) -> some View {
        let isSelected = state.permissionProfile == profile
        let isFullAutonomy = profile == .fullAutonomy
        let accentColor: Color = isFullAutonomy ? LoopsPalette.operational : LoopsPalette.identity

        return Button {
            state.permissionProfile = profile
        } label: {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle()
                        .fill(isSelected ? accentColor : Color(nsColor: .separatorColor).opacity(0.4))
                        .frame(width: 20, height: 20)
                    if isSelected {
                        Image(systemName: "checkmark")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.white)
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(profile.title)
                            .font(.headline)
                        if isFullAutonomy {
                            Text("Default")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(LoopsPalette.operational.opacity(0.18), in: Capsule())
                                .foregroundStyle(LoopsPalette.operational)
                        }
                    }
                    Text(profile.subtitle)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    if isFullAutonomy && isSelected {
                        Label {
                            Text("The loop runs `copilot -p --autopilot --allow-all-tools`. Tools do not prompt, while filesystem and URL access remain scoped.")
                                .font(.caption)
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(LoopsPalette.operational)
                        }
                        .padding(8)
                        .background(LoopsPalette.operational.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
                    }
                }
                Spacer()
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(isSelected ? accentColor.opacity(0.10) : Color.clear)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(isSelected ? accentColor : Color(nsColor: .separatorColor).opacity(0.4),
                                    lineWidth: isSelected ? 1.5 : 0.5)
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(profile.title). \(profile.subtitle)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    // MARK: Tool allow/deny

    private var customToolsSection: some View {
        Section {
            BuilderArgumentList(
                title: "Allow tools",
                addTitle: "Add allowed tool",
                placeholder: "shell",
                rows: $state.allowTools,
                issueFor: { id in
                    issues.first { if case .allowTool(let rowID) = $0.field { return rowID == id }; return false }
                },
                onAdd: { state.addArgumentRow(\.allowTools) },
                onRemove: { state.removeArgumentRow(id: $0, from: \.allowTools) }
            )
            BuilderArgumentList(
                title: "Deny tools",
                addTitle: "Add denied tool",
                placeholder: "bash",
                rows: $state.denyTools,
                issueFor: { id in
                    issues.first { if case .denyTool(let rowID) = $0.field { return rowID == id }; return false }
                },
                onAdd: { state.addArgumentRow(\.denyTools) },
                onRemove: { state.removeArgumentRow(id: $0, from: \.denyTools) }
            )
            BuilderIssueList(issues: issues.filter {
                if case .allowTool(let id) = $0.field, id == "root" { return true }
                return false
            })
        } header: {
            Text("Tools")
        } footer: {
            Text("Deny entries always take precedence over allow entries — a tool listed in both is denied. Names are the raw tool identifiers copilot reports.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: URL allow/deny

    private var customUrlsSection: some View {
        Section {
            BuilderArgumentList(
                title: "Allow URLs",
                addTitle: "Add allowed URL",
                placeholder: "https://api.github.com",
                rows: $state.allowUrls,
                issueFor: { id in
                    issues.first { if case .allowUrl(let rowID) = $0.field { return rowID == id }; return false }
                },
                onAdd: { state.addArgumentRow(\.allowUrls) },
                onRemove: { state.removeArgumentRow(id: $0, from: \.allowUrls) }
            )
            BuilderArgumentList(
                title: "Deny URLs",
                addTitle: "Add denied URL",
                placeholder: "https://raw.githubusercontent.com",
                rows: $state.denyUrls,
                issueFor: { id in
                    issues.first { if case .denyUrl(let rowID) = $0.field { return rowID == id }; return false }
                },
                onAdd: { state.addArgumentRow(\.denyUrls) },
                onRemove: { state.removeArgumentRow(id: $0, from: \.denyUrls) }
            )
        } header: {
            Text("URLs")
        } footer: {
            Text("URLs must be absolute http(s):// origins. Deny takes precedence over allow.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

#if DEBUG
struct PermissionsStepView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            preview(profile: .fullAutonomy).previewDisplayName("Full tool autonomy")
            preview(profile: .custom).previewDisplayName("Custom").preferredColorScheme(.dark)
        }
        .frame(width: 620, height: 640)
        .previewLayout(.sizeThatFits)
    }

    static func preview(profile: PermissionProfile) -> some View {
        let state = LoopBuilderState(
            mode: .create,
            kind: .copilot,
            now: { Date(timeIntervalSince1970: 1_755_000_000) }
        )
        state.permissionProfile = profile
        if profile == .custom {
            state.allowTools = [BuilderArgumentRow(value: "shell")]
            state.denyTools = [BuilderArgumentRow(value: "bash")]
            state.allowUrls = [BuilderArgumentRow(value: "https://api.github.com")]
            state.denyUrls = [BuilderArgumentRow(value: "https://raw.githubusercontent.com")]
        }
        return PermissionsStepView(state: state)
    }
}
#endif
