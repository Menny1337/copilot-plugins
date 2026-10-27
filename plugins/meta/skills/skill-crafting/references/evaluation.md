# Evaluate a skill change

Read when planning or completing checks for an authored skill. Select checks
by the changed behaviour and risk; do not turn a prose correction into an
unrelated full-suite run.

## Contents

- Define cases before drafting
- Verify task completion
- Compare the relevant alternatives
- Structural checks
- Context and outcome checks
- Independent review
- Optional quality scorecard
- Finish or report the blocker

## Define cases before drafting

For a new skill or substantive revision, include at least:

- two prompts that should trigger it
- two semantically close prompts that should use another skill or no skill
- two outcome tasks with explicit success criteria

Keep the previous definition as a baseline and reserve a held-out case that
does not shape the edit. Use synthetic data when private evidence is outside
scope. Existing published examples are regression cases, not held-out evidence.

For spelling or other non-behavioural changes, use the applicable structural
checks. Explain when behavioural coverage is unavailable; do not claim it from
a clean linter or a critic's opinion.

## Verify task completion

Make verified task completion the primary measure. For each outcome case,
record the requested result, required constraints, forbidden actions, and the
evidence that would establish success before running it. For a substantive
change, select affected cases from the shared end-to-end set and the owning
skills' focused cases. Suite maintainers can start with around ten examples
covering cross-skill chains and recovery, not only isolated subtasks. Creating
or running the whole suite is not a gate on every edit. Keep private inputs
and outputs out of shipped examples.

Check the resulting artifact or authoritative system state, not just the final
message, chosen route, tool exit code, or review score. Use a scoped readback:
a draft must contain the intended content; shutdown must leave the owned
process absent; a publication must exist at the returned destination. Check
persistence when the task requires it. Verification must not introduce new
mutations, broaden data access, or bypass approvals merely to produce evidence.

Record each case as pass, fail, partial, blocked, or not run, with its evidence.
A pass requires the outcome and constraints to hold; missing evidence is not
a pass. Repeat critical cases at least twice and retain failed attempts.
Inspect the trajectory for omitted steps, lost constraints, unauthorized
actions, and cleanup, including when the final answer looks correct.

Keep the evidence record compact:

| Field | Record |
| --- | --- |
| Case and attempt | Task, expected state, forbidden actions, baseline or held-out status |
| Conditions | Source revision, model/effort, tools, relevant environment, and input |
| Result | Status, artifact/state readback, constraint violations, and evidence pointer |
| Overhead | Elapsed time, agent calls/handoffs, tokens or cost when available |

Use redacted summaries in durable records and authorized private artifacts for
details. Mark unavailable measurements explicitly. A shared suite needs a named
maintainer and one integrated result; local skill scores cannot stand in for it.

## Compare the relevant alternatives

For a substantive revision, compare old and new definitions on the same cases.
When assessing whether a capability skill still adds value, also try the task
without that skill. A no-skill baseline must retain the same safety,
authorization, and repository constraints.

Keep model, effort, tools, inputs, and success criteria comparable. Record any
differences. Test the critical cases on the intended models available to the
run, including a different family or tier when the skill is shared. Mark
unexercised targets as untested.

For an agent-to-skill migration, compare the existing delegated path with the
main loop loading the skill and tools. Change one capability at a time. Include
each dependent chain and must-not-break rule, then inspect individual
pass-to-fail and fail-to-pass changes. A better average or faster run does not
clear a failed requirement. Retain the old source and a rollback path until the
replacement is verified; record unresolved tradeoffs rather than claiming
equivalence. Use [loop design](../../agent-crafting/references/advanced-topics.md#choose-the-context-boundary)
to choose what to compare.

Observe the execution, not just the answer: chosen skill, loaded references,
tool calls, output artifact, approval compliance, and completion. A written
walkthrough is not an executed outcome test. Use existing evaluators or fresh
task agents; do not install a framework merely to score prose.

## Structural checks

Use the repository's existing validator for frontmatter and packaging. Confirm:

- portable names and description limits, with runtime tolerance assessed separately
- single-line values and repository-specific parser restrictions
- required use, skip, and procedure sections
- declared dependencies and justified tool authority
- live local reference paths, shallow routing, and no duplicated procedures
- descriptions reviewed using `references/descriptions.md`
- safe, unsurprising bundled scripts, assets, and external dependencies

Use current supported documentation/help for changed platform claims. Record
which claims you checked; do not upgrade a whole baseline from a partial check.

## Context and outcome checks

Measure the root and the references needed for representative task paths.
Report bytes, lines, or tokens with the unit named. Do not call fewer bytes
lower latency without measuring latency.

Try a small edit and a more complex workflow. The small edit should not
require unrelated docs, installation, or testing. The complex workflow must
still reach its specified result, including affected validation and recovery.

Shorter is useful only if the skill preserves correctness, legitimate routing,
approval boundaries, and the task's completion criteria.

## Independent review

Use `multi-model-review` for routing, schema, security, governance, or
system-wide changes. It owns panel size, independence, and synthesis.
Description tightening is a separate cross-vendor rewrite run, not a substitute
for substantive review.

Wording-only edits that preserve task boundaries use the description critique
and relevant cases. A change to routing boundaries or cross-unit selection
also needs the judging panel; do not label that change cosmetic to skip review.

Keep reviewers read-only and persist evaluation evidence outside shipped
content. Record requested and observed model metadata where available. Never
count a failed launch or a written self-report as independent execution.

## Optional quality scorecard

Use this when comparing designs, not as an extra gate on every typo.
Score each dimension from 0 (missing) to 2 (demonstrated), and name untested
dimensions rather than inventing a total.

| Dimension | Evidence for 2 |
| --- | --- |
| Trigger precision | Positive and near-miss cases select the intended route |
| Scope | One reusable purpose with explicit adjacent-task boundaries |
| Outcome | Observable success criteria and executed outcome cases |
| Context | Short relevant reading paths with direct references |
| Reuse | Portable procedure or declared, justified compatibility |
| Trust | Reviewed dependencies, least privilege, and preserved approvals |

A high score does not waive a failed requirement or authorize a release.

## Finish or report the blocker

Run the smallest existing checks that cover the change. Fix failures caused
by the approved work and rerun affected checks; expand only when evidence
requires it. Regenerate owned indexes when their inputs change.

Report source correctness separately from pending commit-derived versioning,
publication, and reload. Leave a failed required check blocked with the current
change state. Do not discard unrelated edits to manufacture a clean result.
