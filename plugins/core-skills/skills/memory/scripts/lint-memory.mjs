#!/usr/bin/env node
// lint-memory.mjs — structural linter for a markdown memory tree (~/.copilot/memory).
//
// Mechanizes the MAINTAIN discipline the `memory` skill prescribes so the rules are
// enforced instead of relying on agent goodwill. Zero dependencies (Node >= 16, ESM).
//
// Usage:
//   node scripts/lint-memory.mjs [dir] [--workspace] [--strict] [--json] [--help]
//
//   dir          Memory dir to lint. Default: $MEMORY_DIR or ~/.copilot/memory
//   --workspace  Lint a flat agent-workspace dir (e.g. ~/.copilot/agent-architect)
//                with universal checks only. Runs future-date + >200-line checks on
//                all files, the "**Last Updated:**" freshness check on MEMORY.md only,
//                and SKIPS the orphan/location and project-stem-duplicate checks (which
//                assume the projects/topics/episodes/conventions layout that workspaces
//                lack). Without this flag the full shared-memory check set runs.
//   --strict     Exit non-zero on warnings too (CI/pre-commit mode). Default: only errors fail.
//   --json       Emit machine-readable JSON instead of the human report.
//   --help       Show this help.
//
// Severity model (advisory by default so it never derails an interactive task):
//   error  → real bugs: future dates. Exit 1 (always).
//   warn   → maintenance debt: missing/!bold `Last Updated`, >200 lines, duplicate
//            project stems, format drift. Exit 0 unless --strict.
//   info   → review nudges: orphan files outside documented locations.
//
// It never edits or deletes anything — it only reports.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
import { homedir } from 'node:os';

const HELP = `lint-memory.mjs — structural linter for a markdown memory tree

Usage:
  node scripts/lint-memory.mjs [dir] [--workspace] [--strict] [--json] [--help]

  dir          Memory dir to lint (default: $MEMORY_DIR or ~/.copilot/memory)
  --workspace  Lint a flat agent-workspace dir with universal checks only
               (future dates, >200 lines, "**Last Updated:**" on MEMORY.md);
               skips the orphan/location and duplicate-project checks
  --strict     Exit non-zero on warnings too (default: only errors fail)
  --json       Emit JSON instead of the human report
  --help       Show this help

Default checks: future dates (error), canonical "**Last Updated:**" presence/format,
>200-line distill threshold, duplicate project stems, orphan files (info).
--workspace mode runs only the layout-agnostic subset (see above).`;

// --- args ---------------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}
const strict = args.includes('--strict');
const json = args.includes('--json');
const workspace = args.includes('--workspace');
const positional = args.find((a) => !a.startsWith('-'));
const MEMORY_DIR =
  positional || process.env.MEMORY_DIR || join(homedir(), '.copilot', 'memory');

// --- constants ----------------------------------------------------------
const LINE_LIMIT = 200;
// today in LOCAL time, with a 1-day grace so UTC/local midnight skew is not flagged.
const grace = new Date();
grace.setDate(grace.getDate() + 1);
const todayPlusGrace = grace.toISOString().slice(0, 10);

// Documented memory locations (allowlist). Anything else is an "orphan" (info only).
// Root scalars + the four documented subtrees + the procedural `conventions/` tier.
// `skill-improvement-loop.md` is a sanctioned root changelog: the skill-improvement-loop
// skill (Phase D) prescribes `~/.copilot/memory/skill-improvement-loop.md` as its
// canonical cross-session location — do not flag it as an orphan.
const ROOT_ALLOWED = new Set(['MEMORY.md', 'user.md', 'skill-improvement-loop.md']);
const SUBDIR_ALLOWED = new Set(['projects', 'topics', 'episodes', 'conventions']);

const findings = [];
const add = (severity, file, msg) => findings.push({ severity, file, msg });

// --- walk ---------------------------------------------------------------
function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`Cannot read memory dir: ${dir}\n${err.message}`);
    process.exit(2);
  }
  const files = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // skip dotfiles (.DS_Store, .gitignore)
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(full));
    else if (extname(e.name) === '.md') files.push(full);
  }
  return files;
}

if (!safeIsDir(MEMORY_DIR)) {
  console.error(`Memory dir does not exist: ${MEMORY_DIR}`);
  process.exit(2);
}
function safeIsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const mdFiles = walk(MEMORY_DIR);

// --- per-file checks ----------------------------------------------------
const projectStems = new Map(); // lowercased stem -> [relpaths]

for (const file of mdFiles) {
  const rel = relative(MEMORY_DIR, file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const parts0 = rel.split(/[\\/]/);
  const isEpisode = parts0[0] === 'episodes';

  // 1. freshness header: episodes use "**Date:**"; living files use "**Last Updated:**".
  //    In --workspace mode this check applies ONLY to the workspace's living index
  //    (MEMORY.md); freeform notes/handoffs/roadmaps are not expected to carry a stamp.
  const hasBold = /^\*\*Last Updated:\*\*/m.test(text);
  const hasPlain = /^Last Updated:/m.test(text);
  const hasDate = /^\*\*Date:\*\*/m.test(text);
  const freshnessApplies = workspace ? basename(file) === 'MEMORY.md' : true;
  if (!freshnessApplies) {
    // skip freshness for non-index workspace files
  } else if (isEpisode) {
    if (!hasDate && !hasBold) add('warn', rel, 'episode missing a "**Date:**" line');
  } else if (!hasBold && hasPlain) {
    add('warn', rel, 'uses "Last Updated:" without bold — use "**Last Updated:**"');
  } else if (!hasBold) {
    add('warn', rel, 'missing a "**Last Updated:**" line');
  }

  // 2. future dates — only in STRUCTURED stamps, not arbitrary prose dates:
  //    "**Last Updated:** D", "**Date:** D" (episodes), and inline "_(D ...)_" entry stamps.
  const stampDates = new Set();
  for (const m of text.matchAll(/^\*\*(?:Last Updated|Date):\*\*\s*(\d{4}-\d{2}-\d{2})/gm)) stampDates.add(m[1]);
  for (const m of text.matchAll(/_\((\d{4}-\d{2}-\d{2})(?:[,)]| )/g)) stampDates.add(m[1]);
  for (const d of stampDates) {
    if (d > todayPlusGrace) {
      add('error', rel, `future date ${d} (today is ${new Date().toISOString().slice(0, 10)})`);
    }
  }

  // 3. distill threshold. In --workspace mode this is a *living-index* concern, so it
  //    applies only to MEMORY.md — freeform notes/handoffs/research dumps are
  //    intentionally long and must not generate recurring "distill" advisory noise.
  const distillApplies = workspace ? basename(file) === 'MEMORY.md' : true;
  if (distillApplies && lines.length > LINE_LIMIT) {
    add('warn', rel, `${lines.length} lines > ${LINE_LIMIT} — distill (see DISTILL step)`);
  }

  // 4. collect top-level project stems for duplicate detection (projects/<stem>.md only).
  //    Normalize aggressively so kebab/Pascal/snake variants of one name collide
  //    (e.g. "sample-project" and "SampleProject" → "sampleproject").
  //    Skipped in --workspace mode (flat workspaces have no projects/ layout).
  if (!workspace && parts0[0] === 'projects' && parts0.length === 2) {
    const stem = basename(parts0[1], '.md').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!projectStems.has(stem)) projectStems.set(stem, []);
    projectStems.get(stem).push(rel);
  }

  // 5. orphan detection (info, allowlist-based, never destructive).
  //    Skipped in --workspace mode: workspaces are a flat dir of freeform notes, so
  //    the projects/topics/episodes/conventions allowlist would mis-flag everything.
  if (!workspace) {
    if (parts0.length === 1) {
      if (!ROOT_ALLOWED.has(parts0[0])) {
        add('info', rel, 'root-level file outside documented locations — move to projects/topics/episodes/conventions or MEMORY.md');
      }
    } else if (!SUBDIR_ALLOWED.has(parts0[0])) {
      add('info', rel, `under undocumented dir "${parts0[0]}/" — not a documented memory location`);
    } else if (parts0.length > 2) {
      add('info', rel, `nested under ${parts0[0]}/ — documented layout is flat ${parts0[0]}/<name>.md`);
    }
  }
}

// 6. duplicate project stems (case-insensitive)
for (const [stem, paths] of projectStems) {
  if (paths.length > 1) {
    add('warn', stem, `duplicate project files for "${stem}": ${paths.join(', ')} — merge into one canonical file`);
  }
}

// --- report -------------------------------------------------------------
const counts = { error: 0, warn: 0, info: 0 };
for (const f of findings) counts[f.severity]++;

if (json) {
  console.log(JSON.stringify({ memoryDir: MEMORY_DIR, workspace, counts, findings }, null, 2));
} else {
  const icon = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ' };
  const order = { error: 0, warn: 1, info: 2 };
  console.log(`\nMemory lint: ${MEMORY_DIR}${workspace ? ' (workspace mode)' : ''}`);
  console.log(`Scanned ${mdFiles.length} markdown file(s).\n`);
  if (findings.length === 0) {
    console.log('✅ Clean — no issues found.');
  } else {
    for (const f of [...findings].sort((a, b) => order[a.severity] - order[b.severity])) {
      console.log(`${icon[f.severity]} ${f.file}: ${f.msg}`);
    }
    console.log(`\n${counts.error} error(s), ${counts.warn} warning(s), ${counts.info} info.`);
  }
}

// --- exit ---------------------------------------------------------------
if (counts.error > 0) process.exit(1);
if (strict && counts.warn > 0) process.exit(1);
process.exit(0);
