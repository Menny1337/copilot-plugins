import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createRun,
  readRun,
  patchRun,
  beginAttempt,
  endAttempt,
  finalizeRun,
  appendEvent,
  appendStageEvent,
  readEvents,
  RUN_STAGES,
  readLoopState,
  setActiveState,
  clearActiveState,
  readScheduleState,
  writeScheduleState,
  initializeScheduleBaseline,
  writeManualRequest,
  consumeManualRequestNonce,
  claimManualRequest,
  recordOverlapSkip,
  requestManualRun,
  manualRequestPath,
  verifyApproval,
  listRuns,
  lockDirectory,
  runPaths,
  approvalBlockedPath,
  recoverCrashStaleActiveRun,
  markActiveOrphan,
} from "../lib/run-state.mjs";
import { acquireLock } from "../lib/locks.mjs";
import { UUID_PATTERN, capabilityFingerprint } from "../lib/contracts.mjs";
import { makeScratchEnv, cleanupScratch, cleanupScratchRoot, copilotLoopFixture } from "./runtime-helpers.mjs";

test.after(cleanupScratchRoot);

test("createRun allocates a run id matching the fixture's run-<timestamp> shape, and a UUID sessionId", () => {
  const { env } = makeScratchEnv("createrun");
  try {
    const now = new Date("2026-07-24T15:00:00Z");
    const run = createRun({ loopId: "nightly-dependency-report", trigger: "schedule", scheduledFor: now.toISOString(), env, now });
    assert.equal(run.id, "run-20260724150000");
    assert.equal(run.record.status, "starting");
    assert.equal(run.record.schemaVersion, 1);
    assert.match(run.record.sessionId, UUID_PATTERN);
    assert.notEqual(run.record.sessionId, run.id, "the session id must be a UUID, never the run id string");
    assert.deepEqual(run.record.attempts, []);
    assert.deepEqual(readRun(run.paths), run.record);
    assert.deepEqual(readEvents(run.paths).map((e) => e.type), ["run.created"]);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("createRun never collides two fires within the same second, and mints a distinct sessionId per run", () => {
  const { env } = makeScratchEnv("createrun-collide");
  try {
    const now = new Date("2026-07-24T15:00:00Z");
    const first = createRun({ loopId: "x", trigger: "schedule", env, now });
    const second = createRun({ loopId: "x", trigger: "manual", env, now });
    assert.notEqual(first.id, second.id);
    assert.notEqual(first.record.sessionId, second.record.sessionId);
    assert.equal(fs.existsSync(first.dir), true);
    assert.equal(fs.existsSync(second.dir), true);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("attempt lifecycle: beginAttempt/endAttempt/finalizeRun build a schema-shaped record and keep sessionId stable across attempts", () => {
  const { env } = makeScratchEnv("attempts");
  try {
    const run = createRun({ loopId: "x", trigger: "schedule", env, now: new Date("2026-07-24T15:00:00Z") });
    const sessionId = run.record.sessionId;
    beginAttempt(run.paths, { number: 1, startedAt: "2026-07-24T15:00:01Z" });
    let record = readRun(run.paths);
    assert.equal(record.status, "running");
    assert.equal(record.startedAt, "2026-07-24T15:00:01Z");
    assert.equal(record.attempts.length, 1);
    assert.equal(record.sessionId, sessionId);

    endAttempt(run.paths, { number: 1, endedAt: "2026-07-24T15:00:05Z", exitCode: 1, signal: null });
    beginAttempt(run.paths, { number: 2, startedAt: "2026-07-24T15:01:05Z" });
    endAttempt(run.paths, { number: 2, endedAt: "2026-07-24T15:01:10Z", exitCode: 0, signal: null });
    finalizeRun(run.paths, { status: "succeeded", exitCode: 0, signal: null, endedAt: "2026-07-24T15:01:10Z" });

    record = readRun(run.paths);
    assert.equal(record.status, "succeeded");
    assert.equal(record.sessionId, sessionId, "sessionId must stay stable across retries of the same run");
    assert.equal(record.attempts.length, 2);
    assert.equal(record.attempts[0].exitCode, 1);
    assert.equal(record.attempts[1].exitCode, 0);
    assert.equal(record.startedAt, "2026-07-24T15:00:01Z");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("finalizeRun rejects a non-terminal status", () => {
  const { env } = makeScratchEnv("finalize-guard");
  try {
    const run = createRun({ loopId: "x", trigger: "schedule", env, now: new Date() });
    assert.throws(() => finalizeRun(run.paths, { status: "running" }));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("patchRun persists a void-returning mutator's in-place edits (does not silently discard them)", () => {
  const { env } = makeScratchEnv("patchrun-void");
  try {
    const run = createRun({ loopId: "x", trigger: "schedule", env, now: new Date() });
    const returned = patchRun(run.paths, (clone) => {
      clone.status = "running";
      clone.startedAt = "2026-07-24T15:00:01Z";
      // deliberately no return — the common "mutate in place" style
    });
    assert.equal(returned.status, "running");
    assert.equal(returned.startedAt, "2026-07-24T15:00:01Z");
    const onDisk = readRun(run.paths);
    assert.equal(onDisk.status, "running", "a void-returning mutator's edits must reach disk");
    assert.equal(onDisk.startedAt, "2026-07-24T15:00:01Z");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("appendStageEvent only accepts the canonical RUN_STAGES names and records them in events.jsonl", () => {
  const { env } = makeScratchEnv("stage-events");
  try {
    const run = createRun({ loopId: "x", trigger: "schedule", env, now: new Date() });
    for (const stage of RUN_STAGES) appendStageEvent(run.dir, stage);
    const stages = readEvents(run.paths).filter((e) => e.type === "run.stage").map((e) => e.stage);
    assert.deepEqual(stages, [...RUN_STAGES]);
    assert.throws(() => appendStageEvent(run.dir, "not-a-real-stage"));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("loop-level state.json: setActiveState/clearActiveState track live progress and retain a compact lastRun summary", () => {
  const { env } = makeScratchEnv("loop-state");
  try {
    const loopId = "nightly-report";
    const fresh = readLoopState(loopId, env);
    assert.equal(fresh.active, null);
    assert.equal(fresh.lastRun, null);
    assert.deepEqual(fresh.schedule, { consumedAt: null, lastScheduledAt: null, nextExpectedAt: null });

    setActiveState(loopId, { currentRunId: "run-1", sessionId: "s-1", stage: "preflight", attempt: 0 }, env);
    let state = readLoopState(loopId, env);
    assert.equal(state.active.currentRunId, "run-1");
    assert.equal(state.active.stage, "preflight");

    setActiveState(loopId, { stage: "running", pid: 4242, pgid: 4242, attempt: 1 }, env);
    state = readLoopState(loopId, env);
    assert.equal(state.active.stage, "running");
    assert.equal(state.active.pid, 4242);
    assert.equal(state.active.currentRunId, "run-1", "earlier active fields survive a partial patch");

    clearActiveState(loopId, { runId: "run-1", status: "succeeded", exitCode: 0, signal: null }, env);
    state = readLoopState(loopId, env);
    assert.equal(state.active, null, "active must be cleared crash-safely at terminal");
    assert.equal(state.lastRun.runId, "run-1");
    assert.equal(state.lastRun.status, "succeeded");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("setActiveState rejects an unknown stage name", () => {
  const { env } = makeScratchEnv("loop-state-bad-stage");
  try {
    assert.throws(() => setActiveState("x", { stage: "bogus" }, env));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("schedule baseline round-trips through loop-level state.json independent of active/lastRun", () => {
  const { env } = makeScratchEnv("schedule-state");
  try {
    const loopId = "interval-loop";
    writeScheduleState(loopId, { consumedAt: null, lastScheduledAt: null, nextExpectedAt: "2026-07-24T16:00:00Z" }, env);
    assert.deepEqual(readScheduleState(loopId, env), {
      consumedAt: null,
      lastScheduledAt: null,
      nextExpectedAt: "2026-07-24T16:00:00Z",
    });
    setActiveState(loopId, { currentRunId: "run-1", stage: "preflight" }, env);
    // Updating `active` must not disturb the independently-persisted schedule baseline.
    assert.equal(readScheduleState(loopId, env).nextExpectedAt, "2026-07-24T16:00:00Z");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("consumeManualRequestNonce succeeds exactly once for a matching nonce", () => {
  const { env } = makeScratchEnv("nonce");
  try {
    writeManualRequest({ loopId: "x", nonce: "abc123", requestedAt: "2026-07-24T15:00:00Z", env });
    const first = consumeManualRequestNonce({ loopId: "x", nonce: "abc123", env });
    assert.equal(first, "2026-07-24T15:00:00Z");
    const second = consumeManualRequestNonce({ loopId: "x", nonce: "abc123", env });
    assert.equal(second, null, "the same nonce must not be consumable twice");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("claimManualRequest returns 'none' when nothing is pending, and claims a fresh manual request exactly once", () => {
  const { env } = makeScratchEnv("claim-none-then-manual");
  try {
    assert.deepEqual(claimManualRequest({ loopId: "x", env }), { status: "none" });

    const now = new Date("2026-07-24T15:00:00Z");
    writeManualRequest({ loopId: "x", nonce: "n-1", requestedAt: now.toISOString(), env });
    const claim = claimManualRequest({ loopId: "x", env, now: new Date(now.getTime() + 5000) });
    assert.equal(claim.status, "claimed");
    assert.equal(claim.trigger, "manual");
    assert.equal(claim.retryOf, null);
    assert.equal(claim.nonce, "n-1");

    // Single-use: a second claim attempt finds nothing pending.
    assert.deepEqual(claimManualRequest({ loopId: "x", env }), { status: "none" });
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("claimManualRequest derives trigger='retry' and retryOf from a request that names an original run", () => {
  const { env } = makeScratchEnv("claim-retry");
  try {
    const now = new Date("2026-07-24T15:00:00Z");
    writeManualRequest({ loopId: "x", nonce: "n-retry", requestedAt: now.toISOString(), retryOf: "run-20260724120000", env });
    const claim = claimManualRequest({ loopId: "x", env, now });
    assert.equal(claim.status, "claimed");
    assert.equal(claim.trigger, "retry");
    assert.equal(claim.retryOf, "run-20260724120000");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("claimManualRequest reports (and still consumes) a request too old or too far in the future to honor", () => {
  const { env: envOld } = makeScratchEnv("claim-stale-old");
  const { env: envFuture } = makeScratchEnv("claim-stale-future");
  try {
    const now = new Date("2026-07-24T15:00:00Z");
    writeManualRequest({ loopId: "x", nonce: "n-old", requestedAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), env: envOld });
    const stale = claimManualRequest({ loopId: "x", env: envOld, now, maxAgeMs: 15 * 60 * 1000 });
    assert.equal(stale.status, "stale");
    assert.equal(stale.nonce, "n-old");
    assert.equal(stale.trigger, "manual", "the 'stale' status must carry a trigger too, not leave it undefined for the overlap path to read");
    // Still single-use even though it was rejected as stale.
    assert.deepEqual(claimManualRequest({ loopId: "x", env: envOld, now }), { status: "none" });

    writeManualRequest({
      loopId: "x",
      nonce: "n-future",
      requestedAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      env: envFuture,
    });
    const future = claimManualRequest({ loopId: "x", env: envFuture, now, maxFutureSkewMs: 60 * 1000 });
    assert.equal(future.status, "stale");
  } finally {
    cleanupScratch(envOld.COPILOT_LOOPS_HOME);
    cleanupScratch(envFuture.COPILOT_LOOPS_HOME);
  }
});

test("claimManualRequest returns 'malformed' (never silently 'none') for a torn/corrupt request file, and is still single-use", () => {
  const { env } = makeScratchEnv("claim-malformed");
  try {
    const requestPath = manualRequestPath("x", env);
    fs.mkdirSync(path.dirname(requestPath), { recursive: true });
    // Missing required fields (no `nonce`/`requestedAt`) — a real file existed and was
    // claimed (won the rename), but its contents are not a usable request.
    fs.writeFileSync(requestPath, JSON.stringify({ somethingElse: true }));

    const claim = claimManualRequest({ loopId: "x", env });
    assert.equal(claim.status, "malformed", "a torn/invalid request must be an actionable, distinct status — not folded into 'none'");

    // Single-use: the malformed file was consumed by the claim (renamed away), so a second
    // claim attempt must find nothing pending, never re-discover/re-process the same bytes.
    assert.deepEqual(claimManualRequest({ loopId: "x", env }), { status: "none" });
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("claimManualRequest also treats syntactically-invalid JSON as 'malformed', never crashing or silently falling through to 'none'", () => {
  const { env } = makeScratchEnv("claim-malformed-torn-json");
  try {
    const requestPath = manualRequestPath("x", env);
    fs.mkdirSync(path.dirname(requestPath), { recursive: true });
    fs.writeFileSync(requestPath, '{"nonce": "abc", "requestedAt": ');

    const claim = claimManualRequest({ loopId: "x", env });
    assert.equal(claim.status, "malformed");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("claimManualRequest's internal claim temp filename uses a random token, not pid+timestamp — two claims from the same process in the same millisecond must never collide", () => {
  // Regression guard: a pid+Date.now() claim path can collide when two claims race from the
  // very same process within the same millisecond (e.g. a mocked/frozen clock, or a tight
  // loop), which would let one claim's rename/read/rm clobber another's in-flight claim
  // file. Force many claims back-to-back (real Date.now() resolution is coarser than these
  // calls run) and assert every single one succeeds cleanly with no EEXIST/ENOENT surprises
  // and no leftover `.claim.` temp files.
  const { env } = makeScratchEnv("claim-random-token");
  try {
    const now = new Date("2026-07-24T15:00:00Z");
    for (let i = 0; i < 25; i += 1) {
      writeManualRequest({ loopId: "x", nonce: `n-${i}`, requestedAt: now.toISOString(), env });
      const claim = claimManualRequest({ loopId: "x", env, now });
      assert.equal(claim.status, "claimed", `claim #${i} must succeed without a temp-name collision`);
      assert.equal(claim.nonce, `n-${i}`);
    }
    const requestDir = path.dirname(manualRequestPath("x", env));
    const leftovers = fs.readdirSync(requestDir).filter((name) => name.includes(".claim."));
    assert.deepEqual(leftovers, [], "no claim temp file may ever be left behind");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("verifyApproval fails closed when approval is missing, null, or fingerprint-mismatched", () => {
  const { env } = makeScratchEnv("approval-fail-closed");
  try {
    const loop = copilotLoopFixture();
    assert.equal(loop.approval.fingerprint, null);
    assert.equal(verifyApproval(loop, env).approved, false);

    const wrongFingerprint = copilotLoopFixture({
      lifecycle: "enabled",
      approval: { fingerprint: "a".repeat(64), approvedAt: "2026-07-24T15:00:00Z" },
    });
    assert.equal(verifyApproval(wrongFingerprint, env).approved, false);

    const malformed = { ...copilotLoopFixture(), approval: {} };
    assert.equal(verifyApproval(malformed, env).approved, false);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("verifyApproval approves only when the fingerprint matches the loop's current capability projection", () => {
  const { env } = makeScratchEnv("approval-match");
  try {
    const base = copilotLoopFixture({ lifecycle: "enabled" });
    base.approval = { fingerprint: "0".repeat(64), approvedAt: "2026-07-24T15:00:00Z" };
    const fingerprint = capabilityFingerprint(base);
    const approved = copilotLoopFixture({
      lifecycle: "enabled",
      approval: { fingerprint, approvedAt: "2026-07-24T15:00:00Z" },
    });
    assert.equal(verifyApproval(approved, env).approved, true);

    const drifted = copilotLoopFixture({
      lifecycle: "enabled",
      approval: { fingerprint, approvedAt: "2026-07-24T15:00:00Z" },
      execution: { ...base.execution, prompt: base.execution.prompt + " Also delete everything." },
    });
    assert.equal(verifyApproval(drifted, env).approved, false);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("verifyApproval fails closed on the approval.blocked sentinel even when the fingerprint still matches", () => {
  const { env } = makeScratchEnv("approval-blocked-sentinel");
  try {
    const base = copilotLoopFixture({ lifecycle: "enabled" });
    base.approval = { fingerprint: "0".repeat(64), approvedAt: "2026-07-24T15:00:00Z" };
    const fingerprint = capabilityFingerprint(base);
    const loop = copilotLoopFixture({
      lifecycle: "enabled",
      approval: { fingerprint, approvedAt: "2026-07-24T15:00:00Z" },
    });
    // Sanity: without the sentinel, this loop is approved.
    assert.equal(verifyApproval(loop, env).approved, true);

    const sentinelPath = approvalBlockedPath(loop.id, env);
    fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
    fs.writeFileSync(sentinelPath, "Needs review\n");

    const result = verifyApproval(loop, env);
    assert.equal(result.approved, false);
    assert.equal(result.reason, "blocked");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("verifyApproval denies (fail-closed) when the approval.blocked sentinel path is inaccessible for a reason OTHER than ENOENT — an EACCES/ENOTDIR must never be read as 'absent'", () => {
  const { env } = makeScratchEnv("approval-inaccessible-sentinel");
  try {
    const base = copilotLoopFixture({ lifecycle: "enabled" });
    base.approval = { fingerprint: "0".repeat(64), approvedAt: "2026-07-24T15:00:00Z" };
    const fingerprint = capabilityFingerprint(base);
    const loop = copilotLoopFixture({
      lifecycle: "enabled",
      approval: { fingerprint, approvedAt: "2026-07-24T15:00:00Z" },
    });
    // Sanity: without any filesystem trickery, this loop is approved.
    assert.equal(verifyApproval(loop, env).approved, true);

    // Replace the loop's own directory with a plain FILE, so `stat(approval.blocked)` fails
    // with ENOTDIR (a path component is not a directory) rather than ENOENT (the sentinel
    // itself genuinely absent). `fs.existsSync` would swallow this as "false"/absent and
    // silently approve the run; `verifyApproval` must instead deny it — via a DIFFERENT
    // reason than a real, confirmed absence, because the sentinel's state could not actually
    // be determined.
    const sentinelPath = approvalBlockedPath(loop.id, env);
    const loopDir = path.dirname(sentinelPath);
    fs.rmSync(loopDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(loopDir), { recursive: true });
    fs.writeFileSync(loopDir, "not a directory\n");

    const result = verifyApproval(loop, env);
    assert.equal(result.approved, false, "an inaccessible sentinel path must deny, never silently approve");
    assert.equal(result.reason, "validation-error", "must be distinguishable from a genuine ENOENT absence ('blocked' reason is for a confirmed-present sentinel; a real absence would approve)");
  } finally {
    // Undo the file-for-directory swap before the scratch root's recursive rm — rmSync
    // handles a plain file target fine regardless, but be explicit/defensive here.
    fs.rmSync(path.join(env.COPILOT_LOOPS_HOME, "tasks", "nightly-dependency-report"), { force: true });
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("listRuns is newest-first and skips directories without a readable run.json", () => {
  const { env } = makeScratchEnv("list-runs");
  try {
    const now = new Date("2026-07-24T15:00:00Z");
    const a = createRun({ loopId: "x", trigger: "schedule", env, now: new Date(now.getTime() - 2000) });
    const b = createRun({ loopId: "x", trigger: "schedule", env, now });
    fs.mkdirSync(path.join(path.dirname(a.dir), "garbage-dir"));

    const runs = listRuns("x", env);
    assert.deepEqual(runs.map((r) => r.id), [b.id, a.id]);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("lockDirectory uses the canonical active.lock name, and runPaths exposes stdout/stderr/copilot/cli-logs, no per-run state.json", () => {
  const { home, env } = makeScratchEnv("paths");
  try {
    assert.equal(lockDirectory("x", env), path.join(home, "tasks", "x", "active.lock"));
    const paths = runPaths("x", "run-1", env);
    assert.equal(paths.runJson, path.join(home, "tasks", "x", "runs", "run-1", "run.json"));
    assert.equal(paths.eventsLog, path.join(home, "tasks", "x", "runs", "run-1", "events.jsonl"));
    assert.equal(paths.stdoutLog, path.join(home, "tasks", "x", "runs", "run-1", "stdout.log"));
    assert.equal(paths.stderrLog, path.join(home, "tasks", "x", "runs", "run-1", "stderr.log"));
    assert.equal(paths.copilotLog, path.join(home, "tasks", "x", "runs", "run-1", "copilot.jsonl"));
    assert.equal(paths.cliLogsDir, path.join(home, "tasks", "x", "runs", "run-1", "cli-logs"));
    assert.equal(Object.hasOwn(paths, "stateJson"), false, "per-run state.json is retired in favor of loop-level state.json");
  } finally {
    cleanupScratch(home);
  }
});

test("appendEvent/readEvents survive a torn trailing line and never throw on read", () => {
  const { env } = makeScratchEnv("events-torn");
  try {
    const run = createRun({ loopId: "x", trigger: "schedule", env, now: new Date() });
    appendEvent(run.dir, "run.attempt.started", { number: 1 });
    fs.appendFileSync(run.paths.eventsLog, '{"type":"broken');
    const events = readEvents(run.paths);
    assert.equal(events.filter((e) => e.type === "run.attempt.started").length, 1);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("a non-absolute COPILOT_LOOPS_HOME fails closed (throws) rather than silently resolving against cwd", () => {
  // paths.mjs's stateRoot() now requires COPILOT_LOOPS_HOME to be absolute — every
  // run-state.mjs path helper built on top of loopDirectory() must propagate that failure,
  // not swallow it or fall back to a cwd-relative directory (which would previously have let
  // a misconfigured launchd EnvironmentVariables entry silently write state next to whatever
  // directory the process happened to start in).
  const relativeEnv = { COPILOT_LOOPS_HOME: "relative/loops-home" };
  assert.throws(() => lockDirectory("x", relativeEnv), /absolute path/);
  assert.throws(() => runPaths("x", "run-1", relativeEnv), /absolute path/);
  assert.throws(() => createRun({ loopId: "x", trigger: "schedule", env: relativeEnv, now: new Date() }), /absolute path/);
  assert.throws(() => readLoopState("x", relativeEnv), /absolute path/);

  // Sanity: the exact same call succeeds once given an absolute path.
  const { env } = makeScratchEnv("absolute-home-sanity");
  try {
    assert.doesNotThrow(() => lockDirectory("x", env));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

// ── Overlap-safe manual/retry requests ──────────────────────────────────────────────────

test("recordOverlapSkip writes a terminal skippedOverlap run without ever touching the loop's active/lastRun state", () => {
  const { env } = makeScratchEnv("overlap-skip-isolated");
  try {
    const loopId = "x";
    setActiveState(loopId, { currentRunId: "run-real-active", sessionId: "s-1", stage: "running", attempt: 1, pid: 4242 }, env);

    const result = recordOverlapSkip({ loopId, trigger: "manual", env, now: new Date("2026-07-24T15:00:00Z") });
    assert.equal(result.status, "skippedOverlap");
    assert.ok(result.runId);

    const record = readRun(runPaths(loopId, result.runId, env));
    assert.equal(record.status, "skippedOverlap");
    assert.equal(record.trigger, "manual");
    assert.equal(record.attempts.length, 0);

    // The genuinely active run's live state must be completely untouched.
    const state = readLoopState(loopId, env);
    assert.equal(state.active.currentRunId, "run-real-active");
    assert.equal(state.active.stage, "running");
    assert.equal(state.lastRun, null);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("recordOverlapSkip never collides run ids across two 'racing' overlap records for the same loop/second", () => {
  const { env } = makeScratchEnv("overlap-skip-race");
  try {
    const now = new Date("2026-07-24T15:00:00Z");
    const first = recordOverlapSkip({ loopId: "x", trigger: "schedule", env, now });
    const second = recordOverlapSkip({ loopId: "x", trigger: "schedule", env, now });
    assert.notEqual(first.runId, second.runId);
    assert.ok(readRun(runPaths("x", first.runId, env)));
    assert.ok(readRun(runPaths("x", second.runId, env)));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("requestManualRun queues the request normally when the lock is free", () => {
  const { env } = makeScratchEnv("request-manual-run-free");
  try {
    const result = requestManualRun({ loopId: "x", env, now: new Date("2026-07-24T15:00:00Z") });
    assert.equal(result.queued, true);
    assert.ok(result.request.nonce);
    assert.ok(fs.existsSync(manualRequestPath("x", env)));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("requestManualRun refuses to queue (and records a skippedOverlap instead) when the loop is currently active", () => {
  const { env } = makeScratchEnv("request-manual-run-active");
  try {
    const loopId = "x";
    fs.mkdirSync(path.dirname(lockDirectory(loopId, env)), { recursive: true });
    const held = acquireLock(lockDirectory(loopId, env));
    assert.ok(held);
    try {
      const result = requestManualRun({ loopId, env, now: new Date("2026-07-24T15:00:00Z") });
      assert.equal(result.queued, false);
      assert.equal(result.skip.status, "skippedOverlap");
      assert.ok(result.skip.runId);
      assert.equal(fs.existsSync(manualRequestPath(loopId, env)), false, "no request must ever be written while the loop is active");

      const record = readRun(runPaths(loopId, result.skip.runId, env));
      assert.equal(record.trigger, "manual");
    } finally {
      held.release();
    }
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("requestManualRun with retryOf: queues trigger='retry' when free, records trigger='retry' when active", () => {
  const { env } = makeScratchEnv("request-manual-run-retry");
  try {
    const loopId = "x";
    const now = new Date("2026-07-24T15:00:00Z");

    const queuedResult = requestManualRun({ loopId, retryOf: "run-20260101000000", env, now });
    assert.equal(queuedResult.queued, true);
    assert.equal(queuedResult.request.retryOf, "run-20260101000000");
    // Consume it so the loop is clean for the next assertion.
    fs.rmSync(manualRequestPath(loopId, env), { force: true });

    fs.mkdirSync(path.dirname(lockDirectory(loopId, env)), { recursive: true });
    const held = acquireLock(lockDirectory(loopId, env));
    try {
      const activeResult = requestManualRun({ loopId, retryOf: "run-20260101000000", env, now });
      assert.equal(activeResult.queued, false);
      const record = readRun(runPaths(loopId, activeResult.skip.runId, env));
      assert.equal(record.trigger, "retry");
      assert.equal(record.retryOf, "run-20260101000000");
    } finally {
      held.release();
    }
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

// ── initializeScheduleBaseline (enable/reconcile-time bootstrap) ────────────────────────

test("initializeScheduleBaseline anchors an interval schedule's nextExpectedAt to load-time + seconds (not the runner's first invocation)", () => {
  const { env } = makeScratchEnv("init-baseline-interval");
  try {
    const loopId = "nightly-interval";
    const schedule = { kind: "interval", seconds: 3600, graceSeconds: 60 };
    const enableTime = new Date("2026-07-24T15:00:00Z");

    const baseline = initializeScheduleBaseline({ loopId, schedule, env, now: enableTime });
    assert.equal(baseline.schedule.nextExpectedAt, "2026-07-24T16:00:00.000Z");

    // Persisted, and independently readable — this is exactly what the runner's own
    // schedule assessment will read on its first real invocation.
    assert.deepEqual(readScheduleState(loopId, env), {
      consumedAt: null,
      lastScheduledAt: null,
      nextExpectedAt: "2026-07-24T16:00:00.000Z",
    });
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("initializeScheduleBaseline resets from a clean slate — a schedule CHANGE must not leak the old interval's baseline", () => {
  const { env } = makeScratchEnv("init-baseline-reset");
  try {
    const loopId = "x";
    // An old, stale baseline computed under a DIFFERENT (previous) interval length.
    writeScheduleState(loopId, { consumedAt: null, lastScheduledAt: null, nextExpectedAt: "2026-07-24T15:05:00.000Z" }, env);

    const newSchedule = { kind: "interval", seconds: 7200, graceSeconds: 60 };
    const now = new Date("2026-07-24T15:00:00Z");
    const baseline = initializeScheduleBaseline({ loopId, schedule: newSchedule, env, now });

    // Anchored to the NEW schedule's interval from `now`, not the stale leftover value.
    assert.equal(baseline.schedule.nextExpectedAt, "2026-07-24T17:00:00.000Z");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("initializeScheduleBaseline is safe/idempotent to call for calendar and once schedules too", () => {
  const { env } = makeScratchEnv("init-baseline-other-kinds");
  try {
    const now = new Date("2026-07-24T15:00:00Z");
    assert.doesNotThrow(() =>
      initializeScheduleBaseline({ loopId: "cal", schedule: { kind: "calendar", hour: 1, minute: 0, weekdays: [], graceSeconds: 300 }, env, now }),
    );
    assert.doesNotThrow(() =>
      initializeScheduleBaseline({ loopId: "once", schedule: { kind: "once", scheduledAt: "2026-07-25T01:00:00Z", graceSeconds: 300 }, env, now }),
    );
    assert.doesNotThrow(() => initializeScheduleBaseline({ loopId: "manual", schedule: { kind: "manual" }, env, now }));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

// ── recoverCrashStaleActiveRun (crash-stale `state.active` + orphaned-group reconciliation) ──

/** DI bundle for "nothing recorded in state.active is alive any more". */
const nothingAlive = {
  isProcessAlive: () => false,
  isGroupAlive: () => false,
  stopGroup: async () => {
    throw new Error("stopGroup must never be called when nothing is alive");
  },
};

test("recoverCrashStaleActiveRun finalizes a crash-stale active run as failed, clears state.active, and records a run.crash.recovered event", async () => {
  const { env } = makeScratchEnv("crash-recover-active");
  try {
    const loopId = "x";
    const now = new Date("2026-07-24T15:00:00Z");
    const run = createRun({ loopId, trigger: "schedule", env, now });
    beginAttempt(run.paths, { number: 1, startedAt: now.toISOString() });
    setActiveState(loopId, { currentRunId: run.id, sessionId: run.record.sessionId, stage: "running", attempt: 1, pid: 424242 }, env);

    const result = await recoverCrashStaleActiveRun({
      loopId,
      env,
      now: new Date("2026-07-24T15:05:00Z"),
      ...nothingAlive, // simulate: the pid/group recorded in `active` is confirmed dead
    });
    assert.deepEqual(result.recovered, [run.id]);
    assert.equal(result.blocked, false);
    assert.equal(result.orphan, null, "nothing was alive, so no orphan teardown may be reported");

    const record = readRun(run.paths);
    assert.equal(record.status, "failed", "a crash is a failure outcome — never success/timeout/cancel, none of which actually happened");
    assert.equal(record.exitCode, null);
    assert.equal(record.signal, null);
    assert.equal(record.endedAt, "2026-07-24T15:05:00.000Z");

    const eventTypes = readEvents(run.paths).map((e) => e.type);
    assert.ok(eventTypes.includes("run.crash.recovered"), "must record an auditable crash-recovery event");
    assert.equal(eventTypes.at(-1), "run.stage", "must also close out the stage sequence with a terminal stage event");

    const state = readLoopState(loopId, env);
    assert.equal(state.active, null, "state.active must be cleared so the UI/history stop showing this run as running forever");
    assert.equal(state.lastRun.runId, run.id);
    assert.equal(state.lastRun.status, "failed");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("recoverCrashStaleActiveRun tears a still-live orphan group down with stopGroup FIRST, and only then finalizes/clears", async () => {
  // The crash case that makes the lock a liar: the runner died, so its lock is stale and
  // stealable, but the detached child group it spawned is still alive. That group must be
  // terminated with the standard teardown machinery before any bookkeeping is touched.
  const { env } = makeScratchEnv("crash-recover-orphan-killed");
  try {
    const loopId = "x";
    const now = new Date("2026-07-24T15:00:00Z");
    const run = createRun({ loopId, trigger: "schedule", env, now });
    beginAttempt(run.paths, { number: 1, startedAt: now.toISOString() });
    setActiveState(loopId, { currentRunId: run.id, sessionId: run.record.sessionId, stage: "running", attempt: 1, pid: 424242, pgid: 424242 }, env);

    let alive = true;
    const stopCalls = [];
    const result = await recoverCrashStaleActiveRun({
      loopId,
      env,
      now: new Date("2026-07-24T15:05:00Z"),
      isProcessAlive: () => alive,
      isGroupAlive: () => alive,
      stopGroup: async (pgid, options) => {
        stopCalls.push({ pgid, options });
        alive = false; // the group actually died under TERM/KILL
        return "killed";
      },
    });

    assert.equal(stopCalls.length, 1, "the orphan group must be torn down exactly once");
    assert.equal(stopCalls[0].pgid, 424242, "teardown must target the recorded process GROUP, not just the leader pid");
    assert.equal(typeof stopCalls[0].options.isGroupAliveFn, "function", "the liveness probe must be threaded into stopGroup");
    assert.deepEqual(result.orphan, { pid: 424242, pgid: 424242, result: "killed", terminated: true });
    assert.equal(result.blocked, false);
    assert.deepEqual(result.recovered, [run.id], "only after the group is confirmed dead may the run be finalized");

    assert.equal(readRun(run.paths).status, "failed");
    const eventTypes = readEvents(run.paths).map((e) => e.type);
    assert.ok(eventTypes.includes("run.orphan.terminated"), "the orphan teardown must be auditable on the run it belonged to");
    assert.ok(eventTypes.indexOf("run.orphan.terminated") < eventTypes.indexOf("run.crash.recovered"), "teardown must precede finalization");
    assert.equal(readLoopState(loopId, env).active, null, "active may only be cleared once the group is confirmed dead");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("recoverCrashStaleActiveRun fails closed (blocked) when an orphan group cannot be confirmed dead — nothing is finalized, cleared, or clobbered", async () => {
  const { env } = makeScratchEnv("crash-recover-orphan-blocked");
  try {
    const loopId = "x";
    const now = new Date("2026-07-24T15:00:00Z");
    const run = createRun({ loopId, trigger: "schedule", env, now });
    beginAttempt(run.paths, { number: 1, startedAt: now.toISOString() });
    setActiveState(loopId, { currentRunId: run.id, sessionId: run.record.sessionId, stage: "running", attempt: 1, pid: 424242, pgid: 424242 }, env);

    const result = await recoverCrashStaleActiveRun({
      loopId,
      env,
      now: new Date("2026-07-24T15:05:00Z"),
      isProcessAlive: () => true,
      isGroupAlive: () => true, // never confirms dead, however hard it is signaled
      stopGroup: async () => "kill-failed",
    });

    assert.equal(result.blocked, true);
    assert.equal(result.orphan.terminated, false);
    assert.equal(result.orphan.result, "kill-failed");
    assert.deepEqual(result.recovered, [], "a live orphan's run must never be finalized out from under it");

    const record = readRun(run.paths);
    assert.equal(record.status, "running", "an actually-running run's record must be left completely untouched");
    assert.equal(
      readEvents(run.paths).filter((e) => e.type === "run.crash.recovered").length,
      0,
      "no crash recovery may be fabricated for a run whose group is still alive",
    );
    assert.ok(readEvents(run.paths).some((e) => e.type === "run.orphan.blocked"), "the blocked teardown must be auditable");

    const state = readLoopState(loopId, env);
    assert.equal(state.active.currentRunId, run.id, "the active pointer must survive as the durable orphan marker");
    assert.equal(state.active.pid, 424242, "the recorded pid/pgid must never be lost — it is what the next invocation retries against");
    assert.equal(state.active.pgid, 424242);
    assert.equal(state.active.orphan.reason, "orphan-teardown-unconfirmed");
    assert.equal(state.active.orphan.detail, "kill-failed");
    assert.equal(state.lastRun, null, "a blocked recovery must not publish a last-run summary for a run that never ended");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("recoverCrashStaleActiveRun repeats the bounded teardown on every invocation, and self-heals the moment the orphan finally dies", async () => {
  const { env } = makeScratchEnv("crash-recover-orphan-selfheal");
  try {
    const loopId = "x";
    const now = new Date("2026-07-24T15:00:00Z");
    const run = createRun({ loopId, trigger: "schedule", env, now });
    beginAttempt(run.paths, { number: 1, startedAt: now.toISOString() });
    finalizeRun(run.paths, { status: "timedOut", exitCode: null, signal: "SIGKILL", endedAt: now.toISOString() });
    // Exactly what a previous fire leaves behind when its own teardown was unconfirmed: a
    // finalized run, a published lastRun, and `active` retained purely as the orphan marker.
    markActiveOrphan(
      loopId,
      { runId: run.id, pid: 424242, pgid: 424242, reason: "teardown-unconfirmed", at: now.toISOString() },
      { runId: run.id, status: "timedOut", exitCode: null, signal: "SIGKILL", endedAt: now.toISOString() },
      env,
    );

    const blocked = await recoverCrashStaleActiveRun({
      loopId,
      env,
      now: new Date("2026-07-24T15:05:00Z"),
      isProcessAlive: () => true,
      isGroupAlive: () => true,
      stopGroup: async () => "kill-failed",
    });
    assert.equal(blocked.blocked, true);
    const stillMarked = readLoopState(loopId, env);
    assert.equal(stillMarked.active.orphan.since, now.toISOString(), "the marker's age must survive repeated observations");
    assert.equal(stillMarked.active.orphan.observedAt, "2026-07-24T15:05:00.000Z");

    const healed = await recoverCrashStaleActiveRun({
      loopId,
      env,
      now: new Date("2026-07-24T15:10:00Z"),
      ...nothingAlive, // the orphan finally exited on its own
    });
    assert.equal(healed.blocked, false);
    assert.deepEqual(healed.recovered, [], "an already-finalized run must never be re-finalized by the self-heal");

    const state = readLoopState(loopId, env);
    assert.equal(state.active, null, "with the group provably gone, the marker is cleared and the loop can fire again");
    assert.equal(state.lastRun.status, "timedOut", "the run's real terminal outcome must be preserved exactly");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("recoverCrashStaleActiveRun also recovers a nonterminal run that state.active never (or no longer) points at", async () => {
  // A crash between createRun and the very first setActiveState call leaves an orphaned
  // run.json stuck at "starting"/"running" that no `active` pointer ever referenced. This
  // must still be reconciled — not just whatever `state.active` happens to name.
  const { env } = makeScratchEnv("crash-recover-orphan");
  try {
    const loopId = "x";
    const now = new Date("2026-07-24T15:00:00Z");
    const orphan = createRun({ loopId, trigger: "schedule", env, now }); // never gets setActiveState

    const result = await recoverCrashStaleActiveRun({ loopId, env, now: new Date("2026-07-24T15:05:00Z"), ...nothingAlive });
    assert.deepEqual(result.recovered, [orphan.id]);
    assert.equal(readRun(orphan.paths).status, "failed");

    // No active pointer existed, so there is nothing to clear — this must not throw or
    // fabricate a lastRun/active entry out of nothing.
    const state = readLoopState(loopId, env);
    assert.equal(state.active, null);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("recoverCrashStaleActiveRun never touches an already-terminal run, and clears a leftover state.active pointer even if its run is already terminal", async () => {
  // A crash between finalizeRun and clearActiveState in a PREVIOUS invocation's own finally
  // block can leave a terminal run.json behind with a stale `active` pointer still naming
  // it. Recovery must clear the pointer without re-finalizing (and without re-emitting a
  // crash event for) an already-terminal run.
  const { env } = makeScratchEnv("crash-recover-already-terminal");
  try {
    const loopId = "x";
    const now = new Date("2026-07-24T15:00:00Z");
    const run = createRun({ loopId, trigger: "schedule", env, now });
    beginAttempt(run.paths, { number: 1, startedAt: now.toISOString() });
    endAttempt(run.paths, { number: 1, endedAt: now.toISOString(), exitCode: 0, signal: null });
    finalizeRun(run.paths, { status: "succeeded", exitCode: 0, signal: null, endedAt: now.toISOString() });
    setActiveState(loopId, { currentRunId: run.id, sessionId: run.record.sessionId, stage: "finalizing", attempt: 1, pid: 424242 }, env);

    const result = await recoverCrashStaleActiveRun({ loopId, env, now: new Date("2026-07-24T15:05:00Z"), ...nothingAlive });
    assert.deepEqual(result.recovered, [], "an already-terminal run must never be re-finalized/re-recovered");

    const record = readRun(run.paths);
    assert.equal(record.status, "succeeded", "the real, already-terminal outcome must be preserved exactly");
    assert.equal(
      readEvents(run.paths).filter((e) => e.type === "run.crash.recovered").length,
      0,
      "no crash event may be fabricated for a run that actually finished cleanly",
    );

    const state = readLoopState(loopId, env);
    assert.equal(state.active, null, "the stale pointer must still be cleared even though the run it named was already terminal");
    assert.equal(state.lastRun.runId, run.id);
    assert.equal(state.lastRun.status, "succeeded");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("markActiveOrphan publishes lastRun and retains active as the orphan marker in a single atomic write", () => {
  const { env } = makeScratchEnv("mark-active-orphan");
  try {
    const loopId = "x";
    const now = new Date("2026-07-24T15:00:00Z");
    const run = createRun({ loopId, trigger: "schedule", env, now });
    setActiveState(loopId, { currentRunId: run.id, sessionId: run.record.sessionId, stage: "running", attempt: 1, pid: 4242, pgid: 4242 }, env);

    markActiveOrphan(
      loopId,
      { runId: run.id, reason: "teardown-unconfirmed", at: now.toISOString() },
      { runId: run.id, status: "timedOut", exitCode: null, signal: "SIGKILL", endedAt: now.toISOString() },
      env,
    );

    const state = readLoopState(loopId, env);
    assert.equal(state.lastRun.status, "timedOut", "history/UI must still see the run's real outcome");
    assert.equal(state.active.stage, "stopping");
    assert.equal(state.active.pid, 4242, "omitted pid/pgid must preserve whatever the spawn recorded");
    assert.equal(state.active.pgid, 4242);
    assert.equal(state.active.sessionId, run.record.sessionId, "unrelated active fields must be preserved");
    assert.equal(state.active.orphan.reason, "teardown-unconfirmed");
    assert.equal(state.active.orphan.since, now.toISOString());
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});
