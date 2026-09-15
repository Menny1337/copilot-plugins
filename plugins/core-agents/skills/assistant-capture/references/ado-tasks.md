# Capture ADO tasks

Use only after selecting ADO in the root procedure and reading
[ADO configuration (§3.5.0)](ado-configuration.md).

## Contents

- [Backend contract](#35-ado-backend-when-taskbackend--ado)
- [Field mapping](#351-field-mapping-locked-taxonomy)
- [Create tasks and subtasks](#352-add-a-task)
- [Complete, archive, reopen and update](#354-complete--archive--reopen--update-a-task)
- [Board lanes and flow](#355-board-flow--lane-management)
- [Needs Me and archive decisions](#357-when-the-agent-should-auto-move-cards-to-needs-me)
- [Fallback capture](#359-capture-time-fallback-inboxmd)
- [Fuzzy matching](#3510-find-a-task-by-fuzzy-title)
- [Hierarchy](#3511-three-tier-hierarchy-epic--feature--story--task)

## 3.5 ADO Backend (when `taskBackend = "ado"`)

`taskBackend` selects exactly one of three personal-board backends —
`"markdown"` ([§3](markdown-tasks.md), the default), `"ado"` (this section), or `"github"` ([§3.6](github-tasks.md)). See
[task-backend-contract.md](task-backend-contract.md) for the shared contract every backend implements
(create/update/complete/archive/parent-link/comment/list/field-normalization/ordering/
idempotency/error/fallback), the shared lane catalog, and config-versioning notes — read
it once; the per-backend sections below only cover backend-specific mechanics.

When the [selected assistant config](configuration.md) contains `taskBackend: "ado"`, **[§3 Task Management](markdown-tasks.md) is overridden by this section**. All task operations go to Azure DevOps via `az boards` instead of `tasks.md`. [Reminders (§4)](reminders.md) and [Notes (§2)](notes.md) stay local. [Action Item Extraction (§5)](action-items.md) keeps its parsing and consent steps, then writes accepted tasks through this backend.

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
action items ([§5](action-items.md)) can silently create duplicate work items. Before creating — and
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
az boards work-item update --id <ID> --fields "Microsoft.VSTS.Common.Priority=1" "System.Tags=work; +ExampleProject"
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
CONFIG="${COPILOT_PLUGIN_ASSISTANT_CONFIG:-${COPILOT_PLUGIN_ADO_CONFIG:-$HOME/.copilot/assistant/config.json}}"
CONFIG="${CONFIG/#\~/$HOME}"
config=$(cat "$CONFIG") || exit 1
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

> **Avoid `sed`-based tag splitting.** Earlier versions of this helper used `sed -E "s/; *${tag}//g"` which corrupts neighboring tags when the target tag is a substring of another tag (e.g. removing `metric` from `metric; metric-detail` damages the `metric-detail` tag). The Python split-filter-join approach is exact-match and substring-safe.

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

If any `az boards` call fails (network, auth, throttle), do NOT lose the user's input.
Append an idempotent entry to `<config.fallbackInbox>`. Use
`~/.copilot/assistant/inbox.md` only when the configuration key is absent; preserve
an explicit override.

```
## 2026-05-14T08:00:00Z (clientCaptureId: 1f4a3c8b)
- title: "..."
- priority: 2
- tags: ["work", "ExampleProject"]
- dueDate: "2026-05-21"
- description: "..."
- source: "← notes/meetings/2026-05-14-foo.md"
- ado_status: pending
```

Tell the user the actual saved inbox path and that ADO remains unavailable.
Only claim the local save after it succeeds.

Session-start retries belong to [assistant-query's ADO inbox
reconciliation](../../assistant-query/references/ado-inbox-sync.md), independently
of briefing generation. That procedure accepts both pending status keys, searches
by `clientCaptureId` before creating, and marks an entry synced only after
confirming the remote item. Do not duplicate its scan here or bypass its preflight.

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
| **Epic** | Program; months+ (e.g. Application Performance, Test Automation, Personal Tasks) | Portfolio parent, not day-to-day flow |
| **Feature** | Workstream; weeks | Parent shown on Story cards via `System.Parent`; **Active Features WIP=2 strict** |
| **User Story** | Day-to-day kanban card | Must flow New→Up Next→Active→Done within a few days; if it lingers >5 days, split it |
| **Task** | Optional checklist inside a Story | Never its own board card |

Feature titles use `[Program] Workstream` so the program prefix rolls onto Story cards. Reuse the prefixes already present on the configured board or explicitly supplied by the user; do not invent or rename program prefixes without approval. To discover candidate workstreams:

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

Cadence: use the user's established working week, or the ISO week if none is known. Review Epics monthly; review Features on the first working day to feed **Up Next**; review Stories daily; close out on the final working day.

---
