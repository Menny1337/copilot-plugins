import SwiftUI
import LoopsModels

struct SettingsView_Previews: PreviewProvider {
    static var previews: some View {
        let settings = AppSettings(
            schemaVersion: 1,
            notificationsEnabled: true,
            launchAtLogin: false,
            defaultModel: "gpt-4",
            defaultTimeoutSeconds: 1800,
            stateRoot: "/var/folders/xyz"
        )

        let viewModel = SettingsViewModel(
            settings: settings,
            showMenuBarIcon: true,
            notificationAuthStatus: .authorized,
            systemDiagnostics: [
                "Node Path": "/usr/local/bin/node",
                "Copilot Path": "/usr/local/bin/copilot",
                "State Root": "/var/folders/xyz"
            ],
            managedSecrets: [
                ManagedSecretItem(account: "loop-1:GITHUB_TOKEN", loopID: "loop-1", loopName: "PR Review", envName: "GITHUB_TOKEN"),
                ManagedSecretItem(account: "loop-2:API_KEY", loopID: "loop-2", loopName: nil, envName: "API_KEY")
            ],
            keychainHealth: "Healthy",
            onSave: { _, _ in },
            onRequestNotificationAuth: { return .authorized },
            onCheckNotificationAuth: { return .authorized },
            onOpenSystemSettings: {},
            onDeleteSecret: { _ in },
            onCopyDiagnostic: { _ in },
            onOpenPath: { _ in }
        )

        SettingsView(viewModel: viewModel)
    }
}
