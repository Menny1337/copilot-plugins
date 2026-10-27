// atomic.mjs — durable, crash-safe file writes for the Copilot Loops runtime kernel.
//
// Every persisted record (loop.json, run.json, state.json) is written with a
// temp-file-in-the-same-directory + fsync + rename, so a reader never observes a
// partially written file and a crash mid-write leaves the previous version intact.
// events.jsonl is append-only and relies on POSIX's guarantee that writes issued
// with the O_APPEND flag (Node's "a" flag) are atomic for buffer sizes below the
// filesystem's atomic-write limit — appropriate for our single-line JSON records.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Write every byte of `data` to `fd`, looping over `fsImpl.writeSync` until fully
 * consumed. `fs.writeSync` is permitted by POSIX (and by Node's own typings) to write
 * fewer bytes than requested for a single call — e.g. on `EINTR`, a nearly-full disk, or
 * a destination that is not a plain regular file — so a single call must never be assumed
 * to have flushed arbitrary-sized data.
 */
function writeFullySync(fsImpl, fd, data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  let offset = 0;
  while (offset < buffer.length) {
    const written = fsImpl.writeSync(fd, buffer, offset, buffer.length - offset);
    // A conforming writeSync always makes progress (returns > 0) once it returns at all;
    // guard against an unexpected 0 to avoid ever spinning forever on a broken fsImpl.
    if (!written) {
      throw new Error("writeSync made no progress (returned 0 bytes written)");
    }
    offset += written;
  }
}

/**
 * Write `data` to `filePath` atomically: write to a sibling temp file, fsync it,
 * rename it over the destination, then fsync the containing directory so the
 * rename itself is durable. The ENTIRE open/write/fsync/close/rename path is covered by a
 * single try/catch so the temp file is always cleaned up on ANY failure along the way —
 * not just a failed rename — including a write or fsync error that occurs before the
 * rename is even attempted.
 */
export function atomicWriteFileSync(filePath, data, { mode, fsImpl = fs } = {}) {
  const dir = path.dirname(filePath);
  fsImpl.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let fd;
  try {
    fd = fsImpl.openSync(tempPath, "w", mode ?? 0o600);
    writeFullySync(fsImpl, fd, data);
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = undefined; // closed successfully; the outer catch must not double-close it
    fsImpl.renameSync(tempPath, filePath);
  } catch (err) {
    if (fd !== undefined) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        // fd may already be invalid/closed depending on which step failed; ignore.
      }
    }
    fsImpl.rmSync(tempPath, { force: true });
    throw err;
  }
  fsyncDirectorySync(dir, fsImpl);
}

/** Fsync a directory so a prior rename/unlink within it survives a crash. Best-effort: some
 * platforms/filesystems reject O_RDONLY fsync on directories; that failure is not fatal. */
function fsyncDirectorySync(dir, fsImpl = fs) {
  let fd;
  try {
    fd = fsImpl.openSync(dir, "r");
    fsImpl.fsyncSync(fd);
  } catch {
    // Best-effort only — directory fsync support is inconsistent across filesystems.
  } finally {
    if (fd !== undefined) fsImpl.closeSync(fd);
  }
}

/** Serialize `value` as pretty JSON with a trailing newline and write it atomically. */
export function atomicWriteJSONSync(filePath, value, options = {}) {
  const body = JSON.stringify(value, null, 2) + "\n";
  atomicWriteFileSync(filePath, body, options);
}

/** Read and JSON.parse a file, or return `fallback` (default null) if it does not exist. */
export function readJSONIfExistsSync(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

/**
 * Append one JSON record as a single line to an append-only log (events.jsonl).
 * Uses the "a" open flag so the kernel writes with O_APPEND, keeping concurrent
 * appenders (a run process and, e.g., an inspection tool) from interleaving bytes.
 * Writes the full line via `writeFullySync` rather than assuming a single `writeSync`
 * call consumes an arbitrarily large record; a genuine crash mid-write still leaves at
 * worst a torn trailing line, which `readJSONLinesSync` already tolerates.
 */
export function appendJSONLineSync(filePath, value, { fsImpl = fs } = {}) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  const line = JSON.stringify(value) + "\n";
  const fd = fsImpl.openSync(filePath, "a", 0o600);
  try {
    writeFullySync(fsImpl, fd, line);
    fsImpl.fsyncSync(fd);
  } finally {
    fsImpl.closeSync(fd);
  }
}

/** Read an append-only JSONL log as an array of parsed records; missing file -> []. Only the
 * final line may be malformed (a torn write from a crash mid-append) and is silently dropped;
 * a malformed line anywhere before the last is real corruption and must surface, not vanish. */
export function readJSONLinesSync(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const records = [];
  for (let i = 0; i < lines.length; i += 1) {
    const isLast = i === lines.length - 1;
    try {
      records.push(JSON.parse(lines[i]));
    } catch (err) {
      if (!isLast) {
        throw new Error(`corrupt JSONL record at ${filePath}:${i + 1}: ${err.message}`);
      }
      // A torn/partial final line (crash mid-append) is expected and silently dropped.
    }
  }
  return records;
}
