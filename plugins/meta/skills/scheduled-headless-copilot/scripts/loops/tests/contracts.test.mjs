import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  capabilityFingerprint,
  validateLoopDefinition,
  validateRunRecord,
} from "../lib/contracts.mjs";
import { requireLoopId, taskLabel } from "../lib/paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../contracts/fixtures");

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixtures, name), "utf8"));
}

test("canonical Copilot and script fixtures validate", async () => {
  assert.equal(validateLoopDefinition(await fixture("copilot-loop.json")).kind, "copilot");
  assert.equal(validateLoopDefinition(await fixture("script-loop.json")).kind, "script");
  assert.equal(validateRunRecord(await fixture("run.json")).status, "succeeded");
});

test("published schema nests permission profile constraints under permissions", async () => {
  const schema = await fixture("../loop.schema.json");
  assert.equal(schema.properties.allOf, undefined);
  assert.ok(Array.isArray(schema.properties.permissions.allOf));
  assert.equal(schema.properties.permissions.allOf.length, 2);
});

test("capability fingerprint ignores schedule and presentation fields", async () => {
  const loop = await fixture("copilot-loop.json");
  const first = capabilityFingerprint(loop);
  loop.name = "Renamed";
  loop.schedule.hour = 4;
  loop.notifications.onSuccess = true;
  loop.retention.maxRuns = 25;
  loop.lifecycle = "needsReview";
  loop.updatedAt = "2026-07-24T16:00:00Z";
  assert.equal(capabilityFingerprint(loop), first);
});

test("capability fingerprint covers every Copilot authority field", async () => {
  const base = await fixture("copilot-loop.json");
  const fingerprint = capabilityFingerprint(base);
  const edits = [
    (loop) => { loop.execution.prompt += " Open a pull request."; },
    (loop) => { loop.execution.model = "gpt-5.4"; },
    (loop) => { loop.execution.workingDirectory = "/tmp/other-repo"; },
    (loop) => { loop.execution.extraPaths = ["/tmp/reports"]; },
    (loop) => { loop.execution.localPluginDirectories = ["/tmp/plugin"]; },
    (loop) => { loop.execution.installedPlugin = "meta"; },
    (loop) => { loop.execution.agent = "meta:agent-architect"; },
    (loop) => { loop.execution.skill = "scheduled-headless-copilot"; },
    (loop) => {
      loop.permissions.profile = "custom";
      loop.permissions.allowAll = false;
    },
    (loop) => { loop.permissions.allowTools = ["shell"]; },
    (loop) => { loop.permissions.denyTools = ["browser"]; },
    (loop) => { loop.permissions.allowUrls = ["https://example.com"]; },
    (loop) => { loop.permissions.denyUrls = ["https://blocked.example"]; },
    (loop) => { loop.environment.plain.REPORT_FORMAT = "json"; },
    (loop) => { loop.environment.secretNames = ["OTHER_TOKEN"]; },
    (loop) => { loop.timeoutSeconds += 1; },
    (loop) => { loop.retry.maxRetries = 1; },
    (loop) => { loop.retry.backoffSeconds += 1; },
  ];

  for (const edit of edits) {
    const candidate = structuredClone(base);
    edit(candidate);
    assert.notEqual(capabilityFingerprint(candidate), fingerprint);
  }
});

test("capability fingerprint covers script path, argv, and content hash", async () => {
  const base = await fixture("script-loop.json");
  const fingerprint = capabilityFingerprint(base);
  const edits = [
    (loop) => { loop.execution.path = "/tmp/other-script.sh"; },
    (loop) => { loop.execution.arguments.push("--verbose"); },
    (loop) => { loop.execution.workingDirectory = "/tmp/other-repo"; },
    (loop) => { loop.execution.contentHash = "b".repeat(64); },
  ];
  for (const edit of edits) {
    const candidate = structuredClone(base);
    edit(candidate);
    assert.notEqual(capabilityFingerprint(candidate), fingerprint);
  }
});

test("strict validation rejects schema drift and unsafe fields", async () => {
  const base = await fixture("copilot-loop.json");

  const extra = structuredClone(base);
  extra.shellCommand = "rm -rf /";
  assert.throws(() => validateLoopDefinition(extra), /unsupported properties/);

  const relative = structuredClone(base);
  relative.execution.workingDirectory = "relative/repo";
  assert.throws(() => validateLoopDefinition(relative), /absolute path/);

  const duplicatePath = structuredClone(base);
  duplicatePath.execution.extraPaths = ["/tmp/reports", "/tmp/reports"];
  assert.throws(() => validateLoopDefinition(duplicatePath), /duplicates/);

  const secretConflict = structuredClone(base);
  secretConflict.environment.secretNames = ["REPORT_FORMAT"];
  assert.throws(() => validateLoopDefinition(secretConflict), /both plain and secret/);

  const invalidPermissionProfile = structuredClone(base);
  invalidPermissionProfile.permissions.allowAll = false;
  assert.throws(() => validateLoopDefinition(invalidPermissionProfile), /require allowAll/);

  const unapprovedEnabled = structuredClone(base);
  unapprovedEnabled.lifecycle = "enabled";
  assert.throws(() => validateLoopDefinition(unapprovedEnabled), /require approval/);

  const subMinuteOnce = structuredClone(base);
  subMinuteOnce.schedule = {
    kind: "once",
    scheduledAt: "2026-07-24T15:00:30Z",
    graceSeconds: 300,
  };
  assert.throws(() => validateLoopDefinition(subMinuteOnce), /minute precision/);

  const boundaryName = structuredClone(base);
  boundaryName.name = "x".repeat(120);
  assert.equal(validateLoopDefinition(boundaryName).name.length, 120);

  const overlongName = structuredClone(base);
  overlongName.name = "x".repeat(121);
  assert.throws(() => validateLoopDefinition(overlongName), /at most 120 characters/);
});

test("run validation rejects unknown fields and unsafe loop ids", async () => {
  const run = await fixture("run.json");
  run.secretValue = "must-not-be-stored";
  assert.throws(() => validateRunRecord(run), /unsupported properties/);

  const unsafe = await fixture("run.json");
  unsafe.loopId = "../escape";
  assert.throws(() => validateRunRecord(unsafe), /safe kebab-case/);

  const invalidSession = await fixture("run.json");
  invalidSession.sessionId = invalidSession.id;
  assert.throws(() => validateRunRecord(invalidSession), /must be a UUID/);
});

test("unsafe ids never reach paths or launchd labels", () => {
  const env = {
    HOME: "/Users/USERNAME",
    COPILOT_LOOPS_HOME: "/Users/USERNAME/.copilot/scheduled-tasks/copilot-loops",
  };
  assert.equal(requireLoopId("nightly-report"), "nightly-report");
  assert.equal(taskLabel("nightly-report", env), "com.copilotplugins.copilot-loops.task.nightly-report");
  for (const value of ["../escape", "UPPER", "-bad", "bad-", ""]) {
    assert.throws(() => requireLoopId(value));
  }
});
