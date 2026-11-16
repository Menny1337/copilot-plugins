import { execFile } from 'node:child_process';
import { open, unlink, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { MAX_RESPONSE_BYTES, ClientError } from './client-protocol.mjs';

const BUNDLED_RUNTIME = fileURLToPath(new URL('../browser-runtime/browser-window.mjs', import.meta.url));
const SIBLING_RUNTIME = fileURLToPath(new URL('../../../browser/scripts/browser-window.mjs', import.meta.url));
const fail = (code, message) => { throw new ClientError(code, message, 'not-sent'); };

async function defaultRuntime() {
  try { await stat(BUNDLED_RUNTIME); return BUNDLED_RUNTIME; }
  catch (error) {
    if (error.code === 'ENOENT') return SIBLING_RUNTIME;
    fail('browser-capability', 'The bundled browser runtime cannot be accessed. No fallback was attempted.');
  }
}
async function loadRuntime(runtimePath) {
  try {
    const window = await import(pathToFileURL(runtimePath).href);
    const managed = await import(pathToFileURL(join(dirname(runtimePath), 'browser-managed.mjs')).href);
    if (typeof window.run !== 'function' || typeof window.playwrightInvocation !== 'function' ||
        typeof managed.managedEnvironment !== 'function') throw new Error('Invalid runtime');
    return {
      start: () => window.run(['start']),
      close: session => window.run(['close', '--session', session]),
      async runCode(session, source, signal) {
        const filename = join(session.cwd, `publisher-${randomUUID()}.js`);
        const file = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
        try {
          await file.writeFile(source, 'utf8');
          await file.close();
          const invocation = window.playwrightInvocation();
          return await new Promise((resolve, reject) => {
            execFile(invocation.command, [...invocation.prefix, `-s=${session.session}`, '--raw', 'run-code', '--filename', filename],
              { cwd: session.cwd, env: managed.managedEnvironment(), encoding: 'utf8',
                maxBuffer: Math.ceil(MAX_RESPONSE_BYTES * 4 / 3) + 65536, timeout: 100000, signal, windowsHide: true },
              (error, stdout) => {
                if (error) reject(new Error('Browser command failed'));
                else {
                  try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid browser result')); }
                }
              });
          });
        } finally {
          await file.close();
          await unlink(filename);
        }
      },
    };
  } catch {
    fail('browser-capability', 'Browser mode requires the installed browser skill runtime and playwright-cli 0.1.19+. Set HTMLPUB_BROWSER_RUNTIME to its browser-window.mjs. No tools were installed.');
  }
}

export async function browserRequest(input) {
  if (location.origin !== input.origin || !location.pathname.startsWith('/_manager')) return { failure: 'origin' };
  const mutation = input.path === '/_manager/api/mutate';
  if (input.path !== (mutation ? '/_manager/api/mutate' : '/_manager/api/inventory') ||
      input.method !== (mutation ? 'POST' : 'GET') ||
      Object.keys(input.headers).some(key => !(mutation ? ['content-type', 'x-manager-request'] : []).includes(key)) ||
      (mutation ? input.headers['content-type'] !== 'application/json' || input.headers['x-manager-request'] !== '1' ||
        typeof input.body !== 'string' : input.body !== undefined)) return { failure: 'schema' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(input.path, { method: input.method, headers: input.headers,
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.method === 'POST' ? { referrerPolicy: 'same-origin' } : {}),
      credentials: 'same-origin', redirect: 'error', signal: controller.signal });
    const correlation = response.headers.get('x-ms-middleware-request-id');
    const metadata = { status: response.status, contentTypePresent: response.headers.has('content-type'),
      middlewareRequestId: /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(correlation ?? '') ? correlation : null };
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > input.maxBytes)) {
      await response.body?.cancel(); return { failure: 'limit' };
    }
    const chunks = [];
    let length = 0;
    const reader = response.body?.getReader();
    if (!reader) return { ...metadata, base64: '', bytes: 0 };
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > input.maxBytes) { await reader.cancel(); return { failure: 'limit' }; }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let binary = '';
    for (let start = 0; start < bytes.length; start += 8192) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    }
    return { ...metadata, base64: btoa(binary), bytes: length };
  } catch { return { failure: 'transport' }; }
  finally { clearTimeout(timer); }
}

async function interactiveSignIn({ signal } = {}) {
  if (!process.stdin.isTTY) return false;
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    await terminal.question('Complete sign-in or MFA in the dedicated browser, then press Enter. ', { signal });
    return true;
  } finally { terminal.close(); }
}

export async function createBrowserTransport({ origin, runtimePath = process.env.HTMLPUB_BROWSER_RUNTIME,
  signal, onSignInRequired = interactiveSignIn } = {}, { runtime } = {}) {
  let target;
  try { target = new URL(origin); } catch { fail('browser-target', 'Exact approved HTTPS origin required.'); }
  runtimePath ??= await defaultRuntime();
  if (target.protocol !== 'https:' || target.origin !== origin || target.port || target.username || target.password ||
      !isAbsolute(runtimePath) || (signal !== undefined && !(signal instanceof AbortSignal))) {
    fail('browser-target', 'Exact approved HTTPS origin and absolute browser runtime path required.');
  }
  runtime ??= await loadRuntime(runtimePath);
  if (['start', 'close', 'runCode'].some(key => typeof runtime[key] !== 'function')) {
    fail('browser-capability', 'Owned browser runtime is unavailable.');
  }
  let session, closed = false, owned = false;
  async function close() {
    if (closed || !owned) return;
    const result = await runtime.close(session.session);
    if (result?.ok !== true || result.mode !== 'managed' || result.closed !== true ||
        result.session !== session.session || result.profilePath !== session.profilePath || result.profileRetained !== true) {
      fail('browser-cleanup', 'Owned browser shutdown could not be verified. Profile retained; do not retry the operation.');
    }
    closed = true;
  }
  try {
    signal?.throwIfAborted();
    session = await runtime.start();
    if (session?.ok !== true || session.mode !== 'managed' || session.activity !== 'active' ||
        !/^agent-[A-Za-z0-9._-]{1,58}$/.test(session.session ?? '') || !isAbsolute(session.cwd ?? '') ||
        session.profilePath !== join(session.cwd, 'profile') || session.profileRetained !== true) {
      fail('browser-ownership', 'A fresh agent-owned browser profile is required.');
    }
    owned = true;
    let canonicalRetryUsed = false;
    const ready = async navigate => {
      const result = await runtime.runCode(session, `async page => {
      const deadline = Date.now() + 45000;
      let bootstrapRetried = false;
      const inspect = expected => {
        if (location.origin !== expected || location.pathname !== '/_manager/') return false;
        const status = performance.getEntriesByType('navigation')[0]?.responseStatus;
        if ([401, 403].includes(status)) {
          const text = document.body?.textContent;
          let managerOrigin = false;
          if (status === 403 && typeof text === 'string' && text.length <= 1024 &&
              new TextEncoder().encode(text).length <= 1024) {
            try { managerOrigin = JSON.parse(text)?.code === 'manager-origin'; } catch {}
          }
          return { accessDenied: true, managerOrigin };
        }
        const refresh = document.querySelector('#refresh'), summary = document.querySelector('#summary');
        if (refresh?.disabled === false && document.querySelector('#status')?.classList?.contains('error')) {
          return { failure: 'manager-inventory' };
        }
        return document.querySelector('#pages') && refresh?.disabled === false &&
          /^\\d+ of \\d+ HTML pages$/.test(summary?.textContent ?? '') ? { ready: true } : false;
      };
      ${navigate ? `try {
        await page.goto(${JSON.stringify(origin + '/_manager/')}, { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch (error) { if (error.name !== 'TimeoutError') return { failure: 'navigation' }; }` : ''}
      try { await page.waitForFunction(inspect, ${JSON.stringify(origin)}, { timeout: Math.max(1, deadline - Date.now()) }); }
      catch (error) { if (error.name !== 'TimeoutError') return { failure: 'readiness' }; }
      let state = await page.evaluate(inspect, ${JSON.stringify(origin)});
      if (state?.managerOrigin === true && ${!canonicalRetryUsed}) {
        bootstrapRetried = true;
        try {
          await page.goto(${JSON.stringify(origin + '/_manager/')},
            { waitUntil: 'domcontentloaded', timeout: Math.max(1, deadline - Date.now()) });
          await page.waitForFunction(inspect, ${JSON.stringify(origin)}, { timeout: Math.max(1, deadline - Date.now()) });
        } catch (error) { if (error.name !== 'TimeoutError') return { failure: 'navigation', bootstrapRetried }; }
        state = await page.evaluate(inspect, ${JSON.stringify(origin)});
      }
      if (state?.ready === true) {
        try { await page.waitForLoadState('networkidle', { timeout: Math.max(1, deadline - Date.now()) }); }
        catch { return { failure: 'manager-requests', bootstrapRetried }; }
      }
      return { ready: state?.ready === true, accessDenied: state?.accessDenied === true, failure: state?.failure, bootstrapRetried };
    }`, signal);
      if (result?.bootstrapRetried === true) canonicalRetryUsed = true;
      if (result?.failure) fail('browser-capability', 'Protected browser navigation or DOM readiness could not be verified. No manager operation was sent.');
      if (result?.accessDenied === true) fail('browser-access', 'The protected manager page denied access. Its account and service authorization gates remain enforced.');
      return result;
    };
    const readiness = await ready(true);
    if (readiness?.ready !== true) {
      if (typeof onSignInRequired !== 'function' || !await onSignInRequired({ session: session.session, signal }) ||
          (await ready(false))?.ready !== true) {
        fail('browser-sign-in', 'Sign-in or MFA requires your action in an interactive terminal. No manager operation was sent.');
      }
    }
    return {
      async fetchImpl(url, options) {
        signal?.throwIfAborted();
        const parsed = new URL(url);
        const mutation = parsed.pathname === '/_manager/api/mutate';
        const headers = new Headers(options.headers);
        if (closed || parsed.origin !== origin || parsed.search || parsed.hash || parsed.username || parsed.password ||
            url !== origin + parsed.pathname ||
            parsed.pathname !== (mutation ? '/_manager/api/mutate' : '/_manager/api/inventory') ||
            options.method !== (mutation ? 'POST' : 'GET') || options.credentials !== 'same-origin' || options.redirect !== 'error' ||
            [...headers.keys()].some(key => !(mutation ? ['content-type', 'x-manager-request'] : []).includes(key)) ||
            (mutation ? headers.get('content-type') !== 'application/json' || headers.get('x-manager-request') !== '1' ||
              typeof options.body !== 'string' : options.body !== undefined)) {
          fail('browser-request', 'Only same-origin manager requests without exported credentials are supported.');
        }
        const input = { origin, path: parsed.pathname, method: options.method,
          headers: Object.fromEntries(headers), body: options.body, maxBytes: MAX_RESPONSE_BYTES };
        const value = await runtime.runCode(session,
          `async page => page.evaluate(${browserRequest.toString()}, ${JSON.stringify(input)})`,
          options.signal ? AbortSignal.any([options.signal, ...(signal ? [signal] : [])]) : signal);
        if (!Number.isInteger(value?.status) || value.status < 200 || value.status > 599 ||
            typeof value.contentTypePresent !== 'boolean' ||
            !(value.middlewareRequestId === null || (typeof value.middlewareRequestId === 'string' &&
              /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.middlewareRequestId))) ||
            !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > MAX_RESPONSE_BYTES ||
            typeof value.base64 !== 'string' || value.base64.length > Math.ceil(MAX_RESPONSE_BYTES / 3) * 4) {
          fail('browser-response', 'Browser manager response could not be verified. No retry was attempted.');
        }
        const bytes = Buffer.from(value.base64, 'base64');
        const bodyless = [204, 205, 304].includes(value.status);
        if (bytes.length !== value.bytes || bytes.toString('base64') !== value.base64 || (bodyless && bytes.length)) {
          fail('browser-response', 'Browser manager response could not be verified. No retry was attempted.');
        }
        const response = new Response(bodyless ? null : bytes, { status: value.status });
        Object.defineProperty(response, 'browserHttp', { value: Object.freeze({ httpStatus: value.status,
          bodyBytes: value.bytes, contentTypePresent: value.contentTypePresent, middlewareRequestId: value.middlewareRequestId }) });
        return response;
      },
      close,
    };
  } catch (error) {
    await close();
    if (error instanceof ClientError) throw error;
    if (error?.details?.cleanupVerified === false) {
      fail('browser-cleanup', 'Owned browser startup cleanup could not be verified. Profile retained; do not retry.');
    }
    if (signal?.aborted) fail('browser-cancelled', 'Browser operation cancelled before any manager operation.');
    if (error?.code === 'foreground-browser') {
      fail('browser-foreground', 'Put a stable non-browser application in front, then retry. No focus action or manager operation was attempted.');
    }
    fail('browser-capability', 'Owned browser startup or sign-in could not be verified. No manager operation was sent.');
  }
}
