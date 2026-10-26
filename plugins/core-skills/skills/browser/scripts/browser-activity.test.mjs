import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { nodeOptionsWithRequire } from './browser-window.mjs';

const launcher = join(import.meta.dirname, 'browser-profile-launcher.cjs');
const initialization = `if (this._isMainFrame() && !skipDefaultOverrides)
            promises2.push(this._client.send("Emulation.setFocusEmulationEnabled", { enabled: true }));`;
const bundle = `
class Page {
  constructor(main) {
    this._isMainFrame = () => main;
    this.calls = [];
    this._client = { send: (method, params) => this.calls.push([method, params]) };
  }
  initialize(skipDefaultOverrides) {
    const promises2 = [];
    ${initialization}
    if (!skipDefaultOverrides) this.calls.push(['other-default']);
    return this.calls;
  }
}
module.exports = Page;
`;

function fixture(t, { version = '1.63.0-alpha-2026-08-31', source = bundle } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'browser-activity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const core = join(root, 'node_modules', 'playwright-core');
  const file = join(core, 'lib', 'coreBundle.js');
  mkdirSync(join(core, 'lib', 'entry'), { recursive: true });
  writeFileSync(join(core, 'package.json'), JSON.stringify({
    name: 'playwright-core',
    version,
    exports: { './lib/coreBundle': './lib/coreBundle.js' },
  }));
  writeFileSync(file, source);
  const cli = join(root, 'playwright-cli.js');
  const daemon = join(core, 'lib', 'entry', 'cliDaemon.js');
  const entry = `
const Page = require('playwright-core/lib/coreBundle');
console.log(JSON.stringify([new Page(true).initialize(true), new Page(true).initialize(false),
  new Page(false).initialize(true), new Page(false).initialize(false)]));
`;
  writeFileSync(cli, entry);
  writeFileSync(daemon, entry);
  return {
    run(activity, entrypoint = cli, profileLaunch = '1') {
      return spawnSync(process.execPath, [entrypoint], {
        encoding: 'utf8',
        env: {
          ...process.env,
          COPILOT_PLUGIN_BROWSER_ACTIVITY: activity,
          COPILOT_PLUGIN_BROWSER_PROFILE_LAUNCH: profileLaunch,
          NODE_OPTIONS: nodeOptionsWithRequire('', launcher),
        },
      });
    },
    daemon,
    file,
    source,
  };
}

test('active preload sends native focus on the existing main-frame session, including daemon loads', (t) => {
  const f = fixture(t);
  const focus = ['Emulation.setFocusEmulationEnabled', { enabled: true }];
  for (const entry of [undefined, f.daemon]) {
    const result = f.run('active', entry);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [
      [focus], [focus, ['other-default']], [], [['other-default']],
    ]);
  }
  assert.equal(readFileSync(f.file, 'utf8'), f.source, 'installed code must not be written');
});

test('native mode and unrelated preloads retain all original defaults', (t) => {
  const f = fixture(t);
  for (const [activity, profileLaunch] of [['native', '1'], ['active', '0']]) {
    const result = f.run(activity, undefined, profileLaunch);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [
      [], [['Emulation.setFocusEmulationEnabled', { enabled: true }], ['other-default']],
      [], [['other-default']],
    ]);
  }
});

for (const [name, options] of [
  ['unknown version', { version: '1.64.0' }],
  ['changed initialization', { source: bundle.replace('!skipDefaultOverrides)', '!skipDefaultOverrides && true)') }],
  ['duplicate initialization', { source: `${bundle}\n/* ${initialization} */` }],
]) {
  test(`active fails closed for ${name}; native remains available`, (t) => {
    const f = fixture(t, options);
    const active = f.run('active');
    assert.notEqual(active.status, 0);
    assert.match(active.stderr, /COPILOT_BROWSER_ACTIVITY_UNSUPPORTED/);
    assert.equal(active.stdout, '');
    const native = f.run('native');
    assert.equal(native.status, 0, native.stderr);
    assert.equal(readFileSync(f.file, 'utf8'), f.source);
  });
}
