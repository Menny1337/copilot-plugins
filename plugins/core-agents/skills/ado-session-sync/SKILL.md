---
name: ado-session-sync
description: "Reviews the just-finished Copilot session and updates the related Azure DevOps work item so the ADO board stays a source of truth linking work items to the sessions that produced them. Posts a concise progress comment and stamps the work item with a session:<id> tag for later rediscovery. Invoked by the agentStop session-yield hook (headless copilot -p) but also usable on request. Use when syncing a session to ADO, updating a work item with progress, recording what a session changed, or tagging a work item with its session id. Triggers: ado session sync, update work item with progress, session-to-task, sync session to ADO, stamp session id on work item, session-yield hook."
user-invocable: false
---

# ADO Session Sync

Review the session that just yielded control back to the user, infer which Azure DevOps
work item the work relates to, and update that work item with a short progress note plus a
`session:<id>` tag — so every work item links back to the session(s) that moved it.

This skill is normally driven non-interactively: the `agentStop` hook launches a headless
`copilot -p` agent that invokes this procedure. It can also be run on explicit request.

## When to Use

- A session yielded control and you were launched (headless) to sync it to ADO.
- The user explicitly asks to "sync this session to ADO" / "update the work item with what I did".
- You need to stamp a work item with the current session id for later rediscovery.

## When to Skip

- The personal task backend is not ADO — abort (see Step 1). This skill only writes to ADO.
- No real work happened this session (no edits, commits, or meaningful tool actions) — exit quietly.
- You cannot confidently identify a single related work item — **skip rather than guess**
  (no over-updating unrelated items). Do not fall back to "the most recent item".
- Creating or restructuring the board, or bidirectional ADO→session sync — out of scope.

## Inputs

When launched by the hook you are given (in the prompt) the `agentStop` payload fields:

| Field | Use |
|-------|-----|
| `parentSession` | The triggering session's id — stamp it on the work item (`session:<parentSession>` tag) and reference it in the comment. (Manual runs: `sessionId`.) |
| `syncSession` | This headless sync run's own id — pass it to the logger as `--child` so the audit trail links parent → sync. |
| `transcriptPath` | Path to the session transcript — read it to summarize what changed. |
| `cwd` | Working directory — inspect git state here for branch/commit signals. |

Throughout this skill, "the session id" / `<sessionId>` means `parentSession` (the work the
user did), not `syncSession` (this background run).

> **Use `parentSession` verbatim — and validate it.** Copy the `parentSession` value from the
> prompt exactly as the session id. Do **not** truncate it, abbreviate it, or substitute any
> other identifier (a tool-call id like `toolu_…`, the `syncSession`, a commit sha, etc.). Before
> you tag or log, sanity-check it: a session id is a full UUID — `8-4-4-4-12` hex, e.g.
> `123e4567-e89b-42d3-a456-426614174000`. If the value you are about to use is **not** a full
> UUID (it's shortened, or starts with `toolu_`), you have the wrong id — re-read `parentSession`
> from the prompt. Never write a `session:` tag or a logger `--parent` from anything but the exact
> `parentSession` UUID. Wrong or truncated ids pollute the board with bogus `session:` tags **and**
> break Step 5 idempotency: the next sync can't find its own tag and re-posts a duplicate comment.

If invoked manually without these, derive the session id from the session context and use the
current repo as `cwd`.

## Procedure

> **Always record exactly one terminal outcome.** Every path through this procedure — a
> successful update *or* any deliberate skip *or* an error — must end by logging one `result`
> or `error` event (Step 8). That is what makes the audit trail complete. Do this even when you
> exit early.

### Step 1 — Preconditions (fail safe)

> Recursion is handled by the launcher hook, **not** here: the hook refuses to start a sync
> when one is already running, and it launches this headless child with `ADO_SYNC_ACTIVE=1`
> set. That variable is therefore *expected* to be set while you run — do **not** treat it as a
> reason to stop. Proceed with the sync normally.

1. **Backend + opt-in.** Read `~/.copilot/assistant/config.json`. Env `ADO_SESSION_SYNC=0`
   force-disables sync regardless of config — treat that the same as an explicit skip, even on
   an explicit user request. Otherwise proceed only when both:
   - `taskBackend == "ado"`, and
   - sync is enabled: `adoSessionSync.enabled == true` **or** env `ADO_SESSION_SYNC=1`.
   Otherwise exit quietly (no output, no error).
2. **Read ADO settings** from the same config: `ado.org`, `ado.project`, `ado.assignedTo`,
   `ado.fieldMap`, plus optional auth knobs `ado.tenantId` (pin the org's Entra tenant) and
   the PAT-fallback `ado.patFile` / `ado.patEnv`. Confirm `az` is on PATH.
3. **Establish the ADO auth context (short-lived AAD token — frictionless, headless-safe).**
   `az boards` / `az devops` must **not** depend on whichever `az` subscription is *active*.
   In a headless sync the active subscription is frequently the wrong account/tenant for
   `ado.org` (e.g. a personal MSA / personal-tenant subscription is active because you are
   working in another repo, while the org is corp-tenant) → `TF400813` / `HTTP 401`. The
   bundled `scripts/ado-auth.sh` solves this with **no PAT and no browser**: it auto-detects
   the org's backing Entra tenant (the unauthenticated `X-VSS-ResourceTenant` challenge
   header), pins a logged-in subscription in that tenant, and mints a short-lived AAD access
   token via `az account get-access-token`. Exporting that token as `AZURE_DEVOPS_EXT_PAT`
   makes `az devops` / `az boards` authenticate by token header — with **no `az login`, no
   change to the active subscription, and no mutation of `~/.azure`** (nothing is switched, so
   nothing needs switching back). The `agentStop` launcher already sources
   `scripts/ado-auth.sh`, so the headless child inherits the token.
   - The only prerequisite is being `az login`'d to the org's tenant at least once (you
     normally are). Pinning a *subscription* in that tenant — rather than `--tenant` — is what
     keeps it working even when a personal/MSA subscription is the active default (`--tenant`
     would use the active identity and fail `AADSTS50020`).
   - When `AZURE_DEVOPS_EXT_PAT` is present, **do not run `az login` / `az devops login`** —
     just call `az boards` / `az devops`; they authenticate by token regardless of the active
     `az account`.
   - **Optional PAT fallback** (resolved *before* the AAD token when set): for orgs that allow
     PATs, or environments without `az`, store one with `ado-auth set` (needs **Work Items
     (Read & Write)** scope for `ado.org`). Full resolution order: existing
     `AZURE_DEVOPS_EXT_PAT` → `ado.patFile` → `ado.patEnv` → `~/.copilot/assistant/.ado-pat` →
     freshly minted AAD token. Note: some orgs **disable PAT creation** by policy
     (`disablePatCreationPolicyViolation`) — the AAD path needs no PAT and sidesteps that.
   - `az boards work-item show` and `az boards work-item update` are work-item scoped and do
     **not** accept `--project`; pass `--org` and `--id`, and read project context from config
     only for WIQL/query calls that require it.
   - If neither a token nor a PAT resolves (e.g. not logged into the org's tenant), record the
     failure honestly (Step 8: `error`, `write-blocked` or `az-failed`); do **not** attempt
     interactive auth. Diagnose with `ado-auth status` (shows org, detected tenant, auth mode,
     active az login, and a live probe).

### Step 2 — Determine whether real work happened

Cheap gate before doing anything expensive. Treat the session as worth syncing only if at
least one is true:

- Uncommitted changes in `cwd`: `git -C "<cwd>" status --porcelain` is non-empty.
- New commits this session: compare `git -C "<cwd>" log` against the session's start (recent
  commits authored during the session window).
- The transcript shows substantive `edit`/`create`/`bash` actions that changed state.

If none apply, exit quietly — a pure Q&A/read-only session should not touch the board.

### Step 3 — Summarize what changed

From `transcriptPath` (and git), produce a **2–5 sentence** factual progress note:

- What was done (files/areas touched, commands run, decisions made).
- Current state (in progress / blocked / completed-this-session).
- Keep it terse and specific; no fluff, no full transcript dumps, no secrets.

### Step 4 — Infer the related work item (priority order; skip if none)

Evaluate signals **in this order** and take the first confident match:

1. **Explicit id in the session** — a work-item reference in the transcript or user prompts:
   `#152`, `AB#152`, `work item 152`, an ADO `_workitems/edit/152` URL. Highest priority.
2. **Git branch / commit trailers** — branch names like `feature/152-...`, `152-...`, or
   commit messages/trailers referencing `AB#152` / `#152` in `cwd`.
3. **Existing session link (re-sync)** — a work item already tagged `session:<sessionId>`:
   ```bash
   az boards query --org "<org>" --project "<project>" \
     --wiql "SELECT [System.Id] FROM workitems WHERE [System.Tags] CONTAINS 'session:<sessionId>'" \
     -o tsv 2>/dev/null
   ```
   If found, that is the item to update (idempotent re-sync of the same session).
4. **Current active item** — only if exactly **one** item assigned to `ado.assignedTo` is in
   the Active column (`System.BoardColumn = 'Active'`). More than one Active item → ambiguous.
5. **Otherwise → skip.** Do not update anything. Optionally note (to stderr/log) that no
   confident match was found. Never default to "most recent" or update multiple items.

Validate the chosen id exists and is not `State = 'Closed'`:
```bash
az boards work-item show --id <ID> --org "<org>" \
  --query "{state:fields.\"System.State\", title:fields.\"System.Title\", tags:fields.\"System.Tags\"}" -o json
```
Skip Closed/archived items unless the user explicitly asked to reopen-and-sync.

### Step 5 — Idempotency check (read your last sync before posting)

Repeated yields for the same session are common — do **not** let them produce near-duplicate
comments. Before composing a comment for an item already tagged `session:<sessionId>`:

1. **Read the most recent `session:<sessionId>` note** already on the item (your previous sync
   comment in the discussion thread).
2. **Post only if there is materially new work** since that note — new files/areas touched, a
   state change, a decision made, or a step completed. Rephrasing or re-summarizing the *same*
   work is **not** new.
3. When you do post, write the **delta only** (what changed since the last sync, 1–3 sentences) —
   never restate prior progress.
4. If nothing is materially new, **skip**: log `--action skipped --reason duplicate` (Step 8), and
   only re-add the tag if it is somehow missing.

Rule of thumb: if your draft would largely repeat your previous `session:<sessionId>` comment
(same feature, same files, same status), it is a duplicate — skip it.

### Step 6 — Update the work item

Single `az boards work-item update` call does both the comment and the tag. `--discussion`
adds a discussion comment (there is no separate comment command); `System.Tags` writes are
**additive** (they merge, never replace), so stamping is safe:

```bash
az boards work-item update --id <ID> --org "<org>" \
  --discussion "Session <sessionId> progress: <2-5 sentence note>. (auto-synced from Copilot session)" \
  --fields "System.Tags=session:<sessionId>"
```

> `<sessionId>` here **must** be the exact full `parentSession` UUID (see Inputs) — never a
> truncated id or a tool-call id. The same value goes in the `--discussion` text and the Step 8
> logger `--parent`. A wrong id both pollutes the board and defeats Step 5 (the next sync won't
> find this tag and will re-post).

State handling (conservative):

- If the item is `New` and work clearly started, you may nudge it to `Active`
  (`--state "Active"`). Respect allowed transitions (New → Active → Resolved → Closed).
- **Do not** auto-Resolve/Close on a normal sync. Only move to Resolved/Closed when the
  session unambiguously completed the work *and* the user asked to close it.
- Use `blocked` semantics per config (`blockedSemantics`: add tag `blocked`, leave state Active)
  if the session shows the work is blocked.

### Step 7 — Report

Emit one concise line for the log/transcript: the work-item id, the action taken
(commented + tagged, or skipped + why). When run interactively, tell the user which item was
updated and link it: `<org>/<project>/_workitems/edit/<ID>`.

### Step 8 — Record the outcome (always)

Append exactly **one** terminal event to the shared observability trail so monitoring is
complete. Use the bundled logger at **`scripts/log-run.sh`** inside this skill's directory
(resolve the absolute path from this skill's base directory; do not hardcode a user path). It
writes one JSON line to `~/.copilot/logs/ado-session-sync/runs.jsonl`.

> **Use the closed vocabulary below — verbatim.** The monitor (`sync-status.sh`) groups and
> classifies events by these exact `--event` / `--action` / `--reason` strings. Inventing new
> values (`commented`, `updated`, `synced`, free-form reasons, …) fragments the counts and hides
> failures. Pick the one bullet that matches and copy its values exactly.
>
> | Field | Allowed values (closed set) |
> |-------|------------------------------|
> | `--event` | `result` · `error` |
> | `--action` (result only) | `commented+tagged` · `tagged-only` · `state-nudged` · `skipped` |
> | `--reason` (skipped result) | `no-work` · `ambiguous` · `closed-item` · `duplicate` |
> | `--stage` (error) | `precondition` · `infer` · `update` |
> | `--reason` (error) | `write-blocked` · `az-failed` · `bad-input` |

- **On a successful update** (you actually wrote to ADO):
  ```bash
  <skill-dir>/scripts/log-run.sh --event result \
    --parent "<parentSession>" --child "<syncSession>" \
    --item <ID> --action "commented+tagged" \
    --note "<the same 2-5 sentence progress note>"
  ```
  Use `--action "tagged-only"` if you only added the tag, or `"state-nudged"` if you also moved
  the state. Do **not** use any other action string.

- **On a deliberate skip** — you *chose* not to write because there was nothing to write.
  Map the situation to exactly one canonical token — `no-work` (nothing substantive happened;
  **not** `no-real-work`/`no-new-work`), `ambiguous` (no confident single work item),
  `closed-item`, or `duplicate` — never a descriptive variant. This is a healthy outcome:
  ```bash
  <skill-dir>/scripts/log-run.sh --event result \
    --parent "<parentSession>" --action skipped --reason "<no-work|ambiguous|closed-item|duplicate>"
  ```

- **On a blocked or failed write** — you *tried* to update ADO and could not (the harness denied
  the `az` write — "Permission denied and could not request permission from user" — or `az`
  errored). This is a **failure, not a skip**: record it as an `error` so the monitor flags it.
  ```bash
  <skill-dir>/scripts/log-run.sh --event error \
    --parent "<parentSession>" --stage update --reason write-blocked \
    --detail "<terse: which write was denied/failed, and the item id>"
  ```
  Never log a denied write as `--action skipped` — that buries a real breakage among benign skips.

- **On any other unrecoverable error** (e.g. a precondition or inference step failed):
  ```bash
  <skill-dir>/scripts/log-run.sh --event error \
    --parent "<parentSession>" --stage "<precondition|infer>" --detail "<what failed>"
  ```

Keep `--note` / `--detail` **terse: 2–5 sentences, ≤ ~400 characters**, no secrets, no transcript
dumps — they are written to a local log and rendered inline by the monitor. The logger is
fail-open and honors `adoSessionSync.logLevel`; just call it and continue.

> **If the skill or its logger is not loadable in your runtime** (e.g. you confirmed
> `ado-session-sync` is not registered, so `scripts/log-run.sh` is unavailable), still record
> exactly one terminal event: append a single JSON line with the **same field names and the
> closed vocabulary above** directly to `~/.copilot/logs/ado-session-sync/runs.jsonl`
> (`{"ts":"<UTC ISO8601 Z>","event":"result|error","parent":"<sessionId>",…}`). Keep the same
> brevity and value constraints — the manual fallback must look exactly like a logger line. Use
> `ts`, `parent`, and `child` field names; do not copy prompt names like `timestamp`,
> `parentSession`, or `syncSession` into the audit trail.

## Idempotency & Safety Summary

- **Recursion:** guarded by the launcher hook — it skips when `ADO_SYNC_ACTIVE` is already
  set, so a sync child never spawns another sync. The child itself runs with it set and proceeds.
- **Opt-in:** disabled unless `adoSessionSync.enabled` / `ADO_SESSION_SYNC=1` (Step 1).
  `ADO_SESSION_SYNC=0` force-disables regardless of config and always wins.
- **No over-update:** ambiguous inference → skip (Step 4); never touch unrelated items.
- **Repo allowlist (efficiency):** when `adoSessionSync.syncRepos` is set, the launcher
  hook only spawns a sync child for sessions whose `cwd` is under a listed path prefix —
  or that carry an explicit work-item signal (`AB#`/`work item N`/`_workitems` URL, or a
  numeric branch / `AB#` commit trailer). Other sessions skip cheaply at the gate
  (`skip` / `repo-not-eligible`) without burning a ~4-minute headless run. Unset/empty
  `syncRepos` keeps every session eligible. The fast-path can only add spawns, never
  suppress a real sync, so the gate can never drop tracked work.
- **No duplicates:** session-tag + content check before commenting (Step 5).
- **Non-destructive:** never auto-Close; tag writes are additive (Step 6).
- **Fully audited:** every path logs exactly one `result` or `error` (Step 8) — successes,
  deliberate skips (`result`/`skipped`), and *blocked or failed writes* (`error`, e.g.
  `write-blocked`). A denied write is an error, never a skip.
- **Headless permissions:** the launcher uses `--allow-all` for the opt-in sync child. Narrower
  flag combinations (`--allow-all-tools` + `--allow-all-urls`) can still deny mutating
  `az boards work-item update` commands in `--no-ask-user` mode before the shell runs.
- **Quiet & fail-open:** any precondition miss exits without error so the user is never blocked.

## Notes

- Tag scheme is `session:<sessionId>`. To later find the session(s) behind a work item, read
  its `System.Tags`; to find the item for a session, query `Tags CONTAINS 'session:<id>'`.
- Removing/replacing a tag set needs the REST `op:replace` path (see the `az` skill's
  `devops-boards.md`); normal syncs only **add** the session tag, so the simple `--fields`
  form is correct here.
- Org/project/assignee come from `~/.copilot/assistant/config.json`; do not hardcode them.
- **ADO auth is a short-lived AAD token, decoupled from the active `az` subscription** (see
  Step 3). `scripts/ado-auth.sh` auto-detects the org's Entra tenant, pins a logged-in
  subscription in it, and mints an AAD token via `az account get-access-token`, exported as
  `AZURE_DEVOPS_EXT_PAT` by the launcher — so the sync never `az login`s, switches the active
  subscription, or touches `~/.azure`. A stored PAT
  (`AZURE_DEVOPS_EXT_PAT` → `ado.patFile` → `ado.patEnv` → `~/.copilot/assistant/.ado-pat`) is
  an optional override resolved *first*. Inspect with `ado-auth status`; provision a PAT only
  if needed with `ado-auth set`. No secret is ever committed to a repo.
- `adoSessionSync.syncRepos` (optional, in the same config) is an allowlist of `cwd`
  path prefixes whose sessions may spawn a sync child; it pre-filters doomed runs in
  repos that never map to a work item. See the Idempotency & Safety Summary for the
  fast-path that exempts sessions carrying an explicit work-item reference. Review
  per-repo activity and allowlist suggestions with `scripts/sync-status.sh --repos`.
- **Headless child session naming, storage & deregistration.** The launcher tags each
  headless sync child with `--name "ado-sync:<parentSession>"`, so it is easy to spot in the
  session list and resumable by name (`copilot --resume="ado-sync:<parentSession>"`). After the
  child exits, its transient on-disk **session-state directory** is moved out of the
  normal store to `adoSessionSync.sessionStateDir` — default `~/.copilot/ado-sync-sessions`;
  set it to a custom path to relocate elsewhere, or to `""` (empty string) to disable the
  move and leave state in `~/.copilot/session-state/`. When the move is enabled the child's
  now-dangling `session-store.db` entry is also **deregistered** (via
  `scripts/purge-session.sh` / `.ps1`) — its `sessions` row and dependents (`turns`,
  `checkpoints`, `session_files`, `session_refs`, `search_index`) are deleted in one
  transaction so the moved-away child does not break `--continue`/`--resume` or pollute
  session search. Unrelated VS Code (`cst_*`) and forge (`forge_*`) stores are never touched.
  Deregistration is coupled to relocation: with `sessionStateDir: ""` the store row is left
  intact (no move, no purge). The run log / audit trail always stay in
  `~/.copilot/logs/ado-session-sync/`, so the full transcript survives purge for debugging.
  `COPILOT_HOME` is honored when resolving the source. To clean up a backlog of pre-existing
  sync children, run `scripts/purge-session.sh --sweep` (dry-run preview) then `--sweep --yes`.

## Monitoring

All sync activity is recorded in `~/.copilot/logs/ado-session-sync/` — `runs.jsonl` (structured
events: `launch`, `skip`, `child-exit`, `result`, `error`), `runs.log` (human mirror), and
`<parentSession>.log` (the full headless run).

On an installed plugin the `link-commands` `sessionStart` hook exposes the viewers on **PATH**
(symlinked into `~/.local/bin`), so you can run them by bare name from any directory:

```bash
sync-status            # recent runs + counts
sync-status --follow   # basic status, then live-stream new events (Ctrl-C)
sync-status --errors   # only genuine failures (errors, blocked writes, nonzero exits)
sync-status --reconcile # cross-check the log against ADO session: tags
sync-status --repos    # per-repo launches/outcomes + syncRepos allowlist suggestions
sync-status --pretty   # force the framed, colorized human view
ado-auth status        # show ADO auth: org, detected tenant, token source + a live probe
ado-auth tenant        # print (and cache) the org's auto-detected Entra tenant id
```

If `~/.local/bin` is not on your PATH (or the plugin is run uninstalled), invoke the same
scripts directly from this skill's directory, e.g. `<skill-dir>/scripts/sync-status.sh --errors`.

`--follow` (alias `-f`) prints the basic status first (counts + recent runs) and then
keeps running, rendering each new event the moment the hook appends it — handy for
watching a sync fire in real time. It honors the same `--session` / `--since` / `--errors`
filters as the static view, follows the log across retention prunes, and stops on Ctrl-C.

By default the viewer **auto-detects the terminal**: a framed, colorized human view when
interactive, and the plain text format when piped or redirected (so agents and `| jq` keep
working). Force either with `--pretty` / `--plain`; color also honors `NO_COLOR`. The
`--json` output and the `runs.jsonl` / `runs.log` files are always plain/machine output.

For a richer, browsable view, generate the **HTML dashboard** — on PATH as `sync-ui` (Node, no
server — builds a self-contained file from `runs.jsonl` and opens it in the browser):

```bash
sync-ui            # generate + open the dashboard
sync-ui --no-open  # generate only, print the file path
sync-ui --out <path>  # write to a specific path
```

The dashboard shows summary counts (launches / updated / skipped / errors),
client-side filtering (by session, event type, date, full-text, errors-only), and
expandable rows that reveal the untruncated progress note, a clickable link to the
ADO work item, and a link to that session's full run log (`<parentSession>.log`).
Read-only and fail-soft (empty trail → empty dashboard). Honors
`COPILOT_PLUGIN_ADO_SYNC_LOGDIR`; ADO org/project come from `~/.copilot/assistant/config.json`.
