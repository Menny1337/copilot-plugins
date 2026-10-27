---
name: skill-improvement-loop
description: "Improves agents or skills using observed session evidence. Use for triggering issues, procedure-adherence gaps, repeated tool failures, user corrections, feedback loops, and regression checks."
user-invocable: false
compatibility: "Requires Copilot session history and session_store_sql; local deep validation expects Copilot session-state event logs."
---

# Skill improvement loop

Use observed sessions to propose a change, record its hypothesis, and review it
after deployment. Each empirical cycle covers one unit, one root-cause layer,
and one patch.

## When to Use

- Investigate triggering, adherence, or outcome problems in an agent or skill.
- Follow recurring errors or user corrections to their owner.
- Re-review a deployed change when its review date arrives.

## When to Skip

- Broad architect maintenance: use `agent-architect-self-audit`.
- Static quality, overlap, inventory, or split/merge/retire decisions: use `agent-skill-audit`.
- New skills or frontmatter mechanics: use `skill-crafting`.
- New agents or agent fixes without session evidence: use `agent-crafting`.
- Application code, tests, and configuration are outside this loop.
- Without authorized session access or the Phase C evidence threshold, keep monitoring.

## Procedure

Apply changes only after explicit approval from a named human. An explicitly
authorized `scheduled-skill-review` run may instead use validated AUTO-DEPLOY
and AUTO-REVERT. Evidence never grants deployment or rollback authority.

In scheduled mode, deployment means committing on the unit branch, merging to
`main`, pushing, and running `plugins-update`. AUTO-REVERT reverts the deployed
commit, pushes `main`, and runs `plugins-update` again. Keep durable cycle
records and notifications so deployments remain traceable and reversible.

### Phase A: Harvest signals

Use `session_store_sql` and adapt the queries in
[session-signal-queries.md](references/session-signal-queries.md). For agents,
also read [agent signals](../scheduled-skill-review/references/agent-signals.md).
Look for missed or excessive activation, ignored procedures, incorrect outcomes,
retry clusters, and user corrections.

Grade each finding:

- Direct: observed actions or explicit feedback. A missed trigger is direct only
  when the user explicitly says the unit should have been used.
- Strong-inferred: task meaning matches the description/examples, the unit's
  procedure or tools are absent, and the outcome shows the missing behavior.
- Weak-inferred: keyword similarity alone. Inspect it; never edit from this alone.

Record source availability, date range, repository filter, sessions scanned,
and relevant sample counts. Label local-only coverage. The local store lacks
tool-level `events` and `tool_requests` tables. Where access is authorized,
validate candidate sessions against complete
`~/.copilot/session-state/<id>/events.jsonl` logs before downgrading evidence.
Follow the reference's "Local deep-validation via `events.jsonl`" and "Backend
availability & dialect" sections. Tool calls can establish direct action/error
evidence; they cannot make an inferred missed trigger direct. If logs are
unavailable or inconclusive, retain weak inference for unverified candidates.

Persist only counts, summaries, and redacted excerpts. Exclude raw prompts,
secrets, names/customer identifiers, and proprietary code.

### Phase B: Diagnose the root-cause layer

| Layer | Owner and action |
| --- | --- |
| Discovery | Description frontmatter. Propose clearer triggers/boundaries; use `skill-crafting`'s description critique for skills. |
| Skill procedure | Skill body, references, or scripts. Repair the unclear, missing, or wrong step. |
| Agent orchestration | Agent body. Use `agent-crafting` for scope, skill references, delegation, or instruction conflicts. |
| Tool/platform | External tooling, permissions, limits, or outages. Log the blocker; do not edit the unit. |
| Structural ecosystem | System overlap or duplication. Hand off to `agent-skill-audit`. |

Report or hand off findings outside the current unit. Edit the owning agent only
in a separately authorized agent cycle; do not patch a skill to compensate.
Gather more evidence when the responsible layer is unclear. Tool failures alone
are not unit failures.

### Phase C: Propose one patch (apply on approval)

Require roughly three relevant sessions or a clearly repeated pattern; a single
anecdote is insufficient. Present
counts, evidence grade, root cause, proposed diff, rationale, and expected
effect with its metric. Prefer reasoned guidance over blanket rules.

Preserve the current definition as a baseline. Follow the
[shared outcome contract](../skill-crafting/references/evaluation.md#verify-task-completion)
for artifact/state readback, forbidden actions, same-case and held-out comparisons,
repeated critical runs, and individual regressions. Include discovery near-misses
or procedure/orchestration trajectories as appropriate. Run available behavioral
evaluations and structural checks; cover supported model families/tiers and
record untested coverage.

Use `multi-model-review` for independent fresh-context review of routing,
security, or governance changes. It owns panel selection and synthesis.
Skill descriptions need `skill-crafting`'s different-vendor critique; agent
descriptions follow `agent-crafting`'s behavioral and independent-review guidance.

After approval, apply and validate frontmatter with the repository validator.
In scheduled mode, run this sequence before committing the content:

```bash
node scripts/catalog.mjs
node scripts/plugin-readme.mjs
node scripts/validate.mjs
node scripts/catalog.mjs --check
node scripts/plugin-readme.mjs --check
```

Any generator/check failure stops publication. Report it without committing the
failed change. Use accurate Conventional Commit types: `feat` selects minor;
`fix`, `docs`, `refactor`, `chore`, and other nonbreaking types select patch;
`!` or a `BREAKING CHANGE:` footer selects major. In versioned repositories,
run the version tool separately on a clean tree after the content commit
(for example, `node scripts/version.mjs apply`). Never hand-edit release versions
or release changelogs. The daemon handles this at integration.

### Phase D: Log the hypothesis

Use [the entry template](templates/skill-change-log.md) in a durable location
outside the reviewed unit: authorized shared memory at
`~/.copilot/memory/skill-improvement-loop.md`, or a repo-local reviewed file.
Do not assume an agent-specific workspace. Record the hypothesis, baseline,
approval/deployment state, uncertainties, and review-due date. Keep evidence
pointers private and stored content redacted.

### Phase E: Re-review on the due date

Reopen the entry and compare relevant post-deployment sessions with its baseline.
Start the window at `deployed_at`, when the actual `plugins-update` made the
change live, never at commit or merge time.

Record samples and comparable denominators, verified outcomes, constraint
violations, and new failures under the shared outcome contract. Missing outcome
evidence stays unknown. Note confounders: model/version, active agent, repository
changes, other edited units, task mix, and coverage limits.

Require about 3-5 relevant post-change samples before judging, except for a clear,
severe regression. Use noncausal verdicts:

| Verdict | Meaning |
| --- | --- |
| Consistent with improvement | Enough samples; verified outcomes satisfy constraints, target signal decreased, no regression or obvious confounder. |
| No clear change | Enough samples and required outcome evidence; no measurable difference. |
| Possible regression | Target or adjacent failures increased; takes precedence over signal or cost gains. |
| Insufficient evidence | Too few relevant samples or missing required artifact/state evidence; extend the window and set a new due date. |
| Invalid hypothesis | Evidence points to another unit, tool, or task mix. |

For possible regression, propose a revert or follow-up patch in a new cycle.
Apply it through the approval workflow above; authorized scheduled AUTO-REVERT
remains the exception. Do not claim the edit caused the observed result.

### Phase F: Distill the lesson

For durable, supported lessons, use the `memory` skill within authorized
`~/.copilot/memory/` access. Save a redacted failure pattern, helpful change,
and rationale. Close the changelog entry.
