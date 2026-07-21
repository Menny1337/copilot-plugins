---
name: agent-crafting
description: "Creates and refines custom Copilot agents. Use for scaffolding, frontmatter or tool configuration, role and boundary design, invocation behavior, and troubleshooting loading or routing errors."
user-invocable: false
---

# How to Create and Configure Agents

A practical workflow for creating, configuring, and maintaining custom Copilot agents.

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
| `model` | string | No | Inherits default | Model to use when this agent executes. Powers per-agent subagent model selection (`/subagents`). |
| `target` | string | No | Both | `vscode` or `github-copilot` — restricts which environment the agent loads in. |
| `mcp-servers` | object | No | — | MCP server configurations. Not used by VS Code/IDE agents. |
| `disable-model-invocation` | boolean | No | `false` | Set `true` to prevent the model auto-selecting this agent (e.g. as a sub-agent); it must be chosen manually. Equivalent to the retired `infer: false`. |
| `user-invocable` | boolean | No | `true` | When `false`, the agent can't be manually selected — only invoked programmatically. |
| `metadata` | object | No | — | `name`/`value` string pair for annotation. Not used by VS Code/IDE agents. |

> **`infer` is retired.** Older agents used `infer: true|false`; replace it with
> `disable-model-invocation` and `user-invocable`. `disable-model-invocation: true` is
> equivalent to `infer: false`; if both appear, `disable-model-invocation` wins.
>
> **Ignored fields:** `argument-hint` and `handoffs` are VS Code-only — GitHub.com and the
> Copilot CLI ignore them (they don't error, but don't rely on them for portable agents).
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

## Common Agent Patterns

### Specialist Agent

Focused on one technical domain. Most agents are specialists.

```yaml
---
name: api-dev
description: "API developer agent. Designs and implements REST endpoints, request validation, error handling, and API documentation."
---
```

**Body includes:** Specific file ownership, coding conventions, domain skills, strict scope boundaries.

### Orchestrator Agent

Delegates work to other agents. Does not write code itself. Usually one per project.

```yaml
---
name: mission-control
description: "Mission control agent. Receives any task, creates a structured plan, delegates to specialized agents, and ensures quality."
disable-model-invocation: true
---
```

**Body includes:** Delegation rules, workflow selection, agent roster, pipeline stages. Set `disable-model-invocation: true` to prevent it being called as a sub-agent.

### Meta Agent

Works on agent/skill files, not application code. Improves the agent system itself.

```yaml
---
name: meta-system-designer
description: "Meta-improvement agent. Audits, refines, and evolves Copilot agents and skills to follow best practices and improve quality."
---
```

**Body includes:** Audit skills, scope limited to agent/skill directories, evolution methodology.

### Reviewer Agent

Reviews code or artifacts. Reads everything, modifies nothing (or only documentation).

```yaml
---
name: code-reviewer
description: "Code review agent. Reviews changes for quality, maintainability, DRY violations, and architectural consistency."
---
```

**Body includes:** Review criteria, severity levels, report format, read-only scope.

### Researcher Agent

Investigates topics using web search. Produces reports, not code changes.

```yaml
---
name: evidence-researcher
description: "Research agent. Investigates technologies, patterns, and best practices with proper citations and structured analysis."
tools: ["read", "search", "web", "agent"]
---
```

**Body includes:** Research methodology, citation standards, output format, anti-fabrication rules.

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

## Troubleshooting

### "Attribute X is not supported" error

Remove the unsupported attribute. The documented frontmatter properties (GitHub.com +
Copilot CLI) are: `name`, `description`, `tools`, `model`, `target`,
`disable-model-invocation`, `user-invocable`, `mcp-servers`, and `metadata`. `infer` is
retired (see above). `argument-hint` and `handoffs` are VS Code-only and are ignored
elsewhere rather than erroring.

### "Unexpected indentation" error

Caused by multi-line `description` using YAML folded scalar (`>`). Convert to single-line quoted string.

### Agent not appearing in Copilot Chat

- Verify file is in correct directory with `.agent.md` extension
- Check that `user-invocable` is not set to `false`
- For repo-level: must be in `.github/agents/`
- For user-level: must be in `~/.copilot/agents/`
- For plugin: must be in the plugin's `agents/` directory and the plugin must be installed
- Restart VS Code or reload the window

### Agent not triggering on expected prompts

- Check `description` — it's used for matching user intent to agents
- Make description specific about capabilities and trigger keywords
- Ensure the agent isn't shadowed by a higher-precedence agent with the same name

## Subagents and Parallel Execution

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
| Pick this agent's model | frontmatter | `model: <model-id>` |
| Per-agent model / effort / context tier | `~/.copilot/settings.json` | `subagents.agents.<name>` = `{ model, effortLevel, contextTier }` (managed by `/subagents`) |
| Prevent an agent from being dispatched | `~/.copilot/settings.json` | `subagents.disabledSubagents: [...]` (the built-in `explore`, `task`, and `rubber-duck` can't be disabled) |

Subagents default to a **low-cost model** unless overridden by the `model` frontmatter field
or a `subagents.agents.<name>.model` setting. (`/sidekicks` is not documented in the public
CLI reference — don't author against it.)

## Hooks and Agents

Agents are configured purely through their file — they don't declare hooks. The Copilot
`hooks.json` lifecycle system is separate, but two events relate to agents: `subagentStart`
(fires before a subagent runs; can prepend `additionalContext` to its prompt) and
`subagentStop` (fires when a subagent finishes; can `block` to force another turn). The
built-in `general-purpose` agent does **not** emit these events. To author hooks around the
agent lifecycle, use the `hooks-crafting` skill.

## References

- [GitHub Docs: Custom Agents Configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [GitHub Docs: Creating Custom Agents](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents)
- [GitHub Docs: Speed up task completion (fleet/subagents)](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/speed-up-task-completion)
- [VS Code: Custom Agents](https://code.visualstudio.com/docs/agent-customization/custom-agents)
- [GitHub Blog: How to Write a Great agents.md](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)
