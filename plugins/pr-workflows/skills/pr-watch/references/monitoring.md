# Change-driven monitoring

Use the bundled `scripts/watch.mjs`, not a recurring agent prompt. Node 20+ is
required. GitHub uses the existing `gh` login; Azure DevOps uses
`AZURE_DEVOPS_EXT_PAT` if already set, otherwise an Azure CLI token for Azure
DevOps. Do not print tokens, invent credentials, or change account defaults.
Supported URLs: github.com, dev.azure.com, and legacy *.visualstudio.com PRs.

## Start and resume

Resolve the script's absolute path from this skill's installation location.
Store the state file outside the repository in the current session's artifact
directory. Reuse one state file for this PR, including after interruption.
Do not pass template placeholders literally:

```bash
node <skill-path>/scripts/watch.mjs wait \
  --url <exact-pr-url> --state <absolute-state-file> --interval 600
```

`--interval` is in seconds. A user's "every 5 minutes" means `--interval 300`.
The first successful read returns a compact JSON event. After handling it:

```bash
node <skill-path>/scripts/watch.mjs ack \
  --state <same-state-file> --token <delivered-token>
node <skill-path>/scripts/watch.mjs wait \
  --url <same-pr-url> --state <same-state-file> --interval 600
```

Run the wait as one attached shell command with the longest supported initial
wait (600 seconds in this host). If it continues in the background, end the
turn and wait for its completion notification. Read the completed output once.
Do not check progress with repeated tool calls, impose shell timeouts, or run
another watcher. The script has no overall deadline: human approval may take
hours. No unchanged poll prints output or starts a model. Host/process loss
still interrupts coverage; a definition cannot guarantee an always-on service.
If the host cannot keep an attached command alive, report that limitation and
agree on a supported persistent execution mechanism rather than scheduling
unconditional model turns or silently declaring completion.

## Events and acknowledgment

- `changed`: first observation or semantic change in revisions, checks,
  reviews, policy state, or feedback. Fetch full evidence only where needed.
- `ready`: candidate endpoint. Independently re-read current provider state and
  feedback before reporting completion.
- `terminal`: PR merged externally, closed, or abandoned. Report its actual state
  and stop, without resuming. An acknowledged terminal state is replayed locally
  if accidentally resumed; it does not start another polling loop.
- `error`: monitoring cannot safely continue. Report the error; no green verdict.

Each successful event has an opaque token and a snapshot containing IDs and
content hashes rather than comment bodies. Timestamps, progress text, array
ordering, and heartbeat noise do not cause wakeups. Comments, edited replies,
review decisions, changed check attempts, and new source/target revisions do.

Feedback changes deliver `changed` events even while CI is queued, running, or
failing; `ready` is not required to handle comments. Follow the skill's
feedback-first procedure on the initial observation and subsequent events.
Detection during an idle wait occurs on the next configured poll, not through
instant push notifications. While the agent handles an event, use live feedback
reads at safe work checkpoints; do not start a second watcher.

An event remains pending until its exact token is acknowledged. A crash before
acknowledgment replays it, so consult recorded dispositions and verify uncertain
pushes/replies before repeating them. `ack` records only that delivered snapshot:
it never fetches or silently swallows feedback that arrived during a fix.
After an own push/reply, a subsequent event may confirm that publication; do not
repeat the action. State and locks are private local files. A second process
using the same state is rejected. After a crash, inspect the reported owner PID
and remove only the named stale `.lock` file when no watcher remains. The
script never races another process by automatically deleting its lock.
Use `--token` as data, not shell code. Quoted/argument-array execution is preferred.

## Readiness and coverage

All observed current checks must report success, including optional checks.
Neutral, skipped, partially succeeded, missing checks, stale builds, unknown
mergeability, drafts, unresolved threads, and missing approval do not qualify.
GitHub also requires its authoritative `APPROVED` review decision, no pending
review requests, and a non-author `User` approval that has not been dismissed.
Azure DevOps requires a non-author reviewer with explicit individual AAD identity
metadata and an approving vote, no negative votes, all required reviewer votes,
and approved blocking policies. Missing identity metadata fails closed; the
agent must verify the actual approving identity from authoritative evidence.
Provider `User`/AAD metadata does not prove a physical person operates an account;
the final check must rule out known service accounts and bots, not just groups.
An otherwise-green event with approval but incomplete identity metadata should
trigger that verification even without a `ready` candidate. Independently
establishing every endpoint condition is sufficient; do not wait for a metadata
field that the provider never supplies. Without that evidence, remain blocked.
ADO build-policy builds must match the PR source or evaluated merge revision.
Old iteration statuses block readiness until refreshed or explicitly adjudicated.

The collector brackets reads with PR metadata checks to reject a moving head or
target. GitHub REST/GraphQL pagination and ADO policy pagination are exhausted;
failed or incomplete reads fail closed. No script can decide whether an
arbitrary bot comment is actionable or whether a provider omitted an expected
check. The agent must verify expected CI configuration, review freshness,
provider-specific expiration/approval rules, and feedback dispositions before
accepting `ready`. New comments on already-resolved threads still need assessment.

The script never writes to the provider, edits code, launches Copilot, approves,
or merges. Diagnosis, justified requeues, fixes, and replies belong to the
agent when it wakes. Use the existing helper procedures; do not duplicate them
inside a second polling loop.

## Checks

```bash
node --test <skill-path>/scripts/watch.test.mjs
node <skill-path>/scripts/watch.mjs --help
```

Tests use synthetic provider responses, not credentials or real PR mutations.
They exercise normalization, readiness, pagination, failure handling,
acknowledgment/replay, locking, and an actual unchanged-poll wait loop.
