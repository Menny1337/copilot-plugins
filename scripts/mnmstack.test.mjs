import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = resolve(root, 'plugins/mnmstack');
const json = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const originalSkills = [
  'ado-session-sync', 'agent-architect-self-audit', 'agent-crafting',
  'agent-skill-audit', 'assistant-capture', 'assistant-query', 'az', 'browser',
  'create-image', 'github-session-sync', 'grok-search', 'hooks-crafting',
  'm365-messaging', 'memory', 'multi-model-review', 'narrate', 'plugin-crafting',
  'prompt-builder', 'publish-html', 'research-methodology',
  'scheduled-headless-copilot', 'scheduled-skill-review', 'skill-crafting',
  'skill-improvement-loop',
];

test('one mnmstack entry replaces all three default-stack plugins', () => {
  const marketplace = json('.github/plugin/marketplace.json');
  const plugin = json('plugins/mnmstack/plugin.json');
  const entries = marketplace.plugins.filter(entry => entry.name === 'mnmstack');
  assert.equal(entries.length, 1);
  assert.equal(resolve(root, entries[0].source), pluginRoot);
  assert.equal(plugin.name, 'mnmstack');
  assert.equal(entries[0].version, plugin.version);
  for (const name of ['core-skills', 'core-agents', 'meta']) {
    assert(!marketplace.plugins.some(entry => entry.name === name), `Legacy marketplace entry: ${name}`);
    assert(!existsSync(resolve(root, 'plugins', name)), `Legacy plugin tree: ${name}`);
  }
});

test('every existing skill remains discoverable under its original name', () => {
  for (const name of originalSkills) {
    const source = readFileSync(resolve(pluginRoot, 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(source, new RegExp(`^name: ${name}$`, 'm'));
  }
});

test('the consolidated default stack does not ship custom agents', () => {
  const manifest = json('plugins/mnmstack/plugin.json');
  assert.equal(manifest.agents, undefined);
  assert(!existsSync(resolve(pluginRoot, 'agents')));
});

test('ticket updates replace the retired assistant workflow wrapper', () => {
  assert(!existsSync(resolve(pluginRoot, 'skills/assistant-workflows/SKILL.md')));
  const source = readFileSync(resolve(pluginRoot, 'skills/issue-updates/SKILL.md'), 'utf8');
  assert.match(source, /^name: issue-updates$/m);
  for (const reference of [
    '../assistant-capture/SKILL.md',
    '../github-session-sync/SKILL.md',
    '../ado-session-sync/SKILL.md',
    '../az/references/devops-boards.md',
    '../assistant-capture/references/github-tasks.md',
    '../assistant-capture/references/ado-tasks.md',
  ]) {
    assert(source.includes(`](${reference})`), `Missing owner route: ${reference}`);
    assert(existsSync(resolve(pluginRoot, 'skills/issue-updates', reference)));
  }
});

test('all four original startup hooks survive exactly once in order', () => {
  const manifest = json('plugins/mnmstack/plugin.json');
  assert.equal(manifest.hooks, 'hooks/hooks.json');
  const config = json('plugins/mnmstack/hooks/hooks.json');
  assert.equal(config.version, 1);
  assert.deepEqual(Object.keys(config.hooks), ['sessionStart']);
  const expected = [
    ['lint-memory-advisory', 15], ['detect-tools', 15],
    ['link-commands', 10], ['ado-sync-advisory', 10],
  ].map(([name, timeoutSec]) => ({
    type: 'command',
    bash: `./hooks/${name}.sh`,
    powershell: `. ./hooks/${name}.ps1`,
    timeoutSec,
  }));
  assert.deepEqual(config.hooks.sessionStart, expected);
  for (const hook of expected) {
    assert(existsSync(resolve(pluginRoot, hook.bash)));
    assert(existsSync(resolve(pluginRoot, hook.powershell.slice(2))));
  }
});

test('shared assistant helpers remain adjacent to their skill and hook callers', () => {
  for (const file of [
    'assistant-config.mjs', 'assistant-config.sh',
    'assistant-config.ps1', 'github-cli-auth.mjs',
  ]) assert(existsSync(resolve(pluginRoot, 'shared', file)), `Missing helper: ${file}`);
  assert(readdirSync(resolve(pluginRoot, 'skills')).length >= originalSkills.length);
});

test('manual removal of a verified legacy command link allows safe recreation', () => {
  const fixture = resolve(root, `.mnmstack-link-fixture-${randomUUID()}`);
  const home = resolve(fixture, 'home');
  const bin = resolve(home, '.local/bin');
  const copilotHome = resolve(home, '.copilot');
  const scratch = resolve(fixture, 'scratch');
  const legacyTarget = resolve(copilotHome,
    'installed-plugins/fixture-marketplace/core-agents/skills/assistant-query/scripts/ado-query.mjs');
  const legacyLink = resolve(bin, 'ado-query');
  const unrelatedTarget = resolve(fixture, 'unrelated-command.mjs');
  const unrelatedLink = resolve(bin, 'github-query');
  const regularFile = resolve(bin, 'assistant-store');
  const runHook = () => {
    const result = spawnSync('/bin/bash', [resolve(pluginRoot, 'hooks/link-commands.sh')], {
      cwd: fixture,
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        HOME: home,
        PATH: '/usr/bin:/bin',
        COPILOT_HOME: copilotHome,
        COPILOT_CACHE_HOME: resolve(fixture, 'custom-cache'),
        XDG_CACHE_HOME: resolve(fixture, 'xdg-cache'),
        TMPDIR: scratch,
      },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  };
  const assertForeignEntriesUnchanged = () => {
    assert(lstatSync(unrelatedLink).isSymbolicLink());
    assert.equal(readlinkSync(unrelatedLink), unrelatedTarget);
    assert.equal(readFileSync(unrelatedTarget, 'utf8'), 'unrelated target\n');
    assert(lstatSync(regularFile).isFile());
    assert.equal(readFileSync(regularFile, 'utf8'), 'user-owned command\n');
  };

  try {
    mkdirSync(bin, { recursive: true });
    mkdirSync(copilotHome, { recursive: true });
    mkdirSync(scratch, { recursive: true });
    symlinkSync(legacyTarget, legacyLink);
    writeFileSync(unrelatedTarget, 'unrelated target\n');
    symlinkSync(unrelatedTarget, unrelatedLink);
    writeFileSync(regularFile, 'user-owned command\n');

    runHook();
    assert(lstatSync(legacyLink).isSymbolicLink());
    assert.equal(readlinkSync(legacyLink), legacyTarget);
    assert.equal(existsSync(legacyLink), false);
    assertForeignEntriesUnchanged();

    unlinkSync(legacyLink);
    runHook();
    assert(lstatSync(legacyLink).isSymbolicLink());
    assert.equal(readlinkSync(legacyLink),
      resolve(pluginRoot, 'skills/assistant-query/scripts/ado-query.mjs'));
    assert(existsSync(legacyLink));
    assertForeignEntriesUnchanged();
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
