import { getInventory } from "./inventory.mjs";
import { getSettings } from "./settings.mjs";
import { inspectLoop, inspectAllLoops } from "../lib/control-observe.mjs";
import { exactPayload, requireLoopIdValue } from "../lib/control-payload.mjs";
import { appLabel, inspectPath, isLabelLoaded, runtimeContext } from "../lib/control-runtime.mjs";
import { taskPlistHashPath, taskPlistPath } from "../lib/launchd.mjs";
import { readLoop } from "../lib/store.mjs";
import { inspectLoopSchedule } from "./schedule.mjs";

function loopIssue(entry, code, message, context = {}) {
  return { id: entry.loop.id, code, message, context };
}

function binarySummary(entry, info) {
  return {
    ...entry,
    path: entry?.path ?? entry?.resolvedPath ?? null,
    exists: Boolean(info?.exists ?? entry?.resolvedPath),
    executable: info?.executable ?? Boolean(entry?.resolvedPath),
    kind: info?.kind ?? null,
    error: info?.error ?? (entry?.resolvedPath ? null : "missing"),
  };
}

export async function runtimeDiagnostics(payload = {}, options = {}) {
  const body = exactPayload(payload ?? {}, { required: [], optional: ["id"] });
  const env = options.env ?? process.env;
  const resolvedAppLabel = appLabel(env);
  const loopId = body.id === undefined ? null : requireLoopIdValue(body.id, "payload.id");
  const runtime = await runtimeContext(env, options);
  const settings = await getSettings({}, { env, ...options });
  const nodeInfo = await inspectPath(runtime.node?.path, { type: "file", executable: true });
  const runnerInfo = await inspectPath(runtime.runner?.path, { type: "file" });
  const controlInfo = await inspectPath(runtime.control?.path, { type: "file" });
  const helperInfo = await inspectPath(runtime.helper?.path, { type: "file", executable: true });
  const appInfo = runtime.app?.path ? await inspectPath(runtime.app.path, { type: "directory" }) : null;
  const copilotInfo = runtime.copilot.resolvedPath ? await inspectPath(runtime.copilot.resolvedPath, { type: "file", executable: true }) : null;
  const launchctlInfo = runtime.launchctl.resolvedPath ? await inspectPath(runtime.launchctl.resolvedPath, { type: "file", executable: true }) : null;
  const appLoaded = await isLabelLoaded(resolvedAppLabel, { ...options, env });

  const inspections = loopId
    ? [inspectLoop(await readLoop(loopId, env), { env })]
    : (await inspectAllLoops({ env })).inspections;
  const localPluginDirectories = [...new Set(inspections.flatMap((inspection) => inspection.loop.execution.type === "copilot" ? inspection.loop.execution.localPluginDirectories : []))].sort();
  const inventory = await getInventory({ localPluginDirectories }, options.execFn, { env });

  const loops = [];
  const errors = [];
  const warnings = [];

  for (const inspection of inspections) {
    let schedule;
    const issues = [...inspection.issues];
    try {
      schedule = await inspectLoopSchedule(inspection.loop, options);
      const plistInfo = await inspectPath(taskPlistPath(inspection.loop.id, env), { type: "file" });
      const hashInfo = await inspectPath(taskPlistHashPath(inspection.loop.id, env), { type: "file" });
      if (schedule.launchdState === "loaded" && !schedule.loaded) {
        issues.push(loopIssue(inspection, "launchd-unloaded", "Loop should be loaded in launchd but is not", {
          target: schedule.label,
        }));
      }
      if ((schedule.launchdState === "booted-out" || schedule.launchdState === "archived") && schedule.loaded) {
        issues.push(loopIssue(inspection, "launchd-loaded-drift", "Loop is still loaded in launchd even though its lifecycle should keep it booted out", {
          target: schedule.label,
        }));
      }
      if (schedule.launchdState === "consumed-once" && (schedule.loaded || plistInfo.exists || hashInfo.exists)) {
        issues.push(loopIssue(inspection, "one-time-reconcile-needed", "One-time loop has been consumed and still has launchd artifacts", {
          target: schedule.label,
          plistPath: plistInfo.path,
          hashPath: hashInfo.path,
        }));
      }
      loops.push({
        id: inspection.loop.id,
        lifecycle: inspection.loop.lifecycle,
        scheduleKind: inspection.loop.schedule.kind,
        desiredLaunchdState: schedule.launchdState,
        loaded: schedule.loaded,
        consumedOnce: schedule.consumedOnce,
        label: schedule.label,
        plistPath: schedule.plistPath,
        hashPath: taskPlistHashPath(inspection.loop.id, env),
        isRunning: inspection.state.isRunning,
        currentRunId: inspection.state.currentRunId,
        stage: inspection.state.stage,
        nextScheduledAt: inspection.state.nextScheduledAt,
        lastRunStatus: inspection.state.lastRun?.status ?? null,
        secretNameCount: inspection.loop.environment.secretNames.length,
        issues,
      });
    } catch (error) {
      loops.push({
        id: inspection.loop.id,
        lifecycle: inspection.loop.lifecycle,
        scheduleKind: inspection.loop.schedule.kind,
        desiredLaunchdState: null,
        loaded: null,
        consumedOnce: null,
        label: null,
        plistPath: null,
        hashPath: taskPlistHashPath(inspection.loop.id, env),
        isRunning: inspection.state.isRunning,
        currentRunId: inspection.state.currentRunId,
        stage: inspection.state.stage,
        nextScheduledAt: inspection.state.nextScheduledAt,
        lastRunStatus: inspection.state.lastRun?.status ?? null,
        secretNameCount: inspection.loop.environment.secretNames.length,
        issues: [...issues, loopIssue(inspection, "schedule-inspection-failed", error.message)],
      });
    }
  }

  for (const loop of loops) {
    for (const entry of loop.issues) {
      if (String(entry.code).includes("failed") || String(entry.code).includes("missing") || String(entry.code).includes("drift")) {
        errors.push(entry);
      } else {
        warnings.push(entry);
      }
    }
  }
  for (const entry of inventory.errors) {
    warnings.push({ id: null, code: entry.code, message: entry.message, context: { path: entry.path ?? null } });
  }
  if (runtime.breadcrumb.error) {
    warnings.push({ id: null, code: "runtime_breadcrumb_invalid", message: runtime.breadcrumb.error.message, context: { path: runtime.breadcrumb.path } });
  }

  return {
    schemaVersion: 1,
    runtime: {
      stateRoot: runtime.stateRoot,
      launchPath: runtime.launchPath,
      breadcrumb: runtime.breadcrumb,
      app: binarySummary(runtime.app, appInfo),
      control: binarySummary(runtime.control, controlInfo),
      runner: binarySummary(runtime.runner, runnerInfo),
      node: binarySummary(runtime.node, nodeInfo),
      helper: binarySummary(runtime.helper, helperInfo),
      copilot: binarySummary(runtime.copilot, copilotInfo),
      launchctl: binarySummary(runtime.launchctl, launchctlInfo),
    },
    app: {
      label: resolvedAppLabel,
      target: appLoaded.target,
      loaded: appLoaded.loaded,
      launchAtLogin: settings.settings.launchAtLogin,
    },
    settings,
    inventory,
    loops,
    errors,
    warnings,
  };
}
