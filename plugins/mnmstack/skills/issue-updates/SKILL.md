---
name: issue-updates
description: "Updates existing GitHub issues and Azure DevOps work items: comments, fields, assignments, and state. Use for explicit ticket changes, not personal board management, PR reviews, or finished-session sync."
---

# Update issues and work items

## When to Use

- Add a progress comment or edit an existing GitHub issue or ADO ticket.
- Change its title, description, assignee, priority, or state as requested.

## When to Skip

- Personal task capture or board management: use [assistant-capture](../assistant-capture/SKILL.md).
- Finished-session progress and session links: use [github-session-sync](../github-session-sync/SKILL.md)
  or [ado-session-sync](../ado-session-sync/SKILL.md).
- PR review threads, code changes, new tickets, or repository policy: use the
  corresponding workflow. An issue update does not authorize those actions.

## Procedure

### 1. Resolve the target and requested change

Identify the backend, account, and canonical item URL. For GitHub, bind the issue
number to its host and owner/repository; for ADO, bind the ID to its organization
and verify the item's project. A bare number or fuzzy title is not enough when
several targets fit. Ask rather than guessing or switching to the personal board.

Read the current item and only the comments or fields needed for the request.
Use its existing identity and configuration; do not change global CLI defaults,
accounts, or credentials. Prefer `gh` for GitHub and `az boards` for ADO.
Check the selected command's help if an option is uncertain.

### 2. Apply only the requested update

Preserve unrelated body sections, labels, tags, assignments, and concurrent edits.
Re-read before replacing a whole body; merge the requested change into current
content instead of overwriting it from an old snapshot. Resolve assignees to
confirmed identities and use the project's actual state/field values.

For progress, distinguish completed work, remaining work, blockers, and evidence.
Do not infer completion from an agent's answer, a local edit, or a passing check.
Keep personal issue IDs, private planning, secrets, and unrelated account data out
of team-facing tickets. A personal/team mirror needs an explicit target and may
link the public team item without copying private notes.

| Backend | Read and update route |
| --- | --- |
| GitHub issue | `gh issue view`, `gh issue comment`, `gh issue edit`, `gh issue close` or `gh issue reopen`, always with explicit `--repo`. Use `--body-file` for multiline content. |
| ADO work item | Use `az` and its [Boards reference](../az/references/devops-boards.md). Direct-ID `show` and `update` accept `--org`, not `--project`; verify `System.TeamProject` from the item. |
| Configured personal board | Use the [GitHub](../assistant-capture/references/github-tasks.md) or [ADO](../assistant-capture/references/ado-tasks.md) backend contract. GitHub Lane/state transitions must use its verified transition helper, not raw close/reopen calls. |

Change state only when requested; a progress comment is not permission to close.
Do not invent an intermediate ADO transition after a rejection. Report the
conflict and resolve it against the actual process before another write.

### 3. Read back the result

Fetch the updated fields or posted comment and compare them with the requested
change. For a state change, verify the state and any board fields owned by the
selected backend. Report the item URL and what actually changed.

If a write fails or times out, read the remote item before retrying: it may have
succeeded. Avoid duplicate comments; retry only a confirmed missing change.
If verification is unavailable, say the outcome is unverified. For partial
updates, name what landed and what remains; do not claim success or roll back
another writer's changes.
