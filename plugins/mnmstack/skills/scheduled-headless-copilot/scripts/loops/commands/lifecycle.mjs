import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import { approveLoop as approve, blockApproval, unblockApproval } from "../lib/approval.mjs";
import { exactPayload, requireLoopIdValue, requireRunIdValue } from "../lib/control-payload.mjs";
import { buildPreflightReport } from "../lib/control-preflight.mjs";
import { UserError } from "../lib/errors.mjs";
import { historyResponse, listLoopStatesResponse } from "../lib/control-observe.mjs";
import {
  bootoutTaskLaunchAgent,
  disableTaskLaunchAgent,
  isTaskLoaded,
  kickstartTaskLaunchAgent,
  killTaskLaunchAgent,
} from "../lib/launchd.mjs";
import { isLockHeld } from "../lib/locks.mjs";
import {
  isTerminalStatus,
  lockDirectory,
  manualRequestPath,
  readLoopState,
  recordOverlapSkip,
  requestManualRun,
} from "../lib/run-state.mjs";
import { readLoop, withGlobalMutation, withLoopMutation, writeLoop } from "../lib/store.mjs";
import { getInventory } from "./inventory.mjs";
import { ensureLoopServiceLoaded, reconcileLoopSchedule } from "./schedule.mjs";

function lifecyclePayload(payload, optional = []) {
  const body = exactPayload(payload ?? {}, { required: ["id"], optional });
  return {
    ...body,
    id: requireLoopIdValue(body.id, "payload.id"),
  };
}

function isApproved(report) {
  return report?.approval?.status === "approved" && report.errorDetails.length === 0;
}

function preflightOptions(options = {}) {
  return {
    ...options,
    env: options.env ?? process.env,
    getInventory: options.getInventory ?? ((payload) => getInventory(payload, options.execFn, { env: options.env ?? process.env })),
  };
}

async function runPreflightForLoop(loop, options = {}) {
  return await buildPreflightReport(loop, preflightOptions(options));
}

function throwOnPreflightErrors(report, action) {
  if (report.errorDetails.length > 0) {
    throw new UserError(`Cannot ${action}: preflight reported errors`, {
      errors: report.errorDetails,
    });
  }
}

function throwUnlessRunnableApproval(report, action) {
  if (!isApproved(report)) {
    throw new UserError(`Cannot ${action}: loop is not currently approved`, {
      approval: report.approval,
      warnings: report.warningDetails,
      errors: report.errorDetails,
    });
  }
}

function dispatchNow(options = {}) {
  const value = typeof options.now === "function" ? options.now() : options.now;
  if (value === undefined) return new Date();
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function activeContext(loopId, env = process.env) {
  try {
    const state = readLoopState(loopId, env);
    return {
      currentRunId: state.active?.currentRunId ?? state.active?.runId ?? null,
      stage: state.active?.stage ?? null,
    };
  } catch {
    return {
      currentRunId: null,
      stage: null,
    };
  }
}

function skippedOverlapResponse(loop, skip, env = process.env) {
  return {
    loop,
    queued: false,
    skip,
    active: activeContext(loop.id, env),
  };
}

async function rollbackLoop(previousLoop, options = {}) {
  try {
    await writeLoop(previousLoop, options.env ?? process.env);
    await reconcileLoopSchedule(previousLoop, options);
    return null;
  } catch (error) {
    return error;
  }
}

async function transitionLoop(id, nextLifecycle, action, allowed, options = {}, { requireApproval = false } = {}) {
  const env = options.env ?? process.env;
  return await withLoopMutation(id, env, async () => {
  const loop = await readLoop(id, env);
  if (!allowed.includes(loop.lifecycle)) {
    throw new UserError(`Cannot ${action}: loop lifecycle '${loop.lifecycle}' is not allowed`, {
      id,
      lifecycle: loop.lifecycle,
      allowed,
    });
  }

  if (requireApproval) {
    const report = await runPreflightForLoop(loop, options);
    throwOnPreflightErrors(report, action);
    throwUnlessRunnableApproval(report, action);
  }

  const nextLoop = {
    ...structuredClone(loop),
    lifecycle: nextLifecycle,
    updatedAt: new Date().toISOString(),
  };
  await writeLoop(nextLoop, env);
  try {
    const schedule = await reconcileLoopSchedule(nextLoop, options);
    return { loop: nextLoop, schedule };
  } catch (error) {
    const rollbackError = await rollbackLoop(loop, options);
    throw new UserError(`Failed to ${action}: ${error.message}`, {
      id,
      desiredLifecycle: nextLifecycle,
      previousLifecycle: loop.lifecycle,
      cause: error.message,
      rollback: rollbackError ? rollbackError.message : null,
    });
  }
  }, options);
}

function launchdMutationOptions(options, env, extra = {}) {
  return {
    ...options,
    ...extra,
    env,
    launchctlPath: options.launchctlPath ?? options.env?.COPILOT_LOOPS_LAUNCHCTL ?? process.env.COPILOT_LOOPS_LAUNCHCTL,
  };
}

async function failClosedManualRequest(loop, dispatchError, action, trigger, retryOf, options, env) {
  const requestPath = manualRequestPath(loop.id, env);
  const removeRequest = options.removeManualRequest ?? ((target) => fsp.rm(target, { force: true }));
  let removalError = null;
  try {
    await removeRequest(requestPath);
  } catch (error) {
    removalError = error;
  }

  if (!removalError) {
    throw new UserError(`Failed to ${action}: ${dispatchError.message}`, {
      id: loop.id,
      trigger,
      retryOf,
      cause: dispatchError.message,
    });
  }

  const containment = {};
  const neutralizeRequest = options.neutralizeManualRequest ?? (async (target) => {
    const temp = `${target}.${process.pid}.${Date.now()}.blocked`;
    try {
      await fsp.writeFile(temp, "{}\n", { encoding: "utf8", mode: 0o600 });
      await fsp.rename(temp, target);
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  });
  try {
    await neutralizeRequest(requestPath);
    containment.manualRequest = "neutralized";
  } catch (error) {
    containment.manualRequest = "failed";
    containment.manualRequestError = error.message;
    try {
      await blockApproval(loop.id, env);
      containment.approval = "blocked";
    } catch (blockError) {
      containment.approval = "failed";
      containment.approvalError = blockError.message;
    }
  }
  try {
    await (options.disableTaskLaunchAgent ?? disableTaskLaunchAgent)(
      loop.id,
      launchdMutationOptions(options, env),
    );
    containment.disable = "succeeded";
  } catch (error) {
    containment.disable = "failed";
    containment.disableError = error.message;
  }
  try {
    const loaded = await (options.isTaskLoaded ?? isTaskLoaded)(
      loop.id,
      launchdMutationOptions(options, env),
    );
    containment.loaded = loaded.loaded;
    if (loaded.loaded) {
      await (options.bootoutTaskLaunchAgent ?? bootoutTaskLaunchAgent)(
        loop.id,
        launchdMutationOptions(options, env),
      );
      containment.bootout = "succeeded";
    } else {
      containment.bootout = "not-needed";
    }
  } catch (error) {
    containment.bootout = "failed";
    containment.bootoutError = error.message;
  }

  throw new UserError(`Failed to ${action}: ${dispatchError.message}; failed to remove pending manual request: ${removalError.message}`, {
    id: loop.id,
    trigger,
    retryOf,
    cause: dispatchError.message,
    manualRequestCleanup: removalError.message,
    containment,
  });
}

async function writeManualDispatch(loop, action, trigger, options = {}, retryOf = null) {
  if (!["ready", "enabled", "paused"].includes(loop.lifecycle)) {
    throw new UserError(`Cannot ${action}: loop lifecycle '${loop.lifecycle}' cannot run manually`, {
      id: loop.id,
      lifecycle: loop.lifecycle,
    });
  }
  const env = options.env ?? process.env;
  const now = dispatchNow(options);
  if (isLockHeld(lockDirectory(loop.id, env))) {
    const skip = recordOverlapSkip({ loopId: loop.id, trigger, retryOf, env, now });
    return skippedOverlapResponse(loop, skip, env);
  }

  const report = await runPreflightForLoop(loop, options);
  throwOnPreflightErrors(report, action);
  throwUnlessRunnableApproval(report, action);
  const queued = requestManualRun({
    loopId: loop.id,
    retryOf,
    nonce: randomUUID(),
    requestedAt: now.toISOString(),
    env,
    now,
  });
  if (!queued.queued) {
    return skippedOverlapResponse(loop, queued.skip, env);
  }
  const request = queued.request;

  try {
    const schedule = await (options.ensureLoopServiceLoaded ?? ensureLoopServiceLoaded)(loop, options);
    await (options.kickstartTaskLaunchAgent ?? kickstartTaskLaunchAgent)(loop.id, {
      ...options,
      env,
      launchctlPath: options.launchctlPath ?? options.env?.COPILOT_LOOPS_LAUNCHCTL ?? process.env.COPILOT_LOOPS_LAUNCHCTL,
      killExisting: false,
    });
    return {
      loop,
      queued: true,
      schedule,
      request: {
        trigger,
        nonce: request.nonce,
        requestedAt: request.requestedAt,
        retryOf,
      },
    };
  } catch (error) {
    await failClosedManualRequest(loop, error, action, trigger, retryOf, options, env);
  }
}

export async function approveLoopCmd(payload, options = {}) {
  const body = exactPayload(payload ?? {}, { required: ["id", "expectedFingerprint"], optional: [] });
  const id = requireLoopIdValue(body.id, "payload.id");
  if (typeof body.expectedFingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(body.expectedFingerprint)) {
    throw new UserError("payload.expectedFingerprint must be a 64-character SHA-256 hex string", {
      id,
    });
  }

  const env = options.env ?? process.env;
  return await withLoopMutation(id, env, async () => {
  const loop = await readLoop(id, env);
  if (!["draft", "needsReview"].includes(loop.lifecycle)) {
    throw new UserError("loop is not waiting for review", { id, lifecycle: loop.lifecycle });
  }

  const report = await runPreflightForLoop(loop, options);
  throwOnPreflightErrors(report, "approve");
  if (report.fingerprint !== body.expectedFingerprint) {
    throw new UserError("The loop changed after the approval review was generated", {
      id,
      expectedFingerprint: body.expectedFingerprint,
      currentFingerprint: report.fingerprint,
    });
  }

  const approved = approve(loop);
  await writeLoop(approved, env);
  try {
    const schedule = await reconcileLoopSchedule(approved, options);
    await unblockApproval(id, env);
    return {
      loop: approved,
      schedule,
      preflight: {
        fingerprint: report.fingerprint,
        warnings: report.warningDetails,
      },
    };
  } catch (error) {
    const rollbackError = await rollbackLoop(loop, options);
    throw new UserError(`Failed to approve loop: ${error.message}`, {
      id,
      cause: error.message,
      rollback: rollbackError ? rollbackError.message : null,
    });
  }
  }, options);
}

export async function enableLoop(payload, options = {}) {
  const { id } = lifecyclePayload(payload, []);
  return await transitionLoop(id, "enabled", "enable", ["ready", "paused"], options, { requireApproval: true });
}

export async function pauseLoop(payload, options = {}) {
  const { id } = lifecyclePayload(payload, []);
  return await transitionLoop(id, "paused", "pause", ["enabled"], options);
}

export async function resumeLoop(payload, options = {}) {
  const { id } = lifecyclePayload(payload, []);
  return await transitionLoop(id, "enabled", "resume", ["paused"], options, { requireApproval: true });
}

export async function archiveLoop(payload, options = {}) {
  const { id } = lifecyclePayload(payload, []);
  return await transitionLoop(id, "archived", "archive", ["draft", "needsReview", "ready", "enabled", "paused"], options);
}

export async function runNow(payload, options = {}) {
  const { id } = lifecyclePayload(payload, []);
  const env = options.env ?? process.env;
  return await withLoopMutation(id, env, async () => {
    const loop = await readLoop(id, env);
    return await writeManualDispatch(loop, "run now", "manual", options);
  }, options);
}

export async function stopLoop(payload, options = {}) {
  const { id } = lifecyclePayload(payload, []);
  const env = options.env ?? process.env;
  return await withLoopMutation(id, env, async () => {
  const loop = await readLoop(id, env);
  let detail = null;
  let observationError = null;
  try {
    detail = await (options.listLoopStatesResponse ?? listLoopStatesResponse)({ env });
  } catch (error) {
    observationError = error;
  }
  const loaded = await (options.isTaskLoaded ?? isTaskLoaded)(id, {
    ...options,
    env,
    launchctlPath: options.launchctlPath ?? options.env?.COPILOT_LOOPS_LAUNCHCTL ?? process.env.COPILOT_LOOPS_LAUNCHCTL,
  });
  const state = detail?.loops?.find((entry) => entry.definition.id === id) ?? null;
  if (!loaded.loaded && observationError) {
    throw new UserError("Unable to determine whether this loop is active", {
      id,
      cause: observationError.message,
    });
  }
  if (!loaded.loaded && !state?.stateSummary?.isRunning) {
    throw new UserError("Nothing is currently active for this loop", { id });
  }
  try {
    await (options.killTaskLaunchAgent ?? killTaskLaunchAgent)(id, {
      ...options,
      env: options.env ?? process.env,
      launchctlPath: options.launchctlPath ?? options.env?.COPILOT_LOOPS_LAUNCHCTL ?? process.env.COPILOT_LOOPS_LAUNCHCTL,
      signal: "SIGTERM",
    });
  } catch (error) {
    throw new UserError(`Failed to stop loop: ${error.message}`, {
      id,
      cause: error.message,
    });
  }
  return {
    loop,
    request: {
      signal: "SIGTERM",
      loaded: loaded.loaded,
      running: state?.stateSummary?.isRunning ?? false,
    },
  };
  }, options);
}

export async function retryLoop(payload, options = {}) {
  const body = exactPayload(payload ?? {}, { required: ["id", "runId"], optional: [] });
  const id = requireLoopIdValue(body.id, "payload.id");
  const runId = requireRunIdValue(body.runId, "payload.runId");
  const env = options.env ?? process.env;
  return await withLoopMutation(id, env, async () => {
  const loop = await readLoop(id, env);
  const history = await historyResponse({ loopId: id, count: 200, env });
  const target = history.runs.find((entry) => entry.run.id === runId)?.run;
  if (!target) {
    throw new UserError("retry requires a prior run for the same loop", {
      id,
      runId,
    });
  }
  if (!isTerminalStatus(target.status)) {
    throw new UserError("retry requires a terminal run", {
      id,
      runId,
      status: target.status,
    });
  }
  return await writeManualDispatch(loop, "retry", "retry", options, runId);
  }, options);
}

export async function reconcileLoops(payload = {}, options = {}) {
  const body = exactPayload(payload ?? {}, { required: [], optional: ["id"] });
  const singleId = body.id === undefined ? null : requireLoopIdValue(body.id, "payload.id");

  const env = options.env ?? process.env;
  const work = async () => {
  const loops = singleId ? [await readLoop(singleId, env)] : (await listLoopStatesResponse({ env })).loops.map((entry) => entry.definition);
  const reconciliation = [];
  const errors = [];

  for (const loop of loops) {
    try {
      const result = await reconcileLoopSchedule(loop.id, options);
      reconciliation.push(result);
    } catch (error) {
      const issue = {
        id: loop.id,
        code: "reconcile_failed",
        message: error.message,
      };
      if (singleId) {
        throw new UserError(`Failed to reconcile ${loop.id}: ${error.message}`, issue);
      }
      errors.push(issue);
    }
  }

  const response = await listLoopStatesResponse({ env });
  response.reconciliation = reconciliation;
  response.errors = [...response.errors, ...errors];
  return response;
  };
  return singleId
    ? await withLoopMutation(singleId, env, work, options)
    : await withGlobalMutation(env, work, options);
}

export async function preflightLoop(payload = {}, options = {}) {
  const body = exactPayload(payload ?? {}, { required: [], optional: ["id", "loop"] });
  if ((body.id === undefined && body.loop === undefined) || (body.id !== undefined && body.loop !== undefined)) {
    throw new UserError("preflight requires exactly one of { id } or { loop }", {
      hasId: body.id !== undefined,
      hasLoop: body.loop !== undefined,
    });
  }
  const loop = body.id !== undefined ? await readLoop(requireLoopIdValue(body.id, "payload.id"), options.env ?? process.env) : body.loop;
  return await runPreflightForLoop(loop, options);
}
