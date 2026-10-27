import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { deleteLoop, readLoop, writeLoop } from "../lib/store.mjs";
import { buildScriptLoop, writeExecutable } from "./cli-control-helpers.mjs";
import { cleanupScratch, cleanupScratchRoot, makeScratchEnv } from "./runtime-helpers.mjs";

test.after(cleanupScratchRoot);

async function makeLoopFixture(home, id = "store-loop") {
  const workingDirectory = path.join(home, "repo");
  const scriptPath = path.join(home, "bin", `${id}.sh`);
  await fsp.mkdir(workingDirectory, { recursive: true });
  await writeExecutable(scriptPath, "#!/bin/sh\nexit 0\n");
  const loop = buildScriptLoop({ id, scriptPath, workingDirectory });
  return { loop, scriptPath, workingDirectory };
}

test("writeLoop reclaims stale legacy mutation locks and persists loop.json as 0600", async () => {
  const { home, env } = makeScratchEnv("store-write");
  try {
    const { loop } = await makeLoopFixture(home, "store-write-lock");
    const loopDir = path.join(home, "tasks", loop.id);
    const staleLockDir = path.join(loopDir, ".lock");
    await fsp.mkdir(staleLockDir, { recursive: true });
    await fsp.writeFile(path.join(staleLockDir, "pid"), "999999\n", "utf8");

    await writeLoop(loop, env);

    const manifestPath = path.join(loopDir, "loop.json");
    const stored = await readLoop(loop.id, env);
    assert.equal(stored.id, loop.id);
    assert.equal(fs.existsSync(staleLockDir), false);
    assert.equal((await fsp.stat(manifestPath)).mode & 0o777, 0o600);
  } finally {
    cleanupScratch(home);
  }
});

test("deleteLoop reclaims stale legacy mutation locks and removes the loop directory", async () => {
  const { home, env } = makeScratchEnv("store-delete-stale");
  try {
    const { loop } = await makeLoopFixture(home, "store-delete-stale");
    await writeLoop(loop, env);
    const loopDir = path.join(home, "tasks", loop.id);
    const staleLockDir = path.join(loopDir, ".lock");
    await fsp.mkdir(staleLockDir, { recursive: true });
    await fsp.writeFile(path.join(staleLockDir, "pid"), "999999\n", "utf8");

    await deleteLoop(loop.id, env);

    assert.equal(fs.existsSync(loopDir), false);
  } finally {
    cleanupScratch(home);
  }
});

test("deleteLoop fails closed when a live mutation lock owner is present", async () => {
  const { home, env } = makeScratchEnv("store-delete-live");
  try {
    const { loop } = await makeLoopFixture(home, "store-delete-live");
    await writeLoop(loop, env);
    const loopDir = path.join(home, "tasks", loop.id);
    const liveLockDir = path.join(loopDir, ".lock");
    await fsp.mkdir(liveLockDir, { recursive: true });
    await fsp.writeFile(path.join(liveLockDir, "pid"), `${process.pid}\n`, "utf8");

    await assert.rejects(
      () => deleteLoop(loop.id, env),
      (error) => {
        assert.equal(error.name, "UserError");
        assert.match(error.message, /currently locked for mutation/);
        return true;
      },
    );
    assert.equal(fs.existsSync(loopDir), true);
  } finally {
    cleanupScratch(home);
  }
});
