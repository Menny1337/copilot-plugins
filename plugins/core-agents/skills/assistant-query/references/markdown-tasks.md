## 2. List Tasks

Resolve dates using the [daily briefing's timezone rules](daily-briefing.md#file-path),
including for on-demand queries. The examples below assume that timezone is scoped
to the date commands; do not force UTC.

### All Active Tasks

Read and display `~/.copilot/assistant/tasks.md`, showing the `## Active` section.

### Filter by Priority

```bash
grep -E "^\- \[ \] \*\*\(P1\)\*\*" ~/.copilot/assistant/tasks.md
```

### Filter by Due Date

Find overdue tasks (due before today):

```bash
today=$(date +%Y-%m-%d)
# Parse tasks.md for items with "due YYYY-MM-DD" where date < today
grep -E "^\- \[ \].*due [0-9]{4}-[0-9]{2}-[0-9]{2}" ~/.copilot/assistant/tasks.md | while read line; do
    due=$(echo "$line" | grep -oE "due [0-9]{4}-[0-9]{2}-[0-9]{2}" | cut -d' ' -f2)
    if [[ "$due" < "$today" ]]; then
        echo "⚠️  OVERDUE: $line"
    fi
done
```

Find tasks due today:

```bash
today=$(date +%Y-%m-%d)
grep "due $today" ~/.copilot/assistant/tasks.md
```

### Filter by Context or Project

```bash
grep "@work" ~/.copilot/assistant/tasks.md | grep "^\- \[ \]"
grep "+ExampleProject" ~/.copilot/assistant/tasks.md | grep "^\- \[ \]"
```

### Present Task Lists

Format task listings clearly:

```
📋 Active Tasks (3):

P1:
  ⚠️  Fix auth redirect — due 2026-04-14 (OVERDUE) @work +ExampleProject

P2:
  Review example PR #1001 — due 2026-04-15 @work +ExampleProject

P3:
  Schedule dentist appointment — @personal
```

---
