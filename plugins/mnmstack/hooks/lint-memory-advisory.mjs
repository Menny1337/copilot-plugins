#!/usr/bin/env node
// lint-memory-advisory.mjs — sessionStart advisory wrapper for the memory linter.
//
// Runs the bundled structural linter (skills/memory/scripts/lint-memory.mjs) in
// advisory mode and surfaces any drift to the session via a single-line
// { "additionalContext": "..." } JSON object on stdout.
//
// Coverage (task #72): it lints BOTH
//   1. the shared memory tree (~/.copilot/memory) with the FULL check set, and
//   2. each agent-workspace dir (~/.copilot/<agent>/) that contains a MEMORY.md,
//      in --workspace mode (universal checks only — see lint-memory.mjs).
// The shared `memory` dir is de-duped (compared by real path) so it is never
// scanned twice, and symlinked workspace dirs are skipped.
//
// Contract (see plugins/meta/skills/hooks-crafting): a sessionStart hook must
// never block or fail startup. So this wrapper is best-effort and ALWAYS exits 0:
//   - node/linter missing                 -> silent, exit 0
//   - every target missing/unreadable     -> silent, exit 0
//   - 0 errors and 0 warnings (clean)     -> silent, exit 0 (quiet on clean)
//   - errors and/or warnings present      -> emit additionalContext, exit 0
// One target failing is "skip that target", never "abort all linting".
//
// It only reports — it never runs --strict and never edits anything.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { existsSync, readdirSync, realpathSync, lstatSync, statSync } from 'node:fs';
import { homedir } from 'node:os';

const MAX_FINDINGS = 20; // global cap across all targets
const MAX_LINE = 200; // per-finding char cap
const SPAWN_TIMEOUT_MS = 12_000;

function quietExit() {
  process.exit(0);
}

// Resolve a path to its real path for robust de-dupe; fall back to the input.
function realOrSelf(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// Run the linter against one dir; return its parsed JSON report or null on any failure.
function lintDir(linter, dir, mode) {
  const argv = mode === 'workspace' ? [linter, '--workspace', '--json', dir] : [linter, '--json', dir];
  const res = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS });
  if (!res || res.error || !res.stdout) return null;
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

try {
  const here = dirname(fileURLToPath(import.meta.url));
  // hooks/ -> plugin root -> skills/memory/scripts/lint-memory.mjs
  const linter = join(here, '..', 'skills', 'memory', 'scripts', 'lint-memory.mjs');
  if (!existsSync(linter)) quietExit();

  const copilotDir = join(homedir(), '.copilot');
  const sharedDir = join(copilotDir, 'memory');
  const sharedReal = existsSync(sharedDir) ? realOrSelf(sharedDir) : null;

  const reports = [];

  // 1. Shared memory tree — full check set.
  if (sharedDir && existsSync(sharedDir)) {
    const r = lintDir(linter, sharedDir, 'shared');
    if (r) reports.push(r);
  }

  // 2. Each agent-workspace dir with a MEMORY.md — workspace (universal) mode.
  let entries = [];
  try {
    entries = readdirSync(copilotDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const dir = join(copilotDir, e.name);
    // Skip symlinked dirs (could resolve to huge/unexpected trees).
    try {
      if (lstatSync(dir).isSymbolicLink()) continue;
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    // De-dupe the shared memory dir by real path (already scanned above).
    if (sharedReal && realOrSelf(dir) === sharedReal) continue;
    // Only workspaces that actually keep a living MEMORY.md.
    if (!existsSync(join(dir, 'MEMORY.md'))) continue;
    const r = lintDir(linter, dir, 'workspace');
    if (r) reports.push(r);
  }

  if (reports.length === 0) quietExit();

  // Aggregate AFTER all targets are linted (never short-circuit on the first one).
  let errors = 0;
  let warns = 0;
  const allFindings = [];
  for (const rep of reports) {
    const c = rep.counts || {};
    errors += c.error || 0;
    warns += c.warn || 0;
    const label = rep.memoryDir ? basename(rep.memoryDir) : 'memory';
    for (const f of rep.findings || []) {
      if (f.severity === 'error' || f.severity === 'warn') {
        allFindings.push({ ...f, file: `${label}/${f.file}` });
      }
    }
  }
  if (errors + warns === 0) quietExit();

  const icon = { error: '❌', warn: '⚠️' };
  // errors first, then warns, so the global cap keeps the most important findings.
  allFindings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  const shown = allFindings.slice(0, MAX_FINDINGS);
  const omitted = allFindings.length - shown.length;
  const lines = shown.map((f) => `${icon[f.severity]} ${f.file}: ${f.msg}`.slice(0, MAX_LINE));
  if (omitted > 0) {
    lines.push(`…and ${omitted} more finding(s). Run lint-memory manually for full details.`);
  }

  const header =
    `[Memory hygiene advisory — non-blocking, from a sessionStart hook] ` +
    `The memory linter found drift across the shared memory tree and agent workspaces: ` +
    `${errors} error(s), ${warns} warning(s). ` +
    `How to act: do NOT interrupt or derail the user's current task to fix this, and do not announce ` +
    `it unprompted. Treat it as background awareness. Address it only when the user's work already ` +
    `involves memory, when they ask about memory health, or at a natural stopping point — then fix it ` +
    `via the memory skill's MAINTAIN step (errors first; workspaces via lint-memory --workspace). Findings:`;

  process.stdout.write(JSON.stringify({ additionalContext: `${header}\n${lines.join('\n')}` }));
  process.exit(0);
} catch {
  // Best-effort: any unexpected failure must not disrupt session startup.
  quietExit();
}
