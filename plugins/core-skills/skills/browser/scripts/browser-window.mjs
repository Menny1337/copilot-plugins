#!/usr/bin/env node

import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { resolveToken } from './bridge-token.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ID = 'mmlmfjhmonkocbjadbfplnigmagldckm';
const PROFILE_LAUNCHER = join(SCRIPT_DIR, 'browser-profile-launcher.cjs');
const STATE_VERSION = 1;
const ATTACH_TIMEOUT_MS = 25_000;
const START_LOCK_TIMEOUT_MS = 120_000;
const SESSION_LOCK_TIMEOUT_MS = 180_000;
const CLOSE_LOCK_TIMEOUT_MS = 600_000;
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PROFILE_RE = /^(?!\.\.?$)[^\\/\u0000-\u001f\u007f]{1,128}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MARKER_RE = /^agent-[a-f0-9]{16}$/;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

export function parseArgs(argv) {
  const command = argv[0];
  if (!['start', 'close'].includes(command)) {
    fail('usage', 'Usage: browser-window.mjs start [--browser msedge|chrome] [--profile name] [--session name]\n' +
      '       browser-window.mjs close --session name');
  }

  const values = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) fail('usage', `Unexpected argument: ${arg}`);
    const equal = arg.indexOf('=');
    const name = equal === -1 ? arg.slice(2) : arg.slice(2, equal);
    const value = equal === -1 ? argv[++i] : arg.slice(equal + 1);
    if (!['browser', 'profile', 'session'].includes(name) || !value || value.startsWith('--')) {
      fail('usage', `--${name} requires a value`);
    }
    values[name] = value;
  }

  const browser = (values.browser || 'msedge').toLowerCase();
  if (!['msedge', 'chrome'].includes(browser)) {
    fail('unsupported-browser', '--browser must be msedge or chrome');
  }
  if (values.session && !SESSION_RE.test(values.session)) {
    fail('invalid-session', 'Session names must be 1-64 letters, numbers, dots, underscores, or hyphens');
  }
  if (values.profile && !PROFILE_RE.test(values.profile)) {
    fail('invalid-profile', 'Profile names must be 1-128 characters without control characters or path separators');
  }
  if (command === 'close' && !values.session) {
    fail('session-required', 'close requires --session <name>');
  }

  return {
    command,
    browser,
    profile: values.profile || null,
    session: values.session || null,
  };
}

export function generateSession(browser, random = randomBytes) {
  return `agent-${browser}-${process.pid}-${random(4).toString('hex')}`;
}

export function defaultStateRoot(os = platform(), env = process.env) {
  if (os === 'win32') {
    return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'browser-window');
  }
  if (os === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'browser-window');
  }
  fail('unsupported-platform', 'Dedicated browser windows support Windows and macOS only');
}

function ensurePrivateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // Windows ACLs, not POSIX mode bits, govern access.
  }
}

function atomicWriteJson(path, value) {
  ensurePrivateDir(dirname(path));
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on Windows.
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail('invalid-state', `Cannot read lifecycle state: ${error.message}`);
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function acquireLock(path, {
  timeoutMs = START_LOCK_TIMEOUT_MS,
  staleMs = START_LOCK_TIMEOUT_MS,
  now = Date.now,
  wait = sleep,
  random = randomBytes,
  busyCode = 'startup-busy',
  busyMessage = 'Another browser window is currently being started; retry shortly',
} = {}) {
  ensurePrivateDir(dirname(path));
  const deadline = now() + timeoutMs;
  const owner = random(16).toString('hex');
  while (now() < deadline) {
    try {
      const fd = openSync(path, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify({
        pid: process.pid,
        owner,
        createdAt: new Date(now()).toISOString(),
      }));
      closeSync(fd);
      return () => {
        try {
          const current = JSON.parse(readFileSync(path, 'utf8'));
          if (current.owner === owner) unlinkSync(path);
        } catch {
          // Another failure path may already have released it.
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let age = 0;
      try {
        age = now() - statSync(path).mtimeMs;
        const lock = JSON.parse(readFileSync(path, 'utf8'));
        if (!processAlive(lock.pid)) {
          unlinkSync(path);
          continue;
        }
      } catch (readError) {
        if (readError.code === 'ENOENT') continue;
        if (age > staleMs) {
          try {
            unlinkSync(path);
            continue;
          } catch {
            // Another process may have replaced the lock.
          }
        }
      }
      wait(100);
    }
  }
  fail(busyCode, busyMessage);
}

function browserExecutable(browser, os = platform(), env = process.env) {
  if (os === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
    const relative = browser === 'chrome'
      ? join('Google', 'Chrome', 'Application', 'chrome.exe')
      : join('Microsoft', 'Edge', 'Application', 'msedge.exe');
    const match = roots.map((root) => join(root, relative)).find(existsSync);
    if (match) return match;
  }
  if (os === 'darwin') {
    return browser === 'chrome'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  }
  fail('browser-not-found', `${browser} is not installed in a standard location`);
}

function runJson(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout || 10_000,
    windowsHide: true,
    env: options.env || process.env,
  });
  if (result.error) {
    const message = (result.stderr || result.stdout || result.error?.message || '').trim();
    fail('native-command-failed', message || `${command} failed`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    const message = (result.stderr || result.stdout || '').trim();
    fail(
      result.status === 0 ? 'native-command-invalid' : 'native-command-failed',
      message || `${command} failed`,
    );
  }
  return parsed;
}

function createNativeAdapter(os = platform()) {
  if (os === 'win32') {
    const script = join(SCRIPT_DIR, 'browser-window-windows.ps1');
    return {
      invoke(command, browser, identity = {}, previous = {}) {
        const args = [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', script, '-Command', command, '-Browser', browser,
        ];
        if (identity.id) args.push('-Handle', String(identity.id));
        if (identity.processId) args.push('-ProcessId', String(identity.processId));
        if (identity.marker) args.push('-Marker', String(identity.marker));
        if (previous.id) args.push('-PreviousHandle', String(previous.id));
        if (previous.processId) args.push('-PreviousProcessId', String(previous.processId));
        const value = runJson('powershell.exe', args);
        return command === 'list' ? (Array.isArray(value) ? value : [value]) : value;
      },
    };
  }
  if (os === 'darwin') {
    const script = join(SCRIPT_DIR, 'browser-window-macos.applescript');
    return {
      invoke(command, browser, identity = {}, previous = {}) {
        const value = runJson('osascript', [
          script,
          command,
          browser,
          identity.id || '',
          identity.processId || '',
          identity.marker || '',
          previous.processName || '',
          previous.id || '',
        ]);
        return command === 'list' ? (Array.isArray(value) ? value : [value]) : value;
      },
    };
  }
  fail('unsupported-platform', 'Dedicated browser windows support Windows and macOS only');
}

function runPlaywright(args, { timeout = 15_000, env = {} } = {}) {
  const invocation = playwrightInvocation();
  const result = spawnSync(invocation.command, [...invocation.prefix, ...args], {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT',
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
    error: result.error,
  };
}

export function isSupportedPlaywrightVersion(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major > 0 || minor > 1 || (minor === 1 && patch >= 19);
}

export function playwrightInvocation(os = platform(), env = process.env) {
  if (os !== 'win32') return { command: 'playwright-cli', prefix: [] };
  for (const directory of (env.PATH || '').split(delimiter).filter(Boolean)) {
    const shim = join(directory, 'playwright-cli.ps1');
    if (existsSync(shim)) {
      const cli = join(directory, 'node_modules', '@playwright', 'cli', 'playwright-cli.js');
      if (existsSync(cli)) return { command: process.execPath, prefix: [cli] };
    }
  }
  return { command: 'playwright-cli', prefix: [] };
}

function playwrightVersion() {
  const result = runPlaywright(['--version']);
  const match = result.output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (result.status !== 0 || !match) fail('playwright-missing', 'playwright-cli is not installed');
  if (!isSupportedPlaywrightVersion(match[0])) {
    fail('playwright-version', 'playwright-cli 0.1.19 or newer is required');
  }
  return match[0];
}

function playwrightSessionExists(session) {
  return runPlaywright([`-s=${session}`, 'tab-list'], { timeout: 5_000 }).status === 0;
}

export function nodeOptionsWithRequire(existing, requiredPath) {
  return [existing, '--require', JSON.stringify(requiredPath)].filter(Boolean).join(' ');
}

export function extensionAttachEnvironment(
  browser,
  profileDirectory,
  token,
  {
    os = platform(),
    env = process.env,
    nodePath = process.execPath,
    launcherPath = PROFILE_LAUNCHER,
  } = {},
) {
  return {
    PLAYWRIGHT_MCP_EXTENSION_TOKEN: token,
    PLAYWRIGHT_MCP_EXECUTABLE_PATH: nodePath,
    COPILOT_PLUGIN_BROWSER_PROFILE_LAUNCH: '1',
    COPILOT_PLUGIN_BROWSER_EXECUTABLE: browserExecutable(browser, os, env),
    COPILOT_PLUGIN_BROWSER_PROFILE_DIRECTORY: profileDirectory,
    NODE_OPTIONS: nodeOptionsWithRequire(env.NODE_OPTIONS, launcherPath),
  };
}

function attachPlaywright(browser, session, token, profileDirectory) {
  if (!PROFILE_RE.test(profileDirectory || '')) {
    fail('invalid-profile', 'Selected browser profile directory is unavailable');
  }
  if (!existsSync(PROFILE_LAUNCHER)) {
    fail('profile-launcher-missing', 'The browser profile launcher is unavailable');
  }
  const result = runPlaywright([
    'attach',
    `--extension=${browser}`,
    `--session=${session}`,
  ], {
    timeout: ATTACH_TIMEOUT_MS,
    env: extensionAttachEnvironment(browser, profileDirectory, token),
  });
  if (result.timedOut) fail('attach-timeout', 'Playwright Bridge attach timed out');
  if (result.status !== 0) fail('attach-failed', 'Playwright Bridge attach failed');
}

export function parseTabUrls(output) {
  const urls = [];
  for (const line of output.split(/\r?\n/)) {
    if (!/^-\s+\d+:/.test(line.trim())) continue;
    // CLI titles are unescaped: an unreadable row must invalidate the entire scope.
    if (!line.endsWith(')')) return null;
    const first = line.indexOf('](');
    if (first === -1 || first !== line.lastIndexOf('](')) return null;
    urls.push(line.slice(first + 2, -1));
  }
  return urls;
}

export function hasExpectedWelcome(output) {
  const urls = parseTabUrls(output);
  if (!urls || urls.length !== 1) return false;
  try {
    const url = new URL(urls[0]);
    return url.protocol === 'chrome-extension:' && url.host === EXTENSION_ID;
  } catch {
    return false;
  }
}

export function hasSafeBlank(output) {
  const urls = parseTabUrls(output);
  return urls !== null && urls.length === 1 && urls[0] === 'about:blank' && !output.includes('token=');
}

function verifyScopedSession(session) {
  const result = runPlaywright([`-s=${session}`, 'tab-list']);
  if (result.status !== 0) fail('session-unavailable', 'Playwright session is unavailable after attach');
  if (!hasExpectedWelcome(result.output)) {
    fail('scope-verification-failed', 'Attached session exposed pages outside the Bridge Welcome page');
  }
}

function sanitizeScopedSession(session) {
  const opened = runPlaywright([`-s=${session}`, 'tab-new', 'about:blank']);
  if (opened.status !== 0) {
    fail('scope-sanitization-failed', 'Could not create a safe replacement for the Bridge Welcome page');
  }
  const closedWelcome = runPlaywright([`-s=${session}`, 'tab-close', '0']);
  if (closedWelcome.status !== 0) {
    fail('scope-sanitization-failed', 'Could not close the credential-bearing Bridge Welcome page');
  }
  const listed = runPlaywright([`-s=${session}`, 'tab-list']);
  if (listed.status !== 0 || !hasSafeBlank(listed.output)) {
    fail('scope-sanitization-failed', 'Playwright session did not settle on one safe blank page');
  }
}

function bindPlaywrightSession(session, marker) {
  const result = runPlaywright([
    `-s=${session}`,
    '--raw',
    'eval',
    `() => { document.title = '${marker}'; return document.title; }`,
  ]);
  if (result.status !== 0) {
    fail('attachment-binding-failed', 'Could not create the native-window binding page');
  }
}

function clearBridgeWelcome(session) {
  const listed = runPlaywright([`-s=${session}`, 'tab-list']);
  if (listed.status === 0 && hasExpectedWelcome(listed.output)) {
    runPlaywright([`-s=${session}`, 'tab-close', '0']);
  }
}

function detachPlaywright(session) {
  runPlaywright([`-s=${session}`, 'detach'], { timeout: 10_000 });
}

function launchBrowser(browser, profileDirectory, marker) {
  const executable = browserExecutable(browser);
  if (platform() === 'darwin' && !existsSync(executable)) {
    fail('browser-not-found', `${browser} is not installed in /Applications`);
  }
  const markerPage = `data:text/html,<title>${marker}</title>`;
  const child = spawn(executable, [
    '--new-window',
    ...(profileDirectory ? [`--profile-directory=${profileDirectory}`] : []),
    markerPage,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

export function createRuntime(overrides = {}) {
  const stateRoot = overrides.stateRoot || defaultStateRoot();
  return {
    stateRoot,
    native: overrides.native || createNativeAdapter(),
    resolveToken: overrides.resolveToken || resolveToken,
    playwrightVersion: overrides.playwrightVersion || playwrightVersion,
    sessionExists: overrides.sessionExists || playwrightSessionExists,
    attach: overrides.attach || attachPlaywright,
    verifySession: overrides.verifySession || verifyScopedSession,
    bindSession: overrides.bindSession || bindPlaywrightSession,
    clearWelcome: overrides.clearWelcome || clearBridgeWelcome,
    sanitizeSession: overrides.sanitizeSession || sanitizeScopedSession,
    detach: overrides.detach || detachPlaywright,
    launch: overrides.launch || launchBrowser,
    wait: overrides.wait || sleep,
    random: overrides.random || randomBytes,
    acquireLock: overrides.acquireLock || acquireLock,
  };
}

function statePath(runtime, session) {
  return join(runtime.stateRoot, 'sessions', `${session}.json`);
}

function lockPath(runtime) {
  return join(runtime.stateRoot, 'startup.lock');
}

function sessionLockPath(runtime, session) {
  return join(runtime.stateRoot, 'sessions', `${session}.lock`);
}

function discardCandidates(runtime, browser, candidates, marker) {
  for (const candidate of candidates) {
    try {
      runtime.native.invoke('discard', browser, { ...candidate, marker });
    } catch {
      // Only marker-matched candidates are eligible; cleanup failure is reported by startup.
    }
  }
}

function validateTrackedState(state, session) {
  if (state.version !== STATE_VERSION || state.session !== session ||
      !['msedge', 'chrome'].includes(state.browser) ||
      !/^[1-9]\d*$/.test(String(state.window?.id || '')) ||
      !/^[1-9]\d*$/.test(String(state.window?.processId || '')) ||
      !MARKER_RE.test(state.window?.marker || '')) {
    fail('invalid-state', 'Lifecycle state does not match the requested session or identity schema');
  }
}

function closeTrackedWindow(runtime, state) {
  const inspected = runtime.native.invoke('inspect', state.browser, state.window);
  if (inspected.exists && !inspected.matches) {
    if (inspected.markerMayBeClosed === true &&
        inspected.processMatches === true &&
        inspected.markerMatches === false) {
      fail(
        'window-marker-missing',
        'Tracked window marker is missing; it may have been closed or the window ID may have been reused. Confirm the visible window is the dedicated agent window before closing it manually, then rerun close',
      );
    }
    fail('window-identity-mismatch', 'Tracked native window identity no longer matches; refusing to close it');
  }
  if (!inspected.exists) return { closed: true, alreadyClosed: true };
  const result = runtime.native.invoke('close', state.browser, state.window);
  if (!result.closed) fail('window-close-failed', 'Tracked browser window did not close');
  return result;
}

export function startWindow(options, runtime = createRuntime()) {
  const browser = options.browser || 'msedge';
  const session = options.session || generateSession(browser, runtime.random);
  if (!SESSION_RE.test(session)) fail('invalid-session', 'Invalid Playwright session name');

  const releaseSession = runtime.acquireLock(sessionLockPath(runtime, session), {
    timeoutMs: SESSION_LOCK_TIMEOUT_MS,
    busyCode: 'session-busy',
    busyMessage: `Session "${session}" is still starting or closing; retry shortly`,
  });
  let release;
  let state;
  let marked = false;
  let attached = false;
  let previous;
  try {
    release = runtime.acquireLock(lockPath(runtime));
    runtime.playwrightVersion();
    const file = statePath(runtime, session);
    if (existsSync(file) || runtime.sessionExists(session)) {
      fail('session-exists', `Session "${session}" already exists`);
    }

    const tokenResult = runtime.resolveToken(browser, options.profile || null);
    if (!tokenResult.ok || !TOKEN_RE.test(tokenResult.token || '')) {
      const requested = options.profile ? ` profile "${options.profile}"` : '';
      if (tokenResult.reason === 'profile-not-found') {
        fail(
          'profile-not-found',
          options.profile
            ? `No ${browser} browser profile matched "${options.profile}"`
            : `No ${browser} browser profile was found`,
        );
      }
      if (tokenResult.reason === 'profile-ambiguous') {
        const matches = (tokenResult.matches || [])
          .map((profile) => `${profile.name} (${profile.dir})`)
          .join(', ');
        fail('profile-ambiguous', `${browser}${requested} matches multiple profiles: ${matches}`);
      }
      if (tokenResult.reason === 'extension-not-installed') {
        fail('extension-not-installed', `The Playwright Bridge extension is not installed in ${browser}${requested}`);
      }
      fail('bridge-token-unavailable', `No usable Playwright Bridge token was found for ${browser}${requested}`);
    }

    const marker = `agent-${runtime.random(8).toString('hex')}`;
    const before = runtime.native.invoke('list', browser);
    previous = runtime.native.invoke('current', browser);
    runtime.launch(browser, tokenResult.profile?.dir, marker);

    const beforeIds = new Set(before.map((window) => String(window.id)));
    let created = [];
    for (let attempt = 0; attempt < 150; attempt++) {
      runtime.wait(100);
      const after = runtime.native.invoke('list', browser);
      created = after.filter((window) =>
        !beforeIds.has(String(window.id)) && String(window.title || '').includes(marker));
      if (created.length === 1) break;
    }
    if (created.length !== 1) {
      discardCandidates(runtime, browser, created, marker);
      fail('window-not-created', 'Browser did not create one marker-matched visible window; an unidentified window may remain open');
    }

    state = {
      version: STATE_VERSION,
      session,
      browser,
      window: { ...created[0], marker },
      profileName: tokenResult.profile?.name || tokenResult.profile?.dir || null,
      profileDirectory: tokenResult.profile?.dir || null,
      previousForeground: previous,
      createdAt: new Date().toISOString(),
    };
    const markResult = runtime.native.invoke('mark', browser, state.window);
    if (!markResult.marked) fail('window-mark-failed', 'The new browser window could not be marked for safe cleanup');
    marked = true;
    atomicWriteJson(file, state);

    const focused = runtime.native.invoke('foreground', browser, state.window);
    if (!focused.focused) fail('foreground-failed', 'The new browser window could not be foregrounded');

    runtime.attach(browser, session, tokenResult.token, tokenResult.profile.dir);
    attached = true;
    const attachedWindow = runtime.native.invoke('current', browser);
    if (String(attachedWindow.id) !== String(state.window.id) ||
        String(attachedWindow.processId) !== String(state.window.processId)) {
      fail('attachment-target-lost', 'Foreground moved away from the tracked browser window during attach');
    }
    runtime.verifySession(session);
    runtime.bindSession(session, marker);
    let bound = [];
    for (let attempt = 0; attempt < 50; attempt++) {
      runtime.wait(100);
      bound = runtime.native.invoke('list', browser).filter((window) =>
        String(window.title || '').includes(marker));
      if (bound.length === 1) break;
    }
    if (bound.length !== 1 ||
        String(bound[0].id) !== String(state.window.id) ||
        String(bound[0].processId) !== String(state.window.processId)) {
      fail('attachment-binding-failed', 'Playwright attached outside the tracked native browser window');
    }
    runtime.sanitizeSession(session);
    state.attached = true;
    atomicWriteJson(file, state);

    return {
      ok: true,
      session,
      browser,
      profile: state.profileName,
      profileDirectory: state.profileDirectory,
      windowId: String(state.window.id),
    };
  } catch (error) {
    if (state) {
      if (attached && ['attachment-target-lost', 'attachment-binding-failed'].includes(error.code)) {
        try {
          runtime.clearWelcome(state.session);
        } catch {
          // Native-window cleanup remains authoritative.
        }
      }
      try {
        runtime.detach(state.session);
      } catch {
        // Preserve the original failure.
      }
      try {
        if (marked) {
          closeTrackedWindow(runtime, state);
        } else {
          discardCandidates(runtime, browser, [state.window], state.window.marker);
        }
        rmSync(statePath(runtime, state.session), { force: true });
      } catch (cleanupError) {
        error.cleanupError = cleanupError.message;
      }
    }
    throw error;
  } finally {
    if (previous?.id || previous?.processName) {
      try {
        runtime.native.invoke('restore', browser, {}, previous);
      } catch {
        // Focus restoration is best effort when the prior window was closed meanwhile.
      }
    }
    if (release) release();
    releaseSession();
  }
}

export function closeWindow(options, runtime = createRuntime()) {
  const session = options.session;
  if (!SESSION_RE.test(session || '')) fail('invalid-session', 'Invalid Playwright session name');
  const release = runtime.acquireLock(sessionLockPath(runtime, session), {
    timeoutMs: CLOSE_LOCK_TIMEOUT_MS,
    staleMs: SESSION_LOCK_TIMEOUT_MS,
    busyCode: 'session-busy',
    busyMessage: `Session "${session}" is still starting or closing; retry after it finishes`,
  });
  try {
    const file = statePath(runtime, session);
    if (!existsSync(file)) {
      return { ok: true, session, closed: true, alreadyClosed: true };
    }
    const state = readJson(file);
    validateTrackedState(state, session);

    const result = closeTrackedWindow(runtime, state);
    try {
      runtime.detach(session);
    } catch {
      // Closing the native window normally detaches the Bridge automatically.
    }
    rmSync(file);
    return {
      ok: true,
      session,
      browser: state.browser,
      profile: state.profileName || state.profileDirectory,
      profileDirectory: state.profileDirectory,
      windowId: String(state.window.id),
      closed: true,
      alreadyClosed: Boolean(result.alreadyClosed),
    };
  } finally {
    release();
  }
}

export function run(argv, runtime = createRuntime()) {
  const args = parseArgs(argv);
  return args.command === 'start'
    ? startWindow(args, runtime)
    : closeWindow(args, runtime);
}

function main() {
  try {
    console.log(JSON.stringify(run(process.argv.slice(2))));
  } catch (error) {
    const payload = {
      ok: false,
      error: error.code || 'browser-window-failed',
      message: error.message,
    };
    if (error.details) payload.details = error.details;
    if (error.cleanupError) payload.cleanupError = error.cleanupError;
    console.error(JSON.stringify(payload));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
