// runner-command.mjs — build the argv vector (never a shell string) for one run attempt.
//
// Supports the three execution types from contracts/loop.schema.json's `execution` union:
//   - "copilot":              launch headless Copilot with the full hardened flag set
//   - "scriptFile"/"executable": spawn the manifest's path + arguments directly
//
// The command builder never returns a shell string — callers pass `{ command, args }`
// straight to child_process.spawn(..., { shell: false }) (see ./process-tree.mjs). Secret
// *values* only ever flow through the returned `env` map; only secret *names* ever appear
// in `args` (via --secret-env-vars) so nothing sensitive is ever safe to log from `args`.

import path from "node:path";
import { createHash } from "node:crypto";
import { stat, readFile } from "node:fs/promises";

function permissionArgs(permissions) {
  const args = [];
  if (permissions.allowAll) args.push("--allow-all-tools");
  for (const tool of permissions.allowTools ?? []) args.push(`--allow-tool=${tool}`);
  for (const tool of permissions.denyTools ?? []) args.push(`--deny-tool=${tool}`);
  for (const url of permissions.allowUrls ?? []) args.push(`--allow-url=${url}`);
  for (const url of permissions.denyUrls ?? []) args.push(`--deny-url=${url}`);
  return args;
}

/** Prefix the configured prompt with a thin skill-invocation instruction when the manifest
 * names a skill, keeping the manifest prompt itself free of boilerplate. */
export function buildPrompt(execution) {
  const prefix = execution.skill ? `Use the "${execution.skill}" skill. ` : "";
  return `${prefix}${execution.prompt}`;
}

function buildCopilotArgs({ loop, run, sessionId, copilotArgs = [] }) {
  const execution = loop.execution;
  const args = [
    "-p",
    buildPrompt(execution),
    "-C",
    execution.workingDirectory,
    "--autopilot",
    ...permissionArgs(loop.permissions),
    "--no-ask-user",
    "--no-auto-update",
    "--no-color",
    "--output-format",
    "json",
    "--log-dir",
    run.cliLogsDir,
    "--session-id",
    sessionId,
  ];

  for (const dir of execution.extraPaths ?? []) args.push("--add-dir", dir);
  for (const dir of execution.localPluginDirectories ?? []) args.push("--plugin-dir", dir);
  if (execution.model) args.push("--model", execution.model);
  if (execution.agent) args.push("--agent", execution.agent);

  const secretNames = loop.environment?.secretNames ?? [];
  if (secretNames.length > 0) args.push(`--secret-env-vars=${secretNames.join(",")}`);

  args.push(...copilotArgs); // caller-supplied extras (tests inject these last, never override safety flags)
  return args;
}

function buildDirectArgs({ loop }) {
  const execution = loop.execution;
  return { command: execution.path, args: [...(execution.arguments ?? [])] };
}

/**
 * Assemble the environment for a run attempt: base env (defaults to `process.env`), a
 * defensively-prepended PATH, the manifest's plain vars, then resolved secret values last
 * (so a plain var can never accidentally shadow a secret). Throws if a declared secret name
 * has no resolved value — fail closed rather than launch with a silently-missing credential.
 */
export function buildEnv({ loop, secretValues = {}, baseEnv = process.env, pathPrepend = [] }) {
  const env = { ...baseEnv };
  if (pathPrepend.length > 0) {
    env.PATH = [...pathPrepend, baseEnv.PATH].filter(Boolean).join(path.delimiter);
  }
  Object.assign(env, loop.environment?.plain ?? {});
  for (const name of loop.environment?.secretNames ?? []) {
    if (!Object.prototype.hasOwnProperty.call(secretValues, name)) {
      throw new Error(`missing resolved value for declared secret: ${name}`);
    }
    env[name] = secretValues[name];
  }
  return env;
}

/**
 * Build `{ command, args, cwd, env }` for one attempt of `loop`.
 *
 * `run` = `{ cliLogsDir }` — the per-run directory to hand Copilot as `--log-dir`.
 * `sessionId` — stable id passed as `--session-id` for the copilot execution type
 *   (defaults to run.id via the caller; kept as an explicit param so retries can choose to
 *   resume the same session or mint a fresh one).
 * `copilotBinary` — DI seam so tests point at a fake script instead of the real `copilot`.
 * `secretValues` / `baseEnv` / `pathPrepend` — see `buildEnv`.
 */
export function buildCommand({
  loop,
  run,
  sessionId,
  copilotBinary = "copilot",
  copilotArgs = [],
  secretValues = {},
  baseEnv = process.env,
  pathPrepend = [],
}) {
  const execution = loop.execution;
  const env = buildEnv({ loop, secretValues, baseEnv, pathPrepend });

  if (execution.type === "copilot") {
    return {
      command: copilotBinary,
      args: buildCopilotArgs({ loop, run, sessionId, copilotArgs }),
      cwd: execution.workingDirectory,
      env,
    };
  }

  if (execution.type === "scriptFile" || execution.type === "executable") {
    const { command, args } = buildDirectArgs({ loop });
    return { command, args, cwd: execution.workingDirectory, env };
  }

  throw new TypeError(`unsupported execution type: ${execution.type}`);
}

const SHEBANG = "#!";

/**
 * Verify a `scriptFile`/`executable` execution's on-disk file matches what was approved,
 * right before spawning it: must be a regular, executable file, and its SHA-256 must match
 * the manifest's `contentHash`/`executableHash`. `scriptFile` additionally requires a
 * shebang line, since it is executed directly by the OS rather than via an interpreter argv.
 *
 * A hash is REQUIRED for both execution types — `executableHash: null` is schema-legal (the
 * canonical loop schema/validator still permit it), but this runtime gate treats a missing
 * hash as an integrity failure rather than "nothing to verify, allow it": a null hash is
 * exactly what would let a binary be swapped out after approval and still run unreviewed.
 * Converging on fail-closed here — in the one place that runs immediately before every
 * spawn — closes that gap without weakening (or needing to touch) the shared schema.
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }` where `reason` is a short, redacted code
 * — never a file path, hash, or file content — safe to persist into an event/run record.
 * Trivially `{ ok: true }` for the `copilot` execution type (no user-supplied path/hash).
 */
export async function verifyExecutableIntegrity(execution) {
  if (execution.type !== "scriptFile" && execution.type !== "executable") {
    return { ok: true };
  }

  let fileStat;
  try {
    fileStat = await stat(execution.path);
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (!fileStat.isFile()) {
    return { ok: false, reason: "not-a-regular-file" };
  }
  if ((fileStat.mode & 0o111) === 0) {
    return { ok: false, reason: "not-executable" };
  }

  const hashField = execution.type === "scriptFile" ? execution.contentHash : execution.executableHash;
  if (hashField === null) {
    return { ok: false, reason: "missing-hash" };
  }

  let buffer;
  try {
    buffer = await readFile(execution.path);
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  if (execution.type === "scriptFile" && buffer.subarray(0, 2).toString("utf8") !== SHEBANG) {
    return { ok: false, reason: "missing-shebang" };
  }

  const digest = createHash("sha256").update(buffer).digest("hex");
  if (digest !== hashField) {
    return { ok: false, reason: "hash-mismatch" };
  }

  return { ok: true };
}
