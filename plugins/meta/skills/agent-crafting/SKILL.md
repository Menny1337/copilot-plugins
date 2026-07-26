---
name: agent-crafting
description: "Creates and refines custom Copilot agents. Use for scaffolding, frontmatter or tool configuration, role and boundary design, invocation behavior, and troubleshooting loading or routing errors."
user-invocable: false
---

# How to Create and Configure Agents

A practical workflow for creating, configuring, and maintaining custom Copilot agents.

For version-sensitive CLI behaviour, consult and refresh
`../agent-skill-audit/references/cli-feature-baseline.md` before relying on memory.

## When to Use

- Creating a new custom agent from scratch
- Modifying an existing agent's configuration or persona
- Troubleshooting agent frontmatter errors (not appearing, parse errors)
- Looking up supported agent attributes or capabilities
- Deciding which agent pattern fits a use case

## When to Skip

- Creating or modifying skills — use `skill-crafting` instead
- Creating or modifying lifecycle hooks (`hooks.json`) — use `hooks-crafting` instead
- Packaging agents/skills/hooks into a plugin or marketplace — use `plugin-crafting` instead
- Auditing existing agents for quality — use `agent-skill-audit` instead
- Application code changes — use domain-specific agents or skills

## Agent File Basics

### Location and Naming

<!-- validate:allow-user-paths -->

| Level | Path | Precedence | Notes |
|-------|------|------------|-------|
| Repository | `.github/agents/<name>.agent.md` | Highest | Overrides org/enterprise |
| Organization | `agents/<name>.agent.md` in the organization's `.github` or `.github-private` repository | Middle | Shared across org repos |
| Enterprise | `agents/<name>.agent.md` in an enterprise-designated organization's `.github-private` repository | Lowest | Broadest scope |
| User (local) | `~/.copilot/agents/<name>.agent.md` | User-local | Personal agents, all repos |
| Plugin | `<plugin-dir>/agents/<name>.agent.md` | Plugin-scoped | Loaded when the plugin is installed |

The filename (minus `.agent.md`) becomes the agent's identifier. Invoke with `@<name>` in Copilot Chat.

**Naming conventions:**
- Use lowercase kebab-case: `code-reviewer`, `audio-dev`, `doc-updater`
- Keep names short and descriptive (1–3 words)
- Name should hint at the agent's domain or role

### File Structure

Every agent file has two parts:

1. **YAML frontmatter** (between `---` markers) — configuration attributes
2. **Markdown body** — persona, instructions, workflow, boundaries (max ~30,000 characters)

## YAML Frontmatter Reference

### Supported Attributes

| Attribute | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | No | From filename | Display name shown in Copilot Chat |
| `description` | string | **Yes** | — | Purpose and capabilities summary. Appears as placeholder text. |
| `tools` | string[] / string | No | All (`["*"]`) | Tools the agent can use. Accepts a YAML array or a comma-separated string. See [Tool Aliases](#tool-aliases). |
| `skills` | string[] | No | — | CLI-only since 1.0.22. Eagerly loads the named skills' content into the agent's context at startup. Must be a YAML array — a bare string makes the agent fail to load. Unknown names are silently ignored. Reserve for procedures needed on every run. |
| `model` | string | No | Inherits default | Model to use when this agent executes. Powers per-agent subagent model selection (`/subagents`). |
| `reasoning-effort` | string | No | Inherits current | CLI-only since 1.0.66. Sets reasoning effort for this agent. Use when the role consistently needs deeper or lighter reasoning than the parent session; `/subagents` per-agent settings can still override it. |
| `target` | string | No | Both | `vscode` or `github-copilot` — restricts which environment the agent loads in. |
| `mcp-servers` | object | No | — | MCP server configurations. Not used by VS Code/IDE agents. |
| `deferred-tool-loading` | boolean | No | `false` | CLI-only since 1.0.52. Opts in to tool-search discovery for large tool lists instead of loading every tool definition up front. Use for broad MCP or wildcard tool sets where schema cost is significant; respected with `tools: ["*"]` since CLI 1.0.64. |
| `disable-model-invocation` | boolean | No | `false` | Set `true` to prevent the model auto-selecting this agent (e.g. as a sub-agent); it must be chosen manually. Equivalent to the retired `infer: false`. |
| `user-invocable` | boolean | No | `true` | When `false`, the agent can't be manually selected — only invoked programmatically. |
| `metadata` | object | No | — | `name`/`value` string pair for annotation. Not used by VS Code/IDE agents. |

> **`infer` is retired.** Older agents used `infer: true|false`; replace it with
> `disable-model-invocation` and `user-invocable`. `disable-model-invocation: true` is
> equivalent to `infer: false`; if both appear, `disable-model-invocation` wins.
>
> **Ignored fields:** `argument-hint` and `handoffs` are VS Code-only — GitHub.com and the
> Copilot CLI ignore them (they don't error, but don't rely on them for portable agents).
> The asymmetry is easy to miss: `argument-hint` is supported on skills in the CLI, but
> not on agents.
> Unrecognized `tools` entries are silently ignored, which lets you list product-specific
> tools without breaking other hosts.

### Syntax Rules

**Always use single-line quoted descriptions:**

```yaml
# ✅ Correct
---
name: my-agent
description: "Short clear description of what this agent does and its specialty."
---

# ❌ Wrong — multi-line description causes parse errors
---
name: my-agent
description: >
  This will be treated as separate
  attributes and cause errors.
---

# ❌ Wrong — unquoted description can break on special characters
---
name: my-agent
description: Handles auth: tokens, sessions, and keys
---
```

### Tool Aliases

Use these aliases in the `tools` array:

| Alias | Also Accepts | Purpose |
|-------|-------------|---------|
| `read` | `Read`, `NotebookRead` | Read file contents |
| `edit` | `Edit`, `MultiEdit`, `Write`, `NotebookEdit` | Edit files |
| `search` | `Grep`, `Glob` | Search for files or text |
| `execute` | `shell`, `Bash`, `powershell` | Run shell commands |
| `agent` | `custom-agent`, `Task` | Invoke other custom agents |
| `web` | `WebSearch`, `WebFetch` | Web search and URL fetching |
| `todo` | `TodoWrite` | Create and manage task lists |

Use `tools: ["*"]` for all tools (default), or `tools: []` to disable all tools.

If the environment supports MCP servers, you can also enable namespaced tools such as `my-server/tool-name` or all tools from one server with `my-server/*`.

**Restricting tools** is useful for:
- Read-only agents: `tools: ["read", "search", "web"]`
- No-code agents (researchers, reviewers): omit `execute` and `edit`
- Orchestrator agents that only delegate: `tools: ["read", "search", "agent"]`

Prefer the smallest stable tool set that supports the role. If a host compatibility bug
requires `tools: ["*"]`, document the exception in the agent and compensate with explicit
scope and approval boundaries.

For agents with large MCP or wildcard tool surfaces, add `deferred-tool-loading: true`.
It keeps tool schemas out of the initial prompt and lets the agent discover them through
tool search when needed. Since CLI 1.0.64 this also works with `tools: ["*"]`, and MCP
servers configured in `mcp-servers` honour their own `deferTools` setting.

### Preloading skill content

Use frontmatter `skills:` only for procedures the agent needs on essentially every
invocation:

```yaml
skills: ["agent-crafting", "agent-skill-audit"]
```

This is eager loading, not a reference. The named skills' content is loaded into the
agent's context at startup, whether or not the model would have selected that skill
on demand. A `## Skills` section in the agent body is the right lightweight way to list
related skills or operating expectations without spending context on every run.

`skills:` must be a YAML array. A plain string such as `skills: agent-crafting` is rejected
as malformed frontmatter and the whole agent does not load. Unknown skill names are silently
ignored, so typo-check this field when behaviour suggests a procedure was not loaded.

Use it deliberately with `deferred-tool-loading`: that setting defers tool schemas to save
context, while `skills:` pre-loads skill bodies and spends context.

### Plan mode compatibility

CLI 1.0.71 hard-blocks built-in tools that mutate the workspace while planning:
file edits, mutating shell commands, and opening pull requests. MCP and external tools
are still allowed. Since 1.0.74 the block is scoped — planning artifacts written inside
the session folder are permitted, while file mutations outside it stay blocked. If an
agent should be useful in plan mode, design it to analyse, specify, and hand off using
read/search tools, and write any interim artifacts to the session folder.

### Environment Fit

How much detail belongs in the agent depends on whether the host also supports reusable skills:

- **Agent-only environments** — Put commands, examples, and project-specific workflows directly in the agent file.
- **Agent + skill environments** — Keep the agent focused on role, boundaries, and skill references; move detailed workflows, commands, and checklists into skills.

## Step-by-Step: Create a New Agent

### Step 1: Define the Role

Answer these questions before writing anything:

- **What is this agent's specialty?** (one clear domain)
- **What skills should it reference?** (from `.github/skills/`, `~/.copilot/skills/`, or installed plugins)
- **What files/directories can it touch?** (scope boundaries)
- **Where does it fit in the pipeline?** (before/after other agents, or standalone)
- **What tools does it need?** (all, read-only, no-execute, etc.)
- **What representative tasks prove it works?** (acceptance criteria and likely failure modes)

### Step 2: Create the File

Create the file at the appropriate location:

```yaml
---
name: <name>
description: "<Role description>. <What it does in one sentence>."
---
```

### Step 3: Write the Markdown Body

Structure the body with these sections:

```markdown
# <Display Name>

<Persona statement — "You are a..." — defines identity and tone>

## Skills

Follow these skills for all work:

- **skill-name** — Brief description of what this skill provides

## File Ownership

<List of files/directories this agent is responsible for>

## Conventions

<Key coding/behavior conventions for this domain>

## Memory

<What patterns to store after completing work — categories and examples>

## Verification

<Quick domain-specific checks before reporting done>

## Approval and Scope Boundaries

- **Always**: <normal actions within the role>
- **Ask first**: <risky, destructive, or ownership-changing actions>
- **Never**: <actions outside the role or trust boundary>
```

Not every section is mandatory — adapt to the agent's role:

| Section | Specialist | Orchestrator | Meta | Reviewer |
|---------|-----------|-------------|------|----------|
| Persona | ✅ | ✅ | ✅ | ✅ |
| Skills | ✅ | ✅ | ✅ | ✅ |
| File Ownership | ✅ | ❌ (delegates) | ✅ | ❌ (reads all) |
| Conventions | ✅ | ⚠️ (delegation rules) | ⚠️ | ⚠️ |
| Memory | ✅ | ✅ | ✅ | Optional |
| Verification | ✅ | ✅ | ✅ | ✅ |
| Scope | ✅ | ✅ | ✅ | ✅ |

For a worked frontmatter + body template of each archetype above, read
`references/agent-patterns.md`.

High-value optional sections:

- **Project Knowledge** — Tech stack, versions, file layout, and non-obvious constraints
- **Commands / Verification** — Put executable commands early when the agent must validate its own work and no companion skill owns that procedure
- **Approval Boundaries** — Use a three-tier pattern (`Always`, `Ask first`, `Never`) for every risky or write-capable agent

### Step 4: Verify

- [ ] File is at correct location with `.agent.md` extension
- [ ] Frontmatter has `description` (required) and `name` (recommended)
- [ ] Description is single-line, quoted, non-empty, and within any target-host limit
- [ ] No unsupported attributes in frontmatter
- [ ] Description matches the agent's actual tools, permissions, and scope
- [ ] Markdown body defines persona, skills, and scope boundaries
- [ ] No workflow logic duplicated from skills (agent says WHO, skill says HOW)
- [ ] Commands, examples, and checklists live in the right layer for this environment (agent-only vs skill-backed)
- [ ] Agent is documented in project tables (if applicable)
- [ ] Frontmatter validation passes (in this marketplace: `node scripts/validate.mjs`)

**Behavioral verification (risk-scaled):**

- Define representative tasks and acceptance criteria before adding detailed instructions.
- For auto-routed agents, test at least two should-select prompts and two semantically close
  prompts that should not select the agent.
- Run a representative task in a fresh context and inspect the trajectory, not only the final
  answer: tool choice, handoffs, boundary compliance, and validation behavior all matter.
- When modifying an existing agent, compare the new profile with the previous profile on the
  same tasks. Keep at least one held-out task that did not shape the edit.
- If the agent targets multiple model families or tiers, run the same critical tasks on each
  intended model; instructions that work for a frontier model may under-specify a smaller one.
- Use independent review for substantive routing, security, or scope changes, and retain human
  approval for destructive actions, commits, and releases.

## Anti-Patterns to Avoid

| ❌ Don't | ✅ Do Instead |
|----------|--------------|
| Duplicate workflow steps from a skill into the agent body | Reference the skill: "follow the **skill-name** procedure" |
| Use multi-line `description: >` in frontmatter | Use single-line `description: "..."` |
| Add unsupported attributes to frontmatter | Only use attributes from the supported list |
| Give an agent multiple unrelated responsibilities | Create separate focused agents for each domain |
| Put concrete commands or checklists in the agent | Put those in a skill; agent just references it |
| Make the markdown body longer than 30,000 characters | Keep instructions focused; move detail to skills |
| Hardcode project-specific paths in user-level agents | Use generic patterns; let skills handle specifics |
| Create agents without scope boundaries | Always define DO / DO NOT sections |
| Name agents with generic terms like "helper" or "assistant" | Use specific domain names: "api-dev", "test-writer" |

## Bundled References

Load these only when the trigger applies — they are not needed for routine frontmatter or
body edits.

| Read | When |
|------|------|
| `references/agent-patterns.md` | Scaffolding a new agent and choosing an archetype (specialist, orchestrator, meta, reviewer, researcher) |
| `references/troubleshooting.md` | An agent errors on load, doesn't appear in chat, or doesn't trigger on expected prompts |
| `references/advanced-topics.md` | The agent will run as a subagent, needs parallel/fleet or per-agent model/effort/context tuning, targets plan mode, or you're wiring `subagentStart`/`subagentStop` hooks |

## References

- [GitHub Docs: Custom Agents Configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [GitHub Docs: Creating Custom Agents](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents)
- [GitHub Docs: Speed up task completion (fleet/subagents)](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/speed-up-task-completion)
- [VS Code: Custom Agents](https://code.visualstudio.com/docs/agent-customization/custom-agents)
- [GitHub Blog: How to Write a Great agents.md](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)
