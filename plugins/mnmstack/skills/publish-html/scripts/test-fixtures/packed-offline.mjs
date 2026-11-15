import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import child from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

const log = event => appendFileSync(process.env.HTMLPUB_TEST_IO_LOG, JSON.stringify(event) + '\n', { mode: 0o600 });
const forbidden = () => { log({ forbidden: true }); throw new Error('PACKED OFFLINE TEST: service or child dispatch forbidden'); };
globalThis.fetch = forbidden;
net.Socket.prototype.connect = tls.connect = forbidden;
http.request = http.get = https.request = https.get = forbidden;
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6']) dns[name] = forbidden;
for (const name of Object.keys(dns.promises)) if (typeof dns.promises[name] === 'function') dns.promises[name] = forbidden;
for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) child[name] = forbidden;
syncBuiltinESMExports();

const { Azure } = await import(pathToFileURL(path.join(process.env.HTMLPUB_PACKED_ROOT, 'scripts/onboarding/azure.mjs')));
const guid = n => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const account = { id: guid(1), tenantId: guid(2), name: 'Packed offline subscription', state: 'Enabled',
  environmentName: 'AzureCloud', user: { type: 'user', name: `${'a'.repeat(30)}@example.invalid` } };
Azure.prototype.cli = async function (args) {
  const command = args.slice(0, 2).join(' ');
  log({ command, synthetic: true });
  if (command === 'account list') return [account];
  if (command === 'account show') return account;
  return forbidden();
};
