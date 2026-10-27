import { AsyncLocalStorage } from "node:async_hooks";
import fsp from "node:fs/promises";
import path from "node:path";
import { loopManifestPath, loopDirectory, stateRoot } from "./paths.mjs";
import { validateLoopDefinition } from "./contracts.mjs";
import { UserError } from "./errors.mjs";
import { acquireLock } from "./locks.mjs";

const transactionContext = new AsyncLocalStorage();
const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;
const TRANSACTION_RETRY_MS = 20;

function mutationLockPath(id, env = process.env) {
  return path.join(loopDirectory(id, env), ".lock");
}

function transactionLockPath(scope, env = process.env) {
  return path.join(stateRoot(env), ".control-locks", `${scope}.lock`);
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireTransactionLock(lockPath, options = {}) {
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });
  const timeoutMs = options.mutationTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lock = acquireLock(lockPath);
    if (lock) return lock;
    if (Date.now() >= deadline) {
      throw new UserError("control-plane mutation is currently locked", {
        lockPath,
        timeoutMs,
      });
    }
    await delay(Math.min(TRANSACTION_RETRY_MS, Math.max(1, deadline - Date.now())));
  }
}

async function withMutationTransaction(scope, env, work, options = {}) {
  const lockPath = transactionLockPath(scope, env);
  const heldLocks = transactionContext.getStore();
  if (heldLocks?.has(lockPath)) {
    return await work();
  }

  const lock = await acquireTransactionLock(lockPath, options);
  const nextHeldLocks = new Set(heldLocks ?? []);
  nextHeldLocks.add(lockPath);
  return await transactionContext.run(nextHeldLocks, async () => {
    try {
      await options.onMutationLockAcquired?.({ scope, lockPath });
      return await work();
    } finally {
      lock.release();
    }
  });
}

export async function withLoopMutation(id, env = process.env, work, options = {}) {
  return await withMutationTransaction(`loop-${id}`, env, work, options);
}

export async function withGlobalMutation(env = process.env, work, options = {}) {
  return await withMutationTransaction("global", env, work, options);
}

async function acquireMutationLock(id, env = process.env, { createDirectory = false } = {}) {
  const dir = loopDirectory(id, env);
  if (createDirectory) {
    await fsp.mkdir(dir, { recursive: true });
  }
  const lock = acquireLock(mutationLockPath(id, env));
  if (!lock) {
    throw new UserError(`loop ${id} is currently locked for mutation`);
  }
  return { dir, lock };
}

export async function readLoop(id, env = process.env) {
  const p = loopManifestPath(id, env);
  try {
    const data = await fsp.readFile(p, "utf-8");
    return validateLoopDefinition(JSON.parse(data));
  } catch (e) {
    if (e.code === "ENOENT") throw new UserError(`loop not found: ${id}`);
    throw e;
  }
}

export async function loopExists(id, env = process.env) {
  try {
    await fsp.stat(loopManifestPath(id, env));
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}

export async function listLoops(env = process.env) {
  const tasksDir = path.join(stateRoot(env), "tasks");
  const result = { loops: [], errors: [] };
  try {
    const entries = await fsp.readdir(tasksDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          result.loops.push(await readLoop(entry.name, env));
        } catch (e) {
          result.errors.push({ id: entry.name, error: e.name, message: e.message });
        }
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return result;
}

export async function writeLoop(loop, env = process.env) {
  validateLoopDefinition(loop);
  const { lock } = await acquireMutationLock(loop.id, env, { createDirectory: true });

  try {
    const p = loopManifestPath(loop.id, env);
    const temp = `${p}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(loop, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
    await fsp.rename(temp, p); // Atomic rename
  } finally {
    lock.release();
  }
}

export async function deleteLoop(id, env = process.env) {
  const dir = loopDirectory(id, env);
  try {
    await fsp.stat(dir);
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }

  const { lock } = await acquireMutationLock(id, env);

  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  } finally {
    lock.release();
  }
}
