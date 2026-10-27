import Foundation

enum DaemonState: String, CaseIterable, Identifiable {
    case running
    case idle
    case paused
    case prs
    case failed
    case reviewing

    var id: String { rawValue }

    var fallbackEmoji: String {
        switch self {
        case .failed: return "⚠️"
        case .paused: return "⏸️"
        case .reviewing: return "✨"
        case .prs: return "🔬"
        case .running: return "🔄"
        case .idle: return "🧪"
        }
    }
}

struct Status: Codable, Equatable {
    struct LastRun: Codable, Equatable {
        var runId: String
        var status: String
        var applied: Int
        var reverted: Int
        var prs: Int
        var failed: Int

        init(runId: String = "", status: String = "", applied: Int = 0, reverted: Int = 0, prs: Int = 0, failed: Int = 0) {
            self.runId = runId
            self.status = status
            self.applied = applied
            self.reverted = reverted
            self.prs = prs
            self.failed = failed
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            runId = try container.decodeIfPresent(String.self, forKey: .runId) ?? ""
            status = try container.decodeIfPresent(String.self, forKey: .status) ?? ""
            applied = try container.decodeIfPresent(Int.self, forKey: .applied) ?? 0
            reverted = try container.decodeIfPresent(Int.self, forKey: .reverted) ?? 0
            prs = try container.decodeIfPresent(Int.self, forKey: .prs) ?? 0
            failed = try container.decodeIfPresent(Int.self, forKey: .failed) ?? 0
        }
    }

    var enabled: Bool
    var running: Bool
    var nextRun: String?
    var deployMode: String
    var autoMergeUnits: [String]
    var prUnits: [String]
    var include: [String]
    var exclude: [String]
    var lastRun: LastRun?
    var openCycles: Int
    var openPRs: Int
    var prUrls: [String]
    var dueReReviews: Int

    init(
        enabled: Bool = true,
        running: Bool = false,
        nextRun: String? = nil,
        deployMode: String = "",
        autoMergeUnits: [String] = [],
        prUnits: [String] = [],
        include: [String] = [],
        exclude: [String] = [],
        lastRun: LastRun? = nil,
        openCycles: Int = 0,
        openPRs: Int = 0,
        prUrls: [String] = [],
        dueReReviews: Int = 0
    ) {
        self.enabled = enabled
        self.running = running
        self.nextRun = nextRun
        self.deployMode = deployMode
        self.autoMergeUnits = autoMergeUnits
        self.prUnits = prUnits
        self.include = include
        self.exclude = exclude
        self.lastRun = lastRun
        self.openCycles = openCycles
        self.openPRs = openPRs
        self.prUrls = prUrls
        self.dueReReviews = dueReReviews
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        running = try container.decodeIfPresent(Bool.self, forKey: .running) ?? false
        nextRun = try container.decodeIfPresent(String.self, forKey: .nextRun)
        deployMode = try container.decodeIfPresent(String.self, forKey: .deployMode) ?? ""
        autoMergeUnits = try container.decodeIfPresent([String].self, forKey: .autoMergeUnits) ?? []
        prUnits = try container.decodeIfPresent([String].self, forKey: .prUnits) ?? []
        include = try container.decodeIfPresent([String].self, forKey: .include) ?? []
        exclude = try container.decodeIfPresent([String].self, forKey: .exclude) ?? []
        lastRun = try container.decodeIfPresent(LastRun.self, forKey: .lastRun)
        openCycles = try container.decodeIfPresent(Int.self, forKey: .openCycles) ?? 0
        openPRs = try container.decodeIfPresent(Int.self, forKey: .openPRs) ?? 0
        prUrls = try container.decodeIfPresent([String].self, forKey: .prUrls) ?? []
        dueReReviews = try container.decodeIfPresent(Int.self, forKey: .dueReReviews) ?? 0
    }

    var daemonState: DaemonState {
        if let failed = lastRun?.failed, failed != 0 { return .failed }
        if enabled == false { return .paused }
        if running == true { return .reviewing }
        if openPRs != 0 { return .prs }
        if dueReReviews != 0 { return .running }
        return .idle
    }

    func formattedNextRun(now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String? {
        guard let nextRun, let date = Self.parseISODate(nextRun) else { return nil }

        let timeFormatter = DateFormatter()
        timeFormatter.locale = locale
        timeFormatter.calendar = calendar
        timeFormatter.dateFormat = "HH:mm"
        let hhmm = timeFormatter.string(from: date)

        let day: String
        if calendar.isDate(date, inSameDayAs: now) {
            day = "Today"
        } else if let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)), calendar.isDate(date, inSameDayAs: tomorrow) {
            day = "Tomorrow"
        } else {
            let dayFormatter = DateFormatter()
            dayFormatter.locale = locale
            dayFormatter.calendar = calendar
            dayFormatter.setLocalizedDateFormatFromTemplate("EEE")
            day = dayFormatter.string(from: date)
        }

        let rawMinutes = (date.timeIntervalSince(now) / 60).rounded()
        let minutes = max(0, Int(rawMinutes))
        let relative = minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes)m"
        return "\(day) \(hhmm) (in \(relative))"
    }

    static func parseISODate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: value) { return date }
        return nil
    }
}
