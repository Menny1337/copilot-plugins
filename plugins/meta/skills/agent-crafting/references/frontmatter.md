<!-- validate:allow-user-paths -->

# Agent frontmatter and discovery

Read when creating a definition or changing configuration, discovery, or
invocation behaviour. For a persona-only edit, the authoring reference is enough.

## Contents

- Source of platform facts
- Location and naming
- Minimal configuration
- Choose authority and loading deliberately
- Model and invocation controls
- Validation boundary

## Source of platform facts

Use the [feature baseline](../../agent-skill-audit/references/cli-feature-baseline.md#agent-frontmatter)
for supported fields, types, defaults, version gates, and documentation
disagreements. Check only the affected claims against live help or supported
documentation. This reference explains decisions; it does not maintain another
complete schema.

## Location and naming

| Scope | Definition location |
| --- | --- |
| Repository | `.github/agents/<name>.agent.md` |
| Plugin | `<plugin>/agents/<name>.agent.md` |
| Personal | `~/.copilot/agents/<name>.agent.md` |
| Organization | `agents/` in its `.github` or `.github-private` repository |
| Enterprise | `agents/` in the designated organization's `.github-private` repository |
| Added directory | `.github/agents/` under a trusted discovery root, where the CLI version supports it |

Use short lowercase kebab-case names matching the filename stem. Confirm the
target host's precedence and resolved origin rather than treating these scopes
as one universal ordering. `--add-dir` can discover customizations as well as
grant path access; never add an untrusted root as a permission workaround.

Select the agent using the target host's supported interface. Do not assume
Copilot Chat invocation syntax also applies to the CLI.

## Minimal configuration

```yaml
---
name: evidence-reviewer
description: "Reviews supplied evidence and reports supported findings without modifying source."
tools: ["read", "search"]
---
```

`description` is required. Keep it quoted, non-empty, and consistent with the
agent's tools and ownership. In this marketplace, keep top-level values on one
line, using existing supported forms such as the inline `tools` array above.
Do not use folded/block descriptions or nested maps unsupported by its parsers.

The body follows the closing frontmatter marker. Keep it focused on role,
skill routing, ownership, and boundaries; the host's maximum size is not a
target to fill.

## Choose authority and loading deliberately

Use the smallest stable tool set that supports the role. These aliases retain
the existing authoring vocabulary; verify affected entries for the target host:

| Alias | Also accepts | Purpose |
| --- | --- | --- |
| `read` | `Read`, `NotebookRead` | Read content |
| `edit` | `Edit`, `MultiEdit`, `Write`, `NotebookEdit` | Edit content |
| `search` | `Grep`, `Glob` | Find files and text |
| `execute` | `shell`, `Bash`, `powershell` | Run commands |
| `agent` | `custom-agent`, `Task` | Invoke agents |
| `web` | `WebSearch`, `WebFetch` | Search or fetch web content |
| `todo` | `TodoWrite` | Track work |

Supporting hosts also accept namespaced MCP tools such as `my-server/tool-name`
or `my-server/*`. They are not limited to this alias list.

The documented default when `tools` is omitted is all tools.
`tools: []` disables tools; `tools: ["*"]` explicitly enables all tools.
Preserve documented host compatibility exceptions until re-tested. Compensate
for broad access with explicit scope and approval boundaries; these do not
replace enforced tool permissions.

For broad MCP surfaces, consider `deferred-tool-loading` only on a supporting
runtime. It defers tool schemas, not the agent's responsibilities.

Frontmatter `skills:` eagerly loads bodies. Use it only for procedures needed
on essentially every invocation, and use the supported array form. A body
roster with use conditions is the lighter option for related skills.
Unknown names can be ignored by the host; check dependency resolution.

## Model and invocation controls

Check `model`, `model-policy`, `reasoning-effort`, `target`,
`disable-model-invocation`, and `user-invocable` against the intended host.
Do not assume a field supported by CLI frontmatter has the same shape in the
SDK or another host.

The baseline records ordered model lists and `model-policy` for CLI 1.0.83,
alongside narrower public/SDK declarations. Preserve that distinction when
authoring or reviewing an affected field.

Do not introduce retired `infer` guidance. Skills and agents also differ:
`argument-hint` on a CLI skill does not establish support on an agent.
Verify host-specific `handoffs`, MCP configuration, and metadata before use.

## Validation boundary

Run the existing repository frontmatter validator after edits. Exercise the
affected loading or invocation behaviour where possible, using a fixture
instead of mutating a user's installed agent. Record untested host paths.

For plan mode, use `advanced-topics.md` and the baseline. A capability to call
an external tool does not grant permission to make a workspace change while
the task or host requires a plan.
