import Foundation

/// Data-only, untrusted artifact candidate detected from bounded run text.
///
/// Integrators must validate `changedFile` values against the loop working
/// directory before opening them; callbacks must not trust these values as paths.
struct CopilotLoopArtifact: Identifiable, Hashable {
    enum Kind: String, CaseIterable, Identifiable {
        case githubPullRequest
        case commitSHA
        case changedFile
        case copilotSessionID

        var id: String { rawValue }

        var title: String {
            switch self {
            case .githubPullRequest: return "Pull request"
            case .commitSHA: return "Commit"
            case .changedFile: return "File"
            case .copilotSessionID: return "Session"
            }
        }

        var systemImage: String {
            switch self {
            case .githubPullRequest: return "arrow.triangle.pull"
            case .commitSHA: return "point.topleft.down.curvedto.point.bottomright.up"
            case .changedFile: return "doc.text"
            case .copilotSessionID: return "bubble.left.and.bubble.right"
            }
        }
    }

    let kind: Kind
    let value: String
    let source: String?

    var id: String { "\(kind.rawValue):\(value)" }

    var displayValue: String {
        switch kind {
        case .commitSHA:
            return String(value.prefix(12))
        case .githubPullRequest:
            return value.replacingOccurrences(of: "https://github.com/", with: "")
        case .changedFile, .copilotSessionID:
            return value
        }
    }
}

struct ArtifactDetectionLimits: Equatable {
    var maxBytes: Int
    var maxLines: Int
    var maxArtifacts: Int

    init(maxBytes: Int = 256 * 1024, maxLines: Int = 2_000, maxArtifacts: Int = 80) {
        self.maxBytes = max(1, maxBytes)
        self.maxLines = max(1, maxLines)
        self.maxArtifacts = max(1, maxArtifacts)
    }
}

enum CopilotLoopArtifactDetector {
    static func detect(
        in text: String,
        limits: ArtifactDetectionLimits = ArtifactDetectionLimits()
    ) -> [CopilotLoopArtifact] {
        let bounded = boundedPrefix(of: text, maxBytes: limits.maxBytes, maxLines: limits.maxLines)
        guard !bounded.isEmpty else { return [] }

        var found: [CopilotLoopArtifact] = []
        var seen = Set<String>()

        func append(_ kind: CopilotLoopArtifact.Kind, _ rawValue: String, source: String? = nil) {
            guard found.count < limits.maxArtifacts else { return }
            let value = normalize(rawValue)
            guard !value.isEmpty else { return }
            let artifact = CopilotLoopArtifact(kind: kind, value: value, source: source)
            guard seen.insert(artifact.id).inserted else { return }
            found.append(artifact)
        }

        matches(
            pattern: #"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+(?:[?#][^\s\"'<>)]*)?"#,
            in: bounded
        ) { match in
            append(.githubPullRequest, match)
        }

        matches(
            pattern: #"(?<![0-9A-Fa-f])[0-9A-Fa-f]{40}(?![0-9A-Fa-f])"#,
            in: bounded
        ) { match in
            append(.commitSHA, match.lowercased())
        }

        let filePatterns = [
            #"^\s*(?:[MADRCUT?]{1,2}|R[0-9]{3})\s+([^\n\r]+)$"#,
            #"^\s*(?:modified|added|deleted|renamed|created|changed):\s+([^\n\r]+)$"#,
            #"^\s*(?:\+\+\+ b/|--- a/)([^\n\r]+)$"#,
            #"^diff --git a/([^\s]+) b/[^\n\r]+$"#,
            #"\"(?:changedFile|changedFiles|filePath|changed_path)\"\s*:\s*\"([^\"\n\r]+)\""#,
        ]
        for pattern in filePatterns {
            captureMatches(pattern: pattern, in: bounded, options: [.anchorsMatchLines, .caseInsensitive]) { value in
                if let file = normalizeFileReference(value) {
                    append(.changedFile, file)
                }
            }
        }

        captureMatches(
            pattern: #"(?:copilot[-_ ]?session(?:[-_ ]?id)?|session(?:Id|_id)?|session:)['\"\s:=]+([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}|[A-Za-z0-9][A-Za-z0-9._-]{7,})"#,
            in: bounded,
            options: [.caseInsensitive]
        ) { value in
            append(.copilotSessionID, value)
        }

        return found
    }

    private static func boundedPrefix(of text: String, maxBytes: Int, maxLines: Int) -> String {
        var output = ""
        output.reserveCapacity(min(text.count, maxBytes))
        var bytes = 0
        var lines = 0
        var index = text.startIndex
        while index < text.endIndex, bytes < maxBytes, lines < maxLines {
            let character = text[index]
            let characterBytes = String(character).utf8.count
            if bytes + characterBytes > maxBytes { break }
            output.append(character)
            bytes += characterBytes
            if character == "\n" { lines += 1 }
            index = text.index(after: index)
        }
        return output
    }

    private static func matches(
        pattern: String,
        in text: String,
        options: NSRegularExpression.Options = [],
        handler: (String) -> Void
    ) {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        regex.enumerateMatches(in: text, options: [], range: range) { result, _, stop in
            guard let result, let matchRange = Range(result.range, in: text) else { return }
            handler(String(text[matchRange]))
            if result.range.location == NSNotFound { stop.pointee = true }
        }
    }

    private static func captureMatches(
        pattern: String,
        in text: String,
        options: NSRegularExpression.Options = [],
        handler: (String) -> Void
    ) {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        regex.enumerateMatches(in: text, options: [], range: range) { result, _, _ in
            guard
                let result,
                result.numberOfRanges > 1,
                let captureRange = Range(result.range(at: 1), in: text)
            else { return }
            handler(String(text[captureRange]))
        }
    }

    private static func normalize(_ raw: String) -> String {
        raw.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\"'`,.;)]}")))
    }

    private static func normalizeFileReference(_ raw: String) -> String? {
        var value = normalize(raw)
        if value.hasPrefix("a/") || value.hasPrefix("b/") {
            value.removeFirst(2)
        }
        if value == "/dev/null" || value.isEmpty { return nil }
        if value.localizedCaseInsensitiveContains("://") { return nil }
        if value.contains(" ") && !value.contains("/") { return nil }
        if !value.contains("/") && !value.contains(".") { return nil }
        return value
    }
}
