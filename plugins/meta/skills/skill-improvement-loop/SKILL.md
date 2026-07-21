---
name: skill-improvement-loop
description: "Improves agents or skills using observed session evidence. Use for triggering issues, procedure-adherence gaps, repeated tool failures, user corrections, feedback loops, and regression checks."
user-invocable: false
compatibility: "Requires Copilot session history and session_store_sql; local deep validation expects Copilot session-state event logs."
---

# Skill Improvement Loop

A closed, evidence-based loop for evolving a single agent or skill: mine already-happened
sessions for where it underperformed, **propose** one targeted change, log a
hypothesis, and **re-review the change later** to confirm it helped or revert it.

This is empirical (what real sessions show), not structural. It complements static
review — it does not replace it.

> **Governance first.** This loop proposes changes and applies them only after human
> approval. It never silently rewrites agents or skills. Observational session data is treated
> as evidence with uncertainty, never as proof.

## Autonomous mode (scheduled-skill-review)

When driven by the `scheduled-skill-review` daemon, the Phase C human-approval gate
is replaced by validated AUTO-DEPLOY followed by post-deploy Phase E review:

- "Applied" means committed on the unit's branch, then merged to `main`, pushed, and
  made live with `plugins-update` after validation passes.
- AUTO-REVERT handles regressions by reverting the deployed commit, pushing `main`,
  and running `plugins-update` again.
- The safety net is git-tracked reversibility plus durable cycle records and
  notifications, not a pre-apply human yes/no.
- All other governance still holds: one change per unit per cycle, evidence grading,
  non-causal verdicts, and redaction/privacy.

## When to Use

- You want to learn from sessions that already happened and improve an agent or skill from that evidence
- A unit seems to underperform: it did not trigger when it should have, its procedure was ignored, or its output was wrong
- Recurring tool errors, retries, or user corrections ("no, do X instead") point at a unit
- You made an earlier agent or skill edit and a review is now due to check whether it helped

## When to Skip

- **Static structural quality** (frontmatter validity, inventory, duplication, split/merge/retire, quality scoring) — use `agent-skill-audit` instead
- **Creating a brand-new skill** or editing frontmatter mechanics — use `skill-crafting`
- **Creating a brand-new agent or fixing one without session evidence** — use `agent-crafting`
- You have no access to session history, or fewer than ~3 relevant sessions exist — there is not enough signal; keep monitoring
- Application code, tests, or config work — out of scope

## Core Principles

- **One unit, one layer, one patch per cycle.** Bundled edits cannot be evaluated later.
- **Uncertainty is first-class.** Session mining is observational, not a controlled experiment. Use candidate signals, evidence grades, and non-causal verdicts.
- **Propose, then apply on approval.** Avoid low-quality agent or skill drift from weak inference.
- **Generalize, don't overfit.** A change must help inputs you have not seen — not just the one session that revealed the problem.
- **Not every failure belongs to the reviewed unit.** The fix may belong to another unit, the tooling, or the system structure (see Phase B).
- **Privacy.** Persist only summarized signals, counts, and redacted excerpts — never raw prompts, secrets, customer data, or proprietary code.

## The Loop

```
A. Harvest signals → B. Diagnose root-cause layer → C. Propose one patch (apply on approval)
→ D. Log hypothesis (+ review-due date) → [days later] E. Re-review → F. Distill lesson
```

### Phase A — Harvest Signals

Query the session history to find where the target behavior went wrong. Use the
`session_store_sql` tool. Representative queries live in
`references/session-signal-queries.md` — read that file and adapt the queries. When reviewing
an agent, also read `../scheduled-skill-review/references/agent-signals.md` for agent-specific
routing and orchestration signals.

Signal types to look for:

| Signal | What it looks like |
|--------|--------------------|
| **Missed-trigger candidate** | Task matched an agent or skill, but that unit or its procedure was never used |
| **Over-trigger / near-miss** | Unit activated for an adjacent task where another unit or no specialization was appropriate |
| **Adherence gap** | Unit selected, but its instructions or procedure were not followed |
| **Correctness gap** | Procedure followed, but the outcome was still wrong |
| **Error/retry cluster** | Repeated failed tool calls or retries around a task type |
| **User correction** | User pushed back ("no", "that's wrong", "you should have…", "why didn't you…") |

**Missed-trigger detection is the hardest signal — there is no log line for a unit
that never fired.** Treat it as a *candidate*, not a proven miss, and grade the evidence:

- **Direct** — user explicitly says the agent or skill should have been used. Trustworthy.
- **Strong-inferred** — task text matches the unit's description/examples, there is no trace of its instructions, procedure, or tools, and the outcome shows the missing behavior. Reasonable basis for a proposal.
- **Weak-inferred** — keyword similarity only. Inspect manually; never edit from this alone.

**Record an evidence-coverage note** for the harvest: source (local store only / cloud
available?), date range, repository filter, and number of sessions scanned. If the
cloud session store is unavailable, you are seeing local history only — say so. The
`session_store_sql` local store lacks tool-level tables (`events`, `tool_requests`), **but
the full per-session event log lives on disk** at
`~/.copilot/session-state/<id>/events.jsonl` (assistant turns, every tool call + its
arguments, success/failure). **Before downgrading any signal to weak-inferred, deep-validate
the candidate sessions against `events.jsonl`** — tool-error and "what the agent did" signals
become **direct** evidence, a missed-trigger can reach **strong-inferred** (direct only if the
user explicitly said the unit should have been used), and it catches false positives that
keyword text would miscount. Validate the log is complete first, and cap at weak-inferred only
when `events.jsonl` is unavailable or inconclusive. See the *Local deep-validation via
`events.jsonl`* and *Backend availability & dialect* sections of
`references/session-signal-queries.md`.

### Phase B — Diagnose the Root-Cause Layer

Classify each problem. The layer determines the fix — and whether the fix even belongs
in the reviewed unit:

| Root cause | Fix target | Action |
|------------|-----------|--------|
| **Discovery** — agent or skill didn't trigger when it should | `description` frontmatter | Propose clearer triggers and boundaries; for skills, run the description critique in `skill-crafting` |
| **Skill procedure** — skill triggered but steps are unclear, incomplete, or wrong | skill body / `references/` / `scripts/` | Propose a targeted procedure edit |
| **Agent orchestration** — wrong scope, missing skill reference, bad delegation, conflicting instructions | agent body | Propose a targeted agent edit (see `agent-crafting`); do not misattribute it to a reviewed skill |
| **Tool / platform** — failures from tool limits, permissions, outages, rate limits | external | Do not edit the unit; log the blocker |
| **Structural ecosystem** — overlap, duplication, should split/merge/retire | the system | Hand off to `agent-skill-audit` |

Misdiagnosing the layer produces the wrong fix. If the evidence is ambiguous between
two layers, stop and gather more signal rather than guessing.

When the reviewed unit is an agent, agent-orchestration findings are actionable here
as edits to that agent file, guided by `scheduled-skill-review`'s
`references/agent-signals.md`. When the reviewed unit is a skill, keep the existing
rule: do not edit the skill for an agent-layer problem.

### Phase C — Propose One Patch (apply on approval)

- Require a **minimum signal threshold** before proposing: roughly **≥3 relevant
  sessions** or one clearly repeated pattern. A single anecdote is not enough.
- Draft exactly **one** change addressing **one** layer.
- Present: the observed signal (with counts), the root-cause layer, the proposed diff,
  the rationale, and the **expected effect** (which signal should drop, and how you'll
  measure it).
- Prefer reasoned guidance over rigid `ALWAYS`/`NEVER` rules — agents follow reasoned
  instructions more reliably.
- Preserve the current unit as a baseline. Test the proposal on the same representative
  cases plus held-out sessions or prompts that did not shape the diagnosis. Include
  semantically close near-misses for discovery changes, and inspect trajectories/tool calls
  for procedure or orchestration changes.
- Run the repository's available behavioral evaluations in addition to structural validation.
  For units intended to work across model families or tiers, test each supported target.
- Use independent fresh-context review for routing, security, or governance changes. Skill
  descriptions require the different-model critique in `skill-crafting`; agent descriptions
  follow the behavioral and independent-review guidance in `agent-crafting`.
- **Apply only after explicit human approval.** After applying, run frontmatter
  validation (the repo validator if available, e.g. `node scripts/validate.mjs`). In
  autonomous mode, "apply" means commit on the unit's branch; the daemon merges and
  deploys only if `node scripts/validate.mjs` and `node scripts/catalog.mjs --check`
  pass.
- **Mind version governance.** If the repo versions its content (e.g. per-plugin
  `plugin.json` + a marketplace manifest + per-plugin `CHANGELOG.md`, gated in CI),
  the version bump follows the content commit — do **not** hand-edit version/changelog
  files. Use an accurate Conventional Commit *type*, since the bump level is derived
  from it (`feat` → minor; `fix`/`docs`/`refactor`/`chore`/… → patch; `!` or a
  `BREAKING CHANGE:` footer → major). Apply the bump separately on a clean tree after
  the content commit (e.g. `node scripts/version.mjs apply`); under the daemon this is
  done automatically at integration.

### Phase D — Log the Hypothesis

Append an entry to a durable changelog stored independently of the reviewed unit using
`templates/skill-change-log.md`. Preferred locations:

- Shared memory for cross-session continuity: `~/.copilot/memory/skill-improvement-loop.md`
- Or a repo-local reviewed file if the project wants versioned governance

Do not assume or hard-code a specific agent's workspace. Each entry records: target
unit and type, date, observed signal + counts, evidence grade + coverage note, root-cause
layer, the change (or proposal), expected effect/metric, confounders to watch, and a
**review-due date** (the "few days later" checkpoint). Store summarized, redacted
signals only.

### Phase E — Re-Review on the Due Date

When the review-due date arrives, reopen the changelog entry and judge honestly. When
driven by the daemon, the re-review window opens at the change's DEPLOY time
(`deployed_at` = when `plugins-update` made it live), not at commit/merge time, because
live sessions only exercise the change after deployment.

1. Pull sessions **since the change** that exercised the target unit (see the
   post-change queries in the relevant reference file).
2. Compare against the **pre-change baseline window** recorded in the entry; record
   sample counts on both sides.
3. **Record confounders** that could explain the difference instead of your edit:
   model/version changes, which agent ran, major repo changes, other edited skills or
   agents, a shift in task mix, and session-store coverage limits.
4. Assign a verdict using **non-causal language** — never claim the edit "caused" the
   result:

| Verdict | Meaning |
|---------|---------|
| **Consistent with improvement** | Enough post-change samples; target signal decreased; no obvious confounder explains it |
| **No clear change** | Enough samples, no measurable difference |
| **Possible regression** | Target or an adjacent failure increased |
| **Insufficient evidence** | Too few relevant sessions — keep monitoring, set a new due date |
| **Invalid hypothesis** | Root cause turned out to be another unit, tool, or task-mix rather than the reviewed unit |

Require a **minimum post-change sample** (≈3–5 relevant sessions) before any verdict
other than a clear, severe regression. On *possible regression*, propose a revert or a
follow-up patch (new cycle). On *insufficient evidence*, extend the review window.

### Phase F — Distill the Lesson

For confirmed, durable lessons only, write a concise pattern into `~/.copilot/memory/`
(see the `memory` skill): the failure mode, the fix that helped, and why. **Redact**
names, secrets, customer identifiers, and proprietary snippets before persisting. Mark
the changelog entry closed.

## Anti-Patterns

- Editing an agent or skill from a single session or weak-inferred similarity
- Claiming the edit "fixed" something a few days later (causal language) — use the verdict taxonomy
- Bundling multiple changes so the result can't be attributed
- Editing the reviewed unit when the real problem is another unit, the tooling, or system structure
- Copying raw session text, prompts, or secrets into the changelog or memory
- Treating local-only session history as if it were the complete record

## References

- `references/session-signal-queries.md` — adaptable `session_store_sql` queries for harvest and re-review
- `templates/skill-change-log.md` — agent-or-skill hypothesis/changelog entry template
