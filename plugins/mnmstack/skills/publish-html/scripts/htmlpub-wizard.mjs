import path from 'node:path';
import { DEFAULT_CONFIG, GUID, GATES, STAGES, exact, validateRequest, validateInventory,
  safePath, readPrivate, withInventory, targetHash, acceptanceComplete, isExistingHost, validateExistingHost, hash } from './onboarding/state.mjs';
import { setup } from './setup-html.mjs';
import { recordEvidence } from './onboarding/stages.mjs';
import { SetupCatalog, aliasPrefix, exactSelection } from './htmlpub-catalog.mjs';
import { choose, chooseMany, confirm, fields, label, optionalPrivate, savePrivate, SavedExit } from './htmlpub-terminal.mjs';

const resourceNames = { resourceGroup: 'Resource group', plan: 'Hosting plan', identity: 'Managed identity',
  application: 'App registration', site: 'Website', workspace: 'Log workspace', group: 'Reader group' };

const ANSWERS = ['version', 'cloud', 'tenantId', 'subscriptionId', 'location', 'resourceGroup', 'plan', 'identity',
  'application', 'site', 'readerGroups', 'managerObjectIds', 'allowedClientIds', 'diagnostics', 'legacyConfig'];
export function validateDraft(draft) {
  exact(draft, ['version', 'answers', 'prefix', 'mode', 'completed']);
  exact(draft.answers, [], ANSWERS);
  if (draft.version !== 1 || (draft.prefix !== null && !/^[a-z0-9][a-z0-9-]{1,39}$/.test(draft.prefix)) ||
      ![null, 'create', 'reuse'].includes(draft.mode) || !Array.isArray(draft.completed) ||
      draft.completed.some(stage => !STAGES.includes(stage)) || new Set(draft.completed).size !== draft.completed.length) throw new Error('The saved setup draft is invalid. Keep it and ask the host owner to review it.');
  return draft;
}
export function showStatus(ui, inventory, completed = []) {
  const finished = new Set(completed);
  if (Object.values(inventory.resources).every(item => item.status === 'verified')) finished.add('resources');
  if (inventory.runtime?.verifiedAt) for (const stage of ['identity', 'deployment']) finished.add(stage);
  if (inventory.activation.status === 'verified' && acceptanceComplete(inventory)) for (const stage of STAGES) finished.add(stage);
  if (!freshGate(inventory, 'native-manager-obo')) finished.delete('acceptance');
  if (inventory.activation.status !== 'verified' || !acceptanceComplete(inventory)) finished.delete('activation');
  ui.line(`Target: ${label(inventory.publisher?.origin ?? inventory.request.site.name)}`);
  ui.line(`Saved inventory, revision ${inventory.revision}. This command has not checked Azure.`);
  for (const stage of STAGES) {
    const blocked = inventory.lastFailure?.stage === stage;
    ui.line(`[${blocked ? 'blocked' : finished.has(stage) ? 'done' : 'pending'}] ${stage}`);
  }
  for (const [name, gate] of Object.entries(inventory.gates)) ui.line(`  ${label(name)}: ${gate.status === 'passed' && !freshGate(inventory, name) ? 'stale' : gate.status}`);
  ui.line(`Publishing activation: ${inventory.activation.status}; acceptance: ${acceptanceComplete(inventory) ? 'fresh' : 'pending, stale or failed'}`);
}
function freshGate(inventory, name) {
  const gate = inventory.gates[name], age = Date.now() - Date.parse(gate.checkedAt);
  return gate.status === 'passed' && gate.targetSha256 === targetHash(inventory) && Number.isFinite(age) && age >= 0 && age < 86400000 &&
    (name !== 'native-manager-obo' || gate.source === 'publisher-probe');
}
export function showPreview(ui, preview) {
  ui.line(`Review this ${preview.stage ?? 'recovery'} change:`);
  fields(ui, preview.operation ?? preview);
  if (preview.effects) ui.line(`Effects: ${preview.effects}`);
  ui.line('Your approval covers these values. We will check them again before making the change.');
}
export async function guidedRecovery(config, ui, dependencies = {}) {
  const preview = await setup({ action: 'recover', config }, dependencies);
  showPreview(ui, preview);
  await confirm(ui, 'RECOVER');
  ui.line('[running] Checking the interrupted setup without repeating its writes');
  const result = await setup({ action: 'recover', config, approve: preview.sha256 }, dependencies);
  ui.line(`[done] recovery: ${label(result.status ?? 'reconciled')}`);
  return result;
}
export async function guidedSetup(options, ui, { catalog = new SetupCatalog(), engine = setup, ...dependencies } = {}) {
  if (!ui.interactive) throw new Error('Guided setup needs a terminal. For automation, use htmlpub setup plan/apply with all required arguments.');
  let config = path.resolve(options.config ?? DEFAULT_CONFIG);
  try { await safePath(config); }
  catch (error) {
    if (options.config) throw error;
    ui.line('The default config folder is not private or is inside Git. Choose a private path outside your repositories.');
    config = path.resolve(await ui.ask('Absolute private inventory path'));
    await safePath(config);
  }
  const draftFile = `${config}.guided.json`;
  let prior = await optionalPrivate(draftFile);
  const draft = prior ? validateDraft(structuredClone(prior)) :
    { version: 1, answers: { version: 1, cloud: 'AzureCloud' }, prefix: null, mode: null, completed: [] };
  const persist = async () => { validateDraft(draft); await savePrivate(draftFile, draft, prior); prior = structuredClone(draft); };
  const invoke = args => engine({ config, ...args }, dependencies);
  let retryNative = false;
  try {
    const saved = await optionalPrivate(config);
    if (saved) {
      if (isExistingHost(saved)) {
        validateExistingHost(saved);
        ui.line(`Existing publisher configured: ${label(saved.publisher.origin)}`);
        ui.line('Use htmlpub list to check reports, or publish, replace, delete and restore to manage them. Setup did not change the host.');
        return { status: 'existing-host', config };
      }
      let inventory = validateInventory(saved);
      if (Object.keys(draft.answers).length > 2 && hash(draft.answers) !== inventory.requestSha256) throw new Error('The draft and saved inventory have different settings. Keep both files and ask the host owner to review them.');
      draft.answers = structuredClone(inventory.request);
      ui.line('Found your saved publisher. We will keep its resource and logging settings.');
      const choice = await choose(ui, 'Continue existing setup', [
        { label: 'Continue setup', value: 'resume' }, { label: 'View saved settings', value: 'details' }, { label: 'Save and exit', value: 'exit' }]);
      if (choice === 'exit') return { status: 'saved', config };
      if (choice === 'details') { fields(ui, inventory.request); showStatus(ui, inventory, draft.completed); return { status: 'details', config }; }
      if (inventory.recovery || ['started', 'uncertain'].includes(inventory.operation?.status)) {
        await guidedRecovery(config, ui, dependencies);
        inventory = validateInventory(await readPrivate(config));
      }
      if (inventory.activation.status === 'verified' && acceptanceComplete(inventory)) {
        ui.line('[done] Publishing is already enabled and its checks are current. Nothing changed; we did not sign in again.');
        return { status: 'already-accepted', config };
      }
      // These are progress hints only. Every later stage still validates the live prerequisites.
      const last = inventory.operation?.stage;
      if (['consent', 'deployment', 'diagnostics', 'acceptance', 'activation'].includes(last)) {
        for (const stage of ['resources', 'identity']) if (!draft.completed.includes(stage)) draft.completed.push(stage);
      }
      if (inventory.runtime?.verifiedAt) for (const stage of ['resources', 'identity', 'deployment']) {
        if (!draft.completed.includes(stage)) draft.completed.push(stage);
      }
      if (last === 'identity' && ['verified', 'reconciled'].includes(inventory.operation.status) && !draft.completed.includes('identity')) draft.completed.push('identity');
      await persist();
      if (inventory.gates['native-manager-obo'].status === 'failed') {
        showStatus(ui, inventory, draft.completed);
        ui.line('[blocked] The publisher check failed earlier. Ask the host owner to fix it before trying once more.');
        retryNative = await choose(ui, 'Failed publisher check', [
          { label: 'Save and exit without checking again', value: false },
          { label: 'The host owner fixed it; review one new check', value: true }]);
        if (!retryNative) return { status: 'blocked', config };
      }
    } else {
      if (prior) {
        ui.line('Found your saved setup answers. This draft has not changed any resources.');
        const choice = await choose(ui, 'Continue draft', [{ label: 'Resume', value: 'resume' },
          { label: 'View saved settings', value: 'details' }, { label: 'Save and exit', value: 'exit' }]);
        if (choice !== 'resume') { if (choice === 'details') fields(ui, draft.answers); return { status: choice, config }; }
      }
      await persist();
      ui.line('Choose your resources first. We will ask before creating or changing anything.');
      ui.line('Use the arrow keys and Enter. Space toggles multiple choices. Esc saves confirmed answers and exits.');
      ui.line('At a text prompt, :save also exits. Publishing needs POSIX; Windows setup has not been tested on Windows.');
      let selectedAccount;
      async function subscriptions() {
        const accounts = await catalog.accounts();
        if (!Array.isArray(accounts) || !accounts.length) throw new Error('No enabled public-Azure subscriptions found. Sign in to Azure CLI separately. Setup will not sign in or switch its defaults.');
        const account = await choose(ui, 'Subscription and directory', accounts.map(item => ({
          label: `${item.name} (${item.id}; tenant ${item.tenantId})`, value: item })));
        await catalog.select(account);
        selectedAccount = account;
        draft.answers.subscriptionId = account.id; draft.answers.tenantId = account.tenantId;
        await persist();
      }
      if (!draft.answers.subscriptionId) await subscriptions();
      else await catalog.select({ id: draft.answers.subscriptionId, tenantId: draft.answers.tenantId });
      if (!draft.prefix) {
        selectedAccount ??= (await catalog.accounts()).find(account => account.id?.toLowerCase() === draft.answers.subscriptionId.toLowerCase());
        const suggestion = aliasPrefix(selectedAccount);
        if (!suggestion) ui.line('No usable signed-in user alias. Enter your own prefix. We cannot use a display name or service principal as a user alias.');
        draft.prefix = await ui.ask('Resource prefix (accept or edit)', suggestion ?? undefined);
        if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(draft.prefix)) throw new Error('Use 2-40 lowercase letters, digits or hyphens for the prefix. Start with a letter or digit.');
        await persist();
      }
      if (!draft.mode) {
        draft.mode = await choose(ui, 'Publisher resources', [{ label: 'Create a new protected publisher', value: 'create' },
          { label: 'Use existing resources that meet the host requirements', value: 'reuse' }]); await persist();
      }
      async function resource(role, suffix, multiple = false) {
        const title = resourceNames[role];
        const mode = await choose(ui, `${title}: create or reuse?`, [{ label: 'Create new', value: 'create' },
          { label: 'Choose existing', value: 'reuse' }], draft.mode === 'reuse' ? 1 : 0);
        let selected;
        if (mode === 'create') selected = { mode, name: await ui.ask(`${title} name`, `${draft.prefix}${suffix}`) };
        else {
          const found = await catalog.resources(role, draft.answers);
          const choices = [...found.map(item => ({ label: `${item.name ?? item.displayName} (${item.id})`, value: item })),
            { label: 'Enter a known resource ID', value: null }];
          const prompt = `Choose ${multiple ? 'reader groups' : title.toLowerCase()} (first page shown)`;
          const picked = multiple ? await chooseMany(ui, prompt, choices) : [await choose(ui, prompt, choices)];
          const resources = [];
          for (const item of picked) {
            const name = item?.name ?? item?.displayName ?? await ui.ask(`${title} name`);
            const id = item?.id ?? await ui.ask(`${title} ID`);
            resources.push(exactSelection(role, draft.answers, name, id));
          }
          if (role === 'plan') resources[0].sku = await ui.ask('Paid Linux hosting tier (billed before publishing checks)', draft.answers.plan?.sku ?? 'B1');
          return multiple ? resources : resources[0];
        }
        if (role === 'plan') selected.sku = await ui.ask('Paid Linux hosting tier (billed before publishing checks)', draft.answers.plan?.sku ?? 'B1');
        return multiple ? [selected] : selected;
      }
      async function region() {
        const found = await catalog.regions();
        draft.answers.location = await choose(ui, 'Region', found.map(item => ({
          label: `${item.displayName} (${item.name})`, value: item.name }))); await persist();
      }
      async function refs(role) {
        const found = await catalog.resources(role, draft.answers);
        const selected = await chooseMany(ui, role === 'users' ? 'Choose managers (first tenant page)' : 'Choose approved client apps (first tenant page)', [
          ...found.map(item => ({ label: `${item.displayName} (${role === 'clients' ? item.appId : item.id})`, value: role === 'clients' ? item.appId : item.id })),
          { label: 'Enter known GUIDs', value: null }]);
        const values = selected.filter(value => value !== null);
        if (selected.includes(null)) values.push(...(await ui.ask(`${role === 'users' ? 'Manager object' : 'Client application'} GUIDs, separated by commas`)).split(',').map(value => value.trim()));
        if (!values.length || values.length > 20 || values.some(value => !GUID.test(value)) ||
            new Set(values.map(value => value.toLowerCase())).size !== values.length) throw new Error('Choose 1-20 different GUIDs.');
        return values;
      }
      async function logging() {
        draft.answers.diagnostics = { mode: 'enabled', workspace: await resource('workspace', '-logs'),
          settingName: `${draft.prefix}-auth-logs`, retentionDays: Number(await ui.ask('Log retention days', '30')),
          dailyQuotaGb: Number(await ui.ask('Daily log quota in GB (not a spend limit)', '1')) };
        await persist();
      }
      async function readers() {
        const groups = await resource('group', '-readers', true);
        while (groups.length < 20 && await choose(ui, 'Reader group selection', [
          { label: 'Keep these reader groups', value: false }, { label: 'Add more reader groups', value: true }])) {
          groups.push(...await resource('group', `-readers${groups.length + 1}`, true));
        }
        if (groups.length > 20) throw new Error('Choose at most 20 reader groups.');
        if (new Set(groups.map(group => (group.id ?? group.name).toLowerCase())).size !== groups.length) throw new Error('A reader group was chosen twice. Choose each group once.');
        return groups;
      }
      async function collect() {
        if (!draft.answers.resourceGroup) { draft.answers.resourceGroup = await resource('resourceGroup', '-rg'); await persist(); }
        if (!draft.answers.location) await region();
        for (const [role, suffix] of [['plan', '-plan'], ['identity', '-identity'], ['application', '-app'], ['site', '']]) {
          if (!draft.answers[role]) { draft.answers[role] = await resource(role, suffix); await persist(); }
        }
        if (!draft.answers.readerGroups) { draft.answers.readerGroups = await readers(); await persist(); }
        if (!draft.answers.managerObjectIds) { draft.answers.managerObjectIds = await refs('users'); await persist(); }
        if (!draft.answers.allowedClientIds) { draft.answers.allowedClientIds = await refs('clients'); await persist(); }
        if (!draft.answers.diagnostics) await logging();
      }
      await collect();
      while (true) {
        validateRequest(draft.answers);
        ui.line('Review your setup', 'prompt'); fields(ui, draft.answers);
        ui.line(`Private config: ${label(config)}`);
        const price = await catalog.estimate(draft.answers);
        ui.line(price ? `Hosting estimate: USD ${price.monthlyUsd}/month (${price.hourlyUsd}/hour); ${price.assumption}; ${price.source}.`
          : 'Hosting estimate unavailable. This Linux plan has recurring costs. Check the region and tier in Azure Pricing Calculator before approval.');
        ui.line(`Logging: ${draft.answers.diagnostics.mode}. Enabled logs can contain sensitive authentication data about other users. Export, ingestion and retention can cost money.`);
        ui.line('The workspace inherits RBAC access and network settings. Other people may have access; public ingestion/query endpoints may be enabled.');
        ui.line('The daily quota is not a hard spend cap. Appsettings, startup and logging changes can restart the app. We will not change group membership.', 'warning');
        const action = await choose(ui, 'What next?', [{ label: 'Review and approve each change', value: 'apply' },
          { label: 'Change settings', value: 'change' }, { label: 'Save and exit without applying', value: 'save' }]);
        if (action === 'save') return { status: 'saved', config };
        if (action === 'apply') break;
        const key = await choose(ui, 'Change a setting', [
          ...['subscription', 'resourceGroup', 'location', 'plan', 'identity', 'application', 'site', 'readerGroups', 'managerObjectIds', 'allowedClientIds', 'diagnostics']
            .map(value => ({ label: { subscription: 'Subscription', location: 'Region', readerGroups: 'Reader groups',
              managerObjectIds: 'Managers', allowedClientIds: 'Approved client apps', diagnostics: 'Logging', ...resourceNames }[value], value })),
          { label: 'Back to review', value: 'back' }]);
        if (key === 'back') continue;
        if (key === 'subscription') {
          ui.line('Choosing another subscription clears its dependent draft settings. No cloud resources have changed.');
          draft.answers = { version: 1, cloud: 'AzureCloud' };
          await subscriptions(); await collect();
        } else if (key === 'location') await region();
        else if (key === 'managerObjectIds' || key === 'allowedClientIds') draft.answers[key] = await refs(key === 'managerObjectIds' ? 'users' : 'clients');
        else if (key === 'readerGroups') draft.answers.readerGroups = await readers();
        else if (key === 'diagnostics') {
          const mode = await choose(ui, 'Logging', [{ label: 'Set up logging', value: 'enabled' },
            { label: 'Turn logging off for this new setup', value: 'off' }]);
          if (mode === 'enabled') await logging(); else draft.answers.diagnostics = { mode: 'off' };
        } else {
          draft.answers[key] = await resource(key, { resourceGroup: '-rg', plan: '-plan', identity: '-identity', application: '-app', site: '' }[key]);
          if (key === 'resourceGroup') {
            for (const [role, suffix] of [['plan', '-plan'], ['identity', '-identity'], ['site', '']]) {
              if (draft.answers[role].mode === 'reuse') draft.answers[role] = await resource(role, suffix);
            }
            if (draft.answers.diagnostics.workspace?.mode === 'reuse') draft.answers.diagnostics.workspace = await resource('workspace', '-logs');
          }
        }
        await persist();
      }
      await withInventory(config, validateRequest(draft.answers), async () => {});
    }
    for (const stage of STAGES) {
      if (draft.completed.includes(stage) && !['acceptance', 'activation'].includes(stage)) { ui.line(`[done] ${stage} (saved; we will recheck before the next change)`); continue; }
      const inventory = validateInventory(await readPrivate(config));
      if (stage === 'acceptance') {
        const gate = inventory.gates['native-manager-obo'];
        if (gate.status === 'failed' && !retryNative) { ui.line('[blocked] The publisher check failed earlier. Ask the host owner to fix it before trying again.'); return { status: 'blocked', config }; }
        if (freshGate(inventory, 'native-manager-obo')) {
          ui.line('[done] The publisher check is current. We will not repeat it.'); continue;
        }
      }
      if (stage === 'activation' && !acceptanceComplete(inventory)) {
        ui.line('[pending] Add evidence for checks the host owner has already completed. A ready flag cannot replace these checks.');
        for (const gate of GATES.filter(name => name !== 'native-manager-obo')) {
          const current = validateInventory(await readPrivate(config));
          if (freshGate(current, gate)) continue;
          ui.line(`Pending check: ${gate}. The evidence requirements are in onboarding.md.`);
          const record = await choose(ui, 'Owner evidence', [{ label: 'Save and exit; check has not been verified', value: false },
            { label: 'Record a check that has already passed', value: true }]);
          if (!record) return { status: 'pending-acceptance', config };
          const reference = await ui.ask('Private evidence reference (leave out secrets)');
          const checkedAt = await ui.ask('Actual UTC check time, ISO 8601');
          await confirm(ui, `ATTEST ${gate}`);
          await withInventory(config, null, async (value, save) => {
            recordEvidence(value, { version: 1, targetSha256: targetHash(current), checks: [{ gate, result: 'passed', checkedAt, reference }] }); await save();
          });
        }
      }
      for (let count = 0; count < 100; count++) {
        const preview = await invoke({ action: 'plan', stage });
        if (preview.operation.kind === 'none') { ui.line(`[done] ${stage}: ${label(preview.operation.reason)}`); break; }
        showPreview(ui, preview);
        await confirm(ui, `APPLY ${stage}`);
        ui.line(`[running] ${stage}`);
        await invoke({ action: 'apply', stage, approve: preview.sha256 });
        ui.line(`[done] ${stage} change verified`);
        if (!['resources', 'consent', 'diagnostics'].includes(stage)) break;
        if (count === 99) throw new Error('This stage reached its limit. Keep the saved state and review it before continuing.');
      }
      if (!draft.completed.includes(stage)) draft.completed.push(stage);
      await persist();
    }
    const final = validateInventory(await readPrivate(config));
    showStatus(ui, final, draft.completed);
    return { status: final.activation.status === 'verified' ? 'accepted' : 'pending-acceptance', config };
  } catch (error) {
    if (error instanceof SavedExit) { ui.line(error.message); return { status: 'saved', config }; }
    ui.line(`[blocked] ${label(error.message)}\nSaved state: ${label(config)}. If a change is uncertain, run htmlpub recover before trying again.`);
    throw error;
  }
}
