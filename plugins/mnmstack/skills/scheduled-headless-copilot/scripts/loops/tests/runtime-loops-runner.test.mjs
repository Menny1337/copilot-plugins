import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { runLoop, resolveSecretsViaHelper, resolveSecretsFromEnv } from "../../loops-runner.mjs";
import { acquireLock, isLockHeld } from "../lib/locks.mjs";
import { spawnGroup, isGroupAlive } from "../lib/process-tree.mjs";
import {
  lockDirectory,
  readRun,
  readEvents,
  runPaths,
  writeManualRequest,
  readLoopState,
  readScheduleState,
  initializeScheduleBaseline,
  manualRequestPath,
  approvalBlockedPath,
  createRun,
  beginAttempt,
  setActiveState,
  listRuns,
} from "../lib/run-state.mjs";
import { capabilityFingerprint, UUID_PATTERN } from "../lib/contracts.mjs";
import { disableTaskLaunchAgent, launchdTarget } from "../lib/launchd.mjs";
import {
  makeScratchEnv,
  makeScratchDir,
  cleanupScratch,
  cleanupScratchRoot,
  scriptLoopFixture,
  copilotLoopFixture,
  execPathHash,
  sha256File,
} from "./runtime-helpers.mjs";

test.after(cleanupScratchRoot);

function approvedLoop(fixtureFn, overrides = {}) {
  const placeholderApproval = { fingerprint: "0".repeat(64), approvedAt: "2026-07-24T15:00:00Z" };
  const draft = fixtureFn({ lifecycle: "enabled", approval: placeholderApproval, ...overrides });
  return { ...draft, approval: { fingerprint: capabilityFingerprint(draft), approvedAt: placeholderApproval.approvedAt } };
}

function approvedExecutableLoop(env, overrides = {}) {
  return approvedLoop(scriptLoopFixture, {
    execution: {
      type: "executable",
      path: process.execPath,
      arguments: [],
      workingDirectory: process.cwd(),
      executableHash: execPathHash(),
    },
    ...overrides,
  });
}

function fakeScript(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

// ── Orphaned-process-group helpers ──────────────────────────────────────────────────────
//
// The overlap hazard these cover is inherently about a process that OUTLIVES its runner, so
// these tests use a real detached process group (never a made-up pid that might get recycled
// into something real) plus deterministic DI for the teardown result.

/** A real, detached, idle process group that stays alive until it is explicitly killed. */
function spawnOrphanGroup() {
  const child = spawnGroup({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000);"],
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  return child;
}

async function killOrphanGroup(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // already gone
  }
  await waitUntil(() => !isGroupAlive(child.pid), { timeoutMs: 5000 });
}

/** A pid that is guaranteed to be dead: a child process that has already been spawned,
 * exited, and reaped. Stands in for "the runner process that owned this lock is gone". */
function deadPid() {
  return spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" }).pid;
}

/** Recreate the on-disk lock a crashed runner leaves behind: the directory still exists and
 * still names its owner, but that owner is dead — so the lock is immediately stealable. */
function writeStaleLock(loopId, env, pid) {
  const dir = lockDirectory(loopId, env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pid"), String(pid));
  return dir;
}

/** A `runGroup` stand-in that never spawns anything and records that it was called — used to
 * prove a fire spawned NO new work. Still closes the streams it was handed, exactly as the
 * real runGroup would. */
function countingRunGroup(counter) {
  return async ({ stdout, stderr }) => {
    counter.spawns += 1;
    await Promise.all([
      new Promise((resolve) => (stdout ? stdout.end(resolve) : resolve())),
      new Promise((resolve) => (stderr ? stderr.end(resolve) : resolve())),
    ]);
    return { exitCode: 0, signal: null, outcome: "exited", teardownConfirmed: true };
  };
}

// ── Happy path / retries / timeout ──────────────────────────────────────────────────────

test("runLoop: happy path succeeds on the first attempt, writes a schema-shaped run.json, and stdout.log/stderr.log (not copilot.jsonl)", async () => {
  const { env } = makeScratchEnv("runner-success");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, { execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() } });

    const result = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });

    assert.equal(result.status, "succeeded");
    assert.equal(result.exitCode, 0);
    const paths = runPaths(loop.id, result.runId, env);
    const record = readRun(paths);
    assert.equal(record.status, "succeeded");
    assert.match(record.sessionId, UUID_PATTERN);
    assert.equal(record.attempts.length, 1);
    assert.equal(record.attempts[0].exitCode, 0);
    assert.ok(fs.existsSync(paths.cliLogsDir));
    assert.ok(fs.existsSync(paths.stdoutLog), "script executions must produce stdout.log");
    assert.ok(fs.existsSync(paths.stderrLog), "script executions must produce stderr.log");
    assert.equal(fs.existsSync(paths.copilotLog), false, "copilot.jsonl is only for the copilot execution type");
    assert.equal(fs.existsSync(path.join(paths.dir, "cli-logs", "attempt-1.log")), false, "no combined attempt log");

    // The lock must be released after a completed run.
    const reacquired = acquireLock(lockDirectory(loop.id, env));
    assert.ok(reacquired);
    reacquired.release();
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: retries per manifest policy and succeeds once a later attempt exits 0", async () => {
  const { env } = makeScratchEnv("runner-retry");
  try {
    const marker = path.join(env.COPILOT_LOOPS_HOME, "attempt-marker");
    const script = fakeScript(
      env.COPILOT_LOOPS_HOME,
      "flaky.js",
      `const fs = require("fs");\nif (fs.existsSync(${JSON.stringify(marker)})) { process.exit(0); }\n` +
        `fs.writeFileSync(${JSON.stringify(marker)}, "1");\nprocess.exit(1);\n`,
    );
    const loop = approvedExecutableLoop(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
      retry: { maxRetries: 1, backoffSeconds: 0 },
    });

    const result = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });

    assert.equal(result.status, "succeeded");
    const record = readRun(runPaths(loop.id, result.runId, env));
    assert.equal(record.attempts.length, 2);
    assert.equal(record.attempts[0].exitCode, 1);
    assert.equal(record.attempts[1].exitCode, 0);
    const stages = readEvents(runPaths(loop.id, result.runId, env))
      .filter((e) => e.type === "run.stage")
      .map((e) => e.stage);
    assert.deepEqual(stages, ["preflight", "starting", "running", "retrying", "starting", "running", "finalizing", "terminal"]);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: exhausts retries and finalizes as failed with the last attempt's exit code", async () => {
  const { env } = makeScratchEnv("runner-exhausted");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "always-fails.js", "process.exit(3);\n");
    const loop = approvedExecutableLoop(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
      retry: { maxRetries: 2, backoffSeconds: 0 },
    });

    const result = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });

    assert.equal(result.status, "failed");
    assert.equal(result.exitCode, 3);
    const record = readRun(runPaths(loop.id, result.runId, env));
    assert.equal(record.attempts.length, 3); // 1 initial + 2 retries
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: a hard timeout kills the whole process group and finalizes as timedOut", async () => {
  const { env } = makeScratchEnv("runner-timeout");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "hang.js", "setInterval(() => {}, 1000);\n");
    const loop = approvedExecutableLoop(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
      timeoutSeconds: 1,
    });

    const result = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });

    assert.equal(result.status, "timedOut");
    assert.equal(result.exitCode, null);
    assert.ok(result.signal === "SIGTERM" || result.signal === "SIGKILL");
    assert.equal(result.teardownConfirmed, true, "a normal kill-confirmed timeout must report teardown as confirmed");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: never releases the run lock when a process-group teardown is NOT confirmed dead (kill-failed)", async () => {
  const { env } = makeScratchEnv("runner-teardown-unconfirmed");
  try {
    const loop = approvedExecutableLoop(env);
    // A fake runGroup standing in for "we signaled SIGKILL but never confirmed the group
    // actually died" — deterministic, no real unreapable process needed. Still closes the
    // stdout/stderr streams it was handed, exactly as the real runGroup would, so no file
    // handle is left dangling once the test's scratch directory is cleaned up.
    const fakeRunGroup = async ({ stdout, stderr }) => {
      await Promise.all([
        new Promise((resolve) => (stdout ? stdout.end(resolve) : resolve())),
        new Promise((resolve) => (stderr ? stderr.end(resolve) : resolve())),
      ]);
      return { exitCode: 0, signal: null, outcome: "exited", teardownConfirmed: false };
    };

    const result = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop, runGroup: fakeRunGroup });

    assert.equal(result.teardownConfirmed, false);
    const events = readEvents(runPaths(loop.id, result.runId, env));
    assert.ok(events.some((e) => e.type === "run.teardown.unconfirmed"));

    // The lock must still be held afterward — a second invocation must yield skippedOverlap
    // rather than being allowed to start while the previous run's teardown is unconfirmed.
    const second = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });
    assert.equal(second.status, "skippedOverlap");

    // Also verify directly at the lock-primitive level: acquireLock must fail (lock held).
    const directAttempt = acquireLock(lockDirectory(loop.id, env));
    assert.equal(directAttempt, null, "the lock directory must still be held after an unconfirmed teardown");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: a confirmed teardown (normal case) always releases the lock, allowing the next fire to proceed", async () => {
  const { env } = makeScratchEnv("runner-teardown-confirmed");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });

    const first = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });
    assert.equal(first.teardownConfirmed, true);

    const held = acquireLock(lockDirectory(loop.id, env));
    assert.ok(held, "the lock must be free again after a confirmed teardown");
    held.release();
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: a group that only dies AFTER runGroup gave up is confirmed by the bounded follow-up sweep, and the lock is released normally", async () => {
  // "Unconfirmed" must not mean "permanently wedged": the runner gets one more bounded
  // TERM→wait→KILL→confirm sweep before it gives up on a group, so a group that was merely
  // slow to die still ends the run cleanly, with no orphan marker and no held lock.
  const { env } = makeScratchEnv("runner-teardown-late-sweep");
  try {
    const loop = approvedExecutableLoop(env);
    const fakeRunGroup = async ({ stdout, stderr, onSpawn }) => {
      onSpawn?.({ pid: 987654 });
      await Promise.all([
        new Promise((resolve) => (stdout ? stdout.end(resolve) : resolve())),
        new Promise((resolve) => (stderr ? stderr.end(resolve) : resolve())),
      ]);
      return { exitCode: null, signal: "SIGKILL", outcome: "timedOut", teardownConfirmed: false };
    };

    const sweeps = [];
    const result = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env,
      loadLoop: async () => loop,
      runGroup: fakeRunGroup,
      stopGroup: async (pgid) => {
        sweeps.push(pgid);
        return "already-exited"; // it had, in fact, died in the meantime
      },
    });

    assert.deepEqual(sweeps, [987654], "the follow-up sweep must target the attempt's own process group");
    assert.equal(result.teardownConfirmed, true, "a group confirmed dead by the sweep is a confirmed teardown");
    const events = readEvents(runPaths(loop.id, result.runId, env)).map((e) => e.type);
    assert.ok(events.includes("run.teardown.swept"));
    assert.equal(events.includes("run.teardown.unconfirmed"), false);

    const state = readLoopState(loop.id, env);
    assert.equal(state.active, null, "a confirmed teardown must leave no orphan marker behind");
    const reacquired = acquireLock(lockDirectory(loop.id, env));
    assert.ok(reacquired, "the lock must be released once the group is confirmed dead");
    reacquired.release();
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: an unconfirmed teardown cannot be made stealable just by the runner exiting — the durable orphan marker blocks the next fire", async () => {
  // The lock records the RUNNER's pid, so it goes stale the instant the runner returns/exits.
  // Single-flight safety across invocations therefore cannot rest on the lock alone: the
  // durable `state.active` orphan marker is what makes the next invocation fail closed.
  const { env } = makeScratchEnv("runner-orphan-durable");
  const orphan = spawnOrphanGroup();
  try {
    const loop = approvedExecutableLoop(env);
    const refuseToKill = async () => "kill-failed"; // deterministically unkillable group
    const fakeRunGroup = async ({ stdout, stderr, onSpawn }) => {
      onSpawn?.(orphan); // a REAL, still-live detached process group
      await Promise.all([
        new Promise((resolve) => (stdout ? stdout.end(resolve) : resolve())),
        new Promise((resolve) => (stderr ? stderr.end(resolve) : resolve())),
      ]);
      return { exitCode: null, signal: "SIGKILL", outcome: "timedOut", teardownConfirmed: false };
    };

    const first = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env,
      loadLoop: async () => loop,
      runGroup: fakeRunGroup,
      stopGroup: refuseToKill,
    });
    assert.equal(first.teardownConfirmed, false);
    assert.equal(first.status, "timedOut");

    const marked = readLoopState(loop.id, env);
    assert.equal(marked.active.orphan.reason, "teardown-unconfirmed", "state.active must be retained as the durable orphan marker");
    assert.equal(marked.active.pgid, orphan.pid, "the marker must name the group that could not be confirmed dead");
    assert.equal(marked.lastRun.runId, first.runId, "the run's real outcome must still be published as lastRun");
    assert.equal(marked.lastRun.status, "timedOut");

    // Simulate the runner process exiting: its lock pid is now dead, so the lock is
    // immediately stealable — exactly the window the durable marker exists to cover.
    fs.writeFileSync(path.join(lockDirectory(loop.id, env), "pid"), String(deadPid()));
    assert.equal(isLockHeld(lockDirectory(loop.id, env)), false, "sanity: a dead-owner lock really is stealable");

    const counter = { spawns: 0 };
    const second = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env,
      loadLoop: async () => loop,
      runGroup: countingRunGroup(counter),
      stopGroup: refuseToKill,
    });

    assert.equal(second.status, "skippedOverlap", "the next fire must be skipped, not overlapped");
    assert.equal(second.orphanBlocked, true);
    assert.equal(counter.spawns, 0, "nothing new may be spawned while a group from the previous fire might still be alive");
    assert.ok(isGroupAlive(orphan.pid), "sanity: the orphan group really was still alive throughout");

    const stillMarked = readLoopState(loop.id, env);
    assert.equal(stillMarked.active.pgid, orphan.pid, "the blocked state must stay durable for the invocation after that one too");
    assert.equal(stillMarked.active.orphan.reason, "orphan-teardown-unconfirmed");
    assert.equal(readRun(runPaths(loop.id, second.runId, env)).status, "skippedOverlap", "the blocked fire must leave a visible history entry");
  } finally {
    await killOrphanGroup(orphan);
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: a crashed runner's still-live child group is terminated and its run finalized BEFORE any replacement run starts", async () => {
  const { env } = makeScratchEnv("runner-crash-orphan");
  const orphan = spawnOrphanGroup();
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });

    // Exactly what a crashed runner leaves behind: a nonterminal run, a `state.active`
    // pointer naming the still-live child group, and a lock owned by a pid that is gone.
    const crashed = createRun({ loopId: loop.id, trigger: "schedule", env, now: new Date() });
    beginAttempt(crashed.paths, { number: 1 });
    setActiveState(
      loop.id,
      { currentRunId: crashed.id, sessionId: crashed.record.sessionId, stage: "running", attempt: 1, pid: orphan.pid, pgid: orphan.pid },
      env,
    );
    writeStaleLock(loop.id, env, deadPid());

    const result = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });

    assert.equal(isGroupAlive(orphan.pid), false, "the orphaned process group must actually be dead, not merely assumed dead");
    const crashedRecord = readRun(crashed.paths);
    assert.equal(crashedRecord.status, "failed", "the crashed run must be finalized, never left running forever");
    const crashedEvents = readEvents(crashed.paths).map((e) => e.type);
    assert.ok(crashedEvents.includes("run.orphan.terminated"));
    assert.ok(crashedEvents.includes("run.crash.recovered"));
    assert.ok(
      crashedEvents.indexOf("run.orphan.terminated") < crashedEvents.indexOf("run.crash.recovered"),
      "the group must be confirmed dead BEFORE its run is finalized",
    );

    assert.equal(result.status, "succeeded", "with the orphan provably gone, the replacement run may proceed");
    assert.notEqual(result.runId, crashed.id, "the replacement run must never reuse/overwrite the crashed run");
    const state = readLoopState(loop.id, env);
    assert.equal(state.active, null);
    assert.equal(state.lastRun.runId, result.runId);
    const reacquired = acquireLock(lockDirectory(loop.id, env));
    assert.ok(reacquired, "the stolen lock must be released again by the recovering invocation");
    reacquired.release();
  } finally {
    await killOrphanGroup(orphan);
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: a failed orphan cleanup fails closed — no replacement run is spawned, and the loop self-heals once the orphan finally dies", async () => {
  const { env } = makeScratchEnv("runner-crash-orphan-blocked");
  const orphan = spawnOrphanGroup();
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });

    const crashed = createRun({ loopId: loop.id, trigger: "schedule", env, now: new Date() });
    beginAttempt(crashed.paths, { number: 1 });
    setActiveState(
      loop.id,
      { currentRunId: crashed.id, sessionId: crashed.record.sessionId, stage: "running", attempt: 1, pid: orphan.pid, pgid: orphan.pid },
      env,
    );
    writeStaleLock(loop.id, env, deadPid());

    const counter = { spawns: 0 };
    const blocked = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env,
      loadLoop: async () => loop,
      runGroup: countingRunGroup(counter),
      stopGroup: async () => "kill-failed", // teardown can never be confirmed
    });

    assert.equal(blocked.status, "skippedOverlap");
    assert.equal(blocked.orphanBlocked, true);
    assert.equal(counter.spawns, 0, "a run whose orphan cleanup failed must never spawn new work");
    assert.ok(isGroupAlive(orphan.pid), "the live orphan must be left alone, never abandoned as 'probably fine'");
    assert.equal(readRun(crashed.paths).status, "running", "a live orphan's run must never be finalized out from under it");

    const stateWhileBlocked = readLoopState(loop.id, env);
    assert.equal(stateWhileBlocked.active.currentRunId, crashed.id, "the live orphan must never be overwritten by a new run");
    assert.equal(stateWhileBlocked.active.pgid, orphan.pid);
    assert.equal(stateWhileBlocked.active.orphan.reason, "orphan-teardown-unconfirmed");
    assert.equal(stateWhileBlocked.lastRun, null, "no last-run summary may be fabricated for a run that never ended");
    assert.equal(isLockHeld(lockDirectory(loop.id, env)), false, "a fire that never spawned anything must not leak the lock it stole");

    // Self-heal: once the group is genuinely gone, the very next fire reconciles it (with the
    // real teardown machinery) and is allowed to run again — blocked is never permanent.
    await killOrphanGroup(orphan);
    const healed = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });

    assert.equal(healed.status, "succeeded");
    assert.equal(readRun(crashed.paths).status, "failed", "the crashed run is finalized only once its group is provably gone");
    const healedState = readLoopState(loop.id, env);
    assert.equal(healedState.active, null);
    assert.equal(healedState.lastRun.runId, healed.runId);
    const skipped = listRuns(loop.id, env).filter((entry) => entry.record.status === "skippedOverlap");
    assert.equal(skipped.length, 1, "the blocked fire must remain visible in history exactly once");
  } finally {
    await killOrphanGroup(orphan);
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: skips with skippedPaused for a paused lifecycle under a (forced) schedule trigger, and never spawns anything", async () => {
  const { env } = makeScratchEnv("runner-paused");
  try {
    let spawned = false;
    const loop = approvedExecutableLoop(env, { lifecycle: "paused" });
    const result = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env,
      loadLoop: async () => loop,
      buildCommand: () => {
        spawned = true;
        throw new Error("must not be called");
      },
    });
    assert.equal(result.status, "skippedPaused");
    assert.equal(spawned, false);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: contended lock yields skippedOverlap with a visible history record (schedule trigger), schedule baseline left untouched", async () => {
  const { env } = makeScratchEnv("runner-overlap");
  try {
    const loop = approvedExecutableLoop(env);
    fs.mkdirSync(path.dirname(lockDirectory(loop.id, env)), { recursive: true });
    const held = acquireLock(lockDirectory(loop.id, env));
    assert.ok(held);
    try {
      const result = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });
      assert.equal(result.status, "skippedOverlap");
      assert.ok(result.runId, "lock contention must now leave a visible skippedOverlap history record");
      const record = readRun(runPaths(loop.id, result.runId, env));
      assert.equal(record.status, "skippedOverlap");
      assert.equal(record.trigger, "schedule");
      assert.equal(record.attempts.length, 0, "an overlap skip must never have attempted a spawn");
      // The genuinely active run's own live state must be completely untouched by the skip.
      const state = readLoopState(loop.id, env);
      assert.equal(state.active, null, "recordOverlapSkip must never touch the active run's own state.json");
    } finally {
      held.release();
    }
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: contended lock with nothing forced auto-detects a schedule overlap and still records it visibly", async () => {
  const { env } = makeScratchEnv("runner-overlap-auto-schedule");
  try {
    const loop = approvedExecutableLoop(env, { schedule: { kind: "interval", seconds: 60, graceSeconds: 30 } });
    fs.mkdirSync(path.dirname(lockDirectory(loop.id, env)), { recursive: true });
    const held = acquireLock(lockDirectory(loop.id, env));
    try {
      const result = await runLoop({ loopId: loop.id, env, loadLoop: async () => loop, now: () => new Date("2026-07-24T15:00:00Z") });
      assert.equal(result.status, "skippedOverlap");
      assert.ok(result.runId);
      const record = readRun(runPaths(loop.id, result.runId, env));
      assert.equal(record.trigger, "schedule");
      // The schedule baseline must be untouched — a contended overlap must never consume or
      // advance it, so the next legitimate tick re-evaluates freshness correctly on its own.
      assert.deepEqual(readScheduleState(loop.id, env), { consumedAt: null, lastScheduledAt: null, nextExpectedAt: null });
    } finally {
      held.release();
    }
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: contended lock with a pending manual request claims and records it (never left stale for a later invocation)", async () => {
  const { env } = makeScratchEnv("runner-overlap-manual-pending");
  try {
    const loop = approvedExecutableLoop(env);
    writeManualRequest({ loopId: loop.id, env });
    fs.mkdirSync(path.dirname(lockDirectory(loop.id, env)), { recursive: true });
    const held = acquireLock(lockDirectory(loop.id, env));
    try {
      const result = await runLoop({ loopId: loop.id, env, loadLoop: async () => loop });
      assert.equal(result.status, "skippedOverlap");
      assert.ok(result.runId);
      const record = readRun(runPaths(loop.id, result.runId, env));
      assert.equal(record.trigger, "manual");

      // The request must be fully consumed — nothing left for some unrelated future
      // invocation to run unexpectedly late.
      assert.equal(fs.existsSync(manualRequestPath(loop.id, env)), false);
    } finally {
      held.release();
    }
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: contended lock with a pending RETRY request claims and records it with retryOf preserved", async () => {
  const { env } = makeScratchEnv("runner-overlap-retry-pending");
  try {
    const loop = approvedExecutableLoop(env);
    writeManualRequest({ loopId: loop.id, retryOf: "run-20260101000000", env });
    fs.mkdirSync(path.dirname(lockDirectory(loop.id, env)), { recursive: true });
    const held = acquireLock(lockDirectory(loop.id, env));
    try {
      const result = await runLoop({ loopId: loop.id, env, loadLoop: async () => loop });
      assert.equal(result.status, "skippedOverlap");
      const record = readRun(runPaths(loop.id, result.runId, env));
      assert.equal(record.trigger, "retry");
      assert.equal(record.retryOf, "run-20260101000000");
    } finally {
      held.release();
    }
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: a failure while recording the overlap skip is itself best-effort and still reports skippedOverlap", async () => {
  const { env } = makeScratchEnv("runner-overlap-record-failure");
  try {
    const loop = approvedExecutableLoop(env);
    fs.mkdirSync(path.dirname(lockDirectory(loop.id, env)), { recursive: true });
    const held = acquireLock(lockDirectory(loop.id, env));
    try {
      const result = await runLoop({
        loopId: loop.id,
        trigger: "schedule",
        env,
        loadLoop: async () => loop,
        recordOverlapSkip: () => {
          throw new Error("disk full");
        },
      });
      assert.equal(result.status, "skippedOverlap");
      assert.equal(result.runId, null, "a bookkeeping failure falls back to the no-record outcome, never throws");
    } finally {
      held.release();
    }
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: two contended-lock overlaps for the same loop within the same second still get distinct run ids (no collision)", async () => {
  const { env } = makeScratchEnv("runner-overlap-race");
  try {
    const loop = approvedExecutableLoop(env);
    fs.mkdirSync(path.dirname(lockDirectory(loop.id, env)), { recursive: true });
    const held = acquireLock(lockDirectory(loop.id, env));
    try {
      const now = () => new Date("2026-07-24T15:00:00Z");
      const [first, second] = await Promise.all([
        runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop, now }),
        runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop, now }),
      ]);
      assert.equal(first.status, "skippedOverlap");
      assert.equal(second.status, "skippedOverlap");
      assert.ok(first.runId && second.runId);
      assert.notEqual(first.runId, second.runId, "two racing overlap records must never collide on the same run id");
    } finally {
      held.release();
    }
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: fails closed with approvalBlocked when the stored fingerprint no longer matches the loop's current capability projection", async () => {
  const { env } = makeScratchEnv("runner-approval");
  try {
    const loop = approvedExecutableLoop(env);
    loop.execution = { ...loop.execution, arguments: [...loop.execution.arguments, "--extra-argument"] };
    const result = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });
    assert.equal(result.status, "approvalBlocked");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: fails closed with approvalBlocked on the approval.blocked sentinel, even though the fingerprint still matches", async () => {
  const { env } = makeScratchEnv("runner-approval-blocked-sentinel");
  try {
    const loop = approvedExecutableLoop(env);
    const sentinelPath = approvalBlockedPath(loop.id, env);
    fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
    fs.writeFileSync(sentinelPath, "Needs review\n");

    const result = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });
    assert.equal(result.status, "approvalBlocked");
    const record = readRun(runPaths(loop.id, result.runId, env));
    assert.equal(record.status, "approvalBlocked");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: fails closed with approvalBlocked when the on-disk executable no longer matches its recorded hash", async () => {
  const { env } = makeScratchEnv("runner-integrity");
  try {
    const scriptPath = path.join(env.COPILOT_LOOPS_HOME, "task");
    const originalBody = "#!/bin/sh\necho original\n";
    fs.writeFileSync(scriptPath, originalBody);
    fs.chmodSync(scriptPath, 0o755);
    const { createHash } = await import("node:crypto");
    const contentHash = createHash("sha256").update(Buffer.from(originalBody)).digest("hex");
    const loop = approvedLoop(scriptLoopFixture, {
      execution: { type: "scriptFile", path: scriptPath, arguments: [], workingDirectory: env.COPILOT_LOOPS_HOME, contentHash },
    });

    // Tamper with the script after approval — the stored hash no longer matches.
    fs.writeFileSync(scriptPath, "#!/bin/sh\necho tampered\n");
    fs.chmodSync(scriptPath, 0o755);

    const result = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });
    assert.equal(result.status, "approvalBlocked");
    const events = readEvents(runPaths(loop.id, result.runId, env));
    const blocked = events.find((e) => e.type === "run.integrity.blocked");
    assert.equal(blocked.reason, "hash-mismatch");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: an 'executable' loop approved with a null executableHash fails closed (never spawns) — converged with scriptFile's mandatory hash", async () => {
  const { env } = makeScratchEnv("runner-executable-null-hash");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    // Deliberately construct the loop WITHOUT going through execPathHash() — this models a
    // loop that was reviewed/approved back when `executableHash: null` was accepted as
    // "nothing to verify". It must no longer be allowed to run unreviewed.
    const loop = approvedExecutableLoop(env, {
      execution: {
        type: "executable",
        path: process.execPath,
        arguments: [script],
        workingDirectory: process.cwd(),
        executableHash: null,
      },
    });

    const result = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });
    assert.equal(result.status, "approvalBlocked");
    const record = readRun(runPaths(loop.id, result.runId, env));
    assert.equal(record.attempts.length, 0, "a null-hash executable must never reach a spawn attempt");
    const events = readEvents(runPaths(loop.id, result.runId, env));
    assert.equal(events.find((e) => e.type === "run.integrity.blocked")?.reason, "missing-hash");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: an 'executable' loop with a real, matching SHA-256 hash runs normally, and a post-approval swap is caught before spawn", async () => {
  const { env } = makeScratchEnv("runner-executable-real-hash");
  try {
    const execPath = path.join(env.COPILOT_LOOPS_HOME, "task-bin");
    const originalBody = "#!/bin/sh\necho original\n";
    fs.writeFileSync(execPath, originalBody);
    fs.chmodSync(execPath, 0o755);
    const executableHash = sha256File(execPath);

    const loop = approvedExecutableLoop(env, {
      execution: { type: "executable", path: execPath, arguments: [], workingDirectory: env.COPILOT_LOOPS_HOME, executableHash },
    });

    const first = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });
    assert.equal(first.status, "succeeded");

    // Swap the binary out after approval — the recorded hash no longer matches.
    fs.writeFileSync(execPath, "#!/bin/sh\necho swapped\n");
    fs.chmodSync(execPath, 0o755);

    const second = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });
    assert.equal(second.status, "approvalBlocked");
    const events = readEvents(runPaths(loop.id, second.runId, env));
    assert.equal(events.find((e) => e.type === "run.integrity.blocked")?.reason, "hash-mismatch");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: re-verifies integrity immediately before EVERY spawn attempt, including retries — a first attempt that self-modifies its own executable blocks the retry from ever spawning the changed bytes", async () => {
  const { env } = makeScratchEnv("runner-integrity-per-attempt");
  try {
    const scriptPath = path.join(env.COPILOT_LOOPS_HOME, "self-modifying.js");
    // Node reads/compiles a script's ENTIRE source synchronously before running any of its
    // top-level code, so this process is free to rewrite its own on-disk file mid-execution
    // without affecting itself — exactly modeling a first attempt that tampers with its own
    // bytes (accidentally or maliciously) before a retry would otherwise re-spawn it.
    const originalBody =
      "#!/usr/bin/env node\n" +
      "const fs = require('node:fs');\n" +
      `fs.writeFileSync(${JSON.stringify(scriptPath)}, "#!/usr/bin/env node\\nprocess.exit(0);\\n");\n` +
      "process.exitCode = 1;\n";
    fs.writeFileSync(scriptPath, originalBody);
    fs.chmodSync(scriptPath, 0o755);
    const { createHash } = await import("node:crypto");
    const contentHash = createHash("sha256").update(Buffer.from(originalBody)).digest("hex");

    const loop = approvedLoop(scriptLoopFixture, {
      execution: { type: "scriptFile", path: scriptPath, arguments: [], workingDirectory: env.COPILOT_LOOPS_HOME, contentHash },
      retry: { maxRetries: 1, backoffSeconds: 0 },
    });

    const result = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env: { ...env, PATH: process.env.PATH }, // shebang resolution (`env node`) needs a real PATH
      loadLoop: async () => loop,
    });

    assert.equal(result.status, "approvalBlocked", "the retry must never be allowed to spawn the tampered bytes");
    const record = readRun(runPaths(loop.id, result.runId, env));
    assert.equal(record.attempts.length, 1, "only the first (real) attempt may ever have spawned");
    assert.equal(record.attempts[0].exitCode, 1, "the first attempt's own genuine exit code must still be recorded");

    const events = readEvents(runPaths(loop.id, result.runId, env));
    const blockedEvents = events.filter((e) => e.type === "run.integrity.blocked");
    assert.equal(blockedEvents.length, 1, "integrity must be checked and block exactly once — before the retry, not before attempt 1 (which legitimately matched)");
    assert.equal(blockedEvents[0].reason, "hash-mismatch");
    assert.equal(blockedEvents[0].attemptNumber, 2, "the block must be attributed to the retry attempt integrity was re-verified for");

    // On-disk proof the tampered bytes were genuinely written (attempt 1 really ran), yet
    // were never spawned again — the file now differs from the content hash approved.
    assert.notEqual(sha256File(scriptPath), contentHash);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop (forced manual + explicit nonce, legacy seam): consumed exactly once; replay leaves no run record", async () => {
  const { env } = makeScratchEnv("runner-nonce");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      lifecycle: "enabled",
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    writeManualRequest({ loopId: loop.id, nonce: "n-1", env });

    const first = await runLoop({ loopId: loop.id, trigger: "manual", nonce: "n-1", env, loadLoop: async () => loop });
    assert.equal(first.status, "succeeded");
    assert.ok(first.runId);

    const second = await runLoop({ loopId: loop.id, trigger: "manual", nonce: "n-1", env, loadLoop: async () => loop });
    assert.equal(second.status, "skippedOverlap");
    assert.equal(second.runId, null, "a replayed nonce must not create a new run record");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

// ── Manual/retry auto-detection (no explicit trigger — the production path) ────────────

test("runLoop auto-detection: a pending manual request runs a PAUSED loop, bypassing schedule/lifecycle gating entirely", async () => {
  const { env } = makeScratchEnv("auto-manual-paused");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      lifecycle: "paused",
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    writeManualRequest({ loopId: loop.id, env });

    const result = await runLoop({ loopId: loop.id, env, loadLoop: async () => loop }); // no explicit trigger
    assert.equal(result.status, "succeeded");
    const record = readRun(runPaths(loop.id, result.runId, env));
    assert.equal(record.trigger, "manual");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop auto-detection: a request naming retryOf runs with trigger='retry' and records retryOf on the new run", async () => {
  const { env } = makeScratchEnv("auto-retry");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    writeManualRequest({ loopId: loop.id, retryOf: "run-20260101000000", env });

    const result = await runLoop({ loopId: loop.id, env, loadLoop: async () => loop });
    assert.equal(result.status, "succeeded");
    const record = readRun(runPaths(loop.id, result.runId, env));
    assert.equal(record.trigger, "retry");
    assert.equal(record.retryOf, "run-20260101000000");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop auto-detection: with nothing pending and the schedule not yet due, no run record is created", async () => {
  const { env } = makeScratchEnv("auto-not-due");
  try {
    const loop = approvedExecutableLoop(env, {
      schedule: { kind: "interval", seconds: 3600, graceSeconds: 60 },
    });
    const result = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => new Date("2026-07-24T15:00:00Z"),
    });
    assert.equal(result.runId, null);
    assert.equal(result.status, "notDue");
    const state = readLoopState(loop.id, env);
    assert.equal(state.schedule.nextExpectedAt, "2026-07-24T16:00:00.000Z", "the interval baseline must be established on the first check");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop auto-detection: an interval schedule fires on its second check without double-delaying the first real launch", async () => {
  const { env } = makeScratchEnv("auto-interval-due");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      schedule: { kind: "interval", seconds: 60, graceSeconds: 30 },
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    const t0 = new Date("2026-07-24T15:00:00Z");

    const first = await runLoop({ loopId: loop.id, env, loadLoop: async () => loop, now: () => t0 });
    assert.equal(first.runId, null); // establishes the baseline only

    const t1 = new Date(t0.getTime() + 60_000); // exactly at the established nextExpectedAt
    const second = await runLoop({ loopId: loop.id, env, loadLoop: async () => loop, now: () => t1 });
    assert.equal(second.status, "succeeded");
    const record = readRun(runPaths(loop.id, second.runId, env));
    assert.equal(record.trigger, "schedule");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("end-to-end fake clock: pre-seeding the baseline at enable-time (initializeScheduleBaseline) makes the runner's very FIRST launchd tick actually fire — without it, that first tick is wasted", async () => {
  const script = fakeScript;
  const intervalSeconds = 60;

  async function firstTickOutcome({ preSeed }) {
    const { env } = makeScratchEnv(`first-tick-${preSeed ? "seeded" : "unseeded"}`);
    try {
      const scriptPath = script(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
      const loop = approvedExecutableLoop(env, {
        schedule: { kind: "interval", seconds: intervalSeconds, graceSeconds: 30 },
        execution: {
          type: "executable",
          path: process.execPath,
          arguments: [scriptPath],
          workingDirectory: process.cwd(),
          executableHash: execPathHash(),
        },
      });

      // The moment the control plane loads/bootstraps this loop's LaunchAgent.
      const enableTime = new Date("2026-08-01T09:00:00Z");
      if (preSeed) {
        // This is the exact hook: enable/reconcile must call this at load/schedule-change
        // time, anchoring nextExpectedAt to (approximately) the same "now" launchd itself
        // used to arm its first StartInterval tick.
        initializeScheduleBaseline({ loopId: loop.id, schedule: loop.schedule, env, now: enableTime });
      }

      // launchd's very first StartInterval fire: exactly one interval after load.
      const firstLaunchdTick = new Date(enableTime.getTime() + intervalSeconds * 1000);
      const outcome = await runLoop({ loopId: loop.id, env, loadLoop: async () => loop, now: () => firstLaunchdTick });
      return outcome;
    } finally {
      cleanupScratch(env.COPILOT_LOOPS_HOME);
    }
  }

  const seeded = await firstTickOutcome({ preSeed: true });
  assert.equal(seeded.status, "succeeded");
  assert.notEqual(seeded.runId, null);

  const unseeded = await firstTickOutcome({ preSeed: false });
  // Without pre-seeding, the runner's own first invocation is the one that establishes the
  // baseline (now + interval, i.e. ANOTHER interval further out) — this documents the bug
  // this feature closes: the loop's first real run would only happen on launchd's SECOND
  // tick, silently doubling the effective first-fire delay.
  assert.equal(unseeded.runId, null);
});

test("runLoop auto-detection: a stale calendar fire (missed window) records skippedMissed with a run record", async () => {
  const { env } = makeScratchEnv("auto-calendar-stale");
  try {
    const loop = approvedExecutableLoop(env, {
      schedule: { kind: "calendar", hour: 1, minute: 0, weekdays: [], graceSeconds: 300 },
    });
    const result = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => new Date("2026-07-24T15:00:00Z"), // far past today's 01:00 + 5min grace
    });
    assert.equal(result.status, "skippedMissed");
    assert.ok(result.runId);
    const record = readRun(runPaths(loop.id, result.runId, env));
    assert.equal(record.trigger, "schedule");
    assert.equal(record.status, "skippedMissed");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop auto-detection: a manual request too old to honor is consumed once and recorded as skippedMissed", async () => {
  const { env } = makeScratchEnv("auto-manual-stale");
  try {
    const loop = approvedExecutableLoop(env);
    const now = new Date("2026-07-24T15:00:00Z");
    writeManualRequest({ loopId: loop.id, requestedAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), env });

    const result = await runLoop({ loopId: loop.id, env, loadLoop: async () => loop, now: () => now });
    assert.equal(result.status, "skippedMissed");
    assert.ok(result.runId);

    // Single-use even though it was stale: a second invocation finds nothing pending and due.
    const again = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => now,
    });
    assert.notEqual(again.status, "skippedMissed");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

// ── Canonical live state ─────────────────────────────────────────────────────────────────

test("runLoop populates state.json's active fields live during a run and clears them at terminal, retaining a lastRun summary", async () => {
  const { env } = makeScratchEnv("runner-live-state");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "slow.js", "setTimeout(() => process.exit(0), 300);\n");
    const loop = approvedExecutableLoop(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });

    const runPromise = runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });

    const sawRunning = await waitUntil(() => {
      const state = readLoopState(loop.id, env);
      return state.active !== null && state.active.stage === "running" && state.active.pid !== null;
    });
    assert.ok(sawRunning, "state.json must reflect the running stage with a live pid while the attempt executes");
    const midState = readLoopState(loop.id, env);
    assert.equal(midState.active.attempt, 1);
    assert.match(midState.active.sessionId, UUID_PATTERN);

    const result = await runPromise;
    const finalState = readLoopState(loop.id, env);
    assert.equal(finalState.active, null, "active must be cleared once the run reaches a terminal status");
    assert.equal(finalState.lastRun.runId, result.runId);
    assert.equal(finalState.lastRun.status, "succeeded");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop emits the canonical stage events in order for a simple successful run", async () => {
  const { env } = makeScratchEnv("runner-stages");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    const result = await runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop });
    const stages = readEvents(runPaths(loop.id, result.runId, env))
      .filter((e) => e.type === "run.stage")
      .map((e) => e.stage);
    assert.deepEqual(stages, ["preflight", "starting", "running", "finalizing", "terminal"]);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

// ── Secrets via the keychain helper ──────────────────────────────────────────────────────
//
// The real `CopilotLoopsSecrets` helper is presumably a compiled/shebang'd executable that
// the runner spawns directly (no shell). These fakes are ordinary shebang'd Node scripts,
// chmod'd executable, so `resolveSecretsViaHelper`'s `command: helperPath` spawn works
// exactly as it would against the real thing.

function fakeSecretsHelper(dir, behavior) {
  const bodies = {
    echo: `#!/usr/bin/env node\nconst arg = process.argv[3] || "";\nconst name = arg.split(":")[1] || "";\nprocess.stdout.write("value-for-" + name);\nprocess.exit(0);\n`,
    fail: `#!/usr/bin/env node\nprocess.stderr.write("denied: no such secret");\nprocess.exit(1);\n`,
    hang: `#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n`,
    // Echoes back whatever raw bytes are handed to it via FAKE_SECRET_RAW_VALUE, with NO
    // added terminator — modeling the real CopilotLoopsSecrets helper's documented
    // behavior ("writes raw bytes with no terminator").
    rawEcho: `#!/usr/bin/env node\nprocess.stdout.write(Buffer.from(process.env.FAKE_SECRET_RAW_VALUE, "utf8"));\nprocess.exit(0);\n`,
  };
  const file = path.join(dir, `fake-secrets-helper-${behavior}`);
  fs.writeFileSync(file, bodies[behavior]);
  fs.chmodSync(file, 0o755);
  return file;
}

test("resolveSecretsViaHelper preserves the helper's stdout EXACTLY — trailing newline, CRLF, and embedded newlines are never trimmed", async () => {
  const dir = makeScratchDir("secrets-helper-raw-echo");
  const helper = fakeSecretsHelper(dir, "rawEcho");
  try {
    const loop = copilotLoopFixture({ environment: { plain: {}, secretNames: ["REPORT_TOKEN"] } });
    const cases = [
      "no-trailing-newline",
      "intentionally-newline-terminated\n",
      "crlf-terminated\r\n",
      "multi\nline\nsecret\nvalue",
      "trailing-newline-with-content-after\nmore-content\n",
      "", // an empty (but resolved) secret value must round-trip as an empty string, not throw
    ];
    for (const rawValue of cases) {
      const values = await resolveSecretsViaHelper(loop, {
        helperPath: helper,
        env: { ...process.env, FAKE_SECRET_RAW_VALUE: rawValue },
      });
      assert.equal(
        values.REPORT_TOKEN,
        rawValue,
        `stdout must round-trip exactly for ${JSON.stringify(rawValue)}, got ${JSON.stringify(values.REPORT_TOKEN)}`,
      );
    }
  } finally {
    cleanupScratch(dir);
  }
});

test("runLoop end-to-end: an intentionally newline-terminated secret reaches the child's env byte-for-byte, unmodified", async () => {
  const { env } = makeScratchEnv("secrets-newline-e2e");
  const helper = fakeSecretsHelper(env.COPILOT_LOOPS_HOME, "rawEcho");
  try {
    const rawSecret = "s3cr3t-with-trailing-newline\n";
    // The redaction transform scrubs the value from stdout.log by design (see the earlier
    // redaction tests), so capture it via a marker file instead to assert byte-exactness.
    const capturePath = path.join(env.COPILOT_LOOPS_HOME, "captured-secret");
    const markerScript = fakeScript(
      env.COPILOT_LOOPS_HOME,
      "capture-env-raw.js",
      `require("fs").writeFileSync(${JSON.stringify(capturePath)}, process.env.REPORT_TOKEN);\nprocess.exit(0);\n`,
    );
    const loop = approvedExecutableLoop(env, {
      environment: { plain: {}, secretNames: ["REPORT_TOKEN"] },
      execution: { type: "executable", path: process.execPath, arguments: [markerScript], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });

    const result = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env: { ...env, PATH: process.env.PATH, FAKE_SECRET_RAW_VALUE: rawSecret }, // shebang resolution (`env node`) needs a real PATH
      loadLoop: async () => loop,
      secretsHelperPath: helper,
    });
    assert.equal(result.status, "succeeded");
    assert.equal(fs.readFileSync(capturePath, "utf8"), rawSecret, "the trailing newline must survive all the way into the child's env");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("resolveSecretsViaHelper: a failure resolving one of several declared secrets rejects the WHOLE call — no partial map is ever produced or usable", async () => {
  const dir = makeScratchDir("secrets-partial-guard");
  try {
    // A per-name-aware fake: resolves the first declared name fine (proving it WOULD have
    // produced a value), then fails for the second.
    const loop = copilotLoopFixture({ environment: { plain: {}, secretNames: ["REPORT_TOKEN", "OTHER_TOKEN"] } });
    const selective = path.join(dir, "fake-secrets-helper-selective");
    fs.writeFileSync(
      selective,
      `#!/usr/bin/env node\nconst name = (process.argv[3] || "").split(":")[1] || "";\n` +
        `if (name === "REPORT_TOKEN") { process.stdout.write("first-value-resolved"); process.exit(0); }\n` +
        `process.stderr.write("no such secret"); process.exit(1);\n`,
    );
    fs.chmodSync(selective, 0o755);

    let rejected = null;
    let returnedValue;
    try {
      returnedValue = await resolveSecretsViaHelper(loop, { helperPath: selective });
    } catch (err) {
      rejected = err;
    }
    assert.equal(returnedValue, undefined, "no value must ever be returned when any declared secret fails to resolve");
    assert.ok(rejected, "the whole resolution must reject, not silently return a partial map");
    assert.ok(!rejected.message.includes("first-value-resolved"), "the successfully-resolved value must never leak into the error either");
  } finally {
    cleanupScratch(dir);
  }
});

test("runLoop end-to-end: a missing declared secret fails closed as launchFailed and never spawns with a partial env", async () => {
  const { env } = makeScratchEnv("secrets-missing-fails-closed");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "should-not-run.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      environment: { plain: {}, secretNames: ["REPORT_TOKEN", "MISSING_TOKEN"] },
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    const result = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env,
      loadLoop: async () => loop,
      // Only resolves ONE of the two declared secrets — models a resolver bug or a
      // helper/keychain item that silently vanished for one name.
      resolveSecrets: () => ({ REPORT_TOKEN: "present" }),
    });
    assert.equal(result.status, "launchFailed");
    const record = readRun(runPaths(loop.id, result.runId, env));
    // beginAttempt() logs an attempt entry before command construction runs, but that
    // attempt must show no real process outcome — buildCommand/buildEnv must throw and
    // abort BEFORE any spawn, never launch the script with only the resolved subset of its
    // declared secrets.
    assert.equal(record.attempts.length, 1);
    assert.equal(record.attempts[0].exitCode, null, "no real exit code — the script must never have actually run");
    assert.equal(record.attempts[0].signal, null);
    assert.equal(fs.existsSync(runPaths(loop.id, result.runId, env).stdoutLog), false, "no stdout.log means the script process never spawned");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("resolveSecretsViaHelper invokes the helper directly (argv `get <loopId:NAME>`, no shell) once per declared secret", async () => {
  const dir = makeScratchDir("secrets-helper-echo");
  const helper = fakeSecretsHelper(dir, "echo");
  try {
    const loop = copilotLoopFixture({ environment: { plain: {}, secretNames: ["REPORT_TOKEN", "OTHER_TOKEN"] } });
    const values = await resolveSecretsViaHelper(loop, { helperPath: helper });
    assert.deepEqual(values, { REPORT_TOKEN: "value-for-REPORT_TOKEN", OTHER_TOKEN: "value-for-OTHER_TOKEN" });
  } finally {
    cleanupScratch(dir);
  }
});

test("resolveSecretsViaHelper returns {} without spawning anything when the loop declares no secrets", async () => {
  const loop = copilotLoopFixture({ environment: { plain: {}, secretNames: [] } });
  const values = await resolveSecretsViaHelper(loop, { helperPath: "/nonexistent/should-never-be-invoked" });
  assert.deepEqual(values, {});
});

test("resolveSecretsViaHelper throws (never a partial/garbled value) when the helper exits non-zero, without leaking its stdout/stderr", async () => {
  const dir = makeScratchDir("secrets-helper-fail");
  const helper = fakeSecretsHelper(dir, "fail");
  try {
    const loop = copilotLoopFixture({ environment: { plain: {}, secretNames: ["REPORT_TOKEN"] } });
    await assert.rejects(() => resolveSecretsViaHelper(loop, { helperPath: helper }), (err) => {
      assert.ok(!err.message.includes("denied"), "the helper's stderr must never appear in the thrown message");
      return true;
    });
  } finally {
    cleanupScratch(dir);
  }
});

test("resolveSecretsViaHelper bounds each lookup with a timeout and rejects promptly if the helper hangs", async () => {
  const dir = makeScratchDir("secrets-helper-hang");
  const helper = fakeSecretsHelper(dir, "hang");
  try {
    const loop = copilotLoopFixture({ environment: { plain: {}, secretNames: ["REPORT_TOKEN"] } });
    const start = Date.now();
    await assert.rejects(
      () => resolveSecretsViaHelper(loop, { helperPath: helper, timeoutMs: 500 }),
      /timed out/,
    );
    assert.ok(Date.now() - start < 3000, "a hung helper must not block the run indefinitely");
  } finally {
    cleanupScratch(dir);
  }
});

test("resolveSecretsViaHelper throws when the helper binary is missing (default or explicit path)", async () => {
  const loop = copilotLoopFixture({ environment: { plain: {}, secretNames: ["REPORT_TOKEN"] } });
  await assert.rejects(() => resolveSecretsViaHelper(loop, { helperPath: "/definitely/not/a/real/helper-binary" }));
});

test("resolveSecretsFromEnv (the plain-env alternate resolver) reads declared secret names directly from env", () => {
  const loop = copilotLoopFixture({ environment: { plain: {}, secretNames: ["REPORT_TOKEN"] } });
  assert.deepEqual(resolveSecretsFromEnv(loop, { env: { REPORT_TOKEN: "abc" } }), { REPORT_TOKEN: "abc" });
  assert.deepEqual(resolveSecretsFromEnv(loop, { env: {} }), {});
});

test("runLoop: a missing/failing secrets helper fails closed as launchFailed, and a hung helper never blocks the run indefinitely", async () => {
  const { env } = makeScratchEnv("runner-secrets-helper-failure");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      environment: { plain: {}, secretNames: ["REPORT_TOKEN"] },
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    const result = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env,
      loadLoop: async () => loop,
      secretsHelperPath: "/definitely/not/a/real/helper-binary",
    });
    assert.equal(result.status, "launchFailed");
    const record = readRun(runPaths(loop.id, result.runId, env));
    assert.equal(record.status, "launchFailed");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: never writes secret values anywhere on disk, INCLUDING when the script echoes them back to its own stdout — redacted, not the raw value", async () => {
  const { env } = makeScratchEnv("runner-secrets-clean");
  try {
    const secretValue = "sekret-value-xyz";
    const script = fakeScript(
      env.COPILOT_LOOPS_HOME,
      "print-env.js",
      "console.log(JSON.stringify(process.env.REPORT_TOKEN));\nprocess.exit(0);\n",
    );
    const loop = approvedExecutableLoop(env, {
      environment: { plain: {}, secretNames: ["REPORT_TOKEN"] },
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });

    const result = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env,
      loadLoop: async () => loop,
      resolveSecrets: () => ({ REPORT_TOKEN: secretValue }),
    });
    assert.equal(result.status, "succeeded");

    const paths = runPaths(loop.id, result.runId, env);
    for (const file of [paths.runJson, paths.eventsLog, paths.stdoutLog]) {
      assert.ok(!fs.readFileSync(file, "utf8").includes(secretValue), `${path.basename(file)} must never contain the secret value`);
    }
    // The script DID echo the value it received (proving injection actually happened), but
    // stdout.log must show the redaction marker, never the raw bytes.
    assert.ok(fs.readFileSync(paths.stdoutLog, "utf8").includes("[REDACTED]"));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: redacts a secret echoed back split exactly across two of the script's own stdout writes", async () => {
  const { env } = makeScratchEnv("runner-secrets-cross-chunk");
  try {
    const secretValue = "cross-chunk-secret-0123456789ABCDEF";
    const splitAt = 14;
    const script = fakeScript(
      env.COPILOT_LOOPS_HOME,
      "echo-split.js",
      `const v = process.env.REPORT_TOKEN;\n` +
        `process.stdout.write(v.slice(0, ${splitAt}));\n` +
        `process.stdout.write(v.slice(${splitAt}));\n` +
        `process.stdout.write("\\n");\nprocess.exit(0);\n`,
    );
    const loop = approvedExecutableLoop(env, {
      environment: { plain: {}, secretNames: ["REPORT_TOKEN"] },
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });

    const result = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env,
      loadLoop: async () => loop,
      resolveSecrets: () => ({ REPORT_TOKEN: secretValue }),
    });
    assert.equal(result.status, "succeeded");

    const stdoutContent = fs.readFileSync(runPaths(loop.id, result.runId, env).stdoutLog, "utf8");
    assert.equal(stdoutContent, "[REDACTED]\n");
    assert.ok(!stdoutContent.includes(secretValue.slice(0, splitAt)), "must not leak the prefix half of a value split across writes");
    assert.ok(!stdoutContent.includes(secretValue.slice(splitAt)), "must not leak the suffix half of a value split across writes");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

// ── sessionId ────────────────────────────────────────────────────────────────────────────

test("runLoop passes the run's UUID sessionId (never the run id string) as --session-id for a copilot execution", async () => {
  const { env } = makeScratchEnv("runner-session-id");
  try {
    const capturePath = path.join(env.COPILOT_LOOPS_HOME, "captured-session-id");
    const fakeCopilot = fakeScript(
      env.COPILOT_LOOPS_HOME,
      "fake-copilot",
      `#!/usr/bin/env node\nconst idx = process.argv.indexOf("--session-id");\n` +
        `require("fs").writeFileSync(${JSON.stringify(capturePath)}, process.argv[idx + 1]);\n` +
        `process.stdout.write("{}\\n");\nprocess.exit(0);\n`,
    );
    fs.chmodSync(fakeCopilot, 0o755);

    const loop = approvedLoop(copilotLoopFixture, {
      environment: { plain: {}, secretNames: [] },
      execution: { ...copilotLoopFixture().execution, workingDirectory: env.COPILOT_LOOPS_HOME },
    });
    const result = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env: { ...env, PATH: process.env.PATH }, // shebang resolution (`env node`) needs a real PATH
      loadLoop: async () => loop,
      copilotBinary: fakeCopilot,
    });
    assert.equal(result.status, "succeeded");

    const record = readRun(runPaths(loop.id, result.runId, env));
    const capturedSessionId = fs.readFileSync(capturePath, "utf8");
    assert.equal(capturedSessionId, record.sessionId);
    assert.match(capturedSessionId, UUID_PATTERN);
    assert.notEqual(capturedSessionId, result.runId);

    // Copilot's stdout goes to copilot.jsonl, not stdout.log.
    const paths = runPaths(loop.id, result.runId, env);
    assert.ok(fs.existsSync(paths.copilotLog));
    assert.equal(fs.existsSync(paths.stdoutLog), false);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

// ── Abortable retry backoff ──────────────────────────────────────────────────────────────

test("runLoop: an abort during retry backoff cancels promptly instead of waiting out the full backoff", async () => {
  const { env } = makeScratchEnv("runner-abort-backoff");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "always-fails.js", "process.exit(1);\n");
    const loop = approvedExecutableLoop(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
      retry: { maxRetries: 1, backoffSeconds: 300 }, // 5 minutes — must NOT actually be waited out
    });
    const controller = new AbortController();
    const runPromise = runLoop({ loopId: loop.id, trigger: "schedule", env, loadLoop: async () => loop, abortSignal: controller.signal });

    const sawRetrying = await waitUntil(() => readLoopState(loop.id, env).active?.stage === "retrying");
    assert.ok(sawRetrying, "the run must reach the retrying stage before we abort mid-backoff");

    const start = Date.now();
    controller.abort();
    const result = await runPromise;
    const elapsed = Date.now() - start;

    assert.equal(result.status, "cancelled");
    assert.ok(elapsed < 5000, `abort during backoff must cancel promptly, took ${elapsed}ms`);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

// ── Retention: reported, never fatal to an already-finalized run ───────────────────────

test("runLoop: a retention failure is reported (retentionError) but never retroactively fails the finalized run", async () => {
  const { env } = makeScratchEnv("runner-retention-error");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    const result = await runLoop({
      loopId: loop.id,
      trigger: "schedule",
      env,
      loadLoop: async () => loop,
      enforceRetention: () => {
        throw new Error("simulated retention failure");
      },
    });
    assert.equal(result.status, "succeeded", "the run's own outcome must be unaffected by a retention failure");
    assert.equal(result.retentionError, "simulated retention failure");
    const events = readEvents(runPaths(loop.id, result.runId, env));
    assert.ok(events.some((e) => e.type === "run.retention.failed" && e.message === "simulated retention failure"));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});


// ── One-time schedules must never fire again — immediate self-disable ──────────────────
//
// A "once" loop's launchd StartCalendarInterval has no year field, so the plist alone would
// fire again next year unless something stops it. The persisted `consumedAt` schedule
// baseline already makes a re-fire a silent no-op (see the auto-detection tests above), but
// this is the belt-and-suspenders half: immediately after a SCHEDULE-triggered fire of a
// one-time loop reaches a terminal status, the runner also disables its own launchd task
// label directly (no shell, exit-code only) — closing the gap for "control reconciliation
// never runs because the app stays closed".

function onceLoopFixture(env, overrides = {}) {
  return approvedExecutableLoop(env, {
    schedule: { kind: "once", scheduledAt: "2026-07-24T15:00:00Z", graceSeconds: 300 },
    ...overrides,
  });
}

test("runLoop: a scheduled one-time fire disables its own launchd task label after terminal finalization", async () => {
  const { env } = makeScratchEnv("once-disable-success");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = onceLoopFixture(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    const calls = [];
    const result = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => new Date("2026-07-24T15:00:00Z"),
      disableLaunchdTask: async (id, opts) => {
        calls.push({ id, opts });
      },
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.onceScheduleDisabled, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, loop.id);

    const record = readRun(runPaths(loop.id, result.runId, env));
    assert.equal(record.trigger, "schedule");
    const events = readEvents(runPaths(loop.id, result.runId, env));
    assert.ok(events.some((e) => e.type === "run.schedule.once.disabled"));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: a failure to disable the once-schedule's launchd task is reported but never fails the already-finalized run", async () => {
  const { env } = makeScratchEnv("once-disable-failure");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = onceLoopFixture(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    const result = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => new Date("2026-07-24T15:00:00Z"),
      disableLaunchdTask: async () => {
        throw new Error("launchctl disable failed: no such service");
      },
    });
    assert.equal(result.status, "succeeded", "the run's own outcome must be unaffected by a disable failure");
    assert.equal(result.onceScheduleDisabled, false);
    const events = readEvents(runPaths(loop.id, result.runId, env));
    assert.ok(events.some((e) => e.type === "run.schedule.once.disable_failed" && e.message.includes("no such service")));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: never disables the launchd task for a recurring (non-once) schedule", async () => {
  const { env } = makeScratchEnv("once-disable-not-recurring");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = approvedExecutableLoop(env, {
      schedule: { kind: "interval", seconds: 60, graceSeconds: 30 },
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    const t0 = new Date("2026-07-24T15:00:00Z");
    await runLoop({ loopId: loop.id, env, loadLoop: async () => loop, now: () => t0, disableLaunchdTask: async () => {
      throw new Error("must never be called for a recurring schedule");
    } });
    const t1 = new Date(t0.getTime() + 60_000);
    let disableCalled = false;
    const result = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => t1,
      disableLaunchdTask: async () => {
        disableCalled = true;
      },
    });
    assert.equal(result.status, "succeeded");
    assert.equal(disableCalled, false, "an interval schedule must never trigger the once-only self-disable");
    assert.equal(result.onceScheduleDisabled, undefined);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: a stale/missed one-time fire (skippedMissed) still disables the launchd task, since the window is consumed either way", async () => {
  const { env } = makeScratchEnv("once-disable-stale");
  try {
    const loop = onceLoopFixture(env, { schedule: { kind: "once", scheduledAt: "2026-07-24T15:00:00Z", graceSeconds: 60 } });
    let disableCalled = false;
    const result = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => new Date("2026-07-24T16:00:00Z"), // an hour past scheduledAt + grace: stale
      disableLaunchdTask: async () => {
        disableCalled = true;
      },
    });
    assert.equal(result.status, "skippedMissed");
    assert.equal(disableCalled, true);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: Run Now (manual trigger) on a one-time loop never triggers the self-disable — and still runs even after the schedule already fired", async () => {
  const { env } = makeScratchEnv("once-preserve-manual");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = onceLoopFixture(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    const t0 = new Date("2026-07-24T15:00:00Z");

    // The scheduled fire happens and disables the launchd task (asserted above); simulate
    // that here without re-testing it, just to reach the "already consumed" state.
    const scheduled = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => t0,
      disableLaunchdTask: async () => {},
    });
    assert.equal(scheduled.status, "succeeded");

    // A manual "Run now" afterward must still work, and must NOT touch the launchd task.
    const oneYearLater = new Date(t0.getTime() + 365 * 24 * 60 * 60 * 1000);
    writeManualRequest({ loopId: loop.id, requestedAt: oneYearLater.toISOString(), env });
    let disableCalled = false;
    const manual = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => oneYearLater,
      disableLaunchdTask: async () => {
        disableCalled = true;
      },
    });
    assert.equal(manual.status, "succeeded");
    assert.equal(disableCalled, false, "a manual Run now must never invoke the once-schedule self-disable");
    const record = readRun(runPaths(loop.id, manual.runId, env));
    assert.equal(record.trigger, "manual");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop: a scheduled re-fire of an already-consumed one-time loop a year later is a silent no-op (no spawn, no run record)", async () => {
  const { env } = makeScratchEnv("once-no-refire-next-year");
  try {
    let spawned = false;
    const loop = onceLoopFixture(env);
    const t0 = new Date("2026-07-24T15:00:00Z");
    const first = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => t0,
      buildCommand: () => {
        spawned = true;
        return { command: process.execPath, args: ["-e", "process.exit(0)"] };
      },
      disableLaunchdTask: async () => {},
    });
    assert.equal(first.status, "succeeded");
    assert.equal(spawned, true);

    spawned = false;
    const nextYear = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => new Date(t0.getTime() + 365 * 24 * 60 * 60 * 1000),
      buildCommand: () => {
        spawned = true;
        throw new Error("must never be called for an already-consumed one-time schedule");
      },
      disableLaunchdTask: async () => {
        throw new Error("must never be called: no schedule trigger fires here at all");
      },
    });
    assert.equal(nextYear.runId, null);
    assert.equal(nextYear.status, "notDue");
    assert.equal(spawned, false);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

// Deterministic injected-launchctl test: exercises the REAL disableTaskLaunchAgent (from
// lib/launchd.mjs) end to end, with a fake command runner standing in for the `launchctl`
// binary — proving the exact argv shape (`disable <domain>/<label>`), that it is invoked
// directly (no shell), and that only the exit code is consulted (stdout is never parsed).
test("runLoop + the real disableTaskLaunchAgent: invokes `launchctl disable <target>` directly, via argv, exit-code only", async () => {
  const { env } = makeScratchEnv("once-disable-real-launchctl");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = onceLoopFixture(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });

    const invocations = [];
    const fakeCommandRunner = async (command, args) => {
      invocations.push({ command, args });
      // Deliberately noisy/misleading stdout to prove it is never parsed for success.
      return { code: 0, signal: null, stdout: "this is not JSON and must never be read", stderr: "" };
    };
    const disableLaunchdTask = (id, opts) => disableTaskLaunchAgent(id, { ...opts, run: fakeCommandRunner });

    const result = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => new Date("2026-07-24T15:00:00Z"),
      disableLaunchdTask,
    });

    assert.equal(result.status, "succeeded");
    assert.equal(result.onceScheduleDisabled, true);
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0].command, "launchctl");
    assert.deepEqual(invocations[0].args, ["disable", launchdTarget(loop.id, undefined, env)]);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("runLoop + the real disableTaskLaunchAgent: a non-zero exit code fails closed without ever reading stdout for the reason", async () => {
  const { env } = makeScratchEnv("once-disable-real-launchctl-failure");
  try {
    const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
    const loop = onceLoopFixture(env, {
      execution: { type: "executable", path: process.execPath, arguments: [script], workingDirectory: process.cwd(), executableHash: execPathHash() },
    });
    const fakeCommandRunner = async () => ({ code: 1, signal: null, stdout: "", stderr: "Could not find service" });
    const disableLaunchdTask = (id, opts) => disableTaskLaunchAgent(id, { ...opts, run: fakeCommandRunner });

    const result = await runLoop({
      loopId: loop.id,
      env,
      loadLoop: async () => loop,
      now: () => new Date("2026-07-24T15:00:00Z"),
      disableLaunchdTask,
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.onceScheduleDisabled, false);
    const events = readEvents(runPaths(loop.id, result.runId, env));
    const failedEvent = events.find((e) => e.type === "run.schedule.once.disable_failed");
    assert.ok(failedEvent.message.includes("Could not find service"));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

// ── Lifecycle gating matrix ──────────────────────────────────────────────────────────────
//
// - `enabled`: the only lifecycle a SCHEDULE trigger may execute.
// - `paused`: schedule -> skippedPaused; a claimed manual/retry request still executes.
// - `ready`: never a schedule fire (even if its transient "Run now" LaunchAgent happens to
//   still be loaded/bootstrapped when a calendar/interval slot comes around — lifecycle
//   gating is a property of the manifest, not of launchd's transient load state); only a
//   CLAIMED manual Run now / Retry request executes.
// - `draft`, `needsReview`, `archived`: fail/skip closed for every trigger.

function draftLoop(env, overrides = {}) {
  // draft/needsReview MUST carry a null approval (contracts.mjs's validateApproval enforces
  // this the other way too) — deliberately NOT using the approvedLoop()/fingerprint helper.
  return scriptLoopFixture({
    lifecycle: "draft",
    execution: {
      type: "executable",
      path: process.execPath,
      arguments: [],
      workingDirectory: process.cwd(),
      executableHash: execPathHash(),
    },
    ...overrides,
  });
}

function needsReviewLoop(env, overrides = {}) {
  return draftLoop(env, { lifecycle: "needsReview", ...overrides });
}

function archivedLoop(env, overrides = {}) {
  // archived carries no approval constraint either way; use a previously-approved
  // fingerprint (the realistic "was enabled, then archived" case).
  return approvedExecutableLoop(env, { lifecycle: "archived", ...overrides });
}

const LIFECYCLE_GATING_CASES = [
  { lifecycle: "enabled", trigger: "schedule", expect: "run" },
  { lifecycle: "enabled", trigger: "manual", expect: "run" },
  { lifecycle: "paused", trigger: "schedule", expect: "skippedPaused" },
  { lifecycle: "paused", trigger: "manual", expect: "run" },
  { lifecycle: "ready", trigger: "schedule", expect: "skippedPaused" },
  { lifecycle: "ready", trigger: "manual", expect: "run" },
  { lifecycle: "ready", trigger: "retry", expect: "run" },
  { lifecycle: "draft", trigger: "schedule", expect: "skippedPaused" },
  { lifecycle: "draft", trigger: "manual", expect: "skippedPaused" },
  { lifecycle: "needsReview", trigger: "schedule", expect: "skippedPaused" },
  { lifecycle: "needsReview", trigger: "manual", expect: "skippedPaused" },
  { lifecycle: "archived", trigger: "schedule", expect: "skippedPaused" },
  { lifecycle: "archived", trigger: "manual", expect: "skippedPaused" },
];

for (const { lifecycle, trigger, expect } of LIFECYCLE_GATING_CASES) {
  test(`runLoop lifecycle gating: ${lifecycle} + trigger=${trigger} -> ${expect}`, async () => {
    const { env } = makeScratchEnv(`gate-${lifecycle}-${trigger}`);
    try {
      const script = fakeScript(env.COPILOT_LOOPS_HOME, "ok.js", "process.exit(0);\n");
      const execution = {
        type: "executable",
        path: process.execPath,
        arguments: [script],
        workingDirectory: process.cwd(),
        executableHash: execPathHash(),
      };

      let loop;
      if (lifecycle === "draft") loop = draftLoop(env, { execution });
      else if (lifecycle === "needsReview") loop = needsReviewLoop(env, { execution });
      else if (lifecycle === "archived") loop = archivedLoop(env, { execution });
      else loop = approvedExecutableLoop(env, { lifecycle, execution });

      const options = { loopId: loop.id, env, loadLoop: async () => loop };
      if (trigger === "manual" || trigger === "retry") {
        writeManualRequest({ loopId: loop.id, retryOf: trigger === "retry" ? "run-20260101000000" : null, env });
      } else {
        options.trigger = "schedule"; // forced: simulate an actual calendar/interval fire,
        // exactly the "transient service still loaded" scenario for a `ready` loop.
      }

      const result = await runLoop(options);
      const record = readRun(runPaths(loop.id, result.runId, env));

      if (expect === "run") {
        assert.equal(result.status, "succeeded", `${lifecycle}+${trigger} must be allowed to run`);
        assert.equal(record.trigger, trigger);
        assert.equal(record.attempts.length, 1, `${lifecycle}+${trigger} must actually spawn an attempt`);
      } else {
        assert.equal(result.status, "skippedPaused", `${lifecycle}+${trigger} must fail/skip closed`);
        assert.equal(record.attempts.length, 0, `${lifecycle}+${trigger} must never spawn a command`);
      }
    } finally {
      cleanupScratch(env.COPILOT_LOOPS_HOME);
    }
  });
}

// ── COPILOT_LOOPS_HOME must be absolute (shared paths.mjs boundary) ────────────────────

test("runLoop fails closed (rejects) when given a non-absolute COPILOT_LOOPS_HOME, instead of silently writing state relative to cwd", async () => {
  const loop = approvedExecutableLoop({ COPILOT_LOOPS_HOME: "irrelevant" }, {});
  await assert.rejects(
    () =>
      runLoop({
        loopId: loop.id,
        trigger: "schedule",
        env: { COPILOT_LOOPS_HOME: "relative/loops-home" },
        loadLoop: async () => loop,
      }),
    /absolute path/,
  );
});
