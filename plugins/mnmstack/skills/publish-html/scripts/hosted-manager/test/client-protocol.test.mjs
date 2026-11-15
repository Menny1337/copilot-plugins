import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeSignInFailure, readResponse, responseFailure, transportFailure, MAX_RESPONSE_BYTES } from '../client-protocol.mjs';
import { json } from './test-support.mjs';

test('native sign-in projects only a fixed stage, HTTP status and GUID middleware correlation', () => {
  const id = '99999999-9999-4999-8999-999999999999';
  const error = nativeSignInFailure(new Response('synthetic-private-body', {
    status: 403, headers: { 'x-ms-middleware-request-id': id, 'set-cookie': 'synthetic-private-cookie', location: 'https://private.test' },
  }), 'http-response');
  assert.equal(error.code, 'native-sign-in'); assert.equal(error.outcome, 'not-sent');
  assert.deepEqual(error.nativeSignIn, { stage: 'http-response', httpStatus: 403, middlewareRequestId: id });
  assert.equal(Object.isFrozen(error.nativeSignIn), true);
  assert.doesNotMatch(JSON.stringify(error), /synthetic|private\.test|set-cookie|location/);
  for (const correlation of ['synthetic.jwt.token', 'x'.repeat(65536), 'constructor', `${id} private`]) {
    const invalid = nativeSignInFailure({ status: 403, headers: new Headers({ 'x-ms-middleware-request-id': correlation }) }, 'synthetic-private-stage');
    assert.deepEqual(invalid.nativeSignIn, { stage: 'transport', httpStatus: 403, middlewareRequestId: null });
  }
  for (const status of [undefined, '403', 0, 99, 600, NaN, 403.5]) {
    assert.equal(nativeSignInFailure({ status }, 'session-response').nativeSignIn.httpStatus, null);
  }
  assert.deepEqual(nativeSignInFailure(null, 'transport').nativeSignIn,
    { stage: 'transport', httpStatus: null, middlewareRequestId: null });
});
test('client preserves allowlisted definite denial codes with fixed non-secret remediation', () => {
  for (const [status, code] of [[409, 'version-conflict'], [507, 'state-quota'], [507, 'content-quota'], [403, 'mutations-disabled'], [403, 'obo-consent-or-policy']]) {
    const error = responseFailure(status, { code, error: 'synthetic.jwt.token', transactionId: 'untrusted' }, true);
    assert.equal(error.code, code); assert.equal(error.outcome, 'denied'); assert.equal(error.transactionId, null);
    assert.match(error.message, /No report change was made by this request/);
    assert.doesNotMatch(error.message, /synthetic|uncertain|private transaction evidence/);
  }
});
test('only structured GUID transaction IDs survive uncertain errors; unknown POST/lost responses remain uncertain', () => {
  const id = '99999999-9999-4999-8999-999999999999';
  const error = responseFailure(503, { code: 'outcome-uncertain', transactionId: id, error: 'synthetic.jwt.token' }, true);
  assert.equal(error.outcome, 'uncertain'); assert.equal(error.transactionId, id); assert.match(error.message, new RegExp(id));
  assert.doesNotMatch(error.message, /synthetic/);
  const hostile = responseFailure(503, { code: 'outcome-uncertain', transactionId: 'secret\ninvalid' }, true);
  assert.equal(hostile.transactionId, null); assert.doesNotMatch(hostile.message, /secret/);
  for (const data of [{}, { code: 'synthetic.jwt.token', error: 'secret' }]) {
    const unknown = responseFailure(500, data, true);
    assert.equal(unknown.outcome, 'uncertain'); assert.doesNotMatch(unknown.message, /secret|synthetic/);
  }
  assert.equal(transportFailure(true).outcome, 'uncertain');
  assert.equal(transportFailure(false).outcome, 'not-sent');
});
test('prototype property names are unknown mutation error codes, never definite denials', () => {
  for (const code of ['constructor', 'toString', '__proto__']) {
    const error = responseFailure(500, { code, error: 'synthetic.jwt.token' }, true);
    assert.equal(error.code, 'outcome-uncertain'); assert.equal(error.outcome, 'uncertain');
    assert.equal(error.transactionId, null);
    assert.doesNotMatch(error.message, /constructor|toString|__proto__|function|Object|synthetic.jwt.token/);
  }
});
test('bounded inventory response accepts maximum legal backup rows above the old 4 MiB limit', async () => {
  const name = 'x'.repeat(250) + '.html';
  const backup = { id: '99999999-9999-4999-8999-999999999999', name, sha256: 'a'.repeat(64), size: 1048576, savedAt: '2026-01-01T00:00:00.000Z', action: 'replace' };
  const inventory = { pages: [], backups: Array.from({ length: 9999 }, () => backup), missingVersions: {} };
  const serialized = JSON.stringify(inventory);
  assert.ok(Buffer.byteLength(serialized) > 4 * 1024 * 1024);
  assert.ok(Buffer.byteLength(serialized) < MAX_RESPONSE_BYTES);
  assert.equal((await readResponse(json(inventory))).backups.length, 9999);
  await assert.rejects(readResponse(new Response('x'.repeat(MAX_RESPONSE_BYTES + 1))), /Response limit/);
});
