import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { writeFile, readFile, rename, readdir, symlink, unlink, open } from 'node:fs/promises';
import { PageStore } from './store.mjs';
import { createServer } from './server.mjs';
import { runPublisher } from './publish.mjs';
import { readResponse } from './client-protocol.mjs';
import { pngInfo, MAX_PNG } from './png.mjs';
import { digest } from './common.mjs';
import { fixture, manager, other, origin, html, png, thumbnail, request, principal, graphFetch } from './test-support.mjs';

const page = async store => (await store.list()).pages[0];
const withImage = (action, current, bytes, image) => ({ ...request(action, current, bytes), thumbnail: thumbnail(bytes, image) });
async function imageBytes(store, image) {
  const [id, side, hash] = image.url.slice('/_manager/api/thumbnail/'.length).replace(/\.png$/, '').split('/');
  return store.thumbnail(id, side, hash);
}
async function host(t) {
  const f = await fixture(t);
  const server = await createServer(f.config, { store: f.store, fetchImpl: graphFetch(), logError: () => {} });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const send = (target, method = 'GET', body = null, identity = principal()) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: target, method,
      headers: { Host: new URL(origin).host, ...identity, ...(body ? { Origin: origin, 'Content-Type': 'application/json', 'X-Manager-Request': '1' } : {}) } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(new Response(method === 'HEAD' ? null : Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
  return { ...f, send };
}
test('CLI -> authenticated HTTP -> private images: upload/replace, backup selection, delete and restore retain exact image', async t => {
  const { root, config, store, send } = await host(t);
  const file = path.join(root, 'report.html'), image = path.join(root, 'report.png');
  const a = html('A'), b = html('B'), pngA = png(30), pngB = png(200);
  await writeFile(file, a); await writeFile(image, pngA);
  const deps = { tokenProvider: async () => 'synthetic-token',
    fetchImpl: async (url, options) => send(new URL(url).pathname, options.method, options.body) };
  const options = { origin, file, confirm: 'report.html', thumbnail: image, 'thumbnail-html-sha256': digest(a) };
  const uploaded = await runPublisher({ ...options, action: 'upload' }, deps);
  assert.equal(uploaded.thumbnail.sha256, digest(pngA));
  const first = await page(store);
  const response = await send(first.thumbnail.url);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pngA);
  assert.equal((await send(first.thumbnail.url, 'GET', null, principal(other))).status, 403);
  assert.equal((await send(first.thumbnail.url, 'GET', null, { 'x-ms-client-principal': '' })).status, 401);
  assert.equal((await send(first.thumbnail.url, 'POST', '{}')).status, 405);
  const head = await send(first.thumbnail.url, 'HEAD'); assert.equal(head.status, 405); assert.equal(head.headers.get('allow'), 'GET');
  assert.equal((await send(first.thumbnail.url.replace(digest(pngA), 'e'.repeat(64)))).status, 404);
  for (const target of ['/after.png', '/before.png', `/transactions/${uploaded.transactionId}/after.png`,
    first.thumbnail.url + '?x=1', '/_manager/api/thumbnail/../after.png']) assert.equal((await send(target)).status, 404);
  await writeFile(file, b); await writeFile(image, pngB);
  await runPublisher({ ...options, action: 'replace', revision: first.revision, sha256: first.sha256, 'thumbnail-html-sha256': digest(b) }, deps);
  let inventory = await store.list();
  assert.equal(inventory.pages[0].thumbnail.sha256, digest(pngB));
  const selected = inventory.backups.find(item => item.sha256 === digest(a));
  assert.deepEqual(await imageBytes(store, selected.thumbnail), pngA);
  await store.mutate(request('delete', inventory.pages[0]), manager);
  inventory = await store.list();
  const restored = await store.mutate(request('restore', { name: 'report.html', revision: inventory.missingVersions['report.html'], sha256: null }, null,
    { backupId: selected.id, backupSha256: selected.sha256 }), manager);
  assert.equal(restored.thumbnail.sha256, digest(pngA));
  assert.deepEqual(await imageBytes(store, (await page(store)).thumbnail), pngA);
  assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), a);
  assert.equal((await page(store)).uploadedAt, null);
  assert.deepEqual(await readdir(config.contentDir), ['report.html']);
  const legacy = path.join(root, 'legacy.html'); await writeFile(legacy, html('no image'));
  await runPublisher({ origin, action: 'upload', file: legacy, confirm: 'legacy.html' }, deps);
  assert.equal((await store.list()).pages.find(item => item.name === 'legacy.html').thumbnail, null);
});
test('invalid/wrong-hash/oversize PNGs fail before token, transaction or live writes; PNG request never silently downgrades', async t => {
  const { root, store } = await fixture(t);
  const file = path.join(root, 'report.html'), image = path.join(root, 'report.png'), bytes = html('actual');
  await writeFile(file, bytes);
  for (const [imageBytes, hash] of [[png(), 'a'.repeat(64)], [Buffer.from('bad PNG'), digest(bytes)], [Buffer.alloc(MAX_PNG + 1), digest(bytes)]]) {
    await writeFile(image, imageBytes);
    await assert.rejects(runPublisher({ origin, action: 'upload', file, confirm: 'report.html', thumbnail: image, 'thumbnail-html-sha256': hash },
      { tokenProvider: () => assert.fail('invalid PNG must fail before token') }));
    await assert.rejects(store.mutate({ ...withImage('upload', null, bytes, imageBytes),
      thumbnail: { htmlSha256: hash, pngBase64: imageBytes.toString('base64') } }, manager));
  }
  assert.deepEqual(await readdir(store.transactions), []);
  await assert.rejects(store.mutate({ ...request('upload', null, bytes), thumbnail: { ...thumbnail(bytes), htmlSha256: 'a'.repeat(64) } }, manager), { code: 'thumbnail-binding' });
  await writeFile(image, png());
  const id = '99999999-9999-4999-8999-999999999999';
  await assert.rejects(runPublisher({ origin, action: 'replace', file, confirm: 'report.html', thumbnail: image,
    'thumbnail-html-sha256': digest(bytes), revision: 'reviewed', sha256: digest(bytes) }, {
    tokenProvider: async () => 'synthetic-token', fetchImpl: async () => new Response(JSON.stringify({
      verified: true, name: 'report.html', action: 'replace', sha256: digest(bytes), transactionId: id, revision: id, thumbnail: null,
    })),
  }), error => error.outcome === 'uncertain' && error.transactionId === id);
});
test('same HTML association is immutable, including legacy no-image replace and actual concurrent manager processes', async t => {
  const { store, config } = await fixture(t);
  const bytes = html('unchanged'), image = png(30);
  await store.mutate(withImage('upload', null, bytes, image), manager);
  const initial = await page(store);
  await store.mutate(request('replace', initial, bytes), manager);
  assert.equal((await page(store)).thumbnail.sha256, digest(image));
  const current = await page(store);
  await assert.rejects(store.mutate(withImage('replace', current, bytes, png(200)), manager), { code: 'thumbnail-conflict' });
  assert.equal((await page(store)).revision, current.revision);
  const children = [];
  t.after(() => { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const start = () => {
    const child = fork(new URL('./store-worker.mjs', import.meta.url), { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); children.push(child);
    return child;
  };
  const first = start(), firstMessage = once(first, 'message'), firstExit = once(first, 'exit');
  first.send({ config, request: withImage('replace', current, html('new'), png(80)), actor: manager, pause: true });
  assert.deepEqual((await firstMessage)[0], { stage: 'prepared' });
  const second = start(), secondMessage = once(second, 'message'), secondExit = once(second, 'exit');
  second.send({ config, request: withImage('replace', current, html('new'), png(90)), actor: manager, pause: false });
  assert.equal((await secondMessage)[0].code, 'writer-locked'); await secondExit;
  first.send('continue'); await firstExit;
  const latest = await page(store);
  assert.equal(latest.thumbnail.sha256, digest(png(80)));
  await assert.rejects(store.mutate(withImage('replace', latest, html('new'), png(90)), manager), { code: 'thumbnail-conflict' });
});
test('parallel thumbnail reads and a mutation acquire the common lock without read collisions or stale-lock stealing', async t => {
  const { store, config } = await fixture(t);
  await store.mutate(withImage('upload', null, html('A'), png(30)), manager);
  const current = await page(store);
  const readers = Array.from({ length: 12 }, () => imageBytes(new PageStore(config), current.thumbnail));
  const change = new PageStore(config).mutate(withImage('replace', current, html('B'), png(100)), manager);
  for (const result of await Promise.all(readers)) assert.deepEqual(result, png(30));
  await change;
  assert.equal((await page(store)).sha256, digest(html('B')));
});
for (const stage of ['prepared', 'renamed']) {
  test(`PNG evidence survives ${stage} crash and offline recovery without wrong-version association`, async t => {
    let crash = false;
    const { store, config } = await fixture(t, { checkpoint: async at => { if (crash && at === stage) throw new Error('injected-image-crash'); } });
    await store.mutate(withImage('upload', null, html('A'), png(30)), manager);
    crash = true;
    await assert.rejects(store.mutate(withImage('replace', await page(store), html('B'), png(200)), manager), { code: 'outcome-uncertain' });
    await rename(store.lock, path.join(store.state, 'abandoned-test-lock'));
    const recovered = await new PageStore(config).recover();
    assert.equal(recovered[0].status, stage === 'prepared' ? 'aborted' : 'committed');
    const current = await page(store);
    assert.equal(current.sha256, digest(html(stage === 'prepared' ? 'A' : 'B')));
    assert.deepEqual(await imageBytes(store, current.thumbnail), png(stage === 'prepared' ? 30 : 200));
  });
}
test('corrupt or linked PNG evidence blocks list/recovery and cannot disclose another file', async t => {
  let crash = false;
  const { store, root } = await fixture(t, { checkpoint: async at => { if (crash && at === 'renamed') throw new Error('crash'); } });
  const upload = await store.mutate(withImage('upload', null, html('A'), png()), manager);
  const filename = path.join(store.transactions, upload.transactionId, 'after.png');
  await writeFile(filename, png(200));
  await assert.rejects(store.list(), { code: 'thumbnail-corrupt' });
  await unlink(filename); const outside = path.join(root, 'outside.png'); await writeFile(outside, png());
  await symlink(outside, filename);
  await assert.rejects(store.list(), { code: 'unsafe-file' });
  await unlink(filename); await writeFile(filename, png());
  crash = true;
  await assert.rejects(store.mutate(withImage('replace', await page(store), html('B'), png(100)), manager), { code: 'outcome-uncertain' });
  const pending = (await store.records({ allowPending: true })).find(record => !record.outcome);
  await writeFile(path.join(pending.directory, 'after.png'), png(250));
  await rename(store.lock, path.join(store.state, 'abandoned-test-lock'));
  await assert.rejects(store.recover(), { code: 'thumbnail-corrupt' });
});
test('PNG retention/accounting: current image stays, expired copies retire with transaction, PNG bytes consume quota', async t => {
  let now = Date.parse('2025-01-01');
  const { store } = await fixture(t, { now: () => now });
  const first = await store.mutate(withImage('upload', null, html('A'), png(30)), manager);
  await store.mutate(withImage('replace', await page(store), html('B'), png(200)), manager);
  const backup = (await store.list()).backups[0];
  now += 91 * 86400000;
  assert.equal((await store.list()).backups.length, 0);
  await assert.rejects(imageBytes(store, backup.thumbnail), { code: 'thumbnail-missing' });
  await assert.rejects(readFile(path.join(store.transactions, first.transactionId, 'after.png')), { code: 'ENOENT' });
  assert.deepEqual(await imageBytes(store, (await page(store)).thumbnail), png(200));
  now += 366 * 86400000; await store.list();
  assert.ok(!(await readdir(store.transactions)).includes(first.transactionId));
  assert.deepEqual(await readdir(store.retired), []);
  const current = await page(store);
  const sparse = await open(path.join(store.transactions, current.revision, 'before.png'), 'wx');
  try { await sparse.truncate(512 * 1024 * 1024); } finally { await sparse.close(); }
  await assert.rejects(store.quota(), { code: 'state-quota' });
});
test('adding a PNG to identical legacy HTML recovers a prepared association only with verified image evidence', async t => {
  let crash = false;
  const { store, config } = await fixture(t, { checkpoint: async at => { if (crash && at === 'prepared') throw new Error('same-html-crash'); } });
  await store.mutate(request('upload', null, html('same')), manager);
  const old = await page(store); assert.equal(old.thumbnail, null);
  crash = true;
  await assert.rejects(store.mutate(withImage('replace', old, html('same'), png(80)), manager), { code: 'outcome-uncertain' });
  await rename(store.lock, path.join(store.state, 'abandoned-test-lock'));
  assert.equal((await new PageStore(config).recover())[0].status, 'committed');
  assert.equal((await page(store)).sha256, old.sha256);
  assert.deepEqual(await imageBytes(store, (await page(store)).thumbnail), png(80));
});
test('retired cleanup resumes after removing an image without orphaning evidence or tearing an active journal', async t => {
  let now = Date.parse('2025-01-01'), crash = false;
  const { store, config } = await fixture(t, { now: () => now, checkpoint: async (at, record) => {
    if (crash && at === 'retired-file-removed' && record.name === 'after.png') throw new Error('interrupted-image-cleanup');
  } });
  const first = await store.mutate(withImage('upload', null, html('A'), png(30)), manager);
  await store.mutate(withImage('replace', await page(store), html('B'), png(200)), manager);
  now += 366 * 86400000; crash = true;
  await assert.rejects(store.list(), /interrupted-image-cleanup/);
  assert.ok((await readdir(store.retired)).includes(first.transactionId));
  const restarted = await new PageStore(config, { now: () => now }).initialize();
  assert.equal((await restarted.list()).pages[0].thumbnail.sha256, digest(png(200)));
  assert.deepEqual(await readdir(store.retired), []);
});
test('maximum legal backup inventory with PNG metadata fits shared 16 MiB response limit', async () => {
  const metadata = { ...pngInfo(png()), htmlSha256: 'a'.repeat(64),
    url: `/_manager/api/thumbnail/99999999-9999-4999-8999-999999999999/before/${'b'.repeat(64)}.png` };
  const backup = { id: '99999999-9999-4999-8999-999999999999', name: 'x'.repeat(250) + '.html', sha256: 'a'.repeat(64),
    size: 1048576, savedAt: '2026-01-01T00:00:00.000Z', action: 'replace', thumbnail: metadata };
  const backups = Array.from({ length: 9999 }, (_, index) => ({ ...backup, name: String(index).padStart(250, 'x') + '.html' }));
  const value = { pages: Array.from({ length: 500 }, () => ({ ...backup, thumbnail: { ...metadata }, revision: backup.id, url: 'https://example.test/' + backup.name,
    uploadedAt: backup.savedAt, recordedAt: backup.savedAt, modifiedAt: backup.savedAt, provenance: 'replace', actor: backup.id })),
    backups, missingVersions: Object.fromEntries(backups.map(item => [item.name, item.id])) };
  assert.equal((await readResponse(new Response(JSON.stringify(value)))).backups.length, 9999);
});
