import Foundation

struct ReviewUnitCatalog: Decodable {
    let units: [ReviewUnit]
}

struct ReviewUnit: Decodable, Equatable, Identifiable {
    private enum CodingKeys: String, CodingKey {
        case name, type, path, source, sourceKind, sourceRoot, plugin, exists, conflict
    }

    let name: String
    let type: String
    let path: String
    let source: String
    let sourceKind: String
    let sourceRoot: String
    let plugin: String
    let exists: Bool
    let conflict: Bool

    init(
        name: String,
        type: String = "skill",
        path: String,
        source: String = "marketplace",
        sourceKind: String = "",
        sourceRoot: String = "",
        plugin: String = "",
        exists: Bool = true,
        conflict: Bool = false
    ) {
        self.name = name
        self.type = type
        self.path = path
        self.source = source
        self.sourceKind = source == "external" && sourceKind.isEmpty ? "file" : sourceKind
        self.sourceRoot = sourceRoot.isEmpty ? path : sourceRoot
        self.plugin = plugin
        self.exists = exists
        self.conflict = conflict
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        type = try container.decodeIfPresent(String.self, forKey: .type) ?? "unknown"
        path = try container.decodeIfPresent(String.self, forKey: .path) ?? ""
        source = try container.decodeIfPresent(String.self, forKey: .source) ?? "configured"
        sourceKind = try container.decodeIfPresent(String.self, forKey: .sourceKind) ?? ""
        sourceRoot = try container.decodeIfPresent(String.self, forKey: .sourceRoot) ?? path
        plugin = try container.decodeIfPresent(String.self, forKey: .plugin) ?? ""
        exists = try container.decodeIfPresent(Bool.self, forKey: .exists) ?? false
        conflict = try container.decodeIfPresent(Bool.self, forKey: .conflict) ?? false
    }

    var id: String {
        "\(type)|\(source)|\(path.isEmpty ? name : path)"
    }

    var isExternal: Bool { source == "external" }
    var isFolderSource: Bool { isExternal && sourceKind == "folder" }
    var isSkill: Bool { type == "skill" }
    var canRun: Bool { exists && !conflict && (type == "skill" || type == "agent") }

    var typeLabel: String {
        switch type {
        case "skill": "Skill"
        case "agent": "Agent"
        default: "Configured unit"
        }
    }

    var displayPath: String {
        guard !path.isEmpty else { return "Source file is missing" }
        return Self.abbreviateHome(in: path)
    }

    static func abbreviateHome(in path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path == home { return "~" }
        if path.hasPrefix(home + "/") {
            return "~" + String(path.dropFirst(home.count))
        }
        return path
    }

    static func skillName(at url: URL) throws -> String {
        guard url.lastPathComponent == "SKILL.md" else {
            throw ReviewUnitError.notSkillFile
        }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey])
        guard values.isRegularFile == true else {
            throw ReviewUnitError.notSkillFile
        }

        let content = try String(contentsOf: url, encoding: .utf8)
        let lines = content.components(separatedBy: .newlines)
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---" else {
            throw ReviewUnitError.missingName
        }

        for line in lines.dropFirst() {
            if line.trimmingCharacters(in: .whitespaces) == "---" { break }
            guard line.hasPrefix("name:") else { continue }
            var value = String(line.dropFirst("name:".count))
                .trimmingCharacters(in: .whitespaces)
            if value.count >= 2,
               (value.hasPrefix("\"") && value.hasSuffix("\"")) ||
               (value.hasPrefix("'") && value.hasSuffix("'")) {
                value.removeFirst()
                value.removeLast()
            }
            guard !value.isEmpty else { throw ReviewUnitError.missingName }
            guard value.count <= 64,
                  value.range(of: #"^[a-z0-9]+(?:-[a-z0-9]+)*$"#, options: .regularExpression) != nil else {
                throw ReviewUnitError.invalidName(value)
            }
            return value
        }
        throw ReviewUnitError.missingName
    }

    static func skillFiles(in selectedURL: URL) throws -> [(name: String, url: URL)] {
        let folder = selectedURL.standardizedFileURL.resolvingSymlinksInPath()
        let values = try folder.resourceValues(forKeys: [.isDirectoryKey])
        guard values.isDirectory == true else { throw ReviewUnitError.notSkillFolder }

        var candidates: [URL] = []
        let direct = folder.appendingPathComponent("SKILL.md")
        if FileManager.default.fileExists(atPath: direct.path) {
            candidates.append(direct)
        }

        let children = try FileManager.default.contentsOfDirectory(
            at: folder,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )
        for child in children {
            let resolvedChild = child.resolvingSymlinksInPath()
            let childValues = try? resolvedChild.resourceValues(forKeys: [.isDirectoryKey])
            guard childValues?.isDirectory == true else { continue }
            let skill = resolvedChild.appendingPathComponent("SKILL.md")
            if FileManager.default.fileExists(atPath: skill.path) {
                candidates.append(skill)
            }
        }

        let skills: [(name: String, url: URL)] = try candidates
            .map {
                let resolved = $0.standardizedFileURL.resolvingSymlinksInPath()
                return (name: try skillName(at: resolved), url: resolved)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        guard !skills.isEmpty else { throw ReviewUnitError.emptySkillFolder }
        return skills
    }
}

enum ReviewUnitError: LocalizedError {
    case notSkillFile
    case missingName
    case invalidName(String)
    case notSkillFolder
    case emptySkillFolder
    case alreadyAdded(String)
    case folderAlreadyAdded(String)
    case duplicateName(String)
    case cannotOpen(String)

    var errorDescription: String? {
        switch self {
        case .notSkillFile:
            "Choose a file named SKILL.md."
        case .missingName:
            "The selected SKILL.md needs a scalar name in its frontmatter."
        case .invalidName(let name):
            "\(name) is not a valid kebab-case skill name."
        case .notSkillFolder:
            "Choose a folder containing SKILL.md files."
        case .emptySkillFolder:
            "No valid SKILL.md files were found in this folder or its immediate child folders."
        case .alreadyAdded(let path):
            "This skill is already added: \(path)"
        case .folderAlreadyAdded(let path):
            "This skills folder is already added: \(path)"
        case .duplicateName(let name):
            "A reviewed unit named \(name) already exists. Skill and agent names must be unique."
        case .cannotOpen(let path):
            "macOS could not open \(path)."
        }
    }
}

enum UnitPolicy: String, CaseIterable, Identifiable {
    case defaultPolicy
    case autoMerge
    case reviewPR

    var id: String { rawValue }
}

enum UnitEligibility: String, CaseIterable, Identifiable {
    case defaultScope
    case included
    case excluded

    var id: String { rawValue }
}
