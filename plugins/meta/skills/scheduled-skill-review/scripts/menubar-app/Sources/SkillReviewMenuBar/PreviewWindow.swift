import AppKit
import SwiftUI

/// Renders the real `ConfigWindow` in an on-screen `NSWindow` and captures it
/// with `screencapture`. Unlike `Snapshot` (ImageRenderer), this path runs a
/// real AppKit run loop, so AppKit-backed views like `Form` populate correctly.
/// Invoked via `SkillReviewMenuBar --preview-config <out.png> [light|dark]`.
enum PreviewWindow {
    @MainActor
    static func run(_ args: [String]) {
        let outPath = args.first ?? "/tmp/skill-review-config-preview.png"
        let dark = !(args.count > 1 && args[1].lowercased() == "light")

        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        app.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)

        let config = Config(
            enabled: true,
            schedule: ScheduleConfig(hour: 18, minute: 0, weekdays: [1, 2, 3, 4]),
            concurrency: 2,
            autoDeploy: true,
            autoRevert: true,
            deployMode: "pr",
            revertDeployMode: "pr",
            include: ["assistant", "narrate"],
            exclude: ["pptx"],
            autoMergeUnits: ["memory", "browser"],
            prUnits: ["research-methodology", "assistant"],
            signalThreshold: 5,
            observationWindowDays: 3,
            firstRunLookbackDays: 7,
            maxFirstRunSessions: 200,
            repoDir: "/Users/you/Repos/copilot-plugins",
            marketplaceName: "menny1337-plugins",
            ghAccount: "the user"
        )
        let root = ConfigWindow(model: ConfigModel(snapshot: config), autoLoad: false)
        let hosting = NSHostingView(rootView: root)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 900),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Skill Review Settings"
        window.titlebarAppearsTransparent = true
        window.contentView = hosting
        window.center()
        window.makeKeyAndOrderFront(nil)
        app.activate(ignoringOtherApps: true)

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            let id = window.windowNumber
            let capture = Process()
            capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            capture.arguments = ["-o", "-x", "-l\(id)", outPath]
            try? capture.run()
            capture.waitUntilExit()
            let ok = capture.terminationStatus == 0 && FileManager.default.fileExists(atPath: outPath)
            if ok { print(outPath) } else { FileHandle.standardError.write(Data("preview capture failed\n".utf8)) }
            exit(ok ? 0 : 3)
        }
        app.run()
    }
}
