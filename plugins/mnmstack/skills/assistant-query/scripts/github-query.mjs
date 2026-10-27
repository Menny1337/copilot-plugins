#!/usr/bin/env node
/**
 * github-query.mjs — deterministic GraphQL Projects v2 builder + `gh api graphql`
 * runner for the assistant-query skill (§8b GitHub Personal Board).
 *
 * WHY THIS EXISTS
 *   `ado-query.mjs` owns WIQL mechanics for the ADO personal/team boards. This is
 *   its GitHub-backend twin: once `taskBackend: "github"`, the personal board is a
 *   GitHub Issues + Projects v2 board instead of ADO work items. The agent should
 *   never hand-write GraphQL for a lane the same way it never hand-writes WIQL —
 *   this script owns the mechanics; SKILL.md keeps only the judgment (which lane,
 *   hide-empty/WIP rules, how to render).
 *
 * CONFIG (read at runtime — never hardcoded)
 *   Source order: --config <path>  >  $COPILOT_PLUGIN_ASSISTANT_CONFIG  >
 *                 $COPILOT_PLUGIN_ADO_CONFIG (legacy) > ~/.copilot/assistant/config.json
 *   Personal board (github mode) -> config.github { owner, ownerType, repo,
 *     projectNumber, fields{ lane, priority, kind, dueDate, adoId, workstream, mode },
 *     boardUrl }.
 *   A leading "~" in --config is expanded to the home directory.
 *   `fields` maps the shared lane-catalog concepts (see
 *   assistant-capture/references/task-backend-contract.md) to this project's actual
 *   Projects v2 field names; every key has a sensible default so config only needs
 *   to override a renamed field.
 *
 * USAGE
 *   github-query <lane> [options]             run a named lane (installed command)
 *   github-query --list                       list lanes with descriptions
 *   github-query details --id 123             show one issue + its project fields
 *   github-query <lane> --print-query          print the GraphQL + gh command, run nothing
 *   # portable form, no install needed:  node github-query.mjs <lane> [options]
 *
 * OPTIONS
 *   --priority N              priority lane target (default 1)
 *   --changed-since-days N    done-recent window in days (default 14)
 *   --window all|overdue|today|week   due lane window (default all)
 *   --output table|json       output format (default table)
 *   --print-query / --dry-run print the GraphQL query + resolved gh command; do not execute
 *   --config PATH             config file (see CONFIG above)
 *   --id NUMBER               issue number (with the `details` lane)
 *   --list / --help
 *
 * EXIT CODES: 0 ok · 1 usage/arg error · 2 config missing/invalid ·
 *             3 board not configured (no `github` block) · 4 gh CLI error/not found
 *
 * PAGINATION / TYPED FIELDS / ORDERING
 *   Every page of `items(first: 50, after: $cursor)` is fetched until
 *   `pageInfo.hasNextPage` is false — never just the first page. Pagination
 *   is capped and every next cursor must be non-empty and advance. Each
 *   `ProjectV2ItemFieldValue` union member is parsed by its own `__typename`
 *   (text/number/date/single-select/iteration); an unexpected/missing type for a
 *   configured field degrades to `null` for that field rather than throwing, so one
 *   misconfigured project field never crashes the whole lane. Every lane has a fixed
 *   sort key (see SORTERS below) so re-running an unchanged board returns the same
 *   order every time.
 *
 * INSTALL: the core-agents plugin's sessionStart hook (hooks/link-commands.sh / .ps1)
 *   links this script onto ~/.local/bin as `github-query`, same as `ado-query`.
 *
 * Pure Node, zero deps — mirrors ado-query.mjs and the repo's other *.mjs scripts.
 */

import { realpathSync } from 'node:fs';
import { readAssistantConfig, validateBoard } from '../../../shared/assistant-config.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectGithubCliEnv } from '../../../shared/github-cli-auth.mjs';

// --- Shared field-name defaults (overridable via config.github.fields) -----
const DEFAULT_FIELD_NAMES = {
  lane: 'Lane',
  priority: 'Priority',
  kind: 'Kind',
  dueDate: 'Due date',
  adoId: 'ADO ID',
  workstream: 'Workstream',
  mode: 'Mode',
};

const PAGE_SIZE = 50;
const MAX_PAGES = 200;
let ghEnv = process.env;
// Field values per project item are paginated too: a project with many custom
// fields (or many labels-as-fields, iterations, etc.) can exceed a single
// page. FIELD_VALUES_PAGE_SIZE stays modest (not "just raise the limit and
// hope") because pagination below is real — any item whose fieldValues
// connection reports `hasNextPage` gets its remaining pages fetched via a
// dedicated per-item `node(id:...)` follow-up query before normalization, so
// Lane/Priority/Due (or any other field) is never silently omitted merely
// because it happened to sort past the first page.
const FIELD_VALUES_PAGE_SIZE = 30;

// --- GraphQL query construction ---------------------------------------------------
// One field-value fragment per ProjectV2ItemFieldValue union member we understand.
// Unknown/unsupported member types are simply absent from the response and ignored.
const FIELD_VALUE_FRAGMENTS = `
    __typename
    ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
    ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
    ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
    ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
    ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { name } } }`;

function buildItemsQuery(ownerType) {
  const ownerField = ownerType === 'org' ? 'organization' : 'user';
  return `
query($login: String!, $number: Int!, $after: String) {
  ${ownerField}(login: $login) {
    projectV2(number: $number) {
      id
      items(first: ${PAGE_SIZE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            __typename
            ... on Issue {
              number
              title
              url
              state
              createdAt
              updatedAt
              closedAt
              labels(first: 20) { nodes { name } }
            }
          }
          fieldValues(first: ${FIELD_VALUES_PAGE_SIZE}) {
            pageInfo { hasNextPage endCursor }
            nodes {${FIELD_VALUE_FRAGMENTS}
            }
          }
        }
      }
    }
  }
}`.trim();
}

function buildIssueDetailsQuery() {
  return `
query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      number
      title
      url
      state
      createdAt
      updatedAt
      closedAt
      body
      labels(first: 20) { nodes { name } }
      projectItems(first: ${PAGE_SIZE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          project { number }
          fieldValues(first: ${FIELD_VALUES_PAGE_SIZE}) {
            pageInfo { hasNextPage endCursor }
            nodes {${FIELD_VALUE_FRAGMENTS}
            }
          }
        }
      }
    }
  }
}`.trim();
}

/**
 * Follow-up query for one project item's REMAINING fieldValues pages, by the
 * item's own global node id — used when the first page (embedded in
 * buildItemsQuery/buildIssueDetailsQuery) reports `hasNextPage: true`.
 */
function buildFieldValuesPageQuery() {
  return `
query($id: ID!, $after: String) {
  node(id: $id) {
    ... on ProjectV2Item {
      fieldValues(first: ${FIELD_VALUES_PAGE_SIZE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {${FIELD_VALUE_FRAGMENTS}
        }
      }
    }
  }
}`.trim();
}

// --- Typed field-value parsing (safe: never throws on a shape mismatch) ----------
function parseFieldValueNodes(nodes) {
  const out = {};
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const name = n.field && typeof n.field.name === 'string' ? n.field.name : null;
    if (!name) continue;
    switch (n.__typename) {
      case 'ProjectV2ItemFieldTextValue':
        out[name] = typeof n.text === 'string' ? n.text : null;
        break;
      case 'ProjectV2ItemFieldNumberValue':
        out[name] = typeof n.number === 'number' ? n.number : null;
        break;
      case 'ProjectV2ItemFieldDateValue':
        out[name] = typeof n.date === 'string' ? n.date : null;
        break;
      case 'ProjectV2ItemFieldSingleSelectValue':
        out[name] = typeof n.name === 'string' ? n.name : null;
        break;
      case 'ProjectV2ItemFieldIterationValue':
        out[name] = typeof n.title === 'string' ? n.title : null;
        break;
      default:
        // Unknown/unsupported member type — degrade to absent rather than throw.
        break;
    }
  }
  return out;
}

/** Parse "P1"/"P2"/"P3" or a bare number into an integer; anything else -> null. */
function parsePriority(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const m = String(raw).match(/-?\d+/);
  return m ? Number.parseInt(m[0], 10) : null;
}

/** Parse a date-only field into "YYYY-MM-DD"; anything unparsable -> null. */
function parseDateOnly(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function normalizeItem(node, fieldNames) {
  const content = node && node.content;
  if (!content || content.__typename !== 'Issue') return null;
  const values = parseFieldValueNodes(node.fieldValues && node.fieldValues.nodes);
  const labels = (content.labels && content.labels.nodes) || [];
  return {
    number: content.number,
    title: content.title,
    url: content.url,
    state: content.state, // 'OPEN' | 'CLOSED'
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
    closedAt: content.closedAt || null,
    labels: labels.map((l) => l.name),
    lane: values[fieldNames.lane] ?? null,
    priority: parsePriority(values[fieldNames.priority]),
    kind: values[fieldNames.kind] ?? null,
    dueDate: parseDateOnly(values[fieldNames.dueDate]),
    adoId: values[fieldNames.adoId] ?? null,
    workstream: values[fieldNames.workstream] ?? null,
    mode: values[fieldNames.mode] ?? null,
  };
}

// --- Deterministic sorters (every lane names exactly one of these) ---------------
function byNumberAsc(a, b) { return a.number - b.number; }
function byPriorityThenDueThenNumber(a, b) {
  const pa = a.priority ?? Number.POSITIVE_INFINITY;
  const pb = b.priority ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  const da = a.dueDate ?? '9999-99-99';
  const db = b.dueDate ?? '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
  return byNumberAsc(a, b);
}
function byPriorityThenCreatedThenNumber(a, b) {
  const pa = a.priority ?? Number.POSITIVE_INFINITY;
  const pb = b.priority ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  const ca = a.createdAt ?? '';
  const cb = b.createdAt ?? '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  return byNumberAsc(a, b);
}
function byUpdatedDesc(a, b) {
  const ua = a.updatedAt ?? '';
  const ub = b.updatedAt ?? '';
  if (ua !== ub) return ua < ub ? 1 : -1;
  return byNumberAsc(a, b);
}
function byUpdatedAsc(a, b) {
  const ua = a.updatedAt ?? '';
  const ub = b.updatedAt ?? '';
  if (ua !== ub) return ua < ub ? -1 : 1;
  return byNumberAsc(a, b);
}
function byDueThenNumber(a, b) {
  const da = a.dueDate ?? '9999-99-99';
  const db = b.dueDate ?? '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
  return byNumberAsc(a, b);
}

// --- Lane predicates ---------------------------------------------------------------
const isOpen = (i) => i.state === 'OPEN';
const isClosed = (i) => i.state === 'CLOSED';

function daysSince(isoTs, now = Date.now()) {
  if (!isoTs) return Number.POSITIVE_INFINITY;
  const t = Date.parse(isoTs);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (now - t) / 86_400_000;
}

function dueWindow(item, window, today, referenceMs) {
  if (!item.dueDate) return false;
  const ref = today ?? new Date(referenceMs ?? Date.now()).toISOString().slice(0, 10);
  switch (window) {
    case 'overdue': return item.dueDate < ref;
    case 'today': return item.dueDate === ref;
    case 'week': {
      const base = referenceMs ?? Date.parse(`${ref}T00:00:00Z`) ?? Date.now();
      const weekOut = new Date(base + 7 * 86_400_000).toISOString().slice(0, 10);
      return item.dueDate >= ref && item.dueDate <= weekOut;
    }
    case 'all':
    default:
      return true;
  }
}

/**
 * The lane catalog. Faithful to the shared table in
 * assistant-capture/references/task-backend-contract.md ("Lane catalog"). Each entry
 * is a pure `{ desc, filter(items, opts, now), sort }` so lane logic is unit-testable
 * without any network access.
 */
const LANES = {
  'all-open': {
    desc: 'All open personal items (every non-done/non-archive lane).',
    filter: (items) => items.filter(isOpen),
    sort: byPriorityThenDueThenNumber,
  },
  active: {
    desc: 'Lane = Active — in-flight (WIP target 3).',
    filter: (items) => items.filter((i) => isOpen(i) && i.lane === 'Active'),
    sort: byPriorityThenDueThenNumber,
  },
  'needs-me': {
    desc: 'Lane = Needs Me — your attention queue (WIP target 5).',
    filter: (items) => items.filter((i) => isOpen(i) && i.lane === 'Needs Me'),
    sort: byUpdatedDesc,
  },
  'up-next': {
    desc: 'Lane = Up Next — queued short-list (WIP target 5).',
    filter: (items) => items.filter((i) => isOpen(i) && i.lane === 'Up Next'),
    sort: byPriorityThenDueThenNumber,
  },
  blocked: {
    desc: 'Lane = Blocked — waiting on an external party (WIP target 3).',
    filter: (items) => items.filter((i) => isOpen(i) && i.lane === 'Blocked'),
    sort: byNumberAsc,
  },
  backlog: {
    desc: 'Lane = Backlog — not yet promoted (mirrors ADO board column "New").',
    filter: (items) => items.filter((i) => isOpen(i) && i.lane === 'Backlog'),
    sort: byPriorityThenCreatedThenNumber,
  },
  'done-24h': {
    desc: 'Lane = Done, closed in the last 24h (daily momentum recap).',
    filter: (items, _opts, now) => items.filter(
      (i) => isClosed(i) && i.lane === 'Done' && daysSince(i.closedAt || i.updatedAt, now) <= 1,
    ),
    sort: byUpdatedDesc,
  },
  'done-recent': {
    desc: 'Lane = Done, closed recently (--changed-since-days, default 14; weekly uses 7).',
    filter: (items, opts, now) => items.filter(
      (i) => isClosed(i) && i.lane === 'Done'
        && daysSince(i.closedAt || i.updatedAt, now) <= (opts.since ?? 14),
    ),
    sort: byUpdatedDesc,
  },
  stale: {
    desc: 'Open but untouched for 7+ days (any non-done/non-archive lane).',
    filter: (items, _opts, now) => items.filter((i) => isOpen(i) && daysSince(i.updatedAt, now) >= 7),
    sort: byUpdatedAsc,
  },
  due: {
    desc: 'Open items carrying a due date (--window all|overdue|today|week, default all).',
    filter: (items, opts, now) => items.filter(
      (i) => isOpen(i) && dueWindow(i, opts.window || 'all', undefined, now),
    ),
    sort: byDueThenNumber,
  },
  priority: {
    desc: 'Open items at a given priority (--priority, default 1).',
    filter: (items, opts) => items.filter((i) => isOpen(i) && i.priority === (opts.priority ?? 1)),
    sort: byDueThenNumber,
  },
  archive: {
    desc: 'Lane = Archive (opt-in only — never in briefings).',
    filter: (items) => items.filter((i) => isClosed(i) && i.lane === 'Archive'),
    sort: byUpdatedDesc,
  },
};

function classify(items, laneName, opts, now = Date.now()) {
  const lane = LANES[laneName];
  if (!lane) return null;
  return lane.filter(items, opts, now).slice().sort(lane.sort);
}

// --- Config / arg plumbing (mirrors ado-query.mjs) --------------------------------
function die(code, msg) {
  process.stderr.write(`github-query: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const o = { _: [], output: 'table' };
  const positiveInteger = (flag, raw) => {
    if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      die(1, `${flag} must be a positive integer (got ${JSON.stringify(raw)})`);
    }
    return Number(raw);
  };
  const nonNegativeInteger = (flag, raw) => {
    if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      die(1, `${flag} must be a non-negative integer (got ${JSON.stringify(raw)})`);
    }
    return Number(raw);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) die(1, `${a} requires a value`);
      return v;
    };
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '--list': o.list = true; break;
      case '--print-query': case '--print-wiql': case '--dry-run': o.print = true; break;
      case '--priority': o.priority = positiveInteger(a, next()); break;
      case '--changed-since-days': o.since = nonNegativeInteger(a, next()); break;
      case '--window': {
        o.window = next();
        if (!['all', 'overdue', 'today', 'week'].includes(o.window)) {
          die(1, `--window must be one of: all, overdue, today, week (got ${JSON.stringify(o.window)})`);
        }
        break;
      }
      case '--output': case '-o': {
        o.output = next();
        if (!['table', 'json'].includes(o.output)) {
          die(1, `${a} must be one of: table, json (got ${JSON.stringify(o.output)})`);
        }
        break;
      }
      case '--config': o.config = next(); break;
      case '--id': o.id = positiveInteger(a, next()); break;
      default:
        if (a.startsWith('-')) die(1, `unknown option: ${a}`);
        o._.push(a);
    }
  }
  return o;
}

function loadConfig(explicit) {
  try {
    return readAssistantConfig(explicit);
  } catch (e) {
    return die(2, e.message);
  }
}

function resolveGithubContext(cfg) {
  try { validateBoard(cfg, 'github'); }
  catch (e) { die(3, e.message); }
  const g = cfg.github;
  const projectNumber = Number(g.projectNumber);
  return {
    owner: g.owner,
    ownerType: g.ownerType === 'org' ? 'org' : 'user',
    repo: g.repo,
    projectNumber,
    fields: { ...DEFAULT_FIELD_NAMES, ...(g.fields || {}) },
    boardUrl: g.boardUrl || null,
  };
}

function ghArgsFor(query, variables) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(variables)) {
    if (v === undefined || v === null) continue;
    args.push('-F', `${k}=${v}`);
  }
  return args;
}

function runGh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', env: ghEnv });
  if (r.error) {
    if (r.error.code === 'ENOENT') die(4, 'the `gh` CLI was not found on PATH.');
    die(4, `failed to run gh: ${r.error.message}`);
  }
  if (r.status !== 0) {
    die(4, `gh api graphql failed (exit ${r.status}): ${(r.stderr || '').trim().slice(0, 500)}`);
  }
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    die(4, `gh returned non-JSON output: ${e.message}`);
  }
}

/**
 * Given one project item's already-fetched first fieldValues page, exhaust
 * any remaining pages via `node(id:...)` follow-up queries and return the
 * COMPLETE merged nodes array. A field value sorted past the first page (e.g.
 * Lane/Priority/Due on a project with many custom fields) is never silently
 * dropped — this is real pagination, not just a larger first-page guess.
 */
function fetchAllFieldValueNodes(itemId, firstPage) {
  const nodes = [...((firstPage && firstPage.nodes) || [])];
  let pageInfo = firstPage && firstPage.pageInfo;
  const query = buildFieldValuesPageQuery();
  let after = null;
  let pageCount = 1;
  while (pageInfo && pageInfo.hasNextPage) {
    if (pageCount >= MAX_PAGES) {
      die(4, `exceeded ${MAX_PAGES} fieldValues pages for project item ${itemId}; aborting to avoid an infinite pagination loop.`);
    }
    if (!itemId) die(4, 'a project item reported additional fieldValues pages but has no node id to page through them.');
    const nextCursor = pageInfo.endCursor;
    if (typeof nextCursor !== 'string' || !nextCursor || nextCursor === after) {
      die(4, `fieldValues pagination for project item ${itemId} did not provide a new non-empty cursor.`);
    }
    after = nextCursor;
    const data = runGh(ghArgsFor(query, { id: itemId, after }));
    const nextPage = data && data.data && data.data.node && data.data.node.fieldValues;
    if (!nextPage) die(4, 'gh response did not contain the expected fieldValues page shape for a paginated follow-up.');
    nodes.push(...(nextPage.nodes || []));
    pageInfo = nextPage.pageInfo;
    pageCount += 1;
  }
  return nodes;
}

/** Fetch every page of Project v2 items, exhausting cursor pagination. */
function fetchAllProjectItems(ctx) {
  const query = buildItemsQuery(ctx.ownerType);
  const ownerKey = ctx.ownerType === 'org' ? 'organization' : 'user';
  const items = [];
  let after = null;
  for (let pageCount = 0; pageCount < MAX_PAGES; pageCount += 1) {
    const variables = { login: ctx.owner, number: ctx.projectNumber, after };
    const data = runGh(ghArgsFor(query, variables));
    const project = data && data.data && data.data[ownerKey] && data.data[ownerKey].projectV2;
    if (!project) die(4, 'gh response did not contain the expected projectV2 shape.');
    const page = project.items;
    if (!page) die(4, 'gh response did not contain the expected projectV2.items shape.');
    for (const node of page.nodes || []) {
      const allFieldValueNodes = fetchAllFieldValueNodes(node.id, node.fieldValues);
      const norm = normalizeItem({ ...node, fieldValues: { nodes: allFieldValueNodes } }, ctx.fields);
      if (norm) items.push(norm);
    }
    if (!page.pageInfo || !page.pageInfo.hasNextPage) break;
    const nextCursor = page.pageInfo.endCursor;
    if (typeof nextCursor !== 'string' || !nextCursor || nextCursor === after) {
      die(4, 'project items pagination did not provide a new non-empty cursor.');
    }
    after = nextCursor;
    if (pageCount === MAX_PAGES - 1) {
      die(4, `exceeded ${MAX_PAGES} project item pages; aborting to avoid an infinite pagination loop.`);
    }
  }
  return items;
}

function fetchIssueDetails(ctx, id) {
  const query = buildIssueDetailsQuery();
  let after = null;
  let issue = null;
  for (let pageCount = 0; pageCount < MAX_PAGES; pageCount += 1) {
    const data = runGh(ghArgsFor(query, {
      owner: ctx.owner, repo: ctx.repo, number: Number(id), after,
    }));
    issue = data && data.data && data.data.repository && data.data.repository.issue;
    if (!issue) die(4, `issue #${id} not found in ${ctx.owner}/${ctx.repo}.`);
    const projectItems = issue.projectItems;
    if (!projectItems) die(4, 'gh response did not contain the expected issue.projectItems shape.');
    const projItem = (projectItems.nodes || [])
      .find((n) => n.project && n.project.number === ctx.projectNumber);
    if (projItem) {
      const allFieldValueNodes = fetchAllFieldValueNodes(projItem.id, projItem.fieldValues);
      const fieldNode = { content: { __typename: 'Issue', ...issue }, fieldValues: { nodes: allFieldValueNodes } };
      return normalizeItem(fieldNode, ctx.fields);
    }
    if (!projectItems.pageInfo || !projectItems.pageInfo.hasNextPage) {
      const fieldNode = { content: { __typename: 'Issue', ...issue }, fieldValues: { nodes: [] } };
      return normalizeItem(fieldNode, ctx.fields);
    }
    const nextCursor = projectItems.pageInfo.endCursor;
    if (typeof nextCursor !== 'string' || !nextCursor || nextCursor === after) {
      die(4, `issue #${id} projectItems pagination did not provide a new non-empty cursor.`);
    }
    after = nextCursor;
    if (pageCount === MAX_PAGES - 1) {
      die(4, `exceeded ${MAX_PAGES} issue projectItems pages for issue #${id}; aborting to avoid an infinite pagination loop.`);
    }
  }
  die(4, `exceeded ${MAX_PAGES} issue projectItems pages for issue #${id}; aborting to avoid an infinite pagination loop.`);
}

// --- Rendering ----------------------------------------------------------------------
function renderTable(items) {
  if (items.length === 0) return '(no items)\n';
  const lines = items.map((i) => {
    const p = i.priority !== null ? `P${i.priority}` : '--';
    const due = i.dueDate ? ` due ${i.dueDate}` : '';
    const lane = i.lane ? ` [${i.lane}]` : '';
    return `#${i.number}  ${p}  ${i.title}${lane}${due}`;
  });
  return `${lines.join('\n')}\n`;
}

function printHelp() {
  process.stdout.write([
    'github-query — GraphQL Projects v2 builder + `gh api graphql` runner (assistant-query §8b)',
    '',
    'Usage:',
    '  github-query <lane> [options]          run a named lane',
    '  github-query --list                    list lanes with descriptions',
    '  github-query details --id <N>          show one issue',
    '  (portable, no install: node github-query.mjs <lane> [options])',
    '',
    'Common options: --priority N  --changed-since-days N  --window all|overdue|today|week',
    '  --output table|json  --print-query  --config PATH',
    '',
    'Run `github-query --list` for the lane catalog.',
    '',
  ].join('\n'));
}

function printList() {
  const rows = Object.entries(LANES).map(([n, l]) => `  ${n.padEnd(14)} ${l.desc}`);
  process.stdout.write(`Personal board lanes (config.github):\n${rows.join('\n')}\n\n` +
    'Special:\n  details        show one issue (needs --id)\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (opts._.length === 0 && !opts.list)) { printHelp(); return; }
  if (opts.list) { printList(); return; }

  const laneName = opts._[0];
  const { cfg } = loadConfig(opts.config);
  const ctx = resolveGithubContext(cfg);

  if (laneName === 'details') {
    if (!opts.id) die(1, 'details requires --id <N>');
    if (opts.print) {
      process.stdout.write(`# details --id ${opts.id}  (${ctx.owner}/${ctx.repo})\n`);
      process.stdout.write(`${buildIssueDetailsQuery()}\n\n`);
      return;
    }
    try {
      ghEnv = selectGithubCliEnv(ctx);
    } catch (e) {
      die(4, e && e.message ? e.message : String(e));
    }
    const item = fetchIssueDetails(ctx, opts.id);
    process.stdout.write(opts.output === 'json' ? `${JSON.stringify(item, null, 2)}\n` : renderTable([item]));
    return;
  }

  const lane = LANES[laneName];
  if (!lane) die(1, `unknown lane: ${laneName}\n  run \`github-query --list\` for choices.`);

  if (opts.print) {
    process.stdout.write(`# lane: ${laneName}  (${ctx.owner}/${ctx.repo} project #${ctx.projectNumber})\n`);
    process.stdout.write(`${buildItemsQuery(ctx.ownerType)}\n\n`);
    process.stdout.write(`gh api graphql -f query=<above> -F login=${ctx.owner} -F number=${ctx.projectNumber} -F after=<cursor>\n`);
    return;
  }

  try {
    ghEnv = selectGithubCliEnv(ctx);
  } catch (e) {
    die(4, e && e.message ? e.message : String(e));
  }
  const items = fetchAllProjectItems(ctx);
  const result = classify(items, laneName, opts);
  process.stdout.write(opts.output === 'json' ? `${JSON.stringify(result, null, 2)}\n` : renderTable(result));
}

const isMain = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) main();

export {
  LANES,
  classify,
  normalizeItem,
  parseFieldValueNodes,
  parsePriority,
  parseDateOnly,
  buildItemsQuery,
  buildIssueDetailsQuery,
  buildFieldValuesPageQuery,
  fetchAllFieldValueNodes,
  resolveGithubContext,
  fetchAllProjectItems,
  fetchIssueDetails,
  dueWindow,
  daysSince,
  ghArgsFor,
  MAX_PAGES,
};
