#!/usr/bin/env node
// owa-compose - one-shot Outlook on the web (OWA) mail driver.
//
// Why this exists: driving OWA by hand costs many retries per email. Two
// structural causes, both removed here:
//
//   1. Quoting. A rich HTML body carrying " $ ` \ corrupts
//      `playwright-cli eval '<fn>'` when it travels through a shell. This
//      script never uses a shell (spawnSync with an argv array) and carries the
//      body as base64 inside the generated function, so the payload cannot be
//      mangled.
//   2. Re-discovery. Each step used to be snapshot -> grep -> click a fresh
//      e<N> ref. Here a whole compose is one command: preflight, act, verify,
//      report. Selectors are the stable aria-label contract, not positional refs.
//
// Every guardrail below maps to an observed real-world failure; see
// ../references/outlook-web.md for the evidence and the manual fallback.
//
// Requires Node 18+ and `playwright-cli` on PATH. Zero npm dependencies.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { playwrightInvocation } from './browser-window.mjs';

const DEFAULT_CMD_TIMEOUT_MS = 45_000;
let CMD_TIMEOUT_MS = DEFAULT_CMD_TIMEOUT_MS;
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 20_000;
const RECIPIENT_SETTLE_MS = 1_500;

const OWA_HOSTS = /^https:\/\/(outlook\.office\.com|outlook\.cloud\.microsoft|outlook\.office365\.com|outlook\.live\.com)\//;
const OWA_MAIL_URL = 'https://outlook.office.com/mail/';

// ---------------------------------------------------------------------------
// process plumbing
// ---------------------------------------------------------------------------

let SESSION = null;
let JSON_OUT = false;

// Progress goes to stderr so stdout stays a single parseable JSON document.
// A full draft takes ~1 minute; silence for that long reads as a hang.
function log(...a) {
  if (!JSON_OUT) console.error('[owa]', ...a);
}

function fail(code, message, extra = {}) {
  const payload = { ok: false, error: code, message, ...extra };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(1);
}

function done(payload) {
  console.log(JSON.stringify({ ok: true, ...payload }, null, 2));
  process.exit(0);
}

// Run playwright-cli with an argv array. No shell => no quoting hazard.
function pw(args, { timeout = CMD_TIMEOUT_MS, env } = {}) {
  const invocation = playwrightInvocation();
  const res = spawnSync(invocation.command, [...invocation.prefix, `--s=${SESSION}`, ...args], {
    encoding: 'utf8',
    timeout,
    shell: false,
    env: env ? { ...process.env, ...env } : process.env,
  });
  const timedOut = res.error?.code === 'ETIMEDOUT' || res.signal === 'SIGTERM';
  return {
    timedOut,
    code: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    spawnError: res.error && !timedOut ? res.error.message : null,
  };
}

// `--raw eval` prints the bare JSON result. Errors arrive as "### Error ...".
function clearModalState() {
  // A dialog (commonly OWA's beforeunload) blocks EVERY subsequent tool call.
  // Dismiss first - for beforeunload that means "stay", which preserves the draft.
  for (const verb of ['dialog-dismiss', 'dialog-accept']) {
    const r = pw([verb], { timeout: 15_000 });
    const out = (r.stdout + r.stderr);
    if (!r.timedOut && !/No dialog is showing/i.test(out)) return true;
  }
  return false;
}

function pwGoto(url, opts = {}) {
  let r = pw(['goto', url], opts);
  if (/does not handle the modal state/i.test(r.stdout + r.stderr)) {
    clearModalState();
    r = pw(['goto', url], opts);
  }
  return r;
}

function pwEvalOnce(fnSource, opts = {}) {
  const r = pw(['--raw', 'eval', fnSource], opts);
  if (r.timedOut) return { ok: false, error: 'timeout', raw: '' };
  if (r.spawnError) return { ok: false, error: 'spawn', message: r.spawnError };
  const out = r.stdout.trim();
  const combined = out + '\n' + r.stderr;
  // With --raw the CLI may emit a bare "Error: ..." line instead of a "### Error"
  // block, which would otherwise be parsed as a legitimate string value.
  if (/^###\s*Error/m.test(combined) || /^"?Error:\s/m.test(out)) {
    const msg = combined.split('\n').filter((l) => l.trim()).slice(0, 4).join(' ');
    const modal = /does not handle the modal state/i.test(msg);
    return { ok: false, error: modal ? 'modal-state' : 'eval-error', message: msg };
  }
  try {
    return { ok: true, value: JSON.parse(out) };
  } catch {
    return { ok: true, value: out };
  }
}

function pwEval(fnSource, opts = {}) {
  const first = pwEvalOnce(fnSource, opts);
  if (first.ok || first.error !== 'modal-state') return first;
  if (!clearModalState()) return first;
  const second = pwEvalOnce(fnSource, opts);
  if (second.ok) second.recoveredFromModal = true;
  return second;
}

// Poll an in-page predicate instead of sleeping a fixed amount. OWA renders
// asynchronously; fixed sleeps were the source of flaky "element not found".
function waitFor(fnSource, { timeout = POLL_TIMEOUT_MS, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    const r = pwEval(fnSource);
    if (r.ok && r.value) return { ok: true, value: r.value };
    last = r;
    if (r.error === 'modal-state') return r;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, POLL_INTERVAL_MS);
  }
  return { ok: false, error: 'timeout', message: `timed out waiting for ${label}`, last };
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ---------------------------------------------------------------------------
// in-page snippets
// ---------------------------------------------------------------------------

// Shared prelude injected into every evaluated function.
const PRELUDE = `
  var CE = function (label) {
    return document.querySelector('div[aria-label="' + label + '"][contenteditable="true"]');
  };
  var BODY = function () {
    var eds = document.querySelectorAll('[contenteditable]');
    for (var i = 0; i < eds.length; i++) {
      if ((eds[i].getAttribute('aria-label') || '') === 'Message body') return eds[i];
    }
    return null;
  };
  var SUBJ = function () { return document.querySelector('input[aria-label="Subject"]'); };
  var VISIBLE = function (el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  var BTN = function (label) {
    var all = [].slice.call(document.querySelectorAll('button'));
    return all.filter(function (b) {
      return (b.getAttribute('aria-label') || '').trim() === label && VISIBLE(b);
    });
  };
  var PILLS = function (label) {
    var f = CE(label);
    if (!f) return -1;
    var well = f.closest('[id^="recipient-well"]') || f.parentElement.parentElement;
    return [].slice.call(well.querySelectorAll('[role=option],[data-lpc-hover-target-id],button[aria-label*="@"]'))
      // The autocomplete suggestion popup also uses role=option and can render
      // inside the well. A suggestion is not a committed recipient, so anything
      // inside a listbox is excluded and the pill-growth assertion stays honest.
      .filter(function (c) { return !c.closest('[role=listbox]') && VISIBLE(c); })
      .length;
  };
  var REAL_DIALOGS = function () {
    return [].slice.call(document.querySelectorAll('[role=dialog],[role=alertdialog]'))
      .filter(function (d) { return VISIBLE(d) && (d.innerText || '').trim().length > 0; });
  };
`;

function fn(body) {
  return `() => {${PRELUDE}${body}}`;
}

// ---------------------------------------------------------------------------
// preflight
// ---------------------------------------------------------------------------

function ensureSession() {
  const result = pw(['tab-list'], { timeout: 10_000 });
  if (result.timedOut) {
    return { ok: false, error: 'session-timeout', message: `Playwright session "${SESSION}" did not respond` };
  }
  if (result.code !== 0) {
    return {
      ok: false,
      error: 'session-unavailable',
      message: `Playwright session "${SESSION}" is not running. Start it with browser-window.mjs first.`,
    };
  }
  return { ok: true };
}

// Dismiss teaching callouts / banners that would otherwise brick every later
// call with "does not handle the modal state". Never uses Escape: in a compose
// surface Escape is bound to Discard and silently destroys the draft.
function dismissBlockers() {
  return pwEval(fn(`
    var dismissed = [];
    var dlgs = REAL_DIALOGS();
    for (var i = 0; i < dlgs.length; i++) {
      var d = dlgs[i];
      var txt = (d.innerText || '').replace(/\\s+/g, ' ').slice(0, 80);
      if (/discard this draft|delete this/i.test(txt)) continue; // destructive - never auto-click
      var btns = [].slice.call(d.querySelectorAll('button'));
      // aria-label and text are tested separately: a Fluent button often carries
      // both ("Close" / "Close"), and concatenating them defeats an anchored match.
      var RX = /^(got it|dismiss|close|no thanks|maybe later|not now|skip|ok)$/i;
      var close = btns.filter(function (b) {
        var l = (b.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
        var t = (b.textContent || '').replace(/\\s+/g, ' ').trim();
        return RX.test(l) || RX.test(t);
      });
      if (close.length) { close[0].click(); dismissed.push(txt); }
    }
    return { dismissed: dismissed, remaining: REAL_DIALOGS().length };
  `));
}

function ensureOwa({ navigate = true } = {}) {
  const cur = pwEval('() => location.href');
  if (!cur.ok) return cur;
  if (typeof cur.value === 'string' && OWA_HOSTS.test(cur.value)) return { ok: true, url: cur.value };
  if (!navigate) {
    return { ok: false, error: 'not-on-owa', message: `current page is not OWA: ${cur.value}` };
  }
  // outlook.office.com redirects to outlook.cloud.microsoft; both are accepted.
  log('opening Outlook on the web');
  pw(['tab-new', OWA_MAIL_URL], { timeout: CMD_TIMEOUT_MS });
  const w = waitFor(fn(`return !!BTN('New mail').length || !!SUBJ();`), {
    timeout: 30_000,
    label: 'OWA to finish loading',
  });
  if (!w.ok) return { ok: false, error: 'owa-load', message: 'OWA did not finish loading' };
  return { ok: true, url: OWA_MAIL_URL };
}

function preflight({ navigate = true } = {}) {
  const session = ensureSession();
  if (!session.ok) fail(session.error, session.message);
  const o = ensureOwa({ navigate });
  if (!o.ok) {
    if (o.error === 'modal-state') {
      dismissBlockers();
      const retry = ensureOwa({ navigate });
      if (!retry.ok) fail(retry.error, retry.message);
      return retry;
    }
    fail(o.error, o.message);
  }
  dismissBlockers();
  return o;
}

// ---------------------------------------------------------------------------
// compose primitives
// ---------------------------------------------------------------------------

function openCompose() {
  log('opening a new compose');
  const r = pwEval(fn(`
    var b = BTN('New mail');
    if (!b.length) return { ok: false, err: 'no New mail button' };
    b[0].click();
    return { ok: true };
  `));
  if (!r.ok) return r;
  if (r.value && r.value.ok === false) return { ok: false, error: 'no-new-mail', message: r.value.err };
  const w = waitFor(fn(`return !!SUBJ() && !!CE('To') && !!BODY();`), { label: 'compose surface' });
  if (!w.ok) return { ok: false, error: 'compose-timeout', message: 'compose surface never appeared' };
  return { ok: true };
}

// Bcc is NOT rendered until its toggle is clicked. The toggle carries no
// aria-label and no stable id, so it is matched by exact text.
function revealBcc() {
  const present = pwEval(fn(`return !!CE('Bcc');`));
  if (present.ok && present.value === true) return { ok: true, revealed: false };
  const to = pwEval(fn(`var t = CE('To'); if (t) { t.focus(); t.click(); } return true;`));
  if (!to.ok) return to;
  sleep(400);
  const click = pwEval(fn(`
    var b = [].slice.call(document.querySelectorAll('button')).filter(function (x) {
      return (x.textContent || '').trim() === 'Bcc' && VISIBLE(x);
    });
    if (!b.length) return { ok: false };
    b[0].click();
    return { ok: true };
  `));
  if (!click.ok) return click;
  const w = waitFor(fn(`return !!CE('Bcc');`), { timeout: 6_000, label: 'Bcc field' });
  if (!w.ok) return { ok: false, error: 'bcc-toggle', message: 'Bcc field did not appear' };
  return { ok: true, revealed: true };
}

// Type one address, press Enter, then assert the pill count actually grew.
// A silently-unresolved recipient was a real failure mode.
function addRecipient(field, address) {
  log(`${field}: ${address}`);
  const before = pwEval(fn(`return PILLS('${field}');`));
  const beforeN = before.ok && typeof before.value === 'number' ? before.value : 0;

  const focus = pw(['click', `div[aria-label="${field}"][contenteditable="true"]`]);
  if (focus.timedOut) return { ok: false, error: 'timeout', message: `focusing ${field}` };
  sleep(300);
  pw(['type', address]);
  sleep(RECIPIENT_SETTLE_MS);
  pw(['press', 'Enter']);

  const w = waitFor(fn(`return PILLS('${field}') > ${beforeN};`), {
    timeout: 8_000,
    label: `${field} pill for ${address}`,
  });
  if (w.ok) return { ok: true, address, field };

  // One retry: commit via the resolution list rather than a bare Enter.
  pw(['press', 'Enter']);
  const retry = waitFor(fn(`return PILLS('${field}') > ${beforeN};`), {
    timeout: 6_000,
    label: `${field} pill for ${address} (retry)`,
  });
  if (retry.ok) return { ok: true, address, field, retried: true };
  return { ok: false, error: 'recipient-unresolved', message: `${field}: "${address}" did not resolve to a pill` };
}

function setSubject(subject) {
  log('setting the subject');
  const r = pw(['fill', 'input[aria-label="Subject"]', subject]);
  if (r.timedOut) return { ok: false, error: 'timeout', message: 'setting subject' };
  const w = waitFor(fn(`var s = SUBJ(); return !!s && s.value.length > 0;`), {
    timeout: 6_000,
    label: 'subject value',
  });
  return w.ok ? { ok: true } : { ok: false, error: 'subject', message: 'subject did not stick' };
}

// Rich body. Base64 keeps " $ ` \ and non-ASCII intact through every layer.
// insertHTML (not innerHTML) is required: it produces the edit events OWA needs
// to mark the draft dirty and autosave it. `mode` controls placement so a reply
// keeps its quoted thread.
function injectBody(html, { mode = 'replace' } = {}) {
  log(`injecting the body (${mode}, ${html.length} chars)`);
  const b64 = Buffer.from(html, 'utf8').toString('base64');
  const source = fn(`
    var b64 = "${b64}";
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
    var html = new TextDecoder('utf-8').decode(bytes);
    var ed = BODY();
    if (!ed) return { ok: false, err: 'no message body editor' };
    ed.focus();
    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(ed);
    ${mode === 'replace' ? 'sel.removeAllRanges(); sel.addRange(range); document.execCommand("delete", false, null); range = document.createRange(); range.selectNodeContents(ed);' : ''}
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    var ok = document.execCommand('insertHTML', false, html);
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: ok, anchors: ed.querySelectorAll('a').length, chars: ed.innerText.length };
  `);
  const r = pwEval(source, { timeout: 60_000 });
  if (!r.ok) return r;
  if (r.value && r.value.ok === false) return { ok: false, error: 'body-inject', message: r.value.err };
  return { ok: true, ...r.value };
}

// Read the compose back. Note: OWA rewrites <strong> to <b> server-side, so
// verification asserts on text and anchors, never on those tags.
function verifyCompose() {
  const r = pwEval(fn(`
    var text = function (label) {
      var f = CE(label);
      if (!f) return null;
      var well = f.closest('[id^="recipient-well"]') || f.parentElement.parentElement;
      return (well.innerText || '').replace(/\\u200b/g, '').replace(/\\s+/g, ' ').trim();
    };
    var ed = BODY();
    var saved = [].slice.call(document.querySelectorAll('*'))
      .map(function (e) { return (e.textContent || '').trim(); })
      .filter(function (t) { return /^Draft saved/i.test(t) && t.length < 60; });
    var s = SUBJ();
    return {
      to: text('To'), cc: text('Cc'), bcc: text('Bcc'),
      toPills: PILLS('To'), ccPills: PILLS('Cc'), bccPills: PILLS('Bcc'),
      subject: s ? s.value : null,
      bodyChars: ed ? ed.innerText.length : 0,
      bodyAnchors: ed ? ed.querySelectorAll('a').length : 0,
      savedIndicator: saved.length ? saved[saved.length - 1] : null
    };
  `));
  return r;
}

function waitForAutosave({ timeout = 20_000 } = {}) {
  // Nudge the editor so OWA marks the draft dirty, then wait for the receipt.
  pwEval(fn(`var ed = BODY(); if (ed) ed.dispatchEvent(new Event('input', { bubbles: true })); return true;`));
  const w = waitFor(fn(`
    var hits = [].slice.call(document.querySelectorAll('*'))
      .map(function (e) { return (e.textContent || '').trim(); })
      .filter(function (t) { return /^Draft saved/i.test(t) && t.length < 60; });
    return hits.length > 0;
  `), { timeout, label: '"Draft saved" indicator' });
  return w;
}

// Close keeps the draft. The invisible decoy button at (0,0) also carries
// aria-label="Close", so visible-only filtering is mandatory.
function closeCompose() {
  const r = pwEval(fn(`
    var b = BTN('Close');
    if (!b.length) return { ok: false, err: 'no visible Close button', fullPage: /\\/mail\\/compose\\//.test(location.href) };
    b[b.length - 1].click();
    return { ok: true, candidates: b.length };
  `));
  if (!r.ok) return r;
  if (r.value && r.value.ok === false) {
    // Full-page compose (/mail/compose/<id>) has no Close button - only Discard.
    // The draft is already autosaved, so navigating away is the "keep it" path.
    if (r.value.fullPage) {
      pwGoto(`${OWA_MAIL_URL}inbox`, { timeout: CMD_TIMEOUT_MS });
      waitFor(fn(`return !SUBJ();`), { timeout: 15_000, label: 'compose to close' });
      return { ok: true, mode: 'full-page-navigate-away' };
    }
    return { ok: false, error: 'no-close', message: r.value.err };
  }
  waitFor(fn(`return !SUBJ();`), { timeout: 8_000, label: 'compose to close' });
  return { ok: true, mode: 'compose-tab' };
}

// Discard destroys the draft and always asks for confirmation.
function discardCompose() {
  const c = pwEval(fn(`
    var d = document.querySelector('#discardCompose');
    if (!d) return { ok: false, err: 'no #discardCompose (is a compose open?)' };
    d.click();
    return { ok: true };
  `));
  if (!c.ok) return c;
  if (c.value && c.value.ok === false) return { ok: false, error: 'no-compose', message: c.value.err };

  waitFor(fn(`
    return REAL_DIALOGS().some(function (d) { return /discard this draft/i.test(d.innerText || ''); });
  `), { timeout: 6_000, label: 'discard confirmation' });

  pwEval(fn(`
    var btns = [].slice.call(document.querySelectorAll('[role=dialog] button,[role=alertdialog] button'));
    var ok = btns.filter(function (b) { return /^ok$/i.test((b.textContent || '').trim()); })[0];
    if (ok) { ok.click(); return { confirmed: true }; }
    return { confirmed: false };
  `));
  waitFor(fn(`return !SUBJ();`), { timeout: 8_000, label: 'compose to close' });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// spec handling
// ---------------------------------------------------------------------------

function loadSpec(path) {
  if (!path) fail('no-spec', '--spec <file.json> is required');
  if (!existsSync(path)) fail('no-spec', `spec file not found: ${path}`);
  let spec;
  try {
    spec = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail('bad-spec', `spec is not valid JSON: ${e.message}`);
  }
  const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  spec.to = arr(spec.to);
  spec.cc = arr(spec.cc);
  spec.bcc = arr(spec.bcc);
  if (spec.bodyHtmlFile) {
    if (!existsSync(spec.bodyHtmlFile)) fail('bad-spec', `bodyHtmlFile not found: ${spec.bodyHtmlFile}`);
    spec.bodyHtml = readFileSync(spec.bodyHtmlFile, 'utf8');
  }
  return spec;
}

function fillFromSpec(spec, { isReply = false } = {}) {
  const results = { recipients: [], warnings: [] };

  if (spec.bcc.length) {
    const b = revealBcc();
    if (!b.ok) fail(b.error || 'bcc-toggle', b.message || 'could not reveal Bcc');
  }

  for (const [field, list] of [['To', spec.to], ['Cc', spec.cc], ['Bcc', spec.bcc]]) {
    for (const addr of list) {
      const r = addRecipient(field, addr);
      if (!r.ok) fail(r.error, r.message, { partial: results });
      if (r.retried) results.warnings.push(`${field}: "${addr}" needed a retry`);
      results.recipients.push(`${field}: ${addr}`);
    }
  }

  if (spec.subject != null && !(isReply && spec.subject === '')) {
    const s = setSubject(spec.subject);
    if (!s.ok) fail(s.error, s.message, { partial: results });
  }

  if (spec.bodyHtml) {
    // A reply must keep its quoted thread: prepend instead of replacing.
    const mode = isReply ? 'prepend' : 'replace';
    const b = injectBody(spec.bodyHtml, { mode });
    if (!b.ok) fail(b.error, b.message, { partial: results });
    results.body = { anchors: b.anchors, chars: b.chars, mode };
  }

  return results;
}

function finish(spec, filled, extra = {}) {
  log('waiting for autosave, then verifying');
  const saved = waitForAutosave();
  const v = verifyCompose();
  if (!v.ok) fail(v.error || 'verify', v.message || 'could not verify compose');

  const state = v.value;
  const problems = [];
  if (spec.to.length && state.toPills < spec.to.length) problems.push(`To has ${state.toPills} pills, expected ${spec.to.length}`);
  if (spec.cc.length && state.ccPills < spec.cc.length) problems.push(`Cc has ${state.ccPills} pills, expected ${spec.cc.length}`);
  if (spec.bcc.length && state.bccPills < spec.bcc.length) problems.push(`Bcc has ${state.bccPills} pills, expected ${spec.bcc.length}`);
  if (spec.subject && state.subject !== spec.subject) problems.push('subject does not match the spec');
  if (spec.bodyHtml && state.bodyChars === 0) problems.push('message body is empty');
  if (!saved.ok) problems.push('no "Draft saved" indicator appeared');

  if (problems.length) {
    fail('verification-failed', problems.join('; '), { state, filled });
  }
  done({ ...extra, filled, state });
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

function cmdProbe() {
  preflight();
  const hadCompose = pwEval(fn(`return !!SUBJ();`));
  let opened = false;
  if (!(hadCompose.ok && hadCompose.value === true)) {
    openCompose();
    opened = true;
  }

  const r = pwEval(fn(`
    var q = function (s) { return document.querySelectorAll(s).length; };
    var labels = [].slice.call(document.querySelectorAll('[contenteditable="true"]')).map(function (e) {
      return { ariaLabel: e.getAttribute('aria-label'), role: e.getAttribute('role'), id: e.id || null };
    });
    var buttons = [].slice.call(document.querySelectorAll('button')).filter(VISIBLE).map(function (b) {
      return { ariaLabel: b.getAttribute('aria-label'), title: b.getAttribute('title'), id: b.id || null,
               text: (b.textContent || '').trim().slice(0, 16) };
    }).filter(function (b) {
      return /new mail|send|discard|close|^cc$|^bcc$|reply|forward/i.test(
        (b.ariaLabel || '') + ' ' + (b.title || '') + ' ' + b.text);
    });
    return {
      url: location.href,
      contract: {
        'button[aria-label="New mail"]': q('button[aria-label="New mail"]'),
        'div[aria-label="To"][contenteditable="true"]': q('div[aria-label="To"][contenteditable="true"]'),
        'div[aria-label="Cc"][contenteditable="true"]': q('div[aria-label="Cc"][contenteditable="true"]'),
        'div[aria-label="Bcc"][contenteditable="true"]': q('div[aria-label="Bcc"][contenteditable="true"]'),
        'input[aria-label="Subject"]': q('input[aria-label="Subject"]'),
        '[aria-label="Message body"][contenteditable="true"]': q('[aria-label="Message body"][contenteditable="true"]'),
        '#discardCompose': q('#discardCompose'),
        'button[aria-label="Send"]': q('button[aria-label="Send"]')
      },
      contentEditables: labels,
      relevantButtons: buttons.slice(0, 24),
      blockingDialogs: REAL_DIALOGS().map(function (d) {
        return (d.innerText || '').replace(/\\s+/g, ' ').slice(0, 80);
      })
    };
  `));
  if (!r.ok) fail(r.error, r.message || 'probe failed');
  if (opened) discardCompose();
  done({ probe: r.value, note: 'Compare against the contract table in references/outlook-web.md' });
}

function cmdDraft(spec) {
  preflight();
  const o = openCompose();
  if (!o.ok) fail(o.error, o.message);
  const filled = fillFromSpec(spec);
  finish(spec, filled, { action: 'draft' });
}

function cmdReply(spec, mode) {
  const labelFor = { reply: 'Reply', 'reply-all': 'Reply all', forward: 'Forward' };
  const label = labelFor[mode];
  if (!label) fail('bad-mode', `--mode must be reply, reply-all or forward (got "${mode}")`);

  preflight({ navigate: false });

  const r = pwEval(fn(`
    var b = BTN('${label}');
    if (!b.length) return { ok: false, err: 'no visible "${label}" button - open a message first' };
    b[0].click();
    return { ok: true };
  `));
  if (!r.ok) fail(r.error, r.message);
  if (r.value && r.value.ok === false) fail('no-reply-button', r.value.err);

  const w = waitFor(fn(`return !!SUBJ() && !!BODY();`), { label: `${label} compose surface` });
  if (!w.ok) fail('compose-timeout', `${label} compose never appeared`);

  // Forward starts with no recipients; reply/reply-all arrive prefilled.
  const filled = fillFromSpec(spec, { isReply: true });
  finish(spec, filled, { action: mode });
}

function cmdRead(index) {
  preflight({ navigate: false });
  const r = pwEval(fn(`
    var idx = ${Number.isInteger(index) ? index : -1};
    if (idx >= 0) {
      var opts = [].slice.call(document.querySelectorAll('[role=option]'));
      if (!opts[idx]) return { err: 'no message at index ' + idx };
      opts[idx].click();
    }
    return null;
  `));
  if (!r.ok) fail(r.error, r.message);
  if (Number.isInteger(index) && index >= 0) sleep(3_000);

  const out = pwEval(fn(`
    var pane = document.querySelector('[role=main]') || document.body;
    var composeSubj = SUBJ();
    var subject = null, kind = 'message';
    if (composeSubj) {
      subject = composeSubj.value || '';
      kind = 'compose';
    } else {
      var heads = [].slice.call(pane.querySelectorAll('[role=heading], h1, h2'))
        .filter(function (h) {
          var t = (h.textContent || '').trim();
          return t && !/^(navigation pane|folder pane|message list|reading pane)$/i.test(t);
        });
      if (heads.length) subject = (heads[0].textContent || '').trim().slice(0, 200);
    }
    return {
      url: location.href,
      kind: kind,
      subject: subject,
      text: (pane.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 12000),
      listItems: [].slice.call(document.querySelectorAll('[role=option]')).slice(0, 15).map(function (o, i) {
        return i + ': ' + (o.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').slice(0, 110);
      })
    };
  `), { timeout: 60_000 });
  if (!out.ok) fail(out.error, out.message);
  done({ action: 'read', ...out.value });
}

function cmdListDrafts() {
  preflight();
  pwGoto(`${OWA_MAIL_URL}drafts`, { timeout: CMD_TIMEOUT_MS });
  waitFor(fn(`return document.querySelectorAll('[role=option]').length > 0 || /drafts/i.test(location.href);`), {
    timeout: 20_000, label: 'Drafts folder',
  });
  const r = pwEval(fn(`
    return [].slice.call(document.querySelectorAll('[role=option]')).slice(0, 25).map(function (o, i) {
      return i + ': ' + (o.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').slice(0, 120);
    });
  `));
  if (!r.ok) fail(r.error, r.message);
  done({ action: 'list-drafts', drafts: r.value });
}

function cmdSend(spec, confirmed) {
  // Sending is irreversible: it requires both the subcommand and --confirm.
  if (!confirmed) {
    fail('confirm-required',
      'send requires --confirm. Draft first, let the user read it, then re-run `send --confirm` (no --spec) to send that same draft.');
  }
  // Two modes. With --spec, compose from scratch. Without it, send the compose
  // that is already open - that is what the draft -> review -> send flow needs,
  // and composing a second message there would orphan the reviewed draft.
  preflight({ navigate: !!spec });
  let filled = null;

  if (spec) {
    const o = openCompose();
    if (!o.ok) fail(o.error, o.message);
    filled = fillFromSpec(spec);
  } else {
    const open = pwEval(fn(`return !!SUBJ() && !!CE('To');`));
    if (!open.ok) fail(open.error, open.message);
    if (open.value !== true) {
      fail('no-compose',
        'no compose is open. Either pass --spec <file> to compose and send in one shot, or run `draft --spec <file>` first and then `send --confirm`.');
    }
  }

  const v = verifyCompose();
  if (!v.ok) fail(v.error || 'verify', v.message || 'could not verify before send');
  const expectedTo = spec ? spec.to.length : 1;
  if (expectedTo && v.value.toPills < expectedTo) {
    fail('verification-failed', 'refusing to send: To recipients did not all resolve', { state: v.value });
  }

  log('sending');
  const s = pwEval(fn(`
    var b = BTN('Send');
    if (!b.length) return { ok: false, err: 'no visible Send button' };
    b[0].click();
    return { ok: true };
  `));
  if (!s.ok) fail(s.error, s.message);
  if (s.value && s.value.ok === false) fail('no-send', s.value.err);
  waitFor(fn(`return !SUBJ();`), { timeout: 15_000, label: 'compose to close after send' });
  done({ action: 'send', sent: true, mode: spec ? 'composed' : 'open-compose', filled, state: v.value });
}

// ---------------------------------------------------------------------------
// cli
// ---------------------------------------------------------------------------

const USAGE = `owa-compose - one-shot Outlook on the web (OWA) driver

Usage:
  owa-compose.mjs <command> [options]

Commands:
  probe                      Dump the live compose DOM contract (run when a selector misses)
  draft   --spec <file>      Open a compose, fill it, verify it, leave it saved as a draft
  reply   --spec <file> --mode reply|reply-all|forward
                             Same, starting from the open message
  read    [--index <n>]      Read the open message, or open list item <n> first
  list-drafts                List the Drafts folder to confirm a draft landed
  close                      Close the compose, KEEPING the draft
  discard                    Discard the compose (destroys it) and confirm the dialog
  send    [--spec <file>] --confirm
                             With --spec: compose and send in one shot.
                             Without --spec: send the compose that is already
                             open, which is what draft -> review -> send needs.
                             Requires --confirm either way.

Options:
  --session <name>   helper-owned playwright-cli session (required)
  --timeout <ms>     per playwright-cli call timeout (default: ${DEFAULT_CMD_TIMEOUT_MS})
  --json             suppress the stderr progress log, leaving stdout pure JSON
  -h, --help

Spec file (JSON):
  {
    "to":      ["someone@example.com"],
    "cc":      [],
    "bcc":     [],
    "subject": "Subject line",
    "bodyHtml":     "<div>...</div>",
    "bodyHtmlFile": "/path/to/body.html"
  }

Notes:
  - Body HTML is carried as base64, so " $ \` \\ and non-ASCII are always safe.
  - Escape is NEVER sent: in a compose, Escape is Discard and destroys the draft.
  - Output is JSON on stdout; a non-zero exit means a real, described failure.

Session lifecycle:
  Start a dedicated browser window first:
      node scripts/browser-window.mjs start
  Pass the returned session to every OWA command. This driver never attaches to
  whichever browser window happens to be active.
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--confirm') out.confirm = true;
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

// A bare `--flag` parses to `true`. Number(true) is 1, so an unvalidated
// `--index` would silently open message 1 - exactly the kind of quiet wrong
// answer this script exists to prevent. Value options are therefore checked.
function strArg(args, name) {
  if (args[name] == null) return null;
  if (args[name] === true) fail('bad-option', `--${name} requires a value`);
  return String(args[name]);
}

function intArg(args, name, { min = 0 } = {}) {
  if (args[name] == null) return null;
  const raw = args[name];
  if (raw === true) fail('bad-option', `--${name} requires a numeric value`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    fail('bad-option', `--${name} must be an integer >= ${min} (got "${raw}")`);
  }
  return n;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (args.help || !cmd) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }
  if (args.json) JSON_OUT = true;
  const session = strArg(args, 'session');
  if (!session) fail('session-required', '--session is required; start a dedicated browser window first');
  SESSION = session;
  const timeout = intArg(args, 'timeout', { min: 1_000 });
  if (timeout != null) CMD_TIMEOUT_MS = timeout;

  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) fail('node-version', `Node 18+ required (running ${process.versions.node})`);

  switch (cmd) {
    case 'probe':
      cmdProbe();
      break;
    case 'draft':
      cmdDraft(loadSpec(strArg(args, 'spec')));
      break;
    case 'reply':
      cmdReply(loadSpec(strArg(args, 'spec')), strArg(args, 'mode') || 'reply');
      break;
    case 'read': {
      const index = intArg(args, 'index', { min: 0 });
      cmdRead(index == null ? -1 : index);
      break;
    }
    case 'list-drafts':
      cmdListDrafts();
      break;
    case 'close': {
      preflight({ navigate: false });
      const r = closeCompose();
      if (!r.ok) fail(r.error, r.message);
      done({ action: 'close', keptDraft: true, mode: r.mode });
      break;
    }
    case 'discard': {
      preflight({ navigate: false });
      const r = discardCompose();
      if (!r.ok) fail(r.error, r.message);
      done({ action: 'discard', destroyed: true });
      break;
    }
    case 'send': {
      const spec = args.spec == null ? null : loadSpec(strArg(args, 'spec'));
      cmdSend(spec, !!args.confirm);
      break;
    }
    default:
      console.log(USAGE);
      fail('unknown-command', `unknown command: ${cmd}`);
  }
}

main();
