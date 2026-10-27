# TaskBackend contract

The [selected assistant config](configuration.md) (default
`~/.copilot/assistant/config.json`) selects **one personal-board task backend** via
`taskBackend`. `assistant-capture` (writes) and `assistant-query` (queries, briefings and inbox reconciliation) both branch on
this single value for every operation that touches the personal board — notes,
reminders, and action-item parsing are backend-independent. Accepted action items
write tasks through the selected backend.

This document is the single source of truth for what "a backend" must implement. It
exists so a new backend (or a change to an existing one) can be reviewed against one
checklist instead of being inferred from scattered examples across two skills.

## Contents

- [Supported values and defaults](#supported-values-and-defaults)
- [The contract](#the-contract)
- [Lane catalog](#lane-catalog-shared-names-backend-specific-source-field)
- [Configuration versioning](#configuration-versioning)

## Supported values and defaults

| `taskBackend` | Personal-board store | Query command | Capture section | Query section |
|---|---|---|---|---|
| `"markdown"` (default; also used when the key/file is absent) | `~/.copilot/assistant/tasks.md` | n/a (`assistant-store` gateway reads the file directly) | [§3](markdown-tasks.md) | [§2](../../assistant-query/references/markdown-tasks.md) |
| `"ado"` | Azure DevOps work items (`config.ado` block) | `ado-query` (WIQL builder + `az boards query`) | [§3.5](ado-tasks.md) | [§8a](../../assistant-query/references/ado-tasks.md) |
| `"github"` | GitHub Issues + a Projects v2 board (`config.github` block) | `github-query` (GraphQL builder + `gh api graphql`) | [§3.6](github-tasks.md) | [§8b](../../assistant-query/references/github-tasks.md) |

`taskBackend` is versioned implicitly by the config shape it requires — see
**Configuration versioning** below. An absent default config file or selector defaults to
`"markdown"`; an explicit `"markdown"` selects the local store.

Before invoking any personal-board task helper, the skill must reject an explicit unrecognized
selector: report the unsupported value and stop the task operation without reading
or writing any task backend. Report malformed config or a missing/invalid required
remote-backend block and stop that task operation too. Do not silently substitute
markdown. Briefings can still persist independent sections, with task data marked
unavailable. Notes and reminders remain local and do not need task configuration.

These are skill-level routing guards. Hooks also validate the selected personal
backend before launching. Direct query commands validate their requested board independently.
Do not rely on a helper's fallback or config parsing to authorize a different store.

`config.teamBoard` is a **separate, read-only, backend-independent** board (the
corporate/team sprint board). It is never selected by `taskBackend` and always reads
through `ado-query` regardless of which personal backend is active — see
[team queries (§8)](../../assistant-query/references/ado-queries.md) /
[team layout (§4b)](../../assistant-query/references/team-board-layout.md).
Validate that target independently; a personal-backend error does not disable a
valid team query or an explicitly requested non-personal ADO work-item operation.

## The contract

Every backend implementation (a query command plus the matching capture/query SKILL.md
section) MUST define, for its store:

1. **Create** — add a new item with at minimum: title, priority, tags/labels, due date,
   description/body, and source provenance (which note/PR/work-item triggered capture).
   Must be safe to call more than once for the "same" logical capture (see
   **Idempotency**).
2. **Update** — change any of the above fields on an existing item without disturbing
   fields not being changed (partial update, never a destructive full overwrite unless
   the field's write semantics require replace-only, e.g. GitHub Issue labels or ADO
   `System.Tags` op:replace).
3. **Complete** — move an item to its backend's terminal-but-visible "done" state
   (`Resolved` in ADO for Story/Bug, issue-closed + Lane=Done in GitHub, `[x]` +
   Completed section in Markdown). Completion is always visible in default views for a
   bounded recency window (`done-24h` / `done-recent`), never silently hidden.
4. **Archive** — move an item to its backend's terminal-and-hidden state (`Closed` in
   ADO for Story/Feature/Epic, issue-closed + Lane=Archive in GitHub). Archive is
   opt-in-to-view only; it must never leak into default listings or briefings.
5. **Parent/sub-item linking** — attach a child item to a parent (ADO
   `relation add --relation-type parent`; GitHub sub-issues /
   `addSubIssue` GraphQL mutation). Two-pass: create both items, then link — never invent
   a parent.
6. **Comment** — append a timestamped note to an item without altering its other fields
   (ADO `--discussion`; GitHub `gh issue comment` / `addComment` mutation).
7. **List/query** — enumerate items by a named **lane** (see the lane catalog below) with
   a stable `SELECT`/`WHERE`/`ORDER BY`-equivalent per lane, driven by config, never by
   hand-typed ad hoc queries for the standard lanes.
8. **Field normalization** — map the backend's native fields to this shared vocabulary
   so briefings render identically regardless of backend:

   | Shared concept | Markdown | ADO | GitHub |
   |---|---|---|---|
   | Priority | `**(P1\|P2\|P3)**` | `Microsoft.VSTS.Common.Priority` (1/2/3) | `Priority` Projects v2 single-select field (`P1`/`P2`/`P3`) |
   | Lane/column | n/a (Active/Completed sections only) | `System.BoardColumn` | `Lane` Projects v2 single-select field |
   | Terminality | `[x]` + Completed section | `System.State` | Issue `open`/`closed` state |
   | Due date | `due YYYY-MM-DD` | `Microsoft.VSTS.Scheduling.DueDate` | `Due date` Projects v2 date field |
   | Tags/context | `@context` / `+project` | `System.Tags` (`;`-joined) | Issue labels + `Workstream`/`Mode` fields |
   | Hierarchy kind | n/a | `System.WorkItemType` | `Kind` Projects v2 single-select field |
   | Idempotency key | task title (fuzzy match) | work-item id / `clientCaptureId` in Description | issue-body marker (e.g. `adoId:` or `clientCaptureId:`) |

9. **Deterministic ordering** — every lane's result order is a fixed, documented sort
   key (e.g. priority ascending, then due date ascending, then id ascending). The same
   lane run twice against unchanged data returns rows in the same order. Never rely on
   backend-default/insertion order.
10. **Idempotency** — creating "the same" item twice (retry after a network error, a
    bulk import re-run, a delta-reconciliation pass) must not create a duplicate.
    Backends achieve this differently (ADO: [fuzzy-title search, §3.5.2](ado-tasks.md#352-add-a-task); GitHub: an
    explicit idempotency marker in the issue body plus an unconditional remote existence
    check before create, never a local-cache-only check) but the guarantee is the same:
    **search before create.**
11. **Error behavior** — a failed write must never silently lose the user's input and
    must never be reported as success. See **Fallback capture** below.
12. **Fallback capture** — if the backend is unreachable (network, auth, throttling),
    append an idempotent entry to `<config.fallbackInbox>` (default
    `~/.copilot/assistant/inbox.md`) tagged with a `clientCaptureId` and a
    backend-neutral `status: pending` field (not `ado_status`/`github_status` — see
    **Configuration versioning**). At the next session start, `assistant-query` scans
    for `status: pending` entries and retries the create against whichever backend is
    currently configured, using the `clientCaptureId` as the idempotency key so a retry
    after a partial success never double-creates.

## Lane catalog (shared names, backend-specific source field)

These lane names are shared across `ado-query` and `github-query` so SKILL.md prose and
briefing logic do not need per-backend branching beyond "which command do I call":

| Lane | Meaning | ADO source | GitHub source |
|---|---|---|---|
| `all-open` | Every non-done/non-archive item | `BoardColumn` implicit via `NOT IN (Closed,Resolved,Removed)` | issue state = open |
| `active` | In-flight work (WIP-bounded) | `BoardColumn = 'Active'` | `Lane = Active`, issue open |
| `needs-me` | Attention queue (WIP-bounded) | `BoardColumn = 'Needs Me'` | `Lane = 'Needs Me'`, issue open |
| `up-next` | Queued short-list (WIP-bounded) | `BoardColumn = 'Up Next'` | `Lane = 'Up Next'`, issue open |
| `blocked` | Waiting on external party (WIP-bounded) | `BoardColumn = 'Blocked'` | `Lane = Blocked`, issue open |
| `backlog` | Untriaged incoming | `BoardColumn = 'New'` | `Lane = Backlog`, issue open |
| `done-24h` | Completed in the last 24h | `State = 'Resolved'` + 1-day window | `Lane = Done`, issue closed, 1-day window |
| `done-recent` | Completed recently (default 14d) | `State = 'Resolved'` + N-day window | `Lane = Done`, issue closed, N-day window |
| `stale` | Open but untouched 7+ days | any open lane, `ChangedDate` | any open lane, `updatedAt` |
| `due` | Items carrying a due date (overdue/today/week windows) | `DueDate` comparisons | `Due date` field comparisons |
| `priority` | Items at a given priority (`--priority`, default 1) | `Priority` field | `Priority` field |
| `archive` | Terminal-and-hidden (opt-in view only) | `State = 'Closed'` | `Lane = Archive`, issue closed |

Archive/closed items are **excluded by default** from every other lane in this table;
they only ever appear via the `archive` lane itself, on explicit request.

## Configuration versioning

`config.json` has no explicit `configVersion` field prior to the GitHub backend; its
shape is inferred from which top-level keys are present (`ado`, `teamBoard`,
`adoSessionSync`, …). Adding the `github` block introduces an implicit v2 shape:

- **v1 (implicit, unversioned):** `taskBackend` is `"markdown"` or `"ado"`. Recognized
  blocks: `ado`, `teamBoard`, `adoSessionSync`, `fallbackInbox`. All existing v1 configs
  continue to work with **zero changes** — nothing in this contract removes or renames a
  v1 key.
- **v2:** adds `taskBackend: "github"`, a `github` block (see [GitHub configuration (§3.6.0)](github-configuration.md)
  for its shape), and a new `taskSessionSync` block read by the `github-session-sync`
  launcher (debounce/allowlist/session-state/log-level knobs, same shape as
  `adoSessionSync`). The ADO launcher (`ado-session-sync.sh`/`.ps1`) is **untouched** and
  keeps reading `adoSessionSync` exactly as before — v1 configs need zero changes to stay
  on ADO. `taskSessionSync` is therefore additive, not a rename: it is the block a new
  `taskBackend: "github"` config declares; it has no effect on `taskBackend: "ado"`.
- A config is never required to declare `configVersion` explicitly; the reader infers
  it from which keys are present. A future breaking shape change SHOULD add an explicit
  `configVersion` integer and this document's table should be extended rather than the
  old rows silently repurposed.
- Fallback-inbox entries move from backend-specific status keys (`ado_status`) to a
  neutral `status` key under `taskBackend: "github"`; readers MUST accept both key names
  on the same file (a file can contain entries written under either backend across a
  cutover) and MUST NOT require a bulk rewrite of pre-existing entries.
