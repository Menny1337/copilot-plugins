import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { capabilityFingerprint } from "../lib/contracts.mjs";
import { taskPlistHashPath, taskPlistPath, launchdTarget } from "../lib/launchd.mjs";
import { loopDirectory, loopManifestPath } from "../lib/paths.mjs";
import { finalizeRun, createRun, readRun, runPaths } from "../lib/run-state.mjs";
import { cleanupScratch, cleanupScratchRoot, makeScratchEnv, scriptLoopFixture, copilotLoopFixture } from "./runtime-helpers.mjs";

const ctl = path.resolve(import.meta.dirname, "../../loops-ctl.mjs");

test.after(cleanupScratchRoot);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeExecutable(filePath, body) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, body, "utf8");
  await fsp.chmod(filePath, 0o755);
}

function runCtl(command, payload, env, inputRaw = null) {
  try {
    const stdout = execFileSync(process.execPath, [ctl, command], {
      input: inputRaw ?? JSON.stringify(payload ?? {}),
      encoding: "utf8",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

function loadedMarkerPath(env, target) {
  return path.join(env.FAKE_LAUNCHCTL_DIR, "loaded", target.replace(/[/:]/g, "_"));
}

async function markLoaded(env, loopId) {
  const marker = loadedMarkerPath(env, launchdTarget(loopId, undefined, env));
  await fsp.mkdir(path.dirname(marker), { recursive: true });
  await fsp.writeFile(marker, "loaded\n", "utf8");
}

async function readLaunchctlLog(env) {
  try {
    return await fsp.readFile(path.join(env.FAKE_LAUNCHCTL_DIR, "log.txt"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function reviewableScriptLoop(env, { scriptPath, workingDirectory, contentHash, execution = {}, ...overrides } = {}) {
  const base = scriptLoopFixture({
    id: "repo-maintenance",
    name: "Repository maintenance",
    lifecycle: "draft",
    execution: {
      type: "scriptFile",
      path: scriptPath,
      arguments: ["--prune", "--stats"],
      workingDirectory,
      contentHash,
    },
    approval: { fingerprint: null, approvedAt: null },
    createdAt: "2026-07-24T15:00:00Z",
    updatedAt: "2026-07-24T15:00:00Z",
  });
  return { ...base, ...overrides, execution: { ...base.execution, ...execution } };
}

function approvedScriptLoop(env, { id = "repo-maintenance", lifecycle = "ready", scriptPath, workingDirectory, secretNames = [], execution = {}, ...overrides } = {}) {
  const placeholderApproval = { fingerprint: "0".repeat(64), approvedAt: "2026-07-24T15:00:00Z" };
  const draft = scriptLoopFixture({
    id,
    name: overrides.name ?? "Repository maintenance",
    lifecycle,
    schedule: overrides.schedule ?? { kind: "manual" },
    execution: {
      type: execution.type ?? "scriptFile",
      path: scriptPath,
      arguments: execution.arguments ?? [],
      workingDirectory,
      contentHash: execution.type === "executable" ? undefined : (execution.contentHash ?? sha256(fs.readFileSync(scriptPath))),
      executableHash: execution.type === "executable" ? (execution.executableHash ?? sha256(fs.readFileSync(scriptPath))) : undefined,
    },
    environment: {
      plain: {},
      secretNames,
    },
    approval: placeholderApproval,
    createdAt: "2026-07-24T15:00:00Z",
    updatedAt: "2026-07-24T15:00:00Z",
    ...overrides,
  });
  const normalizedExecution = draft.execution.type === "executable"
    ? {
        type: "executable",
        path: scriptPath,
        arguments: execution.arguments ?? [],
        workingDirectory,
        executableHash: execution.executableHash ?? sha256(fs.readFileSync(scriptPath)),
      }
    : {
        type: execution.type ?? "scriptFile",
        path: scriptPath,
        arguments: execution.arguments ?? [],
        workingDirectory,
        contentHash: execution.contentHash ?? sha256(fs.readFileSync(scriptPath)),
      };
  const loop = {
    ...draft,
    execution: normalizedExecution,
    approval: placeholderApproval,
  };
  return {
    ...loop,
    approval: {
      fingerprint: capabilityFingerprint(loop),
      approvedAt: placeholderApproval.approvedAt,
    },
  };
}

function approvedCopilotLoop(env, { id = "nightly-dependency-report", lifecycle = "enabled", workingDirectory, localPluginDirectories = [] } = {}) {
  const placeholderApproval = { fingerprint: "0".repeat(64), approvedAt: "2026-07-24T15:00:00Z" };
  const loop = copilotLoopFixture({
    id,
    lifecycle,
    execution: {
      ...copilotLoopFixture().execution,
      workingDirectory,
      extraPaths: [],
      localPluginDirectories,
      installedPlugin: "core-agents",
      agent: "core-agents:researcher",
      skill: "research-methodology",
    },
    environment: {
      plain: {},
      secretNames: ["REPORT_TOKEN"],
    },
    approval: placeholderApproval,
    createdAt: "2026-07-24T15:00:00Z",
    updatedAt: "2026-07-24T15:00:00Z",
  });
  return {
    ...loop,
    approval: {
      fingerprint: capabilityFingerprint(loop),
      approvedAt: placeholderApproval.approvedAt,
    },
  };
}

async function persistLoop(loop, env, { blocked = false } = {}) {
  const manifestPath = loopManifestPath(loop.id, env);
  await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
  await fsp.writeFile(manifestPath, JSON.stringify(loop, null, 2) + "\n", "utf8");
  if (blocked) {
    await fsp.writeFile(path.join(loopDirectory(loop.id, env), "approval.blocked"), "Needs review\n", "utf8");
  }
}

async function writeLoopState(loopId, env, state) {
  const statePath = path.join(loopDirectory(loopId, env), "state.json");
  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  await fsp.writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

async function createPluginInventory(env) {
  const pluginRoot = path.join(env.HOME, ".copilot", "installed-plugins", "acme-marketplace", "core-agents");
  await fsp.mkdir(path.join(pluginRoot, "agents"), { recursive: true });
  await fsp.mkdir(path.join(pluginRoot, "skills", "research-methodology"), { recursive: true });
  await fsp.writeFile(path.join(pluginRoot, "plugin.json"), JSON.stringify({
    name: "core-agents",
    version: "1.2.3",
    description: "Testing plugin",
  }, null, 2) + "\n", "utf8");
  await fsp.writeFile(path.join(pluginRoot, "agents", "researcher.agent.md"), `---\nname: core-agents:researcher\ndescription: Test researcher\n---\n`, "utf8");
  await fsp.writeFile(path.join(pluginRoot, "skills", "research-methodology", "SKILL.md"), `---\nname: research-methodology\ndescription: Test research skill\nuser-invocable: true\n---\n`, "utf8");
}

async function setupEnv(label) {
  const { home } = makeScratchEnv(label);
  const fakeHome = path.join(home, "home");
  const binDir = path.join(home, "bin");
  const launchctlStateDir = path.join(home, "launchctl-state");
  const secretLog = path.join(home, "secret-helper.log");
  await fsp.mkdir(fakeHome, { recursive: true });
  await fsp.mkdir(binDir, { recursive: true });
  await fsp.mkdir(launchctlStateDir, { recursive: true });

  const launchctlPath = path.join(binDir, "fake-launchctl");
  const copilotPath = path.join(binDir, "copilot");
  const helperPath = path.join(binDir, "CopilotLoopsSecrets");

  await writeExecutable(launchctlPath, `#!/bin/sh\nset -eu\nSTATE_DIR=\"${launchctlStateDir}\"\nLOG=\"$STATE_DIR/log.txt\"\nmkdir -p \"$STATE_DIR/loaded\" \"$STATE_DIR/disabled\"\nprintf '%s\\n' \"$*\" >> \"$LOG\"\nsanitize() { printf '%s' \"$1\" | tr '/:' '__'; }\ncmd=\"$1\"\nshift || true\ncase \"$cmd\" in\n  print)\n    target=\"$1\"\n    [ -f \"$STATE_DIR/loaded/$(sanitize \"$target\")\" ] && exit 0 || exit 113\n    ;;\n  enable)\n    target=\"$1\"\n    rm -f \"$STATE_DIR/disabled/$(sanitize \"$target\")\"\n    exit 0\n    ;;\n  disable)\n    target=\"$1\"\n    touch \"$STATE_DIR/disabled/$(sanitize \"$target\")\"\n    exit 0\n    ;;\n  bootstrap)\n    domain=\"$1\"\n    plist=\"$2\"\n    label=$(basename \"$plist\" .plist)\n    target=\"$domain/$label\"\n    if [ \"\${FAKE_LAUNCHCTL_FAIL_BOOTSTRAP_LABEL:-}\" = \"$label\" ]; then\n      echo \"bootstrap failed for $label\" >&2\n      exit 71\n    fi\n    touch \"$STATE_DIR/loaded/$(sanitize \"$target\")\"\n    exit 0\n    ;;\n  bootout)\n    target=\"$1\"\n    if [ \"\${FAKE_LAUNCHCTL_FAIL_BOOTOUT_TARGET:-}\" = \"$target\" ]; then\n      echo \"bootout failed for $target\" >&2\n      exit 72\n    fi\n    rm -f \"$STATE_DIR/loaded/$(sanitize \"$target\")\"\n    exit 0\n    ;;\n  kickstart)\n    if [ \"\${1:-}\" = \"-k\" ]; then shift; fi\n    target=\"$1\"\n    if [ \"\${FAKE_LAUNCHCTL_FAIL_KICKSTART_TARGET:-}\" = \"$target\" ]; then\n      echo \"kickstart failed for $target\" >&2\n      exit 73\n    fi\n    touch \"$STATE_DIR/loaded/$(sanitize \"$target\")\"\n    exit 0\n    ;;\n  kill)\n    signal=\"$1\"\n    target=\"$2\"\n    if [ ! -f \"$STATE_DIR/loaded/$(sanitize \"$target\")\" ]; then\n      echo \"not loaded: $target\" >&2\n      exit 74\n    fi\n    rm -f \"$STATE_DIR/loaded/$(sanitize \"$target\")\"\n    exit 0\n    ;;\n  *)\n    echo \"unsupported command: $cmd\" >&2\n    exit 99\n    ;;\nesac\n`);

  await writeExecutable(copilotPath, `#!/bin/sh\nset -eu\nfail=\"\${FAKE_COPILOT_FAIL:-}\"\ncase \"$1 $2 $3\" in\n  \"plugins list --json\")\n    case \",$fail,\" in\n      *,plugins,*|*,both,*) echo \"plugins failed\" >&2; exit 41 ;;\n    esac\n    printf '{\"plugins\":[{\"kind\":\"plugin\",\"name\":\"core-agents\",\"scope\":\"user\",\"source\":\"marketplace:acme-marketplace\",\"enabled\":true,\"version\":\"1.2.3\",\"description\":\"Testing plugin\"}]}'\n\n    ;;
  \"skill list --json\")\n    case \",$fail,\" in\n      *,skills,*|*,both,*) echo \"skills failed\" >&2; exit 42 ;;\n    esac\n    printf '{\"skills\":[{\"name\":\"research-methodology\",\"enabled\":true,\"plugin\":\"core-agents\",\"description\":\"Test research skill\",\"userInvocable\":true}]}'\n\n    ;;
  *)\n    echo \"unexpected copilot args: $*\" >&2\n    exit 2\n    ;;
esac\n`);

  await writeExecutable(helperPath, `#!/bin/sh\nset -eu\nprintf '%s %s\\n' \"$1\" \"\${2:-}\" >> \"${secretLog}\"\ncase \"$1\" in\n  exists)\n    case \"\${2:-}\" in\n      *:MISSING_*) printf 'false\\n' ;;\n      *) printf 'true\\n' ;;\n    esac\n    ;;\n  get) printf 'secret-value-for-%s' \"\${2:-}\" ;;\n  set) cat >/dev/null ;;\n  delete)\n    if [ \"\${FAKE_SECRET_DELETE_FAIL_ACCOUNT:-}\" = \"\${2:-}\" ]; then\n      echo \"delete failed for \${2:-}\" >&2\n      exit 75\n    fi\n    ;;\n  *) exit 2 ;;\nesac\n`);

  const env = {
    ...process.env,
    HOME: fakeHome,
    COPILOT_HOME: path.join(fakeHome, ".copilot"),
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    COPILOT_LOOPS_HOME: home,
    COPILOT_LOOPS_LAUNCHCTL: launchctlPath,
    COPILOT_LOOPS_SECRETS_HELPER: helperPath,
    FAKE_LAUNCHCTL_DIR: launchctlStateDir,
  };
  await createPluginInventory(env);
  return { home, env, binDir, fakeHome, helperPath, secretLog, launchctlStateDir };
}

test("preflight approve and lifecycle transitions work end-to-end via the CLI", async () => {
  const { home, env } = await setupEnv("approve-lifecycle");
  try {
    const workingDirectory = path.join(home, "repo");
    const scriptPath = path.join(home, "bin", "repo-maintenance.sh");
    await fsp.mkdir(workingDirectory, { recursive: true });
    const scriptBody = "#!/bin/sh\necho maintenance\n";
    await writeExecutable(scriptPath, scriptBody);

    const loop = reviewableScriptLoop(env, {
      id: "repo-maintenance",
      workingDirectory,
      scriptPath,
      contentHash: sha256(scriptBody),
    });
    delete loop.createdAt;
    delete loop.updatedAt;

    const createRes = runCtl("create", { loop }, env);
    assert.equal(createRes.ok, true);
    assert.equal(createRes.data.loop.lifecycle, "needsReview");

    const preflight = runCtl("preflight", { id: "repo-maintenance" }, env);
    assert.equal(preflight.ok, true);
    assert.equal(preflight.data.errorDetails.length, 0);
    assert.equal(preflight.data.approval.status, "needs-review");
    assert.deepEqual(preflight.data.redactedCommand, [scriptPath, "--prune", "--stats"]);

    const approveRes = runCtl("approve", { id: "repo-maintenance", expectedFingerprint: preflight.data.fingerprint }, env);
    assert.equal(approveRes.ok, true);
    assert.equal(approveRes.data.loop.lifecycle, "ready");
    assert.equal(fs.existsSync(path.join(loopDirectory("repo-maintenance", env), "approval.blocked")), false);
    assert.equal(approveRes.data.schedule.desired, "booted-out");

    const enableRes = runCtl("enable", { id: "repo-maintenance" }, env);
    assert.equal(enableRes.ok, true);
    assert.equal(enableRes.data.loop.lifecycle, "enabled");
    assert.equal(enableRes.data.schedule.desired, "loaded");

    const pauseRes = runCtl("pause", { id: "repo-maintenance" }, env);
    assert.equal(pauseRes.ok, true);
    assert.equal(pauseRes.data.loop.lifecycle, "paused");
    assert.equal(pauseRes.data.schedule.desired, "loaded");

    const resumeRes = runCtl("resume", { id: "repo-maintenance" }, env);
    assert.equal(resumeRes.ok, true);
    assert.equal(resumeRes.data.loop.lifecycle, "enabled");

    const archiveRes = runCtl("archive", { id: "repo-maintenance" }, env);
    assert.equal(archiveRes.ok, true);
    assert.equal(archiveRes.data.loop.lifecycle, "archived");
    assert.equal(fs.existsSync(taskPlistPath("repo-maintenance", env)), false);
    assert.equal(fs.existsSync(taskPlistHashPath("repo-maintenance", env)), false);

    const launchctlLog = await readLaunchctlLog(env);
    assert.match(launchctlLog, /enable gui\//);
    assert.match(launchctlLog, /bootstrap gui\//);
    assert.match(launchctlLog, /bootout gui\//);
  } finally {
    cleanupScratch(home);
  }
});

test("preflight and approve fail closed for executable loops missing executableHash", async () => {
  const { home, env } = await setupEnv("approve-executable-hash");
  try {
    const workingDirectory = path.join(home, "repo");
    const executablePath = path.join(home, "bin", "task");
    const executableBody = "#!/bin/sh\necho executable\n";
    await fsp.mkdir(workingDirectory, { recursive: true });
    await writeExecutable(executablePath, executableBody);

    const loop = reviewableScriptLoop(env, {
      id: "unpinned-executable",
      workingDirectory,
      scriptPath: executablePath,
      execution: {
        type: "executable",
        path: executablePath,
        arguments: ["--once"],
        workingDirectory,
        contentHash: undefined,
        executableHash: null,
      },
    });
    delete loop.createdAt;
    delete loop.updatedAt;

    const createRes = runCtl("create", { loop }, env);
    assert.equal(createRes.ok, true);
    assert.equal(createRes.data.loop.lifecycle, "needsReview");

    const preflight = runCtl("preflight", { id: loop.id }, env);
    assert.equal(preflight.ok, true);
    assert.equal(preflight.data.approval.canApprove, false);
    const missingHash = preflight.data.errorDetails.find((entry) => entry.code === "executable-hash-missing");
    assert.ok(missingHash, "preflight must hard-fail an executable without executableHash");
    assert.equal(missingHash.context.currentHash, sha256(executableBody));

    const approveRes = runCtl("approve", { id: loop.id, expectedFingerprint: preflight.data.fingerprint }, env);
    assert.equal(approveRes.ok, false);
    assert.equal(approveRes.error.name, "UserError");
    assert.match(approveRes.error.message, /Cannot approve/);
    assert.ok(
      Array.isArray(approveRes.error.context?.errors) &&
        approveRes.error.context.errors.some((entry) => entry.code === "executable-hash-missing"),
    );
  } finally {
    cleanupScratch(home);
  }
});

test("update deletes only removed managed secrets and reports removedSecretNames", async () => {
  const { home, env, secretLog } = await setupEnv("update-secret-removal");
  try {
    const workingDirectory = path.join(home, "repo");
    const scriptPath = path.join(home, "bin", "update-secret-removal.sh");
    await fsp.mkdir(workingDirectory, { recursive: true });
    await writeExecutable(scriptPath, "#!/bin/sh\nexit 0\n");

    const loop = approvedScriptLoop(env, {
      id: "update-secret-removal",
      lifecycle: "ready",
      scriptPath,
      workingDirectory,
      secretNames: ["KEEP_TOKEN", "DROP_TOKEN"],
    });
    await persistLoop(loop, env);

    const updated = structuredClone(loop);
    updated.environment.secretNames = ["KEEP_TOKEN"];
    const updateRes = runCtl("update", { loop: updated }, env);
    assert.equal(updateRes.ok, true);
    assert.equal(updateRes.data.loop.lifecycle, "needsReview");
    assert.equal(updateRes.data.schedule.desired, "booted-out");
    assert.deepEqual(updateRes.data.removedSecretNames, ["DROP_TOKEN"]);
    assert.deepEqual(updateRes.data.secretNames, ["DROP_TOKEN"]);
    assert.equal(updateRes.data.secretDeletion.status, "deleted");
    assert.equal(updateRes.data.secretDeletion.deletedCount, 1);
    assert.deepEqual(updateRes.data.secretDeletion.deletedNames, ["DROP_TOKEN"]);
    assert.deepEqual(updateRes.data.secretDeletion.deletedAccounts, [`${loop.id}:DROP_TOKEN`]);
    assert.equal("warning" in updateRes.data, false);

    const stored = JSON.parse(await fsp.readFile(loopManifestPath(loop.id, env), "utf8"));
    assert.deepEqual(stored.environment.secretNames, ["KEEP_TOKEN"]);

    const helperLog = await fsp.readFile(secretLog, "utf8");
    assert.match(helperLog, new RegExp(`delete ${loop.id}:DROP_TOKEN`));
    assert.doesNotMatch(helperLog, new RegExp(`delete ${loop.id}:KEEP_TOKEN`));
  } finally {
    cleanupScratch(home);
  }
});

test("update persists removed secret changes and warns when helper cleanup fails", async () => {
  const { home, env, secretLog } = await setupEnv("update-secret-warning");
  try {
    const workingDirectory = path.join(home, "repo");
    const scriptPath = path.join(home, "bin", "update-secret-warning.sh");
    await fsp.mkdir(workingDirectory, { recursive: true });
    await writeExecutable(scriptPath, "#!/bin/sh\nexit 0\n");

    const loop = approvedScriptLoop(env, {
      id: "update-secret-warning",
      lifecycle: "ready",
      scriptPath,
      workingDirectory,
      secretNames: ["DROP_TOKEN"],
    });
    await persistLoop(loop, env);

    const updated = structuredClone(loop);
    updated.environment.secretNames = [];
    const failureEnv = { ...env, FAKE_SECRET_DELETE_FAIL_ACCOUNT: `${loop.id}:DROP_TOKEN` };
    const updateRes = runCtl("update", { loop: updated }, failureEnv);
    assert.equal(updateRes.ok, true);
    assert.equal(updateRes.data.loop.lifecycle, "needsReview");
    assert.deepEqual(updateRes.data.removedSecretNames, ["DROP_TOKEN"]);
    assert.deepEqual(updateRes.data.secretNames, ["DROP_TOKEN"]);
    assert.match(updateRes.data.warning, /could not be deleted/i);
    assert.equal(updateRes.data.secretDeletion.status, "failed");
    assert.equal(updateRes.data.secretDeletion.deletedCount, 0);
    assert.equal(updateRes.data.secretDeletion.failedName, "DROP_TOKEN");
    assert.equal(updateRes.data.secretDeletion.failedAccount, `${loop.id}:DROP_TOKEN`);
    assert.equal(updateRes.data.secretDeletion.error.code, "helper-delete-failed");

    const stored = JSON.parse(await fsp.readFile(loopManifestPath(loop.id, env), "utf8"));
    assert.deepEqual(stored.environment.secretNames, []);

    const helperLog = await fsp.readFile(secretLog, "utf8");
    assert.match(helperLog, new RegExp(`delete ${loop.id}:DROP_TOKEN`));
  } finally {
    cleanupScratch(home);
  }
});

test("enable fails closed and restores the previous lifecycle when launchctl bootstrap fails", async () => {
  const { home, env } = await setupEnv("enable-rollback");
  try {
    const workingDirectory = path.join(home, "repo");
    const scriptPath = path.join(home, "bin", "runner.sh");
    await fsp.mkdir(workingDirectory, { recursive: true });
    const scriptBody = "#!/bin/sh\nexit 0\n";
    await writeExecutable(scriptPath, scriptBody);
    const loop = approvedScriptLoop(env, {
      id: "bootstrap-failure",
      lifecycle: "ready",
      scriptPath,
      workingDirectory,
    });
    await persistLoop(loop, env);

    const label = `com.copilotplugins.copilot-loops.task.${loop.id}`;
    const failureEnv = { ...env, FAKE_LAUNCHCTL_FAIL_BOOTSTRAP_LABEL: label };
    const enableRes = runCtl("enable", { id: loop.id }, failureEnv);
    assert.equal(enableRes.ok, false);
    assert.equal(enableRes.error.name, "UserError");

    const stored = JSON.parse(await fsp.readFile(loopManifestPath(loop.id, env), "utf8"));
    assert.equal(stored.lifecycle, "ready");
  } finally {
    cleanupScratch(home);
  }
});

test("archive fails closed and preserves launchd artifacts when bootout fails for a loaded service", async () => {
  const { home, env } = await setupEnv("archive-bootout-failure");
  try {
    const workingDirectory = path.join(home, "repo");
    const scriptPath = path.join(home, "bin", "archive.sh");
    await fsp.mkdir(workingDirectory, { recursive: true });
    await writeExecutable(scriptPath, "#!/bin/sh\nexit 0\n");
    const loop = approvedScriptLoop(env, {
      id: "archive-failure",
      lifecycle: "paused",
      scriptPath,
      workingDirectory,
    });
    await persistLoop(loop, env);
    await fsp.mkdir(path.dirname(taskPlistPath(loop.id, env)), { recursive: true });
    await fsp.writeFile(taskPlistPath(loop.id, env), "plist\n", "utf8");
    await fsp.writeFile(taskPlistHashPath(loop.id, env), "hash\n", "utf8");
    await markLoaded(env, loop.id);

    const target = launchdTarget(loop.id, undefined, env);
    const failureEnv = { ...env, FAKE_LAUNCHCTL_FAIL_BOOTOUT_TARGET: target };
    const archiveRes = runCtl("archive", { id: loop.id }, failureEnv);
    assert.equal(archiveRes.ok, false);
    assert.equal(archiveRes.error.name, "UserError");

    const stored = JSON.parse(await fsp.readFile(loopManifestPath(loop.id, env), "utf8"));
    assert.equal(stored.lifecycle, "paused");
    assert.equal(fs.existsSync(taskPlistPath(loop.id, env)), true);
    assert.equal(fs.existsSync(taskPlistHashPath(loop.id, env)), true);
  } finally {
    cleanupScratch(home);
  }
});

test("run-now retry and stop use manual requests, keep paused loops paused, and never kickstart with -k", async () => {
  const { home, env } = await setupEnv("run-now-retry-stop");
  try {
    const workingDirectory = path.join(home, "repo");
    const scriptPath = path.join(home, "bin", "runner.sh");
    await fsp.mkdir(workingDirectory, { recursive: true });
    const scriptBody = "#!/bin/sh\nexit 0\n";
    await writeExecutable(scriptPath, scriptBody);
    const loop = approvedScriptLoop(env, {
      id: "manual-dispatch",
      lifecycle: "paused",
      scriptPath,
      workingDirectory,
    });
    await persistLoop(loop, env);

    const runNowRes = runCtl("run-now", { id: loop.id }, env);
    assert.equal(runNowRes.ok, true);
    assert.equal(runNowRes.data.queued, true);
    assert.equal(runNowRes.data.loop.lifecycle, "paused");
    assert.equal(runNowRes.data.request.trigger, "manual");
    const pendingRequest = JSON.parse(await fsp.readFile(path.join(loopDirectory(loop.id, env), "manual-request.json"), "utf8"));
    assert.equal(typeof pendingRequest.nonce, "string");

    const run = createRun({ loopId: loop.id, trigger: "manual", env, now: new Date("2026-07-24T16:00:00Z") });
    finalizeRun(run.paths, { status: "failed", exitCode: 1, endedAt: "2026-07-24T16:00:03Z" });

    const retryRes = runCtl("retry", { id: loop.id, runId: run.id }, env);
    assert.equal(retryRes.ok, true);
    assert.equal(retryRes.data.queued, true);
    assert.equal(retryRes.data.request.trigger, "retry");
    assert.equal(retryRes.data.request.retryOf, run.id);

    await markLoaded(env, loop.id);
    await writeLoopState(loop.id, env, {
      schemaVersion: 1,
      loopId: loop.id,
      schedule: { consumedAt: null, lastScheduledAt: null, nextExpectedAt: null },
      active: { currentRunId: run.id, stage: "running" },
      lastRun: null,
      updatedAt: "2026-07-24T16:00:04Z",
    });
    const stopRes = runCtl("stop", { id: loop.id }, env);
    assert.equal(stopRes.ok, true);
    assert.equal(stopRes.data.request.signal, "SIGTERM");

    const launchctlLog = await readLaunchctlLog(env);
    assert.match(launchctlLog, /kickstart gui\//);
    assert.doesNotMatch(launchctlLog, /kickstart -k/);
    assert.match(launchctlLog, /kill SIGTERM gui\//);
  } finally {
    cleanupScratch(home);
  }
});

test("run-now and retry skip overlap without queuing stale manual requests and leave visible skippedOverlap history", async () => {
  const { home, env } = await setupEnv("manual-overlap-skip");
  try {
    const workingDirectory = path.join(home, "repo");
    const scriptPath = path.join(home, "bin", "overlap.sh");
    await fsp.mkdir(workingDirectory, { recursive: true });
    await writeExecutable(scriptPath, "#!/bin/sh\nexit 0\n");
    const loop = approvedScriptLoop(env, {
      id: "manual-overlap",
      lifecycle: "enabled",
      scriptPath,
      workingDirectory,
    });
    await persistLoop(loop, env);
    await writeLoopState(loop.id, env, {
      schemaVersion: 1,
      loopId: loop.id,
      schedule: { consumedAt: null, lastScheduledAt: null, nextExpectedAt: null },
      active: { currentRunId: "run-active", stage: "running", startedAt: "2026-07-24T18:00:00Z", pid: process.pid },
      lastRun: null,
      updatedAt: "2026-07-24T18:00:00Z",
    });
    const activeLockDir = path.join(loopDirectory(loop.id, env), "active.lock");
    await fsp.mkdir(activeLockDir, { recursive: true });
    await fsp.writeFile(path.join(activeLockDir, "pid"), `${process.pid}\n`, "utf8");

    const runNowFirst = runCtl("run-now", { id: loop.id }, env);
    assert.equal(runNowFirst.ok, true);
    assert.equal(runNowFirst.data.queued, false);
    assert.equal(runNowFirst.data.skip.status, "skippedOverlap");
    assert.equal(runNowFirst.data.active.currentRunId, "run-active");
    assert.equal(fs.existsSync(path.join(loopDirectory(loop.id, env), "manual-request.json")), false);
    const firstSkip = readRun(runPaths(loop.id, runNowFirst.data.skip.runId, env));
    assert.equal(firstSkip.status, "skippedOverlap");
    assert.equal(firstSkip.trigger, "manual");

    const runNowSecond = runCtl("run-now", { id: loop.id }, env);
    assert.equal(runNowSecond.ok, true);
    assert.equal(runNowSecond.data.queued, false);
    assert.equal(runNowSecond.data.skip.status, "skippedOverlap");
    assert.notEqual(runNowSecond.data.skip.runId, runNowFirst.data.skip.runId);

    const priorRun = createRun({ loopId: loop.id, trigger: "manual", env, now: new Date("2026-07-24T18:01:00Z") });
    finalizeRun(priorRun.paths, { status: "failed", exitCode: 1, endedAt: "2026-07-24T18:01:03Z" });
    const retryRes = runCtl("retry", { id: loop.id, runId: priorRun.id }, env);
    assert.equal(retryRes.ok, true);
    assert.equal(retryRes.data.queued, false);
    assert.equal(retryRes.data.skip.status, "skippedOverlap");
    assert.equal(fs.existsSync(path.join(loopDirectory(loop.id, env), "manual-request.json")), false);
    const retrySkip = readRun(runPaths(loop.id, retryRes.data.skip.runId, env));
    assert.equal(retrySkip.status, "skippedOverlap");
    assert.equal(retrySkip.trigger, "retry");
    assert.equal(retrySkip.retryOf, priorRun.id);

    const launchctlLog = await readLaunchctlLog(env);
    assert.doesNotMatch(launchctlLog, /kickstart gui\//);
  } finally {
    cleanupScratch(home);
  }
});

test("reconcile removes consumed one-time loops after runtime disables them immediately", async () => {
  const { home, env } = await setupEnv("consumed-once");
  try {
    const workingDirectory = path.join(home, "repo");
    const scriptPath = path.join(home, "bin", "once.sh");
    await fsp.mkdir(workingDirectory, { recursive: true });
    const scriptBody = "#!/bin/sh\nexit 0\n";
    await writeExecutable(scriptPath, scriptBody);
    const loop = approvedScriptLoop(env, {
      id: "single-fire",
      lifecycle: "enabled",
      scriptPath,
      workingDirectory,
      schedule: {
        kind: "once",
        scheduledAt: "2026-07-24T17:00:00Z",
        graceSeconds: 300,
      },
    });
    await persistLoop(loop, env);
    await writeLoopState(loop.id, env, {
      schemaVersion: 1,
      loopId: loop.id,
      schedule: {
        consumedAt: "2026-07-24T17:00:00.000Z",
        lastScheduledAt: "2026-07-24T17:00:00.000Z",
        nextExpectedAt: null,
      },
      active: null,
      lastRun: { runId: "run-20260724170000", status: "succeeded", exitCode: 0, signal: null },
      updatedAt: "2026-07-24T17:05:00Z",
    });
    await fsp.mkdir(path.dirname(taskPlistPath(loop.id, env)), { recursive: true });
    await fsp.writeFile(taskPlistPath(loop.id, env), "plist\n", "utf8");
    await fsp.writeFile(taskPlistHashPath(loop.id, env), "hash\n", "utf8");
    await markLoaded(env, loop.id);

    const reconcileRes = runCtl("reconcile", { id: loop.id }, env);
    assert.equal(reconcileRes.ok, true);
    assert.equal(reconcileRes.data.reconciliation[0].desired, "consumed-once");
    assert.equal(reconcileRes.data.reconciliation[0].removed, true);
    assert.equal("runtimeHookNeeded" in reconcileRes.data, false);
    assert.equal(fs.existsSync(taskPlistPath(loop.id, env)), false);
    assert.equal(fs.existsSync(taskPlistHashPath(loop.id, env)), false);

    const launchctlLog = await readLaunchctlLog(env);
    assert.match(launchctlLog, /disable gui\//);
    assert.match(launchctlLog, /bootout gui\//);
  } finally {
    cleanupScratch(home);
  }
});

test("purge fails closed on launchd or secret-helper errors, then deletes secrets before removing the loop bundle", async () => {
  const { home, env, secretLog } = await setupEnv("purge");
  try {
    const workingDirectory = path.join(home, "repo");
    const scriptPath = path.join(home, "bin", "purge.sh");
    await fsp.mkdir(workingDirectory, { recursive: true });
    const scriptBody = "#!/bin/sh\nexit 0\n";
    await writeExecutable(scriptPath, scriptBody);
    const loop = approvedScriptLoop(env, {
      id: "purge-me",
      lifecycle: "paused",
      scriptPath,
      workingDirectory,
      secretNames: ["API_TOKEN"],
    });
    await persistLoop(loop, env);
    await fsp.mkdir(path.dirname(taskPlistPath(loop.id, env)), { recursive: true });
    await fsp.writeFile(taskPlistPath(loop.id, env), "plist\n", "utf8");
    await fsp.writeFile(taskPlistHashPath(loop.id, env), "hash\n", "utf8");
    await markLoaded(env, loop.id);

    const target = launchdTarget(loop.id, undefined, env);
    const failureEnv = { ...env, FAKE_LAUNCHCTL_FAIL_BOOTOUT_TARGET: target };
    const failed = runCtl("purge", { id: loop.id, confirm: true }, failureEnv);
    assert.equal(failed.ok, false);
    assert.equal(fs.existsSync(loopDirectory(loop.id, env)), true);
    assert.equal(fs.existsSync(taskPlistPath(loop.id, env)), true);
    const launchFailureSecretLog = await fsp.readFile(secretLog, "utf8").catch(() => "");
    assert.doesNotMatch(launchFailureSecretLog, /delete purge-me:API_TOKEN/);

    const helperFailureEnv = { ...env, FAKE_SECRET_DELETE_FAIL_ACCOUNT: `${loop.id}:API_TOKEN` };
    const helperFailed = runCtl("purge", { id: loop.id, confirm: true }, helperFailureEnv);
    assert.equal(helperFailed.ok, false);
    assert.equal(helperFailed.error.name, "UserError");
    assert.match(helperFailed.error.message, /secrets helper delete failed/);
    assert.equal(fs.existsSync(loopDirectory(loop.id, env)), true);
    assert.equal(fs.existsSync(taskPlistPath(loop.id, env)), false);
    assert.equal(fs.existsSync(taskPlistHashPath(loop.id, env)), false);
    assert.deepEqual(helperFailed.error.context.deletedNames ?? [], []);
    assert.equal(helperFailed.error.context.secretAccount, `${loop.id}:API_TOKEN`);

    const success = runCtl("purge", { id: loop.id, confirm: true }, env);
    assert.equal(success.ok, true);
    assert.equal(success.data.secretNames[0], "API_TOKEN");
    assert.equal(success.data.secretAccounts[0], `${loop.id}:API_TOKEN`);
    assert.equal(success.data.secretDeletion.deletedCount, 1);
    assert.equal(success.data.secretDeletion.deletedNames[0], "API_TOKEN");
    assert.equal(success.data.secretDeletion.deletedAccounts[0], `${loop.id}:API_TOKEN`);
    assert.equal(fs.existsSync(loopDirectory(loop.id, env)), false);

    const helperLog = await fsp.readFile(secretLog, "utf8");
    const deleteLines = helperLog.split("\n").filter((line) => line === `delete ${loop.id}:API_TOKEN`);
    assert.equal(deleteLines.length, 2);
  } finally {
    cleanupScratch(home);
  }
});

test("history aggregate templates diagnostics settings and inventory stay bounded, strict, and secret-safe", async () => {
  const { home, env } = await setupEnv("observe-diagnostics");
  try {
    const workingDirectory = path.join(home, "repo");
    const scriptPath = path.join(home, "bin", "task.sh");
    await fsp.mkdir(workingDirectory, { recursive: true });
    const scriptBody = "#!/bin/sh\nexit 0\n";
    await writeExecutable(scriptPath, scriptBody);

    const localPluginDir = path.join(home, "local-plugin");
    await fsp.mkdir(path.join(localPluginDir, "agents"), { recursive: true });
    await fsp.mkdir(path.join(localPluginDir, "skills", "local-skill"), { recursive: true });
    await fsp.writeFile(path.join(localPluginDir, "plugin.json"), JSON.stringify({ name: "local-plugin", version: "0.1.0", description: "Local" }, null, 2) + "\n", "utf8");
    await fsp.writeFile(path.join(localPluginDir, "agents", "local.agent.md"), `---\nname: local-agent\ndescription: Local agent\n---\n`, "utf8");
    await fsp.writeFile(path.join(localPluginDir, "skills", "local-skill", "SKILL.md"), `---\nname: local-skill\ndescription: Local skill\nuser-invocable: false\n---\n`, "utf8");

    const loop = approvedCopilotLoop(env, {
      id: "nightly-dependency-report",
      lifecycle: "enabled",
      workingDirectory,
      localPluginDirectories: [localPluginDir],
    });
    await persistLoop(loop, env);
    const oldRun = createRun({ loopId: loop.id, trigger: "schedule", env, now: new Date("2026-07-24T01:00:00Z") });
    finalizeRun(oldRun.paths, { status: "succeeded", exitCode: 0, endedAt: "2026-07-24T01:02:00Z" });
    const newRun = createRun({ loopId: loop.id, trigger: "manual", env, now: new Date("2026-07-24T02:00:00Z") });
    finalizeRun(newRun.paths, { status: "failed", exitCode: 1, endedAt: "2026-07-24T02:03:00Z" });
    const activeRun = createRun({ loopId: loop.id, trigger: "manual", env, now: new Date("2026-07-24T03:00:00Z") });
    await fsp.writeFile(activeRun.paths.stdoutLog, "active stdout\n", "utf8");
    await fsp.writeFile(activeRun.paths.stderrLog, "active stderr\n", "utf8");
    await fsp.writeFile(activeRun.paths.copilotLog, "{\"type\":\"active\"}\n", "utf8");
    await fsp.mkdir(activeRun.paths.cliLogsDir, { recursive: true });
    await fsp.writeFile(path.join(activeRun.paths.cliLogsDir, "active.log"), "cli\n", "utf8");
    await writeLoopState(loop.id, env, {
      schemaVersion: 1,
      loopId: loop.id,
      schedule: { consumedAt: null, lastScheduledAt: null, nextExpectedAt: null },
      active: { currentRunId: activeRun.id, stage: "running", startedAt: "2026-07-24T03:00:00Z", pid: 4242 },
      lastRun: { runId: newRun.id, status: "failed", exitCode: 1, signal: null },
      updatedAt: "2026-07-24T03:01:00Z",
    });
    await markLoaded(env, loop.id);

    const preflight = runCtl("preflight", { id: loop.id }, env);
    assert.equal(preflight.ok, true);
    const preflightJson = JSON.stringify(preflight);
    assert.doesNotMatch(preflightJson, /secret-value-for/);
    assert.doesNotMatch(preflightJson, /<redacted:REPORT_TOKEN>/);

    const history = runCtl("history", { id: loop.id, count: 1 }, env);
    assert.equal(history.ok, true);
    assert.equal(history.data.runs.length, 1);
    assert.equal(history.data.runs[0].run.id, activeRun.id);

    const list = runCtl("list", {}, env);
    assert.equal(list.ok, true);
    assert.equal(list.data.loops[0].definition.id, loop.id);
    assert.equal(list.data.loops[0].stateSummary.currentRunId, activeRun.id);
    assert.equal("state" in list.data.loops[0], false);

    const show = runCtl("show", { id: loop.id, count: 2 }, env);
    assert.equal(show.ok, true);
    assert.equal(show.data.definition.id, loop.id);
    assert.equal(show.data.state.active.currentRunId, activeRun.id);
    assert.equal(show.data.state.lastRun.runId, newRun.id);
    assert.equal(show.data.summary.currentRunId, activeRun.id);
    assert.equal(show.data.currentRun.runId, activeRun.id);
    assert.equal(show.data.currentRun.artifacts.stdoutPath, activeRun.paths.stdoutLog);
    assert.equal(show.data.currentRun.artifacts.stderrPath, activeRun.paths.stderrLog);
    assert.equal(show.data.currentRun.artifacts.copilotJsonlPath, activeRun.paths.copilotLog);
    assert.equal(show.data.currentRun.artifacts.eventsPath, activeRun.paths.eventsLog);
    assert.equal(show.data.currentRun.artifacts.cliLogsDirectory, activeRun.paths.cliLogsDir);
    assert.equal(show.data.recentRuns.count, 2);
    assert.equal(show.data.recentRuns.runs[0].run.id, activeRun.id);

    const aggregate = runCtl("aggregate", { count: 1 }, env);
    assert.equal(aggregate.ok, true);
    assert.equal(aggregate.data.counts.totalLoops, 1);
    assert.equal(aggregate.data.recentActivity.count, 1);
    assert.equal(aggregate.data.recentActivity.entries[0].run.id, activeRun.id);
    assert.equal(aggregate.data.loops[0].definition.id, loop.id);
    assert.equal(aggregate.data.loops[0].state.active.currentRunId, activeRun.id);
    assert.equal(aggregate.data.loops[0].state.lastRun.runId, newRun.id);
    assert.equal(aggregate.data.loops[0].currentRunId, activeRun.id);
    assert.equal(aggregate.data.loops[0].lastRun.id, activeRun.id);

    const templates = runCtl("templates", {}, env);
    assert.equal(templates.ok, true);
    assert.equal(templates.data.templates.length, 5);
    const templatesJson = JSON.stringify(templates.data.templates);
    assert.doesNotMatch(templatesJson, /Applications\/CopilotLoops\.app/);
    assert.doesNotMatch(templatesJson, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const diagnostics = runCtl("diagnostics", { id: loop.id }, env);
    assert.equal(diagnostics.ok, true);
    assert.equal(diagnostics.data.runtime.node.exists, true);
    assert.equal(diagnostics.data.runtime.copilot.exists, true);
    assert.equal(diagnostics.data.inventory.errors.length, 0);
    assert.equal(diagnostics.data.loops[0].loaded, true);
    assert.doesNotMatch(JSON.stringify(diagnostics), /secret-value-for/);

    const settingsSet = runCtl("settings-set", { settings: { schemaVersion: 1, launchAtLogin: false, defaultTimeoutSeconds: 60 } }, env);
    assert.equal(settingsSet.ok, true);
    const settingsGet = runCtl("settings-get", {}, env);
    assert.equal(settingsGet.ok, true);
    assert.equal(settingsGet.data.settings.launchAtLogin, false);
    const launchctlLog = await readLaunchctlLog(env);
    assert.match(launchctlLog, /disable gui\/\d+\/com\.copilotplugins\.copilot-loops\.app/);
    assert.doesNotMatch(launchctlLog, /bootout gui\/\d+\/com\.copilotplugins\.copilot-loops\.app/);

    const strictFailure = runCtl("templates", { unexpected: true }, env);
    assert.equal(strictFailure.ok, false);
    assert.equal(strictFailure.error.name, "UserError");

    const inventoryRelative = runCtl("inventory", { localPluginDirectories: ["relative/plugin"] }, env);
    assert.equal(inventoryRelative.ok, false);
    assert.equal(inventoryRelative.error.name, "UserError");

    const inventoryFallback = runCtl("inventory", { localPluginDirectories: [localPluginDir] }, { ...env, FAKE_COPILOT_FAIL: "both" });
    assert.equal(inventoryFallback.ok, true);
    assert.ok(inventoryFallback.data.errors.length >= 2);
    assert.ok(inventoryFallback.data.skills.some((entry) => entry.name === "local-skill"));
    assert.ok(inventoryFallback.data.agents.some((entry) => entry.name === "local-agent"));
  } finally {
    cleanupScratch(home);
  }
});
