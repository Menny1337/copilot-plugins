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
            include: [],
            exclude: [],
            skillPaths: ["/Users/you/.copilot/skills/assistant-capture/SKILL.md"],
            skillFolders: ["/Users/you/.copilot/skills"],
            autoMergeUnits: ["memory", "browser"],
            prUnits: ["research-methodology", "agent-skill-audit"],
            signalThreshold: 5,
            observationWindowDays: 3,
            firstRunLookbackDays: 7,
            maxFirstRunSessions: 200,
            repoDir: "/Users/you/Repos/copilot-plugins",
            marketplaceName: "menny1337-plugins",
            ghAccount: "the user"
        )
        let units = [
            ReviewUnit(name: "agent-crafting", path: "/Users/you/Repos/copilot-plugins/plugins/meta/skills/agent-crafting/SKILL.md", plugin: "meta"),
            ReviewUnit(name: "agent-skill-audit", path: "/Users/you/Repos/copilot-plugins/plugins/meta/skills/agent-skill-audit/SKILL.md", plugin: "meta"),
            ReviewUnit(name: "assistant-capture", path: "/Users/you/.copilot/skills/assistant-capture/SKILL.md", source: "external"),
            ReviewUnit(name: "govuk-style", path: "/Users/you/.copilot/skills/govuk-style/SKILL.md", source: "external", sourceKind: "folder", sourceRoot: "/Users/you/.copilot/skills"),
            ReviewUnit(name: "browser", path: "/Users/you/Repos/copilot-plugins/plugins/core-skills/skills/browser/SKILL.md", plugin: "core-skills"),
            ReviewUnit(name: "memory", path: "/Users/you/Repos/copilot-plugins/plugins/core-skills/skills/memory/SKILL.md", plugin: "core-skills"),
            ReviewUnit(name: "research-methodology", path: "/Users/you/Repos/copilot-plugins/plugins/core-skills/skills/research-methodology/SKILL.md", plugin: "core-skills"),
            ReviewUnit(name: "scheduled-skill-review", path: "/Users/you/Repos/copilot-plugins/plugins/meta/skills/scheduled-skill-review/SKILL.md", plugin: "meta"),
            ReviewUnit(name: "skill-crafting", path: "/Users/you/Repos/copilot-plugins/plugins/meta/skills/skill-crafting/SKILL.md", plugin: "meta"),
            ReviewUnit(name: "agent-architect", type: "agent", path: "/Users/you/Repos/copilot-plugins/plugins/meta/agents/agent-architect.agent.md", plugin: "meta"),
        ]
        let root = ConfigWindow(model: ConfigModel(snapshot: config, units: units), autoLoad: false)
        let hosting = NSHostingView(rootView: root)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 840, height: 1_700),
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
