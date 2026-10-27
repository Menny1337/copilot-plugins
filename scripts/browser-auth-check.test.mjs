import assert from 'node:assert/strict';
import test from 'node:test';
import { authExpression, checkAuth, decodeRead, openAccountMenu, redactDiagnostic } from './browser-auth-check.mjs';

test('CLI technical error details survive redaction, including success-exit error blocks', () => {
  const read = decodeRead({status: 0, stdout: '### Error\nError: page.evaluate: Execution context was destroyed, most likely because of a navigation\n'});
  assert.equal(read.ok, false);
  assert.equal(read.error.transientNavigation, true);
  assert.match(read.error.message, /Execution context was destroyed/);
  assert.equal(read.error.exitCode, 0);
  const safe = redactDiagnostic('Error: https://example.com/?token=secret user@example.com /Users/user/private/token ' + 'a'.repeat(43));
  assert.equal(safe, 'Error: [url] [account] [local-path] [secret]');
});

test('unstructured output does not leak page text; timeouts and signals stay explicit', () => {
  const r = decodeRead({status: null, signal: 'SIGTERM', error: {code: 'ETIMEDOUT'}, stdout: 'private mailbox content'});
  assert.equal(r.error.code, 'ETIMEDOUT');
  assert.equal(r.error.signal, 'SIGTERM');
  assert.equal(r.error.message, 'CLI returned no structured object');
  const withSnapshot = decodeRead({status: 1, stdout: '### Error\nError: interrupted\n### Snapshot\nprivate mailbox text'});
  assert.doesNotMatch(withSnapshot.error.message, /private mailbox/);
});

test('readiness checks do not read main/body text or enumerate messages', () => {
  const expression = authExpression('outlook', 'test@example.com');
  assert.doesNotMatch(expression, /innerText|document\.body|querySelectorAll\(['"]\*|role.?=.?(?:option|listitem)/);
  assert.match(expression, /identityNodes/);
  assert.match(expression, /checkVisibility/);
  assert.throws(() => authExpression('other', 'test@example.com'));
  assert.throws(() => authExpression('ado', ''));
});

test('a known redirect context race is retained and retried only within the visit budget', () => {
  let time = 0, reads = 0;
  const r = checkAuth({
    site: 'ado', expectedAccount: 'test@example.com', now: () => time, wait: ms => {time += ms;},
    call: args => {
      time += 20;
      if (args[0] === 'goto') return {status: 0, stdout: 'navigated'};
      if (reads++ === 0) return {status: 0, stdout: '### Error\nError: Execution context was destroyed'};
      return {status: 0, stdout: '{"shellReady":true,"accountMatch":true}'};
    },
  });
  assert.equal(r.status, 'PASS');
  assert.equal(r.failures.length, 1);
  assert.equal(reads, 2);
  assert.ok(r.elapsedMs <= r.budgetMs);
});

test('unknown failures stop without retry; shell alone does not establish identity', () => {
  let calls = 0;
  const r = checkAuth({
    site: 'ado', expectedAccount: 'test@example.com', now: () => 0, wait: () => assert.fail(),
    call: args => {calls++; return {status: 0, stdout: args[0] === 'goto' ? '' : 'Error: unsupported command'};},
  });

  assert.equal(r.status, 'BLOCKED');
  assert.equal(calls, 2);
  assert.equal(r.failures[0].transientNavigation, false);
  const partial = checkAuth({
    site: 'ado', expectedAccount: 'test@example.com', now: () => 0, wait: () => assert.fail(),
    call: args => ({status: 0, stdout: args[0] === 'goto' ? '' :
      args[2].includes('controls[0].click()') ? '{"opened":false,"controls":2}' : '{"shellReady":true,"accountMatch":null}'}),
  });
  assert.equal(partial.status, 'PARTIAL');
});

test('account verification opens only the known account menu and keeps identity out of reports', () => {
  let reads = 0, time = 0, menuOpened = false;
  const report = checkAuth({
    site: 'ado', expectedAccount: 'test@example.com', now: () => time, wait: ms => {time += ms;},
    call: args => {
      time += 5;
      if (args[0] === 'goto') return {status: 0, stdout: ''};
      if (args[2].includes('controls[0].click()')) {
        menuOpened = true;
        return {status: 0, stdout: '{"opened":true}'};
      }
      return {status: 0, stdout: JSON.stringify({shellReady: true, accountMatch: reads++ ? true : null})};
    },
  });
  assert.equal(report.status, 'PASS');
  assert.equal(menuOpened, true);
  assert.equal(reads, 2);
  assert.doesNotMatch(JSON.stringify(report), /test@example/);
});

test('a different account fails rather than passing a ready shell or selecting another identity', () => {
  const report = checkAuth({
    site: 'outlook', expectedAccount: 'test@example.com', now: () => 0, wait: () => assert.fail(),
    call: args => ({status: 0, stdout: args[0] === 'goto' ? '' : '{"shellReady":true,"accountMatch":false}'}),
  });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.accountMenu, undefined);
});

test('transient reads cannot extend the visit budget or hide their failures', () => {
  let time = 0, calls = 0;
  const report = checkAuth({
    site: 'ado', expectedAccount: 'test@example.com', budgetMs: 2000,
    now: () => time, wait: ms => {time += ms;},
    call: (args, timeout) => {
      assert.equal(timeout, 2000 - time);
      calls++;
      time += 100;
      return {status: 0, stdout: args[0] === 'goto' ? '' : 'Error: Execution context was destroyed'};
    },
  });
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.elapsedMs, 2000);
  assert.equal(report.failures.length, calls - 1);
});

test('a late-loading account trigger is observed until ready, without repeated activation', () => {
  let time = 0, menus = 0, reads = 0;
  const report = checkAuth({
    site: 'ado', expectedAccount: 'test@example.com', now: () => time, wait: ms => {time += ms;},
    call: args => {
      time += 10;
      if (args[0] === 'goto') return {status: 0, stdout: ''};
      if (args[2].includes('controls[0].click()')) {
        return {status: 0, stdout: JSON.stringify(menus++ === 0 ? {opened: false, controls: 0} : {opened: true})};
      }
      return {status: 0, stdout: JSON.stringify({shellReady: true, accountMatch: reads++ >= 3 ? true : null})};
    },
  });
  assert.equal(report.status, 'PASS');
  assert.equal(menus, 2);
  assert.equal(report.accountMenuObservations.length, 2);
  assert.equal(report.accountMenuObservations[0].value.controls, 0);
});

test('a permanently visible account wrapper is not mistaken for an expanded menu', () => {
  let clicked = 0;
  const control = {
    checkVisibility: () => true,
    closest: () => null,
    getBoundingClientRect: () => ({width: 48, height: 48}),
    getAttribute: name => name === 'aria-expanded' ? 'false' : null,
    click: () => {clicked++;},
  };
  const root = {querySelectorAll: selector => {
    if (selector === '#mectrl_currentAccount_secondary') return [];
    assert.equal(selector, '#mectrl_main_trigger,button.mectrl_trigger,#owa-me-control-container button');
    return [control];
  }};
  assert.deepEqual(openAccountMenu(root), {opened: true, alreadyOpen: false});
  assert.equal(clicked, 1);
});
