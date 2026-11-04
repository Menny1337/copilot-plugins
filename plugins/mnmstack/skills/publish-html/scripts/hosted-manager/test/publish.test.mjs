import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { azureToken, easyAuthSession, parseArgs, runPublisher } from '../publish.mjs';
import { fixture, tenant, client, manager, origin, html, json, nativeLogin } from './test-support.mjs';
import { digest } from '../common.mjs';

test('CLI captures own-API scope token in memory, never token argv/files', async () => {
  let invocation;
  const value = await azureToken({ tenantId: tenant, apiClientId: client }, (command, args, options, done) => {
    invocation = { command, args, options }; done(null, 'synthetic.jwt.token\n');
  });
  assert.equal(value, 'synthetic.jwt.token');
  assert.equal(invocation.command, 'az');
  assert.equal(invocation.args[invocation.args.indexOf('--scope') + 1], `api://${client}/publish_as_user`);
  assert.ok(!invocation.args.includes(value));
  await assert.rejects(azureToken({ tenantId: tenant, apiClientId: client }, (command, args, options, done) => done(new Error('synthetic-secret-provider-error'))),
    error => !error.message.includes('synthetic-secret'));
});
test('CLI validates explicit target and exact action-specific arguments', () => {
  const args = ['inventory', '--origin', origin, '--tenant', tenant, '--api-client', client];
  assert.equal(parseArgs(args).origin, origin);
  for (const bad of [args.concat(['--token', 'secret']), args.concat(['--origin', origin]), ['inventory'],
    ['inventory', '--origin', 'http://example.test', '--tenant', tenant, '--api-client', client],
    args.concat(['--file', 'report.html'])]) assert.throws(() => parseArgs(bad));
  const upload = ['upload', ...args.slice(1), '--file', '/private/report.html', '--confirm', 'report.html'];
  assert.equal(parseArgs([...upload, '--thumbnail', '/private/report.png', '--thumbnail-html-sha256', 'a'.repeat(64)]).thumbnail, '/private/report.png');
  assert.throws(() => parseArgs([...upload, '--thumbnail', '/private/report.png']));
  assert.throws(() => parseArgs([...args, '--thumbnail', '/private/report.png', '--thumbnail-html-sha256', 'a'.repeat(64)]));
});
test('CLI automated create, reviewed replace/delete/restore share store protocol and verify effects', async t => {
  const { store, root } = await fixture(t);
  const file = path.join(root, 'report.html'); await writeFile(file, html('cli'));
  const calls = [];
  const deps = {
    tokenProvider: async () => 'synthetic.jwt.token',
    fetchImpl: nativeLogin(async (url, options) => {
      assert.equal(options.headers['X-Manager-Assertion'], 'synthetic.jwt.token');
      assert.equal(options.headers['X-ZUMO-AUTH'], 'synthetic-session-token');
      assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
      assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
      calls.push({ url, options });
      if (url === origin + '/_manager/api/inventory') return json({ ...await store.list(), mutationsEnabled: true });
      assert.equal(url, origin + '/_manager/api/mutate');
      assert.equal(options.headers['X-Manager-Request'], '1');
      return json(await store.mutate(JSON.parse(options.body), manager));
    }),
  };
  const base = { origin, tenantId: tenant, apiClientId: client };
  const uploaded = await runPublisher({ ...base, action: 'upload', file, confirm: 'report.html' }, deps);
  assert.equal(uploaded.url, origin + '/report.html');
  assert.equal(calls.length, 2);
  await assert.rejects(runPublisher({ ...base, action: 'upload', file, confirm: 'report.html' }, deps), /Destination exists/);
  const page = (await store.list()).pages[0];
  await writeFile(file, html('changed'));
  const replaced = await runPublisher({ ...base, action: 'replace', file, confirm: 'report.html', revision: page.revision, sha256: page.sha256 }, deps);
  const deleted = await runPublisher({ ...base, action: 'delete', name: 'report.html', confirm: 'report.html', revision: replaced.revision, sha256: replaced.sha256 }, deps);
  assert.equal(deleted.url, undefined); assert.equal(replaced.url, origin + '/report.html');
  const backup = (await store.list()).backups[0];
  const restored = await runPublisher({ ...base, action: 'restore', name: 'report.html', confirm: 'report.html', revision: deleted.revision,
    sha256: 'missing', 'backup-id': backup.id, 'backup-sha256': backup.sha256 }, deps);
  assert.equal(restored.sha256, backup.sha256);
  assert.equal(restored.url, origin + '/report.html');
  assert.deepEqual(await readFile(file), html('changed'));
});
test('CLI reports structured transaction ID or definite prewrite denial without raw provider text', async () => {
  const options = { action: 'delete', origin, name: 'report.html', confirm: 'report.html', revision: 'reviewed', sha256: digest(html('x')) };
  const id = '99999999-9999-4999-8999-999999999999';
  for (const [status, data, outcome, expectedCode] of [
    [503, { code: 'outcome-uncertain', transactionId: id, error: 'synthetic.jwt.token' }, 'uncertain', 'outcome-uncertain'],
    [409, { code: 'version-conflict', error: 'synthetic.jwt.token' }, 'denied', 'version-conflict'],
    [507, { code: 'state-quota', error: 'synthetic.jwt.token' }, 'denied', 'state-quota'],
  ]) {
    let calls = 0;
    await assert.rejects(runPublisher(options, {
      tokenProvider: async () => 'synthetic.jwt.token',
      fetchImpl: nativeLogin(async () => { calls++; return json(data, status); }),
    }), error => error.outcome === outcome && error.code === expectedCode &&
      error.transactionId === (outcome === 'uncertain' ? id : null) && !error.message.includes('synthetic.jwt.token'));
    assert.equal(calls, 1);
  }
});
test('CLI never retries, logs provider bodies or falls back to Kudu after uncertain results', async () => {
  let calls = 0;
  const options = { action: 'delete', origin, name: 'report.html', confirm: 'report.html', revision: 'reviewed', sha256: digest(html('x')) };
  await assert.rejects(runPublisher(options, {
    tokenProvider: async () => 'synthetic.jwt.token',
    fetchImpl: nativeLogin(async () => { calls++; throw new Error('synthetic.jwt.token'); }),
  }), error => /uncertain/.test(error.message) && !error.message.includes('synthetic.jwt.token'));
  assert.equal(calls, 1);
  await assert.rejects(runPublisher(options, {
    tokenProvider: async () => 'synthetic.jwt.token',
    fetchImpl: nativeLogin(async () => json({ error: 'synthetic.jwt.token' }, 403)),
  }), error => !error.message.includes('synthetic.jwt.token'));
});
test('native sign-in uses only the explicit origin and own-API token; session and assertion are separate credentials', async () => {
  const calls = [];
  const result = await runPublisher({ action: 'inventory', origin }, {
    tokenProvider: async () => 'synthetic.jwt.token',
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
      if (calls.length === 1) {
        assert.equal(url, `${origin}/.auth/login/aad`); assert.equal(options.method, 'POST');
        assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
        assert.deepEqual(JSON.parse(options.body), { access_token: 'synthetic.jwt.token' });
        return json({ authenticationToken: 'synthetic-native-session', user: { userId: 'sid:synthetic' } });
      }
      assert.equal(url, `${origin}/_manager/api/inventory`); assert.equal(options.method, 'GET');
      assert.deepEqual(options.headers, { 'X-ZUMO-AUTH': 'synthetic-native-session', 'X-Manager-Assertion': 'synthetic.jwt.token' });
      return json({ pages: [] });
    },
  });
  assert.deepEqual(result, { pages: [] }); assert.equal(calls.length, 2);
});
test('native sign-in failures never send manager requests, retry, expose provider text or fall back to cookies/bearer', async () => {
  for (const response of [
    () => json({ error: 'synthetic-private-provider-text' }, 403),
    () => json({ authenticationToken: 'header\r\ninjection', user: { userId: 'sid:x' } }),
    () => json({ authenticationToken: 'synthetic-session', user: {} }),
    () => json({ authenticationToken: 'x'.repeat(32769), user: { userId: 'sid:x' } }),
    () => new Response('synthetic-private-provider-text'),
    () => new Response('x'.repeat(65537)),
    () => json({ authenticationToken: 'synthetic-session', user: { userId: 'sid:x' } }, 201),
  ]) {
    let calls = 0;
    await assert.rejects(runPublisher({ action: 'inventory', origin }, {
      tokenProvider: async () => 'synthetic.jwt.token',
      fetchImpl: async url => { calls++; assert.equal(url, `${origin}/.auth/login/aad`); return response(); },
    }), error => error.code === 'native-sign-in' && error.outcome === 'not-sent' &&
      !/synthetic-private|synthetic\.jwt/.test(error.message));
    assert.equal(calls, 1);
  }
  await assert.rejects(easyAuthSession(origin, 'synthetic.jwt.token', async () => { throw new Error('synthetic-private-provider-text'); }),
    error => error.code === 'native-sign-in' && !error.message.includes('synthetic-private'));
});
