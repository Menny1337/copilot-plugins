import LoopsModels

enum LoopsPreviewData {
    static let timestamp = "2026-07-24T15:00:00Z"
    static let approvedFingerprint = String(repeating: "a", count: 64)

    static let dependencyLoop = LoopDefinition(
        id: "nightly-dependency-report",
        name: "Nightly dependency report",
        kind: .copilot,
        lifecycle: .enabled,
        schedule: .calendar(hour: 1, minute: 0, weekdays: [], graceSeconds: 300),
        execution: .copilot(
            CopilotExecution(
                prompt: "Review dependency manifests and write a concise markdown report.",
                model: "gpt-5.6-sol",
                workingDirectory: "/Users/USERNAME/Repos/web-app",
                installedPlugin: "core-agents",
                agent: "core-agents:researcher",
                skill: "research-methodology"
            )
        ),
        permissions: PermissionConfig(profile: .fullAutonomy, allowAll: true),
        environment: EnvironmentConfig(secretNames: ["REPORT_TOKEN"]),
        approval: Approval(fingerprint: approvedFingerprint, approvedAt: timestamp),
        createdAt: timestamp,
        updatedAt: timestamp
    )

    static let maintenanceLoop = LoopDefinition(
        id: "repository-maintenance",
        name: "Repository maintenance",
        kind: .script,
        lifecycle: .enabled,
        schedule: .calendar(hour: 2, minute: 30, weekdays: [1, 2, 3, 4, 5], graceSeconds: 300),
        execution: .executable(
            ExecutableExecution(
                path: "/usr/bin/git",
                workingDirectory: "/Users/USERNAME/Repos/web-app",
                arguments: ["status", "--short"],
                executableHash: approvedFingerprint
            )
        ),
        approval: Approval(fingerprint: approvedFingerprint, approvedAt: timestamp),
        createdAt: timestamp,
        updatedAt: timestamp
    )

    static let draftLoop = LoopDefinition(
        id: "weekly-release-notes",
        name: "Weekly release notes",
        kind: .copilot,
        lifecycle: .needsReview,
        schedule: .calendar(hour: 9, minute: 0, weekdays: [5], graceSeconds: 300),
        execution: .copilot(
            CopilotExecution(
                prompt: "Summarize this week's merged changes for the release notes.",
                model: "gpt-5.6-sol",
                workingDirectory: "/Users/USERNAME/Repos/web-app"
            )
        ),
        permissions: PermissionConfig(profile: .fullAutonomy, allowAll: true),
        createdAt: timestamp,
        updatedAt: timestamp
    )

    static let successfulRun = RunRecord(
        id: "run-20260724-010000",
        loopId: dependencyLoop.id,
        sessionId: "11111111-1111-4111-8111-111111111111",
        trigger: .schedule,
        status: .succeeded,
        scheduledFor: "2026-07-24T01:00:00Z",
        startedAt: "2026-07-24T01:00:03Z",
        endedAt: "2026-07-24T01:04:18Z",
        exitCode: 0,
        attempts: [
            RunAttempt(
                number: 1,
                startedAt: "2026-07-24T01:00:03Z",
                endedAt: "2026-07-24T01:04:18Z",
                exitCode: 0
            ),
        ]
    )

    static let failedRun = RunRecord(
        id: "run-20260724-023000",
        loopId: maintenanceLoop.id,
        sessionId: "22222222-2222-4222-8222-222222222222",
        trigger: .schedule,
        status: .failed,
        scheduledFor: "2026-07-24T02:30:00Z",
        startedAt: "2026-07-24T02:30:02Z",
        endedAt: "2026-07-24T02:30:11Z",
        exitCode: 1,
        attempts: [
            RunAttempt(
                number: 1,
                startedAt: "2026-07-24T02:30:02Z",
                endedAt: "2026-07-24T02:30:11Z",
                exitCode: 1
            ),
        ]
    )

    static let runningRun = RunRecord(
        id: "run-20260724-150000",
        loopId: dependencyLoop.id,
        sessionId: "33333333-3333-4333-8333-333333333333",
        trigger: .manual,
        status: .running,
        startedAt: "2026-07-24T15:00:02Z",
        attempts: [RunAttempt(number: 1, startedAt: "2026-07-24T15:00:02Z")]
    )

    static let loopStates = [
        LoopState(
            definition: dependencyLoop,
            lastRun: runningRun,
            isRunning: true,
            nextScheduledAt: "2026-07-25T01:00:00Z",
            currentFingerprint: approvedFingerprint
        ),
        LoopState(
            definition: maintenanceLoop,
            lastRun: failedRun,
            nextScheduledAt: "2026-07-25T02:30:00Z",
            currentFingerprint: approvedFingerprint
        ),
        LoopState(
            definition: draftLoop,
            currentFingerprint: approvedFingerprint
        ),
    ]

    static let recentRuns = [runningRun, failedRun, successfulRun]
}
