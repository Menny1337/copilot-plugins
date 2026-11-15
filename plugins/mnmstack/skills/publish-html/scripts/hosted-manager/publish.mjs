#!/usr/bin/env node
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUID, NAME, SHA, fail, htmlBytes, readRegular, digest } from './common.mjs';
import { ClientError, nativeSignInFailure, readResponse, responseFailure, transportFailure, uncertainFailure, sameThumbnail } from './client-protocol.mjs';
import { MAX_PNG, thumbnailInput } from './png.mjs';
import { publisherTarget } from '../onboarding/state.mjs';
import { createBrowserTransport } from './browser-transport.mjs';

export async function azureToken({ tenantId, apiClientId }, run = execFile) {
  if (process.platform === 'win32') fail(400, 'platform', 'The own-API CLI requires POSIX Node 24 and Azure CLI. Native Windows activation has not been validated.');
  return new Promise((resolve, reject) => {
    run('az', ['account', 'get-access-token', '--tenant', tenantId, '--scope', `api://${apiClientId}/publish_as_user`,
      '--query', 'accessToken', '--output', 'tsv', '--only-show-errors'],
    { encoding: 'utf8', maxBuffer: 65536, timeout: 60000, windowsHide: true }, (error, stdout) => {
      if (error || typeof stdout !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(stdout.trim())) {
        reject(new Error('Own-API token acquisition failed. Sign-in, consent or conditional-access review required; no fallback is permitted.'));
      } else resolve(stdout.trim());
    });
  });
}
export function parseArgs(args) {
  const [action, ...rest] = args;
  if (!['inventory', 'upload', 'replace', 'delete', 'restore'].includes(action)) throw new Error('Use inventory, upload, replace, delete or restore. See hosted-manager.md for exact arguments.');
  const options = {};
  const allowed = ['config', 'origin', 'tenant', 'api-client', 'file', 'name', 'confirm', 'revision', 'sha256', 'backup-id', 'backup-sha256', 'thumbnail', 'thumbnail-html-sha256', 'browser-runtime'];
  for (let i = 0; i < rest.length;) {
    const flag = rest[i++];
    if (flag === '--browser') {
      if (Object.hasOwn(options, 'browser')) throw new Error('Duplicate browser option.');
      options.browser = true; continue;
    }
    const key = flag.slice(2), value = rest[i++];
    if (!flag.startsWith('--') || !allowed.includes(key) || !value || value.startsWith('--') || Object.hasOwn(options, key)) throw new Error('Unknown, duplicate or incomplete option.');
    options[key] = value;
  }
  if (options['browser-runtime'] && !options.browser && !options.config) throw new Error('--browser-runtime requires --browser.');
  if (options.config) {
    if (['origin', 'tenant', 'api-client'].some(key => options[key])) throw new Error('Use either a private onboarding config or explicit target arguments, never both.');
  } else {
    let url;
    try { url = new URL(options.origin); } catch { throw new Error('Explicit approved HTTPS origin required.'); }
    if (url.protocol !== 'https:' || url.origin !== options.origin || url.port || url.username || url.password ||
        !GUID.test(options.tenant ?? '') || !GUID.test(options['api-client'] ?? '')) throw new Error('Exact HTTPS origin, tenant GUID and own-API app GUID required.');
  }
  const imageFields = ['thumbnail', 'thumbnail-html-sha256'];
  const imageRequested = imageFields.some(key => Object.hasOwn(options, key));
  if (imageRequested && (!['upload', 'replace'].includes(action) || imageFields.some(key => !options[key]))) throw new Error('Upload/replace thumbnails require both --thumbnail and --thumbnail-html-sha256.');
  const fields = [...(options.config ? ['config'] : ['origin', 'tenant', 'api-client']),
    ...(options.browser ? ['browser'] : []), ...(options['browser-runtime'] ? ['browser-runtime'] : []),
    ...(imageRequested ? imageFields : []), ...(action === 'inventory' ? [] :
    ['confirm', ...(['upload', 'replace'].includes(action) ? ['file'] : ['name']),
      ...(action === 'upload' ? [] : ['revision', 'sha256']),
      ...(action === 'restore' ? ['backup-id', 'backup-sha256'] : [])])];
  if (Object.keys(options).some(key => !fields.includes(key)) || fields.some(key => !options[key])) throw new Error('Arguments do not match the selected operation.');
  return { action, ...options, tenantId: options.tenant, apiClientId: options['api-client'] };
}
export async function resolvePublisherConfig(options) {
  const resolved = options.config ? { ...options, ...await publisherTarget(options.config, options.action) } : options;
  if (resolved['browser-runtime'] && resolved.browser !== true) throw new Error('--browser-runtime requires browser publishing.');
  return resolved;
}
export async function easyAuthSession(origin, token, fetchImpl = globalThis.fetch) {
  let response = null, stage = 'transport';
  try {
    response = await fetchImpl(`${origin}/.auth/login/aad`, {
      method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: token }),
    });
    stage = 'http-response';
    if (response.status !== 200) { await response.body?.cancel(); throw new Error('Native sign-in refused.'); }
    stage = 'session-response';
    const result = await readResponse(response, 65536);
    if (typeof result?.authenticationToken !== 'string' || !/^[A-Za-z0-9._-]{1,32768}$/.test(result.authenticationToken) ||
        typeof result?.user?.userId !== 'string' || !result.user.userId || result.user.userId.length > 1024) throw new Error('Invalid native session.');
    return result.authenticationToken;
  } catch {
    throw nativeSignInFailure(response, stage);
  }
}
export async function runPublisher(options, { fetchImpl = globalThis.fetch, tokenProvider = azureToken,
  browserFactory = createBrowserTransport, onSignInRequired, signal } = {}) {
  let body = null, suppliedThumbnail = null;
  if ((options.thumbnail || options['thumbnail-html-sha256']) &&
      (!['upload', 'replace'].includes(options.action) || !options.thumbnail || !options['thumbnail-html-sha256'])) throw new Error('Upload/replace thumbnails require the PNG path and exact HTML SHA-256.');
  if (options.action !== 'inventory') {
    let bytes = null;
    const name = ['upload', 'replace'].includes(options.action) ? path.basename(options.file) : options.name;
    if (!NAME.test(name ?? '') || options.confirm !== name) throw new Error('Type the exact selected filename with --confirm.');
    if (['upload', 'replace'].includes(options.action)) bytes = htmlBytes((await readRegular(path.resolve(options.file))).bytes);
    if (options.expectedFileSha256 && digest(bytes) !== options.expectedFileSha256) throw new ClientError('local-file-changed',
      'Selected local HTML changed after review. No credentials or mutation were sent.', 'not-sent');
    if (options.action !== 'upload' && (!options.revision || options.revision.length > 160 ||
        !(options.sha256 === 'missing' || SHA.test(options.sha256 ?? '')))) throw new Error('Reviewed --revision and --sha256 (or missing) required.');
    if (options.action === 'restore' && (!GUID.test(options['backup-id'] ?? '') || !SHA.test(options['backup-sha256'] ?? ''))) throw new Error('Reviewed backup ID and SHA-256 required.');
    body = {
      action: options.action, name, confirmation: options.confirm,
      expectedRevision: options.action === 'upload' ? 'missing' : options.revision,
      expectedSha256: options.action === 'upload' || options.sha256 === 'missing' ? null : options.sha256,
      htmlBase64: bytes?.toString('base64') ?? null,
      backupId: options['backup-id'] ?? null, backupSha256: options['backup-sha256'] ?? null,
    };
    if (options.thumbnail) {
      body.thumbnail = { htmlSha256: options['thumbnail-html-sha256'], pngBase64: (await readRegular(path.resolve(options.thumbnail), MAX_PNG)).bytes.toString('base64') };
      suppliedThumbnail = thumbnailInput(body.thumbnail, digest(bytes)).metadata;
    }
  }
  let token = null, browser = null, delivered = null, failure = null;
  try {
    if (options.browser === true) {
      browser = await browserFactory({ origin: options.origin, runtimePath: options['browser-runtime'], onSignInRequired, signal });
      fetchImpl = browser.fetchImpl;
    } else token = await tokenProvider(options);
    async function request(route, payload) {
      let response, result;
      try {
        response = await fetchImpl(`${options.origin}/_manager/api/${route}`, {
          method: payload ? 'POST' : 'GET', credentials: browser ? 'same-origin' : 'omit', redirect: 'error',
          signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
          headers: { ...(browser ? {} : { Authorization: `Bearer ${token}` }), ...(payload ? { 'Content-Type': 'application/json', 'X-Manager-Request': '1' } : {}) },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        result = await readResponse(response);
      } catch {
        const error = browser && response && !response.ok ? new ClientError('http-rejected',
          `Manager endpoint returned HTTP ${response.status} without a verified manager error. Do not retry blindly; inspect inventory and host evidence.`,
          payload ? 'uncertain' : 'not-sent') : transportFailure(Boolean(payload));
        if (browser && response?.browserHttp) error.browserHttp = response.browserHttp;
        throw error;
      }
      if (!response.ok) {
        const error = responseFailure(response.status, result, Boolean(payload));
        if (browser && response.browserHttp) error.browserHttp = response.browserHttp;
        throw error;
      }
      return result;
    }
    if (options.action === 'upload') {
      const inventory = await request('inventory');
      if (!Array.isArray(inventory.pages) || !inventory.missingVersions || inventory.pages.some(page => page.name.toLowerCase() === body.name.toLowerCase())) throw new Error('Destination exists or inventory is invalid. Explicit reviewed replace is required.');
      body.expectedRevision = inventory.missingVersions[body.name] ?? 'missing';
    }
    const result = await request(body ? 'mutate' : 'inventory', body);
    if (body && (!result || result.verified !== true || result.name !== body.name || result.action !== body.action || !GUID.test(result.transactionId ?? '') ||
        result.revision !== result.transactionId || result.sha256 !== (body.action === 'delete' ? null : body.action === 'restore' ? body.backupSha256 :
          digest(Buffer.from(body.htmlBase64, 'base64'))))) throw uncertainFailure(result?.transactionId);
    if (suppliedThumbnail && !sameThumbnail(suppliedThumbnail, result.thumbnail)) throw uncertainFailure(result?.transactionId);
    delivered = result;
    return body && body.action !== 'delete' ? { ...result, url: `${options.origin}/${body.name}` } : result;
  } catch (error) { failure = error; throw error; }
  finally {
    token = null;
    try { await browser?.close(); }
    catch {
      if (failure) { failure.browserCleanupUnverified = true; throw failure; }
      throw new ClientError('browser-cleanup', 'Owned browser shutdown could not be verified. Profile retained; do not repeat the operation.',
        body && delivered?.verified === true ? 'verified-cleanup-pending' : 'not-sent', delivered?.transactionId ?? null);
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--help') {
    console.log('HTML publisher. Actions: inventory, upload, replace, delete, restore. Use --config <private-resources.json> or explicit --origin, --tenant and --api-client. Default bearer requires POSIX Node 24 + Azure CLI. Optional --browser uses a fresh owned SSO browser on macOS/Windows; --browser-runtime selects browser-window.mjs. Upload/replace optionally accept --thumbnail <reviewed.png> --thumbnail-html-sha256 <exact-html-sha256>. Local capture: render-thumbnail.mjs. Config never invokes setup. No cookie export or Kudu fallback.');
  } else {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.on('SIGINT', cancel);
    try { console.log(JSON.stringify(await runPublisher(await resolvePublisherConfig(parseArgs(process.argv.slice(2))), { signal: controller.signal }))); }
    catch (error) {
      console.error(JSON.stringify({ code: error.code ?? 'publisher-failed', outcome: error.outcome ?? 'not-sent',
        transactionId: error.transactionId ?? null, error: error.message,
        ...(error.code === 'native-sign-in' ? { nativeSignIn: error.nativeSignIn } : {}),
        ...(error.browserHttp ? { browserHttp: error.browserHttp } : {}),
        ...(error.browserCleanupUnverified ? { browserCleanupUnverified: true } : {}) }));
      process.exitCode = 1;
    }
    finally { process.removeListener('SIGINT', cancel); }
  }
}
