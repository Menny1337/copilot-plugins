#!/usr/bin/env node
// github-query.test.mjs — node:test coverage for the GitHub Projects v2 query
// helper: typed-field parsing, the full lane catalog, deterministic ordering,
// cursor-pagination exhaustion, CLI config/error behavior, and mixed
// GitHub-personal + ADO-team board routing (assistant-query §8/§8a/§8c).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LANES,
  classify,
  normalizeItem,
  parseFieldValueNodes,
  parsePriority,
  parseDateOnly,
  buildItemsQuery,
  buildIssueDetailsQuery,
  resolveGithubContext,
  dueWindow,
  daysSince,
  ghArgsFor,
  fetchAllFieldValueNodes,
} from '../github-query.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'github-query.mjs');
const ADO_SCRIPT = join(HERE, '..', 'ado-query.mjs');

function mkIssue({
  number, title = `Issue ${number}`, state = 'OPEN', lane = null, priority = null,
  dueDate = null, createdAt = '2026-01-01T00:00:00Z', updatedAt = '2026-01-01T00:00:00Z',
  closedAt = null, kind = null,
}) {
  const fieldValues = [];
  if (lane !== null) fieldValues.push({ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: lane, field: { name: 'Lane' } });
  if (priority !== null) fieldValues.push({ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: `P${priority}`, field: { name: 'Priority' } });
  if (dueDate !== null) fieldValues.push({ __typename: 'ProjectV2ItemFieldDateValue', date: dueDate, field: { name: 'Due date' } });
  if (kind !== null) fieldValues.push({ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: kind, field: { name: 'Kind' } });
  const node = {
    id: `node-${number}`,
    content: {
      __typename: 'Issue', number, title, url: `https://github.com/o/r/issues/${number}`,
      state, createdAt, updatedAt, closedAt, labels: { nodes: [] },
    },
    fieldValues: { nodes: fieldValues },
  };
  return normalizeItem(node, { lane: 'Lane', priority: 'Priority', kind: 'Kind', dueDate: 'Due date', adoId: 'ADO ID', workstream: 'Workstream', mode: 'Mode' });
}

// ---------------------------------------------------------------------------------
describe('typed field-value parsing', () => {
  test('parsePriority reads "P1".."P3" and bare numbers, else null', () => {
    assert.equal(parsePriority('P1'), 1);
    assert.equal(parsePriority('P3'), 3);
    assert.equal(parsePriority(2), 2);
    assert.equal(parsePriority(null), null);
    assert.equal(parsePriority(undefined), null);
    assert.equal(parsePriority('unset'), null);
  });

  test('parseDateOnly normalizes an ISO datetime to YYYY-MM-DD, else null', () => {
    assert.equal(parseDateOnly('2026-05-01'), '2026-05-01');
    assert.equal(parseDateOnly('2026-05-01T00:00:00Z'), '2026-05-01');
    assert.equal(parseDateOnly(''), null);
    assert.equal(parseDateOnly(null), null);
    assert.equal(parseDateOnly('not-a-date'), null);
  });

  test('parseFieldValueNodes handles every supported __typename', () => {
    const nodes = [
      { __typename: 'ProjectV2ItemFieldTextValue', text: 'hello', field: { name: 'Workstream' } },
      { __typename: 'ProjectV2ItemFieldNumberValue', number: 42, field: { name: 'ADO ID' } },
      { __typename: 'ProjectV2ItemFieldDateValue', date: '2026-06-01', field: { name: 'Due date' } },
      { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'Active', field: { name: 'Lane' } },
      { __typename: 'ProjectV2ItemFieldIterationValue', title: 'Sprint 1', field: { name: 'Iteration' } },
    ];
    const parsed = parseFieldValueNodes(nodes);
    assert.equal(parsed.Workstream, 'hello');
    assert.equal(parsed['ADO ID'], 42);
    assert.equal(parsed['Due date'], '2026-06-01');
    assert.equal(parsed.Lane, 'Active');
    assert.equal(parsed.Iteration, 'Sprint 1');
  });

  test('an unknown/unsupported field-value __typename degrades to absent, never throws', () => {
    const nodes = [
      { __typename: 'ProjectV2ItemFieldRepositoryValue', repository: { name: 'x' }, field: { name: 'Repo' } },
      { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'Active', field: { name: 'Lane' } },
    ];
    assert.doesNotThrow(() => parseFieldValueNodes(nodes));
    const parsed = parseFieldValueNodes(nodes);
    assert.equal(parsed.Repo, undefined);
    assert.equal(parsed.Lane, 'Active');
  });

  test('a field value with a missing/malformed field.name is skipped safely', () => {
    const nodes = [
      { __typename: 'ProjectV2ItemFieldTextValue', text: 'orphan' },
      null,
      { __typename: 'ProjectV2ItemFieldTextValue', text: 'ok', field: { name: 'Workstream' } },
    ];
    assert.doesNotThrow(() => parseFieldValueNodes(nodes));
    assert.deepEqual(parseFieldValueNodes(nodes), { Workstream: 'ok' });
  });

  test('normalizeItem returns null for a non-Issue content node (e.g. a draft item)', () => {
    const node = { content: { __typename: 'DraftIssue', title: 'draft' }, fieldValues: { nodes: [] } };
    assert.equal(normalizeItem(node, { lane: 'Lane' }), null);
  });
});

// ---------------------------------------------------------------------------------
describe('lane catalog — every required lane exists with a filter and sort', () => {
  const required = [
    'all-open', 'active', 'needs-me', 'up-next', 'blocked', 'backlog',
    'done-24h', 'done-recent', 'stale', 'due', 'priority',
  ];
  for (const name of required) {
    test(`lane "${name}" is registered`, () => {
      assert.ok(LANES[name], `expected LANES.${name} to exist`);
      assert.equal(typeof LANES[name].filter, 'function');
      assert.equal(typeof LANES[name].sort, 'function');
    });
  }

  test('archive is registered but excluded from all-open', () => {
    assert.ok(LANES.archive);
  });
});

describe('lane classification semantics', () => {
  const now = Date.parse('2026-06-15T00:00:00Z');
  const items = [
    mkIssue({ number: 1, lane: 'Active', priority: 2, state: 'OPEN', updatedAt: '2026-06-14T00:00:00Z' }),
    mkIssue({ number: 2, lane: 'Needs Me', priority: 1, state: 'OPEN', updatedAt: '2026-06-13T00:00:00Z' }),
    mkIssue({ number: 3, lane: 'Up Next', priority: 3, state: 'OPEN', updatedAt: '2026-06-10T00:00:00Z' }),
    mkIssue({ number: 4, lane: 'Blocked', priority: 1, state: 'OPEN' }),
    mkIssue({ number: 5, lane: 'Backlog', priority: null, state: 'OPEN', createdAt: '2026-06-01T00:00:00Z' }),
    mkIssue({ number: 6, lane: 'Backlog', priority: 2, state: 'OPEN', createdAt: '2026-06-02T00:00:00Z' }),
    mkIssue({ number: 7, lane: 'Done', state: 'CLOSED', closedAt: '2026-06-14T12:00:00Z' }),
    mkIssue({ number: 8, lane: 'Done', state: 'CLOSED', closedAt: '2026-06-01T00:00:00Z' }),
    mkIssue({ number: 9, lane: 'Archive', state: 'CLOSED' }),
    mkIssue({ number: 10, lane: null, priority: null, state: 'OPEN', updatedAt: '2026-06-01T00:00:00Z' }), // stale, no lane
    mkIssue({ number: 11, lane: 'Backlog', priority: 1, state: 'OPEN', dueDate: '2026-06-16' }), // due tomorrow (window=week)
    mkIssue({ number: 12, lane: 'Backlog', priority: 1, state: 'OPEN', dueDate: '2026-06-01' }), // overdue
    mkIssue({ number: 13, lane: 'Backlog', priority: 1, state: 'OPEN', dueDate: '2026-06-15' }), // due today
  ];

  test('all-open: every OPEN item regardless of lane, excludes CLOSED (Done/Archive)', () => {
    const out = classify(items, 'all-open', {}, now).map((i) => i.number);
    assert.deepEqual(out.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 10, 11, 12, 13]);
  });

  test('active / needs-me / up-next / blocked / backlog each scope to their exact Lane + OPEN', () => {
    assert.deepEqual(classify(items, 'active', {}, now).map((i) => i.number), [1]);
    assert.deepEqual(classify(items, 'needs-me', {}, now).map((i) => i.number), [2]);
    assert.deepEqual(classify(items, 'up-next', {}, now).map((i) => i.number), [3]);
    assert.deepEqual(classify(items, 'blocked', {}, now).map((i) => i.number), [4]);
    const backlog = classify(items, 'backlog', {}, now).map((i) => i.number);
    assert.deepEqual(backlog.sort((a, b) => a - b), [5, 6, 11, 12, 13]);
  });

  test('done-24h only includes Done items closed within 1 day of "now"', () => {
    assert.deepEqual(classify(items, 'done-24h', {}, now).map((i) => i.number), [7]);
  });

  test('done-recent honors --changed-since-days (opts.since)', () => {
    assert.deepEqual(classify(items, 'done-recent', { since: 1 }, now).map((i) => i.number), [7]);
    const wide = classify(items, 'done-recent', { since: 30 }, now).map((i) => i.number);
    assert.deepEqual(wide.sort((a, b) => a - b), [7, 8]);
  });

  test('stale: item #10 (missing lane, untouched since 2026-06-01) qualifies at a 14-day reference', () => {
    const out = classify(items, 'stale', {}, Date.parse('2026-06-15T00:00:00Z')).map((i) => i.number);
    assert.ok(out.includes(10), 'expected item #10 (no lane, 14d stale) in the stale lane');
  });

  test('stale excludes archive/done and requires open + old updatedAt', () => {
    const staleNow = Date.parse('2026-06-20T00:00:00Z');
    const out = classify(items, 'stale', {}, staleNow).map((i) => i.number).sort((a, b) => a - b);
    // items updated far enough back and still OPEN
    assert.ok(out.includes(3));
    assert.ok(out.includes(10));
    assert.ok(!out.includes(7)); // closed, excluded
    assert.ok(!out.includes(9)); // archive, excluded
  });

  test('priority filters open items at the exact --priority (default 1)', () => {
    const p1 = classify(items, 'priority', {}, now).map((i) => i.number).sort((a, b) => a - b);
    assert.deepEqual(p1, [2, 4, 11, 12, 13]);
    const p2 = classify(items, 'priority', { priority: 2 }, now).map((i) => i.number).sort((a, b) => a - b);
    assert.deepEqual(p2, [1, 6]);
  });

  test('due lane windows: all / overdue / today / week', () => {
    const all = classify(items, 'due', { window: 'all' }, now).map((i) => i.number).sort((a, b) => a - b);
    assert.deepEqual(all, [11, 12, 13]);
    const overdue = classify(items, 'due', { window: 'overdue' }, now).map((i) => i.number);
    assert.deepEqual(overdue, [12]);
    const today = classify(items, 'due', { window: 'today' }, now).map((i) => i.number);
    assert.deepEqual(today, [13]);
  });

  test('archive lane only returns Lane=Archive closed items, and is never in all-open', () => {
    assert.deepEqual(classify(items, 'archive', {}, now).map((i) => i.number), [9]);
    assert.ok(!classify(items, 'all-open', {}, now).some((i) => i.number === 9));
    assert.ok(!classify(items, 'all-open', {}, now).some((i) => i.number === 7));
  });

  test('unknown lane name returns null (caller reports "unknown lane")', () => {
    assert.equal(classify(items, 'not-a-lane', {}, now), null);
  });
});

describe('deterministic ordering', () => {
  test('active sorts by priority ascending, then due date ascending, then issue number', () => {
    const items = [
      mkIssue({ number: 3, lane: 'Active', priority: 2, dueDate: '2026-06-10' }),
      mkIssue({ number: 1, lane: 'Active', priority: 1, dueDate: '2026-06-20' }),
      mkIssue({ number: 2, lane: 'Active', priority: 1, dueDate: '2026-06-05' }),
      mkIssue({ number: 4, lane: 'Active', priority: null }),
    ];
    const out = classify(items, 'active', {}, Date.now()).map((i) => i.number);
    assert.deepEqual(out, [2, 1, 3, 4]);
  });

  test('classifying the same unchanged input twice yields byte-identical order', () => {
    const items = [
      mkIssue({ number: 5, lane: 'Backlog', priority: 3 }),
      mkIssue({ number: 2, lane: 'Backlog', priority: 1 }),
      mkIssue({ number: 8, lane: 'Backlog', priority: 1 }),
    ];
    const a = classify(items, 'backlog', {}, Date.now()).map((i) => i.number);
    const b = classify(items, 'backlog', {}, Date.now()).map((i) => i.number);
    assert.deepEqual(a, b);
    assert.deepEqual(a, [2, 8, 5]);
  });

  test('needs-me sorts by updatedAt descending (most recently touched first)', () => {
    const items = [
      mkIssue({ number: 1, lane: 'Needs Me', updatedAt: '2026-06-01T00:00:00Z' }),
      mkIssue({ number: 2, lane: 'Needs Me', updatedAt: '2026-06-10T00:00:00Z' }),
    ];
    const out = classify(items, 'needs-me', {}, Date.now()).map((i) => i.number);
    assert.deepEqual(out, [2, 1]);
  });
});

describe('config resolution', () => {
  test('resolveGithubContext applies field-name defaults and allows overrides', () => {
    const ctx = resolveGithubContext({ github: { owner: 'o', repo: 'r', projectNumber: 1 } });
    assert.equal(ctx.owner, 'o');
    assert.equal(ctx.ownerType, 'user');
    assert.equal(ctx.fields.lane, 'Lane');
    assert.equal(ctx.fields.priority, 'Priority');

    const ctx2 = resolveGithubContext({
      github: { owner: 'o', repo: 'r', projectNumber: 1, ownerType: 'org', fields: { lane: 'Status Lane' } },
    });
    assert.equal(ctx2.ownerType, 'org');
    assert.equal(ctx2.fields.lane, 'Status Lane');
    assert.equal(ctx2.fields.priority, 'Priority'); // default preserved
  });
});

describe('GraphQL query shape', () => {
  test('buildItemsQuery switches between user() and organization() root fields', () => {
    assert.match(buildItemsQuery('user'), /^\s*query.*\n\s*user\(login: \$login\)/s);
    assert.match(buildItemsQuery('org'), /organization\(login: \$login\)/);
    assert.match(buildItemsQuery('user'), /hasNextPage/);
    assert.match(buildItemsQuery('user'), /ProjectV2ItemFieldSingleSelectValue/);
  });

  test('buildIssueDetailsQuery scopes to repository(owner,name).issue(number)', () => {
    assert.match(buildIssueDetailsQuery(), /repository\(owner: \$owner, name: \$repo\)/);
    assert.match(buildIssueDetailsQuery(), /issue\(number: \$number\)/);
  });

  test('ghArgsFor omits null/undefined variables (first-page cursor) but keeps present ones', () => {
    const args = ghArgsFor('QUERY', { login: 'o', number: 1, after: undefined });
    assert.deepEqual(args, ['api', 'graphql', '-f', 'query=QUERY', '-F', 'login=o', '-F', 'number=1']);
    const args2 = ghArgsFor('QUERY', { login: 'o', number: 1, after: 'CURSOR' });
    assert.deepEqual(args2, ['api', 'graphql', '-f', 'query=QUERY', '-F', 'login=o', '-F', 'number=1', '-F', 'after=CURSOR']);
  });
});

describe('dueWindow / daysSince helpers', () => {
  test('dueWindow "week" includes today through today+7 inclusive', () => {
    const item = { dueDate: '2026-06-22' };
    assert.equal(dueWindow(item, 'week', '2026-06-15'), true);
    assert.equal(dueWindow({ dueDate: '2026-06-23' }, 'week', '2026-06-15'), false);
  });

  test('daysSince returns Infinity for missing/invalid timestamps', () => {
    assert.equal(daysSince(null), Number.POSITIVE_INFINITY);
    assert.equal(daysSince('not-a-date'), Number.POSITIVE_INFINITY);
  });
});

// ---------------------------------------------------------------------------------
// End-to-end CLI tests: a fake `gh` shadowing PATH, so pagination, error handling,
// and JSON/table output are exercised through the real spawnSync path — not just
// the pure functions above.
// ---------------------------------------------------------------------------------

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'github-query-'));
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(home, '.copilot', 'assistant'), { recursive: true });
  return { home, bin };
}

function writeFakeGh(bin, script) {
  const p = join(bin, 'gh');
  writeFileSync(p, script.replace(
    '\n',
    '\nif [ "$*" = "api user --jq .login" ] && [ -n "${FAKE_GH_LOGIN:-}" ]; then printf \'%s\\n\' "$FAKE_GH_LOGIN"; exit 0; fi\n',
  ), 'utf8');
  chmodSync(p, 0o755);
}

function writeConfig(home, cfg) {
  writeFileSync(join(home, '.copilot', 'assistant', 'config.json'), JSON.stringify(cfg, null, 2));
}

function run(args, { home, bin, env = {} }) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_TOKEN: undefined,
      GITHUB_TOKEN: undefined,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_GH_LOGIN: 'acme',
      ...env,
    },
  });
}

describe('fieldValues pagination (>30 field values per project item)', () => {
  test('a project item whose fieldValues span two pages gets ALL values merged — Lane/Priority sorted into the second page are never dropped', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      // Page 1: 30 generic filler field values (no Lane/Priority at all).
      const page1Nodes = Array.from({ length: 30 }, (_, i) => (
        { __typename: 'ProjectV2ItemFieldTextValue', text: `filler-${i}`, field: { name: `Filler${i}` } }
      ));
      // Page 2: the fields we actually care about, proving they survive.
      const page2Nodes = [
        { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'Active', field: { name: 'Lane' } },
        { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'P1', field: { name: 'Priority' } },
      ];
      writeFakeGh(bin, `#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"-F id="* ]]; then
  # Follow-up node(id:...) query for the remaining fieldValues page.
  cat <<'JSON'
{"data":{"node":{"fieldValues":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":${JSON.stringify(page2Nodes)}}}}}
JSON
else
  cat <<'JSON'
{"data":{"user":{"projectV2":{"id":"P","items":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[
{"id":"ITEM1","content":{"__typename":"Issue","number":1,"title":"Big item","url":"u1","state":"OPEN","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closedAt":null,"labels":{"nodes":[]}},"fieldValues":{"pageInfo":{"hasNextPage":true,"endCursor":"FVCURSOR"},"nodes":${JSON.stringify(page1Nodes)}}}
]}}}}}
JSON
fi
`);
      const r = run(['active', '--output', 'json'], { home, bin });
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.length, 1);
      assert.equal(out[0].lane, 'Active');
      assert.equal(out[0].priority, 1);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test('fetchAllFieldValueNodes merges the first page verbatim when there is no additional page (no extra gh call)', () => {
    const firstPage = { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ __typename: 'ProjectV2ItemFieldTextValue', text: 'x', field: { name: 'X' } }] };
    const merged = fetchAllFieldValueNodes('ITEM1', firstPage);
    assert.deepEqual(merged, firstPage.nodes);
  });

  test('details --id also paginates a project item\'s fieldValues past the first page', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      const page1Nodes = Array.from({ length: 30 }, (_, i) => (
        { __typename: 'ProjectV2ItemFieldTextValue', text: `filler-${i}`, field: { name: `Filler${i}` } }
      ));
      const page2Nodes = [{ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'Blocked', field: { name: 'Lane' } }];
      writeFakeGh(bin, `#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"-F id="* ]]; then
  cat <<'JSON'
{"data":{"node":{"fieldValues":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":${JSON.stringify(page2Nodes)}}}}}
JSON
else
  cat <<'JSON'
{"data":{"repository":{"issue":{"number":42,"title":"Detail Item","url":"u42","state":"OPEN","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closedAt":null,"body":"...","labels":{"nodes":[]},"projectItems":{"nodes":[{"id":"ITEM42","project":{"number":1},"fieldValues":{"pageInfo":{"hasNextPage":true,"endCursor":"C"},"nodes":${JSON.stringify(page1Nodes)}}}]}}}}}
JSON
fi
`);
      const r = run(['details', '--id', '42', '--output', 'json'], { home, bin });
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.lane, 'Blocked');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test('rejects a null fieldValues cursor instead of looping', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      writeFakeGh(bin, `#!/usr/bin/env bash
cat <<'JSON'
{"data":{"user":{"projectV2":{"id":"P","items":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[
{"id":"ITEM1","content":{"__typename":"Issue","number":1,"title":"Broken cursor","url":"u1","state":"OPEN","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closedAt":null,"labels":{"nodes":[]}},"fieldValues":{"pageInfo":{"hasNextPage":true,"endCursor":null},"nodes":[]}}
]}}}}}
JSON
`);
      const r = run(['all-open'], { home, bin });
      assert.equal(r.status, 4);
      assert.match(r.stderr, /fieldValues pagination.*new non-empty cursor/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});

describe('CLI end-to-end (fake `gh` on PATH)', () => {
  test('the installed symlink executes the CLI and prints the lane catalog', () => {
    const { home, bin } = sandbox();
    try {
      const linkedCommand = join(bin, 'github-query');
      symlinkSync(SCRIPT, linkedCommand);
      const r = spawnSync(linkedCommand, ['--list'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GH_TOKEN: undefined,
          GITHUB_TOKEN: undefined,
          HOME: home,
          PATH: `${bin}:${process.env.PATH}`,
        },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Personal board lanes/);
      assert.match(r.stdout, /\bactive\b/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('the symlinked CLI uses a matching keyring identity when the ambient token is for another user', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, {
        taskBackend: 'github',
        github: { owner: 'managed-user', ownerType: 'user', repo: 'personal-work', projectNumber: 1 },
      });
      writeFakeGh(bin, `#!/usr/bin/env bash
if [ "$*" = "api user --jq .login" ]; then
  if [ -n "\${GH_TOKEN:-}\${GITHUB_TOKEN:-}" ]; then
    echo "wrong-user"
  else
    echo "managed-user"
  fi
  exit 0
fi
if [ -n "\${GH_TOKEN:-}\${GITHUB_TOKEN:-}" ]; then
  echo "ambient token must not reach the board query" >&2
  exit 1
fi
cat <<'JSON'
{"data":{"user":{"projectV2":{"id":"P","items":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"ITEM_42","content":{"__typename":"Issue","number":42,"title":"Active task","url":"u42","state":"OPEN","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closedAt":null,"labels":{"nodes":[]}},"fieldValues":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Active","field":{"name":"Lane"}}]}}]}}}}}
JSON
`);
      const linkedCommand = join(bin, 'github-query');
      symlinkSync(SCRIPT, linkedCommand);
      const r = spawnSync(linkedCommand, ['all-open', '--output', 'json'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GH_TOKEN: 'ambient-token',
          GITHUB_TOKEN: 'secondary-token',
          HOME: home,
          PATH: `${bin}:${process.env.PATH}`,
        },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout).map((item) => item.number), [42]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('exhausts multi-page cursor pagination and aggregates all items', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      writeFakeGh(bin, `#!/usr/bin/env bash
after=""
args=("$@")
for ((i=0; i<\${#args[@]}; i++)); do
  if [ "\${args[$i]}" = "-F" ]; then
    j=$((i+1))
    case "\${args[$j]}" in after=*) after="\${args[$j]#after=}";; esac
  fi
done
if [ -z "$after" ]; then
  cat <<'JSON'
{"data":{"user":{"projectV2":{"id":"P","items":{"pageInfo":{"hasNextPage":true,"endCursor":"C1"},"nodes":[
{"content":{"__typename":"Issue","number":1,"title":"A","url":"u1","state":"OPEN","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closedAt":null,"labels":{"nodes":[]}},"fieldValues":{"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Backlog","field":{"name":"Lane"}}]}}
]}}}}}
JSON
elif [ "$after" = "C1" ]; then
  cat <<'JSON'
{"data":{"user":{"projectV2":{"id":"P","items":{"pageInfo":{"hasNextPage":true,"endCursor":"C2"},"nodes":[
{"content":{"__typename":"Issue","number":2,"title":"B","url":"u2","state":"OPEN","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closedAt":null,"labels":{"nodes":[]}},"fieldValues":{"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Backlog","field":{"name":"Lane"}}]}}
]}}}}}
JSON
else
  cat <<'JSON'
{"data":{"user":{"projectV2":{"id":"P","items":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[
{"content":{"__typename":"Issue","number":3,"title":"C","url":"u3","state":"OPEN","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closedAt":null,"labels":{"nodes":[]}},"fieldValues":{"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Backlog","field":{"name":"Lane"}}]}}
]}}}}}
JSON
fi
`);
      const r = run(['backlog', '--output', 'json'], { home, bin });
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.deepEqual(out.map((i) => i.number), [1, 2, 3]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('rejects a non-progressing project-items cursor instead of looping', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      writeFakeGh(bin, `#!/usr/bin/env bash
cat <<'JSON'
{"data":{"user":{"projectV2":{"id":"P","items":{"pageInfo":{"hasNextPage":true,"endCursor":"SAME"},"nodes":[]}}}}}
JSON
`);
      const r = run(['all-open'], { home, bin });
      assert.equal(r.status, 4);
      assert.match(r.stderr, /project items pagination.*new non-empty cursor/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--print-query prints the GraphQL query without invoking gh at all', () => {
    const { home, bin } = sandbox();
    try {
      const marker = join(home, 'gh-invoked');
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      writeFakeGh(bin, `#!/usr/bin/env bash\nprintf invoked > "${marker}"\nexit 99\n`);
      const r = run(['active', '--print-query'], {
        home,
        bin,
        env: { GH_TOKEN: 'ambient-token' },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /query\(\$login/);
      assert.match(r.stdout, /project #1/);
      assert.equal(existsSync(marker), false, '--print-query must not probe identity or invoke any gh API');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('user-owned execution fails closed for wrong ambient and keyring identities', () => {
    const { home, bin } = sandbox();
    try {
      const marker = join(home, 'board-query-ran');
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      writeFakeGh(bin, `#!/usr/bin/env bash\nprintf invoked > "${marker}"\nexit 99\n`);
      const r = run(['active'], {
        home,
        bin,
        env: { GH_TOKEN: 'ambient-token', FAKE_GH_LOGIN: 'wrong-user' },
      });
      assert.equal(r.status, 4);
      assert.match(r.stderr, /identity mismatch/);
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('user-owned execution with no env token fails closed for a wrong active keyring identity', () => {
    const { home, bin } = sandbox();
    try {
      const marker = join(home, 'board-query-ran');
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      writeFakeGh(bin, `#!/usr/bin/env bash\nprintf invoked > "${marker}"\nexit 99\n`);
      const r = run(['active'], {
        home,
        bin,
        env: { GH_TOKEN: undefined, GITHUB_TOKEN: undefined, FAKE_GH_LOGIN: 'wrong-user' },
      });
      assert.equal(r.status, 4);
      assert.match(r.stderr, /identity mismatch/);
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('org-owned execution preserves ambient auth and skips exact-owner identity probing', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, {
        taskBackend: 'github',
        github: { owner: 'acme-org', ownerType: 'org', repo: 'personal-work', projectNumber: 1 },
      });
      writeFakeGh(bin, `#!/usr/bin/env bash
if [ "$*" = "api user --jq .login" ]; then echo "identity probe must not run" >&2; exit 99; fi
cat <<'JSON'
{"data":{"organization":{"projectV2":{"id":"P","items":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}}}
JSON
`);
      const r = run(['all-open', '--output', 'json'], {
        home, bin, env: { GH_TOKEN: 'org-token', FAKE_GH_LOGIN: undefined },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), []);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('missing github config block exits 3 with a clear message', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'markdown' });
      const r = run(['active'], { home, bin });
      assert.equal(r.status, 3);
      assert.match(r.stderr, /configure github.owner, github.repo and github.projectNumber/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('missing config file exits 2', () => {
    const { home, bin } = sandbox();
    try {
      const r = run(['active'], { home, bin });
      assert.equal(r.status, 2);
      assert.match(r.stderr, /config not found/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('gh not on PATH exits 4 with a clear message', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      // Isolate PATH to just the empty fake-bin dir plus node's own directory (so
      // spawning `node` itself still works) — no fallthrough to a real `gh` that may
      // happen to be installed elsewhere on the host running this test.
      const isolatedPath = `${bin}:${dirname(process.execPath)}`;
      const r = spawnSync('node', [SCRIPT, 'active'], { encoding: 'utf8', env: { ...process.env, HOME: home, PATH: isolatedPath } });
      assert.equal(r.status, 4);
      assert.match(r.stderr, /gh.*CLI was not found/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a gh API error (non-zero exit) surfaces as exit 4, not a crash', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      writeFakeGh(bin, '#!/usr/bin/env bash\necho "GraphQL: Could not resolve to a ProjectV2" >&2\nexit 1\n');
      const r = run(['active'], { home, bin });
      assert.equal(r.status, 4);
      assert.match(r.stderr, /gh api graphql failed/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('unknown lane name reports a usage error (exit 1) and lists --list', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      const r = run(['not-a-real-lane'], { home, bin });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /unknown lane/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('invalid documented option values are usage errors before config/network access', () => {
    const { home, bin } = sandbox();
    try {
      const cases = [
        [['active', '--window', 'later'], /--window/],
        [['active', '--output', 'yaml'], /--output/],
        [['priority', '--priority', 'P1'], /--priority/],
        [['priority', '--priority', '0'], /--priority/],
        [['done-recent', '--changed-since-days', '-1'], /--changed-since-days/],
        [['details', '--id', '80x'], /--id/],
        [['details', '--id', '0'], /--id/],
      ];
      for (const [args, expected] of cases) {
        const r = run(args, { home, bin });
        assert.equal(r.status, 1, args.join(' '));
        assert.match(r.stderr, expected);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('invalid config.github.projectNumber is a clear board-configuration error', () => {
    const { home, bin } = sandbox();
    try {
      for (const projectNumber of [0, -1, 'abc', 1.5]) {
        writeConfig(home, {
          taskBackend: 'github',
          github: { owner: 'acme', repo: 'personal-work', projectNumber },
        });
        const r = run(['active', '--print-query'], { home, bin });
        assert.equal(r.status, 3, String(projectNumber));
        assert.match(r.stderr, /projectNumber must be a positive integer/);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('details --id fetches a single issue by number', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      writeFakeGh(bin, `#!/usr/bin/env bash
cat <<'JSON'
{"data":{"repository":{"issue":{"number":42,"title":"Detail Item","url":"u42","state":"OPEN","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closedAt":null,"body":"...","labels":{"nodes":[]},"projectItems":{"nodes":[{"project":{"number":1},"fieldValues":{"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Active","field":{"name":"Lane"}}]}}]}}}}}
JSON
`);
      const r = run(['details', '--id', '42', '--output', 'json'], { home, bin });
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.number, 42);
      assert.equal(out.lane, 'Active');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('details paginates projectItems until the configured project is found', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'github', github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 } });
      writeFakeGh(bin, `#!/usr/bin/env bash
after=""
args=("$@")
for ((i=0; i<\${#args[@]}; i++)); do
  if [ "\${args[$i]}" = "-F" ]; then
    j=$((i+1))
    case "\${args[$j]}" in after=*) after="\${args[$j]#after=}";; esac
  fi
done
if [ -z "$after" ]; then
  cat <<'JSON'
{"data":{"repository":{"issue":{"number":42,"title":"Detail Item","url":"u42","state":"OPEN","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closedAt":null,"body":"...","labels":{"nodes":[]},"projectItems":{"pageInfo":{"hasNextPage":true,"endCursor":"NEXT"},"nodes":[{"id":"OTHER","project":{"number":999},"fieldValues":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}]}}}}}
JSON
else
  cat <<'JSON'
{"data":{"repository":{"issue":{"number":42,"title":"Detail Item","url":"u42","state":"OPEN","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closedAt":null,"body":"...","labels":{"nodes":[]},"projectItems":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"OURS","project":{"number":1},"fieldValues":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Needs Me","field":{"name":"Lane"}}]}}]}}}}}
JSON
fi
`);
      const r = run(['details', '--id', '42', '--output', 'json'], { home, bin });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).lane, 'Needs Me');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------------
// Mixed personal (GitHub) + team (ADO) briefing routing: with taskBackend="github",
// the personal board must resolve through github-query / config.github, while the
// separate teamBoard block must still resolve through ado-query untouched — the two
// commands must not require each other's config block to be present.
// ---------------------------------------------------------------------------------
describe('mixed GitHub-personal + ADO-team board routing', () => {
  test('a single config.json serves both: teamBoard resolves via ado-query, personal board via github-query', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, {
        taskBackend: 'github',
        github: { owner: 'acme', repo: 'personal-work', projectNumber: 1 },
        teamBoard: { org: 'https://dev.azure.com/example-team', project: 'ExampleProject', team: 'Platform', areaPath: 'ExampleProject\\Platform' },
      });
      // ado-query --print-wiql never calls `az`, so no fake az binary is required.
      const adoR = spawnSync('node', [ADO_SCRIPT, 'team-started', '--print-wiql'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home },
      });
      assert.equal(adoR.status, 0, adoR.stderr);
      assert.match(adoR.stdout, /team-started/);
      assert.match(adoR.stdout, /example-team/);

      const ghR = run(['active', '--print-query'], { home, bin });
      assert.equal(ghR.status, 0, ghR.stderr);
      assert.match(ghR.stdout, /acme\/personal-work/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('ado-query personal board still works unmodified when taskBackend is "ado" (legacy compatibility)', () => {
    const { home, bin } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'ado', ado: { org: 'https://dev.azure.com/legacy', project: 'Personal' } });
      const r = spawnSync('node', [ADO_SCRIPT, 'all-open', '--print-wiql'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: home },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /legacy/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
