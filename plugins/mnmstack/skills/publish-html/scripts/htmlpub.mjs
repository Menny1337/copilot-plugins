#!/usr/bin/env node
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, GUID, HASH, validateInventory, isExistingHost, validateExistingHost, hash } from './onboarding/state.mjs';
import { setup, parseArgs as parseSetup } from './setup-html.mjs';
import { runPublisher, parseArgs as parsePublisher, resolvePublisherConfig } from './hosted-manager/publish.mjs';
import { ClientError } from './hosted-manager/client-protocol.mjs';
import { NAME, SHA, htmlBytes, readRegular, digest } from './hosted-manager/common.mjs';
import { guidedSetup, guidedRecovery, showStatus, validateDraft } from './htmlpub-wizard.mjs';
import { terminal, choose, confirm, fields, label, optionalPrivate, savePrivate, SavedExit } from './htmlpub-terminal.mjs';

export const HELP = `htmlpub: protected HTML publisher
Needs Node.js 24. Setup and bearer publishing also need an installed Azure CLI.

  htmlpub setup                 Set up a publisher (--setup also works)
  htmlpub status                View saved progress and publishing checks
  htmlpub resources             View your saved resource inventory
  htmlpub list                   Sign in and list reports and backups
  htmlpub publish FILE           Publish a new trusted HTML report
  htmlpub replace FILE           Review and replace an existing report
  htmlpub delete NAME            Review and delete a report
  htmlpub restore                Choose a retained backup to restore
  htmlpub recover                Review an interrupted or uncertain change

Menus: Up/Down + Enter. Multiple choices: Space to toggle, Enter to keep.
Esc or Ctrl+C saves confirmed answers and exits. Text prompts also accept :save.
Plain terminals use numbered choices. Redirected input never prompts.
Color respects NO_COLOR and TERM=dumb.

Common: --config <private-resources.json>, --json, --non-interactive
Publishing: --browser uses a dedicated signed-in Edge window instead of an Azure CLI token.
Browser prerequisites: installed Edge and playwright-cli; no automatic installation or fallback.
Setup automation: htmlpub setup plan|apply|status|recover|evidence <engine options>
Publishing automation: --confirm NAME; replace/delete/restore also --revision VALUE
and --sha256 SHA|missing; restore also --name NAME --backup-id GUID --backup-sha256 SHA.
Explicit target: --origin HTTPS --tenant GUID --api-client GUID (not with --config).
Optional: --journal <private.json>, --file-sha256 SHA, --thumbnail PNG --thumbnail-html-sha256 SHA.
Setup is implemented for Windows/macOS/Linux; Windows execution is unverified.
Bearer publishing needs POSIX. Browser publishing uses the macOS/Windows browser runtime;
native Windows browser execution is unverified, and Linux browser transport is unsupported.
Publishing never runs setup, retries sign-in or falls back to Kudu.
Pass all required arguments for redirected input or --json.
Installation: npm install --global --ignore-scripts <absolute-publish-html-skill-directory>
Install from the local skill directory. This package is not released on npm.
See references/htmlpub.md.`;

export function parsePublic(args) {
  const [raw, ...rest] = args;
  const action = raw === '--setup' ? 'setup' : raw;
  if (!['setup', 'status', 'resources', 'list', 'publish', 'replace', 'delete', 'restore', 'recover'].includes(action)) throw new Error('Unknown command. Run htmlpub --help for the command list.');
  if (action === 'setup' && ['plan', 'apply', 'status', 'recover', 'evidence'].includes(rest[0])) {
    const flags = rest.filter(value => ['--json', '--non-interactive'].includes(value));
    if (new Set(flags).size !== flags.length) throw new Error('An output or input flag was passed twice.');
    return { action: 'structured', options: parseSetup(rest.filter(value => !flags.includes(value))),
      ...(flags.includes('--json') ? { json: true } : {}), ...(flags.includes('--non-interactive') ? { 'non-interactive': true } : {}) };
  }
  const options = { action };
  const flags = new Set(['json', 'non-interactive', 'browser']);
  const common = ['config', 'json', 'non-interactive'];
  const values = ['origin', 'tenant', 'api-client', 'confirm', 'revision', 'sha256', 'backup-id', 'backup-sha256',
    'name', 'journal', 'file-sha256', 'thumbnail', 'thumbnail-html-sha256', 'browser-runtime'];
  const allowed = action === 'recover' ? [...common, 'approve', 'journal', 'browser', 'browser-runtime'] :
    ['setup', 'status', 'resources'].includes(action) ? common : [...common, ...values, 'browser'];
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (!word.startsWith('--')) {
      if (!['publish', 'replace', 'delete'].includes(action) || options.operand) throw new Error('Unexpected argument. Check the command with htmlpub --help.');
      options.operand = word; continue;
    }
    const key = word.slice(2);
    if (!allowed.includes(key) || Object.hasOwn(options, key)) throw new Error('Unknown or duplicate htmlpub option. Check htmlpub --help.');
    if (flags.has(key)) options[key] = true;
    else {
      const value = rest[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}.`);
      options[key] = value;
    }
  }
  if (['publish', 'replace', 'delete'].includes(action) && !options.operand) throw new Error('A file or exact destination name is required.');
  if (options.approve && !HASH.test(options.approve)) throw new Error('Use the exact recovery digest from the preview you reviewed.');
  return options;
}
const unresolved = journal => ['started', 'uncertain', 'verified-cleanup-pending'].includes(journal?.status);
function listing(value) {
  if (!Array.isArray(value?.pages) || !Array.isArray(value?.backups) || !value.missingVersions ||
      typeof value.missingVersions !== 'object' || Array.isArray(value.missingVersions)) throw new Error('Manager inventory shape is invalid. No mutation was sent.');
  return value;
}
function validateJournal(value) {
  if (!value) return null;
  const allowed = ['version', 'status', 'target', 'action', 'name', 'revision', 'sha256', 'resultSha256',
    'startedAt', 'transactionId', 'observedRevision', 'observedSha256'];
  if (Object.keys(value).some(key => !allowed.includes(key)) || value.version !== 1 ||
      !['started', 'uncertain', 'verified', 'verified-cleanup-pending', 'not-sent', 'denied', 'owner-reconciled'].includes(value.status) ||
      !['upload', 'replace', 'delete', 'restore'].includes(value.action) || !NAME.test(value.name) ||
      !value.target || !GUID.test(value.target.tenantId) || !GUID.test(value.target.apiClientId) ||
      !Number.isFinite(Date.parse(value.startedAt)) || (value.transactionId !== null && !GUID.test(value.transactionId)) ||
      (value.resultSha256 !== null && !SHA.test(value.resultSha256))) throw new Error('The publishing journal is invalid. Keep it and ask the host owner to review it.');
  if (Object.keys(value.target).some(key => !['origin', 'tenantId', 'apiClientId', 'transport'].includes(key)) ||
      (value.target.transport !== undefined && !['bearer', 'browser'].includes(value.target.transport))) throw new Error('The publishing journal transport is invalid.');
  parsePublisher(['inventory', '--origin', value.target.origin, '--tenant', value.target.tenantId, '--api-client', value.target.apiClientId]);
  return value;
}
function targetOptions(options) {
  if (options.config && ['origin', 'tenant', 'api-client'].some(key => options[key])) throw new Error('Choose a config file or pass the origin, tenant and client directly. You cannot combine them.');
  const explicit = ['origin', 'tenant', 'api-client'].some(key => options[key]);
  const transport = { ...(options.browser ? { browser: true } : {}),
    ...(options['browser-runtime'] ? { 'browser-runtime': options['browser-runtime'] } : {}) };
  if (explicit) return { ...Object.fromEntries(['origin', 'tenant', 'api-client'].map(key => [key, options[key]])), ...transport };
  return { config: path.resolve(options.config ?? DEFAULT_CONFIG), ...transport };
}
function publisherArgs(action, values) {
  return parsePublisher([action, ...Object.entries(values).filter(([, value]) => value !== undefined)
    .flatMap(([key, value]) => value === true ? [`--${key}`] : [`--${key}`, value])]);
}
function publishingTransport(ui, interactive, dependencies) {
  return { ...dependencies.publisherTransport, onSignInRequired: dependencies.publisherTransport?.onSignInRequired ?? (async () => {
    if (!interactive) throw new ClientError('browser-sign-in', 'Finish browser sign-in in an interactive terminal. No write was sent.', 'not-sent');
    ui.line('Finish signing in to the dedicated Edge window. Complete any required MFA there.');
    return await choose(ui, 'Browser sign-in', [
      { label: 'I have signed in, continue', value: true },
      { label: 'Stop without publishing', value: false },
    ]);
  }) };
}
async function publisherDispatch(options, ui, dependencies) {
  if ((dependencies.platform ?? process.platform) === 'win32' && !options.browser) {
    const saved = options.origin ? null : await optionalPrivate(path.resolve(options.config ?? DEFAULT_CONFIG));
    if (!isExistingHost(saved) || validateExistingHost(saved).publisher.transport !== 'browser') throw new Error('Bearer publishing and list need POSIX. Windows browser execution is unverified.');
  }
  const action = { list: 'inventory', publish: 'upload' }[options.action] ?? options.action;
  const target = targetOptions(options);
  const interactive = ui.interactive && !options['non-interactive'];
  const run = dependencies.publisher ?? runPublisher;
  const transport = publishingTransport(ui, interactive, dependencies);
  let values = { ...target };
  for (const key of ['confirm', 'revision', 'sha256', 'backup-id', 'backup-sha256', 'name', 'thumbnail', 'thumbnail-html-sha256']) {
    if (options[key] !== undefined) values[key] = options[key];
  }
  if (['upload', 'replace'].includes(action)) values.file = path.resolve(options.operand);
  if (action === 'delete') {
    if (values.name && values.name !== options.operand) throw new Error('The destination names do not match.');
    values.name = options.operand;
  }
  if (action === 'inventory') {
    const parsed = publisherArgs(action, values);
    if (options['file-sha256'] || options.journal) throw new Error('List does not accept mutation options.');
    ui.line('[running] Signing in and listing reports. Inventory retention may update host state.');
    return listing(await run(await resolvePublisherConfig(parsed), transport));
  }
  const journalFile = path.resolve(options.journal ?? `${options.config ?? DEFAULT_CONFIG}.publish.json`);
  const prior = validateJournal(await optionalPrivate(journalFile));
  if (unresolved(prior)) throw new Error('Previous publishing outcome is uncertain. Run htmlpub recover before trying another write.');
  let localSha = null;
  if (values.file) localSha = digest(htmlBytes((await readRegular(values.file)).bytes));
  if (options['file-sha256'] && (!SHA.test(options['file-sha256']) || localSha !== options['file-sha256'])) throw new Error('The local HTML file does not match --file-sha256.');
  let parsed, reviewedTarget;
  if (!interactive) parsed = publisherArgs(action, values);
  else {
    // Validate the target and activation before any credential or inventory request.
    const probe = publisherArgs('inventory', target);
    reviewedTarget = await resolvePublisherConfig({ ...probe, action });
    ui.line('[running] Reading versions and backups. The write uses a separate authenticated request.');
    const inventory = listing(await run({ ...reviewedTarget, action: 'inventory' }, transport));
    let name = values.file ? path.basename(values.file) : values.name;
    if (action === 'restore') {
      const backup = await choose(ui, 'Choose a retained backup', inventory.backups.filter(item => !values.name || item.name === values.name).map(item => ({
        label: `${item.name}, ${item.savedAt}, ${item.id}, SHA ${item.sha256}`, value: item })));
      if (values.name && values.name !== backup.name || values['backup-id'] && values['backup-id'] !== backup.id ||
          values['backup-sha256'] && values['backup-sha256'] !== backup.sha256) throw new Error('The backup arguments do not match the backup you chose.');
      name = backup.name;
      values.name = name; values['backup-id'] = backup.id; values['backup-sha256'] = backup.sha256;
    }
    if (!NAME.test(name ?? '')) throw new Error('Choose a supported HTML filename.');
    const page = inventory.pages.find(item => item.name === name);
    if (action === 'upload' && inventory.pages.some(item => item.name.toLowerCase() === name.toLowerCase())) throw new Error('That report already exists. Use replace only if you intend to overwrite it.');
    if (['replace', 'delete'].includes(action) && !page) throw new Error('That report does not exist. Nothing was changed.');
    const revision = page?.revision ?? inventory.missingVersions[name] ?? 'missing', sha256 = page?.sha256 ?? 'missing';
    if (action !== 'upload') {
      if (values.revision && values.revision !== revision || values.sha256 && values.sha256 !== sha256) throw new Error('The report version differs from your arguments. Nothing was changed; review its current version.');
      values.revision = revision; values.sha256 = sha256;
    }
    ui.line(`Review ${action}: ${label(name)} on ${label(reviewedTarget.origin)}`);
    ui.line(`Current revision: ${label(revision)}; SHA: ${label(sha256)}; local HTML SHA: ${label(localSha ?? 'not applicable')}`);
    if (action === 'restore') ui.line(`Backup: ${values['backup-id']}; restored SHA: ${values['backup-sha256']}`);
    ui.line('Report scripts have same-origin application privileges. Restoring a backup will not revoke copies people already have.');
    await confirm(ui, `${action.toUpperCase()} ${name}`);
    if (values.confirm && values.confirm !== name) throw new Error('The confirmation does not match the filename you chose.');
    values.confirm = name;
    parsed = publisherArgs(action, values);
  }
  const name = values.file ? path.basename(values.file) : values.name;
  if (!NAME.test(name ?? '') || values.confirm !== name ||
      (action !== 'upload' && (!values.revision || values.revision.length > 160 || !(values.sha256 === 'missing' || SHA.test(values.sha256 ?? '')))) ||
      (action === 'restore' && (!GUID.test(values['backup-id'] ?? '') || !SHA.test(values['backup-sha256'] ?? '')))) {
    throw new Error('Confirm the exact filename and pass all reviewed version and backup arguments before writing.');
  }
  parsed.expectedFileSha256 = localSha;
  const resolved = await resolvePublisherConfig(parsed);
  if (reviewedTarget && (['origin', 'tenantId', 'apiClientId', 'browser-runtime'].some(key => reviewedTarget[key] !== resolved[key]) ||
      Boolean(reviewedTarget.browser) !== Boolean(resolved.browser))) throw new Error('The configured target or transport changed after review. We did not sign in for the write. Review the new target first.');
  const journal = { version: 1, status: 'started', target: { origin: resolved.origin, tenantId: resolved.tenantId, apiClientId: resolved.apiClientId },
    action, name: values.file ? path.basename(values.file) : values.name, revision: values.revision ?? 'missing',
    sha256: values.sha256 ?? 'missing', resultSha256: action === 'delete' ? null : action === 'restore' ? values['backup-sha256'] : localSha,
    startedAt: new Date().toISOString(), transactionId: null };
  if (resolved.browser) journal.target.transport = 'browser';
  await savePrivate(journalFile, journal, prior);
  const started = structuredClone(journal);
  try {
    ui.line(`[running] Signing in for ${action}. We will send the write once.`);
    const result = await run(resolved, transport);
    journal.status = 'verified'; journal.transactionId = result.transactionId;
    await savePrivate(journalFile, journal, started);
    return result;
  } catch (error) {
    journal.status = ['not-sent', 'denied', 'verified-cleanup-pending'].includes(error.outcome) ? error.outcome : 'uncertain';
    journal.transactionId = GUID.test(error.transactionId ?? '') ? error.transactionId : null;
    await savePrivate(journalFile, journal, started);
    throw error;
  }
}
async function recoverPublishing(options, ui, dependencies, inventory) {
  const journalFile = path.resolve(options.journal ?? `${options.config ?? DEFAULT_CONFIG}.publish.json`);
  const prior = validateJournal(await optionalPrivate(journalFile));
  if (!unresolved(prior)) { ui.line('No uncertain publishing write is recorded. Nothing needs recovery.'); return { status: 'no-recovery' }; }
  if (inventory && (!inventory.publisher || ['origin', 'tenantId', 'apiClientId'].some(key => inventory.publisher[key] !== prior.target[key]))) throw new Error('The publishing journal and inventory point to different hosts. We did not sign in.');
  if (!ui.interactive || options['non-interactive']) throw new Error('The host owner needs to review this uncertain write. Use list with the full target arguments and check private transaction evidence. We will not repeat it.');
  const browser = options.browser || inventory?.publisher?.transport === 'browser' || prior.target.transport === 'browser';
  if ((dependencies.platform ?? process.platform) === 'win32' && !browser) throw new Error('Bearer publishing recovery needs POSIX. We did not try to acquire credentials.');
  ui.line('Recovery reads the current inventory. It will not repeat the write.');
  fields(ui, prior);
  await confirm(ui, 'INSPECT PUBLISHING');
  const target = { origin: prior.target.origin, tenantId: prior.target.tenantId, apiClientId: prior.target.apiClientId };
  const current = listing(await (dependencies.publisher ?? runPublisher)({ action: 'inventory', ...target,
    ...(browser ? { browser: true } : {}),
    ...(options['browser-runtime'] ? { 'browser-runtime': options['browser-runtime'] } : {}) },
    publishingTransport(ui, ui.interactive && !options['non-interactive'], dependencies)));
  const page = current.pages.find(item => item.name === prior.name);
  const revision = page?.revision ?? current.missingVersions[prior.name] ?? 'missing', sha = page?.sha256 ?? 'missing';
  ui.line(`Observed ${label(prior.name)}: revision ${label(revision)}, SHA ${label(sha)}.`);
  ui.line('We cannot tell which request produced this version. Check the private host transaction evidence before accepting it.');
  await confirm(ui, `ACCEPT OBSERVED ${prior.name}`);
  await savePrivate(journalFile, { ...prior, status: 'owner-reconciled', observedRevision: revision, observedSha256: sha }, prior);
  return { status: 'owner-reconciled',
    originalOutcome: prior.status === 'verified-cleanup-pending' ? 'verified-cleanup-pending' : 'not-proven', revision, sha256: sha };
}
export async function runHtmlpub(args, dependencies = {}) {
  const ui = dependencies.ui ?? terminal();
  try {
    if (!args.length || args[0] === '--help') { ui.line(HELP); return { status: 'help', help: HELP }; }
    const options = parsePublic(args), config = path.resolve(options.config ?? DEFAULT_CONFIG);
    if (options['non-interactive'] || options.json) ui.interactive = false;
    if (options.action === 'structured') return await setup(options.options, dependencies.setupDependencies);
    if (options.action === 'setup') return await guidedSetup(options, ui, dependencies.setupDependencies);
    if (['status', 'resources'].includes(options.action)) {
      const inventory = await optionalPrivate(config);
      if (!inventory) {
        const draft = await optionalPrivate(`${config}.guided.json`);
        ui.line(draft ? 'Your setup draft is saved. Run htmlpub setup to continue; publishing checks are still pending.' : 'No inventory yet. Run htmlpub setup.');
        return { status: draft ? 'draft' : 'not-configured' };
      }
      if (isExistingHost(inventory)) {
        validateExistingHost(inventory);
        if (options.action === 'resources') { fields(ui, inventory.resources); return inventory.resources; }
        ui.line(`Publisher: ${label(inventory.publisher.origin)}`);
        ui.line('Existing host configuration saved. This command has not checked the host.');
        return { status: 'existing-host', publisher: inventory.publisher, checks: inventory.checks };
      }
      validateInventory(inventory);
      if (options.action === 'resources') fields(ui, inventory.resources);
      else {
        const draft = await optionalPrivate(`${config}.guided.json`);
        if (draft) {
          validateDraft(draft);
          if (hash(draft.answers) !== inventory.requestSha256) throw new Error('The saved progress and inventory have different settings. Keep both files for review.');
        }
        showStatus(ui, inventory, draft?.completed ?? []);
      }
      return options.action === 'resources' ? inventory.resources : await setup({ action: 'status', config });
    }
    if (options.action === 'recover') {
      const inventory = options.journal && !options.config ? null : await optionalPrivate(config);
      if (inventory) {
        if (isExistingHost(inventory)) validateExistingHost(inventory);
        else validateInventory(inventory);
        if (!isExistingHost(inventory) && (inventory.recovery || ['started', 'uncertain'].includes(inventory.operation?.status))) {
          if (options.approve) return setup({ action: 'recover', config, approve: options.approve }, dependencies.setupDependencies);
          if (!ui.interactive) throw new Error('Run htmlpub setup recover to review the recovery, then pass its approved digest to htmlpub recover --approve.');
          return await guidedRecovery(config, ui, dependencies.setupDependencies);
        }
      }
      if (options.approve) throw new Error('No matching setup recovery is pending.');
      return await recoverPublishing(options, ui, dependencies, inventory);
    }
    return await publisherDispatch(options, ui, dependencies);
  } catch (error) {
    if (error instanceof SavedExit) { ui.line(error.message); return { status: 'saved' }; }
    throw error;
  } finally { ui.close?.(); }
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes('--json');
  const ui = terminal();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  if (json) ui.line = () => {};
  try {
    const result = await runHtmlpub(process.argv.slice(2), { ui, publisherTransport: { signal: controller.signal } });
    if (json) console.log(JSON.stringify(result));
    else if (result.status !== 'help') ui.line(`Result: ${result.url ?? result.status ?? 'verified response'}${result.transactionId ? `; transaction ${result.transactionId}` : ''}`,
      result.status === 'blocked' || result.status === 'pending-acceptance' ? 'warning' : 'done');
    if (!json && Array.isArray(result.pages)) fields(terminal(), { pages: result.pages, backups: result.backups });
    if (result.status === 'blocked') process.exitCode = 1;
    if (result.status === 'pending-acceptance') process.exitCode = 2;
  } catch (error) {
    if (!json && process.stdin.isTTY && process.stderr.isTTY) terminal({ output: process.stderr }).error(error.message);
    else console.error(JSON.stringify({ code: error.code ?? 'htmlpub-blocked', outcome: error.outcome ?? 'not-sent',
      transactionId: error.transactionId ?? null, error: label(error.message),
      ...(error.browserHttp ? { browserHttp: error.browserHttp } : {}),
      ...(error.browserCleanupUnverified ? { browserCleanupUnverified: true } : {}) }));
    process.exitCode = 1;
  }
  finally { process.removeListener('SIGINT', cancel); }
}
