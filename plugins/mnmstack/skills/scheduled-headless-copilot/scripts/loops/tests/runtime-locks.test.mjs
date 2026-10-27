import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { acquireLock, isLockHeld } from "../lib/locks.mjs";
import { makeScratchDir, cleanupScratch, cleanupScratchRoot } from "./runtime-helpers.mjs";

test.after(cleanupScratchRoot);

test("acquireLock grants the lock when nothing holds it, and release() removes it", () => {
  const dir = makeScratchDir("lock-basic");
  try {
    const lockDir = path.join(dir, "run.lock");
    const handle = acquireLock(lockDir);
    assert.ok(handle, "lock should be acquired");
    assert.ok(fs.existsSync(lockDir));
    assert.equal(fs.readFileSync(path.join(lockDir, "pid"), "utf8"), String(process.pid));
    handle.release();
    assert.equal(fs.existsSync(lockDir), false);
  } finally {
    cleanupScratch(dir);
  }
});

test("acquireLock yields (returns null) when a live process holds the lock", () => {
  const dir = makeScratchDir("lock-contended");
  try {
    const lockDir = path.join(dir, "run.lock");
    const first = acquireLock(lockDir);
    assert.ok(first);
    const second = acquireLock(lockDir);
    assert.equal(second, null, "a live holder must block a second acquire");
    first.release();
  } finally {
    cleanupScratch(dir);
  }
});

test("acquireLock reclaims a lock left by a dead pid", () => {
  const dir = makeScratchDir("lock-stale");
  try {
    const lockDir = path.join(dir, "run.lock");
    fs.mkdirSync(lockDir);
    // A pid essentially guaranteed to be dead/nonexistent on this host.
    fs.writeFileSync(path.join(lockDir, "pid"), "999999");

    const handle = acquireLock(lockDir);
    assert.ok(handle, "a stale lock must be reclaimed");
    assert.equal(fs.readFileSync(path.join(lockDir, "pid"), "utf8"), String(process.pid));
    handle.release();
    assert.equal(fs.existsSync(lockDir), false);
    // The steal mutex must never survive a successful reclaim.
    assert.equal(fs.existsSync(`${lockDir}.steal`), false);
  } finally {
    cleanupScratch(dir);
  }
});

test("acquireLock yields when the steal mutex is itself live-held by another racer", () => {
  const dir = makeScratchDir("lock-steal-contended");
  try {
    const lockDir = path.join(dir, "run.lock");
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, "pid"), "999999"); // stale owner -> triggers a steal attempt

    // Simulate a live racer that already won the steal mutex.
    fs.mkdirSync(`${lockDir}.steal`);
    fs.writeFileSync(path.join(`${lockDir}.steal`, "pid"), String(process.pid));

    const handle = acquireLock(lockDir);
    assert.equal(handle, null, "a live steal-mutex holder must block this racer");
    // The original (stale) lock is left untouched for the actual steal-mutex holder to finish.
    assert.ok(fs.existsSync(lockDir));
  } finally {
    cleanupScratch(dir);
  }
});

test("acquireLock self-heals a lock crashed mid-steal (dead steal-mutex owner)", () => {
  const dir = makeScratchDir("lock-steal-stale");
  try {
    const lockDir = path.join(dir, "run.lock");
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, "pid"), "999999");
    fs.mkdirSync(`${lockDir}.steal`);
    fs.writeFileSync(path.join(`${lockDir}.steal`, "pid"), "999998"); // also dead

    const handle = acquireLock(lockDir);
    assert.ok(handle, "a dead steal-mutex owner must be reclaimed one level deep");
    handle.release();
  } finally {
    cleanupScratch(dir);
  }
});

test("two concurrent racers against a stale lock never both win", async () => {
  const dir = makeScratchDir("lock-race");
  try {
    const lockDir = path.join(dir, "run.lock");
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, "pid"), "999999");

    const results = await Promise.all([
      Promise.resolve().then(() => acquireLock(lockDir)),
      Promise.resolve().then(() => acquireLock(lockDir)),
    ]);
    const winners = results.filter(Boolean);
    assert.equal(winners.length, 1, "exactly one racer must win the reclaimed lock");
    winners[0].release();
  } finally {
    cleanupScratch(dir);
  }
});

// ── isLockHeld (read-only peek, no side effects) ───────────────────────────────────────

test("isLockHeld is false for a lock directory that does not exist, and never creates one", () => {
  const dir = makeScratchDir("peek-missing");
  try {
    const lockDir = path.join(dir, "active.lock");
    assert.equal(isLockHeld(lockDir), false);
    assert.equal(fs.existsSync(lockDir), false, "peeking must never create the lock directory");
  } finally {
    cleanupScratch(dir);
  }
});

test("isLockHeld is true while a live process holds the lock, and never removes anything", () => {
  const dir = makeScratchDir("peek-live");
  try {
    const lockDir = path.join(dir, "active.lock");
    const handle = acquireLock(lockDir);
    assert.ok(handle);
    assert.equal(isLockHeld(lockDir), true);
    assert.ok(fs.existsSync(lockDir), "peeking must never remove a live lock");
    handle.release();
    assert.equal(isLockHeld(lockDir), false);
  } finally {
    cleanupScratch(dir);
  }
});

test("isLockHeld is false for a stale lock left by a dead pid, and does not reclaim/steal it", () => {
  const dir = makeScratchDir("peek-stale");
  try {
    const lockDir = path.join(dir, "active.lock");
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, "pid"), "999999"); // essentially guaranteed dead
    assert.equal(isLockHeld(lockDir), false);
    // A peek must never mutate the lock: no steal mutex, no reclaim, directory untouched.
    assert.ok(fs.existsSync(lockDir));
    assert.equal(fs.existsSync(`${lockDir}.steal`), false);
    assert.equal(fs.readFileSync(path.join(lockDir, "pid"), "utf8"), "999999");
  } finally {
    cleanupScratch(dir);
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Fresh (mkdir'd, not-yet-pid'd) lock directories must never be mistaken for abandoned ──

test("acquireLock: a second caller observing a fresh, not-yet-pid'd lock yields instead of stealing it (deterministic injected race)", () => {
  const dir = makeScratchDir("lock-fresh-race");
  try {
    const lockDir = path.join(dir, "active.lock");
    let secondCallerResult = "never-ran";
    const first = acquireLock(lockDir, {
      // Invoked synchronously right after our own mkdir succeeds but BEFORE we write our
      // pid — the exact race window: a second, fully independent acquireLock call must
      // yield here, never discard-and-recreate our still-forming lock (the bug this
      // closes: EEXIST + missing pid must not be treated as "abandoned, reclaim it").
      onAfterMkdir: () => {
        secondCallerResult = acquireLock(lockDir);
      },
    });
    assert.ok(first, "the original acquirer must still win its own lock");
    assert.equal(secondCallerResult, null, "a racer hitting the fresh pid-less window must yield, not steal");
    assert.equal(fs.readFileSync(path.join(lockDir, "pid"), "utf8"), String(process.pid));
    first.release();
  } finally {
    cleanupScratch(dir);
  }
});

test("acquireLock: MULTIPLE racers hitting the fresh pid-less window all yield — exactly one winner, never a double-acquire", () => {
  const dir = makeScratchDir("lock-fresh-race-multi");
  try {
    const lockDir = path.join(dir, "active.lock");
    const racerResults = [];
    const first = acquireLock(lockDir, {
      onAfterMkdir: () => {
        for (let i = 0; i < 5; i += 1) racerResults.push(acquireLock(lockDir));
      },
    });
    assert.ok(first);
    assert.ok(
      racerResults.every((r) => r === null),
      "every racer observing the fresh pid-less window must yield",
    );
    first.release();
  } finally {
    cleanupScratch(dir);
  }
});

test("isLockHeld reports true for a fresh, not-yet-pid'd lock directory (consistent with acquireLock yielding on it)", () => {
  const dir = makeScratchDir("lock-fresh-isheld");
  try {
    const lockDir = path.join(dir, "active.lock");
    fs.mkdirSync(lockDir); // mkdir succeeded; pid not written yet
    assert.equal(isLockHeld(lockDir), true);
    assert.equal(fs.existsSync(`${lockDir}.steal`), false, "isLockHeld must never create a steal mutex");
  } finally {
    cleanupScratch(dir);
  }
});

// ── Crashed-before-pid-write: reclaimable after a bounded grace window, never a permanent orphan ──

test("acquireLock reclaims a lock directory that crashed before writing its pid, once the stale-pid grace window elapses", async () => {
  const dir = makeScratchDir("lock-crashed-before-pid");
  try {
    const lockDir = path.join(dir, "active.lock");
    fs.mkdirSync(lockDir); // simulates: mkdir succeeded, then the owner crashed before pid

    // Immediately after creation it must still be treated as (probably) in-flight, not yet
    // reclaimable — the same protection a live racer would get.
    assert.equal(
      acquireLock(lockDir, { staleGraceMs: 50 }),
      null,
      "must not reclaim a pid-less lock before its grace window elapses",
    );
    assert.ok(fs.existsSync(lockDir), "an unreclaimed lock directory must be left untouched");

    await sleep(80); // age the directory past a short, test-scoped grace window

    const handle = acquireLock(lockDir, { staleGraceMs: 50 });
    assert.ok(handle, "a lock stuck pid-less well past the grace window must eventually be reclaimable — never a permanent orphan");
    assert.equal(fs.readFileSync(path.join(lockDir, "pid"), "utf8"), String(process.pid));
    assert.equal(fs.existsSync(`${lockDir}.steal`), false, "the steal mutex must not survive a successful reclaim");
    handle.release();
  } finally {
    cleanupScratch(dir);
  }
});

test("isLockHeld reports false once a pid-less lock ages past the grace window (matches acquireLock's reclaim decision)", async () => {
  const dir = makeScratchDir("lock-crashed-isheld");
  try {
    const lockDir = path.join(dir, "active.lock");
    fs.mkdirSync(lockDir);
    assert.equal(isLockHeld(lockDir, { staleGraceMs: 50 }), true);
    await sleep(80);
    assert.equal(isLockHeld(lockDir, { staleGraceMs: 50 }), false);
  } finally {
    cleanupScratch(dir);
  }
});

test("acquireLock: a fresh, not-yet-pid'd STEAL mutex is also never stolen from — the reclaim path gets the same protection", () => {
  const dir = makeScratchDir("lock-fresh-steal-race");
  try {
    const lockDir = path.join(dir, "active.lock");
    // A stale (dead-pid) lock directory that legitimately needs reclaiming...
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, "pid"), "999999");
    // ...but another racer has ALREADY won the steal mutex and just hasn't written its pid
    // into it yet — this must be indistinguishable from "a live racer is stealing" as far
    // as everyone else is concerned.
    fs.mkdirSync(`${lockDir}.steal`);

    assert.equal(acquireLock(lockDir), null, "a fresh pid-less steal mutex must block a second racer, same as a live one would");
    assert.ok(fs.existsSync(lockDir), "the original stale lock must be left for the steal-mutex holder to finish reclaiming");
  } finally {
    cleanupScratch(dir);
  }
});
