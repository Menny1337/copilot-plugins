# ADO query command and team work items

Read for ADO personal queries, explicit ADO lookups, or a configured team board.
`<skill-dir>` below means the `assistant-query` directory, not `references/`.
For generic lanes targeting the team board, pass `--board team`; do not read the
ADO personal board when another personal backend is configured.

## Contents

- [Scope](#8-azure-devops-work-items)
- [Run the command](#running-these-queries-the-ado-query-command)
- [Search strategy](#search-strategy-large-projects)
- [Open and sprint items](#my-open-work-items)
- [Started team lane](#team-sprint--started-column-oriented-daily-briefing)
- [Committed team lane](#team-sprint--committed)
- [Proposed team lane](#team-sprint--proposed)
- [Details and recent changes](#work-item-details)
- [Presentation](#present-ado-results)
- [Daily briefing integration](#integration-with-daily-briefing)

## 8. Azure DevOps Work Items

Query and display ADO work items assigned to the user. This section (and [§8a](ado-tasks.md)) applies
to the **team board always**, and to the **personal board only when
`taskBackend = "ado"`** — when `taskBackend = "github"`, the personal board is [§8b](github-tasks.md)
instead (same lane names, `github-query` command).

### Running these queries: the `ado-query` command

The queries in §8 and [§8a](ado-tasks.md) are **named lanes** of the bundled `ado-query` helper — a
thin WIQL builder that reads the [selected assistant config](../../assistant-capture/references/configuration.md) and runs `az boards
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
For full `az boards` reference, invoke the `az` skill (provided by the `core-skills` plugin).

### Search Strategy (Large Projects)

> **Important:** On large ADO projects, query scoping matters. Follow this order:

1. **Direct ID lookup** — Always preferred when the ID is known (`az boards work-item show --id <ID>`)
2. **Scope to `@Me`** — Fast and reliable for items assigned to the user
3. **Scope by team area path** — Fallback when searching for team items not assigned to `@Me`. Use: `[System.AreaPath] UNDER '<config.teamBoard.project>\\<config.teamBoard.areaPath>'`
4. **Never** use broad `CONTAINS` searches scoped only to iteration — they time out consistently on large projects

> **`teamBoard.areaPath` is the area-path subtree — not `teamBoard.team`.** `teamBoard.team` (the team *name*) is what `@CurrentIteration('[<teamBoard.project>]\<teamBoard.team>')` needs in §8; `teamBoard.areaPath` is what `[System.AreaPath] UNDER` needs. See [capture configuration (§3.5.0)](../../assistant-capture/references/ado-configuration.md) for the `teamBoard` block. They differ when the team's area node is nested under the project.

See [devops-boards.md §10](../../../../core-skills/skills/az/references/devops-boards.md) for full details and query examples.

### My Open Work Items

```bash
ado-query my-open
```

### My Current Sprint Items

```bash
ado-query my-sprint
```

> **The three "Team Sprint" queries below target the team board** — the separate `teamBoard` block in the selected assistant config (`<config.teamBoard.org>` / `<config.teamBoard.project>` / `<config.teamBoard.team>` / `<config.teamBoard.areaPath>`), which is distinct from the default/personal board (`<config.org>` / `<config.project>`) that [§8a](ado-tasks.md) queries. See [capture configuration (§3.5.0)](../../assistant-capture/references/ado-configuration.md) for both blocks. If no `teamBoard` block is configured, skip the team-board section of the briefing.

### Team Sprint — Started (column-oriented daily briefing)

Items I'm currently working on in this sprint. Source for the **🚀 Started** lane in [§4b](team-board-layout.md).

```bash
ado-query team-started
```

> Note: `State = 'Active'` is rarely used on this team. If any Active items appear, render them inside the Started lane with an `_(Active — rare)_` annotation per [§4b](team-board-layout.md).
>
> **`@CurrentIteration` requires a team context**, which the lane derives from `config.teamBoard.team`. If it fails (e.g. the team name is wrong or the sprint isn't current), run `ado-query team-started --print-wiql`, then re-run the printed `az` command with an explicit iteration path swapped in: `[System.IterationPath] UNDER '<config.teamBoard.project>\\<sprint-id>'` (e.g. `'OS\\2605'`) — less portable across sprints but always works.

### Team Sprint — Committed

Items committed for this sprint; must ship before sprint ends. Source for the **🎯 Committed** lane in [§4b](team-board-layout.md).

```bash
ado-query team-committed
```

### Team Sprint — Proposed

Sprint backlog; "Up Next" equivalent on the team board. Pull from here when Committed/Started work resolves. Source for the **⏭️ Proposed** lane in [§4b](team-board-layout.md).

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

When generating a [daily briefing (§4)](daily-briefing.md), include ADO items after local tasks:

1. Run `ado-query my-sprint` (the "My Current Sprint Items" lane)
2. Highlight P1/P2 items and any newly assigned items
3. Show count: "You have N ADO work items in the current sprint (X active, Y new)"

For a configured team board, the daily briefing's step 6 uses the three team
lanes and [§4b layout](team-board-layout.md) instead of a generic personal sprint
query. The selected personal backend still owns all personal task sections.

---
