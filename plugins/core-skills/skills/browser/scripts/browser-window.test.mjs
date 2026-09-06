import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  acquireLock,
  closeWindow,
  createRuntime,
  extensionAttachEnvironment,
  generateSession,
  hasExpectedWelcome,
  hasSafeBlank,
  isSupportedPlaywrightVersion,
  nodeOptionsWithRequire,
  parseTabUrls,
  parseArgs,
  startWindow,
} from './browser-window.mjs';

const requireModule = createRequire(import.meta.url);
const { connectPageFromArg } = requireModule('./browser-profile-launcher.cjs');
const token = 'a'.repeat(43);

for (const [name, input, expected = input] of [
  ['empty text', ''],
  ['single character', 'A'],
  ['single emoji', '😀'],
  ['ASCII', 'Ordinary window title'],
  ['flag grapheme', 'Flag \u{1F1FA}\u{1F1F8}'],
  ['family grapheme', 'Family 👨‍👩‍👧‍👦'],
  ['decomposed accent', 'Cafe\u0301'],
  ['quotes and backslashes', '"quoted" \\ path 👨‍👩‍👧‍👦'],
  ['control characters', `A${String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i))}e\u0301`, 'Ae\u0301'],
]) {
  test(`macOS jsonEscape preserves ${name}`, { skip: platform() !== 'darwin' }, () => {
    const source = readFileSync(join(import.meta.dirname, 'browser-window-macos.applescript'), 'utf8');
    // Load only the production escaping handlers, never the browser/System Events handlers.
    const handlers = ['jsonEscape', 'replaceText'].map((name) => {
      const match = source.match(new RegExp(`^on ${name}\\([^\\n]*\\)[\\s\\S]*?^end ${name}$`, 'm'));
      assert.ok(match, `Missing production handler: ${name}`);
      return match[0];
    }).join('\n\n');
    const value = input
      ? `string id {${Array.from(input, (character) => character.codePointAt(0)).join(', ')}}`
      : '""';
    const result = spawnSync('osascript', ['-'], {
      input: `${handlers}\n\non run\nset value to ${value}\nreturn quote & my jsonEscape(value) & quote\nend run\n`,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.stdout.trimEnd(), JSON.stringify(expected));
    assert.equal(JSON.parse(result.stdout), expected);
  });
}

function harness(overrides = {}) {
  const stateRoot = mkdtempSync(join(tmpdir(), 'browser-window-test-'));
  const calls = [];
  const windows = [{ id: '100', processId: 20, title: 'User page' }];
  let launched = false;
  let focused = { id: '100', processId: 20 };
  let attached = false;
  let marker = null;
  let launchMarker = null;

  const native = {
    invoke(command, browser, identity, previous) {
      calls.push({ type: 'native', command, browser, identity, previous });
      if (command === 'list') {
        return launched
          ? [...windows, { id: '200', processId: 20, title: launchMarker }]
          : [...windows];
      }
      if (command === 'current') return { ...focused };
      if (command === 'foreground') {
        focused = { ...identity };
        return { exists: true, matches: true, focused: true };
      }
      if (command === 'mark') {
        marker = identity.marker;
        return { exists: true, matches: true, marked: true };
      }
      if (command === 'restore') {
        focused = { ...previous };
        return { restored: true };
      }
      if (command === 'inspect') {
        return launched
          ? {
              exists: true,
              matches: identity.marker === marker,
              processMatches: true,
              markerMatches: identity.marker === marker,
              actualProcessId: 20,
            }
          : { exists: false, matches: false };
      }
      if (command === 'close') {
        launched = false;
        return { exists: false, matches: true, closed: true, alreadyClosed: false };
      }
      if (command === 'discard') {
        launched = false;
        return { exists: false, matches: true, closed: true };
      }
      throw new Error(`unexpected native command ${command}`);
    },
  };

  const runtime = createRuntime({
    stateRoot,
    native,
    resolveToken: () => ({
      ok: true,
      token,
      profile: { dir: 'Default', name: 'Default' },
    }),
    playwrightVersion: () => '0.1.19',
    sessionExists: () => false,
    attach: (browser, session, actualToken, profileDirectory) => {
      calls.push({
        type: 'attach',
        browser,
        session,
        token: actualToken,
        profileDirectory,
      });
      attached = true;
    },
    verifySession: (session) => {
      calls.push({ type: 'verify', session });
      assert.equal(attached, true);
    },
    sanitizeSession: (session) => {
      calls.push({ type: 'sanitize', session });
      assert.equal(attached, true);
    },
    bindSession: (session, requestedMarker) => {
      calls.push({ type: 'bind', session, marker: requestedMarker });
      assert.equal(attached, true);
    },
    clearWelcome: (session) => {
      calls.push({ type: 'clear-welcome', session });
    },
    detach: (session) => {
      calls.push({ type: 'detach', session });
      attached = false;
    },
    launch: (browser, profileDirectory, requestedMarker) => {
      calls.push({ type: 'launch' });
      calls.push({ type: 'launch-options', browser, profileDirectory, marker: requestedMarker });
      launchMarker = requestedMarker;
      launched = true;
    },
    wait: () => {},
    random: (size) => Buffer.alloc(size, 0x12),
    acquireLock: (path, options) => {
      calls.push({ type: 'lock', path, options });
      return () => calls.push({ type: 'unlock', path });
    },
    ...overrides,
  });

  return {
    runtime,
    calls,
    stateRoot,
    isLaunched: () => launched,
    isAttached: () => attached,
    focused: () => focused,
  };
}

test('parseArgs defaults start to Edge and accepts explicit Chrome session', () => {
  assert.deepEqual(parseArgs(['start']), {
    command: 'start',
    browser: 'msedge',
    profile: null,
    session: null,
  });
  assert.deepEqual(parseArgs([
    'start', '--browser', 'chrome', '--profile', 'Work Profile', '--session=agent-1',
  ]), {
    command: 'start',
    browser: 'chrome',
    profile: 'Work Profile',
    session: 'agent-1',
  });
});

test('parseArgs requires a close session and rejects unsafe names', () => {
  assert.throws(() => parseArgs(['close']), { code: 'session-required' });
  assert.throws(() => parseArgs(['start', '--session', '../other']), { code: 'invalid-session' });
  assert.throws(() => parseArgs(['start', '--profile', '../Other']), { code: 'invalid-profile' });
});

test('generateSession creates browser-scoped collision-resistant names', () => {
  assert.match(generateSession('chrome', () => Buffer.from('12345678', 'hex')),
    /^agent-chrome-\d+-12345678$/);
});

test('Playwright CLI version gate requires the verified Bridge-compatible release', () => {
  assert.equal(isSupportedPlaywrightVersion('0.1.18'), false);
  assert.equal(isSupportedPlaywrightVersion('0.1.19'), true);
  assert.equal(isSupportedPlaywrightVersion('0.2.0'), true);
  assert.equal(isSupportedPlaywrightVersion('1.0.0'), true);
});

test('profile attach environment forces the selected profile through a Node launcher', () => {
  const env = extensionAttachEnvironment('chrome', 'Profile 2', token, {
    os: 'darwin',
    env: { NODE_OPTIONS: '--trace-warnings' },
    nodePath: '/usr/local/bin/node',
    launcherPath: '/tmp/browser profile launcher.cjs',
  });
  assert.equal(env.PLAYWRIGHT_MCP_EXTENSION_TOKEN, token);
  assert.equal(env.PLAYWRIGHT_MCP_EXECUTABLE_PATH, '/usr/local/bin/node');
  assert.equal(
    env.COPILOT_PLUGIN_BROWSER_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  );
  assert.equal(env.COPILOT_PLUGIN_BROWSER_PROFILE_DIRECTORY, 'Profile 2');
  assert.equal(
    env.NODE_OPTIONS,
    '--trace-warnings --require "/tmp/browser profile launcher.cjs"',
  );
});

test('Node require options support launcher paths containing spaces', () => {
  const root = mkdtempSync(join(tmpdir(), 'browser launcher test '));
  const required = join(root, 'required module.cjs');
  writeFileSync(required, "process.env.COPILOT_PLUGIN_LAUNCHER_TEST = 'loaded';\n");
  const result = spawnSync(process.execPath, [
    '-p',
    'process.env.COPILOT_PLUGIN_LAUNCHER_TEST',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptionsWithRequire('', required),
    },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'loaded');
});

test('profile launcher reconstructs Node-expanded extension URLs', () => {
  const url = 'chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?token=fake';
  assert.equal(connectPageFromArg(url), url);
  assert.equal(
    connectPageFromArg(`/work/chrome-extension:/mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?token=fake`),
    url,
  );
  assert.equal(
    connectPageFromArg('C:\\work\\chrome-extension:\\mmlmfjhmonkocbjadbfplnigmagldckm\\connect.html?token=fake'),
    url,
  );
  assert.equal(connectPageFromArg('/work/chrome-extension:/wrong/connect.html?token=fake'), null);
});

test('profile launcher invokes a stub browser with the selected profile', () => {
  const root = mkdtempSync(join(tmpdir(), 'browser profile launcher '));
  const output = join(root, 'launched.args');
  const launcher = join(import.meta.dirname, 'browser-profile-launcher.cjs');
  const url = 'chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?token=fake';
  let browser;
  if (platform() === 'win32') {
    browser = join(root, 'fake-browser.exe');
    const source = join(root, 'FakeBrowser.cs');
    const build = join(root, 'build-fake-browser.ps1');
    writeFileSync(source, [
      'using System;',
      'using System.IO;',
      'public static class FakeBrowser {',
      '  public static int Main(string[] args) {',
      '    File.WriteAllLines(Environment.GetEnvironmentVariable("COPILOT_PLUGIN_BROWSER_LAUNCH_TEST_OUTPUT"), args);',
      '    return 0;',
      '  }',
      '}',
      '',
    ].join('\n'));
    writeFileSync(build, [
      '$source = Get-Content -Raw -LiteralPath $env:COPILOT_PLUGIN_FAKE_BROWSER_SOURCE',
      'Add-Type -TypeDefinition $source -OutputAssembly $env:COPILOT_PLUGIN_FAKE_BROWSER_EXE -OutputType ConsoleApplication',
      '',
    ].join('\n'));
    const compiled = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      build,
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        COPILOT_PLUGIN_FAKE_BROWSER_SOURCE: source,
        COPILOT_PLUGIN_FAKE_BROWSER_EXE: browser,
      },
    });
    assert.equal(compiled.status, 0, compiled.stderr);
  } else {
    browser = join(root, 'fake browser.sh');
    writeFileSync(browser, [
      '#!/bin/sh',
      'printf \'%s\\n\' "$1" "$2" > "$COPILOT_PLUGIN_BROWSER_LAUNCH_TEST_OUTPUT"',
      '',
    ].join('\n'));
    chmodSync(browser, 0o700);
  }

  const result = spawnSync(process.execPath, [url], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      COPILOT_PLUGIN_BROWSER_PROFILE_LAUNCH: '1',
      COPILOT_PLUGIN_BROWSER_EXECUTABLE: browser,
      COPILOT_PLUGIN_BROWSER_PROFILE_DIRECTORY: 'Profile 2',
      COPILOT_PLUGIN_BROWSER_LAUNCH_TEST_OUTPUT: output,
      NODE_OPTIONS: nodeOptionsWithRequire('', launcher),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const deadline = Date.now() + 5_000;
  while (!existsSync(output) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  assert.equal(existsSync(output), true, 'stub browser did not receive the connect URL');
  assert.deepEqual(readFileSync(output, 'utf8').trim().split(/\r?\n/), [
    '--profile-directory=Profile 2',
    url,
  ]);
});

test('start tracks one window, attaches a unique session, verifies scope, and restores focus', () => {
  const h = harness();
  const result = startWindow({ browser: 'msedge' }, h.runtime);
  assert.equal(result.ok, true);
  assert.equal(result.windowId, '200');
  assert.match(result.session, /^agent-msedge-/);
  assert.equal(h.isLaunched(), true);
  assert.equal(h.isAttached(), true);
  assert.deepEqual(h.focused(), { id: '100', processId: 20 });

  const state = JSON.parse(readFileSync(
    join(h.stateRoot, 'sessions', `${result.session}.json`),
    'utf8',
  ));
  assert.equal(state.window.id, '200');
  assert.match(state.window.marker, /^agent-[a-f0-9]{16}$/);
  assert.equal(state.attached, true);
  const attach = h.calls.find((call) => call.type === 'attach');
  assert.equal(attach.token, token);
  assert.equal(attach.profileDirectory, 'Default');
  assert.ok(h.calls.some((call) => call.type === 'sanitize'));
  assert.ok(h.calls.some((call) => call.type === 'bind'));
});

test('start failure detaches, closes only the created window, and restores focus', () => {
  const h = harness({
    verifySession: () => {
      const error = new Error('scope failed');
      error.code = 'scope-verification-failed';
      throw error;
    },
  });
  assert.throws(
    () => startWindow({ browser: 'chrome', session: 'failed-session' }, h.runtime),
    { code: 'scope-verification-failed' },
  );
  assert.equal(h.isLaunched(), false);
  assert.equal(h.isAttached(), false);
  assert.deepEqual(h.focused(), { id: '100', processId: 20 });
  assert.ok(h.calls.some((call) => call.type === 'native' && call.command === 'close'));
});

test('start rejects a token failure before launching or exposing token data', () => {
  const secret = 's'.repeat(43);
  const h = harness({
    resolveToken: () => ({ ok: false, reason: 'no-token', token: secret }),
  });
  assert.throws(
    () => startWindow({ browser: 'msedge', session: 'no-token' }, h.runtime),
    (error) => {
      assert.equal(error.code, 'bridge-token-unavailable');
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
  assert.equal(h.calls.some((call) => call.type === 'launch'), false);
});

test('start surfaces profile selection failures before launching', () => {
  const missing = harness({
    resolveToken: () => ({ ok: false, reason: 'profile-not-found', profile: null }),
  });
  assert.throws(
    () => startWindow({
      browser: 'chrome',
      profile: 'Missing',
      session: 'missing-profile',
    }, missing.runtime),
    { code: 'profile-not-found' },
  );
  assert.equal(missing.calls.some((call) => call.type === 'launch'), false);

  const ambiguous = harness({
    resolveToken: () => ({
      ok: false,
      reason: 'profile-ambiguous',
      profile: null,
      matches: [
        { name: 'Alex Personal', dir: 'Default' },
        { name: 'Alex Work', dir: 'Profile 1' },
      ],
    }),
  });
  assert.throws(
    () => startWindow({
      browser: 'chrome',
      profile: 'Alex',
      session: 'ambiguous-profile',
    }, ambiguous.runtime),
    (error) => {
      assert.equal(error.code, 'profile-ambiguous');
      assert.match(error.message, /Default/);
      assert.match(error.message, /Profile 1/);
      return true;
    },
  );
  assert.equal(ambiguous.calls.some((call) => call.type === 'launch'), false);
});

test('start refuses state and Playwright session collisions', () => {
  const h = harness({ sessionExists: () => true });
  assert.throws(
    () => startWindow({ browser: 'msedge', session: 'already-running' }, h.runtime),
    { code: 'session-exists' },
  );
});

test('close validates identity, closes the tracked window, detaches, and removes state', () => {
  const h = harness();
  const started = startWindow({ browser: 'msedge', session: 'close-me' }, h.runtime);
  const result = closeWindow({ session: started.session }, h.runtime);
  assert.equal(result.closed, true);
  assert.equal(h.isLaunched(), false);
  assert.equal(h.isAttached(), false);
  assert.equal(h.calls.filter((call) => call.type === 'native' && call.command === 'close').length, 1);
  assert.equal(closeWindow({ session: started.session }, h.runtime).alreadyClosed, true);
});

test('close reports a missing marker and recovers after the user closes the window manually', () => {
  const h = harness();
  const started = startWindow({ browser: 'chrome', session: 'missing-marker' }, h.runtime);
  let manuallyClosed = false;
  const original = h.runtime.native.invoke;
  h.runtime.native.invoke = (command, ...args) => {
    if (command === 'inspect') {
      return manuallyClosed
        ? { exists: false, matches: false }
        : {
            exists: true,
            matches: false,
            processMatches: true,
            markerMatches: false,
            markerMayBeClosed: true,
            actualProcessId: 20,
          };
    }
    return original(command, ...args);
  };

  assert.throws(() => closeWindow({ session: started.session }, h.runtime), {
    code: 'window-marker-missing',
  });
  assert.equal(
    existsSync(join(h.stateRoot, 'sessions', `${started.session}.json`)),
    true,
  );
  manuallyClosed = true;
  const recovered = closeWindow({ session: started.session }, h.runtime);
  assert.equal(recovered.closed, true);
  assert.equal(recovered.alreadyClosed, true);
  assert.equal(
    existsSync(join(h.stateRoot, 'sessions', `${started.session}.json`)),
    false,
  );
});

test('close treats a missing durable native marker as identity reuse', () => {
  const h = harness();
  const started = startWindow({ browser: 'msedge', session: 'native-marker-missing' }, h.runtime);
  h.runtime.native.invoke = (command) => {
    if (command === 'inspect') {
      return {
        exists: true,
        matches: false,
        processMatches: true,
        markerMatches: false,
        actualProcessId: 20,
      };
    }
    throw new Error('must not close a reused native window');
  };
  assert.throws(() => closeWindow({ session: started.session }, h.runtime), {
    code: 'window-identity-mismatch',
  });
});

test('close refuses a reused native identity and retains state', () => {
  const h = harness();
  startWindow({ browser: 'msedge', session: 'stale' }, h.runtime);
  h.runtime.native.invoke = (command) => {
    if (command === 'inspect') return { exists: true, matches: false, actualProcessId: 99 };
    throw new Error('must not close or detach');
  };
  assert.throws(() => closeWindow({ session: 'stale' }, h.runtime), {
    code: 'window-identity-mismatch',
  });
  assert.doesNotThrow(() => readFileSync(join(h.stateRoot, 'sessions', 'stale.json')));
});

test('close treats a user-closed tracked window as idempotent and removes state', () => {
  const h = harness();
  startWindow({ browser: 'msedge', session: 'user-closed' }, h.runtime);
  const original = h.runtime.native.invoke;
  h.runtime.native.invoke = (command, ...args) => {
    if (command === 'inspect') return { exists: false, matches: false };
    return original(command, ...args);
  };
  const result = closeWindow({ session: 'user-closed' }, h.runtime);
  assert.equal(result.alreadyClosed, true);
  assert.equal(
    existsSync(join(h.stateRoot, 'sessions', 'user-closed.json')),
    false,
  );
});

test('close retains state until native closure is verified', () => {
  const h = harness();
  startWindow({ browser: 'msedge', session: 'cannot-close' }, h.runtime);
  const original = h.runtime.native.invoke;
  h.runtime.native.invoke = (command, ...args) => {
    if (command === 'close') return { exists: true, matches: true, closed: false };
    return original(command, ...args);
  };
  assert.throws(() => closeWindow({ session: 'cannot-close' }, h.runtime), {
    code: 'window-close-failed',
  });
  assert.equal(
    existsSync(join(h.stateRoot, 'sessions', 'cannot-close.json')),
    true,
  );
});

test('two starts produce distinct sessions and state files', () => {
  const first = harness({ random: (size) => Buffer.alloc(size, 0x11) });
  const second = harness({ random: (size) => Buffer.alloc(size, 0x22) });
  const a = startWindow({ browser: 'msedge' }, first.runtime);
  const b = startWindow({ browser: 'msedge' }, second.runtime);
  assert.notEqual(a.session, b.session);
});

test('start claims the session lock before waiting for the global startup lock', () => {
  const h = harness();
  startWindow({ browser: 'msedge', session: 'race-session' }, h.runtime);
  assert.deepEqual(
    h.calls
      .filter((call) => call.type === 'lock' || call.type === 'unlock')
      .map((call) => `${call.type}:${call.path}`),
    [
      `lock:${join(h.stateRoot, 'sessions', 'race-session.lock')}`,
      `lock:${join(h.stateRoot, 'startup.lock')}`,
      `unlock:${join(h.stateRoot, 'startup.lock')}`,
      `unlock:${join(h.stateRoot, 'sessions', 'race-session.lock')}`,
    ],
  );
});

test('global lock failure releases the already-held session lock', () => {
  const h = harness();
  const sessionPath = join(h.stateRoot, 'sessions', 'blocked-session.lock');
  h.runtime.acquireLock = (path) => {
    h.calls.push({ type: 'lock', path });
    if (path.endsWith('startup.lock')) {
      const error = new Error('busy');
      error.code = 'startup-busy';
      throw error;
    }
    return () => h.calls.push({ type: 'unlock', path });
  };
  assert.throws(
    () => startWindow({ browser: 'msedge', session: 'blocked-session' }, h.runtime),
    { code: 'startup-busy' },
  );
  assert.deepEqual(
    h.calls
      .filter((call) => call.type === 'lock' || call.type === 'unlock')
      .map((call) => `${call.type}:${call.path}`),
    [
      `lock:${sessionPath}`,
      `lock:${join(h.stateRoot, 'startup.lock')}`,
      `unlock:${sessionPath}`,
    ],
  );
});

test('session lock callers use distinct wait policies', () => {
  const start = harness();
  startWindow({ browser: 'msedge', session: 'start-policy' }, start.runtime);
  const startLock = start.calls.find((call) =>
    call.type === 'lock' && call.path.endsWith('start-policy.lock'));
  assert.equal(startLock.options.timeoutMs, 180_000);
  assert.equal(startLock.options.busyCode, 'session-busy');

  const close = harness();
  closeWindow({ session: 'close-policy' }, close.runtime);
  const closeLock = close.calls.find((call) =>
    call.type === 'lock' && call.path.endsWith('close-policy.lock'));
  assert.equal(closeLock.options.timeoutMs, 600_000);
  assert.equal(closeLock.options.staleMs, 180_000);
});

test('custom lock contention reports the caller-specific busy code', () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-window-session-lock-'));
  const path = join(root, 'session.lock');
  const release = acquireLock(path);
  let time = 0;
  assert.throws(() => acquireLock(path, {
    timeoutMs: 3,
    staleMs: 10,
    busyCode: 'session-busy',
    busyMessage: 'session busy',
    now: () => time++,
    wait: () => {},
  }), { code: 'session-busy' });
  release();
});

test('startup lock rejects overlapping lifecycle mutations and releases cleanly', () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-window-lock-'));
  const path = join(root, 'startup.lock');
  const release = acquireLock(path);
  let time = 0;
  assert.throws(() => acquireLock(path, {
    timeoutMs: 3,
    now: () => time++,
    wait: () => {},
  }), { code: 'startup-busy' });
  release();
  const releaseAgain = acquireLock(path);
  releaseAgain();
});

test('parseTabUrls reads URLs rather than attacker-controlled titles', () => {
  assert.deepEqual(parseTabUrls([
    '### Result',
    '- 0: (current) [chrome-extension://fake/](https://example.com/)',
    '- 1: [Welcome](chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?token=secret)',
  ].join('\n')), [
    'https://example.com/',
    'chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?token=secret',
  ]);
});

test('scope predicates reject extra tabs, forged titles, and retained tokens', () => {
  const welcome = '- 0: (current) [Welcome](chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?token=secret)';
  assert.equal(hasExpectedWelcome(welcome), true);
  assert.equal(hasExpectedWelcome(`${welcome}\n- 1: [User](https://example.com/)`), false);
  assert.equal(
    hasExpectedWelcome('- 0: [chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/](https://example.com/)'),
    false,
  );
  assert.equal(
    hasExpectedWelcome('- 0: [Hostile](https://evil.example/a](chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html)'),
    false,
  );
  assert.equal(hasSafeBlank('- 0: (current) [](about:blank)'), true);
  assert.equal(hasSafeBlank('- 0: [token=secret](about:blank)'), false);
});

for (const [name, extraRow] of [
  ['ambiguous title', '- 1: [Markdown example ]( in title](https://example.com/)'],
  ['crashed tab', '- 1: [User](https://example.com/) [crashed]'],
  ['missing delimiter', '- 1: [User https://example.com/)'],
  ['missing closing parenthesis', '- 1: [User](https://example.com/'],
]) {
  test(`tab scope fails closed for an extra ${name}`, () => {
    const welcome = '- 0: (current) [Welcome](chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?token=secret)';
    const blank = '- 0: (current) [](about:blank)';
    assert.deepEqual({
      welcome: hasExpectedWelcome(`${welcome}\n${extraRow}`),
      blank: hasSafeBlank(`${blank}\n${extraRow}`),
      urls: parseTabUrls(`${blank}\n${extraRow}`),
    }, { welcome: false, blank: false, urls: null });
    assert.equal(parseTabUrls(`${extraRow}\n${blank}`), null);
  });
}

test('start binds launch and attach to the token profile and marks the native window', () => {
  let tokenRequest;
  const h = harness({
    resolveToken: (browser, profile) => {
      tokenRequest = { browser, profile };
      return { ok: true, token, profile: { dir: 'Profile 2' } };
    },
  });
  const result = startWindow({
    browser: 'chrome',
    profile: 'Work Profile',
    session: 'profile-bound',
  }, h.runtime);
  const launch = h.calls.find((call) => call.type === 'launch-options');
  const attach = h.calls.find((call) => call.type === 'attach');
  assert.deepEqual(tokenRequest, { browser: 'chrome', profile: 'Work Profile' });
  assert.equal(launch.profileDirectory, 'Profile 2');
  assert.equal(attach.profileDirectory, 'Profile 2');
  assert.equal(result.profile, 'Profile 2');
  assert.equal(result.profileDirectory, 'Profile 2');
  assert.match(launch.marker, /^agent-[a-f0-9]{16}$/);
  assert.ok(h.calls.some((call) => call.type === 'native' && call.command === 'mark'));
});

test('start fails closed if foreground changes during attach', () => {
  const h = harness();
  const original = h.runtime.native.invoke;
  let currentCalls = 0;
  h.runtime.native.invoke = (command, ...args) => {
    if (command === 'current' && ++currentCalls === 2) {
      return { id: '100', processId: 20 };
    }
    return original(command, ...args);
  };
  assert.throws(
    () => startWindow({ browser: 'msedge', session: 'focus-lost' }, h.runtime),
    { code: 'attachment-target-lost' },
  );
  assert.equal(h.isLaunched(), false);
  assert.ok(h.calls.some((call) => call.type === 'clear-welcome'));
});

test('stale empty startup locks are reclaimed after the timeout', () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-window-empty-lock-'));
  const path = join(root, 'startup.lock');
  writeFileSync(path, '');
  const release = acquireLock(path, {
    now: () => Date.now() + 180_000,
    wait: () => {},
  });
  release();
});

test('lock release never removes a replacement owner lock', () => {
  const root = mkdtempSync(join(tmpdir(), 'browser-window-owner-lock-'));
  const path = join(root, 'startup.lock');
  const release = acquireLock(path, { random: () => Buffer.alloc(16, 0x11) });
  writeFileSync(path, JSON.stringify({ pid: process.pid, owner: 'replacement' }));
  release();
  assert.equal(existsSync(path), true);
});

test('failed marker identification discards only marker-matched candidates', () => {
  const h = harness();
  let listCalls = 0;
  const original = h.runtime.native.invoke;
  h.runtime.native.invoke = (command, browser, identity, previous) => {
    if (command === 'list') {
      listCalls++;
      if (listCalls === 1) return [{ id: '100', processId: 20, title: 'User page' }];
      return [
        { id: '100', processId: 20, title: 'User page' },
        { id: '200', processId: 20, title: `${identity?.marker || ''} duplicate` },
      ];
    }
    return original(command, browser, identity, previous);
  };
  h.runtime.wait = () => {};
  h.runtime.launch = (browser, profile, requestedMarker) => {
    h.calls.push({ type: 'launch' });
    h.runtime.native.invoke = ((invoke) => (command, b, identity, previous) => {
      if (command === 'list') {
        listCalls++;
        if (listCalls === 1) return [{ id: '100', processId: 20, title: 'User page' }];
        return [
          { id: '100', processId: 20, title: 'User page' },
          { id: '200', processId: 20, title: requestedMarker },
          { id: '201', processId: 20, title: requestedMarker },
        ];
      }
      return invoke(command, b, identity, previous);
    })(h.runtime.native.invoke);
  };
  assert.throws(
    () => startWindow({ browser: 'msedge', session: 'ambiguous-marker' }, h.runtime),
    { code: 'window-not-created' },
  );
  assert.equal(
    h.calls.filter((call) => call.type === 'native' && call.command === 'discard').length,
    2,
  );
});

test('mark failure discards the marker-titled window instead of trusting an absent property', () => {
  const h = harness();
  const original = h.runtime.native.invoke;
  h.runtime.native.invoke = (command, ...args) => {
    if (command === 'mark') return { exists: true, matches: true, marked: false };
    return original(command, ...args);
  };
  assert.throws(
    () => startWindow({ browser: 'msedge', session: 'mark-failed' }, h.runtime),
    { code: 'window-mark-failed' },
  );
  assert.equal(h.isLaunched(), false);
  assert.ok(h.calls.some((call) => call.type === 'native' && call.command === 'discard'));
});
