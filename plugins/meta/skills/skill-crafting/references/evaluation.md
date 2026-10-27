# Evaluate a skill or agent change

Choose checks for the behaviour being changed. A wording fix needs source
checks; a workflow change also needs executed tasks. Record unavailable
coverage instead of claiming a pass.

## Define cases before drafting

For a new or substantially changed unit, keep the old source and prepare:

- two prompts that should select it and two close prompts that should not
- two tasks with an observable result and clear approval boundaries
- a held-out case that does not shape the rewrite

Use synthetic inputs when private data is outside scope. Published examples
are regression cases, not held-out cases.

Select affected cases from the shared end-to-end suite and local skill tests.
Suite owners can start with about ten examples, including cross-skill chains,
recovery, and forbidden actions. Each edit does not need a new full suite.

## Verify task completion

Define the expected artifact or system state before running each task.
Inspect that result, including persistence and cleanup where required.
For example, read back a saved draft's content or verify that the owned
browser process is absent. Stay within the task's data access and approvals.

Record pass, fail, partial, blocked, or not run with an evidence pointer.
A pass requires both the result and its constraints. A good answer, successful
tool call, correct route, or review score cannot establish that alone.
Inspect tool calls for omitted steps, lost constraints, and unauthorized
actions. Repeat critical cases at least twice and retain failed attempts.

Keep a redacted record outside shipped content:

| Record | Include |
| --- | --- |
| Case and attempt | Expected state, forbidden actions, baseline or held-out status |
| Conditions | Source revision, model/effort, tools, inputs, environment |
| Result | Status, artifact/state evidence, constraint violations |
| Overhead | Elapsed time, handoffs, tokens/cost when available |

Mark missing measurements as unknown. One owner should maintain the shared
suite and integrated result; isolated skill scores do not establish success
for a task that uses several skills.

## Compare the relevant alternatives

Run old and new definitions on the same cases with comparable models, effort,
tools, inputs, and permissions. Record differences and untested model families.
Exercise critical cases on available intended models, including a different
family or tier for shared guidance.
Use existing evaluators or fresh task contexts. A written walkthrough is not
an executed task.

When testing whether a skill is still useful, include a no-skill baseline
with the same external safeguards. For an agent-to-skill migration, compare
the delegated workflow with the main loop loading the skill and tools.
Change one capability at a time; include dependent chains and must-not-break
rules. Keep a rollback path until the replacement is verified.

Inspect individual pass-to-fail changes before judging averages or savings.
A faster run does not clear a failed requirement. Use
[context-boundary guidance](../../agent-crafting/references/advanced-topics.md#choose-the-context-boundary)
for architecture decisions.

## Check source and reading cost

Run the existing validator and affected generators. Check frontmatter,
dependencies, reference paths, and bundled scripts. Use
[description review](descriptions.md) when descriptions change, and supported
documentation/help for changed platform claims. Update only the verified
part of the feature baseline.

Measure the root plus references needed for a small task and a substantial
one. Report words, bytes, or tokens with the unit named. Check that the small
task avoids unrelated setup and the larger task reaches its result.
Fewer bytes are a reading-cost result; latency needs its own measurement.

## Independent review

Use `multi-model-review` for routing, schema, security, governance, or
system-wide changes. It owns panel selection and synthesis. Description
rewrites use their separate cross-vendor critique; changed routing boundaries
also need the judging panel.

Keep reviewers read-only and save evidence outside shipped content. Record
requested and observed model metadata where available. Failed launches and
reviewers' self-reports do not prove independent execution.

## Finish or report the blocker

Fix in-scope failures and rerun affected checks. Expand testing when the
results show a need. Preserve unrelated edits and user review stops.
Report remaining failures and untested coverage. Distinguish source checks
from behavioural results, publication, and installation refresh.
