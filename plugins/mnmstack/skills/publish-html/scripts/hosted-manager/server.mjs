import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize } from './auth.mjs';
import { loadConfig } from './config.mjs';
import { PageStore } from './store.mjs';
import { ManagerError, fail, readRegular, MAX_HTML, GUID } from './common.mjs';
import { MAX_PNG } from './png.mjs';

export { loadConfig, authorize };
const here = path.dirname(fileURLToPath(import.meta.url));
export const MIME_TYPES = Object.freeze({
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ico: 'image/vnd.microsoft.icon', woff: 'font/woff', woff2: 'font/woff2',
  ttf: 'font/ttf', wasm: 'application/wasm', txt: 'text/plain; charset=utf-8',
});
const HEADERS = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "frame-ancestors 'self'",
};
const MANAGER_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
export function contentName(target) {
  const pathname = target.split('?')[0];
  if (pathname === '/') return 'index.html';
  const match = /^\/[A-Za-z0-9][A-Za-z0-9_-]*\.([a-z0-9]+)$/.exec(pathname);
  if (!match || !Object.hasOwn(MIME_TYPES, match[1])) fail(404, 'not-found', 'Not found.');
  return pathname.slice(1);
}
async function requestJson(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > Math.ceil(MAX_HTML / 3) * 4 + Math.ceil(MAX_PNG / 3) * 4 + 8192) fail(413, 'request-size', 'Request too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { fail(400, 'request-json', 'Valid UTF-8 JSON required.'); }
}
function managerRequest(req, config, mutation) {
  if (req.headers.host !== new URL(config.origin).host ||
      (req.headers.origin !== undefined && req.headers.origin !== config.origin) ||
      (req.headers['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
    fail(403, 'manager-origin', 'Exact approved manager origin required.');
  }
  if (mutation && (req.headers['content-type'] !== 'application/json' || req.headers['x-manager-request'] !== '1' ||
      (req.headers.authorization === undefined && req.headers['x-manager-assertion'] === undefined && req.headers.origin !== config.origin))) {
    fail(403, 'manager-request', 'Same-origin JSON manager request required.');
  }
}
export async function createServer(config, dependencies = {}) {
  const store = dependencies.store ?? await new PageStore(config).initialize();
  const server = http.createServer({ maxHeaderSize: 49152 }, async (req, res) => {
    const manager = req.url === '/_manager' || req.url.startsWith('/_manager/');
    const send = (status, data, type = 'application/json; charset=utf-8', extra = {}) => {
      const body = type.startsWith('application/json') && !Buffer.isBuffer(data) ? JSON.stringify(data) : data;
      res.writeHead(status, {
        ...HEADERS, ...(manager ? { 'Content-Security-Policy': MANAGER_CSP, 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin' } : {}),
        'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    try {
      // Reserved management routes precede the legacy GET/HEAD flat-content path.
      if (manager) {
        const mutation = req.url === '/_manager/api/mutate' && req.method === 'POST';
        managerRequest(req, config, mutation);
        const identity = await authorize(req.headers, config, dependencies, true);
        const assets = ['/_manager', '/_manager/', '/_manager/manager-ui.mjs', '/_manager/client-protocol.mjs'];
        const inventoryRoute = req.url === '/_manager/api/inventory';
        const mutateRoute = req.url === '/_manager/api/mutate';
        const thumbnailRoute = /^\/_manager\/api\/thumbnail\/([a-f0-9-]{36})\/(before|after)\/([a-f0-9]{64})\.png$/.exec(req.url);
        const readMethod = ['GET', 'HEAD'].includes(req.method);
        if (readMethod && assets.includes(req.url)) {
          const script = req.url.endsWith('.mjs');
          send(200, (await readRegular(path.join(here, script ? path.basename(req.url) : 'manager.html'))).bytes,
            script ? MIME_TYPES.mjs : MIME_TYPES.html);
        } else if (thumbnailRoute && req.method === 'GET') {
          send(200, await store.thumbnail(...thumbnailRoute.slice(1)), MIME_TYPES.png, { 'Cache-Control': 'private, no-store' });
        } else if (inventoryRoute && readMethod) {
          send(200, {
            ...await store.list(), origin: config.origin, mutationsEnabled: config.mutationsEnabled && config.legacyPublishersFrozen,
            access: { tenantId: config.tenantId, allowedGroupIds: config.allowedGroupIds, scope: 'host-wide configured requirements, not per-person entitlement', authentication: 'Microsoft Entra + live Graph user/group check', network: 'Host ingress policy must remain unchanged; not attested by this inventory.' },
          });
        } else if (mutation) {
          if (!config.mutationsEnabled || !config.legacyPublishersFrozen) fail(403, 'mutations-disabled', 'Hosted mutations are disabled until approved publisher cutover.');
          send(200, await store.mutate(await requestJson(req), identity.oid));
        } else if (assets.includes(req.url) || inventoryRoute || mutateRoute || thumbnailRoute) {
          send(405, { code: 'method-route', error: 'Unsupported manager method.' }, undefined, { Allow: mutateRoute ? 'POST' : thumbnailRoute ? 'GET' : 'GET, HEAD' });
        } else {
          send(404, { code: 'method-route', error: 'Unknown manager route.' });
        }
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { send(405, 'Method not allowed.', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' }); return; }
      const name = contentName(req.url);
      await authorize(req.headers, config, dependencies);
      const content = await readRegular(path.join(config.contentDir, name));
      send(200, content.bytes, MIME_TYPES[path.extname(name).slice(1)]);
    } catch (error) {
      const notFound = ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code);
      const status = error instanceof ManagerError ? error.status : notFound ? 404 : 500;
      if (status >= 500) (dependencies.logError ?? console.error)(`HTML host request failed (${error instanceof ManagerError ? error.code : 'internal'}).`);
      const message = error instanceof ManagerError ? error.message : notFound ? 'Not found.' : 'Request failed; outcome unverified.';
      send(status, manager ? { code: error instanceof ManagerError ? error.code : 'request-failed', error: message,
        ...(error instanceof ManagerError && GUID.test(error.transactionId ?? '') ? { transactionId: error.transactionId } : {}) } : message,
        manager ? undefined : 'text/plain; charset=utf-8');
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = loadConfig();
    const server = await createServer(config);
    server.on('error', () => { console.error('HTTP server failed.'); process.exitCode = 1; });
    server.listen(config.port, '0.0.0.0', () => console.log('HTML host listening behind mandatory EasyAuth; manager mutations are configuration-gated.'));
  } catch (error) {
    console.error(error instanceof ManagerError ? `HTML host initialization failed (${error.code}): ${error.message}` :
      error.code ? 'HTML host storage initialization failed. Check paths, volume availability and filesystem operations.' :
        `HTML host configuration failed: ${error.message}`);
    process.exitCode = 1;
  }
}
