import AppKit
import SwiftUI

@main
struct SkillReviewMenuBarApp: App {
    @StateObject private var model = MenuModel()
    @StateObject private var configModel = ConfigModel()

    init() {
        let args = CommandLine.arguments
        if let idx = args.firstIndex(of: "--snapshot") {
            Snapshot.run(Array(args.dropFirst(idx + 1)))
            // Snapshot.run calls exit(); this is never reached.
        }
        if let idx = args.firstIndex(of: "--preview-config") {
            PreviewWindow.run(Array(args.dropFirst(idx + 1)))
            // PreviewWindow.run runs NSApp and calls exit(); never reached.
        }
        NSApplication.shared.setActivationPolicy(.accessory)
    }

    var body: some Scene {
        MenuBarExtra {
            MenuContent(model: model)
        } label: {
            StateIconView(state: model.status.daemonState)
        }
        .menuBarExtraStyle(.window)

        Window("Skill Review Settings", id: ConfigWindow.windowID) {
            ConfigWindow(model: configModel)
        }
        .windowResizability(.contentMinSize)
        .defaultSize(width: 820, height: 820)
    }
}
