import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const scriptsRoot = path.resolve(import.meta.dirname, "../..");
const installScript = path.join(scriptsRoot, "loops-install.sh");
const uninstallScript = path.join(scriptsRoot, "loops-uninstall.sh");
const scratchRoot = path.join(import.meta.dirname, ".scratch");

async function scratchDirectory(prefix) {
  await mkdir(scratchRoot, { recursive: true });
  return await mkdtemp(path.join(scratchRoot, prefix));
}

async function writeExecutable(filePath, body) {
  await writeFile(filePath, body, "utf8");
  await chmod(filePath, 0o755);
}

function run(script, args, env) {
  return execFileSync("/bin/bash", [script, ...args], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("installer stages a stable runtime and uninstaller preserves or purges data", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await scratchDirectory("packaging-");

  try {
    const home = path.join(root, "home");
    const stateRoot = path.join(root, "state", "copilot-loops");
    const fakeApp = path.join(root, "Fixture.app");
    const fakeLaunchctl = path.join(root, "launchctl");
    const launchLog = path.join(root, "launchctl.log");
    const secretLog = path.join(root, "secrets.log");
    const namespace = "com.example.copilot-loops";
    const identity = {
      schemaVersion: 1,
      profile: "custom",
      namespace,
      retainedSetting: { enabled: true },
    };

    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "identity.json"), JSON.stringify(identity, null, 2) + "\n");
    await mkdir(path.join(fakeApp, "Contents", "MacOS"), { recursive: true });
    await mkdir(path.join(fakeApp, "Contents", "Helpers"), { recursive: true });
    await writeExecutable(
      path.join(fakeApp, "Contents", "MacOS", "CopilotLoops"),
      "#!/bin/bash\nexit 0\n",
    );
    await writeExecutable(
      path.join(fakeApp, "Contents", "Helpers", "CopilotLoopsSecrets"),
      `#!/bin/bash
printf '%s\\0' "$2" >> "$COPILOT_LOOPS_FAKE_SECRET_LOG"
case "$1" in
  exists) printf 'true\\n' ;;
  get) printf 'fixture-value' ;;
  set) cat >/dev/null ;;
  delete) ;;
  *) exit 2 ;;
esac
`,
    );
    await writeExecutable(
      fakeLaunchctl,
      "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$COPILOT_LOOPS_FAKE_LAUNCH_LOG\"\n",
    );

    const env = {
      ...process.env,
      HOME: home,
      COPILOT_LOOPS_HOME: stateRoot,
      COPILOT_LOOPS_APP_BUNDLE: fakeApp,
      COPILOT_LOOPS_LAUNCHCTL: fakeLaunchctl,
      COPILOT_LOOPS_FAKE_LAUNCH_LOG: launchLog,
      COPILOT_LOOPS_FAKE_SECRET_LOG: secretLog,
    };

    run(installScript, [], env);

    const installedApp = path.join(home, "Applications", "CopilotLoops.app");
    const runtime = path.join(stateRoot, "runtime");
    const control = path.join(runtime, "loops-ctl.mjs");
    const appPlist = path.join(
      home,
      "Library",
      "LaunchAgents",
      `${namespace}.app.plist`,
    );
    const contract = JSON.parse(execFileSync(process.execPath, [control, "contract"], {
      encoding: "utf8",
      env: { ...env, COPILOT_LOOPS_RUNTIME: runtime },
    }));
    assert.equal(contract.schemaVersion, 1);
    assert.equal(contract.appLabel, `${namespace}.app`);
    assert.equal(contract.taskLabelPrefix, `${namespace}.task.`);
    assert.equal(
      JSON.parse(await readFile(path.join(stateRoot, "runtime.json"), "utf8")).loopsCtlPath,
      control,
    );
    execFileSync("/usr/bin/plutil", ["-lint", appPlist]);
    assert.match(await readFile(appPlist, "utf8"), new RegExp(`<string>${namespace}\\.app</string>`));
    assert.match(await readFile(launchLog, "utf8"), /bootstrap gui\//);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(stateRoot, "identity.json"), "utf8")),
      identity,
    );

    const preservedTask = path.join(stateRoot, "tasks", "keep");
    await mkdir(preservedTask, { recursive: true });
    const preservedLoop = JSON.parse(
      await readFile(path.join(scriptsRoot, "loops", "contracts", "fixtures", "script-loop.json"), "utf8"),
    );
    preservedLoop.id = "keep";
    preservedLoop.name = "Preserved loop";
    preservedLoop.environment.secretNames = ["API_TOKEN"];
    await writeFile(
      path.join(preservedTask, "loop.json"),
      JSON.stringify(preservedLoop, null, 2) + "\n",
    );
    const taskPlist = path.join(
      home,
      "Library",
      "LaunchAgents",
      `${namespace}.task.keep.plist`,
    );
    await writeFile(taskPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${namespace}.task.keep</string>
</dict></plist>
`);

    run(uninstallScript, [], env);
    await readFile(path.join(preservedTask, "loop.json"), "utf8");
    await assert.rejects(readFile(path.join(installedApp, "Contents", "MacOS", "CopilotLoops")));
    await assert.rejects(readFile(control));
    await assert.rejects(readFile(taskPlist));

    run(installScript, [], env);
    await writeFile(taskPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${namespace}.task.keep</string>
</dict></plist>
`);
    run(uninstallScript, ["--purge"], env);
    assert.match(await readFile(secretLog, "utf8"), /keep:API_TOKEN/);
    await assert.rejects(readFile(path.join(stateRoot, "runtime.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("purge falls back to security when the app helper is missing", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await scratchDirectory("purge-fallback-");
  try {
    const home = path.join(root, "home");
    const stateRoot = path.join(root, "state", "copilot-loops");
    const taskRoot = path.join(stateRoot, "tasks", "keep");
    const fakeLaunchctl = path.join(root, "launchctl");
    const fakeSecurity = path.join(root, "security");
    const securityLog = path.join(root, "security.log");
    const namespace = "org.example.copilot-loops";
    await mkdir(taskRoot, { recursive: true });
    await mkdir(path.join(home, "Library", "LaunchAgents"), { recursive: true });
    await writeExecutable(fakeLaunchctl, "#!/bin/bash\nexit 0\n");
    await writeExecutable(
      fakeSecurity,
      "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$COPILOT_LOOPS_FAKE_SECURITY_LOG\"\n",
    );

    const loop = JSON.parse(
      await readFile(path.join(scriptsRoot, "loops", "contracts", "fixtures", "script-loop.json"), "utf8"),
    );
    loop.id = "keep";
    loop.environment.secretNames = ["API_TOKEN"];
    await writeFile(path.join(taskRoot, "loop.json"), JSON.stringify(loop, null, 2) + "\n");
    await writeFile(
      path.join(stateRoot, "identity.json"),
      JSON.stringify({ schemaVersion: 1, profile: "custom", namespace }) + "\n",
    );

    run(uninstallScript, ["--purge"], {
      ...process.env,
      HOME: home,
      COPILOT_LOOPS_HOME: stateRoot,
      COPILOT_LOOPS_LAUNCHCTL: fakeLaunchctl,
      COPILOT_LOOPS_SECURITY: fakeSecurity,
      COPILOT_LOOPS_FAKE_SECURITY_LOG: securityLog,
    });

    const securityInvocation = await readFile(securityLog, "utf8");
    assert.match(securityInvocation, /delete-generic-password/);
    assert.match(securityInvocation, /-s org\.example\.copilot-loops\.secrets/);
    assert.match(securityInvocation, /-a keep:API_TOKEN/);
    await assert.rejects(readFile(path.join(taskRoot, "loop.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("install and uninstall refuse existing state without an explicit identity profile", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await scratchDirectory("legacy-gate-");
  try {
    const home = path.join(root, "home");
    const stateRoot = path.join(root, "state", "copilot-loops");
    const installedApp = path.join(home, "Applications", "CopilotLoops.app");
    const appSentinel = path.join(installedApp, "preserve-app");
    const runtimeSentinel = path.join(stateRoot, "runtime", "preserve-runtime");
    const fakeLaunchctl = path.join(root, "launchctl");
    const launchLog = path.join(root, "launchctl.log");
    await mkdir(installedApp, { recursive: true });
    await mkdir(path.dirname(runtimeSentinel), { recursive: true });
    await writeFile(appSentinel, "existing app\n");
    await writeFile(runtimeSentinel, "existing runtime\n");
    await writeExecutable(
      fakeLaunchctl,
      "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$COPILOT_LOOPS_FAKE_LAUNCH_LOG\"\n",
    );

    for (const script of [installScript, uninstallScript]) {
      assert.throws(
        () => run(script, [], {
          ...process.env,
          HOME: home,
          COPILOT_LOOPS_HOME: stateRoot,
          COPILOT_LOOPS_LAUNCHCTL: fakeLaunchctl,
          COPILOT_LOOPS_FAKE_LAUNCH_LOG: launchLog,
        }),
        (error) => {
          assert.match(error.stderr, /Existing Copilot Loops installation or state has no identity profile/);
          assert.ok(error.stderr.includes(path.join(stateRoot, "identity.json")));
          return true;
        },
      );
    }
    assert.equal(await readFile(appSentinel, "utf8"), "existing app\n");
    assert.equal(await readFile(runtimeSentinel, "utf8"), "existing runtime\n");
    await assert.rejects(readFile(launchLog));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installer treats preserved task history as a legacy install after ordinary uninstall", {
  skip: process.platform !== "darwin",
}, async () => {
  const root = await scratchDirectory("legacy-preserved-tasks-");
  try {
    const home = path.join(root, "home");
    const stateRoot = path.join(root, "state", "copilot-loops");
    const taskRoot = path.join(stateRoot, "tasks", "archived-loop");
    const historyPath = path.join(taskRoot, "runs", "run-1", "run.json");
    await mkdir(path.dirname(historyPath), { recursive: true });
    await writeFile(path.join(taskRoot, "loop.json"), "{}\n");
    await writeFile(historyPath, "{}\n");

    assert.throws(
      () => run(installScript, [], {
        ...process.env,
        HOME: home,
        COPILOT_LOOPS_HOME: stateRoot,
      }),
      (error) => {
        assert.match(error.stderr, /Existing Copilot Loops installation or state has no identity profile/);
        return true;
      },
    );

    assert.equal(await readFile(path.join(taskRoot, "loop.json"), "utf8"), "{}\n");
    assert.equal(await readFile(historyPath, "utf8"), "{}\n");
    await assert.rejects(readFile(path.join(stateRoot, "identity.json")));
    await assert.rejects(readFile(path.join(stateRoot, "runtime.json")));
    await assert.rejects(readFile(path.join(home, "Applications", "CopilotLoops.app")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
