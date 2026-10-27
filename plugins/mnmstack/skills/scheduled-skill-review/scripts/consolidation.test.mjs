import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, '../../../../..');
const artifactDir = process.env.SKILL_REVIEW_TEST_ARTIFACT_DIR ?? process.env.VERSION_TEST_ARTIFACT_DIR;

function fixture(t) {
  assert.ok(artifactDir && isAbsolute(artifactDir),
    'Set SKILL_REVIEW_TEST_ARTIFACT_DIR to an authorized absolute artifact directory');
  const base = resolve(artifactDir);
  assert.ok(base !== repoRoot && !base.startsWith(`${repoRoot}${sep}`),
    'Fixtures must not write inside the source checkout');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'consolidation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configPath = join(root, '.copilot/agent-architect/skill-reviews/config.json');
  const write = (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  return {
    root, write,
    env: { ...process.env, HOME: root },
    config: (value) => write(configPath, JSON.stringify(value)),
  };
}

function readConfig(f, libPath = join(scriptsDir, 'lib.mjs')) {
  const url = pathToFileURL(libPath).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { loadConfig } from ${JSON.stringify(url)}; console.log(JSON.stringify(loadConfig()));`,
  ], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('plugin fallback follows its source location, cache fallback uses mnmstack, explicit config is preserved', t => {
  const f = fixture(t);
  const defaults = readConfig(f);
  assert.equal(defaults.pluginDir, resolve(scriptsDir, '../../..'));
  assert.equal(defaults.marketplaceName, '');
  assert.equal(defaults.selfMarker, 'COPILOT_PLUGIN_SCHEDULED_REVIEW');
  assert.deepEqual(defaults.include, []);
  assert.deepEqual(defaults.exclude, []);
  assert.deepEqual(defaults.skillPaths, []);
  assert.deepEqual(defaults.skillFolders, []);
  const relocatedPlugin = join(f.root, 'repo/plugins/mnmstack');
  const relocatedLibrary = join(relocatedPlugin, 'skills/scheduled-skill-review/scripts/lib.mjs');
  f.write(relocatedLibrary, readFileSync(join(scriptsDir, 'lib.mjs'), 'utf8'));
  assert.equal(readConfig(f, relocatedLibrary).pluginDir, relocatedPlugin);
  f.config({ cacheDir: '~/cache', schedule: { hour: 5 } });
  const fallback = readConfig(f);
  assert.equal(fallback.pluginDir, join(f.root, 'cache/plugins/mnmstack'));
  assert.deepEqual(fallback.schedule, { hour: 5, minute: 0, weekdays: [] });
  const explicit = {
    pluginDir: '/explicit/plugins/meta', cacheDir: '~/cache',
    marketplaceName: 'user-marketplace', selfMarker: 'USER_REVIEW_MARKER',
    include: ['chosen'], exclude: ['excluded'], skillPaths: ['/external/SKILL.md'],
    skillFolders: ['/external/folder'], autoDeploy: false, autoRevert: false,
  };
  f.config(explicit);
  const configured = readConfig(f);
  for (const [key, value] of Object.entries(explicit)) assert.deepEqual(configured[key], value);
  f.config({ pluginDir: '' });
  assert.equal(readConfig(f).pluginDir, defaults.pluginDir);
});

test('main-session review self-exclusion and configured marketplace/external target scope stay intact', t => {
  const f = fixture(t);
  const repo = join(f.root, 'repo');
  const sessions = join(f.root, 'sessions');
  const externalSkill = join(f.root, 'external/SKILL.md');
  f.write(join(repo, '.github/plugin/marketplace.json'), JSON.stringify({
    plugins: [
      { name: 'mnmstack', source: 'plugins/mnmstack' },
      { name: 'example-reviewers', source: 'plugins/example-reviewers' },
    ],
  }));
  for (const name of ['skill-crafting', 'agent-skill-audit']) {
    f.write(join(repo, `plugins/mnmstack/skills/${name}/SKILL.md`), `---\nname: ${name}\n---\n`);
  }
  f.write(join(repo, 'plugins/example-reviewers/agents/reviewer.agent.md'), '---\nname: reviewer\n---\n');
  f.write(externalSkill, '---\nname: external-skill\ndescription: External fixture\n---\n');
  const marker = 'USER_REVIEW_MARKER';
  f.config({
    repoDir: repo, sessionStateDir: sessions, skillPaths: [externalSkill],
    marketplaceName: 'user-marketplace', selfMarker: marker,
    include: ['skill-crafting', 'agent-skill-audit', 'external-skill', 'reviewer'],
    exclude: ['agent-skill-audit'],
  });
  const timestamp = new Date().toISOString();
  const event = (type, data) => JSON.stringify({ timestamp, type, data });
  const usage = [
    event('skill.invoked', { name: 'skill-crafting' }),
    event('skill.invoked', { name: 'agent-skill-audit' }),
    event('skill.invoked', { name: 'external-skill' }),
    event('skill.invoked', { name: 'unconfigured-skill' }),
    event('subagent.started', { agentName: 'example-reviewers:reviewer' }),
    event('subagent.started', { agentName: 'unconfigured:other-agent' }),
  ];
  f.write(join(sessions, 'human-session/events.jsonl'), usage.join('\n') + '\n');
  f.write(join(sessions, 'main-agent-review/events.jsonl'), [
    event('user.message', { content: `Use skill-improvement-loop in this main session. [${marker} run=fixture]` }),
    ...usage,
  ].join('\n') + '\n');
  const result = spawnSync(process.execPath, [join(scriptsDir, 'scan-usage.mjs')], {
    env: f.env, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.deepEqual(manifest.units.map(({ unit }) => unit).sort(),
    ['external-skill', 'reviewer', 'skill-crafting']);
  assert.deepEqual(manifest.ourUnits.agents, ['reviewer']);
  for (const unit of manifest.units) assert.deepEqual(unit.sessions, ['human-session']);
  assert.equal(manifest.unitEntries.find(({ name }) => name === 'external-skill').source, 'external');
  assert.equal(manifest.unitEntries.find(({ name }) => name === 'skill-crafting').plugin, 'mnmstack');
});

test('batch review uses main-session skills without an agent flag and retains CLI restrictions', t => {
  const f = fixture(t);
  const source = readFileSync(join(scriptsDir, 'run-batch-review.sh'), 'utf8');
  assert.doesNotMatch(source, /--agent\b/);
  const promptLines = source.split('\n').filter(line => /^\s+local prompt="/.test(line));
  assert.equal(promptLines.length, 2);
  const authoring = source.match(/  local authoringSkill="skill-crafting"\n[^\n]+\n[^\n]+/)[0];
  const externalPrefix = source.split('\n').find(line =>
    line.includes('prompt="Use the skill-improvement-loop, skill-crafting,'));
  for (const [index, type] of [[0, 'skill'], [1, 'skill'], [1, 'agent']]) {
    const cwdVariable = index === 0 ? 'stage' : 'wt';
    const invocation = source.match(new RegExp(
      `\\( cd "\\$${cwdVariable}" && agency copilot \\\\\\n[\\s\\S]*?--allow-all-tools \\)`,
    ))?.[0];
    assert.ok(invocation, 'Must test the actual bounded invocation');
    const capture = join(f.root, `argv-${index}-${type}`);
    const script = [
      'set -eu',
      'agency() { printf "%s\\0" "$@" > "$CAPTURE"; }',
      promptLines[index].replace('local prompt=', 'prompt='),
      (index === 0 ? externalPrefix : authoring.replace('local authoringSkill=', 'authoringSkill=')),
      invocation,
    ].join('\n');
    const result = spawnSync('/bin/bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...f.env, CAPTURE: capture, SELF_MARKER: 'USER_REVIEW_MARKER', RUN_ID: 'fixture',
        unit: 'chosen', type, mode: 'candidate', stage: f.root, wt: f.root,
        stagedSkill: join(f.root, 'SKILL.md'), localResult: join(f.root, 'result.json'),
        wt_result: join(f.root, 'result.json'), PLUGIN_DIR: '/synthetic/plugins/mnmstack',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const args = readFileSync(capture, 'utf8').split('\0').slice(0, -1);
    assert.deepEqual(args.slice(0, 4), ['copilot', '--no-config-plugins', '--plugin', 'local:/synthetic/plugins/mnmstack']);
    assert.ok(!args.includes('--agent'));
    assert.ok(args.includes('--allow-all-tools'));
    assert.ok(!args.includes('--allow-all'));
    assert.equal(args[args.indexOf('--disable-mcp-server') + 1], 'computer-use');
    const prompt = args[args.indexOf('-p') + 1];
    assert.match(prompt, /Use the skill-improvement-loop, (skill-crafting|agent-crafting), and agent-skill-audit skills in this main session/);
    assert.ok(prompt.includes(type === 'agent' ? 'agent-crafting' : 'skill-crafting'));
    assert.match(prompt, /\[USER_REVIEW_MARKER run=fixture\]/);
    assert.match(prompt, /Make at most ONE|make at most ONE/);
    if (index === 0) assert.match(prompt, /Do not run marketplace versioning/);
    else assert.match(prompt, /Stop on any generator or check failure/);
  }
});
