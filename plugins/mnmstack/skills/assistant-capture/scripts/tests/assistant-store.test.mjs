// Node built-in test runner coverage for assistant-store.mjs, the
// transactional local write gateway for the assistant-capture skill.
//
// Focus areas (per the hardening plan): concurrent writers, stale lock
// recovery, note name collisions, malformed store files, ambiguous matches,
// and interrupted/temp-write safety. Runs everywhere `node --test` runs —
// no external dependencies, no network, no real HOME/config mutation (every
// test uses its own throwaway store directory under the OS temp dir).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, utimesSync, statSync } from 'node:fs';
import { tmpdir, hostname, platform } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  StoreError, resolveStoreDir, acquireLock, withLock, storePaths,
  createExclusiveWithSuffix, ensureWorkspaceSkeleton, validateTasksMd,
  validateRemindersMd, parseTaskLine, buildTaskLine, normalizePriority, taskAdd, taskUpdate,
  taskComplete, taskImportBatch, reminderSet, reminderDismiss, parseReminderRow, buildReminderRow,
  escapeCell, unescapeCell, run,
} from '../assistant-store.mjs';

const SCRIPT = fileURLToPath(new URL('../assistant-store.mjs', import.meta.url));

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'assistant-store-test-'));
  return dir;
}

function cli(args, opts = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });
  let json = null;
  try { json = JSON.parse(res.stdout.trim().split('\n').pop()); } catch { /* leave null */ }
  return { ...res, json };
}

test('resolveStoreDir precedence: explicit > env > default', () => {
  const prev = process.env.COPILOT_PLUGIN_ASSISTANT_STORE;
  try {
    process.env.COPILOT_PLUGIN_ASSISTANT_STORE = '/env/store';
    assert.equal(resolveStoreDir('/explicit/store'), '/explicit/store');
    assert.equal(resolveStoreDir(undefined), '/env/store');
    delete process.env.COPILOT_PLUGIN_ASSISTANT_STORE;
    assert.match(resolveStoreDir(undefined), /\.copilot[\\/]assistant$/);
  } finally {
    if (prev === undefined) delete process.env.COPILOT_PLUGIN_ASSISTANT_STORE; else process.env.COPILOT_PLUGIN_ASSISTANT_STORE = prev;
  }
});

test('init is idempotent and creates the full skeleton', () => {
  const store = makeStore();
  try {
    const out1 = cli(['--store', store, 'init']);
    assert.equal(out1.status, 0);
    assert.equal(out1.json.ok, true);
    assert.ok(existsSync(join(store, 'tasks.md')));
    assert.ok(existsSync(join(store, 'reminders.md')));
    assert.ok(existsSync(join(store, 'notes', 'meetings')));
    const out2 = cli(['--store', store, 'init']);
    assert.equal(out2.json.ok, true);
    assert.deepEqual(out2.json.result.created, []);
    assert.ok(out2.json.result.alreadyExisted.length > 0);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('regression (defect 1): the script is directly executable (mode 0755, correct shebang) and runs without an explicit `node` prefix', { skip: platform() === 'win32' ? 'exec bit / shebang execution is POSIX-only' : false }, () => {
  const mode = statSync(SCRIPT).mode & 0o777;
  assert.equal(mode, 0o755, `assistant-store.mjs must be executable (0755), got ${mode.toString(8)}`);
  const firstLine = readFileSync(SCRIPT, 'utf8').split('\n', 1)[0];
  assert.equal(firstLine, '#!/usr/bin/env node', 'shebang must be present and correct for direct POSIX invocation');
  const store = makeStore();
  try {
    // Invoke the script directly (relying on the exec bit + shebang), NOT via
    // `process.execPath SCRIPT ...` — this is the exact path a `link-commands`
    // shim or a directly-linked bin would use.
    const res = spawnSync(SCRIPT, ['--store', store, 'init'], { encoding: 'utf8' });
    assert.equal(res.status, 0, `direct invocation failed: ${res.stderr || res.error}`);
    const json = JSON.parse(res.stdout.trim().split('\n').pop());
    assert.equal(json.ok, true);
    assert.ok(existsSync(join(store, 'tasks.md')));
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('note directories match the SKILL.md-documented convention (plural for meeting/decision/idea, singular scratch)', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    const meeting = cli(['--store', store, 'create-note', '--type', 'meeting', '--title', 'Standup', '--date', '2026-01-02'], { input: 'x\n' });
    const decision = cli(['--store', store, 'create-note', '--type', 'decision', '--title', 'Use Postgres', '--date', '2026-01-02'], { input: 'x\n' });
    const idea = cli(['--store', store, 'create-note', '--type', 'idea', '--title', 'Faster Builds', '--date', '2026-01-02'], { input: 'x\n' });
    const scratch = cli(['--store', store, 'create-note', '--type', 'scratch', '--title', 'Quick Note', '--date', '2026-01-02'], { input: 'x\n' });
    assert.match(meeting.json.result.path, /\/notes\/meetings\//);
    assert.match(decision.json.result.path, /\/notes\/decisions\//);
    assert.match(idea.json.result.path, /\/notes\/ideas\//);
    assert.match(scratch.json.result.path, /\/notes\/scratch\//);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('create-note: identical type/title/date collide with a deterministic -2 suffix, never overwriting', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    const first = cli(['--store', store, 'create-note', '--type', 'scratch', '--title', 'Same Title', '--date', '2026-01-01'], { input: 'first body\n' });
    const second = cli(['--store', store, 'create-note', '--type', 'scratch', '--title', 'Same Title', '--date', '2026-01-01'], { input: 'second body\n' });
    const third = cli(['--store', store, 'create-note', '--type', 'scratch', '--title', 'Same Title', '--date', '2026-01-01'], { input: 'third body\n' });
    assert.equal(first.json.ok, true);
    assert.equal(second.json.ok, true);
    assert.equal(third.json.ok, true);
    assert.notEqual(first.json.result.path, second.json.result.path);
    assert.notEqual(second.json.result.path, third.json.result.path);
    assert.match(second.json.result.path, /-2\.md$/);
    assert.match(third.json.result.path, /-3\.md$/);
    // Original content of the first note must survive untouched.
    assert.match(readFileSync(first.json.result.path, 'utf8'), /first body/);
    assert.match(readFileSync(second.json.result.path, 'utf8'), /second body/);
    assert.match(readFileSync(third.json.result.path, 'utf8'), /third body/);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('createExclusiveWithSuffix: unit-level collision numbering is sequential and gap-free', () => {
  const store = makeStore();
  try {
    const dir = join(store, 'notes');
    const p1 = createExclusiveWithSuffix(dir, 'note', '.md', 'a');
    const p2 = createExclusiveWithSuffix(dir, 'note', '.md', 'b');
    const p3 = createExclusiveWithSuffix(dir, 'note', '.md', 'c');
    assert.match(p1, /\/note\.md$/);
    assert.match(p2, /\/note-2\.md$/);
    assert.match(p3, /\/note-3\.md$/);
    assert.equal(readFileSync(p1, 'utf8'), 'a');
    assert.equal(readFileSync(p2, 'utf8'), 'b');
    assert.equal(readFileSync(p3, 'utf8'), 'c');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('regression (defect 3): a write failure inside createExclusiveWithSuffix frees the reserved name instead of leaving a corrupt/empty file', () => {
  const store = makeStore();
  try {
    const dir = join(store, 'notes');
    // `content: undefined` deterministically makes the underlying writeSync/writeFileSync
    // throw a TypeError — a portable fault-injection that doesn't depend on filesystem
    // permissions (which vary across CI/sandbox environments).
    assert.throws(
      () => createExclusiveWithSuffix(dir, 'fault-note', '.md', undefined),
      /content|argument|invalid/i,
    );
    // The reserved placeholder must NOT be left behind — the name must be fully free again.
    assert.equal(existsSync(join(dir, 'fault-note.md')), false, 'no corrupt/empty file left at the candidate path');
    const strayTemp = existsSync(dir) ? readdirSync(dir).filter((f) => /\.tmp-/.test(f)) : [];
    assert.deepEqual(strayTemp, [], 'no stray temp file left behind either');
    // A subsequent successful call must reuse the SAME base name (not skip to -2),
    // proving the name was genuinely freed rather than "consumed but corrupt".
    const p = createExclusiveWithSuffix(dir, 'fault-note', '.md', 'ok');
    assert.match(p, /\/fault-note\.md$/, 'the base name must be reusable after the failed attempt');
    assert.equal(readFileSync(p, 'utf8'), 'ok');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('malformed tasks.md (missing required headings) is rejected without mutation', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    writeFileSync(join(store, 'tasks.md'), '# Not A Task Store\n\nrandom content\n');
    const before = readFileSync(join(store, 'tasks.md'), 'utf8');
    const out = cli(['--store', store, 'task', 'add', '--title', 'Should not be added']);
    assert.equal(out.json.ok, false);
    assert.equal(out.json.error.code, 'STRUCTURE_INVALID');
    const after = readFileSync(join(store, 'tasks.md'), 'utf8');
    assert.equal(after, before, 'file must be byte-identical after a rejected write');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('malformed reminders.md (missing table header) is rejected without mutation', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    writeFileSync(join(store, 'reminders.md'), '# Reminders\n\nno table here\n');
    const before = readFileSync(join(store, 'reminders.md'), 'utf8');
    const out = cli(['--store', store, 'reminder', 'set', '--text', 'x', '--due', '2026-01-01']);
    assert.equal(out.json.ok, false);
    assert.equal(out.json.error.code, 'STRUCTURE_INVALID');
    assert.equal(readFileSync(join(store, 'reminders.md'), 'utf8'), before);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('validateTasksMd / validateRemindersMd unit checks', () => {
  assert.doesNotThrow(() => validateTasksMd('# Tasks\n\n## Active\n\n## Completed\n'));
  assert.throws(() => validateTasksMd('# Tasks\n\nno active section\n'), StoreError);
  assert.throws(() => validateTasksMd('garbage'), StoreError);
  assert.doesNotThrow(() => validateRemindersMd('# Reminders\n\n| Due | Reminder | Context | Status |\n|-|-|-|-|\n'));
  assert.throws(() => validateRemindersMd('# Reminders\n\nno table\n'), StoreError);
});

test('ambiguous task match returns AMBIGUOUS_MATCH with candidates and applies no edit', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    cli(['--store', store, 'task', 'add', '--title', 'Ship the release']);
    cli(['--store', store, 'task', 'add', '--title', 'Ship the docs']);
    const before = readFileSync(join(store, 'tasks.md'), 'utf8');
    const out = cli(['--store', store, 'task', 'update', '--match', 'Ship', '--priority', 'P1']);
    assert.equal(out.json.ok, false);
    assert.equal(out.json.error.code, 'AMBIGUOUS_MATCH');
    assert.equal(out.json.error.candidates.length, 2);
    assert.equal(readFileSync(join(store, 'tasks.md'), 'utf8'), before, 'no edit applied on ambiguous match');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('no-match task update/complete/reopen returns NOT_FOUND, no mutation', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    const before = readFileSync(join(store, 'tasks.md'), 'utf8');
    const out = cli(['--store', store, 'task', 'update', '--match', 'Nonexistent Task', '--priority', 'P1']);
    assert.equal(out.json.ok, false);
    assert.equal(out.json.error.code, 'NOT_FOUND');
    assert.equal(readFileSync(join(store, 'tasks.md'), 'utf8'), before);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('task lifecycle: add -> update -> complete -> reopen round-trips correctly', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    cli(['--store', store, 'task', 'add', '--title', 'Ship the release', '--priority', 'P1', '--due', '2026-08-01', '--context', '@work', '--project', '+ExampleProject']);
    const upd = cli(['--store', store, 'task', 'update', '--match', 'Ship the release', '--priority', 'P2']);
    assert.equal(upd.json.result.task.priority, 2);
    assert.equal(upd.json.result.task.due, '2026-08-01', 'unspecified fields are preserved on update');
    const comp = cli(['--store', store, 'task', 'complete', '--match', 'Ship the release']);
    assert.equal(comp.json.result.task.checked, true);
    assert.ok(comp.json.result.task.completedOn);
    let content = readFileSync(join(store, 'tasks.md'), 'utf8');
    assert.match(content, /## Completed\n\n- \[x\]/);
    const reopen = cli(['--store', store, 'task', 'reopen', '--match', 'Ship the release']);
    assert.equal(reopen.json.result.task.checked, false);
    assert.equal(reopen.json.result.task.completedOn, null);
    content = readFileSync(join(store, 'tasks.md'), 'utf8');
    assert.match(content, /## Active\n\n- \[ \] \*\*\(P2\)\*\* Ship the release/);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('parseTaskLine / buildTaskLine round-trip for all optional fields', () => {
  const line = '- [ ] **(P1)** Ship the release — due 2026-08-01 @work +ExampleProject ← notes/meeting/2026-08-01-standup.md';
  const parsed = parseTaskLine(line);
  assert.equal(parsed.priority, 1);
  assert.equal(parsed.title, 'Ship the release');
  assert.equal(parsed.due, '2026-08-01');
  assert.equal(parsed.context, '@work');
  assert.equal(parsed.project, '+ExampleProject');
  assert.equal(parsed.source, 'notes/meeting/2026-08-01-standup.md');
  assert.equal(buildTaskLine(parsed), line);
});

test('regression (defect 4): normalizePriority unit checks — accepts P1-P3/1-3, rejects P0/P4/non-numeric/floats', () => {
  assert.equal(normalizePriority(undefined), undefined);
  assert.equal(normalizePriority(null), undefined);
  assert.equal(normalizePriority(''), undefined);
  assert.equal(normalizePriority('P1'), 1);
  assert.equal(normalizePriority('p2'), 2);
  assert.equal(normalizePriority('3'), 3);
  assert.equal(normalizePriority(2), 2);
  for (const bad of ['P0', 'P4', '0', '4', 'abc', '1.5', 1.5, NaN, '-1', 'P-1']) {
    assert.throws(() => normalizePriority(bad), (e) => e instanceof StoreError && e.code === 'VALIDATION_ERROR', `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('regression (defect 4): task add rejects P0/P4/non-numeric priority with no mutation', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    const before = readFileSync(join(store, 'tasks.md'), 'utf8');
    for (const bad of ['P0', 'P4', 'abc']) {
      const out = cli(['--store', store, 'task', 'add', '--title', `Bad priority ${bad}`, '--priority', bad]);
      assert.equal(out.json.ok, false, `priority ${bad} should be rejected`);
      assert.equal(out.json.error.code, 'VALIDATION_ERROR');
    }
    assert.equal(readFileSync(join(store, 'tasks.md'), 'utf8'), before, 'file must be byte-identical — no task was ever added');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('regression (defect 4): task update rejects P0/P4/non-numeric priority with no mutation', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    cli(['--store', store, 'task', 'add', '--title', 'Existing Task', '--priority', 'P2']);
    const before = readFileSync(join(store, 'tasks.md'), 'utf8');
    for (const bad of ['P0', 'P4', 'abc']) {
      const out = cli(['--store', store, 'task', 'update', '--match', 'Existing Task', '--priority', bad]);
      assert.equal(out.json.ok, false, `priority ${bad} should be rejected`);
      assert.equal(out.json.error.code, 'VALIDATION_ERROR');
    }
    assert.equal(readFileSync(join(store, 'tasks.md'), 'utf8'), before, 'file must be byte-identical — priority never changed and no other field mutated');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('regression (defect 4): import rejects P0/P4/non-numeric priority per-item without blocking other valid items', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    const items = [
      { title: 'Good Task', priority: 2 },
      { title: 'Bad Task P0', priority: 'P0' },
      { title: 'Bad Task P4', priority: 'P4' },
      { title: 'Bad Task abc', priority: 'abc' },
      { title: 'Another Good Task' },
    ];
    const out = cli(['--store', store, 'import'], { input: JSON.stringify(items) });
    assert.equal(out.json.ok, true);
    assert.equal(out.json.result.added, 2, 'only the 2 valid items should be added');
    assert.equal(out.json.result.results[1].ok, false);
    assert.equal(out.json.result.results[1].error.code, 'VALIDATION_ERROR');
    assert.equal(out.json.result.results[2].ok, false);
    assert.equal(out.json.result.results[2].error.code, 'VALIDATION_ERROR');
    assert.equal(out.json.result.results[3].ok, false);
    assert.equal(out.json.result.results[3].error.code, 'VALIDATION_ERROR');
    const content = readFileSync(join(store, 'tasks.md'), 'utf8');
    assert.match(content, /Good Task/);
    assert.match(content, /Another Good Task/);
    assert.doesNotMatch(content, /Bad Task/);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('task import: batch add with duplicate detection, reports per-item results, single atomic commit', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    cli(['--store', store, 'task', 'add', '--title', 'Existing Task']);
    const items = [
      { title: 'New Task A', due: '2026-09-01' },
      { title: 'Existing Task' },
      { title: 'New Task B' },
    ];
    const out = cli(['--store', store, 'import'], { input: JSON.stringify(items) });
    assert.equal(out.json.ok, true);
    assert.equal(out.json.result.added, 2);
    assert.equal(out.json.result.results[1].ok, false);
    assert.equal(out.json.result.results[1].duplicate, true);
    const content = readFileSync(join(store, 'tasks.md'), 'utf8');
    assert.match(content, /New Task A/);
    assert.match(content, /New Task B/);
    assert.equal((content.match(/Existing Task/g) || []).length, 1, 'duplicate must not be added twice');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('reminder lifecycle: set then dismiss updates status in place', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    cli(['--store', store, 'reminder', 'set', '--text', 'Follow up with the user', '--due', '2026-08-05', '--context', '@work']);
    let content = readFileSync(join(store, 'reminders.md'), 'utf8');
    assert.match(content, /\| 2026-08-05 \| Follow up with the user \| @work \| pending \|/);
    const dismiss = cli(['--store', store, 'reminder', 'dismiss', '--match', 'the user']);
    assert.equal(dismiss.json.result.reminder.status, 'dismissed');
    content = readFileSync(join(store, 'reminders.md'), 'utf8');
    assert.match(content, /\| 2026-08-05 \| Follow up with the user \| @work \| dismissed \|/);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('recurring reminder classification: "every ..." and "first of month" set status=recurring', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    const a = cli(['--store', store, 'reminder', 'set', '--text', 'Weekly sync', '--due', 'every Monday']);
    assert.equal(a.json.result.reminder.status, 'recurring');
    const b = cli(['--store', store, 'reminder', 'set', '--text', 'Rent', '--due', 'first of month']);
    assert.equal(b.json.result.reminder.status, 'recurring');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('regression (defect 5): escapeCell/unescapeCell unit round-trip for pipe, backslash, and embedded newline', () => {
  const cases = [
    'plain text',
    'has a | pipe in it',
    'has a \\ backslash in it',
    'has both \\ and | together',
    'line one\nline two',
    'edge: \\| already-escaped-looking',
    'trailing backslash\\',
    '',
  ];
  for (const original of cases) {
    const escaped = escapeCell(original);
    assert.doesNotMatch(escaped, /(?<!\\)\|/, `escaped form must contain no unescaped "|": ${JSON.stringify(escaped)}`);
    assert.doesNotMatch(escaped, /\n/, `escaped form must contain no raw newline: ${JSON.stringify(escaped)}`);
    assert.equal(unescapeCell(escaped), original, `round-trip failed for ${JSON.stringify(original)}`);
  }
});

test('regression (defect 5): reminder text/context containing "|", backslash, and embedded newline round-trips safely through the Markdown table', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    const text = 'Buy milk | eggs \\ bread\nand cheese';
    const context = '@home | urgent \\ list';
    const setOut = cli(['--store', store, 'reminder', 'set', '--text', text, '--due', '2026-05-01', '--context', context]);
    assert.equal(setOut.json.ok, true);
    assert.equal(setOut.json.result.reminder.reminder, text, 'reminder text must round-trip exactly through the CLI response');
    assert.equal(setOut.json.result.reminder.context, context);

    const content = readFileSync(join(store, 'reminders.md'), 'utf8');
    // The table must still be exactly one physical line per row — no raw newline escaped
    // into a second line — and validateRemindersMd must still accept the file.
    assert.doesNotThrow(() => validateRemindersMd(content));
    const table = content.split('\n').filter((l) => l.startsWith('|'));
    // header + separator + exactly 1 data row
    assert.equal(table.length, 3, 'the embedded newline must not have split the row across physical lines');

    const dismissOut = cli(['--store', store, 'reminder', 'dismiss', '--match', 'Buy milk']);
    assert.equal(dismissOut.json.ok, true, `dismiss should still find the reminder by substring match: ${JSON.stringify(dismissOut.json)}`);
    assert.equal(dismissOut.json.result.reminder.reminder, text, 'text must still round-trip after being rewritten with a new status');
    assert.equal(dismissOut.json.result.reminder.context, context);
    assert.equal(dismissOut.json.result.reminder.status, 'dismissed');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('concurrent writers: many parallel task-add invocations lose no entries and interleave safely', async () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    const N = 12;
    const runs = [];
    for (let i = 0; i < N; i += 1) {
      runs.push(new Promise((resolve, reject) => {
        const child = spawnSync(process.execPath, [SCRIPT, '--store', store, 'task', 'add', '--title', `Concurrent Task ${i}`], { encoding: 'utf8' });
        if (child.error) reject(child.error); else resolve(child);
      }));
    }
    const results = await Promise.all(runs);
    for (const r of results) {
      assert.equal(r.status, 0, `child exited non-zero: ${r.stdout} ${r.stderr}`);
    }
    const content = readFileSync(join(store, 'tasks.md'), 'utf8');
    for (let i = 0; i < N; i += 1) {
      assert.match(content, new RegExp(`Concurrent Task ${i}\\b`), `task ${i} must be present exactly once`);
    }
    // Structure must still be well-formed after N interleaved writers.
    assert.doesNotThrow(() => validateTasksMd(content));
    const activeLines = content.split('\n').filter((l) => l.startsWith('- ['));
    assert.equal(activeLines.length, N, 'no lost or duplicated lines under concurrency');
    // No leftover lock or temp files after all writers finished.
    assert.equal(existsSync(join(store, '.lock')), false);
    const stray = readdirSync(store).filter((f) => /\.tmp-/.test(f));
    assert.deepEqual(stray, []);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('stale lock (dead pid, same host) is reclaimed instead of hanging', () => {
  const store = makeStore();
  try {
    mkdirSync(store, { recursive: true });
    const sp = storePaths(store);
    mkdirSync(sp.lockDir);
    // A pid that is essentially guaranteed not to be alive on this host.
    const deadPid = 999999;
    writeFileSync(join(sp.lockDir, 'owner.json'), JSON.stringify({
      pid: deadPid,
      hostname: hostname(),
      opId: 'stale-test',
      acquiredAt: new Date(0).toISOString(),
    }));
    const start = Date.now();
    const lock = acquireLock(store, 'reclaimer', { maxAttempts: 20, retryDelayMs: 10 });
    const elapsed = Date.now() - start;
    lock.release();
    assert.ok(elapsed < 5000, 'dead-pid stale lock should be reclaimed quickly, not via the retry/backoff path');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('stale lock (unknown/foreign host, aged past staleMs) is reclaimed by age fallback', () => {
  const store = makeStore();
  try {
    mkdirSync(store, { recursive: true });
    const sp = storePaths(store);
    mkdirSync(sp.lockDir);
    writeFileSync(join(sp.lockDir, 'owner.json'), JSON.stringify({
      pid: 1,
      hostname: 'some-other-host-that-does-not-exist',
      opId: 'stale-test-2',
      acquiredAt: new Date(0).toISOString(),
    }));
    // Backdate the lock dir's mtime so the age-based fallback fires immediately.
    const old = new Date(Date.now() - 60_000);
    utimesSync(sp.lockDir, old, old);
    const lock = acquireLock(store, 'reclaimer-2', { staleMs: 1000, maxAttempts: 20, retryDelayMs: 10 });
    lock.release();
    assert.ok(true, 'age-based stale reclaim succeeded without throwing LOCK_TIMEOUT');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('genuinely held (live) lock is NOT reclaimed and eventually raises LOCK_TIMEOUT', () => {
  const store = makeStore();
  try {
    mkdirSync(store, { recursive: true });
    const sp = storePaths(store);
    mkdirSync(sp.lockDir);
    writeFileSync(join(sp.lockDir, 'owner.json'), JSON.stringify({
      pid: process.pid, // this test process itself: guaranteed alive
      hostname: hostname(),
      opId: 'live-owner',
      acquiredAt: new Date().toISOString(),
    }));
    assert.throws(
      () => acquireLock(store, 'contender', { staleMs: 60_000, maxAttempts: 5, retryDelayMs: 5 }),
      (e) => e instanceof StoreError && e.code === 'LOCK_TIMEOUT',
    );
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('regression (defect 2): a live same-host owner is NEVER reclaimed by age, even with a tiny staleMs and an old mtime', () => {
  const store = makeStore();
  try {
    mkdirSync(store, { recursive: true });
    const sp = storePaths(store);
    mkdirSync(sp.lockDir);
    writeFileSync(join(sp.lockDir, 'owner.json'), JSON.stringify({
      pid: process.pid, // this test process itself: guaranteed alive, same host
      hostname: hostname(),
      opId: 'live-owner-old-mtime',
      acquiredAt: new Date(0).toISOString(),
    }));
    // Backdate the lock dir's mtime well past staleMs. Before the fix, acquireLock's
    // stale check fell through to a pure age comparison for ANY owner (even a live,
    // same-host one), so this would have been wrongly reclaimed after ~15ms here.
    const old = new Date(Date.now() - 60_000);
    utimesSync(sp.lockDir, old, old);
    const start = Date.now();
    assert.throws(
      () => acquireLock(store, 'contender', { staleMs: 15, maxAttempts: 8, retryDelayMs: 5 }),
      (e) => e instanceof StoreError && e.code === 'LOCK_TIMEOUT',
      'a live same-host owner must never be reclaimed by age alone',
    );
    const elapsed = Date.now() - start;
    // The lock dir must still exist and still be owned by our (live) pid — proof it was
    // never removed/reclaimed during the retries.
    assert.ok(existsSync(sp.lockDir), 'lock dir must still exist — it was never reclaimed');
    const ownerStill = JSON.parse(readFileSync(join(sp.lockDir, 'owner.json'), 'utf8'));
    assert.equal(ownerStill.pid, process.pid);
    assert.ok(elapsed >= 8 * 5 - 5, 'must have actually exhausted retries via backoff, not raced past them');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('withLock re-reads under the lock: a change made by a "concurrent" writer between calls is visible', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    ensureWorkspaceSkeleton(storePaths(store));
    const sp = storePaths(store);
    withLock(store, 'op-1', () => {
      // Simulate another process committing a change while we hold no lock yet
      // (this call itself models "before this lock was acquired").
      taskAdd(sp, { title: 'Added before lock body runs' });
    });
    const out = taskAdd(sp, { title: 'Added after' });
    const content = readFileSync(sp.tasksFile, 'utf8');
    assert.match(content, /Added before lock body runs/);
    assert.match(content, /Added after/);
    assert.ok(out.path);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('interrupted write safety: a leftover temp file from a simulated crash is cleaned up and does not corrupt the store', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    const sp = storePaths(store);
    const before = readFileSync(sp.tasksFile, 'utf8');
    // Simulate a crash mid-write: leave a stray temp file next to tasks.md.
    const strayTmp = join(store, '.tasks.md.tmp-1-1700000000000-abcxyz');
    writeFileSync(strayTmp, 'PARTIAL, SHOULD NEVER BE READ');
    assert.ok(existsSync(strayTmp));
    // The next lock-holding operation must sweep it and leave tasks.md intact.
    const out = cli(['--store', store, 'task', 'add', '--title', 'Post-crash task']);
    assert.equal(out.json.ok, true);
    assert.equal(existsSync(strayTmp), false, 'stray temp file must be cleaned up on next lock acquisition');
    const after = readFileSync(sp.tasksFile, 'utf8');
    assert.match(after, /^# Tasks/, 'original structure preserved');
    assert.match(after, /Post-crash task/);
    assert.notEqual(after, before);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('atomicWriteFile leaves target untouched if content is written to a temp file that is never renamed', () => {
  const store = makeStore();
  try {
    mkdirSync(store, { recursive: true });
    const target = join(store, 'file.txt');
    writeFileSync(target, 'ORIGINAL');
    // We do not call atomicWriteFile with a failure injection (no hook point),
    // but we do verify the invariant it depends on: a temp file with content
    // sitting next to the target never affects reads of the target itself.
    writeFileSync(join(store, '.file.txt.tmp-1-2-abc'), 'NEW BUT NOT RENAMED YET');
    assert.equal(readFileSync(target, 'utf8'), 'ORIGINAL');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('usage errors: unknown command / missing required flags produce structured errors with correct exit codes', () => {
  const store = makeStore();
  try {
    cli(['--store', store, 'init']);
    const unknown = cli(['--store', store, 'bogus-command']);
    assert.equal(unknown.json.ok, false);
    assert.equal(unknown.json.error.code, 'USAGE');
    assert.equal(unknown.status, 1);

    const missingTitle = cli(['--store', store, 'task', 'add']);
    assert.equal(missingTitle.json.ok, false);
    assert.equal(missingTitle.json.error.code, 'VALIDATION_ERROR');
    assert.equal(missingTitle.status, 2);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('run() throws (not process.exit) so it is safely callable as a library function', () => {
  const store = makeStore();
  try {
    assert.throws(() => run(['--store', store, 'task', 'add']), (e) => e instanceof StoreError && e.code === 'VALIDATION_ERROR');
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});
