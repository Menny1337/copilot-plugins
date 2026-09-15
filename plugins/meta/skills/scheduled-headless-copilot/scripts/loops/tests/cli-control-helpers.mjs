import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { cleanupScratch, cleanupScratchRoot, makeScratchEnv, scriptLoopFixture } from "./runtime-helpers.mjs";

const ctl = path.resolve(import.meta.dirname, "../../loops-ctl.mjs");

export { cleanupScratch, cleanupScratchRoot, makeScratchEnv, scriptLoopFixture };

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function writeExecutable(filePath, body) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, body, "utf8");
  await fsp.chmod(filePath, 0o755);
}

export function runCtl(command, payload, env, inputRaw = null) {
  try {
    const stdout = execFileSync(process.execPath, [ctl, command], {
      input: inputRaw ?? JSON.stringify(payload ?? {}),
      encoding: "utf8",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

function nodeScript(source) {
  return `#!/usr/bin/env node\n${source}`;
}

export async function setupCliEnv(label) {
  const { home } = makeScratchEnv(label);
  const fakeHome = path.join(home, "home");
  const binDir = path.join(home, "bin");
  const launchctlStateDir = path.join(home, "launchctl-state");
  const launchctlPath = path.join(binDir, "fake-launchctl.mjs");

  await fsp.mkdir(fakeHome, { recursive: true });
  await fsp.mkdir(binDir, { recursive: true });
  await fsp.mkdir(launchctlStateDir, { recursive: true });

  await writeExecutable(launchctlPath, nodeScript(`
import fs from "node:fs";
import path from "node:path";

const stateDir = ${JSON.stringify(launchctlStateDir)};
const logPath = path.join(stateDir, "log.txt");
const loadedDir = path.join(stateDir, "loaded");
const disabledDir = path.join(stateDir, "disabled");
fs.mkdirSync(loadedDir, { recursive: true });
fs.mkdirSync(disabledDir, { recursive: true });

const [, , command = "", ...args] = process.argv;
fs.appendFileSync(logPath, [command, ...args].join(" ") + "\\n");

const sanitize = (value) => String(value).replace(/[/:]/g, "_");
const marker = (dir, value) => path.join(dir, sanitize(value));

switch (command) {
  case "print": {
    process.exit(fs.existsSync(marker(loadedDir, args[0])) ? 0 : 113);
    break;
  }
  case "enable": {
    fs.rmSync(marker(disabledDir, args[0]), { force: true });
    process.exit(0);
    break;
  }
  case "disable": {
    fs.writeFileSync(marker(disabledDir, args[0]), "disabled\\n");
    process.exit(0);
    break;
  }
  case "bootstrap": {
    const [domain, plistPath] = args;
    const label = path.basename(plistPath, ".plist");
    const target = \`\${domain}/\${label}\`;
    if (process.env.FAKE_LAUNCHCTL_FAIL_BOOTSTRAP_LABEL === label) {
      process.stderr.write(\`bootstrap failed for \${label}\\n\`);
      process.exit(71);
    }
    fs.writeFileSync(marker(loadedDir, target), "loaded\\n");
    process.exit(0);
    break;
  }
  case "bootout": {
    const target = args[0];
    if (process.env.FAKE_LAUNCHCTL_FAIL_BOOTOUT_TARGET === target) {
      process.stderr.write(\`bootout failed for \${target}\\n\`);
      process.exit(72);
    }
    fs.rmSync(marker(loadedDir, target), { force: true });
    process.exit(0);
    break;
  }
  case "kickstart": {
    const target = args[0] === "-k" ? args[1] : args[0];
    if (process.env.FAKE_LAUNCHCTL_FAIL_KICKSTART_TARGET === target) {
      process.stderr.write(\`kickstart failed for \${target}\\n\`);
      process.exit(73);
    }
    fs.writeFileSync(marker(loadedDir, target), "loaded\\n");
    process.exit(0);
    break;
  }
  case "kill": {
    const target = args[1];
    if (!fs.existsSync(marker(loadedDir, target))) {
      process.stderr.write(\`not loaded: \${target}\\n\`);
      process.exit(74);
    }
    fs.rmSync(marker(loadedDir, target), { force: true });
    process.exit(0);
    break;
  }
  default: {
    process.stderr.write(\`unsupported command: \${command}\\n\`);
    process.exit(99);
  }
}
`));

  const env = {
    ...process.env,
    HOME: fakeHome,
    COPILOT_HOME: path.join(fakeHome, ".copilot"),
    COPILOT_LOOPS_HOME: home,
    COPILOT_LOOPS_LAUNCHCTL: launchctlPath,
    FAKE_LAUNCHCTL_DIR: launchctlStateDir,
  };

  return {
    home,
    env,
    binDir,
    fakeHome,
    launchctlPath,
    launchctlStateDir,
  };
}

export function buildScriptLoop({ id, scriptPath, workingDirectory }) {
  const body = fs.readFileSync(scriptPath);
  return scriptLoopFixture({
    id,
    name: `Loop ${id}`,
    lifecycle: "draft",
    execution: {
      type: "scriptFile",
      path: scriptPath,
      arguments: [],
      workingDirectory,
      contentHash: sha256(body),
    },
    approval: {
      fingerprint: null,
      approvedAt: null,
    },
  });
}
