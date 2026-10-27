import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawnGroup, stopGroup, runGroup, runCommandCapture, isProcessAlive, isGroupAlive, createRedactingTransform } from "../lib/process-tree.mjs";
import { makeScratchDir, cleanupScratch, cleanupScratchRoot } from "./runtime-helpers.mjs";

test.after(cleanupScratchRoot);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeFakeScript(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
  return file;
}

test("isProcessAlive distinguishes the current process from an implausible pid", () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(999999), false);
  assert.equal(isProcessAlive(0), false);
  assert.equal(isProcessAlive(-5), false);
});

test("runGroup resolves with the child's real exit code for a fast command", async () => {
  const result = await runGroup({ command: process.execPath, args: ["-e", "process.exit(7)"] });
  assert.equal(result.exitCode, 7);
  assert.equal(result.signal, null);
  assert.equal(result.outcome, "exited");
});

test("runGroup never builds a shell string — an argument with shell metacharacters is inert", async () => {
  const dir = makeScratchDir("proc-argv");
  try {
    const marker = path.join(dir, "marker");
    // If this were run through a shell, `; touch marker` would execute as a second command.
    const result = await runGroup({
      command: process.execPath,
      args: ["-e", "process.exit(0)", `; echo unsafe > ${marker}`],
    });
    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(marker), false, "shell metacharacters in argv must never be interpreted");
  } finally {
    cleanupScratch(dir);
  }
});

test("runGroup enforces a hard timeout and kills the whole process group, not just the leader", async () => {
  const dir = makeScratchDir("proc-timeout");
  try {
    const childMarker = path.join(dir, "child-alive");
    // The grandchild writes its own pid to `childMarker` then idles; the leader spawns it as
    // its own `child_process` (so it is *not* the direct pid runGroup tracks) and then also
    // idles. A naive "kill just the top pid" teardown would leave this grandchild running.
    writeFakeScript(
      dir,
      "grandchild.js",
      `require("node:fs").writeFileSync(process.env.MARKER, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
    );
    const script = writeFakeScript(
      dir,
      "leader.js",
      `const { spawn } = require("node:child_process");\n` +
        `const path = require("node:path");\n` +
        `spawn(process.execPath, [path.join(__dirname, "grandchild.js")], { stdio: "ignore" });\n` +
        `setInterval(() => {}, 1000);\n`,
    );
    const start = Date.now();
    const result = await runGroup({
      command: process.execPath,
      args: [script],
      env: { ...process.env, MARKER: childMarker },
      timeoutSeconds: 1,
      termWaitMs: 500,
    });
    const elapsed = Date.now() - start;
    assert.equal(result.outcome, "timedOut");
    assert.ok(result.signal === "SIGTERM" || result.signal === "SIGKILL", `expected a kill signal, got ${result.signal}`);
    assert.ok(elapsed < 5000, `teardown should be bounded, took ${elapsed}ms`);

    await sleep(200); // let the grandchild's marker file appear and its process die
    assert.ok(fs.existsSync(childMarker), "grandchild should have started");
    const grandchildPid = Number.parseInt(fs.readFileSync(childMarker, "utf8"), 10);
    assert.equal(isProcessAlive(grandchildPid), false, "grandchild must die with the group, not survive it");
  } finally {
    cleanupScratch(dir);
  }
});

test("stopGroup is a safe no-op against an already-exited pid", async () => {
  const child = spawnGroup({ command: process.execPath, args: ["-e", "process.exit(0)"] });
  await new Promise((resolve) => child.on("exit", resolve));
  const outcome = await stopGroup(child.pid, { termWaitMs: 100 });
  assert.equal(outcome, "already-exited");
});

test("runGroup honors an external AbortSignal by stopping the group and reporting 'aborted'", async () => {
  const controller = new AbortController();
  const promise = runGroup({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000);"],
    abortSignal: controller.signal,
    termWaitMs: 500,
  });
  await sleep(50);
  controller.abort();
  const result = await promise;
  assert.equal(result.outcome, "aborted");
});

test("isGroupAlive checks the whole process group, not just the leader pid", async () => {
  assert.equal(isGroupAlive(999999), false);
  assert.equal(isGroupAlive(0), false);

  // A freshly spawned detached child is its own group leader (pgid === pid): the group must
  // read as alive while it runs, and as dead once it has exited — the same distinction
  // `isProcessAlive` makes for a single pid, just for the whole group.
  const child = spawnGroup({ command: process.execPath, args: ["-e", "setInterval(() => {}, 1000);"] });
  await sleep(50);
  assert.equal(isGroupAlive(child.pid), true);
  await stopGroup(child.pid, { termWaitMs: 500 });
  assert.equal(isGroupAlive(child.pid), false);
});

async function waitUntil(predicate, { timeoutMs = 3000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

test("runGroup sweeps a grandchild that outlives a normally-exiting leader — a clean exit must not leave a background process", async () => {
  const dir = makeScratchDir("proc-orphan");
  try {
    const childMarker = path.join(dir, "child-alive");
    // The leader forks a grandchild that idles forever, writes the grandchild's pid itself
    // (synchronously, before it exits — no race with the grandchild's own bootstrap), then
    // the LEADER exits normally and quickly — no timeout, no abort. A naive implementation
    // would resolve as soon as the leader's own `close` event fires, leaving the grandchild
    // running forever.
    writeFakeScript(dir, "grandchild.js", `setInterval(() => {}, 1000);\n`);
    const script = writeFakeScript(
      dir,
      "leader.js",
      `const { spawn } = require("node:child_process");\n` +
        `const fs = require("node:fs");\n` +
        `const path = require("node:path");\n` +
        `const grandchild = spawn(process.execPath, [path.join(__dirname, "grandchild.js")], { stdio: "ignore" });\n` +
        `fs.writeFileSync(process.env.MARKER, String(grandchild.pid));\n` +
        `process.exit(0);\n`, // leader exits immediately; grandchild is left running
    );
    const result = await runGroup({
      command: process.execPath,
      args: [script],
      env: { ...process.env, MARKER: childMarker },
      termWaitMs: 500,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.outcome, "exited");

    assert.ok(fs.existsSync(childMarker), "the leader must have recorded the grandchild's pid before exiting");
    const grandchildPid = Number.parseInt(fs.readFileSync(childMarker, "utf8"), 10);
    // Give the OS a brief moment to deliver/process the sweep's kill signal.
    await waitUntil(() => !isProcessAlive(grandchildPid));
    assert.equal(
      isProcessAlive(grandchildPid),
      false,
      "a normal leader exit must not leave a background grandchild running",
    );
  } finally {
    cleanupScratch(dir);
  }
});

test("runGroup invokes onStopping before the group is signaled, for both timeout and abort", async () => {
  const stoppingCalls = [];
  await runGroup({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000);"],
    timeoutSeconds: 1,
    termWaitMs: 300,
    onStopping: (info) => stoppingCalls.push(info.outcome),
  });
  assert.deepEqual(stoppingCalls, ["timedOut"]);

  const controller = new AbortController();
  const abortCalls = [];
  const promise = runGroup({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000);"],
    abortSignal: controller.signal,
    termWaitMs: 300,
    onStopping: (info) => abortCalls.push(info.outcome),
  });
  await sleep(30);
  controller.abort();
  await promise;
  assert.deepEqual(abortCalls, ["aborted"]);
});

test("runGroup: when timeout fires first, a later abort() must not overwrite the outcome or trigger a second stop", async () => {
  const controller = new AbortController();
  const stoppingCalls = [];
  // isGroupAliveFn always reports "alive": this keeps the FIRST stop attempt's confirmation
  // window open (bounded by termWaitMs + killWaitMs below) long enough for the later,
  // competing cause to arrive while the first stop is still genuinely in flight — not merely
  // after the whole promise has already settled, which would prove nothing about the
  // stopTriggered guard specifically.
  const alwaysAlive = () => true;
  const promise = runGroup({
    command: process.execPath,
    args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
    timeoutSeconds: 0.02,
    abortSignal: controller.signal,
    termWaitMs: 150,
    killWaitMs: 150,
    isGroupAliveFn: alwaysAlive,
    onStopping: (info) => stoppingCalls.push(info.outcome),
  });
  await sleep(60); // well after the 20ms timeout has fired and begun stopping, well before the
  // ~300ms (termWaitMs + killWaitMs) confirmation window elapses and the promise settles
  controller.abort();
  const result = await promise;
  assert.equal(result.outcome, "timedOut", "the first cause (timeout) must win");
  assert.deepEqual(stoppingCalls, ["timedOut"], "a later abort must never trigger a second onStopping call");
  assert.equal(result.teardownConfirmed, false, "sanity: alwaysAlive forces kill-failed for the (single) stop attempt");
});

test("runGroup: when abort fires first, a later timeout must not overwrite the outcome, and the competing timer must be cleared (never fires at all)", async () => {
  const controller = new AbortController();
  const stoppingCalls = [];
  const alwaysAlive = () => true;
  const promise = runGroup({
    command: process.execPath,
    args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
    timeoutSeconds: 0.1, // would fire at ~100ms if the timer were not cleared on abort
    abortSignal: controller.signal,
    termWaitMs: 150,
    killWaitMs: 150,
    isGroupAliveFn: alwaysAlive,
    onStopping: (info) => stoppingCalls.push(info.outcome),
  });
  await sleep(10); // let the child spawn
  controller.abort(); // fires well before the 100ms timeout would
  const result = await promise; // resolves at ~300ms — long past the 100ms timeout mark
  assert.equal(result.outcome, "aborted", "the first cause (abort) must win");
  assert.deepEqual(stoppingCalls, ["aborted"], "the competing timeout must never fire a second onStopping call once cleared");
  assert.equal(result.teardownConfirmed, false);
});

test("runGroup routes stdout/stderr to distinct destinations and resolves only after both drain (no truncated tail output)", async () => {
  const dir = makeScratchDir("proc-drain");
  try {
    const stdoutPath = path.join(dir, "stdout.log");
    const stderrPath = path.join(dir, "stderr.log");
    const stdout = fs.createWriteStream(stdoutPath);
    const stderr = fs.createWriteStream(stderrPath);
    const lines = 500; // enough output to exercise backpressure, not just a single small write
    const script =
      `for (let i = 0; i < ${lines}; i++) { process.stdout.write("out-" + i + "\\n"); process.stderr.write("err-" + i + "\\n"); }`;
    const result = await runGroup({ command: process.execPath, args: ["-e", script], stdout, stderr });
    assert.equal(result.exitCode, 0);

    const stdoutContent = fs.readFileSync(stdoutPath, "utf8");
    const stderrContent = fs.readFileSync(stderrPath, "utf8");
    assert.equal(stdoutContent.trim().split("\n").length, lines, "stdout must be fully drained, not truncated");
    assert.equal(stderrContent.trim().split("\n").length, lines, "stderr must be fully drained, not truncated");
    assert.ok(stdoutContent.includes(`out-${lines - 1}`), "the last stdout line must be present");
    assert.ok(!stdoutContent.includes("err-"), "stdout and stderr must never be interleaved into one file");
  } finally {
    cleanupScratch(dir);
  }
});

test("runCommandCapture captures stdout/stderr in memory with a bounded timeout, no shell, no disk artifact", async () => {
  const success = await runCommandCapture({
    command: process.execPath,
    args: ["-e", "process.stdout.write('the-value'); process.exit(0);"],
  });
  assert.equal(success.exitCode, 0);
  assert.equal(success.stdout, "the-value");
  assert.equal(success.timedOut, false);

  const start = Date.now();
  const timedOut = await runCommandCapture({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000);"],
    timeoutSeconds: 1,
  });
  const elapsed = Date.now() - start;
  assert.equal(timedOut.timedOut, true);
  assert.ok(elapsed < 5000, `capture with a timeout must resolve promptly, took ${elapsed}ms`);
});

// ── createRedactingTransform ──────────────────────────────────────────────────────────────

function collect(transform, chunks) {
  return new Promise((resolve, reject) => {
    const out = [];
    transform.on("data", (chunk) => out.push(chunk));
    transform.on("end", () => resolve(Buffer.concat(out).toString("utf8")));
    transform.on("error", reject);
    for (const chunk of chunks) transform.write(chunk);
    transform.end();
  });
}

test("createRedactingTransform passes bytes through unchanged when there is nothing to redact", async () => {
  const transform = createRedactingTransform([]);
  const output = await collect(transform, ["hello world\n", "second line\n"]);
  assert.equal(output, "hello world\nsecond line\n");
});

test("createRedactingTransform redacts a full secret value contained within a single chunk", async () => {
  const transform = createRedactingTransform(["s3cr3t-token-value"]);
  const output = await collect(transform, ["before s3cr3t-token-value after\n"]);
  assert.equal(output, "before [REDACTED] after\n");
  assert.ok(!output.includes("s3cr3t"));
});

test("createRedactingTransform redacts multiple distinct secret values, and repeated occurrences", async () => {
  const transform = createRedactingTransform(["secret-one", "secret-two"]);
  const output = await collect(transform, ["a=secret-one b=secret-two c=secret-one\n"]);
  assert.equal(output, "a=[REDACTED] b=[REDACTED] c=[REDACTED]\n");
});

test("createRedactingTransform matches unique secrets longest-first within a single chunk — a shorter secret must never mask/truncate a longer secret that shares its prefix", async () => {
  // "secret" is declared FIRST (and is itself a real, independently-meaningful secret), but
  // "secret-full-value-1234567890" is a SEPARATE, longer secret that happens to start with
  // it. Declaring the shorter needle first proves the longest-match wins because of an
  // explicit sort, not because of incidental Set/array iteration order.
  const shorter = "secret";
  const longer = "secret-full-value-1234567890";
  const transform = createRedactingTransform([shorter, longer]);
  const output = await collect(transform, [`before ${longer} after\n`]);
  assert.equal(output, "before [REDACTED] after\n");
  assert.ok(!output.includes("full-value"), "the longer secret's suffix must never leak next to the marker");
  assert.ok(!output.includes(longer));
});

test("createRedactingTransform matches unique secrets longest-first across a chunk boundary — the shorter prefix secret must never leak the longer one's suffix", async () => {
  const shorter = "secret";
  const longer = "secret-full-value-1234567890"; // shorter is an exact prefix of longer
  const transform = createRedactingTransform([shorter, longer]);
  // Split so the boundary falls exactly at the end of the shorter needle — the naive
  // (shorter-first, or unsorted) implementation would redact "secret" alone as soon as the
  // first chunk is scanned, emitting `[REDACTED]` immediately and leaking the rest of the
  // longer secret's suffix once the second chunk arrives.
  const output = await collect(transform, [`before ${shorter}`, `${longer.slice(shorter.length)} after\n`]);
  assert.equal(output, "before [REDACTED] after\n");
  assert.ok(!output.includes("full-value"));
  assert.ok(!output.includes(longer));
});

test("createRedactingTransform's longest-first matching is deterministic for equal-length needles regardless of declaration order", async () => {
  const a = "alpha-secret-01";
  const b = "bravo-secret-02"; // same length as `a`, no prefix relationship with it
  assert.equal(a.length, b.length);
  const forward = createRedactingTransform([a, b]);
  const reverse = createRedactingTransform([b, a]);
  const input = [`x=${a} y=${b} z=${a}\n`];
  const [outForward, outReverse] = await Promise.all([collect(forward, input), collect(reverse, input)]);
  assert.equal(outForward, "x=[REDACTED] y=[REDACTED] z=[REDACTED]\n");
  assert.equal(outForward, outReverse, "declaration order of equal-length needles must never change the result");
});

test("createRedactingTransform redacts a secret value split exactly across two chunk boundaries", async () => {
  const secret = "abcdefghijklmnopqrstuvwxyz-secret";
  const splitAt = 10;
  const transform = createRedactingTransform([secret]);
  const output = await collect(transform, [
    `start ${secret.slice(0, splitAt)}`,
    `${secret.slice(splitAt)} end\n`,
  ]);
  assert.equal(output, "start [REDACTED] end\n");
  assert.ok(!output.includes(secret.slice(0, splitAt)));
});

test("createRedactingTransform redacts a secret split across MANY small chunks (one byte at a time)", async () => {
  const secret = "another-long-secret-value-1234567890";
  const transform = createRedactingTransform([secret]);
  const chunks = [`before-`, ...secret.split(""), `-after\n`];
  const output = await collect(transform, chunks);
  assert.equal(output, "before-[REDACTED]-after\n");
});

test("createRedactingTransform never leaks a partial prefix of a secret across a chunk boundary", async () => {
  // Regression guard: an earlier, naive implementation emitted the "safe" prefix of a
  // straddling match unredacted, because it only searched for needles within the emitted
  // slice instead of the full accumulated (carry + chunk) buffer.
  const secret = "0123456789ABCDEF"; // 16 bytes
  const transform = createRedactingTransform([secret]);
  const output = await collect(transform, [`x${secret.slice(0, 15)}`, `${secret.slice(15)}y`]);
  assert.equal(output, "x[REDACTED]y");
  for (let i = 1; i <= secret.length; i += 1) {
    assert.ok(!output.includes(secret.slice(0, i)), `must not leak the ${i}-byte prefix of the secret`);
  }
});

test("createRedactingTransform redacts a secret value that arrives entirely within the final flush (nothing after it)", async () => {
  const secret = "trailing-secret-value";
  const transform = createRedactingTransform([secret]);
  const output = await collect(transform, [`only ${secret}`]);
  assert.equal(output, "only [REDACTED]");
});

test("runGroup redacts secret values from stdout/stderr before they ever reach the destination stream", async () => {
  const dir = makeScratchDir("proc-redact");
  try {
    const secret = "runtime-secret-abcdef-0123456789";
    const stdoutPath = path.join(dir, "stdout.log");
    const stderrPath = path.join(dir, "stderr.log");
    const stdout = fs.createWriteStream(stdoutPath);
    const stderr = fs.createWriteStream(stderrPath);
    const script =
      `process.stdout.write("prefix-"); process.stdout.write(${JSON.stringify(secret.slice(0, 12))});` +
      `process.stdout.write(${JSON.stringify(secret.slice(12))}); process.stdout.write("-suffix\\n");` +
      `process.stderr.write("err says: " + ${JSON.stringify(secret)} + "\\n");`;
    const result = await runGroup({
      command: process.execPath,
      args: ["-e", script],
      stdout,
      stderr,
      redactSecrets: [secret],
    });
    assert.equal(result.exitCode, 0);

    const stdoutContent = fs.readFileSync(stdoutPath, "utf8");
    const stderrContent = fs.readFileSync(stderrPath, "utf8");
    assert.equal(stdoutContent, "prefix-[REDACTED]-suffix\n");
    assert.equal(stderrContent, "err says: [REDACTED]\n");
    assert.ok(!stdoutContent.includes(secret) && !stdoutContent.includes(secret.slice(0, 12)));
    assert.ok(!stderrContent.includes(secret));
  } finally {
    cleanupScratch(dir);
  }
});

// ── stopGroup: bounded, EXPLICIT kill confirmation ──────────────────────────────────────

test("stopGroup confirms the group is actually gone after SIGKILL before reporting 'killed' — TERM-ignoring descendant", async () => {
  const dir = makeScratchDir("stopgroup-term-ignoring");
  try {
    // Installs a SIGTERM handler that does nothing, forcing stopGroup all the way through
    // its TERM-wait-then-KILL sequence. SIGKILL itself cannot be ignored, so the group must
    // end up confirmed dead — this exercises the real TERM -> (still alive) -> KILL ->
    // confirmed-dead path end to end, not just the "already dead" fast path.
    const child = spawnGroup({
      command: process.execPath,
      args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
    });
    await sleep(50); // let it install the handler before we ever signal it
    assert.equal(isGroupAlive(child.pid), true);

    const start = Date.now();
    const outcome = await stopGroup(child.pid, { termWaitMs: 300, killWaitMs: 2000, pollIntervalMs: 30 });
    const elapsed = Date.now() - start;

    assert.equal(outcome, "killed");
    assert.equal(isGroupAlive(child.pid), false, "stopGroup must not report 'killed' unless the group is actually confirmed dead");
    assert.ok(elapsed < 5000, `teardown should still be bounded overall, took ${elapsed}ms`);
  } finally {
    cleanupScratch(dir);
  }
});

test("stopGroup reports 'kill-failed' (never a false 'killed') when the group still shows alive after the kill-confirmation window", async () => {
  // A deterministic simulation via the isGroupAliveFn DI seam — no genuinely
  // unreapable/zombie OS process is needed (and wouldn't be reliably reproducible in a
  // test): the fake always reports "alive", modeling a group that SIGKILL was sent to but
  // never actually confirmed dead (e.g. an unreaped zombie, or a process stuck in
  // uninterruptible sleep).
  const alwaysAlive = () => true;
  const start = Date.now();
  const outcome = await stopGroup(999999, {
    termWaitMs: 50,
    killWaitMs: 50,
    pollIntervalMs: 10,
    isGroupAliveFn: alwaysAlive,
  });
  const elapsed = Date.now() - start;
  assert.equal(outcome, "kill-failed");
  assert.ok(elapsed < 2000, `the failure must still be bounded, took ${elapsed}ms`);
});

test("stopGroup: a group that dies during the TERM phase never needs SIGKILL and reports 'terminated'", async () => {
  const child = spawnGroup({ command: process.execPath, args: ["-e", "setInterval(() => {}, 1000);"] });
  await sleep(50);
  const outcome = await stopGroup(child.pid, { termWaitMs: 3000, pollIntervalMs: 30 });
  assert.equal(outcome, "terminated");
  assert.equal(isGroupAlive(child.pid), false);
});

test("runGroup resolves teardownConfirmed=true for a normal fast exit (nothing ever needed stopping)", async () => {
  const result = await runGroup({ command: process.execPath, args: ["-e", "process.exit(0)"] });
  assert.equal(result.teardownConfirmed, true);
});

test("runGroup resolves teardownConfirmed=false when SIGKILL never gets confirmed — the lock must not be released on this outcome", async () => {
  const alwaysAlive = () => true;
  const result = await runGroup({
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    timeoutSeconds: 0.05,
    termWaitMs: 30,
    killWaitMs: 30,
    isGroupAliveFn: alwaysAlive,
  });
  assert.equal(result.teardownConfirmed, false);
});

test("runGroup surfaces a teardown failure via onTeardownError (not just a thrown exception) when kill-failed", async () => {
  const alwaysAlive = () => true;
  const teardownErrors = [];
  await runGroup({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000);"],
    timeoutSeconds: 0.05,
    termWaitMs: 30,
    killWaitMs: 30,
    isGroupAliveFn: alwaysAlive,
    onTeardownError: (err) => teardownErrors.push(err),
  });
  assert.ok(teardownErrors.length > 0);
  assert.match(teardownErrors[0].message, /still alive after SIGKILL/);
});
