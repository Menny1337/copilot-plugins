## 4. Reminder Management

### Reminder File Format

Reminders live in `~/.copilot/assistant/reminders.md`, **maintained automatically by the
`assistant-store` gateway — never hand-edit this file.** Format, for reference:

```markdown
# Reminders

| Due | Reminder | Context | Status |
|-----|----------|---------|--------|
| 2026-04-16 | Follow up with the user on the example migration | @work +ExampleProject | pending |
| 2026-04-18 | Check if example PR #1001 was merged | @work +ExampleProject | pending |
| every Monday | Weekly team review prep | @work | recurring |
```

### Set a Reminder

1. Parse the user's request for:
   - **Reminder text** (required)
   - **Due date** — Parse natural language, or "every {day}" for recurring
   - **Context** — Infer from content
2. Run:
   ```bash
   assistant-store reminder set --text "<text>" --due "<due>" [--context @x]
   ```
   A `--due` value matching `every ...` or `first of month` is classified `recurring`
   automatically; everything else is `pending`.
3. Confirm: "Reminder set for {date}: {text}"

### Dismiss a Reminder

1. Run `assistant-store reminder dismiss --match "<keyword>"` — it finds the matching
   row (fuzzy match on reminder text) and sets its status to `dismissed`.
2. If `error.code` is `AMBIGUOUS_MATCH` or `NOT_FOUND`, resolve with the user before
   retrying with a more specific `--match`.
3. Confirm: "Dismissed: {text}"

### Recurring Reminders

For recurring reminders, use natural language in the Due column:
- `every Monday`
- `every weekday`
- `first of month`
- `every 2 weeks`

The agent scans these on session start and surfaces them when the pattern matches today's date.

---
