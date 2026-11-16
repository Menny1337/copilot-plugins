import path from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, realpath, unlink, chmod, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
export const GUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/;
export const STAGES = Object.freeze(['resources', 'identity', 'consent', 'deployment', 'diagnostics', 'acceptance', 'activation']);
export const GATES = Object.freeze(['native-manager-obo', 'browser-reader-manager', 'browser-denials',
  'corporate-ingress', 'storage-durability-recovery', 'trusted-origin-review', 'legacy-writers-frozen', 'source-review']);
export const DEFAULT_CONFIG = path.join(homedir(), '.copilot', 'html-publisher', 'resources.json');
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export function exact(value, required, optional = []) {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new Error('Unsupported or incomplete configuration fields.');
}
export function ids(value, label) {
  if (!Array.isArray(value) || !value.length || value.length > 20 || value.some(id => typeof id !== 'string' || !GUID.test(id)) ||
      new Set(value.map(id => id.toLowerCase())).size !== value.length) throw new Error(`${label} requires 1-20 unique GUIDs.`);
}
const ARM = {
  resourceGroup: null, plan: 'Microsoft.Web/serverfarms', identity: 'Microsoft.ManagedIdentity/userAssignedIdentities',
  site: 'Microsoft.Web/sites', workspace: 'Microsoft.OperationalInsights/workspaces',
};
export function armId(request, role, name) {
  const base = `/subscriptions/${request.subscriptionId}/resourceGroups/${role === 'resourceGroup' ? name : request.resourceGroup.name}`;
  return role === 'resourceGroup' ? base : `${base}/providers/${ARM[role]}/${name}`;
}
function selection(value, role, request) {
  exact(value, ['mode', 'name'], ['id', ...(role === 'plan' ? ['sku'] : [])]);
  const reusedDirectory = value.mode === 'reuse' && ['application', 'group'].includes(role);
  const validName = reusedDirectory ? typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 120 &&
    value.name.trim() === value.name && !/[\p{Cc}\p{Cf}]/u.test(value.name) : NAME.test(value.name);
  if (!['create', 'reuse'].includes(value.mode) || !validName) throw new Error(`Invalid ${role} selection.`);
  if (['site', 'identity', 'plan', 'workspace'].includes(role) && !/^[A-Za-z0-9][A-Za-z0-9-]{0,58}[A-Za-z0-9]$/.test(value.name)) throw new Error(`Invalid Azure ${role} name.`);
  if (role === 'plan' && (!/^(?:B[1-3]|S[1-3]|P[0-3]v[23]|P[0-3]mv3)$/.test(value.sku ?? ''))) throw new Error('Select an explicit supported paid Linux plan SKU.');
  if (value.mode === 'create' && value.id !== undefined) throw new Error('New resources must not supply invented IDs.');
  if (value.mode === 'reuse') {
    if (ARM[role] !== undefined) {
      if (typeof value.id !== 'string' || value.id.toLowerCase() !== armId(request, role, value.name).toLowerCase()) throw new Error(`Reuse ${role} by exact selected ARM ID in the selected resource group.`);
    } else if (!GUID.test(value.id ?? '')) throw new Error(`Reuse ${role} by exact directory object GUID.`);
  }
}
export function validateRequest(request) {
  exact(request, ['version', 'cloud', 'tenantId', 'subscriptionId', 'location', 'resourceGroup', 'plan', 'identity',
    'application', 'site', 'readerGroups', 'managerObjectIds', 'allowedClientIds', 'diagnostics'], ['legacyConfig']);
  if (request.version !== 1 || request.cloud !== 'AzureCloud' || !GUID.test(request.tenantId) || !GUID.test(request.subscriptionId) ||
      !/^[a-z][a-z0-9]{1,39}$/.test(request.location)) throw new Error('Explicit public-Azure tenant, subscription and region required.');
  for (const role of ['resourceGroup', 'plan', 'identity', 'application', 'site']) selection(request[role], role, request);
  if (!Array.isArray(request.readerGroups) || !request.readerGroups.length || request.readerGroups.length > 20) throw new Error('Select 1-20 reader groups.');
  for (const group of request.readerGroups) selection(group, 'group', request);
  if (new Set(request.readerGroups.map(group => (group.id ?? group.name).toLowerCase())).size !== request.readerGroups.length) throw new Error('Duplicate reader group.');
  ids(request.managerObjectIds, 'Managers'); ids(request.allowedClientIds, 'Delegated clients');
  exact(request.diagnostics, ['mode'], request.diagnostics.mode === 'off' ? [] : ['workspace', 'settingName', 'retentionDays', 'dailyQuotaGb']);
  if (!['off', 'enabled'].includes(request.diagnostics.mode)) throw new Error('Diagnostics must be explicitly off or enabled.');
  if (request.diagnostics.mode === 'enabled') {
    const d = request.diagnostics;
    selection(d.workspace, 'workspace', request);
    if (!NAME.test(d.settingName ?? '') || !Number.isInteger(d.retentionDays) || d.retentionDays < 30 || d.retentionDays > 730 ||
        typeof d.dailyQuotaGb !== 'number' || d.dailyQuotaGb <= 0 || d.dailyQuotaGb > 100) throw new Error('Explicit diagnostics name, retention and daily quota required; quota is not a spending limit.');
  }
  if (request.legacyConfig !== undefined && (!path.isAbsolute(request.legacyConfig) || path.basename(request.legacyConfig) !== 'config.json')) throw new Error('Select an absolute legacy config.json path.');
  request.tenantId = request.tenantId.toLowerCase(); request.subscriptionId = request.subscriptionId.toLowerCase();
  request.managerObjectIds = request.managerObjectIds.map(id => id.toLowerCase());
  request.allowedClientIds = request.allowedClientIds.map(id => id.toLowerCase());
  for (const selected of [request.application, ...request.readerGroups]) if (selected.id) selected.id = selected.id.toLowerCase();
  return request;
}
export function initialInventory(request, now = new Date().toISOString()) {
  validateRequest(request);
  const resources = {};
  for (const role of ['resourceGroup', 'plan', 'identity', 'application', 'site', ...request.readerGroups.map((_, i) => `readerGroup${i}`),
    ...(request.diagnostics.mode === 'enabled' ? ['workspace'] : [])]) {
    const desired = role.startsWith('readerGroup') ? request.readerGroups[Number(role.slice(11))] :
      role === 'workspace' ? request.diagnostics.workspace : request[role];
    resources[role] = { desired, observed: null, status: 'unverified', ownership: 'unknown', createdBySetup: false, observedAt: null, source: null };
  }
  resources.servicePrincipal = { desired: { mode: 'create-or-reuse-for-selected-application' }, observed: null, status: 'unverified',
    ownership: 'unknown', createdBySetup: false, observedAt: null, source: null };
  return { schemaVersion: 1, setupId: randomUUID(), revision: 0, createdAt: now, updatedAt: now,
    sourceVersion: 'publish-html-onboarding-v1', request, requestSha256: hash(request), subscription: null,
    resources, dependencies: {}, policy: null, runtime: null, diagnostics: { status: request.diagnostics.mode === 'off' ? 'disabled' : 'unverified', capture: 'unverified' },
    gates: Object.fromEntries(GATES.map(key => [key, { status: 'pending', source: null, checkedAt: null, targetSha256: null, evidence: null }])),
    publisher: null, activation: { status: 'pending', targetSha256: null, verifiedAt: null },
    preview: null, operation: null, recovery: null, lastFailure: null };
}
export function validateInventory(value) {
  exact(value, ['schemaVersion', 'setupId', 'revision', 'createdAt', 'updatedAt', 'sourceVersion', 'request', 'requestSha256',
    'subscription', 'resources', 'dependencies', 'policy', 'runtime', 'diagnostics', 'gates', 'publisher', 'activation', 'preview', 'operation', 'recovery', 'lastFailure']);
  if (value.schemaVersion !== 1 || !GUID.test(value.setupId) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      value.sourceVersion !== 'publish-html-onboarding-v1' || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt)) ||
      !HASH.test(value.requestSha256) || value.requestSha256 !== hash(validateRequest(value.request))) throw new Error('Invalid inventory revision or request binding.');
  const baseline = initialInventory(value.request).resources;
  exact(value.resources, Object.keys(baseline));
  for (const [role, resource] of Object.entries(value.resources)) {
    exact(resource, ['desired', 'observed', 'status', 'ownership', 'createdBySetup', 'observedAt', 'source']);
    if (!['unverified', 'verified', 'absent', 'blocked', 'uncertain'].includes(resource.status) ||
        !['unknown', 'created', 'reused', 'external'].includes(resource.ownership) || typeof resource.createdBySetup !== 'boolean') throw new Error('Invalid resource provenance.');
    if (hash(resource.desired) !== hash(baseline[role].desired)) throw new Error('Resource selection differs from the frozen request.');
    if (resource.observed) {
      const observed = resource.observed;
      if (typeof observed.id !== 'string' || (ARM[role] !== undefined
        ? observed.id.toLowerCase() !== armId(value.request, role, resource.desired.name).toLowerCase()
        : !GUID.test(observed.id))) throw new Error('Observed resource identity is invalid.');
      if (role === 'application' && !GUID.test(observed.appId ?? '')) throw new Error('Observed application client GUID is invalid.');
      if (role === 'site' && !new RegExp(`^${value.request.site.name.toLowerCase()}(?:-[a-z0-9]+)?(?:\\.[a-z0-9-]+)?\\.azurewebsites\\.net$`).test(observed.hostname ?? '')) throw new Error('Observed site hostname does not match the selected site.');
    }
  }
  exact(value.gates, GATES);
  for (const gate of Object.values(value.gates)) {
    exact(gate, ['status', 'source', 'checkedAt', 'targetSha256', 'evidence']);
    if (!['pending', 'passed', 'failed'].includes(gate.status)) throw new Error('Invalid acceptance gate.');
  }
  exact(value.activation, ['status', 'targetSha256', 'verifiedAt']);
  if (!['pending', 'verified'].includes(value.activation.status)) throw new Error('Invalid activation status.');
  // Persisted previews are never executed as commands. The stage planner regenerates them.
  if (value.preview && (!STAGES.includes(value.preview.stage) || !HASH.test(value.preview.sha256 ?? ''))) throw new Error('Invalid setup preview.');
  if (value.operation) {
    exact(value.operation, ['stage', 'kind', 'details', 'status', 'startedAt', 'previewSha256'], ['completedAt']);
    if (!STAGES.includes(value.operation.stage) || !['started', 'uncertain', 'verified', 'denied', 'reconciled'].includes(value.operation.status) ||
        !['create', 'identity', 'consent', 'deployment', 'diagnostics', 'acceptance', 'activation'].includes(value.operation.kind) ||
        value.operation.details?.kind !== value.operation.kind || !HASH.test(value.operation.previewSha256 ?? '')) throw new Error('Invalid operation journal.');
  }
  if (!['disabled', 'unverified', 'routing-observed'].includes(value.diagnostics.status) || value.diagnostics.capture !== 'unverified') throw new Error('Invalid diagnostics observation.');
  if (value.recovery) {
    exact(value.recovery, ['kind', 'siteId', 'originalScm', 'releaseSha256', 'previousStartup', 'createdAt', 'readerSha256']);
    const scm = value.recovery.originalScm;
    exact(scm, ['scmIpSecurityRestrictions', 'scmIpSecurityRestrictionsDefaultAction', 'scmIpSecurityRestrictionsUseMain']);
    if (value.recovery.kind !== 'scm' || value.recovery.siteId.toLowerCase() !== armId(value.request, 'site', value.request.site.name).toLowerCase() ||
        scm.scmIpSecurityRestrictionsDefaultAction !== 'Deny' || scm.scmIpSecurityRestrictionsUseMain !== false ||
        !Array.isArray(scm.scmIpSecurityRestrictions) || scm.scmIpSecurityRestrictions.some(rule => rule.action !== 'Deny') ||
        !HASH.test(value.recovery.releaseSha256) || !HASH.test(value.recovery.readerSha256)) throw new Error('Invalid closed SCM recovery scope.');
  }
  return value;
}
export async function safePath(filename) {
  if (!path.isAbsolute(filename) || path.resolve(filename) !== filename) throw new Error('Use an absolute normalized private config path.');
  if (filename === skillRoot || filename.startsWith(skillRoot + path.sep)) throw new Error('Config must be outside the plugin.');
  let current = path.dirname(filename);
  while (true) {
    try {
      const st = await lstat(current);
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('Private config parents must be real directories.');
      try { await access(path.join(current, '.git')); throw new Error('Config must be outside all Git checkouts.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  try { const st = await lstat(filename); if (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1) throw new Error('Config must be a regular, nonlinked file.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
// Only current-user, SYSTEM and local Administrators grants are accepted on Windows.
export const WINDOWS_ACL = String.raw`
$ErrorActionPreference='Stop'
$p=$env:HTML_SETUP_ACL_PATH
$me=[Security.Principal.WindowsIdentity]::GetCurrent().User
$allowed=@($me.Value,'S-1-5-18','S-1-5-32-544')
if ($env:HTML_SETUP_ACL_CREATE -eq 'true') {
  $acl=Get-Acl -LiteralPath $p
  $acl.SetAccessRuleProtection($true,$false)
  foreach($r in @($acl.Access)){[void]$acl.RemoveAccessRuleSpecific($r)}
  $inherit=if((Get-Item -LiteralPath $p) -is [IO.DirectoryInfo]){[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{[Security.AccessControl.InheritanceFlags]::None}
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($me,'FullControl',$inherit,[Security.AccessControl.PropagationFlags]::None,'Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $p -AclObject $acl
}
$acl=Get-Acl -LiteralPath $p
if(!$acl.AreAccessRulesProtected){throw 'Inherited private ACL is unsupported'}
foreach($r in $acl.Access){
  $sid=$r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if($r.AccessControlType -eq 'Allow' -and $sid -notin $allowed){throw 'Private ACL has another reader'}
}
$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
if($owner -notin $allowed){throw 'Private ACL owner is unsupported'}
if(!@($acl.Access|Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $me.Value -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl}).Count){throw 'Current-user access is missing'}
`;
export async function protect(filename, create = false, { platform = process.platform, run = exec } = {}) {
  if (platform === 'win32') {
    try { await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_ACL], {
      windowsHide: true, timeout: 15000, maxBuffer: 4096,
      env: { ...process.env, HTML_SETUP_ACL_PATH: filename, HTML_SETUP_ACL_CREATE: String(create) },
    }); } catch { throw new Error('Private Windows DACL could not be established or verified. No cloud operation is permitted.'); }
  } else {
    const st = await lstat(filename);
    if (st.uid !== process.getuid()) throw new Error('Private config must be owned by the current user.');
    if (create) await chmod(filename, st.isDirectory() ? 0o700 : 0o600);
    if ((await lstat(filename)).mode & 0o077) throw new Error('Private config permissions allow other users.');
  }
}
export async function readPrivate(filename) {
  await safePath(filename); await protect(path.dirname(filename)); await protect(filename);
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) throw new Error('Invalid or oversized private JSON.');
    return JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
}
export async function withInventory(filename, request, work, options = {}) {
  await safePath(filename);
  const parent = path.dirname(filename);
  try { await mkdir(parent, { mode: 0o700 }); await protect(parent, true, options); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await protect(parent, false, options); }
  const lockname = `${filename}.lock`;
  let lock;
  try { lock = await open(lockname, 'wx', 0o600); await protect(lockname, true, options); }
  catch (error) { if (lock) { await lock.close(); await unlink(lockname); } throw new Error('Private setup lock unavailable. Inspect an interrupted setup; never steal its lock.'); }
  try {
    let inventory;
    try { inventory = validateInventory(await readPrivate(filename)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!request) throw new Error('No onboarding inventory exists; first plan with a private request.');
      inventory = initialInventory(request);
    }
    if (request && hash(request) !== inventory.requestSha256) throw new Error('Request differs from saved inventory. Preserve this inventory and choose a new config for a different scope.');
    let persisted = inventory.revision === 0 ? null : inventory.revision;
    async function save() {
      await safePath(filename);
      let existing;
      try { existing = validateInventory(await readPrivate(filename)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if ((existing?.revision ?? null) !== persisted) throw new Error('Inventory changed concurrently.');
      const next = structuredClone(inventory);
      next.revision++; next.updatedAt = new Date().toISOString();
      validateInventory(next);
      const temporary = `${filename}.${randomUUID()}.new`;
      const file = await open(temporary, 'wx', 0o600);
      try { await protect(temporary, true, options); await file.writeFile(JSON.stringify(next, null, 2) + '\n'); await file.sync(); }
      finally { await file.close(); }
      try {
        if (existing) {
          const previous = `${filename}.previous`;
          await safePath(previous);
          const backup = await open(previous, 'w', 0o600);
          try { await protect(previous, true, options); await backup.writeFile(JSON.stringify(existing, null, 2) + '\n'); await backup.sync(); }
          finally { await backup.close(); }
        }
        await rename(temporary, filename);
        if (process.platform !== 'win32') {
          const directory = await open(await realpath(parent), constants.O_RDONLY);
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } catch {
        throw new Error('Inventory replacement could not be verified. Preserve the current, .previous and .new files; stop cloud operations.');
      }
      Object.assign(inventory, next); persisted = next.revision;
    }
    if (persisted === null) await save();
    return await work(inventory, save);
  } finally { await lock.close(); await unlink(lockname); }
}
export function targetHash(inventory) {
  const resources = Object.fromEntries(Object.entries(inventory.resources).map(([role, item]) => [role,
    { observed: item.observed && Object.fromEntries(Object.entries(item.observed).filter(([key]) => key !== 'etag')),
      ownership: item.ownership, status: item.status }]));
  const policy = inventory.policy && structuredClone(inventory.policy);
  if (policy) for (const name of ['HTML_MANAGER_MUTATIONS_ENABLED', 'HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN']) delete policy.settings[name];
  return hash({ request: inventory.requestSha256, resources, dependencies: inventory.dependencies,
    policy, runtime: inventory.runtime });
}
export function acceptanceComplete(inventory, now = Date.now()) {
  const target = targetHash(inventory);
  return GATES.every(name => {
    const gate = inventory.gates[name], age = now - Date.parse(gate.checkedAt);
    return gate.status === 'passed' && gate.targetSha256 === target && Number.isFinite(age) && age >= 0 && age < 24 * 3600000 &&
      (name !== 'native-manager-obo' || gate.source === 'publisher-probe');
  });
}
export function isExistingHost(value) {
  return value?.sourceVersion === 'htmlpub-existing-host-v1';
}
export function existingHostHash(value) {
  return hash({ publisher: value.publisher, resources: value.resources, runtime: value.runtime });
}
export function validateExistingHost(value) {
  exact(value, ['schemaVersion', 'sourceVersion', 'publisher', 'resources', 'runtime', 'checks']);
  if (value.schemaVersion !== 1 || !isExistingHost(value)) throw new Error('Unsupported existing-host config.');
  exact(value.publisher, ['origin', 'tenantId', 'apiClientId'], ['transport']);
  if (value.publisher.transport !== undefined && !['bearer', 'browser'].includes(value.publisher.transport)) throw new Error('Choose bearer or browser publishing explicitly.');
  const { origin, tenantId, apiClientId } = value.publisher;
  let url;
  try { url = new URL(origin); } catch { throw new Error('Existing-host origin is invalid.'); }
  if (url.origin !== origin || url.protocol !== 'https:' || url.port || url.username || url.password ||
      !/^[a-z0-9][a-z0-9.-]*\.azurewebsites\.net$/.test(url.hostname) || url.hostname.includes('.scm.') ||
      !GUID.test(tenantId) || !GUID.test(apiClientId)) throw new Error('Exact existing-host origin and tenant/application GUIDs required.');
  exact(value.resources, ['site', 'application'], ['resourceGroup', 'plan', 'identity', 'servicePrincipal', 'workspace', 'readerGroups']);
  const evidence = text => typeof text === 'string' && text.length >= 10 && text.length <= 500 && !/[\r\n\0]/.test(text);
  const time = text => typeof text === 'string' && Number.isFinite(Date.parse(text)) && Date.parse(text) <= Date.now();
  for (const [role, resource] of Object.entries(value.resources)) {
    if (role === 'readerGroups' && (!Array.isArray(resource) || !resource.length)) throw new Error('Observed reader groups must be a nonempty list.');
    for (const item of role === 'readerGroups' ? resource : [resource]) {
      exact(item, ['id', 'name', 'type', 'location', 'ownership', 'observedAt', 'evidence'], ['appId', 'hostname']);
      const unknownApplicationId = role === 'application' && item.id === null;
      const unknownApplicationName = role === 'application' && item.name === null;
      if ((!unknownApplicationId && (typeof item.id !== 'string' || !(GUID.test(item.id) ||
          /^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[A-Za-z0-9_.()-]+(?:\/providers\/[A-Za-z0-9.]+\/[A-Za-z0-9]+\/[A-Za-z0-9_-]+)?$/i.test(item.id)))) ||
          (!unknownApplicationName && (typeof item.name !== 'string' || !item.name || item.name.length > 256 || /[\r\n\0]/.test(item.name))) ||
          typeof item.type !== 'string' || !item.type || item.type.length > 128 ||
          (item.location !== null && (typeof item.location !== 'string' || !/^[a-z0-9 -]{1,60}$/.test(item.location))) ||
          !['reused', 'external', 'unknown'].includes(item.ownership) || !time(item.observedAt) || !evidence(item.evidence)) throw new Error('Existing resource observations are incomplete.');
    }
  }
  const site = value.resources.site, application = value.resources.application;
  if (site.type !== 'Microsoft.Web/sites' || !/^[a-z0-9][a-z0-9-]{1,59}$/.test(site.name) ||
      !site.id.toLowerCase().endsWith(`/providers/microsoft.web/sites/${site.name.toLowerCase()}`) ||
      site.hostname !== url.hostname || !new RegExp(`^${site.name}(?:-[a-z0-9]+)?(?:\\.[a-z0-9-]+)?\\.azurewebsites\\.net$`).test(url.hostname) ||
      application.type !== 'Microsoft.Graph/applications' || (application.id !== null && !GUID.test(application.id)) || application.appId !== apiClientId) {
    throw new Error('Existing publisher target differs from the observed site/application.');
  }
  exact(value.runtime, ['files', 'startup', 'verifiedAt', 'evidence']);
  const names = ['auth.mjs', 'client-protocol.mjs', 'common.mjs', 'config.mjs', 'manager-ui.mjs',
    'manager.html', 'png.mjs', 'server.mjs', 'store.mjs', 'start-host.mjs'];
  if (!Array.isArray(value.runtime.files) || value.runtime.files.length < 9 ||
      value.runtime.files.length > 10 || new Set(value.runtime.files.map(item => item.name)).size !== value.runtime.files.length ||
      names.slice(0, 9).some(name => !value.runtime.files.some(item => item.name === name)) ||
      typeof value.runtime.startup !== 'string' || !value.runtime.startup || value.runtime.startup.length > 512 ||
      !time(value.runtime.verifiedAt) || !evidence(value.runtime.evidence)) throw new Error('Existing runtime observations are incomplete.');
  for (const file of value.runtime.files) {
    exact(file, ['name', 'sha256']);
    if (!names.includes(file.name) || !HASH.test(file.sha256)) throw new Error('Unsupported existing runtime file.');
  }
  exact(value.checks, ['inventory', 'publication']);
  exact(value.checks.inventory, ['checkedAt', 'evidence', 'targetSha256'], ['actorObjectId']);
  exact(value.checks.publication, ['checkedAt', 'evidence', 'targetSha256', 'transactionId', 'name', 'sha256'], ['actorObjectId']);
  for (const check of Object.values(value.checks)) {
    if (!time(check.checkedAt) || !evidence(check.evidence) || check.targetSha256 !== existingHostHash(value)) throw new Error('Real target-bound existing-host check evidence is required.');
    if (check.actorObjectId !== undefined && check.actorObjectId !== null && !GUID.test(check.actorObjectId)) throw new Error('Observed check actor must be an object GUID or explicitly unknown.');
  }
  const published = value.checks.publication;
  if (!GUID.test(published.transactionId) || !/^[A-Za-z0-9][A-Za-z0-9_-]*\.html$/.test(published.name) ||
      !HASH.test(published.sha256)) throw new Error('Verified publication receipt is required; token issuance is insufficient.');
  return value;
}
export async function publisherTarget(filename, action) {
  const saved = await readPrivate(path.resolve(filename));
  if (isExistingHost(saved)) {
    const profile = validateExistingHost(saved);
    if (action !== 'inventory') {
      for (const check of [profile.runtime, ...Object.values(profile.checks)]) {
        const age = Date.now() - Date.parse(check.verifiedAt ?? check.checkedAt);
        if (age < 0 || age >= 86400000) throw new Error('Existing-host verification is stale. Ask the host owner to check publishing again.');
      }
      for (const name of ['auth.mjs', 'server.mjs']) {
        const source = await readFile(path.resolve(skillRoot, 'scripts/hosted-manager', name));
        const accepted = [hash(source)];
        if (name === 'auth.mjs' && profile.publisher.transport === 'browser') {
          const browserCompatible = source.toString('utf8')
            .replace('    const platformOid = easyAuthIdentity(headers, config);\n    const assertion = headers.authorization.slice(7);',
              '    const assertion = headers.authorization.slice(7);')
            .replace("    if (oid !== platformOid) fail(403, 'principal-binding', 'Platform identity and delegated assertion must identify the same user.');\n", '');
          accepted.push(hash(Buffer.from(browserCompatible)));
        }
        if (!accepted.includes(profile.runtime.files.find(file => file.name === name)?.sha256)) throw new Error('Existing host authorization runtime differs from this publisher. Ask the host owner to verify the selected release.');
      }
    }
    const { transport, ...publisher } = profile.publisher;
    return { ...publisher, ...(transport === 'browser' ? { browser: true } : {}) };
  }
  const inventory = validateInventory(saved);
  if (!inventory.publisher || inventory.recovery || ['started', 'uncertain'].includes(inventory.operation?.status)) throw new Error('Publisher target is unverified or setup recovery is pending.');
  const { origin, tenantId, apiClientId } = inventory.publisher;
  const host = inventory.resources.site.observed?.hostname;
  if (!/^[a-z0-9][a-z0-9.-]*\.azurewebsites\.net$/.test(host ?? '') || host.includes('.scm.') ||
      origin !== `https://${host}` || tenantId !== inventory.request.tenantId ||
      apiClientId !== inventory.resources.application.observed?.appId) throw new Error('Publisher target does not match observed resources.');
  if (action !== 'inventory' && (!acceptanceComplete(inventory) || inventory.activation.status !== 'verified' ||
      inventory.activation.targetSha256 !== targetHash(inventory))) throw new Error('Publishing acceptance/activation is pending, stale or failed. Setup never enables itself during publication.');
  return { origin, tenantId, apiClientId };
}
