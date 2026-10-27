import AppKit
import LoopsModels
import SwiftUI

enum LoopsPalette {
    static let identity = Color(nsColor: .systemTeal)
    static let operational = Color(nsColor: .systemOrange)
    static let success = Color(nsColor: .systemGreen)
    static let warning = Color(nsColor: .systemOrange)
    static let failure = Color(nsColor: .systemRed)
    static let running = Color(nsColor: .systemBlue)
    static let inactive = Color.secondary
}

struct LoopsCard<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.35), lineWidth: 0.5)
            }
    }
}

struct LoopsMetricTile: View {
    let title: String
    let value: String
    let systemImage: String
    var tint: Color = LoopsPalette.identity
    var subtitle: String?

    var body: some View {
        LoopsCard {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 34, height: 34)
                    .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(value)
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                    if let subtitle {
                        Text(subtitle)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct LoopsStatusPill: View {
    let title: String
    let systemImage: String
    let tint: Color

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.medium))
            .lineLimit(1)
            .truncationMode(.tail)
            .foregroundStyle(tint)
            .padding(.horizontal, HistoryLayout.statusPillHorizontalPadding)
            .padding(.vertical, 4)
            .background(tint.opacity(0.12), in: Capsule())
            .help(title)
            .accessibilityLabel(title)
    }
}

struct LoopsSectionHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    private let trailing: Trailing

    init(
        _ title: String,
        subtitle: String? = nil,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.title = title
        self.subtitle = subtitle
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.title2.weight(.semibold))
                if let subtitle {
                    Text(subtitle)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            trailing
        }
    }
}

extension LoopsSectionHeader where Trailing == EmptyView {
    init(_ title: String, subtitle: String? = nil) {
        self.init(title, subtitle: subtitle) { EmptyView() }
    }
}

struct LoopsEmptyState: View {
    let title: String
    let message: String
    let systemImage: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(LoopsPalette.identity)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .padding(24)
        .accessibilityElement(children: .combine)
    }
}

struct LoopsActionRow: View {
    let title: String
    let systemImage: String
    var detail: String?
    var role: ButtonRole?
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(role: role, action: action) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .frame(width: 18)
                Text(title)
                Spacer(minLength: 8)
                if let detail {
                    Text(detail)
                        .foregroundStyle(isHovered ? Color.white.opacity(0.8) : Color.secondary)
                        .lineLimit(1)
                }
            }
            .foregroundStyle(isHovered ? Color.white : Color.primary)
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(isHovered ? Color.accentColor : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }
}

extension RunStatus {
    var systemImage: String {
        switch self {
        case .starting: return "hourglass"
        case .running: return "play.circle.fill"
        case .stopping: return "stop.circle"
        case .succeeded: return "checkmark.circle.fill"
        case .failed, .launchFailed: return "xmark.circle.fill"
        case .timedOut: return "clock.badge.exclamationmark"
        case .cancelled: return "minus.circle"
        case .skippedOverlap, .skippedMissed, .skippedPaused: return "arrow.right.circle"
        case .approvalBlocked: return "lock.trianglebadge.exclamationmark"
        }
    }

    var tint: Color {
        switch self {
        case .succeeded: return LoopsPalette.success
        case .failed, .timedOut, .launchFailed: return LoopsPalette.failure
        case .starting, .running, .stopping: return LoopsPalette.running
        case .approvalBlocked: return LoopsPalette.operational
        case .cancelled, .skippedOverlap, .skippedMissed, .skippedPaused:
            return LoopsPalette.inactive
        }
    }
}

extension LoopLifecycle {
    var displayName: String {
        switch self {
        case .draft: return "Draft"
        case .needsReview: return "Needs review"
        case .ready: return "Ready"
        case .enabled: return "Enabled"
        case .paused: return "Paused"
        case .archived: return "Archived"
        }
    }

    var tint: Color {
        switch self {
        case .enabled: return LoopsPalette.success
        case .needsReview: return LoopsPalette.operational
        case .ready: return LoopsPalette.identity
        case .draft, .paused, .archived: return LoopsPalette.inactive
        }
    }
}
