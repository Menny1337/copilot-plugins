# Render the personal board in a briefing

Read for a generated/refreshed daily or weekly briefing with a remote personal
backend. Use only the selected backend's query reference. The comparisons to
the other backend below do not require querying or loading that backend.

## 4a. Personal Board Section Layout (when `taskBackend = "ado"` or `"github"`)

Applies to [daily step 6b](daily-briefing.md) and [weekly step 6b](weekly-briefing.md). The personal-board portion of the daily briefing is rendered as **column-oriented lanes in this exact order**, mirroring the kanban columns. Each lane sources from the matching lane of whichever query command [§8a ADO](ado-tasks.md) / [§8b GitHub](github-tasks.md) resolves for the active `taskBackend` — `ado-query` for `"ado"`, `github-query` for `"github"`. Lane names are identical across both commands, so only the "Source query" column's command name changes per backend (`ado-query <lane>` ↔ `github-query <lane>`); the layout, headings, and hide-empty rules below never change per backend.

| Order | Lane | Heading | Source query (`<query-cmd>` = `ado-query` or `github-query`) | Render rule |
|---|---|---|---|---|
| 1 | Needs Me | `### 🟠 Needs Me` | `<query-cmd> needs-me` | **Hide if 0** |
| 2 | Active | `### 🔥 Active` | `<query-cmd> active` | **Hide if 0** |
| 3 | Up Next | `### ⏭️ Up Next` | `<query-cmd> up-next` | **Hide if 0**; show **all** items (no cap) |
| 4 | Blocked | `### ⏸️ Blocked` | `<query-cmd> blocked` | **Hide if 0** |
| 5 | Backlog | `### 🆕 Backlog` | `<query-cmd> backlog` | **Always render** the count line (even when 0 — that's its own signal); top-5 expansion conditional (see below) |
| 6 | Done last 24h | `### ✅ Done in the last 24h` | `<query-cmd> done-24h` | **Hide if 0** |

**Never include** in any lane: ADO `State = 'Closed'` (Archive) / GitHub `Lane = Archive`, or ADO `State = 'Resolved'` / GitHub `Lane = Done` older than 24h. Archive is opt-in only.

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

For the Needs Me lane, append the most recent comment snippet if available (the agent's "surfacing for review" note from [capture §3.5.7](../../assistant-capture/references/ado-tasks.md#357-when-the-agent-should-auto-move-cards-to-needs-me), or [§3.6.7](../../assistant-capture/references/github-tasks.md#367-when-the-agent-should-auto-move-cards-to-needs-me) in GitHub mode) — helps the user remember why it's in the queue.

> **GitHub mode (`taskBackend = "github"`):** link to the issue instead of an ADO work-item URL — `**[#<number>](<config.github.boardUrl-derived issue URL, e.g. https://github.com/<owner>/<repo>/issues/<number>>)**` — and skip the batched parent-id lookup above entirely: `github-query` already returns a resolved `workstream` string per item (the `Workstream` Projects v2 field, [capture §3.6.1](../../assistant-capture/references/github-tasks.md#361-field-mapping-locked-taxonomy)), so render `· workstream: <item.workstream>` directly when non-empty, with no separate query.

---
