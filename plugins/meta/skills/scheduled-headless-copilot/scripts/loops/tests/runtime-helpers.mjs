// runtime-helpers.mjs — shared scratch-directory + fixture helpers for the runtime kernel
// tests. Not a test file itself (no `.test.mjs` suffix, no `test-` prefix) so `node --test`
// never tries to execute it directly.
//
// All scratch state lives under this tests/ directory (never under the OS temp dir) and is
// removed by the caller's `after`/`afterEach` hook via `cleanupScratch`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
// `node --test` runs each test file in its own process, in parallel by default. Every test
// file that imports this helper gets a private scratch subdirectory (a fresh id per process)
// so concurrently-running files never race on the same directory tree.
const scratchRoot = path.join(here, ".scratch", `${process.pid}-${randomUUID()}`);

/** Create a fresh scratch directory for one test and return its absolute path. */
export function makeScratchDir(label = "run") {
  const dir = path.join(scratchRoot, `${label}-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove a single scratch directory tree. */
export function cleanupScratch(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Remove the whole shared scratch root (call once from an `after` hook per test file). */
export function cleanupScratchRoot() {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
}

/** Build a fake `env` object (for `COPILOT_LOOPS_HOME`) rooted at a fresh scratch dir. */
export function makeScratchEnv(label = "env") {
  const home = makeScratchDir(label);
  return { home, env: { COPILOT_LOOPS_HOME: home } };
}

const fixturesDir = path.resolve(here, "../contracts/fixtures");

export function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8"));
}

/** A minimal, schema-valid copilot-kind loop with a nonzero maxRetries, for retry tests. */
export function copilotLoopFixture(overrides = {}) {
  const base = loadFixture("copilot-loop.json");
  return { ...base, ...overrides };
}

export function scriptLoopFixture(overrides = {}) {
  const base = loadFixture("script-loop.json");
  return { ...base, ...overrides };
}

/** SHA-256 hex digest of a file's current on-disk content. */
export function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// The runtime's fail-closed executable-integrity check requires a real (non-null) SHA-256
// for BOTH scriptFile and executable execution — a null `executableHash` is no longer
// treated as "skip the check" (see runner-command.mjs's verifyExecutableIntegrity). Most
// "executable" test fixtures spawn `process.execPath` itself (the node binary; the actual
// test script is passed as an argument), so its hash is computed once and reused — it never
// changes within a single test run.
let cachedExecPathHash;
export function execPathHash() {
  if (!cachedExecPathHash) cachedExecPathHash = sha256File(process.execPath);
  return cachedExecPathHash;
}
