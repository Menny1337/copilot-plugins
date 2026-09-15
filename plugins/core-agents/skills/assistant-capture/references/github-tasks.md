# Capture GitHub tasks

Use only after selecting GitHub in the root procedure and reading
[GitHub configuration and authentication (§3.6.0)](github-configuration.md).
Paths beginning `skills/` in commands are relative to the plugin root, not this
reference directory.

## Contents

- [Backend contract](#36-github-backend-when-taskbackend--github)
- [Field mapping](#361-field-mapping-locked-taxonomy)
- [Create tasks and subtasks](#362-add-a-task)
- [Verified lifecycle transitions](#364-complete--archive--reopen--move--update-a-task)
- [Board lanes and flow](#365-board-flow--lane-management)
- [Needs Me and archive decisions](#367-when-the-agent-should-auto-move-cards-to-needs-me)
- [Fallback capture](#369-capture-time-fallback-inboxmd)
- [Fuzzy matching](#3610-find-a-task-by-fuzzy-title)
- [Hierarchy](#3611-three-tier-hierarchy-epic--feature--story--task)

## 3.6 GitHub Backend (when `taskBackend = "github"`)

When the [selected assistant config](configuration.md) contains `taskBackend: "github"`, **[§3 Task Management](markdown-tasks.md) is overridden by this section** (mirroring [§3.5 for ADO](ado-tasks.md) — see [the shared contract](task-backend-contract.md)). All task operations go to a GitHub Issues + Projects v2 board via the `gh` CLI instead of `tasks.md`. [Reminders (§4)](reminders.md) and [Notes (§2)](notes.md) stay local. [Action Item Extraction (§5)](action-items.md) keeps its parsing and consent steps, then writes accepted tasks through this backend. [GitHub queries (§8b)](../../assistant-query/references/github-tasks.md) read the same board through `github-query`.

### 3.6.1 Field mapping (locked taxonomy)

| `tasks.md` token | GitHub field | Notes |
|---|---|---|
| `**(P1)**` / `**(P2)**` / `**(P3)**` | Projects v2 `Priority` single-select = `P1`/`P2`/`P3` | Default `P3` if absent |
| `@work` / `@personal` / `@health` | Issue label `mode:work` / `mode:personal` + `Mode` field | Strip the `@` prefix |
| `+ProjectName` | `Workstream` field (nearest matching Feature-equivalent) or a `workstream:<name>` label if no Workstream field match | Strip the `+` prefix |
| `due YYYY-MM-DD` | Projects v2 `Due date` date field | ISO 8601 |
| `← notes/.../file.md` | Append to the issue body as a markdown link under an `## Imported context` heading | Preserve provenance |
| `[#nnn]` (team WI ref) | Issue body link + label `cross-ref:wi-nnn` | Migrate as a personal follow-up that references the team WI; do NOT skip |
| `[!nnn]` (PR ref) | Issue body link + label `cross-ref:pr-nnn` | Same |
| Subtask (indented `  - [ ]`) | GitHub sub-issue (`addSubIssue` mutation) | Two-pass: parent first, then child linked as a sub-issue |
| **Always set** | `Kind` field from the item's tier (Epic/Feature/User Story/Task — §3.6.11) | Drives hierarchy rendering in `github-query` |

**Do not create per-status labels** (`status:*`). Workflow state has exactly two canonical sources — Projects v2 `Lane` (Backlog/Up Next/Active/Needs Me/Blocked/Done/Archive) and the issue's own `open`/`closed` state — never a label. Normalized `kind:*`, `mode:*`, and `priority:*` labels are informational/searchable only; they are never read back as the source of truth for lane or terminality.

### 3.6.2 Add a Task

**Dedupe before creating — unconditionally, against the remote, every time.** GitHub has no native "does this already exist" dedupe, and a local cache can go stale (another session, a partial retry, a delta reconciliation pass). Before creating, search the live board for an existing open match:

```bash
gh issue list --repo "<config.github.owner>/<config.github.repo>" --state open \
  --search "<keyword> in:title" --json number,title,url
```

If a clear match already exists, update or comment on it instead of creating a new one; if a batch item is ambiguous, surface it to **Needs Me** (§3.6.7) rather than guessing. Only create after confirming no live duplicate exists.

```bash
# 1. Create the issue. `gh issue create` prints ONLY the created issue's URL
#    (plain text) on success — it has no --query/-o json output mode (those
#    flags belong to gh issue list/view, not create). Use exactly one
#    invocation with the complete, marker-bearing body; do NOT fall back to a
#    second, truncated invocation on failure — a fallback body that drops the
#    idempotency marker (e.g. '<!-- clientCaptureId:<id> -->') defeats the
#    whole point of marking the create for dedupe. If this command must be
#    retried after a transient failure, re-run the §3.6.2 dedupe search FIRST
#    — a create can succeed server-side even if the client never saw the
#    response — and only retry the raw create if that search still finds no
#    match.
ISSUE_URL=$(gh issue create --repo "<config.github.owner>/<config.github.repo>" \
  --title "<title>" \
  --body "<body: include source ref + cross-refs + an idempotency marker if this create is part of a batch/import, e.g. '<!-- clientCaptureId:<id> -->'>" \
  --label "kind:story,priority:P<1|2|3>")

# 2. Add it to the Project (returns the project ITEM id, not the issue id).
ITEM_ID=$(gh project item-add "<config.github.projectNumber>" --owner "<config.github.owner>" \
  --url "$ISSUE_URL" --format json --jq '.id')
ISSUE_NUMBER="${ISSUE_URL##*/}"

# 3. Set Lane=Backlog together with its derived built-in Status=Todo through
#    the verified transition helper. Then set independent fields such as
#    Priority and Kind with direct item-edit calls.
node skills/assistant-capture/scripts/github-state-transition.mjs move --id "$ISSUE_NUMBER" --lane Backlog
gh project item-edit --id "$ITEM_ID" --project-id "<config.github.projectId>" \
  --field-id "<Priority field id>" --single-select-option-id "<P1 option id>"
gh project item-edit --id "$ITEM_ID" --project-id "<config.github.projectId>" \
  --field-id "<Kind field id>" --single-select-option-id "<Story option id>"
```

If the workstream Feature is clear (§3.6.11), set the `Workstream` field immediately:

```bash
gh project item-edit --id "$ITEM_ID" --project-id "<config.github.projectId>" \
  --field-id "<Workstream field id>" --text "<workstream title>"
```

If the workstream is unclear, leave it empty and surface to **Needs Me** rather than guessing.

Confirm with: "Added P{n} issue #{number}: {title} — board: {boardUrl}"

### 3.6.3 Add a Subtask

```bash
# Pass 1: create the Task issue (same two steps as §3.6.2 — create, then item-add).
# Pass 2: link as a GitHub sub-issue of the parent Story/Feature issue.
PARENT_NODE_ID=$(gh issue view <parent-number> --repo "<owner>/<repo>" --json id --jq .id)
CHILD_NODE_ID=$(gh issue view <task-number> --repo "<owner>/<repo>" --json id --jq .id)
gh api graphql -f query='
  mutation($issueId: ID!, $subIssueId: ID!) {
    addSubIssue(input: {issueId: $issueId, subIssueId: $subIssueId}) { issue { number } }
  }' -F issueId="$PARENT_NODE_ID" -F subIssueId="$CHILD_NODE_ID"
```

### 3.6.4 Complete / Archive / Reopen / Move / Update a Task

Unlike ADO, GitHub issues have exactly two terminal states (`open`/`closed`); "Done" vs
"Archive" is distinguished by the `Lane` field, not the issue state.

**Ordering is safety-critical, not cosmetic — and so is what happens when the
SECOND step fails.** Set `Lane` *before* closing (for complete/archive), and
reopen *before* setting `Lane` (for reopen), so a second-step failure always
leaves the item **open** with a stale/target lane — still visible to
`all-open` and every open-issue query — rather than **closed** with a
non-terminal lane, which drops out of every lane-based view and is
effectively lost. Ordering alone still isn't enough to *report* correctly: a
Lane-succeeds/close-fails transition must never be reported as success, and
must never be "fixed" by a blind, unverified rollback either (an undo write
can itself silently fail or race with another actor). **Never run the raw
`gh project item-edit`/`gh issue close`/`gh issue reopen` commands by hand
for lifecycle transitions or Lane moves** — always invoke the bundled
`github-state-transition` command (linked onto PATH by this plugin's
sessionStart hook; run `node
skills/assistant-capture/scripts/github-state-transition.mjs` directly if it
is not yet on PATH), which uses **idempotent convergence, not transactional
compensation**:

1. reads the issue's live `state` + `Lane` + built-in `Status` from the
   project BEFORE writing anything (this becomes `current` — the snapshot
   used both to skip already-satisfied steps and to report what actually
   changed);
2. validates the issue number, project membership, allowed destination Lane,
   Lane option, derived Status mapping, and Status option before any write;
3. plans only the steps still needed: any step whose target already matches
   `current` (e.g. Lane is already `Done`) is skipped, so re-running the
   same command is always safe and cheap;
4. applies the remaining steps in the canonical order above via
   `planTransition`/`executeTransition`, and **never rolls back** a step that
   already landed — a partially-applied transition is left exactly as it
   landed, not undone;
5. re-verifies the live remote state matches the expected result before ever
   reporting success (`ok: true` requires a final live re-fetch confirming
   it, not just "every write call returned without throwing");
6. on a write error, does exactly one recovery re-fetch: if the target was
   actually reached anyway (the error was cosmetic, e.g. a client-side
   timeout), this is still reported as success (`recoveredFromWriteError`
   notes why); if the re-fetch itself fails, the result is `indeterminate`
   (unknown live state — never guessed at); otherwise it is a confirmed
   `partial` failure naming exactly what still differs from the target.
   **Both `indeterminate` and `partial` results end the same way: exit
   non-zero and tell the caller to re-run the same command** — a re-run
   reads a fresh `current` snapshot and converges by applying only whatever
   is still missing, which is what actually fixes the Lane-succeeds/close-
   fails case (the close step alone gets retried; Lane is correctly
   recognized as already done and skipped).

```bash
# Complete (Lane=Done, then close reason:completed) — verified, converges on re-run
node skills/assistant-capture/scripts/github-state-transition.mjs complete --id <number>

# Archive/cancel (Lane=Archive, then close reason:"not planned")
node skills/assistant-capture/scripts/github-state-transition.mjs archive --id <number>

# Reopen — defaults Lane to Backlog; pass --lane to land in a specific active lane
node skills/assistant-capture/scripts/github-state-transition.mjs reopen --id <number> [--lane "Up Next"|Active|"Needs Me"|Blocked]

# Ordinary open-card move — updates Lane + derived Status and never changes issue state.
# Allowed lanes: Backlog, Up Next, Active, Needs Me, Blocked.
node skills/assistant-capture/scripts/github-state-transition.mjs move --id <number> --lane "<lane>"

# See the resolved plan (current snapshot + only the steps still needed) without writing anything
node skills/assistant-capture/scripts/github-state-transition.mjs complete --id <number> --dry-run

# Update non-Lane fields (priority, due date, workstream, mode) — single-field writes have
# no ordering/convergence concern, so these remain direct gh calls
gh project item-edit --id "<item-id>" --project-id "<projectId>" \
  --field-id "<Priority field id>" --single-select-option-id "<P1 option id>"
gh project item-edit --id "<item-id>" --project-id "<projectId>" \
  --field-id "<Due date field id>" --date "YYYY-MM-DD"
```

Title changes: `gh issue edit <number> --repo "<owner>/<repo>" --title "<new>"`.

The command prints exactly one JSON line to stdout (`{ok, action, appliedSteps,
current, expected, converged, indeterminate, priorStatus, alreadyConverged,
...}`) and exits `0` only when `ok: true`; any other exit (`5`: confirmed
partial — re-run to converge, `6`: indeterminate — the final verification
read itself failed, re-run to confirm/converge) must be treated as "the task
did not complete/archive/reopen/move" regardless of what partially applied. Never
report success from local step-application alone, and never treat an
`indeterminate` result as either success or failure — re-run instead of
guessing.

### 3.6.5 Board flow & lane management

Same 7-lane model as the [ADO board (§3.5.5)](ado-tasks.md#355-board-flow--lane-management), read/written through the `Lane` Projects v2
field instead of `System.BoardColumn`:

| Lane | Issue state | Meaning |
|---|---|---|
| **Backlog** | open | Fresh capture, untriaged (mirrors ADO board column "New"). |
| **Up Next** | open | Triaged and prioritized short-list. WIP target 5. |
| **Active** | open | Currently being driven. WIP target 3. |
| **Needs Me** | open | Surfaced for your decision/judgment — not blocked, your turn. WIP target 5. |
| **Blocked** | open | Waiting on an external party/event. WIP target 3. |
| **Done** | **closed** (`reason: completed`) | Completed. Stays visible in `done-24h`/`done-recent` — recent wins lane. |
| **Archive** | **closed** (`reason: not planned` for cancellations, `completed` for stale-but-done items) | Filed away. Opt-in-to-view only — never in briefings/`all-open`. |

### 3.6.6 Standard agent flow operations

| User says / agent decides | Operation | Effect |
|---|---|---|
| "Add a task: …" | `gh issue create` + `item-add` + `github-state-transition.mjs move --id N --lane Backlog` | Card lands in **Backlog** with Status **Todo** |
| "Queue #N for soon" | `github-state-transition.mjs move --id N --lane "Up Next"` | Card moves to **Up Next** with Status **Todo** |
| "I'm starting on #N" | `github-state-transition.mjs move --id N --lane Active` | Card moves to **Active** with Status **In Progress** |
| "Pause on #N — I need your input" | `github-state-transition.mjs move --id N --lane "Needs Me"` | Card moves to **Needs Me** with Status **In Progress** |
| "I've decided on #N, continue" | `github-state-transition.mjs move --id N --lane Active` | Card moves back to **Active** with Status **In Progress** |
| "I'm blocked on #N waiting for X" | `github-state-transition.mjs move --id N --lane Blocked` | Card moves to **Blocked** with Status **In Progress** |
| "X came through, picking #N back up" | `github-state-transition.mjs move --id N --lane Active` | Card moves back to **Active** with Status **In Progress** |
| "Done with #N" | `github-state-transition.mjs complete --id N` (§3.6.4 — never raw `gh issue close` + `item-edit`) | Card moves to **Done** |
| "Archive #N" / "Won't do" | `github-state-transition.mjs archive --id N` (§3.6.4) + comment explaining | Card moves to **Archive** |
| "Reopen #N" | `github-state-transition.mjs reopen --id N [--lane <lane>]` (§3.6.4; defaults Lane to Backlog) | Card returns to a clean open lane |

Add a comment for any non-obvious transition: `gh issue comment <number> --repo "<owner>/<repo>" --body "<why>"`.

### 3.6.7 When the agent should auto-move cards to Needs Me

Same triggers as [ADO §3.5.7](ado-tasks.md#357-when-the-agent-should-auto-move-cards-to-needs-me) (two valid approaches with no clear winner, a HIGH-severity
pre-implementation finding, ambiguous external data, an unapproved destructive op, a
spec-contradicting test failure, 3+ stalled retries). Comment before moving:

```bash
gh issue comment <number> --repo "<owner>/<repo>" \
  --body "🤖 Surfacing for your review: <one-sentence reason>. Context: <link or summary>."
```

### 3.6.8 When the agent should auto-archive

Same triggers as [ADO §3.5.8](ado-tasks.md#358-when-the-agent-should-auto-archive) (explicit cancel, 30+ days in Done with no recent activity,
60+ days in Blocked, confirmed duplicate — link the original, then archive the
duplicate). For ambiguous "stale" cases, surface to **Needs Me** first.

### 3.6.9 Capture-time fallback (`inbox.md`)

If any `gh` call fails (network, auth, rate limit, scope error), do NOT lose the user's
input. Append an idempotent entry to `<config.fallbackInbox>` using the **neutral**
`status` key (not `ado_status` — see [task-backend contract: Configuration
versioning](task-backend-contract.md#configuration-versioning); a reader must still accept legacy `ado_status` entries on the same file):

```
## 2026-05-14T08:00:00Z (clientCaptureId: 1f4a3c8b)
- title: "..."
- priority: 2
- tags: ["work", "ExampleProject"]
- dueDate: "2026-05-21"
- description: "..."
- source: "← notes/meetings/2026-05-14-foo.md"
- status: pending
```

Tell the user the actual saved inbox path and that GitHub remains unavailable.
Only claim the local save after it succeeds.

Session-start retries belong to [assistant-query's GitHub inbox
reconciliation](../../assistant-query/references/github-inbox-sync.md), independently
of briefing generation. That procedure accepts both pending status keys, searches
by `clientCaptureId` before creating, and marks an entry synced only after
confirming the remote item. Do not duplicate its scan here or bypass its preflight.

### 3.6.10 Find a task by fuzzy title

Before any complete/update/reopen op, find the matching issue:

```bash
gh issue list --repo "<config.github.owner>/<config.github.repo>" --state open \
  --search "<keyword> in:title" --json number,title,state,url
```

If multiple match, ask the user to disambiguate by number. If none, suggest the closest match (Levenshtein on titles).

### 3.6.11 Three-tier hierarchy (Epic ▸ Feature ▸ Story ▸ Task)

Same tiers and cadence as [ADO §3.5.11](ado-tasks.md#3511-three-tier-hierarchy-epic--feature--story--task), expressed as GitHub sub-issues instead of ADO
`System.Parent`, with the tier stored in the `Kind` field:

| Level | `Kind` value | Board behavior |
|---|---|---|
| **Epic** | `Epic` | Portfolio parent, not day-to-day flow |
| **Feature** | `Feature` | Parent shown via sub-issue rollup; **Active Features WIP=2 strict** |
| **User Story** | `Story` | Day-to-day kanban card; if it lingers >5 days in Active, split it |
| **Task** | `Task` | Optional checklist inside a Story; never its own board card |

To discover candidate workstreams (open Feature-kind issues):

```bash
gh issue list --repo "<config.github.owner>/<config.github.repo>" --state open \
  --search "label:kind:feature" --json number,title,url
```

Match by prefix/keyword, reusing the configured board's existing program prefixes
or ones explicitly supplied by the user, as in ADO. Do not invent or rename
prefixes without approval. When creating a
new Story, link it as a sub-issue of the right Feature (§3.6.3). If there is no
confident match, leave it unparented and surface to **Needs Me** rather than guessing.

Cadence: use the user's established working week, or the ISO week if none is known. Review Epics monthly; review Features on the first working day to feed **Up Next**; review Stories daily; close out on the final working day.

---
