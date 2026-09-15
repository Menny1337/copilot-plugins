# Explicit ADO work-item writes

Use for an explicit ADO work-item request outside personal task tracking. The
root's configured backend owns personal tasks; this route does not override it.
Only write to the team board when the user explicitly asks.

## Contents

- [Prerequisite](#8-azure-devops-work-items)
- [Create a work item](#create-a-work-item)
- [Update a work item](#update-a-work-item)
- [State transitions](#state-transitions)
- [Link to parent](#link-to-parent)
- [Natural language mapping](#natural-language-mapping)

## 8. Azure DevOps Work Items

Create and update ADO work items via `az boards` CLI commands.

**Prerequisite:** Azure DevOps defaults must be configured. If commands fail with auth/project errors, run:
```bash
az devops configure --defaults organization=https://dev.azure.com/<org> project=<project>
```

For full `az boards` reference, invoke the `az` skill (provided by the `core-skills` plugin).

### Create a Work Item

Parse the user's request for:
- **Type** — Bug, Task, User Story (default: Task)
- **Title** (required)
- **Priority** — 1 (highest) to 4 (lowest). Map from natural language: P1→1, P2→2, P3→3
- **Assigned to** — Default `@Me` unless specified
- **Area path** — Infer from project context if known (check MEMORY.md)
- **Iteration** — Use current sprint if not specified
- **Description/discussion** — Any additional context

```bash
az boards work-item create \
  --type "Task" \
  --title "Implement password reset API" \
  --assigned-to "@Me" \
  --iteration "Project\\Sprint 42" \
  --fields "Microsoft.VSTS.Common.Priority=2" \
  --discussion "Context from meeting: need this for the auth redesign"
```

After creating, confirm with: "Created ADO #<ID>: <title>"

### Update a Work Item

Common update patterns:

**Change state:**
```bash
az boards work-item update --id <ID> --state "Active"
az boards work-item update --id <ID> --state "Resolved" --discussion "Fixed in PR #1234"
az boards work-item update --id <ID> --state "Closed"
```

**Reprioritize:**
```bash
az boards work-item update --id <ID> --fields "Microsoft.VSTS.Common.Priority=1"
```

**Reassign:**
```bash
az boards work-item update --id <ID> --assigned-to "user@example.com"
```

**Move to different sprint:**
```bash
az boards work-item update --id <ID> --iteration "Project\\Sprint 43"
```

**Add a comment:**
```bash
az boards work-item update --id <ID> --discussion "Update: waiting on backend API changes"
```

### State Transitions

States must follow valid transitions. Common flows:

| Type | Flow |
|------|------|
| Bug | New → Active → Resolved → Closed |
| Task | New → Active → Closed |
| User Story | New → Active → Resolved → Closed |

If a state transition fails, try the intermediate state first.

### Link to Parent

After creating a task, link it to a parent work item if specified:

```bash
az boards work-item relation add \
  --id <child-ID> \
  --relation-type "parent" \
  --target-id <parent-ID>
```

### Natural Language Mapping

| User Says | ADO Action |
|-----------|------------|
| "create a bug for..." | `az boards work-item create --type Bug` |
| "add a task for..." / "create work item" | `az boards work-item create --type Task` |
| "start working on #12345" | `az boards work-item update --id 12345 --state Active` |
| "resolve #12345" / "done with #12345" | `az boards work-item update --id 12345 --state Resolved` |
| "close #12345" | `az boards work-item update --id 12345 --state Closed` |
| "move #12345 to next sprint" | `az boards work-item update --id 12345 --iteration ...` |
| "assign #12345 to..." | `az boards work-item update --id 12345 --assigned-to ...` |
| "comment on #12345" | `az boards work-item update --id 12345 --discussion "..."` |
