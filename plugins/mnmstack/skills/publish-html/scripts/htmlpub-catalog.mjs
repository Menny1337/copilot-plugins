import { Azure } from './onboarding/azure.mjs';
import { GUID, armId, hash } from './onboarding/state.mjs';
import { readResponse } from './hosted-manager/client-protocol.mjs';

export function aliasPrefix(account) {
  const user = account?.user;
  if (typeof user?.type !== 'string' || user.type.toLowerCase() !== 'user' || typeof user.name !== 'string') return null;
  const match = /^([a-z0-9][a-z0-9._-]{0,29})@[a-z0-9.-]+$/i.exec(user.name);
  if (!match) return null;
  const alias = match[1].toLowerCase().replace(/[._]+/g, '-');
  const suffix = '-html-publishing', available = 40 - suffix.length;
  let hint = alias;
  if (hint.length > available) {
    const discriminator = hash(user.name.toLowerCase()).slice(0, 12);
    hint = `${hint.slice(0, available - discriminator.length - 1).replace(/-+$/, '')}-${discriminator}`;
  }
  return `${hint}${suffix}`;
}
export class SetupCatalog {
  constructor({ azure = new Azure({}), fetchImpl = globalThis.fetch } = {}) { this.azure = azure; this.fetch = fetchImpl; }
  accounts() {
    return this.azure.cli(['account', 'list', '--query',
      "[?state=='Enabled' && environmentName=='AzureCloud'].{id:id,name:name,tenantId:tenantId,user:user}"]);
  }
  async select(account) {
    if (!GUID.test(account?.id ?? '') || !GUID.test(account?.tenantId ?? '')) throw new Error('The subscription or tenant ID is invalid. Choose an enabled public-Azure account.');
    this.azure.request = { subscriptionId: account.id, tenantId: account.tenantId };
    await this.azure.scope();
  }
  regions() {
    return this.azure.cli(['account', 'list-locations', '--subscription', this.azure.request.subscriptionId,
      '--query', '[].{name:name,displayName:displayName}']);
  }
  async resources(role, request) {
    if (role === 'resourceGroup') return this.azure.cli(['group', 'list', '--subscription', request.subscriptionId,
      '--query', '[].{id:id,name:name,location:location}']);
    if (['application', 'group', 'managerGroups', 'users', 'clients'].includes(role)) {
      const collection = { application: 'applications', group: 'groups', managerGroups: 'groups', users: 'users', clients: 'servicePrincipals' }[role];
      const fields = { application: 'id,displayName', group: 'id,displayName,securityEnabled,mailEnabled',
        managerGroups: 'id,displayName,securityEnabled,mailEnabled',
        users: 'id,displayName,userPrincipalName', clients: 'id,appId,displayName,accountEnabled' }[role];
      const result = await this.azure.graph(collection, { query: `?$top=50&$select=${fields}` });
      if (!Array.isArray(result?.value)) throw new Error('Could not verify the directory choices. Keep your saved answers and check access with the tenant owner.');
      return result.value.filter(item => role === 'managerGroups' ? item.securityEnabled === true && typeof item.mailEnabled === 'boolean' :
        role === 'group' ? item.securityEnabled && !item.mailEnabled :
        role === 'clients' ? item.accountEnabled === true : true);
    }
    const types = { plan: 'Microsoft.Web/serverfarms', identity: 'Microsoft.ManagedIdentity/userAssignedIdentities',
      site: 'Microsoft.Web/sites', workspace: 'Microsoft.OperationalInsights/workspaces' };
    if (!types[role] || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/.test(request.resourceGroup?.name ?? '')) throw new Error('Choose a valid resource group before listing its resources.');
    return this.azure.cli(['resource', 'list', '--subscription', request.subscriptionId, '--resource-group', request.resourceGroup.name,
      '--resource-type', types[role], '--query', '[].{id:id,name:name,location:location}']);
  }
  async estimate(request) {
    if (!/^[a-z][a-z0-9]{1,39}$/.test(request.location) || !/^[A-Za-z0-9]+$/.test(request.plan.sku)) throw new Error('Choose a valid region and hosting tier before requesting a price estimate.');
    const filter = `serviceName eq 'Azure App Service' and armRegionName eq '${request.location}' and armSkuName eq '${request.plan.sku}' and priceType eq 'Consumption'`;
    const url = new URL('https://prices.azure.com/api/retail/prices');
    url.searchParams.set('$filter', filter);
    try {
      const response = await this.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) { await response.body?.cancel(); return null; }
      const result = await readResponse(response, 1024 * 1024);
      const prices = result.Items?.filter(item => item.armRegionName === request.location && item.armSkuName === request.plan.sku &&
        /linux/i.test(item.productName) && item.unitOfMeasure === '1 Hour' && item.currencyCode === 'USD' &&
        item.type === 'Consumption' && Number.isFinite(item.retailPrice) && item.retailPrice >= 0);
      if (result.NextPageLink || prices?.length !== 1) return null;
      return { monthlyUsd: Number((prices[0].retailPrice * 730).toFixed(2)), hourlyUsd: prices[0].retailPrice,
        assumption: 'one instance, 730 hours/month; excludes tax, logs, storage and egress', source: url.origin };
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError' || error instanceof TypeError ||
          error instanceof SyntaxError || error.message === 'Response limit exceeded.') return null;
      throw error;
    }
  }
}
export function exactSelection(role, request, name, id, sku) {
  const value = { mode: 'reuse', name, id, ...(role === 'plan' ? { sku } : {}) };
  if (['resourceGroup', 'plan', 'identity', 'site', 'workspace'].includes(role) &&
      id?.toLowerCase() !== armId(request, role, name).toLowerCase()) throw new Error('That resource ID is outside the subscription or resource group you chose.');
  return value;
}
