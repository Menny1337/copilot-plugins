import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setup, parseArgs } from './setup-html.mjs';
import { Azure, GRAPH_APP_ID, launcher, runtimeManifest, RUNTIME_FILES } from './onboarding/azure.mjs';
import { armId, initialInventory, hash, validateRequest, validateInventory, readPrivate, withInventory, targetHash, publisherTarget,
  protect, WINDOWS_ACL, GATES } from './onboarding/state.mjs';
import { recordEvidence, applyStage } from './onboarding/stages.mjs';
import { startHost, prepareStorage } from './hosted-manager/start-host.mjs';
import { runHtmlpub } from './htmlpub.mjs';
import { savePrivate, SavedExit } from './htmlpub-terminal.mjs';

const guid = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const tenant = guid(1), subscription = guid(2), manager = guid(3), client = guid(4);
const request = () => ({ version: 1, cloud: 'AzureCloud', tenantId: tenant, subscriptionId: subscription,
  location: 'eastus', resourceGroup: { mode: 'create', name: 'fixture-group' }, plan: { mode: 'create', name: 'fixture-plan', sku: 'B1' },
  identity: { mode: 'create', name: 'fixture-identity' }, application: { mode: 'create', name: 'fixture-app' },
  site: { mode: 'create', name: 'fixture-site' }, readerGroups: [{ mode: 'create', name: 'fixture-readers' }],
  managerObjectIds: [manager], allowedClientIds: [client], diagnostics: { mode: 'off' } });
const clone = value => JSON.parse(JSON.stringify(value));
class Cloud {
  constructor(r) {
    this.request = r; this.arm = new Map(); this.collections = { applications: [], groups: [], servicePrincipals: [
      { id: guid(80), appId: GRAPH_APP_ID, accountEnabled: true, displayName: 'Microsoft Graph',
        oauth2PermissionScopes: [{ id: guid(81), value: 'User.Read', isEnabled: true }] },
      { id: guid(82), appId: client, accountEnabled: true, displayName: 'Approved delegated client' }],
    users: [{ id: manager }], oauth2PermissionGrants: [] };
    this.fics = []; this.settings = {}; this.calls = []; this.serial = 100; this.deployed = new Map(); this.routing = [];
    this.azure = new Azure(r, { run: this.run.bind(this), resolveLauncher: async () => ({ command: 'mock-az', prefix: [] }),
      fetchImpl: this.fetch.bind(this) });
  }
  writes() { return this.calls.filter(call => call.write); }
  async run(command, args) {
    assert.equal(command, 'mock-az');
    if (args.includes('--help')) return { stdout: 'supported' };
    const option = name => args[args.indexOf(name) + 1];
    if (args[0] === 'account' && args[1] === 'show') {
      this.calls.push({ kind: 'scope', write: false });
      return { stdout: JSON.stringify({ id: subscription, tenantId: tenant, state: 'Enabled', environmentName: 'AzureCloud', name: 'Synthetic subscription' }) };
    }
    if (args[0] === 'account' && args[1] === 'get-access-token') return { stdout: JSON.stringify('synthetic.arm.token') };
    if (args.slice(0, 4).join(' ') === 'webapp config appsettings list') return { stdout: JSON.stringify(Object.entries(this.settings).map(([name, value]) => ({ name, value, slotSetting: true }))) };
    if (args.slice(0, 4).join(' ') === 'webapp config appsettings set') {
      this.calls.push({ kind: 'settings', write: true, args: clone(args) });
      const end = args.indexOf('--output');
      for (const pair of args.slice(args.indexOf('--slot-settings') + 1, end).filter(arg => !arg.startsWith('--'))) {
        const index = pair.indexOf('='); if (index > 0) this.settings[pair.slice(0, index)] = pair.slice(index + 1);
      }
      return { stdout: '' };
    }
    if (args.slice(0, 2).join(' ') === 'webapp deploy') {
      assert.equal(option('--clean'), 'false'); assert.equal(option('--restart'), 'false');
      this.calls.push({ kind: 'deploy', write: true, args: clone(args) });
      this.deployed.set(option('--target-path'), await readFile(option('--src-path')));
      if (this.failDeploy) throw Object.assign(new Error('synthetic-private-provider-body'), { stderr: '(Forbidden) synthetic-private-provider-body' });
      return { stdout: JSON.stringify({ status: 4, complete: true }) };
    }
    assert.equal(args[0], 'rest', 'Unexpected process operation');
    const url = new URL(option('--url')), method = option('--method'), write = method !== 'GET';
    const body = args.includes('--body') ? JSON.parse(option('--body')) : null;
    this.calls.push({ kind: url.hostname, path: url.pathname, method, write, body: clone(body) });
    let result;
    if (url.hostname === 'graph.microsoft.com') result = this.graph(url, method, body);
    else {
      assert.equal(url.hostname, 'management.azure.com');
      assert.equal(option('--subscription'), subscription);
      result = this.resource(url.pathname, method, body);
    }
    if (this.throwAfterWrite && write) { this.throwAfterWrite = false; throw Object.assign(new Error('private-error'), { stderr: '(Forbidden) private-error' }); }
    return { stdout: result === undefined ? '' : JSON.stringify(result) };
  }
  notFound() { throw Object.assign(new Error('private details'), { stderr: '(ResourceNotFound) private details' }); }
  resource(id, method, body) {
    if (this.failRestore && method === 'PATCH' && body?.properties?.scmIpSecurityRestrictions?.every(rule => rule.action === 'Deny')) {
      throw Object.assign(new Error('private restore failure'), { stderr: '(Forbidden) private restore failure' });
    }
    if (id.includes('/providers/Microsoft.Insights/')) {
      if (id.endsWith('diagnosticSettingsCategories')) return { value: [{ name: 'AppServiceAuthenticationLogs', properties: { categoryType: 'Logs' } }] };
      if (id.endsWith('diagnosticSettings')) return { value: clone(this.routing) };
      if (method === 'PUT') { const value = { id, name: id.split('/').at(-1), ...body }; this.routing.push(value); return value; }
      return this.notFound();
    }
    if (method === 'GET') return this.arm.has(id) ? clone(this.arm.get(id)) : this.notFound();
    if (method === 'PUT' || method === 'PATCH') {
      const old = this.arm.get(id);
      const value = old ? { ...old, ...body, properties: { ...old.properties, ...body.properties } } :
        { id, name: id.split('/').at(-1), type: id.includes('/providers/') ? id.split('/providers/')[1].split('/').slice(0, 2).join('/') : 'Microsoft.Resources/resourceGroups',
          ...body, properties: { ...body.properties, provisioningState: 'Succeeded' } };
      if (id.endsWith('/userAssignedIdentities/fixture-identity')) value.properties = { ...value.properties, clientId: guid(40), principalId: guid(41), tenantId: tenant };
      if (id.endsWith('/sites/fixture-site') && !old) {
        value.properties.defaultHostName = 'fixture-site.azurewebsites.net';
        this.arm.set(id + '/config/web', { properties: { ...body.properties.siteConfig, appCommandLine: '', azureStorageAccounts: {} } });
        this.arm.set(id + '/config/authsettingsV2', { properties: {} });
        this.arm.set(id + '/basicPublishingCredentialsPolicies/scm', { properties: { allow: true } });
      }
      if (id.includes('/workspaces/')) value.properties = { ...value.properties, customerId: guid(42) };
      this.arm.set(id, clone(value)); return clone(value);
    }
    throw new Error('Unsupported mock ARM method.');
  }
  graph(url, method, body) {
    const [, collection, id, child] = url.pathname.split('/').slice(1);
    if (this.denyGraph) throw Object.assign(new Error('private Graph details'), { stderr: '(Authorization_RequestDenied) private Graph details' });
    if (child === 'federatedIdentityCredentials') {
      if (method === 'GET') return { value: this.hideFic ? [] : clone(this.fics) };
      const value = { id: guid(this.serial++), ...body }; this.fics.push(value); return clone(value);
    }
    const values = this.collections[collection];
    assert.ok(values, `Unexpected directory collection ${collection}`);
    if (method === 'GET') {
      if (id) return clone(values.find(item => item.id === id) ?? this.notFound());
      const filter = url.searchParams.get('$filter');
      const match = filter?.match(/^(displayName|appId|clientId) eq '([^']+)'$/);
      return { value: clone(match ? values.filter(item => item[match[1]] === match[2]) : values) };
    }
    if (method === 'POST') {
      const value = { id: guid(this.serial++), ...body };
      if (collection === 'applications') value.appId = guid(this.serial++);
      if (collection === 'servicePrincipals') { value.accountEnabled = true; value.displayName = 'Selected app service principal'; }
      if (collection === 'oauth2PermissionGrants') value.id = `opaque_grant_${this.serial++}`;
      values.push(value); return clone(value);
    }
    assert.equal(method, 'PATCH');
    const index = values.findIndex(item => item.id === id); assert.ok(index >= 0);
    values[index] = { ...values[index], ...body }; return null;
  }
  async fetch(url, options) {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer synthetic.arm.token');
    const u = new URL(url); assert.equal(u.hostname, 'fixture-site.scm.azurewebsites.net');
    const bytes = this.deployed.get('/home/' + u.pathname.slice('/api/vfs/'.length));
    return new Response(bytes ?? '', { status: bytes ? 200 : 404 });
  }
}
async function fixture(t, changes = {}) {
  if (!process.env.PUBLISH_HTML_TEST_ARTIFACT_DIR) throw new Error('Set PUBLISH_HTML_TEST_ARTIFACT_DIR outside checkout.');
  const root = await mkdtemp(path.join(await realpath(process.env.PUBLISH_HTML_TEST_ARTIFACT_DIR), 'onboarding-'));
  await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const r = { ...request(), ...changes }, cloud = new Cloud(r);
  const requestPath = path.join(root, 'request.json'), config = path.join(root, 'resources.json');
  await writeFile(requestPath, JSON.stringify(r), { mode: 0o600 });
  const deps = { azureFactory: () => cloud.azure };
  const call = (action, stage = 'resources', extra = {}) => setup({ action, stage, config, ...(action === 'plan' ? { request: requestPath } : {}), ...extra }, deps);
  const stage = async selected => { const preview = await call('plan', selected); return call('apply', selected, { approve: preview.sha256 }); };
  const provision = async () => {
    for (let count = 0; count < 10; count++) { const preview = await call('plan'); if (preview.operation.kind === 'none') return; await call('apply', 'resources', { approve: preview.sha256 }); }
    throw new Error('Resource loop did not finish.');
  };
  return { root, r, cloud, config, requestPath, deps, call, stage, provision, read: () => readPrivate(config) };
}
test('setup rejects open-ended stages, arbitrary cloud/URLs, unknown fields and incomplete selections', () => {
  for (const args of [['apply', '--stage', 'shell', '--approve', 'a'.repeat(64)], ['plan', '--url', 'https://evil.test'], ['apply']]) assert.throws(() => parseArgs(args));
  assert.equal(parseArgs(['plan']).stage, 'resources');
  for (const change of [{ cloud: 'OtherCloud' }, { token: 'secret' }, { diagnostics: { mode: 'on' } },
    { site: { mode: 'reuse', name: 'fixture-site', id: 'https://evil.test' } }]) assert.throws(() => validateRequest({ ...request(), ...change }));
});
test('create-all: inventory exists before cloud work; plan never writes, apply creates only its reviewed resource', async t => {
  const f = await fixture(t);
  const originalScope = f.cloud.azure.scope.bind(f.cloud.azure);
  f.cloud.azure.scope = async () => { const inventory = await f.read(); assert.equal(inventory.resources.resourceGroup.observed, null); return originalScope(); };
  const preview = await f.call('plan');
  assert.equal(f.cloud.writes().length, 0);
  assert.equal(preview.operation.role, 'resourceGroup');
  f.cloud.azure.scope = originalScope;
  await assert.rejects(f.call('apply', 'resources', { approve: 'a'.repeat(64) }), /fresh exact/);
  assert.equal(f.cloud.writes().length, 0);
  await f.call('apply', 'resources', { approve: preview.sha256 });
  await f.provision();
  const inventory = await f.read();
  assert.ok(Object.values(inventory.resources).every(item => item.status === 'verified'));
  assert.ok(Object.values(inventory.gates).every(item => item.status === 'pending'));
  assert.equal(inventory.resources.identity.observed.clientId, guid(40));
  const site = f.cloud.writes().find(call => call.body?.properties?.serverFarmId);
  assert.equal(site.body.properties.publicNetworkAccess, 'Disabled');
  assert.equal(site.body.properties.siteConfig.scmIpSecurityRestrictionsDefaultAction, 'Deny');
  const count = f.cloud.writes().length;
  assert.equal((await f.stage('resources')).status, 'no-change');
  assert.equal(f.cloud.writes().length, count);
  assert.equal(JSON.stringify(inventory).includes('synthetic.arm.token'), false);
});
test('full setup uses exact delegated consent payloads, attested runtime bytes and remains pending after publisher 403', async t => {
  const f = await fixture(t);
  await f.provision(); await f.stage('identity');
  let inventory = await f.read();
  assert.equal(f.cloud.settings.HTML_MANAGER_MUTATIONS_ENABLED, 'false');
  assert.equal(f.cloud.fics[0].subject, guid(41));
  assert.equal(f.cloud.fics[0].audiences[0], 'api://AzureADTokenExchange');
  await f.stage('consent'); await f.stage('consent');
  const grants = f.cloud.collections.oauth2PermissionGrants;
  assert.equal(grants.length, 2);
  assert.deepEqual(grants.map(grant => grant.scope), ['User.Read', 'publish_as_user']);
  assert.ok(f.cloud.collections.applications[0].requiredResourceAccess[0].resourceAccess.every(item => item.type === 'Scope'));
  await f.stage('deployment');
  inventory = await f.read();
  assert.equal(inventory.runtime.files.length, RUNTIME_FILES.length);
  assert.ok(inventory.runtime.files.some(item => item.name === 'start-host.mjs'));
  assert.equal(inventory.runtime.releaseSha256, hash(inventory.runtime.files));
  assert.equal(inventory.recovery, null);
  const web = f.cloud.arm.get(armId(f.r, 'site', f.r.site.name) + '/config/web').properties;
  assert.ok(web.scmIpSecurityRestrictions.every(rule => rule.action === 'Deny'));
  const preview = await f.call('plan', 'acceptance');
  await assert.rejects(setup({ action: 'apply', config: f.config, stage: 'acceptance', approve: preview.sha256 },
    { ...f.deps, nativeProbe: async () => { throw new Error('403 private token response'); } }), /Publishing acceptance failed/);
  inventory = await f.read();
  assert.equal(inventory.gates['native-manager-obo'].status, 'failed');
  assert.equal(f.cloud.settings.HTML_MANAGER_MUTATIONS_ENABLED, 'false');
  await assert.rejects(f.call('plan', 'activation'), /real publisher check/);
  assert.throws(() => recordEvidence(inventory, { version: 1, targetSha256: targetHash(inventory),
    checks: [{ gate: 'native-manager-obo', result: 'passed', checkedAt: new Date().toISOString(), reference: 'token was issued, ready=true' }] }), /Publisher acceptance/);
  await assert.rejects(publisherTarget(f.config, 'upload'), /acceptance/);
});
test('optional manager groups preserve old inventory bindings and require real GUID grants', () => {
  const old = initialInventory(request()), before = clone(old), target = targetHash(old);
  validateInventory(old);
  assert.deepEqual(old, before); assert.equal(targetHash(old), target);
  assert.equal(Object.hasOwn(old.request, 'managerGroupIds'), false);
  const selected = { ...request(), managerObjectIds: [], managerGroupIds: [guid(90).toUpperCase()] };
  assert.equal(validateRequest(selected).managerGroupIds[0], guid(90));
  assert.notEqual(initialInventory(selected).requestSha256, old.requestSha256);
  for (const managerGroupIds of [null, 'team@example.invalid', ['Team'], ['team@example.invalid'], [manager, manager.toUpperCase()], Array(21).fill(manager)]) {
    assert.throws(() => validateRequest({ ...request(), managerGroupIds }));
  }
  assert.throws(() => validateRequest({ ...request(), managerObjectIds: [], managerGroupIds: [] }));
  assert.throws(() => validateRequest({ ...request(), managerObjectIds: [] }));
});
test('group-only setup verifies existing security groups, keeps delegated grants narrow and does not copy members', async t => {
  const f = await fixture(t, { managerObjectIds: [], managerGroupIds: [guid(90), guid(91)] });
  f.cloud.collections.groups.push(...[false, true].map((mailEnabled, i) => ({
    id: guid(90 + i), displayName: `Synthetic manager security group ${i}`, securityEnabled: true, mailEnabled,
  })));
  await f.provision();
  const preview = await f.call('plan', 'identity');
  assert.equal(preview.operation.settings.HTML_MANAGER_OBJECT_IDS, '');
  assert.equal(preview.operation.settings.HTML_MANAGER_GROUP_IDS, `${guid(90)},${guid(91)}`);
  const refs = (await f.read()).dependencies.managerGroups;
  assert.deepEqual(refs.map(group => group.id), [guid(90), guid(91)]);
  assert.ok(refs.every(group => group.type === 'Microsoft.Graph/groups' && group.securityEnabled === true));
  assert.ok(f.cloud.calls.filter(call => call.path?.endsWith('/' + guid(90))).every(call => !call.write));
  await f.stage('identity'); await f.stage('consent'); await f.stage('consent');
  assert.deepEqual(f.cloud.collections.oauth2PermissionGrants.map(grant => grant.scope), ['User.Read', 'publish_as_user']);
  const inventory = await f.read();
  assert.deepEqual(inventory.dependencies.managers, []);
  assert.ok(Object.values(inventory.gates).every(gate => gate.status === 'pending'));
  assert.equal(inventory.activation.status, 'pending');
  assert.ok(!f.cloud.calls.some(call => /members|transitiveMembers/.test(call.path ?? '')));
});
test('setup rejects unavailable, mismatched and unsupported manager-group metadata before any identity write', async t => {
  const f = await fixture(t, { managerGroupIds: [guid(90)] });
  await f.provision();
  const graph = f.cloud.azure.graph.bind(f.cloud.azure), before = f.cloud.writes().length;
  for (const response of [
    null, {}, { id: guid(91), securityEnabled: true, mailEnabled: false },
    { id: guid(90), securityEnabled: false, mailEnabled: true },
    { id: guid(90), '@odata.type': '#microsoft.graph.user', securityEnabled: true, mailEnabled: false },
    { id: guid(90), securityEnabled: 'true', mailEnabled: false },
    { id: guid(90), securityEnabled: true }, { id: guid(90), securityEnabled: true, mailEnabled: 'false' },
    new Error('Synthetic directory denial'),
  ]) {
    f.cloud.azure.graph = (collection, options = {}) => {
      if (collection === 'groups' && options.id === guid(90)) {
        if (response instanceof Error) throw response;
        return clone(response);
      }
      return graph(collection, options);
    };
    await assert.rejects(f.call('plan', 'identity'), /Manager group|directory denial/);
    assert.equal(f.cloud.writes().length, before);
  }
});
test('legacy frozen requests refuse unselected live manager-group grants instead of silently adopting them', async t => {
  const f = await fixture(t);
  await f.provision(); await f.stage('identity');
  assert.equal(f.cloud.settings.HTML_MANAGER_GROUP_IDS, undefined);
  f.cloud.settings.HTML_MANAGER_GROUP_IDS = guid(90);
  const before = f.cloud.writes().length;
  await assert.rejects(f.call('plan', 'consent'), /manager groups differ/);
  assert.equal(f.cloud.writes().length, before);
});
test('recovery never retries uncertain creation and reconciles only the exact setup marker', async t => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const f = await fixture(t);
    const preview = await f.call('plan'); f.cloud.throwAfterWrite = true;
    await assert.rejects(f.call('apply', 'resources', { approve: preview.sha256 }), /Forbidden/);
    assert.equal((await f.read()).operation.status, 'uncertain');
    await assert.rejects(f.call('plan'), /recovery/);
    const recovery = await f.call('recover');
    const before = f.cloud.writes().length;
    await f.call('recover', 'resources', { approve: recovery.sha256 });
    assert.equal(f.cloud.writes().length, before);
    assert.equal((await f.read()).resources.resourceGroup.createdBySetup, true);
  }
});
test('denied lookup and same-name app are blockers, never absence or implicit adoption', async t => {
  const f = await fixture(t);
  f.cloud.denyGraph = true;
  await assert.rejects(f.call('plan'), /Authorization_RequestDenied/);
  assert.equal(f.cloud.writes().length, 0);
  assert.equal((await f.read()).resources.application.status, 'blocked');
  f.cloud.denyGraph = false;
  f.cloud.collections.applications.push({ id: guid(200), appId: guid(201), displayName: f.r.application.name, signInAudience: 'AzureADMyOrg' });
  await assert.rejects(f.call('plan'), /Name collision/);
  assert.equal(f.cloud.writes().length, 0);
});
test('deployment failure restores closed SCM and retains uncertain release evidence without fallback', async t => {
  const f = await fixture(t);
  await f.provision(); await f.stage('identity');
  f.cloud.failDeploy = true;
  await assert.rejects(f.stage('deployment'), /Forbidden/);
  const inventory = await f.read(), web = f.cloud.arm.get(armId(f.r, 'site', f.r.site.name) + '/config/web').properties;
  assert.equal(inventory.operation.status, 'uncertain');
  assert.equal(inventory.recovery, null);
  assert.ok(web.scmIpSecurityRestrictions.every(rule => rule.action === 'Deny'));
  assert.equal(f.cloud.settings.HTML_MANAGER_MUTATIONS_ENABLED, 'false');
  assert.ok(!JSON.stringify(inventory).includes('synthetic-private-provider-body'));
  f.cloud.failDeploy = false;
  const preview = await f.call('recover');
  const before = f.cloud.calls.filter(call => call.kind === 'deploy').length;
  await f.call('recover', 'deployment', { approve: preview.sha256 });
  assert.equal((await f.read()).operation.status, 'reconciled');
  assert.equal((await f.read()).dependencies.deploymentReconciliation.selected, false);
  assert.equal(f.cloud.calls.filter(call => call.kind === 'deploy').length, before);
  assert.equal((await f.call('plan', 'deployment')).operation.kind, 'deployment');
});
test('diagnostics off makes no cloud calls; workspace-only never reports captured logs', async t => {
  const f = await fixture(t);
  const off = await f.call('plan', 'diagnostics');
  assert.equal(off.operation.kind, 'none'); assert.equal(f.cloud.calls.length, 0);
  const d = await fixture(t, { diagnostics: { mode: 'enabled', workspace: { mode: 'create', name: 'fixture-logs' },
    settingName: 'fixture-routing', retentionDays: 30, dailyQuotaGb: 1 } });
  await d.provision(); await d.stage('identity');
  await d.stage('diagnostics');
  assert.equal((await d.read()).diagnostics.capture, 'unverified');
  await d.stage('diagnostics');
  assert.equal(d.cloud.routing[0].properties.logs[0].category, 'AppServiceAuthenticationLogs');
  assert.equal(d.cloud.settings.WEBSITE_AUTH_AAD_TRACE_LEVEL, 'Information');
  assert.equal((await d.read()).diagnostics.capture, 'unverified');
});
test('private paths, legacy recovery, revision checks and owner evidence fail closed', async t => {
  const f = await fixture(t);
  await f.call('plan');
  await assert.rejects(withInventory(f.config, null, async (inventory, save) => {
    const external = await f.read(); external.revision++;
    await writeFile(f.config, JSON.stringify(external), { mode: 0o600 }); await save();
  }), /concurrently/);
  const linked = path.join(f.root, 'linked.json'); await symlink(f.config, linked);
  await assert.rejects(readPrivate(linked), /regular/);
  const inventory = initialInventory(request());
  assert.throws(() => recordEvidence(inventory, { version: 1, targetSha256: 'a'.repeat(64), checks: [] }), /bind/);
  const legacy = path.join(f.root, 'config.json');
  await writeFile(legacy, '{"version":1,"private":"unchanged"}', { mode: 0o600 });
  await writeFile(legacy + '.recovery.json', '{}', { mode: 0o600 });
  const second = await fixture(t, { legacyConfig: legacy });
  await assert.rejects(second.call('plan'), /Legacy SCM recovery/);
  assert.equal(second.cloud.writes().length, 0);
  assert.equal(await readFile(legacy, 'utf8'), '{"version":1,"private":"unchanged"}');
});
test('Windows launcher never invokes az.cmd/shell and DACL allows only current user, SYSTEM and admins', async () => {
  const seen = [];
  const selected = await launcher({ platform: 'win32', env: { PATH: 'C:\\Azure CLI\\CLI2\\wbin' }, exists: async filename => { seen.push(filename); } });
  assert.equal(selected.command, 'C:\\Azure CLI\\CLI2\\python.exe');
  assert.deepEqual(selected.prefix, ['-IBm', 'azure.cli']);
  let invocation;
  await protect('C:\\Private Data\\resources.json', true, { platform: 'win32', run: async (...args) => { invocation = args; } });
  assert.equal(invocation[0], 'powershell.exe');
  assert.equal(invocation[2].env.HTML_SETUP_ACL_PATH, 'C:\\Private Data\\resources.json');
  assert.ok(WINDOWS_ACL.includes('S-1-5-18')); assert.ok(WINDOWS_ACL.includes('S-1-5-32-544'));
  await assert.rejects(protect('C:\\private', false, { platform: 'win32', run: async () => { throw new Error('private ACL details'); } }), /DACL/);
  assert.ok(seen.every(name => !name.includes('token')));
});
test('startup bootstrap initializes before server creation; invalid paths never touch storage', async () => {
  await assert.rejects(prepareStorage({ contentDir: '/other', stateDir: '/private' }), /approved fixed/);
  const calls = [], server = { on: () => {}, listen: port => calls.push(port) };
  await startHost({ port: 8080 }, { prepare: async () => calls.push('prepare'), create: async () => { calls.push('create'); return server; } });
  assert.deepEqual(calls, ['prepare', 'create', 8080]);
  const manifest = await runtimeManifest(path.join(path.dirname(fileURLToPath(import.meta.url)), 'hosted-manager'));
  assert.ok(manifest.files.some(file => file.name === 'start-host.mjs'));
});
test('real-probe contract plus all target-bound owner evidence is required before separate activation', async t => {
  const f = await fixture(t);
  await f.provision(); await f.stage('identity'); await f.stage('consent'); await f.stage('consent'); await f.stage('deployment');
  const preview = await f.call('plan', 'acceptance');
  await setup({ action: 'apply', config: f.config, stage: 'acceptance', approve: preview.sha256 },
    { ...f.deps, nativeProbe: async options => {
      assert.equal(options.action, 'inventory'); assert.equal(options.origin, 'https://fixture-site.azurewebsites.net');
      return { pages: [], mutationsEnabled: false };
    } });
  await assert.rejects(f.call('plan', 'activation'), /all other fresh/);
  await withInventory(f.config, null, async (inventory, save) => {
    recordEvidence(inventory, { version: 1, targetSha256: targetHash(inventory),
      checks: GATES.filter(gate => gate !== 'native-manager-obo').map(gate => ({ gate, result: 'passed',
        checkedAt: new Date().toISOString(), reference: 'Synthetic offline evidence for test only' })) });
    await save();
  });
  await assert.rejects(publisherTarget(f.config, 'upload'), /activation/);
  await f.stage('activation');
  assert.equal(f.cloud.settings.HTML_MANAGER_MUTATIONS_ENABLED, 'true');
  assert.equal((await publisherTarget(f.config, 'upload')).origin, 'https://fixture-site.azurewebsites.net');
  await withInventory(f.config, null, async (inventory, save) => {
    inventory.gates['native-manager-obo'].source = 'native-probe'; await save();
  });
  await assert.rejects(publisherTarget(f.config, 'upload'), /pending, stale or failed/,
    'Legacy session evidence cannot approve the changed publisher protocol');
  await withInventory(f.config, null, async (inventory, save) => {
    inventory.gates['native-manager-obo'].source = 'publisher-probe';
    inventory.gates['browser-denials'].checkedAt = new Date(Date.now() - 25 * 3600000).toISOString(); await save();
  });
  await assert.rejects(publisherTarget(f.config, 'upload'), /stale/);
});
test('reuse-all and mixed resources preserve existing apps and never infer cleanup ownership', async t => {
  const f = await fixture(t);
  await f.provision(); await f.stage('identity'); await f.stage('deployment');
  const inventory = await f.read(), r = clone(f.r);
  for (const role of ['resourceGroup', 'plan', 'identity', 'application', 'site']) {
    r[role] = { ...r[role], mode: 'reuse', id: inventory.resources[role].observed.id };
  }
  r.readerGroups = r.readerGroups.map((group, i) => ({ ...group, mode: 'reuse', id: inventory.resources[`readerGroup${i}`].observed.id }));
  const second = await fixture(t, r);
  for (const key of ['arm', 'collections', 'settings', 'fics', 'deployed']) second.cloud[key] = f.cloud[key];
  assert.equal((await second.stage('resources')).status, 'no-change');
  const before = second.cloud.writes().length;
  await second.stage('identity');
  assert.equal(second.cloud.writes().length, before);
  await second.stage('deployment');
  assert.equal(second.cloud.calls.filter(call => call.kind === 'deploy').length, 0, 'matching reused release is read back, not overwritten');
  assert.ok(Object.values((await second.read()).resources).every(item => !item.createdBySetup));
  const mixed = clone(r); mixed.readerGroups = [{ mode: 'create', name: 'another-readers' }];
  const third = await fixture(t, mixed);
  for (const key of ['arm', 'collections', 'settings', 'fics']) third.cloud[key] = f.cloud[key];
  const preview = await third.call('plan');
  assert.equal(preview.operation.role, 'readerGroup0');
  await third.call('apply', 'resources', { approve: preview.sha256 });
  assert.equal((await third.read()).resources.site.ownership, 'reused');
  assert.equal((await third.read()).resources.readerGroup0.ownership, 'created');
  second.cloud.fics = [];
  const writes = second.cloud.writes().length;
  await assert.rejects(second.call('plan', 'identity'), /Reused registration must already trust/);
  assert.equal(second.cloud.writes().length, writes, 'reuse cannot create unmanaged federation');
});
test('changed target, expired preview and unsafe metadata cannot execute a saved operation', async t => {
  const f = await fixture(t); await f.provision();
  const preview = await f.call('plan', 'identity');
  f.cloud.arm.get(armId(f.r, 'site', f.r.site.name) + '/config/web').properties.appCommandLine = 'unmanaged command with a secret';
  await assert.rejects(f.call('apply', 'identity', { approve: preview.sha256 }), /drifted/);
  assert.equal((await f.read()).policy.web.appCommandLine, 'unmanaged-startup-not-captured');
  assert.ok(!JSON.stringify(await f.read()).includes('command with a secret'));
  await withInventory(f.config, null, async (inventory, save) => {
    inventory.preview.expiresAt = new Date(Date.now() - 1000).toISOString(); await save();
  });
  await assert.rejects(f.call('apply', 'identity', { approve: (await f.read()).preview.sha256 }), /fresh/);
  await withInventory(f.config, null, async (inventory, save) => {
    inventory.resources.site.desired.name = 'evil.test/path';
    await assert.rejects(save(), /selection differs/);
  });
  f.cloud.settings.HTML_MANAGER_API_CLIENT_ID = 'synthetic.jwt.secret';
  await assert.rejects(f.call('plan', 'identity'), /not captured/);
  assert.ok(!JSON.stringify(await f.read()).includes('synthetic.jwt.secret'));
});
test('failed SCM restoration leaves scoped recovery; recovery closes it without redeploying or restarting', async t => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const f = await fixture(t);
    await f.provision(); await f.stage('identity');
    f.cloud.failDeploy = true; f.cloud.failRestore = true;
    await assert.rejects(f.stage('deployment'), /Forbidden/);
    assert.equal((await f.read()).recovery.kind, 'scm');
    await assert.rejects(f.call('plan', 'diagnostics'), /recovery/);
    f.cloud.failRestore = false;
    const preview = await f.call('recover');
    const deploys = f.cloud.calls.filter(call => call.kind === 'deploy').length;
    await f.call('recover', 'deployment', { approve: preview.sha256 });
    assert.equal(f.cloud.calls.filter(call => call.kind === 'deploy').length, deploys);
    assert.equal((await f.read()).recovery, null);
    assert.equal(f.cloud.settings.HTML_MANAGER_MUTATIONS_ENABLED, 'false');
  }
});
test('default acceptance runs the real bearer publisher; Windows default refuses before token acquisition', async t => {
  const f = await fixture(t);
  await f.provision(); await f.stage('identity'); await f.stage('consent'); await f.stage('consent'); await f.stage('deployment');
  const calls = [], preview = await f.call('plan', 'acceptance');
  await setup({ action: 'apply', config: f.config, stage: 'acceptance', approve: preview.sha256 }, {
    ...f.deps, nativeTransport: {
      tokenProvider: async () => 'synthetic.jwt.assertion',
      fetchImpl: async (url, options) => {
        calls.push(url); assert.equal(options.redirect, 'error');
        assert.ok(url.endsWith('/_manager/api/inventory'));
        assert.equal(options.headers.Authorization, 'Bearer synthetic.jwt.assertion');
        assert.equal(options.headers['X-Manager-Assertion'], undefined);
        assert.equal(options.headers['X-ZUMO-AUTH'], undefined);
        return Response.json({ pages: [], mutationsEnabled: false });
      },
    },
  });
  assert.deepEqual(calls.map(url => new URL(url).pathname), ['/_manager/api/inventory']);
  await withInventory(f.config, null, async (inventory, save) => {
    inventory.runtime.releaseSha256 = '0'.repeat(64); await save();
  });
  await assert.rejects(f.call('plan', 'acceptance'), /runtime differs/,
    'A successful old deployment cannot approve the changed authorization runtime');
  assert.equal(calls.length, 1, 'Runtime mismatch stops before another publisher request');
  await withInventory(f.config, null, async (inventory, save) => {
    const manifest = await runtimeManifest(path.join(path.dirname(fileURLToPath(import.meta.url)), 'hosted-manager'));
    inventory.runtime.releaseSha256 = manifest.releaseSha256; await save();
  });
  const next = await f.call('plan', 'acceptance'), inventory = await f.read();
  const platform = process.platform;
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    await assert.rejects(applyStage(inventory, f.cloud.azure, 'acceptance', next.sha256, async () => {}), /acceptance failed/);
    assert.equal(inventory.gates['native-manager-obo'].status, 'failed');
  } finally { Object.defineProperty(process, 'platform', { value: platform }); }
});
test('planned identity metadata does not authorize consent or native acceptance before identity readback', async t => {
  const f = await fixture(t); await f.provision(); await f.call('plan', 'identity');
  const writes = f.cloud.writes().length;
  await assert.rejects(f.call('plan', 'consent'), /policy|Identity/);
  await assert.rejects(f.call('plan', 'deployment'), /policy|Identity/);
  assert.equal(f.cloud.writes().length, writes);
});
test('mixed reuse application/create site never patches an unmanaged registration', async t => {
  const f = await fixture(t); await f.provision(); await f.stage('identity');
  const original = await f.read();
  const r = clone(f.r);
  r.application = { ...r.application, mode: 'reuse', id: original.resources.application.observed.id };
  // Reuse the already configured app with the same exact callback/site name, but a fresh selected site.
  const oldSiteId = armId(r, 'site', r.site.name);
  for (const key of [...f.cloud.arm.keys()]) if (key === oldSiteId || key.startsWith(oldSiteId + '/')) f.cloud.arm.delete(key);
  for (const role of ['resourceGroup', 'plan', 'identity']) r[role] = { ...r[role], mode: 'reuse', id: original.resources[role].observed.id };
  r.readerGroups = [{ ...r.readerGroups[0], mode: 'reuse', id: original.resources.readerGroup0.observed.id }];
  const second = await fixture(t, r);
  for (const key of ['arm', 'collections', 'settings', 'fics']) second.cloud[key] = f.cloud[key];
  await second.provision(); await second.stage('identity');
  assert.equal(second.cloud.writes().filter(call => call.method === 'PATCH' && call.path?.startsWith('/v1.0/applications/')).length, 0);
});
test('diagnostic metadata allows disabled extra categories and repairs trace only with separate stage approval', async t => {
  const f = await fixture(t, { diagnostics: { mode: 'enabled', workspace: { mode: 'create', name: 'fixture-logs' },
    settingName: 'fixture-routing', retentionDays: 30, dailyQuotaGb: 1 } });
  await f.provision(); await f.stage('identity'); await f.stage('diagnostics'); await f.stage('diagnostics');
  f.cloud.routing[0].properties.logs.push({ category: 'AppServiceHTTPLogs', enabled: false });
  delete f.cloud.settings.WEBSITE_AUTH_AAD_TRACE_LEVEL;
  const preview = await f.call('plan', 'diagnostics');
  assert.equal(preview.operation.kind, 'diagnostics'); assert.equal(preview.operation.body, null);
  const routingWrites = f.cloud.writes().filter(call => call.path?.includes('/Microsoft.Insights/')).length;
  await f.call('apply', 'diagnostics', { approve: preview.sha256 });
  assert.equal(f.cloud.writes().filter(call => call.path?.includes('/Microsoft.Insights/')).length, routingWrites);
  const inventory = await f.read();
  assert.equal(inventory.policy.settings.WEBSITE_AUTH_AAD_TRACE_LEVEL.value, 'Information');
  assert.equal(inventory.diagnostics.capture, 'unverified');
});
test('identity apply and recover refuse incomplete FIC readback instead of journaling verified', async t => {
  const f = await fixture(t);
  await f.provision();
  const preview = await f.call('plan', 'identity');
  assert.equal((await f.read()).dependencies.publishScope.observedId, null);
  assert.equal((await f.read()).dependencies.publishScope.status, 'unverified');
  f.cloud.hideFic = true;
  await assert.rejects(f.call('apply', 'identity', { approve: preview.sha256 }), /readback is pending/);
  assert.equal((await f.read()).operation.status, 'uncertain');
  const recovery = await f.call('recover');
  await assert.rejects(f.call('recover', 'identity', { approve: recovery.sha256 }), /readback is pending/);
  assert.equal((await f.read()).operation.status, 'uncertain');
  f.cloud.hideFic = false;
  await f.call('recover', 'identity', { approve: recovery.sha256 });
  assert.equal((await f.read()).operation.status, 'reconciled');
});
test('guided htmlpub runs the real setup engine through logging and a bearer 403, then resumes without replay', async t => {
  const f = await fixture(t, { diagnostics: { mode: 'enabled', workspace: { mode: 'create', name: 'fixture-logs' },
    settingName: 'fixture-routing', retentionDays: 30, dailyQuotaGb: 1 } });
  await savePrivate(`${f.config}.guided.json`, { version: 1, answers: f.r, prefix: 'fixture-html-publishing', mode: 'create', completed: [] });
  const transcript = [], observed = { tokens: 0, native: 0, manager: 0 };
  const ui = { interactive: true, line: text => transcript.push(String(text)),
    async ask(prompt, fallback) {
      const answer = prompt.startsWith('Type ') ? /^Type (.+) to approve/.exec(prompt)[1] : fallback;
      assert.ok(answer, `Unexpected prompt: ${prompt}`);
      transcript.push(`${prompt}: ${answer}`); return answer;
    }, close() {},
  };
  const deps = { ...f.deps, catalog: {
    async select(account) { assert.equal(account.id, subscription); },
    async estimate() { return null; },
  }, nativeTransport: {
    tokenProvider: async () => { observed.tokens++; return 'synthetic.jwt.assertion'; },
    fetchImpl: async (url, options) => {
      assert.ok(url.endsWith('/_manager/api/inventory'));
      assert.equal(options.headers.Authorization, 'Bearer synthetic.jwt.assertion');
      observed.manager++; return new Response('synthetic.private.provider.body', { status: 403 });
    },
  } };
  await assert.rejects(runHtmlpub(['setup', '--config', f.config], { ui, setupDependencies: deps }), /Publishing acceptance failed/);
  const inventory = await f.read();
  assert.equal(inventory.diagnostics.status, 'routing-observed');
  assert.equal(inventory.diagnostics.capture, 'unverified');
  assert.equal(inventory.gates['native-manager-obo'].status, 'failed');
  assert.equal(f.cloud.settings.HTML_MANAGER_MUTATIONS_ENABLED, 'false');
  assert.equal(f.cloud.collections.oauth2PermissionGrants.length, 2);
  assert.equal(f.cloud.routing.length, 1);
  assert.equal(observed.tokens, 1); assert.equal(observed.native, 0); assert.equal(observed.manager, 1);
  const writes = f.cloud.writes().length;
  assert.equal((await runHtmlpub(['--setup', '--config', f.config], { ui, setupDependencies: deps })).status, 'blocked');
  assert.equal(f.cloud.writes().length, writes); assert.equal(observed.tokens, 1);
  assert.ok(!transcript.join('\n').includes('synthetic.private'));
  if (process.env.HTMLPUB_CAPTURE_TRANSCRIPT === '1') console.log('OFFLINE TRANSCRIPT, INJECTED AZURE/HTTP, NOT LIVE ACCEPTANCE\n' + transcript.join('\n'));
});
test('guided htmlpub real engine requires every owner evidence confirmation before separate activation', async t => {
  const f = await fixture(t);
  await savePrivate(`${f.config}.guided.json`, { version: 1, answers: f.r, prefix: 'fixture-html-publishing', mode: 'create', completed: [] });
  let evidenceMenu = false, attestations = 0, tokens = 0;
  const ui = { interactive: true, line(text) { if (text === 'Owner evidence') evidenceMenu = true; },
    async ask(prompt, fallback) {
      if (prompt === 'Select number' && evidenceMenu) { evidenceMenu = false; return '2'; }
      if (prompt.startsWith('Type ')) { if (prompt.includes('ATTEST ')) attestations++; return /^Type (.+) to approve/.exec(prompt)[1]; }
      if (prompt.startsWith('Private evidence')) return 'Synthetic offline evidence, not live acceptance';
      if (prompt.startsWith('Actual UTC')) return new Date().toISOString();
      assert.ok(fallback, `Unexpected prompt: ${prompt}`); return fallback;
    }, close() {},
  };
  const deps = { ...f.deps, catalog: { async select() {}, async estimate() { return null; } },
    nativeTransport: { tokenProvider: async () => { tokens++; return 'synthetic.jwt.assertion'; },
      fetchImpl: async url => {
        assert.ok(url.endsWith('/_manager/api/inventory'));
        return Response.json({ pages: [], mutationsEnabled: false });
      } } };
  const result = await runHtmlpub(['setup', '--config', f.config], { ui, setupDependencies: deps });
  assert.equal(result.status, 'accepted'); assert.equal(attestations, GATES.length - 1); assert.equal(tokens, 1);
  assert.equal((await f.read()).activation.status, 'verified');
  const writes = f.cloud.writes().length;
  assert.equal((await runHtmlpub(['setup', '--config', f.config], { ui, setupDependencies: deps })).status, 'already-accepted');
  assert.equal(f.cloud.writes().length, writes); assert.equal(tokens, 1, 'accepted resume never repeats the publisher request');
  const status = [];
  await runHtmlpub(['status', '--config', f.config], { ui: { interactive: false, line: text => status.push(text), close() {} } });
  assert.match(status.join('\n'), /\[done\] resources/);
  assert.match(status.join('\n'), /acceptance: fresh/);
  assert.equal(tokens, 1, 'status is local and does not sign in');
});
test('guided setup reconciles SCM uncertainty before resuming and never redeploys without another approval', async t => {
  const f = await fixture(t);
  await f.provision(); await f.stage('identity'); await f.stage('consent'); await f.stage('consent');
  f.cloud.failDeploy = true; f.cloud.failRestore = true;
  await assert.rejects(f.stage('deployment'), /Forbidden/);
  const deploys = f.cloud.calls.filter(call => call.kind === 'deploy').length;
  f.cloud.failRestore = false; f.cloud.failDeploy = false;
  await savePrivate(`${f.config}.guided.json`, { version: 1, answers: f.r, prefix: 'fixture-html-publishing',
    mode: 'create', completed: ['resources', 'identity', 'consent'] });
  const ui = { interactive: true, line() {}, async ask(prompt, fallback) {
    if (prompt.startsWith('Type RECOVER')) return 'RECOVER';
    if (prompt.startsWith('Type APPLY deployment')) throw new SavedExit('Saved without another deployment.');
    assert.ok(fallback, `Unexpected prompt: ${prompt}`); return fallback;
  }, close() {} };
  const result = await runHtmlpub(['setup', '--config', f.config], { ui, setupDependencies: f.deps });
  assert.equal(result.status, 'saved');
  assert.equal((await f.read()).recovery, null);
  assert.equal((await f.read()).operation.status, 'reconciled');
  assert.equal(f.cloud.calls.filter(call => call.kind === 'deploy').length, deploys);
  assert.equal(f.cloud.settings.HTML_MANAGER_MUTATIONS_ENABLED, 'false');
});
