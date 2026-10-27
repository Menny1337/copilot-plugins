import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  atomicWriteFileSync,
  atomicWriteJSONSync,
  readJSONIfExistsSync,
  appendJSONLineSync,
  readJSONLinesSync,
} from "../lib/atomic.mjs";
import { makeScratchDir, cleanupScratch, cleanupScratchRoot } from "./runtime-helpers.mjs";

test.after(cleanupScratchRoot);

test("atomicWriteJSONSync writes readable JSON and leaves no temp file behind", () => {
  const dir = makeScratchDir("atomic-json");
  try {
    const file = path.join(dir, "nested", "run.json");
    atomicWriteJSONSync(file, { hello: "world" });
    assert.deepEqual(readJSONIfExistsSync(file), { hello: "world" });
    const siblings = fs.readdirSync(path.dirname(file));
    assert.deepEqual(siblings, ["run.json"]);
  } finally {
    cleanupScratch(dir);
  }
});

test("atomicWriteJSONSync never leaves a partially written file visible to a reader", () => {
  const dir = makeScratchDir("atomic-durability");
  try {
    const file = path.join(dir, "run.json");
    atomicWriteJSONSync(file, { status: "starting" });
    atomicWriteJSONSync(file, { status: "succeeded" });
    // A second write always replaces the file wholesale via rename — no reader can ever see
    // a half-written mix of the two versions.
    assert.deepEqual(readJSONIfExistsSync(file), { status: "succeeded" });
  } finally {
    cleanupScratch(dir);
  }
});

test("readJSONIfExistsSync returns the fallback when the file is missing", () => {
  const dir = makeScratchDir("atomic-missing");
  try {
    assert.equal(readJSONIfExistsSync(path.join(dir, "absent.json")), null);
    assert.deepEqual(readJSONIfExistsSync(path.join(dir, "absent.json"), []), []);
  } finally {
    cleanupScratch(dir);
  }
});

test("atomicWriteFileSync surfaces write errors without leaking the temp file", () => {
  const dir = makeScratchDir("atomic-error");
  try {
    // Point the target at a path whose parent cannot be created (a file, not a directory).
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x");
    const impossibleTarget = path.join(blocker, "child", "run.json");
    assert.throws(() => atomicWriteFileSync(impossibleTarget, "data"));
    const siblings = fs.readdirSync(dir);
    assert.deepEqual(siblings, ["blocker"]);
  } finally {
    cleanupScratch(dir);
  }
});

test("appendJSONLineSync/readJSONLinesSync round-trip an append-only log", () => {
  const dir = makeScratchDir("events");
  try {
    const file = path.join(dir, "events.jsonl");
    assert.deepEqual(readJSONLinesSync(file), []);
    appendJSONLineSync(file, { type: "run.created" });
    appendJSONLineSync(file, { type: "run.attempt.started", number: 1 });
    assert.deepEqual(readJSONLinesSync(file), [
      { type: "run.created" },
      { type: "run.attempt.started", number: 1 },
    ]);
  } finally {
    cleanupScratch(dir);
  }
});

test("readJSONLinesSync skips a torn trailing line instead of failing the whole read", () => {
  const dir = makeScratchDir("events-torn");
  try {
    const file = path.join(dir, "events.jsonl");
    appendJSONLineSync(file, { type: "run.created" });
    fs.appendFileSync(file, '{"type":"run.attempt.st'); // simulate a crash mid-append
    assert.deepEqual(readJSONLinesSync(file), [{ type: "run.created" }]);
  } finally {
    cleanupScratch(dir);
  }
});

test("readJSONLinesSync surfaces a corrupt line that is NOT the final line, instead of silently dropping it", () => {
  const dir = makeScratchDir("events-corrupt-middle");
  try {
    const file = path.join(dir, "events.jsonl");
    appendJSONLineSync(file, { type: "run.created" });
    // A corrupt line buried in the middle of the log is real corruption, not a torn write —
    // only the LAST line of the file gets torn-write tolerance.
    fs.appendFileSync(file, '{"type":"corrupt-middle"\n');
    appendJSONLineSync(file, { type: "run.attempt.started", number: 1 });
    assert.throws(() => readJSONLinesSync(file), /corrupt JSONL record/);
  } finally {
    cleanupScratch(dir);
  }
});

// ── injected write/fsync failure + partial-write fault injection ──────────────────────────
//
// `fakeFs` delegates every call to the real `node:fs` module except the methods named in
// `overrides`, letting these tests exercise genuine failure paths (a write that throws mid
// atomic-write, a writeSync that only ever consumes part of the buffer) without touching the
// real filesystem's error surface (full disk, EINTR, ...) or any global monkey-patching.
function fakeFs(overrides = {}) {
  return new Proxy(fs, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(overrides, prop)) return overrides[prop];
      return target[prop];
    },
  });
}

test("atomicWriteFileSync cleans up the temp file when fsyncSync fails AFTER a successful write (not just on a failed rename)", () => {
  const dir = makeScratchDir("atomic-fsync-fail");
  try {
    const file = path.join(dir, "run.json");
    fs.writeFileSync(file, "previous-good-content");
    const boom = new Error("simulated fsync failure");
    const fsImpl = fakeFs({
      fsyncSync: () => {
        throw boom;
      },
    });
    assert.throws(() => atomicWriteFileSync(file, "new-content", { fsImpl }), /simulated fsync failure/);
    // No leaked `.run.json.<pid>.<uuid>.tmp` sibling — cleanup runs even though the failure
    // happened before rename was ever attempted.
    const siblings = fs.readdirSync(dir);
    assert.deepEqual(siblings, ["run.json"]);
    // The previous, good version of the destination file is left completely untouched.
    assert.equal(fs.readFileSync(file, "utf8"), "previous-good-content");
  } finally {
    cleanupScratch(dir);
  }
});

test("atomicWriteFileSync cleans up the temp file when writeSync itself throws mid-write", () => {
  const dir = makeScratchDir("atomic-write-fail");
  try {
    const file = path.join(dir, "run.json");
    const boom = new Error("simulated disk-full write failure");
    const fsImpl = fakeFs({
      writeSync: () => {
        throw boom;
      },
    });
    assert.throws(() => atomicWriteFileSync(file, "content", { fsImpl }), /simulated disk-full write failure/);
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.equal(fs.existsSync(file), false);
  } finally {
    cleanupScratch(dir);
  }
});

test("atomicWriteFileSync never assumes a single writeSync call flushes the whole buffer — a short-write fsImpl still produces the complete file", () => {
  const dir = makeScratchDir("atomic-short-write");
  try {
    const file = path.join(dir, "run.json");
    const body = JSON.stringify({ big: "x".repeat(5000) });
    let calls = 0;
    const fsImpl = fakeFs({
      writeSync: (fd, buffer, offset, length) => {
        calls += 1;
        // Simulate a short write: never consume more than 17 bytes per call.
        const chunk = Math.min(17, length);
        return fs.writeSync(fd, buffer, offset, chunk);
      },
    });
    atomicWriteFileSync(file, body, { fsImpl });
    assert.equal(fs.readFileSync(file, "utf8"), body);
    assert.ok(calls > 1, "expected writeFullySync to loop across multiple short writes");
    assert.deepEqual(fs.readdirSync(dir), ["run.json"]);
  } finally {
    cleanupScratch(dir);
  }
});

test("atomicWriteFileSync surfaces (rather than infinite-loops on) a writeSync that makes zero progress", () => {
  const dir = makeScratchDir("atomic-zero-progress");
  try {
    const file = path.join(dir, "run.json");
    const fsImpl = fakeFs({ writeSync: () => 0 });
    assert.throws(() => atomicWriteFileSync(file, "content", { fsImpl }), /made no progress/);
    assert.deepEqual(fs.readdirSync(dir), []); // temp file still cleaned up
  } finally {
    cleanupScratch(dir);
  }
});

test("appendJSONLineSync writes the complete line even when writeSync only accepts a few bytes at a time", () => {
  const dir = makeScratchDir("append-short-write");
  try {
    const file = path.join(dir, "events.jsonl");
    const fsImpl = fakeFs({
      writeSync: (fd, buffer, offset, length) => {
        const chunk = Math.min(6, length);
        return fs.writeSync(fd, buffer, offset, chunk);
      },
    });
    appendJSONLineSync(file, { type: "run.created", note: "a".repeat(500) }, { fsImpl });
    appendJSONLineSync(file, { type: "run.attempt.started", number: 1 }, { fsImpl });
    assert.deepEqual(readJSONLinesSync(file), [
      { type: "run.created", note: "a".repeat(500) },
      { type: "run.attempt.started", number: 1 },
    ]);
  } finally {
    cleanupScratch(dir);
  }
});

test("appendJSONLineSync propagates a writeSync failure (caller sees the error; fd is still closed)", () => {
  const dir = makeScratchDir("append-write-fail");
  try {
    const file = path.join(dir, "events.jsonl");
    let closed = false;
    const boom = new Error("simulated append write failure");
    const fsImpl = fakeFs({
      writeSync: () => {
        throw boom;
      },
      closeSync: (fd) => {
        closed = true;
        return fs.closeSync(fd);
      },
    });
    assert.throws(() => appendJSONLineSync(file, { type: "x" }, { fsImpl }), /simulated append write failure/);
    assert.equal(closed, true);
  } finally {
    cleanupScratch(dir);
  }
});
