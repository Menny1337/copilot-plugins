import {
  mkdirSync, existsSync, readFileSync, writeFileSync, renameSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquireLock, defaultStateRoot, playwrightInvocation, createNativeAdapter,
} from './browser-window.mjs';

const SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function fail(code, message, details) {
  throw Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}
function privateDir(path) { mkdirSync(path, {recursive:true,mode:0o700}); }
function store(path, state) {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', {mode:0o600,flag:'wx'});
  renameSync(temporary, path);
}
export function managedEnvironment(env = process.env) {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([key]) =>
      !key.startsWith('PLAYWRIGHT_MCP_') && !key.startsWith('PWTEST_') &&
      !key.startsWith('COPILOT_PLUGIN_BROWSER_') && !key.startsWith('COPILOT_BROWSER_') &&
      !['NODE_OPTIONS','PLAYWRIGHT_CLI_SESSION'].includes(key))),
    NO_UPDATE_NOTIFIER: '1',
  };
}
export function managedConfig(profilePath, activity) {
  if (!['active','native'].includes(activity)) fail('invalid-activity', 'Activity must be active or native');
  if (activity === 'native') fail('managed-native-unsupported', 'Native activity requires an explicit existing-profile Bridge session: start --profile <name> --activity native');
  return {
    extension: false,
    browser: {
      isolated: false, userDataDir: profilePath,
      initPage: [join(dirname(fileURLToPath(import.meta.url)), 'browser-managed-owner.cjs')],
    },
    snapshot: {mode:'none'},
  };
}
export function ownedProcessIdentity(pid, os = platform(), run = spawnSync) {
  if (!Number.isSafeInteger(pid) || pid <= 0) fail('invalid-state', 'Invalid owned process identifier');
  const result = os === 'win32'
    ? run('powershell.exe', ['-NoProfile','-NonInteractive','-Command',
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; if ($p) { $p.CreationDate.ToUniversalTime().ToString("o") }`],
    {encoding:'utf8',timeout:10000,windowsHide:true})
    : run('ps', ['-p',String(pid),'-o','lstart='], {encoding:'utf8',timeout:10000});
  if (result.error || (result.status !== 0 && !(os !== 'win32' && result.status === 1 && !result.stdout.trim()))) {
    fail('process-inspection-failed', 'Cannot verify the owned browser process');
  }
  const identity = result.stdout.trim();
  return identity ? {pid,identity} : null;
}
function cli(args, cwd, env) {
  const invocation = playwrightInvocation();
  const result = spawnSync(invocation.command, [...invocation.prefix,...args], {
    cwd,env,encoding:'utf8',timeout:60000,windowsHide:true,maxBuffer:4*1024*1024,
  });
  return {status:result.status,stdout:result.stdout || '',timedOut:result.error?.code === 'ETIMEDOUT'};
}
export function createManagedRuntime(overrides = {}) {
  const native = createNativeAdapter();
  return {
    stateRoot: defaultStateRoot(), cli, processIdentity:ownedProcessIdentity,
    current: browser => native.invoke(platform() === 'darwin' ? 'current-process' : 'current',browser),
    restore: (browser,previous) => native.invoke('restore',browser,{},previous),
    globalConfigExists: () => existsSync(join(homedir(),'.playwright','cli.config.json')),
    wait:sleep, ...overrides,
  };
}
export function hasManagedState(session, runtime = createManagedRuntime()) {
  return SESSION.test(session || '') && existsSync(join(runtime.stateRoot,'managed',`${session}.json`));
}
function paths(runtime, session) {
  if (!SESSION.test(session || '')) fail('invalid-session','Invalid browser session name');
  privateDir(join(runtime.stateRoot,'managed'));
  privateDir(join(runtime.stateRoot,'sessions'));
  return {
    state:join(runtime.stateRoot,'managed',`${session}.json`),
    lock:join(runtime.stateRoot,'sessions',`${session}.lock`),
  };
}
function readState(file, runtime, session) {
  let state;
  try { state = JSON.parse(readFileSync(file,'utf8')); }
  catch { fail('invalid-state','Managed ownership record is unreadable'); }
  if (state.version !== 1 || state.mode !== 'managed' || state.session !== session ||
      !/^[a-f0-9]{32}$/.test(state.ownerId || '') ||
      !['msedge','chrome'].includes(state.browser) || !['active','native'].includes(state.activity) ||
      state.cwd !== join(runtime.stateRoot,'tasks',state.ownerId) ||
      state.profilePath !== join(state.cwd,'profile') ||
      !['starting','running','failed','closed'].includes(state.phase)) {
    fail('invalid-state','Managed ownership record failed validation');
  }
  return state;
}
function envFor(state) {
  return {
    ...managedEnvironment(),
    COPILOT_BROWSER_OWNER_FILE:join(state.cwd,'owner.json'),
    COPILOT_BROWSER_OWNER_ID:state.ownerId,
  };
}
function entries(runtime, state) {
  const result = runtime.cli(['--json','list'],state.cwd,envFor(state));
  if (result.status !== 0) fail('session-inspection-failed','Cannot inspect this task workspace');
  let data;
  try { data = JSON.parse(result.stdout); } catch { fail('session-inspection-failed','CLI list did not return JSON'); }
  if (!Array.isArray(data.browsers)) fail('session-inspection-failed','CLI list has an unsupported shape');
  return data.browsers;
}
function captureOwner(runtime, state) {
  let owner;
  try { owner = JSON.parse(readFileSync(join(state.cwd,'owner.json'),'utf8')); }
  catch { fail('ownership-unverified','Launch did not return owned-browser identity'); }
  if (owner.ownerId !== state.ownerId || !Number.isSafeInteger(owner.browserPid) ||
      !Number.isSafeInteger(owner.daemonPid)) fail('ownership-unverified','Invalid owned-browser proof');
  const identity = runtime.processIdentity(owner.browserPid);
  if (!identity) fail('ownership-unverified','Owned browser exited during startup');
  state.browserProcess = identity;
  state.daemonPid = owner.daemonPid;
}
function sameForeground(a,b) {
  return String(a.processId) === String(b.processId) && String(a.id) === String(b.id);
}
function currentForeground(runtime,browser) {
  const value = runtime.current(browser);
  if (!Number.isSafeInteger(value?.processId) || value.processId <= 0 ||
      typeof value.processName !== 'string' || !value.processName) {
    fail('foreground-unavailable','Cannot establish the foreground application');
  }
  return value;
}
function restoreForeground(runtime,state,before) {
  const after = currentForeground(runtime,state.browser);
  state.foregroundAfterLaunch = after;
  if (sameForeground(before,after)) return;
  if (after.processId !== state.browserProcess.pid) {
    fail('foreground-interrupted','Foreground changed to another application; no focus action was attempted');
  }
  if (!runtime.restore(state.browser,before)?.restored ||
      !sameForeground(before,currentForeground(runtime,state.browser))) {
    fail('foreground-restore-failed','The prior foreground could not be verified after one restoration');
  }
}
function shutdown(runtime,state) {
  if (state.launchAttempted === false) return {alreadyClosed:true};
  if (!state.browserProcess) fail('ownership-unverified','No owned browser identity; profile and failure state retained');
  const live = runtime.processIdentity(state.browserProcess.pid);
  if (!live) return {alreadyClosed:true};
  if (live.identity !== state.browserProcess.identity) {
    fail('owned-identity-mismatch','Browser PID was reused; refusing to close any session');
  }
  const entry = entries(runtime,state).find(item=>item.name === state.session);
  if (entry && (entry.attached || entry.userDataDir !== state.profilePath)) {
    fail('owned-identity-mismatch','CLI session no longer belongs to this task');
  }
  if (!entry) fail('owned-close-failed','Owned browser still exists without a reachable task session');
  const result = runtime.cli([`-s=${state.session}`,'--json','close'],state.cwd,envFor(state));
  for (let i=0;i<50;i++) {
    const remaining = runtime.processIdentity(state.browserProcess.pid);
    if (!remaining) {
      if (result.status !== 0) state.closeWarning = 'CLI close returned an error, but native process absence was verified';
      return {alreadyClosed:false};
    }
    if (remaining.identity !== state.browserProcess.identity) {
      fail('owned-identity-mismatch','Browser PID changed during shutdown; refusing further action');
    }
    runtime.wait(100);
  }
  fail('owned-close-failed','Owned native browser remains after close; state and profile retained');
}
export function startManaged(options = {}, runtime = createManagedRuntime()) {
  const browser = options.browser || 'msedge', activity = options.activity || 'active';
  if (!['msedge','chrome'].includes(browser)) fail('unsupported-browser','Use msedge or chrome');
  if (!['active','native'].includes(activity)) fail('invalid-activity','Use active or native');
  if (activity === 'native') fail('managed-native-unsupported','Native activity requires an explicit existing-profile Bridge session: start --profile <name> --activity native');
  if (options.profile) fail('invalid-profile','Normal profiles require the explicit Bridge fallback');
  if (runtime.globalConfigExists()) {
    fail('managed-config-conflict','Global ~/.playwright/cli.config.json may redirect owned launch. Resolve its scope explicitly; no config was changed');
  }
  const session = options.session || `agent-${browser}-${randomBytes(12).toString('hex')}`;
  const p = paths(runtime,session);
  const release = acquireLock(p.lock,{busyCode:'session-busy',timeoutMs:1000});
  let state, releaseStartup;
  try {
    if (existsSync(p.state) || existsSync(join(runtime.stateRoot,'sessions',`${session}.json`))) {
      fail('session-exists','Session name already reserved; use a new name, even after close');
    }
    releaseStartup = acquireLock(join(runtime.stateRoot,'startup.lock'));
    const ownerId = randomBytes(16).toString('hex');
    const cwd = join(runtime.stateRoot,'tasks',ownerId);
    privateDir(join(runtime.stateRoot,'tasks'));
    mkdirSync(cwd,{mode:0o700});
    mkdirSync(join(cwd,'.playwright'),{mode:0o700});
    const profilePath = join(cwd,'profile');
    mkdirSync(profilePath,{mode:0o700});
    state = {version:1,mode:'managed',session,ownerId,browser,activity,cwd,profilePath,
      profileRetained:true,phase:'starting',launchAttempted:false,createdAt:new Date().toISOString()};
    store(p.state,state);
    if (entries(runtime,state).some(item=>item.name === session)) fail('session-exists','CLI session already exists; refusing to replace it');
    const config = join(cwd,'launch.json');
    writeFileSync(config,JSON.stringify(managedConfig(profilePath,activity)),{flag:'wx',mode:0o600});
    const foreground = currentForeground(runtime,browser);
    if (['Microsoft Edge','Google Chrome','msedge','chrome'].includes(foreground.processName)) {
      fail('foreground-browser','Start with a stable non-browser application in front');
    }
    state.previousForeground = foreground;
    state.launchAttempted = true;
    store(p.state,state);
    const opened = runtime.cli([`-s=${session}`,'--json','open','--persistent','--headed',
      `--browser=${browser}`,`--profile=${profilePath}`,`--config=${config}`],cwd,envFor(state));
    captureOwner(runtime,state);
    store(p.state,state);
    if (opened.status !== 0) fail('owned-launch-failed','CLI launch failed; attempting exact owned cleanup');
    const entry = entries(runtime,state).find(item=>item.name === session);
    if (!entry || entry.attached || entry.userDataDir !== profilePath) fail('ownership-unverified','CLI ownership does not match the fresh profile');
    restoreForeground(runtime,state,foreground);
    const before = currentForeground(runtime,browser);
    const probe = runtime.cli([`-s=${session}`,'--raw','run-code',
      'async page => ({pages:page.context().pages().length,...await page.evaluate(() => ({visible:document.visibilityState==="visible",hidden:document.hidden,focused:document.hasFocus()}))})'],
    cwd,envFor(state));
    let value;
    try { value = JSON.parse(probe.stdout); } catch { fail('activity-verification-failed','Activity probe returned no structured result'); }
    if (probe.status !== 0 || value.pages !== 1 || !value.visible || value.hidden || !value.focused) {
      fail('activity-verification-failed','Fresh owned page did not meet the selected activity contract');
    }
    if (!sameForeground(before,currentForeground(runtime,browser)) || !sameForeground(foreground,before)) {
      fail('foreground-interrupted','Page activity was not verified under stable non-browser foreground');
    }
    state.phase = 'running';
    store(p.state,state);
    return {ok:true,mode:'managed',session,browser,activity,cwd,profilePath,profileRetained:true};
  } catch (error) {
    if (state) {
      state.phase = 'failed';
      state.error = error.code || 'owned-start-failed';
      try {
        if (state.launchAttempted && !state.browserProcess) captureOwner(runtime,state);
        shutdown(runtime,state);
        state.cleanupVerified = true;
      } catch (cleanupError) {
        state.cleanupVerified = false;
        state.cleanupError = cleanupError.code || 'owned-cleanup-failed';
      }
      store(p.state,state);
      error.details = {session,profilePath:state.profilePath,profileRetained:true,cleanupVerified:state.cleanupVerified,
        ...(state.foregroundAfterLaunch ? {foregroundBefore:state.previousForeground,foregroundAfterLaunch:state.foregroundAfterLaunch} : {}),
        ...(state.cleanupError ? {cleanupError:state.cleanupError} : {})};
    }
    throw error;
  } finally { releaseStartup?.(); release(); }
}
export function closeManaged(session, runtime = createManagedRuntime()) {
  const p = paths(runtime,session);
  const release = acquireLock(p.lock,{busyCode:'session-busy',timeoutMs:1000});
  try {
    const state = readState(p.state,runtime,session);
    const result = state.phase === 'closed' ? {alreadyClosed:true} : shutdown(runtime,state);
    state.phase = 'closed';
    state.cleanupVerified = true;
    state.closedAt ||= new Date().toISOString();
    store(p.state,state);
    return {ok:true,mode:'managed',session,closed:true,alreadyClosed:result.alreadyClosed,
      profilePath:state.profilePath,profileRetained:true,...(state.closeWarning ? {warning:state.closeWarning} : {})};
  } finally { release(); }
}
