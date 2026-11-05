import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const exec = promisify(execFile);
const BUILD_POLICY = '0609b952-1397-4640-95ec-e00a01b2c241';
const fields = 'state,headRefOid,baseRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,reviewDecision,reviewRequests,potentialMergeCommit,author';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sorted = rows => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const array = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`Incomplete ${label} response`);
  return value;
};
const required = (value, label) => {
  if (value === undefined || value === null || value === '') throw new Error(`Missing ${label}`);
  return value;
};

export function parseTarget(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('Use an HTTPS PR URL without credentials or a custom port');
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.some(p => p === '.' || p === '..' || /[/\\?#]/.test(p))) throw new Error('Invalid PR path');
  if (url.hostname === 'github.com' && parts.length === 4 && parts[2] === 'pull' && /^[1-9]\d*$/.test(parts[3])) {
    const [owner, repo, , id] = parts;
    if (![owner, repo].every(p => /^[\w.-]+$/.test(p))) throw new Error('Invalid GitHub repository');
    return { provider: 'github', owner, repo, id, url: `https://github.com/${owner}/${repo}/pull/${id}` };
  }
  const marker = parts.indexOf('_git');
  let origin;
  let project;
  if (url.hostname === 'dev.azure.com' && marker === 2) {
    origin = `https://dev.azure.com/${encodeURIComponent(parts[0])}`;
    project = parts[1];
  } else if (/^[a-z0-9-]+\.visualstudio\.com$/i.test(url.hostname) && [1, 2].includes(marker)) {
    origin = `https://${url.hostname}${marker === 2 ? `/${encodeURIComponent(parts[0])}` : ''}`;
    project = parts[marker - 1];
  }
  if (origin && parts[marker + 2]?.toLowerCase() === 'pullrequest'
      && parts.length === marker + 4 && /^[1-9]\d*$/.test(parts[marker + 3])) {
    const repo = parts[marker + 1];
    const id = parts[marker + 3];
    return { provider: 'ado', origin, project, repo, id,
      url: `${origin}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${id}` };
  }
  throw new Error('Unsupported PR URL; use github.com, dev.azure.com, or *.visualstudio.com');
}

async function command(program, args) {
  try {
    const result = await exec(program, args, {
      timeout: 90_000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GH_PAGER: '', GH_PROMPT_DISABLED: '1', AZURE_CORE_NO_COLOR: '1' },
    });
    return result.stdout;
  } catch (error) {
    // Provider stderr may contain credentials or private content.
    throw new Error(`${program} request failed (${error.code ?? 'timeout'}); check authentication/access locally`);
  }
}

function json(text, label) {
  try { return JSON.parse(text); }
  catch { throw new Error(`Invalid JSON from ${label}`); }
}

async function ghPages(run, endpoint, key) {
  const pages = json(await run('gh', ['api', '--hostname', 'github.com', '--paginate', '--slurp', endpoint]), 'GitHub');
  return array(pages, 'GitHub pages').flatMap(page => array(key ? page[key] : page, 'GitHub collection'));
}

function githubIdentity(pr) {
  return { state: required(pr.state, 'PR state'), head: required(pr.headRefOid, 'head'),
    base: required(pr.baseRefOid, 'base'), draft: pr.isDraft,
    author: required(pr.author?.login, 'PR author'),
    mergeable: pr.mergeable, mergeState: pr.mergeStateStatus,
    approval: pr.reviewDecision ?? null, requests: sorted(array(pr.reviewRequests, 'review requests')),
    merge: pr.potentialMergeCommit?.oid ?? null };
}

export async function collectGithub(target, run = command) {
  const root = `repos/${target.owner}/${target.repo}`;
  const view = async () => json(await run('gh', [
    'pr', 'view', target.id, '--repo', `${target.owner}/${target.repo}`, '--json', fields,
  ]), 'GitHub PR');
  const pr = await view();
  const identity = githubIdentity(pr);
  if (identity.state !== 'OPEN') return normalize({ ...identity, provider: 'github', checks: [], policies: [], feedback: [], reviews: [] });
  const revisions = [...new Set([identity.head, identity.merge].filter(Boolean))];
  const query = `query($owner:String!,$repo:String!,$number:Int!,$endCursor:String) {
    repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
      reviewThreads(first:100,after:$endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id isResolved }
      }
    } }
  }`;
  const [runs, statuses, reviews, comments, inline, threadPages] = await Promise.all([
    Promise.all(revisions.map(sha => ghPages(run, `${root}/commits/${sha}/check-runs?filter=latest&per_page=100`, 'check_runs')
      .then(rows => rows.map(r => ({ ...r, observedRevision: sha }))))),
    Promise.all(revisions.map(sha => ghPages(run, `${root}/commits/${sha}/statuses?per_page=100`)
      .then(rows => rows.map(r => ({ ...r, observedRevision: sha }))))),
    ghPages(run, `${root}/pulls/${target.id}/reviews?per_page=100`),
    ghPages(run, `${root}/issues/${target.id}/comments?per_page=100`),
    ghPages(run, `${root}/pulls/${target.id}/comments?per_page=100`),
    run('gh', ['api', '--hostname', 'github.com', 'graphql', '--paginate', '--slurp',
      '-f', `query=${query}`, '-F', `owner=${target.owner}`, '-F', `repo=${target.repo}`, '-F', `number=${target.id}`])
      .then(text => json(text, 'GitHub review threads')),
  ]);
  const latest = new Map();
  for (const s of statuses.flat()) {
    const key = `${s.observedRevision}:${required(s.context, 'status context')}`;
    if (!latest.has(key) || Number(s.id) > Number(latest.get(key).id)) latest.set(key, s);
  }
  const checks = [
    ...runs.flat().map(r => ({ id: `check:${required(r.id, 'check id')}`, name: r.name,
      revision: r.observedRevision, state: r.status === 'completed' ? r.conclusion : r.status })),
    ...[...latest.values()].map(s => ({ id: `status:${s.id}`, name: s.context,
      revision: s.observedRevision, state: s.state })),
  ];
  const feedback = [
    ...comments.map(c => ({ id: `comment:${c.id}`, hash: digest([c.user?.login, c.body]) })),
    ...inline.map(c => ({ id: `inline:${c.id}`, hash: digest([c.user?.login, c.body, c.in_reply_to_id]) })),
  ];
  let hasNext = true;
  const threads = array(threadPages, 'thread pages').flatMap(page => {
    if (page.errors?.length) throw new Error('GitHub review-thread query failed');
    const connection = required(page.data?.repository?.pullRequest?.reviewThreads, 'review threads');
    hasNext = required(connection.pageInfo, 'thread pagination').hasNextPage;
    return array(connection.nodes, 'threads');
  });
  if (hasNext !== false) throw new Error('Incomplete GitHub review-thread pagination');
  feedback.push(...threads.map(t => ({ id: `thread:${t.id}`, unresolved: t.isResolved !== true })));
  if (digest(identity) !== digest(githubIdentity(await view()))) throw new Error('PR changed during collection; retry observation');
  const decisions = new Map();
  for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) {
      decisions.set(review.user?.login, review);
    }
  }
  const userApproval = [...decisions.values()].some(r => r.state === 'APPROVED'
    && r.user?.type === 'User' && r.user.login !== identity.author && !r.user.login.endsWith('[bot]'));
  return normalize({ ...identity, provider: 'github', checks, policies: [], feedback,
    approved: identity.approval === 'APPROVED' && identity.requests.length === 0 && userApproval,
    reviews: reviews.map(r => ({ id: r.id, state: r.state, revision: r.commit_id,
      author: r.user?.login, authorType: r.user?.type ?? 'unknown', hash: digest([r.body]) })) });
}

export async function adoClient(target, run = command, request = fetch) {
  const pat = process.env.AZURE_DEVOPS_EXT_PAT;
  const token = pat ? null : json(await run('az', ['account', 'get-access-token',
    '--resource', '499b84ac-1321-427f-aa17-267ca6975798', '--output', 'json']), 'Azure authentication').accessToken;
  const authorization = pat ? `Basic ${Buffer.from(`:${pat}`).toString('base64')}` : `Bearer ${required(token, 'Azure DevOps access token')}`;
  return async (relative, params = {}) => {
    const url = new URL(`${target.origin}/${encodeURIComponent(target.project)}/_apis/${relative}`);
    url.search = new URLSearchParams({ 'api-version': '7.1', ...params }).toString();
    let response;
    try {
      response = await request(url, { headers: { Authorization: authorization, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(30_000) });
    } catch { throw new Error('Azure DevOps request interrupted; check network and authentication'); }
    if (!response.ok) throw new Error(`Azure DevOps HTTP ${response.status}; check access before resuming`);
    return { body: await response.json(), continuation: response.headers.get('x-ms-continuationtoken') };
  };
}

export async function adoList(get, relative, params = {}, skipPaging = false) {
  const rows = [];
  const seen = new Set();
  let continuation;
  for (let page = 0; page < 1000; page++) {
    const query = { ...params };
    if (skipPaging) Object.assign(query, { '$top': '100', '$skip': String(rows.length) });
    if (continuation) query.continuationToken = continuation;
    const result = await get(relative, query);
    const items = array(result.body.value, 'Azure DevOps collection');
    rows.push(...items);
    continuation = result.continuation;
    if (continuation) {
      if (seen.has(continuation)) throw new Error('Repeated Azure DevOps pagination token');
      seen.add(continuation);
    } else if (!skipPaging || items.length < 100) return rows;
  }
  throw new Error('Azure DevOps pagination limit exceeded');
}

function adoIdentity(pr) {
  return { state: required(pr.status, 'PR status'), head: required(pr.lastMergeSourceCommit?.commitId, 'source revision'),
    base: required(pr.lastMergeTargetCommit?.commitId, 'target revision'),
    merge: pr.lastMergeCommit?.commitId ?? null, draft: pr.isDraft,
    mergeable: pr.mergeStatus, author: required(pr.createdBy?.id, 'PR author'),
    reviewers: sorted(array(pr.reviewers, 'reviewers').map(r => ({
      id: r.id, vote: r.vote, required: r.isRequired === true, group: r.isContainer === true,
      identity: r.isContainer === true ? 'group'
        : r.isContainer === false && r.isAadIdentity === true ? 'user' : 'unknown',
    }))) };
}

export async function collectAdo(target, get) {
  const root = `git/repositories/${encodeURIComponent(target.repo)}/pullRequests/${target.id}`;
  const pr = (await get(root)).body;
  const identity = adoIdentity(pr);
  if (identity.state !== 'active') return normalize({ ...identity, provider: 'ado', checks: [], policies: [], feedback: [], reviews: [] });
  const projectId = required(pr.repository?.project?.id, 'project ID');
  const [evaluations, statuses, threads, iterations] = await Promise.all([
    adoList(get, 'policy/evaluations', { 'api-version': '7.1-preview.1',
      artifactId: `vstfs:///CodeReview/CodeReviewId/${projectId}/${target.id}` }, true),
    adoList(get, `${root}/statuses`),
    adoList(get, `${root}/threads`),
    adoList(get, `${root}/iterations`),
  ]);
  const iteration = iterations.reduce((n, i) => Math.max(n, i.id), 0);
  if (!iteration) throw new Error('Missing PR iterations');
  const relevant = evaluations.filter(e => e.configuration?.isEnabled !== false
    && !e.configuration?.isDeleted && e.status !== 'notApplicable');
  const policies = relevant.map(e => ({
    id: required(e.evaluationId, 'policy evaluation ID'), state: e.status,
    blocking: e.configuration?.isBlocking !== false,
    revision: e.configuration?.revision, expired: e.context?.isExpired === true,
  }));
  const checks = await Promise.all(relevant.filter(e => e.configuration?.type?.id === BUILD_POLICY
    || e.context?.buildId).map(async e => {
    const id = e.context?.buildId;
    if (!id) return { id: `build-policy:${e.evaluationId}`, name: e.configuration?.type?.displayName,
      state: e.status, revision: null };
    const b = (await get(`build/builds/${encodeURIComponent(id)}`)).body;
    return { id: `build:${id}`, name: b.definition?.name,
      state: b.status === 'completed' ? b.result : b.status,
      revision: b.sourceVersion, current: [identity.head, identity.merge].includes(b.sourceVersion)
        && e.status === 'approved' && e.context?.isExpired !== true };
  }));
  const latest = new Map();
  for (const s of statuses) {
    const key = JSON.stringify([s.context?.genre, required(s.context?.name, 'status context')]);
    if (!latest.has(key) || Number(s.id) > Number(latest.get(key).id)) latest.set(key, s);
  }
  checks.push(...[...latest.values()].map(s => ({
    id: `status:${s.id}`, name: `${s.context.genre ?? ''}/${s.context.name}`, state: s.state,
    revision: s.iterationId ?? null, current: !s.iterationId || s.iterationId === iteration,
  })));
  const feedback = threads.filter(t => !t.isDeleted).flatMap(t => {
    const comments = array(t.comments, 'thread comments').filter(c => !c.isDeleted
      && c.commentType !== 'system' && c.commentType !== 3);
    if (!comments.length) return [];
    return [{ id: `thread:${t.id}`, unresolved: ['active', 'pending', 1, 6].includes(t.status),
      hash: digest(comments.map(c => [c.id, c.parentCommentId, c.author?.id, c.content])) }];
  });
  if (digest(identity) !== digest(adoIdentity((await get(root)).body))) throw new Error('PR changed during collection; retry observation');
  const voters = identity.reviewers.filter(r => r.identity === 'user' && r.id !== identity.author);
  const approved = voters.some(r => r.vote >= 5) && identity.reviewers.every(r => r.vote >= 0
    && (!r.required || r.vote >= 5));
  return normalize({ ...identity, provider: 'ado', approved, checks, policies, feedback, reviews: [] });
}

export function normalize(snapshot) {
  const result = { ...snapshot };
  for (const key of ['checks', 'policies', 'feedback', 'reviews']) result[key] = sorted(array(result[key], key));
  const open = ['OPEN', 'active'].includes(result.state);
  const checksGreen = result.checks.length > 0 && result.checks.every(c =>
    ['success', 'succeeded'].includes(c.state) && c.current !== false);
  result.ready = open && result.draft === false && result.approved === true
    && ['MERGEABLE', 'succeeded'].includes(result.mergeable)
    && (result.provider !== 'github' || result.mergeState === 'CLEAN')
    && checksGreen && result.policies.every(p => !p.blocking || (p.state === 'approved' && !p.expired))
    && result.feedback.every(f => f.unresolved !== true);
  return result;
}

async function loadState(file, url) {
  let state;
  try { state = json(await fs.readFile(file, 'utf8'), 'watch state'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { version: 1, url, acknowledged: null, pending: null };
  }
  if (state.version !== 1 || !state.url || (url && state.url !== url)) throw new Error('State belongs to another PR or schema');
  return state;
}

async function saveState(file, state) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function withLock(file, operation) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = json(await fs.readFile(lock, 'utf8'), 'watch lock');
    if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('Watch lock requires manual inspection');
    try { process.kill(owner.pid, 0); }
    catch (probe) {
      if (probe.code !== 'ESRCH') throw new Error('Cannot verify watch lock owner');
      throw new Error(`Stale watch lock (PID ${owner.pid}); verify no watcher remains before removing ${lock}`);
    }
    throw new Error(`Another watcher owns this state (PID ${owner.pid})`);
  }
  if (!handle) throw new Error('Could not acquire watch lock');
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname() }));
    return await operation();
  } finally {
    await handle.close();
    await fs.unlink(lock);
  }
}

export async function acknowledge(file, token) {
  return withLock(file, async () => {
    const state = await loadState(file);
    if (state.lastToken === token && !state.pending) return { outcome: 'acknowledged', token };
    if (!state.pending || state.pending.token !== token) throw new Error('Token does not match the delivered event');
    state.acknowledged = digest(state.pending.snapshot);
    if (state.pending.outcome === 'terminal') state.finished = state.pending;
    state.lastToken = token;
    state.pending = null;
    await saveState(file, state);
    return { outcome: 'acknowledged', token };
  });
}

export async function waitForChange({ file, target, interval = 600, collect,
  pause = seconds => sleep(seconds * 1000), signal }) {
  if (!Number.isFinite(interval) || interval < 1) throw new Error('Interval must be at least one second');
  return withLock(file, async () => {
    const state = await loadState(file, target.url);
    if (state.pending) return state.pending;
    if (state.finished) return { ...state.finished, alreadyAcknowledged: true };
    while (true) {
      signal?.throwIfAborted();
      const snapshot = await collect(target);
      const fingerprint = digest(snapshot);
      const terminal = !['OPEN', 'active'].includes(snapshot.state);
      if (terminal && fingerprint === state.acknowledged) {
        state.finished = { outcome: 'terminal', token: state.lastToken, url: target.url, snapshot };
        await saveState(file, state);
        return { ...state.finished, alreadyAcknowledged: true };
      }
      if (fingerprint !== state.acknowledged) {
        const outcome = terminal ? 'terminal' : snapshot.ready ? 'ready' : 'changed';
        state.pending = { outcome, token: randomUUID(), url: target.url, snapshot };
        await saveState(file, state);
        return state.pending;
      }
      await pause(interval);
    }
  });
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args.includes('--help')) {
    console.log('Usage: node watch.mjs wait --url HTTPS_PR_URL --state ABSOLUTE_FILE [--interval 600]\n'
      + '       node watch.mjs ack --state ABSOLUTE_FILE --token DELIVERED_TOKEN\n'
      + 'No model calls; unchanged polls stay silent. wait runs until change, readiness, closure, or error.');
    return;
  }
  const [mode, ...rest] = args;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!['--url', '--state', '--interval', '--token'].includes(key) || !rest[i + 1]
        || options[key] !== undefined) throw new Error('Invalid or duplicate command argument');
    options[key] = rest[i + 1];
  }
  const file = required(options['--state'], 'state path');
  if (!path.isAbsolute(file)) throw new Error('State path must be absolute');
  if (mode === 'ack') {
    if (options['--url'] || options['--interval']) throw new Error('ack accepts only state and token');
    console.log(JSON.stringify(await acknowledge(file, required(options['--token'], 'token'))));
  } else if (mode === 'wait') {
    if (options['--token']) throw new Error('Use ack to acknowledge a token');
    const target = parseTarget(required(options['--url'], 'PR URL'));
    const collect = target.provider === 'github' ? collectGithub
      : async t => collectAdo(t, await adoClient(t));
    console.log(JSON.stringify(await waitForChange({
      file, target, interval: Number(options['--interval'] ?? 600), collect,
    })));
  } else throw new Error('Choose wait or ack');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(JSON.stringify({ outcome: 'error', message: error.message }));
    process.exitCode = 1;
  });
}
