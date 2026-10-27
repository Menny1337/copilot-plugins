import AppKit
import LoopsModels
import SwiftUI

// MARK: - LoopHealth display helpers (Dashboard-scoped)

private extension LoopHealth {
    var dotColor: Color {
        switch self {
        case .ok:      return LoopsPalette.success
        case .warning: return LoopsPalette.warning
        case .failing: return LoopsPalette.failure
        case .idle:    return LoopsPalette.inactive
        case .blocked: return LoopsPalette.operational
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .ok:      return "Healthy"
        case .warning: return "Warning"
        case .failing: return "Failing"
        case .idle:    return "Idle"
        case .blocked: return "Blocked"
        }
    }
}

// MARK: - DashboardView

/// Main dashboard detail pane for the Copilot Loops manager window.
///
/// **Integrator contract:**
/// ```swift
/// DashboardView(
///     snapshot: appModel.dashboardSnapshot,
///     onLoopSelected: { id in appModel.navigate(to: .loopDetail(loopID: id)) },
///     onNewLoop:  { appModel.navigate(to: .newLoop(kind: .copilot)) },
///     onAllLoops: { appModel.navigate(to: .section(.schedules)) }
/// )
/// ```
struct DashboardView: View {
    let snapshot: DashboardSnapshot
    let onLoopSelected: (String) -> Void
    let onNewLoop: () -> Void
    let onAllLoops: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            headerBar
            Divider()
            contentArea
            Divider()
            footerBar
        }
        .background(Color(nsColor: .underPageBackgroundColor))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Header

    private var headerBar: some View {
        HStack(alignment: .bottom, spacing: 20) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Copilot Loops")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("Dashboard")
                    .font(.largeTitle.bold())
            }
            Spacer(minLength: 16)
            metricsRow
        }
        .padding(.horizontal, 28)
        .padding(.top, 24)
        .padding(.bottom, 20)
    }

    private var metricsRow: some View {
        HStack(spacing: 14) {
            if snapshot.runningCount > 0 {
                DashboardMetricChip(count: snapshot.runningCount,
                                    label: "Running",
                                    color: LoopsPalette.running)
            }
            if snapshot.upNextCount > 0 {
                DashboardMetricChip(count: snapshot.upNextCount,
                                    label: "Up next",
                                    color: LoopsPalette.warning)
            }
            if snapshot.needsAttentionCount > 0 {
                DashboardMetricChip(count: snapshot.needsAttentionCount,
                                    label: "Needs attention",
                                    color: LoopsPalette.failure)
            }
        }
    }

    // MARK: Scrollable content

    private var contentArea: some View {
        ScrollView(.vertical, showsIndicators: true) {
            LazyVStack(alignment: .leading, spacing: 28) {
                if snapshot.allLoops.isEmpty {
                    LoopsEmptyState(
                        title: "No managed loops",
                        message: "Create your first loop to schedule Copilot agents and scripts to run hands-free.",
                        systemImage: "infinity"
                    )
                    .padding(.top, 60)
                } else {
                    if !snapshot.runningLoops.isEmpty {
                        runningNowSection
                    }
                    if !snapshot.upNextLoops.isEmpty {
                        upNextSection
                    }
                    if !snapshot.needsAttentionLoops.isEmpty {
                        needsAttentionSection
                    }
                    if !snapshot.recentActivity.isEmpty {
                        recentActivitySection
                    }
                    allLoopsSection
                }
            }
            .padding(28)
        }
    }

    // MARK: Running now

    private var runningNowSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Running now")
                .font(.headline)
            VStack(spacing: 6) {
                ForEach(snapshot.runningLoops) { item in
                    RunningLoopRow(item: item) { onLoopSelected(item.id) }
                }
            }
        }
    }

    // MARK: Up next

    private var upNextSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Up next")
                .font(.headline)
            VStack(spacing: 0) {
                ForEach(Array(snapshot.upNextLoops.enumerated()), id: \.element.id) { idx, item in
                    if idx > 0 { Divider().padding(.leading, 52) }
                    UpNextLoopRow(item: item) { onLoopSelected(item.id) }
                }
            }
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.35), lineWidth: 0.5)
            }
        }
    }

    // MARK: Needs attention

    private var needsAttentionSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Needs attention")
                .font(.headline)
            VStack(spacing: 0) {
                ForEach(Array(snapshot.needsAttentionLoops.enumerated()), id: \.element.id) { idx, item in
                    if idx > 0 { Divider().padding(.leading, 52) }
                    AttentionLoopRow(item: item) { onLoopSelected(item.id) }
                }
            }
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.35), lineWidth: 0.5)
            }
        }
    }

    // MARK: Recent activity

    private var recentActivitySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent activity")
                .font(.headline)
            VStack(spacing: 0) {
                ForEach(Array(snapshot.recentActivity.enumerated()), id: \.element.id) { idx, item in
                    if idx > 0 { Divider().padding(.leading, 34) }
                    ActivityFeedRow(item: item) { onLoopSelected(item.loopId) }
                }
            }
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.35), lineWidth: 0.5)
            }
        }
    }

    // MARK: All loops

    private var allLoopsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            LoopsSectionHeader("All Loops",
                               subtitle: "\(snapshot.totalLoops) loops total") {
                Button("Show all") { onAllLoops() }
                    .buttonStyle(.plain)
                    .font(.callout)
                    .foregroundStyle(.tint)
                    .accessibilityLabel("Show all loops")
            }
            VStack(spacing: 0) {
                let slice = Array(snapshot.allLoops.prefix(8))
                ForEach(Array(slice.enumerated()), id: \.element.id) { idx, item in
                    if idx > 0 { Divider().padding(.leading, 42) }
                    LoopSummaryRow(item: item) { onLoopSelected(item.id) }
                }
                if snapshot.allLoops.count > 8 {
                    Divider()
                    Button {
                        onAllLoops()
                    } label: {
                        Text("Show \(snapshot.allLoops.count - 8) more…")
                            .font(.callout)
                            .foregroundStyle(.tint)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                    }
                    .buttonStyle(.plain)
                }
            }
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.35), lineWidth: 0.5)
            }
        }
    }

    // MARK: Footer

    private var footerBar: some View {
        HStack(spacing: 12) {
            Button(action: onNewLoop) {
                Label("New Loop", systemImage: "plus")
                    .font(.callout.weight(.medium))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .accessibilityLabel("Create new loop")

            Button(action: onAllLoops) {
                Label("All Loops", systemImage: "list.bullet")
                    .font(.callout)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tint)
            .accessibilityLabel("View all loops")

            Spacer(minLength: 8)

            if snapshot.totalLoops > 0 {
                Text(snapshot.totalLoops == 1 ? "1 loop" : "\(snapshot.totalLoops) loops")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let nextRun = snapshot.nextRunDescription {
                Label(nextRun, systemImage: "clock")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Upcoming: \(nextRun)")
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }
}

// MARK: - DashboardMetricChip

private struct DashboardMetricChip: View {
    let count: Int
    let label: String
    let color: Color

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
                .accessibilityHidden(true)
            Text(label)
                .font(.callout)
                .foregroundStyle(.secondary)
            Text("\(count)")
                .font(.callout.weight(.semibold).monospacedDigit())
                .foregroundStyle(color)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(count)")
    }
}

// MARK: - LoopKindIcon

struct LoopKindIcon: View {
    let kind: LoopKind
    var size: CGFloat = 30

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.22)
                .fill(
                    (kind == .copilot ? LoopsPalette.identity : LoopsPalette.operational)
                        .opacity(0.12)
                )
                .frame(width: size, height: size)
            Image(systemName: kind.kindSystemImage)
                .font(.system(size: size * 0.43, weight: .semibold))
                .foregroundStyle(kind == .copilot ? LoopsPalette.identity : LoopsPalette.operational)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - RunningLoopRow

private struct RunningLoopRow: View {
    let item: RunningLoopItem
    let onTap: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                LoopKindIcon(kind: item.kind)
                Text(item.name)
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                Spacer(minLength: 8)
                LoopsStatusPill(title: "Running",
                                systemImage: "play.circle.fill",
                                tint: LoopsPalette.running)
                Text(item.elapsedLabel)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                Text("Live")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(LoopsPalette.running)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(LoopsPalette.running.opacity(0.12), in: Capsule())
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                isHovered
                    ? Color(nsColor: .controlBackgroundColor)
                    : Color(nsColor: .controlBackgroundColor).opacity(0.6)
            )
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(LoopsPalette.running.opacity(0.35), lineWidth: 0.75)
        }
        .accessibilityLabel("\(item.name). Running. \(item.elapsedLabel)")
        .accessibilityHint("Open live run view")
    }
}

// MARK: - UpNextLoopRow

private struct UpNextLoopRow: View {
    let item: UpNextLoopItem
    let onTap: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                LoopKindIcon(kind: item.kind)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .font(.callout.weight(.medium))
                        .lineLimit(1)
                    Text(item.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(item.scheduledDateLabel)
                        .font(.caption.weight(.medium))
                    Text(item.relativeLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("\(item.scheduledDateLabel), \(item.relativeLabel)")
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(isHovered ? Color(nsColor: .selectedContentBackgroundColor).opacity(0.06) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel("\(item.name). Scheduled \(item.scheduledDateLabel), \(item.relativeLabel)")
        .accessibilityHint("Open loop detail")
    }
}

// MARK: - AttentionLoopRow

private struct AttentionLoopRow: View {
    let item: AttentionLoopItem
    let onTap: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                ZStack(alignment: .bottomTrailing) {
                    LoopKindIcon(kind: item.kind)
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(LoopsPalette.failure)
                        .background(Color(nsColor: .underPageBackgroundColor), in: Circle())
                        .offset(x: 3, y: 3)
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(item.name)
                            .font(.callout.weight(.medium))
                            .lineLimit(1)
                        if let status = item.lastRunStatus {
                            LoopsStatusPill(title: status.displayName,
                                            systemImage: status.systemImage,
                                            tint: status.tint)
                        }
                    }
                    Text(item.detailLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(isHovered ? Color(nsColor: .selectedContentBackgroundColor).opacity(0.06) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel("\(item.name). \(item.detailLabel)")
        .accessibilityHint("Open loop detail")
    }
}

// MARK: - ActivityFeedRow

private struct ActivityFeedRow: View {
    let item: ActivityItem
    let onTap: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                Image(systemName: item.status.systemImage)
                    .foregroundStyle(item.status.tint)
                    .frame(width: 18)
                    .accessibilityLabel(item.status.displayName)
                Text(item.loopName)
                    .font(.callout)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let started = item.startedLabel {
                    Text(started)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let dur = item.durationLabel {
                    Text(dur)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(minWidth: 44, alignment: .trailing)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(isHovered ? Color(nsColor: .selectedContentBackgroundColor).opacity(0.06) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel(
            "\(item.loopName). \(item.status.displayName)."
                + (item.startedLabel.map { " Started \($0)." } ?? "")
                + (item.durationLabel.map { " Duration \($0)." } ?? "")
        )
    }
}

// MARK: - LoopSummaryRow

private struct LoopSummaryRow: View {
    let item: LoopSummaryItem
    let onTap: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                // Health indicator dot
                Circle()
                    .fill(item.health.dotColor)
                    .frame(width: 7, height: 7)
                    .accessibilityLabel(item.health.accessibilityLabel)

                LoopKindIcon(kind: item.kind, size: 24)

                Text(item.name)
                    .font(.callout)
                    .lineLimit(1)

                Spacer(minLength: 8)

                LoopsStatusPill(
                    title: item.lifecycle.displayName,
                    systemImage: lifecycleSystemImage(item.lifecycle),
                    tint: item.lifecycle.tint
                )

                if let next = item.nextRunLabel {
                    Text(next)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(isHovered ? Color(nsColor: .selectedContentBackgroundColor).opacity(0.06) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel(
            "\(item.name). \(item.lifecycle.displayName). \(item.statusSummary)."
                + (item.nextRunLabel.map { " Next run: \($0)." } ?? "")
        )
    }

    private func lifecycleSystemImage(_ lc: LoopLifecycle) -> String {
        switch lc {
        case .enabled:    return "checkmark.circle"
        case .paused:     return "pause.circle"
        case .ready:      return "circle.dotted"
        case .draft:      return "pencil.circle"
        case .needsReview: return "exclamationmark.circle"
        case .archived:   return "archivebox"
        }
    }
}

// MARK: - Previews

struct DashboardView_Previews: PreviewProvider {
    static var previews: some View {
        let now = LoopProjection.parseTimestamp(LoopsPreviewData.timestamp)!
        let snapshot = DashboardSnapshot.build(
            from: LoopsPreviewData.loopStates,
            runs: LoopsPreviewData.recentRuns,
            now: now
        )
        DashboardView(
            snapshot: snapshot,
            onLoopSelected: { _ in },
            onNewLoop: {},
            onAllLoops: {}
        )
        .frame(width: 680, height: 580)
        .previewDisplayName("Dashboard – populated")

        DashboardView(
            snapshot: .empty,
            onLoopSelected: { _ in },
            onNewLoop: {},
            onAllLoops: {}
        )
        .frame(width: 680, height: 400)
        .previewDisplayName("Dashboard – empty")
    }
}
