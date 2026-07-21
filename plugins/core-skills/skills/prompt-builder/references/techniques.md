# Prompt Builder — Technique Catalog & Examples

Extended reference for the `prompt-builder` skill. Load this when the task is
unusual, when the user asks *why* a choice was made, or when you need a second
worked example to model the output on.

## Contents
- Technique catalog (by goal)
- Prompt anti-patterns
- Reusable prompt skeleton
- Worked examples (refactor, bug hunt, research, extraction/classification,
  multi-agent fan-out)
- Diagnosing a prompt that "isn't working"

---

## Technique Catalog (by goal)

| You want… | Technique | How |
|-----------|-----------|-----|
| Reliable output format | Few-shot examples | Give 1–5 `<example>` blocks mirroring the real case; vary them to cover edge cases. |
| Better reasoning on hard tasks | Encourage step-by-step thinking | "Think through the problem before answering," or ask for a short plan first. |
| Unambiguous parsing | Tag/section structure | Wrap each content type in its own tag: `<context>`, `<task>`, `<constraints>`, `<output_format>`, `<example>`. |
| Correct behavior, not just compliance | Give the motivation | Explain *why* the rule exists; the model generalizes from intent. |
| Predictable scope | Explicit scoping | State exactly what to touch and not touch; agents follow literally and won't infer breadth. |
| Consistent persona/tone | Role prompt | One sentence: "You are a …". Sets judgment and voice. |
| Good results on long inputs | Data-at-top layout | Put large documents/logs near the top, the instruction at the end; ask it to quote relevant parts first. |
| Verifiable completion | Success criteria | Define "done" and a verification step (tests pass, list of changed files, self-check). |
| Avoid a known failure | Positive instruction | Say what to do instead of what to avoid. |
| Tune effort vs. speed | Set expectations | Say whether you want a quick scoped answer or thorough, above-and-beyond work. |

## Prompt Anti-Patterns

- **Vagueness** — "Improve this code." Improve how? Toward what? Specify the goal.
- **Negative-only instructions** — a wall of "don't do X" leaves the desired path
  undefined. Pair every prohibition with the positive alternative.
- **Buried task** — the actual ask hidden in paragraph three. Lead with it.
- **Kitchen-sink context** — irrelevant detail dilutes the signal. Include only
  what changes the answer.
- **No definition of done** — the agent stops at its own arbitrary point.
- **Over-engineering** — a 600-word prompt for a 10-second task. Match effort to
  the task; start simple and iterate.
- **Drip-feeding** — handing an agentic task in fragments across many turns. Put the
  full spec in the first message.

## Reusable Prompt Skeleton

Copy and delete unused blocks:

```text
You are <role — one line, optional>.

<context>
<background the agent can't infer: stack, repo, what's been tried, why it matters>
</context>

<task>
<the single clear objective, stated specifically>
</task>

<instructions>
1. <ordered step>
2. <ordered step>
</instructions>

<constraints>
- <hard rule / scope: touch this, never that, limits, standards>
</constraints>

<output_format>
<exactly what to return and in what shape>
</output_format>

<examples>  <!-- optional, when format/tone matters -->
<example>
input: ...
output: ...
</example>
</examples>

Success criteria: <how the agent knows it's done correctly; verification step>.
```

---

## Worked Examples

### 1. Refactor a messy module

```text
You are a senior software engineer doing a focused refactor.

<context>
The file src/payments/checkout.js is 800 lines, mixes validation, API calls, and
UI state, and has no tests. We're about to add a new payment provider and need it
maintainable first.
</context>

<task>
Refactor checkout.js into cohesive modules with clear responsibilities, preserving
all existing behavior exactly.
</task>

<instructions>
1. Propose a target module breakdown before editing; wait for nothing — proceed if
   it's clearly better.
2. Extract pure logic from side effects.
3. Add unit tests for the extracted pure functions.
</instructions>

<constraints>
- Do not change public function signatures used outside this file.
- No behavior changes — refactor only.
</constraints>

<output_format>
The refactored files, plus a short summary of what moved where and any risks.
</output_format>

Success criteria: existing tests still pass and behavior is unchanged; new pure
functions have tests.
```

### 2. Hunt a bug

```text
You are a debugging specialist.

<context>
Users intermittently get logged out after ~5 minutes. It started after PR #482
(session refactor). Repro is flaky. Stack: Node/Express, Redis-backed sessions.
</context>

<task>
Find the root cause of the premature logouts and propose the smallest correct fix.
</task>

<instructions>
1. Form hypotheses ranked by likelihood given the timing and the implicated PR.
2. For each, state what evidence in the code or logs would confirm or rule it out.
3. Investigate the top hypotheses and identify the root cause.
4. Propose the minimal fix and how to verify it.
</instructions>

Report every plausible cause you find, including low-confidence ones, with a
confidence level — don't filter prematurely. Output: ranked findings, the
identified root cause, and the proposed fix.
```

### 3. Research / evaluation task

```text
You are a pragmatic staff engineer evaluating options.

<task>
Recommend a background-job library for our Python/FastAPI service: Celery vs RQ vs
Dramatiq vs Arq.
</task>

<context>
~10k jobs/day, mostly I/O-bound; we already run Redis; team is small and values
operational simplicity over raw throughput.
</context>

<output_format>
A comparison table (maturity, ops complexity, throughput, Redis fit, community),
then a one-paragraph recommendation with the main trade-off, then what would change
the recommendation.
</output_format>

Base claims on current, citable sources; flag anything you're unsure about.
```

### 4. Extraction / classification (few-shot)

```text
<task>
Classify each support ticket as: bug, feature_request, billing, or other. Return
only the label.
</task>

<examples>
<example>
ticket: "The export button does nothing on Safari."
label: bug
</example>
<example>
ticket: "Can you add dark mode?"
label: feature_request
</example>
<example>
ticket: "I was charged twice this month."
label: billing
</example>
</examples>

ticket: "{{TICKET_TEXT}}"
label:
```

### 5. Multi-agent / sub-agent fan-out

```text
You are an orchestrator coordinating sub-agents.

<task>
Audit our three services (auth, billing, notifications) for missing input
validation and report consolidated findings.
</task>

<instructions>
1. Spawn one sub-agent per service to scan its handlers for unvalidated inputs.
2. Give each sub-agent the service path and the exact checklist of validation
   issues to look for.
3. Merge results, deduplicate, and rank by severity.
</instructions>

<output_format>
A single table: service, file:line, issue, severity, suggested fix.
</output_format>
```

---

## Diagnosing a Prompt That "Isn't Working"

When the user brings an existing prompt that misbehaves, check in this order:

1. **Is the task stated clearly and first?** Move it up; make it specific.
2. **Is scope explicit?** Add what to touch / not touch; the agent may be
   generalizing or under-reaching.
3. **Are there negative-only instructions?** Convert to positive form.
4. **Is "done" defined?** Add success criteria and a verification step.
5. **Is there missing context the agent can't infer?** Add the stack, the why, the
   prior attempts.
6. **Is the output format specified?** Pin it down with a shape or an example.
7. **Is it bloated?** Cut irrelevant context that dilutes the signal.

Then hand back the rewritten prompt plus a one-line note on what you changed and
why, so the user learns the pattern.
