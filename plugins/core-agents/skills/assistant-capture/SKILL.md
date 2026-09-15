---
name: assistant-capture
description: "Captures personal notes, tasks, and reminders. Use to save a note, manage a task or reminder, or turn meeting action items into tasks."
argument-hint: "<note, task, or reminder to capture>"
---

# Capture notes, tasks and reminders

Procedures for writing structured personal assistant data to the workspace at `~/.copilot/assistant/`.

## When to Use

- Creating any type of note (meeting, decision, idea, scratch)
- Adding, updating, completing, or reopening tasks
- Setting or dismissing reminders
- Initializing the workspace for first-time use
- Extracting action items from meeting notes into tasks

## When to Skip

- Searching or listing existing data → use **assistant-query** instead
- Generating summaries or reports → use **assistant-query** instead
- Sending a Teams message or reminder → use **m365-messaging** instead

## Execution Rules

- For any note, task, or reminder write request, perform the write during this turn; do not only describe it. Select the configured backend before any personal-board task operation.
- The gateway is the **only supported write path** for `~/.copilot/assistant/` notes, `tasks.md`, `reminders.md`, and workspace init — never hand-edit those files with `Read`/`Edit`/shell-append, even for a "quick" change. It serializes concurrent writers, validates structure before mutating, and commits atomically, which ad-hoc edits cannot guarantee. ADO tasks use `az boards`; GitHub tasks use `gh` and the verified transition helper. Notes and reminders stay local through `assistant-store`, regardless of task backend.
- When the user already provided the needed content, do not ask follow-up questions before writing.
- Capture first, organize second — get the information down, then refine structure.
- Resolve ambiguous matches with the user; never guess an item or parent. Offer meeting action-item extraction and wait for acceptance before adding tasks.
- For remote tasks, search before creating, preserve provenance and retry markers, and follow the selected backend's authentication and ordering rules. Do not silently change identity or re-authenticate after a permission/scope failure.
- A failed write is not success. Preserve failed remote captures in the configured fallback inbox, report the failure, and reconcile by idempotency key. Partial or indeterminate GitHub transitions require the same command to be re-run, not a blind rollback.
- The personal board is the default write target. The separate `teamBoard` is read-only unless the user explicitly requests a team work-item write. Keep personal tracking out of team-facing artifacts.

## Procedure

### 1. Select the workflow before loading its details

Read only the references needed for this request. A quick note or reminder does not
need task configuration, the backend contract, or ADO/GitHub instructions.

Before any personal-board task write or lookup, resolve and read the selected
[assistant config](references/configuration.md)
and select exactly one personal backend: `markdown`, `ado`, or `github`. Read the
[task-backend contract](references/task-backend-contract.md) when changing a backend
or resolving a contract question; routine operations use the selected route below.
Use `markdown` when the config file or selector is absent, or when explicitly
selected. If an explicit selector is unrecognized, report it and stop the task
operation; do not query or write any task backend. Also stop and report malformed
config or a missing/invalid required remote-backend block. Never substitute a
markdown task write for a configuration or remote-operation failure. These are
skill preflight guards; direct query commands validate their requested board independently.

Explicit non-personal ADO work-item requests validate their requested target
independently. A personal-backend error does not block that route, and that route
must not become a fallback for a failed personal task operation.

| Requested workflow | Read |
| --- | --- |
| Create a meeting, decision, idea or scratch note | [Notes and file naming](references/notes.md) |
| Set or dismiss a reminder | [Reminders](references/reminders.md) |
| Task operation with the selected `markdown` backend | [Markdown tasks](references/markdown-tasks.md) |
| Task operation with the selected `ado` backend | [ADO configuration](references/ado-configuration.md) and [ADO tasks](references/ado-tasks.md) |
| Task operation with the selected `github` backend | [GitHub configuration and authentication](references/github-configuration.md) and [GitHub tasks](references/github-tasks.md) |
| Extract meeting action items | [Action-item extraction](references/action-items.md), then only the selected task backend's references above |
| Explicit request to create/update a non-personal ADO work item | [ADO work items](references/ado-work-items.md); do not use this route to bypass the configured personal backend |
| First use, missing store, or explicit initialization | Workspace initialization below |

References retain their original section numbers for dependent workflows. Follow
links to a different workflow only when the current operation needs it.

### 2. Execute and confirm the outcome

Use the selected reference's commands and result handling. Confirm the actual
saved path, task/issue ID, reminder date, or changed fields. Report per-item
outcomes for imports and distinguish inbox fallback from a successful remote write.

## Running these commands: the `assistant-store` gateway

Every local-store write (initialization, notes, markdown tasks, reminders and
markdown action-item imports, not ADO or GitHub task writes)
goes through the bundled `assistant-store` helper, a zero-dependency Node script that
serializes writes with a lock, re-reads the target under that lock, validates structure,
and commits with a same-directory temp-file + fsync + atomic rename. This is what makes
it safe for a terminal session and a voice/automation client to write to the same store
at the same time.

- **Install:** automatic — the `core-agents` plugin's `sessionStart` hook links
  `assistant-store` onto your `PATH`. If the bare command isn't found yet, run it with
  Node from this skill's directory instead: `node <skill-dir>/scripts/assistant-store.mjs <command>`.
- **Output:** exactly one JSON line on stdout: `{ok, op, opId, changedPaths, result, error}`.
  Parse it — don't guess from exit code alone, though the exit code also distinguishes
  usage errors (1), business/validation errors (2, e.g. not-found, ambiguous match,
  malformed store), lock contention (3), and unexpected failures (4).
- **Ambiguous matches:** `task update|complete|reopen --match` and `reminder dismiss
  --match` require the keyword to identify exactly one row. If more than one matches,
  the command fails with `error.code: "AMBIGUOUS_MATCH"` and an `error.candidates` list —
  ask the user to pick one rather than guessing.
- **Commands:** `init`, `create-note`, `task add|update|complete|reopen`, `reminder
  set|dismiss`, and `import` ([batch action-item import](references/action-items.md)). Run `assistant-store
  --help` for the full flag reference.

---

## 1. Workspace Initialization

**On first use, or whenever a command reports a missing store**, initialize the workspace:

```bash
assistant-store init
```

This idempotently creates the full structure — safe to run even when the workspace
already exists (it reports `alreadyExisted` for anything it didn't need to create):

```
~/.copilot/assistant/
├── MEMORY.md
├── tasks.md
├── reminders.md
├── notes/
│   ├── meetings/
│   ├── decisions/
│   ├── ideas/
│   └── scratch/
├── templates/
│   ├── meeting.md
│   ├── decision.md
│   ├── idea.md
│   └── scratch.md
└── archive/
```

Every other command in this skill also lazy-inits the workspace on first use, so an
explicit `init` call is rarely required — run it directly only when you want to confirm
the workspace exists before doing anything else.

---

## 7. Automatic Behaviors

The agent should do these automatically without being asked:

1. **Date-prefix all files** — the gateway date-prefixes automatically; still choose the right date when the user implies one other than today
2. **Auto-create directories** — the gateway creates any missing note/type directory itself; no manual `mkdir` needed
3. **Use templates** — Always start from the template, never create blank files
4. **Offer action item extraction** — After meeting notes, ask about adding tasks
5. **Smart priority defaults** — P3 unless urgency cues detected
6. **Natural date parsing** — Convert "Friday", "next week", "end of month" to actual dates
7. **Update MEMORY.md** — After learning a preference (e.g., recurring meeting format), persist it. `assistant-store init` creates `MEMORY.md`, but ongoing edits to it are free-form prose, not a structured record the gateway models — edit it directly, same as before.

---
