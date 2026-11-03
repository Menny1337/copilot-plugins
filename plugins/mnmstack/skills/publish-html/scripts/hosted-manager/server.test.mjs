import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer, contentName, MIME_TYPES } from './server.mjs';
import { fixture, principal, graphFetch, other, html, png, request, origin } from './test-support.mjs';
import { visiblePages, mutationRequest, pageUrl } from './manager-ui.mjs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { runPublisher } from './publish.mjs';
import { digest } from './common.mjs';
import { tenant, manager, group, client, cli, json } from './test-support.mjs';

async function host(t, overrides = {}, fetchImpl = graphFetch(), storeDependencies = {}) {
  const f = await fixture(t, storeDependencies);
  const errors = [];
  const server = await createServer({ ...f.config, ...overrides }, { store: f.store, fetchImpl, logError: text => errors.push(text) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function send(url, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: server.address().port, path: url, method,
        headers: { Host: new URL(origin).host, ...principal(), ...headers },
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject); if (body !== undefined) req.write(body); req.end();
    });
  }
  return { ...f, send, errors };
}
const mutateHeaders = { Origin: origin, 'Content-Type': 'application/json', 'X-Manager-Request': '1' };
test('legacy flat reader routes preserve root, query, HEAD and normal JavaScript MIME', async t => {
  const { config, send } = await host(t);
  await writeFile(path.join(config.contentDir, 'index.html'), html('home'));
  await writeFile(path.join(config.contentDir, 'report.html'), html('report'));
  await writeFile(path.join(config.contentDir, 'report.mjs'), 'window.active=true;');
  await writeFile(path.join(config.contentDir, 'report.json'), '{"value":42}\n');
  assert.equal((await send('/')).text, html('home').toString());
  assert.equal((await send('/report.html?v=1')).text, html('report').toString());
  const head = await send('/report.html', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.text, '');
  assert.equal((await send('/report.mjs')).headers['content-type'], MIME_TYPES.mjs);
  assert.equal((await send('/report.mjs')).text, 'window.active=true;');
  assert.equal((await send('/report.json')).headers['content-type'], MIME_TYPES.json);
  assert.equal((await send('/report.json')).text, '{"value":42}\n');
  assert.equal((await send('/report.html', { method: 'POST' })).status, 405);
  for (const name of ['/../server.mjs', '/%2e%2e/server.mjs', '/content/report.html', '/.env', '/file.two.html', '/_manager/../server.mjs']) {
    assert.notEqual((await send(name)).status, 200);
  }
  assert.equal(contentName('/'), 'index.html');
});
test('manager inventory/UI require configured manager AND reader; never expose state through static route', async t => {
  const { send, config } = await host(t);
  const inventory = await send('/_manager/api/inventory');
  assert.equal(inventory.status, 200);
  const body = JSON.parse(inventory.text);
  assert.equal(body.origin, origin); assert.equal(body.access.tenantId, config.tenantId);
  assert.match(body.access.scope, /not per-person/);
  assert.equal((await send('/_manager')).status, 200);
  assert.match((await send('/_manager/manager-ui.mjs')).headers['content-security-policy'], /script-src 'self'/);
  assert.equal((await send('/_manager', { headers: principal(other) })).status, 403);
  assert.equal((await send('/_manager/api/inventory', { headers: { 'x-ms-client-principal': '' } })).status, 401);
  for (const route of ['/private/transactions', '/writer.lock', '/prepare.json', '/backup.html']) assert.equal((await send(route)).status, 404);
});
test('API guards reject cross-origin, wrong host, wrong fetch-site/type, missing confirmation and oversized bodies', async t => {
  const { send, config } = await host(t);
  const body = JSON.stringify(request('upload', null, html('new')));
  for (const headers of [
    { ...mutateHeaders, Origin: 'https://other.test' },
    { ...mutateHeaders, Host: 'other.test' },
    { ...mutateHeaders, 'Sec-Fetch-Site': 'cross-site' },
    { ...mutateHeaders, 'Content-Type': 'text/plain' },
    { ...mutateHeaders, 'X-Manager-Request': '0' },
    { 'Content-Type': 'application/json', 'X-Manager-Request': '1' },
  ]) assert.equal((await send('/_manager/api/mutate', { method: 'POST', headers, body })).status, 403);
  assert.equal((await send('/_manager/api/mutate', { method: 'POST', headers: mutateHeaders, body: JSON.stringify({ ...request('upload', null, html('x')), confirmation: 'wrong' }) })).status, 400);
  assert.equal((await send('/_manager/api/mutate', { method: 'POST', headers: mutateHeaders, body: '{invalid' })).status, 400);
  assert.equal((await send('/_manager/api/mutate', { method: 'POST', headers: mutateHeaders, body: 'x'.repeat(1800000) })).status, 413);
  assert.equal((await send('/_manager/api/mutate?x=1', { method: 'POST', headers: mutateHeaders, body })).status, 404);
  await assert.rejects(readFile(path.join(config.contentDir, 'report.html')), { code: 'ENOENT' });
});
test('hosted UI/API upload, replace, delete and restore use one guarded service protocol', async t => {
  const { send } = await host(t);
  async function inventory() { const result = await send('/_manager/api/inventory'); assert.equal(result.status, 200); return JSON.parse(result.text); }
  async function mutate(body) {
    const result = await send('/_manager/api/mutate', { method: 'POST', headers: mutateHeaders, body: JSON.stringify(body) });
    assert.equal(result.status, 200, result.text); return JSON.parse(result.text);
  }
  const first = await inventory();
  await mutate(mutationRequest('upload', 'report.html', first, { htmlBase64: html('A').toString('base64') }));
  const uploaded = await inventory();
  await mutate(mutationRequest('replace', 'report.html', uploaded, { htmlBase64: html('B').toString('base64') }));
  const replaced = await inventory();
  await mutate(mutationRequest('delete', 'report.html', replaced));
  const deleted = await inventory();
  await mutate(mutationRequest('restore', 'report.html', deleted, { backup: deleted.backups[0] }));
  assert.equal((await inventory()).pages.length, 1);
});
test('default-disabled host refuses mutation before reading payload', async t => {
  const { send } = await host(t, { mutationsEnabled: false });
  assert.equal(JSON.parse((await send('/_manager/api/inventory')).text).mutationsEnabled, false);
  assert.equal((await send('/_manager/api/mutate', { method: 'POST', headers: mutateHeaders, body: 'invalid' })).status, 403);
});
test('manager routes expose only accurate Allow methods and inventory HEAD is supported', async t => {
  const { send } = await host(t);
  for (const url of ['/_manager', '/_manager/manager-ui.mjs', '/_manager/client-protocol.mjs', '/_manager/api/inventory']) {
    const denied = await send(url, { method: 'PUT' });
    assert.equal(denied.status, 405); assert.equal(denied.headers.allow, 'GET, HEAD');
    const head = await send(url, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.text, '');
  }
  const wrongMethod = await send('/_manager/api/mutate');
  assert.equal(wrongMethod.status, 405); assert.equal(wrongMethod.headers.allow, 'POST');
  const missing = await send('/_manager/missing');
  assert.equal(missing.status, 404); assert.equal(missing.headers.allow, undefined);
});
test('uncertain API error includes structured transaction ID matching retained evidence', async t => {
  const { send, store } = await host(t, {}, graphFetch(), { checkpoint: async at => { if (at === 'renamed') throw new Error('injected-crash'); } });
  const response = await send('/_manager/api/mutate', { method: 'POST', headers: mutateHeaders,
    body: JSON.stringify(request('upload', null, html('uncertain'))) });
  const body = JSON.parse(response.text);
  assert.equal(response.status, 503); assert.equal(body.code, 'outcome-uncertain');
  const pending = await store.records({ allowPending: true });
  assert.equal(body.transactionId, pending[0].id);
  assert.doesNotMatch(response.text, /injected-crash/);
});
test('UI request helpers bind exact selected file/version and safe same-origin open URL', () => {
  const inventory = { mutationsEnabled: true, pages: [{ name: 'a.html', revision: 'r1', sha256: 'hash1', size: 2, modifiedAt: '2026-01-01' },
    { name: 'b.html', revision: 'r2', sha256: 'hash2', size: 3, modifiedAt: '2026-02-01' }], missingVersions: {} };
  assert.equal(mutationRequest('delete', 'a.html', inventory).expectedRevision, 'r1');
  assert.equal(mutationRequest('delete', 'a.html', inventory).expectedSha256, 'hash1');
  assert.equal(visiblePages(inventory.pages, '', 'size')[0].name, 'b.html');
  assert.equal(visiblePages(inventory.pages, 'A.', 'name')[0].name, 'a.html');
  assert.equal(visiblePages(inventory.pages, '', 'modified')[0].name, 'b.html');
  assert.throws(() => mutationRequest('upload', 'a.html', inventory));
  assert.throws(() => mutationRequest('delete', 'a.html', { ...inventory, mutationsEnabled: false }));
  assert.throws(() => pageUrl('https://other.test', 'a.html', origin));
  assert.throws(() => pageUrl(origin, '../a.html', origin));
  assert.equal(pageUrl(origin, 'a.html', origin), origin + '/a.html');
});
test('manager source never executes/embeds remote HTML; metadata is text-only', async () => {
  const source = await readFile(new URL('./manager-ui.mjs', import.meta.url), 'utf8');
  const ui = await readFile(new URL('./manager.html', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  assert.match(source, /textContent/);
  assert.match(source, /credentials: 'same-origin'/);
  assert.match(source, /noopener noreferrer/);
  assert.doesNotMatch(ui, /<iframe|<object|<embed/i);
  assert.doesNotMatch(source + ui, /localStorage|sessionStorage|x-manager-token|location\.hash/);
});
test('full offline own-API CLI -> loopback HTTP -> RSA/OBO/Graph -> transaction store', async t => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'offline-end-to-end' };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = [Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid })).toString('base64url'),
    Buffer.from(JSON.stringify({ ver: '2.0', tid: tenant, oid: manager, aud: client, azp: cli,
      iss: `https://login.microsoftonline.com/${tenant}/v2.0`, scp: 'publish_as_user', nbf: now - 60, exp: now + 300 })).toString('base64url')].join('.');
  const assertion = unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), pair.privateKey).toString('base64url');
  const authCalls = [];
  const fetchAuth = async (url, options) => {
    authCalls.push(String(url));
    if (String(url).endsWith('/keys')) return json({ keys: [key] });
    if (String(url).startsWith('http://127.0.0.1:8081/msi/token?')) return json({ access_token: 'synthetic-mi-assertion' });
    if (String(url).endsWith('/oauth2/v2.0/token')) {
      assert.equal(new URLSearchParams(options.body).get('assertion'), assertion);
      return json({ access_token: 'synthetic-obo-graph', token_type: 'Bearer' });
    }
    assert.equal(options.headers.Authorization, 'Bearer synthetic-obo-graph');
    return graphFetch({ oid: manager, groups: [group] })(url, options);
  };
  const { root, config, send } = await host(t, {}, fetchAuth);
  const file = path.join(root, 'report.html'); await writeFile(file, html('own-api end-to-end'));
  const image = path.join(root, 'report.png'); await writeFile(image, png());
  const result = await runPublisher({ action: 'upload', origin, tenantId: tenant, apiClientId: client, file, confirm: 'report.html',
    thumbnail: image, 'thumbnail-html-sha256': digest(html('own-api end-to-end')) }, {
    tokenProvider: async () => assertion,
    fetchImpl: async (url, options) => {
      const target = new URL(url); assert.equal(target.origin, origin);
      const response = await send(target.pathname, { method: options.method, headers: options.headers, body: options.body });
      return new Response(response.text, { status: response.status, headers: response.headers });
    },
  });
  assert.equal(result.verified, true); assert.equal(authCalls.length, 10);
  assert.equal(result.thumbnail.sha256, digest(png()));
  assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), html('own-api end-to-end'));
});
