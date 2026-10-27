# Render the configured team board

Read only when `teamBoard` is configured and team sprint queries are being used.

## 4b. Team Board Section Layout (when team-board sprint queries are run)

Applies to [daily step 6](daily-briefing.md). The team-board section uses the same column-oriented model as the personal board, but mapped to the configured team's **sprint states** (which are the columns on the sprint task board). Each lane sources from the [ADO query command](ado-queries.md) lane in the Source column.

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

Same hide-empty rule as [§4a](personal-board-layout.md) (lane omitted entirely when 0 items). No WIP targets defined for the team board — sprint capacity is managed at the iteration level, not per-lane.

### Item rendering format

```
- **[#<ID>](<config.teamBoard.org>/<config.teamBoard.project>/_workitems/edit/<ID>)** P{n} · Title  {— state-change context if any}
```

Cluster related items (e.g., test automation, notifications) with a single label line above them when there are ≥ 3 items in a cluster, to reduce visual noise:

```
**Example test automation cluster:** [#1001](...) Started · [#1002](...) · [#1003](...) · [#1004](...)
```

---
