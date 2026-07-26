---
name: agent-skill-audit
description: "Audits and improves Copilot agents, skills, and hooks. Use for inventory, frontmatter validation, routing or overlap issues, quality scoring, separation-of-concerns, security reviews, and system evolution."
user-invocable: false
---

# Agent, Skill & Hook Audit

A structured procedure for auditing, refining, and evolving custom Copilot agent, skill, and hook systems in any repository.

## Bundled Reference

- **`references/cli-feature-baseline.md`** — verified Copilot CLI feature surface
  (skill/agent frontmatter, discovery locations, skill and plugin commands, hook
  semantics, headless flags and environment) plus the procedure for re-verifying
  it against a newer CLI. Read it before judging whether guidance is current, and
  refresh it when the baseline version falls behind `copilot --version`.

## When to Use

- Periodic health check of all agents and skills in a repository
- After creating or modifying agents/skills — verify they follow conventions
- When an agent isn't triggering, performing poorly, or has frontmatter errors
- When proposing new agents, skills, or structural improvements
- When onboarding to a new repository's agent system

## When to Skip

- You're doing application work (code, tests, config) — use domain agents instead
- You're only reading agents/skills for context — no audit needed
- The requested scope has no repository, plugin, organization, or user-level agent/skill/hook definitions

## Audit Procedure

### Step 1: Discovery & Inventory

Confirm the requested scope first. Do not expand a plugin-only review into unrelated user-level
content. Then locate definitions at every level that is in scope:

```bash
# Find repository and plugin agents
find .github plugins -type f -path '*/agents/*.agent.md' 2>/dev/null | sort

# Find repository and plugin skills
find .github plugins -type f -path '*/skills/*/SKILL.md' 2>/dev/null | sort

# Find all hook config files (repo, user, and plugin level)
find .github/hooks -name '*.json' 2>/dev/null | sort
find ~/.copilot/hooks -name '*.json' 2>/dev/null | sort
find plugins -path '*/hooks/hooks.json' 2>/dev/null | sort

# Check user-level agents/skills only when included in scope
find ~/.copilot/agents -name '*.agent.md' 2>/dev/null | sort
find ~/.copilot/skills -name 'SKILL.md' 2>/dev/null | sort
```

Run the repository's existing validator before manual scoring. A deterministic failure is a
verified defect; do not downgrade it to a subjective recommendation.

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
- [ ] `description` is non-empty and within any target-host limit
- [ ] No unsupported attributes (documented set: `name`, `description`, `tools`, `model`, `target`, `disable-model-invocation`, `user-invocable`, `mcp-servers`, `metadata`). Flag retired `infer` (→ `disable-model-invocation` + `user-invocable`); `argument-hint`/`handoffs` are VS Code-only and ignored elsewhere.
- [ ] No multi-line `description` using `>` or `|` folded scalars
- [ ] `tools` (if present) uses valid aliases: `read`, `edit`, `search`, `execute`, `agent`, `web`, `todo`, or `["*"]`

**Skill frontmatter checklist:**

- [ ] Has opening and closing `---` markers
- [ ] `name` is present — matches the folder name
- [ ] `description` is present — single-line, quoted, 1–1024 characters
- [ ] Standard optional fields have the right shape (`compatibility` scalar ≤500 chars,
      `allowed-tools` space-separated scalar, `metadata` map only where the host/repo supports it)
- [ ] Host-specific fields are supported by the intended runtime
- [ ] Repository-specific frontmatter restrictions also pass (for example, scalar-only parsers)

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
- [ ] **Scope boundaries** — Defines normal, approval-required, and forbidden actions
- [ ] **Approval boundaries** — Write-capable or risky agents distinguish normal actions,
      actions requiring approval, and forbidden actions
- [ ] **No procedure duplication** — No workflow steps, checklists, or commands that belong in a skill
- [ ] **Examples are justified** — Concise role-specific commands or output examples are fine
      when no companion skill owns them; reusable procedures are not
- [ ] **Focused responsibility** — Agent has one clear domain, not multiple unrelated concerns
- [ ] **Security and trust** — Tool access is least-privilege where reliable; broader access is
      justified and compensated by explicit boundaries
- [ ] **Behavioral evidence** — Representative tasks test routing, tool choice, and boundary compliance
- [ ] **Memory guidance** (optional but recommended) — Describes what patterns to store for future sessions
- [ ] **Documentation listed** — Agent appears in project documentation tables (if applicable)

### Step 4: Audit Each Skill

For every skill file, verify structural quality:

- [ ] **"When to Use" section** — Explains trigger conditions clearly
- [ ] **"When to Skip" section** — Explains when NOT to use, with redirects to correct skill
- [ ] **Self-contained procedure** — Works from declared inputs/dependencies without requiring
      an agent body to supply missing steps
- [ ] **Actionable steps** — Has numbered or ordered procedure, not just prose
- [ ] **References valid** — All file paths, commands, and patterns still exist
- [ ] **CLI currency** — Any claim about Copilot CLI behavior, frontmatter fields, commands, or
      flags matches `references/cli-feature-baseline.md`; the baseline itself is no older than
      the installed `copilot --version`
- [ ] **Context efficiency** — Body is under 500 lines; heavy or conditional detail uses
      shallow references and deterministic work uses scripts
- [ ] **Dependency clarity** — Portable by default; unavoidable host/plugin/agent coupling is
      declared through compatibility and isolated
- [ ] **No persona content** — Skill defines HOW, not WHO — no identity statements
- [ ] **Security and trust** — Bundled scripts, dependencies, assets, external URLs, and input
      handling are unsurprising and least-privilege
- [ ] **Behavioral evidence** — Trigger, near-miss, outcome, baseline, and held-out tests are
      proportionate to the change risk
- [ ] **Documentation listed** — Skill appears in project documentation tables (if applicable)

### Step 4b: Audit Each Hook

For every `hooks.json` (plugin, repo, or user level), verify structure and safety. For
authoring detail, defer to the `hooks-crafting` skill.

- [ ] **`version: 1`** present and top-level `hooks` is an object keyed by event names
- [ ] **Valid event names** — only known events (`sessionStart`, `sessionEnd`, `userPromptSubmitted`, `userPromptTransformed`, `preToolUse`, `preMcpToolCall`, `postToolUse`, `postToolUseFailure`, `permissionRequest`, `agentStop`, `subagentStart`, `subagentStop`, `errorOccurred`, `preCompact`, `notification`) — no typos. PascalCase aliases exist for most but are **not** mechanical re-casing (`userPromptSubmitted` → `UserPromptSubmit`, `agentStop` → `Stop`); an unrecognised name silently never fires.
- [ ] **Valid type per entry** — `command` (default), `http`, or `prompt`
- [ ] **Command hooks** provide `bash` and/or `powershell` (or `command`) for cross-platform parity
- [ ] **HTTP hooks** set `url` using `https://` (required for `preToolUse`/`permissionRequest`); secrets only via `allowedEnvVars`
- [ ] **Prompt hooks** appear only on `sessionStart`
- [ ] **Reasonable `timeoutSec`** (default 30); referenced scripts exist, are executable, and have a shebang
- [ ] **Decision-returning hooks** emit single-line JSON and exit `0` (see `hooks-crafting` reference)
- [ ] **No secrets** echoed to stdout/stderr; not relied on as a hard security gate (failures are fail-open)
- [ ] **Untrusted payloads handled safely** — Parse JSON, quote values, avoid `eval` or dynamic
      shell construction, and allowlist privileged actions
- [ ] **Plugin consistency** — a plugin declaring `"hooks"` in `plugin.json` points it at the hooks JSON **file** (e.g. `"hooks/hooks.json"`, not the bare dir — a directory throws `EISDIR` at load time); hook indexed in the catalog (if applicable)

### Step 5: Check Separation of Concerns

| | Agent | Skill |
|---|---|---|
| **Defines** | WHO — persona, role, pipeline position | HOW — procedure, steps, checklists |
| **Contains** | Name, description, skill refs, scope and approval boundaries | Steps, commands, examples, when-to-use/skip |
| **References** | Points to skills for reusable procedure | Portable by default; declares unavoidable integration dependencies |

**Red flags:**

- Agent body has numbered workflow steps → extract to a skill
- Agent body duplicates reusable commands or workflows → extract them to a skill
- Skill hides a host/plugin/agent dependency → remove it or declare compatibility explicitly
- Same checklist appears in both agent and skill → deduplicate into the skill
- An agent lists many skills with ambiguous routing → group/rank them or split responsibilities;
  count alone is not a defect

### Step 6: Quality Scoring

Rate each agent and skill on a 0–5 scale across these dimensions:

**Agent quality dimensions:**

| Dimension | 0 (Poor) | 3 (Adequate) | 5 (Excellent) |
|-----------|----------|--------------|----------------|
| **Clarity** | No persona, vague purpose | Basic identity, some ambiguity | Crystal-clear role and domain |
| **Focus** | Multiple unrelated responsibilities | Mostly focused, minor scope creep | Single clear responsibility |
| **Separation** | Procedures embedded in body | Some duplication with skills | Clean delegation to skills |
| **Boundaries** | No scope definition | Partial or binary scope rules | Precise, testable approval tiers |
| **Frontmatter** | Missing or invalid | Valid but minimal | Complete with correct syntax |
| **Verification** | No behavioral checks | Ad hoc examples | Representative routing/trajectory tests across intended models |

**Skill quality dimensions:**

| Dimension | 0 (Poor) | 3 (Adequate) | 5 (Excellent) |
|-----------|----------|--------------|----------------|
| **Completeness** | Missing required sections | Has basics, gaps in procedure | All sections, thorough procedure |
| **Portability** | Hidden dependencies | Mostly standalone or partly declared | Reusable, or explicit and justified compatibility |
| **Actionability** | Vague prose | Some concrete steps | Clear numbered procedure with examples |
| **Accuracy** | Outdated/wrong references | Mostly current | All references verified and current |
| **Boundaries** | No when-to-use/skip | Basic triggers listed | Clear triggers with redirects |
| **Context Efficiency** | Bloated / deep refs | Acceptable but noisy | Lean body, shallow refs, scripts for deterministic work |
| **Security & Evaluation** | Unsafe or untested | Partial safeguards/tests | Least privilege plus baseline, near-miss, held-out checks |

**Hook quality dimensions:**

| Dimension | 0 (Poor) | 3 (Adequate) | 5 (Excellent) |
|-----------|----------|--------------|----------------|
| **Schema** | Invalid version/event/type | Valid but minimal | Valid, complete, correct fields per type |
| **Portability** | Single-shell only | One platform plus notes | `bash` and `powershell` parity, or justified single-platform |
| **Safety** | Unquoted input, `eval`, leaks secrets | Basic quoting | Parsed JSON, quoted values, allowlisted actions, no secret output |
| **Reliability** | No timeout, missing/non-executable script | Runs but slow or noisy | Sane `timeoutSec`, executable script with shebang, correct exit codes |
| **Wiring** | `plugin.json` points at a directory or missing file | Points at a file | Points at the hooks JSON file and is indexed in the catalog |

### Step 7: Refine

Fix issues found in steps 2–6:

1. Fix frontmatter errors (syntax, unsupported attributes, missing fields)
2. Extract duplicated procedures from agent bodies into skills
3. Add missing "When to Use" / "When to Skip" sections to skills
4. Remove stale file paths or command references
5. Split agents with too many responsibilities
6. Merge overlapping skills with similar procedures
7. Update documentation tables to match current inventory

Before applying:

1. Label each finding as **verified defect**, **evidence-backed risk**, or **recommendation**.
2. Use independent fresh-context review for schema, routing, security, or system-wide changes.
   For multi-model review, assign non-overlapping lenses and reconcile disagreements explicitly.
3. Run a different-model critique for every changed skill description.
4. Preserve human approval for deletions, splits/merges, commits, releases, and other
   irreversible actions unless the user explicitly authorized them.

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

| Agent | Clarity | Focus | Separation | Boundaries | Frontmatter | Verification | Avg |
|-------|---------|-------|------------|------------|-------------|--------------|-----|

| Skill | Completeness | Portability | Actionability | Accuracy | Boundaries | Context | Security/Evals | Avg |
|-------|--------------|-------------|---------------|----------|------------|---------|----------------|-----|

| Hook | Schema | Portability | Safety | Reliability | Wiring | Avg |
|------|--------|-------------|--------|-------------|--------|-----|

### Evidence
- Verified defects: [validator failures, broken references, schema mismatches]
- Evidence-backed risks: [session or evaluation evidence, with coverage/confidence]
- Recommendations: [reasoned improvements not yet evidenced as failures]

### Recommendations
- 💡 [suggestion with rationale]

### Actions Taken
- 🔧 [what was fixed in this audit]
- 🧪 [validation and representative behavioral evaluations run]
- 👤 [changes intentionally left uncommitted or awaiting approval]
```
