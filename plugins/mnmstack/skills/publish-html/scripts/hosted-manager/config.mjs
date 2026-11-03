import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';
import { GUID } from './common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
function ids(value, label, min = 1, max = 20) {
  const list = (value ?? '').split(',').map(id => id.trim().toLowerCase());
  if (list.length < min || list.length > max || list.some(id => !GUID.test(id)) || new Set(list).size !== list.length) throw new Error(`${label} requires unique GUIDs.`);
  return Object.freeze(list);
}
function flag(value, label) {
  if (value !== undefined && !['true', 'false'].includes(value)) throw new Error(`${label} must be true or false.`);
  return value === 'true';
}
function days(value, fallback, label) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n !== fallback) throw new Error(`${label} must remain at the approved ${fallback} days.`);
  return n;
}
export function loadConfig(env = process.env) {
  if (process.platform === 'win32' || constants.O_NOFOLLOW === undefined) throw new Error('Hosted manager requires a POSIX Node 24 host with no-follow file operations.');
  const tenantId = env.TENANT_ID?.toLowerCase();
  if (!GUID.test(tenantId ?? '')) throw new Error('TENANT_ID must be an approved tenant GUID.');
  const allowedGroupIds = ids(env.ALLOWED_GROUP_IDS, 'ALLOWED_GROUP_IDS');
  const managerObjectIds = ids(env.HTML_MANAGER_OBJECT_IDS, 'HTML_MANAGER_OBJECT_IDS');
  const origin = env.HTML_MANAGER_ORIGIN;
  let parsed;
  try { parsed = new URL(origin); } catch { throw new Error('HTML_MANAGER_ORIGIN requires the approved HTTPS origin.'); }
  if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password || parsed.port) throw new Error('HTML_MANAGER_ORIGIN must be an exact HTTPS origin without port, path or credentials.');
  const contentDir = env.HTML_CONTENT_DIR ?? path.resolve(here, 'content');
  const stateDir = env.HTML_MANAGER_STATE_DIR;
  if (!stateDir || [contentDir, stateDir].some(dir => !path.isAbsolute(dir) || path.resolve(dir) !== dir) ||
      contentDir === stateDir || contentDir.startsWith(stateDir + path.sep) || stateDir.startsWith(contentDir + path.sep) ||
      stateDir === here || stateDir.startsWith(here + path.sep)) {
    throw new Error('Content and private state require separate absolute normalized directory trees.');
  }
  const mutationsEnabled = flag(env.HTML_MANAGER_MUTATIONS_ENABLED, 'HTML_MANAGER_MUTATIONS_ENABLED');
  const legacyPublishersFrozen = flag(env.HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN, 'HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN');
  if (mutationsEnabled && !legacyPublishersFrozen) throw new Error('Freeze and migrate all legacy/manual publishers before enabling hosted mutations.');
  const ownApiEnabled = flag(env.HTML_MANAGER_OWN_API_ENABLED, 'HTML_MANAGER_OWN_API_ENABLED');
  if (mutationsEnabled && !ownApiEnabled) throw new Error('Own-API automated publishing must be configured before hosted mutations are enabled.');
  const apiClientId = env.HTML_MANAGER_API_CLIENT_ID?.toLowerCase();
  const managedIdentityClientId = env.HTML_MANAGER_MI_CLIENT_ID?.toLowerCase();
  let allowedClientIds = [];
  if (ownApiEnabled) {
    if (!GUID.test(apiClientId ?? '') || !GUID.test(managedIdentityClientId ?? '')) throw new Error('Own-API app and managed-identity client GUIDs required.');
    allowedClientIds = ids(env.HTML_MANAGER_ALLOWED_CLIENT_IDS, 'HTML_MANAGER_ALLOWED_CLIENT_IDS');
  }
  const port = env.PORT ?? '8080';
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('PORT must be 1 to 65535.');
  return Object.freeze({
    tenantId, allowedGroupIds, managerObjectIds, origin, contentDir, stateDir,
    mutationsEnabled, legacyPublishersFrozen, ownApiEnabled, apiClientId,
    managedIdentityClientId, allowedClientIds: Object.freeze(allowedClientIds),
    identityEndpoint: env.IDENTITY_ENDPOINT, identityHeader: env.IDENTITY_HEADER,
    backupRetentionDays: days(env.HTML_MANAGER_BACKUP_RETENTION_DAYS, 90, 'HTML_MANAGER_BACKUP_RETENTION_DAYS'),
    auditRetentionDays: days(env.HTML_MANAGER_AUDIT_RETENTION_DAYS, 365, 'HTML_MANAGER_AUDIT_RETENTION_DAYS'),
    port: Number(port),
  });
}
