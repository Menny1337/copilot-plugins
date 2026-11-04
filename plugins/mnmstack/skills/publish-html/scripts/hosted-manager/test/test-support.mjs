import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.mjs';
import { PageStore } from '../store.mjs';
import { deflateSync } from 'node:zlib';
import { crc32 } from '../png.mjs';
import { digest } from '../common.mjs';

export const tenant = '11111111-1111-4111-8111-111111111111';
export const manager = '22222222-2222-4222-8222-222222222222';
export const group = '33333333-3333-4333-8333-333333333333';
export const client = '44444444-4444-4444-8444-444444444444';
export const cli = '55555555-5555-4555-8555-555555555555';
export const other = '66666666-6666-4666-8666-666666666666';
export const identity = '77777777-7777-4777-8777-777777777777';
export const origin = 'https://example.test';
export const html = text => Buffer.from(`<!doctype html><html><script>window.normalJavaScript=true;</script>${text}</html>`);
export function pngChunk(type, bytes) {
  const header = Buffer.alloc(8); header.writeUInt32BE(bytes.length); header.write(type, 4);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), bytes])));
  return Buffer.concat([header, bytes, crc]);
}
export function png(color = 40, width = 32, height = 20) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const data = Buffer.alloc((width * 3 + 1) * height, color);
  for (let row = 0; row < height; row++) data[row * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(data)), pngChunk('IEND', Buffer.alloc(0))]);
}
export const thumbnail = (bytes, image = png()) => ({ htmlSha256: digest(bytes), pngBase64: image.toString('base64') });
export function configEnv(root) {
  return {
    TENANT_ID: tenant, ALLOWED_GROUP_IDS: group, HTML_MANAGER_OBJECT_IDS: manager,
    HTML_MANAGER_ORIGIN: origin, HTML_CONTENT_DIR: path.join(root, 'content'),
    HTML_MANAGER_STATE_DIR: path.join(root, 'private'), HTML_MANAGER_MUTATIONS_ENABLED: 'true',
    HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN: 'true', HTML_MANAGER_OWN_API_ENABLED: 'true',
    HTML_MANAGER_API_CLIENT_ID: client, HTML_MANAGER_ALLOWED_CLIENT_IDS: cli,
    HTML_MANAGER_MI_CLIENT_ID: identity, IDENTITY_ENDPOINT: 'http://127.0.0.1:8081/msi/token',
    IDENTITY_HEADER: 'synthetic-identity-header',
  };
}
export async function fixture(t, dependencies) {
  if (!process.env.PUBLISH_HTML_TEST_ARTIFACT_DIR) throw new Error('Set PUBLISH_HTML_TEST_ARTIFACT_DIR to an approved artifact directory outside the checkout.');
  const parent = await realpath(process.env.PUBLISH_HTML_TEST_ARTIFACT_DIR);
  const root = await mkdtemp(path.join(parent, 'hosted-manager-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'content'));
  const env = configEnv(root), config = loadConfig(env);
  const store = await new PageStore(config, dependencies).initialize();
  return { root, env, config, store };
}
export function principal(oid = manager, tid = tenant, extraClaims = []) {
  return {
    'x-ms-client-principal': Buffer.from(JSON.stringify({ auth_typ: 'aad',
      claims: [{ typ: 'tid', val: tid }, { typ: 'oid', val: oid }, ...extraClaims] })).toString('base64'),
    'x-ms-client-principal-id': oid, 'x-ms-token-aad-access-token': 'synthetic-graph-token',
  };
}
export const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
export const nativeLogin = fetchImpl => async (url, options) => {
  if (new URL(url).pathname === '/.auth/login/aad') return json({
    authenticationToken: 'synthetic-session-token', user: { userId: 'sid:synthetic-user' },
  });
  return fetchImpl(url, options);
};
export function graphFetch({ oid = manager, groups = [group], calls = [] } = {}) {
  return async (url, options) => {
    calls.push({ url: String(url), options });
    if (url === 'https://graph.microsoft.com/v1.0/me?$select=id') return json({ id: oid });
    if (url === 'https://graph.microsoft.com/v1.0/me/checkMemberGroups') return json({ value: groups });
    throw new Error('Forbidden test network request.');
  };
}
export function request(action, page = null, bytes = null, extra = {}) {
  return {
    action, name: page?.name ?? 'report.html', confirmation: page?.name ?? 'report.html',
    expectedRevision: page?.revision ?? 'missing', expectedSha256: page?.sha256 ?? null,
    htmlBase64: bytes?.toString('base64') ?? null, backupId: null, backupSha256: null, ...extra,
  };
}
