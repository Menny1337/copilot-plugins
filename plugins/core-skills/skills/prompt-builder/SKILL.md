---
name: prompt-builder
description: "Turns a plain-language situation and goal into a well-engineered prompt for an AI agent. Use when the user wants help writing, drafting, improving, or structuring a prompt, says I want the agent to do X, give me a prompt for, help me ask an AI to, write a prompt that, or describes a coding/agentic task they want to hand to another agent (a coding assistant, Copilot, Claude, a sub-agent). Keywords: prompt, prompt engineering, write a prompt, craft a prompt, meta-prompt. Not for creating or modifying Copilot skill or agent definition files (use skill-crafting or agent-crafting)."
argument-hint: "<what you want an AI agent to do>"
user-invocable: true
---

# Prompt Builder

Transforms a user's described situation and desired outcome into a clear,
structured, copy-pasteable prompt that reliably steers an AI agent. The input is
informal ("I have a huge NPM→PNPM PR, help the agent shrink it"); the output is an
engineered prompt the user can hand to a coding or agentic AI.

This is a meta-skill: you are not *doing* the user's task, you are *writing the
prompt* that will make another agent do it well.

**Safety boundary:** Don't construct prompts whose purpose is to evade safety
policies, extract secrets, deceive users, or cause harm. If the request points that
way, steer it toward the benign, legitimate version of the goal or decline.

## When to Use

- The user asks you to write, draft, craft, improve, or rewrite a prompt.
- The user describes a situation plus what they want an agent to do, and wants a
  prompt for it ("I have X, I want the agent to Y — give me a prompt").
- The user is about to delegate a coding or research task to another AI (Copilot,
  Claude, ChatGPT, a sub-agent) and wants the instructions to be effective.
- The user has a prompt that "isn't working" and wants it diagnosed and tightened.

## When to Skip

- The user wants *you* to actually perform the task, not write a prompt for it —
  just do the task (or use the relevant domain skill).
- Authoring a Copilot **skill** or **agent** definition file — use `skill-crafting`
  or `agent-crafting` instead (those have their own frontmatter rules).
- A one-line factual question that needs an answer, not a prompt.

## Core Model: What Makes a Good Agent Prompt

Every strong prompt assembles up to seven building blocks. Include the ones the
task needs; omit the rest. Order them roughly as below.

| Block | Purpose | Skip when |
|-------|---------|-----------|
| **Role** | One line framing who the agent is ("You are a senior build engineer"). Focuses tone and judgment. | Task is trivial |
| **Task / Objective** | The single clear outcome, stated up front and specifically. | Never — always required |
| **Context** | Background the agent can't infer: repo, stack, why this matters, what's been tried. | Agent already has it |
| **Instructions / Steps** | Ordered actions when sequence or completeness matters. Numbered list. | Open-ended creative task |
| **Constraints** | Hard rules and scope: what to touch, what not to touch, limits, standards. | None apply |
| **Output format** | Exactly what to return (PR plan, diff, table, file, prose). | Default output is fine |
| **Success criteria** | How the agent (and user) knows it's done right; how to verify. | Trivial task |

Provide examples (1–5, wrapped in tags) when output shape, tone, or edge-case
handling matters — they steer more reliably than description alone.

## Best-Practice Rules (apply while writing)

These are distilled from established prompt-engineering guidance. Apply them to
the prompt you produce:

1. **Be specific and direct.** Vague in → vague out. State the desired output and
   constraints explicitly. If "above and beyond" effort is wanted, say so.
2. **Give the *why*.** Explaining motivation ("we need to merge with confidence
   because it's a risky migration") lets the agent generalize correctly, far better
   than a bare command.
3. **Say what TO do, not what NOT to do.** Prefer "respond with flowing prose" over
   "don't use bullet points." Positive framing is followed more reliably.
4. **Scope explicitly.** Modern agents follow instructions literally and won't
   silently generalize. "Apply this to every file, not just the first" beats
   assuming.
5. **Front-load and specify everything up front.** For agentic/coding tasks, put the
   task, intent, and constraints in the first message. Underspecified prompts drip-fed
   over many turns waste effort and reduce quality.
6. **Use structure.** Separate sections with headers or XML-style tags
   (`<context>`, `<task>`, `<constraints>`, `<output_format>`) so the agent parses
   them unambiguously. For long inputs (logs, files), put the bulk data near the top
   and the instruction at the end.
7. **Use examples for format/tone.** Wrap them in `<example>` tags; make them
   relevant and diverse.
8. **Define done.** Give success criteria and a verification step ("ensure the test
   suite passes", "list the assumptions you made").
9. **Start simple, leave room to iterate.** Don't over-engineer; produce the
   minimum that's specific enough, and tell the user what to tune.

The deeper technique catalog, anti-patterns, and more worked examples live in
[`references/techniques.md`](references/techniques.md). Read it when the task is
unusual (long-context, classification, multi-agent fan-out) or the user asks why a
choice was made.

## Procedure

### Step 1: Extract the four essentials

From the user's description, identify:
- **Situation / context** — what they have (the PR, the codebase, the problem).
- **Goal** — what they want the agent to achieve.
- **Target agent** — who runs the prompt (a coding agent, a chat model, a
  sub-agent). Affects tone, tool assumptions, and length. Assume a capable coding
  agent if unstated.
- **Output they expect** — a plan, a diff, a refactor, an analysis, a file.

### Step 2: Fill the gaps — ask only if it blocks quality

If a *critical* unknown would change the prompt materially (e.g. "should the agent
actually split the PR or just propose how?", "is there a CI/test suite?",
"hard constraints like don't touch lockfiles?"), ask the user one short, focused
clarifying question. Otherwise, make a sensible assumption and **list it** in the
output so the user can correct it. Do not interrogate the user for trivia.

> **If the user brought an existing prompt to fix:** first diagnose the failure
> mode before rewriting — unclear or buried task, missing context, unscoped
> instructions, negative-only constraints, no output format, no success criteria,
> or bloat. Then apply Steps 3–5. The full diagnostic checklist is in
> [`references/techniques.md`](references/techniques.md).

### Step 3: Select the building blocks

Map the essentials onto the seven blocks above. Decide which to include, draft the
Task line first (it anchors everything), then context, instructions, constraints,
output format, and success criteria. Add a role only if it sharpens behavior.

### Step 4: Write the prompt

Assemble the blocks applying the best-practice rules. Use tag-delimited sections
for anything non-trivial. Keep it as short as it can be while staying specific —
every sentence should earn its place.

### Step 5: Deliver

Return, in this order:
1. The finished prompt in a single fenced code block, ready to copy.
2. A short **Assumptions** list (what you inferred; tell them to correct any).
3. A one-line **How to iterate** note (what to tweak if the first run misses).

Keep your own surrounding commentary brief — the prompt is the product.

## Worked Example

**User input:** "I have a big PR that migrates from NPM to PNPM and it changed a
lot of files. I want the agent to think of ways we can reduce the size of the PR
so we can push it through with confidence."

**Your output (the prompt):**

```text
You are a senior build/release engineer reviewing a large, risky migration PR.

<context>
We have an open pull request that migrates our monorepo from npm to pnpm. It
touches a large number of files (lockfile, package.json files across packages,
CI config, scripts, and import/build tweaks). A single huge PR is hard to review
and risky to merge. We want to merge the migration with high confidence.
</context>

<task>
Propose concrete strategies to reduce the size and risk of this PR by splitting it
into smaller, independently reviewable and mergeable pieces — without breaking the
build at any intermediate step.
</task>

<instructions>
1. Categorize the changes into logical groups (e.g. tooling/config, lockfile,
   per-package manifest changes, CI, codemods/scripts).
2. For each group, say whether it can be merged independently before the cutover,
   and in what order, so main stays green at every step.
3. Identify which changes are mechanical/codemod-able vs. ones needing human review.
4. Call out the smallest possible "cutover" PR that actually flips npm→pnpm, and
   what must land before it.
5. Flag the riskiest changes and how to de-risk them (feature flag, canary, extra
   tests, manual verification).
</instructions>

<constraints>
- Do not propose changes that would leave main unbuildable between PRs.
- Prefer reversible, incremental steps over a single big-bang merge.
- Assume reviewers have limited time; optimize for small, focused diffs.
</constraints>

<output_format>
A sequenced merge plan: a numbered list of PRs, each with its scope, dependencies,
risk level, and how to verify it. End with the recommended order and any open
questions.
</output_format>

Before finalizing, briefly state any assumptions about our setup you had to make.
```

**Assumptions:** monorepo; CI exists; goal is a *plan*, not the agent performing
the split. Correct me if the agent should actually do the splitting.

**How to iterate:** if you want it to execute rather than plan, change the Task to
"Implement the following split…" and add tool/repo access details.

---

For more examples (refactor, bug hunt, research, classification) and the full
technique catalog, see [`references/techniques.md`](references/techniques.md).
