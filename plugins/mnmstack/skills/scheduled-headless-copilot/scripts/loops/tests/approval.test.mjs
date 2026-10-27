import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { approveLoop } from "../lib/approval.mjs";
import {
  buildScriptLoop,
  cleanupScratch,
  cleanupScratchRoot,
  runCtl,
  setupCliEnv,
  scriptLoopFixture,
  writeExecutable,
} from "./cli-control-helpers.mjs";

test.after(cleanupScratchRoot);

test("Approval loop", async () => {
  const { home, env, binDir } = await setupCliEnv("approval-loop");

  try {
    const workingDirectory = path.join(home, "repo");
    const scriptPath = path.join(binDir, "approval-loop.sh");
    await fsp.mkdir(workingDirectory, { recursive: true });
    await writeExecutable(scriptPath, "#!/bin/sh\necho approved\n");

    const loop = buildScriptLoop({
      id: "approval-test",
      scriptPath,
      workingDirectory,
    });
    delete loop.createdAt;
    delete loop.updatedAt;

    const createRes = runCtl("create", { loop }, env);
    assert.equal(createRes.ok, true);

    const preflight = runCtl("preflight", { id: loop.id }, env);
    assert.equal(preflight.ok, true);
    assert.equal(preflight.data.errorDetails.length, 0);

    const approveRes = runCtl("approve", { id: loop.id, expectedFingerprint: preflight.data.fingerprint }, env);
    assert.equal(approveRes.ok, true);
    assert.equal(approveRes.data.loop.lifecycle, "ready");
    assert.ok(approveRes.data.loop.approval.fingerprint);

    const enableRes = runCtl("enable", { id: loop.id }, env);
    assert.equal(enableRes.ok, true);
    assert.equal(enableRes.data.loop.lifecycle, "enabled");

    const loopUpdatedName = { ...approveRes.data.loop, name: "New Name" };
    const updateRes1 = runCtl("update", { loop: loopUpdatedName }, env);
    assert.equal(updateRes1.ok, true);
    assert.equal(updateRes1.data.loop.lifecycle, "enabled");

    const loopUpdatedCap = structuredClone(updateRes1.data.loop);
    loopUpdatedCap.permissions.allowTools = ["bash"];
    const updateRes2 = runCtl("update", { loop: loopUpdatedCap }, env);
    assert.equal(updateRes2.ok, true);
    assert.equal(updateRes2.data.loop.lifecycle, "needsReview");
  } finally {
    cleanupScratch(home);
  }
});

test("approveLoop rejects executable loops that are missing executableHash", () => {
  const loop = scriptLoopFixture({
    id: "approval-executable-hash",
    lifecycle: "draft",
    execution: {
      type: "executable",
      path: process.execPath,
      arguments: ["--version"],
      workingDirectory: path.dirname(process.execPath),
      executableHash: null,
    },
    approval: { fingerprint: null, approvedAt: null },
  });
  assert.throws(
    () => approveLoop(loop),
    /execution\.executableHash/,
  );
});
