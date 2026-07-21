---
name: agent-crafting
description: "Guide for creating and configuring custom Copilot agents. Use when asked to create, scaffold, or modify an agent, or when troubleshooting agent frontmatter errors. Covers frontmatter spec, tool aliases, markdown body structure, agent patterns (specialist, orchestrator, meta, reviewer), and validation."
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
- Auditing existing agents for quality — use `agent-skill-audit` instead
- Application code changes — use domain-specific agents or skills

## Agent File Basics

### Location and Naming

<!-- validate:allow-user-paths -->

| Level | Path | Precedence | Notes |
|-------|------|------------|-------|
| Repository | `.github/agents/<name>.agent.md` | Highest | Overrides org/enterprise |
| Organization | `.github-private/agents/<name>.agent.md` | Middle | Shared across org repos |
| Enterprise | Enterprise-level config | Lowest | Broadest scope |
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
| `tools` | string[] | No | All (`["*"]`) | Tools the agent can use. See [Tool Aliases](#tool-aliases). |
| `mcp-servers` | object | No | — | MCP server configurations |
| `disable-model-invocation` | boolean | No | `false` | Set `true` to prevent being called as a sub-agent |
| `user-invocable` | boolean | No | `true` | Controls whether the agent is directly user-invokable where supported |

> **Compatibility note:**
> The current Copilot CLI schema also accepts `infer`, but GitHub's public docs do not document its behavior clearly. Prefer the documented fields above unless you have a verified environment-specific need for `infer`.
>
> Additional IDE-oriented fields may exist (`model`, `agents`, `handoffs`, `target`, `argument-hint`, `metadata`). Some hosts ignore unsupported fields rather than failing, but portable agents should avoid relying on them.

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

## Scope Boundaries

- **DO**: <what this agent is allowed to do>
- **DO NOT**: <what this agent must never touch>
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
- **Approval Boundaries** — Use a three-tier pattern (`Always`, `Ask first`, `Never`) for risky or write-capable agents

### Step 4: Verify

- [ ] File is at correct location with `.agent.md` extension
- [ ] Frontmatter has `description` (required) and `name` (recommended)
- [ ] Description is single-line, quoted, 10–1024 characters
- [ ] No unsupported attributes in frontmatter
- [ ] Description matches the agent's actual tools, permissions, and scope
- [ ] Markdown body defines persona, skills, and scope boundaries
- [ ] No workflow logic duplicated from skills (agent says WHO, skill says HOW)
- [ ] Commands, examples, and checklists live in the right layer for this environment (agent-only vs skill-backed)
- [ ] Agent is documented in project tables (if applicable)
- [ ] Frontmatter validation passes (if validator available)

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
name: agent-architect
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
name: researcher
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

Remove the unsupported attribute. Copilot CLI supports: `name`, `description`, `tools`, `mcp-servers`, `disable-model-invocation`. VS Code additionally supports: `model`, `agents`, `handoffs`, `target`, `argument-hint`, `user-invokable`, `metadata`.

### "Unexpected indentation" error

Caused by multi-line `description` using YAML folded scalar (`>`). Convert to single-line quoted string.

### Agent not appearing in Copilot Chat

- Verify file is in correct directory with `.agent.md` extension
- Check that `user-invokable` is not set to `false` (VS Code)
- For repo-level: must be in `.github/agents/`
- For user-level: must be in `~/.copilot/agents/`
- For plugin: must be in the plugin's `agents/` directory and the plugin must be installed
- Restart VS Code or reload the window

### Agent not triggering on expected prompts

- Check `description` — it's used for matching user intent to agents
- Make description specific about capabilities and trigger keywords
- Ensure the agent isn't shadowed by a higher-precedence agent with the same name

## Hooks and Agents

Agents are configured purely through their file — they don't declare hooks. The Copilot
`hooks.json` lifecycle system is separate, but two events relate to agents: `subagentStart`
(fires before a subagent runs; can prepend `additionalContext` to its prompt) and
`subagentStop` (fires when a subagent finishes; can `block` to force another turn). To author hooks around
the agent lifecycle, use the `hooks-crafting` skill.

## References

- [GitHub Docs: Custom Agents Configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [GitHub Docs: Creating Custom Agents](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents)
- [VS Code: Custom Agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents)
- [GitHub Blog: How to Write a Great agents.md](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)
