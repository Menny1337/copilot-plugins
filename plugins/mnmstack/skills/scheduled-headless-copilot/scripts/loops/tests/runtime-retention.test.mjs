import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { enforceRetention } from "../lib/retention.mjs";
import { createRun, finalizeRun, listRuns } from "../lib/run-state.mjs";
import { makeScratchEnv, cleanupScratch, cleanupScratchRoot } from "./runtime-helpers.mjs";

test.after(cleanupScratchRoot);

function seedRun(loopId, env, { now, status, ageMs = 0 }) {
  const startedAt = new Date(now.getTime() - ageMs);
  const run = createRun({ loopId, trigger: "schedule", env, now: startedAt });
  finalizeRun(run.paths, { status, endedAt: startedAt.toISOString() });
  return run;
}

test("enforceRetention prunes runs older than `days` beyond the `maxRuns` floor", () => {
  const { env } = makeScratchEnv("retention-days");
  try {
    const loopId = "nightly-report";
    const now = new Date("2026-07-24T12:00:00Z");
    const DAY = 24 * 60 * 60 * 1000;

    // 5 succeeded runs: ages 0, 10, 20, 40, 400 days.
    for (const ageDays of [400, 40, 20, 10, 0]) {
      seedRun(loopId, env, { now, status: "succeeded", ageMs: ageDays * DAY });
      // Ensure distinct run ids even though seeds share a millisecond-precision clock input.
    }

    const removed = enforceRetention({ loopId, retention: { days: 30, maxRuns: 100 }, env, now });
    // The 40- and 400-day-old runs exceed `days`; `maxRuns` (100) never binds here.
    assert.equal(removed.length, 2);

    const remaining = listRuns(loopId, env);
    assert.equal(remaining.length, 3);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("enforceRetention keeps at most `maxRuns` recent runs even when all are within `days`", () => {
  const { env } = makeScratchEnv("retention-maxruns");
  try {
    const loopId = "frequent-loop";
    const now = new Date("2026-07-24T12:00:00Z");

    for (let i = 0; i < 5; i += 1) {
      seedRun(loopId, env, { now, status: "succeeded", ageMs: i * 1000 });
    }

    const removed = enforceRetention({ loopId, retention: { days: 30, maxRuns: 3 }, env, now });
    assert.equal(removed.length, 2, "only the 2 oldest beyond the floor of 3 should be pruned");
    assert.equal(listRuns(loopId, env).length, 3);
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("enforceRetention never prunes a run that is still in-flight, however old", () => {
  const { env } = makeScratchEnv("retention-active");
  try {
    const loopId = "long-runner";
    const now = new Date("2026-07-24T12:00:00Z");
    const DAY = 24 * 60 * 60 * 1000;

    const stillRunning = createRun({ loopId, trigger: "schedule", env, now: new Date(now.getTime() - 400 * DAY) });
    // Deliberately left in "running" status (non-terminal) — never finalized.

    const removed = enforceRetention({ loopId, retention: { days: 1, maxRuns: 1 }, env, now });
    assert.equal(removed.length, 0);
    assert.ok(fs.existsSync(stillRunning.dir), "an in-flight run directory must survive pruning");
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});

test("enforceRetention rejects a malformed retention policy rather than silently no-op", () => {
  const { env } = makeScratchEnv("retention-invalid");
  try {
    assert.throws(() => enforceRetention({ loopId: "x", retention: { days: 0, maxRuns: 10 }, env }));
    assert.throws(() => enforceRetention({ loopId: "x", retention: { days: 10, maxRuns: 0 }, env }));
  } finally {
    cleanupScratch(env.COPILOT_LOOPS_HOME);
  }
});
