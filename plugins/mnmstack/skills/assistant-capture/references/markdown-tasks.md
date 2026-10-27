## 3. Task Management

### Task File Format

Tasks live in `~/.copilot/assistant/tasks.md`, **maintained automatically by the
`assistant-store` gateway — never hand-edit this file.** Format, for reference:

```markdown
# Tasks

## Active

- [ ] **(P1)** Task title — due YYYY-MM-DD @context +project
- [ ] **(P2)** Task title — @context
- [ ] **(P3)** Task title

## Completed

- [x] **(P2)** Task title — completed 2026-04-15
```

### Add a Task

1. Parse the user's request for:
   - **Title** (required)
   - **Priority** — P1 (urgent), P2 (important), P3 (normal, default)
   - **Due date** — Parse natural language: "by Friday" → next Friday's date, "next week" → next Monday, "tomorrow" → tomorrow's date
   - **Context** — `@work`, `@personal`, `@health` (infer from content)
   - **Project** — `+ProjectName` (infer from content)
   - **Source** — If from a meeting note, add `← notes/meetings/filename.md`
2. Run:
   ```bash
   assistant-store task add --title "<title>" [--priority P1|P2|P3] [--due YYYY-MM-DD] \
     [--context @x] [--project +Y] [--source <path>]
   ```
3. Confirm: "Added P{n} task: {title}"

### Priority Guide

| Priority | Meaning | When to Assign |
|----------|---------|----------------|
| P1 | Urgent — needs immediate attention | User says "urgent", "ASAP", "critical", "blocking" |
| P2 | Important — should do soon | User says "important", "this week", or sets a near due date |
| P3 | Normal — do when possible | Default for everything else |

### Complete a Task

1. Run `assistant-store task complete --match "<keyword>"` — it finds the task in
   `## Active` (fuzzy match on title keywords), checks it off, appends the completion
   date, and moves it to `## Completed`.
2. If `error.code` is `AMBIGUOUS_MATCH` or `NOT_FOUND`, resolve with the user before
   retrying with a more specific `--match`.
3. Confirm: "Completed: {title}"

### Update a Task

1. Run `assistant-store task update --match "<keyword>" [--title S] [--priority Pn]
   [--due D] [--context @x] [--project +Y]` — unspecified fields are left unchanged.
2. Confirm what changed

### Reopen a Task

1. Run `assistant-store task reopen --match "<keyword>"` — it finds the task in
   `## Completed`, unchecks it, drops the completion date, and moves it back to `## Active`.

---
