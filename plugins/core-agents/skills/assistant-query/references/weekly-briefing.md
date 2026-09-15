# Weekly briefing lifecycle

Use through the [query root's preflight and procedure](../SKILL.md#procedure).
If personal-backend validation fails, mark its sections `_Task data unavailable_`
and continue independent sections, including a separately valid team board.
Load the root's conditional briefing sources only when generating or refreshing.
The selected personal backend owns
the task snapshot, completions, stale items and priorities below; read `tasks.md`
only in markdown mode.

## 5. Weekly Briefing (Persistent Markdown File)

Weekly briefings are **persisted to disk** at `~/.copilot/assistant/briefings/weekly/YYYY-Www-weekly.md`.

### Triggers

- Explicit: "weekly brief", "weekly briefing", "weekly review"
- **Auto-trigger:** First conversation of a new ISO week where this week's file does not yet exist (handled by agent — see [assistant.agent.md § Morning Briefing](../../../agents/assistant.agent.md#morning-briefing))
- **Working-week start rule:** If today starts the user's established working week and no file exists, also generate. Generate the weekly briefing before the daily. If no working-week preference is known, use the ISO week.

### File Path & ISO Week

Use the [daily briefing's timezone resolution](daily-briefing.md#file-path) for
all date commands below, including the ISO week label.

```bash
# ISO week — Monday is day 1, week containing Thursday determines year
iso=$(date +%G-W%V)            # e.g. 2026-W16
file=~/.copilot/assistant/briefings/weekly/${iso}-weekly.md
```

For the headline, calculate the start and end dates from the user's established
working days and label that activity range. Use Monday through Sunday only when
no working-week preference is known. Keep the ISO week label for the filename,
even when the headline's activity range differs. Resolve both in the same
timezone as the daily briefing.

### Decision: Read vs. Generate

Same rules as the [daily briefing (§4 "Decision: Read vs. Generate")](daily-briefing.md#decision-read-vs-generate):

1. If file exists → present summary, offer refresh
2. If not → generate from `~/.copilot/assistant/templates/weekly-briefing.md`, write, present summary
3. Refresh preserves everything below the user-edits divider

### Steps to Compute Sections

1. **Headline** — One-sentence summary derived from P1 tasks + sprint commitments
2. **Open tasks snapshot** — Counts by priority + overdue count
3. **Completed last 7 days** — Use `## Completed` in Markdown mode or the validated remote backend's `done-recent --changed-since-days 7` lane
4. **Decisions made** — Decision records from `notes/decisions/` with date prefix in the last 7 days
5. **Notes created** — Counts by type with file paths
6. **Team-board ADO sprint status (only when a `teamBoard` is configured).** When a `teamBoard` block is present, run the sprint query and embed results. Format every item as a markdown link:
   `**[#<ID>](<config.teamBoard.org>/<config.teamBoard.project>/_workitems/edit/<ID>)** (Type, State) — Title`
   Group by **Active / In-flight** vs **Proposed (pick up this week)**, plus a **Known blockers** subsection (PRs awaiting approval, pending entitlement renewals, incident tickets). **Omit this section entirely when no `teamBoard` block is configured** (see [§8](ado-queries.md)). When `teamBoard` is configured but `az` is unavailable, write `_ADO not configured_`.
6b. **Personal board (when `taskBackend = "ado"` or `"github"`) — MANDATORY column-oriented layout.** Render the personal board using the same six-lane layout as the daily briefing (see [§4a](personal-board-layout.md)), but with a wider time window: Done lane shows **last 7 days** instead of last 24h. Use the selected query command's `done-recent --changed-since-days 7` lane. Add a `📈 Throughput` line under the Done lane: `Done last 7d: {N} — avg {N/7} per day`. Items with ADO `State = 'Closed'` or GitHub `Lane = Archive` are never included. In markdown mode, skip this step.
6c. **[Active pull requests (§9)](pull-requests.md).** Include the user's open PRs across the configured orgs. Under a **Known blockers** note, call out PRs that have been open all week or are blocking a sprint commitment.
7. **Recurring commitments this week** — Recurring reminders that will fire (e.g. "every Monday" → Mon of this week)
8. **Stale items** — Active tasks created >7 days ago with no movement (use `ado-query stale` when `taskBackend = "ado"`, or `github-query stale` when `taskBackend = "github"`)
9. **Top priorities** — Suggested 3–5 from P1/P2 tasks and sprint commitments

### Chat Summary Format

Example with no working-week preference (the ISO-week fallback):

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
