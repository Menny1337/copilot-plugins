import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  startManaged, closeManaged, createManagedRuntime, managedEnvironment, managedConfig,
  ownedProcessIdentity,
} from './browser-managed.mjs';
import { run } from './browser-window.mjs';

function fixture(t, overrides = {}) {
  const stateRoot = mkdtempSync(join(tmpdir(), 'browser-managed-test-'));
  t.after(() => rmSync(stateRoot, {recursive:true,force:true}));
  const calls = [];
  let live = false, foreign = false, entry;
  const fg = {processName:'Test editor',processId:12,id:'21'};
  const runtime = createManagedRuntime({
    stateRoot,
    globalConfigExists: () => false,
    current: () => fg,
    restore: () => ({restored:true}),
    processIdentity: pid => live ? {pid,identity:foreign?'reused':'created'} : null,
    cli: (args, cwd, env) => {
      calls.push({args,cwd,env});
      if (args.includes('list')) return {status:0,stdout:JSON.stringify({browsers:live ? [entry] : []})};
      if (args.includes('open')) {
        live = true;
        entry = {name:args.find(a=>a.startsWith('-s=')).slice(3),
          userDataDir:args.find(a=>a.startsWith('--profile=')).slice(10),attached:false};
        writeFileSync(env.COPILOT_BROWSER_OWNER_FILE, JSON.stringify({
          ownerId:env.COPILOT_BROWSER_OWNER_ID,browserPid:333,daemonPid:222,
        }));
        return {status:0,stdout:'{}'};
      }
      if (args.includes('run-code')) return {status:0,stdout:JSON.stringify({visible:true,hidden:false,focused:true,pages:1})};
      if (args.includes('close')) {live=false;return {status:0,stdout:'{}'};}
      throw new Error('Unexpected CLI command');
    },
    wait:()=>{},
    ...overrides,
  });
  return {runtime,calls,stateRoot,setLive:value=>{live=value;},reuse:()=>{foreign=true;}};
}

test('default managed launch allocates a fresh private workspace/profile and retains it after verified close', t => {
  const f=fixture(t);
  const a=startManaged({browser:'msedge',activity:'active'},f.runtime);
  assert.equal(a.mode,'managed');
  assert.equal(a.profileRetained,true);
  assert.ok(existsSync(a.profilePath));
  const opened=f.calls.find(c=>c.args.includes('open'));
  assert.ok(opened.args.includes('--persistent'));
  assert.ok(opened.args.includes('--headed'));
  assert.ok(opened.args.includes(`--profile=${a.profilePath}`));
  assert.equal(opened.cwd,a.cwd);
  assert.equal(opened.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN,undefined);
  assert.equal(closeManaged(a.session,f.runtime).closed,true);
  assert.ok(existsSync(a.profilePath));
  assert.equal(closeManaged(a.session,f.runtime).alreadyClosed,true);
  const b=startManaged({browser:'msedge',activity:'active'},f.runtime);
  assert.notEqual(a.profilePath,b.profilePath);
  assert.notEqual(a.session,b.session);
});

test('same explicit name and registry collisions fail before opening, without replacing ownership', t => {
  const f=fixture(t);
  const a=startManaged({session:'same-owner'},f.runtime);
  const before=readFileSync(join(f.stateRoot,'managed','same-owner.json'),'utf8');
  assert.throws(()=>startManaged({session:'same-owner'},f.runtime),{code:'session-exists'});
  assert.equal(readFileSync(join(f.stateRoot,'managed','same-owner.json'),'utf8'),before);
  assert.equal(f.calls.filter(c=>c.args.includes('open')).length,1);
  closeManaged(a.session,f.runtime);
  assert.throws(()=>startManaged({session:'same-owner'},f.runtime),{code:'session-exists'});
  const g=fixture(t,{cli:()=>({status:0,stdout:JSON.stringify({browsers:[{name:'collision'}]})})});
  assert.throws(()=>startManaged({session:'collision'},g.runtime),{code:'session-exists'});
});

test('close refuses reused browser PID and retains state instead of acting on a namesake', t => {
  const f=fixture(t),a=startManaged({},f.runtime);
  f.reuse();
  assert.throws(()=>closeManaged(a.session,f.runtime),{code:'owned-identity-mismatch'});
  assert.equal(f.calls.filter(c=>c.args.includes('close')).length,0);
});

test('failed close never reports success from missing CLI response alone', t => {
  const f=fixture(t),a=startManaged({},f.runtime);
  const cli=f.runtime.cli;
  f.runtime.cli=(args,...rest)=>args.includes('close')?{status:0,stdout:'{}'}:cli(args,...rest);
  assert.throws(()=>closeManaged(a.session,f.runtime),{code:'owned-close-failed'});
  assert.ok(existsSync(a.profilePath));
});

test('user-closed owned browser is idempotent and does not send close to a potentially reused session', t => {
  const f=fixture(t),a=startManaged({},f.runtime);
  f.setLive(false);
  assert.equal(closeManaged(a.session,f.runtime).alreadyClosed,true);
  assert.equal(f.calls.filter(c=>c.args.includes('close')).length,0);
});

test('startup activity failure closes only owned browser and retains failed profile with accurate state', t => {
  const f=fixture(t);
  const cli=f.runtime.cli;
  f.runtime.cli=(args,...rest)=>args.includes('run-code')
    ? {status:0,stdout:'{"visible":false,"hidden":true,"focused":false,"pages":1}'}
    : cli(args,...rest);
  assert.throws(()=>startManaged({session:'bad-activity'},f.runtime),{code:'activity-verification-failed'});
  const state=JSON.parse(readFileSync(join(f.stateRoot,'managed','bad-activity.json')));
  assert.equal(state.phase,'failed');
  assert.equal(state.cleanupVerified,true);
  assert.ok(existsSync(state.profilePath));
});

test('global config and inherited transport/preload overrides cannot redirect managed launch', t => {
  const f=fixture(t,{globalConfigExists:()=>true});
  assert.throws(()=>startManaged({},f.runtime),{code:'managed-config-conflict'});
  assert.equal(f.calls.length,0);
  const env=managedEnvironment({PATH:'x',NODE_OPTIONS:'private-loader',PLAYWRIGHT_MCP_EXTENSION:'1',PLAYWRIGHT_CLI_SESSION:'other',PWTEST_DAEMON_SESSION_DIR:'/elsewhere'});
  assert.deepEqual(env,{PATH:'x',NO_UPDATE_NOTIFIER:'1'});
});

test('owned initialization only captures ownership; managed native is rejected before profile allocation', t => {
  const config=managedConfig('/owned/profile','active');
  assert.equal(config.browser.userDataDir,'/owned/profile');
  assert.equal(config.extension,false);
  assert.equal(config.browser.initPage.length,1);
  assert.ok(config.browser.initPage[0].endsWith('browser-managed-owner.cjs'));
  const f=fixture(t);
  assert.throws(()=>startManaged({activity:'native'},f.runtime),{code:'managed-native-unsupported'});
  assert.equal(existsSync(join(f.stateRoot,'tasks')),false);
  assert.equal(f.calls.length,0);
  assert.throws(()=>managedConfig('/owned/profile','native'),{code:'managed-native-unsupported'});
});

test('CLI routing uses managed by default, stored ownership for close, and Bridge for an explicit profile', async () => {
  const calls=[];
  const managed={
    startManaged:options=>{calls.push(['managed',options]);return {};},
    closeManaged:session=>{calls.push(['close',session]);return {};},
    hasManagedState:()=>true,
  };
  await run(['start'],undefined,managed);
  await run(['close','--session','mine'],undefined,managed);
  const bridge={stateRoot:'/unused',acquireLock:()=>{throw Object.assign(new Error('Reached legacy start'),{code:'bridge-selected'});}};
  await assert.rejects(run(['start','--profile','Default','--activity','native'],bridge,managed),{code:'bridge-selected'});
  assert.equal(calls[0][0],'managed');
  assert.deepEqual(calls[1],['close','mine']);
});

test('foreground restoration happens once only for the exact owned PID, with verified readback', t => {
  const f=fixture(t);
  const prior={processName:'Test editor',processId:12,id:'21'}, own={processName:'Microsoft Edge',processId:333,id:'own'};
  let reads=0, restores=0;
  f.runtime.current=()=>++reads===2?own:prior;
  f.runtime.restore=()=>{restores++;return {restored:true};};
  startManaged({},f.runtime);
  assert.equal(restores,1);
  const g=fixture(t); let otherReads=0;
  g.runtime.current=()=>++otherReads===2?{processName:'Other application',processId:999,id:'other'}:prior;
  g.runtime.restore=()=>{throw new Error('Must not force foreground');};
  assert.throws(()=>startManaged({},g.runtime),{code:'foreground-interrupted'});
});

test('missing foreground identity fails before browser launch and changed foreground after restoration fails', t => {
  const f=fixture(t,{current:()=>({processId:0,processName:''})});
  assert.throws(()=>startManaged({},f.runtime),{code:'foreground-unavailable'});
  assert.equal(f.calls.some(c=>c.args.includes('open')),false);
  const g=fixture(t); let reads=0;
  g.runtime.current=()=>({processName:'Test editor',id:'21',processId:++reads<=2?12:13});
  assert.throws(()=>startManaged({},g.runtime),{code:'foreground-interrupted'});
});

test('prelaunch failure is known clean, while missing postlaunch ownership remains explicitly unverified', t => {
  const f=fixture(t,{current:()=>({processName:'Microsoft Edge',processId:1,id:''})});
  assert.throws(()=>startManaged({session:'prelaunch'},f.runtime),error=>error.code==='foreground-browser'&&error.details.cleanupVerified);
  assert.equal(f.calls.some(c=>c.args.includes('open')),false);
  assert.equal(closeManaged('prelaunch',f.runtime).alreadyClosed,true);
  const g=fixture(t),cli=g.runtime.cli;
  g.runtime.cli=(args,...rest)=>args.includes('open')?{status:1,stdout:''}:cli(args,...rest);
  assert.throws(()=>startManaged({session:'unproven'},g.runtime),error=>
    error.code==='ownership-unverified'&&error.details.cleanupVerified===false);
  assert.equal(g.calls.some(c=>c.args.includes('close')),false);
  assert.equal(existsSync(join(g.stateRoot,'startup.lock')),false);
});

test('process checks use only the owned PID on macOS and Windows and fail closed on inspection errors', () => {
  for(const os of ['darwin','win32']) {
    let call;
    const identity=ownedProcessIdentity(321,os,(...args)=>{call=args;return {status:0,stdout:'created\n'};});
    assert.deepEqual(identity,{pid:321,identity:'created'});
    assert.equal(call[0],os==='win32'?'powershell.exe':'ps');
    assert.match(call[1].join(' '),os==='win32'?/ProcessId = 321/:/-p 321/);
    assert.throws(()=>ownedProcessIdentity(321,os,()=>({status:2,stdout:''})),{code:'process-inspection-failed'});
  }
});

test('PID reuse during shutdown is surfaced without another action', t => {
  const f=fixture(t),a=startManaged({},f.runtime),cli=f.runtime.cli;
  f.runtime.cli=(args,...rest)=>{if(args.includes('close')){f.reuse();return {status:0,stdout:'{}'};}return cli(args,...rest);};
  assert.throws(()=>closeManaged(a.session,f.runtime),{code:'owned-identity-mismatch'});
  assert.equal(f.calls.filter(c=>c.args.includes('open')).length,1);
});
