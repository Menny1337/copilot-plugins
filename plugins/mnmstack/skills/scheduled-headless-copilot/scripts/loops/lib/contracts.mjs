import { createHash } from "node:crypto";
import path from "node:path";

export const LOOP_SCHEMA_VERSION = 1;
export const LOOP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LOOP_KINDS = new Set(["copilot", "script"]);
export const LOOP_LIFECYCLES = new Set([
  "draft",
  "needsReview",
  "ready",
  "enabled",
  "paused",
  "archived",
]);
export const SCHEDULE_KINDS = new Set(["manual", "once", "calendar", "interval"]);
export const EXECUTION_TYPES = new Set(["copilot", "scriptFile", "executable"]);
export const RUN_TRIGGERS = new Set(["schedule", "manual", "retry"]);
export const RUN_STATUSES = new Set([
  "starting",
  "running",
  "stopping",
  "succeeded",
  "failed",
  "timedOut",
  "cancelled",
  "skippedOverlap",
  "skippedMissed",
  "skippedPaused",
  "approvalBlocked",
  "launchFailed",
]);

const LOOP_KEYS = [
  "schemaVersion",
  "id",
  "name",
  "kind",
  "lifecycle",
  "schedule",
  "execution",
  "permissions",
  "environment",
  "timeoutSeconds",
  "retry",
  "overlapPolicy",
  "notifications",
  "retention",
  "approval",
  "createdAt",
  "updatedAt",
];
const RUN_KEYS = [
  "schemaVersion",
  "id",
  "loopId",
  "sessionId",
  "trigger",
  "status",
  "scheduledFor",
  "startedAt",
  "endedAt",
  "exitCode",
  "signal",
  "retryOf",
  "attempts",
];

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireNullableString(value, label) {
  if (value === null) return value;
  return requireString(value, label);
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
}

function requireInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer in [${minimum},${maximum}]`);
  }
  return value;
}

function requireDateTime(value, label, nullable = false) {
  if (nullable && value === null) return value;
  requireString(value, label);
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`${label} must be an ISO date-time`);
  return value;
}

function requireAbsolutePath(value, label) {
  requireString(value, label);
  if (!path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute path`);
  return value;
}

function requireStringArray(value, label, options = {}) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of strings`);
  }
  value.forEach((item, index) => {
    requireString(item, `${label}[${index}]`);
    if (options.absolutePaths) requireAbsolutePath(item, `${label}[${index}]`);
  });
  if (options.unique && new Set(value).size !== value.length) {
    throw new TypeError(`${label} must not contain duplicates`);
  }
  return value;
}

function requireExactKeys(value, required, optional, label) {
  const object = requireObject(value, label);
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(object).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new TypeError(`${label} contains unsupported properties: ${unexpected.sort().join(", ")}`);
  }
  const missing = required.filter((key) => !Object.hasOwn(object, key));
  if (missing.length) {
    throw new TypeError(`${label} is missing required properties: ${missing.join(", ")}`);
  }
  return object;
}

function validateSchedule(schedule) {
  requireObject(schedule, "schedule");
  if (!SCHEDULE_KINDS.has(schedule.kind)) {
    throw new TypeError(`unsupported schedule kind: ${schedule.kind}`);
  }
  switch (schedule.kind) {
    case "manual":
      requireExactKeys(schedule, ["kind"], [], "schedule");
      break;
    case "once":
      requireExactKeys(schedule, ["kind", "scheduledAt", "graceSeconds"], [], "schedule");
      requireDateTime(schedule.scheduledAt, "schedule.scheduledAt");
      if (
        new Date(schedule.scheduledAt).getUTCSeconds() !== 0 ||
        new Date(schedule.scheduledAt).getUTCMilliseconds() !== 0
      ) {
        throw new TypeError("schedule.scheduledAt must use minute precision");
      }
      requireInteger(schedule.graceSeconds, "schedule.graceSeconds", 0, 3600);
      break;
    case "calendar":
      requireExactKeys(
        schedule,
        ["kind", "hour", "minute", "weekdays", "graceSeconds"],
        [],
        "schedule",
      );
      requireInteger(schedule.hour, "schedule.hour", 0, 23);
      requireInteger(schedule.minute, "schedule.minute", 0, 59);
      if (!Array.isArray(schedule.weekdays)) {
        throw new TypeError("schedule.weekdays must be an array");
      }
      schedule.weekdays.forEach((day, index) =>
        requireInteger(day, `schedule.weekdays[${index}]`, 0, 6),
      );
      if (new Set(schedule.weekdays).size !== schedule.weekdays.length) {
        throw new TypeError("schedule.weekdays must not contain duplicates");
      }
      requireInteger(schedule.graceSeconds, "schedule.graceSeconds", 0, 3600);
      break;
    case "interval":
      requireExactKeys(schedule, ["kind", "seconds", "graceSeconds"], [], "schedule");
      requireInteger(schedule.seconds, "schedule.seconds", 60, 31_536_000);
      requireInteger(schedule.graceSeconds, "schedule.graceSeconds", 0, 3600);
      break;
  }
}

function validateExecution(kind, execution) {
  requireObject(execution, "execution");
  if (!EXECUTION_TYPES.has(execution.type)) {
    throw new TypeError(`unsupported execution type: ${execution.type}`);
  }
  if (kind === "copilot" && execution.type !== "copilot") {
    throw new TypeError("copilot loops require copilot execution");
  }
  if (kind === "script" && execution.type === "copilot") {
    throw new TypeError("script loops require scriptFile or executable execution");
  }
  if (execution.type === "copilot") {
    requireExactKeys(
      execution,
      ["type", "prompt", "model", "workingDirectory", "extraPaths", "localPluginDirectories"],
      ["installedPlugin", "agent", "skill"],
      "execution",
    );
    requireString(execution.prompt, "execution.prompt");
    requireString(execution.model, "execution.model");
    requireAbsolutePath(execution.workingDirectory, "execution.workingDirectory");
    requireStringArray(execution.extraPaths, "execution.extraPaths", {
      absolutePaths: true,
      unique: true,
    });
    requireStringArray(execution.localPluginDirectories, "execution.localPluginDirectories", {
      absolutePaths: true,
      unique: true,
    });
    for (const key of ["installedPlugin", "agent", "skill"]) {
      if (Object.hasOwn(execution, key)) requireNullableString(execution[key], `execution.${key}`);
    }
  } else {
    const hashKey = execution.type === "scriptFile" ? "contentHash" : "executableHash";
    requireExactKeys(
      execution,
      ["type", "path", "arguments", "workingDirectory", hashKey],
      [],
      "execution",
    );
    requireAbsolutePath(execution.path, "execution.path");
    requireAbsolutePath(execution.workingDirectory, "execution.workingDirectory");
    requireStringArray(execution.arguments, "execution.arguments");
    const hash = execution[hashKey];
    if (execution.type === "scriptFile" && (typeof hash !== "string" || !SHA256_PATTERN.test(hash))) {
      throw new TypeError("execution.contentHash must be a SHA-256 hex string");
    }
    if (
      execution.type === "executable" &&
      hash !== null &&
      (typeof hash !== "string" || !SHA256_PATTERN.test(hash))
    ) {
      throw new TypeError("execution hash must be null or a SHA-256 hex string");
    }
  }
}

function validatePermissions(permissions) {
  requireExactKeys(
    permissions,
    ["profile", "allowAll", "allowTools", "denyTools", "allowUrls", "denyUrls"],
    [],
    "permissions",
  );
  if (!["fullAutonomy", "custom"].includes(permissions.profile)) {
    throw new TypeError(`unsupported permissions profile: ${permissions.profile}`);
  }
  requireBoolean(permissions.allowAll, "permissions.allowAll");
  for (const key of ["allowTools", "denyTools", "allowUrls", "denyUrls"]) {
    requireStringArray(permissions[key], `permissions.${key}`, { unique: true });
  }
  if (permissions.profile === "fullAutonomy" && !permissions.allowAll) {
    throw new TypeError("fullAutonomy permissions require allowAll");
  }
  if (permissions.profile === "custom" && permissions.allowAll) {
    throw new TypeError("custom permissions cannot set allowAll");
  }
}

function validateEnvironment(environment) {
  requireExactKeys(environment, ["plain", "secretNames"], [], "environment");
  const plain = requireObject(environment.plain, "environment.plain");
  for (const [name, value] of Object.entries(plain)) {
    if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
      throw new TypeError(`invalid environment variable name: ${name}`);
    }
    if (typeof value !== "string" || value.includes("\0")) {
      throw new TypeError(`environment.plain.${name} must be a string`);
    }
  }
  requireStringArray(environment.secretNames, "environment.secretNames", { unique: true });
  for (const name of environment.secretNames) {
    if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
      throw new TypeError(`invalid secret environment variable name: ${name}`);
    }
    if (Object.hasOwn(plain, name)) {
      throw new TypeError(`environment variable cannot be both plain and secret: ${name}`);
    }
  }
}

function validateRuntimePolicy(loop) {
  requireInteger(loop.timeoutSeconds, "timeoutSeconds", 0, 604_800);
  requireExactKeys(loop.retry, ["maxRetries", "backoffSeconds"], [], "retry");
  requireInteger(loop.retry.maxRetries, "retry.maxRetries", 0, 5);
  requireInteger(loop.retry.backoffSeconds, "retry.backoffSeconds", 0, 86_400);
  if (loop.overlapPolicy !== "skip") throw new TypeError("v1 overlapPolicy must be skip");

  requireExactKeys(loop.notifications, ["onFailure", "onSuccess"], [], "notifications");
  requireBoolean(loop.notifications.onFailure, "notifications.onFailure");
  requireBoolean(loop.notifications.onSuccess, "notifications.onSuccess");

  requireExactKeys(loop.retention, ["days", "maxRuns"], [], "retention");
  requireInteger(loop.retention.days, "retention.days", 1, 3650);
  requireInteger(loop.retention.maxRuns, "retention.maxRuns", 1, 10_000);
}

function validateApproval(loop) {
  requireExactKeys(loop.approval, ["fingerprint", "approvedAt"], [], "approval");
  const fingerprint = loop.approval.fingerprint;
  if (fingerprint !== null && (typeof fingerprint !== "string" || !SHA256_PATTERN.test(fingerprint))) {
    throw new TypeError("approval.fingerprint must be null or a SHA-256 hex string");
  }
  requireDateTime(loop.approval.approvedAt, "approval.approvedAt", true);
  if ((fingerprint === null) !== (loop.approval.approvedAt === null)) {
    throw new TypeError("approval fingerprint and timestamp must both be set or both be null");
  }
  if (["ready", "enabled", "paused"].includes(loop.lifecycle) && fingerprint === null) {
    throw new TypeError(`${loop.lifecycle} loops require approval`);
  }
  if (["draft", "needsReview"].includes(loop.lifecycle) && fingerprint !== null) {
    throw new TypeError(`${loop.lifecycle} loops cannot retain approval`);
  }
}

export function validateLoopDefinition(value) {
  const loop = requireExactKeys(value, LOOP_KEYS, [], "loop");
  if (loop.schemaVersion !== LOOP_SCHEMA_VERSION) {
    throw new TypeError(`unsupported schemaVersion: ${loop.schemaVersion}`);
  }
  if (!LOOP_ID_PATTERN.test(loop.id ?? "")) {
    throw new TypeError("loop.id must be a safe kebab-case identifier");
  }
  requireString(loop.name, "loop.name");
  if (loop.name.length > 120) throw new TypeError("loop.name must be at most 120 characters");
  if (!LOOP_KINDS.has(loop.kind)) throw new TypeError(`unsupported loop kind: ${loop.kind}`);
  if (!LOOP_LIFECYCLES.has(loop.lifecycle)) {
    throw new TypeError(`unsupported lifecycle: ${loop.lifecycle}`);
  }
  validateSchedule(loop.schedule);
  validateExecution(loop.kind, loop.execution);
  validatePermissions(loop.permissions);
  validateEnvironment(loop.environment);
  validateRuntimePolicy(loop);
  validateApproval(loop);
  requireDateTime(loop.createdAt, "createdAt");
  requireDateTime(loop.updatedAt, "updatedAt");
  if (Date.parse(loop.updatedAt) < Date.parse(loop.createdAt)) {
    throw new TypeError("updatedAt cannot precede createdAt");
  }
  return loop;
}

export function validateRunRecord(value) {
  const run = requireExactKeys(value, RUN_KEYS, [], "run");
  if (run.schemaVersion !== LOOP_SCHEMA_VERSION) {
    throw new TypeError(`unsupported run schemaVersion: ${run.schemaVersion}`);
  }
  requireString(run.id, "run.id");
  if (!LOOP_ID_PATTERN.test(run.loopId ?? "")) {
    throw new TypeError("run.loopId must be a safe kebab-case identifier");
  }
  if (typeof run.sessionId !== "string" || !UUID_PATTERN.test(run.sessionId)) {
    throw new TypeError("run.sessionId must be a UUID");
  }
  if (!RUN_TRIGGERS.has(run.trigger)) throw new TypeError(`unsupported run trigger: ${run.trigger}`);
  if (!RUN_STATUSES.has(run.status)) throw new TypeError(`unsupported run status: ${run.status}`);
  requireDateTime(run.scheduledFor, "run.scheduledFor", true);
  requireDateTime(run.startedAt, "run.startedAt", true);
  requireDateTime(run.endedAt, "run.endedAt", true);
  if (run.exitCode !== null && !Number.isInteger(run.exitCode)) {
    throw new TypeError("run.exitCode must be null or an integer");
  }
  requireNullableString(run.signal, "run.signal");
  requireNullableString(run.retryOf, "run.retryOf");
  if (!Array.isArray(run.attempts)) throw new TypeError("run.attempts must be an array");
  const numbers = new Set();
  run.attempts.forEach((attempt, index) => {
    requireExactKeys(
      attempt,
      ["number", "startedAt", "endedAt", "exitCode", "signal"],
      [],
      `run.attempts[${index}]`,
    );
    requireInteger(attempt.number, `run.attempts[${index}].number`, 1, 6);
    if (numbers.has(attempt.number)) throw new TypeError("run attempt numbers must be unique");
    numbers.add(attempt.number);
    requireDateTime(attempt.startedAt, `run.attempts[${index}].startedAt`);
    requireDateTime(attempt.endedAt, `run.attempts[${index}].endedAt`, true);
    if (attempt.exitCode !== null && !Number.isInteger(attempt.exitCode)) {
      throw new TypeError(`run.attempts[${index}].exitCode must be null or an integer`);
    }
    requireNullableString(attempt.signal, `run.attempts[${index}].signal`);
  });
  return run;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function sortedUnique(values) {
  return [...new Set(values ?? [])].sort();
}

export function capabilityProjection(loop) {
  validateLoopDefinition(loop);
  const execution = structuredClone(loop.execution);
  if (execution.type === "copilot") {
    execution.extraPaths = sortedUnique(execution.extraPaths);
    execution.localPluginDirectories = sortedUnique(execution.localPluginDirectories);
  }
  const permissions = structuredClone(loop.permissions);
  for (const key of ["allowTools", "denyTools", "allowUrls", "denyUrls"]) {
    permissions[key] = sortedUnique(permissions[key]);
  }
  return canonicalize({
    kind: loop.kind,
    execution,
    permissions,
    environment: {
      plain: loop.environment.plain,
      secretNames: sortedUnique(loop.environment.secretNames),
    },
    timeoutSeconds: loop.timeoutSeconds,
    retry: loop.retry,
  });
}

export function capabilityFingerprint(loop) {
  const body = JSON.stringify(capabilityProjection(loop));
  return createHash("sha256").update(body).digest("hex");
}
