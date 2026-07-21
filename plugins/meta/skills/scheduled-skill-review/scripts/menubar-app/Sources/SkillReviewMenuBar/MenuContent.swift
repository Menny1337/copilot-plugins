import AppKit
import SwiftUI

/// Custom styled panel rendered by `MenuBarExtra(...).menuBarExtraStyle(.window)`.
/// Mirrors the approved menubar mockups: colored state dot, SF Symbol rows,
/// orange accent counts, a highlighted PRs row with an inline expand, and
/// hover-highlighted action rows.
struct MenuContent: View {
    @ObservedObject var model: MenuModel
    @Environment(\.openWindow) private var openWindow
    @State private var prsExpanded = true

    private var status: Status { model.status }

    private var dotColor: Color {
        switch status.daemonState {
        case .failed: return .red
        case .paused: return .secondary
        case .reviewing: return .blue
        case .prs: return .orange
        case .running: return .yellow
        case .idle: return .green
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "testtube.2")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.teal)
                Text(Constants.displayName)
                    .font(.headline)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 9)

            Divider().padding(.horizontal, 10)

            if let lastError = model.lastError {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .frame(width: 18)
                    Text("status error: \(lastError)")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                Divider().padding(.horizontal, 10)
            }

            VStack(alignment: .leading, spacing: 11) {
                HStack(spacing: 10) {
                    Circle().fill(dotColor).frame(width: 9, height: 9)
                    HStack(spacing: 0) {
                        Text("State: ").foregroundStyle(.secondary)
                        Text(status.enabled ? "enabled" : "paused").fontWeight(.medium)
                    }
                    Spacer(minLength: 0)
                }

                InfoRow(icon: "arrow.triangle.2.circlepath") {
                    HStack(spacing: 0) {
                        Text("Open cycles: ").foregroundStyle(.secondary)
                        Text("\(status.openCycles)")
                            .foregroundStyle(status.openCycles > 0 ? Color.orange : Color.primary)
                            .fontWeight(.medium)
                        Text("   ·   Due re-reviews: ").foregroundStyle(.secondary)
                        Text("\(status.dueReReviews)")
                            .foregroundStyle(status.dueReReviews > 0 ? Color.orange : Color.primary)
                            .fontWeight(.medium)
                    }
                }

                if let nextRun = status.formattedNextRun() {
                    InfoRow(icon: "clock") {
                        HStack(spacing: 0) {
                            Text("Next run: ").foregroundStyle(.secondary)
                            Text(nextRun)
                            if !status.enabled {
                                Text(" — paused").foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                if status.running {
                    InfoRow(icon: "sparkles") {
                        Text("Review in progress…").foregroundStyle(.secondary)
                    }
                }

                if status.openPRs > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        Button {
                            withAnimation(.easeInOut(duration: 0.12)) { prsExpanded.toggle() }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.yellow)
                                    .frame(width: 18)
                                Text("PRs awaiting your review: \(status.openPRs)")
                                    .fontWeight(.medium)
                                Spacer(minLength: 0)
                                Image(systemName: prsExpanded ? "chevron.down" : "chevron.right")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        if prsExpanded {
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(Array(status.prUrls.enumerated()), id: \.offset) { _, url in
                                    ActionRow(icon: "arrow.triangle.branch", title: prLabel(url), indent: true) {
                                        model.openPR(url)
                                    }
                                }
                                ActionRow(icon: "arrow.triangle.2.circlepath", title: "Reconcile PRs now", indent: true) {
                                    model.reconcile()
                                }
                            }
                        }
                    }
                }

                if let lastRun = status.lastRun {
                    InfoRow(icon: "checkmark.circle") {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 0) {
                                Text("Last run: ").foregroundStyle(.secondary)
                                Text("\(lastRun.runId) (\(lastRun.status))")
                            }
                            Text("applied \(lastRun.applied)  ·  reverted \(lastRun.reverted)  ·  PRs \(lastRun.prs)  ·  failed \(lastRun.failed)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    InfoRow(icon: "checkmark.circle") {
                        Text("Last run: never").foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 10)

            Divider().padding(.horizontal, 10)

            VStack(alignment: .leading, spacing: 1) {
                if status.enabled {
                    ActionRow(icon: "pause.circle", title: "Pause daemon") { model.pause() }
                } else {
                    ActionRow(icon: "play.circle", title: "Resume daemon") { model.resume() }
                }
                ActionRow(icon: "play.circle", title: "Run now") { model.runNow() }
                ActionRow(icon: "doc.text", title: "Open latest digest") { model.openLatestDigest() }
                ActionRow(icon: "gearshape", title: "Settings…") { openSettings() }
                ActionRow(icon: "folder", title: "Open workspace") { model.openWorkspace() }
                ActionRow(icon: "arrow.clockwise", title: "Refresh") {
                    Task { await model.refresh() }
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 6)
            .padding(.bottom, 8)
        }
        .frame(width: 320, alignment: .leading)
    }

    private func prLabel(_ url: String) -> String {
        if let last = url.split(separator: "/").last, !last.isEmpty {
            if Int(last) != nil { return "Open PR #\(last)" }
            return "Open \(last)"
        }
        return "Open PR"
    }

    /// Open the native settings window. The app is an accessory (no Dock icon),
    /// so switch to a regular activation policy first; `ConfigWindow.onDisappear`
    /// restores accessory mode so text fields get keyboard focus while open.
    private func openSettings() {
        NSApp.setActivationPolicy(.regular)
        openWindow(id: ConfigWindow.windowID)
        NSApp.activate(ignoringOtherApps: true)
    }
}

/// A non-interactive info line: leading SF Symbol + trailing content.
private struct InfoRow<Content: View>: View {
    let icon: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(.secondary)
                .frame(width: 18)
            content()
            Spacer(minLength: 0)
        }
    }
}

/// A clickable row with a hover highlight, matching the mockup's blue selection.
private struct ActionRow: View {
    let icon: String
    let title: String
    var indent: Bool = false
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .frame(width: 18)
                    .foregroundStyle(hover ? Color.white : Color.secondary)
                Text(title)
                    .foregroundStyle(hover ? Color.white : Color.primary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
            }
            .padding(.leading, indent ? 22 : 6)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .background(hover ? Color.accentColor : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
