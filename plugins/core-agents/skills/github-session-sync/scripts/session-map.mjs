#!/usr/bin/env node
/**
 * session-map.mjs — local session-to-issue mapping + idempotency marker helpers
 * for the `github-session-sync` skill (the GitHub twin of `ado-session-sync`).
 *
 * WHY THIS EXISTS
 *   The ADO backend stamps a `session:<id>` **tag** directly on the work item — ADO
 *   tags are a first-class, queryable field, so the tag itself is both the
 *   idempotency marker (§Step 5 of `ado-session-sync`) and the rediscovery index
 *   (WIQL `[System.Tags] CONTAINS 'session:<id>'`).
 *
 *   GitHub issues have no equivalent free-form queryable tag field that is safe to
 *   machine-append to repeatedly (labels are a poor fit — one label per session
 *   would be unbounded label churn, which the plan explicitly rules out). Instead:
 *     - Idempotency marker: a single **hidden HTML comment** per session,
 *       `<!-- copilot-session:<uuid> -->`, embedded in the progress comment body
 *       itself. Grepping an issue's comments for this exact marker tells you
 *       whether *this* session already posted to *this* issue.
 *     - Rediscovery index: a small local JSON file
 *       (`~/.copilot/assistant/session-issue-map.json` by default) mapping
 *       `sessionId -> { repo, issue, updatedAt }`, so a re-sync of the same session
 *       does not have to re-search GitHub to find the issue it already touched.
 *       This is a **cache only** — every write path still verifies the marker is
 *       actually present on the remote issue before treating it as a duplicate
 *       (never trust the local cache alone for a correctness decision).
 *
 * This module is pure/testable: no network calls, no `gh` invocation. The
 * `github-session-sync` skill (and its bundled `github-sync.mjs`, if present) call
 * `gh` directly and use these helpers only for marker text and local-cache I/O.
 */

import {
  readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, rmSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isValidSessionId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** The exact, stable hidden marker for a session — never truncated/abbreviated. */
function markerFor(sessionId) {
  if (!isValidSessionId(sessionId)) {
    throw new Error(`session-map: not a valid session UUID: ${JSON.stringify(sessionId)}`);
  }
  return `<!-- copilot-session:${sessionId} -->`;
}

/** True if `text` (an issue/comment body) already carries this session's marker. */
function hasMarker(text, sessionId) {
  if (typeof text !== 'string' || !text) return false;
  return text.includes(markerFor(sessionId));
}

/** Extract every `copilot-session:<uuid>` marker present in `text`, de-duplicated. */
function extractMarkers(text) {
  if (typeof text !== 'string' || !text) return [];
  const re = /<!--\s*copilot-session:([0-9a-fA-F-]{36})\s*-->/g;
  const out = new Set();
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text))) out.add(m[1]);
  return [...out];
}

function defaultMapPath() {
  return join(homedir(), '.copilot', 'assistant', 'session-issue-map.json');
}

function loadMap(path = defaultMapPath()) {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Atomic-enough write: temp file in the same dir, then rename over the target. */
function saveMap(map, path = defaultMapPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  try {
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw e;
  }
}

// ── Locking ──────────────────────────────────────────────────────────────
// recordMapping is a read-modify-write over a single shared JSON file. This
// is a personal, single-machine, single-operator tool, so the lock has one
// job: serialize this machine's writers (e.g. two session-sync children
// finishing around the same time) and fail clearly when it can't — never
// guess. There is NO automatic reclaim: this process never removes, renames,
// or otherwise touches a lock directory it did not itself create. If a lock
// exists, acquire waits up to a bounded time and then fails with the lock
// path, a PID diagnostic (owner pid/hostname/age, and whether that pid looks
// alive on this host — informational only, never used to decide anything),
// and an explicit manual-cleanup instruction. A single operator can look at
// that and decide it's safe to `rm -rf` the stale lock themselves; this
// module will not do it for them, so it can never delete a live holder's
// lock out from under it.

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** true if pid appears to be a live process on THIS host; unknown -> true (assume alive). Diagnostic only — never used to decide reclaim, because this module never reclaims. */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH'; // ESRCH = definitely gone; anything else (e.g. EPERM) = assume alive
  }
}

function readLockOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Release the lock at `lockDir`, but only if it's still recorded as ours. */
function releaseMapLock(lockDir) {
  const owner = readLockOwner(lockDir);
  if (!owner || owner.pid !== process.pid || owner.hostname !== hostname()) return false;
  try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  return true;
}

/**
 * Acquire an exclusive lock guarding the session-issue map at `path`.
 * mkdir is the atomic primitive (EEXIST the same way O_EXCL is for a file).
 * If already held by anyone — live, dead, or unidentifiable — this waits
 * and retries for up to `maxAttempts * retryDelayMs`, then fails closed; it
 * never removes another holder's lock.
 */
function acquireMapLock(path, { maxAttempts = 200, retryDelayMs = 25 } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const lockDir = `${path}.lock`;
  let lastOwner = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
        pid: process.pid,
        hostname: hostname(),
        acquiredAt: new Date().toISOString(),
      }));
      return { release: () => releaseMapLock(lockDir) };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      lastOwner = readLockOwner(lockDir);
      sleepSync(retryDelayMs);
    }
  }
  const waitedMs = maxAttempts * retryDelayMs;
  let ownerDesc = '';
  if (lastOwner && typeof lastOwner.hostname === 'string' && Number.isInteger(lastOwner.pid)) {
    const aliveNote = lastOwner.hostname === hostname()
      ? (isPidAlive(lastOwner.pid) ? 'appears alive' : 'appears dead')
      : 'liveness unknown (different host)';
    ownerDesc = ` (recorded owner: pid ${lastOwner.pid} on ${lastOwner.hostname}, ${aliveNote}, `
      + `held since ${lastOwner.acquiredAt})`;
  }
  throw new Error(
    `session-map: could not acquire the map lock at ${lockDir} after waiting ~${waitedMs}ms${ownerDesc}. `
    + `This tool never auto-removes another holder's lock. If you have confirmed no other `
    + `session-sync process is running, remove it manually: rm -rf "${lockDir}"`,
  );
}

/** Record (or overwrite) which issue a session synced to, for fast rediscovery. */
function recordMapping(sessionId, { owner, repo, issue }, path = defaultMapPath()) {
  if (!isValidSessionId(sessionId)) throw new Error(`session-map: not a valid session UUID: ${JSON.stringify(sessionId)}`);
  if (!owner || !repo || !issue) throw new Error('session-map: recordMapping requires { owner, repo, issue }');
  const lock = acquireMapLock(path);
  try {
    const map = loadMap(path);
    map[sessionId] = { owner, repo, issue: Number(issue), updatedAt: new Date().toISOString() };
    saveMap(map, path);
    return map[sessionId];
  } finally {
    lock.release();
  }
}

/** Look up a previously recorded mapping for a session; undefined if none. */
function lookupMapping(sessionId, path = defaultMapPath()) {
  const map = loadMap(path);
  return map[sessionId];
}

/**
 * Whether a git remote URL resolves to the CONFIGURED GitHub owner/repo —
 * required to let a branch-name or commit-message numeric reference count as
 * "established GitHub context" (see `resolveIssueRef`). Handles the common
 * remote URL forms: `https://github.com/<owner>/<repo>.git`,
 * `https://github.com/<owner>/<repo>`, and `git@github.com:<owner>/<repo>.git`.
 */
function remoteMatchesConfiguredRepo(remoteUrl, owner, repo) {
  if (!remoteUrl || !owner || !repo) return false;
  const m = String(remoteUrl).match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i);
  if (!m) return false;
  return m[1].toLowerCase() === String(owner).toLowerCase() && m[2].toLowerCase() === String(repo).toLowerCase();
}

/**
 * Resolve which issue a sync should target, in the documented priority order
 * (github-session-sync SKILL.md Step 4). Pure function — callers supply
 * already-extracted signals; this only encodes the precedence, never does
 * I/O itself.
 *
 * SAFETY (audited): a BARE numeric mention (e.g. "#152" with no further
 * GitHub-specific context) is NEVER trusted alone. `assistant-capture`'s own
 * ADO team-work-item cross-reference convention writes ADO references in
 * exactly this shape (`[#nnn]`, see `assistant-capture` §3.6.1's field-mapping
 * table), so treating a bare number as confident evidence risks posting a
 * private session-progress summary to an unrelated — or entirely wrong —
 * GitHub issue. A bare number resolves ONLY when corroborated by one of:
 *   - an unambiguous issue URL for the CONFIGURED repo (`explicitUrlRef`),
 *   - explicit GitHub-scoped wording — "GitHub issue #152" / "gh issue #152"
 *     (`explicitGithubWordingRef`),
 *   - a branch/commit reference where `repoContextConfirmed` is true (cwd's
 *     git remote has been confirmed, via `remoteMatchesConfiguredRepo`, to be
 *     the configured owner/repo — a numeric branch/commit reference in an
 *     unrelated repo is exactly as ambiguous as a bare mention), or
 *   - an existing verified local session-to-issue mapping.
 * Anything else — including a bare number alone, or a branch/commit
 * reference whose repo context is NOT confirmed — returns
 * `{ issue: null, source: 'ambiguous', ambiguousRef }` so the caller skips
 * rather than guesses.
 *
 * @param {object} signals
 * @param {number|null} [signals.explicitUrlRef]  issue number from an unambiguous
 *   `github.com/<configured-owner>/<configured-repo>/issues/<n>` URL — always trusted.
 * @param {number|null} [signals.explicitGithubWordingRef]  issue number from explicit
 *   GitHub-scoped wording ("GitHub issue #152", "gh issue #152") — always trusted.
 * @param {number|null} [signals.bareNumberRef]  issue number from an unqualified
 *   "#152" mention with NO GitHub-specific context — NEVER trusted alone.
 * @param {boolean} [signals.repoContextConfirmed]  whether cwd's git remote has been
 *   confirmed (via `remoteMatchesConfiguredRepo`) to match the configured owner/repo —
 *   required for `branchRef`/`commitRef` to count.
 * @param {number|null} [signals.branchRef]
 * @param {number|null} [signals.commitRef]
 * @param {object|null} [signals.cachedMapping]
 * @returns {{ issue: number, source: string } | { issue: null, source: 'ambiguous', ambiguousRef: number } | null}
 */
function resolveIssueRef({
  explicitUrlRef = null, explicitGithubWordingRef = null, bareNumberRef = null,
  repoContextConfirmed = false, branchRef = null, commitRef = null, cachedMapping = null,
} = {}) {
  if (explicitUrlRef !== null && explicitUrlRef !== undefined) return { issue: Number(explicitUrlRef), source: 'explicit-url' };
  if (explicitGithubWordingRef !== null && explicitGithubWordingRef !== undefined) return { issue: Number(explicitGithubWordingRef), source: 'explicit-wording' };
  if (repoContextConfirmed && branchRef !== null && branchRef !== undefined) return { issue: Number(branchRef), source: 'branch' };
  if (repoContextConfirmed && commitRef !== null && commitRef !== undefined) return { issue: Number(commitRef), source: 'commit' };
  if (cachedMapping && cachedMapping.issue) return { issue: Number(cachedMapping.issue), source: 'cached-mapping' };
  if (bareNumberRef !== null && bareNumberRef !== undefined) {
    return { issue: null, source: 'ambiguous', ambiguousRef: Number(bareNumberRef) };
  }
  return null;
}

export {
  isValidSessionId,
  markerFor,
  hasMarker,
  extractMarkers,
  defaultMapPath,
  loadMap,
  saveMap,
  acquireMapLock,
  releaseMapLock,
  isPidAlive,
  recordMapping,
  lookupMapping,
  resolveIssueRef,
  remoteMatchesConfiguredRepo,
};

// --- Thin CLI (for the headless sync agent / manual use) -------------------------
function parseCliArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--session': o.session = next(); break;
      case '--owner': o.owner = next(); break;
      case '--repo': o.repo = next(); break;
      case '--issue': o.issue = next(); break;
      case '--path': o.path = next(); break;
      // finding 7: resolveIssueRef's candidate signals, as CLI flags, so the
      // real sync agent routes through the code-enforced precedence instead
      // of eyeballing the same rule from SKILL.md prose.
      case '--explicit-url': o.explicitUrlRef = next(); break;
      case '--explicit-wording': o.explicitGithubWordingRef = next(); break;
      case '--bare-number': o.bareNumberRef = next(); break;
      case '--branch-ref': o.branchRef = next(); break;
      case '--commit-ref': o.commitRef = next(); break;
      // boolean flag — presence alone means true; no value is consumed.
      case '--repo-context-confirmed': o.repoContextConfirmed = true; break;
      default: o._.push(a);
    }
  }
  return o;
}

function cliMain(argv) {
  const opts = parseCliArgs(argv);
  const cmd = opts._[0];
  const path = opts.path || defaultMapPath();
  try {
    switch (cmd) {
      case 'marker': {
        process.stdout.write(`${markerFor(opts.session)}\n`);
        return 0;
      }
      case 'record': {
        const rec = recordMapping(opts.session, { owner: opts.owner, repo: opts.repo, issue: opts.issue }, path);
        process.stdout.write(`${JSON.stringify({ ok: true, result: rec })}\n`);
        return 0;
      }
      case 'lookup': {
        const rec = lookupMapping(opts.session, path);
        process.stdout.write(`${JSON.stringify({ ok: true, result: rec ?? null })}\n`);
        return 0;
      }
      case 'resolve': {
        // finding 7: the ONE executable path real session-sync candidate
        // signals must be routed through before any GitHub read/write or
        // mapping record — never re-implemented ad hoc by a caller, and
        // never bypassed by "it's just a bare number, close enough" prose
        // judgment. `--session` is required so a cached prior mapping (the
        // lowest-priority confident signal) is looked up automatically;
        // every other signal is optional and defaults to "not present".
        if (!opts.session) {
          process.stdout.write(`${JSON.stringify({ ok: false, error: { message: 'session-map: resolve requires --session <uuid>' } })}\n`);
          return 2;
        }
        const cachedMapping = lookupMapping(opts.session, path) ?? null;
        const toNum = (v) => (v === undefined || v === null ? null : Number(v));
        const result = resolveIssueRef({
          explicitUrlRef: toNum(opts.explicitUrlRef),
          explicitGithubWordingRef: toNum(opts.explicitGithubWordingRef),
          bareNumberRef: toNum(opts.bareNumberRef),
          repoContextConfirmed: !!opts.repoContextConfirmed,
          branchRef: toNum(opts.branchRef),
          commitRef: toNum(opts.commitRef),
          cachedMapping,
        });
        if (result === null) {
          // No signal at all — nothing to even call ambiguous. Skip, same
          // spirit as 'ambiguous' but a distinct reason/exit code so callers
          // can tell "we saw a bare number and rejected it" apart from
          // "we saw nothing to go on".
          process.stdout.write(`${JSON.stringify({ ok: true, result: null, reason: 'no-signal' })}\n`);
          return 4;
        }
        if (result.source === 'ambiguous') {
          // CODE-REJECTED, not prose-only: a bare "#N" with no corroborating
          // GitHub-specific context is never trusted, and this exit code
          // makes that a hard, scriptable stop rather than a judgment call
          // an agent could talk itself out of.
          process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
          return 3;
        }
        process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
        return 0;
      }
      default:
        process.stderr.write('usage: session-map.mjs <marker|record|lookup|resolve> --session <uuid> [--owner O --repo R --issue N] [--path FILE]\n'
          + '       session-map.mjs resolve --session <uuid> [--explicit-url N] [--explicit-wording N] [--bare-number N]\n'
          + '                                [--repo-context-confirmed] [--branch-ref N] [--commit-ref N] [--path FILE]\n'
          + '         exit 0 = confident match (see stdout .result.issue); exit 3 = ambiguous (code-rejected, must skip);\n'
          + '         exit 4 = no signal at all (skip); exit 2 = bad input.\n');
        return 1;
    }
  } catch (e) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { message: e.message } })}\n`);
    return 2;
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) process.exit(cliMain(process.argv.slice(2)));
