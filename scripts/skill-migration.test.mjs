import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const prSkills = [
  'pr-comments', 'pr-diagnose', 'pr-prepare', 'pr-review',
  'pr-status', 'pr-validate', 'pr-watch',
];
const importedSkills = ['anatomy', 'bro', 'humanizer', 'show-me', 'teach'];

test('PR workflows owns exactly the seven migrated PR skills without collisions', () => {
  const marketplace = JSON.parse(read('.github/plugin/marketplace.json'));
  const entries = marketplace.plugins.filter(entry => entry.name === 'pr-workflows');
  assert.equal(entries.length, 1);
  assert.equal(resolve(root, entries[0].source), resolve(root, 'plugins/pr-workflows'));
  const plugin = JSON.parse(read('plugins/pr-workflows/plugin.json'));
  assert.equal(plugin.name, entries[0].name);
  assert.equal(plugin.version, entries[0].version);
  assert.deepEqual(readdirSync(resolve(root, 'plugins/pr-workflows/skills')).sort(), prSkills);
  for (const name of [...prSkills, ...importedSkills]) {
    const owners = marketplace.plugins.filter(entry =>
      existsSync(resolve(root, entry.source, 'skills', name, 'SKILL.md')));
    assert.equal(owners.length, 1, `${name} must have exactly one owner`);
    assert.equal(owners[0].name, prSkills.includes(name) ? 'pr-workflows' : 'mnmstack');
    assert.match(read(`${owners[0].source}/skills/${name}/SKILL.md`),
      new RegExp(`^name: ${name}$`, 'm'));
  }
});

test('supporting files, manual invocation flags, and upstream notices survive', () => {
  for (const path of [
    'pr-workflows/skills/pr-watch/scripts/watch.mjs',
    'pr-workflows/skills/pr-watch/scripts/watch.test.mjs',
    'pr-workflows/skills/pr-watch/references/monitoring.md',
    ...['MISSION', 'LEARNING-RECORD', 'RESOURCES', 'GLOSSARY'].map(name =>
      `mnmstack/skills/teach/${name}-FORMAT.md`),
    'mnmstack/skills/anatomy/kit/iso-kit.mjs',
    'mnmstack/skills/anatomy/references/craft.md',
    'mnmstack/skills/anatomy/.github/assets/dial-indicator.webp',
    'mnmstack/skills/humanizer/.claude-plugin/plugin.json',
    'mnmstack/skills/humanizer/.cursor-plugin/plugin.json',
    'mnmstack/skills/humanizer/agents/openai.yaml',
  ]) assert(existsSync(resolve(root, 'plugins', path)), `Missing resource: ${path}`);
  for (const name of ['bro', 'teach']) {
    assert.match(read(`plugins/mnmstack/skills/${name}/SKILL.md`),
      /^disable-model-invocation: true$/m);
  }
  for (const [name, copyright] of [
    ['anatomy', '2026 Ryan'],
    ['humanizer', '2025 Siqi Chen'],
    ['bro', '2026 Lauren Tan'],
    ['show-me', '2026 HumanLayer'],
    ['teach', '2026 Matt Pocock'],
  ]) {
    const license = read(`plugins/mnmstack/skills/${name}/LICENSE`);
    assert.match(license, /^MIT License\r?\n/);
    assert(license.includes(`Copyright (c) ${copyright}`));
    assert(license.includes('The above copyright notice and this permission notice shall be included'));
  }
  const humanizer = read('plugins/mnmstack/skills/humanizer/SKILL.md');
  assert.match(humanizer, /^metadata-version: "3\.1\.0"$/m);
  assert.doesNotMatch(humanizer.split('\n---')[0], /^description: [|>]|^metadata:|^  /m);
});

test('the watcher starts from a native filesystem path without provider access', () => {
  const script = resolve(root, 'plugins/pr-workflows/skills/pr-watch/scripts/watch.mjs');
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.ifError(help.error);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--interval 600/);
  const invalid = spawnSync(process.execPath, [script, 'wait', '--state', 'relative'],
    { encoding: 'utf8' });
  assert.ifError(invalid.error);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /State path must be absolute/);
});
