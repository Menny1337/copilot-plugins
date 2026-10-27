import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchdDomain } from "./launchd.mjs";
import { appLabel, stateRoot } from "./paths.mjs";
import { defaultCommandRunner, defaultLaunchdPath, defaultRunnerPath } from "./plist.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SOURCE_CONTROL_PATH = path.resolve(here, "../../loops-ctl.mjs");
export const SOURCE_RUNNER_PATH = path.resolve(here, "../../loops-runner.mjs");

function executableMode(stats) {
  return stats.isFile() && (stats.mode & 0o111) !== 0;
}

export function homeDirectory(env = process.env) {
  return env.HOME ? path.resolve(env.HOME) : os.homedir();
}

export function runtimeBreadcrumbPath(env = process.env) {
  return path.join(stateRoot(env), "runtime.json");
}

export async function readRuntimeBreadcrumb(env = process.env, options = {}) {
  const breadcrumbPath = options.breadcrumbPath ?? runtimeBreadcrumbPath(env);
  const readFile = options.readFile ?? fsp.readFile;
  try {
    const raw = await readFile(breadcrumbPath, "utf8");
    return {
      path: breadcrumbPath,
      exists: true,
      breadcrumb: JSON.parse(raw),
      error: null,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { path: breadcrumbPath, exists: false, breadcrumb: null, error: null };
    }
    return {
      path: breadcrumbPath,
      exists: true,
      breadcrumb: null,
      error: {
        name: error.name,
        message: error.message,
        code: error.code ?? null,
      },
    };
  }
}

export function resolveCommandOnPath(command, pathValue = process.env.PATH, cwd = process.cwd()) {
  if (typeof command !== "string" || command.length === 0) return null;
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    const candidate = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    try {
      const stats = fs.statSync(candidate);
      return executableMode(stats) ? candidate : null;
    } catch {
      return null;
    }
  }
  for (const segment of String(pathValue ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(segment, command);
    try {
      const stats = fs.statSync(candidate);
      if (executableMode(stats)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function pathCandidate(options) {
  for (const candidate of options) {
    if (!candidate?.value || typeof candidate.value !== "string") continue;
    return {
      path: path.resolve(candidate.value),
      source: candidate.source,
    };
  }
  return null;
}

export async function runtimeContext(env = process.env, options = {}) {
  const breadcrumbInfo = await readRuntimeBreadcrumb(env, options);
  const breadcrumb = breadcrumbInfo.breadcrumb;
  const loopsHome = stateRoot(env);
  const app = pathCandidate([
    { value: env.COPILOT_LOOPS_APP, source: "env" },
    { value: breadcrumb?.appPath, source: "breadcrumb" },
    { value: path.join(homeDirectory(env), "Applications", "CopilotLoops.app"), source: "default" },
  ]);
  const runtime = pathCandidate([
    { value: env.COPILOT_LOOPS_RUNTIME, source: "env" },
    { value: breadcrumb?.runtimePath, source: "breadcrumb" },
    { value: path.join(loopsHome, "runtime"), source: "default" },
  ]);
  const controlPath = pathCandidate([
    { value: env.COPILOT_LOOPS_CTL, source: "env" },
    { value: breadcrumb?.loopsCtlPath, source: "breadcrumb" },
    {
      value: runtime?.path && fs.existsSync(path.join(runtime.path, "loops-ctl.mjs"))
        ? path.join(runtime.path, "loops-ctl.mjs")
        : SOURCE_CONTROL_PATH,
      source: runtime?.path && fs.existsSync(path.join(runtime.path, "loops-ctl.mjs")) ? "runtime" : "source",
    },
  ]);
  const runnerPath = pathCandidate([
    { value: env.COPILOT_LOOPS_RUNNER, source: "env" },
    { value: breadcrumb?.runnerPath, source: "breadcrumb" },
    {
      value: defaultRunnerPath(env, fs.existsSync),
      source: env.COPILOT_LOOPS_RUNTIME ? "runtime" : (fs.existsSync(defaultRunnerPath(env, fs.existsSync)) && defaultRunnerPath(env, fs.existsSync) !== SOURCE_RUNNER_PATH ? "runtime" : "source"),
    },
  ]);
  const nodePath = pathCandidate([
    { value: env.COPILOT_LOOPS_NODE, source: "env" },
    { value: breadcrumb?.nodePath, source: "breadcrumb" },
    { value: process.execPath, source: "process" },
  ]);
  const helperPath = pathCandidate([
    { value: env.COPILOT_LOOPS_SECRETS_HELPER, source: "env" },
    { value: breadcrumb?.secretsHelperPath, source: "breadcrumb" },
    { value: path.join(app.path, "Contents", "Helpers", "CopilotLoopsSecrets"), source: "default" },
  ]);
  const launchPath = defaultLaunchdPath(env);
  const launchctlCommand = env.COPILOT_LOOPS_LAUNCHCTL || "launchctl";
  return {
    home: homeDirectory(env),
    stateRoot: loopsHome,
    launchPath,
    breadcrumb: breadcrumbInfo,
    app: app ? { ...app } : null,
    runtime: runtime ? { ...runtime } : null,
    control: controlPath ? { ...controlPath } : null,
    runner: runnerPath ? { ...runnerPath } : null,
    node: nodePath ? { ...nodePath } : null,
    helper: helperPath ? { ...helperPath } : null,
    copilot: {
      command: "copilot",
      source: "launchd-path",
      resolvedPath: resolveCommandOnPath("copilot", launchPath),
      pathEnv: launchPath,
    },
    launchctl: {
      command: launchctlCommand,
      source: env.COPILOT_LOOPS_LAUNCHCTL ? "env" : "path",
      resolvedPath: resolveCommandOnPath(launchctlCommand, env.PATH),
    },
  };
}

export async function inspectPath(target, options = {}) {
  const stat = options.stat ?? fsp.stat;
  const readFile = options.readFile ?? fsp.readFile;
  const result = {
    path: target ?? null,
    exists: false,
    kind: null,
    executable: false,
    hash: null,
    error: null,
  };
  if (typeof target !== "string" || target.length === 0) {
    result.error = "missing";
    return result;
  }
  try {
    const stats = await stat(target);
    result.exists = true;
    result.kind = stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other";
    result.executable = result.kind === "file" && executableMode(stats);
    if (options.hash === true && result.kind === "file") {
      const buffer = await readFile(target);
      result.hash = createHash("sha256").update(buffer).digest("hex");
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      result.error = "missing";
      return result;
    }
    result.error = error.message;
    return result;
  }
  if (options.type === "directory" && result.kind !== "directory") {
    result.error = `expected-directory`;
  }
  if (options.type === "file" && result.kind !== "file") {
    result.error = `expected-file`;
  }
  if (options.executable === true && !result.executable) {
    result.error = result.kind !== "file" ? result.error ?? "expected-file" : "not-executable";
  }
  return result;
}

export function labelTarget(label, uid = process.getuid?.()) {
  return `${launchdDomain(uid)}/${label}`;
}

export async function runLaunchctl(args, options = {}) {
  const run = options.run ?? defaultCommandRunner;
  const command = options.launchctlPath ?? options.env?.COPILOT_LOOPS_LAUNCHCTL ?? "launchctl";
  const result = await run(command, args, {
    env: options.env,
    input: options.input,
  });
  if (result.code !== 0 && !options.allowFailure) {
    const detail = (result.stderr || result.stdout || `launchctl ${args[0]} failed`).trim();
    const error = new Error(detail);
    error.code = result.code;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result;
}

export async function isLabelLoaded(label, options = {}) {
  const result = await runLaunchctl(["print", labelTarget(label, options.uid)], {
    ...options,
    allowFailure: true,
  });
  return {
    ...result,
    target: labelTarget(label, options.uid),
    loaded: result.code === 0,
  };
}

export async function setLabelEnabled(label, enabled, options = {}) {
  return await runLaunchctl([enabled ? "enable" : "disable", labelTarget(label, options.uid)], options);
}

export { appLabel };
