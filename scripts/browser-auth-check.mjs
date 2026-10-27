#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { managedEnvironment } from '../plugins/core-skills/skills/browser/scripts/browser-managed.mjs';
import { newMailButtons } from '../plugins/core-skills/skills/browser/scripts/owa-compose.mjs';

const sites = {
  ado: 'https://dev.azure.com/microsoft/DefenderCommon',
  outlook: 'https://outlook.office.com/mail/',
};

export function redactDiagnostic(text) {
  return String(text)
    .replace(/https?:\/\/[^\s"'<>]+/g, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[account]')
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_+/-]{32,}(?:\.[A-Za-z0-9_+/-]+)*={0,2}\b/g, '[secret]')
    .replace(/(?:\/Users\/|[A-Z]:\\Users\\)[^\s"'<>]+/gi, '[local-path]')
    .slice(0, 1600);
}

export function decodeRead(result) {
  const stdout = result.stdout || '', stderr = result.stderr || '';
  const output = `${stdout}\n${stderr}`;
  let value;
  try { value = JSON.parse(stdout); } catch { /* Non-JSON CLI failures are classified below. */ }
  if (!result.error && result.status === 0 && value && typeof value === 'object' && !Array.isArray(value)) {
    return {ok: true, value};
  }
  // Never retain snapshots or evaluated page content from a malformed response.
  const lines = output.split('\n');
  const start = lines.findIndex(line => /^###\s*Error|^"?Error:|^\w*Error:/.test(line));
  const block = start < 0 ? [] : lines.slice(start, start + 5);
  const boundary = block.findIndex((line, index) => index > 0 && /^###\s/.test(line));
  const message = start < 0 ? 'CLI returned no structured object' :
    block.slice(0, boundary < 0 ? block.length : boundary).join('\n');
  return {
    ok: false,
    error: {
      code: result.error?.code || (result.status !== 0 ? 'cli-exit' : 'structured-read-failed'),
      exitCode: result.status,
      signal: result.signal ?? null,
      message: redactDiagnostic(message),
      transientNavigation: /Execution context was destroyed|Cannot find context|Frame was detached|most likely because of a navigation/i.test(message),
    },
  };
}

export function authExpression(site, expectedAccount) {
  if (!Object.hasOwn(sites, site)) throw new Error('Unsupported auth-check site');
  if (!expectedAccount || !/^[^\s@]+@[^\s@]+$/.test(expectedAccount)) throw new Error('Expected account is required');
  return `async page => page.evaluate(() => {
    const expected = ${JSON.stringify(expectedAccount.toLowerCase())};
    const visible = e => !!e && e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) &&
      !e.closest('[aria-hidden="true"]') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
    const q = s => [...document.querySelectorAll(s)].some(visible);
    const accountPanels = [...document.querySelectorAll(
      '#mectrl_main_body,.mectrl_mainDropdown,[data-testid="account-menu"],.bolt-header-command-bar [role="menu"],.user-settings-menu'
    )].filter(visible);
    const identityNodes = accountPanels.flatMap(p => [...p.querySelectorAll(
      '#mectrl_currentAccount_secondary,[data-testid="account-email"],[class*="email"],[class*="principal"]'
    )]).filter(visible);
    const accountMatch = identityNodes.length ?
      identityNodes.some(e => (e.textContent || '').trim().toLowerCase() === expected) : null;
    const host = location.hostname;
    const ado = host === 'dev.azure.com' && location.pathname.startsWith('/microsoft/DefenderCommon') &&
      q('a[href*="/DefenderCommon/_build"],a[href*="/DefenderCommon/_workitems"],a[href*="/DefenderCommon/_overview"]');
    const outlook = ['outlook.office.com','outlook.cloud.microsoft'].includes(host) &&
      q('main,[role="main"]') && q('[role="navigation"],[role="tree"]');
    return {
      host, shellReady: ${site === 'ado' ? 'ado' : 'outlook'}, accountMatch,
      newMailControls: ${site === 'outlook' ? `(${newMailButtons.toString()})().length` : 'null'},
      signIn: q('input[type="email"],input[type="password"]'),
      challenge: q('input[autocomplete="one-time-code"],iframe[src*="captcha"]'),
      explicitAccessError: q('#errorPage,#access-denied,[data-testid="access-denied"]')
    };
  })`;
}

export function openAccountMenu(root = document) {
  const visible = element => !!element &&
    element.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) &&
    !element.closest('[aria-hidden="true"]') &&
    element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  if ([...root.querySelectorAll('#mectrl_currentAccount_secondary')].some(visible)) {
    return {opened: true, alreadyOpen: true};
  }
  const controls = [...root.querySelectorAll('#mectrl_main_trigger,button.mectrl_trigger,#owa-me-control-container button')].filter(visible);
  if (controls.length !== 1) return {opened: false, controls: controls.length};
  if (controls[0].getAttribute('aria-expanded') === 'true') return {opened: true, alreadyOpen: true};
  controls[0].click();
  return {opened: true, alreadyOpen: false};
}

export function checkAuth({site, expectedAccount, call, now = Date.now, wait, budgetMs = 45000}) {
  if (!Object.hasOwn(sites, site)) throw new Error('Unsupported auth-check site');
  const expression = authExpression(site, expectedAccount);
  const start = now(), deadline = start + budgetMs;
  const report = {site, startedAt: new Date(start).toISOString(), budgetMs, samples: [], failures: []};
  const navigation = call(['goto', sites[site]], Math.max(1, deadline - now()));
  if (navigation.error || navigation.status !== 0 || /^###\s*Error|^"?Error:/m.test(navigation.stdout || '')) {
    const failure = decodeRead(navigation).error;
    report.failures.push({phase: 'navigation', elapsedMs: now() - start, ...failure});
    if (!failure.transientNavigation) {
      return {...report, status: 'BLOCKED', elapsedMs: now() - start};
    }
  }
  let accountMenuAttempted = false;
  while (now() < deadline) {
    const began = now();
    const read = decodeRead(call(['--raw', 'run-code', expression], deadline - now()));
    if (!read.ok) {
      report.failures.push({phase: 'read', elapsedMs: now() - start, durationMs: now() - began, ...read.error});
      if (!read.error.transientNavigation) break;
    } else {
      report.samples.push({elapsedMs: now() - start, durationMs: now() - began, ...read.value});
      if (read.value.signIn || read.value.challenge || read.value.explicitAccessError) break;
      if (read.value.shellReady && read.value.accountMatch === null && now() < deadline) {
        if (!accountMenuAttempted) {
          const menu = decodeRead(call(['--raw', 'run-code', `async page => page.evaluate(${openAccountMenu.toString()})`], deadline - now()));
          report.accountMenu = menu;
          (report.accountMenuObservations ??= []).push({elapsedMs: now() - start, ...menu});
          if (!menu.ok) {
            report.failures.push({phase: 'account-menu', elapsedMs: now() - start, ...menu.error});
            break;
          }
          if (menu.value.controls > 1) break;
          accountMenuAttempted = menu.value.opened === true;
        }
        if (now() < deadline) wait(Math.min(500, deadline - now()));
        continue;
      }
      if (read.value.shellReady) break;
    }
    if (now() < deadline) wait(Math.min(1000, deadline - now()));
  }
  const last = report.samples.at(-1);
  return {...report, elapsedMs: now() - start, status:
    last?.accountMatch === false ? 'FAIL' :
    last?.shellReady && last?.accountMatch === true ? 'PASS' : last?.shellReady ? 'PARTIAL' : 'BLOCKED'};
}

function main() {
  const args = process.argv.slice(2);
  const get = name => args[args.indexOf(name) + 1];
  if (!args.includes('--session') || !args.includes('--cwd') || !args.includes('--site') || !args.includes('--output')) {
    throw new Error('Usage: browser-auth-check.mjs --session <owned-session> --cwd <returned-cwd> --site ado|outlook --output <private-json>; set BROWSER_EXPECTED_ACCOUNT');
  }
  const session = get('--session');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(session)) throw new Error('Invalid session');
  const report = checkAuth({
    site: get('--site'), expectedAccount: process.env.BROWSER_EXPECTED_ACCOUNT,
    call: (args, timeout) => spawnSync('playwright-cli', [`-s=${session}`, ...args], {
      cwd: get('--cwd'), encoding: 'utf8', env: managedEnvironment(), timeout,
      maxBuffer: 1024 * 1024,
    }),
    wait: ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  });
  writeFileSync(get('--output'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  console.log(JSON.stringify(report));
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
