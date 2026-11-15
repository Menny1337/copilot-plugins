#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, STAGES, HASH, validateRequest, readPrivate, withInventory, targetHash } from './onboarding/state.mjs';
import { Azure } from './onboarding/azure.mjs';
import { planStage, applyStage, recordEvidence, recoveryPreview, recover } from './onboarding/stages.mjs';

export function parseArgs(args) {
  const [action, ...rest] = args;
  const choices = { plan: ['request', 'config', 'stage'], apply: ['config', 'stage', 'approve'],
    status: ['config'], recover: ['config', 'approve'], evidence: ['config', 'evidence'] };
  if (!Object.hasOwn(choices, action)) throw new Error('Use plan, apply, status, recover or evidence. --help describes approval boundaries.');
  const options = { action, config: DEFAULT_CONFIG };
  const supplied = new Set();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.slice(2), value = rest[i + 1];
    if (!rest[i]?.startsWith('--') || !choices[action].includes(key) || !value || value.startsWith('--') || supplied.has(key)) throw new Error('Unknown, duplicate or incomplete setup option.');
    supplied.add(key); options[key] = value;
  }
  if ((action === 'apply' && (!options.stage || !options.approve)) || (action === 'evidence' && !options.evidence) ||
      (options.stage && !STAGES.includes(options.stage)) || (options.approve && !HASH.test(options.approve))) throw new Error('Exact finite stage and scope digest required.');
  options.config = path.resolve(options.config);
  if (action === 'plan') options.stage ??= 'resources';
  return options;
}
export async function setup(options, { azureFactory = request => new Azure(request), ...dependencies } = {}) {
  const request = options.request ? validateRequest(await readPrivate(path.resolve(options.request))) : null;
  return withInventory(options.config, request, async (inventory, save) => {
    const azure = azureFactory(inventory.request);
    try {
      if (options.action === 'status') return { schemaVersion: inventory.schemaVersion, revision: inventory.revision,
        targetSha256: targetHash(inventory), resources: inventory.resources, gates: inventory.gates, runtime: inventory.runtime,
        diagnostics: inventory.diagnostics, operation: inventory.operation, recovery: inventory.recovery ? recoveryPreview(inventory) : null,
        preview: inventory.preview, liveAcceptance: inventory.gates['native-manager-obo'].status };
      if (options.action === 'plan') { const result = await planStage(inventory, azure, options.stage); await save(); return result; }
      if (options.action === 'apply') return await applyStage(inventory, azure, options.stage, options.approve, save, dependencies);
      if (options.action === 'recover') {
        if (!options.approve) return recoveryPreview(inventory);
        return await recover(inventory, azure, options.approve, save);
      }
      recordEvidence(inventory, await readPrivate(path.resolve(options.evidence))); await save();
      return { status: 'owner-evidence-recorded', nativeAcceptance: inventory.gates['native-manager-obo'].status,
        note: 'These checks were recorded by the owner. Native authentication must still pass its real probe.' };
    } catch (error) {
      if (options.action === 'plan') {
        inventory.lastFailure = { stage: options.stage, code: error.code ?? 'setup-blocked',
          at: new Date().toISOString(), message: 'Setup stopped. Review this stage and its private state before trying again. No fallback was used.' };
        await save();
      }
      throw error;
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--help') console.log(`HTML publisher onboarding (Node.js 24, Windows/macOS/Linux; Linux App Service).
plan --request <private.json> [--config <resources.json>] [--stage ${STAGES.join('|')}]
apply --config <resources.json> --stage <stage> --approve <preview-sha256>
status --config <resources.json>
recover --config <resources.json> [--approve <recovery-sha256>]
evidence --config <resources.json> --evidence <private-owner-evidence.json>
Plan contacts explicitly selected Azure/Graph metadata. Status is local. Preview digests bind scope,
not authenticated user permission: obtain explicit human/tool approval for every impactful stage.
Setup will not sign in, install software, grant broad consent or delete resources.
Publishing checks must pass before activation, even after provisioning succeeds.
Windows execution is unverified; native acceptance and publishing need POSIX.
See references/onboarding.md.`);
  else {
    try { console.log(JSON.stringify(await setup(parseArgs(process.argv.slice(2))), null, 2)); }
    catch (error) { console.error(JSON.stringify({ code: error.code ?? 'setup-blocked', error: error.message, success: false })); process.exitCode = 1; }
  }
}
