<!-- validate:allow-user-paths -->
# Subagents, parallel execution, and hooks

Use this for context boundaries, subagent configuration, plan mode, and hooks.

## Contents

- Choose the context boundary
- Subagents and parallel execution
- Plan mode
- Hooks and agents

## Choose the context boundary

Keep planning, execution, and dependent follow-ups in one main loop. Shared
data and earlier decisions can be lost in summaries. Load procedures through
skills, conditional facts through references, and tool schemas through deferred
discovery; avoid eagerly loading every former specialist's instructions.

Use separate contexts for independent parallel work, independent verification,
measured context or tool-selection problems, or enforced isolation. A title
alone does not justify a boundary. A separate prompt provides no security
boundary: verify host and tool restrictions before relying on isolation.

Give each delegate a bounded objective, inputs, constraints, ownership, and stop
condition. Require evidence pointers, uncertainty, failures, and cleanup state.
The parent checks the result and owns the integrated outcome. Transfer the
conversation only when direct specialist interaction is needed.

Keep reusable judgment in skills and mechanical payloads and validation in tools.
Enforce permissions, approvals, and budgets in the host or tools where supported.
Keep instruction safeguards until replacement enforcement is verified.

Before changing a context boundary, measure outcomes and overhead using the
shared [evaluation contract](../../skill-crafting/references/evaluation.md#verify-task-completion).
Routine edits need not re-justify existing agents. Migrate one capability at a
time, preserving scope, authority, memory, recovery, discovery, and rollback.
Keep useful independent verification.

Design source: [Anthropic, When to fold subagents into your main agent loop](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop).
Treat its claims as hypotheses to test here. They do not authorize retiring
units without approval.

## Subagents and parallel execution

The `agent`/Task tool dispatches a custom agent in a separate context. `/fleet`
runs parallel subagents; `@agent-name` targets one and `/tasks` monitors them.
There is no `fleet` frontmatter key. Leave `disable-model-invocation` unset to
allow auto-dispatch; set it to `true` to block it. `user-invocable: false` blocks
manual selection.

Use [agent frontmatter](../../agent-skill-audit/references/cli-feature-baseline.md#agent-frontmatter)
for supported versions and fields, including:

- `model: <model-id>` or `model: [<primary>, <fallback>]`
- `model-policy: required` to constrain later changes to that list
- `reasoning-effort: <level>` for a profile's effort requirement
- `deferred-tool-loading: true`; frontmatter MCP servers also honour `deferTools`

An ordered model list alone controls startup fallback, not later model changes.
The baseline records the SDK's narrower `CustomAgentConfig` shape (`model?: string`,
no `modelPolicy`); do not assume CLI array syntax works programmatically.

Use [subagent settings](../../agent-skill-audit/references/cli-feature-baseline.md#subagent-settings)
for per-child model/effort/context overrides, `"inherit"`, depth defaults, and
built-in agent restrictions. Configure overrides with `/subagents` (alias
`/agents`); do not author against the undocumented `/sidekicks`. Keep nesting
shallow and explain any higher depth requirement.

Children inherit parent tool restrictions and retain their own filters.
Delegating cannot restore forbidden edit or execute access.

## Plan mode

Plan mode blocks built-in workspace mutators, including opening pull requests,
but allows MCP and external tools. Keep planning artifacts in the session
folder; mutations outside it remain blocked. See the baseline's
[subagent settings](../../agent-skill-audit/references/cli-feature-baseline.md#subagent-settings)
for version scope and `/model plan` (`/model --plan`, `off` to clear).

## Hooks and agents

The [GitHub hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference#agent-scoped-hooks)
documents CLI-only frontmatter `hooks`; the general agent table omits it.
Neither establishes support in every host or installed CLI.

Agent-crafting owns profile placement and host compatibility. Use
`hooks-crafting`'s [scoped-hook contract](../../hooks-crafting/references/hooks-reference.md#agent-scoped-hooks-cli-only)
for events, payloads, command/HTTP handlers, and trust. Validate the target runtime
in an authorized isolated fixture before enabling executable configuration.

The documented nested YAML map fails this repository's scalar-only parser.
Adding it requires separate schema/governance approval; do not relax validation
as a documentation fix.

Session events `subagentStart` (prepends `additionalContext`) and `subagentStop`
(`block` forces another turn) are separate. The built-in `general-purpose` agent
does not emit them.
