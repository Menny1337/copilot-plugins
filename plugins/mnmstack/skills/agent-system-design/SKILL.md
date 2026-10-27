---
name: agent-system-design
description: "Designs customization workflows across skills, agents, hooks, plugins, and extension or canvas boundaries. Use for cross-component ownership, routing, and approval design; use the relevant authoring skill for a known single-file change."
---

# Design agent systems

## When to Use

- Decide which customization owns a workflow or how several components cooperate.
- Migrate an agent workflow into skills or revise context and approval boundaries.
- Plan a system-wide change with dependent definitions and integration work.

## When to Skip

- A known definition change: use its authoring skill below directly.
- A structural inventory: use `agent-skill-audit`.
- An architect toolkit self-audit: use `agent-architect-self-audit`.
- Application code, product tests, or product UI: use the relevant domain workflow.

## Procedure

### 1. Establish ownership and authority

Identify the requested result, canonical source, target host, editable artifacts,
and completion evidence. Read repository instructions and preserve unrelated
changes. A skill supplies guidance; it does not inherit an agent's frontmatter,
restrict the host's tool access, or grant permission to act. The host and invoking
workflow must provide those controls.

Keep dependent work in the same execution loop unless an actual context or
authority boundary warrants isolation. Use
[context-boundary guidance](../agent-crafting/references/advanced-topics.md#choose-the-context-boundary)
to compare alternatives. Do not recreate a removed persona in a large skill.

### 2. Load the owner for each affected contract

| Work | Owning skill |
| --- | --- |
| Agent definition, role, or context boundary | `agent-crafting` |
| Reusable procedure, skill discovery, or installation | `skill-crafting` |
| Structural quality, overlap, and inventory | `agent-skill-audit` |
| Lifecycle hooks | `hooks-crafting` |
| Plugin or marketplace packaging and discovery | `plugin-crafting` |
| Improvement from authorized session evidence | `skill-improvement-loop` |
| General unattended OS-scheduled work | `scheduled-headless-copilot` |
| This marketplace's review daemon | `scheduled-skill-review` |
| Independent review and description critique | `multi-model-review` |
| Authorized persistent memory | `memory` |

Keep exact interfaces with their owner. Rewrite repeated or conflicting guidance
in place and link to it from consumers. Inspect extension/canvas host contracts
when those boundaries are involved; do not assume plugin or IDE parity.

The documented `tools: ["*"]` loading workaround belongs to plugin-agent
frontmatter until re-tested through `agent-crafting`. It is not a skill privilege
or a reason to add `allowed-tools`.

### 3. Complete only the authorized change

Source edits and their owned checks/generators may proceed within the task's
approved scope. Deleting, renaming, merging, splitting, retiring, or reorganizing
units needs explicit authorization. Changing another reviewer's scope, committing,
versioning, pushing, publishing, releasing, deploying, refreshing installations,
and writing private memory also need separate approval unless already granted.
Do not treat tool availability as approval or skip frontmatter validation.

A self-audit remains report-only until named findings and exact dependent
artifacts are approved under `agent-architect-self-audit`. Do not substitute
scheduled-review autonomy for that approval.

Read `~/.copilot/memory/MEMORY.md` or
`~/.copilot/agent-architect/MEMORY.md` only within authorized scope.
If access is denied, report it without trying another tool or path.
Use `memory` for approved durable, redacted lessons; architect artifacts may use
`~/.copilot/agent-architect/` only when authorized.

### 4. Verify the result

Use the owning authoring skills' outcome cases and source checks, correcting
in-scope failures. Use `multi-model-review` for routing, schema, security, and
system-wide changes when the invoking scope permits independent reviewers.
Record missing review or runtime coverage; a score or static check alone does
not prove the result. Report source, publication, and loaded/installed state
separately.
