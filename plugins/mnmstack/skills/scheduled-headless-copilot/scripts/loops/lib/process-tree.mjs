// process-tree.mjs — detached process-group spawn + TERM→wait→KILL teardown.
//
// Ports templates/runner.sh's `set -m` / `stop_group` semantics to Node: the child is
// spawned as the leader of its own process group (`detached: true` on POSIX), and every
// stop path — timeout, external signal, or normal cleanup — signals the *group* (negative
// PID) rather than the single top PID, so tool-spawned grandchildren die too. Liveness and
// termination both probe the GROUP (`kill(-pgid, 0)`), not just the leader PID: a leader can
// exit while a still-running grandchild keeps the process group alive, and every stop path —
// including a normal leader exit — sweeps the whole group before resolving so nothing is
// left running in the background.

import { spawn } from "node:child_process";
import { Transform } from "node:stream";

const DEFAULT_TERM_WAIT_MS = 10_000; // < launchd's default 20s unload grace, per runner.sh.
const DEFAULT_POLL_INTERVAL_MS = 200;
const DEFAULT_KILL_WAIT_MS = 5_000; // bounded confirmation window after SIGKILL — see stopGroup

/** True if the single process `pid` is alive (or alive-but-unsignalable). Used for
 * single-process ownership checks (e.g. a lock file's owner pid) — NOT process-group
 * liveness; see `isGroupAlive` for that. */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === "ESRCH") return false;
    if (err.code === "EPERM") return true; // exists, just not signalable by us
    throw err;
  }
}

/** True if ANY process in group `pgid` is alive. A spawned leader doubles as its group's
 * PGID (see `spawnGroup`); the group survives as long as at least one member does, even
 * after the original leader has exited — so this is the correct check for "is there still
 * something running that I launched", not `isProcessAlive` on the leader's pid alone. */
export function isGroupAlive(pgid) {
  if (!Number.isInteger(pgid) || pgid <= 0) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    if (err.code === "ESRCH") return false;
    if (err.code === "EPERM") return true;
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spawn `command args` as the leader of a new detached process group in `cwd` with `env`.
 * `stdio` defaults to inheriting nothing on stdin and piping stdout/stderr for the caller to
 * consume/redirect. Returns the ChildProcess; its `.pid` doubles as the process group id
 * (PGID) on POSIX because it is the group leader.
 */
export function spawnGroup({ command, args = [], cwd, env, stdio = ["ignore", "pipe", "pipe"] }) {
  if (typeof command !== "string" || command.length === 0) {
    throw new TypeError("spawnGroup requires a non-empty command string");
  }
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
    throw new TypeError("spawnGroup args must be an array of strings");
  }
  return spawn(command, args, {
    cwd,
    env,
    detached: true, // POSIX: child becomes its own process group leader (pgid === pid)
    stdio,
    shell: false, // never build a shell string — argv only
  });
}

function killGroupSignal(pgid, signal) {
  try {
    process.kill(-pgid, signal); // negative pid = whole process group on POSIX
  } catch (err) {
    if (err.code !== "ESRCH") throw err;
  }
}

/** Poll `isAliveFn(pgid)` until it reports false or `waitMs` elapses. Returns true once
 * confirmed dead, false if the deadline passed while it still reports alive. */
async function pollUntilDead(pgid, waitMs, pollIntervalMs, isAliveFn) {
  if (!isAliveFn(pgid)) return true;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())) || pollIntervalMs);
    if (!isAliveFn(pgid)) return true;
  }
  return !isAliveFn(pgid);
}

/**
 * Stop the whole process group rooted at `pgid`: SIGTERM the group, poll for exit up to
 * `termWaitMs`, then SIGKILL the group and poll for exit up to `killWaitMs` before reporting
 * success. Returns one of:
 *   "already-exited" — the group was already dead before any signal was sent
 *   "terminated"     — SIGTERM alone was confirmed to end the group
 *   "killed"         — SIGKILL was confirmed to end the group (verified, not assumed)
 *   "kill-failed"     — SIGKILL was sent but the group STILL reports alive after `killWaitMs`
 *                       (e.g. an unreaped zombie, or a process stuck in uninterruptible
 *                       sleep) — this is reported honestly rather than optimistically
 *                       claiming "killed", since a caller (see runGroup) must not release a
 *                       run's single-flight lock while any group member might still survive.
 *
 * Safe to call on an already-dead group (no-op) and safe to call repeatedly/concurrently
 * (every signal is guarded by a liveness probe). `isGroupAliveFn` is a DI seam (defaults to
 * the real `isGroupAlive`) so tests can deterministically simulate a group that never
 * confirms dead, without depending on genuinely unreapable/zombie OS process state.
 */
export async function stopGroup(
  pgid,
  {
    termWaitMs = DEFAULT_TERM_WAIT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    killWaitMs = DEFAULT_KILL_WAIT_MS,
    signal = "SIGTERM",
    isGroupAliveFn = isGroupAlive,
  } = {},
) {
  if (!isGroupAliveFn(pgid)) return "already-exited";
  killGroupSignal(pgid, signal);
  if (await pollUntilDead(pgid, termWaitMs, pollIntervalMs, isGroupAliveFn)) return "terminated";

  killGroupSignal(pgid, "SIGKILL");
  if (await pollUntilDead(pgid, killWaitMs, pollIntervalMs, isGroupAliveFn)) return "killed";

  return "kill-failed";
}

/** Swallow-and-report wrapper around `stopGroup`: teardown must never throw into a caller
 * that is already mid-cleanup (a timeout/abort handler, a `close` listener). Also reports
 * (via `onError`, without throwing) a `"kill-failed"` result — that is just as much a
 * teardown failure as a thrown exception, and callers must be able to react to it the same
 * way (most importantly: never release a run's lock on the strength of a false "killed"). */
async function stopGroupSafely(pgid, options, onError) {
  try {
    const result = await stopGroup(pgid, options);
    if (result === "kill-failed") {
      onError?.(new Error(`process group ${pgid} still alive after SIGKILL confirmation window`));
    }
    return result;
  } catch (err) {
    onError?.(err);
    return "error";
  }
}

function waitForDrain(readable, destination, redactValues) {
  if (!readable || !destination) return Promise.resolve();
  const source = redactValues && redactValues.length > 0 ? readable.pipe(createRedactingTransform(redactValues)) : readable;
  return new Promise((resolve) => {
    source.pipe(destination);
    destination.on("finish", resolve);
    destination.on("error", resolve); // never let a log-stream error hang the run
  });
}

const REDACTION_MARKER = Buffer.from("[REDACTED]");

/**
 * A streaming Transform that scrubs every occurrence of any (non-empty) value in
 * `secretValues` from the bytes flowing through it, replacing each with a fixed
 * `[REDACTED]` marker (never a value-specific marker, so the marker itself can't leak which
 * secret matched). Built for exactly one purpose: an arbitrary script/executable — or
 * Copilot itself — can echo an injected secret env var straight back to its own
 * stdout/stderr, so raw piping from a child process to a persisted log file is never safe
 * once any secret has been injected into that child's environment.
 *
 * Correctness across chunk boundaries: a secret can be split arbitrarily across two (or
 * more) `write()` calls from the OS pipe. This holds back — as a bounded "carry" — the last
 * `maxSecretLength - 1` bytes of everything seen so far, and only emits bytes once enough
 * trailing lookahead has accumulated to KNOW no held-back byte could still be the start of
 * an as-yet-incomplete match. That bound means memory use never grows with stream size,
 * only with the length of the longest secret value being redacted.
 *
 * Matching order is longest-needle-first, deterministically: when one secret value is a
 * prefix of another (e.g. a short token and a longer token that starts with it), matching
 * the SHORTER one first at a shared start position would consume only that prefix and let
 * the longer secret's remaining suffix bytes fall through unredacted right next to the
 * `[REDACTED]` marker — a real leak of secret material, not just a cosmetic ordering
 * difference. Sorting needles by descending length before scanning means the longest
 * possible match at any position always wins. `Array.prototype.sort` is stable (guaranteed
 * since ES2019), so needles of equal length keep their original (de-duplicated, insertion)
 * order — the tie-break is deterministic, never dependent on `Set`/engine iteration quirks.
 */
export function createRedactingTransform(secretValues) {
  const needles = [...new Set((secretValues ?? []).filter((v) => typeof v === "string" && v.length > 0))]
    .map((v) => Buffer.from(v, "utf8"))
    .sort((a, b) => b.length - a.length);

  if (needles.length === 0) {
    return new Transform({
      transform(chunk, _encoding, callback) {
        callback(null, chunk);
      },
    });
  }

  const maxLen = Math.max(...needles.map((n) => n.length));
  const holdBack = maxLen - 1;
  let carry = Buffer.alloc(0);

  function scan(buf, emitLimit) {
    const pieces = [];
    let i = 0;
    while (i < emitLimit) {
      let matchedLength = 0;
      for (const needle of needles) {
        if (i + needle.length <= buf.length && buf.compare(needle, 0, needle.length, i, i + needle.length) === 0) {
          matchedLength = needle.length;
          break;
        }
      }
      if (matchedLength > 0) {
        pieces.push(REDACTION_MARKER);
        i += matchedLength;
      } else {
        pieces.push(buf.subarray(i, i + 1));
        i += 1;
      }
    }
    return { emitted: Buffer.concat(pieces), consumed: i };
  }

  return new Transform({
    transform(chunk, encoding, callback) {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      const buf = carry.length > 0 ? Buffer.concat([carry, incoming]) : incoming;
      const emitLimit = Math.max(0, buf.length - holdBack);
      const { emitted, consumed } = scan(buf, emitLimit);
      carry = buf.subarray(consumed);
      callback(null, emitted);
    },
    flush(callback) {
      // End of stream: no more lookahead is coming, so redact and emit everything left.
      const { emitted } = scan(carry, carry.length);
      carry = Buffer.alloc(0);
      callback(null, emitted);
    },
  });
}

/**
 * Run a spawned group to completion, enforcing an optional hard timeout and an optional
 * external AbortSignal (e.g. wired to the runner's own SIGINT/SIGTERM handler or an
 * abortable retry-backoff). `stdout`/`stderr`, when given, are Writable streams the child's
 * stdio is piped into; the returned promise only resolves once the child's own `close`
 * event has fired AND both destinations have finished/flushed, so a caller reading those
 * files back immediately after `await runGroup(...)` never sees truncated tail output.
 *
 * `redactSecrets`, when given a non-empty array of secret values, is applied to BOTH
 * `stdout` and `stderr` via `createRedactingTransform` before anything reaches disk: any
 * child process that had a secret injected into its env can echo it right back out, so raw
 * piping is never safe once a secret is in play.
 *
 * Resolves with `{ exitCode, signal, outcome, teardownConfirmed }` where `outcome` is one of:
 *   "exited"   — the process group exited on its own before any deadline
 *   "timedOut" — the timeout elapsed and the group was TERM'd/KILL'd
 *   "aborted"  — the external abort fired and the group was TERM'd/KILL'd
 *
 * If BOTH the timeout and the external abort fire (e.g. the caller aborts a run that is
 * also right at its timeout boundary), only the FIRST cause to arrive decides `outcome` and
 * owns the single stop attempt — a second, later-arriving cause is a no-op rather than
 * overwriting `outcome` or replacing the in-flight stop promise (see `triggerStop` below).
 *

 * `teardownConfirmed` is `false` whenever ANY stop attempt (the timeout/abort path, and/or
 * the post-close sweep below) reported `"kill-failed"` (or hit a thrown teardown error) —
 * i.e. the group was signaled with SIGKILL but never actually verified dead. Callers that
 * manage a single-flight lock around a run MUST treat `teardownConfirmed === false` as "do
 * not release the lock": a lingering group member means a second invocation could overlap
 * with a process this call was supposed to have stopped.
 *
 * Whatever the outcome, if the leader's own exit left a still-running grandchild behind (the
 * leader forked something and exited before it did), the whole group is swept one more time
 * before resolving — a normal exit must never leave a background process running.
 */
export function runGroup({
  command,
  args = [],
  cwd,
  env,
  stdout,
  stderr,
  redactSecrets,
  timeoutSeconds = 0,
  abortSignal,
  termWaitMs,
  killWaitMs,
  isGroupAliveFn, // DI seam, threaded through to stopGroup — see its own docs
  onSpawn,
  onStopping,
  onTeardownError,
}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnGroup({
        command,
        args,
        cwd,
        env,
        stdio: ["ignore", stdout ? "pipe" : "ignore", stderr ? "pipe" : "ignore"],
      });
    } catch (err) {
      reject(err);
      return;
    }
    onSpawn?.(child);

    const drainWaiters = [
      waitForDrain(child.stdout, stdout, redactSecrets),
      waitForDrain(child.stderr, stderr, redactSecrets),
    ];

    let settled = false;
    let outcome = "exited";
    let timer = null;
    let abortListener = null;
    let stopPromise = null; // set only if triggerStop actually fired (timeout/abort)
    let stopTriggered = false; // true the instant the FIRST cause (timeout XOR abort) wins

    const clearHandlers = () => {
      if (timer) clearTimeout(timer);
      if (abortListener && abortSignal) abortSignal.removeEventListener("abort", abortListener);
    };

    // Only the first of {timeout, abort} to fire may ever decide `outcome`/`stopPromise` —
    // whichever cause wins the `stopTriggered` race is authoritative. Without this guard, a
    // second, nearly-simultaneous cause (e.g. the abort signal firing microtasks after the
    // timeout, or vice versa) would silently overwrite `outcome` with the wrong reported
    // cause AND replace `stopPromise` with a second, independent `stopGroupSafely` call —
    // orphaning the first stop attempt's promise/result entirely (never awaited, its
    // teardown outcome — including a `"kill-failed"` that must not be lost — dropped) while
    // also risking two concurrent TERM/KILL sequences racing each other against the same
    // group. `clearHandlers()` here retires the OTHER, now-moot timer/listener immediately
    // rather than leaving it to fire later: a fired `{ once: true }` abort listener is
    // already detached and a fired timer is already inert, so this is only ever needed to
    // cancel the competing (not-yet-fired) one.
    const triggerStop = (nextOutcome) => {
      if (settled || stopTriggered) return;
      stopTriggered = true;
      outcome = nextOutcome;
      clearHandlers();
      onStopping?.({ pgid: child.pid, outcome: nextOutcome });
      stopPromise = stopGroupSafely(child.pid, { termWaitMs, killWaitMs, isGroupAliveFn }, onTeardownError);
    };

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearHandlers();
      reject(err);
    });

    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearHandlers();
      // The leader may have exited while a grandchild it forked (still in the same process
      // group) keeps running — sweep the whole group so a normal exit never leaves a
      // background process behind.
      const groupStillAlive = (isGroupAliveFn ?? isGroupAlive)(child.pid);
      const sweep = groupStillAlive
        ? stopGroupSafely(child.pid, { termWaitMs, killWaitMs, isGroupAliveFn }, onTeardownError)
        : Promise.resolve("already-exited");
      Promise.all([stopPromise ?? Promise.resolve(null), sweep, ...drainWaiters]).then(([stopResult, sweepResult]) => {
        const teardownConfirmed = ![stopResult, sweepResult].some((r) => r === "kill-failed" || r === "error");
        resolve({ exitCode, signal, outcome, teardownConfirmed });
      });
    });

    if (timeoutSeconds > 0) {
      timer = setTimeout(() => triggerStop("timedOut"), timeoutSeconds * 1000);
      timer.unref?.();
    }

    if (abortSignal) {
      abortListener = () => triggerStop("aborted");
      if (abortSignal.aborted) abortListener();
      else abortSignal.addEventListener("abort", abortListener, { once: true });
    }
  });
}

/**
 * Run a short-lived helper command to completion and capture its stdout/stderr in memory
 * (never on disk) with a bounded timeout. Built for one-shot lookups like the secrets
 * helper: no shell, no process-group log files, just `{ exitCode, signal, timedOut, stdout,
 * stderr }`. Callers are responsible for never logging `stdout`/`stderr` when the command
 * may have emitted a secret value.
 */
export function runCommandCapture({ command, args = [], cwd, env, timeoutSeconds = 0 }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnGroup({ command, args, cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      reject(err);
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout?.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk) => stderrChunks.push(chunk));

    let settled = false;
    let timedOut = false;
    let timer = null;

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });

    if (timeoutSeconds > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        void stopGroupSafely(child.pid, { termWaitMs: 2000 });
      }, timeoutSeconds * 1000);
      timer.unref?.();
    }
  });
}
