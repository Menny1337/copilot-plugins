import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helper = fileURLToPath(new URL('./menubar-launch-agent.sh', import.meta.url));
const options = { skip: process.platform === 'win32' ? 'Requires POSIX Bash' : false };
const canonicalLabel = 'com.copilotplugins.skill-review.menubar';
const legacyLabel = 'com.example.skill-review.menubar';
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'menubar-launch-agent-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home with spaces');
  const bin = join(root, 'bin');
  const launchAgents = join(home, 'Library', 'LaunchAgents');
  const log = join(root, 'launchctl.jsonl');
  const appBinary = join(home, 'Applications', 'SkillReviewMenuBar.app', 'Contents', 'MacOS', 'SkillReviewMenuBar');
  mkdirSync(launchAgents, { recursive: true });
  mkdirSync(bin);

  function mock(name, body) {
    const script = join(root, `${name}.cjs`);
    writeFileSync(script, body);
    writeFileSync(join(bin, name),
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(script)} "$@"\n`,
      { mode: 0o755 });
  }

  // An isolated PATH prevents any fallback to the host's launchctl.
  writeFileSync(join(bin, 'id'), '#!/bin/sh\n[ "$#" -eq 1 ] && [ "$1" = "-u" ] || exit 64\nprintf "1000\\n"\n', { mode: 0o755 });
  mock('launchctl', String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    assert.equal(args.length, 2);
    assert.match(args[1], /^gui\/1000\/com\.[^.]+\.skill-review\.menubar$/);
    fs.appendFileSync(process.env.TEST_LAUNCHCTL_LOG, JSON.stringify(args) + '\n');
    if (args[0] === 'bootout') process.exit(Number(process.env.TEST_BOOTOUT_EXIT));
    if (args[0] === 'print') process.exit(process.env.TEST_LOADED === 'true' ? 0 : 113);
    throw new Error('Unexpected mock launchctl action');
  `);
  // Model raw extraction from JSON property-list fixtures, not macOS plist parsing.
  mock('plutil', String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    assert.equal(args.length, 6);
    assert.equal(args[0], '-extract');
    assert.deepEqual(args.slice(2, 5), ['raw', '-o', '-']);
    assert.ok(['ProgramArguments.0', 'Label'].includes(args[1]));
    let plist;
    try {
      plist = JSON.parse(fs.readFileSync(args[5], 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) process.exit(1);
      throw error;
    }
    const value = args[1] === 'Label' ? plist.Label : plist.ProgramArguments?.[0];
    if (typeof value !== 'string') process.exit(1);
    process.stdout.write(value);
  `);
  mock('rm', String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const args = process.argv.slice(2);
    assert.equal(args.length, 2);
    assert.equal(args[0], '-f');
    const relative = path.relative(process.env.HOME, args[1]);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(args[1], { force: true });
  `);

  function addJob({
    label = canonicalLabel,
    fileLabel = label,
    program = appBinary,
  } = {}) {
    const path = join(launchAgents, `${fileLabel}.plist`);
    writeFileSync(path, JSON.stringify({ Label: label, ProgramArguments: [program] }));
    return path;
  }

  function run({ bootoutExit = 0, loaded = false } = {}) {
    const result = spawnSync('/bin/bash', [
      '--noprofile', '--norc', '-c',
      'set -euo pipefail; source "$1"; remove_menubar_launch_agents "$2"',
      'menubar-cleanup-test', helper, appBinary,
    ], {
      cwd: home,
      env: {
        HOME: home,
        PATH: bin,
        TEST_LAUNCHCTL_LOG: log,
        TEST_BOOTOUT_EXIT: String(bootoutExit),
        TEST_LOADED: String(loaded),
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result;
  }

  function calls() {
    return existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
      : [];
  }

  return { home, launchAgents, appBinary, addJob, run, calls };
}

test('removes canonical and legacy jobs with the exact executable and matching labels', options, t => {
  const f = fixture(t);
  const current = f.addJob();
  const legacy = f.addJob({ label: legacyLabel });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(current), false);
  assert.equal(existsSync(legacy), false);
  assert.deepEqual(f.calls(), [
    ['bootout', `gui/1000/${legacyLabel}`],
    ['bootout', `gui/1000/${canonicalLabel}`],
  ]);
});

for (const [name, job] of [
  ['a different executable', f => ({ program: join(f.home, 'OtherApp') })],
  ['an executable with only a matching prefix', f => ({ program: `${f.appBinary}-other` })],
  ['a label that does not match the filename', () => ({ label: legacyLabel, fileLabel: canonicalLabel })],
  ['a filename outside the menu-bar job family', () => ({ label: 'com.example.other-job' })],
]) {
  test(`preserves a job with ${name}`, options, t => {
    const f = fixture(t);
    const path = f.addJob(job(f));
    const before = readFileSync(path);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(path), before);
    assert.deepEqual(f.calls(), []);
  });
}

test('preserves a symlink and its otherwise matching target', options, t => {
  const f = fixture(t);
  const target = join(f.home, 'target.plist');
  const content = JSON.stringify({ Label: canonicalLabel, ProgramArguments: [f.appBinary] });
  writeFileSync(target, content);
  const link = join(f.launchAgents, `${canonicalLabel}.plist`);
  symlinkSync(target, link);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.equal(readFileSync(target, 'utf8'), content);
  assert.deepEqual(f.calls(), []);
});

test('failed bootout leaves a still-loaded job unchanged and stops cleanup', options, t => {
  const f = fixture(t);
  const path = f.addJob({ label: legacyLabel });
  const later = f.addJob();
  const before = readFileSync(path);
  const result = f.run({ bootoutExit: 5, loaded: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not unload.*leaving it unchanged/);
  assert.deepEqual(readFileSync(path), before);
  assert.ok(existsSync(later));
  assert.deepEqual(f.calls(), [
    ['bootout', `gui/1000/${legacyLabel}`],
    ['print', `gui/1000/${legacyLabel}`],
  ]);
});

test('failed bootout permits cleanup when the job is already unloaded', options, t => {
  const f = fixture(t);
  const path = f.addJob();
  const result = f.run({ bootoutExit: 113, loaded: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path), false);
  assert.deepEqual(f.calls(), [
    ['bootout', `gui/1000/${canonicalLabel}`],
    ['print', `gui/1000/${canonicalLabel}`],
  ]);
});

test('cleanup is idempotent after a successful removal', options, t => {
  const f = fixture(t);
  const path = f.addJob();
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(existsSync(path), false);
  const calls = f.calls();
  assert.equal(calls.length, 1);
  const second = f.run();
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(f.calls(), calls);
});

test('a missing LaunchAgents directory needs no launchctl operation', options, t => {
  const f = fixture(t);
  rmSync(f.launchAgents, { recursive: true });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(f.launchAgents), false);
  assert.deepEqual(f.calls(), []);
});

test('preserves an unreadable property-list structure', options, t => {
  const f = fixture(t);
  const path = f.addJob();
  writeFileSync(path, '{invalid-json');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path, 'utf8'), '{invalid-json');
  assert.deepEqual(f.calls(), []);
});

test('preserves a property list with no label', options, t => {
  const f = fixture(t);
  const path = f.addJob();
  const content = JSON.stringify({ ProgramArguments: [f.appBinary] });
  writeFileSync(path, content);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path, 'utf8'), content);
  assert.deepEqual(f.calls(), []);
});
