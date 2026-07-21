# Agent/Skill Change Log

Hypothesis log for the **skill-improvement-loop**. One entry per cycle (one unit, one
root-cause layer, one patch). Keep entries summarized and redacted — no raw prompts,
secrets, customer data, or proprietary code. Store this file in a durable location
independent of the reviewed unit (e.g. `~/.copilot/memory/skill-improvement-loop.md` or a
repo-local reviewed file).

## Entry template

Copy this block for each new cycle.

```markdown
### <YYYY-MM-DD> — <target-unit-name>

- **Status:** open | closed
- **Target type:** agent | skill
- **Target unit:** `<plugin>/agents/<name>` | `<plugin>/skills/<name>`
- **Observed signal:** <what went wrong> (counts: <N sessions / M hits>)
- **Evidence grade:** direct | strong-inferred | weak-inferred
- **Coverage note:** <local-only? cloud available? date range, repo, sessions scanned>
- **Root-cause layer:** discovery | procedure | agent-orchestration | tool/platform | structural
- **Proposed change:** <one targeted edit; what and where>
- **Approved by:** <human> on <date>   _(loop applies changes only after approval)_
- **Applied:** <yes/no, date> · validation: <passed/failed>
- **Expected effect / metric:** <which signal should drop, and how it's measured>
- **Baseline window:** <start>..<change-date> (pre-change hits: <n>)
- **Confounders to watch:** <model/version, agent used, repo changes, other edits, task-mix shift, store coverage>
- **Review-due date:** <YYYY-MM-DD>

#### Re-review (<review date>)
- **Post-change window:** <change-date>..<now> (post-change hits: <n>, samples: <n>)
- **Confounders observed:** <...>
- **Verdict:** consistent-with-improvement | no-clear-change | possible-regression | insufficient-evidence | invalid-hypothesis
- **Action:** keep | revert | follow-up patch (new cycle) | extend review window
- **Lesson distilled to memory:** <yes/no — link or summary, redacted>
```

## Worked example

```markdown
### 2026-05-29 — narrate

- **Status:** open
- **Target type:** skill
- **Target unit:** `core-skills/skills/narrate`
- **Observed signal:** users re-asked for an "audio summary" and the skill did not engage (4 sessions)
- **Evidence grade:** strong-inferred
- **Coverage note:** local store only (cloud 404); last 30 days; 1,704 sessions scanned
- **Root-cause layer:** discovery
- **Proposed change:** add "audio summary", "listenable version", "read this to me" to the description triggers
- **Approved by:** <reviewer> on <date>
- **Applied:** yes, 2026-05-29 · validation: passed
- **Expected effect / metric:** drop in sessions where "audio summary" appears with no narrate invocation
- **Baseline window:** 2026-04-29..2026-05-29 (pre-change hits: 4)
- **Confounders to watch:** model version, task-mix shift toward docs work
- **Review-due date:** 2026-06-03
```
