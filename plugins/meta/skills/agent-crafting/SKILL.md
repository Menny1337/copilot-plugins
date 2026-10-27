---
name: agent-crafting
description: "Creates and troubleshoots Copilot agent definitions (.agent.md). Use for persona, frontmatter, tool access, or loading and routing changes."
user-invocable: false
---

# Create and configure agents

## When to Use

Create, revise, or troubleshoot an agent definition, including its role,
tools, model settings, and invocation behaviour.

## When to Skip

Use `skill-crafting` for skills, `hooks-crafting` for hooks, `plugin-crafting`
for packaging, and `agent-skill-audit` for structural reviews.
Application work belongs to its domain tools or agent.

## Procedure

### 1. Set the scope

Read the current definition, repository instructions, and affected dependencies.
Identify the target host, role, owned artifacts, authority, and expected result.
Check available skills before adding procedures to an agent.

Keep dependent work in the main loop. Use the context-boundary reference
when considering delegation or folding an agent into skills.

### 2. Read the needed guidance

| Task | Read |
| --- | --- |
| Role, ownership, or body | [Authoring](references/authoring.md) |
| Fields, tools, discovery, or invocation | [Frontmatter](references/frontmatter.md) |
| Archetype examples | [Agent patterns](references/agent-patterns.md) |
| Loading or routing failure | [Troubleshooting](references/troubleshooting.md) |
| Context boundaries, subagents, model tuning, plan mode, or hooks | [Advanced topics](references/advanced-topics.md) |
| Version-sensitive CLI claim | Relevant [feature baseline](../agent-skill-audit/references/cli-feature-baseline.md) section |

New agents need authoring and frontmatter. A body-only edit needs no schema
refresh unless configuration changes. Verify changed platform claims using
supported documentation/help and the target runtime. Keep shell, session,
and baseline versions distinct.

### 3. Rewrite within scope

State the role, skill routes, ownership, and approval boundaries plainly.
Keep reusable procedures in skills; agent-only hosts must supply any missing
procedure. Replace duplicate instructions rather than adding another copy.

Retain least privilege, tested workarounds, and user review stops.
Do not remove safeguards based on a model's advertised capabilities.
Let the agent finish authorized edit/check/fix work; preserve plan-only
requests and workflow approval gates.

### 4. Verify and finish

Use the shared [evaluation contract](../skill-crafting/references/evaluation.md)
for outcome evidence, baseline comparisons, and held-out cases.
Run frontmatter/reference checks and affected generators. Fix failures within
scope. Routing, schema, security, and system-wide changes also require
`multi-model-review`.

State untested behaviour and blockers. Commit, version, publication, and
installation refresh remain separate approvals.
