<!-- validate:allow-user-paths -->
# Subagents, parallel execution, and hooks

Read this when designing an agent that will be dispatched as a subagent, tuning parallel
execution, or wiring hooks around the agent lifecycle.

## Subagents and parallel execution

A custom agent can run as a **subagent**: the main agent dispatches work to it (via the
`agent`/Task tool) in its own isolated context window. `/fleet` runs multiple subagents in
**parallel** to speed up decomposable tasks, and `@agent-name` inside a fleet/prompt targets a
specific custom agent. `/tasks` monitors running subagents. There is **no** `fleet` frontmatter
key — an agent is eligible for auto-dispatch simply by leaving `disable-model-invocation` unset.

What you control from the agent profile and settings:

| Goal | Where | How |
|------|-------|-----|
| Block auto-dispatch as a subagent | frontmatter | `disable-model-invocation: true` |
| Block manual selection | frontmatter | `user-invocable: false` |
| Pick this agent's model or effort | frontmatter | `model: <model-id>` or `model: [<primary>, <fallback>]`, plus `reasoning-effort: <level>` |
| Keep model changes on the configured list | frontmatter | `model-policy: required` (CLI 1.0.83+) |
| Per-subagent model / effort / context tier | `~/.copilot/settings.json` | `subagents.agents.<name>` = `{ model, effortLevel, contextTier }`; each field accepts the literal `"inherit"` (managed by `/subagents`, alias `/agents`) |
| Limit nested delegation | `~/.copilot/settings.json` | `subagents.maxDepth`; default lowered from 6 to 4 in CLI 1.0.71, and usage-based-billing users can raise it up to 128 |
| Prevent agents from being dispatched | `~/.copilot/settings.json` | Exclude or restrict custom and built-in agents for selection, tasks, and subagents (CLI 1.0.66 and 1.0.71) |
| Defer large tool surfaces | frontmatter / MCP | `deferred-tool-loading: true`; MCP servers configured in agent frontmatter also honour `deferTools` |

Subagents default to a **low-cost model** unless overridden by the `model` frontmatter field
or a `subagents.agents.<name>.model` setting. A `model` array is tried in order until one is
available. Add `model-policy: required` when later model changes must stay within that list;
without it, the list provides startup fallback rather than a permanent policy boundary. Use
`reasoning-effort` in frontmatter when the agent itself always needs a different effort
level; use `/subagents` when the parent orchestrator should decide per child.
(`/sidekicks` is not documented in the public CLI reference — don't author against it.)

The bundled 1.0.83-5 SDK's programmatic `CustomAgentConfig` still accepts only
`model?: string` and has no `modelPolicy` field. Treat ordered models and
`model-policy` as CLI frontmatter features until the SDK declarations catch up.

The lower `subagents.maxDepth` default matters for orchestrators that delegate to agents
that delegate again. Keep the delegation graph shallow by default, and document when a
workflow genuinely needs a higher depth.

Nested delegation cannot escape tool restrictions. Subagent sessions inherit parent tool
restrictions (CLI 1.0.67), and custom agents keep their own tool filters in nested
subagents (CLI 1.0.68). If a parent cannot use edit or execute tools, delegating will
not restore them.

Built-in agents can be excluded from selection and restricted for tasks and subagents.
Use this when an orchestrator should avoid a built-in path because of cost, policy, or
domain ownership.

## Plan mode

In CLI 1.0.71 and later, plan mode hard-blocks built-in mutating tools: file edits,
mutating shell commands, and opening pull requests. MCP and external tools are still
allowed. Since 1.0.74 the restriction is scoped rather than absolute — planning
artifacts written inside the session folder are permitted, while clear file mutations
outside it stay blocked. `/model plan` (or `/model --plan`) selects a model used only
while planning; pass `off` to clear it.

Agents intended for plan mode should produce analysis, options, specifications,
and handoff steps, keeping any interim artifacts in the session folder.

## Hooks and agents

Agents are configured purely through their file — they don't declare hooks. The Copilot
`hooks.json` lifecycle system is separate, but two events relate to agents: `subagentStart`
(fires before a subagent runs; can prepend `additionalContext` to its prompt) and
`subagentStop` (fires when a subagent finishes; can `block` to force another turn). The
built-in `general-purpose` agent does **not** emit these events. To author hooks around the
agent lifecycle, use the `hooks-crafting` skill.
