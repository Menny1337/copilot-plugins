import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  buildScriptLoop,
  cleanupScratch,
  cleanupScratchRoot,
  runCtl,
  setupCliEnv,
  writeExecutable,
} from "./cli-control-helpers.mjs";

test.after(cleanupScratchRoot);

test("CRUD loop and error handling", async () => {
  const { home, env, binDir } = await setupCliEnv("control-cli");

  try {
    const badJsonRes = runCtl("list", null, env, "{ bad json");
    assert.equal(badJsonRes.ok, false);
    assert.equal(badJsonRes.error.name, "SyntaxError");

    const unknownRes = runCtl("foo-bar-cmd", {}, env);
    assert.equal(unknownRes.ok, false);
    assert.equal(unknownRes.error.name, "UserError");
    assert.equal(unknownRes.error.message, "unknown command: foo-bar-cmd");

    const workingDirectory = path.join(home, "repo");
    const scriptPath = path.join(binDir, "test-loop.sh");
    await fsp.mkdir(workingDirectory, { recursive: true });
    await writeExecutable(scriptPath, "#!/bin/sh\nexit 0\n");

    const loop = buildScriptLoop({
      id: "test-loop",
      scriptPath,
      workingDirectory,
    });
    delete loop.createdAt;
    delete loop.updatedAt;

    const createRes = runCtl("create", { loop }, env);
    assert.equal(createRes.ok, true);
    assert.equal(createRes.data.loop.lifecycle, "needsReview");
    assert.ok(createRes.data.loop.createdAt);
    assert.ok(createRes.data.loop.updatedAt);
    const initialCreatedAt = createRes.data.loop.createdAt;

    const createDupRes = runCtl("create", { loop }, env);
    assert.equal(createDupRes.ok, false);
    assert.equal(createDupRes.error.name, "UserError");

    const corruptDir = path.join(home, "tasks", "bad-loop");
    await fsp.mkdir(corruptDir, { recursive: true });
    await fsp.writeFile(path.join(corruptDir, "loop.json"), "{ invalid }");

    const listRes = runCtl("list", {}, env);
    assert.equal(listRes.ok, true);
    assert.equal(listRes.data.loops.length, 1);
    assert.equal(listRes.data.loops[0].definition.id, "test-loop");
    assert.equal(typeof listRes.data.loops[0].stateSummary.currentFingerprint, "string");
    assert.equal("state" in listRes.data.loops[0], false);
    assert.equal(listRes.data.errors.length, 1);
    assert.equal(listRes.data.errors[0].id, "bad-loop");
    assert.equal(listRes.data.errors[0].code, "syntaxerror");

    const preflight = runCtl("preflight", { id: "test-loop" }, env);
    assert.equal(preflight.ok, true);
    assert.equal(preflight.data.errorDetails.length, 0);

    const approveRes = runCtl("approve", { id: "test-loop", expectedFingerprint: preflight.data.fingerprint }, env);
    assert.equal(approveRes.ok, true);
    assert.equal(approveRes.data.loop.lifecycle, "ready");

    const readyLoop = { ...approveRes.data.loop, name: "Updated name", createdAt: "2000-01-01T00:00:00Z" };
    const updateRes = runCtl("update", { loop: readyLoop }, env);
    assert.equal(updateRes.ok, true);
    assert.equal(updateRes.data.loop.lifecycle, "ready");
    assert.equal(updateRes.data.loop.createdAt, initialCreatedAt);

    const capLoop = structuredClone(updateRes.data.loop);
    capLoop.permissions.allowTools = ["bash"];
    const updateCapRes = runCtl("update", { loop: capLoop }, env);
    assert.equal(updateCapRes.ok, true);
    assert.equal(updateCapRes.data.loop.lifecycle, "needsReview");

    const mutationLockDir = path.join(home, "tasks", "test-loop", ".lock");
    await fsp.mkdir(mutationLockDir, { recursive: true });
    await fsp.writeFile(path.join(mutationLockDir, "pid"), `${process.pid}\n`, "utf8");
    const purgeLockedRes = runCtl("purge", { id: "test-loop", confirm: true }, env);
    assert.equal(purgeLockedRes.ok, false);
    assert.equal(purgeLockedRes.error.name, "UserError");
    await fsp.rm(mutationLockDir, { recursive: true, force: true });

    const purgeRes = runCtl("purge", { id: "test-loop", confirm: true }, env);
    assert.equal(purgeRes.ok, true);
  } finally {
    cleanupScratch(home);
  }
});
