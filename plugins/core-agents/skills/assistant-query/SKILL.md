---
name: assistant-query
description: "Queries saved notes, tasks, reminders, and open pull requests, and creates daily or weekly briefings. Use to find personal context, check what is due, or get a briefing."
argument-hint: "<what to look up, or a date range>"
---

# Query personal data and create briefings

Procedures for reading, searching, filtering, and summarizing personal assistant data from `~/.copilot/assistant/`.

## When to Use

- Searching notes by keyword, date range, or type
- Listing or filtering tasks by status, priority, or due date
- Listing the user's open pull requests, in a briefing or on demand
- Checking for due or overdue reminders
- Generating daily briefings or weekly summaries
- Surfacing related context when the user mentions a topic
- Answering "what did I..." questions about past notes/decisions
- Reconciling pending captures at session start through the selected remote backend

## When to Skip

- Direct requests to create or modify notes, tasks or reminders → use **assistant-capture** instead; session-start inbox retries use its capture procedure through the reconciliation route below
- Searching Teams messages → use **m365-messaging** instead
- General questions unrelated to saved personal data or the user's work queues do not need this skill.

## Execution rules

- Before any personal-board task query, including context searches, stale scans and briefing task sections, resolve and read the selected [assistant config](../assistant-capture/references/configuration.md). Select exactly one personal backend: `markdown`, `ado`, or `github`. Use `markdown` only when explicitly selected or the config file/selector is absent. Use the [task-backend contract](../assistant-capture/references/task-backend-contract.md) for backend changes or contract questions, not routine local queries. Do not query `tasks.md` alongside a configured remote personal board.
- If an explicit personal-backend selector is unrecognized, report it and stop personal task operations, including inbox reconciliation; do not query or write another personal backend. Also stop personal operations on malformed config or a missing/invalid required remote-backend block. In a briefing, mark personal task data unavailable and continue independent sections rather than substituting `tasks.md`. These are skill preflight guards; direct query commands validate their requested board independently.
- Notes and reminders remain local regardless of backend. Any writes to those records, markdown tasks or workspace initialization must go through [assistant-capture's `assistant-store` gateway](../assistant-capture/SKILL.md#running-these-commands-the-assistant-store-gateway), with JSON/error/ambiguity handling; never hand-edit them.
- This skill is not globally read-only: it writes persisted briefing files and reconciles pending inbox captures at session start. Ordinary lookups do not authorize other record changes. For inbox retries, use only the selected backend's capture procedure, preserve `clientCaptureId`, search before creating, and mark synced only after confirming the remote item.
- Keep backend authentication, identity and scope checks on inbox writes. Stop and report permission failures; do not silently re-authenticate, switch accounts or guess success. Preserve failed input and distinguish partial/indeterminate results from success.
- Keep the optional `teamBoard` separate from the personal board. Validate its target independently and continue valid team queries if the personal backend is unavailable. Team queries use ADO regardless of personal backend, and remain read-only. No `teamBoard` block means no team section.
- Archive is opt-in only, never part of default task listings or briefings. Use each backend's authoritative column/lane, not tags or labels; preserve the specified completion windows, hide-empty rules and WIP/backlog rules.
- For existing briefings, read and summarize; do not regenerate without a refresh request or confirmation. During refresh, preserve everything below the user-space divider verbatim.
- Report unavailable sources in the briefing rather than silently omitting them or claiming there are no results. Calendar is mandatory for daily generation; open PRs are a standing daily/weekly section, hidden only when there are zero open PRs.
- Summaries must cite actual saved paths or item links and verified data. Briefing completion requires the persisted file, not just a chat response.

## Procedure

### 1. Read the reference for the requested result

Read only the matching workflow. Notes, reminders and on-demand PR lookups do not
require the task-backend references or a full briefing.

At every session start, validate the personal backend and run its pending-inbox
route below before task or briefing reads, even when today's briefing already
exists. Markdown has no remote inbox reconciliation. A failed personal preflight
blocks reconciliation, not independent notes, reminders, PRs or valid team queries.

| Requested workflow | Read |
| --- | --- |
| Find notes or past decisions | [Search notes](references/notes.md) |
| Check due or recurring reminders | [Reminders](references/reminders.md) |
| Task query with selected `markdown` backend | [Markdown task queries](references/markdown-tasks.md) |
| Task query with selected `ado` backend | [ADO configuration](../assistant-capture/references/ado-configuration.md), [ADO query command](references/ado-queries.md), and [ADO task queries](references/ado-tasks.md) |
| Task query with selected `github` backend | [GitHub configuration](../assistant-capture/references/github-configuration.md) and [GitHub task queries](references/github-tasks.md) |
| Short top-N priority answer with `ado` or `github` | Selected backend above, plus [ranked task answers](references/ranked-tasks.md); do not run a full briefing |
| Short top-N priority answer with `markdown` | [Markdown task queries](references/markdown-tasks.md); rank matching active rows by overdue/requested due window, numeric priority, then due date. Return up to the requested count and disclose fewer matches |
| Explicit ADO work-item or configured team/sprint query | [ADO query command and team lanes](references/ado-queries.md); use `--board team` for generic team queries |
| List the user's open PRs | [Pull requests](references/pull-requests.md) |
| Surface related context or stale items | [Context and stale items](references/context-and-stale.md), [notes](references/notes.md), and only the selected task backend above |
| Read, generate or refresh a daily briefing | [Daily briefing](references/daily-briefing.md), then the conditional sources in step 2 |
| Read, generate or refresh a weekly briefing | [Weekly briefing](references/weekly-briefing.md), then the conditional sources in step 2 |
| Session-start pending inbox reconciliation with `ado` | [ADO inbox sync](references/ado-inbox-sync.md), [ADO capture configuration](../assistant-capture/references/ado-configuration.md) and [ADO capture](../assistant-capture/references/ado-tasks.md) |
| Session-start pending inbox reconciliation with `github` | [GitHub inbox sync](references/github-inbox-sync.md), [GitHub capture configuration](../assistant-capture/references/github-configuration.md) and [GitHub capture](../assistant-capture/references/github-tasks.md) |

References retain original section numbers. A link to another workflow is
conditional, not a requirement to read every referenced file.

### 2. Load briefing sources only when generating or refreshing

Check the weekly file before the daily file at session start or a morning greeting.
Generate the missing weekly briefing first at a new ISO week or the start of the
user's established working week, then the missing daily briefing. Use the user's
known timezone (otherwise runtime local time) for daily dates and ISO week labels.
Use existing profile preferences for working days; otherwise use the ISO week.

If the relevant file exists, follow its read/refresh rules without loading all
live-source references. For generation or confirmed refresh, load:

- [notes](references/notes.md), [reminders](references/reminders.md), [context and stale items](references/context-and-stale.md), and [PRs](references/pull-requests.md)
- exactly the configured task-query route from step 1, replacing all `tasks.md` task sections in remote mode, including due, completed, stale and focus data
- [personal-board layout](references/personal-board-layout.md) for `ado` or `github`; weekly uses `done-recent --changed-since-days 7` and throughput for either backend
- [ADO query command and team lanes](references/ado-queries.md) and [team-board layout](references/team-board-layout.md) only when `teamBoard` is configured

If remote captures remain pending after the session-start attempt, include a
pending-inbox warning in the generated briefing. Reading an existing briefing
does not refresh it; report newly observed pending captures separately.

Pull today's calendar for daily generation using the daily reference's exact
window and rendering rules. Keep PRs after work-item sections and before Recent
Notes, and include the open-PR count in the chat summary.

### 3. Return the result

Use the workflow's presentation rules. For briefings, fill and save the template,
preserve the user-space divider on refresh, and return a concise summary with the
file path. For lookups, return matching items with dates, snippets or links as
specified; do not manufacture a briefing file for an on-demand lookup.
