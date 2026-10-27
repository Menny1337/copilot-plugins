// run-state.mjs — stable run IDs/directories, the on-disk run record, and the loop-level
// canonical live-state file for a fire of a loop.
//
// Layout under `<loopDirectory>` (loopDirectory comes from the read-only ../lib/paths.mjs
// contract):
//   state.json            — canonical LOOP-level live state: schedule baseline
//                            (consumedAt/lastScheduledAt/nextExpectedAt), the currently
//                            active run's stage/pid/pgid/attempt (or null when idle), and a
//                            compact last-run summary. Atomic writes; crash-safe (a reader
//                            never observes a half-written file, and `active` is always
//                            cleared before the process that owns it can vanish mid-write).
//                            `active` — NOT the lock directory, whose pid is the runner's own
//                            and therefore stale the instant that runner exits — is the
//                            durable record that a spawned process group may still be alive:
//                            it is only ever cleared once that group is confirmed dead (see
//                            `markActiveOrphan` / `recoverCrashStaleActiveRun`).
//   active.lock/           — the single-flight lock directory (see ./locks.mjs)
//   manual-request.json    — a pending manual/retry-run request, consumed exactly once
//   approval.blocked       — sentinel written by the control plane (see ../lib/store.mjs);
//                            its mere existence fails a run closed regardless of fingerprint
//   runs/<runId>/
//     run.json             — the durable record described by contracts/run.schema.json
//     events.jsonl          — append-only lifecycle log (one JSON object per line), including
//                            stable stage events: preflight, starting, running, retrying,
//                            stopping, finalizing, terminal
//     stdout.log            — script/executable stdout (or Copilot's stderr — see below)
//     stderr.log            — script/executable stderr, and Copilot's stderr
//     copilot.jsonl          — Copilot's stdout (JSONL, from --output-format json)
//     cli-logs/              — passed to `copilot --log-dir` for this run's attempts

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  atomicWriteJSONSync,
  appendJSONLineSync,
  readJSONIfExistsSync,
  readJSONLinesSync,
} from "./atomic.mjs";
import { loopDirectory } from "./paths.mjs";
import { capabilityFingerprint, validateRunRecord, RUN_STATUSES, RUN_TRIGGERS } from "./contracts.mjs";
import { isLockHeld } from "./locks.mjs";
import {
  isProcessAlive as defaultIsProcessAlive,
  isGroupAlive as defaultIsGroupAlive,
  stopGroup as defaultStopGroup,
} from "./process-tree.mjs";
import { assessSchedule } from "./schedule.mjs";

export const RUN_SCHEMA_VERSION = 1;
export { RUN_STATUSES, RUN_TRIGGERS };

/** Stable stage names emitted as `run.stage` events and mirrored into `state.json`'s
 * `active.stage` field, in the order a normal run passes through them. */
export const RUN_STAGES = Object.freeze([
  "preflight",
  "starting",
  "running",
  "retrying",
  "stopping",
  "finalizing",
  "terminal",
]);

// Which RUN_STATUSES values are terminal (a run record in one of these states is done and
// will never change again). contracts.mjs owns the full status set; this is a narrower,
// run-state-local classification it does not define.
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "timedOut",
  "cancelled",
  "skippedOverlap",
  "skippedMissed",
  "skippedPaused",
  "approvalBlocked",
  "launchFailed",
]);

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

// ── Paths ────────────────────────────────────────────────────────────────────────────────

export function runsRoot(loopId, env = process.env) {
  return path.join(loopDirectory(loopId, env), "runs");
}

export function runDirectory(loopId, runId, env = process.env) {
  return path.join(runsRoot(loopId, env), runId);
}

export function runPaths(loopId, runId, env = process.env) {
  const dir = runDirectory(loopId, runId, env);
  return {
    dir,
    runJson: path.join(dir, "run.json"),
    eventsLog: path.join(dir, "events.jsonl"),
    stdoutLog: path.join(dir, "stdout.log"),
    stderrLog: path.join(dir, "stderr.log"),
    copilotLog: path.join(dir, "copilot.jsonl"),
    cliLogsDir: path.join(dir, "cli-logs"),
  };
}

export function lockDirectory(loopId, env = process.env) {
  return path.join(loopDirectory(loopId, env), "active.lock");
}

export function manualRequestPath(loopId, env = process.env) {
  return path.join(loopDirectory(loopId, env), "manual-request.json");
}

export function approvalBlockedPath(loopId, env = process.env) {
  return path.join(loopDirectory(loopId, env), "approval.blocked");
}

export function loopStatePath(loopId, env = process.env) {
  return path.join(loopDirectory(loopId, env), "state.json");
}

function pad(n, width) {
  return String(n).padStart(width, "0");
}

/** `run-YYYYMMDDHHMMSS` in UTC, matching contracts/fixtures/run.json. */
export function formatRunTimestamp(date) {
  return (
    "run-" +
    pad(date.getUTCFullYear(), 4) +
    pad(date.getUTCMonth() + 1, 2) +
    pad(date.getUTCDate(), 2) +
    pad(date.getUTCHours(), 2) +
    pad(date.getUTCMinutes(), 2) +
    pad(date.getUTCSeconds(), 2)
  );
}

// ── Run record lifecycle ────────────────────────────────────────────────────────────────

/**
 * Create a fresh run directory and its initial run.json. Collisions (two fires in the same
 * second) are resolved by trying suffixed candidate ids under an exclusive mkdir — the
 * directory creation itself is the uniqueness check, so this is race-safe across processes.
 * Mints and stores a stable per-run `sessionId` (UUID), reused as Copilot's `--session-id`
 * across every attempt of the run — never the run id itself, which is not a UUID.
 */
export function createRun({ loopId, trigger, scheduledFor = null, retryOf = null, env = process.env, now = new Date() }) {
  if (!RUN_TRIGGERS.has(trigger)) throw new TypeError(`unsupported trigger: ${trigger}`);
  const root = runsRoot(loopId, env);
  fs.mkdirSync(root, { recursive: true });

  const base = formatRunTimestamp(now);
  let id = base;
  let dir = path.join(root, id);
  let attempt = 1;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      attempt += 1;
      id = `${base}-${attempt}`;
      dir = path.join(root, id);
      if (attempt > 1000) throw new Error(`could not allocate a unique run id under ${root}`);
    }
  }

  const record = {
    schemaVersion: RUN_SCHEMA_VERSION,
    id,
    loopId,
    sessionId: randomUUID(),
    trigger,
    status: "starting",
    scheduledFor,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    signal: null,
    retryOf,
    attempts: [],
  };
  validateRunRecord(record);
  const paths = runPaths(loopId, id, env);
  atomicWriteJSONSync(paths.runJson, record);
  appendEvent(paths.dir, "run.created", { trigger, scheduledFor, retryOf, sessionId: record.sessionId });
  return { id, dir: paths.dir, paths, record };
}

export function readRun(dirOrPaths) {
  const runJson = typeof dirOrPaths === "string" ? path.join(dirOrPaths, "run.json") : dirOrPaths.runJson;
  return readJSONIfExistsSync(runJson);
}

function writeRun(dirOrPaths, record) {
  validateRunRecord(record);
  const runJson = typeof dirOrPaths === "string" ? path.join(dirOrPaths, "run.json") : dirOrPaths.runJson;
  atomicWriteJSONSync(runJson, record);
}

/**
 * Read-modify-write run.json with `mutate(clone) -> void|record`. `clone` is a deep copy of
 * the current record; a mutator that edits `clone` in place and returns nothing (the common
 * case) has its edits persisted — it does NOT fall back to the pre-mutation original. Every
 * write is validated against the shared run-record contract before it touches disk.
 */
export function patchRun(dirOrPaths, mutate) {
  const current = readRun(dirOrPaths);
  if (!current) throw new Error("patchRun: run.json does not exist");
  const clone = structuredClone(current);
  const returned = mutate(clone);
  const next = returned ?? clone;
  writeRun(dirOrPaths, next);
  return next;
}

export function appendEvent(dir, type, data = {}) {
  const eventsLog = typeof dir === "string" ? path.join(dir, "events.jsonl") : dir.eventsLog;
  appendJSONLineSync(eventsLog, { ts: new Date().toISOString(), type, ...data });
}

/** Append a stable `run.stage` event — see `RUN_STAGES` for the canonical stage names. */
export function appendStageEvent(dir, stage, data = {}) {
  if (!RUN_STAGES.includes(stage)) throw new TypeError(`unsupported run stage: ${stage}`);
  appendEvent(dir, "run.stage", { stage, ...data });
}

export function readEvents(dirOrPaths) {
  const eventsLog = typeof dirOrPaths === "string" ? path.join(dirOrPaths, "events.jsonl") : dirOrPaths.eventsLog;
  return readJSONLinesSync(eventsLog);
}

/** Mark attempt `number` as started; sets the run-level `startedAt`/`status` on the first attempt. */
export function beginAttempt(dirOrPaths, { number, startedAt = new Date().toISOString() }) {
  return patchRun(dirOrPaths, (run) => {
    run.status = "running";
    if (run.startedAt === null) run.startedAt = startedAt;
    run.attempts.push({ number, startedAt, endedAt: null, exitCode: null, signal: null });
  });
}

/** Record the outcome of attempt `number`. Does not change run-level status/endedAt — call
 * `finalizeRun` once retries are exhausted or the run has otherwise reached a terminal state. */
export function endAttempt(dirOrPaths, { number, endedAt = new Date().toISOString(), exitCode = null, signal = null }) {
  return patchRun(dirOrPaths, (run) => {
    const entry = run.attempts.find((a) => a.number === number);
    if (entry) {
      entry.endedAt = endedAt;
      entry.exitCode = exitCode;
      entry.signal = signal;
    }
  });
}

/** Set the run's terminal status/exitCode/signal/endedAt. */
export function finalizeRun(dirOrPaths, { status, exitCode = null, signal = null, endedAt = new Date().toISOString() }) {
  if (!isTerminalStatus(status)) throw new TypeError(`finalizeRun: not a terminal status: ${status}`);
  return patchRun(dirOrPaths, (run) => {
    run.status = status;
    run.exitCode = exitCode;
    run.signal = signal;
    run.endedAt = endedAt;
  });
}

// ── Canonical loop-level live state (state.json) ────────────────────────────────────────

function defaultLoopState(loopId) {
  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    loopId,
    schedule: { consumedAt: null, lastScheduledAt: null, nextExpectedAt: null },
    active: null,
    lastRun: null,
    updatedAt: null,
  };
}

export function readLoopState(loopId, env = process.env) {
  return readJSONIfExistsSync(loopStatePath(loopId, env)) ?? defaultLoopState(loopId);
}

function writeLoopState(loopId, state, env = process.env) {
  const record = { ...state, loopId, updatedAt: new Date().toISOString() };
  atomicWriteJSONSync(loopStatePath(loopId, env), record);
  return record;
}

/** Read-modify-write state.json with `mutate(clone) -> void|state`, same void-mutator
 * semantics as `patchRun`. */
export function patchLoopState(loopId, mutate, env = process.env) {
  const clone = structuredClone(readLoopState(loopId, env));
  const returned = mutate(clone);
  return writeLoopState(loopId, returned ?? clone, env);
}

/** Merge `patch` into the current `active` run-progress view and bump its stage, creating
 * `active` if this is the first call for a new run. Every field the runner tracks live
 * (currentRunId, sessionId, stage, pid, pgid, attempt, startedAt) flows through here. */
export function setActiveState(loopId, patch, env = process.env) {
  if (patch.stage !== undefined && !RUN_STAGES.includes(patch.stage)) {
    throw new TypeError(`unsupported run stage: ${patch.stage}`);
  }
  return patchLoopState(
    loopId,
    (state) => {
      state.active = { startedAt: new Date().toISOString(), ...(state.active ?? {}), ...patch };
    },
    env,
  );
}

/** Clear `active` (crash-safely, via the same atomic write as every other state.json update)
 * and record a compact last-run summary. Called once a run reaches a terminal status AND its
 * process group has been confirmed dead — see `markActiveOrphan` for the case where that
 * confirmation could not be obtained. */
export function clearActiveState(loopId, lastRun, env = process.env) {
  return patchLoopState(
    loopId,
    (state) => {
      state.active = null;
      if (lastRun) state.lastRun = lastRun;
    },
    env,
  );
}

/**
 * The durable, cross-process "a process group from this loop may still be alive" marker.
 *
 * `active.lock` cannot carry this fact across invocations: the lock records the RUNNER's own
 * pid, so the instant that runner returns/exits the lock is stale and the very next
 * invocation is entitled to steal it (see ./locks.mjs) — even though the run's detached
 * child GROUP (recorded as `active.pid`/`active.pgid`) may still be alive. `state.json` is
 * the only thing that survives the runner process, so `active` — not the lock — is the
 * authoritative record of a possibly-live group:
 *
 *   `active` is non-null exactly while a spawned process group may still be alive, and is
 *   only ever cleared once that group's death has been confirmed.
 *
 * This is the terminal-status counterpart of `clearActiveState`: it publishes the run's real
 * `lastRun` summary (so history/UI show the true outcome) while KEEPING `active` as an
 * orphan marker naming the group that could not be confirmed dead. Both halves land in a
 * single atomic write, so no crash window can publish the summary while losing the marker.
 * `recoverCrashStaleActiveRun` is what eventually reconciles it (terminate the group, then
 * clear), and `loops-runner.mjs` refuses to spawn anything new while it is unreconciled.
 *
 * `pid`/`pgid` are left exactly as they are when omitted (the values the spawn recorded);
 * `orphan.since` is preserved across repeated observations so the marker's age stays honest.
 */
export function markActiveOrphan(
  loopId,
  { runId = null, pid, pgid, reason, at = new Date().toISOString(), detail = null },
  lastRun = null,
  env = process.env,
) {
  return patchLoopState(
    loopId,
    (state) => {
      if (lastRun) state.lastRun = lastRun;
      const active = state.active ?? {};
      state.active = {
        ...active,
        ...(runId ? { currentRunId: runId } : {}),
        ...(pid !== undefined ? { pid } : {}),
        ...(pgid !== undefined ? { pgid } : {}),
        stage: "stopping",
        orphan: {
          reason,
          since: active.orphan?.since ?? at,
          observedAt: at,
          ...(detail === null ? {} : { detail }),
        },
      };
    },
    env,
  );
}

export function readScheduleState(loopId, env = process.env) {
  return readLoopState(loopId, env).schedule ?? { consumedAt: null, lastScheduledAt: null, nextExpectedAt: null };
}

/** Persist an updated schedule baseline (the `state` object `assessSchedule` returns). Every
 * schedule-trigger invocation should persist this, even when the fire is not due — that is
 * how an interval schedule's `nextExpectedAt` baseline survives across invocations instead
 * of being silently recomputed (and the fire indefinitely delayed) on every poll. */
export function writeScheduleState(loopId, scheduleState, env = process.env) {
  return patchLoopState(
    loopId,
    (state) => {
      state.schedule = scheduleState;
    },
    env,
  );
}

/**
 * Atomically (re)initialize a loop's schedule baseline as of `now` — from a completely
 * clean slate, exactly as if nothing had ever been scheduled. This exists for the
 * enable/reconcile control-plane flow, at the precise moment it loads/bootstraps a loop's
 * LaunchAgent (or whenever the loop's `schedule` itself changes), NOT for the runner's own
 * per-invocation assessment (see `writeScheduleState`, which preserves the existing
 * baseline instead).
 *
 * Why this matters: an interval schedule's `assessSchedule`, given no prior baseline,
 * initializes `nextExpectedAt` to `now + seconds` and reports "not due yet" — it does not
 * fire immediately. If nothing calls this BEFORE launchd's own `StartInterval` timer starts
 * ticking, the runner's own first invocation (which happens at load-time + one full
 * interval, per launchd's StartInterval semantics) ends up being the one that establishes
 * the baseline — silently pushing the loop's actual first run to load-time + TWO full
 * intervals instead of one. Calling this at load/bootstrap time instead means the baseline
 * is already anchored to (approximately) the same "now" launchd itself used to schedule
 * that first tick, so the runner's first real invocation correctly reports due.
 *
 * A schedule CHANGE (not just a fresh enable) must also call this — otherwise a stale
 * baseline computed against the OLD interval length/calendar spec would leak into the new
 * schedule's assessment. Safe/idempotent to call for calendar/once schedules too (they
 * don't rely on a rolling baseline the same way, but `assessSchedule` handles a clean-slate
 * state for every schedule kind uniformly).
 */
export function initializeScheduleBaseline({ loopId, schedule, env = process.env, now = new Date() }) {
  const assessment = assessSchedule(schedule, { consumedAt: null, lastScheduledAt: null, nextExpectedAt: null }, { now });
  return writeScheduleState(loopId, assessment.state, env);
}

// ── Manual/retry request — atomic single-use claim ──────────────────────────────────────

/** Record a pending manual- or retry-run request. `retryOf` (a run id), when set, makes the
 * eventual claim resolve to trigger "retry" instead of "manual". `run-now`/`retry`-style
 * control-plane tooling writes this; the runner claims it exactly once on its next
 * invocation (see `claimManualRequest`) — launchd's `kickstart` cannot pass custom argv, so
 * the runner must discover a pending request itself rather than being told about it. */
export function writeManualRequest({
  loopId,
  nonce = randomUUID(),
  requestedAt = new Date().toISOString(),
  retryOf = null,
  env = process.env,
}) {
  const request = { nonce, requestedAt, retryOf };
  atomicWriteJSONSync(manualRequestPath(loopId, env), request);
  return request;
}

/**
 * A torn/corrupt manual-request file (invalid JSON) is a real, distinct condition from
 * ENOENT (nothing there at all) — deliberately not left to `readJSONIfExistsSync`'s bare
 * `JSON.parse` failure escaping uncaught, which would crash the whole runner invocation
 * instead of producing `claimManualRequest`'s own actionable `"malformed"` status. Returns
 * the parsed value, `null` for ENOENT (genuinely absent), or `TORN_REQUEST` for anything
 * that exists but fails to parse.
 */
const TORN_REQUEST = Symbol("torn-manual-request");
function readManualRequestFileOrTorn(filePath) {
  try {
    return readJSONIfExistsSync(filePath);
  } catch (err) {
    if (err instanceof SyntaxError) return TORN_REQUEST;
    throw err;
  }
}

/**
 * Consume a manual-run request nonce exactly once: the matching request file is renamed out
 * from under any other reader before being deleted, so two racing runner invocations
 * triggered by the same nonce can never both proceed — only one wins the rename. This is
 * the lower-level nonce-matching primitive; production code should prefer
 * `claimManualRequest`, which does not require already knowing the nonce.
 * Returns the consumed request's `requestedAt`, or `null` if there is no pending request or
 * `nonce` does not match it (already consumed, forged, stale, or torn/corrupt).
 */
export function consumeManualRequestNonce({ loopId, nonce, env = process.env }) {
  const requestPath = manualRequestPath(loopId, env);
  const pending = readManualRequestFileOrTorn(requestPath);
  if (pending === null || pending === TORN_REQUEST || pending.nonce !== nonce) return null;

  // A random (not pid+timestamp) claim token: pid+timestamp can collide across two claims
  // from the very same process in the same millisecond (e.g. a test with a mocked clock, or
  // a tight retry loop), which would let one claim's rename/read/rm clobber another's
  // in-flight claim path. `randomUUID()` makes every claim path unique regardless of
  // process/timing, matching the same durability convention `atomic.mjs` already uses for
  // its own temp files.
  const claimPath = `${requestPath}.claim.${process.pid}.${randomUUID()}`;
  try {
    fs.renameSync(requestPath, claimPath);
  } catch (err) {
    if (err.code === "ENOENT") return null; // another racer already claimed it
    throw err;
  }
  try {
    const claimed = readManualRequestFileOrTorn(claimPath);
    if (claimed === null || claimed === TORN_REQUEST || claimed.nonce !== nonce) return null; // paranoia: shouldn't happen
    return claimed.requestedAt ?? null;
  } finally {
    fs.rmSync(claimPath, { force: true });
  }
}

const DEFAULT_MAX_REQUEST_AGE_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_REQUEST_FUTURE_SKEW_MS = 60 * 1000; // 1 minute

/**
 * Atomically detect and claim whatever manual/retry request is pending for `loopId`, without
 * needing to already know its nonce — this is what every runner invocation calls first
 * (launchd `kickstart` can only re-invoke with the loop id, never custom flags), before
 * falling back to schedule assessment. The claim is single-use regardless of outcome: a
 * stale OR malformed request is still consumed (so it can never be retried/reprocessed
 * indefinitely), just reported as such rather than run.
 *
 * Returns one of:
 *   `{ status: "none" }`                                              — nothing pending
 *   `{ status: "malformed" }`                                         — claimed, but the
 *                                                                        request file was
 *                                                                        torn/corrupt/missing
 *                                                                        required fields
 *   `{ status: "stale", trigger, nonce, requestedAt, retryOf }`        — claimed, too old/new to honor
 *   `{ status: "claimed", trigger, nonce, requestedAt, retryOf }`      — claimed and fresh; run it
 *
 * A malformed/torn request is DELIBERATELY never folded back into `{ status: "none" }`: that
 * would let a corrupted manual-run request silently vanish into ordinary schedule assessment
 * with no trace anywhere that a request ever existed. The caller (see loops-runner.mjs) turns
 * `"malformed"` into an actionable, recorded terminal run outcome instead.
 */
export function claimManualRequest({
  loopId,
  env = process.env,
  now = new Date(),
  maxAgeMs = DEFAULT_MAX_REQUEST_AGE_MS,
  maxFutureSkewMs = DEFAULT_MAX_REQUEST_FUTURE_SKEW_MS,
}) {
  const requestPath = manualRequestPath(loopId, env);
  const pending = readManualRequestFileOrTorn(requestPath);
  if (pending === null) return { status: "none" };
  // `pending === TORN_REQUEST` falls through here deliberately: a file that exists but
  // fails to parse must still be claimed (renamed away) rather than left behind forever —
  // its malformed-ness is reported below, once we've won the rename.

  // See consumeManualRequestNonce above for why this must be a random token, not pid+Date.now().
  const claimPath = `${requestPath}.claim.${process.pid}.${randomUUID()}`;
  try {
    fs.renameSync(requestPath, claimPath);
  } catch (err) {
    if (err.code === "ENOENT") return { status: "none" }; // another racer already claimed it
    throw err;
  }
  let claimed;
  try {
    claimed = readManualRequestFileOrTorn(claimPath);
  } finally {
    fs.rmSync(claimPath, { force: true });
  }
  if (
    claimed === null ||
    claimed === TORN_REQUEST ||
    typeof claimed.nonce !== "string" ||
    typeof claimed.requestedAt !== "string"
  ) {
    // Malformed/torn: the file existed (we won the rename) but its contents are not a valid
    // request. This is a real, actionable condition — surfaced as its own status rather than
    // silently discarded as "nothing was ever pending".
    return { status: "malformed" };
  }
  const retryOf = claimed.retryOf ?? null;
  const trigger = retryOf ? "retry" : "manual";
  const requestedAtMs = Date.parse(claimed.requestedAt);
  if (Number.isNaN(requestedAtMs)) {
    return { status: "stale", trigger, nonce: claimed.nonce, requestedAt: claimed.requestedAt, retryOf };
  }
  const ageMs = now.getTime() - requestedAtMs;
  if (ageMs > maxAgeMs || ageMs < -maxFutureSkewMs) {
    return { status: "stale", trigger, nonce: claimed.nonce, requestedAt: claimed.requestedAt, retryOf };
  }
  return {
    status: "claimed",
    trigger,
    nonce: claimed.nonce,
    requestedAt: claimed.requestedAt,
    retryOf,
  };
}

// ── Overlap-safe manual/retry requests ──────────────────────────────────────────────────
//
// `launchctl kickstart` (without `-k`) on an already-running one-instance service is a
// no-op — it does NOT queue a second invocation. Naively writing manual-request.json and
// then kickstarting means: if a run is already active, the request just sits there (the
// active run has no way to notice it — it already passed its own request-discovery step
// minutes/hours ago) until some UNRELATED future invocation happens to pick it up and run
// it, arbitrarily late. That directly contradicts v1's "skip an overlapping fire and
// record skippedOverlap" contract. `requestManualRun` is the fail-safe replacement for a
// bare `writeManualRequest` call: it checks the canonical `active.lock` FIRST, and if the
// loop is currently running, records a terminal `skippedOverlap` history entry immediately
// instead of ever writing the request.

/**
 * Record a terminal `skippedOverlap` run — a visible history entry for an attempt that
 * never even started because another run was (or might have been) active. Deliberately
 * does NOT touch the loop-level `state.json`'s `active`/`lastRun` fields: a genuinely
 * active run (if any) owns that state, and this must never clobber it. Safe to call
 * without holding `active.lock` — run directories are independently, atomically allocated
 * (see `createRun`), so this never contends with the active run's own bookkeeping.
 */
export function recordOverlapSkip({ loopId, trigger, scheduledFor = null, retryOf = null, env = process.env, now = new Date() }) {
  const run = createRun({ loopId, trigger, scheduledFor, retryOf, env, now });
  const endedAt = now.toISOString();
  finalizeRun(run.paths, { status: "skippedOverlap", endedAt });
  appendStageEvent(run.dir, "terminal", { status: "skippedOverlap" });
  return { runId: run.id, status: "skippedOverlap", exitCode: null, signal: null };
}

/**
 * The shared safe helper for `run-now`/`retry` control-plane commands: checks whether
 * `loopId`'s run is currently active (via the read-only `isLockHeld` peek — this does NOT
 * acquire or weaken the lock) BEFORE persisting a manual/retry request.
 *
 *   - Lock free (the common case): writes the request as normal and returns
 *     `{ queued: true, request }` — the caller proceeds with its existing
 *     kickstart-the-runner flow.
 *   - Lock held: writes NOTHING and immediately returns
 *     `{ queued: false, skip: <skippedOverlap run result> }` — the caller can surface that
 *     result directly, with no need to kickstart anything.
 *
 * This is inherently racy in the "lock free" direction (the run could start a moment after
 * this peeks) — that race is by design tolerated, not eliminated: `runLoop`'s own lock
 * contention path independently claims and records any request that slips through this
 * window, so no request can ever linger to fire unexpectedly late.
 */
export function requestManualRun({
  loopId,
  retryOf = null,
  nonce = randomUUID(),
  requestedAt,
  env = process.env,
  now = new Date(),
}) {
  const trigger = retryOf ? "retry" : "manual";
  if (isLockHeld(lockDirectory(loopId, env))) {
    return { queued: false, skip: recordOverlapSkip({ loopId, trigger, retryOf, env, now }) };
  }
  const request = writeManualRequest({ loopId, nonce, requestedAt: requestedAt ?? now.toISOString(), retryOf, env });
  return { queued: true, request };
}

// ── Fail-closed approval gate ────────────────────────────────────────────────────────────

/**
 * True if `approval.blocked`'s sentinel file exists at `filePath`. Deliberately NOT
 * `fs.existsSync` (which swallows every error — permission-denied, a symlink loop, an I/O
 * error — as "false", i.e. "not blocked"): that would let a filesystem fault masquerade as
 * "approved". `stat` is used instead so only `ENOENT` (genuinely absent) means "not
 * blocked" — every other error (permission denied, EIO, etc.) is treated as blocked, fail-
 * closed, since the caller cannot actually confirm the sentinel's absence.
 */
function approvalBlockedSentinelPresent(filePath) {
  try {
    fs.statSync(filePath);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Verify a loop is authorized to run. Fails closed: any missing/mismatched/unexpected
 * approval state is treated as NOT approved.
 *
 * Two independent checks, either of which blocks the run:
 *  1. `approval.blocked` sentinel — written by the control plane (see ../lib/store.mjs)
 *     ahead of clearing the manifest's approval fields, specifically so a run request that
 *     races the block can never slip through on a fingerprint that technically still
 *     matches. Its mere presence blocks the run, independent of the fingerprint check below.
 *     Presence is determined by `stat`, not `existsSync` — only `ENOENT` counts as absent;
 *     an inaccessible/otherwise-erroring sentinel path denies rather than silently allowing.
 *  2. Capability fingerprint — `approval.approvedAt` must be set and `approval.fingerprint`
 *     must equal the loop's current `capabilityFingerprint` (schedule/name/notification
 *     edits don't require re-approval; execution/permission/secret/retry edits do, because
 *     they change the fingerprint).
 */
export function verifyApproval(loop, env = process.env) {
  try {
    if (approvalBlockedSentinelPresent(approvalBlockedPath(loop.id, env))) {
      return { approved: false, reason: "blocked" };
    }
    const { fingerprint, approvedAt } = loop.approval ?? {};
    if (typeof fingerprint !== "string" || typeof approvedAt !== "string") {
      return { approved: false, reason: "not-approved" };
    }
    if (fingerprint !== capabilityFingerprint(loop)) {
      return { approved: false, reason: "fingerprint-mismatch" };
    }
    return { approved: true, reason: null };
  } catch {
    // Any validation error while computing the fingerprint is also a denial, not a crash.
    return { approved: false, reason: "validation-error" };
  }
}

// ── Enumeration (used by retention.mjs and inspection tooling) ─────────────────────────

/** List runs for a loop, newest-first by run id, each as `{ id, dir, paths, record }`.
 * Directories without a readable run.json are skipped (never crash retention/listing). */
export function listRuns(loopId, env = process.env) {
  const root = runsRoot(loopId, env);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const paths = runPaths(loopId, entry.name, env);
    const record = readRun(paths);
    if (!record) continue;
    runs.push({ id: entry.name, dir: paths.dir, paths, record });
  }
  runs.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return runs;
}

// ── Crash-stale recovery / orphaned process-group reconciliation ─────────────────────────

/** The process-group id an `active` record names, if any. The runner records `pid` and
 * `pgid` together at spawn time and both are the detached group leader's pid (see
 * loops-runner.mjs's `onSpawn`), so `pgid` is authoritative and `pid` is only a fallback for
 * older/hand-written state that never carried a `pgid`. */
function activeGroupId(active) {
  const pgid = Number.isInteger(active?.pgid) && active.pgid > 0 ? active.pgid : null;
  const pid = Number.isInteger(active?.pid) && active.pid > 0 ? active.pid : null;
  return pgid ?? pid;
}

function activeLeaderPid(active) {
  return Number.isInteger(active?.pid) && active.pid > 0 ? active.pid : null;
}

/** Run paths for whatever run `active` points at, or null when it points at nothing (or at a
 * run directory that no longer has a readable run.json). */
function activeRunPaths(loopId, active, env) {
  const runId = active?.currentRunId ?? active?.runId ?? null;
  if (!runId) return null;
  const paths = runPaths(loopId, runId, env);
  return readRun(paths) ? paths : null;
}

const CONFIRMED_DEAD_RESULTS = new Set(["already-exited", "terminated", "killed"]);

/**
 * Reconcile `loopId`'s leftover live state before this invocation does any new work (see
 * loops-runner.mjs, which awaits this immediately after `acquireLock` succeeds and before any
 * request/schedule discovery).
 *
 * Holding the lock is NOT proof that nothing from a previous fire is still running. The lock
 * records the previous RUNNER's pid, so a runner that crashed (or was killed) leaves a lock
 * whose owner is dead and therefore immediately stealable — while the detached process GROUP
 * it spawned (recorded as `active.pid`/`active.pgid`) can happily still be alive. The
 * authoritative record is `state.json`'s `active` pointer, and this function is what enforces
 * its invariant:
 *
 *   `active` is non-null exactly while a spawned process group may still be alive, and is
 *   only ever cleared once that group's death has been confirmed.
 *
 * So there are two distinct jobs here, in this order:
 *
 *  1. ORPHAN TEARDOWN. If `active` names a still-live process group, that group is by
 *     definition an orphan: the only process that could legitimately own it (the previous
 *     runner) is gone, or it would still hold the lock. It is torn down with the same
 *     TERM→wait→KILL→confirm machinery every other stop path uses (`stopGroup` from
 *     ./process-tree.mjs) — bounded, never an unbounded wait. Only once its death is
 *     CONFIRMED does recovery continue. If it cannot be confirmed dead, nothing is finalized,
 *     nothing is cleared, and `{ blocked: true }` is returned: the caller must not start a
 *     new run, and the (refreshed) `active` orphan marker keeps that state durable and
 *     observable for the next invocation and for the UI. Fail closed, never overlap.
 *
 *  2. CRASH-STALE BOOKKEEPING. With no live group left, a dangling `active` pointer or a run
 *     stuck at a nonterminal status can only be a previous invocation that crashed mid-run
 *     (never a real second in-flight run), so every nonterminal run under the loop is
 *     finalized as `"failed"` (a crash is a failure outcome — never success/timeout/cancel,
 *     none of which actually happened) with a `run.crash.recovered` event recording what
 *     stage/status it was stuck at, and the `active` pointer is cleared. Every nonterminal
 *     run is reconciled, not just the one `active` points at: a crash between `createRun` and
 *     the first `setActiveState` call leaves an orphaned `run.json` stuck at "starting" that
 *     no `active` pointer ever referenced, and it must be recovered too.
 *
 * `isProcessAlive`/`isGroupAlive`/`stopGroup` are DI seams purely so tests can simulate live
 * and unkillable groups deterministically, without depending on real OS process lifecycles;
 * production always uses the real ones. `stopOptions` bounds the teardown (see `stopGroup`).
 *
 * Returns `{ recovered, orphan, blocked }`: `recovered` is the (possibly empty) array of
 * recovered run ids, `orphan` describes the live group this call found (and what teardown
 * reported) or null when there was none, and `blocked` is true only when an orphan could not
 * be confirmed dead — in which case NOTHING else was touched.
 */
export async function recoverCrashStaleActiveRun({
  loopId,
  env = process.env,
  now = new Date(),
  isProcessAlive = defaultIsProcessAlive,
  isGroupAlive = defaultIsGroupAlive,
  stopGroup = defaultStopGroup,
  stopOptions = {},
}) {
  const state = readLoopState(loopId, env);
  const active = state.active ?? null;
  const groupId = activeGroupId(active);
  const leaderPid = activeLeaderPid(active);
  const stillRunning = () => (groupId !== null && isGroupAlive(groupId)) || (leaderPid !== null && isProcessAlive(leaderPid));

  let orphan = null;
  if (groupId !== null && stillRunning()) {
    const result = await stopGroup(groupId, { ...stopOptions, isGroupAliveFn: isGroupAlive });
    // Trust nothing but a fresh probe: `stopGroup` reporting a confirmed-dead result is
    // necessary but not sufficient (e.g. a `pid`-only record whose group id never existed
    // would report "already-exited" while the process itself is still very much alive).
    const confirmedDead = CONFIRMED_DEAD_RESULTS.has(result) && !stillRunning();
    orphan = { pid: leaderPid, pgid: groupId, result, terminated: confirmedDead };
    const orphanRun = activeRunPaths(loopId, active, env);
    if (!confirmedDead) {
      if (orphanRun) appendEvent(orphanRun, "run.orphan.blocked", { pid: leaderPid, pgid: groupId, result });
      // Refresh (never clear) the durable marker so the blocked state survives this process
      // and stays visible to the next invocation and to the UI.
      markActiveOrphan(
        loopId,
        { runId: active?.currentRunId ?? null, reason: "orphan-teardown-unconfirmed", at: now.toISOString(), detail: result },
        null,
        env,
      );
      return { recovered: [], orphan, blocked: true };
    }
    if (orphanRun) appendEvent(orphanRun, "run.orphan.terminated", { pid: leaderPid, pgid: groupId, result });
  }

  const recovered = [];
  for (const run of listRuns(loopId, env)) {
    if (isTerminalStatus(run.record.status)) continue;
    const endedAt = now.toISOString();
    finalizeRun(run.paths, { status: "failed", exitCode: null, signal: null, endedAt });
    appendEvent(run.paths, "run.crash.recovered", {
      previousStatus: run.record.status,
      previousStage: active?.currentRunId === run.id ? (active.stage ?? null) : null,
    });
    appendStageEvent(run.paths, "terminal", { status: "failed", exitCode: null, signal: null });
    recovered.push(run.id);
  }

  if (active) {
    // Clear the now-necessarily-stale `active` pointer regardless of whether the loop above
    // actually recovered anything for it (it may already have been terminal — e.g. a crash
    // between `finalizeRun` and `clearActiveState` in a previous invocation's own finally,
    // or a run that finalized while its group could not be confirmed dead and is only now
    // provably gone).
    const lastRunId = active.currentRunId ?? null;
    const lastRecord = lastRunId ? readRun(runPaths(loopId, lastRunId, env)) : null;
    clearActiveState(
      loopId,
      lastRecord
        ? { runId: lastRecord.id, status: lastRecord.status, exitCode: lastRecord.exitCode, signal: lastRecord.signal, endedAt: lastRecord.endedAt }
        : null,
      env,
    );
  }

  return { recovered, orphan, blocked: false };
}
