import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createLoop, purgeLoop, updateLoop } from "../commands/crud.mjs";
import { approveLoopCmd, preflightLoop, retryLoop, runNow, stopLoop } from "../commands/lifecycle.mjs";
import { buildPreflightReport } from "../lib/control-preflight.mjs";
import { loopDirectory } from "../lib/paths.mjs";
import { createRun } from "../lib/run-state.mjs";
import {
  buildScriptLoop,
  cleanupScratch,
  cleanupScratchRoot,
  setupCliEnv,
  writeExecutable,
} from "./cli-control-helpers.mjs";
import { copilotLoopFixture } from "./runtime-helpers.mjs";

test.after(cleanupScratchRoot);

async function createReviewableLoop(label, id) {
  const fixture = await setupCliEnv(label);
  const workingDirectory = path.join(fixture.home, "repo");
  const scriptPath = path.join(fixture.binDir, `${id}.sh`);
  await fsp.mkdir(workingDirectory, { recursive: true });
  await writeExecutable(scriptPath, "#!/bin/sh\nexit 0\n");
  const input = buildScriptLoop({ id, scriptPath, workingDirectory });
  delete input.createdAt;
  delete input.updatedAt;
  const created = await createLoop({ loop: input }, { env: fixture.env });
  return { ...fixture, workingDirectory, scriptPath, created: created.loop };
}

async function approveCreatedLoop(fixture) {
  const report = await preflightLoop({ id: fixture.created.id }, { env: fixture.env });
  const approved = await approveLoopCmd(
    { id: fixture.created.id, expectedFingerprint: report.fingerprint },
    { env: fixture.env },
  );
  return approved.loop;
}

test("whole-command locking prevents a stale approval from overwriting a newer capability edit", async () => {
  const fixture = await createReviewableLoop("stale-approval-race", "stale-approval-race");
  try {
    const report = await preflightLoop({ id: fixture.created.id }, { env: fixture.env });
    let releaseApproval;
    let approvalLocked;
    const approvalLockReached = new Promise((resolve) => {
      approvalLocked = resolve;
    });
    const approvalGate = new Promise((resolve) => {
      releaseApproval = resolve;
    });

    const approvalPromise = approveLoopCmd(
      { id: fixture.created.id, expectedFingerprint: report.fingerprint },
      {
        env: fixture.env,
        onMutationLockAcquired: async () => {
          approvalLocked();
          await approvalGate;
        },
      },
    );
    await approvalLockReached;

    const edited = structuredClone(fixture.created);
    edited.permissions.allowTools = ["bash"];
    let updateSettled = false;
    const updatePromise = updateLoop({ loop: edited }, { env: fixture.env })
      .finally(() => {
        updateSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(updateSettled, false, "capability update must wait for the approval transaction");

    releaseApproval();
    await approvalPromise;
    const updated = await updatePromise;
    assert.equal(updated.loop.lifecycle, "needsReview");
    assert.deepEqual(updated.loop.permissions.allowTools, ["bash"]);
    assert.equal(
      fs.existsSync(path.join(loopDirectory(fixture.created.id, fixture.env), "approval.blocked")),
      true,
    );
  } finally {
    cleanupScratch(fixture.home);
  }
});

test("manual dispatch failure contains a request that cannot be deleted and surfaces both errors", async () => {
  const fixture = await createReviewableLoop("manual-dispatch-cleanup", "manual-dispatch-cleanup");
  try {
    await approveCreatedLoop(fixture);
    const containmentCalls = [];
    await assert.rejects(
      () => runNow(
        { id: fixture.created.id },
        {
          env: fixture.env,
          ensureLoopServiceLoaded: async () => ({ loaded: true }),
          kickstartTaskLaunchAgent: async () => {
            throw new Error("kickstart failed");
          },
          removeManualRequest: async () => {
            throw new Error("unlink failed");
          },
          disableTaskLaunchAgent: async () => {
            containmentCalls.push("disable");
          },
          isTaskLoaded: async () => ({ loaded: true, code: 0 }),
          bootoutTaskLaunchAgent: async () => {
            containmentCalls.push("bootout");
          },
        },
      ),
      (error) => {
        assert.equal(error.name, "UserError");
        assert.match(error.message, /kickstart failed/);
        assert.match(error.message, /unlink failed/);
        assert.equal(error.context.cause, "kickstart failed");
        assert.equal(error.context.manualRequestCleanup, "unlink failed");
        assert.deepEqual(error.context.containment, {
          manualRequest: "neutralized",
          disable: "succeeded",
          loaded: true,
          bootout: "succeeded",
        });
        return true;
      },
    );
    assert.deepEqual(containmentCalls, ["disable", "bootout"]);
    const pendingPath = path.join(loopDirectory(fixture.created.id, fixture.env), "manual-request.json");
    assert.equal(fs.existsSync(pendingPath), true);
    assert.deepEqual(JSON.parse(await fsp.readFile(pendingPath, "utf8")), {});
  } finally {
    cleanupScratch(fixture.home);
  }
});

test("stop reports an observation failure when launchd is not loaded", async () => {
  const fixture = await createReviewableLoop("stop-observation", "stop-observation");
  try {
    await assert.rejects(
      () => stopLoop(
        { id: fixture.created.id },
        {
          env: fixture.env,
          listLoopStatesResponse: async () => {
            throw new Error("state unreadable");
          },
          isTaskLoaded: async () => ({ loaded: false, code: 113 }),
        },
      ),
      (error) => {
        assert.equal(error.name, "UserError");
        assert.match(error.message, /Unable to determine/);
        assert.equal(error.context.cause, "state unreadable");
        return true;
      },
    );
  } finally {
    cleanupScratch(fixture.home);
  }
});

test("purge rejects an active loop before launchd, secret, or data deletion", async () => {
  const fixture = await createReviewableLoop("purge-active", "purge-active");
  try {
    const loopDir = loopDirectory(fixture.created.id, fixture.env);
    await fsp.writeFile(path.join(loopDir, "state.json"), JSON.stringify({
      schemaVersion: 1,
      loopId: fixture.created.id,
      schedule: { consumedAt: null, lastScheduledAt: null, nextExpectedAt: null },
      active: { currentRunId: "run-20260725205547", stage: "running", pid: process.pid },
      lastRun: null,
      updatedAt: "2026-07-25T20:55:47.000Z",
    }, null, 2) + "\n");
    const activeLock = path.join(loopDir, "active.lock");
    await fsp.mkdir(activeLock);
    await fsp.writeFile(path.join(activeLock, "pid"), `${process.pid}\n`);
    let launchdTouched = false;
    let secretsTouched = false;

    await assert.rejects(
      () => purgeLoop(
        { id: fixture.created.id, confirm: true },
        {
          env: fixture.env,
          removeTaskLaunchAgent: async () => {
            launchdTouched = true;
          },
          runtimeContext: async () => {
            secretsTouched = true;
            return {};
          },
        },
      ),
      (error) => {
        assert.equal(error.name, "UserError");
        assert.match(error.message, /stop it first/);
        assert.equal(error.context.currentRunId, "run-20260725205547");
        return true;
      },
    );
    assert.equal(launchdTouched, false);
    assert.equal(secretsTouched, false);
    assert.equal(fs.existsSync(loopDir), true);
  } finally {
    cleanupScratch(fixture.home);
  }
});

test("retry rejects unsafe, unknown, and cross-loop run IDs before dispatch", async () => {
  const fixture = await createReviewableLoop("retry-validation", "retry-validation");
  try {
    await approveCreatedLoop(fixture);
    for (const [runId, expected] of [
      ["../run-20260725205547", /must match run-YYYYMMDDHHMMSS/],
      ["/run-20260725205547", /must match run-YYYYMMDDHHMMSS/],
      ["run-\0bad", /must not contain NUL bytes/],
      ["unknown", /must match run-YYYYMMDDHHMMSS/],
    ]) {
      await assert.rejects(
        () => retryLoop({ id: fixture.created.id, runId }, { env: fixture.env }),
        expected,
      );
    }

    await assert.rejects(
      () => retryLoop(
        { id: fixture.created.id, runId: "run-20260725205547" },
        { env: fixture.env },
      ),
      /prior run for the same loop/,
    );

    const other = createRun({
      loopId: "another-loop",
      trigger: "manual",
      env: fixture.env,
      now: new Date("2026-07-25T20:55:48Z"),
    });
    await assert.rejects(
      () => retryLoop({ id: fixture.created.id, runId: other.id }, { env: fixture.env }),
      /prior run for the same loop/,
    );
  } finally {
    cleanupScratch(fixture.home);
  }
});

test("manual agents warn when unconfirmed, while disabled agents and missing skills block", async () => {
  const fixture = await setupCliEnv("manual-agent-preflight");
  try {
    const workingDirectory = path.join(fixture.home, "repo");
    const copilotPath = path.join(fixture.binDir, "copilot");
    await fsp.mkdir(workingDirectory, { recursive: true });
    await writeExecutable(copilotPath, "#!/bin/sh\nexit 0\n");
    const env = {
      ...fixture.env,
      PATH: `${fixture.binDir}${path.delimiter}${fixture.env.PATH ?? ""}`,
    };
    const base = copilotLoopFixture({
      id: "manual-agent-preflight",
      execution: {
        ...copilotLoopFixture().execution,
        workingDirectory,
        installedPlugin: null,
        agent: "manually-typed-agent",
        skill: null,
        localPluginDirectories: [],
        extraPaths: [],
      },
      environment: { plain: {}, secretNames: [] },
    });
    const runtimeOptions = {
      env,
      getInventory: async () => ({ plugins: [], agents: [], skills: [], errors: [] }),
    };

    const unknown = await buildPreflightReport(base, runtimeOptions);
    assert.equal(unknown.errorDetails.some((entry) => entry.code === "agent-missing"), false);
    assert.equal(unknown.warningDetails.some((entry) => entry.code === "agent-missing"), true);

    const disabled = await buildPreflightReport(base, {
      ...runtimeOptions,
      getInventory: async () => ({
        plugins: [],
        agents: [{ name: "manually-typed-agent", enabled: false }],
        skills: [],
        errors: [],
      }),
    });
    assert.equal(disabled.errorDetails.some((entry) => entry.code === "agent-disabled"), true);

    const missingSkillLoop = structuredClone(base);
    missingSkillLoop.execution.agent = null;
    missingSkillLoop.execution.skill = "missing-skill";
    const missingSkill = await buildPreflightReport(missingSkillLoop, runtimeOptions);
    assert.equal(missingSkill.errorDetails.some((entry) => entry.code === "skill-missing"), true);
  } finally {
    cleanupScratch(fixture.home);
  }
});
