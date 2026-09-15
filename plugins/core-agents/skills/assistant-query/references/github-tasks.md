# Query GitHub personal tasks

Use only for the selected GitHub personal backend. Read
[GitHub configuration (§3.6.0)](../../assistant-capture/references/github-configuration.md).
The command fallback is `node <skill-dir>/scripts/github-query.mjs <lane>`;
`<skill-dir>` is the `assistant-query` skill directory, not `references/`.

## Contents

- [Request to lane mapping](#26-list-tasks--github-backend-when-taskbackend--github)
- [Query command](#8b-personal-board--github-when-taskbackend--github)
- [Lane authority](#authoritative-lane-source-the-lane-projects-v2-field)
- [Default exclusions](#default-exclusion-rule)
- [Due date windows](#due-date-windows)
- [Completions](#done--last-24h--recent-completions)
- [Daily briefing integration](#daily-briefing-integration-github-mode)
- [Briefing lane map](#personal-board-lane--query-map-github-used-by-4a)
- [Weekly briefing integration](#weekly-briefing-integration-github-mode)

For session-start retries, read [pending inbox sync](github-inbox-sync.md) only
when pending captures need reconciliation.

## 2.6 List Tasks — GitHub Backend (when `taskBackend = "github"`)

When the [selected assistant config](../../assistant-capture/references/configuration.md) has `taskBackend: "github"`, **§2 List
Tasks is overridden by this section** (see [§2 markdown](markdown-tasks.md) and [§2.5 ADO](ado-tasks.md)). All task listings come
from the GitHub Issues + Projects v2 board configured under `config.github` instead of
`tasks.md` or ADO.

Read config first (see [GitHub configuration (§3.6.0)](../../assistant-capture/references/github-configuration.md)). The lanes are run with the
**`github-query`** command (see §8b for the full lane catalog) — identical lane names to
[§2.5's ADO mapping](ado-tasks.md), just a different command:

| User asks for | Run |
|---|---|
| All active tasks / "show my tasks" | `github-query all-open` |
| Top / highest-priority N items | `github-query all-open --output json`, then use [Rank a Short Top-N List](ranked-tasks.md) (identical procedure — swap `ado-query` for `github-query` and `details --id <ID>` takes an issue number) |
| "What am I working on" / "my active" | `github-query active` |
| Filter by P1 | `github-query priority --priority 1` |
| Overdue / due today / due this week | `github-query due --window overdue` / `due --window today` / `due --window week` |
| Blocked items / "what's blocked" | `github-query blocked` |
| Needs my attention / "needs me" | `github-query needs-me` |
| Up Next queue / "my queue" / "what's next" | `github-query up-next` |
| Backlog / "what could I pick up" | `github-query backlog` |
| Recently completed / "what did I just finish" | `github-query done-recent` |
| Done in the last day | `github-query done-24h` |
| Archive contents (explicit ask only) | `github-query archive` |
| Stale (untouched 7 days) | `github-query stale` |

> **Default exclusion:** unless the user explicitly asks for archive contents, **never include `Lane = Archive`** (or a `Lane = Done` item closed more than the relevant window ago) in any listing. Archive is opt-in only — same rule as [§2.5/§8a](ado-tasks.md).

Keep the same presentation format as [§2](markdown-tasks.md#present-task-lists), but render IDs as issue links: `**[#<number>](https://github.com/<config.github.owner>/<config.github.repo>/issues/<number>)** — Title`.

---

## 8b. Personal Board — GitHub (when `taskBackend = "github"`)

Mirror of [§8a](ado-tasks.md) but pointed at a GitHub Issues + Projects v2 board (`config.github` block
from the selected assistant config; see [GitHub configuration (§3.6.0)](../../assistant-capture/references/github-configuration.md)). When
`taskBackend != "github"`, **skip this entire section** — follow the root's selected backend route instead. Every lane
below runs through **`github-query`**, the GraphQL twin of `ado-query`: a config-driven
Projects v2 query builder + `gh api graphql` runner that exhausts cursor pagination and
parses every typed field value (text/number/date/single-select/iteration) safely, so a
misconfigured or renamed project field degrades to an empty value for that field
instead of crashing the lane.

- **Install:** automatic, same `sessionStart` hook as `ado-query`; the hook links
  `github-query` onto `PATH`. Use the Node fallback above if the bare command is absent.
- **Catalog:** `github-query --list` prints every lane with its description.
- **See the query:** append `--print-query` (alias `--dry-run`) to any lane to print the
  exact GraphQL query **without running it**.
- **Options:** `--priority N`, `--changed-since-days N` (done-recent window),
  `--window all|overdue|today|week` (due lane), `--output table|json`.

**Lane names are identical to the ADO personal-board lanes in [§8a](ado-tasks.md)** (`all-open`,
`active`, `needs-me`, `up-next`, `blocked`, `backlog`, `done-24h`, `done-recent`,
`stale`, `due`, `priority`, `archive`) — this is what lets [§4a](personal-board-layout.md)/[§5](weekly-briefing.md)'s briefing layout stay
backend-agnostic; only the command name changes (`ado-query <lane>` ↔
`github-query <lane>`).

### Authoritative lane source: the `Lane` Projects v2 field

**Column-classifying queries below use the `Lane` single-select field — not labels.**
This is the field that drives the Projects v2 board view, mirroring [§8a](ado-tasks.md)'s rule that
`System.BoardColumn` (not tags) is authoritative for ADO. `Lane = Done` / `Lane = Archive`
correspond to a **closed** issue; every other lane value corresponds to an **open** issue
— see [capture §3.6.5](../../assistant-capture/references/github-tasks.md#365-board-flow--lane-management) for the full mapping.

### Default exclusion rule

Same as [§8a](ado-tasks.md): **every lane in this section excludes closed issues with `Lane = Archive`**
(and `Lane = Done` items older than the relevant window) unless the user explicitly asks
for archive contents. The only lane that returns `Lane = Archive` items is `archive`
itself, on explicit request.

### All Open Personal Items

```bash
github-query all-open
```

### My Open by Priority (P1 / P2 / P3)

```bash
github-query priority --priority 1   # --priority 2 / 3 for P2 / P3
```

### Due Date Windows

```bash
github-query due --window overdue   # past due, still open
github-query due --window today     # due today
github-query due --window week      # due in the next 7 days
github-query due --window all       # any open item carrying a due date (default)
```

### Blocked / Needs Me / Up Next / Active / Backlog

Same WIP semantics as [§8a](ado-tasks.md) (Blocked/Active target 3, Needs Me/Up Next target 5, Backlog
uncapped):

```bash
github-query blocked
github-query needs-me
github-query up-next
github-query active
github-query backlog
```

### Done — last 24h / recent completions

```bash
github-query done-24h                               # last 24h — daily momentum recap
github-query done-recent                             # default: last 14 days
github-query done-recent --changed-since-days 7       # weekly briefing window
```

### Archive Items

```bash
github-query archive
```

### Stale Items (untouched 7 days)

```bash
github-query stale
```

### Work Item Details

```bash
github-query details --id <issue-number>
```

### Daily Briefing Integration (GitHub mode)

When `taskBackend = "github"`, the [Daily Briefing (§4)](daily-briefing.md) "Tasks" section is sourced from
`github-query` lanes instead of `tasks.md`, using the exact same step numbering and [§4a
layout](personal-board-layout.md) as ADO mode — only the underlying command differs (see [§4 step 6b](daily-briefing.md) and [§4a](personal-board-layout.md)).

Include step **2b. Pending inbox** when captures remain pending after
[GitHub inbox reconciliation](github-inbox-sync.md); show a warning, not a
successful-sync claim.

### Personal Board Lane → Query Map (GitHub; used by §4a)

| Briefing lane | `github-query` lane | Render rule |
|---|---|---|
| 🟠 Needs Me | `needs-me` (`Lane = 'Needs Me'`) | Hide if 0; WIP target 5 |
| 🔥 Active | `active` (`Lane = 'Active'`) | Hide if 0; WIP target 3 |
| ⏭️ Up Next | `up-next` (`Lane = 'Up Next'`) | Hide if 0; show all; WIP target 5 |
| ⏸️ Blocked | `blocked` (`Lane = 'Blocked'`) | Hide if 0; WIP target 3 |
| 🆕 Backlog | `backlog` (`Lane = 'Backlog'`) | Always render count; expand top 5 only when Active+UpNext ≤ 6 |
| ✅ Done last 24h | `done-24h` | Hide if 0. Weekly briefing uses `done-recent --changed-since-days 7` + throughput stat |

**Never** render `Lane = Archive` (closed) in the briefing under any lane. Archive is
opt-in only — identical rule to [§8a](ado-tasks.md)'s ADO `State = 'Closed'` exclusion.

### Weekly Briefing Integration (GitHub mode)

Identical to [§8a's "Weekly Briefing Integration (ADO mode)"](ado-tasks.md#weekly-briefing-integration-ado-mode): step 6b uses
`github-query done-recent --changed-since-days 7` instead of `done-24h`, plus the same
`📈 Done last 7d: {N} — avg {N/7:.1f} per day` throughput line.

---
