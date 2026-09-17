#!/usr/bin/env node
// github-sync-advisory.test.mjs — node:test coverage for the GitHub-backend path
// of the sessionStart advisory hook (ado-sync-advisory.sh), added when the
// opt-in gate was generalized to fire for taskBackend="github" too (shared log
// file: ~/.copilot/logs/ado-session-sync/runs.jsonl). Complements
// ado-sync-advisory.test.mjs, which covers the pre-existing ADO-only behavior
// unchanged.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = dirname(HERE);
const SH_HOOK = join(HOOKS_DIR, 'ado-sync-advisory.sh');

function hasCommand(cmd) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
}
const HAS_JQ = hasCommand('jq');

const VALID_SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'github-advisory-test-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  return { root, home };
}

function writeConfig(home, { enabled, taskBackend = 'github' } = {}) {
  mkdirSync(join(home, '.copilot', 'assistant'), { recursive: true });
  const config = {
    taskBackend,
    taskSessionSync: { enabled },
    github: { owner: 'example-org', ownerType: 'org', repo: 'tasks', projectNumber: 1 },
  };
  writeFileSync(join(home, '.copilot', 'assistant', 'config.json'), JSON.stringify(config));
}

function logDir(home) { return join(home, '.copilot', 'logs', 'ado-session-sync'); }

function writeRunsJsonl(home, lines) {
  mkdirSync(logDir(home), { recursive: true });
  writeFileSync(join(logDir(home), 'runs.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

function payload(sid = VALID_SID) { return JSON.stringify({ sessionId: sid }); }

function watermarkPath(home) { return join(logDir(home), 'seen.watermark'); }
function writeWatermark(home, ts) {
  mkdirSync(logDir(home), { recursive: true });
  writeFileSync(watermarkPath(home), ts);
}

function run(sandbox, { env = {} } = {}) {
  return spawnSync('bash', [SH_HOOK], {
    input: payload(),
    env: { PATH: process.env.PATH, HOME: sandbox.home, TMPDIR: sandbox.root, ...env },
    encoding: 'utf8',
  });
}

describe(
  'ado-sync-advisory.sh — GitHub-backend opt-in (taskSessionSync.enabled + taskBackend="github")',
  { skip: !HAS_JQ && 'jq not found on PATH (hard dependency of the advisory script)' },
  () => {
    test('taskBackend=github + taskSessionSync.enabled=true + a new result -> produces additionalContext', () => {
      const sandbox = makeSandbox();
      try {
        writeConfig(sandbox.home, { enabled: true });
        writeWatermark(sandbox.home, '2026-08-01T00:01:00Z'); // pre-seed baseline
        writeRunsJsonl(sandbox.home, [
          { ts: '2026-08-01T00:00:00Z', event: 'launch', parent: VALID_SID },
          { ts: '2026-08-01T00:01:00Z', event: 'result', parent: VALID_SID, action: 'commented+tagged', item: 42 },
          { ts: '2026-08-02T00:00:00Z', event: 'result', parent: VALID_SID, action: 'commented+tagged', item: 43 },
        ]);
        const r = run(sandbox);
        assert.equal(r.status, 0);
        assert.match(r.stdout, /additionalContext/);
        assert.match(r.stdout, /item\(s\) updated/);
      } finally { rmSync(sandbox.root, { recursive: true, force: true }); }
    });

    test('taskBackend=github but taskSessionSync.enabled=false stays silent', () => {
      const sandbox = makeSandbox();
      try {
        writeConfig(sandbox.home, { enabled: false });
        writeRunsJsonl(sandbox.home, [{ ts: '2026-08-01T00:00:00Z', event: 'result', parent: VALID_SID, action: 'commented+tagged', item: 1 }]);
        const r = run(sandbox);
        assert.equal(r.status, 0);
        assert.equal(r.stdout.trim(), '');
      } finally { rmSync(sandbox.root, { recursive: true, force: true }); }
    });

    test('taskBackend=ado with adoSessionSync.enabled=true is unaffected by the github generalization (still fires)', () => {
      const sandbox = makeSandbox();
      try {
        mkdirSync(join(sandbox.home, '.copilot', 'assistant'), { recursive: true });
        writeFileSync(join(sandbox.home, '.copilot', 'assistant', 'config.json'), JSON.stringify({
          taskBackend: 'ado',
          ado: { org: 'example-org', project: 'tasks' },
          adoSessionSync: { enabled: true },
        }));
        writeWatermark(sandbox.home, '2026-08-01T00:00:00Z');
        writeRunsJsonl(sandbox.home, [
          { ts: '2026-08-01T00:00:00Z', event: 'result', parent: VALID_SID, action: 'commented+tagged', item: 1 },
          { ts: '2026-08-02T00:00:00Z', event: 'result', parent: VALID_SID, action: 'commented+tagged', item: 2 },
        ]);
        const r = run(sandbox);
        assert.match(r.stdout, /additionalContext/);
      } finally { rmSync(sandbox.root, { recursive: true, force: true }); }
    });

    test('COPILOT_PLUGIN_GITHUB_SESSION_SYNC=0 force-disables regardless of config, before touching the lock dir', () => {
      const sandbox = makeSandbox();
      try {
        writeConfig(sandbox.home, { enabled: true });
        const r = run(sandbox, { env: { COPILOT_PLUGIN_GITHUB_SESSION_SYNC: '0' } });
        assert.equal(r.status, 0);
        assert.equal(r.stdout.trim(), '');
        assert.equal(existsSync(join(sandbox.home, '.copilot', 'logs', 'ado-session-sync', 'seen.watermark')), false);
      } finally { rmSync(sandbox.root, { recursive: true, force: true }); }
    });

    test('COPILOT_PLUGIN_TASK_SESSION_SYNC=0 (neutral alias) also force-disables', () => {
      const sandbox = makeSandbox();
      try {
        writeConfig(sandbox.home, { enabled: true });
        const r = run(sandbox, { env: { COPILOT_PLUGIN_TASK_SESSION_SYNC: '0' } });
        assert.equal(r.status, 0);
        assert.equal(r.stdout.trim(), '');
      } finally { rmSync(sandbox.root, { recursive: true, force: true }); }
    });

    test('COPILOT_PLUGIN_TASK_SESSION_SYNC=1 overrides opt-in for a valid GitHub backend', () => {
      const sandbox = makeSandbox();
      try {
        writeConfig(sandbox.home, { enabled: false, taskBackend: 'github' });
        writeWatermark(sandbox.home, '2026-08-01T00:00:00Z');
        writeRunsJsonl(sandbox.home, [
          { ts: '2026-08-01T00:00:00Z', event: 'result', parent: VALID_SID, action: 'commented+tagged', item: 1 },
          { ts: '2026-08-02T00:00:00Z', event: 'result', parent: VALID_SID, action: 'commented+tagged', item: 2 },
        ]);
        const r = run(sandbox, { env: { COPILOT_PLUGIN_TASK_SESSION_SYNC: '1' } });
        assert.match(r.stdout, /additionalContext/);
      } finally { rmSync(sandbox.root, { recursive: true, force: true }); }
    });
  },
);
