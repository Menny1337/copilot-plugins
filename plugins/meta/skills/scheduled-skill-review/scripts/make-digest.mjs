#!/usr/bin/env node
/**
 * make-digest.mjs — assemble a human-friendly markdown digest for one run from
 * the per-unit result JSONs the review subprocesses wrote, plus the lifecycle
 * cycle records. Bad/missing result JSON ⇒ the unit is reported as failed.
 *
 * Usage:
 *   node make-digest.mjs --run <runId> [--out <file>]
 * Reads:  runs/<runId>/manifest.json, runs/<runId>/results/*.json
 * Writes: runs/<runId>/digest.md and updates latest-digest.md (unless --stdout)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PATHS, readJson, validateResult, loadCycles, nowIso, ensureDir,
} from './lib.mjs';

const argv = process.argv.slice(2);
function flag(n) { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; }
const STDOUT = argv.includes('--stdout');

const runId = flag('--run');
if (!runId) { console.error('make-digest: --run <runId> required'); process.exit(2); }

const runDir = join(PATHS.runs, runId);
const resultsDir = join(runDir, 'results');
const manifest = readJson(join(runDir, 'manifest.json')) || {};
const cycles = loadCycles();
const cycleByUnit = new Map();
for (const c of cycles) if (c.runId === runId) cycleByUnit.set(c.unit, c);

const results = [];
if (existsSync(resultsDir)) {
  for (const f of readdirSync(resultsDir)) {
    if (!f.endsWith('.json')) continue;
    const path = join(resultsDir, f);
    let r;
    try { r = JSON.parse(readFileSync(path, 'utf8')); } catch {
      results.push({ unit: f.replace(/\.json$/, ''), action: 'failed', _problem: 'unreadable/invalid JSON' });
      continue;
    }
    const problems = validateResult(r);
    if (problems.length) { r.action = 'failed'; r._problem = problems.join('; '); }
    results.push(r);
  }
}

results.sort((a, b) => String(a.unit).localeCompare(String(b.unit)));

const counts = { patched: 0, 'no-change': 0, 're-review': 0, revert: 0, failed: 0 };
for (const r of results) counts[r.action] = (counts[r.action] || 0) + 1;
// PRs opened this run = cycles for this run currently awaiting human merge.
const prCount = [...cycleByUnit.values()].filter((c) => c.status === 'pr').length;

const lines = [];
const cov = manifest.coverage || {};
lines.push(`# Skill/Agent Review Digest — ${runId}`);
lines.push('');
lines.push(`_Generated ${nowIso()}_`);
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push(`- Units reviewed: **${results.length}**`);
lines.push(`- Patched: **${counts.patched}** · No change: **${counts['no-change']}** · Re-reviews: **${counts['re-review']}** · Reverts: **${counts.revert}** · Failed: **${counts.failed}**`);
if (prCount) lines.push(`- 🔬 PRs opened for review: **${prCount}** — merge them to deploy (the daemon reconciles the merge next run).`);
lines.push(`- Sessions scanned: ${cov.filesScanned ?? '?'} (with our-unit usage: ${cov.sessionsWithUsage ?? '?'})`);
if (cov.note) lines.push(`- Coverage: ${cov.note}`);
if (cov.truncated) lines.push('- ⚠️ Scan was truncated (first-run cap) — older history not covered.');
if (cov.parseErrors) lines.push(`- ⚠️ ${cov.parseErrors} malformed event lines skipped.`);
lines.push('');

lines.push('## Units');
lines.push('');
if (!results.length) {
  lines.push('_No units were reviewed this run._');
} else {
  lines.push('| Unit | Type | Action | Root cause | Evidence | Change | Verdict | Status |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    const c = cycleByUnit.get(r.unit);
    const esc = (s) => String(s ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${esc(r.unit)} | ${esc(r.unitType)} | ${esc(r.action)} | ${esc(r.rootCauseLayer)} | ${esc(r.evidenceGrade)} | ${esc(r.changeSummary)} | ${esc(r.verdict)} | ${esc(c?.status)} |`);
  }
}
lines.push('');

// Detail blocks for anything that changed state or failed.
const notable = results.filter((r) => ['patched', 'revert', 'failed', 're-review'].includes(r.action));
if (notable.length) {
  lines.push('## Details');
  lines.push('');
  for (const r of notable) {
    const c = cycleByUnit.get(r.unit);
    lines.push(`### ${r.unit} — ${r.action}`);
    lines.push('');
    if (r._problem) lines.push(`- ⚠️ Problem: ${r._problem}`);
    if (r.changeSummary) lines.push(`- Change: ${r.changeSummary}`);
    if (r.diffStat) lines.push(`- Diff: ${r.diffStat}`);
    if (r.sessionsConsidered != null) lines.push(`- Sessions considered: ${r.sessionsConsidered}`);
    if (r.verdict) lines.push(`- Verdict: ${r.verdict}`);
    if (r.notes) lines.push(`- Notes: ${r.notes}`);
    if (c) {
      lines.push(`- Cycle: \`${c.id}\` (status: ${c.status}${c.commit ? `, commit ${String(c.commit).slice(0, 8)}` : ''}${c.deployedAt ? `, deployed ${c.deployedAt}` : ''}${c.reviewDueAt ? `, re-review due ${c.reviewDueAt}` : ''})`);
      if (c.prUrl) lines.push(`- PR (awaiting merge): ${c.prUrl}`);
    }
    lines.push('');
  }
}

const md = lines.join('\n') + '\n';

if (STDOUT) { process.stdout.write(md); process.exit(0); }

ensureDir(runDir);
const digestPath = join(runDir, 'digest.md');
writeFileSync(digestPath, md);
copyFileSync(digestPath, PATHS.latestDigest);
process.stdout.write(`wrote ${digestPath}\n`);
