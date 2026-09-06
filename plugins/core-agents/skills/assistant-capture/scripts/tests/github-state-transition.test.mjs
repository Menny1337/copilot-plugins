#!/usr/bin/env node
// github-state-transition.test.mjs — node:test coverage for the safe
// complete/archive/reopen ordering (finding 5, r1: a second-step failure must
// never report success) and the IDEMPOTENT CONVERGENCE design (r5, replacing
// the earlier transactional-compensation design):
//
//   - planTransition SKIPS any step whose target already matches the live
//     `current` snapshot passed in, so a plan only ever contains steps that
//     are still actually needed.
//   - executeTransition/runTransition never roll back a partial failure. A
//     write error triggers exactly one re-fetch-and-compare against the
//     live remote: if the target was reached anyway, it's a success; if the
//     re-fetch itself fails, the result is `indeterminate`; otherwise it's a
//     `partial` failure. Both failure kinds tell the caller to re-run — the
//     re-run's own `current` read converges by applying only what's missing.
//
// Also still covers (unchanged by the r5 simplification):
//   - (r3 finding 2) the built-in Projects v2 Status field is captured,
//     forward-planned, and verified alongside Lane.
//   - (r3 finding 3) projectItems/fieldValues pagination is exhaustive — a
//     target project or field on a later page is never missed.
//   - (r2 finding: open never Done/Archive; closed never nonterminal)
//     deriveStatus's canonical (state, lane) invariant check.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
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
} from '../github-state-transition.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'github-state-transition.mjs');

function cliSandbox(github = {}) {
  const root = mkdtempSync(join(tmpdir(), 'github-state-transition-cli-'));
  const bin = join(root, 'bin');
  const config = join(root, 'config.json');
  const calls = join(root, 'gh-calls.log');
  mkdirSync(bin);
  writeFileSync(config, JSON.stringify({
    github: {
      owner: 'managed-user',
      ownerType: 'user',
      repo: 'personal-work',
      projectNumber: 1,
      projectId: 'PROJECT_1',
      ...github,
    },
  }));
  return { root, bin, config, calls };
}

function writeFakeGh(box, body) {
  const fakeGh = join(box.bin, 'gh');
  writeFileSync(fakeGh, body);
  chmodSync(fakeGh, 0o755);
}

function runCli(box, args, env = {}) {
  return spawnSync('node', [SCRIPT, ...args, '--config', box.config], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_TOKEN: undefined,
      GITHUB_TOKEN: undefined,
      PATH: `${box.bin}:${process.env.PATH}`,
      ...env,
    },
  });
}

describe('CLI execution', () => {
  test('the installed symlink executes the CLI and prints help', () => {
    const dir = mkdtempSync(join(tmpdir(), 'github-state-transition-'));
    try {
      const linkedCommand = join(dir, 'github-state-transition');
      symlinkSync(SCRIPT, linkedCommand);
      const r = spawnSync(linkedCommand, ['--help'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /verified, idempotent complete\/archive\/reopen/);
      assert.match(r.stdout, /Usage:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the symlinked preflight uses a matching keyring identity when the ambient token is for another user', () => {
    const dir = mkdtempSync(join(tmpdir(), 'github-state-transition-auth-'));
    try {
      const bin = join(dir, 'bin');
      const config = join(dir, 'config.json');
      mkdirSync(bin);
      writeFileSync(config, JSON.stringify({
        github: {
          owner: 'managed-user',
          ownerType: 'user',
          repo: 'personal-work',
          projectNumber: 1,
          projectId: 'PROJECT_1',
        },
      }));
      const fakeGh = join(bin, 'gh');
      writeFileSync(fakeGh, `#!/usr/bin/env bash
if [ "$*" = "api user --jq .login" ]; then
  if [ -n "\${GH_TOKEN:-}\${GITHUB_TOKEN:-}" ]; then
    echo "wrong-user"
  else
    echo "managed-user"
  fi
  exit 0
fi
if [ -n "\${GH_TOKEN:-}\${GITHUB_TOKEN:-}" ]; then
  echo "ambient token must not reach state-transition preflight" >&2
  exit 1
fi
args="$*"
case "$args" in
  "project field-list "*)
    echo '{"fields":[{"id":"FIELD_LANE","name":"Lane","options":[{"id":"OPT_DONE","name":"Done"}]},{"id":"FIELD_STATUS","name":"Status","options":[{"id":"OPT_DONE","name":"Done"}]}]}'
    ;;
  *"projectItems(first:"*)
    echo '{"data":{"repository":{"issue":{"projectItems":{"nodes":[{"id":"ITEM_42","project":{"number":1}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}'
    ;;
  *"fieldValues(first:"*)
    echo '{"data":{"node":{"fieldValues":{"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Active","field":{"name":"Lane"}},{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"In Progress","field":{"name":"Status"}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}'
    ;;
  *"issue(number:"*"id state"*)
    echo '{"data":{"repository":{"issue":{"id":"ISSUE_42","state":"OPEN"}}}}'
    ;;
  *)
    echo "unexpected gh invocation: $args" >&2
    exit 1
    ;;
esac
`);
      chmodSync(fakeGh, 0o755);
      const linkedCommand = join(bin, 'github-state-transition');
      symlinkSync(SCRIPT, linkedCommand);
      const r = spawnSync(linkedCommand, [
        'complete', '--id', '42', '--dry-run', '--config', config,
      ], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GH_TOKEN: 'ambient-token',
          GITHUB_TOKEN: 'secondary-token',
          PATH: `${bin}:${process.env.PATH}`,
        },
      });
      assert.equal(r.status, 0, r.stderr);
      const output = JSON.parse(r.stdout);
      assert.equal(output.dryRun, true);
      assert.equal(output.current.issueId, 'ISSUE_42');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('unsafe reopen destinations are usage errors before config or gh is touched', () => {
    for (const lane of ['Done', 'Archive', 'Bogus']) {
      const r = spawnSync('node', [
        SCRIPT, 'reopen', '--id', '80', '--lane', lane, '--dry-run',
      ], { encoding: 'utf8' });
      assert.equal(r.status, 1, lane);
      assert.match(r.stderr, /--lane must be one of/);
    }
  });

  test('invalid issue ids are usage errors before config or gh is touched', () => {
    for (const id of ['0', '-1', '80x']) {
      const r = spawnSync('node', [
        SCRIPT, 'reopen', '--id', id, '--lane', 'Backlog', '--dry-run',
      ], { encoding: 'utf8' });
      assert.equal(r.status, 1, id);
      assert.match(r.stderr, /--id must be a positive integer/);
    }
  });

  test('invalid config.github.projectNumber is rejected before identity or project reads', () => {
    const box = cliSandbox({ projectNumber: 'bogus' });
    try {
      const r = runCli(box, ['complete', '--id', '80', '--dry-run']);
      assert.equal(r.status, 3);
      assert.match(r.stderr, /projectNumber must be a positive integer/);
    } finally {
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('a wrong ambient identity plus a wrong keyring identity fails before preflight reads or writes', () => {
    const box = cliSandbox();
    try {
      writeFakeGh(box, `#!/usr/bin/env bash
if [ "$*" = "api user --jq .login" ]; then
  if [ -n "\${GH_TOKEN:-}\${GITHUB_TOKEN:-}" ]; then echo wrong-user; else echo another-user; fi
  exit 0
fi
printf '%s\n' "$*" >> "${box.calls}"
exit 99
`);
      const r = runCli(box, ['complete', '--id', '80', '--dry-run'], {
        GH_TOKEN: 'ambient-token',
        GITHUB_TOKEN: 'secondary-token',
      });
      assert.equal(r.status, 4);
      assert.match(r.stderr, /identity mismatch/);
      assert.equal(existsSync(box.calls), false, 'no project/issue API call may run under a mismatched identity');
    } finally {
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('initial snapshot failures are mapped to the documented setup/read exit without a Node stack', () => {
    const box = cliSandbox();
    try {
      writeFakeGh(box, `#!/usr/bin/env bash
if [ "$*" = "api user --jq .login" ]; then echo managed-user; exit 0; fi
case "$*" in
  "project field-list "*)
    echo '{"fields":[{"id":"FIELD_LANE","name":"Lane","options":[{"id":"OPT_DONE","name":"Done"}]},{"id":"FIELD_STATUS","name":"Status","options":[{"id":"STATUS_DONE","name":"Done"}]}]}'
    ;;
  *) echo '{}' ;;
esac
`);
      const r = runCli(box, ['complete', '--id', '80', '--dry-run']);
      assert.equal(r.status, 4);
      assert.match(r.stderr, /could not read issue #80/);
      assert.doesNotMatch(r.stderr, /\n\s+at /);
    } finally {
      rmSync(box.root, { recursive: true, force: true });
    }
  });

  test('project membership and target Lane/Status options are validated before reopen writes', () => {
    for (const scenario of ['not-member', 'missing-lane-option', 'missing-status-option']) {
      const box = cliSandbox();
      try {
        const laneOptions = scenario === 'missing-lane-option'
          ? '[{"id":"OPT_BACKLOG","name":"Backlog"}]'
          : '[{"id":"OPT_BACKLOG","name":"Backlog"},{"id":"OPT_NEEDS","name":"Needs Me"}]';
        const statusOptions = scenario === 'missing-status-option'
          ? '[{"id":"STATUS_DONE","name":"Done"}]'
          : '[{"id":"STATUS_DONE","name":"Done"},{"id":"STATUS_PROGRESS","name":"In Progress"}]';
        writeFakeGh(box, `#!/usr/bin/env bash
if [ "$*" = "api user --jq .login" ]; then echo managed-user; exit 0; fi
printf '%s\n' "$*" >> "${box.calls}"
case "$*" in
  "project field-list "*)
    echo '{"fields":[{"id":"FIELD_LANE","name":"Lane","options":${laneOptions}},{"id":"FIELD_STATUS","name":"Status","options":${statusOptions}}]}'
    ;;
  *"issue(number:"*"id state"*)
    echo '{"data":{"repository":{"issue":{"id":"ISSUE_80","state":"CLOSED"}}}}'
    ;;
  *"projectItems(first:"*)
    if [ "${scenario}" = "not-member" ]; then
      echo '{"data":{"repository":{"issue":{"projectItems":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}'
    else
      echo '{"data":{"repository":{"issue":{"projectItems":{"nodes":[{"id":"ITEM_80","project":{"number":1}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}'
    fi
    ;;
  *"fieldValues(first:"*)
    echo '{"data":{"node":{"fieldValues":{"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Archive","field":{"name":"Lane"}},{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"Done","field":{"name":"Status"}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}'
    ;;
  *) echo "unexpected write: $*" >&2; exit 99 ;;
esac
`);
        const r = runCli(box, ['reopen', '--id', '80', '--lane', 'Needs Me']);
        assert.equal(r.status, 4, `${scenario}: ${r.stderr}`);
        assert.doesNotMatch(readFileSync(box.calls, 'utf8'), /\bissue reopen\b|\bproject item-edit\b/);
      } finally {
        rmSync(box.root, { recursive: true, force: true });
      }
    }
  });

  test('move writes Lane and derived Status, verifies convergence, and never changes issue state', () => {
    const box = cliSandbox();
    const laneState = join(box.root, 'lane.txt');
    const statusState = join(box.root, 'status.txt');
    try {
      writeFakeGh(box, `#!/usr/bin/env bash
if [ "$*" = "api user --jq .login" ]; then echo managed-user; exit 0; fi
printf '%s\n' "$*" >> "${box.calls}"
case "$*" in
  "project field-list "*)
    echo '{"fields":[{"id":"FIELD_LANE","name":"Lane","options":[{"id":"OPT_BACKLOG","name":"Backlog"},{"id":"OPT_ACTIVE","name":"Active"}]},{"id":"FIELD_STATUS","name":"Status","options":[{"id":"STATUS_TODO","name":"Todo"},{"id":"STATUS_PROGRESS","name":"In Progress"}]}]}'
    ;;
  *"single-select-option-id OPT_ACTIVE"*)
    printf Active > "${laneState}"
    ;;
  *"single-select-option-id STATUS_PROGRESS"*)
    printf 'In Progress' > "${statusState}"
    ;;
  *"issue(number:"*"id state"*)
    echo '{"data":{"repository":{"issue":{"id":"ISSUE_80","state":"OPEN"}}}}'
    ;;
  *"projectItems(first:"*)
    echo '{"data":{"repository":{"issue":{"projectItems":{"nodes":[{"id":"ITEM_80","project":{"number":1}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}'
    ;;
  *"fieldValues(first:"*)
    lane=Backlog
    status=Todo
    [ ! -f "${laneState}" ] || lane="$(cat "${laneState}")"
    [ ! -f "${statusState}" ] || status="$(cat "${statusState}")"
    printf '{"data":{"node":{"fieldValues":{"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"%s","field":{"name":"Lane"}},{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"%s","field":{"name":"Status"}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}\n' "$lane" "$status"
    ;;
  *) echo "unexpected gh invocation: $*" >&2; exit 99 ;;
esac
`);
      const r = runCli(box, ['move', '--id', '80', '--lane', 'Active']);
      assert.equal(r.status, 0, r.stderr);
      const output = JSON.parse(r.stdout);
      assert.deepEqual(output.appliedSteps.map((entry) => entry.step.type), ['lane', 'status']);
      assert.deepEqual(output.current, {
        issueId: 'ISSUE_80',
        itemId: 'ITEM_80',
        state: 'open',
        lane: 'Active',
        status: 'In Progress',
      });
      assert.doesNotMatch(readFileSync(box.calls, 'utf8'), /\bissue close\b|\bissue reopen\b/);
    } finally {
      rmSync(box.root, { recursive: true, force: true });
    }
  });
});

describe('planTransition — step ordering (no `current` supplied: every canonical step is always planned)', () => {
  test('complete: sets Lane=Done, then Status=Done, BEFORE closing (reason completed)', () => {
    const plan = planTransition('complete');
    assert.deepEqual(plan.steps.map((s) => s.type), ['lane', 'status', 'close']);
    assert.equal(plan.steps[0].targetLane, 'Done');
    assert.equal(plan.steps[1].targetStatus, 'Done');
    assert.equal(plan.steps[2].reason, 'completed');
    assert.deepEqual(plan.expected, {
      lane: 'Done', state: 'closed', status: 'Done', checkStatus: true,
    });
  });

  test('archive: sets Lane=Archive, then Status=Done (per DEFAULT_LANE_STATUS_MAP), BEFORE closing (reason not planned)', () => {
    const plan = planTransition('archive');
    assert.deepEqual(plan.steps.map((s) => s.type), ['lane', 'status', 'close']);
    assert.equal(plan.steps[0].targetLane, 'Archive');
    assert.equal(plan.steps[1].targetStatus, 'Done');
    assert.equal(plan.steps[2].reason, 'not planned');
    assert.deepEqual(plan.expected, {
      lane: 'Archive', state: 'closed', status: 'Done', checkStatus: true,
    });
  });

  test('reopen: reopens BEFORE setting Lane/Status, defaulting to Backlog', () => {
    const plan = planTransition('reopen');
    assert.deepEqual(plan.steps.map((s) => s.type), ['reopen', 'lane', 'status']);
    assert.equal(plan.steps[1].targetLane, 'Backlog');
    assert.equal(plan.steps[2].targetStatus, 'Todo');
    assert.deepEqual(plan.expected, {
      lane: 'Backlog', state: 'open', status: 'Todo', checkStatus: true,
    });
  });

  test('reopen: honors an explicit chosenLane (e.g. reopening straight into Active)', () => {
    const plan = planTransition('reopen', { chosenLane: 'Active' });
    assert.equal(plan.steps[1].targetLane, 'Active');
    assert.deepEqual(plan.expected, {
      lane: 'Active', state: 'open', status: 'In Progress', checkStatus: true,
    });
  });

  test('move: plans Lane + derived Status only and preserves the open issue state', () => {
    const plan = planTransition('move', {
      chosenLane: 'Blocked',
      current: { state: 'open', lane: 'Backlog', status: 'Todo' },
    });
    assert.deepEqual(plan.steps, [
      { type: 'lane', targetLane: 'Blocked' },
      { type: 'status', targetStatus: 'In Progress' },
    ]);
    assert.deepEqual(plan.expected, {
      lane: 'Blocked', state: 'open', status: 'In Progress', checkStatus: true,
    });
  });

  test('move/reopen accept exactly the five non-terminal destinations', () => {
    assert.deepEqual(OPEN_LANES, ['Backlog', 'Up Next', 'Active', 'Needs Me', 'Blocked']);
    assert.throws(
      () => planTransition('move', {
        chosenLane: 'Done', current: { state: 'open', lane: 'Active', status: 'In Progress' },
      }),
      /lane "Done" is invalid/,
    );
    assert.throws(
      () => planTransition('move', {
        chosenLane: 'Active', current: { state: 'closed', lane: 'Done', status: 'Done' },
      }),
      /requires an open issue/,
    );
    assert.throws(
      () => planTransition('move', {
        chosenLane: 'Active',
        includeStatus: false,
        current: { state: 'open', lane: 'Backlog', status: null },
      }),
      /requires the project built-in Status field/,
    );
  });

  test('rejects an unknown action', () => {
    assert.throws(() => planTransition('delete'), /unknown action/);
  });

  test('TERMINAL_LANE_BY_ACTION / CLOSE_REASON_BY_ACTION expose the exact locked mapping', () => {
    assert.deepEqual(TERMINAL_LANE_BY_ACTION, { complete: 'Done', archive: 'Archive' });
    assert.deepEqual(CLOSE_REASON_BY_ACTION, { complete: 'completed', archive: 'not planned' });
  });

  describe('finding 2 — Status handling can be gated off per-project', () => {
    test('includeStatus:false (project has no built-in Status field) never plans a status step or checks it', () => {
      const plan = planTransition('complete', { includeStatus: false });
      assert.deepEqual(plan.steps.map((s) => s.type), ['lane', 'close']);
      assert.equal(plan.expected.status, null);
      assert.equal(plan.expected.checkStatus, false);
    });

    test('a laneStatusMap with no entry for the target lane is rejected before a Lane-only drift can be planned', () => {
      assert.throws(
        () => planTransition('reopen', { chosenLane: 'Blocked', laneStatusMap: { Backlog: 'Todo' } }),
        /no Status mapping/,
      );
    });

    test('a custom laneStatusMap overrides the built-in default mapping', () => {
      const plan = planTransition('complete', { laneStatusMap: { Done: 'Complete!' } });
      assert.equal(plan.steps[1].targetStatus, 'Complete!');
      assert.equal(plan.expected.status, 'Complete!');
    });

    test('DEFAULT_LANE_STATUS_MAP matches the documented Lane catalog (Backlog/Up Next -> Todo; Active/Needs Me/Blocked -> In Progress; Done/Archive -> Done)', () => {
      assert.deepEqual(DEFAULT_LANE_STATUS_MAP, {
        Backlog: 'Todo',
        'Up Next': 'Todo',
        Active: 'In Progress',
        'Needs Me': 'In Progress',
        Blocked: 'In Progress',
        Done: 'Done',
        Archive: 'Done',
      });
    });
  });
});

describe('planTransition — idempotent convergence: steps already satisfied by `current` are SKIPPED', () => {
  test('complete: current already fully at the target (Lane=Done, Status=Done, closed) -> zero steps needed', () => {
    const plan = planTransition('complete', { current: { state: 'closed', lane: 'Done', status: 'Done' } });
    assert.deepEqual(plan.steps, []);
  });

  test('complete: lane and status already correct but issue still open -> only the close step remains', () => {
    const plan = planTransition('complete', { current: { state: 'open', lane: 'Done', status: 'Done' } });
    assert.deepEqual(plan.steps.map((s) => s.type), ['close']);
  });

  test('complete: issue already closed but lane/status still wrong -> lane+status steps remain, close is skipped (never re-closes)', () => {
    const plan = planTransition('complete', { current: { state: 'closed', lane: 'Active', status: 'In Progress' } });
    assert.deepEqual(plan.steps.map((s) => s.type), ['lane', 'status']);
  });

  test('complete: lane already correct, status still wrong -> only the status step remains, in the middle of the canonical order', () => {
    const plan = planTransition('complete', { current: { state: 'open', lane: 'Done', status: 'Todo' } });
    assert.deepEqual(plan.steps.map((s) => s.type), ['status', 'close']);
  });

  test('reopen: current already fully at the target (open/Backlog/Todo) -> zero steps needed', () => {
    const plan = planTransition('reopen', { current: { state: 'open', lane: 'Backlog', status: 'Todo' } });
    assert.deepEqual(plan.steps, []);
  });

  test('reopen: already open but wrong lane/status -> lane+status steps only, reopen is skipped (never a redundant reopen call)', () => {
    const plan = planTransition('reopen', { current: { state: 'open', lane: 'Active', status: 'In Progress' } });
    assert.deepEqual(plan.steps.map((s) => s.type), ['lane', 'status']);
  });

  test('reopen: still closed, but the target lane already matches -> reopen+status remain, lane is skipped', () => {
    const plan = planTransition('reopen', { chosenLane: 'Blocked', current: { state: 'closed', lane: 'Blocked', status: 'Done' } });
    assert.deepEqual(plan.steps.map((s) => s.type), ['reopen', 'status']);
  });

  test('a step type whose corresponding current field is null (never fetched / project has no item) is never treated as "already satisfied"', () => {
    const plan = planTransition('complete', { current: { state: 'open', lane: null, status: null } });
    assert.deepEqual(plan.steps.map((s) => s.type), ['lane', 'status', 'close']);
  });

  test('without a `current` argument at all, planning is conservative — every canonical step is planned (same as legacy full-plan behavior)', () => {
    const plan = planTransition('archive');
    assert.deepEqual(plan.steps.map((s) => s.type), ['lane', 'status', 'close']);
  });
});

describe('matchesExpected — pure convergence check', () => {
  test('true only when state, lane, and (if checkStatus) status all match', () => {
    const expected = {
      lane: 'Done', state: 'closed', status: 'Done', checkStatus: true,
    };
    assert.equal(matchesExpected({ state: 'closed', lane: 'Done', status: 'Done' }, expected), true);
    assert.equal(matchesExpected({ state: 'open', lane: 'Done', status: 'Done' }, expected), false);
    assert.equal(matchesExpected({ state: 'closed', lane: 'Active', status: 'Done' }, expected), false);
    assert.equal(matchesExpected({ state: 'closed', lane: 'Done', status: 'Todo' }, expected), false);
  });

  test('status is ignored when checkStatus is false', () => {
    const expected = {
      lane: 'Done', state: 'closed', status: null, checkStatus: false,
    };
    assert.equal(matchesExpected({ state: 'closed', lane: 'Done', status: 'anything at all' }, expected), true);
  });

  test('a null/undefined live snapshot never matches (defensive)', () => {
    assert.equal(matchesExpected(null, { lane: 'Done', state: 'closed', checkStatus: false }), false);
  });
});

describe('executeTransition — the invisible-partial-failure regression (finding 5, r1) plus idempotent-convergence outcomes (r5)', () => {
  test('all steps apply AND the final fetchLive confirms the canonical result -> ok:true, converged:true', () => {
    const plan = planTransition('complete');
    const result = executeTransition(plan, {
      applyStep: () => ({ ok: true }),
      fetchLive: () => ({ state: 'closed', lane: 'Done', status: 'Done' }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.converged, true);
    assert.equal(result.indeterminate, false);
    assert.equal(result.appliedSteps.length, 3);
  });

  test('all steps apply WITHOUT throwing, but the live remote silently did not take effect -> ok:false, converged:false (apply success alone is not proof)', () => {
    const plan = planTransition('archive');
    const result = executeTransition(plan, {
      applyStep: () => ({ ok: true }),
      fetchLive: () => ({ state: 'open', lane: 'Active', status: 'In Progress' }), // unchanged live state
    });
    assert.equal(result.ok, false);
    assert.equal(result.converged, false);
    assert.equal(result.indeterminate, false);
    assert.deepEqual(result.expected, {
      lane: 'Archive', state: 'closed', status: 'Done', checkStatus: true,
    });
    assert.match(result.message, /re-run/i);
  });

  test('complete: THIRD step (close) throws, but the re-fetch shows the target was ALREADY reached anyway -> recovered, ok:true', () => {
    const applied = [];
    const plan = planTransition('complete');
    const result = executeTransition(plan, {
      applyStep: (step) => {
        applied.push(step.type);
        if (step.type === 'close') throw new Error('gh issue close reported a timeout, but may have actually landed');
        return { ok: true };
      },
      fetchLive: () => ({ state: 'closed', lane: 'Done', status: 'Done' }), // it actually landed
    });
    assert.equal(result.ok, true);
    assert.equal(result.converged, true);
    assert.deepEqual(applied, ['lane', 'status', 'close']);
    assert.equal(result.appliedSteps.length, 2); // close's own ledger entry was never added (it threw)
    assert.match(result.recoveredFromWriteError, /timeout/);
  });

  test('complete: THIRD step (close) throws AND the re-fetch confirms it genuinely did not land -> ok:false, converged:false, a rerun-guidance message, current+expected both reported', () => {
    const plan = planTransition('complete');
    const result = executeTransition(plan, {
      applyStep: (step) => {
        if (step.type === 'close') throw new Error('gh issue close failed: network error');
        return { ok: true };
      },
      fetchLive: () => ({ state: 'open', lane: 'Done', status: 'Done' }), // lane/status landed, close did not
    });
    assert.equal(result.ok, false);
    assert.equal(result.converged, false);
    assert.equal(result.indeterminate, false);
    assert.equal(result.appliedSteps.length, 2);
    assert.equal(result.failedStep.type, 'close');
    assert.match(result.error, /network error/);
    assert.deepEqual(result.current, { state: 'open', lane: 'Done', status: 'Done' });
    assert.match(result.message, /re-run/i);
  });

  test('complete: FIRST step (lane) throws and never attempts status/close at all', () => {
    const applied = [];
    const plan = planTransition('complete');
    const result = executeTransition(plan, {
      applyStep: (step) => {
        applied.push(step.type);
        throw new Error('gh project item-edit failed: rate limited');
      },
      fetchLive: () => ({ state: 'open', lane: 'Active', status: 'In Progress' }),
    });
    assert.equal(result.ok, false);
    assert.deepEqual(applied, ['lane']); // status/close are never reached
    assert.equal(result.appliedSteps.length, 0);
    assert.equal(result.failedStep.type, 'lane');
  });

  test('a write error followed by a FAILED re-fetch is reported as indeterminate:true, distinct from a confirmed still-partial result — and this is NOT treated as a failure requiring rollback (no further writes are ever attempted)', () => {
    const plan = planTransition('complete');
    let fetchCalls = 0;
    const result = executeTransition(plan, {
      applyStep: (step) => {
        if (step.type === 'close') throw new Error('gh issue close failed: network error');
        return { ok: true };
      },
      fetchLive: () => { fetchCalls += 1; throw new Error('gh api graphql failed: could not resolve host'); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.indeterminate, true);
    assert.equal(result.converged, false);
    assert.match(result.fetchError, /could not resolve host/);
    assert.match(result.message, /re-run/i);
    assert.equal(fetchCalls, 1, 'exactly one recovery re-fetch is attempted, never more');
  });

  test('a write error with NO re-fetch failure, where the live state matches NEITHER the old nor the new target (some third state) is still just reported as a confirmed partial failure — no special-cased rollback path exists', () => {
    const plan = planTransition('reopen', { chosenLane: 'Up Next' });
    const result = executeTransition(plan, {
      applyStep: (step) => {
        if (step.type === 'reopen') return { ok: true };
        throw new Error('lane write failed');
      },
      fetchLive: () => ({ state: 'open', lane: null, status: null }), // reopened, but lane never got set to anything
    });
    assert.equal(result.ok, false);
    assert.equal(result.converged, false);
    assert.deepEqual(result.appliedSteps.map((e) => e.step.type), ['reopen']);
  });

  test('requires both applyStep and fetchLive callbacks', () => {
    const plan = planTransition('complete');
    assert.throws(() => executeTransition(plan, { fetchLive: () => true }), /applyStep/);
    assert.throws(() => executeTransition(plan, { applyStep: () => {} }), /fetchLive/);
  });

  test('never invokes applyStep for a step beyond the first failure (no compensation/undo steps are ever synthesized or applied)', () => {
    const applyLog = [];
    const plan = planTransition('archive');
    executeTransition(plan, {
      applyStep: (step) => {
        applyLog.push(step.type);
        if (step.type === 'status') throw new Error('status write failed');
        return { ok: true };
      },
      fetchLive: () => ({ state: 'open', lane: 'Archive', status: 'In Progress' }),
    });
    // Exactly the forward steps up to and including the failing one — no
    // extra "undo"/"compensate" steps of any kind.
    assert.deepEqual(applyLog, ['lane', 'status']);
  });
});

describe('deriveStatus — canonical (state, lane) invariant (open never Done/Archive; closed never nonterminal)', () => {
  test('open + non-terminal lane is valid', () => {
    const s = deriveStatus({ state: 'open', lane: 'Active' });
    assert.equal(s.valid, true);
    assert.equal(s.violation, null);
    assert.equal(s.state, 'open');
    assert.equal(s.lane, 'Active');
  });

  test('closed + terminal lane (Done or Archive) is valid', () => {
    assert.equal(deriveStatus({ state: 'closed', lane: 'Done' }).valid, true);
    assert.equal(deriveStatus({ state: 'closed', lane: 'Archive' }).valid, true);
  });

  test('open + terminal lane is an invariant violation ("open never Done/Archive")', () => {
    const s = deriveStatus({ state: 'open', lane: 'Done' });
    assert.equal(s.valid, false);
    assert.equal(s.violation, 'open-with-terminal-lane');
  });

  test('closed + non-terminal lane is an invariant violation ("closed never nonterminal")', () => {
    const s = deriveStatus({ state: 'closed', lane: 'Active' });
    assert.equal(s.valid, false);
    assert.equal(s.violation, 'closed-with-nonterminal-lane');
  });

  test('is case/shape tolerant of GraphQL-cased state (OPEN/CLOSED)', () => {
    assert.equal(deriveStatus({ state: 'OPEN', lane: 'Backlog' }).state, 'open');
    assert.equal(deriveStatus({ state: 'CLOSED', lane: 'Done' }).state, 'closed');
  });
});

describe('runTransition — idempotent convergence: no compensation/rollback, a rerun converges by applying only what is missing', () => {
  test('requires a `current` snapshot read BEFORE any write is attempted', () => {
    assert.throws(
      () => runTransition('complete', { applyStep: () => {}, fetchLive: () => true }),
      /`current`/,
    );
  });

  test('already fully converged (current matches the target already) -> ok:true, alreadyConverged:true, and applyStep/fetchLive are never even called', () => {
    let applyCalls = 0;
    let fetchCalls = 0;
    const result = runTransition('complete', {
      current: { state: 'closed', lane: 'Done', status: 'Done' },
      applyStep: () => { applyCalls += 1; return { ok: true }; },
      fetchLive: () => { fetchCalls += 1; return { state: 'closed', lane: 'Done', status: 'Done' }; },
    });
    assert.equal(result.ok, true);
    assert.equal(result.alreadyConverged, true);
    assert.equal(result.converged, true);
    assert.equal(applyCalls, 0);
    assert.equal(fetchCalls, 0);
  });

  test('full success from a genuinely different starting state: ok:true, alreadyConverged:false, priorStatus reflects the ORIGINAL current snapshot', () => {
    let live = { state: 'open', lane: 'Active', status: 'In Progress' };
    const result = runTransition('complete', {
      current: { ...live },
      applyStep: (step) => {
        if (step.type === 'lane') live = { ...live, lane: step.targetLane };
        else if (step.type === 'status') live = { ...live, status: step.targetStatus };
        else if (step.type === 'close') live = { ...live, state: 'closed' };
        return { ok: true };
      },
      fetchLive: () => live,
    });
    assert.equal(result.ok, true);
    assert.equal(result.alreadyConverged, false);
    assert.equal(result.priorStatus.valid, true);
    assert.equal(result.priorStatus.lane, 'Active');
  });

  test('THE R5 CORE SCENARIO: lane succeeds then close fails -> reports a partial (non-indeterminate) failure naming exactly what still differs, WITHOUT touching lane back — and a RERUN (fresh `current` read) converges by applying only the still-missing close step', () => {
    let live = { state: 'open', lane: 'Active', status: 'In Progress' };
    let closeShouldFail = true; // the transient network error is gone by the time of the rerun
    const applyLog = [];
    const applyStep = (step) => {
      applyLog.push(step.type);
      if (step.type === 'lane') { live = { ...live, lane: step.targetLane }; return { ok: true }; }
      if (step.type === 'status') { live = { ...live, status: step.targetStatus }; return { ok: true }; }
      if (step.type === 'close') {
        if (closeShouldFail) throw new Error('gh issue close failed: network error');
        live = { ...live, state: 'closed' };
        return { ok: true };
      }
      throw new Error(`unexpected step in this scenario: ${step.type}`);
    };
    const fetchLive = () => live;

    // --- first run: fails partway ---
    const first = runTransition('complete', {
      current: { ...live },
      applyStep,
      fetchLive,
    });
    assert.equal(first.ok, false);
    assert.equal(first.indeterminate, false);
    assert.equal(first.converged, false);
    assert.deepEqual(first.appliedSteps.map((e) => e.step.type), ['lane', 'status']);
    assert.match(first.error, /network error/);
    assert.match(first.message, /re-run/i);
    // Lane/Status DID actually land (not rolled back) — no blind-undo write:
    assert.equal(live.lane, 'Done');
    assert.equal(live.status, 'Done');
    assert.equal(live.state, 'open'); // only the close step is still missing
    assert.deepEqual(applyLog, ['lane', 'status', 'close']); // no extra 'lane'/'status' undo calls

    // --- rerun: a fresh `current` read reflects the partially-applied state ---
    applyLog.length = 0;
    closeShouldFail = false; // simulate the transient network error having cleared
    const second = runTransition('complete', {
      current: { ...live }, // simulates the caller re-fetching before the rerun
      applyStep,
      fetchLive,
    });
    assert.equal(second.ok, true);
    assert.equal(second.converged, true);
    // Only the missing step was applied this time — lane/status were
    // correctly recognized as already-satisfied and skipped.
    assert.deepEqual(applyLog, ['close']);
    assert.equal(live.state, 'closed');
    assert.equal(deriveStatus({ state: live.state, lane: live.lane }).valid, true);
  });

  test('reopen: reopen succeeds then lane-set fails -> partial failure, issue is left OPEN (never invisible-closed) with the wrong lane; a rerun with the lane already reopened only re-applies the still-missing lane/status', () => {
    let live = { state: 'closed', lane: 'Archive', status: 'Done' };
    const applyStep = (step) => {
      if (step.type === 'reopen') { live = { ...live, state: 'open' }; return { ok: true }; }
      if (step.type === 'lane') throw new Error('lane write failed: permission denied');
      throw new Error(`unexpected step: ${step.type}`);
    };
    const fetchLive = () => live;

    const first = runTransition('reopen', {
      chosenLane: 'Up Next',
      current: { ...live },
      applyStep,
      fetchLive,
    });
    assert.equal(first.ok, false);
    assert.equal(first.converged, false);
    assert.equal(live.state, 'open'); // reopened, never re-closed by any rollback
    assert.equal(live.lane, 'Archive'); // lane write never landed

    const applyStep2 = (step) => {
      if (step.type === 'lane') { live = { ...live, lane: step.targetLane }; return { ok: true }; }
      if (step.type === 'status') { live = { ...live, status: step.targetStatus }; return { ok: true }; }
      throw new Error(`unexpected step: ${step.type}`);
    };
    const second = runTransition('reopen', {
      chosenLane: 'Up Next',
      current: { ...live },
      applyStep: applyStep2,
      fetchLive,
    });
    assert.equal(second.ok, true);
    // 'reopen' was correctly skipped this time — only lane/status were missing.
    assert.deepEqual(second.appliedSteps.map((e) => e.step.type), ['lane', 'status']);
  });

  test('a write-error whose re-fetch shows the target was reached anyway is reported as a full success (recoveredFromWriteError set) — no rerun is even needed', () => {
    let live = { state: 'open', lane: 'Active', status: 'In Progress' };
    const applyStep = (step) => {
      if (step.type === 'close') {
        live = { ...live, state: 'closed' }; // the write actually landed...
        throw new Error('...but gh reported a client-side timeout waiting for the response');
      }
      if (step.type === 'lane') { live = { ...live, lane: step.targetLane }; return { ok: true }; }
      if (step.type === 'status') { live = { ...live, status: step.targetStatus }; return { ok: true }; }
      throw new Error(`unexpected step: ${step.type}`);
    };
    const result = runTransition('complete', {
      current: { ...live },
      applyStep,
      fetchLive: () => live,
    });
    assert.equal(result.ok, true);
    assert.match(result.recoveredFromWriteError, /timeout/);
  });

  test('an indeterminate result (re-fetch itself fails) is reported distinctly and never treated as a confirmed failure requiring any kind of rollback', () => {
    let live = { state: 'open', lane: 'Active', status: 'In Progress' };
    const applyStep = (step) => {
      if (step.type === 'lane') { live = { ...live, lane: step.targetLane }; return { ok: true }; }
      throw new Error('status write failed: rate limited');
    };
    const result = runTransition('complete', {
      current: { ...live },
      applyStep,
      fetchLive: () => { throw new Error('gh api graphql failed: could not resolve host'); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.indeterminate, true);
    // The lane write that DID land is never rolled back:
    assert.equal(live.lane, 'Done');
  });

  test('a project with no Status field (includeStatus:false) never plans, applies, or reads a status step', () => {
    const applied = [];
    const result = runTransition('complete', {
      current: { state: 'open', lane: 'Active', status: null },
      includeStatus: false,
      applyStep: (step) => { applied.push(step.type); return { ok: true }; },
      fetchLive: () => ({ state: 'closed', lane: 'Done', status: null }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(applied, ['lane', 'close']);
  });

  test('move converges Lane + Status without applying any issue state step', () => {
    let live = { state: 'open', lane: 'Up Next', status: 'Todo' };
    const applied = [];
    const result = runTransition('move', {
      chosenLane: 'Active',
      current: { ...live },
      applyStep: (step) => {
        applied.push(step.type);
        if (step.type === 'lane') live = { ...live, lane: step.targetLane };
        if (step.type === 'status') live = { ...live, status: step.targetStatus };
        return { ok: true };
      },
      fetchLive: () => live,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(applied, ['lane', 'status']);
    assert.equal(live.state, 'open');
  });
});

describe('pagination pure parsers/orchestrators (finding 3 — exhaustive projectItems/fieldValues traversal)', () => {
  describe('parseIssueStateResponse', () => {
    test('extracts issueId and lowercased state', () => {
      const data = { data: { repository: { issue: { id: 'I_1', state: 'OPEN' } } } };
      assert.deepEqual(parseIssueStateResponse(data), { issueId: 'I_1', state: 'open' });
    });
    test('throws on a response missing repository.issue', () => {
      assert.throws(() => parseIssueStateResponse({ data: { repository: { issue: null } } }), /repository\.issue/);
      assert.throws(() => parseIssueStateResponse({}), /repository\.issue/);
    });
  });

  describe('parseProjectItemsPage', () => {
    test('extracts items and pageInfo from one page', () => {
      const data = {
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: [{ id: 'PVTI_1', project: { number: 1 } }, { id: 'PVTI_2', project: { number: 2 } }],
                pageInfo: { hasNextPage: true, endCursor: 'CURSOR_A' },
              },
            },
          },
        },
      };
      const page = parseProjectItemsPage(data);
      assert.deepEqual(page.items, [{ id: 'PVTI_1', projectNumber: 1 }, { id: 'PVTI_2', projectNumber: 2 }]);
      assert.equal(page.hasNextPage, true);
      assert.equal(page.endCursor, 'CURSOR_A');
    });
    test('throws on an unexpected shape', () => {
      assert.throws(() => parseProjectItemsPage({}), /projectItems/);
    });
  });

  describe('parseFieldValuesPage', () => {
    test('extracts only single-select field values, ignoring other typenames', () => {
      const data = {
        data: {
          node: {
            fieldValues: {
              nodes: [
                { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'Active', field: { name: 'Lane' } },
                { __typename: 'ProjectV2ItemFieldTextValue', text: 'some note' },
                { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'In Progress', field: { name: 'Status' } },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
      const page = parseFieldValuesPage(data);
      assert.deepEqual(page.values, [
        { fieldName: 'Lane', value: 'Active' },
        { fieldName: 'Status', value: 'In Progress' },
      ]);
      assert.equal(page.hasNextPage, false);
    });
    test('throws on an unexpected shape', () => {
      assert.throws(() => parseFieldValuesPage({}), /fieldValues/);
    });
  });

  describe('findProjectItemId — exhaustive projectItems pagination', () => {
    test('finds the target project on the FIRST page without further requests', () => {
      let calls = 0;
      const id = findProjectItemId(5, {
        fetchProjectItemsPage: () => {
          calls += 1;
          return {
            data: {
              repository: {
                issue: {
                  projectItems: {
                    nodes: [{ id: 'ITEM_ours', project: { number: 5 } }],
                    pageInfo: { hasNextPage: true, endCursor: 'C1' },
                  },
                },
              },
            },
          };
        },
      });
      assert.equal(id, 'ITEM_ours');
      assert.equal(calls, 1, 'must stop as soon as the target project is found, even if more pages exist');
    });

    test('finds the target project on a LATER page (3rd) — proves exhaustive pagination, not just first-page truncation', () => {
      const pages = [
        { nodes: [{ id: 'ITEM_a', project: { number: 100 } }], hasNextPage: true, endCursor: 'C1' },
        { nodes: [{ id: 'ITEM_b', project: { number: 101 } }], hasNextPage: true, endCursor: 'C2' },
        { nodes: [{ id: 'ITEM_ours', project: { number: 5 } }], hasNextPage: false, endCursor: null },
      ];
      const seenAfters = [];
      const id = findProjectItemId(5, {
        fetchProjectItemsPage: (after) => {
          seenAfters.push(after);
          const p = pages[seenAfters.length - 1];
          return {
            data: {
              repository: {
                issue: { projectItems: { nodes: p.nodes, pageInfo: { hasNextPage: p.hasNextPage, endCursor: p.endCursor } } },
              },
            },
          };
        },
      });
      assert.equal(id, 'ITEM_ours');
      assert.deepEqual(seenAfters, [null, 'C1', 'C2']);
    });

    test('returns null (not found) once the connection is exhausted without a match', () => {
      const id = findProjectItemId(5, {
        fetchProjectItemsPage: () => ({
          data: {
            repository: {
              issue: {
                projectItems: {
                  nodes: [{ id: 'ITEM_other', project: { number: 999 } }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        }),
      });
      assert.equal(id, null);
    });

    test('throws rather than looping forever if hasNextPage never becomes false (defensive safety valve)', () => {
      assert.throws(() => findProjectItemId(5, {
        fetchProjectItemsPage: () => ({
          data: {
            repository: {
              issue: {
                projectItems: {
                  nodes: [{ id: 'ITEM_x', project: { number: 999 } }],
                  pageInfo: { hasNextPage: true, endCursor: 'always-more' },
                },
              },
            },
          },
        }),
      }), /exceeded .* projectItems pages/);
    });
  });

  describe('collectFieldValues — exhaustive fieldValues pagination', () => {
    test('accumulates single-select values across multiple pages (Lane on page 1, Status on page 3)', () => {
      const pages = [
        { values: [{ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'Active', field: { name: 'Lane' } }], hasNextPage: true, endCursor: 'C1' },
        { values: [{ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'P1', field: { name: 'Priority' } }], hasNextPage: true, endCursor: 'C2' },
        { values: [{ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'In Progress', field: { name: 'Status' } }], hasNextPage: false, endCursor: null },
      ];
      let call = 0;
      const all = collectFieldValues({
        fetchFieldValuesPage: () => {
          const p = pages[call]; call += 1;
          return { data: { node: { fieldValues: { nodes: p.values, pageInfo: { hasNextPage: p.hasNextPage, endCursor: p.endCursor } } } } };
        },
      });
      assert.deepEqual(all, [
        { fieldName: 'Lane', value: 'Active' },
        { fieldName: 'Priority', value: 'P1' },
        { fieldName: 'Status', value: 'In Progress' },
      ]);
      assert.equal(call, 3);
    });

    test('throws rather than looping forever if hasNextPage never becomes false (defensive safety valve)', () => {
      assert.throws(() => collectFieldValues({
        fetchFieldValuesPage: () => ({
          data: { node: { fieldValues: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'always-more' } } } },
        }),
      }), /exceeded .* fieldValues pages/);
    });
  });
});

describe('TERMINAL_LANES', () => {
  test('is exactly the set of terminal lane names from TERMINAL_LANE_BY_ACTION', () => {
    assert.deepEqual(new Set(TERMINAL_LANES), new Set(['Done', 'Archive']));
  });
});
