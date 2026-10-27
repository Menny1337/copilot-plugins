# Query ADO personal tasks

Use only for the selected ADO personal backend. Read
[ADO configuration (§3.5.0)](../../assistant-capture/references/ado-configuration.md)
and the [ADO query command (§8)](ado-queries.md) before running lanes.

## Contents

- [Request to lane mapping](#25-list-tasks--ado-backend-when-taskbackend--ado)
- [Personal board and default exclusions](#8a-personal-board-when-taskbackend--ado)
- [Open items](#all-open-personal-items)
- [Due date windows](#due-date-windows)
- [Needs Me](#needs-me-items-your-attention-queue)
- [Recent completions](#done-recent-completions)
- [Daily briefing integration](#daily-briefing-integration-ado-mode)
- [Briefing lane maps](#personal-board-lane--query-map-used-by-step-6b-and-4a)
- [Weekly briefing integration](#weekly-briefing-integration-ado-mode)

For session-start retries, read [pending inbox sync](ado-inbox-sync.md) only when
pending captures need reconciliation.

## 2.5 List Tasks — ADO Backend (when `taskBackend = "ado"`)

When the [selected assistant config](../../assistant-capture/references/configuration.md) has `taskBackend: "ado"`, **[§2 List Tasks](markdown-tasks.md) is overridden by this section**. All task listings come from Azure DevOps via WIQL queries against `<config.org>/<config.project>` instead of `tasks.md`.

Read config first (see [capture configuration (§3.5.0)](../../assistant-capture/references/ado-configuration.md)). Use `<config.org>`, `<config.project>`, `<config.assignedTo>`, `<config.fieldMap>`. The lanes are run with the `ado-query` command (see [§8 "Running these queries"](ado-queries.md#running-these-queries-the-ado-query-command) and §8a below for the full lane catalog); this section only describes WHEN to use them.

### Mapping table

| User asks for | Run |
|---|---|
| All active tasks / "show my tasks" | `ado-query all-open` |
| Top / highest-priority N items | `ado-query all-open --output json`, then use [ranked task answers](ranked-tasks.md) |
| "What am I working on" / "my active" / true in-flight | `ado-query active` |
| Filter by P1 | `ado-query by-priority --priority 1` |
| Overdue / due today / due this week | `ado-query overdue` / `due-today` / `due-week` |
| By tag (`@work`, `+ExampleProject`) | `ado-query by-tag --tag '+ExampleProject'` |
| Blocked items / "what's blocked" | `ado-query blocked` |
| Needs my attention / "needs me" | `ado-query needs-me` |
| Up Next queue / "my queue" / "what's next" | `ado-query up-next` |
| Backlog / "what could I pick up" | `ado-query backlog` |
| Recently completed / "what did I just finish" | `ado-query done-recent` |
| Done in the last day | `ado-query done-24h` |
| Archive contents (explicit ask only) | `ado-query archive` |
| Stale (untouched 7 days) | `ado-query stale` |
| Recent activity | `ado-query recently-changed` |

Keep the same presentation format as [§2 "Present Task Lists"](markdown-tasks.md#present-task-lists) (group by Priority, mark OVERDUE inline, etc.) but render IDs as clickable links: `**[#<ID>](<config.org>/<config.project>/_workitems/edit/<ID>)** — Title`.

---

## 8a. Personal Board (when `taskBackend = "ado"`)

Mirror of [§8](ado-queries.md) but pointed at the personal board (`config.ado` → `<config.org>/<config.project>` from the selected assistant config). When `taskBackend != "ado"`, **skip this entire section**. Every lane below runs through `ado-query` (see [§8 "Running these queries"](ado-queries.md#running-these-queries-the-ado-query-command)), which reads the `ado` block from config — no `--org` / `--project` needed.

### Authoritative column source: `System.BoardColumn`

**Column-classifying queries below use `[System.BoardColumn]` — not tags.** This is the field ADO uses to render kanban columns, so querying it guarantees the briefing matches exactly what the user sees on the board UI.

Historical context: an earlier iteration queried `Tags CONTAINS 'up-next'` (etc.) per the [capture skill §3.5.5](../../assistant-capture/references/ado-tasks.md#355-board-flow--lane-management) tag convention. Reality: ADO column rules are driven by `System.BoardColumn`, not tags. When the user drags a card in the UI, `System.BoardColumn` updates but tags do not. When the agent updates tags, the card does not visually move. Querying `System.BoardColumn` is the only way to read the truth of the board.

Capture-side (tag-setting) behavior may diverge from read-side until the capture skill is fixed to also set `System.BoardColumn`. Read-side is authoritative.

### Default exclusion rule

**Every lane in this section excludes `State = 'Closed'`** unless the user explicitly asks for archive contents. Archive (Closed) is opt-in only — it must never leak into briefings, "show my tasks" answers, or "what's on my plate" responses. The only lane that returns Closed items is `archive`, and only when the user asks for it directly.

If you add a new lane to [`../scripts/ado-query.mjs`](../scripts/ado-query.mjs), bake in `[System.State] <> 'Closed'` (or the broader `[System.State] NOT IN ('Resolved', 'Closed')` when appropriate).

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
ado-query by-tag --tag '+ExampleProject'
```

Note: WIQL `CONTAINS` on Tags works as a substring match against the semicolon-joined tag string.

### Blocked Items

Items in the Blocked column. WIP target = 3 — if > 3, surface as an overflow warning per [§4a](personal-board-layout.md).

```bash
ado-query blocked
```

### Needs Me Items (your attention queue)

Items the agent (or external events) have surfaced for your decision/judgment. These are NOT blocked — they're "your turn". WIP target = 5 — if > 5, surface as an overflow warning per [§4a](personal-board-layout.md).

```bash
ado-query needs-me
```

**Daily Briefing should ALWAYS surface this count prominently** — if Needs Me has items, those are the user's first action of the day. Render at the top of the briefing as `🟠 Needs Me: N items` (orange, because urgency without crisis).

### Up Next Items (queued short-list)

Items in the Up Next column on the board. WIP target = 5 — if > 5, surface as an overflow warning per [§4a](personal-board-layout.md).

```bash
ado-query up-next
```

### True Active Items (in-flight)

Items in the Active column on the board (you're actively driving toward Done). WIP target = 3 — if > 3, surface as overflow warning per [§4a](personal-board-layout.md).

```bash
ado-query active
```

### Backlog (System.BoardColumn = 'New')

Items in the New column (have not been promoted to Up Next yet). Surface a count always; expand only when the pipeline is running low (see [§4a Backlog expansion rule](personal-board-layout.md#backlog-expansion-rule)).

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

### Daily Briefing Integration (ADO mode)

When `taskBackend = "ado"`, the [Daily Briefing (§4)](daily-briefing.md) "Tasks" section is sourced from `ado-query` lanes instead of `tasks.md`. Mapping:

| §4 step | When `taskBackend = "ado"`, source it from |
|---|---|
| 2. Overdue tasks | `ado-query overdue` |
| 3. Due today | `ado-query due-today` |
| 4. Due this week | `ado-query due-week` |
| 6. Team-board ADO items | `ado-query team-started` / `team-committed` / `team-proposed` — rendered per [§4b Team Board Section Layout](team-board-layout.md) |
| 6b. Personal board — column-oriented layout | See [§4a Personal Board Section Layout](personal-board-layout.md); sourced from the lane→query map below |

Add a new step **2b. Pending Inbox** if the count from [Pending Inbox Sync](ado-inbox-sync.md) is > 0 — show as a warning, e.g. `⚠️ N inbox items not yet synced to ADO`.

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

The [Weekly Briefing (§5)](weekly-briefing.md) step 6b uses the same six-lane layout as the daily, with two differences:

1. **Done lane window:** `ado-query done-recent --changed-since-days 7` (7-day window) instead of `done-24h`.
2. **Throughput line:** under the Done lane, append `📈 Done last 7d: {N} — avg {N/7:.1f} per day`. This gives the user a velocity signal week-over-week.

WIP targets, overflow warnings, hide-empty rule, and the Closed-exclusion rule are unchanged from the daily briefing.

---
