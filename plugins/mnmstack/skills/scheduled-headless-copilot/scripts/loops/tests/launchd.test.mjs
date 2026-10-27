import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  bootstrapTaskLaunchAgent,
  isTaskLoaded,
  launchAgentsDirectory,
  launchdTarget,
  removeTaskLaunchAgent,
  taskPlistHashPath,
  taskPlistPath,
  taskStderrPath,
  taskStdoutPath,
  writeTaskLaunchAgent,
} from "../lib/launchd.mjs";
import {
  INSTALLED_RUNNER_PATH,
  SOURCE_RUNNER_PATH,
  TASK_PLIST_TEMPLATE_PATH,
  defaultRunnerPath,
  renderTaskPlist,
  validatePlistXml,
} from "../lib/plist.mjs";

const env = {
  HOME: "/Users/USERNAME",
  PATH: "/custom/bin",
  COPILOT_LOOPS_HOME: "/Users/USERNAME/.copilot/scheduled-tasks/copilot-loops",
  COPILOT_LOOPS_RUNTIME: "/Users/USERNAME/.copilot/scheduled-tasks/copilot-loops/runtime",
  COPILOT_LOOPS_SECRETS_HELPER: "/Users/USERNAME/.copilot/scheduled-tasks/copilot-loops/runtime/loops-secrets-helper",
};

const loop = {
  schemaVersion: 1,
  id: "nightly-report",
  name: "Nightly report",
  kind: "copilot",
  lifecycle: "enabled",
  schedule: {
    kind: "calendar",
    hour: 3,
    minute: 15,
    weekdays: [1, 5],
    graceSeconds: 300,
  },
  execution: {
    type: "copilot",
    prompt: "Review & report <nightly>",
    model: "gpt-5.6-sol",
    workingDirectory: "/Users/USERNAME/Repos/reporting",
    extraPaths: [],
    localPluginDirectories: [],
  },
  permissions: {
    profile: "fullAutonomy",
    allowAll: true,
    allowTools: [],
    denyTools: [],
    allowUrls: [],
    denyUrls: [],
  },
  environment: {
    plain: {},
    secretNames: [],
  },
  timeoutSeconds: 1800,
  retry: {
    maxRetries: 0,
    backoffSeconds: 60,
  },
  overlapPolicy: "skip",
  notifications: {
    onFailure: true,
    onSuccess: false,
  },
  retention: {
    days: 30,
    maxRuns: 100,
  },
  approval: {
    fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    approvedAt: "2026-07-24T15:05:00Z",
  },
  createdAt: "2026-07-24T15:00:00Z",
  updatedAt: "2026-07-24T15:00:00Z",
};

test("rendered plists escape XML and use absolute runtime arguments", () => {
  const rendered = renderTaskPlist(loop, {
    env,
    nodePath: "/opt/homebrew/bin/node",
    launchPath: "/opt/homebrew/bin:/custom & bin",
    stdoutPath: taskStdoutPath(loop.id, env),
    stderrPath: taskStderrPath(loop.id, env),
  });

  assert.match(TASK_PLIST_TEMPLATE_PATH, /\/loops\/templates\//);
  assert.equal(rendered.programArguments[0], "/opt/homebrew/bin/node");
  assert.equal(
    rendered.programArguments[1],
    "/Users/USERNAME/.copilot/scheduled-tasks/copilot-loops/runtime/loops-runner.mjs",
  );
  assert.equal(rendered.programArguments[2], loop.id);
  assert.notEqual(rendered.programArguments[1], SOURCE_RUNNER_PATH);
  assert.match(rendered.xml, /\/custom &amp; bin/);
  assert.match(rendered.xml, /<key>HOME<\/key>\s*<string>\/Users\/USERNAME<\/string>/);
  assert.match(
    rendered.xml,
    /<key>COPILOT_LOOPS_HOME<\/key>\s*<string>\/Users\/USERNAME\/\.copilot\/scheduled-tasks\/copilot-loops<\/string>/,
  );
  assert.match(
    rendered.xml,
    /<key>COPILOT_LOOPS_SECRETS_HELPER<\/key>\s*<string>\/Users\/USERNAME\/\.copilot\/scheduled-tasks\/copilot-loops\/runtime\/loops-secrets-helper<\/string>/,
  );
  assert.match(rendered.xml, /<key>RunAtLoad<\/key>\s*<false\/>/);
  assert.doesNotMatch(rendered.xml, /<key>KeepAlive<\/key>/);
  assert.match(rendered.xml, /<key>StartCalendarInterval<\/key>/);
  assert.match(rendered.xml, /<key>Weekday<\/key>\s*<integer>1<\/integer>/);
});

test("rendered plists infer the installed secrets helper when env override is absent", () => {
  const rendered = renderTaskPlist(loop, {
    env: {
      HOME: "/Users/USERNAME",
      PATH: "/custom/bin",
      COPILOT_LOOPS_HOME: "/Users/USERNAME/.copilot/scheduled-tasks/copilot-loops",
      COPILOT_LOOPS_RUNTIME: "/Users/USERNAME/.copilot/scheduled-tasks/copilot-loops/runtime",
    },
    nodePath: "/opt/homebrew/bin/node",
    stdoutPath: taskStdoutPath(loop.id, env),
    stderrPath: taskStderrPath(loop.id, env),
  });

  assert.equal(
    rendered.secretsHelperPath,
    "/Users/USERNAME/Applications/CopilotLoops.app/Contents/Helpers/CopilotLoopsSecrets",
  );
  assert.match(
    rendered.xml,
    /<key>COPILOT_LOOPS_SECRETS_HELPER<\/key>\s*<string>\/Users\/USERNAME\/Applications\/CopilotLoops\.app\/Contents\/Helpers\/CopilotLoopsSecrets<\/string>/,
  );
});

test("defaultRunnerPath prefers installed colocated runtime when env is absent", () => {
  assert.equal(
    defaultRunnerPath(
      {
        HOME: "/Users/USERNAME",
        PATH: "/custom/bin",
      },
      (candidate) => candidate === INSTALLED_RUNNER_PATH,
    ),
    INSTALLED_RUNNER_PATH,
  );
  assert.equal(
    defaultRunnerPath(
      {
        HOME: "/Users/USERNAME",
        PATH: "/custom/bin",
      },
      () => false,
    ),
    SOURCE_RUNNER_PATH,
  );
});

test("validatePlistXml delegates to plutil with stdin", async () => {
  const calls = [];
  await validatePlistXml("<?xml version=\"1.0\"?><plist version=\"1.0\"><dict/></plist>", {
    run: async (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return { code: 0, stdout: "OK", stderr: "" };
    },
  });

  assert.deepEqual(calls, [
    {
      command: "plutil",
      args: ["-lint", "-"],
      input: "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict/></plist>",
    },
  ]);
});

function createMemoryFs() {
  const files = new Map();
  const renames = [];
  const mkdirCalls = [];
  const removals = [];
  return {
    files,
    renames,
    mkdirCalls,
    removals,
    mkdir: async (target, options) => {
      mkdirCalls.push({ target, options });
    },
    readFile: async (target) => {
      if (!files.has(target)) {
        const error = new Error(`ENOENT: ${target}`);
        error.code = "ENOENT";
        throw error;
      }
      return files.get(target);
    },
    writeFile: async (target, content) => {
      files.set(target, String(content));
    },
    rename: async (from, to) => {
      renames.push({ from, to });
      files.set(to, files.get(from));
      files.delete(from);
    },
    rm: async (target) => {
      removals.push(target);
      files.delete(target);
    },
  };
}

test("writeTaskLaunchAgent writes plist and hash atomically and skips reload churn when unchanged", async () => {
  const fs = createMemoryFs();
  const first = await writeTaskLaunchAgent(loop, {
    env,
    nodePath: "/opt/homebrew/bin/node",
    runPlutil: async () => ({ code: 0, stdout: "", stderr: "" }),
    ...fs,
  });

  assert.equal(first.changed, true);
  assert.equal(fs.renames.length, 2);
  assert.equal(path.dirname(fs.renames[0].from), path.dirname(taskPlistPath(loop.id, env)));
  assert.equal(fs.renames[0].to, taskPlistPath(loop.id, env));
  assert.equal(path.dirname(fs.renames[1].from), path.dirname(taskPlistHashPath(loop.id, env)));
  assert.equal(fs.renames[1].to, taskPlistHashPath(loop.id, env));
  assert.equal(fs.files.get(taskPlistHashPath(loop.id, env)), `${first.hash}\n`);
  assert.deepEqual(
    fs.mkdirCalls.slice(0, 2),
    [
      { target: launchAgentsDirectory(env), options: { recursive: true } },
      { target: path.join(env.COPILOT_LOOPS_HOME, "tasks", loop.id, "logs"), options: { recursive: true } },
    ],
  );

  const second = await writeTaskLaunchAgent(loop, {
    env,
    nodePath: "/opt/homebrew/bin/node",
    runPlutil: async () => ({ code: 0, stdout: "", stderr: "" }),
    ...fs,
  });

  assert.equal(second.changed, false);
  assert.equal(fs.renames.length, 2);
});

test("bootstrapTaskLaunchAgent retries with fresh bootout and linear backoff", async () => {
  const calls = [];
  const sleeps = [];
  const responses = [
    { code: 1, stdout: "", stderr: "bootstrap EIO" },
    { code: 1, stdout: "", stderr: "bootstrap EIO" },
    { code: 0, stdout: "", stderr: "" },
  ];
  const result = await bootstrapTaskLaunchAgent("nightly-report", "/Users/USERNAME/Library/LaunchAgents/com.copilotplugins.copilot-loops.task.nightly-report.plist", {
    env,
    uid: 501,
    run: async (_command, args) => {
      calls.push(args);
      if (args[0] === "bootstrap") return responses.shift();
      return { code: 0, stdout: "", stderr: "" };
    },
    sleep: async (seconds) => {
      sleeps.push(seconds);
    },
  });

  assert.equal(result.attempt, 3);
  assert.deepEqual(sleeps, [1, 2]);
  assert.deepEqual(calls, [
    ["bootout", "gui/501/com.copilotplugins.copilot-loops.task.nightly-report"],
    [
      "bootstrap",
      "gui/501",
      "/Users/USERNAME/Library/LaunchAgents/com.copilotplugins.copilot-loops.task.nightly-report.plist",
    ],
    ["bootout", "gui/501/com.copilotplugins.copilot-loops.task.nightly-report"],
    [
      "bootstrap",
      "gui/501",
      "/Users/USERNAME/Library/LaunchAgents/com.copilotplugins.copilot-loops.task.nightly-report.plist",
    ],
    ["bootout", "gui/501/com.copilotplugins.copilot-loops.task.nightly-report"],
    [
      "bootstrap",
      "gui/501",
      "/Users/USERNAME/Library/LaunchAgents/com.copilotplugins.copilot-loops.task.nightly-report.plist",
    ],
  ]);
});

test("isTaskLoaded uses launchctl print exit status only", async () => {
  const loaded = await isTaskLoaded("nightly-report", {
    env,
    run: async (_command, args) => {
      assert.deepEqual(args, ["print", "gui/501/com.copilotplugins.copilot-loops.task.nightly-report"]);
      return {
        code: 0,
        stdout: "loaded",
        stderr: "",
      };
    },
    uid: 501,
  });

  assert.equal(loaded.loaded, true);
  const missing = await isTaskLoaded("nightly-report", {
    env,
    run: async () => ({ code: 113, stdout: "", stderr: "Could not find service" }),
    uid: 501,
  });
  assert.equal(missing.loaded, false);
  assert.equal(launchdTarget("nightly-report", 501, env), "gui/501/com.copilotplugins.copilot-loops.task.nightly-report");
});

test("isTaskLoaded rejects a signal-killed launchctl print instead of treating it as not-loaded", async () => {
  await assert.rejects(
    () => isTaskLoaded("nightly-report", {
      env,
      run: async () => ({ code: null, signal: "SIGTERM", stdout: "", stderr: "" }),
      uid: 501,
    }),
    (error) => {
      assert.equal(error.signal, "SIGTERM");
      return true;
    },
  );
});

test("launchd paths and targets use the configured identity namespace", () => {
  const root = path.join(import.meta.dirname, ".scratch", `launchd-identity-${process.pid}`);
  const customEnv = {
    HOME: path.join(root, "home"),
    COPILOT_LOOPS_HOME: path.join(root, "state", "copilot-loops"),
  };
  try {
    fs.mkdirSync(customEnv.COPILOT_LOOPS_HOME, { recursive: true });
    fs.writeFileSync(
      path.join(customEnv.COPILOT_LOOPS_HOME, "identity.json"),
      JSON.stringify({
        schemaVersion: 1,
        profile: "custom",
        namespace: "net.example.copilot-loops",
      }),
    );
    assert.equal(
      launchdTarget("nightly-report", 501, customEnv),
      "gui/501/net.example.copilot-loops.task.nightly-report",
    );
    assert.equal(
      taskPlistPath("nightly-report", customEnv),
      path.join(customEnv.HOME, "Library", "LaunchAgents", "net.example.copilot-loops.task.nightly-report.plist"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("removeTaskLaunchAgent bootouts and deletes plist plus hash when the service is loaded", async () => {
  const calls = [];
  const removed = [];
  const result = await removeTaskLaunchAgent("nightly-report", {
    env,
    uid: 501,
    run: async (_command, args) => {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    },
    rm: async (target) => {
      removed.push(target);
    },
  });

  assert.deepEqual(calls, [
    ["print", "gui/501/com.copilotplugins.copilot-loops.task.nightly-report"],
    ["bootout", "gui/501/com.copilotplugins.copilot-loops.task.nightly-report"],
  ]);
  assert.deepEqual(removed, [taskPlistPath("nightly-report", env), taskPlistHashPath("nightly-report", env)]);
  assert.equal(result.hashPath, taskPlistHashPath("nightly-report", env));
  assert.equal(result.loaded, true);
});

test("removeTaskLaunchAgent deletes plist plus hash without bootout when the service is not loaded", async () => {
  const calls = [];
  const removed = [];
  const result = await removeTaskLaunchAgent("nightly-report", {
    env,
    uid: 501,
    run: async (_command, args) => {
      calls.push(args);
      return { code: 113, stdout: "", stderr: "Could not find service" };
    },
    rm: async (target) => {
      removed.push(target);
    },
  });

  assert.deepEqual(calls, [["print", "gui/501/com.copilotplugins.copilot-loops.task.nightly-report"]]);
  assert.deepEqual(removed, [taskPlistPath("nightly-report", env), taskPlistHashPath("nightly-report", env)]);
  assert.equal(result.loaded, false);
});

test("removeTaskLaunchAgent fails closed before deleting files when loaded bootout fails", async () => {
  const calls = [];
  const removed = [];
  await assert.rejects(
    () => removeTaskLaunchAgent("nightly-report", {
      env,
      uid: 501,
      run: async (_command, args) => {
        calls.push(args);
        if (args[0] === "print") return { code: 0, signal: null, stdout: "", stderr: "" };
        return { code: 72, signal: null, stdout: "", stderr: "bootout failed" };
      },
      rm: async (target) => {
        removed.push(target);
      },
    }),
    /bootout failed/,
  );
  assert.deepEqual(calls, [
    ["print", "gui/501/com.copilotplugins.copilot-loops.task.nightly-report"],
    ["bootout", "gui/501/com.copilotplugins.copilot-loops.task.nightly-report"],
  ]);
  assert.deepEqual(removed, []);
});

test("removeTaskLaunchAgent fails closed before deleting files when launchctl print is signal-killed", async () => {
  const removed = [];
  await assert.rejects(
    () => removeTaskLaunchAgent("nightly-report", {
      env,
      uid: 501,
      run: async () => ({ code: null, signal: "SIGTERM", stdout: "", stderr: "" }),
      rm: async (target) => {
        removed.push(target);
      },
    }),
    (error) => {
      assert.equal(error.signal, "SIGTERM");
      return true;
    },
  );
  assert.deepEqual(removed, []);
});
