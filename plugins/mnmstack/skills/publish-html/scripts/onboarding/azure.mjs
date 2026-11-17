import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { armId, GUID, hash } from './state.mjs';

const exec = promisify(execFile);
export const GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';
const API = { resourceGroup: '2022-09-01', plan: '2024-11-01', identity: '2023-01-31',
  site: '2024-11-01', workspace: '2023-09-01' };
const ERROR_CODES = ['ResourceNotFound', 'ResourceGroupNotFound', 'Request_ResourceNotFound',
  'AuthorizationFailed', 'Authorization_RequestDenied', 'Forbidden', 'InvalidAuthenticationToken', 'Conflict'];
export class AzureError extends Error {
  constructor(code = 'azure-failed') { super(`Azure operation could not be verified (${code}). Provider response omitted; no fallback is permitted.`); this.code = code; }
}
export async function launcher({ platform = process.platform, env = process.env, exists = access } = {}) {
  for (const directory of (env.PATH ?? '').split(platform === 'win32' ? ';' : path.delimiter).filter(Boolean)) {
    const candidate = platform === 'win32' ? path.win32.join(directory, 'az.cmd') : path.join(directory, 'az');
    try { await exists(candidate); } catch { continue; }
    if (platform !== 'win32') return { command: candidate, prefix: [] };
    const python = path.win32.join(path.win32.dirname(path.win32.dirname(candidate)), 'python.exe');
    try { await exists(python); } catch { throw new Error('Standard Windows Azure CLI with bundled python.exe required. No az.cmd shell fallback.'); }
    return { command: python, prefix: ['-IBm', 'azure.cli'] };
  }
  throw new Error('Azure CLI must already be installed on PATH.');
}
export class Azure {
  constructor(request, { run = exec, resolveLauncher = launcher, fetchImpl = globalThis.fetch } = {}) {
    this.request = request; this.run = run; this.resolveLauncher = resolveLauncher; this.fetch = fetchImpl;
  }
  async cli(args, { json = true, body } = {}) {
    this.launch ??= await this.resolveLauncher();
    const input = [...this.launch.prefix, ...args, '--only-show-errors', '--output', json ? 'json' : 'none'];
    if (body !== undefined) input.push('--body', canonicalBody(body));
    try {
      const { stdout } = await this.run(this.launch.command, input, { encoding: 'utf8', windowsHide: true,
        shell: false, timeout: args.includes('deploy') ? 240000 : 60000, maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, AZURE_EXTENSION_USE_DYNAMIC_INSTALL: 'no' } });
      return json && stdout?.trim() ? JSON.parse(stdout) : null;
    } catch (error) {
      const code = ERROR_CODES.find(code => new RegExp(`(?:\\(|"|\\b)${code}(?:\\)|"|\\b)`).test(String(error.stderr ?? '')));
      throw new AzureError(code);
    }
  }
  async scope() {
    const account = await this.cli(['account', 'show', '--subscription', this.request.subscriptionId,
      '--query', '{id:id,tenantId:tenantId,environmentName:environmentName,state:state,name:name}']);
    if (account?.id?.toLowerCase() !== this.request.subscriptionId.toLowerCase() ||
        account?.tenantId?.toLowerCase() !== this.request.tenantId.toLowerCase() || account.environmentName !== 'AzureCloud' ||
        account.state !== 'Enabled') throw new Error('Selected subscription, tenant, public cloud or account state does not match.');
    return account;
  }
  async help(args) {
    this.launch ??= await this.resolveLauncher();
    try { await this.run(this.launch.command, [...this.launch.prefix, ...args, '--help'], {
      encoding: 'utf8', shell: false, windowsHide: true, timeout: 15000, maxBuffer: 262144,
      env: { ...process.env, AZURE_EXTENSION_USE_DYNAMIC_INSTALL: 'no' },
    }); } catch { throw new Error(`Required Azure CLI capability is unavailable: ${args.slice(0, 3).join(' ')}. No installation or fallback.`); }
  }
  async arm(role, selection, suffix = '', method = 'GET', body) {
    const allowed = { resourceGroup: [''], plan: [''], identity: [''], workspace: [''],
      site: ['', '/config/web', '/config/authsettingsV2', '/config/appsettings', '/basicPublishingCredentialsPolicies/scm', '/basicPublishingCredentialsPolicies/ftp'] };
    if (!allowed[role]?.includes(suffix) || !['GET', 'PUT', 'PATCH', 'POST'].includes(method)) throw new Error('Unsupported fixed ARM operation.');
    return this.cli(['rest', '--method', method, '--url',
      `https://management.azure.com${armId(this.request, role, selection.name)}${suffix}?api-version=${API[role]}`,
      '--resource', 'https://management.azure.com/', '--subscription', this.request.subscriptionId], { body });
  }
  async graph(collection, { id, query = '', method = 'GET', body, child } = {}) {
    if (!['applications', 'servicePrincipals', 'groups', 'users', 'oauth2PermissionGrants'].includes(collection) ||
        (id !== undefined && !GUID.test(id)) || (child !== undefined && child !== 'federatedIdentityCredentials') ||
        !['GET', 'POST', 'PATCH'].includes(method)) throw new Error('Unsupported fixed directory operation.');
    if (query && (!query.startsWith('?$') || /[^\x20-\x7e]/.test(query))) throw new Error('Invalid internal directory query.');
    const url = `https://graph.microsoft.com/v1.0/${collection}${id ? `/${id}` : ''}${child ? `/${child}` : ''}${query}`;
    return this.cli(['rest', '--method', method, '--url', url, '--resource', 'https://graph.microsoft.com/',
      '--subscription', this.request.subscriptionId], { body });
  }
  async optional(read) {
    try { return await read(); }
    catch (error) { if (['ResourceNotFound', 'ResourceGroupNotFound', 'Request_ResourceNotFound'].includes(error.code)) return null; throw error; }
  }
  async resource(role, desired) {
    if (role === 'application') {
      if (desired.mode === 'reuse') return this.optional(() => this.graph('applications', { id: desired.id,
        query: '?$select=id,appId,displayName,signInAudience,api,web,requiredResourceAccess,identifierUris,tags' }));
      const result = await this.graph('applications', { query: `?$filter=displayName eq '${desired.name}'&$select=id,appId,displayName,signInAudience,api,web,requiredResourceAccess,identifierUris,tags` });
      return unique(result);
    }
    if (role.startsWith('readerGroup')) {
      if (desired.mode === 'reuse') return this.optional(() => this.graph('groups', { id: desired.id, query: '?$select=id,displayName,securityEnabled,mailEnabled,description' }));
      return unique(await this.graph('groups', { query: `?$filter=displayName eq '${desired.name}'&$select=id,displayName,securityEnabled,mailEnabled,description` }));
    }
    return this.optional(() => this.arm(role, desired));
  }
  async sp(appId) {
    if (!GUID.test(appId)) throw new Error('Observed application client GUID required.');
    return unique(await this.graph('servicePrincipals', { query: `?$filter=appId eq '${appId}'&$select=id,appId,displayName,oauth2PermissionScopes,accountEnabled` }));
  }
  async settings() {
    const names = ['TENANT_ID', 'ALLOWED_GROUP_IDS', 'OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID', 'HTML_MANAGER_OBJECT_IDS', 'HTML_MANAGER_GROUP_IDS',
      'HTML_MANAGER_ORIGIN', 'HTML_CONTENT_DIR', 'HTML_MANAGER_STATE_DIR', 'HTML_MANAGER_MUTATIONS_ENABLED',
      'HTML_MANAGER_LEGACY_PUBLISHERS_FROZEN', 'HTML_MANAGER_OWN_API_ENABLED', 'HTML_MANAGER_API_CLIENT_ID',
      'HTML_MANAGER_ALLOWED_CLIENT_IDS', 'HTML_MANAGER_MI_CLIENT_ID', 'WEBSITE_AUTH_AAD_TRACE_LEVEL'];
    const selected = await this.cli(['webapp', 'config', 'appsettings', 'list', '--resource-group', this.request.resourceGroup.name,
      '--name', this.request.site.name, '--subscription', this.request.subscriptionId,
      '--query', `[?${names.map(name => `name=='${name}'`).join(' || ')}].{name:name,value:value,slotSetting:slotSetting}`]);
    if (!Array.isArray(selected) || selected.some(item => !names.includes(item.name)) ||
        new Set(selected.map(item => item.name)).size !== selected.length) throw new Error('Invalid selected application settings.');
    for (const { name, value } of selected) {
      const valid = name === 'HTML_MANAGER_ORIGIN' ? /^https:\/\/[a-z0-9][a-z0-9.-]*\.azurewebsites\.net$/.test(value) :
        name === 'HTML_CONTENT_DIR' ? value === '/home/site/wwwroot/content' :
        name === 'HTML_MANAGER_STATE_DIR' ? value === '/home/site/html-manager/state' :
        name === 'WEBSITE_AUTH_AAD_TRACE_LEVEL' ? ['Off', 'Error', 'Warning', 'Information', 'Verbose'].includes(value) :
        /(?:ENABLED|FROZEN)$/.test(name) ? ['true', 'false'].includes(value) :
        ['HTML_MANAGER_OBJECT_IDS', 'HTML_MANAGER_GROUP_IDS'].includes(name) && value === '' ? true :
        ['ALLOWED_GROUP_IDS', 'HTML_MANAGER_OBJECT_IDS', 'HTML_MANAGER_GROUP_IDS', 'HTML_MANAGER_ALLOWED_CLIENT_IDS'].includes(name)
          ? typeof value === 'string' && value.split(',').length <= 20 && value.split(',').every(id => GUID.test(id.trim())) :
          typeof value === 'string' && GUID.test(value);
      if (!valid) throw new Error(`Selected appsetting ${name} has an unsupported value. It was not captured; inspect it privately with the host owner.`);
    }
    return Object.fromEntries(selected.map(item => [item.name, { value: item.value, slotSetting: item.slotSetting === true }]));
  }
  async setSettings(values) {
    for (const [name, value] of Object.entries(values)) {
      if (!/^(?:TENANT_ID|ALLOWED_GROUP_IDS|OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID|HTML_(?:CONTENT_DIR|MANAGER_[A-Z_]+)|WEBSITE_AUTH_AAD_TRACE_LEVEL)$/.test(name) ||
          typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) throw new Error('Invalid owned application setting.');
    }
    // The CLI merges these named settings; never replace the whole appsettings document.
    return this.cli(['webapp', 'config', 'appsettings', 'set', '--resource-group', this.request.resourceGroup.name,
      '--name', this.request.site.name, '--subscription', this.request.subscriptionId, '--slot-settings',
      ...Object.entries(values).map(([name, value]) => `${name}=${value}`)], { json: false });
  }
  async deploy(local, remote) {
    if (!/^\/home\/site\/html-manager\/releases\/[a-f0-9]{64}\/[A-Za-z0-9-]+\.(?:mjs|html)$/.test(remote)) throw new Error('Invalid fixed release path.');
    return this.cli(['webapp', 'deploy', '--resource-group', this.request.resourceGroup.name, '--name', this.request.site.name,
      '--subscription', this.request.subscriptionId, '--src-path', local, '--type', 'static', '--target-path', remote,
      '--clean', 'false', '--restart', 'false', '--track-status', 'false', '--enable-kudu-warmup', 'false']);
  }
  async readDeployed(hostname, remote, expectedSize) {
    if (!/^[a-z0-9][a-z0-9.-]*\.azurewebsites\.net$/.test(hostname) || hostname.includes('.scm.') ||
        !/^\/home\/site\/html-manager\/releases\/[a-f0-9]{64}\/[A-Za-z0-9-]+\.(?:mjs|html)$/.test(remote) ||
        !Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > 1024 * 1024) throw new Error('Invalid release verification target.');
    let token = await this.cli(['account', 'get-access-token', '--subscription', this.request.subscriptionId,
      '--resource', 'https://management.azure.com/', '--query', 'accessToken']);
    if (typeof token !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(token)) throw new Error('Entra deployment verification token is unavailable.');
    try {
      const hostnameScm = hostname.replace('.', '.scm.');
      const response = await this.fetch(`https://${hostnameScm}/api/vfs/${remote.slice('/home/'.length)}`, {
        headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000),
      });
      if (response.status !== 200) { await response.body?.cancel(); throw new Error('readback'); }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length; if (size > expectedSize) throw new Error('readback-size'); chunks.push(chunk);
      }
      if (size !== expectedSize) throw new Error('readback-size');
      return hash(Buffer.concat(chunks));
    } catch { throw new Error('Release readback was not verified. Preserve deployment evidence; no fallback.'); }
    finally { token = null; }
  }
  async diagnostic(kind, method = 'GET', body) {
    const tail = kind === 'categories' ? 'diagnosticSettingsCategories' : kind === 'settings' ? 'diagnosticSettings' :
      kind === 'selected' ? `diagnosticSettings/${this.request.diagnostics.settingName}` : null;
    if (!tail || !['GET', 'PUT'].includes(method) || this.request.diagnostics.mode !== 'enabled') throw new Error('Unsupported diagnostics operation.');
    return this.cli(['rest', '--method', method, '--url',
      `https://management.azure.com${armId(this.request, 'site', this.request.site.name)}/providers/Microsoft.Insights/${tail}?api-version=2021-05-01-preview`,
      '--resource', 'https://management.azure.com/', '--subscription', this.request.subscriptionId], { body });
  }
}
function canonicalBody(body) {
  const json = JSON.stringify(body);
  if (json.length > 262144) throw new Error('Setup operation body exceeds its limit.');
  return json;
}
export function unique(result) {
  if (!Array.isArray(result?.value) || result['@odata.nextLink'] || result.value.length > 1) throw new Error('Directory result is ambiguous or incomplete. Select an exact ID.');
  return result.value[0] ?? null;
}
export const RUNTIME_FILES = Object.freeze(['start-host.mjs', 'server.mjs', 'config.mjs', 'common.mjs', 'auth.mjs', 'store.mjs',
  'client-protocol.mjs', 'png.mjs', 'manager.html', 'manager-ui.mjs']);
export async function runtimeManifest(directory) {
  const files = [];
  for (const name of RUNTIME_FILES) {
    const filename = path.join(directory, name), stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error('Runtime source must be bounded regular files.');
    const bytes = await readFile(filename);
    files.push({ name, size: bytes.length, sha256: hash(bytes) });
  }
  return { releaseSha256: hash(files), files };
}
