# Daily briefing lifecycle

Use through the [query root's preflight and procedure](../SKILL.md#procedure).
Only load its conditional briefing sources when generation or refresh is needed.
If personal-backend validation fails, mark task sections `_Task data unavailable_`
and continue independent sections, including a separately valid team board.
Read `tasks.md` only for a validated Markdown selection. In remote task mode, replace all
`tasks.md` sources below with the selected backend's due/open/completed lanes:
[ADO task queries](ado-tasks.md) or [GitHub task queries](github-tasks.md).

## 4. Daily Briefing (Persistent Markdown File)

Daily briefings are **persisted to disk** at `~/.copilot/assistant/briefings/daily/YYYY-MM-DD-daily.md` so the user can re-read, edit, and track them as history.

### Triggers

- Greetings: "good morning", "morning", "boker tov", "בוקר טוב"
- Explicit: "daily brief", "today's briefing", "what's on my plate?", "daily summary"
- **Auto-trigger:** First conversation of any calendar day where today's file does not yet exist (the agent's session-start workflow handles this — see [assistant.agent.md § Morning Briefing](../../../agents/assistant.agent.md#morning-briefing))

### File Path

The date examples below assume the process timezone matches the user's known
timezone. If it differs, scope `TZ` to those date commands; do not change host or
user settings. With no known preference, keep runtime local time and label it.

```bash
today=$(date +%Y-%m-%d)        # use local time, not UTC, for "today" semantics
file=~/.copilot/assistant/briefings/daily/${today}-daily.md
```

> Use the user's established timezone from existing profile or calendar settings. If none is known, use the runtime's local timezone and state it. Derive the filename date and calendar window in that same timezone; UTC can select a different date near midnight.

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
2. **Overdue tasks** — Tasks from the validated personal backend with due dates before today (`tasks.md` only in Markdown mode)
2b. **Pending inbox** — For remote backends, show a warning if captures remain pending after session-start reconciliation. Do not hide a failed sync behind the saved briefing.
3. **Due today** — Tasks due today
4. **Due this week** — Tasks due within next 7 days, excluding today
5. **Due reminders** — Date-based reminders matching today + recurring patterns matching today (see [§3](reminders.md))
6. **Team-board ADO items (only when a `teamBoard` is configured).** When the [selected assistant config](../../assistant-capture/references/configuration.md) has a `teamBoard` block, run the configured team sprint lanes and embed results using the [§4b Team Board Section Layout](team-board-layout.md) (three lanes: Started → Committed → Proposed; hide-empty rule). Sourced from `ado-query team-started` / `team-committed` / `team-proposed`. **Omit this section entirely when no `teamBoard` block is configured** (see [§8](ado-queries.md)) — unlike the personal board (6b), the team board is optional. When `teamBoard` is configured but `az` is not, write `_ADO not configured — run \`az login\`_` rather than silently skipping.
6b. **Personal board (when `taskBackend = "ado"` or `taskBackend = "github"`) — MANDATORY column-oriented layout.** Render the personal board as a separate section using the [§4a Personal Board Section Layout](personal-board-layout.md). Sourced from `ado-query` ([§8a](ado-tasks.md), `System.BoardColumn` — authoritative) when `taskBackend = "ado"`, or `github-query` ([§8b](github-tasks.md), the `Lane` Projects v2 field — authoritative) when `taskBackend = "github"` — same lane names either way (`needs-me`, `active`, `up-next`, `blocked`, `backlog`, `done-24h`), so [§4a](personal-board-layout.md)'s layout table does not change per backend, only which command runs it. Archived/closed items are **never** included (ADO: `State = 'Closed'`, or `State = 'Resolved'` older than 24h; GitHub: `Lane = Archive`, or `Lane = Done` with the issue closed more than 24h ago). When `taskBackend` is neither `"ado"` nor `"github"`, skip this step.
7. **Calendar — MANDATORY.** Always pull today's events via `calendar-ListCalendarView` using the timezone and local date resolved above. Render as a small table with `Time (<timezone>) | Subject | Notes`. Flag conflicts (overlapping busy meetings) and OOO attendees. Bold any meeting the user organized. If the calendar tool is unavailable, write `_Calendar tool unavailable_` rather than skipping.
7b. **[Active pull requests (§9)](pull-requests.md).** List the user's open PRs across the configured orgs and render the **🔀 Active Pull Requests** section here — after the ADO work-item sections, before Recent Notes. **Hide the section if the user has zero open PRs.** Add the open-PR count to the chat summary. This is a standing section: the user should not have to ask for it each day.
8. **Recent notes** — Notes created in the last 2 days (use filename date prefix)
9. **Open action items** — Scan meeting notes from the last 7 days for unchecked `- [ ]` items
10. **Focus for today** — Top 1–3 from Overdue + Due Today + P1 items from the selected task backend + the highest-priority calendar meeting

### Writing the File

Use the template as a starting point. Replace each `{...}` placeholder. For "none" sections, write `_None_` (italic) — do not delete the heading. This keeps file structure stable across days for diff-friendly history.

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

📌 Focus: Fix auth redirect → Review example PR #1001 → Send weekly report
```

Do not dump the full markdown into chat — point at the file.

---
