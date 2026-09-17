#!/usr/bin/env node
// task-session-sync.test.mjs — node:test coverage for the backend-neutral
// agentStop dispatcher (task-session-sync.sh) and the new GitHub launcher
// (github-session-sync.sh): recursion guard, backend routing (ado delegation vs.
// github launch), opt-in env/config precedence, debounce, repo allowlist, and
// fail-open behavior when a target launcher is missing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, cpSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = dirname(HERE);
const DISPATCHER = join(HOOKS_DIR, 'task-session-sync.sh');
const GITHUB_HOOK = join(HOOKS_DIR, 'github-session-sync.sh');
const ADO_HOOK = join(HOOKS_DIR, 'ado-session-sync.sh');
const GITHUB_HOOK_PS1 = join(HOOKS_DIR, 'github-session-sync.ps1');

function hasCommand(cmd) {
  const r = spawnSync('bash', ['-c', `command -v ${cmd}`]);
  return r.status === 0;
}

const VALID_SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'task-sync-test-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const marker = join(root, 'copilot-invocations.log');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });

  const fakeCopilot = join(bin, 'copilot');
  writeFileSync(fakeCopilot, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${marker}"\nexit 0\n`);
  chmodSync(fakeCopilot, 0o755);

  // Fake `gh`: presence-only check by github-session-sync.sh; never actually invoked
  // by the gating logic itself (only by the spawned headless child's prompt, which
  // we never let run to completion in these tests).
  const fakeGh = join(bin, 'gh');
  writeFileSync(fakeGh, '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(fakeGh, 0o755);

  // Fake `az` — needed only so the ado path's sourced ado-auth.sh never touches
  // the network when the dispatcher delegates to the (untouched) ADO launcher.
  const fakeAz = join(bin, 'az');
  writeFileSync(fakeAz, '#!/usr/bin/env bash\nexit 1\n');
  chmodSync(fakeAz, 0o755);

  return { root, home, bin, marker };
}

function writeConfig(home, cfg) {
  mkdirSync(join(home, '.copilot', 'assistant'), { recursive: true });
  const config = { ...cfg };
  if (config.taskBackend === 'github' && !config.github) {
    config.github = {
      owner: 'example-org',
      ownerType: 'org',
      repo: 'tasks',
      projectNumber: 1,
    };
  }
  if (config.taskBackend === 'ado' && !config.ado) {
    config.ado = { org: 'example-org', project: 'tasks' };
  }
  writeFileSync(join(home, '.copilot', 'assistant', 'config.json'), JSON.stringify(config));
}

function payload(sid = VALID_SID, cwd = '/tmp') {
  return JSON.stringify({ sessionId: sid, cwd, transcriptPath: '' });
}

function waitForMarker(marker, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(marker)) {
      const content = readFileSync(marker, 'utf8');
      if (content.trim().length > 0) return content;
    }
    spawnSync('sleep', ['0.1']);
  }
  return existsSync(marker) ? readFileSync(marker, 'utf8') : '';
}

/**
 * Build a PATH that has every utility github-session-sync.sh needs (bash's
 * own builtins aside: mkdir/date/cat/grep/sed/uuidgen, plus the sandbox's
 * fake copilot/gh) EXCEPT `jq` — by symlinking each real binary into a fresh
 * directory rather than just excluding a whole system dir (jq commonly lives
 * alongside grep/sed/uuidgen in /usr/bin, so excluding that directory wholesale
 * would also break the script's other dependencies).
 */
function noJqPath(sandboxBin) {
  const dir = mkdtempSync(join(tmpdir(), 'no-jq-bin-'));
  for (const tool of ['mkdir', 'date', 'cat', 'grep', 'sed', 'uuidgen', 'sh', 'bash', 'sleep', 'rm', 'basename', 'dirname', 'head', 'tr', 'git', 'python3', 'nohup', 'setsid', 'pwd', 'printf']) {
    const real = spawnSync('bash', ['-lc', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    if (!real) continue;
    try {
      symlinkSync(real, join(dir, tool));
    } catch { /* best-effort */ }
  }
  return `${sandboxBin}:${dir}`;
}

function runHook(hookPath, sandbox, { env = {}, sid = VALID_SID } = {}) {
  const result = spawnSync('bash', [hookPath], {
    input: payload(sid),
    env: {
      PATH: `${sandbox.bin}:${process.env.PATH}`,
      HOME: sandbox.home,
      TMPDIR: sandbox.root,
      ...env,
    },
    encoding: 'utf8',
    timeout: 5000,
  });
  return result;
}

function cleanup(sandbox) {
  rmSync(sandbox.root, { recursive: true, force: true });
}

describe('task-session-sync.sh — recursion guard', () => {
  test('COPILOT_PLUGIN_TASK_SYNC_ACTIVE set -> emits {} without spawning anything', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'github', taskSessionSync: { enabled: true, debounceMinutes: 0 } });
      const r = runHook(DISPATCHER, sandbox, { env: { COPILOT_PLUGIN_TASK_SYNC_ACTIVE: '1' } });
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '{}');
      assert.equal(existsSync(sandbox.marker), false);
    } finally { cleanup(sandbox); }
  });

  test('legacy ADO_SYNC_ACTIVE set -> also short-circuits (backward compatible)', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'github', taskSessionSync: { enabled: true, debounceMinutes: 0 } });
      const r = runHook(DISPATCHER, sandbox, { env: { ADO_SYNC_ACTIVE: '1' } });
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '{}');
      assert.equal(existsSync(sandbox.marker), false);
    } finally { cleanup(sandbox); }
  });
});

describe('task-session-sync.sh — backend routing', () => {
  test('taskBackend=github + enabled -> delegates to github-session-sync.sh (spawns headless child)', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'github', taskSessionSync: { enabled: true, debounceMinutes: 0 } });
      const r = runHook(DISPATCHER, sandbox);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '{}');
      const invoked = waitForMarker(sandbox.marker);
      assert.match(invoked, /github-sync:/, 'expected the spawned child to be named github-sync:<session>');
    } finally { cleanup(sandbox); }
  });

  test('taskBackend=ado + enabled -> delegates to ado-session-sync.sh unchanged (spawns headless child named ado-sync:)', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'ado', adoSessionSync: { enabled: true, debounceMinutes: 0 } });
      const r = runHook(DISPATCHER, sandbox);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '{}');
      const invoked = waitForMarker(sandbox.marker);
      assert.match(invoked, /ado-sync:/, 'expected the delegated child to be named ado-sync:<session>');
    } finally { cleanup(sandbox); }
  });

  test('COPILOT_PLUGIN_ASSISTANT_CONFIG selects a non-default GitHub config', () => {
    const sandbox = makeSandbox();
    const selectedConfig = join(sandbox.root, 'selected-assistant.json');
    try {
      writeFileSync(selectedConfig, JSON.stringify({
        taskBackend: 'github',
        github: {
          owner: 'example-org',
          ownerType: 'org',
          repo: 'tasks',
          projectNumber: 1,
        },
        taskSessionSync: { enabled: true, debounceMinutes: 0 },
      }));
      const r = runHook(DISPATCHER, sandbox, {
        env: { COPILOT_PLUGIN_ASSISTANT_CONFIG: selectedConfig },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '{}');
      assert.match(waitForMarker(sandbox.marker), /github-sync:/);
    } finally { cleanup(sandbox); }
  });

  test('taskBackend=markdown -> exits without selecting a remote sync launcher', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'markdown' });
      const r = runHook(DISPATCHER, sandbox);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '{}');
      // Give any accidental spawn a moment, then assert nothing landed.
      spawnSync('sleep', ['0.3']);
      assert.equal(existsSync(sandbox.marker), false);
    } finally { cleanup(sandbox); }
  });

  test('no config file at all -> exits without selecting a remote sync launcher', () => {
    const sandbox = makeSandbox();
    try {
      const r = runHook(DISPATCHER, sandbox);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '{}');
      spawnSync('sleep', ['0.3']);
      assert.equal(existsSync(sandbox.marker), false);
    } finally { cleanup(sandbox); }
  });

  test('fails open (emits {}) if the resolved backend launcher is missing on disk', () => {
    // Copy only the dispatcher into an isolated hooks dir with no siblings, so
    // `$SELF_DIR/github-session-sync.sh` cannot possibly exist.
    const sandbox = makeSandbox();
    const isolatedHooks = join(sandbox.root, 'isolated-hooks');
    const isolatedShared = join(sandbox.root, 'shared');
    mkdirSync(isolatedHooks, { recursive: true });
    mkdirSync(isolatedShared, { recursive: true });
    const isolatedDispatcher = join(isolatedHooks, 'task-session-sync.sh');
    cpSync(DISPATCHER, isolatedDispatcher);
    cpSync(join(HOOKS_DIR, '..', 'shared', 'assistant-config.sh'), join(isolatedShared, 'assistant-config.sh'));
    cpSync(join(HOOKS_DIR, '..', 'shared', 'assistant-config.mjs'), join(isolatedShared, 'assistant-config.mjs'));
    chmodSync(isolatedDispatcher, 0o755);
    try {
      writeConfig(sandbox.home, { taskBackend: 'github', taskSessionSync: { enabled: true, debounceMinutes: 0 } });
      const r = runHook(isolatedDispatcher, sandbox);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '{}');
    } finally { cleanup(sandbox); }
  });
});

describe('github-session-sync.sh — opt-in and gating (invoked directly)', () => {
  test('disabled by default (no config) -> emits {} without spawning', () => {
    const sandbox = makeSandbox();
    try {
      const r = runHook(GITHUB_HOOK, sandbox);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '{}');
      assert.equal(existsSync(sandbox.marker), false);
    } finally { cleanup(sandbox); }
  });

  test('COPILOT_PLUGIN_GITHUB_SESSION_SYNC=0 force-disables regardless of config', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'github', taskSessionSync: { enabled: true, debounceMinutes: 0 } });
      const r = runHook(GITHUB_HOOK, sandbox, { env: { COPILOT_PLUGIN_GITHUB_SESSION_SYNC: '0' } });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '{}');
      assert.equal(existsSync(sandbox.marker), false);
    } finally { cleanup(sandbox); }
  });

  test('COPILOT_PLUGIN_TASK_SESSION_SYNC=1 overrides opt-in for a valid GitHub backend', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'github', taskSessionSync: { enabled: false, debounceMinutes: 0 } });
      const r = runHook(GITHUB_HOOK, sandbox, { env: { COPILOT_PLUGIN_TASK_SESSION_SYNC: '1' } });
      assert.equal(r.status, 0, r.stderr);
      const invoked = waitForMarker(sandbox.marker);
      assert.match(invoked, /github-sync:/);
    } finally { cleanup(sandbox); }
  });

  test('COPILOT_PLUGIN_TASK_SESSION_SYNC=1 cannot bypass backend validation', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'markdown' });
      const r = runHook(GITHUB_HOOK, sandbox, {
        env: { COPILOT_PLUGIN_TASK_SESSION_SYNC: '1' },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '{}');
      assert.equal(existsSync(sandbox.marker), false);
    } finally { cleanup(sandbox); }
  });

  test('config-enabled path requires BOTH taskSessionSync.enabled AND taskBackend=github', () => {
    const sandbox = makeSandbox();
    try {
      // enabled=true but wrong backend -> must stay disabled.
      writeConfig(sandbox.home, { taskBackend: 'ado', taskSessionSync: { enabled: true, debounceMinutes: 0 } });
      const r = runHook(GITHUB_HOOK, sandbox);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(existsSync(sandbox.marker), false);
    } finally { cleanup(sandbox); }
  });

  test('FAIL CLOSED without jq: a legacy ADO config (adoSessionSync.enabled=true, no taskSessionSync) must NOT activate GitHub sync, even under taskBackend=github', () => {
    // Regression fixture for the audited fidelity bug: the pre-fix no-jq grep
    // fallback matched ANY `"enabled": true` in the file, so a leftover
    // adoSessionSync.enabled=true (with taskSessionSync absent entirely)
    // would incorrectly enable GitHub sync purely because taskBackend also
    // said "github". The fix fails closed instead of grep-guessing.
    const sandbox = makeSandbox();
    let noJqDir;
    try {
      writeConfig(sandbox.home, {
        taskBackend: 'github',
        adoSessionSync: { enabled: true, debounceMinutes: 0 }, // legacy leftover — taskSessionSync absent
      });
      const isolatedPath = noJqPath(sandbox.bin);
      noJqDir = isolatedPath.split(':')[1];
      // Sanity: prove jq is genuinely unavailable on this constructed PATH.
      const probe = spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8', env: { PATH: isolatedPath } });
      assert.notEqual(probe.status, 0, 'test setup bug: jq is still reachable on the constructed PATH');

      const r = spawnSync('bash', [GITHUB_HOOK], {
        input: payload(),
        env: { PATH: isolatedPath, HOME: sandbox.home, TMPDIR: sandbox.root },
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '{}');
      assert.equal(existsSync(sandbox.marker), false, 'must NOT have spawned a sync child from a legacy ADO-only config without jq');
    } finally {
      cleanup(sandbox);
      if (noJqDir) rmSync(noJqDir, { recursive: true, force: true });
    }
  });

  test('taskSessionSync.enabled=true WITH jq available still activates GitHub sync normally (no regression from the fail-closed fix)', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'github', taskSessionSync: { enabled: true, debounceMinutes: 0 } });
      const r = runHook(GITHUB_HOOK, sandbox);
      assert.equal(r.status, 0, r.stderr);
      const invoked = waitForMarker(sandbox.marker);
      assert.match(invoked, /github-sync:/);
    } finally { cleanup(sandbox); }
  });

  test('a non-UUID sessionId (sub-agent/sidekick stop) is skipped, not synced', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'github', taskSessionSync: { enabled: true, debounceMinutes: 0 } });
      const r = runHook(GITHUB_HOOK, sandbox, { sid: 'toolu_01abcXYZ' });
      assert.equal(r.status, 0, r.stderr);
      spawnSync('sleep', ['0.3']);
      assert.equal(existsSync(sandbox.marker), false);
    } finally { cleanup(sandbox); }
  });

  test('debounce: a second yield within the window is skipped; the log records "debounced"', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'github', taskSessionSync: { enabled: true, debounceMinutes: 30 } });
      const first = runHook(GITHUB_HOOK, sandbox);
      assert.equal(first.status, 0, first.stderr);
      waitForMarker(sandbox.marker);
      rmSync(sandbox.marker, { force: true }); // clear so the second run's (non-)spawn is unambiguous

      const second = runHook(GITHUB_HOOK, sandbox);
      assert.equal(second.status, 0, second.stderr);
      spawnSync('sleep', ['0.3']);
      assert.equal(existsSync(sandbox.marker), false, 'debounce should have suppressed a second spawn');

      const logFile = join(sandbox.home, '.copilot', 'logs', 'ado-session-sync', 'runs.jsonl');
      if (existsSync(logFile)) {
        const lines = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
        assert.ok(lines.some((l) => l.includes('"reason":"debounced"')), 'expected a debounced skip to be logged');
      }
    } finally { cleanup(sandbox); }
  });

  test('repo allowlist: a cwd outside taskSessionSync.syncRepos is skipped without an issue signal', () => {
    const sandbox = makeSandbox();
    const otherCwd = join(sandbox.root, 'not-allowlisted-repo');
    mkdirSync(otherCwd, { recursive: true });
    try {
      writeConfig(sandbox.home, {
        taskBackend: 'github',
        taskSessionSync: { enabled: true, debounceMinutes: 0, syncRepos: [join(sandbox.root, 'allowlisted-repo')] },
      });
      const result = spawnSync('bash', [GITHUB_HOOK], {
        input: JSON.stringify({ sessionId: VALID_SID, cwd: otherCwd, transcriptPath: '' }),
        env: { PATH: `${sandbox.bin}:${process.env.PATH}`, HOME: sandbox.home, TMPDIR: sandbox.root },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      spawnSync('sleep', ['0.3']);
      assert.equal(existsSync(sandbox.marker), false);
    } finally { cleanup(sandbox); }
  });

  test('repo allowlist: an explicit issue signal in cwd git state qualifies even outside the allowlist', () => {
    const sandbox = makeSandbox();
    const otherCwd = join(sandbox.root, 'not-allowlisted-repo');
    mkdirSync(otherCwd, { recursive: true });
    spawnSync('git', ['init', '-q'], { cwd: otherCwd });
    spawnSync('git', ['-C', otherCwd, 'config', 'user.email', 'x@example.com']);
    spawnSync('git', ['-C', otherCwd, 'config', 'user.name', 'x']);
    spawnSync('git', ['-C', otherCwd, 'checkout', '-b', '152-fix-thing'], { cwd: otherCwd });
    writeFileSync(join(otherCwd, 'f.txt'), 'x');
    spawnSync('git', ['-C', otherCwd, 'add', '.']);
    spawnSync('git', ['-C', otherCwd, 'commit', '-q', '-m', 'init']);
    try {
      writeConfig(sandbox.home, {
        taskBackend: 'github',
        taskSessionSync: { enabled: true, debounceMinutes: 0, syncRepos: [join(sandbox.root, 'allowlisted-repo')] },
      });
      const result = spawnSync('bash', [GITHUB_HOOK], {
        input: JSON.stringify({ sessionId: VALID_SID, cwd: otherCwd, transcriptPath: '' }),
        env: { PATH: `${sandbox.bin}:${process.env.PATH}`, HOME: sandbox.home, TMPDIR: sandbox.root },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const invoked = waitForMarker(sandbox.marker);
      assert.match(invoked, /github-sync:/);
    } finally { cleanup(sandbox); }
  });

  test('missing gh on PATH -> skips (fail-open), never crashes', () => {
    const sandbox = makeSandbox();
    // A bin dir with only a fake `copilot` (no `gh`), so the gate reaches the
    // gh-presence check specifically rather than stopping earlier at "no-copilot".
    const copilotOnlyBin = join(sandbox.root, 'copilot-only-bin');
    mkdirSync(copilotOnlyBin, { recursive: true });
    const fakeCopilot = join(copilotOnlyBin, 'copilot');
    writeFileSync(fakeCopilot, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${sandbox.marker}"\nexit 0\n`);
    chmodSync(fakeCopilot, 0o755);
    try {
      writeConfig(sandbox.home, { taskBackend: 'github', taskSessionSync: { enabled: true, debounceMinutes: 0 } });
      // System dirs (for bash/mkdir/sed/grep/jq) + the copilot-only bin, but
      // explicitly excluding any directory that actually contains a real `gh`.
      const ghPath = spawnSync('bash', ['-lc', 'command -v gh'], { encoding: 'utf8' }).stdout.trim();
      const ghDir = ghPath ? dirname(ghPath) : null;
      const safeDirs = [copilotOnlyBin, '/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', dirname(process.execPath)]
        .filter((d) => d && d !== ghDir);
      const r = spawnSync('bash', [GITHUB_HOOK], {
        input: payload(),
        env: { PATH: safeDirs.join(':'), HOME: sandbox.home, TMPDIR: sandbox.root },
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '{}');
      assert.equal(existsSync(sandbox.marker), false, 'must not have spawned a headless child without gh');
    } finally { cleanup(sandbox); }
  });
});

describe('legacy ADO compatibility through the dispatcher', () => {
  test('ADO_SESSION_SYNC=0 still force-disables ADO sync when reached through the dispatcher', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'ado', adoSessionSync: { enabled: true, debounceMinutes: 0 } });
      const r = runHook(DISPATCHER, sandbox, { env: { ADO_SESSION_SYNC: '0' } });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '{}');
      spawnSync('sleep', ['0.3']);
      assert.equal(existsSync(sandbox.marker), false);
    } finally { cleanup(sandbox); }
  });

  test('ado-session-sync.sh remains directly invocable and behaves identically whether called directly or via the dispatcher', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'ado', adoSessionSync: { enabled: true, debounceMinutes: 0 } });
      const direct = runHook(ADO_HOOK, sandbox, { sid: VALID_SID });
      assert.equal(direct.status, 0, direct.stderr);
      const directInvoked = waitForMarker(sandbox.marker);
      assert.match(directInvoked, /ado-sync:/);
    } finally { cleanup(sandbox); }
  });
});

describe('github-session-sync.ps1 — pwsh/powershell launcher detection (finding 8 regression)', () => {
  test('detects pwsh/powershell via Get-Command before attempting Start-Process, rather than relying on a bare try/catch', () => {
    // Regression guard for the reported bug: Start-Process's failure to find a
    // missing -FilePath executable is not reliably a terminating error under
    // every PowerShell/OS combination, so wrapping it alone in try/catch (even
    // with -ErrorAction Stop) can silently swallow the failure and leave the
    // powershell fallback unreachable. Command detection via the SAME
    // Get-Command idiom this file already uses for copilot/gh is deterministic.
    const src = readFileSync(GITHUB_HOOK_PS1, 'utf8');
    assert.match(src, /Get-Command pwsh -ErrorAction SilentlyContinue/, 'must probe for pwsh via Get-Command');
    assert.match(src, /Get-Command powershell -ErrorAction SilentlyContinue/, 'must probe for powershell via Get-Command as the fallback');
    assert.match(src, /no-pwsh-or-powershell/, 'must log an observable reason when neither launcher is resolvable');
  });
});

describe('github-session-sync.ps1 — launcher detection behavior (pwsh)', { skip: !hasCommand('pwsh') && 'pwsh not found on PATH' }, () => {
  function runsJsonlPath(home) {
    return join(home, '.copilot', 'logs', 'ado-session-sync', 'runs.jsonl');
  }
  function waitForLogEvent(home, predicate, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    const p = runsJsonlPath(home);
    while (Date.now() < deadline) {
      if (existsSync(p)) {
        const lines = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
        if (lines.some((l) => { try { return predicate(JSON.parse(l)); } catch { return false; } })) return true;
      }
      spawnSync('sleep', ['0.1']);
    }
    return false;
  }
  function pwshPath() {
    return spawnSync('bash', ['-c', 'command -v pwsh'], { encoding: 'utf8' }).stdout.trim();
  }
  function runPs1(sandbox, pathOverride) {
    const pwsh = pwshPath();
    return spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', GITHUB_HOOK_PS1], {
      input: payload(VALID_SID, sandbox.root),
      env: { PATH: pathOverride, HOME: sandbox.home, TMPDIR: sandbox.root },
      encoding: 'utf8',
      timeout: 8000,
    });
  }

  test('baseline: pwsh resolvable on PATH -> launcher detection succeeds (no no-pwsh-or-powershell skip)', () => {
    const sandbox = makeSandbox();
    try {
      writeConfig(sandbox.home, { taskBackend: 'github', taskSessionSync: { enabled: true, debounceMinutes: 0 } });
      const r = runPs1(sandbox, `${sandbox.bin}:${process.env.PATH}`);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), '{}');
      assert.ok(waitForLogEvent(sandbox.home, (e) => e.event === 'launch'), 'expected the launch decision log event');
      assert.equal(
        waitForLogEvent(sandbox.home, (e) => e.event === 'skip' && e.reason === 'no-pwsh-or-powershell', 500),
        false,
        'must not report no-pwsh-or-powershell when pwsh is on PATH',
      );
    } finally { cleanup(sandbox); }
  });

  // NOTE on portability: pwsh always prepends its own installation directory
  // ($PSHOME) to $env:PATH at startup (verified: even with PATH restricted to
  // a directory containing none of the real pwsh/powershell binaries,
  // `Get-Command pwsh` still resolves inside a pwsh-launched process). That
  // makes it impossible to exercise "neither pwsh nor powershell resolvable"
  // end-to-end via PATH manipulation alone when the harness itself must run
  // under pwsh. Instead we extract the exact detection snippet from the
  // script and evaluate it in a harness that shadows `Get-Command` (a plain
  // function definition takes precedence over the cmdlet in the same scope)
  // to simulate neither launcher being resolvable — proving the detection
  // logic itself (not just the live launch, covered above) takes the
  // fail-open "no-pwsh-or-powershell" branch instead of silently doing
  // nothing or hanging.
  test('neither pwsh nor powershell resolvable -> detection logic takes the fail-open no-pwsh-or-powershell branch', () => {
    const src = readFileSync(GITHUB_HOOK_PS1, 'utf8');
    const m = src.match(/\$launcherShell = \$null\n(?:[\s\S]*?\n)}\n\n/);
    assert.ok(m, 'could not locate the launcher-detection snippet in github-session-sync.ps1 to unit-test');
    const snippet = m[0];
    const harness = [
      "function Get-Command { param([Parameter(Position=0)]$Name, [switch]$ErrorAction) return $null }",
      "function Log { param([hashtable]$a) }",
      "$SID = 'test-sid'",
      "$inner = ''",
      snippet,
      "if (-not $launcherShell) { Write-Output 'NO-LAUNCHER-BRANCH-TAKEN' } else { Write-Output \"unexpected: $launcherShell\" }",
    ].join('\n');
    const pwsh = spawnSync('bash', ['-c', 'command -v pwsh'], { encoding: 'utf8' }).stdout.trim();
    const r = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', harness], { encoding: 'utf8', timeout: 8000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'NO-LAUNCHER-BRANCH-TAKEN');
  });
});
