import CoreGraphics
import Foundation

/// Width/height budget for the manager window.
///
/// `NavigationSplitView` on macOS is backed by an `NSSplitViewController` whose
/// columns are laid out inside whatever width the split view itself receives.
/// If the split view (or a column's own content) reports a minimum width larger
/// than the space it is offered, SwiftUI still lays it out at that larger width
/// and *centers* the result in the available space. The overflow is then clipped
/// on both edges, which pushes the sidebar's leading icons and labels outside
/// the window.
///
/// Derivation direction matters, so the contract can actually fail:
///
///   destination minimums → `detailMinWidth` → `effectiveWindowMinContentWidth`
///                                             ≤ `windowMinContentWidth` (declared budget)
///
/// `windowMinContentWidth` is an independently declared budget, *not* something
/// the detail minimum is derived from. Growing a destination therefore raises
/// `effectiveWindowMinContentWidth` until it breaches the budget and
/// `ManagerLayoutContract` fails.
public enum ManagerLayout {
    // MARK: Sidebar column

    public static let sidebarMinWidth: CGFloat = 200
    public static let sidebarIdealWidth: CGFloat = 236
    public static let sidebarMaxWidth: CGFloat = 320

    /// Width the split view divider takes from the content rect.
    public static let splitDividerWidth: CGFloat = 1

    // MARK: Declared window budget

    /// Largest window minimum the design is willing to ship. Nothing derives
    /// from this; the contract asserts the computed minimum stays under it.
    public static let windowMinContentWidth: CGFloat = 1120
    public static let windowMinContentHeight: CGFloat = 660
    public static let windowDefaultWidth: CGFloat = 1180
    public static let windowDefaultHeight: CGFloat = 780

    // MARK: Shared spacing

    public static let screenPadding: CGFloat = 18
    public static let cardPadding: CGFloat = 16
    public static let columnGap: CGFloat = 14

    // MARK: Typography reference points
    //
    // macOS text style point sizes used when sizing text-driven columns.

    public static let captionPointSize: CGFloat = 10
    public static let bodyPointSize: CGFloat = 13

    // MARK: Destination requirements

    /// Sections built from adaptive grids and wrapping stacks; they compress
    /// well and only need a readable floor.
    public static let browsableSectionMinWidth: CGFloat = 560
    public static let browsableSectionMinHeight: CGFloat = 560
    public static let settingsMinWidth: CGFloat = 600
    public static let settingsMinHeight: CGFloat = 450

    /// Pushed routes rendered inside the same detail column.
    public static let builderMinWidth: CGFloat = 720
    public static let builderMinHeight: CGFloat = 620

    /// Minimum width each top-level section needs before it has to overflow.
    public static func minimumDetailWidth(for section: LoopsSection) -> CGFloat {
        switch section {
        case .history: return HistoryLayout.minDetailWidth
        case .settings: return settingsMinWidth
        case .dashboard, .schedules, .library: return browsableSectionMinWidth
        }
    }

    public static func minimumDetailHeight(for section: LoopsSection) -> CGFloat {
        switch section {
        case .settings: return settingsMinHeight
        case .history, .dashboard, .schedules, .library: return browsableSectionMinHeight
        }
    }

    /// Every destination the detail column has to render: section routes plus
    /// pushed routes.
    public static var detailRequirements: [DetailRequirement] {
        var items = LoopsSection.allCases.map {
            DetailRequirement(
                name: $0.rawValue,
                minWidth: minimumDetailWidth(for: $0),
                minHeight: minimumDetailHeight(for: $0)
            )
        }
        items.append(
            DetailRequirement(name: "loopBuilder", minWidth: builderMinWidth, minHeight: builderMinHeight)
        )
        return items
    }

    public struct DetailRequirement: Equatable, Sendable {
        public let name: String
        public let minWidth: CGFloat
        public let minHeight: CGFloat

        public init(name: String, minWidth: CGFloat, minHeight: CGFloat) {
            self.name = name
            self.minWidth = minWidth
            self.minHeight = minHeight
        }
    }

    // MARK: Detail column

    /// Minimum the detail column must guarantee: the widest destination.
    public static var detailMinWidth: CGFloat {
        detailRequirements.reduce(0) { max($0, $1.minWidth) }
    }

    /// Minimum the detail column must guarantee: the tallest destination.
    public static var detailMinHeight: CGFloat {
        detailRequirements.reduce(0) { max($0, $1.minHeight) }
    }

    // MARK: Resulting window minimum

    /// Window content width AppKit ends up enforcing once the sidebar column
    /// minimum and the detail column minimum are both honoured.
    public static var effectiveWindowMinContentWidth: CGFloat {
        sidebarMinWidth + splitDividerWidth + detailMinWidth
    }

    public static var effectiveWindowMinContentHeight: CGFloat { detailMinHeight }
}

/// Composition of the History screen's minimum width. The view builds its
/// columns from exactly these values so the contract stays truthful.
public enum HistoryLayout {
    // MARK: Status pill
    //
    // Sized so the longest `RunStatus.displayName` ("Skipped while paused",
    // 107.7pt at 10pt medium) stays on one line: 107.7 + 20pt icon allowance
    // + 2 × 8pt pill padding = 143.7pt.

    /// Horizontal padding inside `LoopsStatusPill`.
    public static let statusPillHorizontalPadding: CGFloat = 8
    /// SF Symbol width plus `Label` icon-to-title spacing at caption size. The
    /// widest measured status symbol is 14pt; 20pt leaves spacing headroom.
    public static let statusPillIconAllowance: CGFloat = 20

    // MARK: Run table columns

    public static let statusColumnWidth: CGFloat = 148
    public static let loopColumnMinWidth: CGFloat = 130
    /// Fits "999d 23h ago" (68.1pt, monospaced-digit caption).
    public static let startedColumnWidth: CGFloat = 72
    /// Fits "999:59:59" (51.1pt, monospaced-digit caption).
    public static let durationColumnWidth: CGFloat = 56
    /// Three 13pt symbols, two 4pt gaps, and a count.
    public static let artifactsColumnWidth: CGFloat = 70
    public static let columnSpacing: CGFloat = 8
    public static let rowHorizontalPadding: CGFloat = 8
    /// Fixed columns in a run row: status, loop, started, duration, artifacts.
    public static let runColumnCount: Int = 5

    // MARK: Inspector column

    public static let inspectorMinWidth: CGFloat = 260
    public static let inspectorIdealWidth: CGFloat = 360
    public static let inspectorMaxWidth: CGFloat = 420

    // MARK: Filter bar
    //
    // Six subviews (search, loop, status, date, spacer, count) → five gaps.

    public static let filterSubviewCount: Int = 6
    public static let filterSpacing: CGFloat = 10
    public static let filterTrailingGap: CGFloat = 8

    /// Leading label plus the gap before a `Picker`'s popup button.
    public static let pickerLabelGap: CGFloat = 8
    /// Popup button text insets plus the chevron well.
    public static let pickerPopupChrome: CGFloat = 32

    public static let searchFieldMinWidth: CGFloat = 130
    public static let searchFieldMaxWidth: CGFloat = 260
    public static let loopFilterMinWidth: CGFloat = 150
    public static let loopFilterMaxWidth: CGFloat = 210
    /// Wide enough for the "Status" label plus the longest selected status at
    /// body size: 38.8 + 8 + 132.2 + 32 = 211pt.
    public static let statusFilterMinWidth: CGFloat = 216
    public static let statusFilterMaxWidth: CGFloat = 248
    /// Fits "Date" + "Any date": 28.4 + 8 + 53.4 + 32 = 121.8pt.
    public static let dateFilterMinWidth: CGFloat = 126
    public static let dateFilterMaxWidth: CGFloat = 150

    /// Width a status pill's *text* can occupy inside its column.
    public static var statusPillTextBudget: CGFloat {
        statusColumnWidth - statusPillHorizontalPadding * 2 - statusPillIconAllowance
    }

    /// Width the status filter popup can give the selected value.
    public static var statusFilterValueBudget: CGFloat {
        statusFilterMinWidth - pickerLabelGap - pickerPopupChrome
    }

    /// Narrowest a run row can get before its fixed columns overflow.
    public static var runTableMinWidth: CGFloat {
        statusColumnWidth
            + loopColumnMinWidth
            + startedColumnWidth
            + durationColumnWidth
            + artifactsColumnWidth
            + columnSpacing * CGFloat(runColumnCount - 1)
            + rowHorizontalPadding * 2
    }

    public static var runListMinWidth: CGFloat {
        runTableMinWidth + ManagerLayout.cardPadding * 2
    }

    public static var filtersMinWidth: CGFloat {
        searchFieldMinWidth
            + loopFilterMinWidth
            + statusFilterMinWidth
            + dateFilterMinWidth
            + filterSpacing * CGFloat(filterSubviewCount - 1)
            + filterTrailingGap
            + ManagerLayout.cardPadding * 2
    }

    /// Minimum width of the whole History destination, padding included.
    public static var minDetailWidth: CGFloat {
        let widestRow = max(
            filtersMinWidth,
            runListMinWidth + ManagerLayout.columnGap + inspectorMinWidth
        )
        return widestRow + ManagerLayout.screenPadding * 2
    }
}

/// Layout invariants that must hold for the manager window to lay out without
/// clipping any column. Exposed as data so the Swift contract tests can assert
/// them without instantiating SwiftUI views.
public enum ManagerLayoutContract {
    public struct Violation: Equatable, Sendable, CustomStringConvertible {
        public let rule: String
        public let detail: String

        public init(rule: String, detail: String) {
            self.rule = rule
            self.detail = detail
        }

        public var description: String { "\(rule): \(detail)" }
    }

    /// Empty when the manager window can lay out every destination without
    /// overflowing (and therefore clipping) a column.
    public static func violations() -> [Violation] {
        var found: [Violation] = []

        if ManagerLayout.sidebarMinWidth > ManagerLayout.sidebarIdealWidth
            || ManagerLayout.sidebarIdealWidth > ManagerLayout.sidebarMaxWidth {
            found.append(
                Violation(
                    rule: "sidebar-column-width-order",
                    detail: "min \(ManagerLayout.sidebarMinWidth) <= ideal \(ManagerLayout.sidebarIdealWidth) <= max \(ManagerLayout.sidebarMaxWidth) is violated"
                )
            )
        }

        // Headline invariant: the sidebar minimum, the divider, and the widest
        // destination all have to fit inside the declared window budget. Grow
        // any destination past the budget and this fails.
        if ManagerLayout.effectiveWindowMinContentWidth > ManagerLayout.windowMinContentWidth {
            let widest = ManagerLayout.detailRequirements.max { $0.minWidth < $1.minWidth }
            found.append(
                Violation(
                    rule: "sidebar-and-widest-destination-fit-window-budget",
                    detail: "sidebar \(ManagerLayout.sidebarMinWidth) + divider \(ManagerLayout.splitDividerWidth) + widest destination '\(widest?.name ?? "?")' \(ManagerLayout.detailMinWidth) = \(ManagerLayout.effectiveWindowMinContentWidth)pt exceeds the \(ManagerLayout.windowMinContentWidth)pt window budget"
                )
            )
        }

        if ManagerLayout.effectiveWindowMinContentHeight > ManagerLayout.windowMinContentHeight {
            let tallest = ManagerLayout.detailRequirements.max { $0.minHeight < $1.minHeight }
            found.append(
                Violation(
                    rule: "tallest-destination-fits-window-budget",
                    detail: "tallest destination '\(tallest?.name ?? "?")' needs \(ManagerLayout.detailMinHeight)pt but the window budget is \(ManagerLayout.windowMinContentHeight)pt"
                )
            )
        }

        if ManagerLayout.windowDefaultWidth < ManagerLayout.effectiveWindowMinContentWidth
            || ManagerLayout.windowDefaultHeight < ManagerLayout.effectiveWindowMinContentHeight {
            found.append(
                Violation(
                    rule: "default-window-not-below-minimum",
                    detail: "default \(ManagerLayout.windowDefaultWidth)x\(ManagerLayout.windowDefaultHeight) is smaller than the enforced minimum \(ManagerLayout.effectiveWindowMinContentWidth)x\(ManagerLayout.effectiveWindowMinContentHeight)"
                )
            )
        }

        for requirement in ManagerLayout.detailRequirements
        where requirement.minWidth > ManagerLayout.detailMinWidth
            || requirement.minHeight > ManagerLayout.detailMinHeight {
            found.append(
                Violation(
                    rule: "destination-fits-detail-column",
                    detail: "\(requirement.name) needs \(requirement.minWidth)x\(requirement.minHeight)pt but the detail column guarantees \(ManagerLayout.detailMinWidth)x\(ManagerLayout.detailMinHeight)pt"
                )
            )
        }

        return found
    }
}
