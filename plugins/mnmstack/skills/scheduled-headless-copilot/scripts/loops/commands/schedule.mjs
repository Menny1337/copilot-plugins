import { validateLoopDefinition } from "../lib/contracts.mjs";
import {
  bootstrapTaskLaunchAgent,
  bootoutTaskLaunchAgent,
  disableTaskLaunchAgent,
  enableTaskLaunchAgent,
  isTaskLoaded,
  readCanonicalLoopManifest,
  launchdTarget,
  removeTaskLaunchAgent,
  taskPlistPath,
  writeTaskLaunchAgent,
} from "../lib/launchd.mjs";
import { readScheduleState, writeScheduleState } from "../lib/run-state.mjs";
import { assessSchedule } from "../lib/schedule.mjs";
import { requireLoopId } from "../lib/paths.mjs";
import { withLoopMutation } from "../lib/store.mjs";

const EMPTY_SCHEDULE_STATE = Object.freeze({
  consumedAt: null,
  lastScheduledAt: null,
  nextExpectedAt: null,
});

function launchctlOptions(options = {}) {
  return {
    ...options,
    env: options.env ?? process.env,
    launchctlPath: options.launchctlPath ?? options.env?.COPILOT_LOOPS_LAUNCHCTL ?? process.env.COPILOT_LOOPS_LAUNCHCTL,
  };
}

function schedulerOps(options = {}) {
  return {
    bootstrapTaskLaunchAgent: options.bootstrapTaskLaunchAgent ?? bootstrapTaskLaunchAgent,
    bootoutTaskLaunchAgent: options.bootoutTaskLaunchAgent ?? bootoutTaskLaunchAgent,
    disableTaskLaunchAgent: options.disableTaskLaunchAgent ?? disableTaskLaunchAgent,
    enableTaskLaunchAgent: options.enableTaskLaunchAgent ?? enableTaskLaunchAgent,
    isTaskLoaded: options.isTaskLoaded ?? isTaskLoaded,
    readCanonicalLoopManifest: options.readCanonicalLoopManifest ?? readCanonicalLoopManifest,
    writeScheduleState: options.writeScheduleState ?? writeScheduleState,
    writeTaskLaunchAgent: options.writeTaskLaunchAgent ?? writeTaskLaunchAgent,
    removeTaskLaunchAgent: options.removeTaskLaunchAgent ?? removeTaskLaunchAgent,
  };
}

function scheduleNow(options = {}) {
  const value = typeof options.now === "function" ? options.now() : options.now;
  if (value === undefined) return new Date();
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function shouldResetIntervalBaseline(loop, scheduleState, reloaded) {
  return loop.schedule.kind === "interval" && (reloaded || !scheduleState?.nextExpectedAt);
}

function intervalBaselineAssessment(loop, options = {}) {
  return assessSchedule(loop.schedule, EMPTY_SCHEDULE_STATE, { now: scheduleNow(options) });
}

function wrapRollbackError(error, rollbackError) {
  if (!rollbackError) return error;
  const wrapped = new Error(`${error.message}; failed to restore previous interval schedule baseline: ${rollbackError.message}`);
  wrapped.cause = error;
  wrapped.rollback = rollbackError;
  return wrapped;
}

async function withPreparedIntervalBaseline(loop, scheduleState, reloaded, options, work) {
  const ops = schedulerOps(options);
  if (!shouldResetIntervalBaseline(loop, scheduleState, reloaded)) {
    return await work(null);
  }
  const previousState = structuredClone(scheduleState ?? EMPTY_SCHEDULE_STATE);
  const prepared = intervalBaselineAssessment(loop, options);
  await ops.writeScheduleState(loop.id, prepared.state, options.env);
  try {
    return await work(prepared);
  } catch (error) {
    let rollbackError = null;
    try {
      await ops.writeScheduleState(loop.id, previousState, options.env);
    } catch (rollback) {
      rollbackError = rollback;
    }
    throw wrapRollbackError(error, rollbackError);
  }
}

export async function loadLoop(loopOrId, options = {}) {
  const ops = schedulerOps(options);
  if (typeof loopOrId === "string") {
    return await ops.readCanonicalLoopManifest(loopOrId, options);
  }
  return validateLoopDefinition(loopOrId);
}

export function resolveScheduleState(loopDefinition, options = {}) {
  if (options.scheduleState) return options.scheduleState;
  try {
    return (options.readScheduleState ?? readScheduleState)(loopDefinition.id, options.env);
  } catch {
    return { consumedAt: null, lastScheduledAt: null, nextExpectedAt: null };
  }
}

export function isConsumedOneTimeLoop(loopDefinition, options = {}) {
  const loop = validateLoopDefinition(loopDefinition);
  const scheduleState = resolveScheduleState(loop, options);
  return loop.schedule.kind === "once" && Boolean(scheduleState?.consumedAt);
}

export function desiredLaunchdState(loopDefinition, options = {}) {
  const loop = validateLoopDefinition(loopDefinition);
  if (isConsumedOneTimeLoop(loop, options)) return "consumed-once";
  if (loop.lifecycle === "enabled" || loop.lifecycle === "paused") return "loaded";
  if (loop.lifecycle === "archived") return "archived";
  return "booted-out";
}

export async function inspectLoopSchedule(loopOrId, options = {}) {
  const ops = schedulerOps(options);
  const launchd = launchctlOptions(options);
  const loop = await loadLoop(loopOrId, options);
  const scheduleState = resolveScheduleState(loop, options);
  const loaded = await ops.isTaskLoaded(loop.id, launchd);
  return {
    loopId: loop.id,
    label: launchdTarget(loop.id, options.uid, options.env),
    plistPath: taskPlistPath(loop.id, options.env),
    launchdState: desiredLaunchdState(loop, { ...options, scheduleState }),
    loaded: loaded.loaded,
    consumedOnce: isConsumedOneTimeLoop(loop, { ...options, scheduleState }),
    scheduleState,
    schedule: assessSchedule(loop.schedule, scheduleState, { now: options.now }),
  };
}

async function ensureLoopServiceLoadedUnlocked(loopOrId, options = {}) {
  const ops = schedulerOps(options);
  const launchd = launchctlOptions(options);
  const loop = await loadLoop(loopOrId, options);
  const scheduleState = resolveScheduleState(loop, options);
  const written = await ops.writeTaskLaunchAgent(loop, launchd);
  const loaded = await ops.isTaskLoaded(loop.id, launchd);
  const reloaded = written.changed || !loaded.loaded;
  return await withPreparedIntervalBaseline(loop, scheduleState, reloaded, options, async () => {
    await ops.enableTaskLaunchAgent(loop.id, launchd);
    if (reloaded) {
      await ops.bootstrapTaskLaunchAgent(loop.id, written.plistPath, launchd);
    }
    return {
      loopId: loop.id,
      desired: "loaded",
      plistPath: written.plistPath,
      hashPath: written.hashPath,
      label: written.label,
      programArguments: written.programArguments,
      launchPath: written.launchPath,
      changed: written.changed,
      loaded: loaded.loaded,
      reloaded,
    };
  });
}

export async function ensureLoopServiceLoaded(loopOrId, options = {}) {
  const env = options.env ?? process.env;
  const id = typeof loopOrId === "string"
    ? requireLoopId(loopOrId)
    : validateLoopDefinition(loopOrId).id;
  return await withLoopMutation(id, env, async () => {
    return await ensureLoopServiceLoadedUnlocked(loopOrId, { ...options, env });
  }, options);
}

async function reconcileLoopScheduleUnlocked(loopOrId, options = {}) {
  const ops = schedulerOps(options);
  const launchd = launchctlOptions(options);
  const loop = await loadLoop(loopOrId, options);
  const scheduleState = resolveScheduleState(loop, options);
  const desired = desiredLaunchdState(loop, { ...options, scheduleState });

  if (desired === "archived") {
    const removed = await ops.removeTaskLaunchAgent(loop.id, launchd);
    return {
      loopId: loop.id,
      desired,
      removed: true,
      ...removed,
    };
  }

  if (desired === "consumed-once") {
    const loaded = await ops.isTaskLoaded(loop.id, launchd);
    let disabled = false;
    if (loaded.loaded) {
      await ops.disableTaskLaunchAgent(loop.id, launchd);
      disabled = true;
    }
    const removed = await ops.removeTaskLaunchAgent(loop.id, launchd);
    return {
      loopId: loop.id,
      desired,
      loaded: loaded.loaded,
      consumedOnce: true,
      disabled,
      removed: true,
      ...removed,
    };
  }

  const written = await ops.writeTaskLaunchAgent(loop, launchd);
  const loaded = await ops.isTaskLoaded(loop.id, launchd);
  if (desired === "booted-out") {
    if (loaded.loaded) {
      await ops.bootoutTaskLaunchAgent(loop.id, { ...launchd, allowFailure: true });
    }
    return {
      loopId: loop.id,
      desired,
      plistPath: written.plistPath,
      hashPath: written.hashPath,
      label: written.label,
      programArguments: written.programArguments,
      launchPath: written.launchPath,
      changed: written.changed,
      loaded: loaded.loaded,
    };
  }

  const reloaded = written.changed || !loaded.loaded;
  return await withPreparedIntervalBaseline(loop, scheduleState, reloaded, options, async () => {
    await ops.enableTaskLaunchAgent(loop.id, launchd);
    if (reloaded) {
      await ops.bootstrapTaskLaunchAgent(loop.id, written.plistPath, launchd);
    }
    return {
      loopId: loop.id,
      desired,
      plistPath: written.plistPath,
      hashPath: written.hashPath,
      label: written.label,
      programArguments: written.programArguments,
      launchPath: written.launchPath,
      changed: written.changed,
      loaded: loaded.loaded,
      reloaded,
    };
  });
}

export async function reconcileLoopSchedule(loopOrId, options = {}) {
  const env = options.env ?? process.env;
  const id = typeof loopOrId === "string"
    ? requireLoopId(loopOrId)
    : validateLoopDefinition(loopOrId).id;
  return await withLoopMutation(id, env, async () => {
    return await reconcileLoopScheduleUnlocked(loopOrId, { ...options, env });
  }, options);
}
