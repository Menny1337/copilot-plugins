import Foundation

struct Constants {
    static let productName = "SkillReviewMenuBar"
    static let displayName = "Skill Review"
    static let executableName = "SkillReviewMenuBar"
    static let bundleIdentifier = "com.copilotplugins.skill-review.menubar"
    static let launchAgentLabel = "com.copilotplugins.skill-review.menubar"
    static let installPath = "~/Applications/SkillReviewMenuBar.app"
    static let launchAgentInstallPath = "~/Library/LaunchAgents/com.copilotplugins.skill-review.menubar.plist"

    static let workspacePath = "~/.copilot/agent-architect/skill-reviews"
    static let daemonControlScriptName = "daemon-ctl.sh"
    static let scriptDirEnvironmentKey = "SKILL_REVIEW_SCRIPT_DIR"
    static let menubarConfigFileName = "menubar.json"
    static let runNowCommandFileName = "RunSkillReviewNow.command"

    static let mandatoryPath = "/opt/homebrew/bin:/usr/local/bin:/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    static let refreshSeconds: TimeInterval = 300
    static let debounceSeconds: TimeInterval = 0.4

    static let iconStateNames = ["running", "idle", "paused", "prs", "failed", "reviewing"]
    static let watchedFileNames: Set<String> = [
        "state.json", "cycles.json", "config.json", "lock", "cycles.lock", "latest-digest.md"
    ]

    static var workspaceURL: URL {
        URL(fileURLWithPath: workspacePath.expandingTildeInPath, isDirectory: true)
    }
}

extension String {
    var expandingTildeInPath: String {
        guard hasPrefix("~") else { return self }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if self == "~" { return home }
        if hasPrefix("~/") { return home + String(dropFirst()) }
        return self
    }
}
