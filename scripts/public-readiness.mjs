#!/usr/bin/env node
import {
  existsSync, lstatSync, readFileSync, realpathSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrivatePolicy, redactPrivateDetails, residualGuardNames } from './publish-public-guard.mjs';

const MAX_BYTES = 10 * 1024 * 1024;
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.icns', '.ico', '.pdf',
  '.zip', '.gz', '.tar', '.7z', '.pptx', '.docx', '.xlsx', '.woff', '.woff2', '.sqlite', '.db']);
const ARTIFACT_DIRS = new Set(['.git', '.build', '.playwright-cli', '.venv', '__pycache__', 'node_modules']);

function git(root, args, input) {
  try {
    return execFileSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', '-C', root, ...args], {
      input, maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`Git inspection failed (${args[0]}). No repository contents were printed.`);
  }
}

function artifact(path) {
  const parts = path.split('/');
  const name = parts.at(-1);
  return parts.some((part) => ARTIFACT_DIRS.has(part))
    || parts.some((part) => part.startsWith('.ado-sync-sandbox-'))
    || name === '.DS_Store' || name === '.auth.json'
    || (/^\.env(?:\.|$)/.test(name) && !/\.example$/.test(name))
    || /\.local\.(?:json|toml|ya?ml)$/.test(name)
    || /\.(?:log|orig|tmp|pem|pfx|p12|key)$/.test(name);
}

function assetReviews(root, mode) {
  const path = resolve(root, 'scripts/public-assets.json');
  let data;
  if (mode === 'staged') {
    const entry = indexEntries(root).find((entry) => entry.path === 'scripts/public-assets.json' && entry.stage === '0');
    if (!entry) return new Map();
    if (entry.mode !== '100644') throw new Error('Asset reviews must be a regular non-executable file.');
    data = git(root, ['cat-file', 'blob', entry.oid]);
  } else {
    if (!existsSync(path)) return new Map();
    if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error('Asset reviews must be a regular file inside the checkout.');
    data = readFileSync(path);
  }
  let value;
  try { value = JSON.parse(data.toString('utf8')); }
  catch { throw new Error('Cannot read public asset reviews as JSON.'); }
  if (value.version !== 1 || !Array.isArray(value.assets)) throw new Error('Invalid public asset review schema.');
  const reviews = new Map();
  for (const asset of value.assets) {
    if (!asset || typeof asset.path !== 'string' || isAbsolute(asset.path)
      || asset.path.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || typeof asset.reason !== 'string' || !asset.reason.trim() || reviews.has(asset.path)) {
      throw new Error('Invalid or duplicate public asset review.');
    }
    reviews.set(asset.path, asset.sha256);
  }
  return reviews;
}

function indexEntries(root) {
  return git(root, ['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean).map((entry) => {
    const tab = entry.indexOf('\t');
    const [mode, oid, stage] = entry.slice(0, tab).split(' ');
    return { path: entry.slice(tab + 1), mode, oid, stage };
  });
}

function readObjects(root, ids, visit) {
  for (let i = 0; i < ids.length; i += 32) {
    const group = ids.slice(i, i + 32);
    const info = git(root, ['cat-file', '--batch-check'], `${group.join('\n')}\n`).toString('utf8').trim().split('\n');
    const readable = [];
    for (const line of info) {
      const [oid, type, size] = line.split(' ');
      if (!/^[a-f0-9]{40,64}$/.test(oid) || !/^(?:blob|commit|tag|tree)$/.test(type)
        || !Number.isSafeInteger(Number(size))) throw new Error('Unexpected Git object response.');
      if (Number(size) > MAX_BYTES) visit(oid, type, null);
      else readable.push(oid);
    }
    if (!readable.length) continue;
    const output = git(root, ['cat-file', '--batch'], `${readable.join('\n')}\n`);
    let offset = 0;
    for (const expected of readable) {
      const end = output.indexOf(10, offset);
      if (end < 0) throw new Error('Incomplete Git object response.');
      const [oid, type, size] = output.subarray(offset, end).toString('utf8').split(' ');
      const length = Number(size);
      if (oid !== expected || !Number.isSafeInteger(length) || length < 0
        || end + 1 + length >= output.length) throw new Error('Invalid Git object response.');
      visit(oid, type, output.subarray(end + 1, end + 1 + length));
      offset = end + 2 + length;
    }
  }
}

export function audit({ root, mode = 'tracked', policyPath, includeUntracked = false } = {}) {
  root = realpathSync(root ?? process.cwd());
  if (!['tracked', 'staged', 'history'].includes(mode)) throw new Error('Unknown audit mode.');
  if (includeUntracked && mode !== 'tracked') throw new Error('--include-untracked requires --tracked.');
  const top = git(root, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  root = realpathSync(top);
  let policy = [];
  if (policyPath) {
    const realPolicy = realpathSync(resolve(policyPath));
    const rel = relative(root, realPolicy);
    if (rel === '' || (!rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
      throw new Error('Private policy must be outside the source checkout.');
    }
    policy = loadPrivatePolicy(realPolicy);
  }
  const reviews = assetReviews(root, mode);
  const report = {
    mode, privatePolicy: Boolean(policyPath), files: 0, deleted: 0, objects: 0, metadata: 0, refs: 0,
    findings: [], unreviewed: [], limitations: [
      'This is a local inspection, not publication approval or a complete secret detector.',
      'Hosted PRs, issues, releases, Actions data, and server-only refs are not inspected.',
      ...(mode === 'history' ? ['Local reflogs and unreachable objects are not inspected; history scope is reachable refs and HEAD.'] : []),
      ...(policyPath ? [] : ['Owner-specific private identifiers require an external policy.']),
    ],
  };
  const safe = (text) => redactPrivateDetails(text, policy);
  function record(list, path, rule, oid) {
    list.push({ path: safe(path), rule, ...(oid ? { object: oid } : {}) });
  }
  function inspect(path, mode, data, oid) {
    report.files++;
    for (const rule of residualGuardNames(path, { policy, branding: false })) {
      record(report.findings, path, rule, oid);
    }
    if (artifact(path)) record(report.findings, path, 'tracked-private-artifact', oid);
    if (!['100644', '100755'].includes(mode)) {
      record(report.unreviewed, path, mode === '120000' ? 'symlink' : 'unsupported-file-mode', oid);
      return;
    }
    if (data === null || data.length > MAX_BYTES) {
      record(report.unreviewed, path, 'oversized-or-unreadable', oid);
      return;
    }
    let text;
    if (!BINARY.has(extname(path).toLowerCase()) && !data.includes(0)) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
      catch { /* Invalid UTF-8 requires a binary review below. */ }
    }
    if (text === undefined) {
      const hash = createHash('sha256').update(data).digest('hex');
      if (reviews.get(path) !== hash) record(report.unreviewed, path, 'binary-review-required', oid);
      return;
    }
    for (const rule of residualGuardNames(text, { policy, branding: false })) {
      record(report.findings, path, rule, oid);
    }
  }
  if (mode === 'history') {
    const refs = git(root, ['for-each-ref', '--format=%(objectname) %(refname)']).toString('utf8').trim().split('\n').filter(Boolean);
    report.refs = refs.length;
    for (const ref of refs) {
      for (const rule of residualGuardNames(ref, { policy, branding: false })) {
        record(report.findings, ref.slice(ref.indexOf(' ') + 1), rule);
      }
    }
    const commits = git(root, ['rev-list', '--all', 'HEAD']).toString('utf8').trim().split('\n').filter(Boolean);
    const entries = new Map();
    for (const commit of commits) {
      for (const entry of git(root, ['ls-tree', '-r', '-z', commit]).toString('utf8').split('\0').filter(Boolean)) {
        const tab = entry.indexOf('\t');
        const [mode, , oid] = entry.slice(0, tab).split(' ');
        const path = entry.slice(tab + 1);
        const key = `${mode}\0${oid}\0${path}`;
        entries.set(key, { path, mode, oid });
      }
    }
    const byObject = new Map();
    for (const entry of entries.values()) {
      if (!byObject.has(entry.oid)) byObject.set(entry.oid, []);
      byObject.get(entry.oid).push(entry);
    }
    const allIds = git(root, ['rev-list', '--objects', '--no-object-names', '--all', 'HEAD'])
      .toString('utf8').trim().split('\n').filter(Boolean);
    for (const ref of refs) allIds.push(ref.split(' ')[0]);
    readObjects(root, [...new Set(allIds)], (oid, type, data) => {
      report.objects++;
      if (type === 'blob') {
        const paths = byObject.get(oid);
        if (!paths) inspect('unmapped-blob', '100644', data, oid);
        else for (const entry of paths) inspect(entry.path, entry.mode, data, oid);
      } else if (type === 'commit' || type === 'tag') {
        report.metadata++;
        if (data === null) record(report.unreviewed, type, 'oversized-metadata', oid);
        else for (const rule of residualGuardNames(data.toString('utf8'), { policy, branding: false })) {
          record(report.findings, type, rule, oid);
        }
      }
    });
    for (const entry of entries.values()) {
      if (!['100644', '100755', '120000'].includes(entry.mode)) inspect(entry.path, entry.mode, null, entry.oid);
    }
  } else {
    let entries = indexEntries(root);
    for (const entry of entries) {
      if (entry.stage !== '0') record(report.unreviewed, entry.path, 'unmerged-index');
    }
    if (mode === 'staged') {
      const changed = new Set(git(root, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT'])
        .toString('utf8').split('\0').filter(Boolean));
      entries = entries.filter(({ path }) => changed.has(path));
      const byOid = new Map();
      for (const entry of entries) {
        if (!byOid.has(entry.oid)) byOid.set(entry.oid, []);
        byOid.get(entry.oid).push(entry);
      }
      readObjects(root, [...byOid.keys()], (oid, type, data) => {
        report.objects++;
        for (const entry of byOid.get(oid)) inspect(entry.path, entry.mode, data, oid);
      });
    } else {
      if (includeUntracked) {
        const paths = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
          .toString('utf8').split('\0').filter(Boolean);
        entries.push(...paths.map((path) => ({ path, mode: '100644', stage: '0' })));
      }
      const visited = new Set();
      for (const entry of entries) {
        if (visited.has(entry.path)) continue;
        visited.add(entry.path);
        const path = resolve(root, entry.path);
        let stat;
        try { stat = lstatSync(path); }
        catch (error) {
          if (error.code === 'ENOENT') report.deleted++;
          else record(report.unreviewed, entry.path, 'unreadable-worktree-file');
          continue;
        }
        if (!stat.isFile()) inspect(entry.path, stat.isSymbolicLink() ? '120000' : '160000', null);
        else {
          const rel = relative(root, realpathSync(path));
          if (rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
            record(report.unreviewed, entry.path, 'outside-worktree'); continue;
          }
          inspect(entry.path, entry.mode, stat.size > MAX_BYTES ? null : readFileSync(path));
        }
      }
    }
  }
  report.passed = report.findings.length === 0 && report.unreviewed.length === 0;
  return report;
}

function main(argv) {
  const options = {};
  let json = false;
  let selected = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') {
      console.log('Usage: node scripts/public-readiness.mjs [--tracked|--staged|--history] [--include-untracked] [--policy PATH] [--root PATH] [--json]\nRead-only local inspection. Exit 1: findings or unreviewed content; exit 2: inspection error.\nPrivate policies must be outside the checkout. No mode authorizes publication.');
      return 0;
    }
    if (['--tracked', '--staged', '--history'].includes(arg)) {
      if (selected) throw new Error('Choose one audit mode.');
      options.mode = arg.slice(2); selected = true;
    } else if (arg === '--root' || arg === '--policy') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      options[arg === '--root' ? 'root' : 'policyPath'] = value;
    } else if (arg === '--json') json = true;
    else if (arg === '--include-untracked') options.includeUntracked = true;
    else throw new Error('Unknown public-readiness argument. Use --help.');
  }
  options.policyPath ??= process.env.COPILOT_PLUGIN_PUBLIC_POLICY;
  const report = audit(options);
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${report.mode}: ${report.files} file versions; ${report.findings.length} findings; ${report.unreviewed.length} unreviewed.`);
    for (const finding of [...report.findings, ...report.unreviewed]) {
      console.log(`${finding.path}${finding.object ? ` @ ${finding.object}` : ''} [${finding.rule}]`);
    }
    for (const limitation of report.limitations) console.log(limitation);
  }
  return report.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    // Filesystem errors can include private absolute paths; never print their messages.
    console.error(error.code ? `Inspection failed (${error.code}). No private contents printed.` : error.message);
    process.exitCode = 2;
  }
}
