// locks.mjs — atomic mkdir single-flight lock with a stale-lock steal mutex.
//
// Direct port of templates/runner.sh's acquire_lock/take_steal to Node: `fs.mkdirSync`
// (non-recursive) is the atomic primitive — exactly one caller ever wins a given directory
// name. A lock held by a dead owner is reclaimed, but only after winning a *second* mkdir
// ("the steal mutex") so two racers that both observe a dead owner can't both recreate the
// lock and double-run the loop. The steal mutex is itself stale-aware (one level of
// reclaim), so a crash mid-steal self-heals on the very next attempt.
//
// A second, narrower race lives entirely inside "acquire": `mkdirSync` succeeding and the
// owner's pid actually landing in `pid` are two separate steps, not one atomic operation.
// A second caller that hits EEXIST in that gap sees a lock directory with no pid file yet —
// indistinguishable, from a single snapshot, from a process that crashed between the mkdir
// and the write. Treating that instant as "abandoned, reclaim it" is exactly how two callers
// can both end up believing they hold the lock (see `STALE_PID_GRACE_MS` below). We close
// that gap with directory-metadata-based age: a lock/steal dir with no valid pid is only
// ever eligible for reclaim once it has existed longer than a short, bounded grace window —
// long enough that no legitimate in-flight `mkdir` → `writeFileSync(pid)` gap could still be
// running, short enough that a genuine crash-before-pid-write is still reclaimed promptly
// (never a permanent orphan lock).

import fs from "node:fs";
import path from "node:path";
import { isProcessAlive } from "./process-tree.mjs";

// Real mkdir→writeFileSync gaps are sub-millisecond (two synchronous fs calls back to back);
// this is a very generous upper bound even under heavy scheduler/CI load.
const STALE_PID_GRACE_MS = 2000;

function pidFile(lockDir) {
  return path.join(lockDir, "pid");
}

function readOwnerPid(lockDir) {
  try {
    const raw = fs.readFileSync(pidFile(lockDir), "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/** How long (ms) `dir` has existed, via filesystem metadata — `birthtime` where the
 * filesystem supports it, falling back to `mtime`. Returns `Infinity` if `dir` no longer
 * exists (never treated as "too fresh to touch": nothing left to race over). */
function dirAgeMs(dir) {
  let st;
  try {
    st = fs.statSync(dir);
  } catch (err) {
    if (err.code === "ENOENT") return Infinity;
    throw err;
  }
  const createdAtMs = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
  return Date.now() - createdAtMs;
}

/** True if `dir` exists, has no valid pid file yet, AND is younger than the stale-pid grace
 * window — i.e. it is far more likely a legitimate concurrent acquirer caught between its
 * own `mkdir` and pid write than an abandoned lock, and must NOT be reclaimed yet. */
function isFreshWithoutPid(dir, staleGraceMs) {
  return readOwnerPid(dir) === null && dirAgeMs(dir) < staleGraceMs;
}

/**
 * Atomically create `lockDir` and stamp it with our pid. Returns false on EEXIST.
 *
 * `onAfterMkdir`, when given, is invoked synchronously right after the `mkdir` succeeds but
 * BEFORE the pid is written — i.e. exactly inside the race window this module exists to
 * close. This is a TEST-ONLY seam (production callers never pass it) that lets a test
 * deterministically inject a second, interleaved `acquireLock` call at the exact instant a
 * lock directory exists with no pid yet, without needing real multi-process concurrency.
 */
function tryCreate(lockDir, onAfterMkdir) {
  try {
    fs.mkdirSync(lockDir);
  } catch (err) {
    if (err.code === "EEXIST") return false;
    throw err;
  }
  onAfterMkdir?.();
  fs.writeFileSync(pidFile(lockDir), String(process.pid));
  return true;
}

/** Discard a lock/steal directory we know is stale/ours: rename it out of the way first
 * (so a concurrent stat never observes a half-removed directory), then delete it. */
function discard(dir) {
  const gravePath = `${dir}.dead.${process.pid}.${Date.now()}`;
  try {
    fs.renameSync(dir, gravePath);
  } catch (err) {
    if (err.code === "ENOENT") return; // already gone — another racer cleaned it up
    throw err;
  }
  fs.rmSync(gravePath, { recursive: true, force: true });
}

function stealDirFor(lockDir) {
  return `${lockDir}.steal`;
}

/** Win the steal mutex for `lockDir`. Returns true if we now hold it. A fresh, not-yet-
 * pid'd steal directory is treated the same way a fresh lock directory is: yield rather
 * than reclaim, since it's most likely another racer mid-`takeSteal` itself. */
function takeSteal(lockDir, staleGraceMs) {
  const steal = stealDirFor(lockDir);
  if (tryCreate(steal)) return true;
  const ownerPid = readOwnerPid(steal);
  if (ownerPid !== null && isProcessAlive(ownerPid)) return false; // a live racer is stealing
  if (isFreshWithoutPid(steal, staleGraceMs)) return false; // possibly mid-creation; yield
  discard(steal); // dead/stale holder -> reclaim
  return tryCreate(steal);
}

function releaseSteal(lockDir) {
  discard(stealDirFor(lockDir));
}

/**
 * Read-only peek: is `lockDir` currently held (or very likely about to be, mid-acquire)?
 * Never creates, steals, or removes anything — safe to call from anywhere (including a
 * caller that has no intention of ever acquiring the lock itself), and inherently racy by
 * nature (the answer can change the instant after this returns). This does NOT weaken
 * `acquireLock`'s atomic guarantee — it is purely an optimization for callers that want to
 * avoid the common case of doing work that would only be discarded by lock contention a
 * moment later (e.g. writing a manual-run request that the active run has no way to notice
 * before it finishes). Whatever calls this must still tolerate `acquireLock` losing the race
 * afterward. A fresh lock directory with no pid yet counts as held here too, consistent with
 * `acquireLock` yielding on it rather than reclaiming it.
 */
export function isLockHeld(lockDir, { staleGraceMs = STALE_PID_GRACE_MS } = {}) {
  const ownerPid = readOwnerPid(lockDir);
  if (ownerPid !== null) return isProcessAlive(ownerPid);
  return isFreshWithoutPid(lockDir, staleGraceMs);
}

/**
 * Attempt to acquire the single-flight lock at `lockDir`.
 *
 * Returns a handle `{ release() }` on success, or `null` if the lock is contended — either
 * by a live holder, OR by a lock directory that exists with no pid yet but is too fresh to
 * safely treat as abandoned (see the module docs above). `staleGraceMs` bounds how long a
 * pid-less lock/steal directory is protected from reclaim before it is treated as a genuine
 * crash-before-pid-write and reclaimed like any other dead lock — never a permanent orphan.
 * `onAfterMkdir` is a test-only seam; see `tryCreate`.
 */
export function acquireLock(lockDir, { staleGraceMs = STALE_PID_GRACE_MS, onAfterMkdir } = {}) {
  if (tryCreate(lockDir, onAfterMkdir)) return makeHandle(lockDir);

  const ownerPid = readOwnerPid(lockDir);
  if (ownerPid !== null && isProcessAlive(ownerPid)) return null; // held by a live run; yield
  if (isFreshWithoutPid(lockDir, staleGraceMs)) return null; // possibly mid-creation; yield

  if (!takeSteal(lockDir, staleGraceMs)) return null; // couldn't serialize the reclaim; yield
  try {
    // Re-check under the steal mutex: another racer may have already reclaimed and re-taken
    // the lock (or simply finished writing its pid) while we were winning the steal mutex.
    const recheckPid = readOwnerPid(lockDir);
    if (recheckPid !== null && isProcessAlive(recheckPid)) return null;
    if (isFreshWithoutPid(lockDir, staleGraceMs)) return null;
    discard(lockDir);
    return tryCreate(lockDir) ? makeHandle(lockDir) : null;
  } finally {
    releaseSteal(lockDir);
  }
}

function makeHandle(lockDir) {
  let released = false;
  return {
    lockDir,
    release() {
      if (released) return;
      released = true;
      // Only ever remove a lock directory we still own — guards against releasing a lock
      // that was stolen out from under us (which should never happen while we hold it, but
      // costs nothing to double-check).
      if (readOwnerPid(lockDir) === process.pid) {
        fs.rmSync(lockDir, { recursive: true, force: true });
      }
    },
  };
}
