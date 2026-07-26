import Foundation

/// The schedule estimate the menu bar uses for "next run". Mirrors the launchd
/// plist (which owns the real trigger). `weekdays` uses JS `getDay()` numbering
/// (0=Sun … 6=Sat); empty = every day.
struct ScheduleConfig: Codable, Equatable {
    var hour: Int
    var minute: Int
    var weekdays: [Int]

    init(hour: Int = 3, minute: Int = 0, weekdays: [Int] = []) {
        self.hour = hour
        self.minute = minute
        self.weekdays = weekdays
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        hour = try c.decodeIfPresent(Int.self, forKey: .hour) ?? 3
        minute = try c.decodeIfPresent(Int.self, forKey: .minute) ?? 0
        weekdays = try c.decodeIfPresent([Int].self, forKey: .weekdays) ?? []
    }
}

/// The user-tunable subset of the daemon's `config.json`, edited by the native
/// settings window. Decoded from `daemon-ctl.sh config-get` (defaults merged)
/// and re-encoded as a patch for `daemon-ctl.sh config-set`, which merges it
/// back and preserves any keys this UI does not manage.
struct Config: Codable, Equatable {
    var enabled: Bool
    var schedule: ScheduleConfig
    var concurrency: Int
    var autoDeploy: Bool
    var autoRevert: Bool
    var deployMode: String
    var revertDeployMode: String
    var include: [String]
    var exclude: [String]
    var skillPaths: [String]
    var skillFolders: [String]
    var autoMergeUnits: [String]
    var prUnits: [String]
    var signalThreshold: Int
    var observationWindowDays: Int
    var firstRunLookbackDays: Int
    var maxFirstRunSessions: Int
    var repoDir: String
    var marketplaceName: String
    var ghAccount: String
    var notify: String

    init(
        enabled: Bool = true,
        schedule: ScheduleConfig = ScheduleConfig(),
        concurrency: Int = 2,
        autoDeploy: Bool = true,
        autoRevert: Bool = true,
        deployMode: String = "auto",
        revertDeployMode: String = "auto",
        include: [String] = [],
        exclude: [String] = [],
        skillPaths: [String] = [],
        skillFolders: [String] = [],
        autoMergeUnits: [String] = [],
        prUnits: [String] = [],
        signalThreshold: Int = 3,
        observationWindowDays: Int = 3,
        firstRunLookbackDays: Int = 7,
        maxFirstRunSessions: Int = 200,
        repoDir: String = "",
        marketplaceName: String = "",
        ghAccount: String = "",
        notify: String = "auto"
    ) {
        self.enabled = enabled
        self.schedule = schedule
        self.concurrency = concurrency
        self.autoDeploy = autoDeploy
        self.autoRevert = autoRevert
        self.deployMode = deployMode
        self.revertDeployMode = revertDeployMode
        self.include = include
        self.exclude = exclude
        self.skillPaths = skillPaths
        self.skillFolders = skillFolders
        self.autoMergeUnits = autoMergeUnits
        self.prUnits = prUnits
        self.signalThreshold = signalThreshold
        self.observationWindowDays = observationWindowDays
        self.firstRunLookbackDays = firstRunLookbackDays
        self.maxFirstRunSessions = maxFirstRunSessions
        self.repoDir = repoDir
        self.marketplaceName = marketplaceName
        self.ghAccount = ghAccount
        self.notify = notify
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = Config()
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? d.enabled
        schedule = try c.decodeIfPresent(ScheduleConfig.self, forKey: .schedule) ?? d.schedule
        concurrency = try c.decodeIfPresent(Int.self, forKey: .concurrency) ?? d.concurrency
        autoDeploy = try c.decodeIfPresent(Bool.self, forKey: .autoDeploy) ?? d.autoDeploy
        autoRevert = try c.decodeIfPresent(Bool.self, forKey: .autoRevert) ?? d.autoRevert
        deployMode = try c.decodeIfPresent(String.self, forKey: .deployMode) ?? d.deployMode
        revertDeployMode = try c.decodeIfPresent(String.self, forKey: .revertDeployMode) ?? d.revertDeployMode
        include = try c.decodeIfPresent([String].self, forKey: .include) ?? d.include
        exclude = try c.decodeIfPresent([String].self, forKey: .exclude) ?? d.exclude
        skillPaths = try c.decodeIfPresent([String].self, forKey: .skillPaths) ?? d.skillPaths
        skillFolders = try c.decodeIfPresent([String].self, forKey: .skillFolders) ?? d.skillFolders
        autoMergeUnits = try c.decodeIfPresent([String].self, forKey: .autoMergeUnits) ?? d.autoMergeUnits
        prUnits = try c.decodeIfPresent([String].self, forKey: .prUnits) ?? d.prUnits
        signalThreshold = try c.decodeIfPresent(Int.self, forKey: .signalThreshold) ?? d.signalThreshold
        observationWindowDays = try c.decodeIfPresent(Int.self, forKey: .observationWindowDays) ?? d.observationWindowDays
        firstRunLookbackDays = try c.decodeIfPresent(Int.self, forKey: .firstRunLookbackDays) ?? d.firstRunLookbackDays
        maxFirstRunSessions = try c.decodeIfPresent(Int.self, forKey: .maxFirstRunSessions) ?? d.maxFirstRunSessions
        repoDir = try c.decodeIfPresent(String.self, forKey: .repoDir) ?? d.repoDir
        marketplaceName = try c.decodeIfPresent(String.self, forKey: .marketplaceName) ?? d.marketplaceName
        ghAccount = try c.decodeIfPresent(String.self, forKey: .ghAccount) ?? d.ghAccount
        notify = try c.decodeIfPresent(String.self, forKey: .notify) ?? d.notify
    }
}
