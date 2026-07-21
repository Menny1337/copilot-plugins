---
name: skill-crafting
description: "Guide for discovering existing Copilot Agent Skills and creating new ones. Use when asked to find, browse, or recommend skills, or when asked to create or scaffold a new skill. Covers skill file structure, frontmatter, description engineering, quality evaluation, context budget, and agent-vs-skill separation of concerns."
user-invocable: false
---

# How to Find and Create Skills

A practical workflow for locating existing Agent Skills and creating new ones.

## When to Use

- User asks to find, discover, browse, or recommend skills
- User asks how to create a skill or add new capabilities
- User wants to install a skill from another repository
- Evaluating whether something should be a skill vs. part of an agent

## When to Skip

- Creating or modifying agents — use `agent-crafting` instead
- Auditing existing skills for quality — use `agent-skill-audit` instead
- Application code changes — use domain-specific skills or agents

## Skill File Basics

### Location and Structure

<!-- validate:allow-user-paths -->

Skills live in a `skills/` directory with one folder per skill:

| Level | Path |
|-------|------|
| Repository | `.github/skills/<skill-name>/SKILL.md` |
| User (local) | `~/.copilot/skills/<skill-name>/SKILL.md` |
| Plugin | `<plugin-dir>/skills/<skill-name>/SKILL.md` (installed under `~/.copilot/installed-plugins/<marketplace>/<plugin>/`) |

Each skill folder contains:

```
<skill-name>/
├── SKILL.md          # Required — frontmatter + instructions
├── scripts/          # Optional — executable helpers for deterministic tasks
├── references/       # Optional — docs loaded into context on demand
├── templates/        # Optional — file templates
└── assets/           # Optional — images, diagrams, fonts
```

### Context Budget

Skills load in three levels — design with this in mind:

| Level | What | When Loaded | Budget |
|-------|------|-------------|--------|
| **Metadata** | `name` + `description` frontmatter | Always in context | ~100 words — keep tight |
| **Body** | SKILL.md content below frontmatter | When skill triggers | **< 500 lines ideal** |
| **Resources** | `scripts/`, `references/`, `assets/` | On demand by procedure steps | No hard limit — loaded as needed |

**Implications:**
- Keep SKILL.md body focused. If it exceeds 500 lines, move reference tables, schemas, or detailed examples into `references/` files and load them with explicit "Read `references/X`" steps.
- Scripts execute without being read into context — use them for deterministic tasks (validation, formatting, aggregation) rather than embedding complex logic in prose.
- The description is the only thing *always* visible to the model — it must do the heavy lifting for trigger accuracy.
- Keep reference hops shallow — link important files directly from `SKILL.md` instead of chaining references through multiple other reference files.
- Add a table of contents to reference files once they grow past ~100 lines so the model can preview the full shape of the file quickly.

### Frontmatter Reference

```yaml
---
name: <skill-name>
description: '<What it does>. Use when <triggers and keywords users might say>.'
allowed-tools: [Read, Grep]   # Optional
user-invocable: false
disable-model-invocation: false
---
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | **Yes** | Kebab-case (lowercase, hyphens, digits). Must match folder name. Max 64 chars. |
| `description` | string | **Yes** | 10–1024 characters. No angle brackets (`<>`). Describes purpose and trigger conditions. |
| `allowed-tools` | string[] | No | Restricts which tools may be used when the skill is active where supported. |
| `user-invocable` | boolean | No | Set `false` for skills only invoked by agents (not directly by users) |
| `disable-model-invocation` | boolean | No | Set `true` for manual-only workflows that should not auto-trigger. |

> **Portability note:** Claude Code exposes additional skill-frontmatter fields such as
> `argument-hint`, `context`, `agent`, `hooks`, and `model`. Copilot CLI currently uses a
> narrower subset. Prefer the core fields above unless you are targeting one host explicitly.
> Note that the Claude Code `hooks` *frontmatter field* is unrelated to Copilot's `hooks.json`
> lifecycle hook system — for that, see the `hooks-crafting` skill.

**Writing Effective Descriptions:**

The description is the primary trigger mechanism — it determines whether the skill activates. Models tend to *undertrigger* rather than overtrigger, so write descriptions that are assertive and keyword-rich.

**Formula:** `<What it does>. Use when <trigger conditions>. <Keywords the user might say>.`

**Phrasing rules:**
- Lead with a neutral capability statement in third-person or noun-phrase form; avoid first-person or second-person wording
- Include both positive triggers (when to use) and domain keywords
- Front-load the most important trigger words
- Keep it to 1–3 sentences, typically 30–80 words; expand only when trigger ambiguity justifies the extra tokens
- Quote the value in YAML to avoid parsing issues

**Example — Weak (undertriggers):**
```yaml
description: "How to build a dashboard."
```

**Example — Strong (triggers reliably):**
```yaml
description: "Creates data dashboards and visualizations. Use when the user mentions dashboards, data visualization, charts, metrics displays, internal analytics, KPI tracking, or wants to display company data visually, even if they do not explicitly ask for a dashboard."
```

**Anti-patterns to avoid:**
- Vague descriptions: "helps with stuff", "useful tool"
- Implementation-focused: "Uses React and D3" (describe the *problem*, not the *solution*)
- Too narrow: only triggers on exact phrasing
- Missing domain synonyms: users say "graph" not just "chart"

## Skill Categories

Understanding what *type* of skill you're building shapes design, testing, and maintenance:

| Type | What It Does | Durability | Maintenance Signal |
|------|-------------|------------|-------------------|
| **Capability Enhancement** | Extends what the model can do (e.g., PDF form filling, data extraction, complex formatting) | May become obsolete as models improve | If agents start doing this without the skill, consider retiring it |
| **Workflow / Preference** | Encodes organization-specific processes (e.g., PR review checklist, deploy procedure, NDA workflow) | Durable — processes outlive model upgrades | Update when the process itself changes |

**Why this matters:**
- Capability skills need periodic review — the model may learn to do it natively
- Workflow skills need process fidelity — they must match how the team actually works
- When in doubt, ask: "Would a better model still need this?" If yes → workflow. If maybe not → capability.

## Step 1: Check What Already Exists

Before creating a new skill, check for existing ones:

```bash
# Repo-level skills
find .github/skills -name 'SKILL.md' -exec head -5 {} \; 2>/dev/null

# User-level skills
find ~/.copilot/skills -name 'SKILL.md' -exec head -5 {} \; 2>/dev/null
```

Scan each SKILL.md frontmatter to understand coverage and avoid duplicates.

## Step 2: Find Skills in Other Repositories

Search GitHub for skills to install or learn from:

**Search patterns:**

```
path:.github/skills SKILL.md
"name:" "description:" path:SKILL.md
path:SKILL.md "When to Use"
topic:copilot-skills
```

**Refine by domain:**

```
path:SKILL.md "When to Use" testing
path:SKILL.md "When to Use" deployment
path:SKILL.md "When to Use" documentation
```

Group results by category when browsing (testing, docs, devops, security, platform, etc.).

## Step 3: Evaluate Skill Quality

Quick quality checklist before installing or using a skill:

- [ ] Has valid YAML frontmatter with `name` and `description`
- [ ] Description explains WHAT it does and WHEN to use it
- [ ] Has "When to Use" and "When to Skip" sections
- [ ] Instructions are step-by-step and actionable (not just prose)
- [ ] Self-contained — works without depending on a specific agent
- [ ] References are current — file paths, commands, and URLs still valid
- [ ] Recent activity — repo shows signs of maintenance

**Avoid skills with:**
- Empty or placeholder body content
- Vague descriptions ("helps with stuff")
- Hardcoded secrets, tokens, or credentials
- Dependencies on specific agents (breaks reusability)
- Outdated API references or deprecated patterns

## Step 4: Install a Skill

1. Copy the skill folder into the target location:
   - Repo-level: `.github/skills/<skill-name>/`
   - User-level: `~/.copilot/skills/<skill-name>/`
   - Plugin: add a directory under your plugin's `skills/<skill-name>/` and list the plugin in `marketplace.json`
2. Ensure `SKILL.md` frontmatter `name` matches the folder name
3. Verify `description` is 10–1024 characters
4. Validate frontmatter (use repo validator if available)
5. Update documentation tables if the project tracks skills

## Step 5: Create a New Skill

### 5a: Decide If It Should Be a Skill

Use this decision matrix:

| Question | Yes → Skill | No → Something Else |
|----------|-------------|---------------------|
| Is it a reusable procedure? | ✅ Skill | Agent body or documentation |
| Can multiple agents use it? | ✅ Skill | Agent-specific section |
| Is it step-by-step and actionable? | ✅ Skill | Reference doc or README |
| Does it define HOW, not WHO? | ✅ Skill | Agent (defines WHO) |
| Would a human find it useful standalone? | ✅ Skill | Agent-internal logic |

### 5b: Capture Intent

Before writing a single line, answer these four questions:

| Question | What It Drives |
|----------|---------------|
| **What should this skill enable an agent to do?** | Scope of the SKILL.md body |
| **When should it trigger (and NOT trigger)?** | The `description` frontmatter and "When to Use/Skip" sections |
| **What is the expected output or behavior?** | Procedure steps, success criteria, examples |
| **What edge cases and dependencies exist?** | Error handling, tool requirements, environment assumptions |

**If the user already demonstrated the workflow** (e.g., "turn what I just did into a skill"), extract:
- The steps they performed, in order
- Tools and commands they used
- Corrections they made mid-process (these reveal edge cases)
- Patterns or decisions they repeated

**Probe for gaps before writing:**
- What input formats does this handle? What formats would break it?
- What happens when a step fails? Should the skill recover or abort?
- Does this require specific tools, CLIs, or environment setup?
- Are there existing skills that overlap? How should they be disambiguated?

### 5c: Write the Skill

Create `<location>/skills/<skill-name>/SKILL.md`:

```markdown
---
name: <skill-name>
description: '<What it does>. Use when <triggers>.'
user-invocable: false
---

# <Skill Title>

<One-line summary of what this skill provides.>

## When to Use

- <Specific trigger condition 1>
- <Specific trigger condition 2>
- <Specific trigger condition 3>

## When to Skip

- <Condition where this skill is wrong> — use `<correct-skill>` instead
- <Condition where no skill is needed>

## Procedure

### Step 1: <First Action>

<Clear instructions with examples>

### Step 2: <Second Action>

<Clear instructions with examples>

...

## References (optional)

- [Link to relevant documentation](https://...)
```

### 5d: Required Sections

Every skill MUST have:

| Section | Purpose |
|---------|---------|
| **When to Use** | Trigger conditions — when should an agent invoke this skill? |
| **When to Skip** | Anti-triggers — when should an agent NOT use this skill? Include redirects. |
| **Procedure** | Step-by-step instructions — the core value of the skill |

Optional but recommended:

| Section | Purpose |
|---------|---------|
| **References** | Links to external documentation, APIs, or standards |
| **Examples** | Concrete examples of input/output or before/after |
| **Troubleshooting** | Common problems and solutions |

### 5e: Quality Standards

- **Actionable** — Every step should be something the agent can execute, not just advice
- **Self-contained** — Skill works without reading any agent file
- **Focused** — One skill = one procedure. If it does two unrelated things, split it.
- **Accurate** — All file paths, commands, URLs, and API references are current
- **Redirecting** — "When to Skip" always tells the user what to do instead
- **Agent-independent** — Never reference a specific agent by name in the procedure

## Step 6: Verify

**Frontmatter validation:**
- [ ] `name` is kebab-case (lowercase letters, hyphens, digits only), max 64 characters
- [ ] `name` matches the folder name exactly
- [ ] `description` is 10–1024 characters, no angle brackets (`<>`)
- [ ] `description` uses imperative phrasing and includes trigger keywords
- [ ] YAML parses cleanly (quote strings, check for special characters)

**Structure validation:**
- [ ] Has "When to Use" section with specific trigger conditions
- [ ] Has "When to Skip" section with redirects to correct alternatives
- [ ] Procedure is step-by-step and actionable (not just advice)
- [ ] No references to specific agents by name (agent-independent)
- [ ] All file paths, commands, and URLs are valid and current

**Context budget validation:**
- [ ] SKILL.md body is under 500 lines (move heavy content to `references/`)
- [ ] Large tables, schemas, or reference data live in `references/` with explicit load instructions
- [ ] Scripts handle deterministic tasks rather than embedding complex logic in prose

**Integration validation:**
- [ ] Frontmatter validation passes (if validator script available)
- [ ] Documented in project tables (if the project tracks skills)
- [ ] Test the trigger — verify the skill activates on expected prompts and does NOT activate on unrelated prompts

### 6b: Run a Lightweight Skill Quality Scorecard

Before calling a new skill done, score it on five dimensions using a simple 0–2 scale:

| Dimension | 0 | 1 | 2 |
|-----------|---|---|---|
| **Trigger Precision** | Fires vaguely or unpredictably | Mostly right, some ambiguity | Clear should-trigger and should-not-trigger behavior |
| **Scope Tightness** | Multiple unrelated jobs | Mostly focused | One crisp reusable procedure |
| **Outcome Verifiability** | Success is subjective or unstated | Partial checks exist | Clear success checks or validation loop |
| **Context Efficiency** | Bloated body / deep references | Acceptable but noisy | Lean body, shallow references, heavy content offloaded |
| **Reusability** | Agent- or repo-specific by accident | Some reusable parts | Self-contained and portable across agents |

Interpretation:
- **9–10** — Ready to ship
- **7–8** — Good, but tighten the weak spots
- **0–6** — Rework before adding more content

Minimum test set:
- **2 should-trigger prompts**
- **2 should-not-trigger prompts**
- **2 representative outcome tasks** with explicit success checks

## Step 7: Iterate and Improve

Skills are not write-once artifacts. When improving a skill based on observed behavior:

**Generalize, don't overfit**
Edits must improve behavior across many prompts, not just the one that revealed the problem. Ask: "Will this change help for inputs I haven't seen yet?"

**Keep it lean**
Remove instructions that produce unproductive behavior. Check agent transcripts, not just outputs — if an instruction causes the agent to waste tokens on unnecessary work, cut it.

**Explain the why, not just the what**
Prefer explaining reasoning over rigid `ALWAYS`/`NEVER` directives. Agents follow reasoned instructions more reliably than arbitrary rules.

> **Instead of:** `"ALWAYS use exactly 3 bullet points"`
>
> **Write:** `"Use bullet points for scanability — typically 3-5 items. Fewer if each point is complex, more if they're simple."`

**Bundle repeated work**
If agents using the skill independently perform the same setup step (creating a helper function, parsing a config, building a boilerplate), extract it into `scripts/` or `templates/` so the skill provides it directly.

**Strengthen the description**
If the skill undertriggers (doesn't activate when it should), add domain synonyms and broaden trigger keywords. If it overtriggers (activates incorrectly), sharpen the scope language and add "not for X" qualifiers.

## Agent vs Skill — Separation of Concerns

| | Agent (`.agent.md`) | Skill (`SKILL.md`) |
|---|---|---|
| **Defines** | WHO — persona, role, pipeline position | HOW — self-contained procedure and knowledge |
| **Contains** | Name, description, skill references, scope boundaries | Steps, commands, checklists, when-to-use/skip, examples |
| **References** | Points to skills for procedure | Does NOT reference or depend on any agent |
| **Tone** | Identity and personality | Neutral and procedural |
| **Reusability** | Tied to a specific role | Reusable by any agent or human |

**Rules:**
- Never duplicate workflow steps or checklists in both agent and skill
- The skill is the single source of truth for procedure — the agent says "follow skill X"
- Skills must be self-contained and reusable (another agent or a human could use it)
- Agents define identity and orchestration (when they run, what they can/can't touch)

**Example — Good:**
```markdown
# Agent file
## Skills
- **code-review** — follow the full procedure defined in this skill
## Scope Boundaries
- DO: Review code for quality issues
- DO NOT: Modify application code
```

**Example — Bad (duplicated logic):**
```markdown
# Agent file
## Workflow              ← duplicates skill!
1. Check for DRY violations
2. Review naming conventions
3. Score complexity
## Checklist             ← duplicates skill!
- [ ] All functions under 50 lines
```

## Tips

- **Search by problem, not solution** — "improve test coverage" not "jest skill"
- **Prefer focused skills** — one skill per procedure, not mega-skills
- **Update don't duplicate** — merge overlapping skills instead of creating similar ones
- **Description is discovery** — write descriptions with the keywords users would search for; be assertive to combat undertriggering
- **Test the trigger** — after creating a skill, verify it activates on expected prompts *and* stays silent on unrelated ones
- **Version awareness** — note when a skill depends on specific tool versions or APIs
- **Know your type** — capability skills may become obsolete as models improve; workflow skills need process fidelity
- **Respect the context budget** — a 500-line skill body + loaded references is more effective than a 1000-line monolith
- **Extract from history** — if a user already demonstrated a workflow, mine it for steps, corrections, and patterns before writing
