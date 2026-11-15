import { terminal, SavedExit, optionalPrivate, confirm } from '../htmlpub-terminal.mjs';
import { runHtmlpub } from '../htmlpub.mjs';

// Only this fixture uses synthetic metadata. Every external dispatch is a test failure.
const forbidden = () => { throw new Error('OFFLINE FIXTURE: external dispatch forbidden'); };
globalThis.fetch = forbidden;
process.env.PATH = '';
const guid = n => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const catalog = {
  async accounts() { return [{ id: guid(1), tenantId: guid(2), name: 'Offline subscription',
    user: { type: 'user', name: 'sample@example.invalid' } }]; },
  async select() {},
  async regions() { return [{ name: 'eastus', displayName: 'East US' }]; },
  async resources(role) {
    if (role === 'users') return [3, 4].map(n => ({ id: guid(n), displayName: `Sample manager ${n}` }));
    if (role === 'clients') return [5, 6].map(n => ({ appId: guid(n), displayName: `Sample client ${n}` }));
    if (role === 'group') return [7, 8].map(n => ({ id: guid(n), displayName: `Sample readers ${n}` }));
    return [];
  },
  async estimate() { return { monthlyUsd: 73, hourlyUsd: 0.1, assumption: 'Synthetic 730-hour estimate', source: 'offline fixture' }; },
};
const ui = terminal();
const [scenario, config] = process.argv.slice(2);
const items = ['Alpha', 'Beta', 'Gamma'].map(label => ({ label, value: label.toLowerCase() }));
let result;
try {
  if (scenario === 'wizard') {
    result = await runHtmlpub(['setup', '--config', config], { ui,
      setupDependencies: { catalog, engine: forbidden }, publisherTransport: { tokenProvider: forbidden, fetchImpl: forbidden } });
    result.draft = await optionalPrivate(`${config}.guided.json`);
    result.inventory = await optionalPrivate(config);
  } else if (scenario === 'approval') { await confirm(ui, 'DELETE report.html'); result = 'approved'; }
  else if (scenario === 'multiple') result = await ui.multiselect('Choose readers', items, { min: 1, max: 2 });
  else if (scenario === 'text') result = await ui.ask('Report name');
  else result = await ui.select('Choose a target', items);
} catch (error) {
  if (!(error instanceof SavedExit)) throw error;
  result = { status: 'saved' };
} finally { ui.close(); }
console.log(`TEST-RESULT ${JSON.stringify(result)}`);
