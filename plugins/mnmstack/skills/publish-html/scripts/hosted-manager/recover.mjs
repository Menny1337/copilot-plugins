#!/usr/bin/env node
import { loadConfig } from './config.mjs';
import { PageStore } from './store.mjs';
import { ManagerError } from './common.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--writers-stopped') {
  console.error('Offline operator recovery only: stop ALL writers, disable mutations, preserve/move the abandoned writer.lock after checking no owner is alive, then run recover.mjs --writers-stopped. This tool never steals a lock or rewrites live content.');
  process.exitCode = 1;
} else {
  try {
    const config = loadConfig();
    if (config.mutationsEnabled || !config.legacyPublishersFrozen) throw new Error('Recovery requires mutations disabled and legacy/manual publishers frozen.');
    console.log(JSON.stringify({ recovered: await (await new PageStore(config).initialize()).recover() }));
  } catch (error) {
    console.error(error instanceof ManagerError ? `Offline recovery refused (${error.code}): ${error.message}` :
      error.code ? 'Offline recovery storage operation failed. Preserve the lock and all transaction evidence; inspect storage availability. No success is confirmed.' :
        `Offline recovery configuration refused: ${error.message}`);
    process.exitCode = 1;
  }
}
