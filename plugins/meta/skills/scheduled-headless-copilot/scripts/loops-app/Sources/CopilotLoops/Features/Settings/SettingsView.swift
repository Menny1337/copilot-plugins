import SwiftUI
import LoopsModels
import UserNotifications

public struct SettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel

    public init(viewModel: SettingsViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        TabView {
            GeneralSettingsView(viewModel: viewModel)
                .tabItem { Label("General", systemImage: "gearshape") }

            SchedulesSettingsView(viewModel: viewModel)
                .tabItem { Label("Schedules", systemImage: "calendar") }

            NotificationsSettingsView(viewModel: viewModel)
                .tabItem { Label("Notifications", systemImage: "bell") }

            PermissionsSettingsView(viewModel: viewModel)
                .tabItem { Label("Permissions", systemImage: "hand.raised") }

            CredentialsSettingsView(viewModel: viewModel)
                .tabItem { Label("Credentials", systemImage: "key") }

            AdvancedSettingsView(viewModel: viewModel)
                .tabItem { Label("Advanced", systemImage: "slider.horizontal.3") }

            AboutSettingsView()
                .tabItem { Label("About", systemImage: "info.circle") }
        }
        .padding()
        .frame(minWidth: ManagerLayout.settingsMinWidth, minHeight: ManagerLayout.settingsMinHeight)
        .overlay(alignment: .bottomTrailing) {
            saveControls
                .padding()
        }
        .alert("Error", isPresented: Binding<Bool>(
            get: { viewModel.error != nil },
            set: { if !$0 { viewModel.error = nil } }
        )) {
            Button("OK", role: .cancel) {
                viewModel.error = nil
            }
        } message: {
            Text(viewModel.error ?? "Unknown error")
        }
    }

    @ViewBuilder
    private var saveControls: some View {
        if viewModel.isDirty {
            HStack {
                Button("Cancel") {
                    viewModel.cancel()
                }
                .disabled(viewModel.isSaving)

                Button("Save") {
                    viewModel.save()
                }
                .disabled(viewModel.isSaving)
                .keyboardShortcut(.return, modifiers: .command)
            }
            .padding()
            .background(.regularMaterial)
            .cornerRadius(8)
            .shadow(radius: 2)
        }
    }
}
