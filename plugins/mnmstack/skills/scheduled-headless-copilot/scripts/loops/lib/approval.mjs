import fsp from "node:fs/promises";
import path from "node:path";
import { loopDirectory } from "./paths.mjs";
import { capabilityFingerprint, SHA256_PATTERN } from "./contracts.mjs";

export async function blockApproval(id, env = process.env) {
  const dir = loopDirectory(id, env);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "approval.blocked"), "Needs review\n", "utf-8");
}

export async function unblockApproval(id, env = process.env) {
  const dir = loopDirectory(id, env);
  try {
    await fsp.rm(path.join(dir, "approval.blocked"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

export function prepareForReview(loop) {
  const cloned = structuredClone(loop);
  cloned.lifecycle = "needsReview";
  cloned.approval = { fingerprint: null, approvedAt: null };
  return cloned;
}

export function approveLoop(loop) {
  const cloned = structuredClone(loop);
  if (
    cloned.execution?.type === "executable" &&
    (typeof cloned.execution.executableHash !== "string" || !SHA256_PATTERN.test(cloned.execution.executableHash))
  ) {
    throw new TypeError("executable approvals require execution.executableHash to be a SHA-256 hex string");
  }
  const fingerprint = capabilityFingerprint(cloned);
  cloned.approval = {
    fingerprint,
    approvedAt: new Date().toISOString(),
  };
  cloned.lifecycle = "ready";
  return cloned;
}
