---
name: oncall-query
description: "Search, filter, aggregate, and report on on-call data. Timeline views, active incidents, shift handoffs, weekly summaries, and metrics. Triggers: query, search, find, show, list, report, handoff, summary, metrics, timeline, what happened, open incidents."
---

# On-Call Query & Reporting

Procedures for searching, filtering, and generating reports from on-call data in `~/.copilot/oncall/`.

## When to Use

- Searching for specific log entries, incidents, or events
- Generating timeline views (shift or incident)
- Listing active/open incidents
- Creating handoff reports for the next on-call
- Generating weekly summaries
- Computing on-call metrics

## When to Skip

- Logging new events or creating entries → use **oncall-logging** instead
- Starting or ending a shift → use **oncall-logging** instead

---

## 1. Search Patterns

All queries use the filesystem + grep. Data lives in `~/.copilot/oncall/`.

### Search by Type

```bash
grep -rl "^type: incident" ~/.copilot/oncall/shifts/*/log/ 2>/dev/null
```

### Search by Severity

```bash
grep -rl "^severity: critical" ~/.copilot/oncall/shifts/*/log/ 2>/dev/null
```

### Search by Tag

```bash
grep -rl "tag-name" ~/.copilot/oncall/shifts/*/log/ 2>/dev/null
```

### Search by Person

```bash
grep -rl "person-name" ~/.copilot/oncall/shifts/*/log/ 2>/dev/null
```

### Search by Date Range

```bash
# All entries for a specific shift date
ls ~/.copilot/oncall/shifts/2026-02-22/log/

# All entries across a date range (use shell globbing)
ls ~/.copilot/oncall/shifts/2026-02-{20..26}/log/ 2>/dev/null
```

### Search by Status

```bash
grep -rl "^status: open" ~/.copilot/oncall/shifts/*/log/ 2>/dev/null
grep -rl "^status: open" ~/.copilot/oncall/incidents/ 2>/dev/null
```

### Search by Incident ID

```bash
grep -rl "INC-2026-0001" ~/.copilot/oncall/shifts/*/log/ 2>/dev/null
```

### Full-Text Search

```bash
grep -rl "search term" ~/.copilot/oncall/shifts/*/log/ ~/.copilot/oncall/incidents/ 2>/dev/null
```

### Combined Queries

Chain grep commands for AND logic:
```bash
grep -rl "^type: incident" ~/.copilot/oncall/shifts/*/log/ 2>/dev/null | xargs grep -l "^severity: critical"
```

---

## 2. Reading & Presenting Results

After finding matching files:

1. **Read each file** using the view tool
2. **Extract frontmatter** for structured display
3. **Present in a table** for quick scanning:

```
| Time (UTC) | Type | Severity | Title | Incident | Status |
|------------|------|----------|-------|----------|--------|
| 10:35 | incident | high | Sentinel ingestion alert | INC-2026-0001 | open |
| 10:42 | action | info | Restarted ingestion service | INC-2026-0001 | ongoing |
| 11:15 | escalation | high | Paged SRE team | INC-2026-0001 | ongoing |
```

4. **Always include file paths** so the user can navigate to the source

---

## 3. Timeline Views

### Shift Timeline

Show all events for a specific shift in chronological order:

1. List all files in `~/.copilot/oncall/shifts/YYYY-MM-DD/log/`
2. Files are already sorted by name (HHMMSS prefix)
3. Read each file's frontmatter
4. Present as a chronological table (see format above)
5. Include shift metadata from `shift.md`

### Incident Timeline

Show all events related to a specific incident:

1. Read the incident file from `~/.copilot/oncall/incidents/INC-YYYY-NNNN.md`
2. The `## Timeline` section has the authoritative timeline
3. Also search shift logs for entries with matching `incident` field
4. Present combined, deduplicated, sorted by timestamp

---

## 4. Active Incidents Summary

List all open/ongoing incidents:

```bash
grep -rl "^status: open\|^status: ongoing" ~/.copilot/oncall/incidents/ 2>/dev/null
```

For each, display:
- Incident ID and title
- Severity
- When opened
- Last activity (most recent timeline entry)
- Owner

Format as a concise table:

```
| ID | Title | Severity | Opened | Last Activity | Owner |
|----|-------|----------|--------|--------------|-------|
| INC-2026-0001 | Sentinel ingestion | high | Feb 22 10:35 | Feb 22 14:20 | on-call-owner |
```

---

## 5. Handoff Report Generation

Generate a report for the next on-call person. Save to `~/.copilot/oncall/reports/handoff-YYYY-MM-DD.md`.

### Procedure

1. Determine the shift date (default: today)
2. Read `shift.md` for shift metadata
3. List all open incidents (see §4)
4. Gather all log entries for the shift
5. Generate the report:

```markdown
---
type: handoff
shift: "YYYY-MM-DD"
generated: "YYYY-MM-DDTHH:MM:SSZ"
from: ""
to: ""
---

# On-Call Handoff — YYYY-MM-DD

## Shift Summary
- **Duration:** HH:MM – HH:MM UTC
- **Services:** (list from shift.md)
- **Total Events:** N (X incidents, Y actions, Z escalations)

## Open Incidents (Requires Attention)

### INC-YYYY-NNNN: Title
- **Severity:** high
- **Status:** open/ongoing
- **Summary:** (brief description)
- **Last Action:** (what was done most recently)
- **Next Steps:** (what needs to happen)

(repeat for each open incident)

## Resolved During Shift

### INC-YYYY-NNNN: Title
- **Resolved at:** HH:MM UTC
- **Summary:** (brief description of what happened and how it was resolved)

## Key Events Timeline
(condensed timeline of significant events — incidents, escalations, critical actions)

## Notes for Next On-Call
(any context, warnings, things to watch out for)
```

   Set `from` to the **outgoing** on-call engineer (you — the current shift owner; read from `~/.copilot/memory/user.md` when available) and `to` to the **incoming** engineer. Leave either `""` only if genuinely unknown.

6. Ask the user if they want to add personal notes before finalizing

---

## 6. Weekly Summary Generation

Generate a weekly summary report. Save to `~/.copilot/oncall/reports/weekly-YYYY-WNN.md`.

### Procedure

1. Determine the week (ISO week number)
2. Find all shift folders in that date range
3. Aggregate across all shifts:
   - Total incidents (by severity)
   - Total escalations
   - Incidents opened vs resolved
   - Mean Time To Resolve (MTTR) for resolved incidents
4. Generate the report:

```markdown
---
type: weekly-summary
week: "YYYY-WNN"
generated: "YYYY-MM-DDTHH:MM:SSZ"
---

# Weekly On-Call Summary — Week NN (Mon DD – Sun DD)

## Key Metrics
- **Total Incidents:** N (critical: X, high: Y, medium: Z, low: W)
- **Resolved:** N | **Still Open:** N
- **Escalations:** N
- **Mean Time to Resolve:** Xh Ym (for incidents resolved this week)
- **Total Log Entries:** N

## Incidents

### New This Week
| ID | Title | Severity | Opened | Status | MTTR |
|----|-------|----------|--------|--------|------|

### Carried Over (Open from Previous Weeks)
| ID | Title | Severity | Opened | Current Status |
|----|-------|----------|--------|---------------|

## Daily Breakdown

### Monday (YYYY-MM-DD)
- N events, N incidents
- Key: (brief summary)

(repeat for each day)

## Observations & Patterns
(any recurring issues, suggestions for improvement)
```

---

## 7. Metrics Computation

### Incident Count

```bash
ls ~/.copilot/oncall/incidents/ 2>/dev/null | wc -l
```

By severity:
```bash
grep -c "^severity: critical" ~/.copilot/oncall/incidents/*.md 2>/dev/null
```

### Mean Time To Resolve (MTTR)

For resolved incidents:
1. Read `opened` and `resolved` timestamps from frontmatter
2. Compute duration for each
3. Average across all resolved incidents in the time range

### Escalation Rate

```bash
# Escalation entries this shift
grep -rl "^type: escalation" ~/.copilot/oncall/shifts/YYYY-MM-DD/log/ 2>/dev/null | wc -l
```

### Active vs Resolved Ratio

```bash
open=$(grep -rl "^status: open" ~/.copilot/oncall/incidents/*.md 2>/dev/null | wc -l)
resolved=$(grep -rl "^status: resolved" ~/.copilot/oncall/incidents/*.md 2>/dev/null | wc -l)
echo "Open: $open, Resolved: $resolved"
```

---

## 8. Query Response Guidelines

When answering user questions about on-call data:

1. **Be precise** — Include exact timestamps, file references, and incident IDs
2. **Use tables** — Present structured data in markdown tables for readability
3. **Link to sources** — Always mention the file path so the user can verify
4. **Default to the current shift** — If no date is specified, assume today's shift
5. **Summarize first, detail on request** — Give the count/overview first, then offer to drill down
6. **Handle empty results** — If no data matches, say so clearly and suggest related searches
