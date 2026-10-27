import Combine
import Foundation
import LoopsModels

enum LiveRunStream: String, CaseIterable, Identifiable {
    case stdout
    case stderr
    case copilotJSONL

    var id: String { rawValue }

    var title: String {
        switch self {
        case .stdout: return "stdout"
        case .stderr: return "stderr"
        case .copilotJSONL: return "Copilot JSONL"
        }
    }

    var systemImage: String {
        switch self {
        case .stdout: return "terminal"
        case .stderr: return "exclamationmark.triangle"
        case .copilotJSONL: return "curlybraces"
        }
    }

    static func defaultSelection(for loop: LoopDefinition) -> LiveRunStream {
        switch loop.kind {
        case .copilot: return .copilotJSONL
        case .script: return .stdout
        }
    }
}

struct LiveRunLogLimits: Equatable {
    var maxBytesPerStream: Int
    var maxLinesPerStream: Int
    var maxEventBytes: Int
    var maxEventLines: Int

    init(
        maxBytesPerStream: Int = 512 * 1024,
        maxLinesPerStream: Int = 4_000,
        maxEventBytes: Int = 256 * 1024,
        maxEventLines: Int = 2_000
    ) {
        self.maxBytesPerStream = max(1, maxBytesPerStream)
        self.maxLinesPerStream = max(1, maxLinesPerStream)
        self.maxEventBytes = max(1, maxEventBytes)
        self.maxEventLines = max(1, maxEventLines)
    }
}

struct BoundedLiveRunLog: Equatable {
    private(set) var text: String
    private(set) var droppedBytes: Int
    private(set) var droppedLines: Int
    let maxBytes: Int
    let maxLines: Int

    init(text: String = "", maxBytes: Int, maxLines: Int) {
        self.text = ""
        self.droppedBytes = 0
        self.droppedLines = 0
        self.maxBytes = max(1, maxBytes)
        self.maxLines = max(1, maxLines)
        append(text)
    }

    var isTruncated: Bool { droppedBytes > 0 || droppedLines > 0 }

    mutating func append(_ chunk: String) {
        guard !chunk.isEmpty else { return }
        text.append(chunk)
        enforceByteLimit()
        enforceLineLimit()
    }

    mutating func replace(with value: String) {
        text = ""
        droppedBytes = 0
        droppedLines = 0
        append(value)
    }

    private mutating func enforceByteLimit() {
        var overflow = text.utf8.count - maxBytes
        guard overflow > 0 else { return }
        var index = text.startIndex
        var removed = 0
        var removedLineBreaks = 0
        while index < text.endIndex, overflow > 0 {
            let next = text.index(after: index)
            let count = String(text[index..<next]).utf8.count
            removed += count
            if text[index] == "\n" { removedLineBreaks += 1 }
            overflow -= count
            index = next
        }
        text.removeSubrange(text.startIndex..<index)
        droppedBytes += removed
        droppedLines += removedLineBreaks
    }

    private mutating func enforceLineLimit() {
        let lineBreaks = text.reduce(0) { $0 + ($1 == "\n" ? 1 : 0) }
        let lineCount = lineBreaks + (text.isEmpty || text.hasSuffix("\n") ? 0 : 1)
        let overflow = lineCount - maxLines
        guard overflow > 0 else { return }

        var removedLines = 0
        var index = text.startIndex
        while index < text.endIndex, removedLines < overflow {
            let next = text.index(after: index)
            if text[index] == "\n" { removedLines += 1 }
            index = next
        }
        text.removeSubrange(text.startIndex..<index)
        droppedLines += removedLines
    }
}

enum LiveRunPhase: String, CaseIterable, Identifiable {
    case preflight
    case starting
    case running
    case retrying
    case stopping
    case finalizing
    case terminal

    var id: String { rawValue }

    var title: String {
        switch self {
        case .preflight: return "Preflight"
        case .starting: return "Starting"
        case .running: return "Running"
        case .retrying: return "Retrying"
        case .stopping: return "Stopping"
        case .finalizing: return "Finalizing"
        case .terminal: return "Terminal"
        }
    }

    var order: Int { Self.allCases.firstIndex(of: self) ?? 0 }
    var isOptional: Bool { self == .retrying || self == .stopping || self == .finalizing }
}

enum LiveRunPhaseState: Equatable {
    case waiting
    case active
    case complete
    case skipped
    case issue
}

struct LiveRunPhaseSnapshot: Identifiable, Equatable {
    var phase: LiveRunPhase
    var state: LiveRunPhaseState
    var timestamp: String?
    var detail: String?

    var id: LiveRunPhase { phase }
}

enum LiveRunIssueSeverity: String, Equatable {
    case warning
    case error
}

struct LiveRunIssue: Identifiable, Equatable {
    var id: String
    var severity: LiveRunIssueSeverity
    var message: String

    init(id: String? = nil, severity: LiveRunIssueSeverity, message: String) {
        self.severity = severity
        self.message = message
        self.id = id ?? "\(severity.rawValue):\(message)"
    }
}

struct LiveRunParsedEvent: Identifiable, Equatable {
    var lineNumber: Int
    var phase: LiveRunPhase
    var timestamp: String?
    var message: String

    var id: String { "\(lineNumber):\(phase.rawValue):\(message)" }
}

struct LiveRunTimelineResult: Equatable {
    var phases: [LiveRunPhaseSnapshot]
    var issues: [LiveRunIssue]
    var parsedEvents: [LiveRunParsedEvent]
}

enum LiveRunEventParser {
    static func timeline(
        for run: RunRecord,
        stage: String? = nil,
        eventsJSONL: String,
        limits: LiveRunLogLimits = LiveRunLogLimits()
    ) -> LiveRunTimelineResult {
        let parse = parse(eventsJSONL, maxBytes: limits.maxEventBytes, maxLines: limits.maxEventLines)
        let terminal = run.status.isTerminalOutcome
        let current = currentPhase(for: run.status, stage: stage, events: parse.events)
        let observedByPhase = Dictionary(parse.events.map { ($0.phase, $0) }, uniquingKeysWith: { _, latest in latest })

        let phases = LiveRunPhase.allCases.map { phase in
            let event = observedByPhase[phase]
            let state: LiveRunPhaseState
            if terminal {
                if phase == .terminal {
                    state = run.status == .succeeded || run.status.isSkippedOutcome || run.status == .cancelled ? .complete : .issue
                } else if event != nil {
                    state = .complete
                } else {
                    state = .skipped
                }
            } else if phase == current {
                state = .active
            } else if event != nil || phase.order < current.order {
                state = .complete
            } else {
                state = .waiting
            }

            return LiveRunPhaseSnapshot(
                phase: phase,
                state: state,
                timestamp: event?.timestamp,
                detail: event?.message
            )
        }

        return LiveRunTimelineResult(phases: phases, issues: parse.issues, parsedEvents: parse.events)
    }

    private static func parse(
        _ text: String,
        maxBytes: Int,
        maxLines: Int
    ) -> (events: [LiveRunParsedEvent], issues: [LiveRunIssue]) {
        let bounded = boundedEventSuffix(text, maxBytes: maxBytes, maxLines: maxLines)
        var issues = bounded.truncated ? [LiveRunIssue(id: "events-truncated", severity: .warning, message: "Older event lines were dropped from the in-memory timeline buffer.")] : []
        guard !bounded.text.isEmpty else { return ([], issues) }

        var lines = bounded.text.components(separatedBy: "\n")
        let endedWithNewline = bounded.text.hasSuffix("\n")
        if endedWithNewline, lines.last == "" { lines.removeLast() }

        var events: [LiveRunParsedEvent] = []
        for (offset, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            let lineNumber = bounded.firstLineNumber + offset
            let isFinalTornCandidate = offset == lines.count - 1 && !endedWithNewline
            do {
                guard let data = trimmed.data(using: .utf8) else { throw ParserError.invalidUTF8 }
                guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw ParserError.notObject
                }
                if let event = parsedEvent(from: object, lineNumber: lineNumber) {
                    events.append(event)
                }
            } catch {
                if isFinalTornCandidate {
                    issues.append(LiveRunIssue(id: "line-\(lineNumber)-partial", severity: .warning, message: "Ignoring a final partial events.jsonl line that is still being written."))
                } else {
                    issues.append(LiveRunIssue(id: "line-\(lineNumber)-malformed", severity: .error, message: "Malformed events.jsonl line \(lineNumber) was ignored."))
                }
            }
        }
        return (events, issues)
    }

    private enum ParserError: Error {
        case invalidUTF8
        case notObject
    }

    private static func parsedEvent(from object: [String: Any], lineNumber: Int) -> LiveRunParsedEvent? {
        let phaseText = strings(for: ["phase", "stage", "type", "event", "status", "message"], in: object)
            .joined(separator: " ")
            .lowercased()
        guard let phase = phase(from: phaseText, object: object) else { return nil }
        let message = firstString(for: ["message", "detail", "summary", "event", "type", "stage", "phase"], in: object) ?? phase.title
        let timestamp = firstString(for: ["ts", "timestamp", "time", "at", "startedAt", "endedAt"], in: object)
        return LiveRunParsedEvent(lineNumber: lineNumber, phase: phase, timestamp: timestamp, message: message)
    }

    private static func phase(from text: String, object: [String: Any]) -> LiveRunPhase? {
        if text.contains("preflight") || text.contains("permission") || text.contains("approve") { return .preflight }
        if text.contains("retry") || intValue(for: ["attempt", "attemptNumber"], in: object).map({ $0 > 1 }) == true { return .retrying }
        if text.contains("stopping") || text.contains("stop requested") || text.contains("cancel") { return .stopping }
        if text.contains("final") || text.contains("cleanup") || text.contains("artifact") || text.contains("persist") { return .finalizing }
        if text.contains("succeeded") || text.contains("failed") || text.contains("timedout") || text.contains("timed out") || text.contains("launchfailed") || text.contains("complete") || text.contains("terminal") { return .terminal }
        if text.contains("running") || text.contains("stdout") || text.contains("stderr") || text.contains("jsonl") { return .running }
        if text.contains("starting") || text.contains("started") || text.contains("launch") || text.contains("spawn") || text.contains("init") { return .starting }
        return nil
    }

    private static func currentPhase(for status: RunStatus, stage: String?, events: [LiveRunParsedEvent]) -> LiveRunPhase {
        if let stage, let phase = phase(from: stage.lowercased(), object: [:]) { return phase }
        if let last = events.last, last.phase != .terminal { return last.phase }
        switch status {
        case .starting: return .starting
        case .running: return .running
        case .stopping: return .stopping
        case .succeeded, .failed, .timedOut, .cancelled, .skippedOverlap, .skippedMissed, .skippedPaused, .approvalBlocked, .launchFailed:
            return .terminal
        }
    }

    private static func boundedEventSuffix(_ text: String, maxBytes: Int, maxLines: Int) -> (text: String, truncated: Bool, firstLineNumber: Int) {
        var output = ""
        var bytes = 0
        var lines = 0
        var index = text.endIndex
        while index > text.startIndex, bytes < maxBytes, lines < maxLines {
            let previous = text.index(before: index)
            let character = text[previous]
            let characterBytes = String(character).utf8.count
            if bytes + characterBytes > maxBytes { break }
            output.insert(character, at: output.startIndex)
            bytes += characterBytes
            if character == "\n" { lines += 1 }
            index = previous
        }
        let truncated = index > text.startIndex
        if truncated, let newline = output.firstIndex(of: "\n") {
            output = String(output[output.index(after: newline)...])
        }
        let totalLineBreaks = text.reduce(0) { $0 + ($1 == "\n" ? 1 : 0) }
        let keptLineBreaks = output.reduce(0) { $0 + ($1 == "\n" ? 1 : 0) }
        let firstLineNumber = max(1, totalLineBreaks - keptLineBreaks + (text.hasSuffix("\n") ? 1 : 0))
        return (output, truncated, firstLineNumber)
    }

    private static func firstString(for keys: [String], in object: Any, depth: Int = 0) -> String? {
        strings(for: keys, in: object, depth: depth).first
    }

    private static func strings(for keys: [String], in object: Any, depth: Int = 0) -> [String] {
        guard depth < 4 else { return [] }
        let normalizedKeys = Set(keys.map(normalizeKey))
        if let dict = object as? [String: Any] {
            var values: [String] = []
            for (key, value) in dict {
                if normalizedKeys.contains(normalizeKey(key)), let string = stringify(value) {
                    values.append(string)
                }
                if value is [String: Any] || value is [Any] {
                    values.append(contentsOf: strings(for: keys, in: value, depth: depth + 1))
                }
            }
            return values
        }
        if let array = object as? [Any] {
            return array.flatMap { strings(for: keys, in: $0, depth: depth + 1) }
        }
        return []
    }

    private static func intValue(for keys: [String], in object: Any, depth: Int = 0) -> Int? {
        guard depth < 4 else { return nil }
        let normalizedKeys = Set(keys.map(normalizeKey))
        if let dict = object as? [String: Any] {
            for (key, value) in dict {
                if normalizedKeys.contains(normalizeKey(key)) {
                    if let int = value as? Int { return int }
                    if let number = value as? NSNumber { return number.intValue }
                    if let string = value as? String, let int = Int(string) { return int }
                }
                if let nested = intValue(for: keys, in: value, depth: depth + 1) { return nested }
            }
        } else if let array = object as? [Any] {
            for value in array {
                if let nested = intValue(for: keys, in: value, depth: depth + 1) { return nested }
            }
        }
        return nil
    }

    private static func stringify(_ value: Any) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    private static func normalizeKey(_ key: String) -> String {
        key.lowercased().filter { $0.isLetter || $0.isNumber }
    }
}

struct LiveRunCallbacks {
    var stop: (CopilotLoopRunKey, RunRecord) -> Void = { _, _ in }
    var copy: (CopilotLoopRunKey, String) -> Void = { _, _ in }
    var openArtifact: (CopilotLoopRunKey, CopilotLoopArtifact) -> Void = { _, _ in }
    var openLog: (LiveRunStream, String) -> Void = { _, _ in }

    static let none = LiveRunCallbacks()
}

@MainActor
final class LiveRunViewModel: ObservableObject {
    @Published var loopState: LoopState?
    @Published var loop: LoopDefinition
    @Published var run: RunRecord
    @Published var selectedStream: LiveRunStream
    @Published var followTail: Bool
    @Published private(set) var stdout: BoundedLiveRunLog
    @Published private(set) var stderr: BoundedLiveRunLog
    @Published private(set) var copilotJSONL: BoundedLiveRunLog
    @Published private(set) var eventsJSONL: BoundedLiveRunLog
    @Published private(set) var stopRequested: Bool

    let stdoutPath: String?
    let stderrPath: String?
    let copilotJSONLPath: String?
    let eventsPath: String?
    let limits: LiveRunLogLimits
    private let callbacks: LiveRunCallbacks

    init(
        loop: LoopDefinition,
        run: RunRecord,
        loopState: LoopState? = nil,
        stdout: String = "",
        stderr: String = "",
        copilotJSONL: String = "",
        eventsJSONL: String = "",
        stdoutPath: String? = nil,
        stderrPath: String? = nil,
        copilotJSONLPath: String? = nil,
        eventsPath: String? = nil,
        selectedStream: LiveRunStream? = nil,
        followTail: Bool = true,
        limits: LiveRunLogLimits = LiveRunLogLimits(),
        callbacks: LiveRunCallbacks = .none
    ) {
        self.loopState = loopState
        self.loop = loop
        self.run = run
        self.stdout = BoundedLiveRunLog(text: stdout, maxBytes: limits.maxBytesPerStream, maxLines: limits.maxLinesPerStream)
        self.stderr = BoundedLiveRunLog(text: stderr, maxBytes: limits.maxBytesPerStream, maxLines: limits.maxLinesPerStream)
        self.copilotJSONL = BoundedLiveRunLog(text: copilotJSONL, maxBytes: limits.maxBytesPerStream, maxLines: limits.maxLinesPerStream)
        self.eventsJSONL = BoundedLiveRunLog(text: eventsJSONL, maxBytes: limits.maxEventBytes, maxLines: limits.maxEventLines)
        self.stdoutPath = stdoutPath
        self.stderrPath = stderrPath
        self.copilotJSONLPath = copilotJSONLPath
        self.eventsPath = eventsPath
        self.selectedStream = selectedStream ?? LiveRunStream.defaultSelection(for: loop)
        self.followTail = followTail
        self.limits = limits
        self.callbacks = callbacks
        self.stopRequested = false
    }

    convenience init(
        loopState: LoopState,
        run: RunRecord,
        stdout: String = "",
        stderr: String = "",
        copilotJSONL: String = "",
        eventsJSONL: String = "",
        stdoutPath: String? = nil,
        stderrPath: String? = nil,
        copilotJSONLPath: String? = nil,
        eventsPath: String? = nil,
        selectedStream: LiveRunStream? = nil,
        followTail: Bool = true,
        limits: LiveRunLogLimits = LiveRunLogLimits(),
        callbacks: LiveRunCallbacks = .none
    ) {
        self.init(
            loop: loopState.definition,
            run: run,
            loopState: loopState,
            stdout: stdout,
            stderr: stderr,
            copilotJSONL: copilotJSONL,
            eventsJSONL: eventsJSONL,
            stdoutPath: stdoutPath,
            stderrPath: stderrPath,
            copilotJSONLPath: copilotJSONLPath,
            eventsPath: eventsPath,
            selectedStream: selectedStream,
            followTail: followTail,
            limits: limits,
            callbacks: callbacks
        )
    }

    var title: String { loop.name }
    var runKey: CopilotLoopRunKey { run.loopRunKey }
    var status: RunStatus { run.status }
    var canStop: Bool { run.status.isActiveOutcome && !stopRequested }

    var timeline: LiveRunTimelineResult {
        LiveRunEventParser.timeline(for: run, stage: loopState?.stage, eventsJSONL: eventsJSONL.text, limits: limits)
    }

    var selectedText: String { log(for: selectedStream).text }
    var selectedPath: String? { path(for: selectedStream) }
    var selectedArtifacts: [CopilotLoopArtifact] { CopilotLoopArtifactDetector.detect(in: selectedText) }

    func append(_ chunk: String, to stream: LiveRunStream) {
        switch stream {
        case .stdout: stdout.append(chunk)
        case .stderr: stderr.append(chunk)
        case .copilotJSONL: copilotJSONL.append(chunk)
        }
    }

    func appendEvents(_ chunk: String) {
        eventsJSONL.append(chunk)
    }

    func replace(_ text: String, for stream: LiveRunStream) {
        switch stream {
        case .stdout: stdout.replace(with: text)
        case .stderr: stderr.replace(with: text)
        case .copilotJSONL: copilotJSONL.replace(with: text)
        }
    }

    func replaceEvents(_ text: String) {
        eventsJSONL.replace(with: text)
    }

    func update(run: RunRecord) {
        self.run = run
        if !run.status.isActiveOutcome { stopRequested = false }
    }

    func update(loopState: LoopState) {
        self.loopState = loopState
        self.loop = loopState.definition
        if let lastRun = loopState.lastRun, lastRun.loopRunKey == run.loopRunKey {
            update(run: lastRun)
        }
    }

    func requestStop() {
        guard canStop else { return }
        stopRequested = true
        if run.status == .starting || run.status == .running {
            run.status = .stopping
        }
        callbacks.stop(runKey, run)
    }

    func copySelectedText() {
        callbacks.copy(runKey, selectedText)
    }

    func openSelectedLog() {
        guard let selectedPath else { return }
        callbacks.openLog(selectedStream, selectedPath)
    }

    func open(_ artifact: CopilotLoopArtifact) {
        callbacks.openArtifact(runKey, artifact)
    }

    func elapsedText(now: Date = Date()) -> String {
        let start = LoopProjection.parseTimestamp(run.startedAt) ?? LoopProjection.parseTimestamp(run.scheduledFor)
        let end = LoopProjection.parseTimestamp(run.endedAt) ?? now
        guard let start else { return "—" }
        return Self.formatDuration(max(0, end.timeIntervalSince(start)))
    }

    func log(for stream: LiveRunStream) -> BoundedLiveRunLog {
        switch stream {
        case .stdout: return stdout
        case .stderr: return stderr
        case .copilotJSONL: return copilotJSONL
        }
    }

    func path(for stream: LiveRunStream) -> String? {
        switch stream {
        case .stdout: return stdoutPath
        case .stderr: return stderrPath
        case .copilotJSONL: return copilotJSONLPath
        }
    }

    static func formatDuration(_ interval: TimeInterval) -> String {
        let seconds = max(0, Int(interval.rounded()))
        let hours = seconds / 3_600
        let minutes = (seconds % 3_600) / 60
        let remaining = seconds % 60
        if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, remaining) }
        return String(format: "%02d:%02d", minutes, remaining)
    }
}

extension RunStatus {
    var isActiveOutcome: Bool {
        switch self {
        case .starting, .running, .stopping: return true
        case .succeeded, .failed, .timedOut, .cancelled, .skippedOverlap, .skippedMissed, .skippedPaused, .approvalBlocked, .launchFailed:
            return false
        }
    }

    var isTerminalOutcome: Bool { !isActiveOutcome }

    var isSkippedOutcome: Bool {
        switch self {
        case .skippedOverlap, .skippedMissed, .skippedPaused: return true
        default: return false
        }
    }
}
