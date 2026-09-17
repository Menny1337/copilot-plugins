#!/usr/bin/env node
// github-session-sync.test.mjs — node:test coverage for the r3 finding-8
// dependency-free Node fallback github-session-sync.sh uses to read
// ~/.copilot/assistant/config.json when `jq` is not on PATH.
//
// Strategy: same sandboxing approach as ado-session-sync.test.mjs (temp HOME,
// a fake `copilot` shadowed onto PATH so we can prove whether a child was
// launched without spawning a real headless agent, a fake `gh` so
// `command -v gh` succeeds without a real network-capable binary) PLUS a
// curated "no-jq" PATH: a one-time symlink farm cloning every /usr/bin
// executable EXCEPT jq, combined with /bin (jq lives only in /usr/bin on this
// platform, confirmed at farm-build time) — so `jq` is genuinely unresolvable
// on PATH, not merely shadowed by an early non-functional stub, while every
// other tool the script needs (sed, grep, head, dirname, nohup, uuidgen, ...)
// stays real. A third curated PATH (no-jq AND no-node) proves the original
// "neither available -> fail closed" safety net still holds.
//
// config-field.test.mjs covers config-field.mjs directly and exhaustively
// (all query kinds, malformed-config fail-closed contract); this file proves
// the fallback is actually wired into the real hook script end-to-end.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, readdirSync,
  symlinkSync, existsSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = dirname(HERE);
const SH_HOOK = join(HOOKS_DIR, 'github-session-sync.sh');

const VALID_SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const REAL_USR_BIN = '/usr/bin';
const NODE_BIN_DIR = dirname(process.execPath);

// --- one-time "no jq" symlink farm, shared read-only across every test in
// this file (building ~900 symlinks per test would be needlessly slow). ---
let farmDir;
function noJqFarmDir() {
  if (farmDir) return farmDir;
  farmDir = mkdtempSync(join(tmpdir(), 'nojq-farm-'));
  for (const name of readdirSync(REAL_USR_BIN)) {
    if (name === 'jq') continue; // the one exclusion — everything else stays real
    try {
      symlinkSync(join(REAL_USR_BIN, name), join(farmDir, name));
    } catch {
      // Ignore individual broken/unreadable entries (e.g. dangling symlinks
      // already present in /usr/bin) — irrelevant to this suite's needs.
    }
  }
  return farmDir;
}
after(() => {
  if (farmDir) rmSync(farmDir, { recursive: true, force: true });
});

/** PATH with jq unresolvable but node, sed, grep, dirname, etc. all real. */
function noJqPath(sandboxBin) {
  return `${sandboxBin}:${noJqFarmDir()}:/bin:${NODE_BIN_DIR}`;
}
/** PATH with NEITHER jq NOR node resolvable — the original safety-net case. */
function noJqNoNodePath(sandboxBin) {
  return `${sandboxBin}:${noJqFarmDir()}:/bin`;
}
/** Normal PATH (jq present) — baseline/regression checks. */
function normalPath(sandboxBin) {
  return `${sandboxBin}:${process.env.PATH}`;
}

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'github-sync-test-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const marker = join(root, 'copilot-invocations.log');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });

  // Fake `copilot`: records invocation, exits immediately. Proves whether the
  // launcher attempted to spawn a headless child without running a real one.
  const fakeCopilot = join(bin, 'copilot');
  writeFileSync(
    fakeCopilot,
    `#!/usr/bin/env bash\nprintf 'GH_TOKEN=%s GITHUB_TOKEN=%s ARGS=%s\\n' "\${GH_TOKEN-<unset>}" "\${GITHUB_TOKEN-<unset>}" "$*" >> "${marker}"\nexit 0\n`,
  );
  chmodSync(fakeCopilot, 0o755);

  // Fake `gh`: identity probes resolve differently depending on whether an
  // ambient token is present, mirroring gh's env-token vs keyring precedence.
  const fakeGh = join(bin, 'gh');
  writeFileSync(fakeGh, `#!/usr/bin/env bash
if [ "$*" = "api user --jq .login" ]; then
  [ -n "\${FAKE_GH_DELAY_SECONDS:-}" ] && sleep "\${FAKE_GH_DELAY_SECONDS}"
  if [ -n "\${GH_TOKEN:-}\${GITHUB_TOKEN:-}" ]; then
    printf '%s\\n' "\${FAKE_GH_AMBIENT_LOGIN:-ambient-user}"
  else
    printf '%s\\n' "\${FAKE_GH_KEYRING_LOGIN:-keyring-user}"
  fi
fi
exit 0
`);
  chmodSync(fakeGh, 0o755);

  // Keep UUID generation hermetic so the detached runner never falls back to
  // the host Python binary (which can write late cache files under temp HOME).
  const fakeUuidgen = join(bin, 'uuidgen');
  writeFileSync(fakeUuidgen, '#!/usr/bin/env bash\necho "11111111-2222-4333-8444-555555555555"\n');
  chmodSync(fakeUuidgen, 0o755);

  return { root, home, bin, marker };
}

function writeConfig(home, {
  taskBackend = 'github', enabled, debounceMinutes, syncRepos, github,
} = {}) {
  mkdirSync(join(home, '.copilot', 'assistant'), { recursive: true });
  const taskSessionSync = {};
  if (enabled !== undefined) taskSessionSync.enabled = enabled;
  if (debounceMinutes !== undefined) taskSessionSync.debounceMinutes = debounceMinutes;
  if (syncRepos !== undefined) taskSessionSync.syncRepos = syncRepos;
  const config = {
    taskBackend,
    taskSessionSync,
    github: {
      owner: 'example-org',
      ownerType: 'org',
      repo: 'tasks',
      projectNumber: 1,
      ...github,
    },
  };
  writeFileSync(join(home, '.copilot', 'assistant', 'config.json'), JSON.stringify(config));
}

function writeMalformedConfig(home) {
  mkdirSync(join(home, '.copilot', 'assistant'), { recursive: true });
  writeFileSync(join(home, '.copilot', 'assistant', 'config.json'), '{ "taskSessionSync": { "enabled": true, ');
}

function payload(sid = VALID_SID, cwd, transcriptPath = '') {
  return JSON.stringify({ sessionId: sid, cwd: cwd ?? '/tmp', transcriptPath });
}

function waitForMarker(marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(marker)) {
      const content = readFileSync(marker, 'utf8');
      if (content.trim().length > 0) {
        spawnSync('sleep', ['0.05']);
        return content;
      }
    }
    spawnSync('sleep', ['0.05']);
  }
  return existsSync(marker) ? readFileSync(marker, 'utf8') : '';
}

function runHook(sandbox, { env = {}, sid = VALID_SID, cwd, transcriptPath, path } = {}) {
  const result = spawnSync('bash', [SH_HOOK], {
    input: payload(sid, cwd, transcriptPath),
    env: {
      PATH: path,
      HOME: sandbox.home,
      TMPDIR: sandbox.root,
      ...env,
    },
    encoding: 'utf8',
  });
  return result;
}

describe('github-session-sync.sh — Node fallback with jq absent (finding 8)', () => {
  test('jq is genuinely unresolvable on the curated no-jq PATH (sandity check on the harness itself)', () => {
    const sandbox = makeSandbox();
    const check = spawnSync('bash', ['-c', 'command -v jq'], {
      env: { PATH: noJqPath(sandbox.bin), HOME: sandbox.home },
      encoding: 'utf8',
    });
    assert.notEqual(check.status, 0, 'jq must not resolve on the no-jq PATH used by the rest of this suite');
    rmSync(sandbox.root, { recursive: true, force: true });
  });

  test('valid config, enabled=true -> opt-in resolves true via node fallback, child launched', () => {
    const sandbox = makeSandbox();
    writeConfig(sandbox.home, { enabled: true, debounceMinutes: 0 });

    const result = runHook(sandbox, { path: noJqPath(sandbox.bin) });

    assert.equal(result.status, 0, `hook must exit 0; stderr: ${result.stderr}`);
    assert.equal(result.stdout, '{}');
    const invoked = waitForMarker(sandbox.marker, 5000);
    assert.notEqual(invoked, '', 'a valid enabled config must launch the sync child via the node fallback, not fail closed just because jq is absent');

    rmSync(sandbox.root, { recursive: true, force: true });
  });

  test('valid config, enabled=false -> opt-in resolves false via node fallback, no child launched', () => {
    const sandbox = makeSandbox();
    writeConfig(sandbox.home, { enabled: false, debounceMinutes: 0 });

    const result = runHook(sandbox, { path: noJqPath(sandbox.bin) });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '{}');
    const invoked = waitForMarker(sandbox.marker, 800);
    assert.equal(invoked, '', 'an explicitly disabled config must not launch a child');

    rmSync(sandbox.root, { recursive: true, force: true });
  });

  test('valid config, taskBackend != github -> opt-in resolves false via node fallback', () => {
    const sandbox = makeSandbox();
    writeConfig(sandbox.home, { taskBackend: 'ado', enabled: true, debounceMinutes: 0 });

    const result = runHook(sandbox, { path: noJqPath(sandbox.bin) });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '{}');
    const invoked = waitForMarker(sandbox.marker, 800);
    assert.equal(invoked, '', 'the github hook must stay opt-out when taskBackend is not "github", even if taskSessionSync.enabled is true');

    rmSync(sandbox.root, { recursive: true, force: true });
  });

  test('malformed config -> fails closed via node fallback (no child launched, no crash)', () => {
    const sandbox = makeSandbox();
    writeMalformedConfig(sandbox.home);

    const result = runHook(sandbox, { path: noJqPath(sandbox.bin) });

    assert.equal(result.status, 0, `hook must still exit 0 (fail-open on startup) even with malformed config; stderr: ${result.stderr}`);
    assert.equal(result.stdout, '{}');
    const invoked = waitForMarker(sandbox.marker, 800);
    assert.equal(invoked, '', 'malformed config must fail CLOSED (opt-in stays disabled), never crash and never guess enabled');

    rmSync(sandbox.root, { recursive: true, force: true });
  });

  test('debounce window from config is honored via node fallback', () => {
    const sandbox = makeSandbox();
    writeConfig(sandbox.home, { enabled: true, debounceMinutes: 60 });
    // Pre-seed a very recent "last synced" stamp for this exact session id, in
    // the same stamp dir the hook itself computes from TMPDIR.
    const stateDir = join(sandbox.root, 'github-session-sync');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, `${VALID_SID}.last`), String(Math.floor(Date.now() / 1000)));

    const result = runHook(sandbox, { path: noJqPath(sandbox.bin) });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '{}');
    const invoked = waitForMarker(sandbox.marker, 800);
    assert.equal(invoked, '', 'a 60-minute debounce window read via the node fallback must suppress a sync that just ran');

    rmSync(sandbox.root, { recursive: true, force: true });
  });

  test('syncRepos eligibility via node fallback: cwd under a configured repo -> child launched', () => {
    const sandbox = makeSandbox();
    const repoDir = join(sandbox.root, 'my-repo');
    mkdirSync(join(repoDir, 'subdir'), { recursive: true });
    writeConfig(sandbox.home, { enabled: true, debounceMinutes: 0, syncRepos: [repoDir] });

    const result = runHook(sandbox, { path: noJqPath(sandbox.bin), cwd: join(repoDir, 'subdir') });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '{}');
    const invoked = waitForMarker(sandbox.marker, 5000);
    assert.notEqual(invoked, '', 'cwd nested under a configured syncRepos entry (read via the node fallback) must be eligible');

    rmSync(sandbox.root, { recursive: true, force: true });
  });

  test('syncRepos eligibility via node fallback: cwd outside every configured repo, no work-item signal -> skipped', () => {
    const sandbox = makeSandbox();
    const configuredRepo = join(sandbox.root, 'configured-repo');
    const unrelatedCwd = join(sandbox.root, 'unrelated-plain-dir');
    mkdirSync(configuredRepo, { recursive: true });
    mkdirSync(unrelatedCwd, { recursive: true });
    writeConfig(sandbox.home, { enabled: true, debounceMinutes: 0, syncRepos: [configuredRepo] });

    const result = runHook(sandbox, { path: noJqPath(sandbox.bin), cwd: unrelatedCwd, transcriptPath: '' });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '{}');
    const invoked = waitForMarker(sandbox.marker, 800);
    assert.equal(invoked, '', 'a cwd outside every syncRepos entry, with no transcript issue reference and no numbered git branch, must be skipped as not-eligible');

    rmSync(sandbox.root, { recursive: true, force: true });
  });

  test('an ineligible stop does not debounce a later eligible stop from the same session', () => {
    const sandbox = makeSandbox();
    const configuredRepo = join(sandbox.root, 'configured-repo');
    const unrelatedCwd = join(sandbox.root, 'unrelated-plain-dir');
    mkdirSync(configuredRepo, { recursive: true });
    mkdirSync(unrelatedCwd, { recursive: true });
    writeConfig(sandbox.home, {
      enabled: true, debounceMinutes: 60, syncRepos: [configuredRepo],
    });

    const first = runHook(sandbox, {
      path: noJqPath(sandbox.bin), cwd: unrelatedCwd, transcriptPath: '',
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(waitForMarker(sandbox.marker, 500), '', 'the ineligible first stop must not launch');

    const second = runHook(sandbox, {
      path: noJqPath(sandbox.bin), cwd: configuredRepo, transcriptPath: '',
    });
    assert.equal(second.status, 0, second.stderr);
    assert.notEqual(
      waitForMarker(sandbox.marker, 5000),
      '',
      'the later eligible stop must launch instead of being suppressed by a stamp from the ineligible stop',
    );

    rmSync(sandbox.root, { recursive: true, force: true });
  });
});

describe('github-session-sync.sh — user-owned board authentication', () => {
  test('matching ambient-token identity is preserved for the sync child', () => {
    const sandbox = makeSandbox();
    writeConfig(sandbox.home, {
      enabled: true,
      debounceMinutes: 0,
      github: { owner: 'managed-user', ownerType: 'user' },
    });

    const result = runHook(sandbox, {
      path: noJqPath(sandbox.bin),
      env: {
        GH_TOKEN: 'ambient-token',
        GITHUB_TOKEN: 'secondary-token',
        FAKE_GH_AMBIENT_LOGIN: 'managed-user',
        FAKE_GH_KEYRING_LOGIN: 'managed-user',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const invoked = waitForMarker(sandbox.marker, 5000);
    assert.match(invoked, /GH_TOKEN=ambient-token GITHUB_TOKEN=secondary-token/);
    rmSync(sandbox.root, { recursive: true, force: true });
  });

  test('mismatched ambient token falls back to a matching keyring identity', () => {
    const sandbox = makeSandbox();
    writeConfig(sandbox.home, {
      enabled: true,
      debounceMinutes: 0,
      github: { owner: 'managed-user', ownerType: 'user' },
    });

    const result = runHook(sandbox, {
      path: noJqPath(sandbox.bin),
      env: {
        GH_TOKEN: 'ambient-token',
        GITHUB_TOKEN: 'secondary-token',
        FAKE_GH_AMBIENT_LOGIN: 'wrong-user',
        FAKE_GH_KEYRING_LOGIN: 'managed-user',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const invoked = waitForMarker(sandbox.marker, 5000);
    assert.match(invoked, /GH_TOKEN=<unset> GITHUB_TOKEN=<unset>/);
    rmSync(sandbox.root, { recursive: true, force: true });
  });

  test('mismatched ambient and keyring identities fail closed without starting the sync child', () => {
    const sandbox = makeSandbox();
    writeConfig(sandbox.home, {
      enabled: true,
      debounceMinutes: 0,
      github: { owner: 'managed-user', ownerType: 'user' },
    });

    const result = runHook(sandbox, {
      path: noJqPath(sandbox.bin),
      env: {
        GH_TOKEN: 'ambient-token',
        GITHUB_TOKEN: 'secondary-token',
        FAKE_GH_AMBIENT_LOGIN: 'wrong-user',
        FAKE_GH_KEYRING_LOGIN: 'another-user',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const invoked = waitForMarker(sandbox.marker, 1500);
    assert.equal(invoked, '');
    const log = readFileSync(join(sandbox.home, '.copilot', 'logs', 'ado-session-sync', 'runs.jsonl'), 'utf8');
    assert.match(log, /"event":"error"/);
    assert.match(log, /"reason":"write-blocked"/);
    rmSync(sandbox.root, { recursive: true, force: true });
  });

  test('slow identity probes run after detachment and do not block agentStop', () => {
    const sandbox = makeSandbox();
    writeConfig(sandbox.home, {
      enabled: true,
      debounceMinutes: 0,
      github: { owner: 'managed-user', ownerType: 'user' },
    });

    const startedAt = Date.now();
    const result = runHook(sandbox, {
      path: noJqPath(sandbox.bin),
      env: {
        GH_TOKEN: 'ambient-token',
        FAKE_GH_AMBIENT_LOGIN: 'wrong-user',
        FAKE_GH_KEYRING_LOGIN: 'managed-user',
        FAKE_GH_DELAY_SECONDS: '2',
      },
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '{}');
    assert.ok(elapsedMs < 1250, `agentStop must return before detached auth probes complete (elapsed ${elapsedMs}ms)`);
    const invoked = waitForMarker(sandbox.marker, 7000);
    assert.match(invoked, /GH_TOKEN=<unset> GITHUB_TOKEN=<unset>/);
    rmSync(sandbox.root, { recursive: true, force: true });
  });
});

describe('github-session-sync.sh — regression: jq-present behavior is unaffected by the fallback', () => {
  test('valid config, enabled=true, jq present -> child launched exactly as before', { skip: !hasJq() && 'jq not available on this machine to validate the baseline path' }, () => {
    const sandbox = makeSandbox();
    writeConfig(sandbox.home, { enabled: true, debounceMinutes: 0 });

    const result = runHook(sandbox, { path: normalPath(sandbox.bin) });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '{}');
    const invoked = waitForMarker(sandbox.marker, 5000);
    assert.notEqual(invoked, '', 'existing jq-backed behavior must still launch a sync child');

    rmSync(sandbox.root, { recursive: true, force: true });
  });

  test('malformed config, jq present -> still fails closed', { skip: !hasJq() && 'jq not available on this machine to validate the baseline path' }, () => {
    const sandbox = makeSandbox();
    writeMalformedConfig(sandbox.home);

    const result = runHook(sandbox, { path: normalPath(sandbox.bin) });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '{}');
    const invoked = waitForMarker(sandbox.marker, 800);
    assert.equal(invoked, '', 'malformed config must fail closed under jq exactly as it does under the node fallback');

    rmSync(sandbox.root, { recursive: true, force: true });
  });
});

describe('github-session-sync.sh — neither jq nor node available: original safety net still holds', () => {
  test('valid enabled config, but neither jq nor node on PATH -> fails closed (no silent guess, no crash)', () => {
    const sandbox = makeSandbox();
    writeConfig(sandbox.home, { enabled: true, debounceMinutes: 0 });

    const result = runHook(sandbox, { path: noJqNoNodePath(sandbox.bin) });

    assert.equal(result.status, 0, `hook must still exit 0 (fail-open on startup) even with no parser at all; stderr: ${result.stderr}`);
    assert.equal(result.stdout, '{}');
    const invoked = waitForMarker(sandbox.marker, 800);
    assert.equal(invoked, '', 'with neither jq nor node available, the opt-in decision must stay fail-closed exactly as it did before the node fallback existed');

    rmSync(sandbox.root, { recursive: true, force: true });
  });
});

function hasJq() {
  const r = spawnSync('sh', ['-c', 'command -v jq']);
  return r.status === 0;
}
