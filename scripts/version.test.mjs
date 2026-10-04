import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { MAX_PLAN_BYTES, MAX_GIT_BYTES } from './version-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marketplacePath = '.github/plugin/marketplace.json';
const manifestPath = 'plugins/example/plugin.json';
const changelogPath = 'plugins/example/CHANGELOG.md';

function fixture(t) {
  const directory = process.env.VERSION_TEST_ARTIFACT_DIR ?? process.env.SKILL_REVIEW_TEST_ARTIFACT_DIR;
  assert.ok(directory && isAbsolute(directory), 'Set VERSION_TEST_ARTIFACT_DIR or SKILL_REVIEW_TEST_ARTIFACT_DIR');
  assert.ok(resolve(directory) !== repoRoot && !resolve(directory).startsWith(repoRoot + sep));
  mkdirSync(directory, { recursive: true });
  const root = mkdtempSync(join(directory, 'version-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, HOME: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  const git = args => execFileSync('git', args, { cwd: root, env, maxBuffer: MAX_GIT_BYTES * 2, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const json = (path, data) => write(path, JSON.stringify(data, null, 2) + '\n');
  const commit = subject => {
    git(['add', '-A']);
    git(['commit', '-m', subject]);
    return git(['rev-parse', 'HEAD']);
  };
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const script of ['version.mjs', 'version-contract.mjs']) {
    copyFileSync(join(repoRoot, 'scripts', script), join(root, 'scripts', script));
  }
  json(marketplacePath, {
    name: 'fixture', metadata: { version: '1.0.0' },
    plugins: [{ name: 'example', version: '1.0.0', source: 'plugins/example', description: 'Fixture' }],
  });
  json(manifestPath, { name: 'example', version: '1.0.0' });
  write('plugins/example/content.md', 'Before\n');
  write(changelogPath, '# Changelog\n\nAuthored preamble.\n\n## [1.0.0] - 2026-01-01\n\n- Historical text.\n');
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['config', 'core.hooksPath', '/dev/null']);
  const base = commit('chore: baseline');
  const run = (args, input, clock) => spawnSync(process.execPath,
    ['scripts/version.mjs', ...args],
    { cwd: root, env: { ...env, ...(clock ? { NODE_OPTIONS: `--import=${JSON.stringify(join(root, 'scripts/clock.mjs'))}`, VERSION_TEST_CLOCK: clock } : {}) },
      input, maxBuffer: MAX_PLAN_BYTES * 2, encoding: 'utf8' });
  return { root, base, git, write, json, commit, run };
}

function plan(f, args = []) {
  const result = f.run(['plan', '--json', '--base', f.base, '--head', 'HEAD', ...args]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertApply(f, value, args = []) {
  const before = f.git(['status', '--porcelain']);
  assert.equal(before, '');
  const result = f.run(['apply', '--plan', '-', '--base', f.base, '--head', 'HEAD', ...args], JSON.stringify(value));
  assert.equal(result.status, 0, result.stderr);
  for (const output of value.outputs) {
    assert.deepEqual(readFileSync(join(f.root, output.path)), Buffer.from(output.after));
  }
}

for (const [subject, level, version] of [
  ['fix: repair', 'patch', '1.0.1'],
  ['feat: add', 'minor', '1.1.0'],
  ['feat!: replace', 'major', '2.0.0'],
  ['fix: repair\n\nBREAKING CHANGE: incompatible', 'major', '2.0.0'],
]) {
  test(`real planner/apply preserve the human CLI for ${level}: ${subject}`, t => {
    const f = fixture(t);
    f.write('plugins/example/content.md', 'After: café\n');
    const head = f.commit(subject);
    const value = plan(f);
    assert.equal(value.schema, 'version-plan/1');
    assert.equal(value.base, f.base);
    assert.equal(value.head, head);
    assert.match(value.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(value.outputs.map(o => o.path), [manifestPath, changelogPath, marketplacePath]);
    assert.equal(value.maxApplied, level);
    assert.equal(JSON.parse(value.outputs[0].after).version, version);
    for (const output of value.outputs) {
      assert.equal(output.before, readFileSync(join(f.root, output.path), 'utf8'));
    }
    const humanArgs = ['plan', '--base', f.base, '--head', 'HEAD'];
    const newPlan = f.run(humanArgs);
    assert.equal(newPlan.status, 0, newPlan.stderr);
    assert.equal(newPlan.stdout,
      `version plan — base ${f.base.slice(0, 7)} … head HEAD\n\n` +
      `  ${'example'.padEnd(22)} ${'1.0.0'.padEnd(8)} → needs ≥ ${level.padEnd(6)}` +
      ` (current 1.0.0, applied bump: none)\n\n` +
      `  marketplace metadata.version: 1.0.0 → needs ≥ ${level} (current 1.0.0)\n`);
    const newApply = f.run(['apply', '--base', f.base]);
    assert.equal(newApply.status, 0, newApply.stderr);
    assert.equal(newApply.stdout,
      `Applied version bumps:\n  • example → ${version} (${level})\n` +
      `  • marketplace metadata.version → ${version} (${level})\n\n` +
      'Next: review the diff, then `node scripts/catalog.mjs` (descriptions/versions may affect the catalog) and `node scripts/validate.mjs`.\n');
    for (const output of value.outputs) assert.equal(readFileSync(join(f.root, output.path), 'utf8'), output.after);
    f.git(['reset', '--hard', head]);
    assertApply(f, value);
    assert.equal(f.run(['check', '--base', f.base]).status, 0);
  });
}

for (const scenario of ['new', 'removed', 'noop', 'already-bumped', 'override']) {
  test(`real producer preserves ${scenario} semantics`, t => {
    const f = fixture(t);
    const marketplace = JSON.parse(readFileSync(join(f.root, marketplacePath), 'utf8'));
    let args = [];
    if (scenario === 'new') {
      marketplace.plugins.push({ name: 'added', version: '0.1.0', source: 'plugins/added' });
      f.json('plugins/added/plugin.json', { name: 'added', version: '0.1.0' });
      f.write('plugins/added/content.md', 'New plugin\n');
      f.json(marketplacePath, marketplace);
      f.commit('feat: new plugin');
    } else if (scenario === 'removed') {
      marketplace.plugins = [];
      f.json(marketplacePath, marketplace);
      rmSync(join(f.root, 'plugins/example'), { recursive: true });
      f.commit('chore: remove plugin');
    } else if (scenario === 'already-bumped') {
      marketplace.plugins[0].version = '1.1.0';
      marketplace.metadata.version = '1.1.0';
      f.json(marketplacePath, marketplace);
      f.json(manifestPath, { name: 'example', version: '1.1.0' });
      f.write(changelogPath, '# Changelog\n\n## [1.1.0]\n\n- Released.\n');
      f.commit('feat: released change');
    } else if (scenario === 'override') {
      args = ['--set', 'example=major'];
    }
    const value = plan(f, args);
    assertApply(f, value, args);
    if (['noop', 'already-bumped'].includes(scenario)) {
      assert.deepEqual(value.outputs, []);
      assert.equal(f.git(['status', '--porcelain']), '');
    } else if (scenario === 'removed') {
      assert.deepEqual(value.outputs.map(o => o.path), [marketplacePath]);
      assert.equal(value.marketplaceVersion, '2.0.0');
    } else if (scenario === 'new') {
      assert.equal(value.outputs.find(o => o.path === 'plugins/added/CHANGELOG.md').before, null);
      assert.match(value.outputs.find(o => o.path === 'plugins/added/plugin.json').after, /0\.1\.1/);
    } else assert.equal(value.marketplaceVersion, '2.0.0');
  });
}

for (const fault of ['schema', 'malformed', 'head', 'base', 'content', 'path', 'precondition', 'date', 'invalid-date', 'working', 'staged', 'untracked']) {
  test(`apply rejects ${fault} without writes`, t => {
    const f = fixture(t);
    f.write('plugins/example/content.md', 'After\n');
    f.commit('fix: change');
    const value = plan(f);
    if (fault === 'schema') value.schema = 'version-plan/2';
    if (fault === 'head') value.head = f.base;
    if (fault === 'base') value.base = value.head;
    if (fault === 'content') value.outputs[0].after += 'unexpected\n';
    if (fault === 'path') value.outputs[0].path = '../outside.json';
    if (fault === 'precondition') value.outputs[0].before += 'unexpected\n';
    if (fault === 'date') value.date = 'not-a-date';
    if (fault === 'invalid-date') value.date = '2026-02-30';
    if (fault === 'working' || fault === 'staged') {
      f.write(manifestPath, '{"name":"example","version":"1.0.0","description":"Concurrent"}\n');
      if (fault === 'staged') f.git(['add', manifestPath]);
    }
    if (fault === 'untracked') f.write('untracked.txt', 'Concurrent\n');
    const snapshot = () => [
      f.git(['status', '--porcelain']), f.git(['diff', '--binary']), f.git(['diff', '--cached', '--binary']),
      ...[manifestPath, changelogPath, marketplacePath].map(p => readFileSync(join(f.root, p), 'utf8')),
    ];
    const before = snapshot();
    const result = f.run(['apply', '--plan', '-', '--base', f.base, '--head', 'HEAD'],
      fault === 'malformed' ? '{broken' : JSON.stringify(value));
    assert.notEqual(result.status, 0);
    assert.deepEqual(snapshot(), before);
  });
}

test('plan replay binds the rendered date rather than recomputing today', t => {
  const f = fixture(t);
  f.write('scripts/clock.mjs', `
const NativeDate = Date;
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [process.env.VERSION_TEST_CLOCK])); }
};
`);
  f.write('plugins/example/content.md', 'After\n');
  f.commit('fix: change');
  const produced = f.run(['plan', '--json', '--base', f.base], undefined, '2026-01-02T23:59:59Z');
  assert.equal(produced.status, 0, produced.stderr);
  const value = JSON.parse(produced.stdout);
  assert.equal(value.date, '2026-01-02');
  const applied = f.run(['apply', '--plan', '-'], produced.stdout, '2026-01-03T00:00:01Z');
  assert.equal(applied.status, 0, applied.stderr);
  for (const output of value.outputs) assert.deepEqual(readFileSync(join(f.root, output.path)), Buffer.from(output.after));
});

test('legacy dirty guard and allow-dirty override remain available', t => {
  const f = fixture(t);
  f.write('plugins/example/content.md', 'After\n');
  f.commit('fix: change');
  f.write('untracked.txt', 'Concurrent\n');
  assert.equal(f.run(['apply', '--base', f.base]).status, 1);
  assert.equal(f.run(['apply', '--base', f.base, '--allow-dirty']).status, 0);
  assert.equal(readFileSync(join(f.root, 'untracked.txt'), 'utf8'), 'Concurrent\n');
});

test('machine plan resolves default refs and fails closed for an unknown ref', t => {
  const f = fixture(t);
  f.git(['update-ref', 'refs/remotes/origin/main', f.base]);
  f.write('plugins/example/content.md', 'After\n');
  const head = f.commit('fix: change');
  const result = f.run(['plan', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).base, f.base);
  assert.equal(JSON.parse(result.stdout).head, head);
  const invalid = f.run(['plan', '--json', '--base', 'missing-fixture-ref']);
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, '');
});

for (const [level, version] of [['patch', '1.0.1'], ['minor', '1.1.0'], ['major', '2.0.0']]) {
  test(`--set ${level} overrides the calculated release level`, t => {
    const f = fixture(t);
    f.write('plugins/example/content.md', 'After\n');
    f.commit('feat!: replace');
    const value = plan(f, ['--set', `example=${level}`]);
    assert.equal(value.maxApplied, level);
    assert.equal(JSON.parse(value.outputs[0].after).version, version);
    assertApply(f, value);
  });
}

test('invalid --set is rejected without a success-shaped plan', t => {
  const f = fixture(t);
  const result = f.run(['plan', '--json', '--base', f.base, '--set', 'example=invalid']);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(f.git(['status', '--porcelain']), '');
});

function snapshot(f) {
  return [
    f.git(['status', '--porcelain']), f.git(['diff', '--binary']), f.git(['diff', '--cached', '--binary']),
    ...[manifestPath, changelogPath, marketplacePath].map(path => readFileSync(join(f.root, path))),
  ];
}

for (const target of ['plugin', 'marketplace']) {
  for (const [version, subject] of [
    ['1.0.9007199254740992', 'fix: change'],
    ['1.9007199254740992.0', 'fix: change'],
    ['9007199254740992.0.0', 'fix: change'],
    ['1000000000000000000000.0.0', 'fix: change'],
    ['1e+21.0.0', 'fix: change'],
    ['1.0.9007199254740991', 'fix: change'],
    ['1.9007199254740991.0', 'feat: change'],
    ['9007199254740991.0.0', 'fix!: change'],
  ]) {
    test(`real producer/apply reject unsafe or overflowing ${target} ${version}`, t => {
      const f = fixture(t);
      const marketplace = JSON.parse(readFileSync(join(f.root, marketplacePath), 'utf8'));
      if (target === 'plugin') {
        marketplace.plugins[0].version = version;
        f.json(manifestPath, { name: 'example', version });
      } else marketplace.metadata.version = version;
      f.json(marketplacePath, marketplace);
      f.base = f.commit('chore: version baseline');
      f.write('plugins/example/content.md', 'After\n');
      f.commit(subject);
      const before = snapshot(f);
      for (const command of ['plan', 'apply']) {
        const result = f.run([command, '--base', f.base, ...(command === 'plan' ? ['--json'] : [])]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /unsafe|overflow/);
        assert.equal(result.stdout, '');
        assert.deepEqual(snapshot(f), before);
      }
    });
  }
}

for (const path of [manifestPath, changelogPath, marketplacePath]) {
  for (const staged of [false, true]) {
    test(`--allow-dirty still rejects stale ${staged ? 'indexed' : 'working'} preconditions for ${path}`, t => {
      const f = fixture(t);
      f.write('plugins/example/content.md', 'After\n');
      f.commit('fix: change');
      const value = plan(f);
      if (path === changelogPath) f.write(path, readFileSync(join(f.root, path), 'utf8') + '\nConcurrent note.\n');
      else {
        const data = JSON.parse(readFileSync(join(f.root, path), 'utf8'));
        data.description = 'Concurrent description';
        f.json(path, data);
      }
      if (staged) {
        f.git(['add', '--', path]);
        // Index and worktree have independent edits.
        f.write(path, readFileSync(join(f.root, path), 'utf8') + '\n');
      }
      const before = snapshot(f);
      const result = f.run(['apply', '--plan', '-', '--allow-dirty'], JSON.stringify(value));
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /preconditions/);
      assert.deepEqual(snapshot(f), before);
    });
  }
}

test('--allow-dirty replays an unchanged plan while preserving unrelated working and index edits', t => {
  const f = fixture(t);
  f.write('unrelated.txt', 'Original\n');
  f.commit('chore: unrelated baseline');
  f.write('plugins/example/content.md', 'After\n');
  f.commit('fix: change');
  const value = plan(f);
  f.write('unrelated.txt', 'Indexed edit\n');
  f.git(['add', '--', 'unrelated.txt']);
  f.write('unrelated.txt', 'Independent working edit\n');
  f.write('untracked.txt', 'Untracked edit\n');
  const index = f.git(['diff', '--cached', '--binary']);
  const result = f.run(['apply', '--plan', '-', '--allow-dirty'], JSON.stringify(value));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git(['diff', '--cached', '--binary']), index);
  assert.equal(readFileSync(join(f.root, 'unrelated.txt'), 'utf8'), 'Independent working edit\n');
  assert.equal(readFileSync(join(f.root, 'untracked.txt'), 'utf8'), 'Untracked edit\n');
  for (const output of value.outputs) assert.equal(readFileSync(join(f.root, output.path), 'utf8'), output.after);
});

test('replay accepts reordered object keys and reordered --set arguments', t => {
  const f = fixture(t);
  const value = plan(f, ['--set', 'example=major', '--set', 'unused=patch']);
  function reverseKeys(value) {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseKeys(entry)]));
    }
    return value;
  }
  assertApply(f, reverseKeys(value), ['--set', 'unused=patch', '--set', 'example=major']);
});

for (const fault of ['extra-field', 'extra-output-field', 'array-order']) {
  test(`structural replay comparison rejects ${fault}`, t => {
    const f = fixture(t);
    f.write('plugins/example/content.md', 'After\n');
    f.commit('fix: change');
    const value = plan(f);
    if (fault === 'extra-field') value.extra = 'unexpected';
    if (fault === 'extra-output-field') value.outputs[0].extra = 'unexpected';
    if (fault === 'array-order') value.outputs.reverse();
    const before = snapshot(f);
    assert.notEqual(f.run(['apply', '--plan', '-'], JSON.stringify(value)).status, 0);
    assert.deepEqual(snapshot(f), before);
  });
}

test('replay accepts exactly 8 MiB of JSON with whitespace and rejects one byte above before parsing', t => {
  const f = fixture(t);
  f.write('plugins/example/content.md', 'After\n');
  f.commit('fix: change');
  const produced = f.run(['plan', '--json', '--base', f.base]);
  assert.equal(produced.status, 0, produced.stderr);
  const before = snapshot(f);
  const excessive = ' '.repeat(MAX_PLAN_BYTES + 1);
  const rejected = f.run(['apply', '--plan', '-'], excessive);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, new RegExp(`exceeds ${MAX_PLAN_BYTES} byte limit`));
  assert.doesNotMatch(rejected.stderr, /Unexpected end|JSON/);
  assert.deepEqual(snapshot(f), before);
  const exact = produced.stdout + ' '.repeat(MAX_PLAN_BYTES - Buffer.byteLength(produced.stdout));
  assert.equal(Buffer.byteLength(exact), MAX_PLAN_BYTES);
  const accepted = f.run(['apply', '--plan', '-'], exact);
  assert.equal(accepted.status, 0, accepted.stderr);
  for (const output of JSON.parse(produced.stdout).outputs) {
    assert.equal(readFileSync(join(f.root, output.path), 'utf8'), output.after);
  }
  t.diagnostic(`accepted stdin=${Buffer.byteLength(exact)} bytes; rejected stdin=${Buffer.byteLength(excessive)} bytes`);
});

test('oversized Git base data cannot fall back to new-plugin analysis', t => {
  const f = fixture(t);
  f.json(manifestPath, { name: 'example', version: '1.0.0', description: 'a'.repeat(MAX_GIT_BYTES) });
  f.base = f.commit('chore: large historical manifest');
  f.json(manifestPath, { name: 'example', version: '1.0.0' });
  f.commit('fix: reduce manifest');
  const before = snapshot(f);
  for (const command of ['plan', 'apply']) {
    const result = f.run([command, '--base', f.base, ...(command === 'plan' ? ['--json'] : [])]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`Git output exceeds ${MAX_GIT_BYTES} byte limit`));
    assert.equal(result.stdout, '');
    assert.deepEqual(snapshot(f), before);
  }
});

test('computed plan cap rejects both producer and direct apply before writes', t => {
  const f = fixture(t);
  const historical = '# Changelog\n\n## [1.0.0]\n\n' + '- Historical café note.\n'.repeat(180_000);
  f.write(changelogPath, historical);
  f.write('plugins/example/content.md', 'After\n');
  f.commit('fix: change');
  const before = snapshot(f);
  for (const command of ['plan', 'apply']) {
    const result = f.run([command, '--base', f.base, ...(command === 'plan' ? ['--json'] : [])]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`Version plan exceeds ${MAX_PLAN_BYTES} byte limit`));
    assert.equal(result.stdout, '');
    assert.deepEqual(snapshot(f), before);
  }
});
