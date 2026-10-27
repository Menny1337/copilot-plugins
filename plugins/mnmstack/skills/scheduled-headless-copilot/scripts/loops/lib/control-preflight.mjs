import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { capabilityFingerprint, capabilityProjection, validateLoopDefinition } from "./contracts.mjs";
import { approvalBlockedPath } from "./run-state.mjs";
import { taskLabel, loopDirectory } from "./paths.mjs";
import { taskPlistHashPath, taskPlistPath, taskStdoutPath, taskStderrPath } from "./launchd.mjs";
import { buildCommand } from "./runner-command.mjs";
import { renderTaskPlist, validatePlistXml } from "./plist.mjs";
import { assessSchedule } from "./schedule.mjs";
import { inspectPath, runtimeContext } from "./control-runtime.mjs";
import { runCommandCapture } from "./process-tree.mjs";

const SECRET_HELPER_TIMEOUT_SECONDS = 5;

function check(report, status, code, message, context = {}) {
  report.checks.push({ status, code, message, context });
  if (status === "warning") report.warningDetails.push({ code, message, context });
  if (status === "error") report.errorDetails.push({ code, message, context });
}

function finalizeReport(report) {
  report.warnings = report.warningDetails.map((entry) => entry.message);
  report.errors = report.errorDetails.map((entry) => entry.message);
  if (report.approval) {
    report.approval.canApprove = report.errorDetails.length === 0;
    report.approval.canRun = report.approval.status === "approved" && report.errorDetails.length === 0;
  }
  return report;
}

function readLoopState(loopId, env = process.env) {
  const statePath = path.join(loopDirectory(loopId, env), "state.json");
  try {
    const data = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return { state: data, error: null };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        state: {
          schedule: { consumedAt: null, lastScheduledAt: null, nextExpectedAt: null },
          active: null,
        },
        error: null,
      };
    }
    return {
      state: {
        schedule: { consumedAt: null, lastScheduledAt: null, nextExpectedAt: null },
        active: null,
      },
      error,
    };
  }
}

function redactedExecutionPreview(loop, env = process.env) {
  const placeholders = Object.fromEntries(
    (loop.environment?.secretNames ?? []).map((name) => [name, `<redacted:${name}>`]),
  );
  const command = buildCommand({
    loop,
    run: { cliLogsDir: path.join(loopDirectory(loop.id, env), "runs", "<run-id>", "cli-logs") },
    sessionId: "<session-id>",
    copilotBinary: "copilot",
    secretValues: placeholders,
    baseEnv: env,
  });
  const argv = [command.command, ...command.args];
  if (loop.execution.type === "copilot") {
    const promptIndex = argv.indexOf("-p");
    if (promptIndex >= 0 && argv[promptIndex + 1]) argv[promptIndex + 1] = "<redacted-prompt>";
    const logDirIndex = argv.indexOf("--log-dir");
    if (logDirIndex >= 0 && argv[logDirIndex + 1]) argv[logDirIndex + 1] = "<cli-logs-dir>";
    const sessionIndex = argv.indexOf("--session-id");
    if (sessionIndex >= 0 && argv[sessionIndex + 1]) argv[sessionIndex + 1] = "<session-id>";
  }
  return argv;
}

async function inspectExecutionPath(loop, report) {
  if (loop.execution.type !== "scriptFile" && loop.execution.type !== "executable") return null;
  const inspected = await inspectPath(loop.execution.path, { type: "file", executable: true, hash: true });
  if (!inspected.exists) {
    check(report, "error", "execution-missing", "Execution path does not exist", {
      path: loop.execution.path,
    });
    return inspected;
  }
  if (inspected.kind !== "file") {
    check(report, "error", "execution-not-file", "Execution path must be a regular file", {
      path: loop.execution.path,
      kind: inspected.kind,
    });
    return inspected;
  }
  if (!inspected.executable) {
    check(report, "error", "execution-not-executable", "Execution path is not executable", {
      path: loop.execution.path,
    });
  } else {
    check(report, "pass", "execution-executable", "Execution path exists and is executable", {
      path: loop.execution.path,
    });
  }

  let body = null;
  try {
    body = await fsp.readFile(loop.execution.path);
  } catch (error) {
    check(report, "error", "execution-unreadable", "Execution path could not be read for integrity verification", {
      path: loop.execution.path,
      cause: error.message,
    });
    return inspected;
  }

  if (loop.execution.type === "scriptFile") {
    if (body.subarray(0, 2).toString("utf8") !== "#!") {
      check(report, "error", "script-missing-shebang", "Script file must begin with a shebang", {
        path: loop.execution.path,
      });
    } else {
      check(report, "pass", "script-shebang", "Script file has a shebang", {
        path: loop.execution.path,
      });
    }
    if (inspected.hash !== loop.execution.contentHash) {
      check(report, "error", "script-hash-mismatch", "Script content hash no longer matches the approved manifest", {
        path: loop.execution.path,
        manifestHash: loop.execution.contentHash,
        currentHash: inspected.hash,
      });
    } else {
      check(report, "pass", "script-hash", "Script content hash matches the approved manifest", {
        path: loop.execution.path,
        hash: inspected.hash,
      });
    }
  } else if (loop.execution.executableHash === null) {
    check(report, "error", "executable-hash-missing", "Executable manifest is missing executableHash; capture and review the current SHA-256 before approval or run", {
      path: loop.execution.path,
      currentHash: inspected.hash,
    });
  } else if (inspected.hash !== loop.execution.executableHash) {
    check(report, "error", "executable-hash-mismatch", "Executable hash no longer matches the approved manifest", {
      path: loop.execution.path,
      manifestHash: loop.execution.executableHash,
      currentHash: inspected.hash,
    });
  } else {
    check(report, "pass", "executable-hash", "Executable hash matches the approved manifest", {
      path: loop.execution.path,
      hash: inspected.hash,
    });
  }
  return inspected;
}

async function checkSecretAvailability(loop, report, options) {
  const secretNames = loop.environment?.secretNames ?? [];
  if (secretNames.length === 0) {
    check(report, "info", "secrets-none", "Loop does not declare any managed secrets");
    return;
  }
  const helperPath = report.runtime?.helper?.path ?? null;
  const helperInfo = await inspectPath(helperPath, { type: "file", executable: true });
  if (!helperInfo.exists || !helperInfo.executable) {
    check(report, "error", "secret-helper-missing", "Secrets helper is unavailable for declared secret checks", {
      path: helperPath,
      secretNames,
    });
    return;
  }
  for (const name of secretNames) {
    let result;
    try {
      result = await (options.runCommandCapture ?? runCommandCapture)({
        command: helperPath,
        args: ["exists", `${loop.id}:${name}`],
        env: options.env,
        timeoutSeconds: SECRET_HELPER_TIMEOUT_SECONDS,
      });
    } catch (error) {
      check(report, "error", "secret-helper-launch-failed", `Secrets helper could not be launched for ${name}`, {
        name,
        cause: error.code ?? error.message,
      });
      continue;
    }
    if (result.timedOut) {
      check(report, "error", "secret-helper-timeout", `Secrets helper timed out while checking ${name}`, {
        name,
      });
      continue;
    }
    if (result.exitCode !== 0) {
      check(report, "error", "secret-helper-failed", `Secrets helper failed while checking ${name}`, {
        name,
        exitCode: result.exitCode,
        signal: result.signal,
      });
      continue;
    }
    const exists = result.stdout.trim() === "true";
    check(report, exists ? "pass" : "error", exists ? "secret-exists" : "secret-missing", exists
      ? `Managed secret ${name} exists`
      : `Managed secret ${name} is missing`, {
      name,
    });
  }
}

function inventoryMatch(items, name) {
  return Array.isArray(items) ? items.find((item) => item.name === name) : null;
}

function inventoryHasCode(inventory, code) {
  return Array.isArray(inventory?.errors) && inventory.errors.some((entry) => entry.code === code || entry.type === code);
}

function checkInventorySelections(loop, report) {
  const inventory = report.inventory;
  if (!inventory) return;
  if (Array.isArray(inventory.errors) && inventory.errors.length > 0) {
    check(report, "warning", "inventory-partial", "Inventory collection reported actionable errors", {
      errors: inventory.errors,
    });
  }
  if (loop.execution.type !== "copilot") return;

  if (loop.execution.installedPlugin) {
    const plugin = inventoryMatch(inventory.plugins, loop.execution.installedPlugin);
    if (!plugin) {
      check(report, inventoryHasCode(inventory, "plugins_list_failed") ? "warning" : "warning", "plugin-missing", "Selected installed plugin could not be confirmed in the Copilot inventory", {
        plugin: loop.execution.installedPlugin,
      });
    } else if (plugin.enabled === false) {
      check(report, "warning", "plugin-disabled", "Selected installed plugin is currently disabled", {
        plugin: loop.execution.installedPlugin,
      });
    } else {
      check(report, "pass", "plugin-present", "Selected installed plugin is present in the Copilot inventory", {
        plugin: loop.execution.installedPlugin,
      });
    }
  }

  if (loop.execution.agent) {
    const agent = inventoryMatch(inventory.agents, loop.execution.agent);
    if (!agent) {
      check(report, "warning", "agent-missing", "Selected agent could not be confirmed in the Copilot inventory", {
        agent: loop.execution.agent,
      });
    } else if (agent.enabled === false) {
      check(report, "error", "agent-disabled", "Selected agent is disabled in the Copilot inventory", {
        agent: loop.execution.agent,
      });
    } else {
      check(report, "pass", "agent-present", "Selected agent is present in the Copilot inventory", {
        agent: loop.execution.agent,
      });
    }
  }

  if (loop.execution.skill) {
    const skill = inventoryMatch(inventory.skills, loop.execution.skill);
    if (!skill) {
      check(report, inventoryHasCode(inventory, "skills_list_failed") ? "warning" : "error", "skill-missing", "Selected skill could not be confirmed in the Copilot inventory", {
        skill: loop.execution.skill,
      });
    } else if (skill.enabled === false) {
      check(report, "error", "skill-disabled", "Selected skill is disabled in the Copilot inventory", {
        skill: loop.execution.skill,
      });
    } else {
      check(report, "pass", "skill-present", "Selected skill is present in the Copilot inventory", {
        skill: loop.execution.skill,
      });
    }
  }
}

function approvalStatus(loop, fingerprint, sentinelExists) {
  if (sentinelExists) {
    return ["draft", "needsReview"].includes(loop.lifecycle) ? "needs-review" : "blocked";
  }
  if (!loop.approval?.fingerprint || !loop.approval?.approvedAt) {
    return ["draft", "needsReview"].includes(loop.lifecycle) ? "needs-review" : "missing";
  }
  if (loop.approval.fingerprint !== fingerprint) {
    return ["draft", "needsReview"].includes(loop.lifecycle) ? "needs-review" : "drifted";
  }
  return "approved";
}

export async function buildPreflightReport(loopInput, options = {}) {
  const env = options.env ?? process.env;
  const report = {
    schemaVersion: 1,
    loop: null,
    fingerprint: null,
    redactedCommand: null,
    capabilitySummary: null,
    checks: [],
    warnings: [],
    errors: [],
    warningDetails: [],
    errorDetails: [],
    approval: null,
    schedule: null,
    runtime: null,
    inventory: null,
    schedulerPreview: null,
  };

  let loop;
  try {
    loop = validateLoopDefinition(structuredClone(loopInput));
  } catch (error) {
    check(report, "error", "loop-invalid", error.message);
    return finalizeReport(report);
  }

  report.loop = loop;
  report.fingerprint = capabilityFingerprint(loop);
  report.capabilitySummary = capabilityProjection(loop);
  report.redactedCommand = redactedExecutionPreview(loop, env);

  const runtime = await runtimeContext(env, options);
  report.runtime = runtime;
  const liveState = readLoopState(loop.id, env);
  if (liveState.error) {
    check(report, "warning", "state-read-failed", "Existing loop state could not be read; schedule viability is using a blank baseline", {
      cause: liveState.error.message,
    });
  }

  const sentinelExists = fs.existsSync(approvalBlockedPath(loop.id, env));
  const approval = {
    status: approvalStatus(loop, report.fingerprint, sentinelExists),
    sentinelExists,
    storedFingerprint: loop.approval.fingerprint,
    approvedAt: loop.approval.approvedAt,
    currentFingerprint: report.fingerprint,
    matchesStored: loop.approval.fingerprint === report.fingerprint && loop.approval.approvedAt !== null,
    canApprove: false,
    canRun: false,
  };
  report.approval = approval;
  if (approval.status === "approved") {
    check(report, "pass", "approval-current", "Stored approval matches the current capability fingerprint", {
      approvedAt: loop.approval.approvedAt,
    });
  } else if (approval.status === "needs-review") {
    check(report, "warning", "approval-review-needed", "Loop is not currently approved and needs review before enable or run", {
      lifecycle: loop.lifecycle,
      sentinelExists,
    });
  } else if (approval.status === "drifted") {
    check(report, "error", "approval-drift", "Stored approval fingerprint no longer matches the current capability fingerprint", {
      approvedAt: loop.approval.approvedAt,
    });
  } else if (approval.status === "blocked") {
    check(report, "error", "approval-blocked", "Approval is currently blocked by the control-plane sentinel", {
      sentinelPath: approvalBlockedPath(loop.id, env),
    });
  } else {
    check(report, "error", "approval-missing", "Loop lifecycle requires approval, but the stored approval is missing", {
      lifecycle: loop.lifecycle,
    });
  }

  const workingDirectory = await inspectPath(loop.execution.workingDirectory, { type: "directory" });
  const workingDirectoryOk = workingDirectory.exists && workingDirectory.kind === "directory";
  check(report, workingDirectoryOk ? "pass" : "error", workingDirectoryOk ? "working-directory-ok" : "working-directory-invalid", workingDirectoryOk
    ? "Working directory exists"
    : "Working directory must exist and be a directory", {
    path: loop.execution.workingDirectory,
    kind: workingDirectory.kind,
    error: workingDirectory.error,
  });

  if (loop.execution.type === "copilot") {
    for (const extraPath of loop.execution.extraPaths) {
      const inspected = await inspectPath(extraPath, { type: "directory" });
      const extraPathOk = inspected.exists && inspected.kind === "directory";
      check(report, extraPathOk ? "pass" : "error", extraPathOk ? "extra-path-ok" : "extra-path-invalid", extraPathOk
        ? `Extra Copilot path exists: ${extraPath}`
        : `Extra Copilot path must exist and be a directory: ${extraPath}`, {
        path: extraPath,
        kind: inspected.kind,
        error: inspected.error,
      });
    }
    for (const pluginDir of loop.execution.localPluginDirectories) {
      const inspected = await inspectPath(pluginDir, { type: "directory" });
      const pluginDirectoryOk = inspected.exists && inspected.kind === "directory";
      check(report, pluginDirectoryOk ? "pass" : "error", pluginDirectoryOk ? "plugin-directory-ok" : "plugin-directory-invalid", pluginDirectoryOk
        ? `Local plugin directory exists: ${pluginDir}`
        : `Local plugin directory must exist and be a directory: ${pluginDir}`, {
        path: pluginDir,
        kind: inspected.kind,
        error: inspected.error,
      });
      const pluginManifest = await inspectPath(path.join(pluginDir, "plugin.json"), { type: "file" });
      check(report, pluginManifest.exists ? "pass" : "warning", pluginManifest.exists ? "plugin-manifest-ok" : "plugin-manifest-missing", pluginManifest.exists
        ? `Local plugin manifest exists: ${pluginDir}/plugin.json`
        : `Local plugin manifest is missing: ${pluginDir}/plugin.json`, {
        path: path.join(pluginDir, "plugin.json"),
      });
    }
  }

  const executionInfo = await inspectExecutionPath(loop, report);
  if (executionInfo?.hash) {
    report.capabilitySummary = {
      ...report.capabilitySummary,
      currentExecutableHash: executionInfo.hash,
    };
  }

  const nodeInfo = await inspectPath(runtime.node?.path, { type: "file", executable: true });
  const nodeOk = nodeInfo.exists && nodeInfo.executable;
  check(report, nodeOk ? "pass" : "error", nodeOk ? "node-ok" : "node-invalid", nodeOk
    ? "Node runtime exists and is executable"
    : "Node runtime could not be resolved as an executable file", {
    path: runtime.node?.path ?? null,
    source: runtime.node?.source ?? null,
    error: nodeInfo.error,
  });

  const runnerInfo = await inspectPath(runtime.runner?.path, { type: "file" });
  const runnerOk = runnerInfo.exists && runnerInfo.kind === "file";
  check(report, runnerOk ? "pass" : "error", runnerOk ? "runner-ok" : "runner-invalid", runnerOk
    ? "Loops runner exists"
    : "Loops runner could not be resolved as a file", {
    path: runtime.runner?.path ?? null,
    source: runtime.runner?.source ?? null,
    error: runnerInfo.error,
  });

  const controlInfo = await inspectPath(runtime.control?.path, { type: "file" });
  const controlOk = controlInfo.exists && controlInfo.kind === "file";
  check(report, controlOk ? "pass" : "warning", controlOk ? "control-ok" : "control-missing", controlOk
    ? "Loops control script exists"
    : "Loops control script could not be resolved as a file", {
    path: runtime.control?.path ?? null,
    source: runtime.control?.source ?? null,
    error: controlInfo.error,
  });

  const helperInfo = await inspectPath(runtime.helper?.path, { type: "file", executable: true });
  if ((loop.environment?.secretNames ?? []).length > 0) {
    const helperOk = helperInfo.exists && helperInfo.executable;
    check(report, helperOk ? "pass" : "error", helperOk ? "helper-ok" : "helper-invalid", helperOk
      ? "Secrets helper exists and is executable"
      : "Secrets helper could not be resolved as an executable file", {
      path: runtime.helper?.path ?? null,
      source: runtime.helper?.source ?? null,
      error: helperInfo.error,
    });
  } else {
    const helperOk = helperInfo.exists && helperInfo.executable;
    check(report, helperOk ? "pass" : "info", helperOk ? "helper-ok" : "helper-not-required", helperOk
      ? "Secrets helper exists and is executable"
      : "Secrets helper is not currently required because the loop declares no secrets", {
      path: runtime.helper?.path ?? null,
      source: runtime.helper?.source ?? null,
      error: helperInfo.error,
    });
  }

  if (loop.execution.type === "copilot") {
    if (runtime.copilot.resolvedPath) {
      check(report, "pass", "copilot-ok", "Copilot CLI resolves on the launchd PATH", {
        path: runtime.copilot.resolvedPath,
      });
    } else {
      check(report, "error", "copilot-missing", "Copilot CLI could not be resolved on the launchd PATH", {
        pathEnv: runtime.copilot.pathEnv,
      });
    }
  }

  try {
    const assessment = assessSchedule(loop.schedule, liveState.state.schedule ?? {}, { now: options.now ?? new Date() });
    report.schedule = {
      ...assessment,
      state: assessment.state,
      consumedOnce: loop.schedule.kind === "once" && Boolean((liveState.state.schedule ?? {}).consumedAt),
    };
    if (assessment.kind === "once" && assessment.consumed) {
      check(report, "warning", "once-consumed", "One-time schedule has already been consumed and should be reconciled out of launchd", {
        scheduledAt: assessment.scheduledAt,
        consumedAt: assessment.state.consumedAt,
      });
    } else if (assessment.stale) {
      check(report, "warning", "schedule-stale", "Current schedule window is stale and would be skipped by the runner", {
        scheduledAt: assessment.scheduledAt,
        reason: assessment.reason,
      });
    } else {
      check(report, "pass", "schedule-ok", "Schedule can be assessed against the current loop state", {
        nextExpectedAt: assessment.nextExpectedAt,
        reason: assessment.reason,
      });
    }
  } catch (error) {
    check(report, "error", "schedule-invalid", "Schedule could not be assessed against the current loop state", {
      cause: error.message,
    });
  }

  let rendered = null;
  try {
    rendered = renderTaskPlist(loop, {
      env,
      nodePath: runtime.node?.path,
      runnerPath: runtime.runner?.path,
      secretsHelperPath: runtime.helper?.path,
      stdoutPath: taskStdoutPath(loop.id, env),
      stderrPath: taskStderrPath(loop.id, env),
      launchPath: runtime.launchPath,
    });
    report.schedulerPreview = {
      label: taskLabel(loop.id, env),
      plistPath: taskPlistPath(loop.id, env),
      hashPath: taskPlistHashPath(loop.id, env),
      programArguments: rendered.programArguments,
      launchPath: rendered.launchPath,
      nodePath: rendered.nodePath,
      runnerPath: rendered.runnerPath,
      secretsHelperPath: rendered.secretsHelperPath,
    };
    await validatePlistXml(rendered.xml, {
      env,
      run: options.runPlutil,
      plutilPath: options.plutilPath ?? env.COPILOT_LOOPS_PLUTIL,
    });
    check(report, "pass", "scheduler-plist", "LaunchAgent plist renders and passes plutil validation", {
      plistPath: taskPlistPath(loop.id, env),
    });
  } catch (error) {
    check(report, "error", "scheduler-plist-invalid", "LaunchAgent plist could not be rendered or validated", {
      cause: error.message,
    });
  }

  if (typeof options.getInventory === "function") {
    try {
      report.inventory = await options.getInventory({
        localPluginDirectories: loop.execution.type === "copilot" ? loop.execution.localPluginDirectories : [],
      });
      checkInventorySelections(loop, report);
    } catch (error) {
      check(report, "warning", "inventory-failed", "Inventory could not be collected for selection checks", {
        cause: error.message,
      });
    }
  }

  await checkSecretAvailability(loop, report, options);
  return finalizeReport(report);
}
