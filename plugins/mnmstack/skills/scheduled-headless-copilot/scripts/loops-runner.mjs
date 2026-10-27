#!/usr/bin/env node
// loops-runner.mjs — the Copilot Loops runtime kernel entrypoint.
//
// This is what the OS scheduler (launchd/cron/systemd/Task Scheduler) actually invokes for
// a single fire of a loop — the Node equivalent of templates/runner.sh, wired to the
// zero-dependency lib/ modules that own each hardened concern:
//   lib/locks.mjs          single-flight lock (stale-owner steal mutex), directory renamed
//                          to the canonical `active.lock` (see lib/run-state.mjs)
//   lib/run-state.mjs      run id/directory, run.json/events.jsonl, the loop-level canonical
//                          `state.json` (schedule baseline + live `active` progress + a
//                          compact `lastRun` summary), the orphaned-process-group marker and
//                          its bounded reconciliation, the fail-closed approval gate
//                          (capability fingerprint + `approval.blocked` sentinel), and the
//                          manual/retry request's atomic single-use claim
//   lib/runner-command.mjs argv + env builder (copilot / scriptFile / executable) and the
//                          pre-spawn executable-integrity check (regular+executable+shebang,
//                          SHA-256 match)
//   lib/process-tree.mjs   detached process-group spawn + TERM→wait→KILL teardown (probing
//                          the whole GROUP, not just the leader), stream-drain-aware
//                          stdout/stderr routing, and the one-shot secrets-helper runner
//   lib/retention.mjs      post-run pruning of old run directories
//
// launchd's `kickstart` cannot pass custom ProgramArguments, so every invocation must
// *discover* what it is supposed to do: claim a pending manual/retry request if one exists,
// otherwise assess the loop's own schedule against its persisted baseline. `runLoop()` is
// the whole kernel as a single async function, built for dependency injection: every
// side-effecting collaborator (clock, lock, schedule assessor, secret resolver, command
// builder, process runner) is an overridable parameter so tests exercise the real state
// machine against fake commands, never real launchd/keychain/Copilot.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateLoopDefinition } from "./loops/lib/contracts.mjs";
import { loopManifestPath, loopDirectory } from "./loops/lib/paths.mjs";
import { assessSchedule } from "./loops/lib/schedule.mjs";
import { acquireLock as defaultAcquireLock } from "./loops/lib/locks.mjs";
import {
  createRun,
  lockDirectory,
  beginAttempt,
  endAttempt,
  finalizeRun,
  appendEvent,
  appendStageEvent,
  setActiveState,
  clearActiveState,
  markActiveOrphan,
  readScheduleState,
  writeScheduleState,
  claimManualRequest as defaultClaimManualRequest,
  consumeManualRequestNonce,
  recordOverlapSkip as defaultRecordOverlapSkip,
  verifyApproval as defaultVerifyApproval,
  recoverCrashStaleActiveRun as defaultRecoverCrashStaleActiveRun,
} from "./loops/lib/run-state.mjs";
import { buildCommand as defaultBuildCommand, verifyExecutableIntegrity as defaultVerifyExecutableIntegrity } from "./loops/lib/runner-command.mjs";
import {
  runGroup as defaultRunGroup,
  runCommandCapture as defaultRunCommandCapture,
  stopGroup as defaultStopGroup,
  isGroupAlive as defaultIsGroupAlive,
} from "./loops/lib/process-tree.mjs";
import { enforceRetention as defaultEnforceRetention } from "./loops/lib/retention.mjs";
import { disableTaskLaunchAgent as defaultDisableLaunchdTask } from "./loops/lib/launchd.mjs";

const DEFAULT_SECRETS_HELPER_TIMEOUT_MS = 5000;

function defaultSecretsHelperPath(env) {
  return (
    env.COPILOT_LOOPS_SECRETS_HELPER ||
    path.join(os.homedir(), "Applications", "CopilotLoops.app", "Contents", "Helpers", "CopilotLoopsSecrets")
  );
}

/**
 * Default secret resolver: invokes the bundled `CopilotLoopsSecrets get <loop-id:NAME>`
 * helper once per declared secret, directly (no shell), bounded by `timeoutMs`. A missing
 * helper binary, a non-zero exit, or a timeout all throw — the caller (see `runLoop` below)
 * turns any of those into an immediate `launchFailed`, never a partial/garbled launch: a
 * declared secret that fails to resolve means the WHOLE resolution rejects (nothing is ever
 * returned with some names present and others silently missing).
 *
 * The helper's `get` writes the secret's raw bytes with no added terminator, so its stdout
 * is used EXACTLY as received — never trimmed. A trailing newline (or CR, or none at all)
 * may be part of the actual secret value, not incidental formatting; stripping it would
 * silently corrupt an intentionally newline-terminated secret. The only unavoidable
 * lossiness is the child process stdio's UTF-8 decode itself (an environment-string
 * constraint every env var is subject to, not something added on top here).
 *
 * Secret *values* (the helper's stdout) are returned to the caller and never otherwise
 * logged, echoed, or included in a thrown error message.
 */
export async function resolveSecretsViaHelper(
  loop,
  { env = process.env, helperPath, timeoutMs = DEFAULT_SECRETS_HELPER_TIMEOUT_MS, runCommandCapture = defaultRunCommandCapture } = {},
) {
  const names = loop.environment?.secretNames ?? [];
  if (names.length === 0) return {};
  const helper = helperPath ?? defaultSecretsHelperPath(env);

  const values = {};
  for (const name of names) {
    let result;
    try {
      result = await runCommandCapture({
        command: helper,
        args: ["get", `${loop.id}:${name}`],
        env,
        timeoutSeconds: timeoutMs / 1000,
      });
    } catch (err) {
      // A spawn-level failure (helper missing, not executable, etc.) — `err.code` (e.g.
      // ENOENT) is safe to surface; nothing secret ever reaches this path.
      throw new Error(`secret helper unavailable for ${name}: ${err.code ?? "spawn failed"}`);
    }
    if (result.timedOut) {
      throw new Error(`secret helper timed out for ${name} after ${timeoutMs}ms`);
    }
    if (result.exitCode !== 0) {
      // Deliberately omit result.stderr/result.stdout — never let a diagnostic leak a value.
      throw new Error(`secret helper failed for ${name} (exit ${result.exitCode ?? "null"}, signal ${result.signal ?? "null"})`);
    }
    // Preserve stdout EXACTLY — the helper writes raw bytes with no terminator, so a
    // trailing newline (or CR, or none at all) may be part of the actual secret value, not
    // incidental formatting. Trimming it here would silently corrupt an intentionally
    // newline-terminated secret. The only unavoidable lossiness is the string/Buffer
    // decode itself (child_process stdio is UTF-8 decoded — an environment string
    // constraint, not something this function adds on top of).
    values[name] = result.stdout;
  }
  return values;
}

/** Alternate resolver for plain-env workflows (a wrapper already sourced a chmod-600 secrets
 * file into this process's env before invoking the runner): looks each declared secret name
 * up directly in `env`. Not the default — see `resolveSecretsViaHelper` — but selectable via
 * `options.resolveSecrets` for hosts that don't have the keychain helper installed. */
export function resolveSecretsFromEnv(loop, { env = process.env } = {}) {
  const values = {};
  for (const name of loop.environment?.secretNames ?? []) {
    if (Object.prototype.hasOwnProperty.call(env, name)) values[name] = env[name];
  }
  return values;
}

function isAllowedToFire(loop, trigger) {
  if (trigger === "manual" || trigger === "retry") {
    return ["enabled", "ready", "paused"].includes(loop.lifecycle);
  }
  return loop.lifecycle === "enabled"; // schedule
}

function attemptOutcomeStatus(outcome, exitCode, signal) {
  if (outcome === "timedOut") return "timedOut";
  if (outcome === "aborted") return "cancelled";
  if (exitCode === 0 && signal === null) return "succeeded";
  return "failed";
}

/** Like `sleep`, but resolves early (with `true`) if `abortSignal` fires — used for the
 * retry backoff, so Stop doesn't have to wait out a long backoff before cancelling. */
function abortableSleep(ms, abortSignal) {
  return new Promise((resolve) => {
    if (!abortSignal) {
      setTimeout(() => resolve(false), ms);
      return;
    }
    if (abortSignal.aborted) {
      resolve(true);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run one fire of `loopId` end-to-end: request/schedule discovery, lifecycle/approval/
 * integrity gates, the single-flight lock, run-record lifecycle with canonical loop-level
 * live state, spawn-with-retries, and post-run retention.
 *
 * Single-flight safety spans two mechanisms, not one. The `active.lock` directory serializes
 * concurrent RUNNERS (its pid file names this process). `state.json`'s `active` pointer is
 * what survives this process: it names a possibly-live child process GROUP and is only ever
 * cleared once that group is confirmed dead. So a fire that cannot confirm its own teardown
 * leaves both behind (lock held AND an `active` orphan marker), and every invocation
 * reconciles that marker — terminating any surviving group with the standard
 * TERM→wait→KILL→confirm machinery — before it is allowed to spawn anything. If the orphan
 * cannot be confirmed dead, this fire records `skippedOverlap` (with `orphanBlocked: true`)
 * and spawns nothing: fail closed rather than overlap.
 *
 * Returns `{ runId, status, exitCode, signal }` (plus `retentionError` when retention failed
 * but the run itself still finalized). `runId` is `null` for outcomes that leave no run
 * record: an unrecognized/replayed manual request, lock contention, or a schedule that
 * simply isn't due yet. Never throws for expected control-flow outcomes — only for
 * programmer/config errors (unreadable manifest, invalid manifest, unsupported trigger).
 */
export async function runLoop(options) {
  const {
    loopId,
    trigger: forcedTrigger, // test/debug seam ONLY — production invocations omit this and
    // let the runner discover a pending manual/retry request or assess its own schedule,
    // since launchd `kickstart` cannot pass custom ProgramArguments.
    scheduledFor: forcedScheduledFor = null,
    retryOf: forcedRetryOf = null,
    nonce, // legacy explicit-nonce seam, only consulted when `trigger` is also forced to "manual"
    env = process.env,
    now = () => new Date(),
    loadLoop = defaultLoadLoop,
    acquireLock = defaultAcquireLock,
    claimManualRequest = defaultClaimManualRequest,
    recordOverlapSkip = defaultRecordOverlapSkip,
    assessScheduleFn = assessSchedule,
    verifyApproval = defaultVerifyApproval,
    recoverCrashStaleActiveRun = defaultRecoverCrashStaleActiveRun,
    verifyExecutableIntegrity = defaultVerifyExecutableIntegrity,
    resolveSecrets = resolveSecretsViaHelper,
    buildCommand = defaultBuildCommand,
    runGroup = defaultRunGroup,
    stopGroup = defaultStopGroup,
    isGroupAlive = defaultIsGroupAlive,
    orphanStopOptions = {},
    enforceRetention = defaultEnforceRetention,
    disableLaunchdTask = defaultDisableLaunchdTask,
    copilotBinary = "copilot",
    pathPrepend = [],
    abortSignal,
    secretsHelperPath,
    secretsHelperTimeoutMs,
    maxRequestAgeMs,
    maxRequestFutureSkewMs,
    log = () => {},
  } = options;

  const loop = await loadLoop(loopId, env);
  validateLoopDefinition(loop);

  // Mirror templates/runner.sh's `mkdir -p "$STATE"`: guarantee the loop's durable state
  // directory (which the lock directory and state.json live inside) exists before anything
  // below tries to lock, log, or write into it.
  fs.mkdirSync(loopDirectory(loopId, env), { recursive: true });

  const lock = acquireLock(lockDirectory(loopId, env));
  if (!lock) {
    log(`${loopId}: lock contended, skipping this fire`);
    // Contended: another fire is already in progress. Produce a visible skippedOverlap
    // history record wherever it is safe to do so — never just return with no history — but
    // deliberately do NOT touch the schedule baseline: assessSchedule's own freshness/grace
    // window makes the next legitimate tick re-evaluate correctly on its own, so an
    // overlapping SCHEDULED fire can simply be skipped.
    return recordOverlappingFire({
      loopId,
      forcedTrigger,
      forcedRetryOf,
      env,
      now,
      claimManualRequest,
      recordOverlapSkip,
      maxRequestAgeMs,
      maxRequestFutureSkewMs,
      log,
    });
  }

  let teardownConfirmed = true; // set false the moment any attempt's process-group teardown
  // is not confirmed dead (SIGKILL sent but never verified, even after the bounded re-sweep
  // below) — see process-tree.mjs's runGroup docs. The lock must not release while any group
  // member might still survive, and — because the lock only names this runner's own pid and
  // is therefore stealable the instant this process exits — `state.active` must be left
  // behind as the durable orphan marker that blocks the NEXT invocation too.
  let orphanPgid = null; // the process group that could not be confirmed dead, if any

  try {
    // ── Reconcile leftover live state BEFORE any new work ────────────────────────────
    // Holding the lock is not by itself proof that nothing from a previous fire survives:
    // the lock records the previous RUNNER's pid, so a crashed runner leaves a stealable
    // lock behind while its detached child GROUP may still be alive. `state.active` is the
    // authoritative record of that group, and this call enforces its invariant — terminate
    // any live orphan group with the standard TERM→wait→KILL→confirm machinery, and only
    // then finalize crash-stale runs and clear `active`. If the orphan cannot be confirmed
    // dead, this invocation must not start anything new.
    const recovery = await recoverCrashStaleActiveRun({
      loopId,
      env,
      now: now(),
      isGroupAlive,
      stopGroup,
      stopOptions: orphanStopOptions,
    });
    if (recovery.blocked) {
      log(
        `${loopId}: a previous run's process group (pgid ${recovery.orphan?.pgid ?? "unknown"}) could not be confirmed dead ` +
          `(${recovery.orphan?.result ?? "unknown"}) — refusing to start a new run`,
      );
      return {
        ...recordOverlappingFire({
          loopId,
          forcedTrigger,
          forcedRetryOf,
          env,
          now,
          claimManualRequest,
          recordOverlapSkip,
          maxRequestAgeMs,
          maxRequestFutureSkewMs,
          log,
        }),
        orphanBlocked: true,
      };
    }

    // ── Discover what this invocation is supposed to do ──────────────────────────────
    let trigger;
    let scheduledFor;
    let retryOf;

    if (forcedTrigger) {
      trigger = forcedTrigger;
      scheduledFor = forcedScheduledFor;
      retryOf = forcedRetryOf;
      if (trigger === "manual" && nonce) {
        const requestedAt = consumeManualRequestNonce({ loopId, nonce, env });
        if (requestedAt === null) {
          return { runId: null, status: "skippedOverlap", exitCode: null, signal: null };
        }
      }
    } else {
      const claim = claimManualRequest({ loopId, env, now: now(), maxAgeMs: maxRequestAgeMs, maxFutureSkewMs: maxRequestFutureSkewMs });
      if (claim.status === "claimed") {
        trigger = claim.trigger; // "manual" or "retry", derived from claim.retryOf
        scheduledFor = null; // manual/retry bypass schedule freshness entirely
        retryOf = claim.retryOf;
      } else if (claim.status === "stale") {
        log(`${loopId}: manual/retry request too stale to honor, recording skippedMissed`);
        return recordSkip(
          { loop, trigger: claim.trigger ?? "manual", scheduledFor: null, retryOf: claim.retryOf, env, now, status: "skippedMissed" },
          { disableLaunchdTask, log, now },
        );
      } else if (claim.status === "malformed") {
        // A torn/corrupt manual-run request was found and consumed, but its trigger/retryOf
        // cannot be trusted. This must never silently fall through to schedule assessment as
        // if nothing had happened — it is recorded as its own actionable, terminal history
        // entry (a launch failure: this invocation could not honor the request it found).
        log(`${loopId}: malformed/torn manual-run request, recording launchFailed`);
        return recordSkip(
          { loop, trigger: "manual", scheduledFor: null, retryOf: null, env, now, status: "launchFailed" },
          { disableLaunchdTask, log, now },
        );
      } else {
        const scheduleState = readScheduleState(loopId, env);
        const assessment = assessScheduleFn(loop.schedule, scheduleState, { now: now() });
        // Persist the (possibly just-initialized/reset) baseline on EVERY schedule check,
        // due or not — this is what keeps an interval schedule's `nextExpectedAt` from being
        // silently recomputed (and the fire indefinitely delayed) on every poll.
        writeScheduleState(loopId, assessment.state, env);
        if (assessment.due) {
          trigger = "schedule";
          scheduledFor = assessment.scheduledAt;
          retryOf = null;
        } else if (assessment.stale) {
          return recordSkip(
            { loop, trigger: "schedule", scheduledFor: assessment.scheduledAt, retryOf: null, env, now, status: "skippedMissed" },
            { disableLaunchdTask, log, now },
          );
        } else {
          return { runId: null, status: "notDue", exitCode: null, signal: null };
        }
      }
    }

    if (!isAllowedToFire(loop, trigger)) {
      return recordSkip({ loop, trigger, scheduledFor, retryOf, env, now, status: "skippedPaused" }, { disableLaunchdTask, log, now });
    }

    // ── Run lifecycle ─────────────────────────────────────────────────────────────────
    const run = createRun({ loopId, trigger, scheduledFor, retryOf, env, now: now() });
    log(`run ${run.id}: created (trigger=${trigger})`);
    setActiveState(loopId, { currentRunId: run.id, sessionId: run.record.sessionId, stage: "preflight", attempt: 0 }, env);
    appendStageEvent(run.dir, "preflight");

    const approval = verifyApproval(loop, env);
    if (!approval.approved) {
      appendEvent(run.dir, "run.approval.blocked", { reason: approval.reason });
      return finalizeAndClear(run, loop, env, { status: "approvalBlocked" }, { disableLaunchdTask, log, now });
    }

    let secretValues;
    try {
      secretValues = await resolveSecrets(loop, {
        env,
        helperPath: secretsHelperPath,
        timeoutMs: secretsHelperTimeoutMs,
      });
    } catch (err) {
      appendEvent(run.dir, "run.secrets.failed", { message: err.message });
      return finalizeAndClear(run, loop, env, { status: "launchFailed" }, { disableLaunchdTask, log, now });
    }

    await fs.promises.mkdir(run.paths.cliLogsDir, { recursive: true });

    // Any non-empty resolved secret value must be redacted from every child output artifact
    // — an arbitrary script (or Copilot itself) can echo an injected secret straight back
    // out to its own stdout/stderr, so raw piping is never safe once a secret is in play.
    const redactSecrets = Object.values(secretValues).filter((value) => typeof value === "string" && value.length > 0);

    const maxRetries = loop.retry?.maxRetries ?? 0;
    const backoffSeconds = loop.retry?.backoffSeconds ?? 0;
    const timeoutSeconds = loop.timeoutSeconds ?? 0;
    const isCopilot = loop.execution.type === "copilot";

    let lastExitCode = null;
    let lastSignal = null;
    let lastOutcome = "exited";
    let finalStatus = "failed";

    for (let attemptNumber = 1; attemptNumber <= maxRetries + 1; attemptNumber += 1) {
      if (abortSignal?.aborted) {
        finalStatus = "cancelled";
        break;
      }

      // Verify the on-disk script/executable's integrity immediately before EVERY spawn
      // attempt, including retries — never just once before the retry loop. A first attempt
      // can itself modify or replace the very file it was launched from (a self-mutating
      // script, or an external actor swapping the binary out while the run is still
      // in-flight/retrying); without a per-attempt recheck here, the next retry would spawn
      // whatever bytes are on disk NOW, never reconfirmed against the manifest's approved
      // hash. This runs BEFORE `beginAttempt`, so a rejected check never counts as a spawn
      // attempt — consistent with the copilot execution type, for which this is trivially a
      // no-op `{ ok: true }` on every attempt (see verifyExecutableIntegrity).
      const integrity = await verifyExecutableIntegrity(loop.execution);
      if (!integrity.ok) {
        appendEvent(run.dir, "run.integrity.blocked", { reason: integrity.reason, attemptNumber });
        finalStatus = "approvalBlocked";
        break;
      }

      setActiveState(loopId, { stage: "starting", attempt: attemptNumber, pid: null, pgid: null }, env);
      beginAttempt(run.paths, { number: attemptNumber, startedAt: now().toISOString() });
      appendStageEvent(run.dir, "starting", { number: attemptNumber });

      let command;
      try {
        command = buildCommand({
          loop,
          run: run.paths,
          sessionId: run.record.sessionId,
          secretValues,
          copilotBinary,
          baseEnv: env,
          pathPrepend,
        });
      } catch (err) {
        appendEvent(run.dir, "run.command.failed", { number: attemptNumber, message: err.message });
        endAttempt(run.paths, { number: attemptNumber, exitCode: null, signal: null, endedAt: now().toISOString() });
        return finalizeAndClear(run, loop, env, { status: "launchFailed" }, { disableLaunchdTask, log, now });
      }

      // Per-run artifacts, never a combined attempt log: script/executable stdout+stderr go
      // to stdout.log/stderr.log; Copilot's own stdout (its --output-format json JSONL) goes
      // to copilot.jsonl while its stderr still goes to stderr.log. cli-logs/ is Copilot's
      // own --log-dir, untouched by us beyond creating the directory.
      const stdoutStream = fs.createWriteStream(isCopilot ? run.paths.copilotLog : run.paths.stdoutLog, { flags: "a" });
      const stderrStream = fs.createWriteStream(run.paths.stderrLog, { flags: "a" });

      let result;
      let attemptPgid = null;
      try {
        result = await runGroup({
          command: command.command,
          args: command.args,
          cwd: command.cwd,
          env: command.env,
          stdout: stdoutStream,
          stderr: stderrStream,
          redactSecrets,
          timeoutSeconds,
          abortSignal,
          isGroupAliveFn: isGroupAlive,
          onSpawn: (child) => {
            attemptPgid = child.pid; // the detached leader's pid doubles as its group id
            setActiveState(loopId, { stage: "running", pid: child.pid, pgid: child.pid }, env);
            appendStageEvent(run.dir, "running", { number: attemptNumber, pid: child.pid });
          },
          onStopping: ({ outcome }) => {
            setActiveState(loopId, { stage: "stopping" }, env);
            appendStageEvent(run.dir, "stopping", { number: attemptNumber, outcome });
          },
        });
      } catch (err) {
        appendEvent(run.dir, "run.spawn.failed", { number: attemptNumber, message: err.message });
        endAttempt(run.paths, { number: attemptNumber, exitCode: null, signal: null, endedAt: now().toISOString() });
        return finalizeAndClear(run, loop, env, { status: "launchFailed" }, { disableLaunchdTask, log, now });
      }

      lastExitCode = result.exitCode;
      lastSignal = result.signal;
      lastOutcome = result.outcome;
      finalStatus = attemptOutcomeStatus(result.outcome, result.exitCode, result.signal);
      if (result.teardownConfirmed === false) {
        // One bounded last-chance sweep before giving up on this group: `runGroup` already
        // ran a full TERM→wait→KILL→confirm cycle, but a group that was mid-exit when that
        // window closed may well be gone by now, and re-signaling a group that is genuinely
        // still there costs nothing. This uses the same `stopGroup` machinery as every other
        // stop path (never a bespoke kill loop) and, like it, is strictly bounded.
        const swept = attemptPgid === null ? "unknown-group" : await stopGroup(attemptPgid, { ...orphanStopOptions, isGroupAliveFn: isGroupAlive });
        if (swept === "already-exited" || swept === "terminated" || swept === "killed") {
          appendEvent(run.dir, "run.teardown.swept", { number: attemptNumber, pgid: attemptPgid, result: swept });
          log(`run ${run.id}: attempt ${attemptNumber}'s process group was confirmed dead by a follow-up sweep (${swept})`);
        } else {
          teardownConfirmed = false;
          orphanPgid = attemptPgid;
          appendEvent(run.dir, "run.teardown.unconfirmed", { number: attemptNumber, pgid: attemptPgid, result: swept });
          log(`run ${run.id}: attempt ${attemptNumber}'s process group was not confirmed dead after teardown`);
        }
      }

      endAttempt(run.paths, { number: attemptNumber, exitCode: result.exitCode, signal: result.signal, endedAt: now().toISOString() });
      appendEvent(run.dir, "run.attempt.ended", {
        number: attemptNumber,
        exitCode: result.exitCode,
        signal: result.signal,
        outcome: result.outcome,
      });

      // Fail closed: a retry is new work, and new work must never be spawned while a process
      // group from this very run might still be alive.
      if (!teardownConfirmed) break;
      if (finalStatus === "succeeded" || finalStatus === "cancelled") break;
      if (attemptNumber > maxRetries) break; // retries exhausted
      if (abortSignal?.aborted) {
        finalStatus = "cancelled";
        break;
      }

      setActiveState(loopId, { stage: "retrying" }, env);
      appendStageEvent(run.dir, "retrying", { nextAttempt: attemptNumber + 1, backoffSeconds });
      if (backoffSeconds > 0) {
        const aborted = await abortableSleep(backoffSeconds * 1000, abortSignal);
        if (aborted) {
          finalStatus = "cancelled";
          break;
        }
      }
    }

    setActiveState(loopId, { stage: "finalizing" }, env);
    appendStageEvent(run.dir, "finalizing");

    const finalized = await finalizeAndClear(
      run,
      loop,
      env,
      { status: finalStatus, exitCode: lastExitCode, signal: lastSignal },
      {
        disableLaunchdTask,
        log,
        now,
        // Teardown unconfirmed: finalize the run honestly, but KEEP `active` as the durable
        // orphan marker naming the group that may still be alive. That marker — not the
        // lock, whose owner pid dies with this process — is what stops the next invocation
        // from spawning over a survivor.
        orphan: teardownConfirmed ? null : { pid: orphanPgid, pgid: orphanPgid, reason: "teardown-unconfirmed" },
      },
    );
    log(`run ${run.id}: ${finalStatus} (exitCode=${lastExitCode}, signal=${lastSignal}, outcome=${lastOutcome})`);

    let retentionError = null;
    try {
      enforceRetention({ loopId, retention: loop.retention, env, now: now() });
    } catch (err) {
      // Retention failing must never retroactively fail an already-finalized run — report it
      // (both on the run's own event log and in the return value) and move on.
      retentionError = err.message;
      appendEvent(run.dir, "run.retention.failed", { message: err.message });
      log(`run ${run.id}: retention enforcement failed: ${err.message}`);
    }

    return { ...finalized, retentionError, teardownConfirmed };
  } finally {
    // Never release the single-flight lock while any process-group member from this run
    // might still be alive — an unconfirmed kill means a second invocation could overlap
    // with a process this run was supposed to have fully stopped. Leaving the lock held is
    // a visible, safe failure mode (the loop simply won't fire again until an operator
    // investigates) — silently releasing it would risk exactly the overlap this whole
    // locking mechanism exists to prevent.
    //
    // The lock alone cannot carry that refusal past this process, though: its pid file names
    // THIS runner, so the moment this process exits the lock is stale and the next
    // invocation is entitled to steal it. The cross-process half of the guarantee is the
    // durable `state.active` orphan marker written by `finalizeAndClear` above — every
    // invocation reconciles it (terminate the group, confirm, only then clear) before it is
    // allowed to spawn anything. Holding the lock here is the in-process belt to that
    // durable braces.
    if (teardownConfirmed) {
      lock.release();
    } else {
      log(
        `${loopId}: process-group teardown was not confirmed (pgid ${orphanPgid ?? "unknown"}) — leaving the run lock held and ` +
          `state.active marked as an orphaned group rather than risk an overlapping fire`,
      );
    }
  }
}

/**
 * Claim any pending manual/retry request and record a terminal `skippedOverlap` history
 * entry for a fire that must not start because another process may still be running — either
 * because the single-flight lock is genuinely contended, or because a previous run's process
 * group could not be confirmed dead (see `recoverCrashStaleActiveRun`).
 *
 * A pending manual/retry request needs claiming here specifically: `launchctl kickstart`
 * (without `-k`) on an already-running one-instance service is a no-op, so a request written
 * despite an active run (a narrow race with the control plane's own pre-check — see
 * run-state.mjs's `requestManualRun`, the primary fix) would otherwise sit stale until some
 * UNRELATED future invocation ran it arbitrarily late. Claiming and recording it HERE, as
 * defense in depth, is what keeps it from lingering.
 */
function recordOverlappingFire({
  loopId,
  forcedTrigger,
  forcedRetryOf,
  env,
  now,
  claimManualRequest,
  recordOverlapSkip,
  maxRequestAgeMs,
  maxRequestFutureSkewMs,
  log,
}) {
  let overlapTrigger = forcedTrigger ?? "schedule";
  let overlapRetryOf = forcedTrigger === "retry" ? forcedRetryOf : null;
  if (!forcedTrigger) {
    const claim = claimManualRequest({ loopId, env, now: now(), maxAgeMs: maxRequestAgeMs, maxFutureSkewMs: maxRequestFutureSkewMs });
    // "malformed" falls through here too (same as "stale"): the request was consumed but
    // its trigger/retryOf can't be trusted, so this overlapping fire is recorded generically
    // — never silently dropped just because its own trigger couldn't be determined.
    if (claim.status === "claimed" || claim.status === "stale" || claim.status === "malformed") {
      overlapTrigger = claim.trigger ?? "manual";
      overlapRetryOf = claim.retryOf ?? null;
    }
  }
  try {
    return recordOverlapSkip({ loopId, trigger: overlapTrigger, retryOf: overlapRetryOf, env, now: now() });
  } catch (err) {
    // Recording the skip is itself best-effort — a bookkeeping failure must never mask or
    // replace the real "already running, skipped" outcome.
    log(`${loopId}: failed to record a skippedOverlap history entry: ${err.message}`);
    return { runId: null, status: "skippedOverlap", exitCode: null, signal: null };
  }
}

/**
 * Finalize a run's terminal status, emit the `terminal` stage event, and clear the loop's
 * live `active` state (retaining a compact `lastRun` summary) — all crash-safely atomic.
 *
 * When `deps.orphan` is given, the run's process group could NOT be confirmed dead: the run
 * is still finalized with its real outcome and its `lastRun` summary is still published, but
 * `active` is KEPT as a durable orphan marker naming that group (see run-state.mjs's
 * `markActiveOrphan`) instead of being cleared. The next invocation reconciles it before it
 * is allowed to spawn anything — that marker, not the runner-pid-owned lock directory, is
 * what makes single-flight safety survive this process exiting.
 *
 * For a `schedule`-triggered fire of a ONE-TIME (`schedule.kind === "once"`) loop, this ALSO
 * immediately disables the loop's own launchd task label (`launchctl disable`, direct argv,
 * no shell, exit-code only — never parses launchctl's stdout). This is deliberately cheap,
 * best-effort, and independent of the control plane: a one-time loop's launchd
 * StartCalendarInterval has no year field, so the *only* thing stopping it from firing again
 * next year is either this loop's own persisted `consumedAt` (checked on every invocation —
 * see the schedule-assessment branch above, and already sufficient to make a re-fire a
 * silent no-op) or the launchd job itself being disabled/removed. The control plane's own
 * reconciliation (`commands/schedule.mjs`'s `reconcileLoopSchedule`, driven by the very same
 * `consumedAt`) is what eventually boots the job out and deletes its plist — but that only
 * runs while the app is open. Disabling here closes the gap for "the app stays closed": even
 * if the plist is never removed, launchd itself won't try to start a disabled job again.
 * Never a fatal condition for the run — a failure to disable is only ever reported, and does
 * not touch manual/retry firing, which bypasses this branch (and schedule freshness)
 * entirely, preserving "Run now" after a one-time schedule has already fired.
 */
async function finalizeAndClear(run, loop, env, { status, exitCode = null, signal = null }, deps = {}) {
  const { disableLaunchdTask = defaultDisableLaunchdTask, log = () => {}, now = () => new Date(), orphan = null } = deps;
  const endedAt = now().toISOString();
  finalizeRun(run.paths, { status, exitCode, signal, endedAt });
  appendStageEvent(run.dir, "terminal", { status, exitCode, signal });
  const lastRun = { runId: run.id, status, exitCode, signal, endedAt };
  if (orphan) {
    markActiveOrphan(loop.id, { runId: run.id, pid: orphan.pid ?? null, pgid: orphan.pgid ?? null, reason: orphan.reason, at: endedAt }, lastRun, env);
  } else {
    clearActiveState(loop.id, lastRun, env);
  }

  let onceScheduleDisabled = null;
  if (run.record.trigger === "schedule" && loop.schedule?.kind === "once") {
    try {
      await disableLaunchdTask(loop.id, { env });
      onceScheduleDisabled = true;
      appendEvent(run.dir, "run.schedule.once.disabled", {});
    } catch (err) {
      onceScheduleDisabled = false;
      appendEvent(run.dir, "run.schedule.once.disable_failed", { message: err.message });
      log(`failed to disable the launchd task for one-time loop ${loop.id}: ${err.message}`);
    }
  }

  return {
    runId: run.id,
    status,
    exitCode,
    signal,
    ...(onceScheduleDisabled !== null ? { onceScheduleDisabled } : {}),
  };
}

/** Create, immediately finalize, and clear a run that never attempts a spawn (paused
 * lifecycle, a missed schedule window, a stale manual/retry request). */
async function recordSkip({ loop, trigger, scheduledFor, retryOf, env, now, status }, deps) {
  const run = createRun({ loopId: loop.id, trigger, scheduledFor, retryOf, env, now: now() });
  return finalizeAndClear(run, loop, env, { status }, deps);
}

async function defaultLoadLoop(loopId, env) {
  const manifestPath = loopManifestPath(loopId, env);
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}

// ── CLI wrapper ──────────────────────────────────────────────────────────────────────────

function parseArgv(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      flags[key] = rest.length > 0 ? rest.join("=") : true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function usage() {
  return `Copilot Loops managed runner

Usage: node loops-runner.mjs <loop-id> [--trigger=schedule|manual|retry]

Production invocations pass ONLY the loop id — launchd's \`kickstart\` cannot supply custom
arguments, so the runner discovers what to do on its own: it claims a pending manual/retry
request (written by \`loops-ctl run-now\`/\`retry\`) if one exists, otherwise it assesses the
loop's own schedule against its persisted baseline.

  --trigger=<schedule|manual|retry>   Force the trigger, bypassing request/schedule
                                       discovery entirely. Test/debug seam only — never
                                       required for a real scheduled or manually-dispatched
                                       run.

The runner validates the canonical loop manifest and approval fingerprint (and, for
scriptFile/executable loops, the on-disk file's integrity) before launching headless
Copilot or a direct executable argv vector. It applies the single-flight lock, retry policy,
hard timeout, and retention policy declared in the loop's manifest, and always exits 0 for
expected skip/failure outcomes (the run record under the loop's runs/ directory, and the
loop's own state.json, carry the real result) — only manifest/config errors raise a non-zero
exit.
`;
}

async function main() {
  const { positional, flags } = parseArgv(process.argv.slice(2));
  if (flags.help || flags.h || positional.length === 0) {
    process.stdout.write(usage());
    process.exitCode = positional.length === 0 && !flags.help && !flags.h ? 2 : 0;
    return;
  }

  const [loopId] = positional;
  const trigger = typeof flags.trigger === "string" ? flags.trigger : undefined;

  const abortController = new AbortController();
  let stopping = false;
  const onSignal = (signal, exitCode) => {
    if (stopping) return;
    stopping = true;
    process.stderr.write(`loops-runner: received ${signal}, stopping run group\n`);
    abortController.abort();
    process.exitCode = exitCode;
  };
  process.on("SIGINT", () => onSignal("SIGINT", 130));
  process.on("SIGTERM", () => onSignal("SIGTERM", 143));

  try {
    const result = await runLoop({
      loopId,
      trigger,
      abortSignal: abortController.signal,
      log: (message) => process.stderr.write(`loops-runner: ${message}\n`),
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    if (!stopping) {
      process.exitCode = result.runId === null || result.status === "succeeded" || result.status.startsWith("skipped") ? 0 : 1;
    }
  } catch (err) {
    process.stderr.write(`loops-runner: ${err.message}\n`);
    process.exitCode = 2;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
