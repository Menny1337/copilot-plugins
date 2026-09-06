#!/usr/bin/env node
/**
 * github-state-transition.mjs — pure/testable ordering + safety logic for the
 * complete/archive/reopen/move transitions documented in assistant-capture's
 * SKILL.md §3.6.4 (GitHub task backend), plus a small CLI that wires it into
 * the real `gh` calls so SKILL.md never has to run raw, unverified commands.
 *
 * WHY THIS EXISTS
 *   A GitHub issue's "done-ness" is the conjunction of two independently
 *   writable things: the issue's own open/closed state, and the Projects v2
 *   `Lane` field (Done/Archive vs. any non-terminal lane) plus its built-in
 *   `Status` field. Each is a separate API call, and any can fail
 *   independently — closing the issue before the Lane/Status write lands can
 *   leave it CLOSED with a stale non-terminal Lane, which vanishes from both
 *   "open" and "done" briefing views. So this module: orders the Lane/Status
 *   write before the state-changing write for destructive transitions
 *   (complete/archive), and the reverse for restorative ones (reopen) — if
 *   the second step fails the item stays OPEN, never closed-and-lost.
 *
 * IDEMPOTENT CONVERGENCE (not transactional compensation)
 *   This module does NOT roll back / compensate a partial failure. Instead:
 *     1. Before planning any write, it reads the live (state, lane, status)
 *        and SKIPS any step whose target already matches that live value
 *        (`planTransition`'s `current` argument) — re-running the exact same
 *        command twice is always safe and the second run does nothing.
 *     2. If a write throws partway through, it does NOT undo the steps that
 *        already succeeded. It re-fetches the live state exactly once and
 *        compares it to the plan's target:
 *          - fully matches  -> report success (the write actually landed
 *            despite the reported error, or another step already covered it).
 *          - refetch itself fails -> report an INDETERMINATE, nonzero result
 *            ("re-run — this command is idempotent").
 *          - refetch succeeds but still doesn't match -> report a PARTIAL,
 *            nonzero result naming exactly what's still wrong, and tell the
 *            caller to re-run — the re-run's own `current` read will skip
 *            whatever already landed and apply only what's still missing.
 *   This trades "always ends in a known-good state after one call" (the old
 *   compensation design) for "never performs a surprise undo, and a rerun
 *   always converges" — appropriate for a single-operator personal backend
 *   where a human can simply run the command again.
 *
 *   Lane remains the canonical workflow source of truth (SKILL.md's Lane
 *   catalog is authoritative); Status is derived from the target Lane via a
 *   configurable `laneStatusMap` and written/verified alongside it. The
 *   snapshot/verification GraphQL queries paginate the `projectItems` and
 *   `fieldValues` connections exhaustively (`findProjectItemId`/
 *   `collectFieldValues`, bounded by `MAX_PAGES` as a hard-error safety
 *   valve, never a silent truncation) so a configured project or field can't
 *   be missed just because it's on a later page.
 *
 * The ORDERING/SAFETY LOGIC (planTransition, executeTransition, runTransition,
 * deriveStatus, matchesExpected) is pure and network-free: callers supply
 * `applyStep`/`fetchLive` callbacks that do the actual `gh` invocations, so
 * this half of the module only decides the ORDER, WHAT'S ALREADY SATISFIED,
 * and the SUCCESS CRITERIA.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectGithubCliEnv } from '../../../shared/github-cli-auth.mjs';

const TERMINAL_LANE_BY_ACTION = { complete: 'Done', archive: 'Archive' };
const CLOSE_REASON_BY_ACTION = { complete: 'completed', archive: 'not planned' };
const TERMINAL_LANES = Object.values(TERMINAL_LANE_BY_ACTION); // ['Done', 'Archive']
const OPEN_LANES = ['Backlog', 'Up Next', 'Active', 'Needs Me', 'Blocked'];
let ghEnv = process.env;

/**
 * Default Lane -> built-in-Status derivation (finding 2), matching this
 * project's own Lane catalog (assistant-query/scripts/github-query.mjs) and
 * the 3-option Status field GitHub creates by default on every new Projects
 * v2 board (Todo / In Progress / Done). Overridable per-board via
 * `config.github.fields.laneStatusMap` (shallow-merged over this default —
 * see `resolveGithubContext`) for boards with custom Status options.
 */
const DEFAULT_LANE_STATUS_MAP = {
  Backlog: 'Todo',
  'Up Next': 'Todo',
  Active: 'In Progress',
  'Needs Me': 'In Progress',
  Blocked: 'In Progress',
  Done: 'Done',
  Archive: 'Done',
};

/** GraphQL connection page size for projectItems/fieldValues pagination (finding 3). */
const PAGE_SIZE = 50;
/** Safety valve against a runaway/misbehaving pagination loop — exceeding this is a hard error, never a silent stop (see file header, finding 3). */
const MAX_PAGES = 200;

/**
 * Canonical (lane, state) invariant check (§3.6.5): an OPEN issue must never
 * sit in a terminal lane (Done/Archive), and a CLOSED issue must never sit in
 * a non-terminal lane. Returns a normalized snapshot plus whether it violates
 * that invariant, so callers (the CLI wiring, a reconciliation pass, tests)
 * can detect an already-bad state rather than silently trusting it.
 *
 * NOTE on naming: this function's `.status` return value is a LANE-DERIVED
 * label (historically `status: lane`, since Lane + open/closed together were
 * previously the only canonical status this module tracked) and is UNRELATED
 * to the built-in Projects v2 "Status" field introduced by finding 2 below
 * (that field's live value lives in the `current`/`fetchSnapshot()` snapshot's
 * `.status`, a completely separate variable). Lane remains the sole input to
 * this invariant check per the r3 review ("Canonical Lane remains workflow
 * source"); the built-in Status field is derived/applied alongside Lane but
 * never itself gates this invariant.
 */
function deriveStatus({ state, lane }) {
  const normState = typeof state === 'string' ? state.toLowerCase() : state;
  const isClosed = normState === 'closed';
  const isOpen = normState === 'open';
  const isTerminalLane = TERMINAL_LANES.includes(lane);
  let violation = null;
  if (isClosed && !isTerminalLane) violation = 'closed-with-nonterminal-lane';
  else if (isOpen && isTerminalLane) violation = 'open-with-terminal-lane';
  return {
    state: normState,
    lane: lane ?? null,
    status: lane ?? null,
    valid: violation === null,
    violation,
  };
}

/**
 * Build an ordered transition plan for `action` ('complete' | 'archive' |
 * 'reopen' | 'move'), SKIPPING any step whose target already matches `current` (the
 * live { state, lane, status } read just before planning) — the core of the
 * idempotent-convergence design: a step is only planned if it is actually
 * still needed, so re-running the same command after a partial failure (or
 * simply twice in a row) only ever applies what's still missing.
 *
 * For 'reopen', `chosenLane` selects the lane to land in (defaults to
 * 'Backlog', matching SKILL.md §3.6.4). For 'move', it is required. Both
 * operations accept only the five open lanes.
 *
 * Step ordering among whatever steps ARE still needed (never change without
 * re-reading the WHY THIS EXISTS note above): complete/archive set Lane
 * (then Status, if available) FIRST, then close; reopen reopens FIRST, then
 * sets Lane (then Status). This guarantees a later-step failure always
 * leaves the issue OPEN, never closed-with-a-stale-lane.
 *
 * `includeStatus` (finding 2) gates whether a `status` step is ever
 * considered — the CLI sets this to `false` when the configured project has
 * no built-in Status field, so a project without one is never forced to
 * grow one. When Status is present, every target lane must have an explicit
 * derived mapping; refusing an incomplete mapping prevents Lane-only drift.
 */
function planTransition(action, {
  chosenLane, laneStatusMap = DEFAULT_LANE_STATUS_MAP, includeStatus = true, current,
} = {}) {
  let lane;
  let state;
  let reason;
  if (action === 'complete' || action === 'archive') {
    lane = TERMINAL_LANE_BY_ACTION[action];
    reason = CLOSE_REASON_BY_ACTION[action];
    state = 'closed';
  } else if (action === 'reopen') {
    lane = chosenLane || 'Backlog';
    state = 'open';
  } else if (action === 'move') {
    if (!current || typeof current.state !== 'string') {
      throw new Error('github-state-transition: move requires a current snapshot so issue state can remain unchanged');
    }
    lane = chosenLane;
    state = current.state;
  } else {
    throw new Error(`github-state-transition: unknown action ${JSON.stringify(action)} (expected complete|archive|reopen|move)`);
  }
  if ((action === 'reopen' || action === 'move') && !OPEN_LANES.includes(lane)) {
    throw new Error(`github-state-transition: ${action} lane ${JSON.stringify(lane)} is invalid (expected ${OPEN_LANES.join('|')})`);
  }
  if (action === 'move' && state !== 'open') {
    throw new Error('github-state-transition: move requires an open issue; use reopen to restore a closed issue to an active lane');
  }
  if (action === 'move' && !includeStatus) {
    throw new Error('github-state-transition: move requires the project built-in Status field so Lane and derived Status cannot drift');
  }
  const status = includeStatus ? laneStatusMap[lane] : null;
  if (includeStatus && (typeof status !== 'string' || !status)) {
    throw new Error(`github-state-transition: no Status mapping is configured for Lane ${JSON.stringify(lane)}`);
  }

  const alreadyLane = !!current && current.lane === lane;
  const alreadyStatus = !status || (!!current && current.status === status);
  const alreadyState = !!current && current.state === state;

  const steps = [];
  if (action === 'reopen') {
    if (!alreadyState) steps.push({ type: 'reopen' });
    if (!alreadyLane) steps.push({ type: 'lane', targetLane: lane });
    if (status && !alreadyStatus) steps.push({ type: 'status', targetStatus: status });
  } else {
    if (!alreadyLane) steps.push({ type: 'lane', targetLane: lane });
    if (status && !alreadyStatus) steps.push({ type: 'status', targetStatus: status });
    if (!alreadyState) steps.push({ type: 'close', reason });
  }

  return {
    action,
    steps,
    expected: {
      lane, state, status, checkStatus: !!status,
    },
  };
}

/** True when `live` already fully matches `expected` (lane, state, and — only when `expected.checkStatus` — status). Pure; used both to decide whether the whole transition is already converged and, after a write error, whether the live remote reached the target despite the reported error. */
function matchesExpected(live, expected) {
  if (!live) return false;
  if (live.state !== expected.state) return false;
  if (live.lane !== expected.lane) return false;
  if (expected.checkStatus && live.status !== expected.status) return false;
  return true;
}

/**
 * Apply `plan.steps` in order via the caller-supplied `applyStep(step)`. If
 * every step applies without throwing, do one final live re-fetch
 * (`fetchLive()`) to confirm the result actually landed (a step can report
 * success from `gh` yet not actually have taken effect). If a step THROWS
 * partway through, do NOT undo anything already applied — instead, also
 * re-fetch once and compare against `plan.expected`:
 *
 *   - live state already matches `plan.expected`      -> report success
 *     (the failing step's write actually landed, or a previous step already
 *     satisfied the target — either way the goal is met).
 *   - the re-fetch itself throws                       -> report `ok: false,
 *     indeterminate: true` — outcome unknown; tell the caller to re-run
 *     (idempotent: a re-run's own planning will skip whatever did land).
 *   - the re-fetch succeeds but still doesn't match     -> report `ok: false,
 *     indeterminate: false` with the observed `current` vs. `expected`, and
 *     tell the caller to re-run.
 *
 * This never performs a surprise write to "undo" anything — the only writes
 * are the ones in `plan.steps` themselves.
 */
function executeTransition(plan, { applyStep, fetchLive }) {
  if (typeof applyStep !== 'function') throw new Error('github-state-transition: executeTransition requires an applyStep(step) function');
  if (typeof fetchLive !== 'function') throw new Error('github-state-transition: executeTransition requires a fetchLive() function');

  const appliedSteps = [];
  let writeError = null;
  let failedStep = null;
  for (const step of plan.steps) {
    try {
      const result = applyStep(step);
      appliedSteps.push({ step, result });
    } catch (e) {
      writeError = e && e.message ? e.message : String(e);
      failedStep = step;
      break;
    }
  }

  let live;
  let fetchError = null;
  try {
    live = fetchLive();
  } catch (e) {
    fetchError = e && e.message ? e.message : String(e);
  }

  if (fetchError) {
    return {
      ok: false,
      action: plan.action,
      appliedSteps,
      failedStep,
      error: writeError || null,
      fetchError,
      current: null,
      expected: plan.expected,
      converged: false,
      indeterminate: true,
      message: `github-state-transition: could not re-read the live state after applying ${appliedSteps.length}/${plan.steps.length} step(s) (${fetchError}). The outcome is UNKNOWN — no rollback was attempted. Re-run this command: it is idempotent and will only apply whatever is still missing.`,
    };
  }

  const converged = matchesExpected(live, plan.expected);
  if (converged) {
    return {
      ok: true,
      action: plan.action,
      appliedSteps,
      current: live,
      converged: true,
      indeterminate: false,
      ...(writeError ? { recoveredFromWriteError: writeError } : {}),
    };
  }

  return {
    ok: false,
    action: plan.action,
    appliedSteps,
    failedStep,
    error: writeError || 'live state does not yet match the expected result',
    current: live,
    expected: plan.expected,
    converged: false,
    indeterminate: false,
    message: `github-state-transition: the transition is only partially applied (${appliedSteps.length}/${plan.steps.length} step(s) applied). Re-run this command: it is idempotent and will apply only whatever is still needed to reach the target lane/status/state.`,
  };
}

/**
 * The full operation used by real callers (SKILL.md §3.6.4): read the live
 * (state, lane, status) BEFORE planning anything (`current`), build a plan
 * that only includes steps still needed to reach the canonical target for
 * `action`, and — if any steps are needed — apply them and confirm
 * convergence against the live remote (`executeTransition`).
 *
 * If NOTHING is needed (the live state already matches the target — e.g.
 * this is a re-run after a fully-successful prior call, or the item was
 * already in the target state), no write is attempted at all and the result
 * reports `ok: true, alreadyConverged: true` immediately.
 *
 * This function never compensates/rolls back a partial failure (see the
 * file header) — a failed run's result carries enough detail (`current`,
 * `expected`, `appliedSteps`, `indeterminate`) for the caller to simply
 * re-run the same command, which will converge by applying only the steps
 * that are still missing.
 */
function runTransition(action, {
  chosenLane, current, applyStep, fetchLive, laneStatusMap, includeStatus,
} = {}) {
  if (!current || typeof current.state !== 'string') {
    throw new Error('github-state-transition: runTransition requires a `current` snapshot { state, lane, status } read from the live issue/project BEFORE planning any write');
  }
  const priorStatus = deriveStatus(current);
  const plan = planTransition(action, {
    chosenLane, laneStatusMap, includeStatus, current,
  });

  if (plan.steps.length === 0) {
    return {
      ok: true,
      action,
      appliedSteps: [],
      current,
      priorStatus,
      alreadyConverged: true,
      converged: true,
      indeterminate: false,
    };
  }

  const result = executeTransition(plan, { applyStep, fetchLive });
  return { ...result, priorStatus, alreadyConverged: false };
}

// =====================================================================
// CLI wiring — the "actually invoked by SKILL.md" half of this module.
//
// Deliberately dependency-free from github-query.mjs (same convention as
// session-map.mjs vs. assistant-store.mjs: no cross-skill import), even
// though the GraphQL/config shape below intentionally mirrors it — a
// project-wide convention change to share this plumbing is a separate,
// larger refactor than this fix.
// =====================================================================

const DEFAULT_LANE_FIELD_NAME = 'Lane';
const DEFAULT_STATUS_FIELD_NAME = 'Status';

function die(code, msg) {
  process.stderr.write(`github-state-transition: ${msg}\n`);
  process.exit(code);
}

function expandHome(p) {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

/** Config source order: --config <path> > $COPILOT_PLUGIN_ASSISTANT_CONFIG > ~/.copilot/assistant/config.json (matches github-query.mjs / SKILL.md §3.6.0). */
function loadConfig(explicit) {
  const path = expandHome(explicit || process.env.COPILOT_PLUGIN_ASSISTANT_CONFIG
    || join(homedir(), '.copilot', 'assistant', 'config.json'));
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    die(2, `config not found: ${path}\n  set --config or $COPILOT_PLUGIN_ASSISTANT_CONFIG, or create the file.`);
  }
  try {
    return { cfg: JSON.parse(raw), path };
  } catch (e) {
    return die(2, `config is not valid JSON (${path}): ${e.message}`);
  }
}

function resolveGithubContext(cfg) {
  const g = cfg.github;
  if (!g || !g.owner || !g.repo || g.projectNumber === undefined || g.projectNumber === null || g.projectNumber === '') {
    die(3, 'no "github" block (owner/repo/projectNumber) configured in config.json.');
  }
  const projectNumber = Number(g.projectNumber);
  if (!Number.isSafeInteger(projectNumber) || projectNumber <= 0) {
    die(3, `config.github.projectNumber must be a positive integer (got ${JSON.stringify(g.projectNumber)}).`);
  }
  const laneStatusMap = { ...DEFAULT_LANE_STATUS_MAP, ...((g.fields && g.fields.laneStatusMap) || {}) };
  return {
    owner: g.owner,
    ownerType: g.ownerType === 'org' ? 'org' : 'user',
    repo: g.repo,
    projectNumber,
    projectId: g.projectId || null,
    laneFieldName: (g.fields && g.fields.lane) || DEFAULT_LANE_FIELD_NAME,
    statusFieldName: (g.fields && g.fields.status) || DEFAULT_STATUS_FIELD_NAME,
    // Whether config.github.fields.status was set explicitly (as opposed to
    // just defaulting to "Status") — if so, a missing field on the live
    // project is a hard misconfiguration error rather than a silent no-op
    // (see fetchFieldMeta).
    statusFieldExplicit: !!(g.fields && g.fields.status),
    laneStatusMap,
  };
}

function ghArgsForGraphQL(query, variables) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(variables)) {
    if (v === undefined || v === null) continue;
    args.push('-F', `${k}=${v}`);
  }
  return args;
}

/**
 * Read-only `gh` invocation used before any write (config/current-snapshot
 * resolution): fatal on failure via `die()` since nothing has been touched
 * yet, so there is nothing to converge/re-run.
 */
function runGhJSON(args, { onErrorCode = 4 } = {}) {
  const r = spawnSync('gh', args, { encoding: 'utf8', env: ghEnv });
  if (r.error) {
    if (r.error.code === 'ENOENT') die(onErrorCode, 'the `gh` CLI was not found on PATH.');
    die(onErrorCode, `failed to run gh: ${r.error.message}`);
  }
  if (r.status !== 0) {
    die(onErrorCode, `gh ${args[0]} failed (exit ${r.status}): ${(r.stderr || '').trim().slice(0, 500)}`);
  }
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    die(onErrorCode, `gh returned non-JSON output: ${e.message}`);
  }
}

/**
 * Write/verify `gh` invocation used INSIDE applyStep/fetchLive (i.e. after
 * the transition has started). MUST throw a plain Error rather than call
 * `die()` — executeTransition catches these to do its one convergence
 * re-fetch-and-compare; calling process.exit here would skip that check
 * entirely and defeat the whole point of this module.
 */
function runGhOrThrow(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', env: ghEnv });
  if (r.error) {
    throw new Error(`failed to run gh ${args[0]}: ${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(`gh ${args.slice(0, 2).join(' ')} failed (exit ${r.status}): ${(r.stderr || '').trim().slice(0, 500)}`);
  }
  return r.stdout;
}

function runGhJSONOrThrow(args) {
  const stdout = runGhOrThrow(args);
  try {
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(`gh ${args.slice(0, 2).join(' ')} returned non-JSON output: ${e.message}`);
  }
}

/** Resolve config.github.projectId, falling back to a one-time `gh project view` lookup (SKILL.md §3.6.0's own recommendation) — this is a pre-write read, so it dies loudly rather than silently guessing. */
function resolveProjectId(ctx) {
  if (ctx.projectId) return ctx.projectId;
  const ownerFlag = ['--owner', ctx.owner];
  const data = runGhJSON(['project', 'view', String(ctx.projectNumber), ...ownerFlag, '--format', 'json']);
  if (!data || !data.id) die(4, `could not resolve the project node id for project ${ctx.projectNumber} (owner ${ctx.owner}); set config.github.projectId to skip this lookup.`);
  return data.id;
}

/**
 * Resolve the Lane (required) and Status (best-effort, finding 2) fields'
 * ids and option-name -> option-id maps via `gh project field-list` (a
 * pre-write read — dies loudly on failure). Field-list JSON shape:
 * `{ fields: [{ id, name, type, options?: [{id,name}] }] }`.
 *
 * Status is OPTIONAL: not every project necessarily has (or keeps) a
 * built-in Status field, so a missing one only dies if the caller explicitly
 * configured `config.github.fields.status` (a real misconfiguration);
 * otherwise the CLI simply skips Status handling for that project
 * (`status: null` in the returned object).
 */
function fetchFieldMeta(ctx) {
  const data = runGhJSON(['project', 'field-list', String(ctx.projectNumber), '--owner', ctx.owner, '--format', 'json']);
  const fields = (data && data.fields) || [];

  const laneField = fields.find((f) => f && f.name === ctx.laneFieldName);
  if (!laneField || !laneField.id) {
    die(4, `project ${ctx.projectNumber} has no field named ${JSON.stringify(ctx.laneFieldName)} (checked config.github.fields.lane).`);
  }
  const laneOptionIdByName = {};
  for (const opt of laneField.options || []) {
    if (opt && typeof opt.name === 'string' && opt.id) laneOptionIdByName[opt.name] = opt.id;
  }

  const statusField = fields.find((f) => f && f.name === ctx.statusFieldName);
  let status = null;
  if (statusField && statusField.id) {
    const statusOptionIdByName = {};
    for (const opt of statusField.options || []) {
      if (opt && typeof opt.name === 'string' && opt.id) statusOptionIdByName[opt.name] = opt.id;
    }
    status = { fieldId: statusField.id, optionIdByName: statusOptionIdByName };
  } else if (ctx.statusFieldExplicit) {
    die(4, `project ${ctx.projectNumber} has no field named ${JSON.stringify(ctx.statusFieldName)} (checked config.github.fields.status).`);
  }

  return { lane: { fieldId: laneField.id, optionIdByName: laneOptionIdByName }, status };
}

/** GraphQL query for one issue's open/closed state + its node id (no project data — paginated separately, see below, finding 3). */
function buildIssueStateQuery() {
  return `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) { id state }
  }
}`.trim();
}

/** Pure parse of buildIssueStateQuery()'s response -> `{ issueId, state }` (lowercased). Exported for fixture-based unit testing without a live `gh` call. */
function parseIssueStateResponse(data) {
  const issue = data && data.data && data.data.repository && data.data.repository.issue;
  if (!issue) throw new Error('gh response did not contain the expected repository.issue shape.');
  return {
    issueId: issue.id,
    state: typeof issue.state === 'string' ? issue.state.toLowerCase() : null,
  };
}

/** One page of an issue's projectItems connection (finding 3: paginated via $after). */
function buildProjectItemsPageQuery() {
  return `
query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      projectItems(first: ${PAGE_SIZE}, after: $after) {
        nodes { id project { number } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`.trim();
}

/** Pure parse of one buildProjectItemsPageQuery() page -> `{ items: [{id, projectNumber}], hasNextPage, endCursor }`. Exported for fixture-based unit testing without a live `gh` call. */
function parseProjectItemsPage(data) {
  const conn = data && data.data && data.data.repository && data.data.repository.issue
    && data.data.repository.issue.projectItems;
  if (!conn) throw new Error('gh response did not contain the expected repository.issue.projectItems shape.');
  const items = (conn.nodes || []).map((n) => ({
    id: n && n.id,
    projectNumber: n && n.project && n.project.number,
  }));
  const pageInfo = conn.pageInfo || {};
  return { items, hasNextPage: !!pageInfo.hasNextPage, endCursor: pageInfo.endCursor || null };
}

/** One page of a project item's fieldValues connection (finding 3: paginated via $after), filtered to single-select values only (Lane/Status are both single-select). */
function buildFieldValuesPageQuery() {
  return `
query($itemId: ID!, $after: String) {
  node(id: $itemId) {
    ... on ProjectV2Item {
      fieldValues(first: ${PAGE_SIZE}, after: $after) {
        nodes {
          __typename
          ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`.trim();
}

/** Pure parse of one buildFieldValuesPageQuery() page -> `{ values: [{fieldName, value}], hasNextPage, endCursor }`. Exported for fixture-based unit testing without a live `gh` call. */
function parseFieldValuesPage(data) {
  const conn = data && data.data && data.data.node && data.data.node.fieldValues;
  if (!conn) throw new Error('gh response did not contain the expected node.fieldValues shape.');
  const values = (conn.nodes || [])
    .filter((n) => n && n.__typename === 'ProjectV2ItemFieldSingleSelectValue' && n.field && typeof n.field.name === 'string')
    .map((n) => ({ fieldName: n.field.name, value: typeof n.name === 'string' ? n.name : null }));
  const pageInfo = conn.pageInfo || {};
  return { values, hasNextPage: !!pageInfo.hasNextPage, endCursor: pageInfo.endCursor || null };
}

/**
 * (finding 3) Exhaustively paginate an issue's projectItems connection via
 * the injected `fetchProjectItemsPage(after)` callback (production wiring:
 * a `gh api graphql` call; tests: a canned multi-page fixture sequence)
 * until the item belonging to `projectNumber` is found, or the connection is
 * exhausted (`null`). Throws (rather than silently stopping) if `MAX_PAGES`
 * is exceeded — that indicates a pagination bug or a misbehaving/malicious
 * response, not something safe to truncate quietly.
 */
function findProjectItemId(projectNumber, { fetchProjectItemsPage }) {
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const raw = fetchProjectItemsPage(after);
    const { items, hasNextPage, endCursor } = parseProjectItemsPage(raw);
    const found = items.find((it) => it.projectNumber === projectNumber);
    if (found) return found.id;
    if (!hasNextPage) return null;
    after = endCursor;
  }
  throw new Error(`github-state-transition: exceeded ${MAX_PAGES} projectItems pages without finding project ${projectNumber} or reaching the end — aborting to avoid an infinite pagination loop.`);
}

/**
 * (finding 3) Exhaustively paginate a project item's fieldValues connection
 * via the injected `fetchFieldValuesPage(after)` callback, accumulating every
 * page's single-select values so a Lane/Status field on a later page (a
 * project with 30+ custom fields) is never missed. Same `MAX_PAGES` safety
 * valve as `findProjectItemId`.
 */
function collectFieldValues({ fetchFieldValuesPage }) {
  const all = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const raw = fetchFieldValuesPage(after);
    const { values, hasNextPage, endCursor } = parseFieldValuesPage(raw);
    all.push(...values);
    if (!hasNextPage) return all;
    after = endCursor;
  }
  throw new Error(`github-state-transition: exceeded ${MAX_PAGES} fieldValues pages — aborting to avoid an infinite pagination loop.`);
}

function validateTransitionPreflight(action, {
  chosenLane, current, fieldMeta, laneStatusMap, includeStatus,
}) {
  const plan = planTransition(action, {
    chosenLane, current, laneStatusMap, includeStatus,
  });
  if (!fieldMeta.lane.optionIdByName[plan.expected.lane]) {
    throw new Error(`the configured Lane field has no option named ${JSON.stringify(plan.expected.lane)}`);
  }
  if (plan.expected.checkStatus) {
    if (!fieldMeta.status) {
      throw new Error('the transition requires a derived Status value, but the configured project has no Status field');
    }
    if (!fieldMeta.status.optionIdByName[plan.expected.status]) {
      throw new Error(`the configured Status field has no option named ${JSON.stringify(plan.expected.status)} (derived from Lane ${JSON.stringify(plan.expected.lane)})`);
    }
  }
  return plan;
}

/**
 * Live read of one issue's { issueId, itemId, state, lane, status } — used
 * both as the REQUIRED `current` snapshot (before any write, to decide which
 * steps are still needed) and, reused, as the `fetchLive` convergence check
 * (after writes). Throws (does not die()) so callers made *after* a write
 * has started can be safely caught by `executeTransition`'s one-time
 * re-fetch-and-compare instead of the process exiting mid-transition.
 *
 * Composes the pure pagination helpers above with real `gh api graphql`
 * calls (finding 3): the issue's own state is a single scalar query; its
 * project-item id is found by paginating `projectItems` until the configured
 * project is found; that item's Lane/Status values are found by exhaustively
 * paginating its `fieldValues`.
 */
function fetchSnapshot(ctx, issueNumber) {
  const issueData = runGhJSONOrThrow(ghArgsForGraphQL(buildIssueStateQuery(), {
    owner: ctx.owner, repo: ctx.repo, number: Number(issueNumber),
  }));
  const { issueId, state } = parseIssueStateResponse(issueData);

  const itemId = findProjectItemId(ctx.projectNumber, {
    fetchProjectItemsPage: (after) => runGhJSONOrThrow(ghArgsForGraphQL(buildProjectItemsPageQuery(), {
      owner: ctx.owner, repo: ctx.repo, number: Number(issueNumber), after,
    })),
  });

  let lane = null;
  let status = null;
  if (itemId) {
    const values = collectFieldValues({
      fetchFieldValuesPage: (after) => runGhJSONOrThrow(ghArgsForGraphQL(buildFieldValuesPageQuery(), { itemId, after })),
    });
    const laneEntry = values.find((v) => v.fieldName === ctx.laneFieldName);
    const statusEntry = values.find((v) => v.fieldName === ctx.statusFieldName);
    lane = laneEntry ? laneEntry.value : null;
    status = statusEntry ? statusEntry.value : null;
  }

  return {
    issueId, itemId, state, lane, status,
  };
}

/** Build the applyStep(step) callback for one issue, given the already-resolved Lane/Status field metadata. Every branch throws (never dies) on failure so the caller's convergence check (re-fetch + compare, see executeTransition) always runs instead of the process exiting mid-transition. */
function makeApplyStep(ctx, issueNumber, itemId, laneMeta, statusMeta) {
  return (step) => {
    if (step.type === 'lane') {
      if (!itemId) throw new Error(`issue #${issueNumber} is not on project ${ctx.projectNumber} — cannot set its ${ctx.laneFieldName} field.`);
      const optionId = laneMeta.optionIdByName[step.targetLane];
      if (!optionId) throw new Error(`project ${ctx.projectNumber}'s ${ctx.laneFieldName} field has no option named ${JSON.stringify(step.targetLane)}.`);
      runGhOrThrow(['project', 'item-edit', '--id', itemId, '--project-id', ctx.projectIdResolved, '--field-id', laneMeta.fieldId, '--single-select-option-id', optionId]);
      return { lane: step.targetLane };
    }
    if (step.type === 'status') {
      if (!statusMeta) throw new Error(`project ${ctx.projectNumber} has no ${ctx.statusFieldName} field available — cannot set Status.`);
      if (!itemId) throw new Error(`issue #${issueNumber} is not on project ${ctx.projectNumber} — cannot set its ${ctx.statusFieldName} field.`);
      const optionId = statusMeta.optionIdByName[step.targetStatus];
      if (!optionId) throw new Error(`project ${ctx.projectNumber}'s ${ctx.statusFieldName} field has no option named ${JSON.stringify(step.targetStatus)}.`);
      runGhOrThrow(['project', 'item-edit', '--id', itemId, '--project-id', ctx.projectIdResolved, '--field-id', statusMeta.fieldId, '--single-select-option-id', optionId]);
      return { status: step.targetStatus };
    }
    if (step.type === 'close') {
      runGhOrThrow(['issue', 'close', String(issueNumber), '--repo', `${ctx.owner}/${ctx.repo}`, '--reason', step.reason]);
      return { state: 'closed' };
    }
    if (step.type === 'reopen') {
      runGhOrThrow(['issue', 'reopen', String(issueNumber), '--repo', `${ctx.owner}/${ctx.repo}`]);
      return { state: 'open' };
    }
    throw new Error(`applyStep: unknown step type ${JSON.stringify(step.type)}`);
  };
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i += 1];
      if (v === undefined) die(1, `${a} requires a value`);
      return v;
    };
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '--id': o.id = next(); break;
      case '--lane': o.lane = next(); break;
      case '--config': o.config = next(); break;
      case '--dry-run': o.dryRun = true; break;
      default:
        if (a.startsWith('-')) die(1, `unknown option: ${a}`);
        o._.push(a);
    }
  }
  return o;
}

function printHelp() {
  process.stdout.write([
    'github-state-transition — verified, idempotent complete/archive/reopen/move (assistant-capture §3.6.4)',
    '',
    'Usage:',
    '  github-state-transition complete --id <N> [--config PATH]',
    '  github-state-transition archive  --id <N> [--config PATH]',
    '  github-state-transition reopen   --id <N> [--lane <lane>] [--config PATH]',
    '  github-state-transition move     --id <N> --lane <lane> [--config PATH]',
    '  github-state-transition <action> --id <N> --dry-run     # print the plan, touch nothing',
    '',
    'Convergence, not compensation: each run reads the live state first and only applies',
    'whatever Lane/Status/open-close step is still needed. It never rolls back a partial',
    'failure. If a run fails partway (exit 5 or 6), simply re-run the exact same command —',
    'it is idempotent and will converge by applying only what is still missing.',
    '',
    'Exit codes: 0 ok (fully converged, verified live) · 1 usage · 2 config missing/invalid ·',
    '            3 board not configured · 4 gh CLI/setup error (no write attempted) ·',
    '            5 partial: some/all steps applied but live state does not yet match the',
    '              target — re-run to converge · 6 indeterminate: could not re-read the live',
    '              state after applying steps — outcome unknown, re-run to confirm/converge',
    '',
  ].join('\n'));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts._.length === 0) { printHelp(); return; }
  const action = opts._[0];
  if (!['complete', 'archive', 'reopen', 'move'].includes(action)) die(1, `unknown action ${JSON.stringify(action)} (expected complete|archive|reopen|move)`);
  if (!opts.id) die(1, '--id <issue-number> is required');
  if (!/^[1-9][0-9]*$/.test(opts.id) || !Number.isSafeInteger(Number(opts.id))) {
    die(1, `--id must be a positive integer (got ${JSON.stringify(opts.id)})`);
  }
  if ((action === 'complete' || action === 'archive') && opts.lane) {
    die(1, `--lane is not valid with ${action}`);
  }
  if (action === 'move' && !opts.lane) die(1, 'move requires --lane <lane>');
  if ((action === 'reopen' || action === 'move') && opts.lane && !OPEN_LANES.includes(opts.lane)) {
    die(1, `--lane must be one of: ${OPEN_LANES.join(', ')}`);
  }
  const issueNumber = Number(opts.id);

  const { cfg } = loadConfig(opts.config);
  const ctx = resolveGithubContext(cfg);
  try {
    ghEnv = selectGithubCliEnv(ctx);
  } catch (e) {
    die(4, e && e.message ? e.message : String(e));
  }
  ctx.projectIdResolved = resolveProjectId(ctx);
  const fieldMeta = fetchFieldMeta(ctx);
  const includeStatus = !!fieldMeta.status;
  let current;
  try {
    current = fetchSnapshot(ctx, issueNumber);
  } catch (e) {
    die(4, `could not read issue #${issueNumber} and its project fields before writing: ${e && e.message ? e.message : String(e)}`);
  }
  if (current.state !== 'open' && current.state !== 'closed') {
    die(4, `issue #${issueNumber} not found in ${ctx.owner}/${ctx.repo}.`);
  }
  if (!current.itemId) {
    die(4, `issue #${issueNumber} is not a member of project ${ctx.projectNumber}; no write was attempted.`);
  }
  let plan;
  try {
    plan = validateTransitionPreflight(action, {
      chosenLane: opts.lane,
      current,
      fieldMeta,
      laneStatusMap: ctx.laneStatusMap,
      includeStatus,
    });
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    die(4, `preflight failed; no write was attempted: ${message}`);
  }

  if (opts.dryRun) {
    process.stdout.write(`${JSON.stringify({
      dryRun: true, action, plan, current, priorStatus: deriveStatus(current),
    })}\n`);
    return;
  }

  const applyStep = makeApplyStep(ctx, issueNumber, current.itemId, fieldMeta.lane, fieldMeta.status);
  const fetchLive = () => fetchSnapshot(ctx, issueNumber);
  const result = runTransition(action, {
    chosenLane: opts.lane,
    current,
    applyStep,
    fetchLive,
    laneStatusMap: ctx.laneStatusMap,
    includeStatus,
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.ok) { process.exitCode = 0; return; }
  if (result.indeterminate) { process.exitCode = 6; return; }
  process.exitCode = 5;
}

const isMain = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) main();

export {
  planTransition,
  matchesExpected,
  executeTransition,
  runTransition,
  deriveStatus,
  parseIssueStateResponse,
  parseProjectItemsPage,
  parseFieldValuesPage,
  findProjectItemId,
  collectFieldValues,
  TERMINAL_LANE_BY_ACTION,
  CLOSE_REASON_BY_ACTION,
  TERMINAL_LANES,
  OPEN_LANES,
  DEFAULT_LANE_STATUS_MAP,
  PAGE_SIZE,
  MAX_PAGES,
};
