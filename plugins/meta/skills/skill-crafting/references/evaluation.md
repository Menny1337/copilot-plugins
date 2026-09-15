# Evaluate a skill change

Read when planning or completing checks for an authored skill. Select checks
by the changed behaviour and risk; do not turn a prose correction into an
unrelated full-suite run.

## Contents

- Define cases before drafting
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

## Compare the relevant alternatives

For a substantive revision, compare old and new definitions on the same cases.
When assessing whether a capability skill still adds value, also try the task
without that skill. A no-skill baseline must retain the same safety,
authorization, and repository constraints.

Keep model, effort, tools, inputs, and success criteria comparable. Record any
differences. Test the critical cases on the intended models available to the
run, including a different family or tier when the skill is shared. Mark
unexercised targets as untested.

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
