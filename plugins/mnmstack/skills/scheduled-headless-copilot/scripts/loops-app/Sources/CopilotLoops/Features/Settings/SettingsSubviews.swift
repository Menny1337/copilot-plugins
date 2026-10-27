import SwiftUI
import LoopsModels
import UserNotifications

struct GeneralSettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel

    var body: some View {
        Form {
            Section {
                Toggle("Launch at login", isOn: $viewModel.settings.launchAtLogin)
                    .onChange(of: viewModel.settings.launchAtLogin) { _ in viewModel.checkDirty() }

                Toggle("Show menu-bar icon", isOn: $viewModel.showMenuBarIcon)
                    .onChange(of: viewModel.showMenuBarIcon) { _ in viewModel.checkDirty() }

                TextField("Default Model", text: Binding(
                    get: { viewModel.settings.defaultModel ?? "" },
                    set: { viewModel.settings.defaultModel = $0.isEmpty ? nil : $0 }
                ))
                .onChange(of: viewModel.settings.defaultModel) { _ in viewModel.checkDirty() }

                Stepper("Default Timeout: \(viewModel.settings.defaultTimeoutSeconds == 0 ? "None" : "\(viewModel.settings.defaultTimeoutSeconds)s")",
                        value: $viewModel.settings.defaultTimeoutSeconds, in: 0...604800, step: 60)
                    .onChange(of: viewModel.settings.defaultTimeoutSeconds) { _ in viewModel.checkDirty() }
            } header: {
                Text("App Behavior")
            } footer: {
                Text("Schedules use your local time zone. Hiding the menu-bar icon keeps Copilot Loops available from the Dock.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
            }
        }
        .padding()
    }
}

struct SchedulesSettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Schedules are Per-Loop")
                .font(.headline)
            Text("Schedules are defined individually on each loop. There are no global schedule controls. To change when a loop runs, open its builder from the Library or Dashboard.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Divider()

            Text("Local Time and DST")
                .font(.headline)
            Text("Copilot Loops schedules evaluate in your local time zone. Daylight Saving Time transitions are handled by macOS and launchd.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Divider()

            Text("Concurrency and Missed Runs")
                .font(.headline)
            Text("If the machine is asleep or off, missed runs are skipped (marked as 'Skipped Missed'). If a run takes longer than its schedule interval, the next scheduled run is skipped ('Skipped Overlap') rather than queued. These missed and overlap policies are fixed for scheduled runs; only grace period is configurable in v1.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Spacer()
        }
        .padding()
    }
}

struct NotificationsSettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel

    var body: some View {
        Form {
            Section {
                Toggle("Enable Notifications", isOn: $viewModel.settings.notificationsEnabled)
                    .onChange(of: viewModel.settings.notificationsEnabled) { _ in viewModel.checkDirty() }

                HStack {
                    Text("System Authorization:")
                    Spacer()
                    Text(authStatusString(viewModel.notificationAuthStatus))
                        .foregroundStyle(authStatusColor(viewModel.notificationAuthStatus))
                }

                if let err = viewModel.notificationDeliveryError {
                    Text("Delivery Error: \(err)")
                        .font(.caption)
                        .foregroundStyle(LoopsPalette.failure)
                }

                HStack {
                    if viewModel.notificationAuthStatus == .notDetermined {
                        Button("Request Permission") {
                            viewModel.requestAuth()
                        }
                    } else {
                        Button("Open System Settings") {
                            viewModel.onOpenSystemSettings()
                        }

                        Button {
                            viewModel.checkAuth()
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Refresh Authorization Status")
                    }
                }
            } header: {
                Text("Master Notification Toggle")
            } footer: {
                Text("Note: Notifications are best-effort and require the menu-bar app to be running. Task execution and history never depend on notification delivery.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
            }
        }
        .padding()
    }

    private func authStatusString(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "Not Determined"
        case .denied: return "Denied"
        case .authorized: return "Authorized"
        case .provisional: return "Provisional"
        @unknown default: return "Unknown"
        }
    }

    private func authStatusColor(_ status: UNAuthorizationStatus) -> Color {
        switch status {
        case .authorized, .provisional: return LoopsPalette.success
        case .denied: return LoopsPalette.failure
        default: return .secondary
        }
    }
}

struct PermissionsSettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Full Autonomy Default")
                .font(.headline)
            Text("By default, Copilot Loops execute with full autonomy using the configured environment. The agent can use any available tool to accomplish its task.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Divider()

            Text("Custom Policy")
                .font(.headline)
            Text("A custom policy overrides the full autonomy default. You can explicitly allow or deny specific tools and URLs. Any change to the loop's capabilities requires a one-time approval before the loop can run.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Spacer()
        }
        .padding()
    }
}

struct CredentialsSettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel
    @State private var secretToDelete: ManagedSecretItem?
    @State private var showDeleteConfirmation = false

    var body: some View {
        VStack(alignment: .leading) {
            Text("Keychain Helper")
                .font(.headline)

            HStack {
                Text("Status: \(viewModel.keychainHealth)")
                    .foregroundStyle(viewModel.keychainError == nil && viewModel.keychainHealth != "Not checked" ? LoopsPalette.success : (viewModel.keychainError != nil ? LoopsPalette.failure : .secondary))
            }
            .padding(.bottom, 4)

            if let error = viewModel.keychainError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(LoopsPalette.failure)
                    .padding(.bottom)
            } else {
                Spacer().frame(height: 12)
            }

            Text("Managed Secrets")
                .font(.headline)

            if viewModel.managedSecrets.isEmpty {
                Text("No managed secrets found.")
                    .foregroundStyle(.secondary)
            } else {
                List(viewModel.managedSecrets, id: \.self) { item in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(item.envName)
                                .font(.body)
                            if let ln = item.loopName, !ln.isEmpty {
                                Text("\(ln) · \(item.loopID)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else {
                                Text(item.loopID)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Button(role: .destructive) {
                            secretToDelete = item
                            showDeleteConfirmation = true
                        } label: {
                            Image(systemName: "trash")
                        }
                        .accessibilityLabel("Delete secret \(item.envName)")
                    }
                }
                .border(Color.secondary.opacity(0.2))
            }
        }
        .padding()
        .confirmationDialog(
            "Delete Secret?",
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let item = secretToDelete {
                    viewModel.deleteSecret(item)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to delete '\(secretToDelete?.envName ?? "")'? This cannot be undone.")
        }
    }
}

struct AdvancedSettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel

    var body: some View {
        Form {
            Section {
                if viewModel.systemDiagnostics.isEmpty {
                    Text("No diagnostics available.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(Array(viewModel.systemDiagnostics.keys.sorted()), id: \.self) { key in
                        HStack {
                            Text(key)
                            Spacer()
                            Text(viewModel.systemDiagnostics[key] ?? "")
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)

                            Button {
                                viewModel.onCopyDiagnostic(viewModel.systemDiagnostics[key] ?? "")
                            } label: {
                                Image(systemName: "doc.on.doc")
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Copy \(key)")

                            if FileManager.default.fileExists(
                                atPath: viewModel.systemDiagnostics[key] ?? ""
                            ) {
                                Button {
                                    viewModel.onOpenPath(viewModel.systemDiagnostics[key] ?? "")
                                } label: {
                                    Image(systemName: "arrow.up.right.square")
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Open \(key)")
                            }
                        }
                    }
                }
            } header: {
                Text("Diagnostics")
            }

            Section {
                Text("Default run retention is 30 days or 100 runs per loop.")
                    .foregroundStyle(.secondary)
            } header: {
                Text("Retention Defaults")
            }
        }
        .padding()
    }
}

struct AboutSettingsView: View {
    var version: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Unknown"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "infinity.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(LoopsPalette.identity)
                .padding(.bottom, 8)

            Text("Copilot Loops")
                .font(.title.bold())

            Text("Version: \(version) (Source Build)")
                .font(.subheadline)

            Text("Signing: Ad-hoc")
                .font(.subheadline)

            Text("Source: Public source. No automated updates provided.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Spacer()
        }
        .padding(32)
    }
}
