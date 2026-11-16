import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createBrowserTransport, browserRequest } from '../browser-transport.mjs';
import { parseArgs, runPublisher } from '../publish.mjs';
import { createServer } from '../server.mjs';
import { digest } from '../common.mjs';
import { MAX_RESPONSE_BYTES } from '../client-protocol.mjs';
import { fixture, origin, tenant, client, html, png, principal, graphFetch, other } from './test-support.mjs';

const inventoryRequest = () => ({ method: 'GET', credentials: 'same-origin', redirect: 'error', headers: {} });
const encode = value => {
  const bytes = Buffer.from(JSON.stringify(value));
  return { status: 200, bytes: bytes.length, base64: bytes.toString('base64'), contentTypePresent: true, middlewareRequestId: null };
};
function ownedRuntime(overrides = {}) {
  const session = { ok: true, mode: 'managed', activity: 'active', session: 'agent-offline',
    cwd: path.resolve('offline-owned-task'), profilePath: path.resolve('offline-owned-task/profile'), profileRetained: true };
  const calls = [];
  const runtime = {
    start: async () => { calls.push('start'); return session; },
    close: async id => { calls.push(['close', id]); return { ...session, closed: true }; },
    runCode: async (_session, source) => { calls.push(source); return source.includes('waitForFunction') ? { ready: true } : encode({ pages: [], missingVersions: {} }); },
    ...overrides,
  };
  return { runtime, session, calls };
}
test('explicit browser flags retain required target and mutation review fields', () => {
  const target = ['--origin', origin, '--tenant', tenant, '--api-client', client];
  const options = parseArgs(['inventory', '--browser', ...target, '--browser-runtime', path.resolve('runtime.mjs')]);
  assert.equal(options.browser, true);
  assert.equal(parseArgs(['inventory', ...target]).browser, undefined);
  assert.throws(() => parseArgs(['inventory', ...target, '--browser-runtime', '/runtime.mjs']));
  assert.throws(() => parseArgs(['inventory', ...target, '--browser', '--browser']));
  assert.throws(() => parseArgs(['replace', ...target, '--browser', '--file', 'report.html', '--confirm', 'report.html']));
});
test('missing runtime and foreground guard are actionable without launch fallback', async t => {
  const { root } = await fixture(t);
  await assert.rejects(createBrowserTransport({ origin, runtimePath: path.join(root, 'absent.mjs') }), { code: 'browser-capability' });
  const { runtime, calls } = ownedRuntime({ start: async () => { throw Object.assign(new Error('private text'), { code: 'foreground-browser' }); } });
  await assert.rejects(createBrowserTransport({ origin }, { runtime }), error =>
    error.code === 'browser-foreground' && error.message.includes('non-browser') && !error.message.includes('private text'));
  assert.deepEqual(calls, []);
});
test('identity-mismatched or attached profiles are never closed or used', async () => {
  for (const override of [{ mode: 'bridge' }, { profilePath: '/normal/profile' }, { session: 'normal-user' }]) {
    const setup = ownedRuntime();
    setup.runtime.start = async () => ({ ...setup.session, ...override });
    await assert.rejects(createBrowserTransport({ origin }, setup), { code: 'browser-ownership' });
    assert.deepEqual(setup.calls, []);
  }
});
test('MFA callback resumes the same session once; access denial and cancellation remain separate', async () => {
  let ready = false;
  const setup = ownedRuntime({ runCode: async () => ({ ready }) });
  const browser = await createBrowserTransport({ origin, onSignInRequired: async ({ session }) => {
    assert.equal(session, setup.session.session); ready = true; return true;
  } }, setup);
  await browser.close(); await browser.close();
  assert.equal(setup.calls.filter(call => Array.isArray(call)).length, 1);
  const denied = ownedRuntime({ runCode: async () => ({ accessDenied: true }) });
  await assert.rejects(createBrowserTransport({ origin, onSignInRequired: () => assert.fail('not MFA') }, denied), { code: 'browser-access' });
  const controller = new AbortController(); controller.abort();
  const cancelled = ownedRuntime();
  await assert.rejects(createBrowserTransport({ origin, signal: controller.signal }, cancelled), { code: 'browser-cancelled' });
  assert.deepEqual(cancelled.calls, []);
  const unresolved = ownedRuntime({ runCode: async () => ({ ready: false }) });
  await assert.rejects(createBrowserTransport({ origin, onSignInRequired: async () => false }, unresolved), { code: 'browser-sign-in' });
  assert.equal(unresolved.calls.filter(call => Array.isArray(call)).length, 1);
});
test('browser adapter forbids credential export, foreign routes, redirects and forged headers', async () => {
  const setup = ownedRuntime(), browser = await createBrowserTransport({ origin }, setup);
  for (const [url, changes] of [
    ['https://foreign.test/_manager/api/inventory', {}], [origin + '/.auth/me', {}],
    [origin + '/_manager/api/inventory?x=1', {}], [origin + '/_manager/api/inventory#fragment', {}],
    [origin + '/_manager/api/inventory', { credentials: 'omit' }],
    [origin + '/_manager/api/inventory', { redirect: 'follow' }],
    ...['Authorization', 'Cookie', 'X-ZUMO-AUTH', 'X-Manager-Assertion', 'X-MS-CLIENT-PRINCIPAL', 'Origin'].map(header =>
      [origin + '/_manager/api/inventory', { headers: { [header]: 'must-not-be-sent' } }]),
  ]) await assert.rejects(browser.fetchImpl(url, { ...inventoryRequest(), ...changes }), { code: 'browser-request' });
  assert.equal(setup.calls.filter(call => typeof call === 'string' && call.startsWith('async page => page.evaluate')).length, 0);
  await browser.close();
});
test('browser response adapter rejects malformed or excessive results without retry', async () => {
  for (const value of [{ status: 200, bytes: 1, base64: '!!!!' }, { status: 200, bytes: MAX_RESPONSE_BYTES + 1, base64: '' },
    { failure: 'transport' }, { status: 204, bytes: 1, base64: 'YQ==' },
    { ...encode({}), middlewareRequestId: ['99999999-9999-4999-8999-999999999999'] }]) {
    const setup = ownedRuntime({ runCode: async (_session, source) => source.includes('waitForFunction') ? { ready: true } : value });
    const browser = await createBrowserTransport({ origin }, setup);
    await assert.rejects(browser.fetchImpl(origin + '/_manager/api/inventory', inventoryRequest()), { code: 'browser-response' });
    await browser.close();
  }
});
function pageContext(fetchImpl, overrides = {}) {
  const location = { origin, pathname: '/_manager/' };
  const readyNode = { disabled: false, textContent: '0 of 0 HTML pages', classList: { contains: () => false } };
  const context = { location, document: { querySelector: () => readyNode }, Date, Uint8Array, AbortController,
    TextEncoder, setTimeout, clearTimeout, btoa, fetch: fetchImpl,
    performance: { getEntriesByType: () => [{ responseStatus: 200 }] }, ...overrides.context };
  const page = {
    goto: async url => { assert.equal(url, origin + '/_manager/'); return { status: () => 200, url: () => url }; },
    waitForFunction: async (fn, argument) => {
      if (!fn(argument)) throw Object.assign(new Error('readiness timed out'), { name: 'TimeoutError' });
    },
    waitForLoadState: async () => {},
    evaluate: async (fn, argument) => fn(argument),
    ...overrides.page,
  };
  return source => vm.runInNewContext(`(${source})`, context)(page);
}
test('SSO manager-origin document rejection permits only one same-origin canonical navigation', async () => {
  for (const [code, status, currentOrigin, expectedVisits] of [
    ['manager-origin', 403, origin, 2], ['manager', 403, origin, 1],
    ['reader', 403, origin, 1], ['manager-origin', 401, origin, 1],
    ['manager-origin', 403, 'https://foreign.test', 1],
  ]) {
    let visits = 0, currentStatus = status;
    const execute = pageContext(() => assert.fail('bootstrap must not request an API'), {
      context: { location: { origin: currentOrigin, pathname: '/_manager/' },
        performance: { getEntriesByType: () => [{ responseStatus: currentStatus }] },
        document: { body: { textContent: JSON.stringify({ code }) },
          querySelector: () => ({ disabled: false, textContent: '0 of 0 HTML pages' }) } },
      page: { goto: async url => {
        assert.equal(url, origin + '/_manager/'); visits++;
        if (visits === 2) currentStatus = 200;
        return { status: () => 200, url: () => 'https://sso.test/' };
      } },
    });
    const setup = ownedRuntime({ runCode: async (_session, source) => execute(source) });
    if (expectedVisits === 2) {
      const browser = await createBrowserTransport({ origin }, setup); await browser.close();
    } else await assert.rejects(createBrowserTransport({ origin }, setup),
      { code: currentOrigin === origin ? 'browser-access' : 'browser-sign-in' });
    assert.equal(visits, expectedVisits);
  }
  let visits = 0;
  const execute = pageContext(() => assert.fail('no API retry'), {
    context: { document: { body: { textContent: '{"code":"manager-origin"}' },
      querySelector: () => ({ disabled: false, textContent: '0 of 0 HTML pages' }) },
      performance: { getEntriesByType: () => [{ responseStatus: 403 }] } },
    page: { goto: async url => { visits++; return { status: () => 403, url: () => url }; } },
  });
  await assert.rejects(createBrowserTransport({ origin }, ownedRuntime({ runCode: async (_session, source) => execute(source) })),
    { code: 'browser-access' });
  assert.equal(visits, 2);
});
test('bootstrap after MFA shares its navigation budget and unsupported readiness is not sign-in', async () => {
  let visits = 0, signedIn = false, status = 200;
  const execute = pageContext(() => assert.fail('no API before readiness'), {
    context: { performance: { getEntriesByType: () => [{ responseStatus: status }] },
      document: { body: { textContent: '{"code":"manager-origin"}' }, querySelector: () => signedIn ? {} : null } },
    page: { goto: async () => { visits++; if (signedIn) status = 403; } },
  });
  await assert.rejects(createBrowserTransport({ origin, onSignInRequired: async () => {
    signedIn = true; status = 403; return true;
  } }, ownedRuntime({ runCode: async (_session, source) => execute(source) })), { code: 'browser-access' });
  assert.equal(visits, 2);
  const broken = pageContext(() => assert.fail('no API'), {
    page: { waitForFunction: async () => { throw new TypeError('unsupported'); } },
  });
  await assert.rejects(createBrowserTransport({ origin, onSignInRequired: () => assert.fail('not MFA') },
    ownedRuntime({ runCode: async (_session, source) => broken(source) })), { code: 'browser-capability' });
});
test('bootstrap waits for the server HTML revisit without adding a CLI navigation or retrying its fallback', async () => {
  for (const finalStatus of [200, 403]) {
    let status = 403, visits = 0;
    const location = { origin, pathname: '/_manager/', search: '' };
    const execute = pageContext(() => assert.fail('no API before recovery finishes'), {
      context: { location, performance: { getEntriesByType: () => [{ responseStatus: status }] },
        document: { body: { textContent: 'Generic recovery guidance, not JSON.' },
          querySelector: selector => selector === 'meta[name="manager-origin-recovery"]' ?
            (location.search === '' ? { content: 'revisit' } : null) :
            { disabled: false, textContent: '0 of 0 HTML pages' } } },
      page: { goto: async url => { assert.equal(url, origin + '/_manager/'); visits++; },
        waitForFunction: async (fn, arg) => {
          assert.equal(fn(arg), false);
          location.search = '?recovery=1'; status = finalStatus;
          assert.ok(fn(arg));
        } },
    });
    const setup = ownedRuntime({ runCode: async (_session, source) => execute(source) });
    if (finalStatus === 200) {
      const browser = await createBrowserTransport({ origin }, setup); await browser.close();
    } else await assert.rejects(createBrowserTransport({ origin, onSignInRequired: () => assert.fail('not MFA') }, setup),
      { code: 'browser-access' });
    assert.equal(visits, 1);
  }
});
test('static manager nodes do not race the initial UI inventory or hide its failure', async () => {
  let busy = true, failed = false, waits = 0, drained = 0;
  const execute = pageContext(() => assert.fail('no API before initial UI inventory finishes'), {
    context: { document: { querySelector: () => ({ disabled: busy,
      textContent: busy ? 'Inventory unavailable' : '0 of 0 HTML pages', classList: { contains: () => failed } }) } },
    page: { waitForFunction: async (fn, arg) => {
      waits++;
      if (busy) { assert.equal(fn(arg), false); busy = false; }
      assert.ok(fn(arg));
    }, waitForLoadState: async (state, options) => {
      assert.equal(busy, false); assert.equal(state, 'networkidle');
      assert.ok(options.timeout > 0 && options.timeout <= 45000); drained++;
    } },
  });
  const browser = await createBrowserTransport({ origin }, ownedRuntime({ runCode: async (_session, source) => execute(source) }));
  await browser.close();
  assert.equal(waits, 1);
  assert.equal(drained, 1);
  failed = true;
  await assert.rejects(createBrowserTransport({ origin, onSignInRequired: () => assert.fail('not MFA') },
    ownedRuntime({ runCode: async (_session, source) => execute(source) })), { code: 'browser-capability' });
  assert.equal(drained, 1);
  const pending = pageContext(() => assert.fail('no API while thumbnails are pending'), {
    page: { waitForLoadState: async () => { throw Object.assign(new Error('pending'), { name: 'TimeoutError' }); } },
  });
  await assert.rejects(createBrowserTransport({ origin, onSignInRequired: () => assert.fail('not MFA') },
    ownedRuntime({ runCode: async (_session, source) => pending(source) })), { code: 'browser-capability' });
});
test('self-contained page request bounds streamed bytes and never follows another origin', async () => {
  let calls = 0, cancelled = false;
  const execute = pageContext(async (_url, options) => {
    calls++; assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error');
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3)); },
      cancel() { cancelled = true; } }));
  });
  const input = { origin, path: '/_manager/api/inventory', method: 'GET', headers: {}, maxBytes: 2 };
  const run = value => execute(`async page => page.evaluate(${browserRequest.toString()}, ${JSON.stringify(value)})`);
  assert.equal((await run(input)).failure, 'limit'); assert.equal(cancelled, true);
  assert.equal((await run({ ...input, origin: 'https://foreign.test' })).failure, 'origin');
  assert.equal((await run({ ...input, headers: { authorization: 'forbidden' } })).failure, 'schema');
  assert.equal(calls, 1);
});
test('browser CLI -> page fetch -> authenticated API preserves HTML/PNG through replace, delete and selected restore', async t => {
  const f = await fixture(t), server = await createServer(f.config, { store: f.store, fetchImpl: graphFetch(), logError: () => {} });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  let account = principal();
  const requests = [];
  const execute = pageContext((route, options) => new Promise((resolve, reject) => {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, options.method === 'POST' ? 'same-origin' : undefined);
    assert.deepEqual(Object.keys(options.headers).sort(), options.method === 'POST' ? ['content-type', 'x-manager-request'] : []);
    requests.push({ route, options });
    const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method: options.method,
      headers: { Host: new URL(origin).host, ...account, ...options.headers, ...(options.method === 'POST' ? { Origin: origin } : {}) } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    request.on('error', reject); request.end(options.body);
  }));
  let started = 0, closed = 0;
  const sessions = new Map();
  const runtime = {
    start: async () => {
      const cwd = path.join(f.root, `task-${++started}`), session = `agent-offline-${started}`;
      const result = { ok: true, mode: 'managed', activity: 'active', cwd, session, profilePath: path.join(cwd, 'profile'), profileRetained: true };
      sessions.set(session, result); return result;
    },
    close: async session => { closed++; return { ...sessions.get(session), closed: true }; },
    runCode: async (_session, source) => execute(source),
  };
  const deps = { tokenProvider: () => assert.fail('browser mode must never acquire tokens'),
    browserFactory: options => createBrowserTransport(options, { runtime }) };
  const file = path.join(f.root, 'report.html'), image = path.join(f.root, 'report.png');
  const options = { origin, browser: true, file, confirm: 'report.html', thumbnail: image };
  const a = html('Unicode: \u03bb; untouched scripts'), b = html('second exact HTML');
  await writeFile(file, a); await writeFile(image, png(30));
  const uploaded = await runPublisher({ ...options, action: 'upload', 'thumbnail-html-sha256': digest(a) }, deps);
  assert.equal(uploaded.thumbnail.sha256, digest(png(30)));
  let inventory = await runPublisher({ origin, browser: true, action: 'inventory' }, deps), first = inventory.pages[0];
  await writeFile(file, b); await writeFile(image, png(100));
  await runPublisher({ ...options, action: 'replace', revision: first.revision, sha256: first.sha256, 'thumbnail-html-sha256': digest(b) }, deps);
  inventory = await runPublisher({ origin, browser: true, action: 'inventory' }, deps);
  const selected = inventory.backups.find(item => item.sha256 === digest(a)), current = inventory.pages[0];
  await runPublisher({ origin, browser: true, action: 'delete', name: current.name, confirm: current.name, revision: current.revision, sha256: current.sha256 }, deps);
  inventory = await runPublisher({ origin, browser: true, action: 'inventory' }, deps);
  const restored = await runPublisher({ origin, browser: true, action: 'restore', name: 'report.html', confirm: 'report.html',
    revision: inventory.missingVersions['report.html'], sha256: 'missing', 'backup-id': selected.id, 'backup-sha256': selected.sha256 }, deps);
  assert.equal(restored.thumbnail.sha256, digest(png(30)));
  assert.deepEqual(await readFile(path.join(f.config.contentDir, 'report.html')), a);
  const version = (await f.store.list()).pages[0];
  const [id, side, hash] = version.thumbnail.url.slice('/_manager/api/thumbnail/'.length).replace(/\.png$/, '').split('/');
  assert.deepEqual(await f.store.thumbnail(id, side, hash), png(30));
  account = principal(other);
  await assert.rejects(runPublisher({ origin, browser: true, action: 'inventory' }, deps), { code: 'manager', outcome: 'denied' });
  assert.equal(started, closed); assert.equal(requests.filter(item => item.options.method === 'POST').length, 4);
});
test('empty HTTP rejection retains bounded metadata and leaves mutation delivery uncertain', async t => {
  const { root } = await fixture(t), file = path.join(root, 'report.html');
  await writeFile(file, html('safe'));
  const correlation = '99999999-9999-4999-8999-999999999999';
  for (const action of ['inventory', 'replace']) {
    let requests = 0;
    const setup = ownedRuntime({ runCode: async (_session, source) => {
      if (source.includes('waitForFunction')) return { ready: true };
      requests++; return { status: 403, bytes: 0, base64: '', contentTypePresent: false, middlewareRequestId: correlation };
    } });
    await assert.rejects(runPublisher({ origin, browser: true, action, file, confirm: 'report.html',
      revision: 'reviewed', sha256: digest(html('previous')) }, {
      tokenProvider: () => assert.fail('no token'), browserFactory: options => createBrowserTransport(options, setup),
    }), error => {
      assert.equal(error.code, 'http-rejected');
      assert.equal(error.outcome, action === 'inventory' ? 'not-sent' : 'uncertain');
      assert.deepEqual(error.browserHttp, { httpStatus: 403, bodyBytes: 0, contentTypePresent: false, middlewareRequestId: correlation });
      return true;
    });
    assert.equal(requests, 1);
    assert.equal(setup.calls.filter(call => Array.isArray(call)).length, 1);
  }
});
test('validation precedes owned startup and cleanup failures preserve known mutation delivery', async t => {
  const { root } = await fixture(t), file = path.join(root, 'report.html');
  await writeFile(file, html('safe'));
  await assert.rejects(runPublisher({ origin, browser: true, action: 'upload', file, confirm: 'wrong.html' },
    { browserFactory: () => assert.fail('validation before browser'), tokenProvider: () => assert.fail('no token') }));
  const transactionId = '99999999-9999-4999-8999-999999999999';
  await assert.rejects(runPublisher({ origin, browser: true, action: 'upload', file, confirm: 'report.html' }, {
    browserFactory: async () => ({
      fetchImpl: async (_url, options) => new Response(JSON.stringify(options.method === 'GET' ? { pages: [], missingVersions: {} } :
        { verified: true, name: 'report.html', action: 'upload', sha256: digest(html('safe')), revision: transactionId, transactionId })),
      close: async () => { throw new Error('private details'); },
    }),
    tokenProvider: () => assert.fail('no token'),
  }), error => error.code === 'browser-cleanup' && error.outcome === 'verified-cleanup-pending' && error.transactionId === transactionId);
});
