---
name: skill-crafting
description: "Finds, evaluates, creates, and refines Copilot Agent Skills. Use for skill discovery or installation, SKILL.md and frontmatter design, trigger descriptions, progressive disclosure, security review, and behavioral evaluation."
user-invocable: false
---

# How to Find and Create Skills

A practical workflow for locating existing Agent Skills and creating new ones.

Frontmatter fields, discovery locations, and install commands are version-sensitive. Check
`../agent-skill-audit/references/cli-feature-baseline.md` before relying on memory, and
refresh it when it falls behind `copilot --version`.

## When to Use

- User asks to find, discover, browse, or recommend skills
- User asks how to create a skill or add new capabilities
- User wants to install a skill from another repository
- Evaluating whether something should be a skill vs. part of an agent

## When to Skip

- Creating or modifying agents — use `agent-crafting` instead
- Auditing existing skills for quality — use `agent-skill-audit` instead
- Packaging skills into a plugin or marketplace — use `plugin-crafting` instead
- Application code changes — use domain-specific skills or agents

## Skill File Basics

### Location and Structure

<!-- validate:allow-user-paths -->

Skills live in a `skills/` directory with one folder per skill:

| Level | Path |
|-------|------|
| Repository | `.github/skills/<skill-name>/SKILL.md`, `.claude/skills/`, `.agents/skills/` |
| User (local) | `~/.copilot/skills/<skill-name>/SKILL.md`, `~/.agents/skills/` |
| Plugin | `<plugin-dir>/skills/<skill-name>/SKILL.md` (installed under `~/.copilot/installed-plugins/<marketplace>/<plugin>/`) |
| Custom | Any directory registered with `copilot skill add <directory>` |
| Built-in | Ships with the CLI |

`copilot skill list` reports the origin of each skill as one of `project`, `inherited`,
`personal-copilot`, `personal-agents`, `plugin`, `custom`, or `builtin`.

When the same skill name exists in several locations, the winner is resolved
`project` > `plugin-dir` > personal (`~/.copilot`, `~/.agents`) > `custom` (CLI 1.0.55).
Same-named skills from *different plugins* coexist instead of colliding (1.0.66).

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

The portable Agent Skills standard requires `name` and `description`. Add optional fields
only when they communicate a real dependency or governance requirement:

```yaml
---
name: <skill-name>
description: '<What it does>. Use when <triggers and keywords users might say>.'
license: MIT
compatibility: Requires git and network access
allowed-tools: Read Grep
---
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | **Yes** | Portable authoring target: 1–64 lowercase alphanumeric characters or hyphens; no leading, trailing, or consecutive hyphen; must match the folder name. This marketplace uses ASCII kebab-case. |
| `description` | string | **Yes** | 1–1024 characters. Describes purpose and trigger conditions. |
| `license` | string | No | SPDX identifier or reference to a bundled license file. |
| `compatibility` | string | No | Host, package, operating-system, or network requirements. Max 500 characters. |
| `metadata` | map | No | String key/value metadata for supporting clients; **unsupported in this scalar-only marketplace** until its parser accepts nested maps. |
| `allowed-tools` | space-separated string | No | Experimental portable field for tools auto-approved while the skill is active. See the security warning below. |
| `user-invocable` | boolean | No | Defaults to `true`. Set `false` to hide the skill from slash-command invocation, leaving it model-only. |
| `disable-model-invocation` | boolean | No | Defaults to `false`. Set `true` so the model cannot auto-invoke it and the user must call it explicitly. Fully honored since CLI 1.0.74. |
| `argument-hint` | string | No | Freeform hint describing expected arguments, shown during slash-command completion. Copilot CLI 1.0.64+. Only meaningful when the skill is user-invocable. |

> **`allowed-tools` is a security decision, not a convenience.** It removes the confirmation
> step for the tools it names. GitHub's documentation warns explicitly against pre-approving
> `shell` or `bash`: doing so lets a malicious skill — or a prompt injection reaching one —
> run arbitrary terminal commands with no prompt. Omit them unless you have read the skill and
> every script it references, and you trust its source.
>
> **Use the portable scalar form.** The 1.0.83-5 CLI bundle contains an internal built-in
> skill with `allowed-tools` expressed as a YAML array, so the runtime accepts that shape in
> at least one internal path. The Agent Skills specification and GitHub's authored examples
> define a space-separated scalar, which is the interoperable form and the only form accepted
> by this marketplace's scalar-only parser.

> **Host differences:** `argument-hint` is supported on Copilot **skills**, but ignored on
> Copilot **agents** (it is VS Code-only there) — an easy trap. Claude Code additionally
> exposes `context`, `agent`, `hooks`, and `model` on skills; verify the target host before
> using those. The Claude Code `hooks` frontmatter field is unrelated to Copilot's
> `hooks.json` lifecycle system.
>
> **Runtime tolerance is broader than the portable target.** The repository's
> probe-backed contract recorded on July 25, 2026 for CLI 1.0.75 found that the
> runtime accepted uppercase letters, underscores, dots, spaces, and a
> frontmatter/folder mismatch. That behavior was not re-probed for 1.0.83-5.
> Author new skills to the portable rule above, but do not reject a third-party
> skill solely for using a runtime-tolerated name.
>
> **This marketplace is scalar-only:** its generators accept only single-line top-level
> scalar values. Do not add nested `metadata` maps or YAML arrays here until the repository
> parser explicitly supports them.

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
- Redundant: the description is *always* in context, so every word costs budget on every turn — cut anything that doesn't improve triggering or comprehension

**Critique the description before saving — required on every create OR change.**

The description is the only always-loaded text, so redundancy costs budget every turn. Delegate this to the `multi-model-review` skill at panel size 1: one critic from a *different vendor family* than the author, with the lens set to description tightening and the four cut-tests below as the rubric. Give that critic the draft `description`, **the skill's purpose**, and the cut-tests — it cannot judge trigger accuracy without knowing what the skill is for. Authors rarely catch their own redundancy, which is precisely why the reviewer must sit outside the author's family. This is a **rewrite lens**, so the critic returns the tightened description plus what it cut and why — not that skill's finding shape, rubric, or synthesis steps. If no cross-family sub-agent is available, self-review instead and note that it was not independent.

> **Retrieval may be semantic.** Copilot CLI 1.0.66 added a persisted `dynamicRetrieval`
> setting (and `--dynamic-retrieval skills=<on|off>`) that retrieves skills using embeddings
> rather than name and description matching alone. Keep writing descriptions for trigger
> accuracy — they still drive routing and are still the always-loaded text — but do not assume
> exact keyword overlap is the only path to being selected.

Four cut-tests (the reviewer applies them too):

1. **Strip implementation detail** — drop internal mechanics that don't aid discovery (subprocess/threading models, framework names, file/script paths, UI labels, data-file names); they belong in the body, not the always-loaded description.
2. **De-duplicate lead vs. triggers** — cut any `Triggers:`/`Keywords:` entry that just restates the lead; keep only terms adding a *distinct* search word (synonym, alternate phrasing, tool/domain noun).
3. **De-duplicate within triggers** — collapse near-synonyms (e.g. "review skills that were used" vs "which skills were used") to one.
4. **Make every remaining word earn its place** — if removing a phrase doesn't reduce trigger coverage or comprehension, remove it; prefer the shortest description that still triggers.

Then re-check it still triggers: the lead must convey *what it does* and the keywords must cover the distinct ways users ask. You own the final wording — accept the reviewer's cuts only where none lose a real trigger.

## Skill Categories

Understanding what *type* of skill you're building shapes design, testing, and maintenance:

| Type | What It Does | Durability | Maintenance Signal |
|------|-------------|------------|-------------------|
| **Capability Enhancement** | Extends what the model can do (e.g., PDF form filling, data extraction, complex formatting) | May become obsolete as models improve | If agents start doing this without the skill, consider retiring it |
| **Workflow / Preference** | Encodes organization-specific processes (e.g., PR review checklist, deploy procedure, NDA workflow) | Durable — processes outlive model upgrades | Update when the process itself changes |

**Why this matters:** capability skills need periodic review (the model may learn to do it
natively); workflow skills need process fidelity. When in doubt ask: "would a better model
still need this?" Yes → workflow. Maybe not → capability.

## Step 1: Check What Already Exists

Before creating a new skill, list everything already loaded — across project, plugin,
personal, custom, and built-in sources — and check for overlap:

```bash
copilot skill list            # add --json for scripting
```

Scan each description to understand coverage and avoid duplicates.

## Step 2: Find Skills in Other Repositories

Start with the purpose-built channels, then fall back to code search.
`gh skill` requires **GitHub CLI v2.90.0+** — older versions fail with
`unknown command "skill" for "gh"`, so check `gh --version` first.

```bash
gh skill search <query>      # search published agent skills
gh skill install <skill>     # install one
gh skill update <skill>      # update it later
gh skill publish             # publish your own
```

The public directory is <https://awesome-copilot.github.com/skills/>. The CLI's own
`copilot plugin marketplace browse awesome-copilot` lists what a marketplace offers.

**Search patterns:**

```
path:.github/skills SKILL.md          # skills in repos
path:SKILL.md "When to Use"           # add a domain word: testing, deployment, docs…
topic:copilot-skills                  # tagged repositories
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
- [ ] Security reviewed — bundled scripts, dependencies, assets, and external URLs match the stated purpose

**Avoid skills with:**
- Empty or placeholder body content
- Vague descriptions ("helps with stuff")
- Hardcoded secrets, tokens, or credentials
- Dependencies on specific agents (breaks reusability)
- Outdated API references or deprecated patterns
- Unexpected network calls, broad file access, dynamic shell construction, or opaque binaries

## Step 4: Install a Skill

1. Treat the skill like software: inspect every bundled file, script, dependency, and external
   URL. Prefer trusted, versioned sources; do not install it if behavior exceeds the stated purpose.
2. Install it with the CLI rather than copying folders by hand:

   ```bash
   copilot skill add <FILE | URL | DIRECTORY>          # add a skill
   copilot skill add --project <FILE | URL>            # copy into .github/skills/
   copilot skill list [--json]                         # confirm it loaded, with source
   copilot skill remove <NAME | DIRECTORY>             # remove it again

   copilot plugins install --skill <FILE | URL>                    # installs for the user
   copilot plugins install --skill --scope project <FILE | URL>    # into .github/skills/
   ```

   Installing a **file or URL** copies the content; installing a **directory** registers it as
   a custom skill source instead. `--scope` accepts `user` (default) or `project`, and applies
   only to file or URL installs. In session, `/skills` (alias `/skill`) offers `list`, `info`,
   `add`, `remove`, and `reload` — `/skills reload` picks up a skill added mid-session without
   restarting. Plugin skills must be managed through their plugin; `/skills info` shows which
   plugin a skill came from. The direct command uses `--project`; the cross-kind
   `copilot plugins install --skill` form uses `--scope project`.

   For a skill authored inside this marketplace, no install step is needed: add the directory
   under your plugin's `skills/<skill-name>/` and list the plugin in `marketplace.json`.
3. Ensure `SKILL.md` frontmatter `name` matches the folder name.
4. Verify `description` is non-empty and at most 1024 characters.
5. Validate frontmatter (use the repository validator if available).
6. Update documentation tables if the project tracks skills.

## Step 5: Create a New Skill

### 5a: Decide If It Should Be a Skill

Use this decision matrix:

| Question | Yes → Skill | No → Something Else |
|----------|-------------|---------------------|
| Is it a reusable capability or focused workflow? | ✅ Skill | Agent body or documentation |
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

Define a small eval set **before drafting instructions**:

- 2 prompts that should trigger the skill
- 2 semantically close near-misses that should not trigger it
- 2 representative outcome tasks with explicit success criteria

For a substantive revision, preserve the old version as the baseline and keep at least one
held-out case that did not shape the edit.

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

The frontmatter description is the authoritative routing surface. Keep body-level
"When to Use" and "When to Skip" sections concise: clarify boundaries and redirects rather
than repeating the full metadata keyword list.

Optional but recommended:

| Section | Purpose |
|---------|---------|
| **References** | Links to external documentation, APIs, or standards |
| **Examples** | Concrete examples of input/output or before/after |
| **Troubleshooting** | Common problems and solutions |

### 5e: Quality Standards

- **Actionable** — Every step should be something the agent can execute, not just advice
- **Self-contained** — Skill works without reading any agent file
- **Focused** — One skill should have one clear purpose or outcome. Split unrelated domains.
- **Accurate** — All file paths, commands, URLs, and API references are current
- **Redirecting** — "When to Skip" always tells the user what to do instead
- **Portable by default** — Avoid agent-specific coupling. If an integrated workflow
  necessarily depends on a named host, plugin, or agent, declare the compatibility and keep
  the coupling explicit and isolated.
- **Secure and unsurprising** — Treat inputs and external content as untrusted; quote shell
  values, avoid dynamic command construction, minimize permissions, and keep behavior within
  the description's stated purpose.
- **Appropriate freedom** — Use flexible guidance where several approaches are safe, and
  deterministic scripts or exact commands where mistakes are costly.

## Step 6: Verify

**Frontmatter validation:**
- [ ] For a skill being authored or made portable, `name` is 1–64 lowercase letters/digits/hyphens, has no edge or doubled hyphen, and matches the folder name; when auditing third-party runtime compatibility, record broader CLI-tolerated names separately instead of treating this authoring target as a universal rejection rule
- [ ] `description` is 1–1024 characters
- [ ] `description` is third-person, states what and when, and includes distinct trigger keywords
- [ ] `allowed-tools`, if present, is a space-separated scalar rather than a YAML array, and does not pre-approve `shell` or `bash`
- [ ] `argument-hint`, if present, is on a user-invocable skill (it is inert otherwise)
- [ ] Host-specific fields are supported by the intended runtime
- [ ] `description` critiqued for redundancy by a sub-agent from a different vendor family (no implementation detail, no triggers that merely restate the lead or each other) — see "Critique the description before saving"
- [ ] YAML parses cleanly (quote strings, check for special characters)

**Structure validation:**
- [ ] Has "When to Use" section with specific trigger conditions
- [ ] Has "When to Skip" section with redirects to correct alternatives
- [ ] Procedure is step-by-step and actionable (not just advice)
- [ ] Dependencies are absent or explicitly declared and justified
- [ ] All file paths, commands, and URLs are valid and current
- [ ] Bundled scripts, dependencies, assets, and external content pass a security/trust review

**Context budget validation:**
- [ ] SKILL.md body is under 500 lines (move heavy content to `references/`)
- [ ] Large tables, schemas, or reference data live in `references/` with explicit load instructions
- [ ] Scripts handle deterministic tasks rather than embedding complex logic in prose

**Integration validation:**
- [ ] Frontmatter validation passes (if validator script available)
- [ ] Documented in project tables (if the project tracks skills)
- [ ] Run the predeclared trigger, near-miss, and outcome tests
- [ ] For substantive revisions, compare against the previous version on the same cases and reserve held-out cases to detect overfitting
- [ ] Test critical workflows on every intended model family or tier

### 6b: Run a Lightweight Skill Quality Scorecard

Before calling a new skill done, score it on six dimensions using a simple 0–2 scale:

| Dimension | 0 | 1 | 2 |
|-----------|---|---|---|
| **Trigger Precision** | Fires vaguely or unpredictably | Mostly right, some ambiguity | Clear should-trigger and should-not-trigger behavior |
| **Scope Tightness** | Multiple unrelated jobs | Mostly focused | One clear reusable purpose |
| **Outcome Verifiability** | Success is subjective or unstated | Partial checks exist | Clear success checks or validation loop |
| **Context Efficiency** | Bloated body / deep references | Acceptable but noisy | Lean body, shallow references, heavy content offloaded |
| **Reusability** | Agent- or repo-specific by accident | Some reusable parts | Self-contained and portable across agents |
| **Security & Trust** | Surprising or unsafe behavior | Risks noted but incomplete | Least privilege, trusted dependencies, safe input handling |

Interpretation:
- **11–12** — Ready to ship
- **9–10** — Good, but tighten the weak spots
- **0–8** — Rework before adding more content

Minimum test set:
- **2 should-trigger prompts**
- **2 semantically close near-misses that should not trigger**
- **2 representative outcome tasks** with explicit success checks

## Step 7: Iterate and Improve

Skills are not write-once artifacts. For evidence-driven refinement from observed session
behavior — harvesting signals, diagnosing the root-cause layer, and re-reviewing for
regressions — use the `skill-improvement-loop` skill rather than repeating its procedure here.

Four rules specific to editing skill text:

- **Generalize, don't overfit.** An edit must improve behavior across many prompts, not just
  the one that revealed the problem. Reserve held-out cases and compare against the prior version.
- **Explain the why, not just the what.** Agents follow reasoned instructions more reliably than
  arbitrary rules. Instead of `"ALWAYS use exactly 3 bullet points"`, write `"Use bullet points
  for scanability — typically 3-5 items. Fewer if each point is complex, more if they're simple."`
- **Bundle repeated work.** If agents using the skill keep performing the same setup step, extract
  it into `scripts/` or `templates/` so the skill provides it directly.
- **Tune the description by failure mode.** Undertriggering → add domain synonyms and broaden
  keywords. Overtriggering → sharpen scope language and add "not for X" qualifiers.

## Agent vs Skill Boundary

Agents define WHO: role, identity, orchestration, and approval boundaries. Skills define HOW:
procedures, commands, examples, and reusable knowledge. Use the Step 5a matrix when the
boundary is ambiguous. Keep the skill as the single source of truth for reusable procedure,
never duplicate a workflow or checklist across an agent and a skill, keep skills portable by
default while declaring unavoidable integration dependencies, and keep agents focused on
identity, routing, ownership, and limits.

> **Same-named skills now coexist.** Since CLI 1.0.66 two plugins may each ship a skill called
> `deploy`; the runtime disambiguates them with an `invocationName`. Loading no longer breaks,
> but duplicate names are still ambiguous for users, so prefer distinct names. A marketplace
> may enforce uniqueness as governance — that is a house rule, not a CLI constraint.

## Tips

- **Search by problem, not solution** — "improve test coverage" not "jest skill"
- **Update don't duplicate** — merge overlapping skills instead of creating similar ones
- **Be assertive in descriptions** — timid wording is the most common cause of undertriggering
- **Version awareness** — note when a skill depends on specific tool versions or APIs
- **Know your type** — capability skills may become obsolete as models improve; workflow skills need process fidelity
- **Extract from history** — if a user already demonstrated a workflow, mine it for steps, corrections, and patterns before writing

## References

- [Agent Skills specification](https://agentskills.io/specification)
- [Anthropic: Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [OpenAI: Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
