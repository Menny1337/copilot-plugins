import AppKit
import LoopsModels
import SwiftUI

@main
struct CopilotLoopsApp: App {
    static let managerWindowID = "manager"

    @StateObject private var model = AppModel()
    @AppStorage(AppModel.showMenuBarIconKey) private var showMenuBarIcon = true

    init() {
        UserDefaults.standard.register(defaults: [AppModel.showMenuBarIconKey: true])
        let policy: NSApplication.ActivationPolicy =
            UserDefaults.standard.bool(forKey: AppModel.showMenuBarIconKey) ? .accessory : .regular
        NSApplication.shared.setActivationPolicy(policy)
    }

    var body: some Scene {
        MenuBarExtra(isInserted: $showMenuBarIcon) {
            MenuBarRoot(model: model)
        } label: {
            MenuBarStatusLabel(snapshot: model.menuBarSnapshot)
        }
        .menuBarExtraStyle(.window)

        Window("Copilot Loops", id: Self.managerWindowID) {
            ManagerWindow(model: model)
                .onChange(of: showMenuBarIcon) { visible in
                    NSApplication.shared.setActivationPolicy(visible ? .accessory : .regular)
                }
        }
        .windowResizability(.contentMinSize)
        .defaultSize(width: ManagerLayout.windowDefaultWidth, height: ManagerLayout.windowDefaultHeight)
    }
}
