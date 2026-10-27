import AppKit
import SwiftUI

/// Offscreen render of the app's real SwiftUI views to PNG, for regenerating the
/// `ux-design/` mockups without screenshotting a live menu-bar popover. Invoked
/// via `SkillReviewMenuBar --snapshot menu <out.png> [light|dark]`.
///
/// Note: only the pure-SwiftUI menu popover renders via `ImageRenderer`. The
/// settings window uses AppKit-backed `Form`/`List` views that `ImageRenderer`
/// captures as blank, so it is rendered by `PreviewWindow` (a real on-screen
/// `NSWindow` + `screencapture`) instead — see `--preview-config`.
enum Snapshot {
    @MainActor
    static func run(_ args: [String]) {
        let view = args.first ?? "menu"
        let outPath = args.count > 1 ? args[1] : "/tmp/skill-review-\(view).png"
        let dark = !(args.count > 2 && args[2].lowercased() == "light")

        NSApplication.shared.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)

        let ok: Bool
        switch view {
        case "menu":
            ok = render(menuMockup(), to: outPath, dark: dark)
        case "config":
            FileHandle.standardError.write(Data("Use --preview-config for the settings window (ImageRenderer can't capture Form)\n".utf8))
            exit(2)
        default:
            FileHandle.standardError.write(Data("Unknown snapshot view: \(view)\n".utf8))
            exit(2)
        }

        if ok {
            print(outPath)
            exit(0)
        }
        FileHandle.standardError.write(Data("Snapshot failed for \(view)\n".utf8))
        exit(1)
    }

    @MainActor
    private static func menuMockup() -> some View {
        let nextRun = ISO8601DateFormatter().string(from: Date().addingTimeInterval(16 * 3600))
        let status = Status(
            enabled: true,
            running: false,
            nextRun: nextRun,
            deployMode: "pr",
            autoMergeUnits: [],
            prUnits: ["memory", "browser"],
            include: [],
            exclude: [],
            lastRun: Status.LastRun(runId: "2026-06-25-1800", status: "ok", applied: 1, reverted: 0, prs: 2, failed: 0),
            openCycles: 2,
            openPRs: 2,
            prUrls: [
                "https://github.com/example-org/example-repo/pull/1",
                "https://github.com/example-org/example-repo/pull/2",
            ],
            dueReReviews: 1
        )
        return MenuContent(model: MenuModel(snapshotStatus: status))
    }

    @MainActor
    static func render(_ view: some View, to path: String, dark: Bool, scale: CGFloat = 2) -> Bool {
        let scheme: ColorScheme = dark ? .dark : .light
        let framed = view
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
            )
            .padding(44)
            .background(Color(nsColor: .underPageBackgroundColor))
            .environment(\.colorScheme, scheme)

        let renderer = ImageRenderer(content: framed)
        renderer.scale = scale
        guard let cgImage = renderer.cgImage else { return false }
        let rep = NSBitmapImageRep(cgImage: cgImage)
        guard let data = rep.representation(using: .png, properties: [:]) else { return false }
        do {
            try data.write(to: URL(fileURLWithPath: path))
            return true
        } catch {
            return false
        }
    }
}
