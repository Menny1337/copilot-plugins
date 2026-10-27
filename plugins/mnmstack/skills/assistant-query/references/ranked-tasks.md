# Rank a short task answer

Use with the selected remote backend, not as a briefing substitute. For GitHub,
replace `ado-query` with `github-query`, use its normalized priority/lane/due fields,
and pass issue numbers to `details --id`.

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
run their required lane set in [§4 daily](daily-briefing.md) and [§5 weekly](weekly-briefing.md).

> **Default exclusion:** unless the user explicitly asks for archive contents, **never include `State = 'Closed'`** in any listing. Archive is opt-in only.
