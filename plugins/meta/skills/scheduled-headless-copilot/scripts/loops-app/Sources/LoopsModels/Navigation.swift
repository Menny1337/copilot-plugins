import Foundation

/// Top-level sidebar sections. Stable identifiers let feature owners register
/// content without a central switch statement in `App.swift`.
public enum LoopsSection: String, Codable, CaseIterable, Identifiable, Sendable {
    case dashboard
    case schedules
    case library
    case history
    case settings

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .schedules: return "Schedules"
        case .library: return "Library"
        case .history: return "History"
        case .settings: return "Settings"
        }
    }

    /// SF Symbol name for the sidebar row.
    public var systemImage: String {
        switch self {
        case .dashboard: return "square.grid.2x2"
        case .schedules: return "calendar"
        case .library: return "square.grid.3x3"
        case .history: return "clock.arrow.circlepath"
        case .settings: return "gearshape"
        }
    }
}

/// A navigable destination. Used as the element type of a navigation stack so
/// each feature can push detail routes independently.
public enum LoopsRoute: Hashable, Codable, Sendable {
    case section(LoopsSection)
    case loopDetail(loopID: String)
    case runDetail(loopID: String, runID: String)
    case newLoop(kind: LoopKind)
    case editLoop(loopID: String)

    public var loopID: String? {
        switch self {
        case .loopDetail(let id), .runDetail(let id, _), .editLoop(let id):
            return id
        case .section, .newLoop:
            return nil
        }
    }
}

/// Observable-free navigation model that feature owners can mutate. Keeping it a
/// plain value type (rather than an `ObservableObject` in `App.swift`) means UI
/// modules can adopt it without editing a central shell.
public struct LoopsNavigationState: Equatable, Sendable {
    public var selectedSection: LoopsSection
    public var path: [LoopsRoute]

    public init(selectedSection: LoopsSection = .dashboard, path: [LoopsRoute] = []) {
        self.selectedSection = selectedSection
        self.path = path
    }

    public mutating func select(_ section: LoopsSection) {
        selectedSection = section
        path.removeAll(keepingCapacity: true)
    }

    public mutating func push(_ route: LoopsRoute) {
        path.append(route)
    }

    @discardableResult
    public mutating func pop() -> LoopsRoute? {
        path.popLast()
    }

    public mutating func popToRoot() {
        path.removeAll(keepingCapacity: true)
    }

    public var current: LoopsRoute {
        path.last ?? .section(selectedSection)
    }
}
