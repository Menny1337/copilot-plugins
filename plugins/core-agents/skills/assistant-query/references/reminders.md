## 3. Check Reminders

### Due Reminders Scan

Run at session start to find due or overdue reminders:

1. Read `~/.copilot/assistant/reminders.md`
2. Parse each row in the table
3. For date-based reminders: compare due date to today
4. For recurring reminders: check if the pattern matches today
   - `every Monday` → check if today is Monday
   - `every weekday` → check if today is Mon-Fri
   - `first of month` → check if today is the 1st
5. Surface any matching reminders

### Recurring Pattern Matching

Use the [daily briefing's resolved timezone](daily-briefing.md#file-path) for these
date commands, including during an on-demand reminder query.

```bash
today_day=$(date +%A)         # Monday, Tuesday, etc.
today_dom=$(date +%d)          # 01-31
today_dow=$(date +%u)          # 1=Monday, 7=Sunday
```

Match patterns:
- `every Monday` → `$today_day == "Monday"`
- `every weekday` → `$today_dow <= 5`
- `first of month` → `$today_dom == "01"`

### Present Reminders

```
🔔 Reminders:

Due today:
  - Follow up with the user on the example migration (@work)

Recurring (today):
  - Weekly team review prep (every Monday)
```

---
