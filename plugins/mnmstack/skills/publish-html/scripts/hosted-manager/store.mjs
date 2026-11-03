import path from 'node:path';
import { mkdir, readdir, rename, rmdir, unlink, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  NAME, SHA, GUID, MAX_HTML, fail, digest, htmlBytes, safeDirectory,
  readRegular, optionalFile, durableFile, syncDirectory, exactObject, ManagerError,
} from './common.mjs';
import { MAX_PNG, pngInfo, validThumbnail, thumbnailInput } from './png.mjs';

const DAY = 86_400_000;
const MAX_TRANSACTIONS = 10_000;
const MAX_STATE_BYTES = 512 * 1024 * 1024;
const JSON_LIMIT = 8192;
const jsonBytes = value => Buffer.from(JSON.stringify(value) + '\n');
const files = ['prepare.json', 'outcome.json', 'backup.html', 'displaced.html', 'next.html', 'before.png', 'after.png'];

async function jsonFile(filename) {
  const file = await optionalFile(filename, JSON_LIMIT);
  if (!file) return null;
  try { return JSON.parse(file.bytes.toString('utf8')); }
  catch { fail(503, 'journal-torn', 'Invalid transaction journal. Preserve evidence and recover offline.'); }
}
function validManifest(m, id) {
  return m?.id === id && Number.isSafeInteger(m.sequence) && m.sequence > 0 && NAME.test(m.name ?? '') &&
    ['upload', 'replace', 'delete', 'restore'].includes(m.action) && GUID.test(m.actor ?? '') &&
    typeof m.beforeRevision === 'string' && m.beforeRevision.length <= 160 &&
    (m.beforeSha === null || SHA.test(m.beforeSha ?? '')) &&
    (m.afterSha === null || SHA.test(m.afterSha ?? '')) && Number.isFinite(Date.parse(m.preparedAt)) &&
    (m.action === 'delete' ? m.afterSha === null && m.beforeSha !== null : m.afterSha !== null) &&
    validThumbnail(m.beforeThumbnail ?? null, m.beforeSha) && validThumbnail(m.afterThumbnail ?? null, m.afterSha);
}
export class PageStore {
  constructor(config, { now = Date.now, checkpoint = async () => {}, syncDirectoryImpl = syncDirectory } = {}) {
    this.config = config; this.now = now; this.checkpoint = checkpoint; this.syncDirectory = syncDirectoryImpl;
    this.root = config.contentDir; this.state = config.stateDir;
    this.transactions = path.join(this.state, 'transactions');
    this.retired = path.join(this.state, 'retired');
    this.lock = path.join(this.state, 'writer.lock');
  }
  async initialize() {
    const root = await safeDirectory(this.root);
    await safeDirectory(path.dirname(this.state));
    try { await mkdir(this.state, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const state = await safeDirectory(this.state);
    if (state.dev !== root.dev) fail(500, 'state-config', 'Non-served state and content must share one filesystem.');
    try { await mkdir(this.transactions, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await safeDirectory(this.transactions);
    try { await mkdir(this.retired, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await safeDirectory(this.retired);
    await syncDirectory(this.state);
    return this;
  }
  async locked(work, waitMs = 1000) {
    await safeDirectory(this.root); await safeDirectory(this.state); await safeDirectory(this.transactions); await safeDirectory(this.retired);
    const deadline = Date.now() + waitMs;
    for (;;) {
      try { await mkdir(this.lock, { mode: 0o700 }); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) fail(409, 'writer-locked', 'Another writer or an interrupted transaction owns the lock. Never steal it; inspect and recover offline.');
        await delay(20);
      }
    }
    let preserve = false;
    try {
      await syncDirectory(this.state);
      return await work(() => { preserve = true; });
    } finally {
      if (!preserve) { await rmdir(this.lock); await syncDirectory(this.state); }
    }
  }
  async records({ allowPending = false } = {}) {
    const entries = await readdir(this.transactions);
    if (entries.length > MAX_TRANSACTIONS) fail(507, 'journal-quota', 'Transaction count limit reached; operator review required.');
    const records = [];
    for (const id of entries) {
      if (!GUID.test(id)) fail(503, 'journal-entry', 'Unexpected private-state entry; preserve it for operator review.');
      const directory = path.join(this.transactions, id);
      await safeDirectory(directory);
      const children = await readdir(directory);
      if (children.some(name => !files.includes(name))) fail(503, 'journal-entry', 'Unexpected transaction evidence; operator review required.');
      const manifest = await jsonFile(path.join(directory, 'prepare.json'));
      const outcome = await jsonFile(path.join(directory, 'outcome.json'));
      if (!validManifest(manifest, id)) fail(503, 'journal-torn', 'Missing or invalid prepare record. Preserve evidence for offline operator review.');
      if (outcome && (!['committed', 'aborted'].includes(outcome.status) || !Number.isFinite(Date.parse(outcome.at)))) fail(503, 'journal-torn', 'Invalid outcome record. Preserve evidence for offline operator review.');
      if (!outcome && !allowPending) fail(503, 'transaction-pending', 'Unresolved transaction; inspect and recover offline before further operations.');
      records.push({ ...manifest, outcome, directory });
    }
    records.sort((a, b) => a.sequence - b.sequence);
    if (new Set(records.map(r => r.sequence)).size !== records.length) fail(503, 'journal-sequence', 'Duplicate transaction sequence; preserve state for review.');
    return records;
  }
  latest(records, name) { return records.findLast(r => r.name === name && r.outcome?.status === 'committed'); }
  async image(record, side) {
    const metadata = record?.[side + 'Thumbnail'] ?? null;
    if (!metadata) return null;
    const file = await optionalFile(path.join(record.directory, side + '.png'), MAX_PNG);
    if (!file) fail(503, 'thumbnail-corrupt', 'Declared private thumbnail is missing; preserve transaction evidence.');
    let info;
    try { info = pngInfo(file.bytes); } catch { fail(503, 'thumbnail-corrupt', 'Private thumbnail failed PNG verification.'); }
    if (Object.entries(info).some(([key, value]) => metadata[key] !== value)) fail(503, 'thumbnail-corrupt', 'Private thumbnail failed hash or dimension verification.');
    return { bytes: file.bytes, metadata };
  }
  thumbnailDetails(record, side, image) {
    return image ? { ...image.metadata, url: `/_manager/api/thumbnail/${record.id}/${side}/${image.metadata.sha256}.png` } : null;
  }
  async thumbnail(id, side, sha256) {
    if (!GUID.test(id ?? '') || !['before', 'after'].includes(side) || !SHA.test(sha256 ?? '')) fail(404, 'thumbnail-missing', 'Thumbnail unavailable.');
    return this.locked(async () => {
      const records = await this.records();
      const record = records.find(item => item.id === id && item.outcome?.status === 'committed');
      const age = record ? this.now() - Math.max(Date.parse(record.outcome.at), Date.parse(record.preparedAt)) : Infinity;
      if (!record || record[side + 'Thumbnail']?.sha256 !== sha256 ||
          (age > this.config.backupRetentionDays * DAY && (side === 'before' || this.latest(records, record.name).id !== id))) {
        fail(404, 'thumbnail-missing', 'Thumbnail unavailable or outside its retention window.');
      }
      return (await this.image(record, side)).bytes;
    }, 5000);
  }
  async snapshot(name, records) {
    if (!NAME.test(name ?? '')) fail(400, 'content-name', 'Safe flat HTML filename required.');
    const file = await optionalFile(path.join(this.root, name));
    const sha256 = file ? digest(file.bytes) : null;
    const latest = this.latest(records, name);
    const tracked = latest && latest.afterSha === sha256;
    return {
      name, sha256, revision: tracked ? latest.id : file ? `untracked:${sha256}` : 'missing',
      size: file?.bytes.length ?? 0, modifiedAt: file ? file.stat.mtime.toISOString() : null,
      uploadedAt: tracked && ['upload', 'replace'].includes(latest.action) ? latest.outcome.at : null,
      recordedAt: tracked ? latest.outcome.at : null,
      provenance: tracked ? latest.action : 'untracked', actor: tracked ? latest.actor : null,
      bytes: file?.bytes ?? null,
    };
  }
  async list() {
    return this.locked(async () => {
      let records = await this.records();
      await this.retention(records);
      records = await this.records();
      const entries = await readdir(this.root);
      if (entries.length > 1000) fail(507, 'inventory-quota', 'Content entry limit reached; operator review required.');
      const names = entries.filter(name => NAME.test(name));
      if (names.length > 500 || new Set(names.map(n => n.toLowerCase())).size !== names.length) fail(409, 'inventory-names', 'Too many pages or case-colliding names; operator review required.');
      const pages = [];
      for (const name of names) {
        const { bytes, ...page } = await this.snapshot(name, records);
        const latest = this.latest(records, name);
        const image = latest?.afterSha === page.sha256 ? await this.image(latest, 'after') : null;
        pages.push({ ...page, url: `${this.config.origin}/${name}`, thumbnail: this.thumbnailDetails(latest, 'after', image) });
      }
      const backups = [];
      const missingVersions = {};
      for (const record of records) {
        if (record.outcome?.status !== 'committed') continue;
        if (!names.includes(record.name)) missingVersions[record.name] = (await this.snapshot(record.name, records)).revision;
        if (record.beforeSha !== null) {
          const backup = await optionalFile(path.join(record.directory, 'backup.html'));
          if (backup) {
            if (digest(backup.bytes) !== record.beforeSha) fail(503, 'backup-corrupt', 'Backup verification failed; preserve private state.');
            backups.push({ id: record.id, name: record.name, sha256: record.beforeSha, size: backup.bytes.length, savedAt: record.preparedAt, action: record.action,
              thumbnail: this.thumbnailDetails(record, 'before', await this.image(record, 'before')) });
          }
        }
      }
      return { pages, backups, missingVersions, unmanagedEntries: entries.length - names.length, checkedAt: new Date(this.now()).toISOString() };
    });
  }
  async quota() {
    let size = 0, count = 0;
    for (const namespace of [this.transactions, this.retired]) {
      for (const id of await readdir(namespace)) {
        if (!GUID.test(id)) fail(503, 'journal-entry', 'Unexpected state entry.');
        const directory = path.join(namespace, id);
        await safeDirectory(directory); count++;
        for (const name of await readdir(directory)) {
          if (!files.includes(name)) fail(503, 'journal-entry', 'Unexpected transaction file.');
          const stat = await lstat(path.join(directory, name));
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail(503, 'journal-link', 'Unsafe transaction file.');
          size += stat.size;
        }
      }
    }
    if (count >= MAX_TRANSACTIONS || size + MAX_HTML * 3 + MAX_PNG * 2 + JSON_LIMIT * 2 > MAX_STATE_BYTES) fail(507, 'state-quota', 'Private backup/audit quota reached. No live content was changed.');
  }
  async mutate(body, actor) {
    const hasThumbnail = Object.hasOwn(body ?? {}, 'thumbnail');
    exactObject(body, ['action', 'name', 'confirmation', 'expectedRevision', 'expectedSha256', 'htmlBase64', 'backupId', 'backupSha256', ...(hasThumbnail ? ['thumbnail'] : [])]);
    if (!this.config.mutationsEnabled || !this.config.legacyPublishersFrozen) fail(403, 'mutations-disabled', 'Hosted mutations are disabled until approved publisher cutover.');
    if (!GUID.test(actor ?? '') || !NAME.test(body.name ?? '') || body.confirmation !== body.name ||
        !['upload', 'replace', 'delete', 'restore'].includes(body.action) ||
        typeof body.expectedRevision !== 'string' || body.expectedRevision.length > 160 ||
        !(body.expectedSha256 === null || SHA.test(body.expectedSha256 ?? ''))) fail(400, 'mutation-fields', 'Exact filename, reviewed revision and SHA-256 required.');
    let next = null, afterImage = null;
    if (['upload', 'replace'].includes(body.action)) {
      if (body.backupId !== null || body.backupSha256 !== null || typeof body.htmlBase64 !== 'string' ||
          body.htmlBase64.length > Math.ceil(MAX_HTML / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.htmlBase64)) fail(400, 'html-payload', 'Canonical base64 HTML required.');
      next = Buffer.from(body.htmlBase64, 'base64');
      if (next.toString('base64') !== body.htmlBase64) fail(400, 'html-payload', 'Canonical base64 HTML required.');
      htmlBytes(next);
      if (hasThumbnail) afterImage = thumbnailInput(body.thumbnail, digest(next));
    } else if (body.htmlBase64 !== null || (body.action === 'delete' && (body.backupId !== null || body.backupSha256 !== null)) ||
        (body.action === 'restore' && (!GUID.test(body.backupId ?? '') || !SHA.test(body.backupSha256 ?? '')))) fail(400, 'mutation-fields', 'Invalid delete or restore request.');
    if (hasThumbnail && !['upload', 'replace'].includes(body.action)) fail(400, 'thumbnail-fields', 'Only upload or replace accepts a publisher thumbnail.');
    return this.locked(async preserve => {
      const records = await this.records();
      const entries = await readdir(this.root);
      if (entries.some(name => name !== body.name && name.toLowerCase() === body.name.toLowerCase())) fail(409, 'name-collision', 'Case-colliding destination refused.');
      const before = await this.snapshot(body.name, records);
      if (before.revision !== body.expectedRevision || before.sha256 !== body.expectedSha256 ||
          (body.action === 'upload' && before.bytes) || (['replace', 'delete'].includes(body.action) && !before.bytes)) fail(409, 'version-conflict', 'Selected file/version changed. Refresh and review it again.');
      if (entries.length + (before.bytes ? 0 : 1) > 1000 ||
          entries.filter(name => NAME.test(name)).length + (before.bytes || body.action === 'delete' ? 0 : 1) > 500) {
        fail(507, 'content-quota', 'Managed page or content entry quota reached. No live content was changed.');
      }
      const previous = this.latest(records, body.name);
      const beforeImage = previous?.afterSha === before.sha256 && before.bytes ? await this.image(previous, 'after') : null;
      if (body.action === 'restore') {
        const record = records.find(r => r.id === body.backupId && r.name === body.name && r.beforeSha === body.backupSha256 && r.outcome?.status === 'committed');
        if (!record) fail(409, 'backup-conflict', 'Selected backup/version does not match.');
        if (this.now() - Math.max(Date.parse(record.outcome.at), Date.parse(record.preparedAt)) > this.config.backupRetentionDays * DAY) fail(409, 'backup-expired', 'Selected backup has passed its approved retention period.');
        const backup = await optionalFile(path.join(record.directory, 'backup.html'));
        if (!backup || digest(backup.bytes) !== body.backupSha256) fail(409, 'backup-conflict', 'Selected backup expired or failed verification.');
        next = htmlBytes(backup.bytes);
        afterImage = await this.image(record, 'before');
      } else if (next) {
        const sha = digest(next);
        for (const record of records.filter(item => item.name === body.name && item.outcome?.status === 'committed')) {
          for (const side of ['before', 'after']) {
            const metadata = record[side + 'Thumbnail'];
            if (metadata?.htmlSha256 !== sha) continue;
            if (afterImage && afterImage.metadata.sha256 !== metadata.sha256) fail(409, 'thumbnail-conflict', 'This filename and HTML hash already have a different immutable PNG association.');
            if (!afterImage && await optionalFile(path.join(record.directory, side + '.png'), MAX_PNG)) afterImage = await this.image(record, side);
          }
        }
      }
      await this.retention(records);
      await this.quota();
      const id = randomUUID(), directory = path.join(this.transactions, id);
      const manifest = {
        id, sequence: (records.at(-1)?.sequence ?? 0) + 1, name: body.name, action: body.action, actor,
        beforeRevision: before.revision, beforeSha: before.sha256,
        afterSha: next ? digest(next) : null, preparedAt: new Date(this.now()).toISOString(),
        beforeThumbnail: beforeImage?.metadata ?? null, afterThumbnail: afterImage?.metadata ?? null,
      };
      await mkdir(directory, { mode: 0o700 }); await syncDirectory(this.transactions);
      // From this point, failures retain the lock and evidence, even before a
      // complete prepare record exists. No automatic retry or stale-lock steal.
      preserve();
      try {
        if (before.bytes) {
          await durableFile(path.join(directory, 'backup.html'), before.bytes);
          if (digest((await readRegular(path.join(directory, 'backup.html'))).bytes) !== before.sha256) fail(503, 'backup-corrupt', 'Backup readback failed.');
        }
        if (next) await durableFile(path.join(directory, 'next.html'), next);
        for (const [side, image] of [['before', beforeImage], ['after', afterImage]]) {
          if (image) { await durableFile(path.join(directory, side + '.png'), image.bytes); await this.image({ ...manifest, directory }, side); }
        }
        await durableFile(path.join(directory, 'prepare.json'), jsonBytes(manifest));
        await this.checkpoint('prepared', manifest);
        const reviewed = await this.snapshot(body.name, records);
        if (reviewed.sha256 !== before.sha256 || reviewed.revision !== before.revision) fail(409, 'external-conflict', 'An unfenced writer changed the destination; all evidence retained.');
        const destination = path.join(this.root, body.name);
        if (next) await rename(path.join(directory, 'next.html'), destination);
        else await rename(destination, path.join(directory, 'displaced.html'));
        await this.checkpoint('renamed', manifest);
        await syncDirectory(this.root); await syncDirectory(directory);
        await this.checkpoint('applied', manifest);
        const after = await optionalFile(destination);
        if ((after ? digest(after.bytes) : null) !== manifest.afterSha) fail(503, 'readback-conflict', 'Mutation readback failed; outcome uncertain.');
        if (!next && digest((await readRegular(path.join(directory, 'displaced.html'))).bytes) !== manifest.beforeSha) fail(503, 'displaced-conflict', 'Deleted bytes differ from backup; preserve evidence.');
        const outcome = { status: 'committed', at: new Date(this.now()).toISOString() };
        await durableFile(path.join(directory, 'outcome.json'), jsonBytes(outcome));
        await this.checkpoint('committed', manifest);
        // Release only after the outcome and committed effect are durable.
        await rmdir(this.lock); await syncDirectory(this.state);
        return { transactionId: id, name: body.name, action: body.action, revision: id, sha256: manifest.afterSha,
          thumbnail: manifest.afterThumbnail, verified: true };
      } catch (error) {
        const cause = error instanceof ManagerError ? error.code :
          ['EIO', 'ENOSPC', 'EACCES', 'EROFS', 'EXDEV'].includes(error.code) ? error.code : 'storage-interrupted';
        const errorResult = new ManagerError(503, 'outcome-uncertain', `Transaction ${id} is not confirmed to this caller (${cause}). Do not retry. Preserve its lock and evidence; recover offline.`);
        errorResult.transactionId = id;
        throw errorResult;
      }
    });
  }
  // Operator must first stop ALL writers and move the abandoned lock aside.
  // This method never steals a lock and never rewrites live content.
  async recover() {
    return this.locked(async preserve => {
      const records = await this.records({ allowPending: true });
      const recovered = [];
      for (const record of records.filter(r => !r.outcome)) {
        preserve();
        const current = await optionalFile(path.join(this.root, record.name));
        const sha = current ? digest(current.bytes) : null;
        if (record.beforeSha !== null) {
          const backup = await optionalFile(path.join(record.directory, 'backup.html'));
          if (!backup || digest(backup.bytes) !== record.beforeSha) fail(503, 'recovery-backup', 'Recovery backup missing or corrupt. Preserve all evidence.');
        }
        await this.image(record, 'before'); await this.image(record, 'after');
        if (sha !== record.afterSha && sha !== record.beforeSha) fail(409, 'recovery-conflict', 'Live file differs from both transaction states. No file was overwritten; preserve evidence.');
        if (record.action === 'delete' && sha === null) {
          const displaced = await optionalFile(path.join(record.directory, 'displaced.html'));
          if (!displaced || digest(displaced.bytes) !== record.beforeSha) fail(503, 'recovery-displaced', 'Deleted original is missing or changed; operator review required.');
        }
        const status = sha === record.afterSha ? 'committed' : 'aborted';
        await this.syncDirectory(this.root);
        await this.syncDirectory(record.directory);
        await this.checkpoint('recovery-synced', record);
        await durableFile(path.join(record.directory, 'outcome.json'), jsonBytes({ status, at: new Date(this.now()).toISOString(), recovered: true }));
        recovered.push({ id: record.id, status });
      }
      if (recovered.length) { await rmdir(this.lock); await syncDirectory(this.state); }
      return recovered;
    });
  }
  async retention(records) {
    await this.cleanupRetired();
    const latest = new Set(records.filter(r => r.outcome?.status === 'committed').map(r => this.latest(records, r.name).id));
    for (const record of records) {
      if (!record.outcome) continue;
      const age = this.now() - Math.max(Date.parse(record.outcome.at), Date.parse(record.preparedAt));
      if (age <= this.config.backupRetentionDays * DAY) continue;
      if (age > this.config.auditRetentionDays * DAY && !latest.has(record.id)) {
        await rename(record.directory, path.join(this.retired, record.id));
        await this.checkpoint('retired-renamed', record);
        await syncDirectory(this.transactions); await syncDirectory(this.retired);
        await this.checkpoint('retired', record);
        continue;
      }
      for (const name of ['backup.html', 'displaced.html', 'next.html', 'before.png', ...(!latest.has(record.id) ? ['after.png'] : [])]) {
        const filename = path.join(record.directory, name);
        if (await optionalFile(filename)) { await unlink(filename); await syncDirectory(record.directory); }
      }
    }
    await this.cleanupRetired();
  }
  async cleanupRetired() {
    const entries = await readdir(this.retired);
    if (entries.length > MAX_TRANSACTIONS) fail(507, 'journal-quota', 'Retired transaction limit reached; operator review required.');
    // Re-sync both sides before resuming deletion after a rename-before-sync crash.
    await syncDirectory(this.transactions); await syncDirectory(this.retired);
    for (const id of entries) {
      if (!GUID.test(id)) fail(503, 'journal-entry', 'Unexpected retired transaction entry; operator review required.');
      const directory = path.join(this.retired, id);
      await safeDirectory(directory);
      for (const name of await readdir(directory)) {
        if (!files.includes(name)) fail(503, 'journal-entry', 'Unexpected retired transaction evidence; operator review required.');
        const filename = path.join(directory, name);
        const stat = await lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail(503, 'journal-link', 'Unsafe retired transaction evidence.');
        await unlink(filename); await syncDirectory(directory);
        await this.checkpoint('retired-file-removed', { id, name });
      }
      await rmdir(directory); await syncDirectory(this.retired);
    }
  }
}
