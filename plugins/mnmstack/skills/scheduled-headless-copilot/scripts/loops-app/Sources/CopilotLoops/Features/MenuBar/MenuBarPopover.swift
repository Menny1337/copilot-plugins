import AppKit
import LoopsModels
import SwiftUI

// MARK: - MenuBarPopover

/// Compact menu-bar popover showing aggregate status, quick actions, and
/// navigation shortcuts for Copilot Loops.
///
/// All side effects are expressed as closures supplied by the integrator:
///
/// ```swift
/// MenuBarPopover(
///     snapshot: appModel.menuBarSnapshot,
///     onPauseAll:  { appModel.pauseAll() },
///     onResumeAll: { appModel.resumeAll() },
///     onRunNow:    { id in appModel.runNow(loopID: id) },
///     onOpenApp:   { NSApp.activate(ignoringOtherApps: true) },
///     onHistory:   { appModel.navigate(to: .section(.history)) },
///     onSettings:  { appModel.navigate(to: .section(.settings)) },
///     onQuit:      { NSApp.terminate(nil) }
/// )
/// ```
///
/// The view does **not** open or focus the main app window itself; call
/// `NSApp.activate(ignoringOtherApps: true)` inside `onOpenApp` when needed.
struct MenuBarPopover: View {
    let snapshot: MenuBarSnapshot
    let onPauseAll: () -> Void
    let onResumeAll: () -> Void
    let onRunNow: (String) -> Void
    let onOpenApp: () -> Void
    let onHistory: () -> Void
    let onSettings: () -> Void
    let onQuit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            titleRow
                .padding(.top, 12)
                .padding(.horizontal, 12)

            Divider()
                .padding(.vertical, 8)
                .padding(.horizontal, 12)

            statusSection
                .padding(.horizontal, 12)

            Divider()
                .padding(.vertical, 8)
                .padding(.horizontal, 12)

            primaryActionsSection
                .padding(.horizontal, 4)

            Divider()
                .padding(.vertical, 4)
                .padding(.horizontal, 12)

            secondaryActionsSection
                .padding(.horizontal, 4)
                .padding(.bottom, 8)
        }
        .frame(width: 300)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: Title row

    private var titleRow: some View {
        HStack(spacing: 8) {
            Image(systemName: "infinity")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(LoopsPalette.identity)
                .accessibilityHidden(true)
            Text("Copilot Loops")
                .font(.headline)
            Spacer(minLength: 0)
            aggregateStatusBadge
        }
        .padding(.bottom, 2)
    }

    private var aggregateStatusBadge: some View {
        let color: Color
        let label: String
        switch snapshot.aggregateStatus {
        case .running:
            color = LoopsPalette.success
            label = "Running"
        case .failing:
            color = LoopsPalette.failure
            label = "Failing"
        case .idle:
            color = LoopsPalette.inactive
            label = "Idle"
        }
        return LoopsStatusPill(title: label, systemImage: "circle.fill", tint: color)
    }

    // MARK: Status section

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Running now
            PopoverStatusRow(
                systemImage: "circle.fill",
                color: snapshot.runningCount > 0 ? LoopsPalette.success : LoopsPalette.inactive,
                text: snapshot.runningCount == 0
                    ? "No loops running"
                    : (snapshot.runningCount == 1 ? "Running now: 1" : "Running now: \(snapshot.runningCount)"),
                accessibilityLabel: "Running: \(snapshot.runningCount)"
            )

            // Next run
            if let nextRun = snapshot.nextRunDescription {
                PopoverStatusRow(
                    systemImage: "clock",
                    color: .secondary,
                    text: "Next run: \(nextRun)",
                    accessibilityLabel: "Next scheduled run: \(nextRun)"
                )
            }

            // Failed
            if snapshot.failedCount > 0 {
                PopoverStatusRow(
                    systemImage: "circle.fill",
                    color: LoopsPalette.failure,
                    text: snapshot.failedCount == 1 ? "Failed: 1" : "Failed: \(snapshot.failedCount)",
                    accessibilityLabel: "Failed loops: \(snapshot.failedCount)"
                )
            }
        }
    }

    // MARK: Primary actions

    private var primaryActionsSection: some View {
        VStack(spacing: 2) {
            // Pause all / Resume all
            if snapshot.allPaused {
                LoopsActionRow(
                    title: "Resume all",
                    systemImage: "play.fill",
                    action: onResumeAll
                )
            } else {
                LoopsActionRow(
                    title: "Pause all",
                    systemImage: "pause.fill",
                    action: onPauseAll
                )
                .disabled(!snapshot.hasPausable)
                .opacity(snapshot.hasPausable ? 1 : 0.45)
            }

            // Resume all alongside Pause all when in mixed state
            if !snapshot.allPaused && snapshot.hasResumable {
                LoopsActionRow(
                    title: "Resume paused",
                    systemImage: "play.circle.fill",
                    action: onResumeAll
                )
            }

            // Run now
            runNowControl

            // Open app
            LoopsActionRow(
                title: "Open Copilot Loops",
                systemImage: "macwindow",
                action: onOpenApp
            )
        }
    }

    @ViewBuilder
    private var runNowControl: some View {
        if snapshot.runNowEligible.isEmpty {
            LoopsActionRow(title: "Run now", systemImage: "play.circle", action: {})
                .disabled(true)
                .opacity(0.45)
        } else if snapshot.runNowEligible.count == 1, let single = snapshot.runNowEligible.first {
            LoopsActionRow(
                title: "Run now",
                systemImage: "play.circle",
                detail: single.name,
                action: { onRunNow(single.id) }
            )
        } else {
            MenuActionRow(
                title: "Run now",
                systemImage: "play.circle",
                items: snapshot.runNowEligible,
                onSelect: onRunNow
            )
        }
    }

    // MARK: Secondary actions

    private var secondaryActionsSection: some View {
        VStack(spacing: 2) {
            LoopsActionRow(title: "History", systemImage: "clock.arrow.circlepath", action: onHistory)
            LoopsActionRow(title: "Settings", systemImage: "gearshape", action: onSettings)
            LoopsActionRow(title: "Quit Copilot Loops", systemImage: "power",
                           role: .destructive, action: onQuit)
        }
    }
}

// MARK: - PopoverStatusRow

private struct PopoverStatusRow: View {
    let systemImage: String
    let color: Color
    let text: String
    let accessibilityLabel: String

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: systemImage)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(color)
                .frame(width: 14)
                .accessibilityHidden(true)
            Text(text)
                .font(.callout)
                .foregroundStyle(.primary)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }
}

// MARK: - MenuActionRow

/// A row that presents a SwiftUI `Menu` drop-down for "Run now" when multiple
/// loops are eligible. Matches the visual style of `LoopsActionRow`.
private struct MenuActionRow: View {
    let title: String
    let systemImage: String
    let items: [RunNowItem]
    let onSelect: (String) -> Void
    @State private var isHovered = false

    var body: some View {
        Menu {
            ForEach(items) { item in
                Button(item.name) { onSelect(item.id) }
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .frame(width: 18)
                Text(title)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(isHovered ? Color.white.opacity(0.7) : Color.secondary)
            }
            .foregroundStyle(isHovered ? Color.white : Color.primary)
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(isHovered ? Color.accentColor : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .onHover { isHovered = $0 }
        .accessibilityLabel("\(title) — \(items.count) loops available")
    }
}

// MARK: - Previews

struct MenuBarPopover_Previews: PreviewProvider {
    static var previews: some View {
        let now = LoopProjection.parseTimestamp(LoopsPreviewData.timestamp)!
        let snapshot = MenuBarSnapshot.build(from: LoopsPreviewData.loopStates, now: now)
        MenuBarPopover(
            snapshot: snapshot,
            onPauseAll: {},
            onResumeAll: {},
            onRunNow: { _ in },
            onOpenApp: {},
            onHistory: {},
            onSettings: {},
            onQuit: {}
        )
        .previewDisplayName("Menu bar – running state")

        MenuBarPopover(
            snapshot: .empty,
            onPauseAll: {},
            onResumeAll: {},
            onRunNow: { _ in },
            onOpenApp: {},
            onHistory: {},
            onSettings: {},
            onQuit: {}
        )
        .previewDisplayName("Menu bar – empty state")
    }
}
