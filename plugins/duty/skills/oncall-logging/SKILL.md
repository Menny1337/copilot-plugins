---
name: oncall-logging
description: "Structured on-call data entry: workspace initialization, shift lifecycle, log entries (incidents, actions, notes, escalations, comms), entry linking, incident management, and file naming conventions. Triggers: log, incident, shift start, shift end, on-call entry, escalation, action taken."
argument-hint: "<incident, action, note, or escalation to log>"
---

# On-Call Logging

Procedures for writing structured on-call data to the workspace at `~/.copilot/oncall/`.

## When to Use

- Starting or ending an on-call shift
- Logging any on-call event (incident, action, note, escalation, communication)
- Opening, updating, or resolving an incident
- Initializing the workspace for first-time use

## When to Skip

- Querying or searching existing data → use **oncall-query** instead
- Generating reports or summaries → use **oncall-query** instead

## Execution Rules

- For any shift, log-entry, or incident-writing request, perform the filesystem changes during this turn; do not only describe what should be written.
- Prefer shell/file-editing tools to create or update records under `~/.copilot/oncall/`, then reply with a brief confirmation.
- When the user already provided the needed services, team, people, or notes, do not ask follow-up questions before writing the files.

---

## 1. Workspace Initialization

**On first use or if directories are missing**, create the full structure:

```
~/.copilot/oncall/
├── MEMORY.md
├── shifts/
├── incidents/
├── reports/
└── templates/
    ├── log-entry.md
    ├── incident.md
    ├── shift.md
    └── handoff.md
```

Check if workspace exists:
```bash
ls ~/.copilot/oncall/MEMORY.md 2>/dev/null || echo "NEEDS_INIT"
```

If `NEEDS_INIT`, create all directories and template files. Copy templates from `~/.copilot/oncall/templates/`.

---

## 2. Shift Lifecycle

### Start Shift

1. Determine the shift start date (today in UTC: `date -u +%Y-%m-%d`)
2. Create the shift directory: `~/.copilot/oncall/shifts/YYYY-MM-DD/`
3. Create the log subdirectory: `~/.copilot/oncall/shifts/YYYY-MM-DD/log/`
4. Create `~/.copilot/oncall/shifts/YYYY-MM-DD/shift.md` with frontmatter:

```yaml
---
start: 2026-02-22T09:00:00Z
end: null
services: []
team: ""
contacts: []
notes: ""
---

# On-Call Shift — YYYY-MM-DD

## Services Covered
- (list services the user mentions)

## Team & Contacts
- (list people/teams)

## Shift Notes
- (anything relevant for the shift)
```

5. Do **not** place `shift.md` inside `log/`; it belongs directly under the dated shift directory.
6. Ask the user what services/team they're covering if not provided
7. Update `~/.copilot/oncall/MEMORY.md` with current shift reference

### End Shift

1. Update `shift.md`: set `end` timestamp
2. Add shift summary to the shift notes section
3. Prompt: "Want me to generate a handoff report?" → if yes, use **oncall-query** skill

---

## 3. Log Entry Creation

### Naming Convention

```
HHMMSS-<type>-<slug>.md
```

- `HHMMSS` — UTC time of the event (e.g., `103500`)
- `<type>` — one of: `incident`, `action`, `note`, `escalation`, `comms`
- `<slug>` — kebab-case brief description (max 50 chars)

Example: `103500-incident-sentinel-ingestion-alert.md`

### Path

```
~/.copilot/oncall/shifts/YYYY-MM-DD/log/HHMMSS-<type>-<slug>.md
```

Use the current shift date. If no active shift, ask the user to start one first.

### Frontmatter Schema

Every log entry MUST have this YAML frontmatter:

```yaml
---
type: incident | action | note | escalation | comms
severity: critical | high | medium | low | info
timestamp: "YYYY-MM-DDTHH:MM:SSZ"
shift: "YYYY-MM-DD"
incident: "INC-YYYY-NNNN"    # optional — link to incident
tags: [tag1, tag2]
people: [person1, person2]
status: open | resolved | ongoing | info
---
```

**Field rules:**
- `timestamp` — Always UTC. Use `date -u +%Y-%m-%dT%H:%M:%SZ` for current time.
- `severity` — Required for incidents and escalations. Default `info` for notes/comms.
- `incident` — Set when this entry relates to a tracked incident.
- `tags` — Extract from context. Common: `alert`, `prod`, `staging`, `database`, `api`, `deployment`, `rollback`.
- `people` — Anyone mentioned or involved.
- `status` — For incidents: `open`/`resolved`/`ongoing`. For actions: `ongoing`/`resolved`. For notes/comms: `info`.

### Body

```markdown
# Brief descriptive title

## What Happened
(Description of the event)

## Actions Taken
(What was done — for action/escalation types)

## Impact
(Who/what is affected — for incident types)

## Next Steps
(What needs to happen next, if anything)
```

Not all sections are required for every type. Use what's relevant:
- **incident**: What Happened, Impact, Next Steps
- **action**: What Happened, Actions Taken, Next Steps
- **note**: Just the description (free-form under the title)
- **escalation**: What Happened, Actions Taken (who was escalated to and why)
- **comms**: What Happened (the communication sent/received and to/from whom)

---

## 4. Entry Types — Quick Reference

| Type | When to Use | Default Severity | Required Fields |
|------|-------------|-----------------|-----------------|
| `incident` | Something broke or is degraded | `high` | severity, status |
| `action` | You did something (restart, deploy, config change) | `info` | incident (if related) |
| `note` | General observation, context, or reminder | `info` | — |
| `escalation` | Reached out to someone for help | `high` | people, incident |
| `comms` | Sent/received a message (Slack, email, Teams) | `info` | people |

---

## 5. Entry Linking

When an action, escalation, or comm is related to an incident:

1. Set the `incident` field in frontmatter to the incident ID (e.g., `INC-2026-0001`)
2. If the incident file exists in `~/.copilot/oncall/incidents/`, append a timeline entry there too

### Append to Incident Timeline

Add to the `## Timeline` section of the incident file:

```markdown
- **HH:MM UTC** — [type] Brief description (→ `shifts/YYYY-MM-DD/log/filename.md`)
```

---

## 6. Incident Lifecycle

Incidents get their own file in `~/.copilot/oncall/incidents/` for cross-shift tracking.

### Incident ID Format

```
INC-YYYY-NNNN
```

- `YYYY` — Current year
- `NNNN` — Sequential number, zero-padded. Check existing files to determine next number:

```bash
ls ~/.copilot/oncall/incidents/INC-$(date -u +%Y)-*.md 2>/dev/null | sort -r | head -1
```

### Open Incident

1. Determine next incident ID
2. Create `~/.copilot/oncall/incidents/INC-YYYY-NNNN.md`:

```yaml
---
id: "INC-YYYY-NNNN"
title: "Brief incident title"
severity: critical | high | medium | low
status: open
opened: "YYYY-MM-DDTHH:MM:SSZ"
resolved: null
services: [affected-service-1]
tags: [tag1, tag2]
owner: ""
---

# INC-YYYY-NNNN: Brief incident title

## Summary
(What is happening and the impact)

## Timeline
- **HH:MM UTC** — Incident opened. (initial description)

## Root Cause
(Fill in when known)

## Resolution
(Fill in when resolved)

## Postmortem
(Fill in after resolution — what went wrong, what went right, action items)
```

   Set `owner` to the current on-call engineer (the person handling the incident). Pull the name from the user profile at `~/.copilot/memory/user.md` when available; otherwise ask. Leave it `""` only if genuinely unknown.

3. Also create a log entry of type `incident` in the current shift log
4. Cross-link: log entry's `incident` field → incident ID

### Update Incident

1. Add timeline entry to the incident file
2. Create a log entry (action/escalation/comms) linked to the incident

### Resolve Incident

1. Set `status: resolved` and `resolved: <timestamp>` in incident frontmatter
2. Add resolution timeline entry
3. Fill in the Resolution section
4. Create a log entry of type `action` with status `resolved`

---

## 7. Automatic Behaviors

The agent should do these automatically without being asked:

1. **Timestamp everything** — Never create an entry without a UTC timestamp
2. **Auto-link** — If the user mentions an incident by ID, set the `incident` field
3. **Auto-tag** — Extract obvious tags from context (service names, environments)
4. **Auto-create structure** — If shift folder doesn't exist for today, create it
5. **Suggest incident creation** — If a log entry sounds like a new incident, ask: "Should I open a formal incident for this?"
6. **Update MEMORY.md** — After each shift, append a brief summary to the agent's memory file
