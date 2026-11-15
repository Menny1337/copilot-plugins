import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, createServer } from './server.mjs';
import { safeDirectory } from './common.mjs';

export async function prepareStorage(config) {
  // Only the two documented App Service paths can be initialized by onboarding.
  if (config.contentDir !== '/home/site/wwwroot/content' || config.stateDir !== '/home/site/html-manager/state') throw new Error('Onboarding storage paths differ from the approved fixed layout.');
  await safeDirectory('/home/site');
  for (const directory of ['/home/site/wwwroot', '/home/site/html-manager', config.contentDir]) {
    try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await safeDirectory(directory);
  }
}
export async function startHost(config = loadConfig(), { prepare = prepareStorage, create = createServer } = {}) {
  await prepare(config);
  const server = await create(config);
  server.on('error', () => { console.error('HTML host failed to listen.'); process.exitCode = 1; });
  server.listen(config.port, '0.0.0.0');
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await startHost(); }
  catch { console.error('HTML host storage/configuration initialization failed. Preserve state and inspect the approved paths; no fallback.'); process.exitCode = 1; }
}
