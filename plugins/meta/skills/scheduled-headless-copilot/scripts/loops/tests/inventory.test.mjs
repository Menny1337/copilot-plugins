import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { getInventory } from "../commands/inventory.mjs";
import { cleanupScratch, cleanupScratchRoot, makeScratchEnv } from "./runtime-helpers.mjs";

test.after(cleanupScratchRoot);

test("Inventory with fake execFile", async () => {
  const { home } = makeScratchEnv("inventory");
  const copilotHome = path.join(home, ".copilot");
  const env = { ...process.env, COPILOT_HOME: copilotHome };

  try {
    const pluginDir = path.join(copilotHome, "installed-plugins", "acme", "acme-plugin");
    const agentsDir = path.join(pluginDir, "agents");
    await fsp.mkdir(agentsDir, { recursive: true });
    await fsp.writeFile(path.join(pluginDir, "plugin.json"), JSON.stringify({
      name: "acme-plugin",
      version: "1.0.0",
      description: "Acme plugin",
    }, null, 2) + "\n");
    await fsp.writeFile(path.join(agentsDir, "test.agent.md"), `---
name: test
description: "A test agent"
---
Agent body
`);

    const fakeExecFn = async (_cmd, args) => {
      if (args[0] === "plugins") {
        return { stdout: JSON.stringify({ plugins: [{ kind: "plugin", name: "acme-plugin", scope: "user", source: "marketplace:acme", enabled: true }] }) };
      }
      if (args[0] === "skill") {
        return { stdout: JSON.stringify({ skills: [{ name: "skill1", enabled: false }] }) };
      }
      throw new Error("Unknown exec");
    };

    const result = await getInventory({}, fakeExecFn, { env });

    assert.equal(result.schemaVersion, 1);
    assert.equal(result.plugins.length, 1);
    assert.equal(result.plugins[0].name, "acme-plugin");
    assert.equal(result.skills.length, 1);
    assert.equal(result.skills[0].name, "skill1");
    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0].name, "test");
    assert.equal(result.agents[0].description, "A test agent");
    assert.equal(result.agents[0].plugin, "acme-plugin");
    assert.equal(result.errors.length, 0);
  } finally {
    cleanupScratch(home);
  }
});

test("installed plugin layouts without a root plugin.json remain healthy", async () => {
  const { home } = makeScratchEnv("inventory-installed-layouts");
  const copilotHome = path.join(home, ".copilot");
  const env = { ...process.env, COPILOT_HOME: copilotHome };

  try {
    const agencyDir = path.join(copilotHome, "installed-plugins", "agency", "agency-extensions");
    await fsp.mkdir(path.join(agencyDir, ".claude-plugin"), { recursive: true });
    await fsp.writeFile(path.join(agencyDir, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "agency-extensions",
      version: "0.1.0",
    }, null, 2) + "\n");

    const skillOnlyDir = path.join(copilotHome, "installed-plugins", "copilot-plugins", "workiq");
    await fsp.mkdir(path.join(skillOnlyDir, "skills", "workiq"), { recursive: true });
    await fsp.writeFile(path.join(skillOnlyDir, "skills", "workiq", "SKILL.md"), `---
name: workiq
description: Test installed skill
---
`);

    const fakeExecFn = async (_cmd, args) => {
      if (args[0] === "plugins") {
        return { stdout: JSON.stringify({ plugins: [{ kind: "plugin", name: "agency-extensions", scope: "user", source: "marketplace:agency", enabled: true }] }) };
      }
      if (args[0] === "skill") {
        return { stdout: JSON.stringify({ skills: [{ name: "workiq", plugin: "workiq", enabled: true }] }) };
      }
      throw new Error("Unknown exec");
    };

    const result = await getInventory({}, fakeExecFn, { env });

    assert.equal(result.healthy, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.plugins.find((plugin) => plugin.name === "agency-extensions")?.version, "0.1.0");
    assert.ok(result.plugins.some((plugin) => plugin.name === "workiq"));
    assert.equal(result.skills.find((skill) => skill.name === "workiq")?.plugin, "workiq");
  } finally {
    cleanupScratch(home);
  }
});

test("explicit local plugin directories still require plugin.json", async () => {
  const { home } = makeScratchEnv("inventory-local-manifest");
  const pluginDir = path.join(home, "local-plugin");
  const env = { ...process.env, COPILOT_HOME: path.join(home, ".copilot") };

  try {
    await fsp.mkdir(pluginDir, { recursive: true });
    const fakeExecFn = async (_cmd, args) => {
      if (args[0] === "plugins") return { stdout: JSON.stringify({ plugins: [] }) };
      if (args[0] === "skill") return { stdout: JSON.stringify({ skills: [] }) };
      throw new Error("Unknown exec");
    };

    const result = await getInventory({ localPluginDirectories: [pluginDir] }, fakeExecFn, { env });

    assert.equal(result.healthy, false);
    assert.equal(result.errors[0]?.code, "plugin_manifest_missing");
  } finally {
    cleanupScratch(home);
  }
});
