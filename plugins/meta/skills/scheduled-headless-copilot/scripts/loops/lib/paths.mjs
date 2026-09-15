import path from "node:path";
import { LOOP_ID_PATTERN } from "./contracts.mjs";
import { loadIdentity, stateRoot } from "./identity.mjs";

export { stateRoot };

export function requireLoopId(value) {
  if (!LOOP_ID_PATTERN.test(value ?? "")) {
    throw new TypeError("loop id must be safe kebab-case");
  }
  return value;
}

export function loopDirectory(id, env = process.env) {
  return path.join(stateRoot(env), "tasks", requireLoopId(id));
}

export function loopManifestPath(id, env = process.env) {
  return path.join(loopDirectory(id, env), "loop.json");
}

export function appLabel(env = process.env) {
  return loadIdentity(env).appLabel;
}

export function taskLabelPrefix(env = process.env) {
  return loadIdentity(env).taskLabelPrefix;
}

export function taskLabel(id, env = process.env) {
  return taskLabelPrefix(env) + requireLoopId(id);
}
