import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { GUID, STAGES, GATES, exact, hash, armId, targetHash, acceptanceComplete, readPrivate } from './state.mjs';
import { GRAPH_APP_ID, runtimeManifest, unique } from './azure.mjs';
import { runPublisher } from '../hosted-manager/publish.mjs';

const runtimeDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../hosted-manager');
const now = () => new Date().toISOString();
const marker = inventory => `html-publisher-setup:${inventory.setupId}`;
const readerRule = { ipAddress: 'CorpNetPublic', tag: 'ServiceTag', action: 'Allow', priority: 100, name: 'Corporate readers' };
const deny = { ipAddress: 'Any', action: 'Deny', priority: 2147483647, name: 'Deny all' };
export const CLOSED_SCM = Object.freeze({ scmIpSecurityRestrictions: [deny], scmIpSecurityRestrictionsDefaultAction: 'Deny',
  scmIpSecurityRestrictionsUseMain: false });
function closedScm(web) {
  return web?.scmIpSecurityRestrictionsDefaultAction === 'Deny' && web.scmIpSecurityRestrictionsUseMain === false &&
    Array.isArray(web.scmIpSecurityRestrictions) && web.scmIpSecurityRestrictions.every(rule => rule.action === 'Deny');
}
function scm(web) {
  return { scmIpSecurityRestrictions: web.scmIpSecurityRestrictions, scmIpSecurityRestrictionsDefaultAction: web.scmIpSecurityRestrictionsDefaultAction,
    scmIpSecurityRestrictionsUseMain: web.scmIpSecurityRestrictionsUseMain };
}
function approvedReaders(web) {
  const allows = web?.ipSecurityRestrictions?.filter(rule => rule.action === 'Allow');
  return web?.ipSecurityRestrictionsDefaultAction === 'Deny' && allows?.length === 1 &&
    allows[0].ipAddress === 'CorpNetPublic' && allows[0].tag === 'ServiceTag';
}
function observedResource(role, raw) {
  if (!raw || typeof raw.id !== 'string') throw new Error('Resource response has no authoritative ID.');
  if (role === 'application') return { id: raw.id.toLowerCase(), type: 'Microsoft.Graph/applications', name: raw.displayName, location: null,
    appId: raw.appId?.toLowerCase(), signInAudience: raw.signInAudience, identifierUris: raw.identifierUris ?? [],
    requestedAccessTokenVersion: raw.api?.requestedAccessTokenVersion ?? null,
    scopes: raw.api?.oauth2PermissionScopes ?? [], preAuthorizedApplications: raw.api?.preAuthorizedApplications ?? [],
    redirectUris: raw.web?.redirectUris ?? [], requiredResourceAccess: raw.requiredResourceAccess ?? [], tags: raw.tags ?? [] };
  if (role === 'servicePrincipal') return { id: raw.id.toLowerCase(), type: 'Microsoft.Graph/servicePrincipals', name: raw.displayName, location: null,
    appId: raw.appId?.toLowerCase(), accountEnabled: raw.accountEnabled };
  if (role.startsWith('readerGroup')) return { id: raw.id.toLowerCase(), type: 'Microsoft.Graph/groups', name: raw.displayName, location: null,
    securityEnabled: raw.securityEnabled, mailEnabled: raw.mailEnabled, description: raw.description ?? null };
  const base = { id: raw.id, type: raw.type ?? (role === 'resourceGroup' ? 'Microsoft.Resources/resourceGroups' : null),
    name: raw.name, location: raw.location ?? null, tags: raw.tags ?? {}, etag: raw.etag ?? null };
  const p = raw.properties ?? {};
  if (role === 'plan') return { ...base, reserved: p.reserved, sku: raw.sku ?? null };
  if (role === 'identity') return { ...base, clientId: p.clientId, principalId: p.principalId, tenantId: p.tenantId };
  if (role === 'site') return { ...base, hostname: p.defaultHostName ?? null, httpsOnly: p.httpsOnly,
    publicNetworkAccess: p.publicNetworkAccess ?? null, planId: p.serverFarmId ?? null, kind: raw.kind ?? null,
    identities: raw.identity?.userAssignedIdentities ?? {}, storage: 'app-service-home-volume-unverified' };
  if (role === 'workspace') return { ...base, workspaceId: p.customerId ?? null, retentionInDays: p.retentionInDays ?? null,
    publicNetworkAccessForIngestion: p.publicNetworkAccessForIngestion ?? null,
    publicNetworkAccessForQuery: p.publicNetworkAccessForQuery ?? null, workspaceCapping: p.workspaceCapping ?? null,
    sku: p.sku ?? null };
  return base;
}
function resourceReady(inventory, role) {
  const item = inventory.resources[role];
  if (item?.status !== 'verified' || !item.observed) throw new Error(`Pending prerequisite: ${role}. Plan/apply resources first.`);
  return item.observed;
}
function roles(inventory) { return Object.keys(inventory.resources).filter(role => role !== 'workspace'); }
async function observe(inventory, azure, role) {
  const item = inventory.resources[role];
  let raw;
  try {
    raw = role === 'servicePrincipal' ? inventory.resources.application.status === 'verified'
      ? await azure.sp(resourceReady(inventory, 'application').appId) : null : await azure.resource(role,
        item.observed && item.createdBySetup && ['application', ...Object.keys(inventory.resources).filter(key => key.startsWith('readerGroup'))].includes(role)
          ? { ...item.desired, mode: 'reuse', id: item.observed.id } : item.desired);
  } catch (error) {
    item.status = 'blocked'; item.observedAt = now(); item.source = role.includes('Group') || ['application', 'servicePrincipal'].includes(role) ? 'Microsoft Graph v1.0' : 'Azure Resource Manager';
    throw error;
  }
  item.observedAt = now(); item.source = role.includes('Group') || ['application', 'servicePrincipal'].includes(role) ? 'Microsoft Graph v1.0' : 'Azure Resource Manager';
  if (!raw) {
    if (item.createdBySetup || item.desired.mode === 'reuse') { item.status = 'blocked'; throw new Error(`Previously observed or explicitly reused ${role} is missing; do not recreate it.`); }
    item.status = 'absent'; item.observed = null; return;
  }
  const observed = observedResource(role, raw);
  if (raw.properties?.provisioningState && raw.properties.provisioningState !== 'Succeeded') {
    item.status = 'unverified'; item.observed = observed;
    throw new Error(`Provisioning ${role} is not complete. Resume with reviewed reconciliation, not another create.`);
  }
  if (item.observed && observed.id.toLowerCase() !== item.observed.id.toLowerCase()) throw new Error(`Observed ${role} changed identity.`);
  if (item.desired.mode === 'create' && !item.createdBySetup) {
    item.status = 'blocked'; item.observed = observed; item.ownership = 'unknown';
    throw new Error(`Name collision for ${role}; existing resources are never silently adopted.`);
  }
  if (item.desired.mode === 'reuse' && observed.id.toLowerCase() !== item.desired.id.toLowerCase()) throw new Error(`Observed ${role} does not match the selected ID.`);
  if (role === 'plan' && (!observed.reserved || observed.sku?.name !== item.desired.sku)) throw new Error('Linux plan and selected SKU must match; no resize fallback.');
  if (role === 'workspace' && (observed.retentionInDays !== inventory.request.diagnostics.retentionDays ||
      observed.workspaceCapping?.dailyQuotaGb !== inventory.request.diagnostics.dailyQuotaGb)) throw new Error('Reused workspace retention/quota differs; no automatic shared-workspace changes.');
  if (role === 'identity' && observed.tenantId?.toLowerCase() !== inventory.request.tenantId.toLowerCase()) throw new Error('Managed identity tenant differs.');
  if (observed.location && observed.location.replace(/\s/g, '').toLowerCase() !== inventory.request.location) throw new Error('Resource region differs from the selected region.');
  if (role.startsWith('readerGroup') && (!observed.securityEnabled || observed.mailEnabled)) throw new Error('Reader group must be a non-mail security group.');
  if (role === 'application' && (observed.signInAudience !== 'AzureADMyOrg' || !GUID.test(observed.appId))) throw new Error('Single-tenant application client identity required.');
  if (role === 'site' && (!(observed.kind ?? '').toLowerCase().split(',').includes('linux') || !/^[a-z0-9][a-z0-9.-]*\.azurewebsites\.net$/.test(observed.hostname ?? '') ||
      observed.hostname.includes('.scm.'))) throw new Error('Linux public-Azure default hostname required.');
  if (['plan', 'identity', 'site', 'workspace', 'resourceGroup'].includes(role) &&
      observed.id.toLowerCase() !== armId(inventory.request, role, item.desired.name).toLowerCase()) throw new Error('ARM returned an unexpected resource ID.');
  item.status = 'verified'; item.observed = observed; item.ownership = item.createdBySetup ? 'created' : role === 'servicePrincipal' ? 'external' : 'reused';
}
async function guardLegacy(inventory) {
  const selected = inventory.request.legacyConfig;
  if (!selected) return;
  await readPrivate(selected);
  for (const suffix of ['.recovery.json', '.lock']) {
    try { await access(selected + suffix); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    // The historical helper leaves an empty lock file after release, so a lock file alone is not proof of an active lock.
    if (suffix === '.recovery.json') throw new Error('Legacy SCM recovery is pending. Recover with the original helper/config first.');
  }
}
async function discovery(inventory, azure, stage) {
  await guardLegacy(inventory);
  inventory.subscription = { ...await azure.scope(), observedAt: now(), source: 'Azure CLI selected account' };
  const selected = stage === 'resources' ? roles(inventory) : Object.keys(inventory.resources).filter(role => role !== 'workspace' || stage === 'diagnostics');
  for (const role of selected) {
    if (role === 'servicePrincipal' && inventory.resources.application.status !== 'verified') continue;
    await observe(inventory, azure, role);
  }
}
async function policy(inventory, azure) {
  const site = resourceReady(inventory, 'site'), app = resourceReady(inventory, 'application'), identity = resourceReady(inventory, 'identity');
  const webRaw = await azure.arm('site', inventory.request.site, '/config/web');
  const authRaw = await azure.arm('site', inventory.request.site, '/config/authsettingsV2');
  const basicRaw = await azure.arm('site', inventory.request.site, '/basicPublishingCredentialsPolicies/scm');
  const settings = await azure.settings();
  const w = webRaw.properties ?? {}, a = authRaw.properties ?? {};
  const command = w.appCommandLine ?? '';
  const safeStartup = command === '' || /^node \/home\/site\/html-manager\/releases\/[a-f0-9]{64}\/start-host\.mjs$/.test(command);
  // Keep only owned policy fields. Never save a raw auth or appsettings response.
  const observed = { web: { ...scm(w), ipSecurityRestrictions: w.ipSecurityRestrictions ?? [],
    ipSecurityRestrictionsDefaultAction: w.ipSecurityRestrictionsDefaultAction ?? null,
    linuxFxVersion: w.linuxFxVersion ?? null, appCommandLine: safeStartup ? command : 'unmanaged-startup-not-captured',
    appCommandLineSha256: hash(command),
    azureStorageAccounts: Object.fromEntries(Object.entries(w.azureStorageAccounts ?? {}).map(([name, value]) => [name,
      { type: value.type ?? null, accountName: value.accountName ?? null, shareName: value.shareName ?? null, mountPath: value.mountPath ?? null }])) },
    auth: { enabled: a.platform?.enabled ?? false, requireAuthentication: a.globalValidation?.requireAuthentication ?? false,
      excludedPaths: a.globalValidation?.excludedPaths ?? [], unauthenticatedClientAction: a.globalValidation?.unauthenticatedClientAction ?? null,
      redirectToProvider: a.globalValidation?.redirectToProvider ?? null, requireHttps: a.httpSettings?.requireHttps ?? null,
      tokenStore: a.login?.tokenStore?.enabled ?? false, externalRedirects: a.login?.allowedExternalRedirectUrls ?? [],
      aadEnabled: a.identityProviders?.azureActiveDirectory?.enabled ?? false,
      clientId: a.identityProviders?.azureActiveDirectory?.registration?.clientId ?? null,
      issuer: a.identityProviders?.azureActiveDirectory?.registration?.openIdIssuer ?? null,
      clientSecretSettingName: a.identityProviders?.azureActiveDirectory?.registration?.clientSecretSettingName ?? null,
      audiences: a.identityProviders?.azureActiveDirectory?.validation?.allowedAudiences ?? [],
      defaultAuthorizationPolicy: a.identityProviders?.azureActiveDirectory?.validation?.defaultAuthorizationPolicy ?? null,
      loginParameters: a.identityProviders?.azureActiveDirectory?.login?.loginParameters ?? [] },
    basicScmAllowed: basicRaw.properties?.allow ?? null, settings, authSha256: hash(a) };
  inventory.policy = observed;
  inventory.publisher = { origin: `https://${site.hostname}`, tenantId: inventory.request.tenantId, apiClientId: app.appId };
  if (site.planId?.toLowerCase() !== resourceReady(inventory, 'plan').id.toLowerCase()) throw new Error('Site uses another service plan; no migration is permitted.');
  if (!closedScm(w) || (basicRaw.properties?.allow !== false && !(inventory.resources.site.createdBySetup && site.publicNetworkAccess === 'Disabled'))) throw new Error('SCM must already be deny-only with basic authentication disabled.');
  if (observed.web.linuxFxVersion !== 'NODE|24-lts' && !inventory.resources.site.createdBySetup) throw new Error('Reused site must already use Linux Node.js 24.');
  if (!Object.keys(site.identities).some(id => id.toLowerCase() === identity.id.toLowerCase())) throw new Error('Selected managed identity must already be attached; do not replace unrelated identities.');
  return observed;
}
function expectedSettings(inventory) {
  const app = resourceReady(inventory, 'application'), identity = resourceReady(inventory, 'identity');
  const groups = inventory.request.readerGroups.map((_, i) => resourceReady(inventory, `readerGroup${i}`).id);
  return { TENANT_ID: inventory.request.tenantId, ALLOWED_GROUP_IDS: groups.join(','),
    OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID: identity.clientId, HTML_MANAGER_OBJECT_IDS: inventory.request.managerObjectIds.join(','),
    HTML_MANAGER_ORIGIN: inventory.publisher.origin, HTML_CONTENT_DIR: '/home/site/wwwroot/content',
    HTML_MANAGER_STATE_DIR: '/home/site/html-manager/state', HTML_MANAGER_MUTATIONS_ENABLED: 'false',
    HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN: 'true', HTML_MANAGER_OWN_API_ENABLED: 'true', HTML_MANAGER_API_CLIENT_ID: app.appId,
    HTML_MANAGER_ALLOWED_CLIENT_IDS: inventory.request.allowedClientIds.join(','), HTML_MANAGER_MI_CLIENT_ID: identity.clientId };
}
function assertPolicy(inventory) {
  const p = inventory.policy, app = resourceReady(inventory, 'application'), r = inventory.request;
  if (!p || p.auth.enabled !== true || !p.auth.requireAuthentication || !p.auth.aadEnabled ||
      p.auth.clientId !== app.appId || p.auth.issuer !== `https://login.microsoftonline.com/${r.tenantId}/v2.0` ||
      p.auth.clientSecretSettingName !== 'OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID' ||
      p.auth.audiences.length !== 1 || p.auth.audiences[0] !== app.appId || p.auth.excludedPaths.length ||
      p.auth.externalRedirects.length || !p.auth.tokenStore || !p.auth.requireHttps ||
      p.auth.unauthenticatedClientAction !== 'RedirectToLoginPage' || p.auth.redirectToProvider !== 'azureactivedirectory' ||
      !approvedReaders(p.web) || p.basicScmAllowed !== false || !closedScm(p.web) ||
      !resourceReady(inventory, 'site').httpsOnly || resourceReady(inventory, 'site').publicNetworkAccess !== 'Enabled') throw new Error('Host policy is not the approved tenant/corporate/secretless policy. Identity stage or host-owner review required.');
  const desired = expectedSettings(inventory);
  for (const [key, value] of Object.entries(desired)) {
    if (['HTML_MANAGER_MUTATIONS_ENABLED', 'HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN'].includes(key)) continue;
    if (p.settings[key]?.value !== value) throw new Error(`Host setting differs: ${key}. No automatic repair during publication/deployment.`);
  }
}
function resourceOperation(inventory, role) {
  const r = inventory.request, desired = inventory.resources[role].desired, tags = { 'html-publisher-setup': inventory.setupId };
  if (role === 'application') return { kind: 'create', role, body: { displayName: desired.name, signInAudience: 'AzureADMyOrg',
    tags: [marker(inventory)], api: { requestedAccessTokenVersion: 2 } } };
  if (role === 'servicePrincipal') return { kind: 'create', role, body: { appId: resourceReady(inventory, 'application').appId } };
  if (role.startsWith('readerGroup')) return { kind: 'create', role, body: { displayName: desired.name, mailEnabled: false,
    mailNickname: desired.name, securityEnabled: true, description: marker(inventory) } };
  if (role === 'resourceGroup') return { kind: 'create', role, body: { location: r.location, tags } };
  if (role === 'plan') return { kind: 'create', role, body: { location: r.location, tags, kind: 'linux', sku: { name: desired.sku },
    properties: { reserved: true } } };
  if (role === 'identity') return { kind: 'create', role, body: { location: r.location, tags } };
  if (role === 'workspace') return { kind: 'create', role, body: { location: r.location, tags, properties: {
    sku: { name: 'PerGB2018' }, retentionInDays: r.diagnostics.retentionDays,
    workspaceCapping: { dailyQuotaGb: r.diagnostics.dailyQuotaGb } } } };
  return { kind: 'create', role: 'site', body: { location: r.location, tags, kind: 'app,linux',
    identity: { type: 'UserAssigned', userAssignedIdentities: { [resourceReady(inventory, 'identity').id]: {} } },
    properties: { serverFarmId: resourceReady(inventory, 'plan').id, httpsOnly: true, publicNetworkAccess: 'Disabled',
      siteConfig: { linuxFxVersion: 'NODE|24-lts', ...CLOSED_SCM, ipSecurityRestrictions: [deny],
        ipSecurityRestrictionsDefaultAction: 'Deny', ftpsState: 'Disabled' } } } };
}
async function identityOperation(inventory, azure) {
  const r = inventory.request, app = resourceReady(inventory, 'application'), identity = resourceReady(inventory, 'identity');
  const site = resourceReady(inventory, 'site');
  const graph = await azure.sp(GRAPH_APP_ID);
  const userRead = graph?.oauth2PermissionScopes?.find(scope => scope.value === 'User.Read' && scope.isEnabled);
  if (!GUID.test(userRead?.id ?? '') || !GUID.test(graph?.id ?? '')) throw new Error('Required delegated Graph User.Read metadata is unverified.');
  const managers = [];
  for (const id of r.managerObjectIds) {
    const user = await azure.graph('users', { id, query: '?$select=id' });
    if (user?.id?.toLowerCase() !== id.toLowerCase()) throw new Error('Manager user reference does not match.');
    managers.push({ id: user.id, type: 'Microsoft.Graph/users', status: 'verified', source: 'Microsoft Graph v1.0' });
  }
  const clients = [];
  for (const id of r.allowedClientIds) {
    const sp = await azure.sp(id);
    if (!sp || sp.accountEnabled !== true) throw new Error('Approved delegated client service principal is absent or disabled.');
    clients.push({ id: sp.id, appId: sp.appId, type: 'Microsoft.Graph/servicePrincipals', status: 'verified', source: 'Microsoft Graph v1.0' });
  }
  inventory.dependencies = { ...inventory.dependencies, graph: { id: graph.id, appId: GRAPH_APP_ID, delegatedUserReadId: userRead.id },
    managers, clients };
  const scopes = app.scopes.filter(scope => scope.value === 'publish_as_user');
  if (scopes.length > 1 || (scopes.length && (!scopes[0].isEnabled || scopes[0].type !== 'Admin'))) throw new Error('Existing publish_as_user scope conflicts.');
  const scopeId = scopes[0]?.id ?? inventory.dependencies.publishScope?.desiredId ?? randomUUID();
  inventory.dependencies.publishScope = { desiredId: scopeId, observedId: scopes[0]?.id ?? null,
    status: scopes.length ? 'verified' : 'unverified', source: scopes.length ? 'Microsoft Graph v1.0' : 'local desired scope, not provisioned' };
  const required = app.requiredResourceAccess;
  const graphAccess = required.find(resource => resource.resourceAppId === GRAPH_APP_ID);
  if (required.filter(resource => resource.resourceAppId === GRAPH_APP_ID).length > 1) throw new Error('Conflicting Graph permission metadata.');
  const requiredResourceAccess = graphAccess ? required.map(resource => resource !== graphAccess ? resource :
    { ...resource, resourceAccess: resource.resourceAccess.some(item => item.id === userRead.id && item.type === 'Scope')
      ? resource.resourceAccess : [...resource.resourceAccess.filter(item => item.id !== userRead.id), { id: userRead.id, type: 'Scope' }] }) :
    [...required, { resourceAppId: GRAPH_APP_ID, resourceAccess: [{ id: userRead.id, type: 'Scope' }] }];
  const existingFics = await azure.graph('applications', { id: app.id, child: 'federatedIdentityCredentials' });
  if (!Array.isArray(existingFics?.value) || existingFics['@odata.nextLink']) throw new Error('Incomplete federation metadata.');
  const fic = { name: 'html-publisher-managed-identity', issuer: `https://login.microsoftonline.com/${r.tenantId}/v2.0`,
    subject: identity.principalId, audiences: ['api://AzureADTokenExchange'] };
  const existing = existingFics.value.find(item => item.name === fic.name);
  if (existing && (existing.issuer !== fic.issuer || existing.subject !== fic.subject || hash(existing.audiences) !== hash(fic.audiences))) throw new Error('Existing named federation credential conflicts. Do not overwrite it.');
  if (!existing && !inventory.resources.application.createdBySetup) throw new Error('Reused registration must already trust the selected managed identity. Host-owner review is required; no unmanaged federation write.');
  if (existing) inventory.dependencies.federation = { id: existing.id, ...fic, status: 'verified', source: 'Microsoft Graph v1.0' };
  const appBody = { identifierUris: [...new Set([...app.identifierUris, `api://${app.appId}`])],
    api: { requestedAccessTokenVersion: 2, oauth2PermissionScopes: scopes.length ? app.scopes : [...app.scopes,
      { id: scopeId, value: 'publish_as_user', type: 'Admin', isEnabled: true,
        adminConsentDisplayName: 'Publish trusted HTML as the signed-in user',
        adminConsentDescription: 'Use the protected HTML manager as the signed-in authorized user.' }],
    preAuthorizedApplications: app.preAuthorizedApplications },
    web: { redirectUris: [...new Set([...app.redirectUris, `${inventory.publisher.origin}/.auth/login/aad/callback`])] }, requiredResourceAccess };
  // Do not silently widen an unmanaged app's registration, callbacks or permissions.
  if (!inventory.resources.application.createdBySetup &&
      (hash({ ...appBody, api: { ...appBody.api, oauth2PermissionScopes: app.scopes } }) !== hash({
        identifierUris: app.identifierUris, api: { requestedAccessTokenVersion: app.requestedAccessTokenVersion,
          oauth2PermissionScopes: app.scopes, preAuthorizedApplications: app.preAuthorizedApplications },
        web: { redirectUris: app.redirectUris }, requiredResourceAccess: app.requiredResourceAccess }) || !scopes.length)) {
    throw new Error('Reused registration must already expose the exact callback, v2 scope and delegated Graph permission. Host-owner changes require a separate reviewed workflow.');
  }
  const auth = { platform: { enabled: true }, globalValidation: { requireAuthentication: true,
    unauthenticatedClientAction: 'RedirectToLoginPage', redirectToProvider: 'azureactivedirectory', excludedPaths: [] },
    httpSettings: { requireHttps: true, forwardProxy: { convention: 'NoProxy' } },
    login: { tokenStore: { enabled: true }, allowedExternalRedirectUrls: [] },
    identityProviders: { azureActiveDirectory: { enabled: true, registration: { clientId: app.appId,
      openIdIssuer: fic.issuer, clientSecretSettingName: 'OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID' },
    validation: { allowedAudiences: [app.appId] }, login: { loginParameters: ['scope=openid profile offline_access https://graph.microsoft.com/User.Read'] } } } };
  if (!inventory.resources.site.createdBySetup) {
    assertPolicy(inventory);
    return { kind: 'identity', appBody: inventory.resources.application.createdBySetup ? appBody : null,
      federation: existing ? null : fic, auth: null, settings: null, site: null };
  }
  if (!closedScm(inventory.policy.web)) throw new Error('SCM recovery is required before identity setup.');
  const settings = expectedSettings(inventory);
  return { kind: 'identity', appBody: inventory.resources.application.createdBySetup ? appBody : null,
    federation: existing ? null : fic, auth, settings,
    site: { httpsOnly: true, publicNetworkAccess: 'Enabled' },
    readerWeb: { ...CLOSED_SCM, ipSecurityRestrictions: [readerRule, deny], ipSecurityRestrictionsDefaultAction: 'Deny', linuxFxVersion: 'NODE|24-lts' },
    expected: { appId: app.appId, identityId: identity.id, siteId: site.id } };
}
async function verifyIdentity(inventory, azure) {
  const operation = await identityOperation(inventory, azure), app = resourceReady(inventory, 'application');
  if (operation.federation || inventory.dependencies.federation?.status !== 'verified' || app.requestedAccessTokenVersion !== 2 ||
      !app.identifierUris.includes(`api://${app.appId}`) || !app.redirectUris.includes(`${inventory.publisher.origin}/.auth/login/aad/callback`) ||
      !app.scopes.some(scope => scope.value === 'publish_as_user' && scope.type === 'Admin' && scope.isEnabled) ||
      !app.requiredResourceAccess.some(resource => resource.resourceAppId === GRAPH_APP_ID &&
        resource.resourceAccess.some(item => item.id === inventory.dependencies.graph.delegatedUserReadId && item.type === 'Scope'))) {
    throw new Error('Identity registration/scope/federation readback is pending. Apply the identity stage before proceeding.');
  }
}
async function consentOperation(inventory, azure) {
  if (!inventory.dependencies.graph) throw new Error('Plan/apply identity before consent.');
  const appSp = resourceReady(inventory, 'servicePrincipal'), graph = inventory.dependencies.graph;
  const needed = [{ clientId: appSp.id, resourceId: graph.id, scope: 'User.Read' },
    ...inventory.dependencies.clients.map(client => ({ clientId: client.id, resourceId: appSp.id, scope: 'publish_as_user' }))];
  const all = [];
  let next = null;
  for (const grant of needed) {
    const result = await azure.graph('oauth2PermissionGrants', { query: `?$filter=clientId eq '${grant.clientId}'&$select=id,clientId,resourceId,consentType,principalId,scope` });
    if (!Array.isArray(result?.value) || result['@odata.nextLink']) throw new Error('Consent metadata is incomplete.');
    all.push(...result.value.map(item => ({ id: item.id, clientId: item.clientId, resourceId: item.resourceId,
      consentType: item.consentType, principalId: item.principalId ?? null, scope: item.scope })));
    if (!result.value.some(item => item.resourceId === grant.resourceId && item.consentType === 'AllPrincipals' &&
        item.scope?.split(' ').includes(grant.scope))) {
      if (result.value.some(item => item.resourceId === grant.resourceId && item.consentType === 'AllPrincipals')) throw new Error('Existing consent grant has different scopes; administrator must review it without wholesale replacement.');
      next ??= { kind: 'consent', body: { ...grant, consentType: 'AllPrincipals' }, administratorApprovalRequired: true };
    }
  }
  inventory.dependencies.consentGrants = all;
  return next ?? { kind: 'none', reason: 'Exact delegated Graph and own-API client grants exist. Live OBO acceptance is still pending.' };
}
function effects(stage) {
  return { resources: 'Create the next resource you selected. Hosting and workspace billing can start before publishing checks pass.',
    identity: 'Update application federation, authentication, reader access and owned appsettings. Appsettings can restart the app. Group membership stays unchanged.',
    consent: 'Add the displayed delegated consent grant for the selected application. Administrator/user approval is still required.',
    deployment: 'Open SCM to corporate traffic temporarily, stage the hashed runtime, initialize selected directories and change startup. This restarts the app. Restore the original closed SCM rules afterward.',
    diagnostics: 'Export authentication logs. This can restart the app, incur charges and retain sensitive logs about other users. Workspace access/networking is inherited; public ingestion/query endpoints may be enabled. Quotas are not hard spending limits.',
    acceptance: 'Check manager inventory with the delegated publisher token on the approved host. Inventory retention can update host state. It will not publish a report or create a sign-in session.',
    activation: 'Enable publishing after a fresh publisher check and all required evidence pass. Legacy/manual writers must stay frozen.' }[stage];
}
export async function planStage(inventory, azure, stage) {
  if (!STAGES.includes(stage)) throw new Error('Select a finite documented setup stage.');
  if (inventory.recovery || inventory.operation?.status === 'uncertain' || inventory.operation?.status === 'started') throw new Error('Interrupted setup requires reviewed recovery before another plan/apply.');
  if (stage === 'diagnostics' && inventory.request.diagnostics.mode === 'off') return makePreview(inventory, stage, { kind: 'none', reason: 'Diagnostics explicitly disabled.' });
  await discovery(inventory, azure, stage);
  let operation;
  if (stage === 'resources') {
    const next = roles(inventory).find(role => inventory.resources[role].status === 'absent');
    operation = next ? resourceOperation(inventory, next) : { kind: 'none', reason: 'Required resources observed. Publishing acceptance remains separate.' };
  } else {
    roles(inventory).forEach(role => resourceReady(inventory, role));
    await policy(inventory, azure);
    if (stage === 'identity') operation = await identityOperation(inventory, azure);
    if (['consent', 'deployment', 'acceptance', 'activation', 'diagnostics'].includes(stage)) {
      assertPolicy(inventory);
      await verifyIdentity(inventory, azure);
    }
    if (stage === 'consent') operation = await consentOperation(inventory, azure);
    if (['acceptance', 'activation'].includes(stage) && (await consentOperation(inventory, azure)).kind !== 'none') throw new Error('Exact delegated Graph and selected own-API client consent is still pending.');
    if (stage === 'deployment') {
      if (inventory.policy.settings.HTML_MANAGER_MUTATIONS_ENABLED?.value !== 'false' ||
          inventory.policy.settings.HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN?.value !== 'true') throw new Error('Disable mutations and freeze every writer before deployment.');
      const manifest = await runtimeManifest(runtimeDirectory);
      if (inventory.policy.web.appCommandLine === 'unmanaged-startup-not-captured') throw new Error('Unmanaged startup was not captured or overwritten; host-owner migration required.');
      const startup = `node /home/site/html-manager/releases/${manifest.releaseSha256}/start-host.mjs`;
      const reuseRuntime = inventory.policy.web.appCommandLine === startup;
      if (!inventory.resources.site.createdBySetup && !reuseRuntime) throw new Error('Unmanaged runtime cannot be replaced. Host owner must perform a separately reviewed migration.');
      operation = { kind: 'deployment', manifest, previousStartup: inventory.policy.web.appCommandLine,
        contentDir: '/home/site/wwwroot/content', stateDir: '/home/site/html-manager/state',
        startup, reuseRuntime, originalScm: scm(inventory.policy.web) };
    }
    if (stage === 'diagnostics') operation = await diagnosticsOperation(inventory, azure);
    if (stage === 'acceptance') {
      if (!inventory.runtime?.verifiedAt) throw new Error('Verified runtime release required before the publisher check.');
      const manifest = await runtimeManifest(runtimeDirectory);
      if (inventory.runtime.releaseSha256 !== manifest.releaseSha256) throw new Error('The verified host runtime differs from this publisher release. Ask the host owner to update and verify it before checking publishing.');
      operation = { kind: 'acceptance', publisher: inventory.publisher, targetSha256: targetHash(inventory) };
    }
    if (stage === 'activation') {
      if (!acceptanceComplete(inventory)) throw new Error('The real publisher check and all other fresh target-bound checks must pass. No ready flag or token-issued evidence can bypass this.');
      operation = { kind: 'activation', settings: { HTML_MANAGER_MUTATIONS_ENABLED: 'true', HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN: 'true' } };
    }
  }
  return makePreview(inventory, stage, operation);
}
function binding(inventory) {
  return { target: targetHash(inventory), subscription: inventory.subscription && {
    id: inventory.subscription.id, tenantId: inventory.subscription.tenantId, environmentName: inventory.subscription.environmentName, state: inventory.subscription.state } };
}
function makePreview(inventory, stage, operation) {
  const scope = binding(inventory);
  const preview = { stage, createdAt: now(), expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
    scope, operation, effects: effects(stage), authorization: 'Digest binds scope only. It is not authenticated user authorization; obtain the required human/tool permissions.' };
  preview.sha256 = hash({ stage, scope, operation });
  inventory.preview = preview;
  return preview;
}
async function createResource(inventory, azure, operation) {
  const { role, body } = operation, item = inventory.resources[role];
  let raw;
  if (role === 'application') raw = await azure.graph('applications', { method: 'POST', body });
  else if (role === 'servicePrincipal') raw = await azure.graph('servicePrincipals', { method: 'POST', body });
  else if (role.startsWith('readerGroup')) raw = await azure.graph('groups', { method: 'POST', body });
  else raw = await azure.arm(role, item.desired, '', 'PUT', body);
  // Persist authoritative identity before a follow-up read. A response without one stays uncertain.
  const observed = observedResource(role, raw);
  item.observed = observed; item.createdBySetup = true; item.ownership = 'created'; item.status = 'unverified';
  item.observedAt = now(); item.source = 'create response; readback pending';
}
async function applyIdentity(inventory, azure, operation) {
  const app = resourceReady(inventory, 'application');
  if (operation.appBody) await azure.graph('applications', { id: app.id, method: 'PATCH', body: operation.appBody });
  if (operation.federation) {
    const fic = await azure.graph('applications', { id: app.id, child: 'federatedIdentityCredentials', method: 'POST', body: operation.federation });
    inventory.dependencies.federation = { id: fic?.id ?? null, ...operation.federation, status: fic?.id ? 'provisioned-unverified' : 'unverified', source: 'Microsoft Graph create response' };
    if (!fic?.id) throw new Error('Federation creation response was unverified.');
  }
  if (!operation.auth) return;
  await azure.arm('site', inventory.request.site, '/basicPublishingCredentialsPolicies/scm', 'PUT', { properties: { allow: false } });
  await azure.arm('site', inventory.request.site, '/basicPublishingCredentialsPolicies/ftp', 'PUT', { properties: { allow: false } });
  await azure.setSettings(operation.settings);
  await azure.arm('site', inventory.request.site, '/config/authsettingsV2', 'PUT', { properties: operation.auth });
  await azure.arm('site', inventory.request.site, '/config/web', 'PATCH', { properties: operation.readerWeb });
  await azure.arm('site', inventory.request.site, '', 'PATCH', { properties: operation.site });
}
async function restoreScm(inventory, azure, save) {
  if (!inventory.recovery) return;
  const recovery = inventory.recovery;
  if (recovery.kind !== 'scm' || !closedScm(recovery.originalScm) || recovery.siteId.toLowerCase() !== armId(inventory.request, 'site', inventory.request.site.name).toLowerCase()) throw new Error('Recovery scope is invalid; preserve evidence.');
  await azure.arm('site', inventory.request.site, '/config/web', 'PATCH', { properties: recovery.originalScm });
  const web = (await azure.arm('site', inventory.request.site, '/config/web')).properties;
  if (hash(scm(web)) !== hash(recovery.originalScm)) throw new Error('Closed SCM restoration could not be verified. Recovery remains pending.');
  inventory.recovery = null;
  await save();
}
async function deploy(inventory, azure, operation, save) {
  await azure.help(['webapp', 'deploy']);
  const manifest = await runtimeManifest(runtimeDirectory);
  if (hash(manifest) !== hash(operation.manifest)) throw new Error('Runtime source changed after preview.');
  inventory.recovery = { kind: 'scm', siteId: resourceReady(inventory, 'site').id,
    originalScm: operation.originalScm, releaseSha256: manifest.releaseSha256, previousStartup: operation.previousStartup,
    createdAt: now(), readerSha256: hash({ rules: inventory.policy.web.ipSecurityRestrictions, default: inventory.policy.web.ipSecurityRestrictionsDefaultAction }) };
  await save();
  try {
    await azure.arm('site', inventory.request.site, '/config/web', 'PATCH', { properties: {
      scmIpSecurityRestrictions: [{ ...readerRule, name: 'HTML onboarding deployment' }, deny],
      scmIpSecurityRestrictionsDefaultAction: 'Deny', scmIpSecurityRestrictionsUseMain: false } });
    const web = (await azure.arm('site', inventory.request.site, '/config/web')).properties;
    if (!approvedReaders({ ipSecurityRestrictions: web.scmIpSecurityRestrictions, ipSecurityRestrictionsDefaultAction: web.scmIpSecurityRestrictionsDefaultAction }) ||
        web.scmIpSecurityRestrictionsUseMain !== false ||
        hash({ rules: web.ipSecurityRestrictions, default: web.ipSecurityRestrictionsDefaultAction }) !== inventory.recovery.readerSha256) throw new Error('Temporary SCM or unchanged reader restrictions were not verified.');
    for (const file of manifest.files) {
      const remote = `/home/site/html-manager/releases/${manifest.releaseSha256}/${file.name}`;
      const local = path.join(runtimeDirectory, file.name);
      if (hash(await readFile(local)) !== file.sha256) throw new Error('Runtime file changed during deployment.');
      if (!operation.reuseRuntime) await azure.deploy(local, remote);
      if (await azure.readDeployed(resourceReady(inventory, 'site').hostname, remote, file.size) !== file.sha256) throw new Error('Runtime readback hash differs.');
    }
    if (!operation.reuseRuntime) await azure.arm('site', inventory.request.site, '/config/web', 'PATCH', { properties: { appCommandLine: operation.startup } });
    const startup = (await azure.arm('site', inventory.request.site, '/config/web')).properties?.appCommandLine;
    if (startup !== operation.startup) throw new Error('Selected runtime startup was not verified.');
    inventory.runtime = { ...manifest, startup, previousStartup: operation.previousStartup,
      contentDir: operation.contentDir, stateDir: operation.stateDir, volume: 'App Service /home; durability acceptance pending',
      verifiedAt: now(), source: 'Entra SCM byte readback and ARM startup readback' };
  } finally { await restoreScm(inventory, azure, save); }
}
async function diagnosticsOperation(inventory, azure) {
  if (inventory.resources.workspace.status === 'absent') return resourceOperation(inventory, 'workspace');
  const workspace = resourceReady(inventory, 'workspace');
  const categories = await azure.diagnostic('categories');
  if (!categories.value?.some(item => item.name === 'AppServiceAuthenticationLogs' && item.properties?.categoryType === 'Logs')) throw new Error('Authentication log category is unavailable. Do not substitute broader logs.');
  const settings = await azure.diagnostic('settings');
  if (!Array.isArray(settings.value)) throw new Error('Diagnostics routing metadata is unavailable.');
  const existing = settings.value.find(item => item.name === inventory.request.diagnostics.settingName);
  const body = { properties: { workspaceId: workspace.id, logAnalyticsDestinationType: 'Dedicated',
    logs: [{ category: 'AppServiceAuthenticationLogs', enabled: true }], metrics: [] } };
  if (existing && hash({ workspaceId: existing.properties.workspaceId, logAnalyticsDestinationType: existing.properties.logAnalyticsDestinationType,
    logs: existing.properties.logs.filter(item => item.enabled).map(({ category, enabled }) => ({ category, enabled })),
    metrics: (existing.properties.metrics ?? []).filter(item => item.enabled) }) !== hash(body.properties)) throw new Error('Named unmanaged diagnostics setting conflicts. Preserve existing routing.');
  inventory.diagnostics = { status: existing ? 'routing-observed' : 'unverified', capture: 'unverified',
    workspaceId: workspace.id, inheritedAccess: 'unverified; not exclusive', networking: {
      ingestion: workspace.publicNetworkAccessForIngestion, query: workspace.publicNetworkAccessForQuery },
    retentionDays: workspace.retentionInDays, dailyQuotaGb: workspace.workspaceCapping?.dailyQuotaGb ?? null,
    hardSpendingLimit: false, observedAt: now(), source: 'ARM diagnostics metadata' };
  const traceReady = inventory.policy.settings.WEBSITE_AUTH_AAD_TRACE_LEVEL?.value === 'Information';
  return existing && traceReady ? { kind: 'none', reason: 'Exact diagnostic routing and trace setting exist; capture remains unverified.' } :
    { kind: 'diagnostics', body: existing ? null : body, settings: { WEBSITE_AUTH_AAD_TRACE_LEVEL: 'Information' } };
}
export async function applyStage(inventory, azure, stage, approved, save, { nativeProbe = runPublisher, nativeTransport } = {}) {
  const old = inventory.preview;
  if (!old || old.stage !== stage || old.sha256 !== approved || Date.now() >= Date.parse(old.expiresAt)) throw new Error('A fresh exact stage preview and scope digest are required. The digest does not replace human authorization.');
  const fresh = await planStage(inventory, azure, stage);
  if (fresh.sha256 !== old.sha256) { await save(); throw new Error('Target or operation drifted; review and approve the new preview.'); }
  const operation = fresh.operation;
  if (operation.kind === 'none') { await save(); return { status: 'no-change', reason: operation.reason, acceptance: 'pending-unless-separately-proven' }; }
  inventory.operation = { stage, kind: operation.kind, details: operation, status: 'started', startedAt: now(), previewSha256: approved };
  inventory.preview = null;
  await save();
  try {
    if (operation.kind === 'create') {
      await createResource(inventory, azure, operation);
      await save();
      await observe(inventory, azure, operation.role);
    }
    if (operation.kind === 'identity') {
      await applyIdentity(inventory, azure, operation);
      await discovery(inventory, azure, stage); await policy(inventory, azure); assertPolicy(inventory);
      await verifyIdentity(inventory, azure);
    }
    if (operation.kind === 'consent') {
      const grant = await azure.graph('oauth2PermissionGrants', { method: 'POST', body: operation.body });
      if (typeof grant?.id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(grant.id)) throw new Error('Consent submission identity was not verified.');
      inventory.dependencies.submittedConsentId = grant.id;
      await consentOperation(inventory, azure);
      if (!inventory.dependencies.consentGrants.some(item => item.id === grant.id && item.clientId === operation.body.clientId &&
          item.resourceId === operation.body.resourceId && item.scope?.split(' ').includes(operation.body.scope))) throw new Error('Exact delegated consent readback is still pending.');
    }
    if (operation.kind === 'deployment') await deploy(inventory, azure, operation, save);
    if (operation.kind === 'diagnostics') {
      await azure.setSettings(operation.settings);
      if (operation.body) await azure.diagnostic('selected', 'PUT', operation.body);
      await policy(inventory, azure);
      if ((await diagnosticsOperation(inventory, azure)).kind !== 'none') throw new Error('Diagnostics routing readback is pending.');
    }
    if (operation.kind === 'acceptance') {
      try {
        const result = await nativeProbe({ action: 'inventory', ...inventory.publisher }, nativeTransport);
        if (!Array.isArray(result?.pages) || result.mutationsEnabled !== false) throw new Error('Expected read-only publisher inventory was not verified.');
        inventory.gates['native-manager-obo'] = { status: 'passed', source: 'publisher-probe', checkedAt: now(),
          targetSha256: targetHash(inventory), evidence: 'Direct bearer publisher inventory succeeded with platform identity, same-user own-API/OBO authorization and the verified runtime.' };
      } catch {
        inventory.gates['native-manager-obo'] = { status: 'failed', source: 'publisher-probe', checkedAt: now(),
          targetSha256: targetHash(inventory), evidence: 'Publisher admission/OBO inventory could not be verified. No retry or fallback.' };
        throw new Error('Publishing acceptance failed. Mutations remain disabled; no token-issued or owner ready flag can clear this check.');
      }
    }
    if (operation.kind === 'activation') {
      await azure.setSettings(operation.settings);
      const settings = await azure.settings();
      if (settings.HTML_MANAGER_MUTATIONS_ENABLED?.value !== 'true' || settings.HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN?.value !== 'true') throw new Error('Activation readback is unverified.');
      await policy(inventory, azure);
      inventory.activation = { status: 'verified', targetSha256: targetHash(inventory), verifiedAt: now() };
    }
    inventory.operation.status = 'verified'; inventory.operation.completedAt = now(); inventory.lastFailure = null;
    await save();
    return { status: 'stage-verified', stage, next: 'Plan the next required stage. Provisioning is not live acceptance.' };
  } catch (error) {
    inventory.operation.status = operation.kind === 'acceptance' ? 'denied' : 'uncertain';
    inventory.lastFailure = { stage, code: error.code ?? 'stage-unverified', at: now(), message: 'Stage outcome is unverified. Preserve state and use reviewed recovery; no blind retry.' };
    await save();
    throw error;
  }
}
export function recordEvidence(inventory, evidence) {
  exact(evidence, ['version', 'targetSha256', 'checks']);
  if (evidence.version !== 1 || evidence.targetSha256 !== targetHash(inventory) || !Array.isArray(evidence.checks) || !evidence.checks.length) throw new Error('Evidence must bind the current target/policy/runtime.');
  for (const item of evidence.checks) {
    exact(item, ['gate', 'result', 'checkedAt', 'reference']);
    const age = Date.now() - Date.parse(item.checkedAt);
    if (!GATES.includes(item.gate) || item.gate === 'native-manager-obo' || !['passed', 'failed'].includes(item.result) ||
        !Number.isFinite(age) || age < 0 || age > 24 * 3600000 || typeof item.reference !== 'string' ||
        item.reference.length < 10 || item.reference.length > 500 || /[\r\n]/.test(item.reference)) throw new Error('Invalid owner evidence. Publisher acceptance must come from the real probe.');
    inventory.gates[item.gate] = { status: item.result, source: 'owner-attestation', checkedAt: item.checkedAt,
      targetSha256: evidence.targetSha256, evidence: item.reference };
  }
}
export function recoveryPreview(inventory) {
  if (!inventory.recovery && !['started', 'uncertain'].includes(inventory.operation?.status)) throw new Error('No interrupted setup to reconcile.');
  const scope = { setupId: inventory.setupId, recovery: inventory.recovery, operation: inventory.operation, request: inventory.requestSha256 };
  return { sha256: hash(scope), scope, effect: inventory.operation?.kind === 'deployment'
    ? 'Close original SCM and reconcile the selected startup. If the candidate release is selected, temporarily allow corporate-only SCM for exact byte readback and reclose it. No redeployment, restart or mutation activation.'
    : 'Re-read the submitted stage without retrying its writes. Unresolved partial stages remain blocked.' };
}
export async function recover(inventory, azure, approved, save) {
  if (approved !== recoveryPreview(inventory).sha256) throw new Error('Exact recovery preview approval required.');
  await azure.scope(); await guardLegacy(inventory);
  if (inventory.recovery) {
    await restoreScm(inventory, azure, save);
    // Closing SCM is necessary, but it does not reconcile the runtime cutover.
  }
  const submitted = inventory.operation.details;
  if (submitted.kind === 'deployment') {
    await discovery(inventory, azure, 'deployment');
    await policy(inventory, azure); assertPolicy(inventory);
    if (inventory.policy.settings.HTML_MANAGER_MUTATIONS_ENABLED?.value !== 'false' ||
        inventory.policy.settings.HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN?.value !== 'true') throw new Error('Deployment reconciliation requires disabled mutations and frozen writers.');
    const startup = inventory.policy.web.appCommandLine;
    if (startup === submitted.startup) {
      await deploy(inventory, azure, { ...submitted, reuseRuntime: true }, save);
    } else if (startup !== submitted.previousStartup) {
      throw new Error('Startup differs from both reviewed versions. Preserve the partial release; host-owner reconciliation required.');
    }
    // An unselected partial release is retained, never treated as active or deleted.
    inventory.dependencies.deploymentReconciliation = { releaseSha256: submitted.manifest.releaseSha256,
      selected: startup === submitted.startup, checkedAt: now(), source: 'ARM startup and closed SCM; selected candidate also requires byte readback' };
  } else if (submitted.kind === 'create') {
    const role = submitted.role, item = inventory.resources[role];
    if (!item) throw new Error('Invalid recovery role.');
    const raw = role === 'servicePrincipal' ? await azure.sp(resourceReady(inventory, 'application').appId) : await azure.resource(role, item.desired);
    if (!raw) throw new Error('Submitted resource is not yet observable. Keep outcome uncertain; never repeat creation based on absence.');
    const tagged = role === 'application' ? raw.tags?.includes(marker(inventory)) : role.startsWith('readerGroup')
      ? raw.description === marker(inventory) : role === 'servicePrincipal' ? raw.appId === resourceReady(inventory, 'application').appId
      : raw.tags?.['html-publisher-setup'] === inventory.setupId;
    if (!tagged || (item.observed && raw.id?.toLowerCase() !== item.observed.id.toLowerCase())) throw new Error('Resource creation provenance is unverified. No adoption or retry.');
    item.createdBySetup = role !== 'servicePrincipal';
    item.observed = observedResource(role, raw);
    await observe(inventory, azure, role);
  } else if (['identity', 'consent', 'activation', 'diagnostics'].includes(submitted.kind)) {
    await discovery(inventory, azure, inventory.operation.stage);
    await policy(inventory, azure);
    assertPolicy(inventory);
    if (submitted.kind === 'identity') {
      await verifyIdentity(inventory, azure);
    }
    if (submitted.kind === 'consent') {
      await consentOperation(inventory, azure);
      if (!inventory.dependencies.consentGrants.some(item => item.clientId === submitted.body.clientId &&
          item.resourceId === submitted.body.resourceId && item.consentType === 'AllPrincipals' && item.scope?.split(' ').includes(submitted.body.scope))) throw new Error('Submitted consent remains pending.');
    }
    if (submitted.kind === 'activation') {
      if (!acceptanceComplete(inventory) || inventory.policy.settings.HTML_MANAGER_MUTATIONS_ENABLED?.value !== 'true' ||
          inventory.policy.settings.HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN?.value !== 'true') throw new Error('Activation remains unverified.');
      inventory.activation = { status: 'verified', targetSha256: targetHash(inventory), verifiedAt: now() };
    }
    if (submitted.kind === 'diagnostics' && (await diagnosticsOperation(inventory, azure)).kind !== 'none') throw new Error('Diagnostics routing remains pending.');
  } else throw new Error('Interrupted stage requires host-owner reconciliation; no write was retried.');
  inventory.operation.status = 'reconciled'; inventory.operation.completedAt = now(); inventory.lastFailure = null;
  await save();
  return { status: 'reconciled', stage: inventory.operation.stage, publishing: 'Pending fresh acceptance and separate activation; no write was retried.' };
}
