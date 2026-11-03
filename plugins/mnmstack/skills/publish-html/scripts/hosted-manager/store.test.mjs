import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile, readFile, mkdir, rename, readdir, symlink, link, chmod, lstat, open } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { PageStore } from './store.mjs';
import { digest, MAX_HTML, syncDirectory } from './common.mjs';
import { fixture, manager, html, request } from './test-support.mjs';

async function page(store) { return (await store.list()).pages[0]; }
async function unlockAfterStopped(store) {
  await rename(store.lock, path.join(store.state, `abandoned-${Date.now()}-${Math.random().toString(16).slice(2)}`));
}
test('upload, conditional replace, delete and restore share durable versions, backups and audit', async t => {
  const { store, config } = await fixture(t);
  const first = html('first'), second = html('second');
  const uploaded = await store.mutate(request('upload', null, first), manager);
  assert.equal(uploaded.verified, true);
  assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), first);
  const initial = await page(store);
  assert.equal(initial.sha256, digest(first)); assert.equal(initial.revision, uploaded.transactionId);
  assert.ok(initial.uploadedAt); assert.equal(initial.actor, manager);
  await store.mutate(request('replace', initial, second), manager);
  await assert.rejects(store.mutate(request('delete', initial), manager), { code: 'version-conflict' });
  const replaced = await page(store);
  await store.mutate(request('delete', replaced), manager);
  const inventory = await store.list();
  assert.equal(inventory.pages.length, 0); assert.equal(inventory.backups.length, 2);
  const backup = inventory.backups.find(b => b.sha256 === digest(first));
  const restored = await store.mutate(request('restore', { name: 'report.html', revision: inventory.missingVersions['report.html'], sha256: null }, null,
    { backupId: backup.id, backupSha256: backup.sha256 }), manager);
  assert.equal(restored.sha256, digest(first));
  assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), first);
  assert.equal((await page(store)).uploadedAt, null);
  const records = await store.records();
  assert.equal(records.length, 4); assert.ok(records.every(record => record.outcome.status === 'committed'));
  assert.ok(records.every(record => record.actor === manager));
  assert.ok((await lstat(config.stateDir)).isDirectory());
});
test('historical mtime is not an upload date; external changes lose tracked provenance', async t => {
  const { store, config } = await fixture(t);
  await writeFile(path.join(config.contentDir, 'historical.html'), html('historical'));
  const historic = (await store.list()).pages[0];
  assert.equal(historic.uploadedAt, null); assert.equal(historic.provenance, 'untracked');
  await store.mutate(request('replace', historic, html('managed')), manager);
  await writeFile(path.join(config.contentDir, historic.name), html('external'));
  const drift = (await store.list()).pages[0];
  assert.equal(drift.uploadedAt, null); assert.equal(drift.actor, null); assert.match(drift.revision, /^untracked:/);
});
test('held-out: deleted A cannot overwrite new B using reviewed missing version', async t => {
  const { store, config } = await fixture(t);
  await store.mutate(request('upload', null, html('A')), manager);
  await store.mutate(request('delete', await page(store)), manager);
  const removed = await store.list(), backup = removed.backups[0];
  const missing = { name: 'report.html', revision: removed.missingVersions['report.html'], sha256: null };
  await store.mutate(request('upload', missing, html('B')), manager);
  await assert.rejects(store.mutate(request('restore', missing, null, { backupId: backup.id, backupSha256: backup.sha256 }), manager), { code: 'version-conflict' });
  assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), html('B'));
});
test('mutation default gate, confirmation, schemas, traversal, UTF-8 and size fail before changes', async t => {
  const { store, config } = await fixture(t);
  const disabled = new PageStore({ ...config, mutationsEnabled: false });
  await assert.rejects(disabled.mutate(request('upload', null, html('x')), manager), { code: 'mutations-disabled' });
  for (const body of [
    { ...request('upload', null, html('x')), confirmation: 'different.html' },
    { ...request('upload', null, html('x')), extra: true },
    { ...request('upload', null, html('x')), name: '../report.html', confirmation: '../report.html' },
    request('upload', null, Buffer.from([255, 254, 255])),
    request('upload', null, Buffer.from('not HTML')),
    request('upload', null, Buffer.from('<html>\0')),
    request('upload', null, Buffer.alloc(MAX_HTML + 1)),
    { ...request('delete'), htmlBase64: html('x').toString('base64') },
  ]) await assert.rejects(store.mutate(body, manager));
  assert.deepEqual(await readdir(config.contentDir), []);
  assert.deepEqual(await readdir(store.transactions), []);
});
test('exactly 1 MiB accepted; case-collisions, symlinks, hardlinks and oversized existing files refused', async t => {
  const { store, root, config } = await fixture(t);
  const bytes = Buffer.alloc(MAX_HTML, 32); bytes.write('<html>');
  await store.mutate(request('upload', null, bytes), manager);
  await assert.rejects(store.mutate({ ...request('upload', null, html('x')), name: 'REPORT.html', confirmation: 'REPORT.html' }, manager), { code: 'name-collision' });
  await writeFile(path.join(root, 'outside.html'), html('outside'));
  await symlink(path.join(root, 'outside.html'), path.join(config.contentDir, 'linked.html'));
  await assert.rejects(store.list(), { code: 'unsafe-file' });
  await assert.rejects(store.mutate(request('delete', { name: 'linked.html', revision: 'missing', sha256: null }), manager));
  assert.deepEqual(await readFile(path.join(root, 'outside.html')), html('outside'));
});
test('hard-linked content, oversized file and linked parent are never followed', async t => {
  const { store, root, config } = await fixture(t);
  const outside = path.join(root, 'outside.html');
  await writeFile(outside, html('outside')); await link(outside, path.join(config.contentDir, 'hard.html'));
  await assert.rejects(store.list(), { code: 'unsafe-file' });
  await rename(path.join(config.contentDir, 'hard.html'), path.join(root, 'hard-held.html'));
  await writeFile(path.join(config.contentDir, 'huge.html'), Buffer.alloc(MAX_HTML + 1));
  await assert.rejects(store.list(), { code: 'unsafe-file' });
  const alias = path.join(root, 'alias'); await symlink(config.contentDir, alias);
  await assert.rejects(new PageStore({ ...config, contentDir: alias }).initialize(), { code: 'storage-link' });
  await chmod(config.stateDir, 0o755);
  assert.ok(await new PageStore(config).initialize(), 'CIFS modes are not treated as an authorization boundary');
});
for (const stage of ['prepared', 'applied', 'committed']) {
  test(`crash at ${stage} retains lock/evidence; explicit offline recovery is conservative`, async t => {
    let crash = false;
    const { store, config } = await fixture(t, { checkpoint: async at => { if (crash && at === stage) throw new Error('simulated crash'); } });
    await store.mutate(request('upload', null, html('before')), manager);
    const before = await page(store); crash = true;
    await assert.rejects(store.mutate(request('replace', before, html('after')), manager), { code: 'outcome-uncertain' });
    await assert.rejects(new PageStore(config).list(), { code: 'writer-locked' });
    await assert.rejects(new PageStore(config).recover(), { code: 'writer-locked' });
    await unlockAfterStopped(store);
    const recovery = await new PageStore(config).recover();
    assert.equal(recovery.length, stage === 'committed' ? 0 : 1);
    assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), html(stage === 'prepared' ? 'before' : 'after'));
    assert.equal((await store.list()).pages.length, 1);
  });
}
test('restore/delete crash recovery verifies backups and never overwrites unrelated external bytes', async t => {
  let crash = false;
  const { store, config } = await fixture(t, { checkpoint: async at => { if (crash && at === 'applied') throw new Error('crash'); } });
  await store.mutate(request('upload', null, html('before')), manager);
  crash = true;
  await assert.rejects(store.mutate(request('delete', await page(store)), manager), { code: 'outcome-uncertain' });
  await writeFile(path.join(config.contentDir, 'report.html'), html('external-writer'));
  await unlockAfterStopped(store);
  await assert.rejects(store.recover(), { code: 'recovery-conflict' });
  assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), html('external-writer'));
  assert.ok((await readdir(store.transactions)).length > 0);
});
test('corrupted backup blocks restore and torn prepare/outcome journals block all writers', async t => {
  const { store } = await fixture(t);
  await store.mutate(request('upload', null, html('before')), manager);
  await store.mutate(request('delete', await page(store)), manager);
  const inventory = await store.list(), backup = inventory.backups[0];
  const filename = path.join(store.transactions, backup.id, 'backup.html');
  await writeFile(filename, html('corrupted'));
  await assert.rejects(store.mutate(request('restore', { name: backup.name, revision: inventory.missingVersions[backup.name], sha256: null }, null,
    { backupId: backup.id, backupSha256: backup.sha256 }), manager), { code: 'backup-conflict' });
  await writeFile(path.join(store.transactions, backup.id, 'prepare.json'), '{"torn":');
  await assert.rejects(store.list(), { code: 'journal-torn' });
  await assert.rejects(store.recover(), { code: 'journal-torn' });
  assert.equal(await readFile(path.join(store.transactions, backup.id, 'prepare.json'), 'utf8'), '{"torn":');
});
test('unprepared orphan and torn outcome are preserved rather than silently discarded', async t => {
  const { store } = await fixture(t);
  const result = await store.mutate(request('upload', null, html('before')), manager);
  await writeFile(path.join(store.transactions, result.transactionId, 'outcome.json'), '{');
  await assert.rejects(store.list(), { code: 'journal-torn' });
  await writeFile(path.join(store.transactions, result.transactionId, 'outcome.json'), '{"status":"committed","at":"2026-01-01T00:00:00Z"}');
  await mkdir(path.join(store.transactions, '88888888-8888-4888-8888-888888888888'));
  await assert.rejects(store.list(), { code: 'journal-torn' });
});
test('external writer detected after prepare preserves its bytes and verified original backup', async t => {
  let interfere = false;
  const { store, config } = await fixture(t, { checkpoint: async stage => {
    if (interfere && stage === 'prepared') await writeFile(path.join(config.contentDir, 'report.html'), html('external'));
  } });
  await store.mutate(request('upload', null, html('before')), manager);
  interfere = true;
  await assert.rejects(store.mutate(request('replace', await page(store), html('after')), manager), { code: 'outcome-uncertain' });
  assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), html('external'));
  const pending = (await store.records({ allowPending: true })).find(record => !record.outcome);
  assert.deepEqual(await readFile(path.join(pending.directory, 'backup.html')), html('before'));
});
test('two actual manager processes cannot mutate concurrently; killed owner lock is not auto-stolen', async t => {
  const { config, store } = await fixture(t);
  const worker = fileURLToPath(new URL('./store-worker.mjs', import.meta.url));
  const children = [];
  t.after(() => { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  function start(pause) {
    const child = fork(worker, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); children.push(child);
    child.send({ config, request: request('upload', null, html(pause ? 'first' : 'second')), actor: manager, pause });
    return child;
  }
  const first = start(true), firstExit = once(first, 'exit');
  assert.deepEqual((await once(first, 'message'))[0], { stage: 'prepared' });
  const second = start(false), secondExit = once(second, 'exit');
  assert.equal((await once(second, 'message'))[0].code, 'writer-locked'); await secondExit;
  first.kill('SIGKILL'); await firstExit;
  await assert.rejects(store.mutate(request('upload', null, html('third')), manager), { code: 'writer-locked' });
  await unlockAfterStopped(store);
  assert.equal((await store.recover())[0].status, 'aborted');
  await store.mutate(request('upload', null, html('after-recovery')), manager);
  assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), html('after-recovery'));
});
test('retention expires only resolved backups/audit and preserves live content/current provenance', async t => {
  let now = Date.parse('2025-01-01T00:00:00Z');
  const { store, config } = await fixture(t, { now: () => now });
  await store.mutate(request('upload', null, html('A')), manager);
  await store.mutate(request('replace', await page(store), html('B')), manager);
  const records = await store.records(), oldest = records[0].id, backup = records[1].id;
  now += 91 * 86400000;
  await store.mutate(request('replace', await page(store), html('C')), manager);
  await assert.rejects(readFile(path.join(store.transactions, backup, 'backup.html')), { code: 'ENOENT' });
  assert.ok((await store.records()).some(record => record.id === oldest));
  now += 366 * 86400000;
  await store.mutate(request('replace', await page(store), html('D')), manager);
  assert.ok(!(await store.records()).some(record => record.id === oldest));
  assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), html('D'));
});
test('same-byte ABA revisions remain stale and backups cannot restore a different filename', async t => {
  const { store } = await fixture(t);
  await store.mutate(request('upload', null, html('same')), manager);
  const old = await page(store);
  await store.mutate(request('replace', old, html('same')), manager);
  assert.equal((await page(store)).sha256, old.sha256);
  await assert.rejects(store.mutate(request('delete', old), manager), { code: 'version-conflict' });
  const backup = (await store.list()).backups[0];
  await assert.rejects(store.mutate(request('restore', { name: 'different.html', revision: 'missing', sha256: null }, null,
    { backupId: backup.id, backupSha256: backup.sha256 }), manager), { code: 'backup-conflict' });
});
test('512 MiB private-state quota reserves a complete transaction and leaves live bytes unchanged', async t => {
  const { store, config } = await fixture(t);
  const result = await store.mutate(request('upload', null, html('unchanged')), manager);
  const current = await page(store);
  const sparse = await open(path.join(store.transactions, result.transactionId, 'next.html'), 'wx');
  try { await sparse.truncate(512 * 1024 * 1024); } finally { await sparse.close(); }
  await assert.rejects(store.mutate(request('replace', current, html('not-applied')), manager), { code: 'state-quota' });
  assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), html('unchanged'));
  assert.equal((await readdir(store.transactions)).length, 1);
});
test('500-page ceiling is checked before preparing the 501st upload', async t => {
  const { store, config } = await fixture(t);
  for (let i = 0; i < 500; i++) await writeFile(path.join(config.contentDir, `p${i}.html`), html('existing'));
  await assert.rejects(store.mutate(request('upload', null, html('new')), manager), { code: 'content-quota' });
  assert.deepEqual(await readdir(store.transactions), []);
});
test('restore crash can recover the verified effect without rewriting live content', async t => {
  let crash = false;
  const { store, config } = await fixture(t, { checkpoint: async at => { if (crash && at === 'applied') throw new Error('restore-crash'); } });
  await store.mutate(request('upload', null, html('restore-me')), manager);
  await store.mutate(request('delete', await page(store)), manager);
  const inventory = await store.list(), backup = inventory.backups[0];
  crash = true;
  await assert.rejects(store.mutate(request('restore', { name: backup.name, revision: inventory.missingVersions[backup.name], sha256: null }, null,
    { backupId: backup.id, backupSha256: backup.sha256 }), manager), { code: 'outcome-uncertain' });
  await unlockAfterStopped(store);
  assert.equal((await store.recover())[0].status, 'committed');
  assert.deepEqual(await readFile(path.join(config.contentDir, backup.name)), html('restore-me'));
});
test('rename-before-sync crash recovery syncs both directories before writing its durable outcome', async t => {
  let crash = false;
  const { store, config } = await fixture(t, { checkpoint: async at => { if (crash && at === 'renamed') throw new Error('rename-before-sync'); } });
  await store.mutate(request('upload', null, html('before')), manager);
  const before = await page(store); crash = true;
  await assert.rejects(store.mutate(request('replace', before, html('after')), manager), error =>
    error.code === 'outcome-uncertain' && /^[a-f0-9-]{36}$/.test(error.transactionId));
  const pending = (await store.records({ allowPending: true })).find(record => !record.outcome);
  await unlockAfterStopped(store);
  const synced = [];
  const recovering = new PageStore(config, {
    syncDirectoryImpl: async directory => {
      await assert.rejects(readFile(path.join(pending.directory, 'outcome.json')), { code: 'ENOENT' });
      synced.push(directory); await syncDirectory(directory);
    },
    checkpoint: async at => { if (at === 'recovery-synced') assert.deepEqual(synced, [config.contentDir, pending.directory]); },
  });
  assert.equal((await recovering.recover())[0].status, 'committed');
  assert.deepEqual(synced, [config.contentDir, pending.directory]);
  assert.equal(JSON.parse(await readFile(path.join(pending.directory, 'outcome.json'), 'utf8')).status, 'committed');
  assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), html('after'));
});
for (const stage of ['retired-renamed', 'retired', 'retired-file-removed']) {
  test(`expired transaction cleanup resumes after ${stage} interruption without torn active journal`, async t => {
    let now = Date.parse('2025-01-01T00:00:00Z'), crash = false;
    const { store, config } = await fixture(t, {
      now: () => now, checkpoint: async at => { if (crash && at === stage) throw new Error('cleanup-crash'); },
    });
    const first = await store.mutate(request('upload', null, html('A')), manager);
    await store.mutate(request('replace', await page(store), html('B')), manager);
    now += 366 * 86400000; crash = true;
    await assert.rejects(store.list(), /cleanup-crash/);
    assert.ok(!(await readdir(store.transactions)).includes(first.transactionId));
    assert.ok((await readdir(store.retired)).includes(first.transactionId));
    const restarted = await new PageStore(config, { now: () => now }).initialize();
    const inventory = await restarted.list();
    assert.equal(inventory.pages[0].sha256, digest(html('B')));
    assert.deepEqual(await readdir(store.retired), []);
    assert.ok((await restarted.records()).every(record => record.outcome.status === 'committed'));
    await restarted.mutate(request('replace', inventory.pages[0], html('C')), manager);
    assert.deepEqual(await readFile(path.join(config.contentDir, 'report.html')), html('C'));
  });
}
test('retired bytes count toward evidence quota until safely cleaned', async t => {
  const { store } = await fixture(t);
  const id = '99999999-9999-4999-8999-999999999999', directory = path.join(store.retired, id);
  await mkdir(directory);
  const sparse = await open(path.join(directory, 'backup.html'), 'wx');
  try { await sparse.truncate(512 * 1024 * 1024); } finally { await sparse.close(); }
  await assert.rejects(store.quota(), { code: 'state-quota' });
  await store.cleanupRetired();
  await store.quota();
});
