import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLoopDefinition } from "./contracts.mjs";
import { stateRoot, taskLabel } from "./paths.mjs";
import { launchdStartSpec } from "./schedule.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_LAUNCHD_PATH_PREFIX =
  "/opt/homebrew/bin:/usr/local/bin:/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin";
export const INSTALLED_RUNNER_PATH = path.resolve(here, "../loops-runner.mjs");
export const SOURCE_RUNNER_PATH = path.resolve(here, "../../loops-runner.mjs");
export const TASK_PLIST_TEMPLATE_PATH = path.resolve(
  here,
  "../templates/copilot-loops.task.plist.in",
);

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || !path.isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return path.normalize(value);
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderStringArray(values, indent = "\t\t") {
  return values.map((value) => `${indent}<string>${xmlEscape(value)}</string>`).join("\n");
}

function renderCalendarEntry(entry, indent = "\t") {
  const order = ["Month", "Day", "Weekday", "Hour", "Minute"];
  const lines = [`${indent}<dict>`];
  for (const key of order) {
    if (!Number.isInteger(entry[key])) continue;
    lines.push(`${indent}\t<key>${key}</key>`);
    lines.push(`${indent}\t<integer>${entry[key]}</integer>`);
  }
  lines.push(`${indent}</dict>`);
  return lines.join("\n");
}

function renderScheduleBlock(schedule) {
  const startSpec = launchdStartSpec(schedule);
  if (!startSpec) return "";
  if (startSpec.key === "StartInterval") {
    return `\t<key>StartInterval</key>\n\t<integer>${startSpec.value}</integer>\n`;
  }
  const value = Array.isArray(startSpec.value)
    ? `\t<array>\n${startSpec.value.map((entry) => renderCalendarEntry(entry, "\t\t")).join("\n")}\n\t</array>`
    : renderCalendarEntry(startSpec.value, "\t");
  return `\t<key>StartCalendarInterval</key>\n${value}\n`;
}

function template() {
  return readFileSync(TASK_PLIST_TEMPLATE_PATH, "utf8");
}

export function defaultLaunchdPath(env = process.env) {
  return env.PATH ? `${DEFAULT_LAUNCHD_PATH_PREFIX}:${env.PATH}` : DEFAULT_LAUNCHD_PATH_PREFIX;
}

function homePath(env = process.env) {
  return requireAbsolutePath(env.HOME ?? os.homedir(), "homePath");
}

function loopsHomePath(env = process.env) {
  return requireAbsolutePath(stateRoot(env), "loopsHomePath");
}

function defaultSecretsHelperPath(env = process.env) {
  return path.join(homePath(env), "Applications", "CopilotLoops.app", "Contents", "Helpers", "CopilotLoopsSecrets");
}

function secretsHelperPath(value, env = process.env) {
  return requireAbsolutePath(value ?? defaultSecretsHelperPath(env), "secretsHelperPath");
}

export function defaultRunnerPath(env = process.env, pathExists = existsSync) {
  if (env.COPILOT_LOOPS_RUNTIME) {
    return path.join(requireAbsolutePath(env.COPILOT_LOOPS_RUNTIME, "runtimeRoot"), "loops-runner.mjs");
  }
  if (pathExists(INSTALLED_RUNNER_PATH)) {
    return INSTALLED_RUNNER_PATH;
  }
  return SOURCE_RUNNER_PATH;
}

export function resolveRunnerPath(value, env = process.env, pathExists = existsSync) {
  return requireAbsolutePath(value ?? defaultRunnerPath(env, pathExists), "runnerPath");
}

export function resolveNodePath(value = process.execPath) {
  return requireAbsolutePath(value, "nodePath");
}

export function renderTaskPlist(loopDefinition, options = {}) {
  const loop = validateLoopDefinition(loopDefinition);
  const label = options.label ?? taskLabel(loop.id, options.env);
  const nodePath = resolveNodePath(options.nodePath);
  const runnerPath = resolveRunnerPath(options.runnerPath, options.env, options.pathExists);
  const stdoutPath = requireAbsolutePath(options.stdoutPath, "stdoutPath");
  const stderrPath = requireAbsolutePath(options.stderrPath, "stderrPath");
  const launchPath = options.launchPath ?? defaultLaunchdPath(options.env);
  const resolvedHomePath = requireAbsolutePath(options.homePath ?? homePath(options.env), "homePath");
  const resolvedLoopsHomePath = requireAbsolutePath(
    options.loopsHomePath ?? loopsHomePath(options.env),
    "loopsHomePath",
  );
  const resolvedSecretsHelperPath = secretsHelperPath(
    options.secretsHelperPath ?? options.env?.COPILOT_LOOPS_SECRETS_HELPER,
    options.env,
  );
  const programArguments = [nodePath, runnerPath, loop.id];
  const xml = template()
    .replaceAll("@LABEL@", xmlEscape(label))
    .replaceAll("@PROGRAM_ARGUMENTS@", renderStringArray(programArguments))
    .replaceAll("@SCHEDULE_BLOCK@", renderScheduleBlock(loop.schedule))
    .replaceAll("@PATH@", xmlEscape(launchPath))
    .replaceAll("@HOME@", xmlEscape(resolvedHomePath))
    .replaceAll("@COPILOT_LOOPS_HOME@", xmlEscape(resolvedLoopsHomePath))
    .replaceAll("@COPILOT_LOOPS_SECRETS_HELPER@", xmlEscape(resolvedSecretsHelperPath))
    .replaceAll("@STDOUT_PATH@", xmlEscape(stdoutPath))
    .replaceAll("@STDERR_PATH@", xmlEscape(stderrPath));
  return {
    label,
    xml,
    programArguments,
    runnerPath,
    nodePath,
    stdoutPath,
    stderrPath,
    launchPath,
    homePath: resolvedHomePath,
    loopsHomePath: resolvedLoopsHomePath,
    secretsHelperPath: resolvedSecretsHelperPath,
  };
}

export async function defaultCommandRunner(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code: code ?? 0, signal: signal ?? null, stdout, stderr });
    });
    child.stdin.end(options.input ?? "");
  });
}

export async function validatePlistXml(xml, options = {}) {
  const run = options.run ?? defaultCommandRunner;
  const plutilPath = options.plutilPath ?? "plutil";
  const result = await run(plutilPath, ["-lint", "-"], {
    env: options.env,
    input: xml,
  });
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "plutil validation failed").trim();
    const error = new Error(detail);
    error.code = result.code;
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result;
}
