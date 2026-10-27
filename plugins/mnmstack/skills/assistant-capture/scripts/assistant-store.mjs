#!/usr/bin/env node
/**
 * assistant-store.mjs — deterministic, transactional local write gateway for
 * the assistant-capture skill.
 *
 * WHY THIS EXISTS
 *   A terminal Copilot session and a voice/automation client can write to the
 *   same local Markdown store (`~/.copilot/assistant/{tasks,reminders}.md` and
 *   `notes/`) at the same time. Direct "read the file, edit some text, write
 *   the file back" edits race: two concurrent writers can silently lose or
 *   duplicate a note/task/reminder, and a crash mid-write can corrupt a file
 *   the next reader depends on. This script is the ONLY supported write path
 *   for that local store: it serializes writes through a lock, re-reads the
 *   target under that lock, validates structure before mutating, and commits
 *   changes with a same-directory temp-file + fsync + atomic rename so a
 *   reader (or a crash) never observes a half-written file.
 *
 *   ADO-backed task operations (SKILL.md §3.5, when `taskBackend: "ado"`) are
 *   NOT handled here — those already go through `az boards` and are
 *   unaffected by this gateway. This script only owns the local-markdown
 *   backend: notes, `tasks.md`, `reminders.md`, workspace init, and batch
 *   action-item import.
 *
 * STORE LOCATION (source order, first hit wins)
 *   --store <dir>  >  $COPILOT_PLUGIN_ASSISTANT_STORE  >  ~/.copilot/assistant
 *
 * COMMANDS
 *   init                                    create the workspace skeleton (idempotent)
 *   create-note --type T --title S [--date YYYY-MM-DD] [--tags a,b]
 *               [--content-file PATH]       content read from stdin if --content-file omitted
 *   task add --title S [--priority P1|P2|P3] [--due YYYY-MM-DD] [--context @x]
 *            [--project +Y] [--source PATH]
 *   task update --match KEYWORD [--title S] [--priority Pn] [--due D]
 *               [--context @x] [--project +Y] [--source PATH]
 *   task complete --match KEYWORD
 *   task reopen --match KEYWORD
 *   reminder set --text S --due D [--context @x]
 *   reminder dismiss --match KEYWORD
 *   import                                  batch action-item import; reads a JSON array
 *                                            of {title, due?, context?, project?, priority?,
 *                                            source?} objects from stdin, one atomic commit
 *
 * OUTPUT
 *   Exactly one JSON line to stdout per invocation:
 *     { ok, op, opId, changedPaths: string[], result, error }
 *   `error` is `{ code, message, ...extra }` (e.g. `candidates` for ambiguous
 *   matches) when `ok` is false; otherwise null.
 *
 * EXIT CODES: 0 ok · 1 usage/argument error · 2 validation/business error
 *             (not found, ambiguous, malformed store, name collision) ·
 *             3 lock could not be acquired (contention) · 4 unexpected/internal
 *
 * Pure Node, zero dependencies — mirrors the repo's other *.mjs scripts.
 */

import {
  mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, statSync,
  openSync, closeSync, writeSync, fsyncSync, renameSync, readdirSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

// ── Errors ───────────────────────────────────────────────────────────────

class StoreError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

const EXIT_BY_CODE = {
  USAGE: 1,
  NOT_FOUND: 2,
  AMBIGUOUS_MATCH: 2,
  STRUCTURE_INVALID: 2,
  VALIDATION_ERROR: 2,
  NAME_EXHAUSTED: 2,
  LOCK_TIMEOUT: 3,
};

// ── Store paths ──────────────────────────────────────────────────────────

function resolveStoreDir(explicit) {
  if (explicit) return explicit;
  if (process.env.COPILOT_PLUGIN_ASSISTANT_STORE) return process.env.COPILOT_PLUGIN_ASSISTANT_STORE;
  return join(homedir(), '.copilot', 'assistant');
}

function storePaths(storeDir) {
  return {
    root: storeDir,
    tasksFile: join(storeDir, 'tasks.md'),
    remindersFile: join(storeDir, 'reminders.md'),
    memoryFile: join(storeDir, 'MEMORY.md'),
    notesDir: join(storeDir, 'notes'),
    templatesDir: join(storeDir, 'templates'),
    archiveDir: join(storeDir, 'archive'),
    lockDir: join(storeDir, '.lock'),
  };
}

const NOTE_TYPES = ['meeting', 'decision', 'idea', 'scratch'];
// SKILL.md documents plural note directories for everything except scratch
// (`notes/meetings/`, `notes/decisions/`, `notes/ideas/`, `notes/scratch/`).
// The `--type` value stays singular (matches the template filenames and the
// natural-language type name); this map translates it to the on-disk folder.
const NOTE_TYPE_DIRS = { meeting: 'meetings', decision: 'decisions', idea: 'ideas', scratch: 'scratch' };

// ── Locking (atomic mkdir + owner metadata + bounded stale recovery) ────

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** true if pid appears to be a live process on THIS host; unknown -> true (assume alive). */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') return false; // definitely gone
    return true; // EPERM etc — exists but not ours; treat as alive
  }
}

function readOwnerMeta(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * True when a lock directory's age exceeds `staleMs`. Used ONLY as a fallback signal for
 * owners we cannot definitively check liveness for (missing/invalid owner metadata, or a
 * foreign host) — see acquireLock. Treats a lock dir that vanished mid-check as stale too
 * (the holder just released it, or another reclaimer already removed it).
 */
function isLockAgeStale(lockDir, staleMs) {
  try {
    const age = Date.now() - statSync(lockDir).mtimeMs;
    return age > staleMs;
  } catch {
    return true;
  }
}

/**
 * Acquire the whole-store lock. Bounded retries with a stale-lock recovery policy:
 *   - Same-host owner: liveness is checked definitively via `process.kill(pid, 0)`. The
 *     lock is reclaimed ONLY when that owner process is confirmed dead. A live same-host
 *     owner is NEVER reclaimed by age alone — a legitimately slow holder (e.g. a large
 *     batch import) must not have its lock stolen out from under it just because it took
 *     longer than `staleMs`.
 *   - Foreign host, or missing/invalid owner metadata: liveness cannot be checked from
 *     here, so `staleMs` age is the only available signal and is used as a bounded
 *     fallback.
 * Recovery is bounded by `maxAttempts` so a genuinely contended (or genuinely hung, opaque
 * foreign-host) lock fails loudly (LOCK_TIMEOUT) instead of retrying forever.
 */
function acquireLock(storeDir, opId, { staleMs = 15_000, maxAttempts = 100, retryDelayMs = 50 } = {}) {
  mkdirSync(storeDir, { recursive: true });
  const lockDir = join(storeDir, '.lock');
  let attempt = 0;
  let lastOwner = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
        pid: process.pid,
        hostname: hostname(),
        opId,
        acquiredAt: new Date().toISOString(),
      }));
      return {
        release() {
          try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        },
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const owner = readOwnerMeta(lockDir);
      lastOwner = owner;
      const hasIdentifiableOwner = owner && typeof owner.hostname === 'string' && Number.isInteger(owner.pid);
      let stale;
      if (!hasIdentifiableOwner) {
        stale = isLockAgeStale(lockDir, staleMs); // can't identify the owner at all
      } else if (owner.hostname === hostname()) {
        stale = !isPidAlive(owner.pid); // same host: definitive liveness check, no age fallback
      } else {
        stale = isLockAgeStale(lockDir, staleMs); // foreign host: age is the only signal we have
      }
      if (stale) {
        try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* race: someone else cleared it */ }
        continue; // retry mkdir immediately, does not count against the sleep backoff
      }
      sleepSync(retryDelayMs);
    }
  }
  throw new StoreError(
    'LOCK_TIMEOUT',
    `Could not acquire the assistant store lock after ${attempt} attempts` +
      (lastOwner ? ` (held by pid ${lastOwner.pid} on ${lastOwner.hostname} since ${lastOwner.acquiredAt})` : ''),
  );
}

/** Remove leftover temp-write artifacts from a prior interrupted write (crash safety). */
function cleanupStaleTempFiles(dir, maxDepth = 3) {
  if (maxDepth < 0) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.lock') continue;
      cleanupStaleTempFiles(p, maxDepth - 1);
    } else if (/\.tmp-\d+-\d+-[a-z0-9]+$/.test(e.name)) {
      try { rmSync(p, { force: true }); } catch { /* best-effort */ }
    }
  }
}

function withLock(storeDir, opId, fn) {
  const lock = acquireLock(storeDir, opId);
  try {
    cleanupStaleTempFiles(storeDir);
    return fn();
  } finally {
    lock.release();
  }
}

// ── Atomic, durable file write ───────────────────────────────────────────

/**
 * Write `content` to `path` via a same-directory temp file, fsync, then an
 * atomic rename. A reader of `path` always sees either the previous complete
 * content or the new complete content — never a partial write. Crash-safe:
 * if the process dies before the rename, `path` is untouched and the stray
 * temp file is swept up by `cleanupStaleTempFiles` on the next lock.
 */
function atomicWriteFile(path, content) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const fd = openSync(tmp, 'w', 0o644);
  try {
    try {
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    // Don't leave a stray empty/partial temp file behind on a synchronous write failure
    // (e.g. invalid content) — clean up immediately rather than relying solely on the
    // next lock's cleanupStaleTempFiles sweep.
    try { rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    throw e;
  }
  renameSync(tmp, path);
  // Best-effort: fsync the containing directory so the rename's directory-entry
  // update is durable too. Not all platforms support fsync on a directory fd
  // (notably Windows) — ignore failures there.
  try {
    const dfd = openSync(dir, 'r');
    try { fsyncSync(dfd); } finally { closeSync(dfd); }
  } catch { /* platform does not support directory fsync */ }
}

/**
 * Reserve a brand-new file name exclusively (no readers can ever observe a
 * partial write of a file they didn't know existed yet), with a deterministic
 * numeric suffix on collision. Returns the final path actually created.
 */
function createExclusiveWithSuffix(dir, baseName, ext, content, maxSuffix = 1000) {
  mkdirSync(dir, { recursive: true });
  for (let n = 0; n <= maxSuffix; n += 1) {
    const candidate = n === 0 ? `${baseName}${ext}` : `${baseName}-${n + 1}${ext}`;
    const candidatePath = join(dir, candidate);
    let fd;
    try {
      fd = openSync(candidatePath, 'wx', 0o644); // exclusive create — atomically detects collision
    } catch (e) {
      if (e.code === 'EEXIST') continue;
      throw e;
    }
    closeSync(fd); // reserved as an empty file; now fill it durably via temp+rename
    try {
      atomicWriteFile(candidatePath, content);
    } catch (e) {
      // Don't leave a consumed-but-empty placeholder behind: free the name back up so a
      // retry (by this process or another) can reuse it instead of skipping to the next
      // suffix or finding a corrupt zero-byte file where content was expected.
      try { rmSync(candidatePath, { force: true }); } catch { /* best-effort */ }
      throw e;
    }
    return candidatePath;
  }
  throw new StoreError('NAME_EXHAUSTED', `Could not find a free name for "${baseName}${ext}" after ${maxSuffix} suffixes`);
}

// ── Workspace skeleton ───────────────────────────────────────────────────

function defaultTasksMd() {
  return '# Tasks\n\n## Active\n\n## Completed\n';
}

function defaultRemindersMd() {
  return '# Reminders\n\n| Due | Reminder | Context | Status |\n|-----|----------|---------|--------|\n';
}

function defaultMemoryMd() {
  return '# Assistant Memory\n\nLearned preferences and durable context go here.\n';
}

const DEFAULT_TEMPLATES = {
  meeting: '# {{title}}\n\n- **Date**:\n- **Attendees**:\n- **Type**:\n\n## Agenda\n\n## Discussion\n\n## Decisions\n\n## Action Items\n',
  decision: '# {{title}}\n\n- **Status**: proposed\n\n## Context\n\n## Options\n\n## Decision\n\n## Consequences\n',
  idea: '# {{title}}\n\n- **Tags**:\n- **Status**: raw\n\n## The Idea\n\n## Why It Matters\n\n## Next Steps\n',
  scratch: '# {{title}}\n\n- **Tags**:\n\n## Content\n',
};

function ensureWorkspaceSkeleton(sp) {
  const created = [];
  const alreadyExisted = [];
  const dirs = [
    sp.root, sp.notesDir, sp.templatesDir, sp.archiveDir,
    ...NOTE_TYPES.map((t) => join(sp.notesDir, NOTE_TYPE_DIRS[t])),
  ];
  for (const d of dirs) {
    if (!existsSync(d)) { mkdirSync(d, { recursive: true }); created.push(d); }
  }
  const files = [
    [sp.memoryFile, defaultMemoryMd()],
    [sp.tasksFile, defaultTasksMd()],
    [sp.remindersFile, defaultRemindersMd()],
    ...NOTE_TYPES.map((t) => [join(sp.templatesDir, `${t}.md`), DEFAULT_TEMPLATES[t]]),
  ];
  for (const [path, content] of files) {
    if (!existsSync(path)) { atomicWriteFile(path, content); created.push(path); }
    else alreadyExisted.push(path);
  }
  return { created, alreadyExisted };
}

// ── Structural validation ────────────────────────────────────────────────

function validateTasksMd(content) {
  if (!/^#\s+Tasks\b/m.test(content)) {
    throw new StoreError('STRUCTURE_INVALID', 'tasks.md is missing its "# Tasks" heading — refusing to mutate a file that does not look like a task store.');
  }
  if (!/^##\s+Active\b/m.test(content)) {
    throw new StoreError('STRUCTURE_INVALID', 'tasks.md is missing its "## Active" section — refusing to mutate a file that does not look like a task store.');
  }
}

function validateRemindersMd(content) {
  if (!/^#\s+Reminders\b/m.test(content)) {
    throw new StoreError('STRUCTURE_INVALID', 'reminders.md is missing its "# Reminders" heading — refusing to mutate a file that does not look like a reminder store.');
  }
  if (!/\|\s*Due\s*\|\s*Reminder\s*\|\s*Context\s*\|\s*Status\s*\|/i.test(content)) {
    throw new StoreError('STRUCTURE_INVALID', 'reminders.md is missing its "| Due | Reminder | Context | Status |" table header — refusing to mutate a file that does not look like a reminder store.');
  }
}

// ── tasks.md model ───────────────────────────────────────────────────────

function locateSection(lines, headingText) {
  const idx = lines.findIndex((l) => l.trim() === headingText);
  if (idx === -1) return null;
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return { headingIdx: idx, contentStart: idx + 1, contentEnd: end };
}

function sectionTaskLines(lines, loc) {
  return lines.slice(loc.contentStart, loc.contentEnd)
    .map((l, i) => ({ line: l, idx: loc.contentStart + i }))
    .filter((e) => /^-\s\[[ x]\]/.test(e.line));
}

/** Replace a section's content span with a normalized "blank, items, blank" body. */
function rewriteSection(lines, headingText, newTaskLines) {
  const loc = locateSection(lines, headingText);
  if (!loc) throw new StoreError('STRUCTURE_INVALID', `tasks.md is missing its "${headingText}" section.`);
  const before = lines.slice(0, loc.headingIdx + 1);
  const after = lines.slice(loc.contentEnd);
  const body = newTaskLines.length ? ['', ...newTaskLines, ''] : [''];
  return [...before, ...body, ...after];
}

const TASK_LINE_RE = /^-\s\[([ x])\]\s\*\*\(P([1-3])\)\*\*\s(.*)$/;

function parseTaskLine(line) {
  const m = TASK_LINE_RE.exec(line);
  if (!m) return null;
  const [, checkedFlag, priority, restRaw] = m;
  let rest = restRaw;
  let completedOn = null;
  const completedMatch = rest.match(/\s—\scompleted\s(\S+)$/);
  if (completedMatch) { completedOn = completedMatch[1]; rest = rest.slice(0, completedMatch.index); }
  let source = null;
  const sourceMatch = rest.match(/\s←\s(.+)$/);
  if (sourceMatch) { source = sourceMatch[1]; rest = rest.slice(0, sourceMatch.index); }
  let project = null;
  const projectMatch = rest.match(/\s(\+[^\s]+)$/);
  if (projectMatch) { project = projectMatch[1]; rest = rest.slice(0, projectMatch.index); }
  let context = null;
  const contextMatch = rest.match(/\s(@[^\s]+)$/);
  if (contextMatch) { context = contextMatch[1]; rest = rest.slice(0, contextMatch.index); }
  let due = null;
  const dueMatch = rest.match(/\s—\sdue\s(\S+)$/);
  if (dueMatch) { due = dueMatch[1]; rest = rest.slice(0, dueMatch.index); }
  return { checked: checkedFlag === 'x', priority: Number(priority), title: rest.trim(), due, context, project, source, completedOn };
}

function buildTaskLine({ checked, priority, title, due, context, project, source, completedOn }) {
  let line = `- [${checked ? 'x' : ' '}] **(P${priority})** ${title}`;
  if (due) line += ` — due ${due}`;
  if (context) line += ` ${context}`;
  if (project) line += ` ${project}`;
  if (source) line += ` ← ${source}`;
  if (completedOn) line += ` — completed ${completedOn}`;
  return line;
}

/**
 * Validate a task priority: only the integers 1, 2, or 3 (optionally spelled `P1`/`p2`/`3`,
 * as a string or a number) are accepted. Returns `undefined` when `value` is `undefined`/
 * `null`/`''` (meaning "not specified" — caller applies its own default or keeps the
 * existing value); throws `VALIDATION_ERROR` for anything else out of range or non-numeric
 * (e.g. `P0`, `P4`, `4`, `"urgent"`) so a caller never silently writes a `**(PNaN)**` or
 * out-of-range priority into the store.
 */
function normalizePriority(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = typeof value === 'string' ? value.trim().replace(/^p/i, '') : value;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (raw === '' || !Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 3) {
    throw new StoreError('VALIDATION_ERROR', `priority must be P1, P2, or P3 (1-3) — got ${JSON.stringify(value)}.`);
  }
  return n;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function findMatches(entries, keyword) {
  const needle = keyword.toLowerCase();
  return entries.filter((e) => e.parsed && e.parsed.title.toLowerCase().includes(needle));
}

function requireSingleMatch(entries, keyword, whatFor) {
  const matches = findMatches(entries, keyword);
  if (matches.length === 0) {
    throw new StoreError('NOT_FOUND', `No ${whatFor} matching "${keyword}" was found.`, { keyword });
  }
  if (matches.length > 1) {
    throw new StoreError('AMBIGUOUS_MATCH', `${matches.length} ${whatFor} match "${keyword}" — be more specific.`, {
      keyword,
      candidates: matches.map((m) => ({ text: m.line.trim() })),
    });
  }
  return matches[0];
}

function readTasksLines(sp) {
  if (!existsSync(sp.tasksFile)) {
    return defaultTasksMd().split('\n');
  }
  const content = readFileSync(sp.tasksFile, 'utf8');
  validateTasksMd(content);
  return content.split('\n');
}

function writeTasksLines(sp, lines) {
  atomicWriteFile(sp.tasksFile, lines.join('\n'));
}

function taskAdd(sp, opts) {
  const priority = normalizePriority(opts.priority) ?? 3;
  const lines = readTasksLines(sp);
  const loc = locateSection(lines, '## Active');
  if (!loc) throw new StoreError('STRUCTURE_INVALID', 'tasks.md is missing its "## Active" section.');
  const existing = sectionTaskLines(lines, loc).map((e) => e.line);
  const newLine = buildTaskLine({
    checked: false,
    priority,
    title: opts.title,
    due: opts.due ?? null,
    context: opts.context ?? null,
    project: opts.project ?? null,
    source: opts.source ?? null,
  });
  const updated = rewriteSection(lines, '## Active', [...existing, newLine]);
  writeTasksLines(sp, updated);
  return { path: sp.tasksFile, task: parseTaskLine(newLine), line: newLine };
}

function loadTaskEntries(lines, loc) {
  return sectionTaskLines(lines, loc).map((e) => ({ ...e, parsed: parseTaskLine(e.line) }));
}

function taskUpdate(sp, opts) {
  const priorityOverride = normalizePriority(opts.priority);
  const lines = readTasksLines(sp);
  const loc = locateSection(lines, '## Active');
  if (!loc) throw new StoreError('STRUCTURE_INVALID', 'tasks.md is missing its "## Active" section.');
  const entries = loadTaskEntries(lines, loc);
  const match = requireSingleMatch(entries, opts.match, 'active tasks');
  const merged = {
    ...match.parsed,
    title: opts.title ?? match.parsed.title,
    priority: priorityOverride ?? match.parsed.priority,
    due: opts.due !== undefined ? opts.due : match.parsed.due,
    context: opts.context !== undefined ? opts.context : match.parsed.context,
    project: opts.project !== undefined ? opts.project : match.parsed.project,
    source: opts.source !== undefined ? opts.source : match.parsed.source,
  };
  const newLine = buildTaskLine(merged);
  const newLines = lines.slice();
  newLines[match.idx] = newLine;
  writeTasksLines(sp, newLines);
  return { path: sp.tasksFile, task: parseTaskLine(newLine), line: newLine };
}

function taskComplete(sp, opts) {
  const lines = readTasksLines(sp);
  const activeLoc = locateSection(lines, '## Active');
  if (!activeLoc) throw new StoreError('STRUCTURE_INVALID', 'tasks.md is missing its "## Active" section.');
  const entries = loadTaskEntries(lines, activeLoc);
  const match = requireSingleMatch(entries, opts.match, 'active tasks');
  const completedLine = buildTaskLine({ ...match.parsed, checked: true, completedOn: todayUtc() });
  const remainingActive = sectionTaskLines(lines, activeLoc).map((e) => e.line).filter((l) => l !== match.line);
  let updated = rewriteSection(lines, '## Active', remainingActive);
  const completedLoc = locateSection(updated, '## Completed');
  if (!completedLoc) throw new StoreError('STRUCTURE_INVALID', 'tasks.md is missing its "## Completed" section.');
  const completedExisting = sectionTaskLines(updated, completedLoc).map((e) => e.line);
  updated = rewriteSection(updated, '## Completed', [...completedExisting, completedLine]);
  writeTasksLines(sp, updated);
  return { path: sp.tasksFile, task: parseTaskLine(completedLine), line: completedLine };
}

function taskReopen(sp, opts) {
  const lines = readTasksLines(sp);
  const completedLoc = locateSection(lines, '## Completed');
  if (!completedLoc) throw new StoreError('STRUCTURE_INVALID', 'tasks.md is missing its "## Completed" section.');
  const entries = loadTaskEntries(lines, completedLoc);
  const match = requireSingleMatch(entries, opts.match, 'completed tasks');
  const reopenedLine = buildTaskLine({ ...match.parsed, checked: false, completedOn: null });
  const remainingCompleted = sectionTaskLines(lines, completedLoc).map((e) => e.line).filter((l) => l !== match.line);
  let updated = rewriteSection(lines, '## Completed', remainingCompleted);
  const activeLoc = locateSection(updated, '## Active');
  if (!activeLoc) throw new StoreError('STRUCTURE_INVALID', 'tasks.md is missing its "## Active" section.');
  const activeExisting = sectionTaskLines(updated, activeLoc).map((e) => e.line);
  updated = rewriteSection(updated, '## Active', [...activeExisting, reopenedLine]);
  writeTasksLines(sp, updated);
  return { path: sp.tasksFile, task: parseTaskLine(reopenedLine), line: reopenedLine };
}

/** Batch-import action items in one lock-held, single-commit pass. */
function taskImportBatch(sp, items) {
  const lines = readTasksLines(sp);
  const loc = locateSection(lines, '## Active');
  if (!loc) throw new StoreError('STRUCTURE_INVALID', 'tasks.md is missing its "## Active" section.');
  const existing = sectionTaskLines(lines, loc).map((e) => e.line);
  const existingTitles = new Set(existing.map((l) => parseTaskLine(l)?.title?.toLowerCase()).filter(Boolean));
  const results = [];
  const toAppend = [];
  for (const item of items) {
    if (!item || typeof item.title !== 'string' || !item.title.trim()) {
      results.push({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'item is missing a non-empty "title"' }, item });
      continue;
    }
    const key = item.title.trim().toLowerCase();
    if (existingTitles.has(key)) {
      results.push({ ok: false, duplicate: true, error: { code: 'DUPLICATE', message: `An active task titled "${item.title}" already exists — skipped.` }, item });
      continue;
    }
    let priority;
    try {
      priority = normalizePriority(item.priority) ?? 3;
    } catch (e) {
      results.push({ ok: false, error: { code: e instanceof StoreError ? e.code : 'VALIDATION_ERROR', message: e.message }, item });
      continue;
    }
    const newLine = buildTaskLine({
      checked: false,
      priority,
      title: item.title.trim(),
      due: item.due ?? null,
      context: item.context ?? null,
      project: item.project ?? null,
      source: item.source ?? null,
    });
    toAppend.push(newLine);
    existingTitles.add(key); // guard against duplicates within the same batch
    results.push({ ok: true, line: newLine, item });
  }
  if (toAppend.length > 0) {
    const updated = rewriteSection(lines, '## Active', [...existing, ...toAppend]);
    writeTasksLines(sp, updated);
  }
  return { path: sp.tasksFile, added: results.filter((r) => r.ok).length, results };
}

// ── reminders.md model ───────────────────────────────────────────────────

function readRemindersLines(sp) {
  if (!existsSync(sp.remindersFile)) {
    return defaultRemindersMd().split('\n');
  }
  const content = readFileSync(sp.remindersFile, 'utf8');
  validateRemindersMd(content);
  return content.split('\n');
}

function writeRemindersLines(sp, lines) {
  atomicWriteFile(sp.remindersFile, lines.join('\n'));
}

function locateReminderTable(lines) {
  const headerIdx = lines.findIndex((l) => /\|\s*Due\s*\|\s*Reminder\s*\|\s*Context\s*\|\s*Status\s*\|/i.test(l));
  if (headerIdx === -1) return null;
  const sepIdx = headerIdx + 1;
  if (!/^\|[\s:-]+\|/.test(lines[sepIdx] ?? '')) return null;
  let end = sepIdx + 1;
  while (end < lines.length && /^\|.*\|\s*$/.test(lines[end])) end += 1;
  return { headerIdx, sepIdx, rowsStart: sepIdx + 1, rowsEnd: end };
}

/**
 * Escape a value for embedding as one Markdown table cell on a single line:
 * backslash first (so we don't double-escape backslashes we introduce next),
 * then real newlines/CRLF to a literal `\n` (a table row must stay one
 * physical line), then `|` (would otherwise be read as a column delimiter).
 * Paired with `unescapeCell` / `splitTableRowCells` for a safe round-trip.
 */
function escapeCell(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/\|/g, '\\|');
}

/** Reverse of `escapeCell`. Scans left-to-right so escape pairs (`\\`, `\|`, `\n`) are
 *  resolved unambiguously regardless of how many appear or in what order. */
function unescapeCell(value) {
  if (value === null || value === undefined) return '';
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c === '\\' && i + 1 < value.length && '\\|n'.includes(value[i + 1])) {
      const next = value[i + 1];
      out += next === 'n' ? '\n' : next;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Split a table row into raw (still-escaped) cells on UNESCAPED `|` only — a `|`
 * preceded by an even number of consecutive backslashes (including zero) is a real
 * delimiter; an odd number means it was escaped by `escapeCell` and belongs to the
 * cell's content. This is what makes a literal `|` inside reminder text/context safe.
 */
function splitTableRowCells(line) {
  const cells = [];
  let current = '';
  let backslashRun = 0;
  for (const c of line) {
    if (c === '\\') {
      current += c;
      backslashRun += 1;
      continue;
    }
    if (c === '|' && backslashRun % 2 === 0) {
      cells.push(current);
      current = '';
      backslashRun = 0;
      continue;
    }
    current += c;
    backslashRun = 0;
  }
  cells.push(current);
  return cells;
}

function parseReminderRow(line) {
  const raw = splitTableRowCells(line).slice(1, -1).map((c) => unescapeCell(c.trim()));
  if (raw.length < 4) return null;
  const [due, reminder, context, status] = raw;
  return { due, reminder, context, status };
}

function buildReminderRow({ due, reminder, context, status }) {
  return `| ${escapeCell(due)} | ${escapeCell(reminder)} | ${escapeCell(context || '')} | ${escapeCell(status)} |`;
}

function reminderSet(sp, opts) {
  const lines = readRemindersLines(sp);
  const table = locateReminderTable(lines);
  if (!table) throw new StoreError('STRUCTURE_INVALID', 'reminders.md is missing its table header/separator.');
  const status = /^every\b/i.test(opts.due) || /first of month/i.test(opts.due) ? 'recurring' : 'pending';
  const newRow = buildReminderRow({ due: opts.due, reminder: opts.text, context: opts.context ?? '', status });
  const before = lines.slice(0, table.rowsEnd);
  const after = lines.slice(table.rowsEnd);
  const updated = [...before, newRow, ...after];
  writeRemindersLines(sp, updated);
  return { path: sp.remindersFile, reminder: parseReminderRow(newRow), row: newRow };
}

function reminderDismiss(sp, opts) {
  const lines = readRemindersLines(sp);
  const table = locateReminderTable(lines);
  if (!table) throw new StoreError('STRUCTURE_INVALID', 'reminders.md is missing its table header/separator.');
  const rowEntries = lines.slice(table.rowsStart, table.rowsEnd).map((line, i) => ({ line, idx: table.rowsStart + i, parsed: parseReminderRow(line) }));
  const candidates = rowEntries.filter((e) => e.parsed && e.parsed.status.toLowerCase() !== 'dismissed'
    && e.parsed.reminder.toLowerCase().includes(opts.match.toLowerCase()));
  if (candidates.length === 0) {
    throw new StoreError('NOT_FOUND', `No active reminder matching "${opts.match}" was found.`, { keyword: opts.match });
  }
  if (candidates.length > 1) {
    throw new StoreError('AMBIGUOUS_MATCH', `${candidates.length} reminders match "${opts.match}" — be more specific.`, {
      keyword: opts.match,
      candidates: candidates.map((c) => ({ text: c.line.trim() })),
    });
  }
  const target = candidates[0];
  const newRow = buildReminderRow({ ...target.parsed, status: 'dismissed' });
  const newLines = lines.slice();
  newLines[target.idx] = newRow;
  writeRemindersLines(sp, newLines);
  return { path: sp.remindersFile, reminder: parseReminderRow(newRow), row: newRow };
}

// ── notes ────────────────────────────────────────────────────────────────

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '') || 'untitled';
}

function createNote(sp, opts) {
  if (!NOTE_TYPES.includes(opts.type)) {
    throw new StoreError('VALIDATION_ERROR', `--type must be one of: ${NOTE_TYPES.join(', ')}`);
  }
  const date = opts.date ?? todayUtc();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new StoreError('VALIDATION_ERROR', '--date must be in YYYY-MM-DD form');
  }
  if (!opts.title || !opts.title.trim()) {
    throw new StoreError('VALIDATION_ERROR', '--title is required');
  }
  const dir = join(sp.notesDir, NOTE_TYPE_DIRS[opts.type]);
  const baseName = `${date}-${slugify(opts.title)}`;
  const path = createExclusiveWithSuffix(dir, baseName, '.md', opts.content ?? '');
  return { path, type: opts.type, title: opts.title, date };
}

// ── command dispatch ─────────────────────────────────────────────────────

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function envelope(op, opId, ok, { changedPaths = [], result = null, error = null } = {}) {
  return { ok, op, opId, changedPaths, result, error };
}

function run(argv) {
  const opId = randomUUID();

  // Manually pull an optional leading/anywhere "--store <dir>" out of argv
  // BEFORE any parseArgs pass, since util.parseArgs only knows how to consume
  // a flag's value when that flag is declared for that specific parseArgs
  // call — and each subcommand below declares its own option set. Once
  // "--store" is removed, argv[0] is always the command and (for "task" /
  // "reminder") argv[1] is the action; everything after that is passed to a
  // per-command parseArgs call that declares exactly the flags it accepts.
  let storeOverride;
  const argsNoStore = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--store') { storeOverride = argv[i + 1]; i += 1; continue; }
    argsNoStore.push(argv[i]);
  }
  const storeDir = resolveStoreDir(storeOverride);
  const sp = storePaths(storeDir);
  const [cmd, sub, ...rest] = argsNoStore;

  if (!cmd || cmd === '--help' || cmd === 'help') {
    return envelope('help', opId, true, { result: { usage: 'assistant-store <init|create-note|task|reminder|import> ...  (see file header for full usage)' } });
  }

  if (cmd === 'init') {
    return withLock(storeDir, opId, () => {
      const result = ensureWorkspaceSkeleton(sp);
      return envelope('init', opId, true, { changedPaths: result.created, result });
    });
  }

  if (cmd === 'create-note') {
    const { values } = parseArgs({
      args: [sub, ...rest].filter((v) => v !== undefined),
      options: {
        type: { type: 'string' }, title: { type: 'string' }, date: { type: 'string' },
        'content-file': { type: 'string' },
      },
      allowPositionals: false,
      strict: false,
    });
    const content = values['content-file'] ? readFileSync(values['content-file'], 'utf8') : readStdin();
    return withLock(storeDir, opId, () => {
      ensureWorkspaceSkeleton(sp); // lazy-init, idempotent
      const result = createNote(sp, { type: values.type, title: values.title, date: values.date, content });
      return envelope('create-note', opId, true, { changedPaths: [result.path], result });
    });
  }

  if (cmd === 'task') {
    const action = sub;
    const { values } = parseArgs({
      args: rest,
      options: {
        title: { type: 'string' }, priority: { type: 'string' }, due: { type: 'string' },
        context: { type: 'string' }, project: { type: 'string' }, source: { type: 'string' },
        match: { type: 'string' },
      },
      allowPositionals: false,
      strict: false,
    });
    const opts = {
      title: values.title, priority: values.priority, // raw; normalizePriority() validates inside taskAdd/taskUpdate
      due: values.due, context: values.context, project: values.project, source: values.source, match: values.match,
    };
    return withLock(storeDir, opId, () => {
      ensureWorkspaceSkeleton(sp);
      if (action === 'add') {
        if (!opts.title) throw new StoreError('VALIDATION_ERROR', '--title is required for "task add"');
        const result = taskAdd(sp, opts);
        return envelope('task.add', opId, true, { changedPaths: [result.path], result });
      }
      if (action === 'update') {
        if (!opts.match) throw new StoreError('VALIDATION_ERROR', '--match is required for "task update"');
        const result = taskUpdate(sp, opts);
        return envelope('task.update', opId, true, { changedPaths: [result.path], result });
      }
      if (action === 'complete') {
        if (!opts.match) throw new StoreError('VALIDATION_ERROR', '--match is required for "task complete"');
        const result = taskComplete(sp, opts);
        return envelope('task.complete', opId, true, { changedPaths: [result.path], result });
      }
      if (action === 'reopen') {
        if (!opts.match) throw new StoreError('VALIDATION_ERROR', '--match is required for "task reopen"');
        const result = taskReopen(sp, opts);
        return envelope('task.reopen', opId, true, { changedPaths: [result.path], result });
      }
      if (action === 'import') {
        const items = JSON.parse(readStdin() || '[]');
        if (!Array.isArray(items)) throw new StoreError('VALIDATION_ERROR', 'stdin must be a JSON array of task items');
        const result = taskImportBatch(sp, items);
        return envelope('task.import', opId, true, { changedPaths: result.added > 0 ? [result.path] : [], result });
      }
      throw new StoreError('USAGE', `Unknown "task" action: ${action}. Expected add|update|complete|reopen|import.`);
    });
  }

  if (cmd === 'reminder') {
    const action = sub;
    const { values } = parseArgs({
      args: rest,
      options: {
        text: { type: 'string' }, due: { type: 'string' }, context: { type: 'string' }, match: { type: 'string' },
      },
      allowPositionals: false,
      strict: false,
    });
    return withLock(storeDir, opId, () => {
      ensureWorkspaceSkeleton(sp);
      if (action === 'set') {
        if (!values.text) throw new StoreError('VALIDATION_ERROR', '--text is required for "reminder set"');
        if (!values.due) throw new StoreError('VALIDATION_ERROR', '--due is required for "reminder set"');
        const result = reminderSet(sp, values);
        return envelope('reminder.set', opId, true, { changedPaths: [result.path], result });
      }
      if (action === 'dismiss') {
        if (!values.match) throw new StoreError('VALIDATION_ERROR', '--match is required for "reminder dismiss"');
        const result = reminderDismiss(sp, values);
        return envelope('reminder.dismiss', opId, true, { changedPaths: [result.path], result });
      }
      throw new StoreError('USAGE', `Unknown "reminder" action: ${action}. Expected set|dismiss.`);
    });
  }

  // Alias: a top-level "import" command is the same as "task import" (batch
  // action-item import from meeting notes into the local task store).
  if (cmd === 'import') {
    return withLock(storeDir, opId, () => {
      ensureWorkspaceSkeleton(sp);
      const items = JSON.parse(readStdin() || '[]');
      if (!Array.isArray(items)) throw new StoreError('VALIDATION_ERROR', 'stdin must be a JSON array of task items');
      const result = taskImportBatch(sp, items);
      return envelope('task.import', opId, true, { changedPaths: result.added > 0 ? [result.path] : [], result });
    });
  }

  throw new StoreError('USAGE', `Unknown command: ${cmd}. Expected init|create-note|task|reminder|import.`);
}

function main() {
  const argv = process.argv.slice(2);
  const opId = randomUUID();
  try {
    const out = run(argv);
    process.stdout.write(`${JSON.stringify(out)}\n`);
    process.exit(out.ok ? 0 : (EXIT_BY_CODE[out.error?.code] ?? 4));
  } catch (e) {
    const code = e instanceof StoreError ? e.code : 'INTERNAL';
    const message = e instanceof StoreError ? e.message : (e?.message ?? String(e));
    const extra = e instanceof StoreError ? { ...e } : {};
    delete extra.code;
    delete extra.message;
    const out = envelope('unknown', opId, false, { error: { code, message, ...extra } });
    process.stdout.write(`${JSON.stringify(out)}\n`);
    process.exit(EXIT_BY_CODE[code] ?? 4);
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();

export {
  StoreError, resolveStoreDir, storePaths, acquireLock, withLock, atomicWriteFile,
  createExclusiveWithSuffix, ensureWorkspaceSkeleton, validateTasksMd, validateRemindersMd,
  parseTaskLine, buildTaskLine, normalizePriority, taskAdd, taskUpdate, taskComplete, taskReopen,
  taskImportBatch, reminderSet, reminderDismiss, parseReminderRow, buildReminderRow, escapeCell,
  unescapeCell, splitTableRowCells, createNote, run, slugify, cleanupStaleTempFiles, isPidAlive,
  isLockAgeStale,
};
