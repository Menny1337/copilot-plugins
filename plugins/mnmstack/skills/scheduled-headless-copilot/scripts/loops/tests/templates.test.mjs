import assert from "node:assert/strict";
import test from "node:test";
import { builtInTemplates } from "../commands/templates.mjs";
import { validateLoopDefinition } from "../lib/contracts.mjs";
import { buildCommand, buildPrompt } from "../lib/runner-command.mjs";
import { copilotLoopFixture } from "./runtime-helpers.mjs";

const run = { cliLogsDir: "/synthetic/logs" };

test("mnmstack templates invoke skills in the main agent without legacy agent defaults", async () => {
  const { templates } = await builtInTemplates();
  for (const [key, skill] of [
    ["nightly-dependency-report", "research-methodology"],
    ["scheduled-skill-review", "agent-skill-audit"],
  ]) {
    const template = templates.find((item) => item.key === key);
    assert.equal(template.defaults.execution.installedPlugin, "mnmstack");
    assert.equal(template.defaults.execution.agent, null);
    assert.equal(template.defaults.execution.skill, skill);
  }
  for (const template of templates.filter((item) => item.kind === "copilot")) {
    const loop = copilotLoopFixture({
      ...template.defaults,
      execution: {
        ...template.defaults.execution,
        workingDirectory: "/synthetic/repository",
      },
    });
    validateLoopDefinition(loop);
    const { args } = buildCommand({ loop, run, sessionId: "run-1", secretValues: { REPORT_TOKEN: "fixture" } });
    assert.ok(!args.includes("--agent"), template.key);
    if (loop.execution.skill) {
      assert.ok(buildPrompt(loop.execution).startsWith(`Use the "${loop.execution.skill}" skill. `));
    }
  }
});

test("explicit historical tasks retain their agent and plugin without migration", () => {
  const loop = copilotLoopFixture();
  loop.execution.installedPlugin = "core-agents";
  loop.execution.agent = "core-agents:researcher";
  const original = structuredClone(loop);
  validateLoopDefinition(loop);
  const { args } = buildCommand({ loop, run, sessionId: "run-1", secretValues: { REPORT_TOKEN: "fixture" } });
  assert.equal(args[args.indexOf("--agent") + 1], original.execution.agent);
  assert.deepEqual(loop, original);
});
