import { createPublicKey, verify } from 'node:crypto';
import { GUID, fail, ManagerError } from './common.mjs';

const GRAPH = 'https://graph.microsoft.com/v1.0';
export function easyAuthIdentity(headers, config) {
  const raw = headers['x-ms-client-principal'];
  let principal;
  try {
    if (typeof raw !== 'string' || !raw.length || raw.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) ||
        Buffer.from(raw, 'base64').toString('base64') !== raw) throw new Error();
    principal = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(raw, 'base64')));
    if (principal?.auth_typ !== 'aad' || !Array.isArray(principal.claims) ||
        principal.claims.some(c => !c || typeof c.typ !== 'string' || typeof c.val !== 'string')) throw new Error();
  } catch { fail(401, 'principal', 'Valid Microsoft user sign-in required.'); }
  function claim(names) {
    const values = principal.claims.filter(c => names.includes(c.typ)).map(c => c.val.toLowerCase());
    if (!values.length || values.some(v => !GUID.test(v)) || new Set(values).size !== 1) fail(401, 'principal-claims', 'Missing or conflicting identity claims.');
    return values[0];
  }
  const tenant = claim(['tid', 'http://schemas.microsoft.com/identity/claims/tenantid']);
  const oid = claim(['oid', 'http://schemas.microsoft.com/identity/claims/objectidentifier']);
  if (tenant !== config.tenantId) fail(403, 'tenant', 'Tenant not permitted.');
  const id = headers['x-ms-client-principal-id'];
  if (id !== undefined && (typeof id !== 'string' || id.toLowerCase() !== oid)) fail(401, 'principal-binding', 'Identity headers do not match.');
  if (principal.claims.some(c => c.typ === 'idtyp' && c.val !== 'user')) fail(401, 'principal-user', 'User sign-in required.');
  return oid;
}
async function jsonRequest(url, options, fetchImpl, stage) {
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (response.status !== 200) {
      if (stage === 'obo') fail(403, 'obo-consent-or-policy', 'OBO authorization failed. Consent, claims challenge or tenant policy requires administrator review; no fallback is permitted.');
      fail(response.status === 401 ? 401 : response.status === 403 ? 403 : 503, `${stage}-unavailable`, `${stage} authorization failed; sign-in or service review required.`);
    }
    const bytes = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 128 * 1024) fail(502, 'auth-response', 'Authorization response exceeds its limit.');
      bytes.push(chunk);
    }
    return JSON.parse(Buffer.concat(bytes).toString('utf8'));
  } catch (error) {
    if (error instanceof ManagerError) throw error;
    fail(503, `${stage}-unavailable`, `${stage} authorization could not be verified.`);
  }
}
export async function checkReader(oid, token, config, fetchImpl = globalThis.fetch) {
  if (typeof token !== 'string' || !token.length || token.length > 32768 || /\s/.test(token)) fail(401, 'graph-token', 'Graph access token missing; sign in again.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const me = await jsonRequest(`${GRAPH}/me?$select=id`, { headers }, fetchImpl, 'graph');
  if (typeof me?.id !== 'string' || me.id.toLowerCase() !== oid) fail(403, 'graph-binding', 'Graph token user does not match the authenticated user.');
  const groups = await jsonRequest(`${GRAPH}/me/checkMemberGroups`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupIds: config.allowedGroupIds }),
  }, fetchImpl, 'graph');
  if (!Array.isArray(groups?.value) || groups.value.some(id => typeof id !== 'string' || !config.allowedGroupIds.includes(id.toLowerCase())) ||
      new Set(groups.value.map(id => id.toLowerCase())).size !== groups.value.length) fail(502, 'graph-response', 'Invalid group authorization response.');
  if (!groups.value.length) fail(403, 'reader', 'Configured reader group membership required.');
}
function jwtPart(part) {
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part) || Buffer.from(part, 'base64url').toString('base64url') !== part) fail(401, 'jwt-format', 'Invalid bearer token.');
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(part, 'base64url')));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  }
  catch { fail(401, 'jwt-format', 'Invalid bearer token.'); }
}
export async function verifyOwnApi(token, config, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (!config.ownApiEnabled) fail(403, 'own-api-disabled', 'Own-API publishing is not enabled.');
  if (typeof token !== 'string' || token.length > 32768) fail(401, 'jwt-format', 'Invalid bearer token.');
  const parts = token.split('.');
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) fail(401, 'jwt-format', 'Invalid bearer token.');
  const header = jwtPart(parts[0]), claims = jwtPart(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 256 || header.crit !== undefined ||
      (header.typ !== undefined && header.typ !== 'JWT')) fail(401, 'jwt-algorithm', 'Unsupported bearer token signature.');
  const issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
  const jwks = await jsonRequest(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`, {}, fetchImpl, 'keys');
  if (!Array.isArray(jwks?.keys) || jwks.keys.length > 100) fail(503, 'jwt-keys', 'Signing keys unavailable.');
  const keys = jwks.keys.filter(key => key && typeof key === 'object' && key.kid === header.kid && key.kty === 'RSA' &&
    (key.use === undefined || key.use === 'sig') && (key.alg === undefined || key.alg === 'RS256') &&
    (key.issuer === undefined || key.issuer === issuer || key.issuer === 'https://login.microsoftonline.com/{tenantid}/v2.0'));
  let signed = false;
  if (keys.length === 1) {
    try {
      const key = createPublicKey({ key: keys[0], format: 'jwk' });
      signed = key.asymmetricKeyDetails.modulusLength >= 2048 &&
        verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    } catch { signed = false; }
  }
  if (!signed) fail(401, 'jwt-signature', 'Bearer token signature rejected.');
  const time = Math.floor(now() / 1000);
  if (claims.ver !== '2.0' || claims.iss !== issuer || claims.tid !== config.tenantId || claims.aud !== config.apiClientId ||
      typeof claims.azp !== 'string' || !config.allowedClientIds.includes(claims.azp) ||
      typeof claims.scp !== 'string' || !claims.scp.split(' ').includes('publish_as_user') ||
      !GUID.test(claims.oid ?? '') || (claims.idtyp !== undefined && claims.idtyp !== 'user') ||
      !Number.isInteger(claims.exp) || !Number.isInteger(claims.nbf) || claims.exp <= time || claims.nbf > time || claims.exp <= claims.nbf) {
    fail(401, 'jwt-claims', 'Bearer token issuer, audience, tenant, client, scope, user or lifetime rejected.');
  }
  return claims.oid;
}
async function oboToken(assertion, config, fetchImpl) {
  let endpoint;
  try { endpoint = new URL(config.identityEndpoint); }
  catch { fail(503, 'mi-config', 'Managed identity endpoint is not configured.'); }
  if (endpoint.protocol !== 'http:' || !/^(?:127\.0\.0\.1|169\.254\.\d{1,3}\.\d{1,3})$/.test(endpoint.hostname) ||
      endpoint.pathname !== '/msi/token' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password ||
      typeof config.identityHeader !== 'string' || !config.identityHeader || /[\r\n]/.test(config.identityHeader)) {
    fail(503, 'mi-config', 'Unsupported managed identity endpoint configuration.');
  }
  endpoint.search = new URLSearchParams({ 'api-version': '2019-08-01', resource: 'api://AzureADTokenExchange', client_id: config.managedIdentityClientId }).toString();
  const mi = await jsonRequest(endpoint.href, { headers: { 'X-IDENTITY-HEADER': config.identityHeader } }, fetchImpl, 'identity');
  if (typeof mi?.access_token !== 'string' || !mi.access_token || /\s/.test(mi.access_token)) fail(503, 'mi-response', 'Managed identity assertion unavailable.');
  const result = await jsonRequest(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.apiClientId, grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      requested_token_use: 'on_behalf_of', scope: 'https://graph.microsoft.com/.default', assertion,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: mi.access_token,
    }).toString(),
  }, fetchImpl, 'obo');
  if (typeof result?.access_token !== 'string' || result.token_type?.toLowerCase() !== 'bearer') fail(502, 'obo-response', 'OBO did not return a delegated token.');
  return result.access_token;
}
// EasyAuth headers are authoritative only behind mandatory platform authentication.
// Injection is a constructor/test dependency, never an HTTP or environment bypass.
export async function authorize(headers, config, { fetchImpl = globalThis.fetch, now = Date.now } = {}, manager = false) {
  let oid, graphToken, transport = 'browser';
  const native = headers['x-manager-assertion'] !== undefined || headers['x-zumo-auth'] !== undefined;
  if (native) {
    if (!manager || headers.authorization !== undefined || headers.cookie !== undefined ||
        typeof headers['x-zumo-auth'] !== 'string' || !/^[A-Za-z0-9._-]{1,32768}$/.test(headers['x-zumo-auth']) ||
        typeof headers['x-manager-assertion'] !== 'string') {
      fail(401, 'native-credentials', 'Native publishing requires a platform session and delegated assertion, without cookies or competing authorization.');
    }
    const platformOid = easyAuthIdentity(headers, config);
    const assertion = headers['x-manager-assertion'];
    oid = await verifyOwnApi(assertion, config, { fetchImpl, now });
    if (oid !== platformOid) fail(403, 'native-binding', 'Platform session and delegated assertion must identify the same user.');
    if (!config.managerObjectIds.includes(oid)) fail(403, 'manager', 'Configured manager user required.');
    graphToken = await oboToken(assertion, config, fetchImpl);
    transport = 'native';
  } else if (manager && headers.authorization !== undefined) {
    if (typeof headers.authorization !== 'string' || !/^Bearer [A-Za-z0-9_.-]+$/.test(headers.authorization)) fail(401, 'bearer', 'Bearer authorization required.');
    const assertion = headers.authorization.slice(7);
    oid = await verifyOwnApi(assertion, config, { fetchImpl, now });
    if (!config.managerObjectIds.includes(oid)) fail(403, 'manager', 'Configured manager user required.');
    graphToken = await oboToken(assertion, config, fetchImpl);
    transport = 'bearer';
  } else {
    oid = easyAuthIdentity(headers, config);
    if (manager && !config.managerObjectIds.includes(oid)) fail(403, 'manager', 'Configured manager user required.');
    graphToken = headers['x-ms-token-aad-access-token'];
    // Native sign-in can put an API-audience token in the shared provider store.
    // A routing hint never authorizes it: verify the complete assertion before OBO.
    if (config.ownApiEnabled && typeof graphToken === 'string' && graphToken.split('.').length === 3 &&
        jwtPart(graphToken.split('.')[1]).aud === config.apiClientId) {
      const tokenOid = await verifyOwnApi(graphToken, config, { fetchImpl, now });
      if (tokenOid !== oid) fail(403, 'native-binding', 'Stored delegated assertion does not match the platform user.');
      graphToken = await oboToken(graphToken, config, fetchImpl);
    }
  }
  await checkReader(oid, graphToken, config, fetchImpl);
  return { oid, transport };
}
