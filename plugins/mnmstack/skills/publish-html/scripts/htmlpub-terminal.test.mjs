import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PassThrough, Writable } from 'node:stream';
import { terminal, label, wrap } from './htmlpub-terminal.mjs';

const exec = promisify(execFile), directory = path.dirname(fileURLToPath(import.meta.url));
test('terminal text strips injected ANSI/control characters and wraps complete graphemes', () => {
  assert.equal(label('\x1b[31mred\x1b[0m\x00'), 'red ');
  assert.deepEqual(wrap('abcde', 3), ['abc', 'de']);
  assert.deepEqual(wrap('e\u0301e\u0301', 1), ['e\u0301', 'e\u0301']);
  assert.deepEqual(wrap('\u754c\u754c', 2), ['\u754c', '\u754c']);
});
test('redirected prompts fail immediately, output/errors have no ANSI even with FORCE_COLOR', async () => {
  const input = new PassThrough(); let text = '';
  const output = new Writable({ write(chunk, _encoding, done) { text += chunk; done(); } });
  const ui = terminal({ input, output, env: { FORCE_COLOR: '1' } });
  ui.line('[done] Saved'); ui.error('\x1b[31mBlocked\x1b[0m');
  await assert.rejects(ui.select('Choose', [{ label: 'No', value: false }]), /redirected/);
  await assert.rejects(ui.ask('Must not hang'), /redirected/);
  assert.ok(!text.includes('\x1b')); ui.close();
});
test('machine JSON help and captured errors contain no ANSI', async () => {
  const cli = path.join(directory, 'htmlpub.mjs');
  const env = { ...process.env, FORCE_COLOR: '1' };
  const help = await exec(process.execPath, [cli, '--help', '--json'], { env });
  assert.ok(!help.stdout.includes('\x1b')); assert.match(JSON.parse(help.stdout).help, /Up\/Down/);
  await assert.rejects(exec(process.execPath, [cli, 'unknown', '--json'], { env }), error => {
    assert.ok(!error.stderr.includes('\x1b')); assert.match(JSON.parse(error.stderr).error, /Unknown command/); return true;
  });
});
test('status colors retain text labels and NO_COLOR suppresses every SGR tone', () => {
  for (const env of [{}, { NO_COLOR: '' }]) {
    let text = '';
    const input = new PassThrough(); input.isTTY = true;
    const output = new Writable({ write(chunk, _encoding, done) { text += chunk; done(); } }); output.isTTY = true;
    const ui = terminal({ input, output, env });
    for (const state of ['running', 'done', 'warning', 'blocked', 'error']) ui.line(`[${state}] Example`);
    if (Object.hasOwn(env, 'NO_COLOR')) assert.ok(!text.includes('\x1b'));
    else for (const code of [31, 32, 33, 36]) assert.ok(text.includes(`\x1b[${code}m`));
    for (const state of ['running', 'done', 'warning', 'blocked', 'error']) assert.ok(text.includes(`[${state}]`));
    ui.close();
  }
});
for (const scenario of ['single', 'multiple', 'escape', 'ctrl-c', 'text-escape', 'text-ctrl-c', 'approve', 'decline',
  'no-color', 'dumb', 'narrow', 'resize', 'wizard', 'resume']) {
  test(`real PTY: ${scenario}`, { skip: process.platform === 'win32' ? 'POSIX PTY harness; Windows is unverified' : false }, async t => {
    const root = process.env.PUBLISH_HTML_TEST_ARTIFACT_DIR;
    assert.ok(root && path.isAbsolute(root), 'Select the approved external artifact directory');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(path.join(root, 'terminal-'));
    t.after(() => rm(temporary, { recursive: true }));
    const result = await exec(process.env.PYTHON ?? 'python3', [path.join(directory, 'test-fixtures/terminal-pty.py'),
      process.execPath, path.join(directory, 'test-fixtures/terminal.mjs'), scenario, path.join(temporary, 'resources.json')],
    { timeout: 45000, maxBuffer: 1024 * 1024 });
    assert.match(result.stdout, new RegExp(`PASS ${scenario}: real PTY`));
  });
}
