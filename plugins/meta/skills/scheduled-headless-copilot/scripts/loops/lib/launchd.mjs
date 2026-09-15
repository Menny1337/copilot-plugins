import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { validateLoopDefinition } from "./contracts.mjs";
import { loopDirectory, loopManifestPath, requireLoopId, taskLabel } from "./paths.mjs";
import {
  defaultCommandRunner,
  defaultLaunchdPath,
  renderTaskPlist,
  validatePlistXml,
} from "./plist.mjs";

export const BOOTSTRAP_RETRY_ATTEMPTS = 5;

function userHome(env = process.env) {
  return env.HOME ? path.resolve(env.HOME) : os.homedir();
}

export function launchAgentsDirectory(env = process.env) {
  return path.join(userHome(env), "Library", "LaunchAgents");
}

export function taskPlistPath(id, env = process.env) {
  return path.join(launchAgentsDirectory(env), `${taskLabel(id, env)}.plist`);
}

export function taskPlistHashPath(id, env = process.env) {
  return path.join(loopDirectory(id, env), "generated.plist.sha256");
}

export function taskLogsDirectory(id, env = process.env) {
  return path.join(loopDirectory(id, env), "logs");
}

export function taskStdoutPath(id, env = process.env) {
  return path.join(taskLogsDirectory(id, env), "launchd.out.log");
}

export function taskStderrPath(id, env = process.env) {
  return path.join(taskLogsDirectory(id, env), "launchd.err.log");
}

export function launchdDomain(uid = process.getuid?.()) {
  if (!Number.isInteger(uid) || uid < 0) throw new TypeError("uid must be a non-negative integer");
  return `gui/${uid}`;
}

export function launchdTarget(id, uid = process.getuid?.(), env = process.env) {
  return `${launchdDomain(uid)}/${taskLabel(id, env)}`;
}

function sleepSeconds(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readTextIfExists(filePath, options = {}) {
  try {
    return await (options.readFile ?? readFile)(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWriteText(filePath, content, options = {}) {
  const base = path.basename(filePath);
  const dir = path.dirname(filePath);
  const write = options.writeFile ?? writeFile;
  const move = options.rename ?? rename;
  const remove = options.rm ?? rm;
  const makeDirectory = options.mkdir ?? mkdir;
  const tempPath = path.join(dir, `.${base}.${process.pid}.${randomUUID()}.tmp`);
  await makeDirectory(dir, { recursive: true });
  try {
    await write(tempPath, content, "utf8");
    await move(tempPath, filePath);
  } catch (error) {
    await remove(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function runLaunchctl(args, options = {}) {
  const run = options.run ?? defaultCommandRunner;
  const result = await run(options.launchctlPath ?? "launchctl", args, {
    env: options.env,
    input: options.input,
  });
  const signalTerminated = result.signal !== null && result.signal !== undefined;
  const exited = typeof result.code === "number";
  if (signalTerminated || !exited || result.code !== 0) {
    if (options.allowFailure && !signalTerminated && exited) return result;
    const detail = (result.stderr || result.stdout || `launchctl ${args[0]} failed`).trim();
    const error = new Error(detail);
    error.code = result.code;
    error.signal = result.signal ?? null;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result;
}

export async function readCanonicalLoopManifest(id, options = {}) {
  const loopId = requireLoopId(id);
  const source = await (options.readFile ?? readFile)(loopManifestPath(loopId, options.env), "utf8");
  return validateLoopDefinition(JSON.parse(source));
}

export async function writeTaskLaunchAgent(loopDefinition, options = {}) {
  const loop = validateLoopDefinition(loopDefinition);
  const plistPath = taskPlistPath(loop.id, options.env);
  const hashPath = taskPlistHashPath(loop.id, options.env);
  const logsDir = taskLogsDirectory(loop.id, options.env);
  await (options.mkdir ?? mkdir)(launchAgentsDirectory(options.env), { recursive: true });
  await (options.mkdir ?? mkdir)(logsDir, { recursive: true });
  const rendered = renderTaskPlist(loop, {
    env: options.env,
    label: taskLabel(loop.id, options.env),
    nodePath: options.nodePath,
    runnerPath: options.runnerPath,
    stdoutPath: options.stdoutPath ?? taskStdoutPath(loop.id, options.env),
    stderrPath: options.stderrPath ?? taskStderrPath(loop.id, options.env),
    launchPath: options.launchPath ?? defaultLaunchdPath(options.env),
  });
  await validatePlistXml(rendered.xml, {
    env: options.env,
    plutilPath: options.plutilPath,
    run: options.runPlutil,
  });
  const hash = sha256(rendered.xml);
  const existingXml = await readTextIfExists(plistPath, options);
  const existingHash = await readTextIfExists(hashPath, options);
  const changed = existingXml !== rendered.xml;
  if (changed) {
    await atomicWriteText(plistPath, rendered.xml, options);
  }
  if (existingHash !== `${hash}\n`) {
    await atomicWriteText(hashPath, `${hash}\n`, options);
  }
  return {
    ...rendered,
    changed,
    hash,
    hashPath,
    plistPath,
    logsDir,
    stdoutPath: rendered.stdoutPath,
    stderrPath: rendered.stderrPath,
  };
}

export async function bootoutTaskLaunchAgent(id, options = {}) {
  return await runLaunchctl(["bootout", launchdTarget(id, options.uid, options.env)], {
    ...options,
    allowFailure: options.allowFailure ?? false,
  });
}

export async function bootstrapTaskLaunchAgent(id, plistPath, options = {}) {
  const loopId = requireLoopId(id);
  const domain = launchdDomain(options.uid);
  const target = launchdTarget(loopId, options.uid, options.env);
  const attempts = options.attempts ?? BOOTSTRAP_RETRY_ATTEMPTS;
  const sleep = options.sleep ?? sleepSeconds;
  await bootoutTaskLaunchAgent(loopId, { ...options, allowFailure: true });
  let lastFailure = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runLaunchctl(["bootstrap", domain, plistPath], {
      ...options,
      allowFailure: true,
    });
    if (result.code === 0) {
      return { ...result, attempt, domain, target };
    }
    lastFailure = result;
    await bootoutTaskLaunchAgent(loopId, { ...options, allowFailure: true });
    if (attempt < attempts) {
      await sleep(attempt);
    }
  }
  const detail = (lastFailure?.stderr || lastFailure?.stdout || "bootstrap failed").trim();
  const error = new Error(`Failed to bootstrap ${target} after retries: ${detail}`);
  error.code = lastFailure?.code ?? 1;
  error.stdout = lastFailure?.stdout ?? "";
  error.stderr = lastFailure?.stderr ?? "";
  throw error;
}

export async function isTaskLoaded(id, options = {}) {
  const result = await runLaunchctl(["print", launchdTarget(id, options.uid, options.env)], {
    ...options,
    allowFailure: true,
  });
  return {
    ...result,
    loaded: result.code === 0,
  };
}

export async function enableTaskLaunchAgent(id, options = {}) {
  return await runLaunchctl(["enable", launchdTarget(id, options.uid, options.env)], options);
}

export async function disableTaskLaunchAgent(id, options = {}) {
  return await runLaunchctl(["disable", launchdTarget(id, options.uid, options.env)], options);
}

export async function kickstartTaskLaunchAgent(id, options = {}) {
  const args = ["kickstart"];
  if (options.killExisting !== false) args.push("-k");
  args.push(launchdTarget(id, options.uid, options.env));
  return await runLaunchctl(args, options);
}

export async function killTaskLaunchAgent(id, options = {}) {
  return await runLaunchctl(
    ["kill", options.signal ?? "SIGTERM", launchdTarget(id, options.uid, options.env)],
    options,
  );
}

export async function removeTaskLaunchAgent(id, options = {}) {
  const loopId = requireLoopId(id);
  const plistPath = taskPlistPath(loopId, options.env);
  const hashPath = taskPlistHashPath(loopId, options.env);
  const loaded = await isTaskLoaded(loopId, options);
  if (loaded.loaded) {
    await bootoutTaskLaunchAgent(loopId, options);
  }
  await (options.rm ?? rm)(plistPath, { force: true });
  await (options.rm ?? rm)(hashPath, { force: true });
  return {
    loaded: loaded.loaded,
    plistPath,
    hashPath,
  };
}
