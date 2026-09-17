---
name: github-session-sync
description: "Reviews the just-finished Copilot session and updates the related GitHub issue so the GitHub personal board stays a source of truth linking issues to the sessions that produced them. Posts a concise progress comment carrying a hidden <!-- copilot-session:<uuid> --> marker and records a local session-to-issue mapping for fast rediscovery. Invoked by the agentStop session-yield hook (via the backend-neutral task-session-sync dispatcher, headless copilot -p) when taskBackend is \"github\", but also usable on request. Use when syncing a session to GitHub, updating an issue with progress, recording what a session changed, or linking a session to an issue. Triggers: github session sync, update issue with progress, session-to-issue, sync session to github, stamp issue with session, session-yield hook."
user-invocable: false
---

# GitHub Session Sync

Review the session that just yielded control back to the user, infer which GitHub
issue the work relates to, and update that issue with a short progress comment
carrying a hidden `<!-- copilot-session:<uuid> -->` marker — so every issue links
back to the session(s) that moved it. This is the GitHub-backend twin of
`ado-session-sync`; see that skill's SKILL.md for the parallel ADO procedure and
[assistant-capture's task-backend contract](../assistant-capture/references/task-backend-contract.md) for the shared contract.

This skill is normally driven non-interactively: the `agentStop` hook's
`task-session-sync.sh`/`.ps1` dispatcher launches a headless `copilot -p` agent that
invokes this procedure whenever `taskBackend == "github"`. It can also be run on
explicit request.

## When to Use

- A session yielded control and you were launched (headless) to sync it to GitHub.
- The user explicitly asks to "sync this session to GitHub" / "update the issue with
  what I did".
- You need to link the current session to an issue for later rediscovery.

## When to Skip

- The personal task backend is not GitHub — abort (see Step 1). This skill only
  writes to the GitHub board configured under `config.github`.
- No real work happened this session (no edits, commits, or meaningful tool
  actions) — exit quietly.
- You cannot confidently identify a single related issue — **skip rather than
  guess**. Do not fall back to "the most recently touched issue".
- Creating or restructuring the Project board, or bidirectional GitHub→session
  sync — out of scope.

## Inputs

Same shape as `ado-session-sync`'s Inputs table: `parentSession` (stamp the
`<!-- copilot-session:<parentSession> -->` marker and reference it in the comment),
`syncSession` (pass to the logger as `--child`), `transcriptPath`, `cwd`.

> **Use `parentSession` verbatim — and validate it.** Same rule as `ado-session-sync`:
> a session id is a full `8-4-4-4-12` hex UUID. `session-map.mjs`'s `markerFor` /
> `recordMapping` reject anything else with a clear error — if you see that error,
> you copied the wrong value; re-read `parentSession` from the prompt.

## Procedure

> **Always record exactly one terminal outcome.** Same rule as `ado-session-sync`
> Step 8 — every path through this procedure ends by logging one `result` or `error`
> event, even an early skip.

### Step 1 — Preconditions (fail safe)

1. **Backend + opt-in.** Read the selected assistant config
   (`COPILOT_PLUGIN_ASSISTANT_CONFIG`, legacy `COPILOT_PLUGIN_ADO_CONFIG`, or
   `~/.copilot/assistant/config.json`). Env
   `COPILOT_PLUGIN_GITHUB_SESSION_SYNC=0` or `COPILOT_PLUGIN_TASK_SESSION_SYNC=0` force-disables sync
   regardless of config. Otherwise proceed only when both:
   - `taskBackend == "github"`, and
   - sync is enabled: `taskSessionSync.enabled == true` **or** env
     `COPILOT_PLUGIN_GITHUB_SESSION_SYNC=1` / `COPILOT_PLUGIN_TASK_SESSION_SYNC=1`.
   Otherwise exit quietly.
2. **Read GitHub settings** from the same config: `github.owner`, `github.repo`,
   `github.projectNumber`, `github.ownerType` (see [assistant-capture §3.6.0](../assistant-capture/references/github-configuration.md)).
   Confirm `gh` is on PATH and authenticated as an identity permitted to write —
   the exact check mirrors [assistant-capture §3.6.0's prerequisite](../assistant-capture/references/github-configuration.md) exactly:
   - `ownerType: "user"` (default) — the authenticated identity must be
     **exactly** `github.owner` (`gh api user --jq .login`); a mismatch is
     always a hard stop, never a silent skip.
   - `ownerType: "org"` — `github.owner` is an organization, so no identity
     "is" it; instead confirm write access to `github.repo`
     (`gh api repos/<owner>/<repo> --jq .permissions.push` must be `true`).
   A failed identity/permission check is an `error` (Step 8, `stage=precondition`),
   not a silent skip — this skill must never write to a board it isn't
   authorized for, but it also must never refuse a legitimately authorized
   org-project write just because no single login equals the org name.

### Step 2 — Determine whether real work happened

Identical to `ado-session-sync` Step 2: uncommitted changes, new commits this
session, or substantive transcript actions. If none, exit quietly.

### Step 3 — Summarize what changed

Identical to `ado-session-sync` Step 3 — a terse 2–5 sentence factual note.

### Step 4 — Infer the related issue (priority order; skip if none)

> **A bare `#N` mention is NEVER, by itself, confident evidence of a GitHub
> issue.** `assistant-capture`'s own ADO team-work-item cross-reference
> convention writes ADO references in exactly this shape (`[#nnn]`, see
> [assistant-capture §3.6.1](../assistant-capture/references/github-tasks.md#361-field-mapping-locked-taxonomy)) — a session that merely says "fixed the thing
> from `[#94]`" is very likely talking about an **ADO** work item, not GitHub
> issue #94 in the configured repo. Treating a bare number as confident would
> risk posting a private session-progress summary to an unrelated (or
> entirely wrong) GitHub issue. **This is enforced in code, not prose:** you
> MUST run the `resolve` subcommand below and act ONLY on its exit code —
> never decide "close enough" yourself from the raw signals.

**Run the executable resolver — do not re-derive this precedence by hand:**

```bash
node <skill-dir>/scripts/session-map.mjs resolve --session "<parentSession>" \
  [--explicit-url <N>] [--explicit-wording <N>] [--bare-number <N>] \
  [--repo-context-confirmed] [--branch-ref <N>] [--commit-ref <N>]
```

Extract the candidate values from the transcript/cwd first, exactly as before:

1. **`--explicit-url <N>`** — an unambiguous GitHub issue URL for the *configured*
   repo (`github.com/<config.github.owner>/<config.github.repo>/issues/152`) found
   in the transcript or user prompts.
2. **`--explicit-wording <N>`** — explicit GitHub-scoped wording ("GitHub issue
   #152", "gh issue #152") in the transcript or user prompts.
3. **`--branch-ref <N>` / `--commit-ref <N>` + `--repo-context-confirmed`** — a
   branch name like `152-...`/`feature/152-...`, or a commit message referencing
   `#152`, in `cwd` — but pass `--repo-context-confirmed` **only** after confirming
   `cwd`'s git remote actually resolves to the configured
   `<config.github.owner>/<config.github.repo>` (use `session-map.mjs`'s
   `remoteMatchesConfiguredRepo(remoteUrl, owner, repo)` against
   `git -C "<cwd>" remote get-url origin`). Omitting this flag when the repo is
   unconfirmed is what keeps a numeric ref from an unrelated local checkout from
   ever being trusted.
4. **`--bare-number <N>`** — any other unqualified `#152`/`152` mention with none
   of the above corroboration. Always pass it if present — the resolver, not you,
   decides whether it counts.

The local session-to-issue cache (re-sync) is consulted automatically by
`resolve` via `--session` — you do not pass it as a flag.

**The command's exit code is the ONLY thing that decides what happens next —
do not override it with your own judgment call:**

| Exit code | Meaning | Required action |
|---|---|---|
| `0` | Confident match — `result.issue` in stdout JSON is safe to use | Proceed to validate it below |
| `3` | **`result.source === 'ambiguous'`** — a bare number with no corroborating GitHub context was code-rejected | **Skip.** Log `skipped` with `--reason ambiguous` (Step 8). Never fall back to using `result.ambiguousRef` anyway. |
| `4` | No signal at all (not even a bare number) | **Skip.** Log `skipped` with `--reason no-work`. |
| `2` | Bad input (e.g. missing `--session`) | Fix the invocation — this is a bug in how you called it, not a sync outcome. |

Validate the chosen issue exists and is not closed with `Lane = Archive` (skip
unless the user explicitly asked to reopen-and-sync):

```bash
gh issue view <number> --repo "<owner>/<repo>" --json number,title,state,body
```

### Step 5 — Idempotency check (read your last sync before posting)

1. Get this session's exact marker text — **never hand-write it**:
   ```bash
   node <skill-dir>/scripts/session-map.mjs marker --session "<parentSession>"
   # -> <!-- copilot-session:<parentSession> -->
   ```
2. List the issue's existing comments and check whether any already contains this
   exact marker:
   ```bash
   gh issue view <number> --repo "<owner>/<repo>" --json comments \
     --jq '.comments[].body' | grep -F "<!-- copilot-session:<parentSession> -->"
   ```
3. **Post only if there is materially new work** since that prior comment (same
   rule as `ado-session-sync` Step 5) — write the delta only, never restate prior
   progress. If nothing is materially new, skip (`--reason duplicate`, Step 8).

### Step 6 — Update the issue

Post one comment carrying both the progress note and the hidden marker (comment,
not edit — never rewrite a prior comment's marker, so the audit trail of every
sync stays intact):

```bash
gh issue comment <number> --repo "<owner>/<repo>" --body "Session <parentSession> progress: <2-5 sentence note>. (auto-synced from Copilot session)

<!-- copilot-session:<parentSession> -->"
```

Then record the local mapping so a re-sync of this session finds this issue
without re-searching:

```bash
node <skill-dir>/scripts/session-map.mjs record \
  --session "<parentSession>" --owner "<owner>" --repo "<repo>" --issue "<number>"
```

State handling (conservative, mirrors `ado-session-sync` Step 6):

- If the issue's `Lane` is `Backlog` and work clearly started, you may move it to
  `Active` ([capture §3.6.4](../assistant-capture/references/github-tasks.md#364-complete--archive--reopen--move--update-a-task) / [§3.6.6](../assistant-capture/references/github-tasks.md#366-standard-agent-flow-operations)). Respect the lane state machine — never jump straight to
  `Done`/`Archive` on a normal sync.
- **Do not** auto-close on a normal sync. Only close when the session unambiguously
  completed the work *and* the user asked to close it.
- Use the `Blocked` lane per [assistant-capture §3.6.5](../assistant-capture/references/github-tasks.md#365-board-flow--lane-management) if the session shows the
  work is blocked.

### Step 7 — Report

Emit one concise line: the issue number, the action taken (commented+tagged, or
skipped+why). When run interactively, tell the user which issue was updated and
link it: `https://github.com/<owner>/<repo>/issues/<number>`.

### Step 8 — Record the outcome (always)

Use the **same bundled logger as `ado-session-sync`** —
`<plugin-root>/skills/ado-session-sync/scripts/log-run.sh` — so every sync (either
backend) lands in the one shared audit trail
(`~/.copilot/logs/ado-session-sync/runs.jsonl`) that `sync-status.sh` and the
`ado-sync-advisory` hook already read. The event/action/reason vocabulary is
**identical** to `ado-session-sync` Step 8, with one addition: use `item` for the
GitHub issue number (same field name, same meaning — just a different backend's id
space) and omit `state-nudged` from the action set (GitHub sync never auto-nudges a
lane the way ADO nudges `State`).

| Field | Allowed values (closed set) |
|-------|------------------------------|
| `--event` | `result` · `error` |
| `--action` (result only) | `commented+tagged` · `tagged-only` · `skipped` |
| `--reason` (skipped result) | `no-work` · `ambiguous` · `closed-item` · `duplicate` |
| `--stage` (error) | `precondition` · `infer` · `update` |
| `--reason` (error) | `write-blocked` · `gh-failed` · `bad-input` |

```bash
<plugin-root>/skills/ado-session-sync/scripts/log-run.sh --event result \
  --parent "<parentSession>" --child "<syncSession>" \
  --item <number> --action "commented+tagged" \
  --note "<the same 2-5 sentence progress note>"
```

**On a blocked or failed write** (the harness denied `gh`, or `gh` errored) — this is
a **failure, not a skip**:

```bash
<plugin-root>/skills/ado-session-sync/scripts/log-run.sh --event error \
  --parent "<parentSession>" --stage update --reason write-blocked \
  --detail "<terse: which write was denied/failed, and the issue number>"
```

Keep `--note`/`--detail` terse (2–5 sentences, ≤400 chars), no secrets, **never a
token**, no transcript dumps.

## Idempotency & Safety Summary

- **One marker per session, per issue** — `<!-- copilot-session:<uuid> -->` is
  appended to exactly one comment per (session, issue) pair; re-syncs check for the
  marker before posting again (Step 5).
- **No per-session labels** — the local `session-issue-map.json` cache plus the
  hidden marker are the only rediscovery mechanisms; this skill never creates a
  `session:<id>` label on an issue (unlike ADO's tag, which is a first-class
  queryable field — GitHub labels are not a safe substitute for unbounded
  per-session values).
- **Local cache is a cache, not a source of truth** — every write path still
  verifies the marker is actually present on the remote issue before treating a
  cache hit as "already synced" (Step 4.3/Step 5).
- **Never mutates ADO** — this skill only ever reads/writes the GitHub board
  configured under `config.github`.

## Notes

- Bundled script: `scripts/session-map.mjs` — marker text, hidden-marker parsing,
  local session→issue mapping I/O, and the pure issue-resolution precedence
  function. Covered by `scripts/tests/session-map.test.mjs`.
- Recursion guard, debounce, repo allowlist, detached-child cleanup, and fail-open
  behavior are handled by the launcher hook (`hooks/github-session-sync.sh`/`.ps1`),
  reached via the backend-neutral `hooks/task-session-sync.sh`/`.ps1` dispatcher —
  not by this skill. See those files' header comments for the full gating order.
- Monitoring: the same `ado-session-sync` skill's `scripts/sync-status.sh` viewer
  reads this skill's log entries too (shared log file) — `sync-status.sh --errors`
  works regardless of which backend produced an entry.
