import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { origin, html, json } from './test-support.mjs';
import { digest } from './common.mjs';
import { pngInfo } from './png.mjs';
import { png } from './test-support.mjs';
import { verifyResult } from './manager-ui.mjs';

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.events = {}; this.value = ''; this.disabled = false; this.textContent = ''; this.attributes = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(event, handler) { this.events[event] = handler; }
  async fire(event, value) { await this.events[event]?.(value); }
  click() { return this.fire('click'); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
}
const text = element => [element.textContent, ...element.children.map(text)].join('\n');
const all = (element, predicate) => [...(predicate(element) ? [element] : []), ...element.children.flatMap(child => all(child, predicate))];
const button = (element, label) => all(element, child => child.tag === 'button' && child.textContent === label)[0];
const field = (element, label) => {
  const nodes = all(element, item => item.tag === 'dl').flatMap(item => item.children);
  const index = nodes.findIndex(item => item.tag === 'dt' && item.textContent === label);
  return index < 0 ? undefined : nodes[index + 1].textContent;
};
const id = '99999999-9999-4999-8999-999999999999';
const page = { name: 'report.html', revision: 'untracked:' + 'a'.repeat(64), sha256: 'a'.repeat(64), size: 49152,
  uploadedAt: null, modifiedAt: '2026-01-01', provenance: '<img src=x onerror=alert(1)>', actor: null, recordedAt: null };
const backupA = { id: '88888888-8888-4888-8888-888888888888', name: page.name, sha256: 'b'.repeat(64), size: 49152, savedAt: '2026-01-02', action: 'replace' };
const backupB = { ...backupA, id: '77777777-7777-4777-8777-777777777777', sha256: 'c'.repeat(64), size: 45056, savedAt: '2026-01-01', action: 'delete' };
let serial = 0;
async function dom(t, changes = {}) {
  const saved = new Map(['document', 'location', 'fetch'].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of saved) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const elements = new Map(), calls = [];
  const get = name => { if (!elements.has(name)) elements.set(name, new Element()); return elements.get(name); };
  get('sort').value = 'name';
  const state = {
    inventory: { pages: [{ ...page }], backups: [backupA, backupB], missingVersions: {}, origin, mutationsEnabled: true,
      checkedAt: '2026-01-03', unmanagedEntries: 2,
      access: { tenantId: 'synthetic-tenant', allowedGroupIds: ['synthetic-group'], authentication: 'synthetic-auth', network: 'not-attested' },
      ...changes },
    mutate: body => {
      if (body.action === 'delete') {
        state.inventory.pages = state.inventory.pages.filter(item => item.name !== body.name);
        state.inventory.missingVersions[body.name] = id;
      } else {
        const selected = state.inventory.backups.find(item => item.id === body.backupId);
        state.inventory.pages = [...state.inventory.pages.filter(item => item.name !== body.name), { ...page,
          name: body.name, sha256: body.backupSha256, revision: id, provenance: 'restore',
          size: selected.size, actor: 'synthetic-actor', thumbnail: selected.thumbnail ?? null,
          uploadedAt: null, recordedAt: '2026-01-04', modifiedAt: '2026-01-04' }];
      }
      return json({ verified: true, name: body.name, action: body.action, transactionId: id, revision: id,
        sha256: body.action === 'delete' ? null : body.backupSha256,
        thumbnail: body.action === 'delete' ? null : state.inventory.backups.find(item => item.id === body.backupId).thumbnail ?? null });
    },
  };
  globalThis.document = { getElementById: get, createElement: tag => new Element(tag) };
  globalThis.location = { origin };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('inventory')) return json(state.inventory);
    return state.mutate(JSON.parse(options.body));
  };
  await import(`./manager-ui.mjs?offline-dom=${serial++}`);
  for (let i = 0; i < 5; i++) await setImmediate();
  const confirm = async (name = page.name) => { get('confirm-name').value = name; await get('confirm-name').fire('input'); await get('confirm').click(); };
  return { get, calls, state, confirm, posts: () => calls.filter(call => call.options.method === 'POST') };
}
test('compact DOM library has selection/search/sort, truthful detail fields and safe Open, not browser publishing', async t => {
  const second = { ...page, name: 'second.html', size: 60000, modifiedAt: '2026-02-01' };
  const { get, calls } = await dom(t, { pages: [page, second] });
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(Object.hasOwn(calls[0].options, 'referrerPolicy'), false);
  assert.equal(Object.hasOwn(calls[0].options, 'referrer'), false);
  assert.equal(get('pages').children.length, 2);
  const row = get('pages').children[0];
  assert.equal(row.children.length, 4);
  assert.doesNotMatch(text(row), /SHA-256|Provenance|Version:/);
  assert.match(text(get('page-details')), /<img src=x onerror/);
  assert.equal(field(get('page-details'), 'Original upload'), 'Unknown');
  assert.match(text(get('technical-fields')), /Actor ID\nUnknown/);
  assert.match(text(get('policy')), /synthetic-tenant|not-attested/);
  const open = all(row, item => item.tag === 'a')[0];
  assert.equal(open.href, origin + '/report.html'); assert.equal(open.rel, 'noopener noreferrer');
  await button(get('pages'), second.name).click();
  assert.match(text(get('page-details')), /second.html/);
  assert.equal(button(get('pages'), second.name).attributes['aria-pressed'], 'true');
  assert.equal(button(get('pages'), second.name).focused, true);
  get('search').value = 'REPORT'; await get('search').fire('input');
  assert.equal(get('pages').children.length, 1);
  assert.match(text(get('page-details')), /second.html/);
  get('search').value = ''; await get('search').fire('input');
  for (const sort of ['modified', 'size']) {
    get('sort').value = sort; await get('sort').fire('change');
    assert.match(text(get('pages').children[0]), /second.html/);
  }
  assert.doesNotMatch(text(get('pages')), /Replace|Upload/);
});
test('whole page rows select without intercepting Open or Delete controls', async t => {
  const second = { ...page, name: 'second.html' };
  const { get, posts } = await dom(t, { pages: [page, second] });
  let row = get('pages').children[1];
  for (const control of ['a', 'button']) {
    await row.fire('click', { target: { closest: selector => {
      assert.equal(selector, 'a, button');
      return all(row, item => item.tag === control)[0];
    } } });
    assert.equal(button(get('pages'), page.name).attributes['aria-pressed'], 'true');
    assert.equal(get('confirmation').open, undefined);
  }
  await row.fire('click', { target: { closest: () => null } });
  assert.equal(button(get('pages'), second.name).attributes['aria-pressed'], 'true');
  assert.equal(button(get('pages'), second.name).focused, true);
  assert.match(text(get('page-details')), /second.html/);
  row = get('pages').children[0];
  await row.fire('click', { target: { closest: () => null } });
  assert.equal(button(get('pages'), page.name).attributes['aria-pressed'], 'true');
  assert.equal(posts().length, 0);
});
test('delete requires exact filename, keeps deleted selection/history and restores selected older backup to missing', async t => {
  const { get, calls, posts, confirm } = await dom(t);
  await button(get('pages'), 'Delete').click();
  assert.equal(get('confirmation').open, true);
  assert.match(text(get('review-fields')), new RegExp(page.revision));
  await confirm('wrong.html'); assert.equal(get('confirm').disabled, true); assert.equal(posts().length, 0);
  await confirm();
  assert.equal(posts().length, 1);
  const deletion = JSON.parse(posts()[0].options.body);
  assert.equal(deletion.expectedRevision, page.revision); assert.equal(deletion.expectedSha256, page.sha256);
  assert.equal(deletion.confirmation, page.name);
  assert.equal(get('pages').children.length, 0);
  assert.match(get('detail-title').textContent, /missing/);
  assert.match(text(get('page-details')), /Last-known size/);
  assert.equal(get('backups').children.length, 2);
  assert.match(get('status').textContent, /Verified delete/);
  await button(get('backups'), 'Backup 2').click();
  assert.equal(get('detail-title').textContent, 'Selected backup');
  assert.match(text(get('page-details')), /44.0 KiB|Current destination: Missing/);
  const selectedPreview = all(get('page-details'), item => item.className === 'preview')[0];
  assert.equal(selectedPreview.attributes['data-sha256'], backupB.sha256);
  assert.match(text(get('technical-fields')), /Selected backup SHA-256/);
  assert.match(text(get('technical-fields')), /Destination SHA-256\nMissing/);
  await button(get('backups').children[1], 'Restore').click();
  assert.match(get('selection').textContent, /Creates the missing page/);
  assert.match(get('selection').textContent, new RegExp(backupB.id));
  assert.match(text(get('review-fields')), new RegExp(backupB.sha256));
  assert.equal(get('confirm-name').value, '');
  await confirm('report.HTML'); assert.equal(posts().length, 1);
  await confirm();
  const restore = JSON.parse(posts()[1].options.body);
  assert.equal(restore.backupId, backupB.id); assert.equal(restore.backupSha256, backupB.sha256);
  assert.equal(restore.expectedSha256, null); assert.equal(restore.expectedRevision, id);
  assert.equal(get('pages').children.length, 1);
  assert.equal(get('detail-title').textContent, 'Selected page');
  assert.equal(all(get('page-details'), item => item.className === 'preview')[0].attributes['data-sha256'], backupB.sha256);
  assert.equal(all(get('pages'), item => item.className === 'preview')[0].attributes['data-sha256'], backupB.sha256);
  assert.match(text(get('page-details')), /44.0 KiB|restore/);
  assert.equal(field(get('page-details'), 'Original upload'), 'Unknown');
  assert.match(get('status').textContent, /Verified restore.*https:\/\/example.test\/report.html/);
  for (const { options } of calls.filter(call => call.options.method === 'POST')) {
    assert.equal(options.referrerPolicy, 'same-origin'); assert.equal(Object.hasOwn(options, 'referrer'), false);
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['Content-Type'], 'application/json'); assert.equal(options.headers['X-Manager-Request'], '1');
  }
});
test('restore-to-existing review discloses overwrite and cancellation/Escape send no request', async t => {
  const { get, posts } = await dom(t);
  await button(get('backups'), 'Restore').click();
  assert.match(get('selection').textContent, /Replaces its reviewed version/);
  assert.match(text(get('review-fields')), new RegExp(page.sha256));
  await get('cancel').click();
  assert.equal(get('confirmation').open, false);
  await button(get('pages'), 'Delete').click();
  let prevented = false;
  await get('confirmation').fire('cancel', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(get('confirmation').open, false); assert.equal(posts().length, 0);
});
test('backup history for missing destinations is discoverable without a live page or invented last-known metadata', async t => {
  const { get } = await dom(t, { pages: [], missingVersions: { [page.name]: id } });
  assert.equal(get('backups').children.length, 2);
  assert.match(text(get('backup-page')), /report.html \(missing\)/);
  assert.equal(field(get('page-details'), 'Last-known size'), 'Unknown');
  assert.match(text(get('technical-fields')), new RegExp(id));
  await button(get('backups'), 'Backup 1').click();
  assert.equal(field(get('page-details'), 'Backup size'), '48.0 KiB');
  assert.equal(field(get('page-details'), 'Original upload'), 'Unknown');
  assert.match(text(get('technical-fields')), /Actor ID\nUnknown/);
});
test('replace dates are not mislabeled as original upload; untracked/missing revisions render honestly', async t => {
  const { get } = await dom(t, { pages: [{ ...page, provenance: 'replace', uploadedAt: '2026-01-02' }] });
  assert.equal(field(get('page-details'), 'Original upload'), 'Unknown');
  assert.notEqual(field(get('page-details'), 'Replacement recorded'), 'Unknown');
  assert.match(text(get('technical-fields')), /untracked:/);
});
test('read-only mode and inventory refresh failure retain context with disabled mutations', async t => {
  const { get, state, posts } = await dom(t, { mutationsEnabled: false });
  assert.match(get('read-only').textContent, /Read-only/);
  assert.equal(button(get('pages'), 'Delete').disabled, true);
  assert.equal(button(get('backups'), 'Restore').disabled, true);
  await button(get('pages'), 'Delete').click(); assert.equal(get('confirmation').open, undefined);
  state.inventory.mutationsEnabled = true; await get('refresh').click();
  assert.equal(button(get('pages'), 'Delete').disabled, false);
  globalThis.fetch = async () => { throw new Error('synthetic.jwt.token'); };
  await get('refresh').click();
  assert.match(get('status').textContent, /Inventory could not be verified/);
  assert.doesNotMatch(get('status').textContent, /synthetic.jwt.token/);
  assert.equal(get('pages').children.length, 1);
  assert.match(get('read-only').textContent, /last-known/);
  assert.equal(button(get('pages'), 'Delete').disabled, true);
  assert.equal(posts().length, 0);
});
test('definite denials and uncertain/wrong-hash results preserve context, safe IDs and do not retry mutations', async t => {
  const { get, state, confirm, posts } = await dom(t);
  for (const [status, code] of [[409, 'version-conflict'], [507, 'state-quota']]) {
    state.mutate = () => json({ code, error: 'synthetic.jwt.token' }, status);
    await get('refresh').click(); await button(get('pages'), 'Delete').click(); await confirm();
    assert.match(get('status').textContent, /No report change was made by this request/);
    assert.doesNotMatch(get('status').textContent, /uncertain|synthetic.jwt.token|private transaction evidence/);
    assert.equal(get('pages').children.length, 1); assert.equal(button(get('pages'), 'Delete').disabled, true);
  }
  for (const transactionId of [id, 'synthetic.jwt.token']) {
    state.mutate = body => json({ verified: true, name: body.name, action: body.action, transactionId, revision: transactionId, sha256: 'wrong', error: 'synthetic.jwt.token' });
    await get('refresh').click(); await button(get('backups'), 'Restore').click(); await confirm();
    assert.match(get('status').textContent, /uncertain/);
    if (transactionId === id) assert.match(get('status').textContent, new RegExp(id));
    assert.doesNotMatch(get('status').textContent, /synthetic.jwt.token|Verified restore/);
    assert.equal(get('pages').children.length, 1); assert.equal(button(get('backups'), 'Restore').disabled, true);
    assert.equal(get('detail-title').textContent, 'Selected backup');
  }
  state.mutate = () => json({ code: 'outcome-uncertain', transactionId: id, error: 'synthetic.jwt.token' }, 503);
  await get('refresh').click(); await button(get('pages'), 'Delete').click(); await confirm();
  assert.match(get('status').textContent, new RegExp(id)); assert.match(get('status').textContent, /uncertain/);
  assert.doesNotMatch(get('status').textContent, /synthetic.jwt.token/); assert.equal(posts().length, 5);
});
test('UI rejects success-shaped results with wrong transaction, filename, version or hash', async () => {
  const request = { name: 'report.html', action: 'upload', htmlBase64: html('local').toString('base64') };
  const result = { name: request.name, action: request.action, verified: true, transactionId: id, revision: id, sha256: digest(html('local')) };
  await verifyResult(request, result);
  for (const change of [{ transactionId: 'invalid' }, { name: 'different.html' }, { revision: 'old' }, { sha256: 'wrong' }]) {
    await assert.rejects(verifyResult(request, { ...result, ...change }), error =>
      error.outcome === 'uncertain' && error.transactionId === (change.transactionId ? null : id));
  }
});
test('real PNG elements bind current, selected backup, confirmation and restored versions; failed image reads stay explicit', async t => {
  const image = (sha, color, side = 'before') => {
    const info = pngInfo(png(color));
    return { htmlSha256: sha, ...info, url: `/_manager/api/thumbnail/${id}/${side}/${info.sha256}.png` };
  };
  const current = { ...page, thumbnail: image(page.sha256, 20, 'after') };
  const backup = { ...backupB, thumbnail: image(backupB.sha256, 200) };
  const { get, confirm } = await dom(t, { pages: [current], backups: [backup] });
  let images = all(get('page-details'), item => item.tag === 'img');
  assert.equal(images[0].src, current.thumbnail.url);
  await button(get('backups'), 'Backup 1').click();
  images = all(get('page-details'), item => item.tag === 'img');
  assert.equal(images[0].src, backup.thumbnail.url);
  await button(get('backups'), 'Restore').click();
  assert.equal(all(get('review-preview'), item => item.tag === 'img')[0].src, backup.thumbnail.url);
  await confirm();
  assert.match(get('status').textContent, /Verified restore/);
  assert.equal(all(get('pages'), item => item.tag === 'img')[0].src, backup.thumbnail.url);
  const restoredImage = all(get('page-details'), item => item.tag === 'img')[0];
  assert.equal(restoredImage.src, backup.thumbnail.url);
  await restoredImage.fire('error');
  assert.match(text(get('page-details')), /image request failed/);
  const restoreRequest = { action: 'restore', name: page.name, backupSha256: backup.sha256 };
  await assert.rejects(verifyResult(restoreRequest, { verified: true, name: page.name, action: 'restore', transactionId: id, revision: id,
    sha256: backup.sha256, thumbnail: current.thumbnail }, backup.thumbnail), error => error.outcome === 'uncertain' && error.transactionId === id);
});
test('UI shell keeps compact accessible columns, expandable IDs, responsive rail and no publishing controls or report embedding', async () => {
  const source = await readFile(new URL('./manager-ui.mjs', import.meta.url), 'utf8');
  const ui = await readFile(new URL('./manager.html', import.meta.url), 'utf8');
  assert.match(ui, /<th scope="col">Page<\/th><th scope="col">Modified<\/th><th scope="col">Size<\/th><th scope="col">Actions<\/th>/);
  assert.match(ui, /<details id="technical"/); assert.match(ui, /<details id="backup-technical"/);
  assert.match(ui, /@media\(max-width:800px\)/); assert.match(ui, /grid-template-columns:1fr/);
  assert.match(ui, /not resolved people or group names, per-page ACLs/);
  assert.doesNotMatch(ui, /<button[^>]*>[^<]*(?:Upload|Replace)|dropzone|type="file"|<iframe|<object|<embed|<img/i);
  assert.doesNotMatch(source, /fetch\(.*(?:page\.url|backup\.url)|innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  assert.match(ui, /Versions without an image show Preview unavailable/);
});
