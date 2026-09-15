import path from "node:path";
import { UserError } from "./errors.mjs";
import { requireLoopId } from "./paths.mjs";

export const RUN_ID_PATTERN = /^run-\d{14}(?:-\d+)?$/;

function fail(message, context = {}) {
  throw new UserError(message, context);
}

export function ensureObject(value, label = "payload") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`, { label });
  }
  return value;
}

export function exactPayload(value, { required = [], optional = [] } = {}, label = "payload") {
  const payload = ensureObject(value, label);
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(payload).filter((key) => !allowed.has(key)).sort();
  if (unexpected.length > 0) {
    fail(`${label} contains unsupported properties: ${unexpected.join(", ")}`, {
      label,
      unexpected,
    });
  }
  const missing = required.filter((key) => !Object.hasOwn(payload, key));
  if (missing.length > 0) {
    fail(`${label} is missing required properties: ${missing.join(", ")}`, {
      label,
      missing,
    });
  }
  return payload;
}

export function assertNoPayload(value, label = "payload") {
  return exactPayload(value, { required: [], optional: [] }, label);
}

export function requireString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    fail(`${label} must be a string`, { label, valueType: typeof value });
  }
  if (!allowEmpty && value.length === 0) {
    fail(`${label} must be a non-empty string`, { label });
  }
  if (value.includes("\0")) {
    fail(`${label} must not contain NUL bytes`, { label });
  }
  return value;
}

export function optionalString(value, label, options) {
  if (value === undefined) return undefined;
  return requireString(value, label, options);
}

export function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    fail(`${label} must be a boolean`, { label, valueType: typeof value });
  }
  return value;
}

export function optionalBoolean(value, label) {
  if (value === undefined) return undefined;
  return requireBoolean(value, label);
}

export function requireInteger(value, label, { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer in [${minimum}, ${maximum}]`, {
      label,
      minimum,
      maximum,
      value,
    });
  }
  return value;
}

export function optionalInteger(value, label, options) {
  if (value === undefined) return undefined;
  return requireInteger(value, label, options);
}

export function requireLoopIdValue(value, label = "id") {
  try {
    return requireLoopId(requireString(value, label));
  } catch (error) {
    fail(`${label} must be a safe kebab-case loop id`, {
      label,
      value,
      cause: error.message,
    });
  }
}

export function requireRunIdValue(value, label = "runId") {
  const runId = requireString(value, label);
  if (!RUN_ID_PATTERN.test(runId)) {
    fail(`${label} must match run-YYYYMMDDHHMMSS with an optional numeric suffix`, {
      label,
      value,
    });
  }
  return runId;
}

export function requireAbsolutePath(value, label) {
  const pathValue = requireString(value, label);
  if (!path.isAbsolute(pathValue)) {
    fail(`${label} must be an absolute path`, { label, value: pathValue });
  }
  return pathValue;
}

export function optionalAbsolutePath(value, label) {
  if (value === undefined) return undefined;
  return requireAbsolutePath(value, label);
}

export function requireStringArray(value, label, { unique = true, absolute = false } = {}) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array of strings`, { label, valueType: typeof value });
  }
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const itemLabel = `${label}[${index}]`;
    const item = absolute ? requireAbsolutePath(value[index], itemLabel) : requireString(value[index], itemLabel);
    result.push(item);
  }
  if (unique) {
    const duplicates = [...new Set(result.filter((item, index) => result.indexOf(item) !== index))].sort();
    if (duplicates.length > 0) {
      fail(`${label} must not contain duplicates`, { label, duplicates });
    }
  }
  return result;
}

export function optionalStringArray(value, label, options) {
  if (value === undefined) return undefined;
  return requireStringArray(value, label, options);
}
