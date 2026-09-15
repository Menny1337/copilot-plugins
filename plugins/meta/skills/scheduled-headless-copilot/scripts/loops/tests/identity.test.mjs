import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  IdentityConfigError,
  identityPath,
  loadIdentity,
  prepareInstallIdentity,
  prepareUninstallIdentity,
} from "../lib/identity.mjs";

const scratchRoot = path.join(import.meta.dirname, ".scratch");

function scratchDirectory(name) {
  const root = path.join(scratchRoot, `${name}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function fixture(name) {
  const root = scratchDirectory(name);
  const env = {
    HOME: path.join(root, "home"),
    COPILOT_LOOPS_HOME: path.join(root, "state", "copilot-loops"),
  };
  return {
    root,
    env,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("missing identity uses public defaults without writing config", () => {
  const current = fixture("missing");
  try {
    const identity = loadIdentity(current.env);
    assert.equal(identity.configured, false);
    assert.equal(identity.namespace, "com.copilotplugins.copilot-loops");
    assert.equal(identity.appLabel, "com.copilotplugins.copilot-loops.app");
    assert.equal(identity.taskLabelPrefix, "com.copilotplugins.copilot-loops.task.");
    assert.equal(identity.keychainService, "com.copilotplugins.copilot-loops.secrets");
    assert.equal(fs.existsSync(identityPath(current.env)), false);
  } finally {
    current.cleanup();
  }
});

test("custom identity derives all durable names and preserves unrelated config", () => {
  const current = fixture("custom");
  try {
    const config = {
      schemaVersion: 1,
      profile: "custom",
      namespace: "com.example.copilot-loops",
      localPreferences: { channel: "stable" },
    };
    fs.mkdirSync(path.dirname(identityPath(current.env)), { recursive: true });
    fs.writeFileSync(identityPath(current.env), JSON.stringify(config, null, 2) + "\n");

    const identity = prepareInstallIdentity(current.env);
    assert.equal(identity.bundleIdentifier, "com.example.copilot-loops");
    assert.equal(identity.appLabel, "com.example.copilot-loops.app");
    assert.equal(identity.taskLabelPrefix, "com.example.copilot-loops.task.");
    assert.equal(identity.keychainService, "com.example.copilot-loops.secrets");
    assert.deepEqual(JSON.parse(fs.readFileSync(identityPath(current.env), "utf8")), config);
  } finally {
    current.cleanup();
  }
});

test("new install writes a public default profile atomically", () => {
  const current = fixture("new-install");
  try {
    const identity = prepareInstallIdentity(current.env);
    assert.equal(identity.namespace, "com.copilotplugins.copilot-loops");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(identityPath(current.env), "utf8")),
      { schemaVersion: 1, profile: "default" },
    );
  } finally {
    current.cleanup();
  }
});

test("existing state without identity fails closed for install and uninstall", () => {
  const current = fixture("legacy");
  try {
    fs.mkdirSync(path.join(current.env.COPILOT_LOOPS_HOME, "runtime"), { recursive: true });
    for (const prepare of [prepareInstallIdentity, prepareUninstallIdentity]) {
      assert.throws(
        () => prepare(current.env),
        (error) => {
          assert.ok(error instanceof IdentityConfigError);
          assert.equal(error.context.code, "identity-profile-required");
          assert.match(error.message, /Create .*identity\.json/);
          return true;
        },
      );
    }
    assert.equal(fs.existsSync(identityPath(current.env)), false);
  } finally {
    current.cleanup();
  }
});

test("new install never overwrites an identity created concurrently", () => {
  const current = fixture("concurrent-profile");
  const configured = { schemaVersion: 1, profile: "custom", namespace: "com.example.copilot-loops" };
  try {
    assert.throws(() => prepareInstallIdentity(current.env, {
      linkSync(temporary, target) {
        fs.writeFileSync(target, JSON.stringify(configured), { flag: "wx" });
        fs.linkSync(temporary, target);
      },
    }), { code: "EEXIST" });
    assert.deepEqual(JSON.parse(fs.readFileSync(identityPath(current.env), "utf8")), configured);
    assert.deepEqual(fs.readdirSync(current.env.COPILOT_LOOPS_HOME), ["identity.json"]);
  } finally {
    current.cleanup();
  }
});

test("preserved tasks and history without runtime artifacts still require a legacy profile", () => {
  const current = fixture("legacy-preserved-tasks");
  try {
    const taskRoot = path.join(current.env.COPILOT_LOOPS_HOME, "tasks", "archived-loop");
    fs.mkdirSync(path.join(taskRoot, "runs", "run-1"), { recursive: true });
    fs.writeFileSync(path.join(taskRoot, "loop.json"), "{}\n");
    fs.writeFileSync(path.join(taskRoot, "runs", "run-1", "run.json"), "{}\n");

    assert.throws(
      () => prepareInstallIdentity(current.env),
      (error) => {
        assert.ok(error instanceof IdentityConfigError);
        assert.equal(error.context.code, "identity-profile-required");
        return true;
      },
    );
    assert.equal(fs.existsSync(identityPath(current.env)), false);
    assert.equal(fs.existsSync(path.join(taskRoot, "loop.json")), true);
    assert.equal(fs.existsSync(path.join(current.env.COPILOT_LOOPS_HOME, "runtime.json")), false);
    assert.equal(fs.existsSync(path.join(current.env.HOME, "Applications", "CopilotLoops.app")), false);
  } finally {
    current.cleanup();
  }
});

test("malformed and unknown identity settings fail visibly", () => {
  const cases = [
    ["not-json", "{", /not valid JSON/],
    ["schema", JSON.stringify({ schemaVersion: 2, profile: "default" }), /schemaVersion must be 1/],
    ["boolean-schema", JSON.stringify({ schemaVersion: true, profile: "default" }), /schemaVersion must be 1/],
    ["string-schema", JSON.stringify({ schemaVersion: "1", profile: "default" }), /schemaVersion must be 1/],
    ["fractional-schema", JSON.stringify({ schemaVersion: 1.5, profile: "default" }), /schemaVersion must be 1/],
    ["profile", JSON.stringify({ schemaVersion: 1, profile: "other" }), /profile must be/],
    ["namespace", JSON.stringify({ schemaVersion: 1, profile: "custom", namespace: "Example" }), /reverse-DNS/],
    ["missing-namespace", JSON.stringify({ schemaVersion: 1, profile: "custom" }), /requires namespace/],
  ];
  for (const [name, content, expected] of cases) {
    const current = fixture(name);
    try {
      fs.mkdirSync(path.dirname(identityPath(current.env)), { recursive: true });
      fs.writeFileSync(identityPath(current.env), content);
      assert.throws(() => loadIdentity(current.env), expected);
    } finally {
      current.cleanup();
    }
  }
});

test("relative HOME is rejected when it determines the identity path", () => {
  assert.throws(
    () => loadIdentity({ HOME: "relative/home" }),
    /HOME must be an absolute path/,
  );
});

test("a dangling identity symlink fails instead of selecting public defaults", () => {
  const current = fixture("dangling-profile");
  try {
    fs.mkdirSync(path.dirname(identityPath(current.env)), { recursive: true });
    fs.symlinkSync(path.join(current.root, "missing.json"), identityPath(current.env));
    for (const read of [loadIdentity, prepareInstallIdentity, prepareUninstallIdentity]) {
      assert.throws(() => read(current.env), { code: "ENOENT" });
    }
    assert.ok(fs.lstatSync(identityPath(current.env)).isSymbolicLink());
  } finally {
    current.cleanup();
  }
});
