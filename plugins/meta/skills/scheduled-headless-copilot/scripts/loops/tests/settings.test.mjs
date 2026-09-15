import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupScratch,
  cleanupScratchRoot,
  runCtl,
  setupCliEnv,
} from "./cli-control-helpers.mjs";

test.after(cleanupScratchRoot);

test("Settings", async () => {
  const { home, env } = await setupCliEnv("settings");

  try {
    const getRes = runCtl("settings-get", {}, env);
    assert.equal(getRes.ok, true);
    assert.equal(getRes.data.settings.schemaVersion, 1);
    assert.equal(getRes.data.settings.notificationsEnabled, true);

    const badSet = runCtl("settings-set", { settings: { foo: "bar" } }, env);
    assert.equal(badSet.ok, false);
    assert.equal(badSet.error.name, "UserError");

    const goodSet = runCtl("settings-set", {
      settings: { schemaVersion: 1, launchAtLogin: false, defaultTimeoutSeconds: 60 },
    }, env);
    assert.equal(goodSet.ok, true);
    assert.equal(goodSet.data.settings.launchAtLogin, false);
    assert.equal(goodSet.data.settings.defaultTimeoutSeconds, 60);

    const getRes2 = runCtl("settings-get", {}, env);
    assert.equal(getRes2.ok, true);
    assert.equal(getRes2.data.settings.launchAtLogin, false);
  } finally {
    cleanupScratch(home);
  }
});
