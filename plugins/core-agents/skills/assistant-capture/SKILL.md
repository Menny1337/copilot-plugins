---
name: assistant-capture
description: "Structured data entry for personal assistant: note creation (meetings, decisions, ideas, scratch), task management (add, update, complete, reopen), reminder management (set, dismiss), workspace initialization, and action item extraction from meeting notes. Triggers: take note, log, capture, add task, new task, set reminder, done with, complete task, jot down."
argument-hint: "<note, task, or reminder to capture>"
---

# Assistant Capture

Procedures for writing structured personal assistant data to the workspace at `~/.copilot/assistant/`.

## When to Use

- Creating any type of note (meeting, decision, idea, scratch)
- Adding, updating, completing, or reopening tasks
- Setting or dismissing reminders
- Initializing the workspace for first-time use
- Extracting action items from meeting notes into tasks

## When to Skip

- Searching or listing existing data → use **assistant-query** instead
- Generating summaries or reports → use **assistant-query** instead

## Execution Rules

- For any note, task, or reminder write request, perform the write during this turn via the `assistant-store` gateway (see below); do not only describe what should be written.
- The gateway is the **only supported write path** for `~/.copilot/assistant/` notes, `tasks.md`, `reminders.md`, and workspace init — never hand-edit those files with `Read`/`Edit`/shell-append, even for a "quick" change. It serializes concurrent writers, validates structure before mutating, and commits atomically, which ad-hoc edits cannot guarantee. (ADO-backed task operations in §3.5 already go through `az boards`, and GitHub-backed task operations in §3.6 already go through `gh`; both are unaffected by the gateway.)
- When the user already provided the needed content, do not ask follow-up questions before writing.
- Capture first, organize second — get the information down, then refine structure.

## Running these commands: the `assistant-store` gateway

Every write in §1, §2, §3, §4, and §5 (local-store operations only — not §3.5 ADO or
§3.6 GitHub)
goes through the bundled `assistant-store` helper, a zero-dependency Node script that
serializes writes with a lock, re-reads the target under that lock, validates structure,
and commits with a same-directory temp-file + fsync + atomic rename. This is what makes
it safe for a terminal session and a voice/automation client to write to the same store
at the same time.

- **Install:** automatic — the `core-agents` plugin's `sessionStart` hook links
  `assistant-store` onto your `PATH`. If the bare command isn't found yet, run it with
  Node from this skill's directory instead: `node <skill-dir>/scripts/assistant-store.mjs <command>`.
- **Output:** exactly one JSON line on stdout: `{ok, op, opId, changedPaths, result, error}`.
  Parse it — don't guess from exit code alone, though the exit code also distinguishes
  usage errors (1), business/validation errors (2, e.g. not-found, ambiguous match,
  malformed store), lock contention (3), and unexpected failures (4).
- **Ambiguous matches:** `task update|complete|reopen --match` and `reminder dismiss
  --match` require the keyword to identify exactly one row. If more than one matches,
  the command fails with `error.code: "AMBIGUOUS_MATCH"` and an `error.candidates` list —
  ask the user to pick one rather than guessing.
- **Commands:** `init`, `create-note`, `task add|update|complete|reopen`, `reminder
  set|dismiss`, and `import` (batch action-item import — see §5). Run `assistant-store
  --help` for the full flag reference.

---

## 1. Workspace Initialization

**On first use, or whenever a command reports a missing store**, initialize the workspace:

```bash
assistant-store init
```

This idempotently creates the full structure — safe to run even when the workspace
already exists (it reports `alreadyExisted` for anything it didn't need to create):

```
~/.copilot/assistant/
├── MEMORY.md
├── tasks.md
├── reminders.md
├── notes/
│   ├── meetings/
│   ├── decisions/
│   ├── ideas/
│   └── scratch/
├── templates/
│   ├── meeting.md
│   ├── decision.md
│   ├── idea.md
│   └── scratch.md
└── archive/
```

Every other command in this skill also lazy-inits the workspace on first use, so an
explicit `init` call is rarely required — run it directly only when you want to confirm
the workspace exists before doing anything else.

---

## 2. Note Creation

### General Process

1. Determine note type: `meeting`, `decision`, `idea`, or `scratch`
2. Determine the title, and a date if the user specified one other than today
3. Read the template from `~/.copilot/assistant/templates/<type>.md` and fill it in with
   the provided information (see the per-type field lists below) — this becomes the note's content
4. Run the gateway, piping the filled-in content on stdin:
   ```bash
   assistant-store create-note --type <type> --title "<title>" [--date YYYY-MM-DD] <<'EOF'
   <filled-in template content>
   EOF
   ```
   It generates the `YYYY-MM-DD-<slug>.md` filename (today in UTC unless `--date` is
   given), reserves the name exclusively (a same-title collision on the same date gets a
   deterministic `-2`, `-3`, ... suffix — see §6), and writes the file durably. It returns
   the final `path` in its JSON result.
5. Confirm with: file path, type, and brief summary

### Meeting Notes

**Path:** `~/.copilot/assistant/notes/meetings/YYYY-MM-DD-<slug>.md`

Fill the meeting template with:
- **Title** — Meeting name or topic
- **Date** — Date and time if known
- **Attendees** — Names mentioned by the user
- **Type** — Classify: standup, design-review, 1:1, planning, retro, sync
- **Agenda** — Topics if provided
- **Discussion** — Key points from the user's description
- **Decisions** — Any decisions mentioned (table format)
- **Action Items** — Tasks with owners and due dates as checkboxes

After creating meeting notes, **always offer**: "Want me to add the action items as tasks?"

### Decision Records

**Path:** `~/.copilot/assistant/notes/decisions/YYYY-MM-DD-<slug>.md`

Fill the decision template with:
- **Title** — What was decided
- **Status** — `proposed`, `accepted`, or `superseded`
- **Context** — Why this decision was needed
- **Options** — Alternatives considered (if the user mentions any)
- **Decision** — What was chosen and why
- **Consequences** — What changes as a result

### Idea Notes

**Path:** `~/.copilot/assistant/notes/ideas/YYYY-MM-DD-<slug>.md`

Fill the idea template with:
- **Title** — Brief name for the idea
- **Tags** — Relevant keywords
- **Status** — `raw` (default for new ideas)
- **The Idea** — Description
- **Why It Matters** — Problem/opportunity
- **Next Steps** — How to explore or validate

### Scratch Notes

**Path:** `~/.copilot/assistant/notes/scratch/YYYY-MM-DD-<slug>.md`

The most flexible format. Use when:
- The user says "note" without specifying a type
- Content doesn't fit meeting/decision/idea templates
- Quick capture of a thought, link, snippet, or observation

Fill with:
- **Title** — Brief description
- **Tags** — Keywords if obvious from context
- **Content** — Whatever the user provided, formatted for readability

---

## 3. Task Management

### Task File Format

Tasks live in `~/.copilot/assistant/tasks.md`, **maintained automatically by the
`assistant-store` gateway — never hand-edit this file.** Format, for reference:

```markdown
# Tasks

## Active

- [ ] **(P1)** Task title — due YYYY-MM-DD @context +project
- [ ] **(P2)** Task title — @context
- [ ] **(P3)** Task title

## Completed

- [x] **(P2)** Task title — completed 2026-04-15
```

### Add a Task

1. Parse the user's request for:
   - **Title** (required)
   - **Priority** — P1 (urgent), P2 (important), P3 (normal, default)
   - **Due date** — Parse natural language: "by Friday" → next Friday's date, "next week" → next Monday, "tomorrow" → tomorrow's date
   - **Context** — `@work`, `@personal`, `@health` (infer from content)
   - **Project** — `+ProjectName` (infer from content)
   - **Source** — If from a meeting note, add `← notes/meetings/filename.md`
2. Run:
   ```bash
   assistant-store task add --title "<title>" [--priority P1|P2|P3] [--due YYYY-MM-DD] \
     [--context @x] [--project +Y] [--source <path>]
   ```
3. Confirm: "Added P{n} task: {title}"

### Priority Guide

| Priority | Meaning | When to Assign |
|----------|---------|----------------|
| P1 | Urgent — needs immediate attention | User says "urgent", "ASAP", "critical", "blocking" |
| P2 | Important — should do soon | User says "important", "this week", or sets a near due date |
| P3 | Normal — do when possible | Default for everything else |

### Complete a Task

1. Run `assistant-store task complete --match "<keyword>"` — it finds the task in
   `## Active` (fuzzy match on title keywords), checks it off, appends the completion
   date, and moves it to `## Completed`.
2. If `error.code` is `AMBIGUOUS_MATCH` or `NOT_FOUND`, resolve with the user before
   retrying with a more specific `--match`.
3. Confirm: "Completed: {title}"

### Update a Task

1. Run `assistant-store task update --match "<keyword>" [--title S] [--priority Pn]
   [--due D] [--context @x] [--project +Y]` — unspecified fields are left unchanged.
2. Confirm what changed

### Reopen a Task

1. Run `assistant-store task reopen --match "<keyword>"` — it finds the task in
   `## Completed`, unchecks it, drops the completion date, and moves it back to `## Active`.

---

## 3.5 ADO Backend (when `taskBackend = "ado"`)

`taskBackend` selects exactly one of three personal-board backends —
`"markdown"` (§3, the default), `"ado"` (this section), or `"github"` (§3.6). See
`references/task-backend-contract.md` for the shared contract every backend implements
(create/update/complete/archive/parent-link/comment/list/field-normalization/ordering/
idempotency/error/fallback), the shared lane catalog, and config-versioning notes — read
it once; the per-backend sections below only cover backend-specific mechanics.

When `~/.copilot/assistant/config.json` exists and contains `taskBackend: "ado"`, **§3 Task Management is overridden by this section**. All task operations go to Azure DevOps via `az boards` instead of `tasks.md`. Reminders (§4), Notes (§2), Action Item Extraction (§5) are unaffected.

### 3.5.0 Read the config

Always read `~/.copilot/assistant/config.json` at the start of any task operation:

```bash
config=$(cat ~/.copilot/assistant/config.json)
backend=$(echo "$config" | python3 -c "import sys,json; print(json.load(sys.stdin).get('taskBackend','markdown'))")
```

If `backend == "github"`, follow §3.6 instead. If `backend` is anything else (including
`"markdown"`, absent, or unrecognized), fall back to §3 markdown behavior. Otherwise
(`backend == "ado"`), extract:
- From the **default board** (top-level keys, or nested under an `ado` object — both resolve): `org`, `project`, `team`, `workItemType`, `subtaskType`, `assignedTo`, `defaultAreaPath`, `defaultIteration`, `boardUrl`, `fieldMap`, plus top-level `fallbackInbox`.
- Optionally, from a separate **`teamBoard`** object (the read-only team/sprint board surfaced by `assistant-query` §8/§4b): `teamBoard.org`, `teamBoard.project`, `teamBoard.team`, `teamBoard.areaPath`.

> **Default board vs `teamBoard` (two distinct boards):**
> - The **default board** keys (`org`, `project`, `team`, `assignedTo`, …) drive all task CRUD (§3.5) and the personal-board briefing section (`assistant-query` §8a / §4a). This is the board you create and manage tasks on.
> - The optional **`teamBoard`** object describes a *separate, read-only* team/sprint board that `assistant-query` surfaces in the daily/weekly briefing (§8 "Team Sprint" / §4b). Omit it entirely if you only use one board.
>
> **Inside `teamBoard`, `team` vs `areaPath` are NOT interchangeable:** `teamBoard.team` is the **team name** for iteration context (`@CurrentIteration('[<teamBoard.project>]\<teamBoard.team>')`); `teamBoard.areaPath` is the **area-path subtree under the project**, used to scope `[System.AreaPath] UNDER '<teamBoard.project>\<teamBoard.areaPath>'`. They coincide only when the team's area node sits directly under the project; they differ when it is nested — e.g. team `Platform` but area subtree `Infra\Backend\Platform` (then `team = "Platform"`, `areaPath = "Infra\Backend\Platform"`). If the team uses no area-path scoping, set `areaPath` equal to `team`.

**Sample `~/.copilot/assistant/config.json`** (copy and replace the placeholder values with your own — these specifics live only in your local config, never in the repo). The default-board keys are shown nested under an `ado` object (top-level also resolves); the separate `teamBoard` object is optional:

```json
{
  "taskBackend": "ado",
  "ado": {
    "org": "https://dev.azure.com/your-org",
    "project": "YourProject",
    "team": "Your Team Name",
    "workItemType": "User Story",
    "subtaskType": "Task",
    "assignedTo": "you@example.com",
    "defaultAreaPath": "YourProject\\Your Team Name",
    "defaultIteration": "YourProject\\Sprint 1",
    "boardUrl": "https://dev.azure.com/your-org/YourProject/_boards/board/t/Your%20Team%20Name/Stories",
    "fieldMap": {
      "priority": "Microsoft.VSTS.Common.Priority",
      "tags": "System.Tags",
      "dueDate": "Microsoft.VSTS.Scheduling.DueDate",
      "description": "System.Description",
      "assignedTo": "System.AssignedTo"
    }
  },
  "teamBoard": {
    "org": "https://dev.azure.com/your-team-org",
    "project": "TeamProject",
    "team": "Your Team",
    "areaPath": "Area\\Subtree\\Your Team"
  },
  "fallbackInbox": "~/.copilot/assistant/inbox.md"
}
```

The assistant maps the `<config.org>`, `<config.project>`, `<config.team>`, `<config.assignedTo>`, etc. placeholders used in this skill and `assistant-query` to the **default-board** keys above. The `<config.teamBoard.*>` placeholders read the separate `teamBoard` object, which only `assistant-query` §8/§4b uses; omit that object if you use a single board.

To stay on the local-markdown backend instead, set `"taskBackend": "markdown"` (or omit the file entirely); the ADO keys are then ignored. To use the GitHub backend instead, see §3.6 (`"taskBackend": "github"` plus a `github` block). Other features layer their own keys onto this same file (e.g. `adoSessionSync.enabled` / `taskSessionSync.enabled` — see the `ado-session-sync` / `github-session-sync` skills).

### 3.5.1 Field mapping (locked taxonomy)

| `tasks.md` token | ADO field (via `fieldMap`) | Notes |
|---|---|---|
| `**(P1)**` / `**(P2)**` / `**(P3)**` | `Microsoft.VSTS.Common.Priority` = 1/2/3 | Default 3 if absent |
| `@work` / `@personal` / `@health` | `System.Tags` (`;`-separated) | Strip the `@` prefix |
| `+ProjectName` | `System.Tags` | Strip the `+` prefix |
| `due YYYY-MM-DD` | `Microsoft.VSTS.Scheduling.DueDate` | ISO 8601 — note: this field is queryable but NOT shown on the default Story card; appears in the side-panel and WIQL queries |
| `← notes/.../file.md` | append to `System.Description` as a markdown link + tag `from-meeting-notes` | Preserve provenance |
| `[#nnn]` (team WI ref) | `System.Description` (link) + tag `cross-ref:wi-nnn` | Migrate as a personal follow-up that references team WI; do NOT skip |
| `[!nnn]` (PR ref) | `System.Description` (link) + tag `cross-ref:pr-nnn` | Same |
| Subtask (indented `  - [ ]`) | Create as `Task` type with parent relation | Two-pass: parent first, then child with `relation add` |
| **Always set** | `System.AssignedTo = config.assignedTo` | Without this, `@Me` queries miss new items |

### 3.5.2 Add a Task

**Dedupe before creating.** ADO has no native dedupe, so a re-run or a bulk push of
action items (§5) can silently create duplicate work items. Before creating — and
especially when creating more than one item in a batch — search for an existing open
match using the §3.5.10 fuzzy-title query (`[System.Title] CONTAINS '<keyword>'`,
`[System.State] <> 'Closed'`). If a clear match already exists, update or comment on it
instead of creating a new one; if a batch item is ambiguous, surface it to **Needs Me**
(§3.5.7) rather than guessing. Only create after confirming no live duplicate exists.

```bash
# Required: title. Optional: priority, due, tags, workstreamFeatureId.
az boards work-item create \
  --type "User Story" \
  --title "<title>" \
  --org "<config.org>" --project "<config.project>" \
  --assigned-to "<config.assignedTo>" \
  --area "<config.defaultAreaPath>" \
  --iteration "<config.defaultIteration>" \
  --description "<HTML description; include source ref + cross-refs>" \
  --fields "Microsoft.VSTS.Common.Priority=<1|2|3>" \
           "System.Tags=tag1; tag2" \
           "Microsoft.VSTS.Scheduling.DueDate=YYYY-MM-DD" \
  --query "{id:id, title:fields.\"System.Title\"}" -o json
```

If the workstream Feature is clear (use §3.5.11 discovery), parent the new Story immediately:

```bash
az boards work-item relation add --id "<story-id>" --relation-type parent --target-id "<feature-id>"
```

If the workstream is unclear, leave the Story unparented and surface it to **Needs Me** rather than guessing.

Confirm with: "Added P{n} story #{id}: {title} — board: {boardUrl}"

### 3.5.3 Add a Subtask

```bash
# Pass 1: create the Task
TASK_ID=$(az boards work-item create --type "<config.subtaskType>" --title "<title>" \
  --assigned-to "<config.assignedTo>" --query id -o tsv)
# Pass 2: link as child of parent Story
az boards work-item relation add --id "$TASK_ID" --relation-type parent --target-id "<parent-story-id>"
```

### 3.5.4 Complete / Archive / Reopen / Update a Task

```bash
# Complete a User Story → state=Resolved (lands in Done column, visible)
az boards work-item update --id <STORY_ID> --state "Resolved"

# Complete a Task (subtask) → state=Closed (Tasks don't have Resolved state in Agile)
az boards work-item update --id <TASK_ID> --state "Closed"

# Archive a User Story → state=Closed (outgoing, auto-filters from board)
az boards work-item update --id <STORY_ID> --state "Closed"

# Reopen from Done: state -> Active (or New if not yet started)
az boards work-item update --id <ID> --state "Active"

# Restore from Archive: state -> Active (or New)
az boards work-item update --id <ID> --state "Active"

# Update fields
az boards work-item update --id <ID> --fields "Microsoft.VSTS.Common.Priority=1" "System.Tags=work; +SamplePlatform"
```

**⚠️ Story vs Task state difference (Agile process limitation):**

| Type | Available states | "Done" maps to | "Archive" maps to |
|---|---|---|---|
| **User Story** | New, Active, Resolved, Closed, Removed | `Resolved` (→ Done column) | `Closed` (→ Archive column) |
| **Task** (subtask) | New, Active, Closed, Removed | `Closed` (no separate archive — Tasks don't show on the kanban board, only as progress on parent Story) | `Closed` (same) |
| **Bug** | New, Active, Resolved, Closed | `Resolved` | `Closed` |

**Use this helper to do the right thing per type:**

```bash
complete_wi() {
  local id="$1"
  local type=$(az boards work-item show --id "$id" --query "fields.\"System.WorkItemType\"" -o tsv)
  case "$type" in
    "User Story"|"Bug") az boards work-item update --id "$id" --state "Resolved" ;;
    "Task"|"Epic"|"Feature") az boards work-item update --id "$id" --state "Closed" ;;
    *) echo "Unknown type: $type — defaulting to Closed"; az boards work-item update --id "$id" --state "Closed" ;;
  esac
}

archive_wi() {
  # All types use Closed for archive (or Removed if you want to be explicit it was cancelled)
  az boards work-item update --id "$1" --state "Closed"
}
```

**State semantics (post-2026-05-14T13:40 column redesign):**
- `New` = backlog, not started
- `Active` = currently being driven (work columns: Active / Needs Me / Blocked, distinguished by tag)
- `Resolved` (Story/Bug only) = **completed** (lands in Done column — visible)
- `Closed` (User Story) = **archived** (lands in Archive column — outgoing, auto-filters)
- `Closed` (Task) = **completed** (Tasks don't have separate Resolved/Archive — Closed is their done state; appears as progress on parent)

Title changes use `--title "<new>"`.

**⚠️ Tag write behavior (corrected 2026-05-28):** `az boards work-item update --fields "System.Tags=..."` is **ADDITIVE — it merges, never removes**. The earlier 2026-05-14 canary note claiming full overwrite was wrong. Confirmed re-canaried 2026-05-28: setting `System.Tags=zzz-test` on a card with existing tags `a; b` yields `a; b; zzz-test`, not `zzz-test`.

- ✅ **Adding** a tag → `az boards work-item update --fields "System.Tags=newtag"` works (it's append-style).
- ❌ **Removing or replacing** the tag set → does NOT work via `az boards work-item update`. You must use the REST PATCH op:replace via `az rest`:

```bash
config=$(cat ~/.copilot/assistant/config.json)
ORG=$(echo "$config" | python3 -c "import sys,json; c=json.load(sys.stdin); a=c.get('ado',{}); print(a.get('org') or c.get('org',''))")
PROJECT=$(echo "$config" | python3 -c "import sys,json; c=json.load(sys.stdin); a=c.get('ado',{}); print(a.get('project') or c.get('project',''))")
ADO_RESOURCE_ID="499b84ac-1321-427f-aa17-267ca6975798"   # Azure DevOps app ID (constant)

replace_tags() {
  local id="$1" tags="$2"   # tags = "tag1; tag2; tag3" (semicolon-space separated)
  az rest --method PATCH \
    --uri "$ORG/$PROJECT/_apis/wit/workitems/$id?api-version=7.1" \
    --resource "$ADO_RESOURCE_ID" \
    --headers "Content-Type=application/json-patch+json" \
    --body "[{\"op\":\"replace\",\"path\":\"/fields/System.Tags\",\"value\":\"$tags\"}]" \
    --query "{id:id, tags:fields.\"System.Tags\"}" -o json
}
```

The `--resource` flag is required — without it, `az rest` cannot derive the AAD audience for ADO and returns `Unauthorized (TF400813)`.

This same op:replace pattern works for any field that `--fields` cannot reliably overwrite.

### 3.5.5 Board flow & lane management

The board has **7 columns** designed for AI-agent + solo human workflows. Multiple columns share underlying states; the column a card appears in is decided by tags + state.

| Column | State | Tag | WIP | Type | Meaning |
|---|---|---|---|---|---|
| **New** | New | (none) | — | incoming | Fresh capture. Untriaged but classified (priority/tags set on capture). |
| **Up Next** | New | `up-next` | 5 | inProgress | Triaged and prioritized — I'll do these next. WIP=5 forces a real short-list. |
| **Active** | Active | (none) | 3 | inProgress | Currently being driven (you or agent). Tight WIP forces focus. |
| **Needs Me** | Active | `review` | 5 | inProgress | Agent (or external event) surfaced this for your decision/judgment. Not blocked — your turn. |
| **Blocked** | Active | `blocked` | 3 | inProgress | Waiting on external party/event. Bounded parking lot — if it overflows, escalate or clean up. |
| **Done** | **Resolved** | (any) | — | inProgress | Completed. Stays visible — recent wins lane. (NB: underlying state is Resolved, not Closed.) |
| **Archive** | **Closed** | (any) | — | outgoing | Filed away — completed-and-old, deferred, cancelled, or parked. Auto-filters from default board view. |

**Important state mapping change (2026-05-14T13):** the underlying state for "completed" work is now **Resolved**, not Closed. State=Closed now means "archived". Reasons:
- Allows two visible end-stages (Done + Archive) within ADO's "exactly one outgoing column" constraint
- Auto-archive of stale items happens at the Archive column (outgoing), not Done
- `Closed` matches the natural English meaning of "permanently closed / off the books"

**Optional `agent` tag** marks AI-driven items so cards visually distinguish autonomous from manual work.

**Tag exclusivity:** `review`, `blocked`, and `up-next` are mutually exclusive within their state grouping. Setting one should clear the others.

**Drag-and-drop limitation:** dragging between same-state columns (e.g. New ↔ Up Next, Active ↔ Needs Me ↔ Blocked) does NOT auto-update tags — only state changes propagate via drag. The agent handles tag updates via skill commands. Manual UI drag for those transitions is a no-op visually. Drag works correctly between different-state columns: New→Active, Active→Done, Done→Archive, etc.

### 3.5.6 Standard agent flow operations

The agent should call these state transitions at the right moments. Each row maps a *user-intent* → the exact `az boards` operation.

| User says / agent decides | Operation | Effect |
|---|---|---|
| "Add a task: …" | `az boards work-item create --type "User Story" ...` (default State=New) | Card lands in **New** |
| "Queue #N for soon" / "I'll do this next" | `add_tag up-next` (state stays New) | Card moves to **Up Next** |
| "I'm starting on #N" / agent begins autonomous work | `update --id N --state "Active"` then optionally `remove_tag up-next; add_tag agent` | Card moves to **Active** |
| "Pause on #N — I need your input" / agent hits ambiguity | `remove_tag blocked; add_tag review` (state stays Active) | Card moves to **Needs Me** |
| "I've decided on #N, continue" | `remove_tag review` (state stays Active) | Card moves back to **Active** |
| "I'm blocked on #N waiting for X" | `remove_tag review; add_tag blocked` | Card moves to **Blocked** |
| "X came through, picking #N back up" | `remove_tag blocked` | Card moves back to **Active** |
| "Done with #N" / agent finishes | `update --id N --state "Resolved"` | Card moves to **Done** |
| "Archive #N" / "File this away" | `update --id N --state "Closed"` | Card moves to **Archive** (auto-filters) |
| "Cancel #N" / "Won't do" | `update --id N --state "Closed"` + comment explaining | Same as Archive |
| "Reopen #N" | `update --id N --state "Active"; remove_tag review; remove_tag blocked` | Card returns to clean **Active** |
| "Restore #N from archive" | `update --id N --state "Active"` (or "New" for not-yet-started) | Card returns to **Active** (or New) |

**Helper functions** (reusable shell — embed in any operation that needs them):

```bash
get_tags() {
  az boards work-item show --id "$1" --query "fields.\"System.Tags\"" -o tsv
}

# Adding a tag — `--fields` is additive, so a direct write is safe and idempotent.
add_tag() {
  local id="$1" tag="$2"
  local cur=$(get_tags "$id")
  if echo "; $cur ;" | grep -q "; $tag ;"; then return 0; fi
  local new
  if [ -z "$cur" ]; then new="$tag"; else new="$cur; $tag"; fi
  az boards work-item update --id "$id" --fields "System.Tags=$new" >/dev/null
}

# Removing a tag — MUST use REST PATCH op:replace because `--fields` does not
# remove tags (it only merges). See §3.5.4 tag-write notes.
# Requires env: ORG, PROJECT, ADO_RESOURCE_ID (=499b84ac-1321-427f-aa17-267ca6975798)
remove_tag() {
  local id="$1" tag="$2"
  local cur=$(get_tags "$id")
  # Split, drop the target tag (exact match, whitespace-trimmed), rejoin with "; ".
  local new=$(python3 -c "
import sys
tag_to_remove = '''$tag'''.strip()
tags = [t.strip() for t in '''$cur'''.split(';') if t.strip() and t.strip() != tag_to_remove]
print('; '.join(tags))
")
  az rest --method PATCH \
    --uri "$ORG/$PROJECT/_apis/wit/workitems/$id?api-version=7.1" \
    --resource "$ADO_RESOURCE_ID" \
    --headers "Content-Type=application/json-patch+json" \
    --body "[{\"op\":\"replace\",\"path\":\"/fields/System.Tags\",\"value\":\"$new\"}]" \
    >/dev/null
}
```

> **Avoid `sed`-based tag splitting.** Earlier versions of this helper used `sed -E "s/; *${tag}//g"` which corrupts neighboring tags when the target tag is a substring of another tag (e.g. removing `metric` from `metric; PortalPerformance` yields `metric PortalPerformance`). The Python split-filter-join approach is exact-match and substring-safe.

### 3.5.7 When the agent should auto-move cards to Needs Me

The agent should proactively move a card to **Needs Me** (without being asked) when ANY of these happen mid-task:

- The agent encounters two valid implementation approaches and can't pick without user judgment
- A pre-implementation rubber-duck critique surfaces a HIGH-severity finding the user should weigh in on
- An external API call returns ambiguous data that needs human interpretation
- A destructive operation is about to happen (delete, force-push, drop) and the user hasn't pre-approved this specific instance
- A test fails in a way that suggests the user's spec was wrong, not the implementation
- The agent has been retrying the same operation 3+ times without progress (escalation, not silent loop)

When auto-moving, the agent should add a comment to the WI explaining *why* it surfaced for review:

```bash
az boards work-item update --id <ID> --discussion "🤖 Surfacing for your review: <one-sentence reason>. Context: <link or summary>."
```

This makes the Needs Me column a meaningful triage queue, not just a dumping ground.

### 3.5.8 When the agent should auto-archive

The agent should move a card to **Archive** (without being asked) when:

- The user explicitly says "won't do" / "cancel" / "drop this"
- A WI is older than 30 days, in `Done`, and not referenced in any recent activity
- A WI has been in `Blocked` for >60 days with no movement (likely de facto cancelled)
- A WI is a duplicate of another open WI (link the original in the comment, then archive the duplicate)

For ambiguous "stale" cases, surface to **Needs Me** first instead of archiving — let the user decide.

### 3.5.9 Capture-time fallback (`inbox.md`)

If any `az boards` call fails (network, auth, throttle), do NOT lose the user's input. Append an idempotent JSON entry to `~/.copilot/assistant/inbox.md`:

```
## 2026-05-14T08:00:00Z (clientCaptureId: 1f4a3c8b)
- title: "..."
- priority: 2
- tags: ["work", "SamplePlatform"]
- dueDate: "2026-05-21"
- description: "..."
- source: "← notes/meetings/2026-05-14-foo.md"
- ado_status: pending
```

Tell the user: **"Saved locally to inbox.md (ADO unreachable). Will sync at next session start."**

At session start (handled by `assistant-query` daily-briefing flow), scan `inbox.md` for `ado_status: pending` entries; for each, search ADO for any work item whose Description contains `clientCaptureId: <id>` (search via `az boards query`); if missing, create the WI and store the `clientCaptureId` in the Description; if present, just mark the inbox entry `ado_status: synced`. This guarantees idempotency under retry.

### 3.5.10 Find a task by fuzzy title

Before any complete/update/reopen op, find the matching WI:

```bash
az boards query --wiql "
  SELECT [System.Id], [System.Title], [System.State]
  FROM WorkItems
  WHERE [System.AssignedTo] = @Me
    AND [System.State] <> 'Closed'
    AND [System.Title] CONTAINS '<title-keyword>'
" -o table
```

If multiple match, ask the user to disambiguate by ID. If none, suggest the closest match (Levenshtein on titles).

### 3.5.11 Three-tier hierarchy (Epic ▸ Feature ▸ Story ▸ Task)

ADO-mode personal-board work uses this hierarchy:

| Level | Meaning | Board behavior |
|---|---|---|
| **Epic** | Program; months+ (e.g. Web Performance, SamplePlatform Harness, Personal Admin) | Portfolio parent, not day-to-day flow |
| **Feature** | Workstream; weeks | Parent shown on Story cards via `System.Parent`; **Active Features WIP=2 strict** |
| **User Story** | Day-to-day kanban card | Must flow New→Up Next→Active→Done within a few days; if it lingers >5 days, split it |
| **Task** | Optional checklist inside a Story | Never its own board card |

Feature titles use `[Program] Workstream` so the program prefix rolls onto Story cards. Current prefixes: `[Perf]` for Web Performance (not `[Portal]`) and `[Ops]` for Personal Ops. To discover candidate workstreams:

```bash
az boards query --org "<config.org>" --project "<config.project>" --wiql "
  SELECT [System.Id], [System.Title]
  FROM WorkItems
  WHERE [System.TeamProject] = '<config.project>'
    AND [System.WorkItemType] = 'Feature'
    AND [System.State] <> 'Closed'
  ORDER BY [System.Id]
" -o table
```

Match Features by prefix/keyword. When creating a new Story, parent it to the right Feature with `az boards work-item relation add --id <story> --relation-type parent --target-id <feature>`. If there is no confident match, leave it unparented and surface to **Needs Me** rather than guessing. Use the §3.5.5 lanes and §3.5.6 flow operations for card movement.

Cadence: Sun–Thu operating week; monthly Epic glance; Sunday Feature review feeds **Up Next**; Mon–Thu daily Stories board; Thursday closeout.

---

## 3.6 GitHub Backend (when `taskBackend = "github"`)

When `~/.copilot/assistant/config.json` contains `taskBackend: "github"`, **§3 Task Management is overridden by this section** (mirroring §3.5 for ADO — see `references/task-backend-contract.md` for the shared contract both implement). All task operations go to a GitHub Issues + Projects v2 board via the `gh` CLI instead of `tasks.md`. Reminders (§4), Notes (§2), Action Item Extraction (§5) are unaffected. `assistant-query` reads this same board through the bundled `github-query` command (§8b).

### 3.6.0 Read the config

```bash
config=$(cat ~/.copilot/assistant/config.json)
backend=$(echo "$config" | python3 -c "import sys,json; print(json.load(sys.stdin).get('taskBackend','markdown'))")
```

If `backend != "github"`, follow §3.5 (`"ado"`) or §3 (anything else). Otherwise, extract the `github` block:

```json
{
  "taskBackend": "github",
  "github": {
    "owner": "your-managed-account",
    "ownerType": "user",
    "repo": "personal-work",
    "projectNumber": 1,
    "projectId": "PVT_kwxxxxxxxxxxxxxxxxx",
    "fields": {
      "lane": "Lane",
      "priority": "Priority",
      "kind": "Kind",
      "dueDate": "Due date",
      "adoId": "ADO ID",
      "workstream": "Workstream",
      "mode": "Mode"
    },
    "boardUrl": "https://github.com/users/your-managed-account/projects/1"
  },
  "teamBoard": {
    "org": "https://dev.azure.com/your-team-org",
    "project": "TeamProject",
    "team": "Your Team",
    "areaPath": "Area\\Subtree\\Your Team"
  },
  "fallbackInbox": "~/.copilot/assistant/inbox.md"
}
```

- `owner` / `ownerType` / `repo` / `projectNumber` are required; `projectId` (the GraphQL node id, `PVT_...`) is optional but recommended — resolve it once with `gh project view <projectNumber> --owner <owner> --format json --jq .id` and cache it in config so writes never have to re-look it up.
- `fields` maps the shared lane-catalog concepts to this project's actual Projects v2 field names; every key has the default shown above — only override a renamed field.
- `teamBoard` is unchanged from §3.5.0: a separate, read-only board that `assistant-query` §8/§4b reads via `ado-query` regardless of which personal backend (`ado` or `github`) is active.
- `fallbackInbox` is unchanged from §3.5.0.

**Prerequisite:** `gh` must be installed and authenticated as an identity permitted to write to `github.owner`/`github.repo`/the Project — the exact check depends on `ownerType`:

- **`ownerType: "user"` (the common case — a personal managed account):** the
  authenticated identity must be **exactly** `github.owner`
  (`gh api user --jq .login`) — never proceed as a different user, even one
  with access, so a personal board never gets written by the wrong account.
- **`ownerType: "org"`:** `github.owner` is an organization name, not a user —
  no identity ever "is" the org, so an exact-login check would reject
  **every** legitimately authorized user. Instead confirm the authenticated
  identity has write access to `github.repo` and to the Project itself:
  `gh api repos/<owner>/<repo> --jq .permissions.push` must be `true`, and a
  Project write probe (e.g. `gh project field-list <projectNumber> --owner
  <owner>` succeeding, or an explicit collaborator/team-write check) must
  succeed. A write-permission failure is reported and stopped exactly like an
  identity mismatch in the user-owned case — never silently retried as a
  different identity.

Either way: confirm required scopes with `gh auth status --show-token=false`
(needs at minimum `repo` and `project`); if a write fails with a scope error,
do not attempt to silently re-auth — report it and stop (§3.6.9 fallback
still applies).

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

Same 7-lane model as the ADO board (§3.5.5), read/written through the `Lane` Projects v2
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

Same triggers as §3.5.7 (two valid approaches with no clear winner, a HIGH-severity
pre-implementation finding, ambiguous external data, an unapproved destructive op, a
spec-contradicting test failure, 3+ stalled retries). Comment before moving:

```bash
gh issue comment <number> --repo "<owner>/<repo>" \
  --body "🤖 Surfacing for your review: <one-sentence reason>. Context: <link or summary>."
```

### 3.6.8 When the agent should auto-archive

Same triggers as §3.5.8 (explicit cancel, 30+ days in Done with no recent activity,
60+ days in Blocked, confirmed duplicate — link the original, then archive the
duplicate). For ambiguous "stale" cases, surface to **Needs Me** first.

### 3.6.9 Capture-time fallback (`inbox.md`)

If any `gh` call fails (network, auth, rate limit, scope error), do NOT lose the user's
input. Append an idempotent entry to `<config.fallbackInbox>` using the **neutral**
`status` key (not `ado_status` — see `references/task-backend-contract.md` §Configuration
versioning; a reader must still accept legacy `ado_status` entries on the same file):

```
## 2026-05-14T08:00:00Z (clientCaptureId: 1f4a3c8b)
- title: "..."
- priority: 2
- tags: ["work", "SamplePlatform"]
- dueDate: "2026-05-21"
- description: "..."
- source: "← notes/meetings/2026-05-14-foo.md"
- status: pending
```

Tell the user: **"Saved locally to inbox.md (GitHub unreachable). Will sync at next session start."**

At session start, scan `inbox.md` for `status: pending` entries; for each, search the
board for an issue whose body contains `clientCaptureId: <id>` (a GitHub code search or
`gh issue list --search "<id> in:body"`); if missing, create the issue with the
`clientCaptureId` embedded in its body (§3.6.2); if present, mark the inbox entry
`status: synced`. This guarantees idempotency under retry — the exact same guarantee
§3.5.9 gives the ADO backend.

### 3.6.10 Find a task by fuzzy title

Before any complete/update/reopen op, find the matching issue:

```bash
gh issue list --repo "<config.github.owner>/<config.github.repo>" --state open \
  --search "<keyword> in:title" --json number,title,state,url
```

If multiple match, ask the user to disambiguate by number. If none, suggest the closest match (Levenshtein on titles).

### 3.6.11 Three-tier hierarchy (Epic ▸ Feature ▸ Story ▸ Task)

Same tiers and cadence as §3.5.11, expressed as GitHub sub-issues instead of ADO
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

Match by prefix/keyword, same convention as ADO (`[Perf]`, `[Ops]`, …). When creating a
new Story, link it as a sub-issue of the right Feature (§3.6.3). If there is no
confident match, leave it unparented and surface to **Needs Me** rather than guessing.

---

## 4. Reminder Management

### Reminder File Format

Reminders live in `~/.copilot/assistant/reminders.md`, **maintained automatically by the
`assistant-store` gateway — never hand-edit this file.** Format, for reference:

```markdown
# Reminders

| Due | Reminder | Context | Status |
|-----|----------|---------|--------|
| 2026-04-16 | Follow up with Alex on cert migration | @work +SampleProject | pending |
| 2026-04-18 | Check if PR #1234 was merged | @work +SampleProject | pending |
| every Monday | Weekly team review prep | @work | recurring |
```

### Set a Reminder

1. Parse the user's request for:
   - **Reminder text** (required)
   - **Due date** — Parse natural language, or "every {day}" for recurring
   - **Context** — Infer from content
2. Run:
   ```bash
   assistant-store reminder set --text "<text>" --due "<due>" [--context @x]
   ```
   A `--due` value matching `every ...` or `first of month` is classified `recurring`
   automatically; everything else is `pending`.
3. Confirm: "Reminder set for {date}: {text}"

### Dismiss a Reminder

1. Run `assistant-store reminder dismiss --match "<keyword>"` — it finds the matching
   row (fuzzy match on reminder text) and sets its status to `dismissed`.
2. If `error.code` is `AMBIGUOUS_MATCH` or `NOT_FOUND`, resolve with the user before
   retrying with a more specific `--match`.
3. Confirm: "Dismissed: {text}"

### Recurring Reminders

For recurring reminders, use natural language in the Due column:
- `every Monday`
- `every weekday`
- `first of month`
- `every 2 weeks`

The agent scans these on session start and surfaces them when the pattern matches today's date.

---

## 5. Action Item Extraction

When meeting notes contain action items (checkboxes with owners and dates):

1. Scan the `## Action Items` section for unchecked items: `- [ ] ...`
2. For each item, parse: task title, owner (@name), due date
3. Filter to items owned by the user (or unassigned)
4. Offer to add each as a task in `tasks.md`
5. If accepted, add them as a single atomic batch (one lock, one commit) rather than one
   `task add` call per item:
   ```bash
   assistant-store import <<'EOF'
   [
     {"title": "Follow up with vendor", "due": "2026-04-20", "context": "@work", "source": "notes/meetings/2026-04-15-standup.md"},
     {"title": "Draft the migration doc", "priority": "P1"}
   ]
   EOF
   ```
   Each JSON item accepts `title` (required), and optionally `due`, `context`, `project`,
   `priority`, and `source`. The result reports a per-item outcome — an item whose title
   already exists among active tasks is reported as `duplicate: true` and skipped, not
   duplicated; everything else that failed validation is reported with its own `error`.
   Review `result.results` and tell the user what was actually added.

---

## 6. File Naming Convention

All note files follow this pattern:

```
YYYY-MM-DD-<slug>.md
```

- **Date**: UTC date of creation
- **Slug**: kebab-case, max 50 characters, descriptive
- Generate date: `date -u +%Y-%m-%d`

Examples:
- `2026-04-15-standup.md`
- `2026-04-15-chose-react-query-for-state.md`
- `2026-04-15-agent-testing-framework.md`
- `2026-04-15-quick-thought-on-caching.md`

If a file with the same name already exists, append a sequence number: `2026-04-15-standup-2.md`

---

## 7. Automatic Behaviors

The agent should do these automatically without being asked:

1. **Date-prefix all files** — the gateway date-prefixes automatically; still choose the right date when the user implies one other than today
2. **Auto-create directories** — the gateway creates any missing note/type directory itself; no manual `mkdir` needed
3. **Use templates** — Always start from the template, never create blank files
4. **Offer action item extraction** — After meeting notes, ask about adding tasks
5. **Smart priority defaults** — P3 unless urgency cues detected
6. **Natural date parsing** — Convert "Friday", "next week", "end of month" to actual dates
7. **Update MEMORY.md** — After learning a preference (e.g., recurring meeting format), persist it. `assistant-store init` creates `MEMORY.md`, but ongoing edits to it are free-form prose, not a structured record the gateway models — edit it directly, same as before.

---

## 8. Azure DevOps Work Items

Create and update ADO work items via `az boards` CLI commands.

**Prerequisite:** Azure DevOps defaults must be configured. If commands fail with auth/project errors, run:
```bash
az devops configure --defaults organization=https://dev.azure.com/<org> project=<project>
```

For full `az boards` reference, invoke the `az` skill (provided by the `ops` plugin).

### Create a Work Item

Parse the user's request for:
- **Type** — Bug, Task, User Story (default: Task)
- **Title** (required)
- **Priority** — 1 (highest) to 4 (lowest). Map from natural language: P1→1, P2→2, P3→3
- **Assigned to** — Default `@Me` unless specified
- **Area path** — Infer from project context if known (check MEMORY.md)
- **Iteration** — Use current sprint if not specified
- **Description/discussion** — Any additional context

```bash
az boards work-item create \
  --type "Task" \
  --title "Implement password reset API" \
  --assigned-to "@Me" \
  --iteration "Project\\Sprint 42" \
  --fields "Microsoft.VSTS.Common.Priority=2" \
  --discussion "Context from meeting: need this for the auth redesign"
```

After creating, confirm with: "Created ADO #<ID>: <title>"

### Update a Work Item

Common update patterns:

**Change state:**
```bash
az boards work-item update --id <ID> --state "Active"
az boards work-item update --id <ID> --state "Resolved" --discussion "Fixed in PR #1234"
az boards work-item update --id <ID> --state "Closed"
```

**Reprioritize:**
```bash
az boards work-item update --id <ID> --fields "Microsoft.VSTS.Common.Priority=1"
```

**Reassign:**
```bash
az boards work-item update --id <ID> --assigned-to "user@example.com"
```

**Move to different sprint:**
```bash
az boards work-item update --id <ID> --iteration "Project\\Sprint 43"
```

**Add a comment:**
```bash
az boards work-item update --id <ID> --discussion "Update: waiting on backend API changes"
```

### State Transitions

States must follow valid transitions. Common flows:

| Type | Flow |
|------|------|
| Bug | New → Active → Resolved → Closed |
| Task | New → Active → Closed |
| User Story | New → Active → Resolved → Closed |

If a state transition fails, try the intermediate state first.

### Link to Parent

After creating a task, link it to a parent work item if specified:

```bash
az boards work-item relation add \
  --id <child-ID> \
  --relation-type "parent" \
  --target-id <parent-ID>
```

### Natural Language Mapping

| User Says | ADO Action |
|-----------|------------|
| "create a bug for..." | `az boards work-item create --type Bug` |
| "add a task for..." / "create work item" | `az boards work-item create --type Task` |
| "start working on #12345" | `az boards work-item update --id 12345 --state Active` |
| "resolve #12345" / "done with #12345" | `az boards work-item update --id 12345 --state Resolved` |
| "close #12345" | `az boards work-item update --id 12345 --state Closed` |
| "move #12345 to next sprint" | `az boards work-item update --id 12345 --iteration ...` |
| "assign #12345 to..." | `az boards work-item update --id 12345 --assigned-to ...` |
| "comment on #12345" | `az boards work-item update --id 12345 --discussion "..."` |
