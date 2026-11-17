import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { runHtmlpub, parsePublic } from './htmlpub.mjs';
import { aliasPrefix, SetupCatalog } from './htmlpub-catalog.mjs';
import { terminal, SavedExit, optionalPrivate, savePrivate } from './htmlpub-terminal.mjs';
import { withInventory, readPrivate, validateRequest, existingHostHash } from './onboarding/state.mjs';
import { digest } from './hosted-manager/common.mjs';

const exec = promisify(execFile);
const guid = n => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const tenant = guid(1), subscription = guid(2), manager = guid(3), client = guid(4), tx = guid(5), backupId = guid(6);
const origin = 'https://publisher.example.invalid';
const beforeSha = '1'.repeat(64), backupSha = '2'.repeat(64);
const target = ['--origin', origin, '--tenant', tenant, '--api-client', client];
const html = '<!doctype html><html><body>Trusted fixture</body></html>';
async function existingProfile({ browser = false, legacyAuth = false, unknownApplication = false } = {}) {
  const checkedAt = new Date().toISOString(), evidence = 'Synthetic offline verified-host evidence, not live acceptance';
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hosted-manager');
  const names = ['auth.mjs', 'client-protocol.mjs', 'common.mjs', 'config.mjs', 'manager-ui.mjs', 'manager.html', 'png.mjs', 'server.mjs', 'store.mjs'];
  const value = { schemaVersion: 1, sourceVersion: 'htmlpub-existing-host-v1',
    publisher: { origin: 'https://fixture-site.azurewebsites.net', tenantId: tenant, apiClientId: client,
      ...(browser ? { transport: 'browser' } : {}) },
    resources: {
      site: { id: `/subscriptions/${subscription}/resourceGroups/fixture/providers/Microsoft.Web/sites/fixture-site`,
        name: 'fixture-site', type: 'Microsoft.Web/sites', hostname: 'fixture-site.azurewebsites.net',
        location: 'eastus', ownership: 'reused', observedAt: checkedAt, evidence },
      application: { id: unknownApplication ? null : guid(10), appId: client, name: unknownApplication ? null : 'Fixture application', type: 'Microsoft.Graph/applications',
        location: null, ownership: 'external', observedAt: checkedAt, evidence },
    }, runtime: { files: await Promise.all(names.map(async name => ({ name, sha256: digest(await readFile(path.join(root, name))) }))),
      startup: 'node /home/site/wwwroot/server.mjs', verifiedAt: checkedAt, evidence },
    checks: { inventory: { checkedAt, evidence, targetSha256: null },
      publication: { checkedAt, evidence, targetSha256: null, transactionId: tx, name: 'report.html', sha256: beforeSha } } };
  if (legacyAuth) {
    const source = await readFile(path.join(root, 'auth.mjs'), 'utf8');
    value.runtime.files.find(file => file.name === 'auth.mjs').sha256 = digest(Buffer.from(
      source.replace(/    const platformOid =.*\n(?=    const assertion = headers.authorization.slice\(7\);)/, '')
        .replace(/    if \(oid !== platformOid\) fail\(403, 'principal-binding'.*\n/, '')));
  }
  for (const check of Object.values(value.checks)) check.targetSha256 = existingHostHash(value);
  return value;
}
function scripted(answer = (_prompt, fallback) => fallback ?? '') {
  const transcript = [];
  return { interactive: true, transcript,
    line: text => transcript.push(String(text)),
    async ask(prompt, fallback) {
      const value = await answer(prompt, fallback, transcript);
      transcript.push(`${prompt}${fallback === undefined ? '' : ` [${fallback}]`}: ${value}`);
      if (value === ':save' || value === undefined) throw new SavedExit('Saved. Resume with htmlpub setup.');
      return String(value);
    }, close() {},
  };
}
const quiet = () => ({ ...scripted(() => { throw new Error('Unexpected prompt'); }), interactive: false });
async function fixture(t) {
  const root = process.env.PUBLISH_HTML_TEST_ARTIFACT_DIR;
  assert.ok(root && path.isAbsolute(root), 'Select the approved external artifact directory');
  await mkdir(root, { mode: 0o700, recursive: true });
  const directory = await mkdtemp(path.join(root, 'htmlpub-'));
  t.after(() => rm(directory, { recursive: true }));
  const file = path.join(directory, 'report.html'), fresh = path.join(directory, 'new.html');
  await writeFile(file, html, { mode: 0o600 }); await writeFile(fresh, html, { mode: 0o600 });
  return { directory, file, fresh, config: path.join(directory, 'resources.json'), journal: path.join(directory, 'publish.json') };
}
function inventory({ missing = false, backups = true } = {}) {
  return { pages: missing ? [] : [{ name: 'report.html', revision: 'r1', sha256: beforeSha }],
    backups: backups ? [{ id: backupId, name: 'report.html', sha256: backupSha, savedAt: '2026-01-01T00:00:00Z' }] : [],
    missingVersions: missing ? { 'report.html': 'deleted-r1', 'new.html': 'new-r1' } : { 'new.html': 'new-r1' } };
}
function protocol(data = inventory(), { bearer403 = false, conflict = false, unknown = false } = {}) {
  const calls = [], counters = { tokens: 0 };
  return { calls, counters, transport: {
    tokenProvider: async options => {
      counters.tokens++; assert.equal(options.tenantId, tenant); assert.equal(options.apiClientId, client);
      return 'synthetic.jwt.assertion';
    },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      assert.equal(options.headers.Authorization, 'Bearer synthetic.jwt.assertion'); assert.equal(options.headers.Cookie, undefined);
      assert.equal(options.headers['X-Manager-Assertion'], undefined);
      assert.equal(options.headers['X-ZUMO-AUTH'], undefined);
      assert.ok(!String(url).includes('/.auth/'));
      if (bearer403) return Response.json({ code: 'principal-binding', error: 'synthetic.private.provider.body' }, { status: 403 });
      if (String(url).endsWith('/inventory')) return Response.json(data);
      assert.ok(String(url).endsWith('/mutate'));
      if (unknown) throw new TypeError('synthetic private network failure');
      if (conflict) return Response.json({ code: 'version-conflict' }, { status: 409 });
      const body = JSON.parse(options.body);
      return Response.json({ verified: true, transactionId: tx, revision: tx, name: body.name, action: body.action,
        sha256: body.action === 'delete' ? null : body.action === 'restore' ? body.backupSha256 : digest(Buffer.from(body.htmlBase64, 'base64')) });
    },
  } };
}
function request(diagnostics = { mode: 'off' }) {
  return { version: 1, cloud: 'AzureCloud', tenantId: tenant, subscriptionId: subscription, location: 'eastus',
    resourceGroup: { mode: 'create', name: 'alex-html-publishing-rg' }, plan: { mode: 'create', name: 'alex-html-publishing-plan', sku: 'B1' },
    identity: { mode: 'create', name: 'alex-html-publishing-identity' }, application: { mode: 'create', name: 'alex-html-publishing-app' },
    site: { mode: 'create', name: 'alex-html-publishing' }, readerGroups: [{ mode: 'create', name: 'alex-html-publishing-readers' }],
    managerObjectIds: [manager], allowedClientIds: [client], diagnostics };
}
function catalog({ alias = 'alex@example.invalid', denied = false } = {}) {
  const calls = [];
  return { calls, async accounts() {
    calls.push('accounts');
    if (denied) throw Object.assign(new Error('Selected subscription access denied'), { code: 'Forbidden' });
    return [{ id: subscription, tenantId: tenant, name: 'Synthetic subscription', user: { type: 'user', name: alias } }];
  }, async select(account) { assert.equal(account.id, subscription); calls.push('select'); },
  async regions() { return [{ name: 'eastus', displayName: 'East US' }]; },
  async resources(role) {
    calls.push(role);
    if (role === 'users') return [{ id: manager, displayName: 'Approved manager' }];
    if (role === 'managerGroups') return [{ id: guid(12), displayName: 'Approved manager security group' }];
    if (role === 'clients') return [{ id: guid(9), appId: client, displayName: 'Approved client' }];
    return [];
  }, async estimate() { return { monthlyUsd: 73, hourlyUsd: 0.1, assumption: 'Synthetic 730-hour fixture, not a live quote', source: 'offline' }; } };
}
function selectReviewSave(prompt, fallback, transcript) {
  if (prompt === 'Select number' && transcript.some(line => line === 'What next?') &&
      transcript.slice(-4).some(line => line.includes('Save and exit without applying'))) return '3';
  return fallback ?? '';
}
test('one npm bin package has no lifecycle scripts/dependencies and real Node/npm-style bin help works', async t => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.bin, { htmlpub: 'scripts/htmlpub.mjs' });
  assert.equal(pkg.private, true); assert.equal(pkg.scripts, undefined); assert.equal(pkg.dependencies, undefined);
  assert.ok((await stat(path.join(root, pkg.bin.htmlpub))).isFile());
  const result = await exec(process.execPath, [path.join(root, pkg.bin.htmlpub), '--help']);
  assert.match(result.stdout, /npm install --global --ignore-scripts/);
  assert.match(result.stdout, /Windows execution is unverified/);
  assert.deepEqual(parsePublic(['--setup']), { action: 'setup' });
  if (process.platform !== 'win32') {
    const f = await fixture(t), bin = path.join(f.directory, 'htmlpub');
    await symlink(path.join(root, pkg.bin.htmlpub), bin);
    const installedStyle = await exec(bin, ['--help']);
    assert.match(installedStyle.stdout, /protected HTML publisher/);
  }
});
test('account alias is an editable hint, never a service-principal/display-name identity', () => {
  assert.equal(aliasPrefix({ user: { type: 'user', name: 'alex@example.invalid' } }), 'alex-html-publishing');
  assert.equal(aliasPrefix({ user: { type: 'servicePrincipal', name: 'alex@example.invalid' } }), null);
  assert.equal(aliasPrefix({ user: { type: 'user', name: 'Alex Display Name' } }), null);
  for (const name of ['\u00e1lex@example.invalid', 'alex@example.invalid (user)', `${'a'.repeat(31)}@example.invalid`]) {
    assert.equal(aliasPrefix({ user: { type: 'user', name } }), null);
  }
  assert.equal(aliasPrefix({ user: { type: 42, name: 'alex@example.invalid' } }), null);
});
test('long-alias suggestions fit every generated resource name and retain distinguishing tails', () => {
  const suggest = name => aliasPrefix({ user: { type: 'user', name } });
  assert.equal(suggest(`${'a'.repeat(24)}@example.invalid`), `${'a'.repeat(24)}-html-publishing`);
  for (const length of [25, 30]) {
    const account = `${'a'.repeat(length)}@example.invalid`, prefix = suggest(account);
    assert.equal(prefix.length, 40);
    assert.match(prefix, /^[a-z0-9][a-z0-9-]*-[a-f0-9]{12}-html-publishing$/);
    assert.equal(suggest(account.toUpperCase()), prefix);
    assert.equal(suggest(account), prefix);
    const selected = request({ mode: 'enabled', workspace: { mode: 'create', name: `${prefix}-logs` },
      settingName: `${prefix}-auth-logs`, retentionDays: 30, dailyQuotaGb: 1 });
    for (const [role, suffix] of Object.entries({ resourceGroup: '-rg', plan: '-plan', identity: '-identity', application: '-app', site: '' })) {
      selected[role].name = prefix + suffix;
    }
    selected.readerGroups[0].name = `${prefix}-readers`;
    assert.doesNotThrow(() => validateRequest(selected));
  }
  assert.notEqual(suggest(`${'a'.repeat(29)}b@example.invalid`), suggest(`${'a'.repeat(29)}c@example.invalid`));
  assert.notEqual(suggest(`${'a'.repeat(30)}@one.invalid`), suggest(`${'a'.repeat(30)}@two.invalid`));
});
test('reused directory display names keep spaces while IDs and ARM name restrictions stay exact', () => {
  const value = request();
  value.readerGroups = [{ mode: 'reuse', name: 'Report Readers (Team A)', id: guid(12) }];
  value.application = { mode: 'reuse', name: 'Existing Report Publisher', id: guid(13) };
  assert.equal(validateRequest(structuredClone(value)).readerGroups[0].name, 'Report Readers (Team A)');
  for (const name of ['bad\nname', 'bad\x1bname', 'bad\u202ename']) {
    const bad = structuredClone(value); bad.readerGroups[0].name = name;
    assert.throws(() => validateRequest(bad), /Invalid group/);
  }
  value.plan.name = 'Invalid ARM Name'; assert.throws(() => validateRequest(value), /Invalid plan/);
});
test('actual list protocol uses one bearer request and emits no credential/provider markers', async () => {
  const p = protocol(), ui = quiet();
  const result = await runHtmlpub(['list', ...target], { ui, publisherTransport: p.transport });
  assert.equal(result.pages.length, 1); assert.equal(p.counters.tokens, 1); assert.equal(p.calls.length, 1);
  assert.ok(!ui.transcript.join('\n').includes('synthetic.'));
});
test('verified existing-host config keeps its actual runtime and simple commands never run setup', async t => {
  const f = await fixture(t), p = protocol(), profile = await existingProfile();
  await savePrivate(f.config, profile);
  const dependencies = { ui: quiet(), publisherTransport: p.transport,
    setupDependencies: { azure: { scope() { assert.fail('No provisioning or cloud discovery'); } } } };
  assert.equal((await runHtmlpub(['status', '--config', f.config], dependencies)).status, 'existing-host');
  assert.deepEqual(await runHtmlpub(['resources', '--config', f.config], dependencies), profile.resources);
  assert.equal((await runHtmlpub(['setup', '--config', f.config],
    { ...dependencies, ui: scripted() })).status, 'existing-host');
  assert.equal(p.counters.tokens, 0);
  const listed = await runHtmlpub(['list', '--config', f.config], dependencies);
  assert.equal(listed.pages.length, 1); assert.equal(p.calls.length, 1);
  const removed = await runHtmlpub(['delete', 'report.html', '--config', f.config, '--confirm', 'report.html',
    '--revision', 'r1', '--sha256', beforeSha], dependencies);
  assert.equal(removed.verified, true); assert.equal(p.counters.tokens, 2);
  assert.equal((await readPrivate(f.config)).runtime.startup, profile.runtime.startup);
});
test('known pre-group host profiles remain usable without rewriting runtime or acceptance evidence', async t => {
  for (const browser of [false, true]) {
    const f = await fixture(t), profile = await existingProfile({ browser }), p = protocol();
    profile.runtime.files.find(file => file.name === 'auth.mjs').sha256 = browser ?
      '4dbdb7ae85739bc2f292280d6c59451abfcf0fb467e39e344638d9105b899b57' :
      '573e385a77e3e200efb5b87f5337c0144c54207fb87f8535ef3083ca2a40de11';
    profile.runtime.files.find(file => file.name === 'server.mjs').sha256 = '6e751015667813e9c0cf9fa4cf947a44ab38e88d3ea8419131d8ef1235f5838f';
    for (const check of Object.values(profile.checks)) check.targetSha256 = existingHostHash(profile);
    await savePrivate(f.config, profile);
    const before = await readFile(f.config, 'utf8');
    const result = await runHtmlpub(['delete', 'report.html', '--config', f.config, '--confirm', 'report.html',
      '--revision', 'r1', '--sha256', beforeSha], { ui: quiet(), publisherTransport: p.transport,
      ...(browser ? { publisher: async options => {
        assert.equal(options.browser, true); return { verified: true, transactionId: tx };
      } } : {}) });
    assert.equal(result.verified, true); assert.equal(await readFile(f.config, 'utf8'), before);
  }
});
test('existing-host config refuses stale, changed-target or wrong-runtime mutation before credentials', async t => {
  for (const kind of ['stale', 'target', 'runtime']) {
    const f = await fixture(t), p = protocol(), profile = await existingProfile();
    if (kind === 'stale') profile.checks.publication.checkedAt = new Date(Date.now() - 25 * 3600000).toISOString();
    if (kind === 'target') profile.checks.inventory.targetSha256 = '0'.repeat(64);
    if (kind === 'runtime') {
      profile.runtime.files.find(item => item.name === 'auth.mjs').sha256 = '0'.repeat(64);
      for (const check of Object.values(profile.checks)) check.targetSha256 = existingHostHash(profile);
    }
    await savePrivate(f.config, profile);
    await assert.rejects(runHtmlpub(['delete', 'report.html', '--config', f.config, '--confirm', 'report.html',
      '--revision', 'r1', '--sha256', beforeSha], { ui: quiet(), publisherTransport: p.transport }),
    /stale|target-bound|runtime differs/);
    assert.equal(p.counters.tokens, 0); assert.equal(p.calls.length, 0);
  }
});
test('explicit browser profile accepts only the known browser-compatible runtime and honest unknown application metadata', async t => {
  const f = await fixture(t), profile = await existingProfile({ browser: true, legacyAuth: true, unknownApplication: true });
  await savePrivate(f.config, profile);
  const calls = [];
  const publisher = async options => {
    calls.push(options); assert.equal(options.browser, true);
    return options.action === 'inventory' ? inventory() : { verified: true, transactionId: tx };
  };
  const args = ['delete', 'report.html', '--config', f.config, '--confirm', 'report.html', '--revision', 'r1', '--sha256', beforeSha];
  assert.equal((await runHtmlpub(args, { ui: quiet(), publisher })).verified, true);
  assert.equal(calls.length, 1);
  assert.equal((await readPrivate(f.config + '.publish.json')).target.transport, 'browser');
  assert.equal((await readPrivate(f.config)).resources.application.id, null);
  for (const kind of ['bearer', 'unknown-auth', 'unknown-server']) {
    const changed = structuredClone(profile);
    if (kind === 'bearer') changed.publisher.transport = 'bearer';
    else changed.runtime.files.find(file => file.name === (kind === 'unknown-auth' ? 'auth.mjs' : 'server.mjs')).sha256 = '0'.repeat(64);
    for (const check of Object.values(changed.checks)) check.targetSha256 = existingHostHash(changed);
    await savePrivate(f.config, changed, await readPrivate(f.config));
    await assert.rejects(runHtmlpub(args, { ui: quiet(), publisher }), /runtime differs/);
  }
  assert.equal(calls.length, 1, 'Browser evidence cannot approve bearer or an unknown runtime');
});
test('browser flags survive facade parsing, review and journal-only recovery without a bearer fallback', async t => {
  assert.equal(parsePublic(['list', '--browser']).browser, true);
  assert.throws(() => parsePublic(['setup', '--browser']), /Unknown/);
  const f = await fixture(t), calls = [];
  const publisher = async options => {
    calls.push(options); assert.equal(options.browser, true);
    assert.equal(options['browser-runtime'], f.directory);
    return options.action === 'inventory' ? inventory() : { verified: true, transactionId: tx };
  };
  await runHtmlpub(['delete', 'report.html', ...target, '--browser', '--browser-runtime', f.directory,
    '--journal', f.journal, '--confirm', 'report.html', '--revision', 'r1', '--sha256', beforeSha],
  { ui: quiet(), publisher });
  const journal = await readPrivate(f.journal);
  await savePrivate(f.journal, { ...journal, status: 'uncertain' }, journal);
  const recovered = await runHtmlpub(['recover', '--journal', f.journal, '--browser-runtime', f.directory],
    { ui: scripted(prompt => prompt.includes('INSPECT') ? 'INSPECT PUBLISHING' : 'ACCEPT OBSERVED report.html'), publisher });
  assert.equal(recovered.originalOutcome, 'not-proven');
  assert.equal(calls.length, 2); assert.equal(calls[1].action, 'inventory');
});
test('a configured transport change after review prevents the write before signing in', async t => {
  const f = await fixture(t), profile = await existingProfile({ browser: true }), calls = [];
  await savePrivate(f.config, profile);
  const ui = scripted(async prompt => {
    if (prompt.includes('DELETE')) {
      const changed = structuredClone(profile);
      changed.publisher.transport = 'bearer';
      for (const check of Object.values(changed.checks)) check.targetSha256 = existingHostHash(changed);
      await savePrivate(f.config, changed, profile);
      return 'DELETE report.html';
    }
    return '';
  });
  await assert.rejects(runHtmlpub(['delete', 'report.html', '--config', f.config], {
    ui, publisher: async options => { calls.push(options); return inventory(); },
  }), /transport changed/);
  assert.equal(calls.length, 1); assert.equal(calls[0].browser, true);
});
test('complete headless publish/replace/delete/restore dispatch through the existing verified client', async t => {
  for (const action of ['publish', 'replace', 'delete', 'restore']) {
    const f = await fixture(t), p = protocol(), ui = quiet();
    const args = [action, ...(['publish', 'replace'].includes(action) ? [action === 'publish' ? f.fresh : f.file] :
      action === 'delete' ? ['report.html'] : []), ...target, '--journal', f.journal, '--confirm', action === 'publish' ? 'new.html' : 'report.html'];
    if (action !== 'publish') args.push('--revision', 'r1', '--sha256', beforeSha);
    if (action === 'restore') args.push('--name', 'report.html', '--backup-id', backupId, '--backup-sha256', backupSha);
    const result = await runHtmlpub(args, { ui, publisherTransport: p.transport });
    assert.equal(result.action, action === 'publish' ? 'upload' : action);
    const mutations = p.calls.filter(call => call.url.endsWith('/mutate'));
    assert.equal(mutations.length, 1);
    const body = JSON.parse(mutations[0].options.body);
    assert.equal(body.confirmation, action === 'publish' ? 'new.html' : 'report.html');
    assert.equal(body.expectedRevision, action === 'publish' ? 'new-r1' : 'r1');
    assert.equal((await readPrivate(f.journal)).status, 'verified');
  }
});
test('guided replace/delete confirm the displayed exact version without hash/JSON copying', async t => {
  for (const action of ['replace', 'delete']) {
    const f = await fixture(t), p = protocol();
    const ui = scripted(prompt => prompt.startsWith('Type ') ? `${action.toUpperCase()} report.html` : '');
    const result = await runHtmlpub([action, action === 'replace' ? f.file : 'report.html', ...target, '--journal', f.journal],
      { ui, publisherTransport: p.transport });
    assert.equal(result.action, action); assert.equal(p.counters.tokens, 2, 'review and mutation are separate explicit client invocations');
    assert.match(ui.transcript.join('\n'), /Current revision: r1; SHA: 111/);
    assert.ok(!ui.transcript.some(line => line.startsWith('Type ') && line.includes(beforeSha)));
    assert.equal(JSON.parse(p.calls.find(call => call.url.endsWith('/mutate')).options.body).expectedRevision, 'r1');
  }
});
test('restore chooses an actual backup, binds missing destination and refuses an empty list', async t => {
  const f = await fixture(t), p = protocol(inventory({ missing: true }));
  const ui = scripted(prompt => prompt === 'Select number' ? '1' : 'RESTORE report.html');
  const result = await runHtmlpub(['restore', ...target, '--journal', f.journal], { ui, publisherTransport: p.transport });
  assert.equal(result.sha256, backupSha);
  const body = JSON.parse(p.calls.find(call => call.url.endsWith('/mutate')).options.body);
  assert.equal(body.expectedRevision, 'deleted-r1'); assert.equal(body.expectedSha256, null);
  assert.equal(body.backupId, backupId); assert.equal(body.backupSha256, backupSha);
  const empty = protocol(inventory({ backups: false }));
  await assert.rejects(runHtmlpub(['restore', ...target, '--journal', path.join(f.directory, 'empty.json')],
    { ui: scripted(), publisherTransport: empty.transport }), /No choices available/);
  assert.equal(empty.calls.filter(call => call.url.endsWith('/mutate')).length, 0);
});
test('declined confirmation and stale server version never mutate/retry or claim deletion', async t => {
  const f = await fixture(t), decline = protocol();
  const canceled = await runHtmlpub(['delete', 'report.html', ...target, '--journal', f.journal],
    { ui: scripted(() => 'DELETE Report.html'), publisherTransport: decline.transport });
  assert.equal(canceled.status, 'saved'); assert.equal(decline.counters.tokens, 1);
  assert.equal(decline.calls.filter(call => call.url.endsWith('/mutate')).length, 0);
  const stale = protocol(inventory(), { conflict: true });
  await assert.rejects(runHtmlpub(['delete', 'report.html', ...target, '--journal', f.journal, '--confirm', 'report.html',
    '--revision', 'r1', '--sha256', beforeSha], { ui: quiet(), publisherTransport: stale.transport }),
  error => error.code === 'version-conflict' && error.outcome === 'denied');
  assert.equal(stale.counters.tokens, 1); assert.equal((await readPrivate(f.journal)).status, 'denied');
});
test('bearer 403 on each public operation never retries or exposes secrets in state/errors', async t => {
  for (const action of ['list', 'publish', 'replace', 'delete', 'restore']) {
    const f = await fixture(t), p = protocol(inventory(), { bearer403: true }), ui = quiet();
    const args = [action, ...(['publish', 'replace'].includes(action) ? [f.file] : action === 'delete' ? ['report.html'] : []), ...target];
    if (action !== 'list') args.push('--journal', f.journal, '--confirm', 'report.html');
    if (['replace', 'delete', 'restore'].includes(action)) args.push('--revision', 'r1', '--sha256', beforeSha);
    if (action === 'restore') args.push('--name', 'report.html', '--backup-id', backupId, '--backup-sha256', backupSha);
    await assert.rejects(runHtmlpub(args, { ui, publisherTransport: p.transport }), error => {
      assert.equal(error.outcome, 'denied');
      assert.ok(!error.message.includes('synthetic.')); return true;
    });
    assert.equal(p.counters.tokens, 1); assert.equal(p.calls.length, 1);
    assert.ok(!JSON.stringify(await optionalPrivate(f.journal)).includes('synthetic.'));
  }
});
test('unknown publishing result fences new writes and recover reads once without replay', async t => {
  const f = await fixture(t), p = protocol(inventory(), { unknown: true });
  const args = ['delete', 'report.html', ...target, '--journal', f.journal, '--confirm', 'report.html', '--revision', 'r1', '--sha256', beforeSha];
  await assert.rejects(runHtmlpub(args, { ui: quiet(), publisherTransport: p.transport }), /uncertain/);
  await assert.rejects(runHtmlpub(args, { ui: quiet(), publisherTransport: p.transport }), /Previous publishing outcome/);
  assert.equal(p.counters.tokens, 1);
  const recovery = protocol(inventory({ missing: true }));
  const result = await runHtmlpub(['recover', '--journal', f.journal], {
    ui: scripted(prompt => prompt.includes('INSPECT') ? 'INSPECT PUBLISHING' : 'ACCEPT OBSERVED report.html'),
    publisherTransport: recovery.transport });
  assert.equal(result.originalOutcome, 'not-proven'); assert.equal(recovery.calls.length, 1);
  assert.ok(recovery.calls.every(call => !call.url.endsWith('/mutate')));
});
test('bad target, incomplete automation, JSON, Windows and redirected terminal fail before credentials/prompts', async t => {
  const f = await fixture(t), p = protocol();
  for (const args of [
    ['delete', 'report.html', ...target, '--journal', f.journal],
    ['list', ...target, '--config', f.config],
    ['list', ...target, '--origin', origin],
    ['list', '--origin', `${origin}/path`, '--tenant', tenant, '--api-client', client],
    ['list', '--origin', origin, '--tenant', tenant],
    ['setup', '--json', '--config', f.config],
  ]) await assert.rejects(runHtmlpub(args, { ui: quiet(), publisherTransport: p.transport }));
  for (const action of ['list', 'publish', 'replace', 'delete', 'restore']) {
    const args = [action, ...(['publish', 'replace'].includes(action) ? [f.file] : action === 'delete' ? ['report.html'] : []), ...target];
    await assert.rejects(runHtmlpub(args, { ui: quiet(), platform: 'win32', publisherTransport: p.transport }), /POSIX/);
  }
  assert.equal(p.counters.tokens, 0);
  const input = Readable.from([]), output = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const ui = terminal({ input, output });
  await assert.rejects(ui.ask('Must not hang'), /redirected/); ui.close();
});
test('new guided setup saves logging by default with exact disclosures and no engine/cloud mutation', async t => {
  const f = await fixture(t), metadata = catalog(), ui = scripted(selectReviewSave);
  const result = await runHtmlpub(['setup', '--config', f.config], {
    ui, setupDependencies: { catalog: metadata, engine: () => { throw new Error('Unexpected apply/discovery'); } } });
  assert.equal(result.status, 'saved');
  const draft = await readPrivate(`${f.config}.guided.json`);
  assert.equal(draft.prefix, 'alex-html-publishing'); assert.equal(draft.answers.diagnostics.mode, 'enabled');
  assert.equal(draft.answers.diagnostics.retentionDays, 30); assert.equal(draft.answers.managerObjectIds[0], manager);
  const text = ui.transcript.join('\n');
  assert.match(text, /sensitive authentication data about other users/); assert.match(text, /Other people may have access/);
  assert.match(text, /restart/); assert.match(text, /73\/month/); assert.match(text, /not a hard spend cap/);
  assert.equal(await optionalPrivate(f.config), null);
});
test('guided group-only setup saves exact grants, not names or a static manager user list', async t => {
  const f = await fixture(t), ui = scripted();
  ui.select = async (prompt, items, selected = 0) => {
    if (prompt === 'Manager security groups') return true;
    if (prompt === 'What next?') return 'save';
    return items[selected].value;
  };
  ui.multiselect = async (prompt, items) => prompt.startsWith('Choose managers') ? ['none'] : [items[0].value];
  const result = await runHtmlpub(['setup', '--config', f.config], { ui, setupDependencies: {
    catalog: catalog(), engine: () => assert.fail('No setup writes in a saved draft'),
  } });
  assert.equal(result.status, 'saved');
  const draft = await readPrivate(`${f.config}.guided.json`);
  assert.deepEqual(draft.answers.managerObjectIds, []);
  assert.deepEqual(draft.answers.managerGroupIds, [guid(12)]);
  assert.equal(await optionalPrivate(f.config), null);
});
test('manager-group catalog excludes unsupported and malformed group types without accepting mail strings', async () => {
  const valid = [false, true].map((mailEnabled, i) => ({ id: guid(12 + i), displayName: 'Synthetic group', securityEnabled: true, mailEnabled }));
  const metadata = new SetupCatalog({ azure: { graph: async (collection, options) => {
    assert.equal(collection, 'groups'); assert.match(options.query, /securityEnabled,mailEnabled/);
    return { value: [...valid, { id: guid(14), securityEnabled: false, mailEnabled: true },
      { id: guid(15), securityEnabled: 'true', mailEnabled: false }, { id: guid(16), securityEnabled: true }] };
  } } });
  assert.deepEqual(await metadata.resources('managerGroups', request()), valid);
  assert.throws(() => validateRequest({ ...request(), managerGroupIds: ['team@example.invalid'] }), /GUID/);
});
test('interrupt/resume persists selected subscription and prefix; missing alias prompts, never fabricates', async t => {
  const f = await fixture(t), metadata = catalog({ alias: null });
  const engine = () => { throw new Error('Offline test forbids setup engine dispatch'); };
  const first = scripted((prompt, fallback) => prompt.startsWith('Resource prefix') ? ':save' : fallback);
  await runHtmlpub(['--setup', '--config', f.config], { ui: first, setupDependencies: { catalog: metadata, engine } });
  assert.equal((await readPrivate(`${f.config}.guided.json`)).answers.subscriptionId, subscription);
  const resumed = scripted((prompt, fallback, transcript) => prompt.startsWith('Resource prefix') ? 'chosen-html-publishing' :
    selectReviewSave(prompt, fallback, transcript));
  const result = await runHtmlpub(['setup', '--config', f.config], { ui: resumed, setupDependencies: { catalog: metadata, engine } });
  assert.equal(result.status, 'saved');
  assert.equal((await readPrivate(`${f.config}.guided.json`)).prefix, 'chosen-html-publishing');
  assert.match(resumed.transcript.join('\n'), /No usable signed-in user alias/);
});
test('explicit entered prefixes are kept verbatim or rejected, never shortened into a success', async t => {
  for (const prefix of ['my-explicit-html-publisher', 'a'.repeat(41)]) {
    const f = await fixture(t), metadata = catalog({ alias: `${'a'.repeat(30)}@example.invalid` });
    const ui = scripted((prompt, fallback) => prompt.startsWith('Resource prefix') ? prefix :
      prompt === 'Select number' && ui.transcript.includes('Publisher resources') ? ':save' : fallback);
    const pending = runHtmlpub(['setup', '--config', f.config], { ui, setupDependencies: {
      catalog: metadata, engine: () => { throw new Error('Offline test forbids engine dispatch'); } } });
    if (prefix.length > 40) {
      await assert.rejects(pending, /Use 2-40/);
      assert.equal((await readPrivate(`${f.config}.guided.json`)).prefix, null);
    } else {
      assert.equal((await pending).status, 'saved');
      assert.equal((await readPrivate(`${f.config}.guided.json`)).prefix, prefix);
    }
  }
});
test('existing inventory with logging off and failed acceptance resumes without probe or settings changes', async t => {
  const f = await fixture(t);
  await withInventory(f.config, request(), async (value, save) => {
    value.runtime = { verifiedAt: new Date().toISOString() };
    value.operation = { stage: 'acceptance', kind: 'acceptance', details: { kind: 'acceptance' }, status: 'denied',
      startedAt: new Date().toISOString(), previewSha256: 'a'.repeat(64) };
    value.gates['native-manager-obo'].status = 'failed'; await save();
  });
  const calls = [];
  const engine = async args => { calls.push(args); return { operation: { kind: 'none', reason: 'Existing metadata' } }; };
  const result = await runHtmlpub(['setup', '--config', f.config], { ui: scripted(), setupDependencies: { engine } });
  assert.equal(result.status, 'blocked');
  assert.equal((await readPrivate(f.config)).request.diagnostics.mode, 'off');
  assert.ok(!calls.some(call => call.stage === 'acceptance' || call.action === 'apply'));
});
test('wizard uses generated engine preview digest internally; save before apply never runs an operation', async t => {
  const f = await fixture(t), calls = [], metadata = catalog();
  const engine = async args => {
    calls.push(args);
    if (args.action === 'plan') return { stage: args.stage, operation: args.stage === 'resources' ? { kind: 'none', reason: 'observed' } : { kind: 'identity', exactTarget: subscription },
      sha256: 'a'.repeat(64), effects: 'Scoped test operation, not a live call' };
    assert.equal(args.approve, 'a'.repeat(64));
    return { status: 'stage-verified' };
  };
  const ui = scripted((prompt, fallback) => prompt.startsWith('Type APPLY identity') ? ':save' : fallback);
  const result = await runHtmlpub(['setup', '--config', f.config], { ui, setupDependencies: { catalog: metadata, engine } });
  assert.equal(result.status, 'saved'); assert.equal(calls.filter(call => call.action === 'apply').length, 0);
  assert.equal((await readPrivate(f.config)).request.diagnostics.mode, 'enabled');
});
test('denied metadata is a blocker with a saved draft, never absence or fallback', async t => {
  const f = await fixture(t);
  await assert.rejects(runHtmlpub(['setup', '--config', f.config], { ui: scripted(), setupDependencies: {
    catalog: catalog({ denied: true }), engine: () => { throw new Error('Offline test forbids engine dispatch'); } } }), /access denied/);
  assert.ok(await optionalPrivate(`${f.config}.guided.json`)); assert.equal(await optionalPrivate(f.config), null);
});
test('structured setup automation goes through the original parser and local status engine without prompts', async t => {
  const f = await fixture(t);
  await withInventory(f.config, request(), async () => {});
  const result = await runHtmlpub(['setup', 'status', '--config', f.config, '--json'], { ui: quiet() });
  assert.equal(result.liveAcceptance, 'pending');
  assert.throws(() => parsePublic(['setup', 'apply', '--config', f.config, '--stage', 'arbitrary', '--approve', 'a'.repeat(64)]), /finite stage/);
});
test('fixed catalog uses selected scope, paged identities and bounded optional price quotes', async () => {
  const calls = [];
  const azure = { request: {}, cli: async args => { calls.push(args); return []; }, scope: async () => {},
    graph: async (_collection, args) => { calls.push(args); return { value: [], '@odata.nextLink': 'untrusted-url' }; } };
  const metadata = new SetupCatalog({ azure, fetchImpl: async url => {
    assert.equal(url.origin, 'https://prices.azure.com');
    return Response.json({ Items: [{ armRegionName: 'eastus', armSkuName: 'B1', productName: 'App Service Linux',
      unitOfMeasure: '1 Hour', currencyCode: 'USD', type: 'Consumption', retailPrice: 0.1 }] });
  } });
  await metadata.select({ id: subscription, tenantId: tenant }); await metadata.resources('users', request());
  await metadata.resources('site', request());
  assert.equal((await metadata.estimate(request())).monthlyUsd, 73);
  assert.ok(calls.some(args => Array.isArray(args) && args.includes(subscription)));
  assert.ok(calls.some(args => args.query?.includes('$top=50')));
});
test('reviewed local content cannot change before real publisher credential acquisition', async t => {
  const f = await fixture(t), p = protocol();
  const ui = scripted(async prompt => {
    if (prompt.startsWith('Type ')) { await writeFile(f.file, '<!doctype html><html>Changed</html>', { mode: 0o600 }); return 'REPLACE report.html'; }
    return '';
  });
  await assert.rejects(runHtmlpub(['replace', f.file, ...target, '--journal', f.journal], { ui, publisherTransport: p.transport }), /changed after review/);
  assert.equal(p.counters.tokens, 1, 'only the separate review acquired a token; changed mutation did not');
  assert.equal(p.calls.filter(call => call.url.endsWith('/mutate')).length, 0);
  assert.equal((await readPrivate(f.journal)).status, 'not-sent');
});
test('malformed inventory cannot become a successful public list response', async () => {
  const p = protocol({ pages: [], missingVersions: {} });
  await assert.rejects(runHtmlpub(['list', ...target], { ui: quiet(), publisherTransport: p.transport }), /inventory shape is invalid/);
  assert.equal(p.calls.length, 1);
});
test('guided Change Settings can disable new logging before any operation, then save the changed draft', async t => {
  const f = await fixture(t);
  let reviewCount = 0;
  const ui = scripted((prompt, fallback, transcript) => {
    if (prompt !== 'Select number') return fallback ?? '';
    const menu = [...transcript].reverse().find(line => ['What next?', 'Change a setting', 'Logging'].includes(line));
    if (menu === 'What next?') return ++reviewCount === 1 ? '2' : '3';
    if (menu === 'Change a setting') return '11';
    if (menu === 'Logging') return '2';
    return fallback;
  });
  const result = await runHtmlpub(['setup', '--config', f.config], { ui, setupDependencies: {
    catalog: catalog(), engine: () => { throw new Error('Offline test forbids engine dispatch'); } } });
  assert.equal(result.status, 'saved');
  assert.deepEqual((await readPrivate(`${f.config}.guided.json`)).answers.diagnostics, { mode: 'off' });
  assert.equal(await optionalPrivate(f.config), null);
});
