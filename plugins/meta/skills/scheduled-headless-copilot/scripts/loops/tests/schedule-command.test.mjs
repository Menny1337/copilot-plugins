import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runLoop } from "../../loops-runner.mjs";
import { desiredLaunchdState, reconcileLoopSchedule } from "../commands/schedule.mjs";
import { capabilityFingerprint } from "../lib/contracts.mjs";
import { readRun, readScheduleState, runPaths } from "../lib/run-state.mjs";
import { cleanupScratch, cleanupScratchRoot, execPathHash, makeScratchEnv, scriptLoopFixture } from "./runtime-helpers.mjs";

test.after(cleanupScratchRoot);

const baseLoop = {
  schemaVersion: 1,
  id: "nightly-report",
  name: "Nightly report",
  kind: "copilot",
  lifecycle: "enabled",
  schedule: {
    kind: "calendar",
    hour: 3,
    minute: 15,
    weekdays: [1, 5],
    graceSeconds: 300,
  },
  execution: {
    type: "copilot",
    prompt: "Review & report",
    model: "gpt-5.6-sol",
    workingDirectory: "/Users/USERNAME/Repos/reporting",
    extraPaths: [],
    localPluginDirectories: [],
  },
  permissions: {
    profile: "fullAutonomy",
    allowAll: true,
    allowTools: [],
    denyTools: [],
    allowUrls: [],
    denyUrls: [],
  },
  environment: {
    plain: {},
    secretNames: [],
  },
  timeoutSeconds: 1800,
  retry: {
    maxRetries: 0,
    backoffSeconds: 60,
  },
  overlapPolicy: "skip",
  notifications: {
    onFailure: true,
    onSuccess: false,
  },
  retention: {
    days: 30,
    maxRuns: 100,
  },
  approval: {
    fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    approvedAt: "2026-07-24T15:05:00Z",
  },
  createdAt: "2026-07-24T15:00:00Z",
  updatedAt: "2026-07-24T15:00:00Z",
};

function approvedExecutableLoop(env, overrides = {}) {
  const placeholderApproval = { fingerprint: "0".repeat(64), approvedAt: "2026-07-24T15:05:00Z" };
  const draft = scriptLoopFixture({
    lifecycle: "enabled",
    execution: {
      type: "executable",
      path: process.execPath,
      arguments: [],
      workingDirectory: process.cwd(),
      executableHash: execPathHash(),
    },
    approval: placeholderApproval,
    ...overrides,
  });
  return {
    ...draft,
    approval: {
      fingerprint: capabilityFingerprint(draft),
      approvedAt: placeholderApproval.approvedAt,
    },
  };
}

function fakeScript(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

test("desiredLaunchdState keeps paused loops loaded and archives removed", () => {
  assert.equal(desiredLaunchdState({ ...baseLoop, lifecycle: "paused" }), "loaded");
  assert.equal(desiredLaunchdState({ ...baseLoop, lifecycle: "archived" }), "archived");
  assert.equal(desiredLaunchdState({ ...baseLoop, lifecycle: "ready" }), "booted-out");
});

test("reconcileLoopSchedule keeps paused loops enabled without disabling them", async () => {
  const calls = [];
  const result = await reconcileLoopSchedule(
    { ...baseLoop, lifecycle: "paused" },
    {
      isTaskLoaded: async () => ({ loaded: true }),
      writeTaskLaunchAgent: async () => ({
        changed: false,
        plistPath: "/Users/USERNAME/Library/LaunchAgents/com.copilotplugins.copilot-loops.task.nightly-report.plist",
        hashPath: "/Users/USERNAME/.copilot/scheduled-tasks/copilot-loops/tasks/nightly-report/generated.plist.sha256",
        label: "com.copilotplugins.copilot-loops.task.nightly-report",
        programArguments: ["/opt/homebrew/bin/node", "/Users/USERNAME/runtime/loops-runner.mjs", "nightly-report"],
        launchPath: "/opt/homebrew/bin:/usr/bin:/bin",
      }),
      enableTaskLaunchAgent: async () => {
        calls.push("enable");
      },
      bootstrapTaskLaunchAgent: async () => {
        calls.push("bootstrap");
      },
      bootoutTaskLaunchAgent: async () => {
        calls.push("bootout");
      },
    },
  );

  assert.equal(result.desired, "loaded");
  assert.equal(result.reloaded, false);
  assert.deepEqual(calls, ["enable"]);
});

test("reconcileLoopSchedule enables before bootstrapping when reload is required", async () => {
  const calls = [];
  const result = await reconcileLoopSchedule(
    { ...baseLoop, lifecycle: "paused" },
    {
      isTaskLoaded: async () => ({ loaded: false }),
      writeTaskLaunchAgent: async () => ({
        changed: true,
        plistPath: "/Users/USERNAME/Library/LaunchAgents/com.copilotplugins.copilot-loops.task.nightly-report.plist",
        hashPath: "/Users/USERNAME/.copilot/scheduled-tasks/copilot-loops/tasks/nightly-report/generated.plist.sha256",
        label: "com.copilotplugins.copilot-loops.task.nightly-report",
        programArguments: ["/opt/homebrew/bin/node", "/Users/USERNAME/runtime/loops-runner.mjs", "nightly-report"],
        launchPath: "/opt/homebrew/bin:/usr/bin:/bin",
      }),
      enableTaskLaunchAgent: async () => {
        calls.push("enable");
      },
      bootstrapTaskLaunchAgent: async () => {
        calls.push("bootstrap");
      },
    },
  );

  assert.equal(result.reloaded, true);
  assert.deepEqual(calls, ["enable", "bootstrap"]);
});

test("reconcileLoopSchedule archives by removing managed files without rewriting", async () => {
  const calls = [];
  const result = await reconcileLoopSchedule(
    { ...baseLoop, lifecycle: "archived" },
    {
      removeTaskLaunchAgent: async () => {
        calls.push("remove");
        return {
          plistPath: "/Users/USERNAME/Library/LaunchAgents/com.copilotplugins.copilot-loops.task.nightly-report.plist",
          hashPath: "/Users/USERNAME/.copilot/scheduled-tasks/copilot-loops/tasks/nightly-report/generated.plist.sha256",
        };
      },
      writeTaskLaunchAgent: async () => {
        throw new Error("writeTaskLaunchAgent must not be called for archived loops");
      },
    },
  );

  assert.equal(result.removed, true);
  assert.deepEqual(calls, ["remove"]);
});

test("reconcileLoopSchedule seeds an interval baseline so the very first launchd interval fire runs immediately", async () => {
  const { env } = makeScratchEnv("schedule-first-interval-fire");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      id: "first-interval-fire",
      schedule: { kind: "interval", seconds: 60, graceSeconds: 30 },
      execution: {
        type: "executable",
        path: process.execPath,
        arguments: [script],
        workingDirectory: process.cwd(),
        executableHash: execPathHash(),
      },
    });
    const t0 = new Date("2026-07-24T15:00:00Z");
    const t1 = new Date("2026-07-24T15:01:00Z");
    const calls = [];

    const reconcile = await reconcileLoopSchedule(loop, {
      env,
      now: () => t0,
      isTaskLoaded: async () => ({ loaded: false }),
      writeTaskLaunchAgent: async () => ({
        changed: true,
        plistPath: path.join(env.COPILOT_LOOPS_HOME, "LaunchAgents", `${loop.id}.plist`),
        hashPath: path.join(env.COPILOT_LOOPS_HOME, "tasks", loop.id, "generated.plist.sha256"),
        label: `com.copilotplugins.copilot-loops.task.${loop.id}`,
        programArguments: [process.execPath, "loops-runner.mjs", loop.id],
        launchPath: "/opt/homebrew/bin:/usr/bin:/bin",
      }),
      enableTaskLaunchAgent: async () => {
        calls.push("enable");
      },
      bootstrapTaskLaunchAgent: async () => {
        calls.push("bootstrap");
      },
    });

    assert.equal(reconcile.reloaded, true);
    assert.deepEqual(calls, ["enable", "bootstrap"]);
    assert.deepEqual(readScheduleState(loop.id, env), {
      consumedAt: null,
      lastScheduledAt: null,
      nextExpectedAt: "2026-07-24T15:01:00.000Z",
    });

    const result = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => t1,
    });
    assert.equal(result.status, "succeeded");
    const record = readRun(runPaths(loop.id, result.runId, env));
    assert.equal(record.trigger, "schedule");
    assert.equal(record.scheduledFor, "2026-07-24T15:01:00.000Z");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("reconcileLoopSchedule resets an interval baseline when a loaded loop is reloaded after a schedule change", async () => {
  const { env } = makeScratchEnv("schedule-interval-reset");
  try {
    const loop = approvedExecutableLoop(env, {
      id: "interval-reset",
      schedule: { kind: "interval", seconds: 120, graceSeconds: 30 },
    });
    const statePath = path.join(env.COPILOT_LOOPS_HOME, "tasks", loop.id);
    fs.mkdirSync(statePath, { recursive: true });
    fs.writeFileSync(path.join(statePath, "state.json"), JSON.stringify({
      schemaVersion: 1,
      loopId: loop.id,
      schedule: {
        consumedAt: null,
        lastScheduledAt: "2026-07-24T14:58:00.000Z",
        nextExpectedAt: "2026-07-24T15:00:00.000Z",
      },
      active: null,
      lastRun: null,
      updatedAt: "2026-07-24T14:58:00.000Z",
    }, null, 2));

    await reconcileLoopSchedule(loop, {
      env,
      now: () => new Date("2026-07-24T15:00:00Z"),
      isTaskLoaded: async () => ({ loaded: true }),
      writeTaskLaunchAgent: async () => ({
        changed: true,
        plistPath: path.join(env.COPILOT_LOOPS_HOME, "LaunchAgents", `${loop.id}.plist`),
        hashPath: path.join(env.COPILOT_LOOPS_HOME, "tasks", loop.id, "generated.plist.sha256"),
        label: `com.copilotplugins.copilot-loops.task.${loop.id}`,
        programArguments: [process.execPath, "loops-runner.mjs", loop.id],
        launchPath: "/opt/homebrew/bin:/usr/bin:/bin",
      }),
      enableTaskLaunchAgent: async () => {},
      bootstrapTaskLaunchAgent: async () => {},
    });

    assert.deepEqual(readScheduleState(loop.id, env), {
      consumedAt: null,
      lastScheduledAt: null,
      nextExpectedAt: "2026-07-24T15:02:00.000Z",
    });
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("reconcileLoopSchedule restores the previous interval baseline if bootstrap fails after seeding it", async () => {
  const { env } = makeScratchEnv("schedule-interval-rollback");
  try {
    const loop = approvedExecutableLoop(env, {
      id: "interval-rollback",
      schedule: { kind: "interval", seconds: 60, graceSeconds: 30 },
    });
    const stateDir = path.join(env.COPILOT_LOOPS_HOME, "tasks", loop.id);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "state.json"), JSON.stringify({
      schemaVersion: 1,
      loopId: loop.id,
      schedule: {
        consumedAt: null,
        lastScheduledAt: null,
        nextExpectedAt: "2026-07-24T14:59:00.000Z",
      },
      active: null,
      lastRun: null,
      updatedAt: "2026-07-24T14:59:00.000Z",
    }, null, 2));

    await assert.rejects(
      () =>
        reconcileLoopSchedule(loop, {
          env,
          now: () => new Date("2026-07-24T15:00:00Z"),
          isTaskLoaded: async () => ({ loaded: false }),
          writeTaskLaunchAgent: async () => ({
            changed: true,
            plistPath: path.join(env.COPILOT_LOOPS_HOME, "LaunchAgents", `${loop.id}.plist`),
            hashPath: path.join(env.COPILOT_LOOPS_HOME, "tasks", loop.id, "generated.plist.sha256"),
            label: `com.copilotplugins.copilot-loops.task.${loop.id}`,
            programArguments: [process.execPath, "loops-runner.mjs", loop.id],
            launchPath: "/opt/homebrew/bin:/usr/bin:/bin",
          }),
          enableTaskLaunchAgent: async () => {},
          bootstrapTaskLaunchAgent: async () => {
            throw new Error("bootstrap failed");
          },
        }),
      /bootstrap failed/,
    );

    assert.deepEqual(readScheduleState(loop.id, env), {
      consumedAt: null,
      lastScheduledAt: null,
      nextExpectedAt: "2026-07-24T14:59:00.000Z",
    });
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});
