import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const initialize = require('./browser-managed-owner.cjs').default;

test('concurrent pages capture ownership once without changing upstream focus initialization', async t => {
  const root = mkdtempSync(join(tmpdir(), 'browser-owner-test-'));
  const previous = {...process.env};
  t.after(() => {
    for (const key of ['COPILOT_BROWSER_OWNER_FILE', 'COPILOT_BROWSER_OWNER_ID']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(root, {recursive:true,force:true});
  });
  process.env.COPILOT_BROWSER_OWNER_FILE = join(root, 'owner.json');
  process.env.COPILOT_BROWSER_OWNER_ID = 'test-owner';
  const commands = [];
  let connections = 0, detached = 0;
  const context = {browser:() => ({newBrowserCDPSession:async () => {
    connections++;
    return {
      send:async method => {
        commands.push(method);
        await Promise.resolve();
        return {processInfo:[{type:'browser',id:123}]};
      },
      detach:async () => {detached++;},
    };
  }})};
  await Promise.all([initialize({page:{context:() => context}}),initialize({page:{context:() => context}})]);
  assert.equal(connections, 1);
  assert.equal(detached, 1);
  assert.deepEqual(commands, ['SystemInfo.getProcessInfo']);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'owner.json'))), {
    ownerId:'test-owner',browserPid:123,daemonPid:process.pid,
  });
});

test('ownership initialization failure propagates rather than returning success', async () => {
  const context = {browser:() => ({newBrowserCDPSession:async () => {throw new Error('CDP denied');}})};
  await assert.rejects(initialize({page:{context:() => context}}), /CDP denied/);
});
