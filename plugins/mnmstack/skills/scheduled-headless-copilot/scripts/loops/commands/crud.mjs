import path from "node:path";
import { prepareForReview, blockApproval } from "../lib/approval.mjs";
import { capabilityFingerprint, validateLoopDefinition } from "../lib/contracts.mjs";
import { inspectPath, runtimeContext } from "../lib/control-runtime.mjs";
import {
  assertNoPayload,
  exactPayload,
  requireBoolean,
  requireInteger,
  requireLoopIdValue,
} from "../lib/control-payload.mjs";
import { UserError } from "../lib/errors.mjs";
import { removeTaskLaunchAgent } from "../lib/launchd.mjs";
import { isLockHeld } from "../lib/locks.mjs";
import { runCommandCapture } from "../lib/process-tree.mjs";
import { listLoopStatesResponse, loopDetailResponse } from "../lib/control-observe.mjs";
import { loopDirectory, stateRoot } from "../lib/paths.mjs";
import { lockDirectory, readLoopState } from "../lib/run-state.mjs";
import { deleteLoop, loopExists, readLoop, withLoopMutation, writeLoop } from "../lib/store.mjs";
import { reconcileLoopSchedule } from "./schedule.mjs";

const SECRET_HELPER_TIMEOUT_SECONDS = 5;
const MUTATION_LOCK_DIRNAME = ".lock";

function assertValidLoop(loop, context = {}) {
  try {
    return validateLoopDefinition(loop);
  } catch (error) {
    throw new UserError(error.message, context);
  }
}

function mutationLoopBase(loopInput, timestamps = {}) {
  const now = timestamps.now ?? new Date().toISOString();
  return {
    ...structuredClone(loopInput),
    createdAt: timestamps.createdAt ?? loopInput.createdAt ?? now,
    updatedAt: now,
  };
}

function scheduleMutationOptions(options) {
  return {
    ...options,
    env: options.env ?? process.env,
    launchctlPath: options.launchctlPath ?? options.env?.COPILOT_LOOPS_LAUNCHCTL ?? process.env.COPILOT_LOOPS_LAUNCHCTL,
  };
}

async function tryReconcile(loop, options = {}) {
  const reconcile = options.reconcileLoopSchedule ?? reconcileLoopSchedule;
  return await reconcile(loop, scheduleMutationOptions(options));
}

function normalizedSecretNames(secretNames = []) {
  return [...new Set(secretNames)].sort();
}

function removedSecretNames(existingLoop, nextLoop) {
  const next = new Set(nextLoop.environment?.secretNames ?? []);
  return normalizedSecretNames(existingLoop.environment?.secretNames ?? []).filter((name) => !next.has(name));
}

export async function createLoop(payload, options = {}) {
  const body = exactPayload(payload ?? {}, { required: ["loop"], optional: [] });
  const id = requireLoopIdValue(body.loop?.id, "payload.loop.id");
  const env = options.env ?? process.env;
  return await withLoopMutation(id, env, async () => {
  const base = mutationLoopBase(body.loop, { now: new Date().toISOString() });
  const loop = prepareForReview(base);
  assertValidLoop(loop, { id: loop.id });

  if (await loopExists(loop.id, env)) {
    throw new UserError(`loop already exists: ${loop.id}`, { id: loop.id });
  }

  await blockApproval(loop.id, env);
  await writeLoop(loop, env);
  return { loop };
  }, options);
}

export async function updateLoop(payload, options = {}) {
  const body = exactPayload(payload ?? {}, { required: ["loop"], optional: [] });
  const id = requireLoopIdValue(body.loop?.id, "payload.loop.id");
  const env = options.env ?? process.env;
  return await withLoopMutation(id, env, async () => {
  const existing = await readLoop(id, env);
  const now = new Date().toISOString();
  const candidate = mutationLoopBase(body.loop, { now, createdAt: existing.createdAt });
  candidate.lifecycle = existing.lifecycle;
  candidate.approval = structuredClone(existing.approval);
  assertValidLoop(candidate, { id });

  const existingFingerprint = capabilityFingerprint(existing);
  const nextFingerprint = capabilityFingerprint(candidate);
  const nextLoop = existingFingerprint === nextFingerprint
    ? candidate
    : prepareForReview(candidate);
  const removedSecrets = removedSecretNames(existing, nextLoop);

  if (existingFingerprint !== nextFingerprint) {
    await blockApproval(nextLoop.id, env);
  }
  assertValidLoop(nextLoop, { id });
  await writeLoop(nextLoop, env);

  let schedule = null;
  let reconcileError = null;
  if (["enabled", "paused", "ready", "needsReview"].includes(existing.lifecycle) || existingFingerprint !== nextFingerprint) {
    try {
      schedule = await tryReconcile(nextLoop, options);
    } catch (error) {
      reconcileError = error;
    }
  }

  const secretLifecycle = await cleanupRemovedSecretsAfterUpdate(nextLoop, removedSecrets, options);
  if (reconcileError) {
    throw new UserError(`Failed to update loop: ${reconcileError.message}`, {
      id,
      cause: reconcileError.message,
      removedSecretNames: secretLifecycle.removedSecretNames,
      secretDeletion: secretLifecycle.secretDeletion,
      warning: secretLifecycle.warning ?? null,
      persisted: true,
    });
  }

  return {
    loop: nextLoop,
    schedule,
    removedSecretNames: secretLifecycle.removedSecretNames,
    secretNames: secretLifecycle.secretNames,
    secretDeletion: secretLifecycle.secretDeletion,
    warning: secretLifecycle.warning,
  };
  }, options);
}

export async function showLoop(payload = {}, options = {}) {
  const body = exactPayload(payload ?? {}, { required: ["id"], optional: ["count"] });
  const id = requireLoopIdValue(body.id, "payload.id");
  const count = body.count === undefined ? 20 : requireInteger(body.count, "payload.count", { minimum: 1, maximum: 200 });
  return await loopDetailResponse(id, { env: options.env, count });
}

export async function listLoopsCmd(payload = {}, options = {}) {
  assertNoPayload(payload ?? {});
  return await listLoopStatesResponse({ env: options.env });
}

function assertManagedLoopDirectory(id, env = process.env) {
  const tasksRoot = path.join(stateRoot(env), "tasks");
  const directory = path.resolve(loopDirectory(id, env));
  const relative = path.relative(tasksRoot, directory);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UserError("refusing to delete outside the managed loop directory", {
      id,
      directory,
      tasksRoot,
    });
  }
  return directory;
}

function mutationLockPath(id, env = process.env) {
  return path.join(loopDirectory(id, env), MUTATION_LOCK_DIRNAME);
}

function trimHelperOutput(value) {
  return typeof value === "string" ? value.trim() : "";
}

function helperFailureDetail(result) {
  return trimHelperOutput(result?.stderr) || trimHelperOutput(result?.stdout) || null;
}

function assertNoLiveMutationLock(id, env = process.env) {
  if (!isLockHeld(mutationLockPath(id, env))) return;
  throw new UserError(`loop ${id} is currently locked for mutation`, { id });
}

async function purgeManagedSecrets(loop, options = {}) {
  return await deleteManagedSecrets(loop.id, loop.environment?.secretNames ?? [], options, { failClosed: true });
}

function secretDeletionWarning(loopId, removedSecretNames, summary) {
  if (!summary || summary.status !== "failed") return undefined;
  const failedAccount = summary.failedAccount ?? (removedSecretNames[0] ? `${loopId}:${removedSecretNames[0]}` : null);
  if (summary.error?.code === "helper-unavailable") {
    return "Loop updated, but removed managed secrets could not be deleted because the secrets helper is unavailable.";
  }
  if (summary.error?.code === "helper-timeout") {
    return `Loop updated, but removed managed secret ${failedAccount ?? "accounts"} could not be deleted because the secrets helper timed out.`;
  }
  if (summary.error?.code === "helper-launch-failed") {
    return `Loop updated, but removed managed secret ${failedAccount ?? "accounts"} could not be deleted because the secrets helper could not be launched.`;
  }
  return `Loop updated, but removed managed secret ${failedAccount ?? "accounts"} could not be deleted from Keychain.`;
}

async function cleanupRemovedSecretsAfterUpdate(loop, removedSecretNamesList, options = {}) {
  const removed = normalizedSecretNames(removedSecretNamesList);
  if (removed.length === 0) {
    return {
      removedSecretNames: [],
      secretNames: undefined,
      secretDeletion: undefined,
      warning: undefined,
    };
  }
  const summary = await deleteManagedSecrets(loop.id, removed, options, { failClosed: false });
  return {
    removedSecretNames: removed,
    secretNames: removed,
    secretDeletion: summary,
    warning: secretDeletionWarning(loop.id, removed, summary),
  };
}

async function deleteManagedSecrets(loopId, secretNamesInput, options = {}, { failClosed = false } = {}) {
  const secretNames = normalizedSecretNames(secretNamesInput);
  const summary = {
    helperPath: null,
    attemptedCount: secretNames.length,
    deletedCount: 0,
    deletedNames: [],
    deletedAccounts: [],
    failedName: null,
    failedAccount: null,
    error: null,
    status: secretNames.length === 0 ? "none" : "deleted",
  };
  if (secretNames.length === 0) {
    return summary;
  }

  const env = options.env ?? process.env;
  const runtime = await (options.runtimeContext ?? runtimeContext)(env, options);
  const helperPath = runtime?.helper?.path ?? null;
  summary.helperPath = helperPath;
  const helperInfo = await (options.inspectPath ?? inspectPath)(helperPath, { type: "file", executable: true });
  if (!helperInfo.exists || !helperInfo.executable) {
    const failure = {
      ...summary,
      status: "failed",
      error: {
        code: "helper-unavailable",
        message: "secrets helper is unavailable",
        helperError: helperInfo.error ?? null,
      },
    };
    if (failClosed) {
      throw new UserError("Cannot purge managed secrets: secrets helper is unavailable", {
        id: loopId,
        helperPath,
        helperError: helperInfo.error ?? null,
        secretNames,
        secretDeletion: failure,
      });
    }
    return failure;
  }

  for (const name of secretNames) {
    const account = `${loopId}:${name}`;
    let result;
    try {
      result = await (options.runCommandCapture ?? runCommandCapture)({
        command: helperPath,
        args: ["delete", account],
        env,
        timeoutSeconds: SECRET_HELPER_TIMEOUT_SECONDS,
      });
    } catch (error) {
      const failure = {
        ...summary,
        status: "failed",
        failedName: name,
        failedAccount: account,
        error: {
          code: "helper-launch-failed",
          message: error.message,
        },
      };
      if (failClosed) {
        throw new UserError(`Failed to purge managed secret ${name}: could not launch secrets helper`, {
          id: loopId,
          secretName: name,
          secretAccount: account,
          helperPath,
          cause: error.message,
          deletedNames: failure.deletedNames,
          deletedAccounts: failure.deletedAccounts,
          secretDeletion: failure,
        });
      }
      return failure;
    }

    if (result.timedOut) {
      const failure = {
        ...summary,
        status: "failed",
        failedName: name,
        failedAccount: account,
        error: {
          code: "helper-timeout",
          message: "secrets helper timed out",
        },
      };
      if (failClosed) {
        throw new UserError(`Failed to purge managed secret ${name}: secrets helper timed out`, {
          id: loopId,
          secretName: name,
          secretAccount: account,
          helperPath,
          deletedNames: failure.deletedNames,
          deletedAccounts: failure.deletedAccounts,
          secretDeletion: failure,
        });
      }
      return failure;
    }
    if (result.exitCode !== 0 || result.signal !== null) {
      const failure = {
        ...summary,
        status: "failed",
        failedName: name,
        failedAccount: account,
        error: {
          code: "helper-delete-failed",
          message: helperFailureDetail(result) ?? "secrets helper delete failed",
          exitCode: result.exitCode,
          signal: result.signal,
        },
      };
      if (failClosed) {
        throw new UserError(`Failed to purge managed secret ${name}: secrets helper delete failed`, {
          id: loopId,
          secretName: name,
          secretAccount: account,
          helperPath,
          exitCode: result.exitCode,
          signal: result.signal,
          detail: helperFailureDetail(result),
          deletedNames: failure.deletedNames,
          deletedAccounts: failure.deletedAccounts,
          secretDeletion: failure,
        });
      }
      return failure;
    }

    summary.deletedNames.push(name);
    summary.deletedAccounts.push(account);
    summary.deletedCount = summary.deletedNames.length;
  }

  return summary;
}

export async function purgeLoop(payload, options = {}) {
  const body = exactPayload(payload ?? {}, { required: ["id", "confirm"], optional: [] });
  const id = requireLoopIdValue(body.id, "payload.id");
  const confirm = requireBoolean(body.confirm, "payload.confirm");
  if (confirm !== true) {
    throw new UserError("purge requires confirm: true", { id });
  }

  const env = options.env ?? process.env;
  return await withLoopMutation(id, env, async () => {
  const loop = await readLoop(id, env);
  const directory = assertManagedLoopDirectory(id, env);
  assertNoLiveMutationLock(id, env);
  let activeState = null;
  let activeStateError = null;
  try {
    activeState = readLoopState(id, env).active ?? null;
  } catch (error) {
    activeStateError = error;
  }
  if (isLockHeld(lockDirectory(id, env)) || activeState) {
    throw new UserError("Cannot purge an active loop; stop it first and wait for it to become idle", {
      id,
      currentRunId: activeState?.currentRunId ?? activeState?.runId ?? null,
      stage: activeState?.stage ?? null,
    });
  }
  if (activeStateError) {
    throw new UserError("Cannot purge because the active state could not be determined; stop the loop first", {
      id,
      cause: activeStateError.message,
    });
  }
  try {
    await (options.removeTaskLaunchAgent ?? removeTaskLaunchAgent)(id, scheduleMutationOptions(options));
  } catch (error) {
    throw new UserError(`Failed to clean up LaunchAgent before purge: ${error.message}`, {
      id,
      cause: error.message,
    });
  }

  let secretDeletion;
  try {
    secretDeletion = await purgeManagedSecrets(loop, options);
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(`Failed to purge managed secrets: ${error.message}`, {
      id,
      cause: error.message,
    });
  }

  await deleteLoop(id, env);
  return {
    loop,
    purged: id,
    deletedPath: directory,
    secretNames: secretDeletion.deletedNames,
    secretAccounts: secretDeletion.deletedAccounts,
    secretDeletion,
  };
  }, options);
}
