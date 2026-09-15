---
name: agent-crafting
description: "Creates and troubleshoots Copilot agent definitions (.agent.md). Use for persona, frontmatter, tool access, or loading and routing changes."
user-invocable: false
---

# Create and configure agents

Define an agent's role, ownership, and boundaries. Put reusable procedures in
skills when the target host supports them.

## When to Use

- Create or revise an agent definition.
- Change its tools, model configuration, persona, or invocation behaviour.
- Diagnose a definition that fails to load or selects the wrong tasks.

## When to Skip

- Skill definitions: use `skill-crafting`.
- Lifecycle hooks: use `hooks-crafting`.
- Plugin or marketplace packaging: use `plugin-crafting`.
- Structural reviews: use `agent-skill-audit`.
- Application code: use the relevant domain agent.

## Procedure

### 1. Define the intended change

Read the current definition, applicable repository instructions, and affected
dependencies. Identify the target host, role, file ownership, authority, and
observable completion criteria. Reuse the available skill inventory.

For a small body edit, inspect the affected role and boundaries; do not require
an unrelated schema refresh. For a new agent, choose its responsibility and
representative tasks before adding instructions.

### 2. Select the relevant reference

| Task | Read |
| --- | --- |
| New agent, persona, ownership, or body structure | [Authoring](references/authoring.md) |
| Frontmatter, tool configuration, discovery, or invocation controls | [Frontmatter](references/frontmatter.md) |
| Choosing an archetype | [Agent patterns](references/agent-patterns.md) |
| Definition fails to load or route | [Troubleshooting](references/troubleshooting.md) |
| Subagents, fleet, model/effort/context tuning, plan mode, or subagent hooks | [Advanced topics](references/advanced-topics.md) |
| A version-sensitive CLI claim changes | The affected section of [the feature baseline](../agent-skill-audit/references/cli-feature-baseline.md) |

For a new agent, read frontmatter and authoring together; batch independent
reads when the host supports it. An existing body-only edit needs no
frontmatter reference unless configuration also changes.

Verify changed platform claims against the target runtime and supported
documentation. Keep shell CLI, session runtime, and baseline versions distinct.
Do not refresh an entire baseline from partial evidence.

### 3. Author within the established boundaries

Keep one responsibility, a concise role statement, conditional skill routes,
and explicit normal/approval-required/forbidden actions. Do not copy a skill's
procedure into the agent body. In agent-only environments, include the
commands and domain procedures the host otherwise cannot supply.

Retain justified compatibility safeguards and least-privilege tool choices.
Do not remove an approval gate, a user review stop, or a tested workaround
because a newer model is expected to need less guidance.

Define the requested result and permit in-scope implementation/check/fix cycles
through completion. Leave safe method choices open. An explicit plan-only
request or workflow approval gate still takes precedence.

### 4. Complete the change

Run the existing frontmatter validator and check referenced skills/resources.
Regenerate affected, owned documentation. Fix failures caused by the approved
change without restarting unrelated checks.

For new or substantively changed agents, use the behavioural checks in
`references/authoring.md`: positive/near-miss cases, an executed outcome,
previous-profile comparison, and a held-out case. Use `multi-model-review`
for routing, schema, security, or system-wide changes.

## Completion

The source definition implements the requested role or configuration change,
its affected checks pass, and any unavailable behavioural coverage is stated.
Commit, version, release, and installation refresh remain separate approvals.
