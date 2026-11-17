import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { authorize, verifyOwnApi, easyAuthIdentity } from '../auth.mjs';
import { loadConfig } from '../config.mjs';
import { configEnv, tenant, manager, group, client, cli, other, identity, principal, json, graphFetch } from './test-support.mjs';

const config = loadConfig(configEnv('/synthetic'));
const managerGroup = '88888888-8888-4888-8888-888888888888';
const groupConfig = loadConfig({ ...configEnv('/synthetic'), HTML_MANAGER_GROUP_IDS: managerGroup });
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'offline-key', use: 'sig', alg: 'RS256' };
const time = Math.floor(Date.now() / 1000);
const claims = { ver: '2.0', iss: `https://login.microsoftonline.com/${tenant}/v2.0`, tid: tenant, aud: client, azp: cli, oid: manager, scp: 'publish_as_user', nbf: time - 30, exp: time + 300 };
function token(changes = {}, headerChanges = {}, key = pair.privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'offline-key', ...headerChanges })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...claims, ...changes })).toString('base64url');
  return `${header}.${body}.${sign('RSA-SHA256', Buffer.from(`${header}.${body}`), key).toString('base64url')}`;
}
const keysFetch = async (url, options) => {
  assert.equal(url, `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`);
  assert.equal(options.redirect, 'error');
  return json({ keys: [jwk] });
};
function delegatedFetch(assertion, { calls = [], oid = manager, groups = [group] } = {}) {
  return async (url, options) => {
    calls.push(String(url));
    if (String(url).endsWith('/keys')) return keysFetch(url, options);
    if (String(url).startsWith('http://127.0.0.1:8081/msi/token?')) {
      const target = new URL(url);
      assert.equal(target.searchParams.get('resource'), 'api://AzureADTokenExchange');
      assert.equal(target.searchParams.get('client_id'), identity);
      assert.equal(options.headers['X-IDENTITY-HEADER'], 'synthetic-identity-header');
      return json({ access_token: 'synthetic-mi-assertion' });
    }
    if (String(url).endsWith('/oauth2/v2.0/token')) {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('assertion'), assertion);
      assert.equal(form.get('client_assertion'), 'synthetic-mi-assertion');
      assert.equal(form.get('requested_token_use'), 'on_behalf_of');
      assert.equal(form.get('scope'), 'https://graph.microsoft.com/.default');
      return json({ access_token: 'synthetic-obo-graph', token_type: 'Bearer' });
    }
    assert.equal(options.headers.Authorization, 'Bearer synthetic-obo-graph');
    return graphFetch({ oid, groups })(url, options);
  };
}
const nativeHeaders = (assertion, oid = manager) => ({
  ...principal(oid), 'x-zumo-auth': 'synthetic-native-session', 'x-manager-assertion': assertion,
});
test('reader gate preserves EasyAuth user binding and scoped group lookup', async () => {
  const calls = [];
  assert.equal((await authorize(principal(), config, { fetchImpl: graphFetch({ calls }) }, true)).oid, manager);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://graph.microsoft.com/v1.0/me?$select=id');
  assert.deepEqual(JSON.parse(calls[1].options.body), { groupIds: [group] });
  assert.equal(calls[0].options.redirect, 'error');
});
for (const [label, headers] of [
  ['missing', {}], ['invalid-base64', { 'x-ms-client-principal': '??' }],
  ['malformed-json', { 'x-ms-client-principal': Buffer.from('not json').toString('base64') }],
  ['conflicting-oid', principal(manager, tenant, [{ typ: 'oid', val: other }])],
  ['conflicting-tenant', principal(manager, tenant, [{ typ: 'tid', val: other }])],
  ['wrong-tenant', principal(manager, other)], ['app-principal', principal(manager, tenant, [{ typ: 'idtyp', val: 'app' }])],
  ['mismatched-header', { ...principal(), 'x-ms-client-principal-id': other }],
  ['non-aad', { 'x-ms-client-principal': Buffer.from(JSON.stringify({ auth_typ: 'other', claims: [] })).toString('base64') }],
]) {
  test(`EasyAuth rejects ${label} before Graph`, async () => {
    assert.throws(() => easyAuthIdentity(headers, config));
    await assert.rejects(authorize(headers, config, { fetchImpl: () => assert.fail('Graph must not run') }, true));
  });
}
for (const [label, headers, fetchImpl] of [
  ['unconfigured-manager', principal(other), graphFetch()],
  ['Graph-user-mismatch', principal(), graphFetch({ oid: other })],
  ['no-reader-group', principal(), graphFetch({ groups: [] })],
  ['unknown-group', principal(), graphFetch({ groups: [other] })],
  ['duplicate-group', principal(), graphFetch({ groups: [group, group] })],
  ['missing-Graph-token', { ...principal(), 'x-ms-token-aad-access-token': '' }, graphFetch()],
  ['Graph-failure', principal(), async () => json({ error: 'synthetic-private-diagnostic' }, 403)],
]) {
  test(`manager rejects ${label}`, async () => { await assert.rejects(authorize(headers, config, { fetchImpl }, true)); });
}
test('non-manager readers remain allowed on ordinary report routes', async () => {
  assert.equal((await authorize(principal(other), config, { fetchImpl: graphFetch({ oid: other }) })).oid, other);
});
test('manager-group authorization checks live selected membership after reader eligibility and reflects revocation', async () => {
  const calls = [];
  let member = true;
  const fetchImpl = graphFetch({ oid: other, calls, groups: ids => ids.includes(group) ? [group] : member ? [managerGroup.toUpperCase()] : [] });
  assert.deepEqual(await authorize(principal(other), groupConfig, { fetchImpl }, true), { oid: other, transport: 'browser' });
  assert.deepEqual(calls.map(call => call.url), ['https://graph.microsoft.com/v1.0/me?$select=id',
    'https://graph.microsoft.com/v1.0/me/checkMemberGroups', 'https://graph.microsoft.com/v1.0/me/checkMemberGroups']);
  assert.deepEqual(JSON.parse(calls[2].options.body), { groupIds: [managerGroup] });
  member = false;
  await assert.rejects(authorize(principal(other), groupConfig, { fetchImpl }, true), { code: 'manager' });
  assert.equal(calls.length, 6);
});
test('manager groups cannot replace reader eligibility, token binding or tenant checks', async () => {
  for (const [headers, options, code, count] of [
    [principal(other), { oid: other, groups: [] }, 'reader', 2],
    [principal(other), { oid: manager, groups: ids => ids }, 'graph-binding', 1],
    [principal(other, manager), { oid: other, groups: ids => ids }, 'tenant', 0],
  ]) {
    const calls = [];
    await assert.rejects(authorize(headers, groupConfig, { fetchImpl: graphFetch({ ...options, calls }) }, true), { code });
    assert.equal(calls.length, count);
  }
});
for (const [label, result] of [
  ['non-member', () => json({ value: [] })],
  ['denied', () => json({ error: 'private' }, 403)],
  ['unauthenticated', () => json({}, 401)],
  ['unavailable', () => json({}, 503)],
  ['network', () => { throw new TypeError('private'); }],
  ['timeout', () => { throw new DOMException('private', 'TimeoutError'); }],
  ['missing-value', () => json({})],
  ['wrong-type', () => json({ value: managerGroup })],
  ['unknown-id', () => json({ value: [other] })],
  ['malformed-id', () => json({ value: ['team@example.invalid'] })],
  ['duplicate', () => json({ value: [managerGroup, managerGroup.toUpperCase()] })],
  ['null-id', () => json({ value: [null] })],
  ['pagination', () => json({ value: [managerGroup], '@odata.nextLink': 'https://untrusted.invalid/' })],
  ['error-envelope', () => json({ value: [managerGroup], error: { code: 'denied' } })],
  ['invalid-json', () => new Response('{not json')],
  ['oversized', () => json({ value: [managerGroup], extra: 'x'.repeat(128 * 1024) })],
]) {
  test(`manager group fails closed on ${label}`, async () => {
    const reader = graphFetch({ oid: other });
    const fetchImpl = (url, options) => url.endsWith('/checkMemberGroups') && JSON.parse(options.body).groupIds.includes(managerGroup)
      ? result() : reader(url, options);
    await assert.rejects(authorize(principal(other), groupConfig, { fetchImpl }, true));
  });
}
test('explicit managers and ordinary readers never depend on manager-group lookups', async () => {
  for (const [oid, isManager] of [[manager, true], [other, false]]) {
    const calls = [];
    assert.equal((await authorize(principal(oid), groupConfig, {
      fetchImpl: graphFetch({ oid, calls }),
    }, isManager)).oid, oid);
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(calls[1].options.body), { groupIds: [group] });
  }
});
test('reader and manager allowlists stay separately bounded at twenty IDs', async () => {
  const ids = n => Array.from({ length: 20 }, (_, i) => `${String(n + i).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
  const readers = ids(1), managers = ids(21), calls = [];
  const selected = loadConfig({ ...configEnv('/synthetic'), ALLOWED_GROUP_IDS: readers.join(','),
    HTML_MANAGER_OBJECT_IDS: '', HTML_MANAGER_GROUP_IDS: managers.join(',') });
  await authorize(principal(other), selected, { fetchImpl: graphFetch({ oid: other, calls, groups: values => [values[0]] }) }, true);
  assert.deepEqual(calls.slice(1).map(call => JSON.parse(call.options.body).groupIds), [readers, managers]);
});
test('own-API verifies actual synthetic RSA signature', async () => {
  assert.equal(await verifyOwnApi(token(), config, { fetchImpl: keysFetch }), manager);
});
for (const [label, changes] of [
  ['tenant', { tid: other }], ['audience', { aud: other }], ['issuer', { iss: `https://example.test/${tenant}` }],
  ['scope', { scp: 'User.Read' }], ['app-role-only', { scp: undefined, roles: ['publish_as_user'] }],
  ['client', { azp: other }], ['oid', { oid: 'invalid' }], ['application', { idtyp: 'app' }],
  ['expiry', { exp: time - 1 }], ['nbf', { nbf: time + 100 }], ['missing-nbf', { nbf: undefined }],
  ['v1', { ver: '1.0' }], ['array-aud', { aud: [client] }], ['string-expiry', { exp: String(time + 300) }],
]) {
  test(`own-API rejects ${label}`, async () => { await assert.rejects(verifyOwnApi(token(changes), config, { fetchImpl: keysFetch })); });
}
test('own-API rejects wrong signature, algorithm, critical header, key ambiguity and disabled flow', async () => {
  const wrongPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  for (const bad of [token({}, {}, wrongPair.privateKey), token({}, { alg: 'none' }), token({}, { crit: ['unknown'] }), 'garbage']) {
    await assert.rejects(verifyOwnApi(bad, config, { fetchImpl: keysFetch }));
  }
  await assert.rejects(verifyOwnApi(token(), config, { fetchImpl: async () => json({ keys: [jwk, jwk] }) }));
  await assert.rejects(verifyOwnApi(token(), { ...config, ownApiEnabled: false }, { fetchImpl: () => assert.fail() }));
});
test('malformed JWT JSON shapes return explicit authentication refusal', async () => {
  const valid = token().split('.');
  for (const value of [null, [], 'text', 123]) {
    const part = Buffer.from(JSON.stringify(value)).toString('base64url');
    await assert.rejects(verifyOwnApi([part, valid[1], valid[2]].join('.'), config, { fetchImpl: () => assert.fail() }), { code: 'jwt-format' });
    await assert.rejects(verifyOwnApi([valid[0], part, valid[2]].join('.'), config, { fetchImpl: () => assert.fail() }), { code: 'jwt-format' });
  }
  await assert.rejects(verifyOwnApi(token(), config, { fetchImpl: async () => json({ keys: [null] }) }), { code: 'jwt-signature' });
});
test('bearer uses actual user assertion AND MI-federated app assertion, then equivalent Graph gate', async () => {
  const assertion = token(), calls = [];
  const fetchImpl = delegatedFetch(assertion, { calls });
  assert.deepEqual(await authorize({ ...principal(), authorization: `Bearer ${assertion}` }, config, { fetchImpl }, true), { oid: manager, transport: 'bearer' });
  assert.equal(calls.length, 5);
});
test('group-only manager uses the same verified Graph gate across browser OBO, bearer and native paths', async () => {
  const selected = { ...groupConfig, managerObjectIds: [] }, assertion = token({ oid: other });
  for (const transport of ['browser', 'bearer', 'native']) {
    const headers = transport === 'native' ? nativeHeaders(assertion, other) :
      transport === 'bearer' ? { ...principal(other), authorization: `Bearer ${assertion}` } :
        { ...principal(other), 'x-ms-token-aad-access-token': assertion };
    const calls = [], groups = ids => ids.includes(group) ? [group] : [managerGroup];
    assert.deepEqual(await authorize(headers, selected, { fetchImpl: delegatedFetch(assertion, { oid: other, calls, groups }) }, true),
      { oid: other, transport });
    assert.equal(calls.length, 6);
    await assert.rejects(authorize(headers, selected, {
      fetchImpl: delegatedFetch(assertion, { oid: other, groups: ids => ids.includes(group) ? [group] : [] }),
    }, true), { code: 'manager' });
    await assert.rejects(authorize(headers, selected, {
      fetchImpl: delegatedFetch(assertion, { oid: other, groups: [] }),
    }, true), { code: 'reader' });
  }
});
test('native platform session is bound to the independently verified assertion before MI-OBO and reader authorization', async () => {
  const assertion = token(), calls = [];
  assert.deepEqual(await authorize(nativeHeaders(assertion), config, { fetchImpl: delegatedFetch(assertion, { calls }) }, true),
    { oid: manager, transport: 'native' });
  assert.equal(calls.length, 5);
  await assert.rejects(authorize(nativeHeaders(assertion), config, { fetchImpl: delegatedFetch(assertion, { groups: [] }) }, true), { code: 'reader' });
  await assert.rejects(authorize(nativeHeaders(assertion), config, { fetchImpl: delegatedFetch(assertion, { oid: other }) }, true), { code: 'graph-binding' });
});
test('native session cannot omit its assertion, compete with bearer/cookies or bypass platform identity', async () => {
  const valid = nativeHeaders(token());
  for (const change of [
    { 'x-manager-assertion': undefined }, { 'x-zumo-auth': undefined }, { 'x-zumo-auth': '' },
    { 'x-zumo-auth': ['one', 'two'] }, { 'x-manager-assertion': ['one', 'two'] },
    { authorization: 'Bearer synthetic-other' }, { cookie: 'AppServiceAuthSession=synthetic-cookie' }, { cookie: '' },
  ]) await assert.rejects(authorize({ ...valid, ...change }, config, { fetchImpl: () => assert.fail('No remote authorization permitted') }, true), { code: 'native-credentials' });
  for (const [change, code] of [
    [{ 'x-ms-client-principal': '' }, 'principal'], [{ 'x-ms-client-principal-id': other }, 'principal-binding'],
    [principal(manager, other), 'tenant'],
  ]) await assert.rejects(authorize({ ...valid, ...change }, config, { fetchImpl: () => assert.fail() }, true), { code });
  await assert.rejects(authorize(valid, config, { fetchImpl: () => assert.fail() }, false), { code: 'native-credentials' });
  await assert.rejects(authorize(nativeHeaders(token({ oid: other })), config, { fetchImpl: keysFetch }, true), { code: 'native-binding' });
  await assert.rejects(authorize(nativeHeaders(token({ oid: other }), other), config, { fetchImpl: keysFetch }, true), { code: 'manager' });
});
for (const [label, changes] of [
  ['expired', { exp: time - 1 }], ['not-yet-valid', { nbf: time + 300 }], ['wrong-tenant', { tid: other }],
  ['wrong-audience', { aud: other }], ['wrong-client', { azp: other }], ['missing-scope', { scp: undefined }],
  ['wrong-scope', { scp: 'User.Read' }], ['app-only', { idtyp: 'app' }], ['wrong-issuer', { iss: `https://example.test/${tenant}` }],
]) {
  test(`native ${label} assertion fails closed without browser-token fallback`, async () => {
    await assert.rejects(authorize(nativeHeaders(token(changes)), config, { fetchImpl: keysFetch }, true), { code: 'jwt-claims' });
  });
}
test('native malformed or forged assertion cannot use an otherwise valid platform/browser identity', async () => {
  const wrongPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  for (const [assertion, code] of [['malformed', 'jwt-format'], [token({}, {}, wrongPair.privateKey), 'jwt-signature']]) {
    await assert.rejects(authorize(nativeHeaders(assertion), config, { fetchImpl: keysFetch }, true), { code });
  }
});
test('browser reader and manager tolerate a native API token in the provider store only through full verification and OBO', async () => {
  for (const isManager of [false, true]) {
    const assertion = token(), calls = [];
    assert.deepEqual(await authorize({ ...principal(), 'x-ms-token-aad-access-token': assertion }, config,
      { fetchImpl: delegatedFetch(assertion, { calls }) }, isManager), { oid: manager, transport: 'browser' });
    assert.equal(calls.length, 5);
  }
  const assertion = token({ oid: other });
  assert.deepEqual(await authorize({ ...principal(other), 'x-ms-token-aad-access-token': assertion }, config,
    { fetchImpl: delegatedFetch(assertion, { oid: other }) }), { oid: other, transport: 'browser' });
});
test('stored API-token validation and user binding fail closed before OBO without a Graph-token fallback', async () => {
  for (const changes of [{ exp: time - 1 }, { tid: other }, { azp: other }, { scp: 'User.Read' }]) {
    await assert.rejects(authorize({ ...principal(), 'x-ms-token-aad-access-token': token(changes) }, config,
      { fetchImpl: keysFetch }), { code: 'jwt-claims' });
  }
  await assert.rejects(authorize({ ...principal(), 'x-ms-token-aad-access-token': token({ oid: other }) }, config,
    { fetchImpl: keysFetch }), { code: 'native-binding' });
  const wrongPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await assert.rejects(authorize({ ...principal(), 'x-ms-token-aad-access-token': token({}, {}, wrongPair.privateKey) }, config,
    { fetchImpl: keysFetch }), { code: 'jwt-signature' });
  await assert.rejects(authorize({ ...principal(), 'x-ms-token-aad-access-token': token({ aud: other }) }, config,
    { fetchImpl: async (url, options) => {
      assert.equal(url, 'https://graph.microsoft.com/v1.0/me?$select=id');
      return json({}, 401);
    } }), { code: 'graph-unavailable' });
});
test('OBO consent/claims challenge fails closed without exposing provider response', async () => {
  const fetchImpl = async url => String(url).endsWith('/keys') ? json({ keys: [jwk] }) :
    String(url).startsWith('http:') ? json({ access_token: 'synthetic-mi' }) :
      json({ error: 'interaction_required', claims: 'synthetic-sensitive-claims' }, 400);
  await assert.rejects(authorize({ ...principal(), authorization: `Bearer ${token()}` }, config, { fetchImpl }, true), error =>
    error.code === 'obo-consent-or-policy' && !error.message.includes('synthetic-sensitive'));
});
test('bearer denies unconfigured manager before MI/OBO and never falls back to browser identity', async () => {
  await assert.rejects(authorize({ ...principal(other), authorization: `Bearer ${token({ oid: other })}` }, config, { fetchImpl: keysFetch }, true), { code: 'manager' });
  await assert.rejects(authorize({ ...principal(), authorization: 'bad' }, config, { fetchImpl: () => assert.fail() }, true));
});
test('unsafe MI endpoints cannot receive either assertion', async () => {
  for (const identityEndpoint of ['https://example.test/msi/token', 'http://example.test/msi/token', 'http://127.0.0.1:8081/other']) {
    await assert.rejects(authorize({ ...principal(), authorization: `Bearer ${token()}` }, { ...config, identityEndpoint }, { fetchImpl: keysFetch }, true), { code: 'mi-config' });
  }
});
test('bearer requires a same-tenant platform identity and binds the independently verified user before OBO', async () => {
  const assertion = token();
  for (const headers of [
    { authorization: `Bearer ${assertion}` },
    { ...principal(manager, other), authorization: `Bearer ${assertion}` },
  ]) {
    await assert.rejects(authorize(headers, config, { fetchImpl: () => assert.fail('No network without platform identity') }, true));
  }
  await assert.rejects(authorize({ ...principal(other), authorization: `Bearer ${assertion}` }, config,
    { fetchImpl: keysFetch }, true), { code: 'principal-binding' });
  for (const changes of [{ aud: other }, { azp: other }, { scp: 'User.Read' }, { exp: time - 1 }]) {
    await assert.rejects(authorize({ ...principal(), authorization: `Bearer ${token(changes)}` }, config,
      { fetchImpl: keysFetch }, true), { code: 'jwt-claims' });
  }
  await assert.rejects(authorize({ ...principal(), authorization: `Bearer ${assertion}` }, config,
    { fetchImpl: delegatedFetch(assertion, { groups: [] }) }, true), { code: 'reader' });
  await assert.rejects(authorize({ ...principal(), authorization: `Bearer ${assertion}` }, config,
    { fetchImpl: delegatedFetch(assertion, { oid: other }) }, true), { code: 'graph-binding' });
});
test('configuration fails closed for identifiers, origin, paths, flags and retention', () => {
  for (const change of [
    { TENANT_ID: '' }, { ALLOWED_GROUP_IDS: `${group},${group}` }, { ALLOWED_GROUP_IDS: `${group},` }, { HTML_MANAGER_OBJECT_IDS: '' },
    { HTML_MANAGER_ORIGIN: 'http://example.test' }, { HTML_MANAGER_ORIGIN: 'https://example.test/' },
    { HTML_MANAGER_ORIGIN: 'https://user:pass@example.test' }, { HTML_MANAGER_ORIGIN: 'https://example.test:444' },
    { HTML_MANAGER_STATE_DIR: '/synthetic/content/private' }, { HTML_CONTENT_DIR: '/synthetic/../content' },
    { HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN: 'false' }, { HTML_MANAGER_MUTATIONS_ENABLED: 'yes' },
    { HTML_MANAGER_BACKUP_RETENTION_DAYS: '1' }, { HTML_MANAGER_AUDIT_RETENTION_DAYS: '1' },
    { HTML_MANAGER_API_CLIENT_ID: 'not-guid' },
    { HTML_MANAGER_OWN_API_ENABLED: 'false' },
  ]) assert.throws(() => loadConfig({ ...configEnv('/synthetic'), ...change }));
  const disabled = configEnv('/synthetic');
  delete disabled.HTML_MANAGER_MUTATIONS_ENABLED; delete disabled.HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN;
  assert.equal(loadConfig(disabled).mutationsEnabled, false);
});
test('manager configuration accepts optional/group-only grants and rejects malformed or empty policies', () => {
  assert.deepEqual(config.managerGroupIds, []);
  assert.deepEqual(loadConfig({ ...configEnv('/synthetic'), HTML_MANAGER_GROUP_IDS: '' }).managerGroupIds, []);
  const selected = loadConfig({ ...configEnv('/synthetic'), HTML_MANAGER_OBJECT_IDS: undefined,
    HTML_MANAGER_GROUP_IDS: managerGroup.toUpperCase() });
  assert.deepEqual(selected.managerObjectIds, []); assert.deepEqual(selected.managerGroupIds, [managerGroup]);
  assert.ok(Object.isFrozen(selected.managerGroupIds));
  for (const groups of ['team@example.invalid', `${managerGroup},`, `${managerGroup},${managerGroup.toUpperCase()}`, Array(21).fill(managerGroup).join(',')]) {
    assert.throws(() => loadConfig({ ...configEnv('/synthetic'), HTML_MANAGER_GROUP_IDS: groups }));
  }
  assert.throws(() => loadConfig({ ...configEnv('/synthetic'), HTML_MANAGER_OBJECT_IDS: undefined }));
});
