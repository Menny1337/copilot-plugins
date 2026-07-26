---
name: assistant-query
description: "Search, filter, and summarize personal assistant data: find notes by keyword or date, list tasks by status or priority, check due reminders, surface related context, and generate persistent daily and weekly briefings saved as markdown files in ~/.copilot/assistant/briefings/ (so they can be re-read, edited, and tracked as history). Triggers: good morning, morning, boker tov, daily brief, today's briefing, weekly brief, weekly review, what's due, find notes, search, show tasks, daily summary, what did I decide, overdue, list, briefing."
argument-hint: "<what to look up, or a date range>"
---

# Assistant Query

Procedures for reading, searching, filtering, and summarizing personal assistant data from `~/.copilot/assistant/`.

## When to Use

- Searching notes by keyword, date range, or type
- Listing or filtering tasks by status, priority, or due date
- Listing the user's open pull requests, in a briefing or on demand (see §9)
- Checking for due or overdue reminders
- Generating daily briefings or weekly summaries
- Surfacing related context when the user mentions a topic
- Answering "what did I..." questions about past notes/decisions

## When to Skip

- Creating notes, adding tasks, or setting reminders → use **assistant-capture** instead
- Modifying existing notes or tasks → use **assistant-capture** instead

---

## 1. Search Notes

### By Keyword

Search across all note files for a term:

```bash
grep -rl "search term" ~/.copilot/assistant/notes/ --include="*.md" 2>/dev/null
```

For content with context:

```bash
grep -r "search term" ~/.copilot/assistant/notes/ --include="*.md" -B 2 -A 2 2>/dev/null
```

### By Date Range

Find notes from a specific date:

```bash
ls ~/.copilot/assistant/notes/*/YYYY-MM-DD-*.md 2>/dev/null
```

Find notes from a date range (e.g., this week):

```bash
find ~/.copilot/assistant/notes/ -name "*.md" -newer /tmp/start_marker ! -newer /tmp/end_marker 2>/dev/null
```

Or use filename prefix matching for a month:

```bash
ls ~/.copilot/assistant/notes/*/2026-04-*.md 2>/dev/null
```

### By Type

List all notes of a specific type:

```bash
ls ~/.copilot/assistant/notes/meetings/ 2>/dev/null
ls ~/.copilot/assistant/notes/decisions/ 2>/dev/null
ls ~/.copilot/assistant/notes/ideas/ 2>/dev/null
ls ~/.copilot/assistant/notes/scratch/ 2>/dev/null
```

### Present Results

When presenting search results:

1. Show matching files with their titles (extracted from `# heading`)
2. Sort by date (most recent first)
3. Show a brief snippet of relevant content
4. Include the file path for reference
5. Offer to show full content of any result

Format:

```
📝 Found 3 notes matching "auth":

1. **Decision: Chose JWT over sessions** (2026-04-10)
   → ~/.copilot/assistant/notes/decisions/2026-04-10-chose-jwt.md
   
2. **Meeting: Design Review** (2026-04-14)
   → ~/.copilot/assistant/notes/meetings/2026-04-14-design-review.md
   "...discussed auth flow changes for the new..."
   
3. **Idea: Unified auth middleware** (2026-04-12)
   → ~/.copilot/assistant/notes/ideas/2026-04-12-unified-auth-middleware.md
```

---

## 2. List Tasks

### All Active Tasks

Read and display `~/.copilot/assistant/tasks.md`, showing the `## Active` section.

### Filter by Priority

```bash
grep -E "^\- \[ \] \*\*\(P1\)\*\*" ~/.copilot/assistant/tasks.md
```

### Filter by Due Date

Find overdue tasks (due before today):

```bash
today=$(date -u +%Y-%m-%d)
# Parse tasks.md for items with "due YYYY-MM-DD" where date < today
grep -E "^\- \[ \].*due [0-9]{4}-[0-9]{2}-[0-9]{2}" ~/.copilot/assistant/tasks.md | while read line; do
    due=$(echo "$line" | grep -oE "due [0-9]{4}-[0-9]{2}-[0-9]{2}" | cut -d' ' -f2)
    if [[ "$due" < "$today" ]]; then
        echo "⚠️  OVERDUE: $line"
    fi
done
```

Find tasks due today:

```bash
today=$(date -u +%Y-%m-%d)
grep "due $today" ~/.copilot/assistant/tasks.md
```

### Filter by Context or Project

```bash
grep "@work" ~/.copilot/assistant/tasks.md | grep "^\- \[ \]"
grep "+SampleProject" ~/.copilot/assistant/tasks.md | grep "^\- \[ \]"
```

### Present Task Lists

Format task listings clearly:

```
📋 Active Tasks (3):

P1:
  ⚠️  Fix auth redirect — due 2026-04-14 (OVERDUE) @work +SampleProject

P2:
  Review PR #1234 — due 2026-04-15 @work +SampleProject

P3:
  Schedule dentist appointment — @personal
```

---

## 2.5 List Tasks — ADO Backend (when `taskBackend = "ado"`)

When `~/.copilot/assistant/config.json` exists with `taskBackend: "ado"`, **§2 List Tasks is overridden by this section**. All task listings come from Azure DevOps via WIQL queries against `<config.org>/<config.project>` instead of `tasks.md`.

Read config first (see `assistant-capture` §3.5.0). Use `<config.org>`, `<config.project>`, `<config.assignedTo>`, `<config.fieldMap>`. The lanes are run with the `ado-query` command (see §8 "Running these queries" and §8a for the full lane catalog); this section only describes WHEN to use them.

### Mapping table

| User asks for | Run |
|---|---|
| All active tasks / "show my tasks" | `ado-query all-open` |
| Top / highest-priority N items | `ado-query all-open --output json`, then rank using the procedure below |
| "What am I working on" / "my active" / true in-flight | `ado-query active` |
| Filter by P1 | `ado-query by-priority --priority 1` |
| Overdue / due today / due this week | `ado-query overdue` / `due-today` / `due-week` |
| By tag (`@work`, `+SamplePlatform`) | `ado-query by-tag --tag '+SamplePlatform'` |
| Blocked items / "what's blocked" | `ado-query blocked` |
| Needs my attention / "needs me" | `ado-query needs-me` |
| Up Next queue / "my queue" / "what's next" | `ado-query up-next` |
| Backlog / "what could I pick up" | `ado-query backlog` |
| Recently completed / "what did I just finish" | `ado-query done-recent` |
| Done in the last day | `ado-query done-24h` |
| Archive contents (explicit ask only) | `ado-query archive` |
| Stale (untouched 7 days) | `ado-query stale` |
| Recent activity | `ado-query recently-changed` |

### Rank a Short Top-N List

For an on-demand request such as "my top priority" or "three highest priorities
tomorrow", do not fan out across every board lane. That adds latency without making
the ranking more consistent.

1. Run `ado-query all-open --output json` once. Apply any explicit scope from the
   request (personal board, project, tag, or time window) as a hard filter.
2. Rank the remaining items in this order:
   - overdue or due inside the requested window, earliest due first
   - lower numeric `Priority` (missing priority sorts last)
   - actionable board column: `Needs Me`, `Active`, `Blocked`, `Up Next`, then other
     columns
   - earlier due date, then most recently changed, then lower work-item ID
3. If the user asks about today, tomorrow, or a specific date, fetch that calendar
   window once. Use fixed commitments to break ties or flag a conflict; do not treat
   every meeting as a board item.
4. Query `ado-query details --id <ID>` only for the selected items whose title and
   ranking fields do not support the requested explanation.
5. Return exactly the requested count. Explain each choice from its due date,
   priority, board column, or verified details; do not invent urgency from the title.

This fast path is only for a short ranked answer. Full daily and weekly briefings still
run their required lane set in §4 and §5.

> **Default exclusion:** unless the user explicitly asks for archive contents, **never include `State = 'Closed'`** in any listing. Archive is opt-in only.

Keep the same presentation format as §2 ("Present Task Lists" — group by Priority, mark OVERDUE inline, etc.) but render IDs as clickable links: `**[#<ID>](<config.org>/<config.project>/_workitems/edit/<ID>)** — Title`.

---

## 3. Check Reminders

### Due Reminders Scan

Run at session start to find due or overdue reminders:

1. Read `~/.copilot/assistant/reminders.md`
2. Parse each row in the table
3. For date-based reminders: compare due date to today
4. For recurring reminders: check if the pattern matches today
   - `every Monday` → check if today is Monday
   - `every weekday` → check if today is Mon-Fri
   - `first of month` → check if today is the 1st
5. Surface any matching reminders

### Recurring Pattern Matching

```bash
today_day=$(date -u +%A)      # Monday, Tuesday, etc.
today_dom=$(date -u +%d)       # 01-31
today_dow=$(date -u +%u)       # 1=Monday, 7=Sunday
```

Match patterns:
- `every Monday` → `$today_day == "Monday"`
- `every weekday` → `$today_dow <= 5`
- `first of month` → `$today_dom == "01"`

### Present Reminders

```
🔔 Reminders:

Due today:
  - Follow up with Alex on cert migration (@work)

Recurring (today):
  - Weekly team review prep (every Monday)
```

---

## 4. Daily Briefing (Persistent Markdown File)

Daily briefings are **persisted to disk** at `~/.copilot/assistant/briefings/daily/YYYY-MM-DD-daily.md` so the user can re-read, edit, and track them as history.

### Triggers

- Greetings: "good morning", "morning", "boker tov", "בוקר טוב"
- Explicit: "daily brief", "today's briefing", "what's on my plate?", "daily summary"
- **Auto-trigger:** First conversation of any calendar day where today's file does not yet exist (the agent's session-start workflow handles this — see `assistant.agent.md` § Morning Briefing)

### File Path

```bash
today=$(date +%Y-%m-%d)        # use local time, not UTC, for "today" semantics
file=~/.copilot/assistant/briefings/daily/${today}-daily.md
```

> Use local time (`date +%Y-%m-%d`) — the user is in Israel; UTC can be off-by-one in the morning.

### Decision: Read vs. Generate

1. **If `$file` exists** → READ it and present a concise summary in chat.
   - Show the path so the user knows where to edit.
   - Offer: "Want me to refresh the auto-generated sections? (your edits below the divider are preserved)"
   - Do NOT regenerate unless the user confirms.
2. **If `$file` does not exist** → GENERATE it:
   - a. Read template `~/.copilot/assistant/templates/daily-briefing.md`
   - b. Compute each section (see Steps below)
   - c. Write the filled file to `$file`
   - d. Present a concise summary in chat with a link to the file
3. **Refresh mode** (user said "refresh today's briefing"):
   - Read the existing file
   - Split at the `<!-- Everything below this line is YOUR space... -->` marker
   - Regenerate only the sections ABOVE the marker
   - Preserve everything BELOW the marker verbatim
   - Append a `<!-- regenerated YYYY-MM-DD HH:MM -->` HTML comment near the top metadata

### Steps to Compute Sections

1. **Date & weekday:** `date "+%Y-%m-%d (%A)"` and `date "+%Y-%m-%d %H:%M %Z"` for the timestamp
2. **Overdue tasks** — Tasks in `tasks.md` with due dates before today
3. **Due today** — Tasks due today
4. **Due this week** — Tasks due within next 7 days, excluding today
5. **Due reminders** — Date-based reminders matching today + recurring patterns matching today (see §3)
6. **Team-board ADO items (only when a `teamBoard` is configured).** When `~/.copilot/assistant/config.json` has a `teamBoard` block, run the configured team sprint lanes and embed results using the **§4b Team Board Section Layout** (three lanes: Started → Committed → Proposed; hide-empty rule). Sourced from `ado-query team-started` / `team-committed` / `team-proposed`. **Omit this section entirely when no `teamBoard` block is configured** (see §8) — unlike the personal board (6b), the team board is optional. When `teamBoard` is configured but `az` is not, write `_ADO not configured — run \`az login\`_` rather than silently skipping.
6b. **Personal board (when `taskBackend = "ado"`) — MANDATORY column-oriented layout.** Render the personal board as a separate section using the layout defined in **§4a Personal Board Section Layout**. Sourced from §8a queries (which use `System.BoardColumn` — authoritative). Items with `State = 'Closed'` (Archive) and `State = 'Resolved'` older than 24h are **never** included. When `taskBackend != "ado"`, skip this step.
7. **Calendar — MANDATORY.** Always pull today's events via `calendar-ListCalendarView` (start = today 00:00 IST, end = today 23:59 IST). Render as a small table with `Time (IST) | Subject | Notes`. Flag conflicts (overlapping busy meetings) and OOO attendees. Bold any meeting the user organized. If the calendar tool is unavailable, write `_Calendar tool unavailable_` rather than skipping.
7b. **Active pull requests (§9).** List the user's open PRs across the configured orgs (see §9) and render the **🔀 Active Pull Requests** section here — after the ADO work-item sections, before Recent Notes. **Hide the section if the user has zero open PRs.** Add the open-PR count to the chat summary. This is a standing section: the user should not have to ask for it each day.
8. **Recent notes** — Notes created in the last 2 days (use filename date prefix)
9. **Open action items** — Scan meeting notes from the last 7 days for unchecked `- [ ]` items
10. **Focus for today** — Top 1–3 from Overdue + Due Today + P1 ADO items + the highest-priority calendar meeting

### Writing the File

Use the template as a starting point. Replace each `{...}` placeholder. For "none" sections, write `_None_` (italic) — do not delete the heading. This keeps file structure stable across days for diff-friendly history.

---

## 4a. Personal Board Section Layout (when `taskBackend = "ado"`)

Applies to step 6b above. The personal-board portion of the daily briefing is rendered as **column-oriented lanes in this exact order**, mirroring the kanban columns. Each lane sources from the `ado-query` lane in the Source column.

| Order | Lane | Heading | Source query | Render rule |
|---|---|---|---|---|
| 1 | Needs Me | `### 🟠 Needs Me` | `ado-query needs-me` | **Hide if 0** |
| 2 | Active | `### 🔥 Active` | `ado-query active` | **Hide if 0** |
| 3 | Up Next | `### ⏭️ Up Next` | `ado-query up-next` | **Hide if 0**; show **all** items (no cap) |
| 4 | Blocked | `### ⏸️ Blocked` | `ado-query blocked` | **Hide if 0** |
| 5 | Backlog | `### 🆕 Backlog` | `ado-query backlog` | **Always render** the count line (even when 0 — that's its own signal); top-5 expansion conditional (see below) |
| 6 | Done last 24h | `### ✅ Done in the last 24h` | `ado-query done-24h` | **Hide if 0** |

**Never include** in any lane: `State = 'Closed'` (Archive) or `State = 'Resolved'` older than 24h. Archive is opt-in only.

### Hide-empty rule

If a lane's source query returns 0 items, **omit the heading entirely** — do not render a `_None_` placeholder. The exception is Backlog: always render at minimum a `🆕 Backlog: {N} items` count line, even when `N = 0`.

Rationale: the briefing is for signal, not status-of-everything. An empty Needs Me / Blocked / Active lane communicates nothing actionable; rendering it consumes attention without information.

### WIP targets and overflow warnings

| Lane | Target | If exceeded, append warning |
|---|---|---|
| Needs Me | 5 | `> ⚠️ Needs Me over WIP ({N}>5) — decide, delegate, or close review items before adding more.` |
| Active | 3 | `> ⚠️ Active over WIP ({N}>3) — consider completing or deferring one before pulling more.` |
| Up Next | 5 | `> ⚠️ Up Next over WIP ({N}>5) — trim the queue or promote one to Active.` |
| Blocked | 3 | `> ⚠️ Blocked over WIP ({N}>3) — escalate blockers or archive stale parked work.` |

Warnings are informational, not blocking. Render them immediately under the lane heading.

### Backlog expansion rule

The Backlog lane always starts with a count line:

```
🆕 Backlog: {N} items
```

**Expand to top 5 (priority-ordered) if and only if** `(active_count + up_next_count) ≤ 6`.

This is a **strict, mechanical threshold check** — not a heuristic. The check uses raw counts; it does NOT consider WIP overflow, priorities of the items in the pipeline, or any other "should I expand anyway?" reasoning. If the threshold is exceeded, do not expand — render only the count line plus the standard hint:

```
🆕 Backlog: {N} items
_Pipeline at {active+upnext} ({active} Active + {upnext} Up Next) — above 6 threshold; backlog hidden. Ask "show my backlog" to see all._
```

**Rationale:** Backlog expansion is for moments when the user genuinely lacks queued work. When Up Next is overflowing (>5), the correct user action is to **trim or promote** from Up Next, not to add more from Backlog. Surfacing the backlog in that state actively works against the WIP discipline the column model is designed to enforce.

**Do not** add narrative justifications like "but backlog will help re-balance" — they undermine the rule. If you find yourself reasoning around the threshold, the answer is always: render the count line and stop.

When expanding (threshold satisfied), format each item as:

```
- **[#<ID>](<config.org>/<config.project>/_workitems/edit/<ID>)** P{n} · Title  {· workstream: <resolved Feature title or #parent-id if unresolved>}  {— due YYYY-MM-DD if any}
```

### Item rendering format (all lanes)

```
- **[#<ID>](<config.org>/<config.project>/_workitems/edit/<ID>)** P{n} · Title  {· workstream: <resolved Feature title or #parent-id if unresolved>}  {— due YYYY-MM-DD if any}  {· context tags}
```

`System.Parent` is an integer parent ID, not the Feature title. Before rendering personal-board Story lanes, collect distinct non-empty parent IDs from the lane results, then resolve them with one batched lookup. This is an ad-hoc ID set (no fixed `ado-query` lane) — use the `--where` escape hatch, or run raw `az`:

```bash
ado-query all-open --where "[System.Id] IN (<comma-separated-parent-ids>)" --print-wiql
# or directly:
az boards query --org "<config.org>" --project "<config.project>" --wiql "
  SELECT [System.Id], [System.Title]
  FROM WorkItems
  WHERE [System.Id] IN (<comma-separated-parent-ids>)
" -o table
```

Build an id→title map and render `· workstream: <Feature title>` when resolved. If a Story has no parent, omit the label. If the lookup cannot run or an ID is missing from the result, render `· workstream: #<parent-id>`; never invent a title.

For the Needs Me lane, append the most recent comment snippet if available (the agent's "surfacing for review" note from `assistant-capture` §3.5.7) — helps the user remember why it's in the queue.

---

## 4b. Team Board Section Layout (when team-board sprint queries are run)

Applies to step 6 above. The team-board section uses the same column-oriented model as the personal board, but mapped to the configured team's **sprint states** (which are the columns on the sprint task board). Each lane sources from the `ado-query` lane in the Source column.

| Order | Lane | Heading | Source query | Render rule |
|---|---|---|---|---|
| 1 | Started | `### 🚀 Started` | `ado-query team-started` | **Hide if 0**; absorb any `State='Active'` items here with `_(Active — rare)_` annotation |
| 2 | Committed | `### 🎯 Committed` | `ado-query team-committed` | **Hide if 0** |
| 3 | Proposed | `### ⏭️ Proposed` | `ado-query team-proposed` | **Hide if 0** |

**Hidden entirely:** `State IN ('Resolved', 'Completed', 'Closed', 'Cut')`. These are done-or-cancelled states; not part of the daily action surface.

### Team sprint state semantics

- **Proposed** = sprint backlog; the team's "Up Next" equivalent. Pull from here when current Committed/Started work resolves.
- **Active** = transitional state, rarely used in practice on this team. If items appear here, render them in the Started lane with `_(Active — rare)_` rather than their own near-empty lane.
- **Committed** = committed for this sprint; must ship before sprint ends.
- **Started** = currently being worked. Use as Started column on the task board.
- **Resolved / Completed / Closed / Cut** = terminal states; hidden from the daily briefing. Surface only on explicit request ("what did I ship this sprint?", "what got cut?").

### Hide-empty + WIP

Same hide-empty rule as §4a (lane omitted entirely when 0 items). No WIP targets defined for the team board — sprint capacity is managed at the iteration level, not per-lane.

### Item rendering format

```
- **[#<ID>](<config.teamBoard.org>/<config.teamBoard.project>/_workitems/edit/<ID>)** P{n} · Title  {— state-change context if any}
```

Cluster related items (e.g., SamplePlatform cluster, Alerts cluster) with a single label line above them when there are ≥ 3 items in a cluster, to reduce visual noise:

```
**SamplePlatform Playwright cluster:** [#12345](...) Started · [#12346](...) · [#12347](...) · [#12348](...)
```

---

### Chat Summary Format

After writing (or after reading existing file), respond with a tight summary like:

```
☀️ Daily Briefing — 2026-04-19 (Sunday)
📄 ~/.copilot/assistant/briefings/daily/2026-04-19-daily.md

⚠️  Overdue: 1 — (P1) Fix auth redirect
📋 Due today: 2
🔔 Reminders: 1
🔷 ADO: 3 sprint items (1 P1)

📌 Focus: Fix auth redirect → Review PR #1234 → Send weekly report
```

Do not dump the full markdown into chat — point at the file.

---

## 5. Weekly Briefing (Persistent Markdown File)

Weekly briefings are **persisted to disk** at `~/.copilot/assistant/briefings/weekly/YYYY-Www-weekly.md`.

### Triggers

- Explicit: "weekly brief", "weekly briefing", "weekly review"
- **Auto-trigger:** First conversation of a new ISO week where this week's file does not yet exist (handled by agent — see `assistant.agent.md` § Morning Briefing)
- **Sunday morning rule:** If today is Sunday (start of Israeli work week) and no file exists, also generate. Sunday's daily briefing call should generate the weekly briefing first, then the daily.

### File Path & ISO Week

```bash
# ISO week — Monday is day 1, week containing Thursday determines year
iso=$(date +%G-W%V)            # e.g. 2026-W16
file=~/.copilot/assistant/briefings/weekly/${iso}-weekly.md

# Week range (Mon–Sun) for the headline
mon=$(date -v-Mon +%Y-%m-%d 2>/dev/null || date -d "monday this week" +%Y-%m-%d)
sun=$(date -v+Sun +%Y-%m-%d 2>/dev/null || date -d "sunday this week" +%Y-%m-%d)
```

> macOS uses `date -v`; GNU/Linux uses `date -d`. The fallback above works on both.
>
> **Note on Israel work week:** File naming uses ISO week (Mon–Sun) for portability. The user's effective work week is Sun–Thu — when listing "completed this week" or "decisions this week", consider both ranges and prefer the user's recent activity window. ISO is the canonical filename only.

### Decision: Read vs. Generate

Same rules as the daily briefing (§4 "Decision: Read vs. Generate"):

1. If file exists → present summary, offer refresh
2. If not → generate from template, write, present summary
3. Refresh preserves everything below the user-edits divider

### Steps to Compute Sections

1. **Headline** — One-sentence summary derived from P1 tasks + sprint commitments
2. **Open tasks snapshot** — Counts by priority + overdue count
3. **Completed last 7 days** — Tasks moved to `## Completed` in the last 7 days
4. **Decisions made** — Decision records from `notes/decisions/` with date prefix in the last 7 days
5. **Notes created** — Counts by type with file paths
6. **Team-board ADO sprint status (only when a `teamBoard` is configured).** When a `teamBoard` block is present, run the sprint query and embed results. Format every item as a markdown link:
   `**[#<ID>](<config.teamBoard.org>/<config.teamBoard.project>/_workitems/edit/<ID>)** (Type, State) — Title`
   Group by **Active / In-flight** vs **Proposed (pick up this week)**, plus a **Known blockers** subsection (PRs awaiting approval, pending entitlement renewals, IcM tickets). **Omit this section entirely when no `teamBoard` block is configured** (see §8). When `teamBoard` is configured but `az` is unavailable, write `_ADO not configured_`.
6b. **Personal board (when `taskBackend = "ado"`) — MANDATORY column-oriented layout.** Render the personal board using the same six-lane layout as the daily briefing (see §4a), but with a wider time window: Done lane shows **last 7 days** instead of last 24h. Add a `📈 Throughput` line under the Done lane: `Done last 7d: {N} — avg {N/7} per day`. Items with `State = 'Closed'` (Archive) are never included. When `taskBackend != "ado"`, skip this step.
6c. **Active pull requests (§9).** Include the user's open PRs across the configured orgs. Under a **Known blockers** note, call out PRs that have been open all week or are blocking a sprint commitment.
7. **Recurring commitments this week** — Recurring reminders that will fire (e.g. "every Monday" → Mon of this week)
8. **Stale items** — Active tasks created >7 days ago with no movement (use `ado-query stale` when `taskBackend = "ado"`)
9. **Top priorities** — Suggested 3–5 from P1/P2 tasks and sprint commitments

### Chat Summary Format

```
📊 Weekly Briefing — 2026-W16 (Apr 13 – Apr 19, 2026)
📄 ~/.copilot/assistant/briefings/weekly/2026-W16-weekly.md

🎯 Headline: Auth migration ships this week; sprint at 60% complete.
📋 Open: 4 (1 P1, 2 P2, 1 P3) · Overdue: 1
✅ Completed last 7d: 3
🏗️ Decisions: 1 (Chose React Query)

📌 Top priorities: Fix auth redirect → Ship migration → Code review backlog
```

---

## 6. Context Surfacing

When the user mentions a topic, project, or person, proactively surface related context:

### Trigger Detection

Listen for mentions of:
- Project names (`+SampleProject`, `+sample-app`)
- People names (check against MEMORY.md contacts)
- Technical topics that match note titles or tags

### Surface Process

1. Search notes for the mentioned term
2. Search tasks for the term
3. Search decisions for the term
4. Present a brief context summary:

```
💡 Related context for "SampleProject":

📝 Recent notes: Design Review (Apr 14), Auth Decision (Apr 10)
📋 Open tasks: 2 (Review PR #1234, Fix auth redirect)
🏗️ Decisions: Chose JWT over sessions (Apr 10)
```

Only surface context when it adds value — don't interrupt the flow for marginal matches.

---

## 7. Stale Item Detection

Flag items that may need attention:

### Criteria

- **Stale tasks**: Active tasks created > 7 days ago with no updates
- **Abandoned ideas**: Ideas in `raw` status for > 14 days
- **Open action items**: Unchecked items in meeting notes > 3 days old

### Scan Command

```bash
# Find notes older than 7 days
find ~/.copilot/assistant/notes/ -name "*.md" -mtime +7 2>/dev/null
```

Surface stale items during daily briefing or weekly review, not on every interaction.

---

## 8. Azure DevOps Work Items

Query and display ADO work items assigned to the user.

### Running these queries: the `ado-query` command

The queries in §8 and §8a are **named lanes** of the bundled `ado-query` helper — a
thin WIQL builder that reads `~/.copilot/assistant/config.json` and runs `az boards
query` for you. Prefer it over hand-typing WIQL: it keeps every lane's `SELECT` /
`WHERE` / `ORDER BY` identical run-to-run and reads org/project (plus the `teamBoard`
block) from config, so **you never pass `--org` / `--project` yourself**.

- **Install:** automatic — the `core-agents` plugin's `sessionStart` hook links
  `ado-query` onto your `PATH`. If the bare command isn't found yet, run it with Node
  from this skill's directory instead: `node <skill-dir>/scripts/ado-query.mjs <lane>`.
- **Catalog:** `ado-query --list` prints every lane grouped by board.
- **See the WIQL:** append `--print-wiql` (alias `--dry-run`) to any lane to print the
  exact query and the resolved `az` command **without running them**.
- **Options:** `--board personal|team` (override a generic lane's board), `--priority N`,
  `--tag T`, `--assignee EMAIL`, `--changed-since-days N`, `--area`, `--output table|json|tsv`,
  and `--where "CLAUSE"` (raw WHERE escape hatch, repeatable).
- **Board defaults:** each lane targets the right board automatically (e.g. `all-open` →
  personal, `team-started` → team). The generic `my-open` / `my-sprint` lanes accept
  `--board team` to point at the team board.

Every code block below names the lane to run; the prose around it (WIP targets,
hide-empty rules, render format) is the judgment the command does **not** encode.

**Prerequisite:** the `az` CLI must be installed and authenticated (`az login`). If a
lane fails with auth/project errors, confirm the `ado` / `teamBoard` blocks in
`config.json`, or set global defaults with
`az devops configure --defaults organization=https://dev.azure.com/<org> project=<project>`.
For full `az boards` reference, invoke the `az` skill (provided by the `ops` plugin).

### Search Strategy (Large Projects)

> **Important:** On large ADO projects, query scoping matters. Follow this order:

1. **Direct ID lookup** — Always preferred when the ID is known (`az boards work-item show --id <ID>`)
2. **Scope to `@Me`** — Fast and reliable for items assigned to the user
3. **Scope by team area path** — Fallback when searching for team items not assigned to `@Me`. Use: `[System.AreaPath] UNDER '<config.teamBoard.project>\\<config.teamBoard.areaPath>'`
4. **Never** use broad `CONTAINS` searches scoped only to iteration — they time out consistently on large projects

> **`teamBoard.areaPath` is the area-path subtree — not `teamBoard.team`.** `teamBoard.team` (the team *name*) is what `@CurrentIteration('[<teamBoard.project>]\<teamBoard.team>')` needs in §8; `teamBoard.areaPath` is what `[System.AreaPath] UNDER` needs. See `assistant-capture` §3.5.0 for the `teamBoard` block. They differ when the team's area node is nested under the project.

See `devops-boards.md` §10 for full details and query examples.

### My Open Work Items

```bash
ado-query my-open
```

### My Current Sprint Items

```bash
ado-query my-sprint
```

> **The three "Team Sprint" queries below target the team board** — the separate `teamBoard` block in `~/.copilot/assistant/config.json` (`<config.teamBoard.org>` / `<config.teamBoard.project>` / `<config.teamBoard.team>` / `<config.teamBoard.areaPath>`), which is distinct from the default/personal board (`<config.org>` / `<config.project>`) that §8a queries. See `assistant-capture` §3.5.0 for both blocks. If no `teamBoard` block is configured, skip the team-board section of the briefing.

### Team Sprint — Started (column-oriented daily briefing)

Items I'm currently working on in this sprint. Source for the **🚀 Started** lane in §4b.

```bash
ado-query team-started
```

> Note: `State = 'Active'` is rarely used on this team. If any Active items appear, render them inside the Started lane with an `_(Active — rare)_` annotation per §4b.
>
> **`@CurrentIteration` requires a team context**, which the lane derives from `config.teamBoard.team`. If it fails (e.g. the team name is wrong or the sprint isn't current), run `ado-query team-started --print-wiql`, then re-run the printed `az` command with an explicit iteration path swapped in: `[System.IterationPath] UNDER '<config.teamBoard.project>\\<sprint-id>'` (e.g. `'OS\\2605'`) — less portable across sprints but always works.

### Team Sprint — Committed

Items committed for this sprint; must ship before sprint ends. Source for the **🎯 Committed** lane in §4b.

```bash
ado-query team-committed
```

### Team Sprint — Proposed

Sprint backlog; "Up Next" equivalent on the team board. Pull from here when Committed/Started work resolves. Source for the **⏭️ Proposed** lane in §4b.

```bash
ado-query team-proposed
```

**Hidden states** (do NOT include in daily/weekly briefings): `Resolved`, `Completed`, `Closed`, `Cut`. Surface only on explicit user request (e.g., "what did I ship this sprint?", "what got cut?").

### Work Item Details

```bash
ado-query details --id <ID>
```

### Recently Changed Items

```bash
ado-query recently-changed
```

### Present ADO Results

Format ADO work items clearly alongside local tasks:

```
🔷 ADO Work Items (assigned to you):

Sprint 42:
  #12345 (P1) Bug: Login page throws 500 — Active
  #12350 (P2) Task: Implement password reset API — New
  #12360 (P3) User Story: As a user I can export data — Active

Other:
  #12400 (P2) Bug: Stale cache on deploy — Active (Sprint 41, carryover)
```

### Integration with Daily Briefing

When generating a daily briefing (§4), include ADO items after local tasks:

1. Run `ado-query my-sprint` (the "My Current Sprint Items" lane)
2. Highlight P1/P2 items and any newly assigned items
3. Show count: "You have N ADO work items in the current sprint (X active, Y new)"

---

## 8a. Personal Board (when `taskBackend = "ado"`)

Mirror of §8 but pointed at the personal board (`config.ado` → `<config.org>/<config.project>` from `~/.copilot/assistant/config.json`). When `taskBackend != "ado"`, **skip this entire section**. Every lane below runs through `ado-query` (see §8 "Running these queries"), which reads the `ado` block from config — no `--org` / `--project` needed.

### Authoritative column source: `System.BoardColumn`

**Column-classifying queries below use `[System.BoardColumn]` — not tags.** This is the field ADO uses to render kanban columns, so querying it guarantees the briefing matches exactly what the user sees on the board UI.

Historical context: an earlier iteration queried `Tags CONTAINS 'up-next'` (etc.) per the capture skill §3.5.5 tag convention. Reality: ADO column rules are driven by `System.BoardColumn`, not tags. When the user drags a card in the UI, `System.BoardColumn` updates but tags do not. When the agent updates tags, the card does not visually move. Querying `System.BoardColumn` is the only way to read the truth of the board.

Capture-side (tag-setting) behavior may diverge from read-side until the capture skill is fixed to also set `System.BoardColumn`. Read-side is authoritative.

### Default exclusion rule

**Every lane in this section excludes `State = 'Closed'`** unless the user explicitly asks for archive contents. Archive (Closed) is opt-in only — it must never leak into briefings, "show my tasks" answers, or "what's on my plate" responses. The only lane that returns Closed items is `archive`, and only when the user asks for it directly.

If you add a new lane to `scripts/ado-query.mjs`, bake in `[System.State] <> 'Closed'` (or the broader `[System.State] NOT IN ('Resolved', 'Closed')` when appropriate).

### All Open Personal Items

```bash
ado-query all-open
```

### My Open by Priority (P1 / P2 / P3)

```bash
ado-query by-priority --priority 1   # --priority 2 / 3 for P2 / P3
```

### Due Date Windows

```bash
ado-query overdue     # past due, still open
ado-query due-today   # due today
ado-query due-week    # due in the next 7 days
```

### By Tag

```bash
ado-query by-tag --tag '+SamplePlatform'
```

Note: WIQL `CONTAINS` on Tags works as a substring match against the semicolon-joined tag string.

### Blocked Items

Items in the Blocked column. WIP target = 3 — if > 3, surface as an overflow warning per §4a.

```bash
ado-query blocked
```

### Needs Me Items (your attention queue)

Items the agent (or external events) have surfaced for your decision/judgment. These are NOT blocked — they're "your turn". WIP target = 5 — if > 5, surface as an overflow warning per §4a.

```bash
ado-query needs-me
```

**Daily Briefing should ALWAYS surface this count prominently** — if Needs Me has items, those are the user's first action of the day. Render at the top of the briefing as `🟠 Needs Me: N items` (orange, because urgency without crisis).

### Up Next Items (queued short-list)

Items in the Up Next column on the board. WIP target = 5 — if > 5, surface as an overflow warning per §4a.

```bash
ado-query up-next
```

### True Active Items (in-flight)

Items in the Active column on the board (you're actively driving toward Done). WIP target = 3 — if > 3, surface as overflow warning per §4a.

```bash
ado-query active
```

### Backlog (System.BoardColumn = 'New')

Items in the New column (have not been promoted to Up Next yet). Surface a count always; expand only when the pipeline is running low (see §4a Backlog expansion rule).

```bash
ado-query backlog
```

### Done — last 24h

Recently-completed items for the daily-briefing momentum recap. Window = 1 day.

```bash
ado-query done-24h
```

### Done (recent completions)

Items in the Done column (State=Resolved). Surfaces what was finished recently — useful for weekly recaps and "what did I do last week" questions. Default window is 14 days; the weekly briefing passes `--changed-since-days 7`.

```bash
ado-query done-recent                       # default: last 14 days
ado-query done-recent --changed-since-days 7  # weekly briefing window
```

### Archive Items

Items archived (State=Closed). For "did I cancel something?" / "what was that thing I parked?" lookups.

```bash
ado-query archive
```

### Stale Items (untouched 7 days)

```bash
ado-query stale
```

### Recently Changed

```bash
ado-query recently-changed
```

### Pending Inbox Sync

When operating in ADO mode, on session start, scan `<config.fallbackInbox>` for entries with `ado_status: pending`:

```bash
grep -B1 -A8 "^- ado_status: pending$" ~/.copilot/assistant/inbox.md
```

For each pending entry, query ADO for any WI whose Description contains its `clientCaptureId`. This is a one-off existence probe (no `ado-query` lane); run it raw:

```bash
az boards query --wiql "
  SELECT [System.Id]
  FROM WorkItems
  WHERE [System.Description] CONTAINS '<clientCaptureId>'
" -o tsv
```

If no match → call `az boards work-item create` with the entry's data, including `<clientCaptureId>` in Description; mark inbox entry `ado_status: synced`.
If match → mark inbox entry `ado_status: synced` (was already created earlier).

### Daily Briefing Integration (ADO mode)

When `taskBackend = "ado"`, the Daily Briefing (§4) "Tasks" section is sourced from `ado-query` lanes instead of `tasks.md`. Mapping:

| §4 step | When `taskBackend = "ado"`, source it from |
|---|---|
| 2. Overdue tasks | `ado-query overdue` |
| 3. Due today | `ado-query due-today` |
| 4. Due this week | `ado-query due-week` |
| 6. Team-board ADO items | `ado-query team-started` / `team-committed` / `team-proposed` — rendered per **§4b Team Board Section Layout** |
| 6b. Personal board — column-oriented layout | See **§4a Personal Board Section Layout**; sourced from the lane→query map below |

Add a new step **2b. Pending Inbox** if the count from "Pending Inbox Sync" is > 0 — show as a warning, e.g. `⚠️ N inbox items not yet synced to ADO`.

Render personal-board IDs as clickable links: `**[#<ID>](<config.org>/<config.project>/_workitems/edit/<ID>)** — Title`. Distinguish them from team-board IDs in the chat summary.

### Personal Board Lane → Query Map (used by step 6b and §4a)

| Briefing lane | `ado-query` lane | Render rule |
|---|---|---|
| 🟠 Needs Me | `needs-me` (`[BoardColumn] = 'Needs Me'`) | Hide if 0; WIP target 5 |
| 🔥 Active | `active` (`[BoardColumn] = 'Active'`) | Hide if 0; WIP target 3 |
| ⏭️ Up Next | `up-next` (`[BoardColumn] = 'Up Next'`) | Hide if 0; show all; WIP target 5 |
| ⏸️ Blocked | `blocked` (`[BoardColumn] = 'Blocked'`) | Hide if 0; WIP target 3 |
| 🆕 Backlog | `backlog` (`[BoardColumn] = 'New'`) | Always render count; expand top 5 only when Active+UpNext ≤ 6 |
| ✅ Done last 24h | `done-24h` | Hide if 0. Weekly briefing uses `done-recent --changed-since-days 7` + throughput stat |

**Never** render `State = 'Closed'` (Archive) in the briefing under any lane. Archive is opt-in only.

### Team Board Lane → Query Map (used by step 6 and §4b)

| Briefing lane | `ado-query` lane | Render rule |
|---|---|---|
| 🚀 Started | `team-started` (`State IN ('Started','Active')`) | Hide if 0; Active items annotated `_(Active — rare)_` |
| 🎯 Committed | `team-committed` (`State = 'Committed'`) | Hide if 0 |
| ⏭️ Proposed | `team-proposed` (`State = 'Proposed'`) | Hide if 0 |

**Never** render `Resolved`, `Completed`, `Closed`, or `Cut` in the daily/weekly briefing. These surface only on explicit request.

### Weekly Briefing Integration (ADO mode)

The Weekly Briefing (§5) step 6b uses the same six-lane layout as the daily, with two differences:

1. **Done lane window:** `ado-query done-recent --changed-since-days 7` (7-day window) instead of `done-24h`.
2. **Throughput line:** under the Done lane, append `📈 Done last 7d: {N} — avg {N/7:.1f} per day`. This gives the user a velocity signal week-over-week.

WIP targets, overflow warnings, hide-empty rule, and the Closed-exclusion rule are unchanged from the daily briefing.

---

## 9. Active Pull Requests

The user's open pull requests are a **standing briefing section** and an on-demand query
("show my active PRs", "my open PRs", "PRs waiting on me", "add my active PRs to the
briefing"). The user has repeatedly asked for this in the morning briefing, so compute it
by default rather than waiting to be asked.

PRs are **repo objects, not work items**, so they come from `az repos pr list` / `gh` —
**not** from `ado-query`, which only builds `az boards` WIQL (§8). Do not try to force PRs
through a board lane.

### Sources

List PRs **authored by the user** across every org they work in. Read the identity and
orgs from `~/.copilot/assistant/config.json`:

- **Creator:** `<config.ado.assignedTo>` (the user's email).
- **ADO orgs/projects:** `<config.ado.org>`/`<config.ado.project>` (personal) and
  `<config.teamBoard.org>`/`<config.teamBoard.project>` (team), plus any extra
  `{ "org": …, "project": … }` pairs in the optional `config.prSources` array. The user
  often has PRs in work orgs beyond the two boards — if a recently-mentioned PR lives in an
  org that isn't configured, surface it anyway and offer to save that org/project to
  `prSources` so future briefings include it automatically.
- **GitHub (only if the user has GitHub repos):** `gh search prs --author "@me" --state open`.

### Query

```bash
ME="<config.ado.assignedTo>"
# Per configured ADO org/project (repeat for each source):
az repos pr list --org "<org>" --project "<project>" \
  --creator "$ME" --status active -o json 2>/dev/null \
  | jq -r '.[] | "\(.pullRequestId)\t\(.repository.name)\t\(.isDraft)\t\(.title)"'

# GitHub, across every repo the user authors in:
gh search prs --author "@me" --state open \
  --json number,title,repository,url,isDraft 2>/dev/null
```

`--status active` already excludes completed/abandoned PRs; keep drafts but tag them
`_(draft)_`. ADO PR link: `<org>/<project>/_git/<repo>/pullrequest/<pullRequestId>`.

### Render

Group by org/repo; one line per PR. **Hide the whole section when the user has zero open
PRs** (do not print an empty heading).

```
## 🔀 Active Pull Requests

**<org> / <project>**
- **[!12345](<org>/<project>/_git/<repo>/pullrequest/12345)** Short PR title · 2 reviewers pending
- **[!12346](<org>/<project>/_git/<repo>/pullrequest/12346)** _(draft)_ Another change

_3 open · 1 waiting on reviewers_
```

When reviewer/vote data is available, annotate who still needs to approve and flag PRs with
active (unresolved) comment threads — that is the judgment the raw list does not encode. If
`az`/`gh` is unavailable or unauthenticated, write
`_PR sources unavailable — run \`az login\` / \`gh auth login\`_` rather than omitting the
heading silently.

### Briefing integration

- **Daily (§4, step 7b):** render after the ADO work-item sections, before Recent Notes;
  add the open-PR count to the chat summary (e.g. `🔀 PRs: 3 open (1 needs review)`).
- **Weekly (§5, step 6c):** same list, plus surface PRs open all week or blocking a sprint
  commitment under **Known blockers**.
- **On demand:** the same query answers "what are my open PRs?" without generating a full
  briefing.
