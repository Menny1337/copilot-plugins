import AppKit
import Foundation
import LoopsClient
import LoopsIdentity
import LoopsModels

enum ContractTestError: Error, CustomStringConvertible {
    case failed(String)

    var description: String {
        switch self {
        case .failed(let message): return message
        }
    }
}

private func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw ContractTestError.failed(message) }
}

private func fixtureURL(_ name: String) -> URL {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<3 {
        url.deleteLastPathComponent()
    }
    return url
        .appendingPathComponent("loops/contracts/fixtures", isDirectory: true)
        .appendingPathComponent(name)
}

/// Scratch directory under the package `.build` tree — never `/tmp`.
private func scratchDirectory() throws -> URL {
    var url = URL(fileURLWithPath: #filePath)
    url.deleteLastPathComponent() // ContractTests
    url.deleteLastPathComponent() // loops-app
    let dir = url
        .appendingPathComponent(".build", isDirectory: true)
        .appendingPathComponent("contract-scratch", isDirectory: true)
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

// MARK: - Mock control client

private final class MockControlClient: ControlClient, @unchecked Sendable {
    let responses: [String: Data]
    let failures: [String: ControlError]
    private let lock = NSLock()
    private var invocations: [ControlInvocation] = []

    init(responses: [String: Data] = [:], failures: [String: ControlError] = [:]) {
        self.responses = responses
        self.failures = failures
    }

    func invokeRaw(_ invocation: ControlInvocation) async throws -> Data {
        lock.withLock { invocations.append(invocation) }
        if let failure = failures[invocation.command] { throw failure }
        guard let data = responses[invocation.command] else {
            throw ControlError(message: "no mock for \(invocation.command)")
        }
        return data
    }

    func lastInvocation(_ command: String) -> ControlInvocation? {
        lock.withLock { invocations.last { $0.command == command } }
    }
}

/// Wraps a payload JSON string in the locked success envelope `{ok:true,data:...}`.
private func envelope(_ dataJSON: String) -> Data {
    Data("{ \"ok\": true, \"data\": \(dataJSON) }".utf8)
}

// MARK: - Tests

private func testFixtureContracts() throws {
    let decoder = JSONDecoder()
    let copilot = try decoder.decode(
        LoopDefinition.self,
        from: Data(contentsOf: fixtureURL("copilot-loop.json"))
    )
    let script = try decoder.decode(
        LoopDefinition.self,
        from: Data(contentsOf: fixtureURL("script-loop.json"))
    )
    let run = try decoder.decode(
        RunRecord.self,
        from: Data(contentsOf: fixtureURL("run.json"))
    )

    try check(copilot.kind == .copilot, "Copilot fixture kind mismatch")
    try check(script.kind == .script, "Script fixture kind mismatch")
    try check(
        copilot.schedule == .calendar(hour: 1, minute: 0, weekdays: [], graceSeconds: 300),
        "Calendar fixture mismatch"
    )
    try check(run.status == .succeeded && run.attempts.count == 1, "Run fixture mismatch")

    // Round-trip preservation.
    let encoded = try JSONEncoder().encode(copilot)
    let redecoded = try decoder.decode(LoopDefinition.self, from: encoded)
    try check(redecoded == copilot, "LoopDefinition round-trip mismatch")
}

private func testControlPlaneDecoding() throws {
    let decoder = JSONDecoder()
    let copilotJSON = String(data: try Data(contentsOf: fixtureURL("copilot-loop.json")), encoding: .utf8)!
    let scriptJSON = String(data: try Data(contentsOf: fixtureURL("script-loop.json")), encoding: .utf8)!
    let runJSON = String(data: try Data(contentsOf: fixtureURL("run.json")), encoding: .utf8)!

    let listJSON = """
    {
      "schemaVersion": 1,
      "loops": [
        {
          "definition": \(copilotJSON),
          "isRunning": true,
          "nextScheduledAt": "2026-07-25T01:00:00Z",
          "currentFingerprint": "abc",
          "stage": "running",
          "currentRunID": "run-9",
          "reconciliationError": null
        }
      ],
      "errors": [
        { "id": "broken-loop", "message": "manifest failed to parse", "code": "parse-error" }
      ]
    }
    """
    let list = try decoder.decode(LoopListResponse.self, from: Data(listJSON.utf8))
    try check(list.loops.count == 1, "List should decode one loop")
    try check(list.loops[0].isRunning, "isRunning should decode true")
    try check(list.loops[0].id == "nightly-dependency-report", "LoopState id mismatch")
    try check(list.loops[0].stage == "running", "LoopState stage mismatch")
    try check(list.loops[0].currentRunID == "run-9", "LoopState currentRunID mismatch")
    try check(list.errors.count == 1 && list.errors[0].id == "broken-loop", "List errors mismatch")

    // LoopState tolerates missing optional/derived fields.
    let minimalState = "{ \"definition\": \(scriptJSON) }"
    let state = try decoder.decode(LoopState.self, from: Data(minimalState.utf8))
    try check(!state.isRunning, "Missing isRunning must default to false")
    try check(state.lastRun == nil, "Missing lastRun must default to nil")
    try check(state.stage == nil && state.reconciliationError == nil, "Missing tolerant fields must be nil")

    let detailJSON = """
    {
      "state": \(minimalState),
      "recentRuns": [\(runJSON)],
      "stdoutPath": "/logs/out.log",
      "stderrPath": "/logs/err.log",
      "copilotJsonlPath": "/logs/copilot.jsonl",
      "eventsPath": "/logs/events.jsonl",
      "cliLogPath": "/logs/cli.log"
    }
    """
    let detail = try decoder.decode(LoopDetail.self, from: Data(detailJSON.utf8))
    try check(detail.recentRuns.count == 1, "Detail recentRuns mismatch")
    try check(detail.stdoutPath == "/logs/out.log", "Detail stdoutPath mismatch")
    try check(detail.stderrPath == "/logs/err.log", "Detail stderrPath mismatch")
    try check(detail.copilotJsonlPath == "/logs/copilot.jsonl", "Detail copilotJsonlPath mismatch")
    try check(detail.eventsPath == "/logs/events.jsonl", "Detail eventsPath mismatch")
    try check(detail.cliLogPath == "/logs/cli.log", "Detail cliLogPath mismatch")

    // Detail with all paths omitted stays tolerant.
    let bareDetail = try decoder.decode(LoopDetail.self, from: Data("{ \"state\": \(minimalState) }".utf8))
    try check(bareDetail.stdoutPath == nil && bareDetail.cliLogPath == nil, "Omitted detail paths must be nil")

    let aggregateJSON = """
    {
      "totalLoops": 3,
      "lifecycleCounts": { "enabled": 2, "draft": 1 },
      "lastRunStatusCounts": { "succeeded": 2 },
      "runningLoopIds": ["a"],
      "needsAttentionLoopIds": ["b"]
    }
    """
    let aggregate = try decoder.decode(LoopAggregate.self, from: Data(aggregateJSON.utf8))
    try check(aggregate.totalLoops == 3, "Aggregate totalLoops mismatch")
    try check(aggregate.lifecycleCounts["enabled"] == 2, "Aggregate lifecycle mismatch")

    // Rich inventory: {schemaVersion, plugins, skills, agents, errors} with
    // full Node provenance fields preserved.
    let inventoryJSON = """
    {
      "schemaVersion": 1,
      "plugins": [
        { "name": "core-agents", "enabled": true, "version": "1.2.0", "scope": "user", "source": "marketplace" },
        { "name": "meta", "enabled": false }
      ],
      "skills": [
        { "name": "research-methodology", "enabled": true, "description": "d", "source": "plugin", "path": "/s/skill.md" }
      ],
      "agents": [
        { "name": "core-agents:researcher", "enabled": true, "description": "a", "source": "plugin", "path": "/a.md", "plugin": "core-agents" }
      ],
      "errors": [
        { "type": "load", "message": "bad plugin dir", "remedy": "reinstall", "source": "/x" }
      ]
    }
    """
    let inventory = try decoder.decode(InventoryResponse.self, from: Data(inventoryJSON.utf8))
    try check(inventory.plugins.count == 2, "Inventory plugins count mismatch")
    try check(inventory.plugins[0].name == "core-agents" && inventory.plugins[0].enabled, "Plugin name/enabled mismatch")
    try check(inventory.plugins[0].scope == "user", "Plugin scope provenance mismatch")
    try check(inventory.plugins[0].source == "marketplace", "Plugin source provenance mismatch")
    try check(inventory.plugins[1].version == nil, "Optional plugin version should be nil")
    try check(inventory.skills[0].source == "plugin" && inventory.skills[0].path == "/s/skill.md", "Skill provenance mismatch")
    try check(inventory.agents[0].plugin == "core-agents" && inventory.agents[0].path == "/a.md", "Agent provenance mismatch")
    try check(inventory.errors[0].type == "load" && inventory.errors[0].remedy == "reinstall", "Inventory issue provenance mismatch")
    try check(inventory.errors[0].source == "/x", "Inventory issue source mismatch")

    // Missing name is a hard decode failure (name/enabled are stable).
    do {
        _ = try decoder.decode(PluginInventoryItem.self, from: Data(#"{ "enabled": true }"#.utf8))
        throw ContractTestError.failed("PluginInventoryItem without name should fail to decode")
    } catch is DecodingError {}

    let settings = try decoder.decode(
        SettingsResponse.self,
        from: Data(#"{ "settings": { "notificationsEnabled": false } }"#.utf8)
    )
    try check(!settings.settings.notificationsEnabled, "Settings decode mismatch")
    try check(settings.settings.launchAtLogin, "launchAtLogin default must be true")
    try check(settings.settings.defaultTimeoutSeconds == 1800, "Settings default mismatch")

    // Mutation + preflight tolerant payloads.
    let mutationJSON = """
    { "loop": \(copilotJSON), "warning": "capabilities changed", "schedule": { "nextFireAt": "2026-07-25T01:00:00Z" } }
    """
    let mutation = try decoder.decode(LoopMutationResponse.self, from: Data(mutationJSON.utf8))
    try check(mutation.loop?.id == "nightly-dependency-report", "Mutation loop mismatch")
    try check(mutation.warning == "capabilities changed", "Mutation warning mismatch")
    try check(mutation.schedule != nil, "Mutation schedule should decode tolerantly")

    // purge/stop need not fabricate a loop: loop is optional and provenance
    // fields let the app clean up Keychain accounts.
    let purgeJSON = #"{ "purged": "nightly-dependency-report", "secretNames": ["REPORT_TOKEN"] }"#
    let purge = try decoder.decode(LoopMutationResponse.self, from: Data(purgeJSON.utf8))
    try check(purge.loop == nil, "Purge response should not require a loop")
    try check(purge.purged == "nightly-dependency-report", "Purge id mismatch")
    try check(purge.secretNames == ["REPORT_TOKEN"], "Purge secretNames mismatch")

    let stop = try decoder.decode(LoopMutationResponse.self, from: Data(#"{ "stopped": true }"#.utf8))
    try check(stop.loop == nil && stop.stopped == true, "Stop response mismatch")

    let preflightJSON = """
    {
      "loop": \(copilotJSON),
      "fingerprint": "deadbeef",
      "redactedCommand": ["copilot", "-p", "***"],
      "capabilitySummary": { "tools": 3 },
      "warnings": ["review required"]
    }
    """
    let preflight = try decoder.decode(PreflightResponse.self, from: Data(preflightJSON.utf8))
    try check(preflight.fingerprint == "deadbeef", "Preflight fingerprint mismatch")
    try check(preflight.redactedCommand == ["copilot", "-p", "***"], "Preflight redacted command mismatch")
    try check(preflight.warnings == ["review required"], "Preflight warnings mismatch")
    try check(preflight.errors.isEmpty && !preflight.hasBlockingErrors, "Missing preflight errors should default empty")

    // Preflight errors arrive inside a SUCCESSFUL envelope and must survive
    // decode: UI must fail closed on them, not infer success from
    // warnings/fingerprint alone.
    let failedPreflightJSON = """
    {
      "fingerprint": "deadbeef",
      "warnings": ["cosmetic"],
      "errors": ["working directory does not exist", "secret REPORT_TOKEN is not set"]
    }
    """
    let failedPreflight = try decoder.decode(PreflightResponse.self, from: Data(failedPreflightJSON.utf8))
    try check(failedPreflight.errors.count == 2, "Preflight errors must survive decode")
    try check(failedPreflight.hasBlockingErrors, "Non-empty errors must mark blocking failure")
    try check(
        failedPreflight.errors.first == "working directory does not exist",
        "Preflight error content mismatch"
    )
    // A fingerprint + warnings but with errors must NOT read as success.
    try check(
        failedPreflight.fingerprint != nil && !failedPreflight.warnings.isEmpty && failedPreflight.hasBlockingErrors,
        "Errors must be observable even alongside fingerprint/warnings"
    )

    // Preflight tolerates an empty object.
    let emptyPreflight = try decoder.decode(PreflightResponse.self, from: Data("{}".utf8))
    try check(
        emptyPreflight.loop == nil && emptyPreflight.warnings.isEmpty && emptyPreflight.errors.isEmpty,
        "Empty preflight should be tolerant"
    )

    // History response with per-run log paths.
    let historyJSON = """
    {
      "schemaVersion": 1,
      "loopId": "nightly-dependency-report",
      "requestedCount": 50,
      "count": 1,
      "stateRoot": "/root",
      "runs": [
        {
          "loopId": "nightly-dependency-report",
          "run": \(runJSON),
          "stdoutPath": "/logs/out.log",
          "cliLogPath": "/logs/cli.log"
        }
      ],
      "errors": [{ "id": "x", "message": "skipped" }]
    }
    """
    let history = try decoder.decode(HistoryResponse.self, from: Data(historyJSON.utf8))
    try check(history.requestedCount == 50 && history.count == 1, "History counts mismatch")
    try check(history.loopId == "nightly-dependency-report", "History loopId mismatch")
    try check(history.runs.first?.run.id == "run-20260724-150000", "History run mismatch")
    try check(history.runs.first?.stdoutPath == "/logs/out.log", "History stdoutPath mismatch")
    try check(history.runs.first?.stderrPath == nil, "History omitted path should be nil")
    try check(history.stateRoot == "/root" && history.errors.count == 1, "History stateRoot/errors mismatch")

    // Diagnostics: exact diagnostics.mjs wire shape.
    let diagnosticsJSON = """
    {
      "schemaVersion": 1,
      "runtime": {
        "stateRoot": "/root",
        "launchPath": "/usr/bin:/bin",
        "breadcrumb": { "path": "/root/runtime.json", "error": null },
        "app": { "path": "/Applications/CopilotLoops.app", "exists": true, "executable": false, "kind": "directory", "error": null },
        "control": { "path": "/x/loops-ctl.mjs", "exists": true, "executable": false, "kind": "file", "error": null },
        "runner": { "path": "/x/loops-runner.mjs", "exists": true, "executable": false, "kind": "file", "error": null },
        "node": { "path": "/usr/local/bin/node", "exists": true, "executable": true, "kind": "file", "error": null },
        "helper": { "path": "/app/Helpers/CopilotLoopsSecrets", "exists": true, "executable": true, "kind": "file", "error": null },
        "copilot": { "path": null, "exists": false, "executable": false, "kind": null, "error": "missing" },
        "launchctl": { "path": "/bin/launchctl", "exists": true, "executable": true, "kind": "file", "error": null }
      },
      "app": { "label": "com.copilotplugins.copilot-loops.app", "target": "gui/501", "loaded": true, "launchAtLogin": false },
      "settings": { "schemaVersion": 1, "settings": { "launchAtLogin": false, "notificationsEnabled": true } },
      "inventory": { "plugins": [{ "name": "core-agents", "enabled": true }] },
      "loops": [{ "id": "a", "lifecycle": "enabled", "loaded": true }],
      "errors": [{ "id": "a", "code": "launchd-unloaded", "message": "diag error" }],
      "warnings": [{ "message": "diag warning", "code": "w1" }]
    }
    """
    let diagnostics = try decoder.decode(DiagnosticsResponse.self, from: Data(diagnosticsJSON.utf8))
    try check(diagnostics.runtime?.stateRoot == "/root", "Diag runtime stateRoot mismatch")
    try check(diagnostics.runtime?.launchPath == "/usr/bin:/bin", "Diag launchPath mismatch")
    try check(diagnostics.runtime?.breadcrumb != nil, "Diag breadcrumb should decode as JSONValue")
    try check(diagnostics.runtime?.app?.kind == "directory", "Diag app path kind mismatch")
    try check(diagnostics.runtime?.control?.path == "/x/loops-ctl.mjs", "Diag control path mismatch")
    try check(diagnostics.runtime?.control?.exists == true && diagnostics.runtime?.control?.executable == false, "Diag control health mismatch")
    try check(diagnostics.runtime?.control?.kind == "file", "Diag control kind mismatch")
    try check(diagnostics.runtime?.runner?.path == "/x/loops-runner.mjs", "Diag runner path mismatch")
    try check(diagnostics.runtime?.node?.executable == true, "Diag node health mismatch")
    try check(diagnostics.runtime?.helper?.executable == true, "Diag helper health mismatch")
    try check(diagnostics.runtime?.copilot?.error == "missing" && diagnostics.runtime?.copilot?.path == nil, "Diag copilot error/path mismatch")
    try check(diagnostics.runtime?.launchctl?.executable == true, "Diag launchctl health mismatch")
    // settings is the FULL SettingsResponse wrapper, not a bare AppSettings.
    try check(diagnostics.settings?.settings.launchAtLogin == false, "Diag settings wrapper mismatch")
    try check(diagnostics.settings?.schemaVersion == 1, "Diag settings schemaVersion mismatch")
    try check(diagnostics.inventory?.plugins.first?.name == "core-agents", "Diag inventory mismatch")
    try check(diagnostics.app?.stringValue == nil, "Top-level app should decode as JSONValue object")
    try check(diagnostics.loops != nil, "Diag loops should decode as JSONValue")
    try check(diagnostics.errors.first?.message == "diag error", "Diag errors preserved")
    try check(diagnostics.warnings.first?.code == "w1", "Diag warnings preserved")

    // Diagnostics tolerates an empty object.
    let emptyDiag = try decoder.decode(DiagnosticsResponse.self, from: Data("{}".utf8))
    try check(emptyDiag.runtime == nil && emptyDiag.settings == nil && emptyDiag.errors.isEmpty && emptyDiag.warnings.isEmpty, "Empty diagnostics tolerant")

    // Templates: structured inputs/defaults preserved as JSONValue.
    let templatesJSON = """
    {
      "schemaVersion": 1,
      "templates": [
        {
          "key": "nightly-report",
          "title": "Nightly report",
          "kind": "copilot",
          "description": "d",
          "requiredInputs": ["workingDirectory"],
          "optionalInputs": { "model": "gpt-5.6-sol" },
          "notes": ["be careful"],
          "defaults": { "timeoutSeconds": 1800 }
        }
      ]
    }
    """
    let templates = try decoder.decode(TemplatesResponse.self, from: Data(templatesJSON.utf8))
    let template = templates.templates.first
    try check(template?.key == "nightly-report", "Template key mismatch")
    try check(template?.kind == "copilot" && template?.title == "Nightly report", "Template title/kind mismatch")
    try check(template?.requiredInputs == .array([.string("workingDirectory")]), "Template requiredInputs not preserved")
    try check(template?.optionalInputs == .object(["model": .string("gpt-5.6-sol")]), "Template optionalInputs not preserved")
    try check(template?.defaults == .object(["timeoutSeconds": .int(1800)]), "Template defaults not preserved")
}

private func testErrorEnvelopes() throws {
    let decoder = JSONDecoder()

    let errEnvelope = try decoder.decode(
        ControlErrorEnvelope.self,
        from: Data(#"{ "ok": false, "error": { "name": "UserError", "message": "loop not found: x", "context": { "id": "x" } } }"#.utf8)
    )
    try check(!errEnvelope.ok, "Envelope ok should be false")
    try check(errEnvelope.error.message == "loop not found: x", "Error message mismatch")
    try check(errEnvelope.error.context["id"]?.stringValue == "x", "Error context mismatch")

    let bare = try decoder.decode(
        ControlError.self,
        from: Data(#"{ "message": "boom" }"#.utf8)
    )
    try check(bare.name == "Error", "Bare error default name mismatch")

    // mapFailure: envelope on stdout.
    let mapped = ShellControlClient.mapFailure(
        stdout: Data(#"{ "ok": false, "error": { "message": "structured failure" } }"#.utf8),
        stderr: Data(),
        exitCode: 2,
        command: "show"
    )
    try check(
        (mapped as? ControlError)?.message == "structured failure",
        "mapFailure should surface structured error"
    )

    // mapFailure: fall back to stderr text.
    let fallback = ShellControlClient.mapFailure(
        stdout: Data(),
        stderr: Data("node: command failed\n".utf8),
        exitCode: 3,
        command: "list"
    )
    try check(
        (fallback as? ControlError)?.message == "node: command failed",
        "mapFailure should fall back to stderr text"
    )
    try check((fallback as? ControlError)?.code == "exit-3", "mapFailure code mismatch")

    // Numeric Node error codes (e.g. a launchctl exit code) normalize to String.
    let numericCode = try decoder.decode(
        ControlError.self,
        from: Data(#"{ "message": "launchctl failed", "code": 78 }"#.utf8)
    )
    try check(numericCode.code == "78", "Numeric error code should normalize to String")
    // ...and inside a failure envelope without breaking decoding.
    let numericEnvelope = try decoder.decode(
        ControlErrorEnvelope.self,
        from: Data(#"{ "ok": false, "error": { "message": "boom", "code": 5 } }"#.utf8)
    )
    try check(numericEnvelope.error.code == "5", "Numeric code in envelope should normalize")

    // Fail closed: a success envelope MUST carry an explicit `ok` key.
    do {
        _ = try decoder.decode(
            ControlEnvelope<LoopListResponse>.self,
            from: Data(#"{ "data": { "loops": [] } }"#.utf8)
        )
        throw ContractTestError.failed("Envelope without ok should be rejected")
    } catch is DecodingError {}
    // A well-formed success envelope still decodes.
    let okEnvelope = try decoder.decode(
        ControlEnvelope<LoopListResponse>.self,
        from: Data(#"{ "ok": true, "data": { "loops": [] } }"#.utf8)
    )
    try check(okEnvelope.ok && okEnvelope.data != nil, "Well-formed success envelope should decode")
}

private func testMockClientFlow() async throws {
    let copilotJSON = String(data: try Data(contentsOf: fixtureURL("copilot-loop.json")), encoding: .utf8)!

    let client = MockControlClient(
        responses: [
            "list": envelope("{ \"loops\": [ { \"definition\": \(copilotJSON) } ] }"),
            "show": envelope("{ \"state\": { \"definition\": \(copilotJSON) } }"),
            "enable": envelope("{ \"loop\": \(copilotJSON) }"),
            "settings-set": envelope("{ \"settings\": { \"launchAtLogin\": true } }"),
            "inventory": envelope("{ \"plugins\": [] }"),
            "history": envelope(#"{ "requestedCount": 200, "count": 0, "runs": [] }"#),
            "diagnostics": envelope(#"{ "runtime": { "stateRoot": "/root" } }"#),
            "templates": envelope(#"{ "templates": [{ "key": "t1" }] }"#),
            // Preflight errors ride inside a SUCCESSFUL (ok:true) envelope.
            "preflight": envelope(#"{ "fingerprint": "abc", "warnings": ["w"], "errors": ["missing working directory"] }"#),
            // Envelope-level failure (ok:false) even though the process exits 0.
            "run-now": Data(#"{ "ok": false, "error": { "name": "UserError", "message": "already running", "code": "overlap" } }"#.utf8),
        ],
        failures: ["stop": ControlError(name: "UserError", message: "loop not found: nope")]
    )

    // Envelope unwrapping returns the inner payload.
    let list = try await client.listLoops()
    try check(list.loops.count == 1, "Mock listLoops mismatch")

    // show sends its id in the JSON payload, never as argv.
    _ = try await client.showLoop(id: "nightly-dependency-report")
    let showInv = client.lastInvocation("show")
    try check(showInv?.arguments.isEmpty ?? false, "show must not send argv arguments")
    let showPayload = try JSONDecoder().decode(LoopIDRequest.self, from: showInv?.payload ?? Data())
    try check(showPayload.id == "nightly-dependency-report", "show payload id mismatch")

    // enable returns a LoopMutationResponse and encodes {id}.
    let enabled = try await client.enable(id: "nightly-dependency-report")
    try check(enabled.loop?.id == "nightly-dependency-report", "enable mutation loop mismatch")
    let enablePayload = try JSONDecoder().decode(LoopIDRequest.self, from: client.lastInvocation("enable")?.payload ?? Data())
    try check(enablePayload.id == "nightly-dependency-report", "enable payload id mismatch")

    // settings-set encodes {settings}.
    _ = try await client.setSettings(AppSettings())
    let settingsPayload = try JSONDecoder().decode(SettingsRequest.self, from: client.lastInvocation("settings-set")?.payload ?? Data())
    try check(settingsPayload.settings.launchAtLogin, "settings-set payload should default launchAtLogin true")

    // inventory encodes {localPluginDirectories}.
    _ = try await client.inventory(localPluginDirectories: ["/a", "/b"])
    let invPayload = try JSONDecoder().decode(InventoryRequest.self, from: client.lastInvocation("inventory")?.payload ?? Data())
    try check(invPayload.localPluginDirectories == ["/a", "/b"], "inventory payload mismatch")

    // preflight succeeds at the envelope level but reports blocking errors; the
    // client must surface them (UI fails closed, does not infer success).
    let preflight = try await client.preflight(id: "nightly-dependency-report")
    try check(preflight.hasBlockingErrors, "Preflight blocking errors must survive envelope unwrap")
    try check(preflight.errors == ["missing working directory"], "Preflight errors content mismatch")

    // history: id + clamped count travel in the JSON stdin payload, never argv.
    _ = try await client.history(id: "nightly-dependency-report", count: 5000)
    let historyInv = client.lastInvocation("history")
    try check(historyInv?.arguments.isEmpty ?? false, "history must not send argv arguments")
    let historyPayload = try JSONDecoder().decode(HistoryRequest.self, from: historyInv?.payload ?? Data())
    try check(historyPayload.id == "nightly-dependency-report", "history payload id mismatch")
    try check(historyPayload.count == 200, "history count must clamp to 200")
    // count below range clamps up to 1.
    _ = try await client.history(count: 0)
    let historyLow = try JSONDecoder().decode(HistoryRequest.self, from: client.lastInvocation("history")?.payload ?? Data())
    try check(historyLow.count == 1 && historyLow.id == nil, "history count must clamp to 1 with nil id")

    // diagnostics: optional id in the JSON payload, never argv.
    _ = try await client.diagnostics(id: "nightly-dependency-report")
    let diagInv = client.lastInvocation("diagnostics")
    try check(diagInv?.arguments.isEmpty ?? false, "diagnostics must not send argv arguments")
    let diagPayload = try JSONDecoder().decode(DiagnosticsRequest.self, from: diagInv?.payload ?? Data())
    try check(diagPayload.id == "nightly-dependency-report", "diagnostics payload id mismatch")

    // templates: empty JSON object payload, never argv.
    let templatesResult = try await client.templates()
    try check(templatesResult.templates.first?.key == "t1", "templates payload mismatch")
    let templatesInv = client.lastInvocation("templates")
    try check(templatesInv?.arguments.isEmpty ?? false, "templates must not send argv arguments")
    _ = try JSONDecoder().decode(EmptyRequest.self, from: templatesInv?.payload ?? Data())

    // Envelope-level failure surfaces the nested ControlError.
    do {
        _ = try await client.runNow(id: "x")
        throw ContractTestError.failed("run-now ok:false should throw")
    } catch let error as ControlError {
        try check(error.code == "overlap", "Envelope failure code mismatch")
    }

    // invokeRaw throwing propagates the ControlError verbatim.
    do {
        _ = try await client.stop(id: "nope")
        throw ContractTestError.failed("stop should have thrown")
    } catch let error as ControlError {
        try check(error.message == "loop not found: nope", "Propagated error mismatch")
    }
}

private func testProjections() throws {
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!

    try check(
        LoopProjection.parseTimestamp("2026-07-24T15:00:00Z") != nil,
        "Plain ISO timestamp should parse"
    )
    try check(
        LoopProjection.parseTimestamp("2026-07-24T15:00:00.123Z") != nil,
        "Fractional ISO timestamp should parse"
    )
    try check(LoopProjection.parseTimestamp(nil) == nil, "nil timestamp should be nil")

    let reference = LoopProjection.parseTimestamp("2026-07-24T15:00:00Z")!

    // manual -> nil
    try check(
        LoopProjection.nextFireDate(for: .manual, after: reference) == nil,
        "Manual schedule has no next fire"
    )

    // interval -> reference + seconds
    let intervalNext = LoopProjection.nextFireDate(
        for: .interval(seconds: 3600, graceSeconds: 0),
        after: reference
    )
    try check(
        intervalNext == reference.addingTimeInterval(3600),
        "Interval next fire mismatch"
    )

    // once in the past -> nil; future -> that date
    try check(
        LoopProjection.nextFireDate(
            for: .once(scheduledAt: "2020-01-01T00:00:00Z", graceSeconds: 0),
            after: reference
        ) == nil,
        "Past once schedule should be nil"
    )
    let futureOnce = LoopProjection.nextFireDate(
        for: .once(scheduledAt: "2026-08-01T00:00:00Z", graceSeconds: 0),
        after: reference
    )
    try check(
        futureOnce == LoopProjection.parseTimestamp("2026-08-01T00:00:00Z"),
        "Future once schedule mismatch"
    )

    // calendar every-day at 01:00 UTC -> next day 01:00
    let calNext = LoopProjection.nextFireDate(
        for: .calendar(hour: 1, minute: 0, weekdays: [], graceSeconds: 0),
        after: reference,
        calendar: utc
    )
    try check(
        calNext == LoopProjection.parseTimestamp("2026-07-25T01:00:00Z"),
        "Calendar next fire mismatch: \(String(describing: calNext))"
    )

    // relative descriptions
    try check(
        LoopProjection.relativeDescription(
            from: reference,
            to: reference.addingTimeInterval(3900)
        ) == "in 1h 5m",
        "Relative future description mismatch"
    )
    try check(
        LoopProjection.relativeDescription(
            from: reference,
            to: reference.addingTimeInterval(-180)
        ) == "3m ago",
        "Relative past description mismatch"
    )

    // run duration
    let run = try JSONDecoder().decode(RunRecord.self, from: Data(contentsOf: fixtureURL("run.json")))
    try check(LoopProjection.runDuration(run) == 252, "Run duration mismatch")
}

private func testHealthAndApproval() throws {
    let copilot = try JSONDecoder().decode(
        LoopDefinition.self,
        from: Data(contentsOf: fixtureURL("copilot-loop.json"))
    )

    // draft -> blocked
    let draftState = LoopState(definition: copilot)
    try check(LoopProjection.health(for: draftState) == .blocked, "Draft should be blocked")

    // enabled + succeeded last run + matching fingerprint -> ok
    var enabled = copilot
    enabled.lifecycle = .enabled
    enabled.approval.fingerprint = "match"
    enabled.approval.approvedAt = "2026-07-24T15:00:00Z"
    let run = try JSONDecoder().decode(RunRecord.self, from: Data(contentsOf: fixtureURL("run.json")))
    let okState = LoopState(definition: enabled, lastRun: run, currentFingerprint: "match")
    try check(LoopProjection.health(for: okState) == .ok, "Enabled+succeeded should be ok")
    try check(!LoopProjection.approvalDrift(for: okState), "Matching fingerprint should not drift")

    // fingerprint mismatch -> blocked + drift
    let driftState = LoopState(definition: enabled, lastRun: run, currentFingerprint: "changed")
    try check(LoopProjection.approvalDrift(for: driftState), "Mismatch should drift")
    try check(LoopProjection.health(for: driftState) == .blocked, "Drift should block health")

    // failed last run -> failing
    var failedRun = run
    failedRun.status = .failed
    let failing = LoopState(definition: enabled, lastRun: failedRun, currentFingerprint: "match")
    try check(LoopProjection.health(for: failing) == .failing, "Failed run should be failing")

    // statusSummary: a ready loop is approved but not enabled, so it must NOT
    // project a scheduled run (it does not own a schedule slot yet).
    let now = LoopProjection.parseTimestamp("2026-07-24T15:00:00Z")!
    var ready = copilot
    ready.lifecycle = .ready
    ready.approval.fingerprint = "match"
    ready.approval.approvedAt = "2026-07-24T15:00:00Z"
    let readyState = LoopState(definition: ready, currentFingerprint: "match")
    try check(
        LoopProjection.statusSummary(for: readyState, now: now) == "Ready to enable",
        "Ready loop should read 'Ready to enable', got '\(LoopProjection.statusSummary(for: readyState, now: now))'"
    )

    // An enabled loop reports a next run ONLY from a persisted future
    // nextScheduledAt — it must not synthesize one from the schedule formula.
    let enabledWithNext = LoopState(
        definition: enabled,
        nextScheduledAt: "2026-07-24T16:00:00Z",
        currentFingerprint: "match"
    )
    let enabledSummary = LoopProjection.statusSummary(for: enabledWithNext, now: now)
    try check(
        enabledSummary.hasPrefix("Next run"),
        "Enabled loop with persisted future nextScheduledAt should project a next run, got '\(enabledSummary)'"
    )

    // Without a persisted nextScheduledAt, an enabled (calendar-scheduled) loop
    // must NOT synthesize a fire time — it reads Idle, not "Next run".
    let enabledNoNext = LoopState(definition: enabled, currentFingerprint: "match")
    try check(
        LoopProjection.statusSummary(for: enabledNoNext, now: now) == "Idle",
        "Enabled loop without persisted nextScheduledAt must read Idle, got '\(LoopProjection.statusSummary(for: enabledNoNext, now: now))'"
    )

    // A stale (past) nextScheduledAt is not projected as a future run.
    let enabledStale = LoopState(
        definition: enabled,
        nextScheduledAt: "2020-01-01T00:00:00Z",
        currentFingerprint: "match"
    )
    try check(
        LoopProjection.statusSummary(for: enabledStale, now: now) == "Idle",
        "Stale nextScheduledAt must read Idle, got '\(LoopProjection.statusSummary(for: enabledStale, now: now))'"
    )

    // A manual enabled loop with no next run reads Manual.
    var manual = enabled
    manual.schedule = .manual
    let manualState = LoopState(definition: manual, currentFingerprint: "match")
    try check(
        LoopProjection.statusSummary(for: manualState, now: now) == "Manual",
        "Manual enabled loop should read Manual, got '\(LoopProjection.statusSummary(for: manualState, now: now))'"
    )
}

private func testNavigation() throws {
    var nav = LoopsNavigationState()
    try check(nav.selectedSection == .dashboard, "Default section should be dashboard")
    try check(nav.current == .section(.dashboard), "Default current route mismatch")

    nav.push(.loopDetail(loopID: "abc"))
    try check(nav.current == .loopDetail(loopID: "abc"), "Push should update current")
    try check(nav.current.loopID == "abc", "Route loopID accessor mismatch")

    nav.select(.history)
    try check(nav.selectedSection == .history, "Select should switch section")
    try check(nav.path.isEmpty, "Select should clear path")

    nav.push(.runDetail(loopID: "abc", runID: "r1"))
    let popped = nav.pop()
    try check(popped == .runDetail(loopID: "abc", runID: "r1"), "Pop should return last route")
    try check(nav.path.isEmpty, "Path should be empty after pop")

    // Codable round-trip for persistence.
    let route = LoopsRoute.editLoop(loopID: "xyz")
    let data = try JSONEncoder().encode(route)
    let decoded = try JSONDecoder().decode(LoopsRoute.self, from: data)
    try check(decoded == route, "Route Codable round-trip mismatch")
}

private func testRuntimeResolver() throws {
    let existing = URL(fileURLWithPath: #filePath).path // this source file certainly exists

    // 1. explicit injected path wins; falls back to /usr/bin/env node.
    let explicit = RuntimeResolver(
        explicitControlPath: existing,
        environment: ["HOME": "/Users/USERNAME"]
    )
    let resolvedExplicit = try explicit.resolve()
    try check(resolvedExplicit.argumentPrefix.last == existing, "Explicit control path should be used")
    try check(
        resolvedExplicit.executableURL.path == "/usr/bin/env"
            && resolvedExplicit.argumentPrefix.first == "node",
        "Should fall back to env node lookup"
    )

    // 2. environment variable.
    let viaEnv = RuntimeResolver(environment: [
        "COPILOT_LOOPS_CTL": existing,
        "HOME": "/Users/USERNAME",
    ])
    let envResolved = try viaEnv.resolve()
    try check(envResolved.argumentPrefix.contains(existing), "Env var control path should resolve")

    // 3. state root resolution honours COPILOT_LOOPS_HOME and default.
    let rooted = RuntimeResolver(environment: ["COPILOT_LOOPS_HOME": "/data/loops"])
    let rootedPath = try rooted.stateRoot().path
    try check(rootedPath == "/data/loops", "COPILOT_LOOPS_HOME should win")
    let defaulted = RuntimeResolver(environment: ["HOME": "/Users/USERNAME"])
    let defaultedPath = try defaulted.stateRoot().path
    try check(
        defaultedPath == "/Users/USERNAME/.copilot/scheduled-tasks/copilot-loops",
        "Default state root mismatch"
    )

    // 4. not found -> descriptive error.
    let missing = RuntimeResolver(
        explicitControlPath: "/definitely/not/here/loops-ctl.mjs",
        environment: ["HOME": "/Users/USERNAME"]
    )
    do {
        _ = try missing.resolve()
        throw ContractTestError.failed("Missing control plane should throw")
    } catch let error as RuntimeResolverError {
        if case .controlPlaneNotFound = error {} else {
            throw ContractTestError.failed("Wrong resolver error: \(error)")
        }

    }
}

private func testIdentityProfile() throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let environment = ["COPILOT_LOOPS_HOME": dir.path, "HOME": "/Users/USERNAME"]

    let missing = try LoopsIdentity.load(environment: environment)
    try check(missing.namespace == "com.copilotplugins.copilot-loops", "Missing profile should use public namespace")
    try check(!missing.configured, "Missing profile should be reported as unconfigured")

    let profileURL = dir.appendingPathComponent("identity.json")
    let configured: [String: Any] = [
        "schemaVersion": 1,
        "profile": "custom",
        "namespace": "com.example.copilot-loops",
        "retainedSetting": ["enabled": true],
    ]
    try JSONSerialization.data(withJSONObject: configured).write(to: profileURL)
    let custom = try LoopsIdentity.load(environment: environment)
    try check(custom.appLabel == "com.example.copilot-loops.app", "Custom app label mismatch")
    try check(custom.taskLabelPrefix == "com.example.copilot-loops.task.", "Custom task prefix mismatch")
    try check(custom.keychainService == "com.example.copilot-loops.secrets", "Custom Keychain service mismatch")

    for version in ["true", "false", #""1""#, "1.5", "null"] {
        try Data("{\"schemaVersion\":\(version),\"profile\":\"default\"}".utf8).write(to: profileURL)
        do {
            _ = try LoopsIdentity.load(environment: environment)
            throw ContractTestError.failed("Invalid identity schema version should fail: \(version)")
        } catch let error as LoopsIdentityError {
            if case .invalidSchemaVersion = error {} else {
                throw ContractTestError.failed("Wrong identity schema error: \(error)")
            }
        }
    }

    try Data(#"{"schemaVersion":1,"profile":"unknown"}"#.utf8).write(to: profileURL)
    do {
        _ = try LoopsIdentity.load(environment: environment)
        throw ContractTestError.failed("Unknown identity profile should fail")
    } catch let error as LoopsIdentityError {
        if case .invalidProfile = error {} else {
            throw ContractTestError.failed("Wrong identity profile error: \(error)")
        }
    }

    try Data(#"{"schemaVersion":1,"profile":"custom","namespace":"Example"}"#.utf8).write(to: profileURL)
    do {
        _ = try LoopsIdentity.load(environment: environment)
        throw ContractTestError.failed("Malformed identity namespace should fail")
    } catch let error as LoopsIdentityError {
        if case .invalidNamespace = error {} else {
            throw ContractTestError.failed("Wrong identity namespace error: \(error)")
        }
    }

    do {
        _ = try LoopsIdentity.load(environment: ["HOME": "relative/home"])
        throw ContractTestError.failed("Relative HOME should fail identity resolution")
    } catch let error as LoopsIdentityError {
        try check(error == .invalidHome("relative/home"), "Wrong HOME error: \(error)")
    }

    try FileManager.default.removeItem(at: profileURL)
    try FileManager.default.createSymbolicLink(
        at: profileURL, withDestinationURL: dir.appendingPathComponent("missing.json")
    )
    do {
        _ = try LoopsIdentity.load(environment: environment)
        throw ContractTestError.failed("Dangling identity profile must not select public defaults")
    } catch let error as LoopsIdentityError {
        if case .unreadable = error {} else {
            throw ContractTestError.failed("Wrong dangling-profile error: \(error)")
        }
    }

    if getuid() != 0 {
        try FileManager.default.removeItem(at: profileURL)
        try JSONSerialization.data(withJSONObject: configured).write(to: profileURL)
        try FileManager.default.setAttributes([.posixPermissions: 0], ofItemAtPath: dir.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: dir.path) }
        do {
            _ = try LoopsIdentity.load(environment: environment)
            throw ContractTestError.failed("Inaccessible identity profile must not select public defaults")
        } catch let error as LoopsIdentityError {
            if case .unreadable = error {} else {
                throw ContractTestError.failed("Wrong inaccessible-profile error: \(error)")
            }
        }
    }
}

private func testRelativeStateRootRejected() throws {
    // A relative COPILOT_LOOPS_HOME must be rejected, never resolved against cwd.
    let relative = RuntimeResolver(environment: ["COPILOT_LOOPS_HOME": "relative/loops"])
    do {
        _ = try relative.stateRoot()
        throw ContractTestError.failed("Relative COPILOT_LOOPS_HOME should throw")
    } catch let error as RuntimeResolverError {
        try check(error == .invalidStateRoot(value: "relative/loops"), "Wrong state-root error: \(error)")
    }

    // resolve() should surface the same error (via the default breadcrumb path).
    let resolving = RuntimeResolver(
        explicitControlPath: URL(fileURLWithPath: #filePath).path,
        environment: ["COPILOT_LOOPS_HOME": "still/relative"]
    )
    do {
        _ = try resolving.resolve()
        throw ContractTestError.failed("resolve() should surface invalid state root")
    } catch let error as RuntimeResolverError {
        try check(error == .invalidStateRoot(value: "still/relative"), "resolve() wrong error: \(error)")
    }

    // A tilde COPILOT_LOOPS_HOME must be rejected (launchd does not expand ~).
    let tilde = RuntimeResolver(environment: [
        "COPILOT_LOOPS_HOME": "~/loops-home",
        "HOME": "/Users/USERNAME",
    ])
    do {
        _ = try tilde.stateRoot()
        throw ContractTestError.failed("Tilde COPILOT_LOOPS_HOME should be rejected")
    } catch let error as RuntimeResolverError {
        try check(error == .invalidStateRoot(value: "~/loops-home"), "Tilde state-root error mismatch: \(error)")
    }

    // A present-but-empty COPILOT_LOOPS_HOME must be rejected (not treated as unset).
    let emptyHome = RuntimeResolver(environment: ["COPILOT_LOOPS_HOME": ""])
    do {
        _ = try emptyHome.stateRoot()
        throw ContractTestError.failed("Empty COPILOT_LOOPS_HOME should be rejected")
    } catch let error as RuntimeResolverError {
        try check(error == .invalidStateRoot(value: ""), "Empty state-root error mismatch: \(error)")
    }
}

private func testAbsolutePathContract() throws {
    let existing = URL(fileURLWithPath: #filePath).path // absolute, definitely exists

    // Relative COPILOT_LOOPS_CTL must be rejected (never resolved against cwd).
    let relativeCtl = RuntimeResolver(environment: [
        "COPILOT_LOOPS_CTL": "relative/loops-ctl.mjs",
        "HOME": "/Users/USERNAME",
    ])
    do {
        _ = try relativeCtl.resolve()
        throw ContractTestError.failed("Relative COPILOT_LOOPS_CTL should be rejected")
    } catch let error as RuntimeResolverError {
        try check(error == .invalidControlPath(value: "relative/loops-ctl.mjs"), "Control path error mismatch: \(error)")
    }

    // Relative COPILOT_LOOPS_NODE must be rejected once a control path resolves.
    let relativeNode = RuntimeResolver(environment: [
        "COPILOT_LOOPS_CTL": existing,
        "COPILOT_LOOPS_NODE": "relative/node",
        "HOME": "/Users/USERNAME",
    ])
    do {
        _ = try relativeNode.resolve()
        throw ContractTestError.failed("Relative COPILOT_LOOPS_NODE should be rejected")
    } catch let error as RuntimeResolverError {
        try check(error == .invalidNodePath(value: "relative/node"), "Node path error mismatch: \(error)")
    }

    // A corrupt breadcrumb with relative paths must surface an error, not fall
    // back to cwd/default. Exercise each field with absolute siblings otherwise.
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let ctl = dir.appendingPathComponent("loops-ctl.mjs")
    try Data("// stub\n".utf8).write(to: ctl)

    func writeBreadcrumb(_ crumb: RuntimeBreadcrumb) throws -> URL {
        let url = dir.appendingPathComponent("runtime-\(UUID().uuidString).json")
        try JSONEncoder().encode(crumb).write(to: url)
        return url
    }

    // Relative breadcrumb control path.
    let badCtlURL = try writeBreadcrumb(RuntimeBreadcrumb(loopsCtlPath: "relative/loops-ctl.mjs", stateRoot: dir.path))
    do {
        _ = try RuntimeResolver(breadcrumbURL: badCtlURL, environment: [:]).resolve()
        throw ContractTestError.failed("Relative breadcrumb control path should be rejected")
    } catch let error as RuntimeResolverError {
        try check(error == .invalidControlPath(value: "relative/loops-ctl.mjs"), "Breadcrumb control error mismatch: \(error)")
    }

    // Relative breadcrumb state root.
    let badRootURL = try writeBreadcrumb(RuntimeBreadcrumb(loopsCtlPath: ctl.path, stateRoot: "relative/state"))
    do {
        _ = try RuntimeResolver(breadcrumbURL: badRootURL, environment: [:]).resolve()
        throw ContractTestError.failed("Relative breadcrumb state root should be rejected")
    } catch let error as RuntimeResolverError {
        try check(error == .invalidStateRoot(value: "relative/state"), "Breadcrumb state-root error mismatch: \(error)")
    }

    // Relative breadcrumb node path.
    let badNodeURL = try writeBreadcrumb(RuntimeBreadcrumb(loopsCtlPath: ctl.path, nodePath: "relative/node", stateRoot: dir.path))
    do {
        _ = try RuntimeResolver(breadcrumbURL: badNodeURL, environment: [:]).resolve()
        throw ContractTestError.failed("Relative breadcrumb node path should be rejected")
    } catch let error as RuntimeResolverError {
        try check(error == .invalidNodePath(value: "relative/node"), "Breadcrumb node error mismatch: \(error)")
    }
}

private func testRuntimeBreadcrumb() throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }

    let ctl = dir.appendingPathComponent("loops-ctl.mjs")
    try Data("// stub\n".utf8).write(to: ctl)
    let node = dir.appendingPathComponent("node")
    try Data("#!/bin/sh\n".utf8).write(to: node)

    let breadcrumb = RuntimeBreadcrumb(
        loopsCtlPath: ctl.path,
        nodePath: node.path,
        stateRoot: dir.path
    )
    let crumbURL = dir.appendingPathComponent("runtime.json")
    try JSONEncoder().encode(breadcrumb).write(to: crumbURL)

    let resolver = RuntimeResolver(breadcrumbURL: crumbURL, environment: [:])
    let resolution = try resolver.resolve()
    try check(resolution.executableURL.path == node.path, "Breadcrumb node path should be used")
    try check(resolution.argumentPrefix == [ctl.path], "Breadcrumb control path should be used")
    try check(
        resolution.stateRoot.path == dir.standardizedFileURL.path,
        "Breadcrumb state root should be used"
    )
}

private func testDebouncer() throws {
    let box = Counter()
    let debouncer = Debouncer(interval: 60) { box.increment() }

    // Multiple signals coalesce into a single pending invocation.
    debouncer.signal()
    debouncer.signal()
    debouncer.signal()
    try check(debouncer.hasPending, "Debouncer should have a pending invocation")
    try check(debouncer.flush(), "Flush should report a pending invocation")
    try check(box.value == 1, "Coalesced signals should fire exactly once, got \(box.value)")
    try check(!debouncer.hasPending, "Debouncer should be empty after flush")

    // Cancel prevents firing.
    debouncer.signal()
    debouncer.cancel()
    try check(!debouncer.flush(), "Cancelled debouncer should have nothing to flush")
    try check(box.value == 1, "Cancel should prevent firing")
}

private func testRootWatcherBatching() throws {
    let sink = BatchSink()
    let watcher = RootDirectoryWatcher(root: URL(fileURLWithPath: "/unused")) { paths in
        sink.append(paths)
    }

    // ingest is the path FSEvents drives; verify accumulation + dedupe + sort.
    watcher.ingest(["/b/2", "/a/1"])
    watcher.ingest(["/a/1", "/c/3"])
    watcher.flush()

    let batches = sink.batches
    try check(batches.count == 1, "Watcher should deliver a single batch, got \(batches.count)")
    try check(batches[0] == ["/a/1", "/b/2", "/c/3"], "Watcher batch should be deduped+sorted: \(batches[0])")
}

private func testRootWatcherPathFilter() throws {
    // The control/state metadata filter admits manifests/markers and excludes
    // the high-frequency live-log streams.
    let admit = [
        "/tasks/nightly/loop.json",
        "/tasks/nightly/state.json",
        "/tasks/nightly/run.json",
        "/tasks/nightly/run-20260724.json",
        "/tasks/nightly/approval.blocked",
        "/tasks/nightly/manual.request",
        "/Library/LaunchAgents/com.copilotplugins.copilot-loops.task.nightly.plist",
        "/tasks/nightly", // task directory (extensionless)
    ]
    for path in admit {
        try check(LiveLoopsEnvironment.isControlStateMetadata(path), "Should admit metadata: \(path)")
    }
    let exclude = [
        "/tasks/nightly/stdout.log",
        "/tasks/nightly/stderr.log",
        "/tasks/nightly/copilot.jsonl",
        "/tasks/nightly/events.jsonl",
        "/tasks/nightly/cli.log",
    ]
    for path in exclude {
        try check(!LiveLoopsEnvironment.isControlStateMetadata(path), "Should exclude live log: \(path)")
    }

    // Starvation guard: a continuous stream of excluded log paths must NEVER
    // buffer anything or arm the debounce, so it cannot keep pushing the
    // trailing edge out and starve a real metadata change.
    let sink = BatchSink()
    let watcher = RootDirectoryWatcher(
        root: URL(fileURLWithPath: "/unused"),
        pathFilter: { LiveLoopsEnvironment.isControlStateMetadata($0) }
    ) { paths in
        sink.append(paths)
    }

    for i in 0..<1000 {
        watcher.ingest(["/tasks/nightly/stdout.log", "/tasks/nightly/copilot.jsonl", "/tasks/nightly/events-\(i).jsonl"])
    }
    // No metadata seen yet: nothing pending, flush delivers nothing.
    watcher.flush()
    try check(sink.batches.isEmpty, "Excluded log churn must not produce a batch")

    // A single real metadata change (amid more log churn) is delivered, and the
    // excluded paths are filtered out of the batch.
    watcher.ingest(["/tasks/nightly/stdout.log", "/tasks/nightly/loop.json", "/tasks/nightly/cli.log"])
    watcher.flush()
    try check(sink.batches.count == 1, "Metadata change must deliver exactly one batch, got \(sink.batches.count)")
    try check(sink.batches[0] == ["/tasks/nightly/loop.json"], "Batch must contain only metadata: \(sink.batches[0])")
}

private func testLogTailerRotation() throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let log = dir.appendingPathComponent("run.log")

    try Data("hello\n".utf8).write(to: log)
    let tailer = LogTailer(url: log, onChunk: { _ in })

    let first = tailer.readAvailable()
    try check(String(data: first, encoding: .utf8) == "hello\n", "Initial read mismatch")
    try check(tailer.readAvailable().isEmpty, "No new data should read empty")

    // Append -> only the new bytes.
    let handle = try FileHandle(forWritingTo: log)
    try handle.seekToEnd()
    try handle.write(contentsOf: Data("world\n".utf8))
    try handle.close()
    try check(String(data: tailer.readAvailable(), encoding: .utf8) == "world\n", "Append read mismatch")

    // Recreate shorter (rotation/truncation) -> offset resets, full new content.
    try FileManager.default.removeItem(at: log)
    try Data("new\n".utf8).write(to: log)
    try check(String(data: tailer.readAvailable(), encoding: .utf8) == "new\n", "Recreation read mismatch")

    // Recreate LARGER than the previous file -> new inode still resets to 0 so
    // the whole replacement is read (regression guard for size-only detection).
    try check(tailer.readAvailable().isEmpty, "Should be caught up before larger replacement")
    try FileManager.default.removeItem(at: log)
    let larger = String(repeating: "z", count: 4096) + "\n"
    try Data(larger.utf8).write(to: log)
    try check(
        String(data: tailer.readAvailable(), encoding: .utf8) == larger,
        "Larger replacement should be read in full from offset 0"
    )
}

/// Drives the live DispatchSource follow path through many rotations to guard
/// against the cancel-handler fd leak: each `start()` opens a descriptor that
/// must be closed deterministically on `stop()`/rotation, so the process fd
/// count must stay bounded rather than growing per cycle.
private func testLogTailerRotationStress() async throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let log = dir.appendingPathComponent("run.log")

    func openFDCount() -> Int {
        (try? FileManager.default.contentsOfDirectory(atPath: "/dev/fd").count) ?? -1
    }

    func sleepMS(_ ms: UInt64) async {
        try? await Task.sleep(nanoseconds: ms * 1_000_000)
    }

    let sink = Counter()

    func runCycle(_ i: Int) async throws {
        try Data("start-\(i)\n".utf8).write(to: log)
        let tailer = LogTailer(url: log, onChunk: { _ in sink.increment() })
        tailer.start()
        await sleepMS(20) // let setupSource open the fd + read initial content
        // Append, then rotate (delete + recreate) to drive the follow + rotation
        // handling that cancels and re-arms the DispatchSource.
        if let h = try? FileHandle(forWritingTo: log) {
            _ = try? h.seekToEnd()
            try? h.write(contentsOf: Data("append-\(i)\n".utf8))
            try? h.close()
        }
        await sleepMS(20)
        try? FileManager.default.removeItem(at: log)
        try Data("rotated-\(i)\n".utf8).write(to: log)
        await sleepMS(20)
        tailer.stop()
        await sleepMS(20) // let teardown/cancel run and close the fd
    }

    // Warm up to stabilize any one-time fd allocations, then baseline.
    for i in 0..<5 { try await runCycle(i) }
    await sleepMS(100)
    let baseline = openFDCount()

    for i in 5..<45 { try await runCycle(i) }
    await sleepMS(150)
    let after = openFDCount()

    try check(baseline > 0, "Could not sample open fd count")
    // A per-cycle leak would grow fds by ~40 across the main loop; allow small
    // slack for transient/runtime descriptors.
    try check(
        after <= baseline + 5,
        "LogTailer leaked descriptors across rotations: baseline \(baseline), after \(after)"
    )
}

/// Proves the DispatchSource is armed before the initial availability read: a
/// write landing in the arm→prime window (driven by the test seam) must still
/// be delivered even though no further write follows it. With the source armed
/// after the read (the old ordering) the seam write would be missed.
private func testLogTailerArmsBeforeInitialRead() async throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let log = dir.appendingPathComponent("run.log")
    try Data("base\n".utf8).write(to: log)

    let sink = DataSink()
    let tailer = LogTailer(url: log, onChunk: { sink.append($0) })
    // Seam runs on the tailer queue after arming, before the initial read.
    tailer.onArmedForTesting = { [url = log] in
        if let handle = try? FileHandle(forWritingTo: url) {
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data("seam\n".utf8))
            try? handle.close()
        }
    }
    tailer.start()

    var delivered = false
    for _ in 0..<100 {
        if sink.text.contains("seam") { delivered = true; break }
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
    tailer.stop()
    try check(delivered, "Write in the arm→prime window must be delivered (no later write follows it)")
}

/// Proves the bounded live-log bootstrap: capture a bounded suffix ending at S,
/// then tail from `startOffset: S`. Bytes written between the snapshot and the
/// source arm (and in the arm→prime window) must be delivered exactly once,
/// while pre-S content is never re-emitted, and the initial read is bounded.
private func testLogTailerBoundedBootstrap() async throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let log = dir.appendingPathComponent("run.log")

    // A large pre-existing body; the bounded suffix reader must not read it all.
    let preexisting = String(repeating: "P", count: 100_000) + "\n"
    try Data(preexisting.utf8).write(to: log)

    // stat S -> read a bounded suffix ending at S (<= 4 KiB).
    guard let suffix = LogTailer.readBoundedSuffix(url: log, maxBytes: 4096) else {
        throw ContractTestError.failed("readBoundedSuffix returned nil")
    }
    try check(suffix.data.count <= 4096, "Bounded suffix must not exceed maxBytes")
    try check(suffix.endOffset == UInt64(preexisting.utf8.count), "endOffset must equal file size S")
    try check(suffix.inode != 0, "inode should be captured")

    // A write landing between the snapshot and the source arm (tailer not yet
    // started): must be delivered by the bounded initial read from S.
    if let handle = try? FileHandle(forWritingTo: log) {
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: Data("between-snapshot-and-arm\n".utf8))
        try? handle.close()
    }

    let sink = DataSink()
    let tailer = LogTailer(url: log, startOffset: suffix.endOffset, inode: suffix.inode, onChunk: { sink.append($0) })
    // A further write in the arm→prime window must also be delivered.
    tailer.onArmedForTesting = { [url = log] in
        if let handle = try? FileHandle(forWritingTo: url) {
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data("in-arm-window\n".utf8))
            try? handle.close()
        }
    }
    tailer.start()

    var got = false
    for _ in 0..<100 {
        let text = sink.text
        if text.contains("between-snapshot-and-arm") && text.contains("in-arm-window") { got = true; break }
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
    tailer.stop()
    try check(got, "Post-snapshot appends (before and during arm) must be delivered from offset S")
    // Pre-S content must never be re-emitted.
    try check(!sink.text.contains("PPPP"), "Pre-snapshot content must not be re-emitted")
}

/// Proves the read path opens first and `fstat`s that exact descriptor: after an
/// inode replacement, `readBoundedSuffix` pairs the NEW inode with the NEW
/// file's size/content (never an old size/inode with a new file), and a tailer
/// seeded from the OLD offset/inode resets to 0 and re-reads the replacement.
private func testLogTailerDescriptorConsistency() throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }
    let log = dir.appendingPathComponent("run.log")

    try Data("AAAA\n".utf8).write(to: log)
    guard let s1 = LogTailer.readBoundedSuffix(url: log, maxBytes: 4096) else {
        throw ContractTestError.failed("readBoundedSuffix returned nil (first)")
    }
    try check(s1.endOffset == 5, "First suffix endOffset mismatch")
    try check(String(data: s1.data, encoding: .utf8) == "AAAA\n", "First suffix content mismatch")

    // Replace the inode with a LARGER, different file.
    try FileManager.default.removeItem(at: log)
    let bigger = String(repeating: "B", count: 32) + "\n"
    try Data(bigger.utf8).write(to: log)

    guard let s2 = LogTailer.readBoundedSuffix(url: log, maxBytes: 4096) else {
        throw ContractTestError.failed("readBoundedSuffix returned nil (second)")
    }
    // Same-descriptor pairing: the new inode's size/content, not the old file's.
    try check(s2.inode != s1.inode, "Inode should change after replacement")
    try check(s2.endOffset == UInt64(bigger.utf8.count), "Second suffix endOffset must match new file size")
    try check(String(data: s2.data, encoding: .utf8) == bigger, "Second suffix must be the replacement content")

    // A tailer seeded from the OLD offset/inode must reset to 0 on the new inode
    // and re-read the full replacement (readAvailable also opens+fstats one fd).
    let tailer = LogTailer(url: log, startOffset: s1.endOffset, inode: s1.inode, onChunk: { _ in })
    try check(
        String(data: tailer.readAvailable(), encoding: .utf8) == bigger,
        "readAvailable must reset to 0 on inode replacement and read the full new file"
    )
    try check(tailer.readAvailable().isEmpty, "No further bytes after full read")
}

private func testRootWatcherCreatesRoot() throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }

    // Fresh install: the tasks directory does not exist yet.
    let root = dir.appendingPathComponent("tasks", isDirectory: true)
    try check(!FileManager.default.fileExists(atPath: root.path), "Precondition: root must not exist")

    let watcher = RootDirectoryWatcher(root: root) { _ in }
    try watcher.start()
    defer { watcher.stop() }

    var isDir: ObjCBool = false
    try check(
        FileManager.default.fileExists(atPath: root.path, isDirectory: &isDir) && isDir.boolValue,
        "start() should create the watch root directory"
    )

    // A root path that is a regular file surfaces a descriptive error.
    let filePath = dir.appendingPathComponent("not-a-dir")
    try Data("x".utf8).write(to: filePath)
    let bad = RootDirectoryWatcher(root: filePath) { _ in }
    do {
        try bad.start()
        throw ContractTestError.failed("start() over a file should throw")
    } catch let error as RootWatcherError {
        try check(error == .rootNotDirectory(path: filePath.path), "Wrong watcher error: \(error)")
    }
}

private func testLargePipeOutput() async throws {
    let processScript = """
    const chunk = "x".repeat(1024);
    for (let i = 0; i < 256; i++) {
      process.stdout.write(chunk);
      process.stderr.write(chunk);
    }
    """
    let output = try await ProcessRunner.runOrThrow(
        URL(fileURLWithPath: "/usr/bin/env"),
        arguments: ["node", "-e", processScript]
    )
    try check(output.stdout.count == 262_144, "Large stdout was not drained")
    try check(output.stderr.count == 262_144, "Large stderr was not drained")
}

private func testProcessRunnerTimeoutKill() async throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }

    // A helper that ignores SIGTERM and would otherwise run for 30s. Its long
    // sleep is a child in the SAME process group, so a whole-group SIGKILL must
    // tear the entire tree down — proving the runner does not merely target the
    // direct PID and then wait out the descendant's sleep.
    let helper = dir.appendingPathComponent("term-ignorer")
    try makeExecutable(helper, script: """
    #!/bin/bash
    trap '' TERM
    cat > /dev/null
    sleep 30 >/dev/null 2>&1
    echo done
    """)

    let started = Date()
    do {
        _ = try await ProcessRunner.run(
            helper,
            arguments: [],
            environment: ["PATH": "/bin:/usr/bin"],
            stdin: Data("x".utf8),
            timeout: 0.5
        )
        throw ContractTestError.failed("TERM-ignoring process should time out")
    } catch let error as ProcessRunnerError {
        guard case .timedOut = error else {
            throw ContractTestError.failed("Expected timedOut, got \(error)")
        }
    }
    // SIGTERM ignored (and inherited as SIG_IGN by the sleep) -> ~0.5s wait + 2s
    // grace + group SIGKILL; must stay well under the helper's 30s sleep,
    // proving the timeout path is bounded on a monotonic clock.
    let elapsed = Date().timeIntervalSince(started)
    try check(elapsed < 8, "Timeout must remain bounded despite ignored SIGTERM, took \(elapsed)s")
}

private func testProcessRunnerTimeoutInheritedPipe() async throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }

    // A helper that ignores TERM and leaves a background descendant which
    // inherits the SAME stdout/stderr pipes (no redirection) and would outlive a
    // direct-PID-only kill. The runner must (a) bound completion without ever
    // awaiting the inherited pipe's EOF, and (b) terminate the whole process
    // group so the descendant is torn down too — verified below via its PID.
    let helper = dir.appendingPathComponent("pipe-inheritor")
    let pidFile = dir.appendingPathComponent("survivor.pid")
    try makeExecutable(helper, script: """
    #!/bin/bash
    trap '' TERM
    sleep 30 &
    echo $! > "\(pidFile.path)"
    wait
    """)

    let secret = "SUPER-SECRET-πλ-1337"
    let started = Date()
    do {
        _ = try await ProcessRunner.run(
            helper,
            arguments: [],
            environment: ["PATH": "/bin:/usr/bin"],
            stdin: Data(secret.utf8),
            timeout: 0.5
        )
        throw ContractTestError.failed("Inherited-pipe survivor should time out")
    } catch let error as ProcessRunnerError {
        guard case .timedOut = error else {
            throw ContractTestError.failed("Expected timedOut, got \(error)")
        }
        try check(
            !(error.errorDescription ?? "").contains("SUPER-SECRET"),
            "SECRET LEAK: value must not appear in timeout error"
        )
    }
    let elapsed = Date().timeIntervalSince(started)
    // Must not wait out the surviving descendant's 30s sleep.
    try check(elapsed < 8, "Timeout must be bounded despite an inherited-pipe survivor, took \(elapsed)s")

    // The background descendant must be gone: a whole-group SIGKILL reaps it
    // rather than orphaning it. A direct-PID-only kill would leave it alive.
    if let text = try? String(contentsOf: pidFile, encoding: .utf8),
       let survivor = pid_t(text.trimmingCharacters(in: .whitespacesAndNewlines)) {
        let deadline = Date().addingTimeInterval(3)
        while kill(survivor, 0) == 0 && Date() < deadline {
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        try check(kill(survivor, 0) != 0, "Descendant \(survivor) survived group termination")
    } else {
        throw ContractTestError.failed("Helper did not record its descendant PID")
    }
}

// MARK: - Secrets client

private func makeExecutable(_ url: URL, script: String) throws {
    try Data(script.utf8).write(to: url)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
}

/// Poll (bounded, monotonic) until `pid` no longer exists, returning whether it
/// is gone. Used to prove descendants are not orphaned.
private func waitForPidGone(_ pid: pid_t, within seconds: Double) async -> Bool {
    let deadline = DispatchTime.now() + seconds
    while kill(pid, 0) == 0 && DispatchTime.now() < deadline {
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
    return kill(pid, 0) != 0
}

/// A child that never reads a large stdin and exits immediately must not crash
/// the host via SIGPIPE, and `run` must return promptly with the child's code.
private func testProcessRunnerStdinChildExitsEarly() async throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }

    let helper = dir.appendingPathComponent("exits-without-reading")
    try makeExecutable(helper, script: """
    #!/bin/bash
    exit 0
    """)

    // 2 MiB far exceeds the pipe buffer, so the writer must confront a closed
    // read end mid-stream. Without F_SETNOSIGPIPE this write raises SIGPIPE and
    // kills the whole harness; reaching the assertions below proves survival.
    let payload = Data(repeating: 0x41, count: 2 * 1024 * 1024)
    let started = Date()
    let output = try await ProcessRunner.run(
        helper,
        arguments: [],
        environment: ["PATH": "/bin:/usr/bin"],
        stdin: payload,
        timeout: 5
    )
    let elapsed = Date().timeIntervalSince(started)
    try check(output.exitCode == 0, "Early-exit child should return exit 0, got \(output.exitCode)")
    try check(elapsed < 5, "Large stdin to a non-reading child must return promptly, took \(elapsed)s")
}

/// On timeout, the leader may die on SIGTERM while a descendant ignores it. The
/// runner must still SIGKILL-sweep the group so nothing is orphaned.
private func testProcessRunnerTimeoutLeaderExitsDescendantSurvives() async throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }

    let helper = dir.appendingPathComponent("leader-dies-child-survives")
    let pidFile = dir.appendingPathComponent("survivor.pid")
    // The leader exits *cleanly* on SIGTERM (so it is reaped during the timeout
    // grace, before any SIGKILL), but its background subshell ignores TERM and
    // sleeps — as does the sleep it spawns (SIG_IGN is inherited). Nothing in
    // the timeout path itself SIGKILLs them, so only the post-exit group sweep
    // can remove them.
    try makeExecutable(helper, script: """
    #!/bin/bash
    ( trap '' TERM; sleep 30 ) &
    echo $! > "\(pidFile.path)"
    trap 'exit 0' TERM
    wait
    """)

    let started = Date()
    do {
        _ = try await ProcessRunner.run(
            helper,
            arguments: [],
            environment: ["PATH": "/bin:/usr/bin"],
            timeout: 0.5
        )
        throw ContractTestError.failed("Should time out while a descendant survives")
    } catch let error as ProcessRunnerError {
        guard case .timedOut = error else {
            throw ContractTestError.failed("Expected timedOut, got \(error)")
        }
    }
    let elapsed = Date().timeIntervalSince(started)
    try check(elapsed < 8, "Group sweep after leader exit must be bounded, took \(elapsed)s")

    guard let text = try? String(contentsOf: pidFile, encoding: .utf8),
          let survivor = pid_t(text.trimmingCharacters(in: .whitespacesAndNewlines)) else {
        throw ContractTestError.failed("Helper did not record its descendant PID")
    }
    let gone = await waitForPidGone(survivor, within: 4)
    try check(gone, "TERM-ignoring descendant \(survivor) survived the timeout group sweep")
}

/// A normally-exiting leader that leaves a background descendant (which inherits
/// the stdout pipe) must not orphan it, and the sweep must unblock draining so
/// the call still returns promptly with the leader's exit code.
private func testProcessRunnerNormalExitBackgroundDescendant() async throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }

    let helper = dir.appendingPathComponent("exits-with-background-child")
    let pidFile = dir.appendingPathComponent("bg.pid")
    // The sleep inherits the stdout pipe (no redirection), so draining can only
    // reach EOF once the group sweep tears the descendant down.
    try makeExecutable(helper, script: """
    #!/bin/bash
    sleep 30 &
    echo $! > "\(pidFile.path)"
    exit 0
    """)

    let started = Date()
    let output = try await ProcessRunner.run(
        helper,
        arguments: [],
        environment: ["PATH": "/bin:/usr/bin"]
    )
    let elapsed = Date().timeIntervalSince(started)
    try check(output.exitCode == 0, "Leader should exit 0, got \(output.exitCode)")
    try check(elapsed < 8, "Normal-exit group sweep + drain must be bounded, took \(elapsed)s")

    guard let text = try? String(contentsOf: pidFile, encoding: .utf8),
          let survivor = pid_t(text.trimmingCharacters(in: .whitespacesAndNewlines)) else {
        throw ContractTestError.failed("Helper did not record its background PID")
    }
    let gone = await waitForPidGone(survivor, within: 4)
    try check(gone, "Background descendant \(survivor) was orphaned after normal exit")
}

/// Count the current process's open descriptors via /dev/fd. Used to prove the
/// stdin writer never leaks its write end when a reader escapes the group.
private func openFDCount() -> Int {
    (try? FileManager.default.contentsOfDirectory(atPath: "/dev/fd").count) ?? -1
}

/// Defect 1 regression: when the parent runs with standard descriptors closed,
/// `pipe()` may hand back fd 0/1/2; unless every pipe end is relocated above
/// STDERR before the spawn file actions are built, a later `addclose` tears down
/// the child's just-mapped std fd. We close each std fd (and all three) around a
/// round-trip helper, then restore them so the parent test runner is untouched.
private func testProcessRunnerClosedStandardDescriptors() async throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }

    let helper = dir.appendingPathComponent("stdio-roundtrip")
    try makeExecutable(helper, script: """
    #!/bin/bash
    read -r line
    printf 'STDOUT:%s\\n' "$line"
    printf 'STDERR-OK\\n' >&2
    exit 0
    """)

    let in0ValidInitially = fcntl(0, F_GETFD) != -1

    for toClose in [[Int32(0)], [Int32(1)], [Int32(2)], [Int32(0), 1, 2]] {
        let marker = "STDIN-\(UUID().uuidString)"

        // Save then close the requested std fds so pipe() is forced to reuse
        // them. F_DUPFD(>=3) keeps the saved copies above the standard range so
        // they can never collide with the descriptors we are about to close and
        // later restore. Returns -1 if the fd is already closed (e.g. run with
        // <&-), in which case we simply leave it closed for the run.
        var saved: [(Int32, Int32)] = []
        for fd in toClose {
            let dupd = fcntl(fd, F_DUPFD, STDERR_FILENO + 1)
            if dupd >= 0 { saved.append((fd, dupd)); close(fd) }
        }

        let captured: Result<ProcessOutput, Error>
        do {
            let out = try await ProcessRunner.run(
                helper,
                arguments: [],
                environment: ["PATH": "/bin:/usr/bin"],
                stdin: Data(marker.utf8),
                timeout: 5
            )
            captured = .success(out)
        } catch {
            captured = .failure(error)
        }

        // Restore before any assertion/print so the harness output is intact.
        for (fd, dupd) in saved { _ = dup2(dupd, fd); close(dupd) }

        let out: ProcessOutput
        switch captured {
        case .success(let value): out = value
        case .failure(let error):
            throw ContractTestError.failed("run failed with fds \(toClose) closed: \(error)")
        }
        let stdout = String(decoding: out.stdout, as: UTF8.self)
        let stderr = String(decoding: out.stderr, as: UTF8.self)
        try check(out.exitCode == 0, "Closed-fd \(toClose): exit \(out.exitCode)")
        try check(stdout.contains("STDOUT:\(marker)"),
                  "Closed-fd \(toClose): child stdin/stdout not wired; stdout=\(stdout.debugDescription)")
        try check(stderr.contains("STDERR-OK"),
                  "Closed-fd \(toClose): child stderr not wired; stderr=\(stderr.debugDescription)")
    }

    // The parent runner's own descriptors must be intact (no contamination).
    if in0ValidInitially {
        try check(fcntl(0, F_GETFD) != -1, "parent stdin fd was contaminated")
    }
    try check(fcntl(1, F_GETFD) != -1, "parent stdout fd was contaminated")
    try check(fcntl(2, F_GETFD) != -1, "parent stderr fd was contaminated")
}

/// Defect regression (relocation failure): if a stdio-range pipe fd cannot be
/// duplicated above STDERR (fd exhaustion / low RLIMIT_NOFILE), ProcessRunner
/// must fail the launch safely — never spawn with broken stdio — closing every
/// owned pipe fd exactly once with no leak, double-close, or parent stdio
/// contamination. We force the failure with a test-only fault-injection env var
/// while all std fds are closed (so pipe() actually hands back stdio-range fds).
private func testProcessRunnerRelocationFailureFailsSafely() async throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }

    let helper = dir.appendingPathComponent("must-not-run")
    try makeExecutable(helper, script: """
    #!/bin/bash
    echo SHOULD_NOT_RUN
    exit 0
    """)

    let in0ValidInitially = fcntl(0, F_GETFD) != -1

    setenv("PROCESSRUNNER_FORCE_RELOCATION_FAILURE", "1", 1)
    defer { unsetenv("PROCESSRUNNER_FORCE_RELOCATION_FAILURE") }

    // Save then close all std fds (F_DUPFD >= 3 so the saved copies never
    // collide) to force pipe() into the stdio range, then restore afterwards.
    var saved: [(Int32, Int32)] = []
    for fd in [Int32(0), 1, 2] {
        let dupd = fcntl(fd, F_DUPFD, STDERR_FILENO + 1)
        if dupd >= 0 { saved.append((fd, dupd)); close(fd) }
    }

    let fdBefore = openFDCount()
    let started = Date()
    let captured: Result<ProcessOutput, Error>
    do {
        let out = try await ProcessRunner.run(
            helper,
            arguments: [],
            environment: ["PATH": "/bin:/usr/bin"],
            stdin: Data("payload".utf8),
            timeout: 5
        )
        captured = .success(out)
    } catch {
        captured = .failure(error)
    }
    let elapsed = Date().timeIntervalSince(started)
    let fdAfter = openFDCount()

    // Restore std fds before asserting (so failures print normally).
    for (fd, dupd) in saved { _ = dup2(dupd, fd); close(dupd) }

    switch captured {
    case .success:
        throw ContractTestError.failed("Relocation failure must fail launch, not spawn with broken stdio")
    case .failure(let error):
        try check(!(error is ProcessRunnerError),
                  "Relocation failure should surface a launch NSError, not ProcessRunnerError; got \(error)")
        let ns = error as NSError
        try check(ns.domain == "ProcessRunner",
                  "Expected a ProcessRunner launch error, got domain \(ns.domain)")
    }

    // Every owned pipe fd was closed exactly once: with std still closed, the
    // open-fd count is unchanged across the failed launch (a leak would raise
    // it). Bounded elapsed proves it fails promptly rather than hanging.
    try check(fdBefore > 0 && fdAfter > 0, "Could not sample /dev/fd count")
    try check(fdAfter <= fdBefore,
              "Relocation-failure launch leaked descriptors: \(fdBefore) -> \(fdAfter)")
    try check(elapsed < 5, "Relocation failure must fail promptly, took \(elapsed)s")

    // The parent runner's own descriptors must be intact (no contamination).
    if in0ValidInitially {
        try check(fcntl(0, F_GETFD) != -1, "parent stdin fd was contaminated")
    }
    try check(fcntl(1, F_GETFD) != -1, "parent stdout fd was contaminated")
    try check(fcntl(2, F_GETFD) != -1, "parent stderr fd was contaminated")

    // Sanity: with the fault injection cleared, a normal launch still succeeds
    // (proves the env seam did not leave any global state broken).
    unsetenv("PROCESSRUNNER_FORCE_RELOCATION_FAILURE")
    let ok = try await ProcessRunner.run(
        helper, arguments: [], environment: ["PATH": "/bin:/usr/bin"])
    try check(ok.exitCode == 0, "Post-injection normal launch should succeed, got \(ok.exitCode)")
    try check(String(decoding: ok.stdout, as: UTF8.self).contains("SHOULD_NOT_RUN"),
              "Post-injection normal launch should actually run the helper")
}

/// Defect 2 regression: a descendant escapes the process group (new session via
/// setsid) and retains the stdin read end without ever reading it. A blocking
/// stdin writer would wedge forever after run() returned, leaking a thread and
/// the write fd. The bounded, self-owned writer must stop within a poll tick and
/// close its own fd, so run() returns promptly and no descriptor is leaked —
/// verified by looping and confirming the open-fd count does not grow.
private func testProcessRunnerEscapedGroupStdinNonReader() async throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }

    let pidFile = dir.appendingPathComponent("escaped.pids")
    let helper = dir.appendingPathComponent("escaped-stdin-holder")
    // The perl descendant calls setsid (new session -> escapes our process
    // group, so the group sweep cannot reach it) and execs `sleep`, inheriting
    // fd 0 (the runner's stdin read end) which it holds open without reading.
    // stdout/stderr are redirected away so draining still reaches EOF at once.
    try makeExecutable(helper, script: """
    #!/bin/bash
    perl -e 'use POSIX; POSIX::setsid(); exec("sleep","30")' >/dev/null 2>&1 &
    echo $! >> "\(pidFile.path)"
    exit 0
    """)

    // The escaped holders outlive run(); clean them up individually at the end
    // (they escaped the group, so the runner legitimately cannot reap them).
    defer {
        if let text = try? String(contentsOf: pidFile, encoding: .utf8) {
            for line in text.split(whereSeparator: { $0 == "\n" }) {
                if let p = pid_t(line.trimmingCharacters(in: .whitespaces)) { _ = kill(p, SIGKILL) }
            }
        }
    }

    // 2 MiB far exceeds the pipe buffer, so the writer necessarily blocks once
    // the buffer fills (the escaped reader keeps the read end open but never
    // drains it) — exactly the wedge the stop flag must break.
    let payload = Data(repeating: 0x41, count: 2 * 1024 * 1024)
    let iterations = 10

    // Warm up so runtime threads/descriptors reach steady state before we sample.
    _ = try? await ProcessRunner.run(
        helper, arguments: [], environment: ["PATH": "/bin:/usr/bin"],
        stdin: payload, timeout: 5)
    try? await Task.sleep(nanoseconds: 300_000_000)

    let baseline = openFDCount()
    var worst = 0.0
    for _ in 0..<iterations {
        let started = Date()
        let out = try await ProcessRunner.run(
            helper,
            arguments: [],
            environment: ["PATH": "/bin:/usr/bin"],
            stdin: payload,
            timeout: 5
        )
        let elapsed = Date().timeIntervalSince(started)
        worst = max(worst, elapsed)
        try check(out.exitCode == 0, "Escaped-stdin leader should exit 0, got \(out.exitCode)")
        try check(elapsed < 5, "Escaped, non-reading stdin holder must not wedge run; took \(elapsed)s")
    }

    // Let the final writer observe its stop flag and close its fd (bounded).
    try? await Task.sleep(nanoseconds: 300_000_000)
    let after = openFDCount()

    try check(baseline > 0 && after > 0, "Could not sample /dev/fd count")
    try check(after <= baseline + 3,
              "Stdin writer leaked descriptors across \(iterations) escaped-reader runs: \(baseline) -> \(after)")
    try check(worst < 5, "Every escaped-reader run must return bounded; worst \(worst)s")
}

private func testSecretsClient() async throws {
    let dir = try scratchDirectory()
    defer { try? FileManager.default.removeItem(at: dir) }

    let argvFile = dir.appendingPathComponent("argv.txt")
    let stdinFile = dir.appendingPathComponent("stdin.bin")

    // A fake helper mimicking CopilotLoopsSecrets: records argv, captures stdin
    // for `set`, and never echoes the value.
    let helper = dir.appendingPathComponent("fake-secrets")
    try makeExecutable(helper, script: """
    #!/bin/bash
    printf '%s\\n' "$@" >> "$ARGV_FILE"
    case "$1" in
      set) cat > "$STDIN_FILE"; echo ok ;;
      exists) echo "${EXISTS_RESULT:-true}" ;;
      delete) echo ok ;;
      *) echo "unknown command" >&2; exit 2 ;;
    esac
    """)

    let secret = "SUPER-SECRET-πλ-1337\n"
    let secretData = Data(secret.utf8)
    let baseEnv: [String: String] = [
        "PATH": "/bin:/usr/bin",
        "HOME": dir.path,
        "ARGV_FILE": argvFile.path,
        "STDIN_FILE": stdinFile.path,
    ]

    let client = KeychainSecretsClient(
        explicitHelperPath: helper.path,
        environment: baseEnv,
        bundleHelperURL: nil
    )

    // set: value goes over stdin, never argv.
    try await client.set(loopID: "nightly-dependency-report", name: "REPORT_TOKEN", value: secretData)
    let argvContent = try String(contentsOf: argvFile, encoding: .utf8)
    try check(argvContent.contains("set"), "argv should contain command")
    try check(argvContent.contains("nightly-dependency-report:REPORT_TOKEN"), "argv should contain account")
    try check(!argvContent.contains("SUPER-SECRET"), "SECRET LEAK: value must never appear in argv")
    let capturedStdin = try Data(contentsOf: stdinFile)
    try check(capturedStdin == secretData, "Helper should receive secret via stdin")

    // exists: true / false.
    let existsTrue = try await client.exists(loopID: "nightly-dependency-report", name: "REPORT_TOKEN")
    try check(existsTrue, "exists should be true")
    let falseClient = KeychainSecretsClient(
        explicitHelperPath: helper.path,
        environment: baseEnv.merging(["EXISTS_RESULT": "false"]) { _, new in new },
        bundleHelperURL: nil
    )
    let existsFalse = try await falseClient.exists(loopID: "loop-x", name: "TOKEN")
    try check(existsFalse == false, "exists should be false")

    // delete: no throw.
    try await client.delete(loopID: "nightly-dependency-report", name: "REPORT_TOKEN")

    // invalid account rejected locally, before the helper runs.
    let freshArgv = dir.appendingPathComponent("argv-invalid.txt")
    let invalidClient = KeychainSecretsClient(
        explicitHelperPath: helper.path,
        environment: baseEnv.merging(["ARGV_FILE": freshArgv.path]) { _, new in new },
        bundleHelperURL: nil
    )
    do {
        try await invalidClient.set(loopID: "Bad_ID", name: "TOKEN", value: secretData)
        throw ContractTestError.failed("Invalid account should throw")
    } catch let error as SecretsClientError {
        guard case .invalidAccount = error else {
            throw ContractTestError.failed("Wrong error for invalid account: \(error)")
        }
    }
    try check(!FileManager.default.fileExists(atPath: freshArgv.path), "Helper must not run for invalid account")

    // helper not found.
    let missingClient = KeychainSecretsClient(
        explicitHelperPath: nil,
        environment: ["HOME": dir.path],
        bundleHelperURL: nil
    )
    do {
        _ = try await missingClient.exists(loopID: "loop-x", name: "TOKEN")
        throw ContractTestError.failed("Missing helper should throw")
    } catch let error as SecretsClientError {
        guard case .helperNotFound = error else {
            throw ContractTestError.failed("Wrong error for missing helper: \(error)")
        }
    }

    // A relative helper candidate must be rejected, never resolved against cwd.
    let relativeClient = KeychainSecretsClient(
        explicitHelperPath: "relative/CopilotLoopsSecrets",
        environment: ["HOME": dir.path],
        bundleHelperURL: nil
    )
    do {
        _ = try relativeClient.resolveHelper()
        throw ContractTestError.failed("Relative helper path should be rejected")
    } catch let error as SecretsClientError {
        guard case .helperNotFound(let searched) = error else {
            throw ContractTestError.failed("Wrong error for relative helper: \(error)")
        }
        try check(
            searched.contains { $0.contains("(rejected relative)") && $0.contains("relative/CopilotLoopsSecrets") },
            "Relative candidate should be reported as rejected, got \(searched)"
        )
    }

    // failure path: sanitized error never contains the secret.
    let failHelper = dir.appendingPathComponent("fail-secrets")
    try makeExecutable(failHelper, script: """
    #!/bin/bash
    printf '%s\\n' "$@" >> "$ARGV_FILE"
    cat > /dev/null
    echo "boom: keychain denied" >&2
    exit 1
    """)
    let failClient = KeychainSecretsClient(
        explicitHelperPath: failHelper.path,
        environment: baseEnv,
        bundleHelperURL: nil
    )
    do {
        try await failClient.set(loopID: "loop-x", name: "TOKEN", value: secretData)
        throw ContractTestError.failed("Failing helper should throw")
    } catch let error as SecretsClientError {
        guard case .helperFailed(_, let code, let detail) = error else {
            throw ContractTestError.failed("Wrong failure error: \(error)")
        }
        try check(code == 1, "Failure exit code mismatch")
        try check(!(error.errorDescription ?? "").contains("SUPER-SECRET"), "SECRET LEAK: value in error text")
        try check(!detail.contains("SUPER-SECRET"), "SECRET LEAK: value in error detail")
    }

    // timeout path: bounded, sanitized, no leak.
    let slowHelper = dir.appendingPathComponent("slow-secrets")
    try makeExecutable(slowHelper, script: """
    #!/bin/bash
    cat > /dev/null
    sleep 5
    echo ok
    """)
    let slowClient = KeychainSecretsClient(
        explicitHelperPath: slowHelper.path,
        environment: baseEnv,
        bundleHelperURL: nil,
        timeout: 0.5
    )
    let started = Date()
    do {
        try await slowClient.set(loopID: "loop-x", name: "TOKEN", value: secretData)
        throw ContractTestError.failed("Slow helper should time out")
    } catch let error as SecretsClientError {
        guard case .timedOut = error else {
            throw ContractTestError.failed("Wrong timeout error: \(error)")
        }
        try check(!(error.errorDescription ?? "").contains("SUPER-SECRET"), "SECRET LEAK: value in timeout error")
    }
    try check(Date().timeIntervalSince(started) < 4, "Timeout should bound the wait")
}

// MARK: - Required-null encoding

private func jsonObject(_ value: some Encodable) throws -> [String: Any] {
    let data = try JSONEncoder().encode(value)
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw ContractTestError.failed("Encoded value was not a JSON object")
    }
    return object
}

private func testRequiredNullEncoding() throws {
    // Draft copilot loop: approval fingerprint/approvedAt must be explicit null.
    let draft = LoopDefinition(
        id: "draft-loop",
        name: "Draft",
        kind: .copilot,
        lifecycle: .draft,
        schedule: .manual,
        execution: .copilot(CopilotExecution(
            prompt: "p", model: "m", workingDirectory: "/w"
        )),
        createdAt: "2026-07-24T15:00:00Z",
        updatedAt: "2026-07-24T15:00:00Z"
    )
    let draftObject = try jsonObject(draft)
    let approval = draftObject["approval"] as? [String: Any]
    try check(approval?.keys.contains("fingerprint") ?? false, "approval.fingerprint key must exist")
    try check(approval?["fingerprint"] is NSNull, "approval.fingerprint must be null")
    try check(approval?["approvedAt"] is NSNull, "approval.approvedAt must be null")

    // Executable loop: executableHash must be explicit null when nil.
    let executable = LoopDefinition(
        id: "exec-loop",
        name: "Exec",
        kind: .script,
        lifecycle: .draft,
        schedule: .manual,
        execution: .executable(ExecutableExecution(
            path: "/bin/tool", workingDirectory: "/w"
        )),
        createdAt: "2026-07-24T15:00:00Z",
        updatedAt: "2026-07-24T15:00:00Z"
    )
    let execObject = try jsonObject(executable)
    let execution = execObject["execution"] as? [String: Any]
    try check(execution?["type"] as? String == "executable", "execution.type mismatch")
    try check(execution?.keys.contains("executableHash") ?? false, "executableHash key must exist")
    try check(execution?["executableHash"] is NSNull, "executableHash must be null")

    // Run with nils: all schema-required nullable keys must be explicit null.
    let run = RunRecord(
        id: "run-x",
        loopId: "draft-loop",
        sessionId: "33333333-3333-4333-8333-333333333333",
        trigger: .manual,
        status: .starting,
        attempts: [RunAttempt(number: 1, startedAt: "2026-07-24T15:00:00Z")]
    )
    let runObject = try jsonObject(run)
    for key in ["scheduledFor", "startedAt", "endedAt", "exitCode", "signal", "retryOf"] {
        try check(runObject.keys.contains(key), "run.\(key) key must exist")
        try check(runObject[key] is NSNull, "run.\(key) must be null")
    }
    let attempt = (runObject["attempts"] as? [[String: Any]])?.first
    try check(attempt?["endedAt"] is NSNull, "attempt.endedAt must be null")
    try check(attempt?["exitCode"] is NSNull, "attempt.exitCode must be null")
    try check(attempt?["signal"] is NSNull, "attempt.signal must be null")

    // Round-trip preservation after explicit-null encoding.
    let decoder = JSONDecoder()
    let draftRoundTrip = try decoder.decode(LoopDefinition.self, from: JSONEncoder().encode(draft))
    try check(draftRoundTrip == draft, "Draft round-trip mismatch")
    let execRoundTrip = try decoder.decode(LoopDefinition.self, from: JSONEncoder().encode(executable))
    try check(execRoundTrip == executable, "Executable round-trip mismatch")
    let runRoundTrip = try decoder.decode(RunRecord.self, from: JSONEncoder().encode(run))
    try check(runRoundTrip == run, "Run round-trip mismatch")
}

// MARK: - Thread-safe test helpers

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func increment() { lock.lock(); count += 1; lock.unlock() }
    var value: Int { lock.lock(); defer { lock.unlock() }; return count }
}

private final class BatchSink: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [[String]] = []
    func append(_ paths: [String]) { lock.lock(); storage.append(paths); lock.unlock() }
    var batches: [[String]] { lock.lock(); defer { lock.unlock() }; return storage }
}

private final class DataSink: @unchecked Sendable {
    private let lock = NSLock()
    private var storage = Data()
    func append(_ data: Data) { lock.lock(); storage.append(data); lock.unlock() }
    var text: String { lock.lock(); defer { lock.unlock() }; return String(data: storage, encoding: .utf8) ?? "" }
}

private func testModelBuilders() throws {
    // Builders/previews construct models via public memberwise initializers.
    let copilot = LoopDefinition(
        id: "built-loop",
        name: "Built loop",
        kind: .copilot,
        lifecycle: .draft,
        schedule: .calendar(hour: 2, minute: 30, weekdays: [1, 3, 5], graceSeconds: 300),
        execution: .copilot(CopilotExecution(
            prompt: "Do the thing",
            model: "gpt-5.6-sol",
            workingDirectory: "/work"
        )),
        createdAt: "2026-07-24T15:00:00Z",
        updatedAt: "2026-07-24T15:00:00Z"
    )
    try check(copilot.overlapPolicy == "skip", "Default overlapPolicy should be skip")
    try check(copilot.timeoutSeconds == 1800, "Default timeout mismatch")
    try check(copilot.permissions == PermissionConfig(), "Default permissions mismatch")
    try check(copilot.retention == RetentionPolicy(days: 30, maxRuns: 100), "Default retention mismatch")

    let script = LoopDefinition(
        id: "built-script",
        name: "Built script",
        kind: .script,
        lifecycle: .needsReview,
        schedule: .interval(seconds: 3600, graceSeconds: 60),
        execution: .scriptFile(ScriptFileExecution(
            path: "/bin/do.sh",
            workingDirectory: "/work",
            arguments: ["--flag"],
            contentHash: String(repeating: "a", count: 64)
        )),
        environment: EnvironmentConfig(plain: ["K": "V"], secretNames: ["TOKEN"]),
        createdAt: "2026-07-24T15:00:00Z",
        updatedAt: "2026-07-24T15:00:00Z"
    )

    let run = RunRecord(
        id: "run-1",
        loopId: "built-loop",
        sessionId: "22222222-2222-4222-8222-222222222222",
        trigger: .manual,
        status: .running,
        attempts: [RunAttempt(number: 1, startedAt: "2026-07-24T15:00:02Z")]
    )
    try check(run.schemaVersion == 1, "Default run schemaVersion mismatch")
    try check(run.attempts.first?.endedAt == nil, "RunAttempt endedAt default mismatch")

    // Round-trip the built values through the contract encoder/decoder.
    let decoder = JSONDecoder()
    for definition in [copilot, script] {
        let data = try JSONEncoder().encode(definition)
        let redecoded = try decoder.decode(LoopDefinition.self, from: data)
        try check(redecoded == definition, "Built LoopDefinition round-trip mismatch")
    }
    let runData = try JSONEncoder().encode(run)
    let runRedecoded = try decoder.decode(RunRecord.self, from: runData)
    try check(runRedecoded == run, "Built RunRecord round-trip mismatch")
}

// MARK: - Manager window layout

/// Measures rendered text width with the real macOS system font. CoreText
/// metrics do not need a window server, so this is safe in headless runs.
private func measuredWidth(_ text: String, pointSize: CGFloat, weight: NSFont.Weight) -> CGFloat {
    let font = NSFont.systemFont(ofSize: pointSize, weight: weight)
    return (text as NSString).size(withAttributes: [.font: font]).width
}

private func widestStatusLabel(pointSize: CGFloat, weight: NSFont.Weight) -> (String, CGFloat) {
    RunStatus.allCases.reduce(("", CGFloat(0))) { widest, status in
        let width = measuredWidth(status.displayName, pointSize: pointSize, weight: weight)
        return width > widest.1 ? (status.displayName, width) : widest
    }
}

/// Regression guard for the sidebar-clipping defect: a destination whose
/// minimum width exceeded what the window could offer made SwiftUI lay the
/// whole `NavigationSplitView` out oversized and center it, pushing the
/// sidebar's leading icons and labels outside the window.
///
/// The invariant is deliberately non-circular. `detailMinWidth` is the maximum
/// of the real destination requirements and `windowMinContentWidth` is an
/// independently declared budget, so growing any destination past the budget
/// makes this fail.
private func testManagerLayout() throws {
    let violations = ManagerLayoutContract.violations()
    try check(
        violations.isEmpty,
        "Manager layout contract violated:\n" + violations.map { "  - \($0)" }.joined(separator: "\n")
    )

    // Headline invariant, restated independently of the shared helper.
    let widestDestination = ManagerLayout.detailRequirements.reduce(0) { max($0, $1.minWidth) }
    try check(
        widestDestination == ManagerLayout.detailMinWidth,
        "detailMinWidth (\(ManagerLayout.detailMinWidth)) is not the maximum destination requirement (\(widestDestination))"
    )
    try check(
        ManagerLayout.sidebarMinWidth + ManagerLayout.splitDividerWidth + widestDestination
            <= ManagerLayout.windowMinContentWidth,
        "Sidebar \(ManagerLayout.sidebarMinWidth) + divider + widest destination \(widestDestination) exceeds the \(ManagerLayout.windowMinContentWidth)pt window budget"
    )
    try check(
        ManagerLayout.effectiveWindowMinContentWidth
            == ManagerLayout.sidebarMinWidth + ManagerLayout.splitDividerWidth + ManagerLayout.detailMinWidth,
        "Effective window minimum is not the sum of the sidebar, divider, and detail minimums"
    )

    // History is the widest destination and the one that exposed the bug.
    try check(
        ManagerLayout.minimumDetailWidth(for: .history) == HistoryLayout.minDetailWidth,
        "History minimum detail width is not sourced from HistoryLayout"
    )
    try check(
        HistoryLayout.inspectorMinWidth <= HistoryLayout.inspectorIdealWidth
            && HistoryLayout.inspectorIdealWidth <= HistoryLayout.inspectorMaxWidth,
        "History inspector min/ideal/max widths are out of order"
    )
    try check(
        HistoryLayout.runListMinWidth > HistoryLayout.runTableMinWidth,
        "History run list must reserve card padding around its table columns"
    )

    // Five gaps between the filter bar's six subviews, not four.
    try check(
        HistoryLayout.filterSubviewCount == 6,
        "Filter bar subview count changed; update filtersMinWidth expectations"
    )
    let expectedFiltersMinWidth =
        HistoryLayout.searchFieldMinWidth
        + HistoryLayout.loopFilterMinWidth
        + HistoryLayout.statusFilterMinWidth
        + HistoryLayout.dateFilterMinWidth
        + HistoryLayout.filterSpacing * 5
        + HistoryLayout.filterTrailingGap
        + ManagerLayout.cardPadding * 2
    try check(
        HistoryLayout.filtersMinWidth == expectedFiltersMinWidth,
        "filtersMinWidth \(HistoryLayout.filtersMinWidth) does not account for five inter-subview gaps (expected \(expectedFiltersMinWidth))"
    )

    // Four gaps between the run row's five fixed columns.
    let expectedRunTableMinWidth =
        HistoryLayout.statusColumnWidth
        + HistoryLayout.loopColumnMinWidth
        + HistoryLayout.startedColumnWidth
        + HistoryLayout.durationColumnWidth
        + HistoryLayout.artifactsColumnWidth
        + HistoryLayout.columnSpacing * 4
        + HistoryLayout.rowHorizontalPadding * 2
    try check(
        HistoryLayout.runTableMinWidth == expectedRunTableMinWidth,
        "runTableMinWidth \(HistoryLayout.runTableMinWidth) does not account for four inter-column gaps (expected \(expectedRunTableMinWidth))"
    )

    // Every real status label must render on one line inside the status column.
    let widestPillLabel = widestStatusLabel(pointSize: ManagerLayout.captionPointSize, weight: .medium)
    try check(
        widestPillLabel.1 <= HistoryLayout.statusPillTextBudget,
        "Status pill text budget is \(HistoryLayout.statusPillTextBudget)pt but \"\(widestPillLabel.0)\" measures \(widestPillLabel.1)pt at \(ManagerLayout.captionPointSize)pt medium; widen statusColumnWidth"
    )

    // The status filter popup must show its longest selected value in full.
    let widestFilterLabel = widestStatusLabel(pointSize: ManagerLayout.bodyPointSize, weight: .regular)
    try check(
        widestFilterLabel.1 <= HistoryLayout.statusFilterValueBudget,
        "Status filter value budget is \(HistoryLayout.statusFilterValueBudget)pt but \"\(widestFilterLabel.0)\" measures \(widestFilterLabel.1)pt at \(ManagerLayout.bodyPointSize)pt"
    )
    try check(
        HistoryLayout.statusFilterMinWidth
            >= measuredWidth("Status", pointSize: ManagerLayout.bodyPointSize, weight: .regular)
                + HistoryLayout.pickerLabelGap
                + widestFilterLabel.1
                + HistoryLayout.pickerPopupChrome,
        "statusFilterMinWidth \(HistoryLayout.statusFilterMinWidth)pt cannot fit the \"Status\" label plus \"\(widestFilterLabel.0)\""
    )
    try check(
        HistoryLayout.statusFilterMaxWidth >= HistoryLayout.statusFilterMinWidth,
        "statusFilterMaxWidth is below statusFilterMinWidth"
    )
    try check(
        HistoryLayout.dateFilterMinWidth
            >= measuredWidth("Date", pointSize: ManagerLayout.bodyPointSize, weight: .regular)
                + HistoryLayout.pickerLabelGap
                + measuredWidth("Any date", pointSize: ManagerLayout.bodyPointSize, weight: .regular)
                + HistoryLayout.pickerPopupChrome,
        "dateFilterMinWidth \(HistoryLayout.dateFilterMinWidth)pt cannot fit \"Date\" plus \"Any date\""
    )
}

@main
struct CopilotLoopsContractTests {
    static func main() async throws {
        try testFixtureContracts()
        try testModelBuilders()
        try testManagerLayout()
        try testRequiredNullEncoding()
        try testControlPlaneDecoding()
        try testErrorEnvelopes()
        try await testMockClientFlow()
        try testProjections()
        try testHealthAndApproval()
        try testNavigation()
        try testRuntimeResolver()
        try testIdentityProfile()
        try testRelativeStateRootRejected()
        try testAbsolutePathContract()
        try testRuntimeBreadcrumb()
        try testDebouncer()
        try testRootWatcherBatching()
        try testRootWatcherPathFilter()
        try testRootWatcherCreatesRoot()
        try testLogTailerRotation()
        try await testLogTailerRotationStress()
        try await testLogTailerArmsBeforeInitialRead()
        try await testLogTailerBoundedBootstrap()
        try testLogTailerDescriptorConsistency()
        try await testLargePipeOutput()
        try await testProcessRunnerTimeoutKill()
        try await testProcessRunnerTimeoutInheritedPipe()
        try await testProcessRunnerStdinChildExitsEarly()
        try await testProcessRunnerTimeoutLeaderExitsDescendantSurvives()
        try await testProcessRunnerNormalExitBackgroundDescendant()
        try await testProcessRunnerClosedStandardDescriptors()
        try await testProcessRunnerRelocationFailureFailsSafely()
        try await testProcessRunnerEscapedGroupStdinNonReader()
        try await testSecretsClient()

        print("Copilot Loops Swift contract tests passed")
    }
}
