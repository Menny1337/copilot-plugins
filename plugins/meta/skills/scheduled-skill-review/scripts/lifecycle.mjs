#!/usr/bin/env node
/**
 * lifecycle.mjs — durable cycle records + lifecycle state machine for the
 * scheduled-skill-review daemon. CLI used by run-batch-review.sh.
 *
 * Lifecycle (per unit/cycle):
 *   candidate → proposed(branch+commit, validated) → integrated(merged→main, pushed)
 *   → deployed(plugin refresh done; deployedAt set) → observing → closed
 *                                                            ↘ regressed → reverted
 *   proposed → pr(branch pushed + GitHub PR opened, awaiting human merge)
 *            → (reconciled) deployed | closed
 *
 * One open cycle per unit at a time (one change per unit per cycle). Re-reviews
 * are scheduled when a deployed change's observation window has elapsed.
 *
 * Subcommands:
 *   select  --manifest <f> [--out <f>]      emit work list (new + due re-reviews)
 *   open    --unit U --type T --mode M --run R --branch B   → prints cycleId
 *   set     <cycleId> key=value ...          update fields (status, commit, …)
 *   ingest-result <cycleId> <resultJson>     copy verdict/changeSummary/etc. from a result file
 *   policy  --unit U [--action A]             print integration policy: auto|pr
 *   get     <cycleId>                         print one cycle as JSON
 *   list    [--status S]                      print cycles as JSON
 *   advance-watermark --to-manifest <f>       move state watermark to manifest's watermarkTo
 *   record-run --json '<json>'                store lastRun summary into state
 */

import {
  loadConfig, loadCycles, saveCycles, loadState, saveState,
  readJson, writeJson, nowIso, safeName, withLock,
} from './lib.mjs';

const OPEN = new Set(['candidate', 'proposed', 'integrated', 'deployed', 'observing', 'pr']);

const argv = process.argv.slice(2);
const sub = argv[0];
function flag(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }

const cfg = loadConfig();

function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }

function cmdSelect() {
  const manifest = readJson(flag('--manifest'));
  if (!manifest) { console.error('select: --manifest not readable'); process.exit(2); }
  const cycles = loadCycles();
  const openByUnit = new Map();
  for (const c of cycles) if (OPEN.has(c.status)) openByUnit.set(c.unit, c);

  const include = new Set(cfg.include || []);
  const exclude = new Set(cfg.exclude || []);
  const eligible = (u) => (include.size === 0 || include.has(u)) && !exclude.has(u);

  const work = [];

  // 1. New candidates meeting the signal threshold with no open cycle.
  for (const u of manifest.units || []) {
    if (!eligible(u.unit)) continue;
    if (openByUnit.has(u.unit)) continue;
    if ((u.sessionCount || 0) < (cfg.signalThreshold || 3)) continue;
    work.push({ mode: 'review', unit: u.unit, type: u.type, sessionCount: u.sessionCount, signals: u.signals });
  }

  // 2. Due re-reviews: deployed/observing cycles past their reviewDueAt.
  const now = Date.now();
  for (const c of cycles) {
    if (!['deployed', 'observing'].includes(c.status)) continue;
    if (!c.reviewDueAt || Date.parse(c.reviewDueAt) > now) continue;
    if (!eligible(c.unit)) continue;
    work.push({ mode: 're-review', unit: c.unit, type: c.unitType, cycleId: c.id });
  }

  const result = { selectedAt: nowIso(), count: work.length, work };
  if (flag('--out')) writeJson(flag('--out'), result);
  out(result);
}

function cmdOpen() {
  const unit = flag('--unit');
  const type = flag('--type') || 'skill';
  const mode = flag('--mode') || 'review';
  const run = flag('--run') || nowIso();
  const branch = flag('--branch') || '';
  if (!unit) { console.error('open: --unit required'); process.exit(2); }
  const id = `${cfg.branchPrefix || 'skill-review'}/${safeName(unit)}/${run}`;
  withLock(() => {
    const cycles = loadCycles();
    const cycle = {
      id, unit, unitType: type, mode,
      status: 'candidate',
      branch,
      commit: null,
      openedAt: nowIso(),
      deployedAt: null,
      reviewDueAt: null,
      closedAt: null,
      action: null,
      rootCauseLayer: null,
      changeSummary: null,
      diffStat: null,
      sessionsConsidered: null,
      verdict: null,
      evidenceGrade: null,
      runId: run,
    };
    cycles.push(cycle);
    saveCycles(cycles);
  });
  process.stdout.write(id + '\n');
}

function cmdSet() {
  const id = argv[1];
  if (!id) { console.error('set: <cycleId> required'); process.exit(2); }
  let c = null;
  withLock(() => {
    const cycles = loadCycles();
    c = cycles.find((x) => x.id === id);
    if (!c) return;
    for (const kv of argv.slice(2)) {
      const eq = kv.indexOf('=');
      if (eq < 0) continue;
      const k = kv.slice(0, eq);
      let v = kv.slice(eq + 1);
      c[k] = v;
    }
    // Derived transitions.
    if (c.status === 'deployed' && !c.deployedAt) c.deployedAt = nowIso();
    if (c.status === 'deployed' && c.deployedAt && !c.reviewDueAt) {
      c.reviewDueAt = new Date(Date.parse(c.deployedAt) + (cfg.observationWindowDays || 3) * 86400_000).toISOString();
    }
    if (['closed', 'regressed', 'reverted', 'failed'].includes(c.status) && !c.closedAt) {
      c.closedAt = nowIso();
    }
    saveCycles(cycles);
  });
  if (!c) { console.error(`set: cycle not found: ${id}`); process.exit(2); }
  out(c);
}

// Copy provenance fields from a review result JSON file into the cycle. Used by
// the orchestrator after a review subprocess writes its result, so the durable
// cycle record carries the verdict/changeSummary/etc. (values are long free text
// with spaces/quotes — unsafe as `set key=value` argv, hence file-based ingest).
function cmdIngestResult() {
  const id = argv[1];
  const path = argv[2];
  if (!id || !path) { console.error('ingest-result: <cycleId> <resultJsonPath> required'); process.exit(2); }
  const r = readJson(path);
  if (!r || typeof r !== 'object') { console.error(`ingest-result: result not readable: ${path}`); process.exit(0); }
  const FIELDS = ['action', 'rootCauseLayer', 'changeSummary', 'diffStat', 'sessionsConsidered', 'verdict', 'evidenceGrade'];
  let c = null;
  withLock(() => {
    const cycles = loadCycles();
    c = cycles.find((x) => x.id === id);
    if (!c) return;
    for (const k of FIELDS) {
      if (r[k] !== undefined && r[k] !== null) c[k] = r[k];
    }
    saveCycles(cycles);
  });
  if (!c) { console.error(`ingest-result: cycle not found: ${id}`); process.exit(2); }
  out(c);
}

function cmdPolicy() {
  const unit = flag('--unit');
  const action = flag('--action') || '';
  if (!unit) { console.error('policy: --unit required'); process.exit(2); }
  const pr = new Set(cfg.prUnits || []);
  const auto = new Set(cfg.autoMergeUnits || []);
  // Resolve the unit's base policy: explicit prUnits wins, then autoMergeUnits,
  // else the global deployMode default.
  let policy = pr.has(unit) ? 'pr' : (auto.has(unit) ? 'auto' : (cfg.deployMode || 'auto'));
  // Regression-reverts can override the unit policy (safety: restore known-good fast).
  if (action === 'revert') {
    const rdm = cfg.revertDeployMode || 'auto';
    if (rdm === 'auto' || rdm === 'pr') policy = rdm; // 'unit' → keep resolved policy
  }
  if (policy !== 'pr') policy = 'auto';
  process.stdout.write(policy + '\n');
}

function cmdGet() {
  const id = argv[1];
  const c = loadCycles().find((x) => x.id === id);
  if (!c) { console.error(`get: cycle not found: ${id}`); process.exit(2); }
  out(c);
}

function cmdList() {
  let cycles = loadCycles();
  const s = flag('--status');
  if (s) cycles = cycles.filter((c) => c.status === s);
  out(cycles);
}

function cmdAdvanceWatermark() {
  const manifest = readJson(flag('--to-manifest'));
  if (!manifest || !manifest.coverage) { console.error('advance-watermark: bad manifest'); process.exit(2); }
  const wm = manifest.coverage.watermarkTo;
  if (!wm || !wm.timestamp) {
    console.error('advance-watermark: manifest has no watermarkTo; leaving state unchanged');
    process.exit(0);
  }
  withLock(() => {
    const state = loadState();
    state.watermark = wm;
    saveState(state);
  }, { name: 'state' });
  out({ watermark: wm });
}

function cmdRecordRun() {
  const json = flag('--json');
  let summary;
  try { summary = JSON.parse(json); } catch { console.error('record-run: --json invalid'); process.exit(2); }
  let lastRun;
  withLock(() => {
    const state = loadState();
    lastRun = { ...summary, recordedAt: nowIso() };
    state.lastRun = lastRun;
    saveState(state);
  }, { name: 'state' });
  out(lastRun);
}

const main = async () => {
  switch (sub) {
    case 'select': return cmdSelect();
    case 'open': return cmdOpen();
    case 'set': return cmdSet();
    case 'ingest-result': return cmdIngestResult();
    case 'policy': return cmdPolicy();
    case 'get': return cmdGet();
    case 'list': return cmdList();
    case 'advance-watermark': return cmdAdvanceWatermark();
    case 'record-run': return cmdRecordRun();
    default:
      console.error('lifecycle.mjs: unknown subcommand. Use select|open|set|ingest-result|policy|get|list|advance-watermark|record-run');
      process.exit(2);
  }
};
await main();
