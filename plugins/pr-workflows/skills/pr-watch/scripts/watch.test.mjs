import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
  parseTarget, normalize, collectGithub, collectAdo, adoClient, adoList,
  waitForChange, acknowledge, withLock,
} from './watch.mjs';

const clone = value => structuredClone(value);
const ghTarget = parseTarget('https://github.com/example/repo/pull/42');
const adoTarget = parseTarget('https://dev.azure.com/example/Project/_git/repo/pullrequest/42');
const green = () => normalize({
  provider: 'github', state: 'OPEN', head: 'head', base: 'base', merge: 'merge',
  draft: false, mergeable: 'MERGEABLE', mergeState: 'CLEAN', approved: true,
  checks: [{ id: 'check:1', name: 'tests', state: 'success', revision: 'head' }],
  policies: [], feedback: [], reviews: [],
});
const pending = () => normalize({ ...green(), approved: false });
const tempState = async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-watch-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'state.json');
};

function githubFixture() {
  const pr = {
    state: 'OPEN', headRefOid: 'head', baseRefOid: 'base', baseRefName: 'main',
    isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED', reviewRequests: [], potentialMergeCommit: null,
    author: { login: 'author' },
  };
  const data = {
    pr, checks: [[{ id: 1, name: 'tests', status: 'completed', conclusion: 'success' }]],
    statuses: [], comments: [], inline: [], reviews: [
      { id: 1, state: 'APPROVED', commit_id: 'head', user: { login: 'reviewer', type: 'User' } },
    ],
    threads: [{ data: { repository: { pullRequest: { reviewThreads: {
      pageInfo: { hasNextPage: false, endCursor: null }, nodes: [],
    } } } } }],
  };
  let views = 0;
  const calls = [];
  const run = async (program, args) => {
    assert.equal(program, 'gh');
    calls.push(args);
    if (args[0] === 'pr') {
      views++;
      return JSON.stringify(views > 1 && data.after ? data.after : data.pr);
    }
    assert(args.includes('--paginate'));
    assert(args.includes('--slurp'));
    if (args.includes('graphql')) return JSON.stringify(data.threads);
    const endpoint = args.at(-1);
    if (endpoint.includes('/check-runs?')) return JSON.stringify(data.checks.map(check_runs => ({ check_runs })));
    if (endpoint.includes('/statuses?')) return JSON.stringify([data.statuses]);
    if (endpoint.includes('/issues/')) return JSON.stringify([data.comments]);
    if (endpoint.includes('/comments?')) return JSON.stringify([data.inline]);
    if (endpoint.includes('/reviews?')) return JSON.stringify([data.reviews]);
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  };
  return { data, run, calls };
}

function adoFixture() {
  const pr = {
    status: 'active', lastMergeSourceCommit: { commitId: 'head' },
    lastMergeTargetCommit: { commitId: 'base' }, lastMergeCommit: { commitId: 'merge' },
    isDraft: false, mergeStatus: 'succeeded', createdBy: { id: 'author' },
    repository: { project: { id: 'project-id' } },
    reviewers: [{ id: 'reviewer', vote: 10, isRequired: true, isContainer: false, isAadIdentity: true }],
  };
  const data = {
    pr, policies: [{ evaluationId: 'eval', status: 'approved',
      configuration: { isBlocking: true, isEnabled: true, revision: 1,
        type: { id: '0609b952-1397-4640-95ec-e00a01b2c241', displayName: 'Build' } },
      context: { buildId: 7 } }],
    statuses: [], threads: [], iterations: [{ id: 2 }],
    build: { status: 'completed', result: 'succeeded', sourceVersion: 'merge', definition: { name: 'tests' } },
  };
  let views = 0;
  const get = async (relative, params = {}) => {
    if (relative.endsWith('/42')) {
      views++;
      return { body: views > 1 && data.after ? data.after : data.pr };
    }
    if (relative === 'policy/evaluations') {
      assert.equal(params.artifactId, 'vstfs:///CodeReview/CodeReviewId/project-id/42');
      return { body: { value: data.policies } };
    }
    if (relative === 'build/builds/7') return { body: data.build };
    for (const key of ['statuses', 'threads', 'iterations']) {
      if (relative.endsWith(`/${key}`)) return { body: { value: data[key] } };
    }
    throw new Error(`Unexpected ADO route: ${relative}`);
  };
  return { data, get };
}

test('parses canonical and legacy URLs without forwarding query strings', () => {
  assert.equal(parseTarget(`${ghTarget.url}?x=1#discussion`).url, ghTarget.url);
  assert.equal(adoTarget.project, 'Project');
  assert.equal(parseTarget('https://example.visualstudio.com/DefaultCollection/O365%20Core/_git/Repo/pullRequest/7').project, 'O365 Core');
  assert.equal(parseTarget('https://example.visualstudio.com/Project/_git/Repo/pullrequest/7').origin, 'https://example.visualstudio.com');
});

test('rejects untrusted origins, credentials, encoded path separators and non-PR URLs', () => {
  for (const url of [
    'http://github.com/example/repo/pull/42', 'https://user:secret@github.com/example/repo/pull/42',
    'https://github.com.evil.test/example/repo/pull/42', 'https://dev.azure.com/Org/Project/_git/R/pullrequest/0',
    'https://github.com/example/re%2Fpo/pull/42', 'https://github.com/example/repo/issues/42',
  ]) assert.throws(() => parseTarget(url));
});

test('readiness requires every check passing, human approval, no draft or unresolved threads', () => {
  assert.equal(green().ready, true);
  for (const patch of [
    { approved: false }, { draft: true }, { checks: [] }, { mergeable: 'UNKNOWN' },
    { mergeState: 'BLOCKED' }, { feedback: [{ id: 9, unresolved: true }] },
    { checks: [{ state: 'neutral' }] }, { checks: [{ state: 'skipped' }] },
    { checks: [{ state: 'success' }, { state: 'failure', optional: true }] },
    { policies: [{ blocking: true, state: 'approved', expired: true }] },
  ]) assert.equal(normalize({ ...green(), ...patch }).ready, false, JSON.stringify(patch));
});

test('GitHub paginates checks, keeps optional failures and deduplicates historical statuses', async () => {
  const { data, run } = githubFixture();
  data.checks.push([{ id: 2, name: 'optional', status: 'completed', conclusion: 'failure' }]);
  data.statuses = [{ id: 3, context: 'external', state: 'success' }, { id: 2, context: 'external', state: 'failure' }];
  const result = await collectGithub(ghTarget, run);
  assert.equal(result.checks.length, 3);
  assert.equal(result.checks.find(c => c.name === 'external').state, 'success');
  assert.equal(result.ready, false);
});

test('GitHub approval qualifies only when no review requests remain', async () => {
  const a = githubFixture();
  assert.equal((await collectGithub(ghTarget, a.run)).ready, true);
  const b = githubFixture();
  b.data.pr.reviewRequests = [{ login: 'another-reviewer' }];
  assert.equal((await collectGithub(ghTarget, b.run)).ready, false);
});

test('GitHub requires a non-author User approval; bot-only, unknown, or dismissed votes do not qualify', async () => {
  for (const mutate of [
    d => { d.reviews[0].user.type = 'Bot'; },
    d => { delete d.reviews[0].user.type; },
    d => { d.reviews[0].user.login = 'author'; },
    d => { d.reviews.push({ id: 2, state: 'DISMISSED', user: { login: 'reviewer', type: 'User' } }); },
  ]) {
    const { data, run } = githubFixture();
    mutate(data);
    assert.equal((await collectGithub(ghTarget, run)).ready, false);
  }
  const { data, run } = githubFixture();
  data.reviews.push({ id: 2, state: 'COMMENTED', user: { login: 'reviewer', type: 'User' } });
  assert.equal((await collectGithub(ghTarget, run)).ready, true);
});

test('GitHub review bodies can be absent, null or empty without hiding review decisions', async () => {
  for (const body of [undefined, null, '']) {
    const { data, run } = githubFixture();
    data.reviews[0].body = body;
    const result = await collectGithub(ghTarget, run);
    assert.equal(result.ready, true);
    assert.equal(result.reviews.length, 1);
  }
});

test('GitHub edits change fingerprints but timestamp/ordering noise does not', async () => {
  const a = githubFixture();
  a.data.comments = [{ id: 1, body: 'original', user: { login: 'reviewer' }, updated_at: 'old' }];
  const original = await collectGithub(ghTarget, a.run);
  a.data.comments[0].updated_at = 'later';
  assert.deepEqual(await collectGithub(ghTarget, a.run), original);
  a.data.comments[0].body = 'edited';
  assert.notDeepEqual(await collectGithub(ghTarget, a.run), original);
  assert.equal(JSON.stringify(original).includes('original'), false);
  assert.deepEqual(normalize({ ...green(), checks: [{ id: 2 }, { id: 1 }] }),
    normalize({ ...green(), checks: [{ id: 1 }, { id: 2 }] }));
});

test('GitHub fails closed on GraphQL errors, incomplete pagination or moving heads', async () => {
  const a = githubFixture();
  a.data.threads = [{ errors: [{ message: 'denied' }] }];
  await assert.rejects(collectGithub(ghTarget, a.run), /query failed/);
  const b = githubFixture();
  b.data.threads[0].data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage = true;
  await assert.rejects(collectGithub(ghTarget, b.run), /Incomplete/);
  const c = githubFixture();
  c.data.after = { ...c.data.pr, headRefOid: 'new-head' };
  await assert.rejects(collectGithub(ghTarget, c.run), /changed during/);
});

test('GitHub thread pagination includes unresolved threads on later pages', async () => {
  const { data, run } = githubFixture();
  const page = clone(data.threads[0]);
  data.threads[0].data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage = true;
  page.data.repository.pullRequest.reviewThreads.nodes = [{ id: 'late', isResolved: false }];
  data.threads.push(page);
  assert.equal((await collectGithub(ghTarget, run)).ready, false);
});

test('GitHub source and test-merge checks must all pass', async () => {
  const { data, run } = githubFixture();
  data.pr.potentialMergeCommit = { oid: 'merge-sha' };
  const wrapped = async (program, args) => {
    if (args.at(-1).includes('/commits/merge-sha/check-runs')) {
      return JSON.stringify([{ check_runs: [{ id: 2, name: 'merge tests', status: 'in_progress' }] }]);
    }
    return run(program, args);
  };
  const result = await collectGithub(ghTarget, wrapped);
  assert.equal(result.checks.length, 2);
  assert.equal(result.ready, false);
});

test('ADO requires current successful builds and required approvals', async () => {
  const a = adoFixture();
  assert.equal((await collectAdo(adoTarget, a.get)).ready, true);
  for (const mutate of [
    d => { d.build.sourceVersion = 'old'; },
    d => { d.policies[0].context.isExpired = true; },
    d => { d.policies[0].status = 'queued'; },
    d => { d.pr.reviewers[0].vote = -5; },
    d => { d.pr.reviewers[0].id = 'author'; },
    d => { delete d.pr.reviewers[0].isAadIdentity; },
    d => { d.pr.reviewers[0].isContainer = true; },
    d => { d.build.result = 'partiallySucceeded'; },
  ]) {
    const { data, get } = adoFixture();
    mutate(data);
    assert.equal((await collectAdo(adoTarget, get)).ready, false);
  }
});

test('ADO old iteration status blocks readiness and newer context replaces history', async () => {
  const { data, get } = adoFixture();
  data.statuses = [{ id: 1, context: { name: 'quality' }, state: 'succeeded', iterationId: 1 }];
  assert.equal((await collectAdo(adoTarget, get)).ready, false);
  data.statuses.push({ id: 2, context: { name: 'quality' }, state: 'succeeded', iterationId: 2 });
  const result = await collectAdo(adoTarget, get);
  assert.equal(result.ready, true);
  assert.equal(result.checks.length, 2);
});

test('ADO ignores system chatter, catches comment edits and active or pending threads', async () => {
  const { data, get } = adoFixture();
  const original = await collectAdo(adoTarget, get);
  data.threads = [{ id: 1, status: 'closed', comments: [{ id: 1, commentType: 'system', content: 'heartbeat' }] }];
  assert.deepEqual(await collectAdo(adoTarget, get), original);
  data.threads.push({ id: 2, status: 'pending', comments: [{ id: 1, commentType: 'text', content: 'please fix' }] });
  const before = await collectAdo(adoTarget, get);
  assert.equal(before.ready, false);
  data.threads[1].comments[0].content = 'edited';
  assert.notDeepEqual(await collectAdo(adoTarget, get), before);
});

test('ADO policies paginate by skip and collections by continuation token', async () => {
  const queries = [];
  const rows = await adoList(async (_route, query) => {
    queries.push(query);
    return { body: { value: query.$skip === '0' ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }] } };
  }, 'policy/evaluations', {}, true);
  assert.equal(rows.length, 101);
  assert.equal(queries[1].$skip, '100');
  let calls = 0;
  assert.deepEqual(await adoList(async (_route, query) => {
    calls++;
    return query.continuationToken ? { body: { value: [2] } }
      : { body: { value: [1] }, continuation: 'next' };
  }, 'git/list'), [1, 2]);
  assert.equal(calls, 2);
  await assert.rejects(adoList(async () => ({ body: { value: [] }, continuation: 'same' }), 'git/list'), /Repeated/);
});

test('ADO client obtains only the documented token and never follows redirects', async () => {
  const oldPat = process.env.AZURE_DEVOPS_EXT_PAT;
  const token = `synthetic-${randomUUID()}`;
  delete process.env.AZURE_DEVOPS_EXT_PAT;
  try {
    const get = await adoClient(adoTarget, async (program, args) => {
      assert.equal(program, 'az');
      assert(args.includes('499b84ac-1321-427f-aa17-267ca6975798'));
      return JSON.stringify({ accessToken: token });
    }, async (url, options) => {
      assert.equal(url.origin, 'https://dev.azure.com');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(options.headers.Authorization.split(' '), ['Bearer', token]);
      return { ok: true, json: async () => ({ value: [] }), headers: new Headers() };
    });
    assert.deepEqual((await get('git/test')).body, { value: [] });
    const denied = await adoClient(adoTarget, async () => '{"accessToken":"synthetic-token"}',
      async () => ({ ok: false, status: 403 }));
    await assert.rejects(denied('git/test'), /HTTP 403/);
  } finally {
    if (oldPat === undefined) delete process.env.AZURE_DEVOPS_EXT_PAT;
    else process.env.AZURE_DEVOPS_EXT_PAT = oldPat;
  }
});

test('first observation delivers, pending replay is exact, acknowledgment is idempotent', async t => {
  const file = await tempState(t);
  const first = await waitForChange({ file, target: ghTarget, collect: async () => pending() });
  assert.equal(first.outcome, 'changed');
  const replay = await waitForChange({ file, target: ghTarget, collect: async () => { throw new Error('must not fetch'); } });
  assert.deepEqual(replay, first);
  await assert.rejects(acknowledge(file, 'wrong'), /does not match/);
  assert.equal((await acknowledge(file, first.token)).outcome, 'acknowledged');
  assert.equal((await acknowledge(file, first.token)).outcome, 'acknowledged');
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('unchanged polls stay inside one wait call, using the default 600-second interval', async t => {
  const file = await tempState(t);
  const first = await waitForChange({ file, target: ghTarget, collect: async () => pending() });
  await acknowledge(file, first.token);
  let polls = 0;
  const pauses = [];
  const event = await waitForChange({
    file, target: ghTarget, collect: async () => ++polls < 4 ? pending() : green(),
    pause: async seconds => { pauses.push(seconds); },
  });
  assert.equal(polls, 4);
  assert.deepEqual(pauses, [600, 600, 600]);
  assert.equal(event.outcome, 'ready');
});

test('ack never swallows concurrent feedback and a new head requires fresh green checks', async t => {
  const file = await tempState(t);
  const first = await waitForChange({ file, target: ghTarget, collect: async () => pending() });
  await acknowledge(file, first.token);
  const next = normalize({ ...pending(), head: 'new', checks: [{ id: 2, state: 'pending', revision: 'new' }],
    feedback: [{ id: 'new-comment', hash: 'new-body' }] });
  const event = await waitForChange({ file, target: ghTarget, collect: async () => next });
  assert.equal(event.outcome, 'changed');
  assert.equal(event.snapshot.head, 'new');
  assert.equal(event.snapshot.feedback.length, 1);
});

for (const provider of ['github', 'ado']) {
  test(`${provider} delivers existing, new and edited feedback while CI remains running`, async t => {
    const file = await tempState(t);
    const fixture = provider === 'github' ? githubFixture() : adoFixture();
    const { data } = fixture;
    const target = provider === 'github' ? ghTarget : adoTarget;
    const collect = provider === 'github'
      ? () => collectGithub(target, fixture.run)
      : () => collectAdo(target, fixture.get);
    const comments = [{ id: 1, body: 'existing', user: { login: 'reviewer' } }];
    if (provider === 'github') {
      data.checks[0][0].status = 'in_progress';
      data.checks[0][0].conclusion = null;
      data.comments = comments;
    } else {
      data.build.status = 'inProgress';
      data.build.result = null;
      data.policies[0].status = 'running';
      data.threads = [{ id: 1, status: 'active', comments: [
        { id: 1, commentType: 'text', content: 'existing' },
      ] }];
    }
    const wait = () => waitForChange({ file, target, collect,
      pause: async () => { throw new Error('feedback must deliver without waiting for CI'); } });
    const first = await wait();
    assert.equal(first.outcome, 'changed');
    assert.equal(first.snapshot.ready, false);
    assert.equal(first.snapshot.feedback.length, 1);

    if (provider === 'github') {
      comments.push({ id: 2, body: 'new', user: { login: 'reviewer' } });
    } else {
      data.threads[0].comments.push({ id: 2, commentType: 'text', content: 'new' });
    }
    assert.deepEqual(await wait(), first);
    await acknowledge(file, first.token);
    const next = await wait();
    assert.equal(next.outcome, 'changed');
    assert.equal(next.snapshot.ready, false);
    assert.deepEqual(next.snapshot.checks, first.snapshot.checks);
    assert.notDeepEqual(next.snapshot.feedback, first.snapshot.feedback);
    await acknowledge(file, next.token);

    if (provider === 'github') comments[1].body = 'edited';
    else data.threads[0].comments[1].content = 'edited';
    const edited = await wait();
    assert.equal(edited.outcome, 'changed');
    assert.equal(edited.snapshot.ready, false);
    assert.deepEqual(edited.snapshot.checks, first.snapshot.checks);
    assert.notDeepEqual(edited.snapshot.feedback, next.snapshot.feedback);
  });
}

test('acknowledged ready candidates do not repeatedly wake on an unchanged PR', async t => {
  const file = await tempState(t);
  const event = await waitForChange({ file, target: ghTarget, collect: async () => green() });
  await acknowledge(file, event.token);
  let sleeps = 0;
  await assert.rejects(waitForChange({
    file, target: ghTarget, collect: async () => green(),
    pause: async () => { sleeps++; throw new Error('test stop'); },
  }), /test stop/);
  assert.equal(sleeps, 1);
});

test('terminal states are explicit and approval alone never completes monitoring', async t => {
  const file = await tempState(t);
  const event = await waitForChange({
    file, target: ghTarget, collect: async () => normalize({ ...green(), state: 'MERGED' }),
  });
  assert.equal(event.outcome, 'terminal');
  assert.equal(event.snapshot.ready, false);
  assert.equal(normalize({ ...green(), checks: [{ state: 'pending' }] }).ready, false);
  await acknowledge(file, event.token);
  const resumed = await waitForChange({ file, target: ghTarget,
    collect: async () => { throw new Error('terminal watch must not poll again'); } });
  assert.equal(resumed.outcome, 'terminal');
  assert.equal(resumed.alreadyAcknowledged, true);
});

test('older acknowledged terminal state is upgraded and does not poll indefinitely', async t => {
  const file = await tempState(t);
  const terminal = normalize({ ...green(), state: 'CLOSED' });
  const event = await waitForChange({ file, target: ghTarget, collect: async () => terminal });
  await acknowledge(file, event.token);
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  delete state.finished;
  await fs.writeFile(file, JSON.stringify(state));
  const resumed = await waitForChange({ file, target: ghTarget, collect: async () => terminal,
    pause: async () => { throw new Error('terminal state must not sleep'); } });
  assert.equal(resumed.outcome, 'terminal');
  assert.equal(resumed.alreadyAcknowledged, true);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).finished.outcome, 'terminal');
});
test('locks reject duplicates, release after errors, and never delete another owner lock', async t => {
  const file = await tempState(t);
  await withLock(file, async () => {
    await assert.rejects(withLock(file, async () => {}), /Another watcher/);
    assert.equal((await fs.stat(`${file}.lock`)).isFile(), true);
  });
  await assert.rejects(withLock(file, async () => { throw new Error('provider unavailable'); }), /provider unavailable/);
  await assert.rejects(fs.stat(`${file}.lock`), { code: 'ENOENT' });
});

test('state mismatch, malformed state, invalid intervals and provider errors fail closed', async t => {
  const file = await tempState(t);
  await waitForChange({ file, target: ghTarget, collect: async () => pending() });
  await assert.rejects(waitForChange({ file, target: adoTarget, collect: async () => green() }), /another PR/);
  await assert.rejects(waitForChange({ file, target: ghTarget, interval: 0, collect: async () => green() }), /Interval/);
  await fs.writeFile(file, '{invalid');
  await assert.rejects(waitForChange({ file, target: ghTarget, collect: async () => green() }), /Invalid JSON/);
  await fs.unlink(file);
  await assert.rejects(waitForChange({ file, target: ghTarget, collect: async () => { throw new Error('API unavailable'); } }), /API unavailable/);
});

test('CLI stays running and silent through unchanged real polls, then returns on approval', { timeout: 15_000 }, async t => {
  const file = await tempState(t);
  const directory = path.dirname(file);
  const fixture = path.join(directory, 'provider.json');
  const gh = path.join(directory, 'gh');
  const data = githubFixture().data;
  data.pr.reviewDecision = 'REVIEW_REQUIRED';
  await fs.writeFile(fixture, JSON.stringify(data));
  await fs.writeFile(gh, `#!/usr/bin/env node
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync(process.env.PR_WATCH_TEST_DATA, 'utf8'));
const args = process.argv.slice(2);
const endpoint = args.at(-1);
let result;
if (args[0] === 'pr') result = d.pr;
else if (args.includes('graphql')) result = d.threads;
else if (endpoint.includes('/check-runs?')) result = d.checks.map(check_runs => ({ check_runs }));
else if (endpoint.includes('/statuses?')) result = [d.statuses];
else if (endpoint.includes('/issues/')) result = [d.comments];
else if (endpoint.includes('/comments?')) result = [d.inline];
else if (endpoint.includes('/reviews?')) result = [d.reviews];
else process.exit(2);
process.stdout.write(JSON.stringify(result));
`, { mode: 0o700 });
  const exec = promisify(execFile);
  const script = new URL('./watch.mjs', import.meta.url).pathname;
  const env = { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    PR_WATCH_TEST_DATA: fixture };
  const args = [script, 'wait', '--url', ghTarget.url, '--state', file, '--interval', '1'];
  const first = JSON.parse((await exec(process.execPath, args, { env })).stdout);
  await exec(process.execPath, [script, 'ack', '--state', file, '--token', first.token], { env });
  const child = spawn(process.execPath, args, { env });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  let errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const exited = once(child, 'exit');
  await sleep(1500);
  assert.equal(child.exitCode, null);
  assert.equal(output, '');
  data.pr.reviewDecision = 'APPROVED';
  await fs.writeFile(fixture, JSON.stringify(data));
  const [code] = await exited;
  assert.equal(code, 0, errors);
  assert.equal(errors, '');
  assert.equal(JSON.parse(output).outcome, 'ready');
  assert.equal(output.trim().split('\n').length, 1);
});

test('CLI help and argument failures execute without contacting a provider', async () => {
  const exec = promisify(execFile);
  const script = new URL('./watch.mjs', import.meta.url).pathname;
  assert.match((await exec(process.execPath, [script, '--help'])).stdout, /--interval 600/);
  await assert.rejects(exec(process.execPath, [script, 'wait', '--state', 'relative']), error =>
    error.code === 1 && error.stderr.includes('State path must be absolute'));
});
