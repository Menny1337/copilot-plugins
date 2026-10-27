#!/usr/bin/env node
// session-map.test.mjs — node:test coverage for github-session-sync's marker
// format, idempotency check, local session→issue mapping cache, and issue-
// resolution precedence.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync,
} from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isValidSessionId,
  markerFor,
  hasMarker,
  extractMarkers,
  loadMap,
  saveMap,
  acquireMapLock,
  releaseMapLock,
  isPidAlive,
  recordMapping,
  lookupMapping,
  resolveIssueRef,
  remoteMatchesConfiguredRepo,
} from '../session-map.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'session-map.mjs');

const VALID_SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_SID = '11111111-2222-4333-8444-555555555555';

describe('marker format and idempotency', () => {
  test('markerFor produces the exact documented hidden-comment format', () => {
    assert.equal(markerFor(VALID_SID), `<!-- copilot-session:${VALID_SID} -->`);
  });

  test('markerFor rejects a non-UUID (truncated id, tool-call id, etc.)', () => {
    assert.throws(() => markerFor('toolu_abc123'), /not a valid session UUID/);
    assert.throws(() => markerFor('short-id'), /not a valid session UUID/);
    assert.throws(() => markerFor(''), /not a valid session UUID/);
  });

  test('isValidSessionId accepts only full 8-4-4-4-12 hex UUIDs', () => {
    assert.equal(isValidSessionId(VALID_SID), true);
    assert.equal(isValidSessionId('toolu_01abc'), false);
    assert.equal(isValidSessionId(VALID_SID.slice(0, 20)), false);
  });

  test('hasMarker finds this exact session\'s marker and not another session\'s', () => {
    const body = `Progress note.\n\n<!-- copilot-session:${VALID_SID} -->`;
    assert.equal(hasMarker(body, VALID_SID), true);
    assert.equal(hasMarker(body, OTHER_SID), false);
    assert.equal(hasMarker('no marker here', VALID_SID), false);
    assert.equal(hasMarker(null, VALID_SID), false);
  });

  test('extractMarkers pulls every distinct session id out of a comment thread, de-duplicated', () => {
    const thread = [
      `<!-- copilot-session:${VALID_SID} -->`,
      'some other comment',
      `<!-- copilot-session:${OTHER_SID} -->`,
      `repeat: <!-- copilot-session:${VALID_SID} -->`,
    ].join('\n');
    const ids = extractMarkers(thread);
    assert.deepEqual(ids.sort(), [OTHER_SID, VALID_SID].sort());
  });
});

describe('local session-issue mapping cache (file I/O)', () => {
  function sandboxPath() {
    const dir = mkdtempSync(join(tmpdir(), 'session-map-'));
    return join(dir, 'session-issue-map.json');
  }

  test('loadMap on a missing file returns an empty object, never throws', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'session-map-')), 'does-not-exist.json');
    assert.doesNotThrow(() => loadMap(p));
    assert.deepEqual(loadMap(p), {});
  });

  test('recordMapping then lookupMapping round-trips owner/repo/issue', () => {
    const p = sandboxPath();
    const rec = recordMapping(VALID_SID, { owner: 'acme', repo: 'personal-work', issue: 152 }, p);
    assert.equal(rec.owner, 'acme');
    assert.equal(rec.issue, 152);
    assert.ok(rec.updatedAt);

    const looked = lookupMapping(VALID_SID, p);
    assert.deepEqual(looked, rec);
    rmSync(dirname(p), { recursive: true, force: true });
  });

  test('lookupMapping for an unknown session returns undefined', () => {
    const p = sandboxPath();
    saveMap({}, p);
    assert.equal(lookupMapping(OTHER_SID, p), undefined);
    rmSync(dirname(p), { recursive: true, force: true });
  });

  test('recordMapping is idempotent: re-recording the same session overwrites, never duplicates', () => {
    const p = sandboxPath();
    recordMapping(VALID_SID, { owner: 'acme', repo: 'personal-work', issue: 152 }, p);
    recordMapping(VALID_SID, { owner: 'acme', repo: 'personal-work', issue: 152 }, p);
    const map = loadMap(p);
    assert.equal(Object.keys(map).length, 1);
    rmSync(dirname(p), { recursive: true, force: true });
  });

  test('recordMapping rejects a non-UUID session id and an incomplete issue ref', () => {
    const p = sandboxPath();
    assert.throws(() => recordMapping('not-a-uuid', { owner: 'a', repo: 'b', issue: 1 }, p));
    assert.throws(() => recordMapping(VALID_SID, { owner: 'a' }, p));
    rmSync(dirname(p), { recursive: true, force: true });
  });

  test('a corrupt/non-object JSON file degrades to an empty map rather than throwing', () => {
    const p = sandboxPath();
    saveMap([1, 2, 3], p); // array, not an object — loadMap must reject this shape
    assert.deepEqual(loadMap(p), {});
    rmSync(dirname(p), { recursive: true, force: true });
  });
});

describe('recordMapping concurrency safety', () => {
  function sandboxPath() {
    const dir = mkdtempSync(join(tmpdir(), 'session-map-concurrency-'));
    return join(dir, 'session-issue-map.json');
  }

  test('N concurrent CLI `record` invocations against the same map file all land — none lost to an unlocked read-modify-write', async () => {
    const p = sandboxPath();
    const N = 5;
    const sids = Array.from({ length: N }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const runs = sids.map((sid, i) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        SCRIPT, 'record',
        '--session', sid,
        '--owner', 'acme',
        '--repo', 'personal-work',
        '--issue', String(100 + i),
        '--path', p,
      ]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    }));
    const results = await Promise.all(runs);
    for (const r of results) {
      assert.equal(r.code, 0, `record CLI exited non-zero: ${r.stderr}`);
      assert.equal(JSON.parse(r.stdout.trim()).ok, true, `record CLI reported failure: ${r.stdout}`);
    }
    const map = loadMap(p);
    assert.equal(Object.keys(map).length, N, `expected all ${N} concurrent mappings to survive, got ${Object.keys(map).length}`);
    for (let i = 0; i < N; i += 1) {
      assert.equal(map[sids[i]]?.issue, 100 + i, `mapping for session ${sids[i]} was lost or overwritten`);
    }
    rmSync(dirname(p), { recursive: true, force: true });
  });

  test('recordMapping still round-trips correctly after taking the lock path', () => {
    const p = sandboxPath();
    const rec = recordMapping(VALID_SID, { owner: 'acme', repo: 'personal-work', issue: 152 }, p);
    assert.equal(rec.issue, 152);
    assert.deepEqual(lookupMapping(VALID_SID, p), rec);
    rmSync(dirname(p), { recursive: true, force: true });
  });
});

describe('lock acquire/release (single-machine, single-operator, no auto-reclaim)', () => {
  function sandboxPath() {
    const dir = mkdtempSync(join(tmpdir(), 'session-map-lock-'));
    return join(dir, 'session-issue-map.json');
  }

  test('a second acquire attempt is blocked while the first holder (this same live process) still holds it', () => {
    const p = sandboxPath();
    const lock = acquireMapLock(p);
    try {
      assert.throws(
        () => acquireMapLock(p, { maxAttempts: 3, retryDelayMs: 5 }),
        /could not acquire the map lock/,
        'a live same-process holder must never be treated as stale and barged past',
      );
    } finally {
      lock.release();
    }
    // Once released, a fresh acquire must succeed immediately.
    const lock2 = acquireMapLock(p, { maxAttempts: 3, retryDelayMs: 5 });
    lock2.release();
    rmSync(dirname(p), { recursive: true, force: true });
  });

  for (const [label, owner] of [
    ['a same-host lock left by a confirmed-dead pid', () => ({ pid: 999999999, hostname: hostname(), acquiredAt: new Date(Date.now() - 60_000).toISOString() })],
    ['a foreign-host lock, however old', () => ({ pid: process.pid, hostname: 'some-other-host', acquiredAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString() })],
    ['an old-but-genuinely-live same-host holder', () => ({ pid: process.pid, hostname: hostname(), acquiredAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString() })],
    ['an unidentifiable/malformed owner record', () => ({ hostname: hostname() })],
  ]) {
    test(`acquireMapLock never auto-reclaims ${label} — it waits out maxAttempts and fails closed, lock left untouched`, () => {
      const p = sandboxPath();
      const lockDir = `${p}.lock`;
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(join(lockDir, 'owner.json'), JSON.stringify(owner()));
      assert.throws(
        () => acquireMapLock(p, { maxAttempts: 3, retryDelayMs: 5 }),
        /could not acquire the map lock/,
        `${label} must never be auto-reclaimed — the module must wait then fail closed`,
      );
      assert.equal(existsSync(lockDir), true, 'the pre-existing lock directory must still exist, untouched, after the failed acquire attempts');
      rmSync(dirname(p), { recursive: true, force: true });
    });
  }

  test('the fail-closed error names the lock path, a PID diagnostic, and manual-cleanup guidance', () => {
    const p = sandboxPath();
    const lockDir = `${p}.lock`;
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 999999999, hostname: hostname(), acquiredAt: new Date().toISOString() }));
    try {
      acquireMapLock(p, { maxAttempts: 2, retryDelayMs: 5 });
      assert.fail('expected acquireMapLock to throw');
    } catch (e) {
      assert.match(e.message, new RegExp(lockDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'error must name the exact lock path');
      assert.match(e.message, /pid 999999999/, 'error must include the recorded owner pid as a diagnostic');
      assert.match(e.message, /appears dead/, 'error must surface the (informational-only) liveness diagnostic');
      assert.match(e.message, /rm -rf/, 'error must give explicit manual-cleanup guidance');
      assert.doesNotMatch(e.message, /reclaim/i, 'this module must never claim it will reclaim anything automatically');
    }
    rmSync(dirname(p), { recursive: true, force: true });
  });

  test('manual cleanup path: after an operator rm -rfs a stale lock (as the error message instructs), a fresh acquire succeeds immediately', () => {
    const p = sandboxPath();
    const lockDir = `${p}.lock`;
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 999999999, hostname: hostname(), acquiredAt: new Date().toISOString() }));
    assert.throws(() => acquireMapLock(p, { maxAttempts: 2, retryDelayMs: 5 }), /could not acquire the map lock/);
    rmSync(lockDir, { recursive: true, force: true }); // the operator's manual cleanup step
    const lock = acquireMapLock(p, { maxAttempts: 3, retryDelayMs: 5 });
    lock.release();
    rmSync(dirname(p), { recursive: true, force: true });
  });

  test('isPidAlive is a diagnostic-only helper: true for this live process, false for a confirmed-dead pid', () => {
    assert.equal(isPidAlive(process.pid), true);
    assert.equal(isPidAlive(999999999), false);
    assert.equal(isPidAlive(0), false, 'pid 0 is not a valid target pid');
  });

  test('releaseMapLock only removes a lock it still owns (pid+host match), and no-ops safely if the lock dir is already gone', () => {
    const p = sandboxPath();
    const lockDir = `${p}.lock`;
    assert.equal(releaseMapLock(lockDir), false, 'releasing a nonexistent lock dir must be a safe no-op');

    const lock = acquireMapLock(p);
    assert.equal(existsSync(lockDir), true);
    assert.equal(lock.release(), true);
    assert.equal(existsSync(lockDir), false);
    rmSync(dirname(p), { recursive: true, force: true });
  });

  test('releaseMapLock never removes a lock recorded under a different pid/host (e.g. a stale lock this process does not own)', () => {
    const p = sandboxPath();
    const lockDir = `${p}.lock`;
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 999999999, hostname: hostname(), acquiredAt: new Date().toISOString() }));
    assert.equal(releaseMapLock(lockDir), false, 'a lock owned by a different pid must never be removed by release');
    assert.equal(existsSync(lockDir), true);
    rmSync(dirname(p), { recursive: true, force: true });
  });

  test('concurrent CLI `record` invocations against a pre-existing (unreclaimed) stale lock all fail closed — no partial/corrupted writes', async () => {
    const p = sandboxPath();
    const lockDir = `${p}.lock`;
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 999999999, hostname: hostname(), acquiredAt: new Date().toISOString() }));

    const N = 3;
    const sids = Array.from({ length: N }, (_, i) => `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const runs = sids.map((sid, i) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        SCRIPT, 'record',
        '--session', sid,
        '--owner', 'acme',
        '--repo', 'personal-work',
        '--issue', String(400 + i),
        '--path', p,
      ]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    }));
    const results = await Promise.all(runs);
    for (const r of results) {
      assert.notEqual(r.code, 0, 'every writer must fail closed against a lock nobody released, never silently succeed');
    }
    assert.equal(existsSync(p), false, 'no map file should have been written at all — no partial/corrupted state');
    assert.equal(existsSync(lockDir), true, 'the untouched stale lock must still be exactly as the operator left it');
    rmSync(dirname(p), { recursive: true, force: true });
  });
});

describe('issue-resolution precedence (pure)', () => {
  test('an unambiguous issue URL always wins over branch/commit/cache/bare-number', () => {
    const r = resolveIssueRef({
      explicitUrlRef: 10, explicitGithubWordingRef: 15, repoContextConfirmed: true,
      branchRef: 20, commitRef: 30, cachedMapping: { issue: 40 }, bareNumberRef: 50,
    });
    assert.deepEqual(r, { issue: 10, source: 'explicit-url' });
  });

  test('explicit GitHub-scoped wording beats branch/commit/cache/bare-number when no URL is present', () => {
    const r = resolveIssueRef({
      explicitGithubWordingRef: 15, repoContextConfirmed: true,
      branchRef: 20, commitRef: 30, cachedMapping: { issue: 40 }, bareNumberRef: 50,
    });
    assert.deepEqual(r, { issue: 15, source: 'explicit-wording' });
  });

  test('branch beats commit and cache when repo context is confirmed and no explicit signal is present', () => {
    const r = resolveIssueRef({ repoContextConfirmed: true, branchRef: 20, commitRef: 30, cachedMapping: { issue: 40 } });
    assert.deepEqual(r, { issue: 20, source: 'branch' });
  });

  test('commit beats cache when repo context is confirmed and no explicit/branch ref is present', () => {
    const r = resolveIssueRef({ repoContextConfirmed: true, commitRef: 30, cachedMapping: { issue: 40 } });
    assert.deepEqual(r, { issue: 30, source: 'commit' });
  });

  test('cached mapping is the last CONFIDENT resort — a re-sync of the same session finds its own prior issue', () => {
    const r = resolveIssueRef({ cachedMapping: { issue: 40 } });
    assert.deepEqual(r, { issue: 40, source: 'cached-mapping' });
  });

  test('no signals at all resolves to null (caller must skip rather than guess)', () => {
    assert.equal(resolveIssueRef({}), null);
    assert.equal(resolveIssueRef(), null);
  });

  // --- Safety fixture (audited finding): a bare "#N" mention must NEVER be
  // trusted alone, and branch/commit numeric refs must NEVER count unless the
  // repo context is confirmed — otherwise a corporate ADO cross-reference
  // (assistant-capture's own `[#nnn]` convention) could be misread as a
  // GitHub issue number and a private session summary posted to it.
  describe('ambiguous bare-number safety (never resolve without established GitHub context)', () => {
    test('a bare number ALONE resolves to ambiguous, never a confident match', () => {
      const r = resolveIssueRef({ bareNumberRef: 152 });
      assert.deepEqual(r, { issue: null, source: 'ambiguous', ambiguousRef: 152 });
    });

    test('a bare number is still ambiguous even alongside an UNCONFIRMED branch/commit ref (repoContextConfirmed=false)', () => {
      const r = resolveIssueRef({ bareNumberRef: 94, branchRef: 94, commitRef: 94, repoContextConfirmed: false });
      assert.deepEqual(r, { issue: null, source: 'ambiguous', ambiguousRef: 94 });
    });

    test('the exact reported scenario: an ADO team-work-item cross-reference "[#94]" must not resolve as GitHub issue #94', () => {
      // assistant-capture §3.6.1 documents `[#nnn]` as the ADO team-WI cross-
      // reference convention; a session that merely mentions "[#94]" in its
      // transcript, with no GitHub-specific corroboration at all, must skip.
      const r = resolveIssueRef({ bareNumberRef: 94 });
      assert.equal(r.issue, null);
      assert.equal(r.source, 'ambiguous');
    });

    test('a branch/commit ref DOES count once repo context is confirmed (cwd verified to be the configured repo)', () => {
      const r = resolveIssueRef({ bareNumberRef: 94, branchRef: 152, repoContextConfirmed: true });
      assert.deepEqual(r, { issue: 152, source: 'branch' });
    });

    test('mixed ADO + GitHub session: a bare ADO cross-reference is ignored in favor of a confirmed branch ref for a DIFFERENT number', () => {
      // The session transcript mentions both an ADO work-item ("[#94]", bare)
      // and is checked out on a branch "152-fix-thing" in the configured
      // GitHub repo. The two numbers must never be conflated — only 152
      // (the confirmed-context signal) is trusted.
      const r = resolveIssueRef({ bareNumberRef: 94, branchRef: 152, repoContextConfirmed: true });
      assert.equal(r.issue, 152);
      assert.notEqual(r.issue, 94);
    });

    test('a cached mapping still resolves confidently even when a bare number is also present', () => {
      const r = resolveIssueRef({ bareNumberRef: 94, cachedMapping: { issue: 7 } });
      assert.deepEqual(r, { issue: 7, source: 'cached-mapping' });
    });
  });
});

describe('remoteMatchesConfiguredRepo — establishing branch/commit "repo context"', () => {
  test('matches an https remote URL with .git suffix', () => {
    assert.equal(remoteMatchesConfiguredRepo('https://github.com/acme/personal-work.git', 'acme', 'personal-work'), true);
  });

  test('matches an https remote URL without .git suffix', () => {
    assert.equal(remoteMatchesConfiguredRepo('https://github.com/acme/personal-work', 'acme', 'personal-work'), true);
  });

  test('matches an ssh-style remote URL', () => {
    assert.equal(remoteMatchesConfiguredRepo('git@github.com:acme/personal-work.git', 'acme', 'personal-work'), true);
  });

  test('is case-insensitive on owner/repo', () => {
    assert.equal(remoteMatchesConfiguredRepo('https://github.com/ACME/Personal-Work.git', 'acme', 'personal-work'), true);
  });

  test('does NOT match a different repo — proving a numeric ref from an unrelated repo never counts', () => {
    assert.equal(remoteMatchesConfiguredRepo('https://github.com/acme/some-other-repo.git', 'acme', 'personal-work'), false);
  });

  test('does NOT match a different owner', () => {
    assert.equal(remoteMatchesConfiguredRepo('https://github.com/someone-else/personal-work.git', 'acme', 'personal-work'), false);
  });

  test('returns false for missing/malformed input rather than throwing', () => {
    assert.equal(remoteMatchesConfiguredRepo(null, 'acme', 'personal-work'), false);
    assert.equal(remoteMatchesConfiguredRepo('not a url', 'acme', 'personal-work'), false);
    assert.equal(remoteMatchesConfiguredRepo('https://github.com/acme/personal-work.git', null, 'personal-work'), false);
  });
});

describe('CLI wrapper', () => {
  function run(args) {
    return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  }

  test('marker subcommand prints the exact hidden-comment marker', () => {
    const r = run(['marker', '--session', VALID_SID]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), `<!-- copilot-session:${VALID_SID} -->`);
  });

  test('record + lookup round-trip through the CLI with an explicit --path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-map-cli-'));
    const path = join(dir, 'map.json');
    try {
      const rec = run(['record', '--session', VALID_SID, '--owner', 'acme', '--repo', 'personal-work', '--issue', '7', '--path', path]);
      assert.equal(rec.status, 0, rec.stderr);
      assert.equal(JSON.parse(rec.stdout).ok, true);

      const look = run(['lookup', '--session', VALID_SID, '--path', path]);
      assert.equal(look.status, 0, look.stderr);
      const parsed = JSON.parse(look.stdout);
      assert.equal(parsed.result.issue, 7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an invalid session id produces a structured error, not a crash', () => {
    const r = run(['marker', '--session', 'not-a-uuid']);
    assert.equal(r.status, 2);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error.message, /not a valid session UUID/);
  });

  test('unknown subcommand reports usage and exits 1', () => {
    const r = run(['bogus']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /usage:/);
  });
});

describe('finding 7: `resolve` CLI subcommand — resolveIssueRef as an executable, code-enforced production path', () => {
  function run(args) {
    return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  }

  test('an explicit issue URL resolves confidently and exits 0', () => {
    const r = run(['resolve', '--session', VALID_SID, '--explicit-url', '152']);
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.result, { issue: 152, source: 'explicit-url' });
  });

  test('a bare number with NO corroborating GitHub context is CODE-REJECTED: exits 3, issue stays null', () => {
    const r = run(['resolve', '--session', VALID_SID, '--bare-number', '94']);
    assert.equal(r.status, 3, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.result.source, 'ambiguous');
    assert.equal(parsed.result.issue, null, 'an ambiguous ref must never surface a usable issue number');
    assert.equal(parsed.result.ambiguousRef, 94);
  });

  test('a branch/commit ref WITHOUT --repo-context-confirmed is never trusted implicitly: it is treated as if absent (exit 4, no-signal)', () => {
    // An unconfirmed branch/commit ref isn't merely "ambiguous like a bare
    // number" — resolveIssueRef doesn't even consider it a candidate at all
    // without repoContextConfirmed, so with no other signal present this is
    // indistinguishable from having seen nothing. Either way the caller must
    // skip; what matters here is that it is NEVER silently trusted.
    const r = run(['resolve', '--session', VALID_SID, '--branch-ref', '152']);
    assert.equal(r.status, 4, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.result, null);
    assert.notEqual(parsed.result?.issue, 152);
  });

  test('a branch ref WITH --repo-context-confirmed resolves confidently and exits 0', () => {
    const r = run(['resolve', '--session', VALID_SID, '--branch-ref', '152', '--repo-context-confirmed']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).result, { issue: 152, source: 'branch' });
  });

  test('no signal at all exits 4 (distinct from ambiguous) so a caller can tell "saw nothing" apart from "rejected a bare number"', () => {
    const r = run(['resolve', '--session', VALID_SID]);
    assert.equal(r.status, 4, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.result, null);
    assert.equal(parsed.reason, 'no-signal');
  });

  test('resolve consults the local session-to-issue cache automatically via --session, and it wins over a bare number', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-map-resolve-cli-'));
    const path = join(dir, 'map.json');
    try {
      const rec = run(['record', '--session', VALID_SID, '--owner', 'acme', '--repo', 'personal-work', '--issue', '77', '--path', path]);
      assert.equal(rec.status, 0, rec.stderr);
      const r = run(['resolve', '--session', VALID_SID, '--bare-number', '999', '--path', path]);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout).result, { issue: 77, source: 'cached-mapping' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('missing --session is a hard input error (exit 2), not a silent ambiguous/no-signal result', () => {
    const r = run(['resolve', '--bare-number', '94']);
    assert.equal(r.status, 2);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error.message, /requires --session/);
  });

  test('a precedence order still holds end-to-end through the CLI: explicit URL beats an ambiguous bare number in the SAME invocation', () => {
    const r = run(['resolve', '--session', VALID_SID, '--explicit-url', '10', '--bare-number', '999']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).result, { issue: 10, source: 'explicit-url' });
  });
});

