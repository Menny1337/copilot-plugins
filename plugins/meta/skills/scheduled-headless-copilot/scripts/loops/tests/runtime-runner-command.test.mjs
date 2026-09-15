import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCommand, buildEnv, buildPrompt, verifyExecutableIntegrity } from "../lib/runner-command.mjs";
import { copilotLoopFixture, scriptLoopFixture, makeScratchDir, cleanupScratch, cleanupScratchRoot } from "./runtime-helpers.mjs";

test.after(cleanupScratchRoot);

const run = { cliLogsDir: "/state/tasks/x/runs/run-1/cli-logs" };

test("buildPrompt prefixes a thin skill-invocation instruction only when a skill is configured", () => {
  const loop = copilotLoopFixture();
  assert.equal(buildPrompt(loop.execution), 'Use the "research-methodology" skill. ' + loop.execution.prompt);
  const noSkill = { ...loop.execution, skill: null };
  assert.equal(buildPrompt(noSkill), loop.execution.prompt);
});

test("buildCommand (copilot): never a shell string, includes every required hardening flag", () => {
  const loop = copilotLoopFixture();
  const { command, args, cwd } = buildCommand({
    loop,
    run,
    sessionId: "run-1",
    copilotBinary: "copilot",
    secretValues: { REPORT_TOKEN: "shh" },
  });

  assert.equal(command, "copilot");
  assert.ok(Array.isArray(args) && args.every((a) => typeof a === "string"));
  assert.equal(cwd, loop.execution.workingDirectory);

  const pairs = argPairs(args);
  assert.equal(pairs.get("-p"), buildPrompt(loop.execution));
  assert.equal(pairs.get("-C"), loop.execution.workingDirectory);
  assert.ok(args.includes("--autopilot"));
  assert.ok(args.includes("--allow-all-tools")); // permissions.allowAll === true in the fixture
  assert.ok(!args.includes("--allow-all"));
  assert.ok(args.includes("--no-ask-user"));
  assert.ok(args.includes("--no-auto-update"));
  assert.ok(args.includes("--no-color"));
  assert.equal(pairs.get("--output-format"), "json");
  assert.equal(pairs.get("--log-dir"), run.cliLogsDir);
  assert.equal(pairs.get("--session-id"), "run-1");
  assert.equal(pairs.get("--model"), loop.execution.model);
  assert.equal(pairs.get("--agent"), loop.execution.agent);
  assert.ok(args.includes("--secret-env-vars=REPORT_TOKEN"));

  // Secret VALUES must never appear anywhere in argv — only the secret NAME does.
  assert.ok(!args.some((a) => a.includes("shh")));
});

test("buildCommand (copilot): custom permission profile emits targeted allow/deny flags, not --allow-all-tools", () => {
  const loop = copilotLoopFixture({
    permissions: {
      profile: "custom",
      allowAll: false,
      allowTools: ["read", "write"],
      denyTools: ["shell"],
      allowUrls: ["https://example.com"],
      denyUrls: ["https://evil.example"],
    },
  });
  const { args } = buildCommand({ loop, run, sessionId: "run-1", secretValues: { REPORT_TOKEN: "x" } });
  assert.ok(!args.includes("--allow-all-tools"));
  assert.ok(args.includes("--allow-tool=read"));
  assert.ok(args.includes("--allow-tool=write"));
  assert.ok(args.includes("--deny-tool=shell"));
  assert.ok(args.includes("--allow-url=https://example.com"));
  assert.ok(args.includes("--deny-url=https://evil.example"));
});

test("buildCommand (copilot): extraPaths -> --add-dir and localPluginDirectories -> --plugin-dir, one flag per entry", () => {
  const loop = copilotLoopFixture({
    execution: {
      ...copilotLoopFixture().execution,
      extraPaths: ["/repo/reports", "/repo/out"],
      localPluginDirectories: ["/plugins/mine"],
    },
  });
  const { args } = buildCommand({ loop, run, sessionId: "run-1", secretValues: { REPORT_TOKEN: "x" } });
  assert.deepEqual(
    args.flatMap((a, i) => (a === "--add-dir" ? [args[i + 1]] : [])),
    ["/repo/reports", "/repo/out"],
  );
  assert.deepEqual(
    args.flatMap((a, i) => (a === "--plugin-dir" ? [args[i + 1]] : [])),
    ["/plugins/mine"],
  );
});

test("buildCommand (copilot): omits --secret-env-vars entirely when there are no declared secrets", () => {
  const loop = copilotLoopFixture({ environment: { plain: {}, secretNames: [] } });
  const { args } = buildCommand({ loop, run, sessionId: "run-1" });
  assert.ok(!args.some((a) => a.startsWith("--secret-env-vars")));
});

test("buildCommand (scriptFile/executable): spawns the manifest path + arguments directly, never a shell", () => {
  const loop = scriptLoopFixture();
  const { command, args, cwd } = buildCommand({ loop, run, sessionId: "run-1" });
  assert.equal(command, loop.execution.path);
  assert.deepEqual(args, loop.execution.arguments);
  assert.equal(cwd, loop.execution.workingDirectory);

  const dir = makeScratchDir("build-command-executable");
  try {
    const execPath = path.join(dir, "task");
    const body = "#!/bin/sh\necho direct\n";
    fs.writeFileSync(execPath, body);
    fs.chmodSync(execPath, 0o755);
    const executableLoop = scriptLoopFixture({
      execution: {
        type: "executable",
        path: execPath,
        arguments: ["--flag"],
        workingDirectory: dir,
        executableHash: sha256(Buffer.from(body)),
      },
    });
    const direct = buildCommand({ loop: executableLoop, run, sessionId: "run-1" });
    assert.equal(direct.command, execPath);
    assert.deepEqual(direct.args, ["--flag"]);
  } finally {
    cleanupScratch(dir);
  }
});

test("buildCommand rejects an unsupported execution type", () => {
  const loop = scriptLoopFixture({ execution: { ...scriptLoopFixture().execution, type: "shellString" } });
  assert.throws(() => buildCommand({ loop, run, sessionId: "run-1" }));
});

test("buildEnv layers PATH prepend, plain vars, then resolved secrets, and fails closed on a missing secret value", () => {
  const loop = copilotLoopFixture();
  const env = buildEnv({
    loop,
    secretValues: { REPORT_TOKEN: "s3cr3t" },
    baseEnv: { PATH: "/usr/bin", EXISTING: "1" },
    pathPrepend: ["/opt/homebrew/bin"],
  });
  assert.equal(env.PATH, ["/opt/homebrew/bin", "/usr/bin"].join(path.delimiter));
  assert.equal(env.REPORT_FORMAT, "markdown"); // from loop.environment.plain
  assert.equal(env.REPORT_TOKEN, "s3cr3t");
  assert.equal(env.EXISTING, "1");

  assert.throws(() => buildEnv({ loop, secretValues: {}, baseEnv: {} }), /missing resolved value/);
});

function argPairs(args) {
  const map = new Map();
  for (let i = 0; i < args.length; i += 1) {
    if (typeof args[i] === "string" && args[i].startsWith("-") && i + 1 < args.length) {
      map.set(args[i], args[i + 1]);
    }
  }
  return map;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

test("verifyExecutableIntegrity is trivially ok for the copilot execution type", async () => {
  const loop = copilotLoopFixture();
  assert.deepEqual(await verifyExecutableIntegrity(loop.execution), { ok: true });
});

test("verifyExecutableIntegrity accepts a scriptFile whose shebang+content hash match, rejects when either drifts", async () => {
  const dir = makeScratchDir("integrity-scriptfile");
  try {
    const scriptPath = path.join(dir, "task.sh");
    const body = "#!/bin/sh\necho hi\n";
    fs.writeFileSync(scriptPath, body);
    fs.chmodSync(scriptPath, 0o755);
    const execution = {
      type: "scriptFile",
      path: scriptPath,
      arguments: [],
      workingDirectory: dir,
      contentHash: sha256(Buffer.from(body)),
    };
    assert.deepEqual(await verifyExecutableIntegrity(execution), { ok: true });

    // Drift: file content changed after approval, hash no longer matches.
    fs.writeFileSync(scriptPath, "#!/bin/sh\necho tampered\n");
    fs.chmodSync(scriptPath, 0o755);
    assert.deepEqual(await verifyExecutableIntegrity(execution), { ok: false, reason: "hash-mismatch" });
  } finally {
    cleanupScratch(dir);
  }
});

test("verifyExecutableIntegrity rejects a scriptFile missing its shebang, and one that isn't executable", async () => {
  const dir = makeScratchDir("integrity-scriptfile-invalid");
  try {
    const noShebangPath = path.join(dir, "no-shebang.sh");
    const body = "echo hi\n";
    fs.writeFileSync(noShebangPath, body);
    fs.chmodSync(noShebangPath, 0o755);
    const noShebangExecution = {
      type: "scriptFile",
      path: noShebangPath,
      arguments: [],
      workingDirectory: dir,
      contentHash: sha256(Buffer.from(body)),
    };
    assert.deepEqual(await verifyExecutableIntegrity(noShebangExecution), { ok: false, reason: "missing-shebang" });

    const notExecutablePath = path.join(dir, "not-executable.sh");
    const shebangBody = "#!/bin/sh\necho hi\n";
    fs.writeFileSync(notExecutablePath, shebangBody);
    fs.chmodSync(notExecutablePath, 0o644); // no execute bit
    const notExecutableExecution = {
      type: "scriptFile",
      path: notExecutablePath,
      arguments: [],
      workingDirectory: dir,
      contentHash: sha256(Buffer.from(shebangBody)),
    };
    assert.deepEqual(await verifyExecutableIntegrity(notExecutableExecution), { ok: false, reason: "not-executable" });
  } finally {
    cleanupScratch(dir);
  }
});

test("verifyExecutableIntegrity for 'executable': a null hash now fails closed (missing-hash) — a null hash must never be treated as 'nothing to verify'", async () => {
  const dir = makeScratchDir("integrity-executable");
  try {
    const execPath = path.join(dir, "task");
    const body = "binary-ish content, not a real ELF/Mach-O for this test\n";
    fs.writeFileSync(execPath, body);
    fs.chmodSync(execPath, 0o755);

    const nullHashExecution = {
      type: "executable",
      path: execPath,
      arguments: [],
      workingDirectory: dir,
      executableHash: null,
    };
    assert.deepEqual(
      await verifyExecutableIntegrity(nullHashExecution),
      { ok: false, reason: "missing-hash" },
      "a null executableHash must fail closed, not silently allow an unreviewed binary to run",
    );

    const pinnedExecution = { ...nullHashExecution, executableHash: sha256(Buffer.from(body)) };
    assert.deepEqual(await verifyExecutableIntegrity(pinnedExecution), { ok: true });

    fs.writeFileSync(execPath, "tampered content\n");
    fs.chmodSync(execPath, 0o755);
    assert.deepEqual(await verifyExecutableIntegrity(pinnedExecution), { ok: false, reason: "hash-mismatch" });
  } finally {
    cleanupScratch(dir);
  }
});

test("verifyExecutableIntegrity reports a missing file and a directory-instead-of-file distinctly", async () => {
  const dir = makeScratchDir("integrity-missing");
  try {
    const placeholderHash = sha256(Buffer.from("placeholder approved executable"));
    const missingExecution = {
      type: "executable",
      path: path.join(dir, "does-not-exist"),
      arguments: [],
      workingDirectory: dir,
      executableHash: placeholderHash,
    };
    assert.deepEqual(await verifyExecutableIntegrity(missingExecution), { ok: false, reason: "missing" });

    const directoryExecution = { ...missingExecution, path: dir };
    assert.deepEqual(await verifyExecutableIntegrity(directoryExecution), { ok: false, reason: "not-a-regular-file" });
  } finally {
    cleanupScratch(dir);
  }
});
