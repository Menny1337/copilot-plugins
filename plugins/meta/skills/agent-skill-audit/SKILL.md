---
name: agent-skill-audit
description: "Audit, refine, and evolve Copilot agents, skills, and hooks in any repository. Use when reviewing agent/skill/hook quality, fixing frontmatter or hooks.json errors, detecting duplication, scoring quality, or proposing system improvements."
user-invocable: false
---

# Agent, Skill & Hook Audit

A structured procedure for auditing, refining, and evolving custom Copilot agent, skill, and hook systems in any repository.

## When to Use

- Periodic health check of all agents and skills in a repository
- After creating or modifying agents/skills — verify they follow conventions
- When an agent isn't triggering, performing poorly, or has frontmatter errors
- When proposing new agents, skills, or structural improvements
- When onboarding to a new repository's agent system

## When to Skip

- You're doing application work (code, tests, config) — use domain agents instead
- You're only reading agents/skills for context — no audit needed
- The repository has no `.github/agents/` or `.github/skills/` directories

## Audit Procedure

### Step 1: Discovery & Inventory

Locate all agent and skill files:

```bash
# Find all agent files (repo-level)
find .github/agents -name '*.agent.md' 2>/dev/null | sort

# Find all skill files (repo-level)
find .github/skills -name 'SKILL.md' 2>/dev/null | sort

# Find all hook config files (repo, user, and plugin level)
find .github/hooks -name '*.json' 2>/dev/null | sort
find ~/.copilot/hooks -name '*.json' 2>/dev/null | sort
find plugins -path '*/hooks/hooks.json' 2>/dev/null | sort

# Check for user-level agents/skills
find ~/.copilot/agents -name '*.agent.md' 2>/dev/null | sort
find ~/.copilot/skills -name 'SKILL.md' 2>/dev/null | sort
```

Build a summary table:

| Type | Name | Location | Description |
|------|------|----------|-------------|
| Agent | ... | repo / user | ... |
| Skill | ... | repo / user | ... |
| Hook | event: handler | repo / user / plugin | ... |

Cross-reference against any agent/skill tables in `copilot-instructions.md` or similar documentation. Flag unlisted or stale entries.

### Step 2: Validate Frontmatter

For every agent and skill file, verify frontmatter syntax and content:

**Agent frontmatter checklist:**

- [ ] Has opening and closing `---` markers
- [ ] `description` is present (required) — single-line, quoted string
- [ ] `name` is present (recommended) — matches filename minus `.agent.md`
- [ ] `description` is 10–1024 characters
- [ ] No unsupported attributes (only: `name`, `description`, `tools`, `mcp-servers`, `disable-model-invocation`)
- [ ] No multi-line `description` using `>` or `|` folded scalars
- [ ] `tools` (if present) uses valid aliases: `read`, `edit`, `search`, `execute`, `agent`, `web`, `todo`, or `["*"]`

**Skill frontmatter checklist:**

- [ ] Has opening and closing `---` markers
- [ ] `name` is present — matches the folder name
- [ ] `description` is present — single-line, quoted, 10–1024 characters
- [ ] No unsupported attributes

> **Tip:** If a frontmatter validator is available, run it first. The standalone [`agent-skill-eval`](https://github.com/Menny1337/agent-skill-eval) tool exposes one as `skill-eval-validate` (also accepts an explicit `.md` path) and operates on any skills directory via the `AGENT_SKILL_EVAL_COPILOT_DIR` env var. Otherwise, validate manually using the checklists above.

**Common frontmatter errors:**

| Error | Cause | Fix |
|-------|-------|-----|
| "Attribute X not supported" | Using VS Code-only or invalid attributes | Remove unsupported keys |
| "Unexpected indentation" | Multi-line `description` with `>` scalar | Convert to single-line quoted string |
| Agent not appearing in chat | `user-invocable: false` or wrong file extension | Check filename ends with `.agent.md` |
| Skill not triggering | `name` doesn't match folder name | Rename to match exactly |

### Step 3: Audit Each Agent

For every agent file, verify structural quality:

- [ ] **Persona statement** — Markdown body opens with a clear identity ("You are...")
- [ ] **Skill references** — Lists skills it depends on with brief descriptions
- [ ] **Scope boundaries** — Has DO / DO NOT sections defining what the agent can touch
- [ ] **No procedure duplication** — No workflow steps, checklists, or commands that belong in a skill
- [ ] **No code blocks** — Agents define WHO, not HOW — commands and examples belong in skills
- [ ] **Focused responsibility** — Agent has one clear domain, not multiple unrelated concerns
- [ ] **Memory guidance** (optional but recommended) — Describes what patterns to store for future sessions
- [ ] **Documentation listed** — Agent appears in project documentation tables (if applicable)

### Step 4: Audit Each Skill

For every skill file, verify structural quality:

- [ ] **"When to Use" section** — Explains trigger conditions clearly
- [ ] **"When to Skip" section** — Explains when NOT to use, with redirects to correct skill
- [ ] **Self-contained procedure** — Works independently of any specific agent
- [ ] **Actionable steps** — Has numbered or ordered procedure, not just prose
- [ ] **References valid** — All file paths, commands, and patterns still exist
- [ ] **No agent dependency** — Skill does not reference a specific agent by name
- [ ] **No persona content** — Skill defines HOW, not WHO — no identity statements
- [ ] **Documentation listed** — Skill appears in project documentation tables (if applicable)

### Step 4b: Audit Each Hook

For every `hooks.json` (plugin, repo, or user level), verify structure and safety. For
authoring detail, defer to the `hooks-crafting` skill.

- [ ] **`version: 1`** present and top-level `hooks` is an object keyed by event names
- [ ] **Valid event names** — only known events (`sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `permissionRequest`, `agentStop`, `subagentStart`, `subagentStop`, `errorOccurred`, `preCompact`, `notification`), in camelCase or PascalCase — no typos
- [ ] **Valid type per entry** — `command` (default), `http`, or `prompt`
- [ ] **Command hooks** provide `bash` and/or `powershell` (or `command`) for cross-platform parity
- [ ] **HTTP hooks** set `url` using `https://` (required for `preToolUse`/`permissionRequest`); secrets only via `allowedEnvVars`
- [ ] **Prompt hooks** appear only on `sessionStart`
- [ ] **Reasonable `timeoutSec`** (default 30); referenced scripts exist, are executable, and have a shebang
- [ ] **Decision-returning hooks** emit single-line JSON and exit `0` (see `hooks-crafting` reference)
- [ ] **No secrets** echoed to stdout/stderr; not relied on as a hard security gate (failures are fail-open)
- [ ] **Plugin consistency** — a plugin declaring `"hooks"` in `plugin.json` points it at the hooks JSON **file** (e.g. `"hooks/hooks.json"`, not the bare dir — a directory throws `EISDIR` at load time); hook indexed in the catalog (if applicable)

### Step 5: Check Separation of Concerns

| | Agent | Skill |
|---|---|---|
| **Defines** | WHO — persona, role, pipeline position | HOW — procedure, steps, checklists |
| **Contains** | Name, description, skill refs, scope boundaries | Steps, commands, examples, when-to-use/skip |
| **References** | Points to skills for procedure | Does NOT depend on any agent |

**Red flags:**

- Agent body has numbered workflow steps → extract to a skill
- Agent body has bash commands or code blocks → extract to a skill
- Skill references a specific agent by name → make it agent-independent
- Same checklist appears in both agent and skill → deduplicate into the skill
- Agent has more than 5 skills listed → consider splitting the agent or ranking skills by priority

### Step 6: Quality Scoring

Rate each agent and skill on a 0–5 scale across these dimensions:

**Agent quality dimensions:**

| Dimension | 0 (Poor) | 3 (Adequate) | 5 (Excellent) |
|-----------|----------|--------------|----------------|
| **Clarity** | No persona, vague purpose | Basic identity, some ambiguity | Crystal-clear role and domain |
| **Focus** | Multiple unrelated responsibilities | Mostly focused, minor scope creep | Single clear responsibility |
| **Separation** | Procedures embedded in body | Some duplication with skills | Clean delegation to skills |
| **Boundaries** | No scope definition | Partial DO/DON'T lists | Precise, testable boundaries |
| **Frontmatter** | Missing or invalid | Valid but minimal | Complete with correct syntax |

**Skill quality dimensions:**

| Dimension | 0 (Poor) | 3 (Adequate) | 5 (Excellent) |
|-----------|----------|--------------|----------------|
| **Completeness** | Missing required sections | Has basics, gaps in procedure | All sections, thorough procedure |
| **Independence** | Depends on specific agent | Mostly standalone | Fully self-contained and reusable |
| **Actionability** | Vague prose | Some concrete steps | Clear numbered procedure with examples |
| **Accuracy** | Outdated/wrong references | Mostly current | All references verified and current |
| **Boundaries** | No when-to-use/skip | Basic triggers listed | Clear triggers with redirects |

### Step 7: Refine

Fix issues found in steps 2–6:

1. Fix frontmatter errors (syntax, unsupported attributes, missing fields)
2. Extract duplicated procedures from agent bodies into skills
3. Add missing "When to Use" / "When to Skip" sections to skills
4. Remove stale file paths or command references
5. Split agents with too many responsibilities
6. Merge overlapping skills with similar procedures
7. Update documentation tables to match current inventory

### Step 8: Evolve (Recommendations)

After auditing, propose improvements:

- **New agents** for uncovered domains (gaps in the system)
- **New skills** for repeated manual workflows
- **Merge** overlapping agents or skills with similar scope
- **Split** agents that handle multiple unrelated concerns
- **Retire** agents or skills no longer needed or used
- **Promote** patterns that work well into reusable skills
- **Prioritize** by impact — fix structural issues before cosmetic ones

## Report Format

```markdown
## Audit Report — [Repository Name]

**Date:** YYYY-MM-DD
**Scope:** [repo-level / user-level / both]

### Inventory
- Agents: X total (Y repo-level, Z user-level)
- Skills: X total (Y repo-level, Z user-level)
- Hooks: X total (across plugin/repo/user `hooks.json`)

### Agents
- ✅ Clean: [list]
- ⚠️ Issues: [agent] — [issue description]
- 🔴 Critical: [agent] — [breaking issue]

### Skills
- ✅ Clean: [list]
- ⚠️ Issues: [skill] — [issue description]
- 🔴 Critical: [skill] — [breaking issue]

### Hooks
- ✅ Clean: [list]
- ⚠️ Issues: [event: handler] — [issue description]
- 🔴 Critical: [event: handler] — [breaking issue]

### Separation of Concerns
- ✅ Clean separations: [list]
- ⚠️ Violations: [description]

### Quality Scores
| Name | Type | Clarity | Focus | Separation | Boundaries | Frontmatter | Avg |
|------|------|---------|-------|------------|------------|-------------|-----|

### Recommendations
- 💡 [suggestion with rationale]

### Actions Taken
- 🔧 [what was fixed in this audit]
```
