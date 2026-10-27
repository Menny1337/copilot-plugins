# Author a skill

Read when creating a skill or changing its procedure, structure, or resources.
For descriptions and evaluations, use the direct routes in `SKILL.md`.

## Contents

- Decide what belongs here
- Establish the contract
- Structure and frontmatter
- Allocate context by task
- Model changes and completion

## Decide what belongs here

A skill should provide a reusable procedure, domain knowledge, a tool contract,
or a workflow preference that the agent would otherwise lack. An agent owns
persona and authority; a reference document can hold information with no
actionable workflow.

Capability guidance may become unnecessary as models change. Organization
processes and user preferences may remain necessary even when a model can
perform the underlying task unaided. Evaluate each rather than retiring it
from a model's advertised capability.

Check the existing inventory before adding another skill. Ask before merging,
splitting, renaming, or retiring units.

## Establish the contract

Record the requested outcome, inputs, success criteria, and likely failures.
Identify required tools, data access, dependencies, and the approval boundary.
If the user supplied a worked example, extract its useful decisions and
constraints without encoding every incidental step.

Preserve domain-specific requirements, exact interface contracts, security
controls, and non-obvious environment facts. Remove general encouragement or
fixed itineraries only when they add no needed constraint.

Use flexible guidance where several approaches are safe. Use ordered steps
where dependencies matter, and scripts or exact commands for fragile,
deterministic operations. Never replace an authorization rule with an appeal
to a model's judgement.

## Structure and frontmatter

Use one `skills/<skill-name>/SKILL.md` with optional `scripts/`, `references/`,
`templates/`, and `assets/` directories.

```markdown
---
name: example-workflow
description: "Performs a specific workflow. Use when its concrete task is requested."
---

# Example workflow

## When to Use

<The task boundary.>

## When to Skip

<Nearby tasks and their appropriate owners.>

## Procedure

<Necessary decisions, constraints, actions, and completion criteria.>
```

These three sections are required by this library's convention, not a reason
to pad a short procedure. Keep body-level triggers concise. Include references,
examples, or troubleshooting only when they help a concrete task.

For portable authoring, `name` is 1 to 64 lowercase letters, digits, or hyphens,
without leading, trailing, or doubled hyphens, and matches the folder.
`description` is required and must fit the 1,024-character limit.
Use the [skill-frontmatter baseline](../../agent-skill-audit/references/cli-feature-baseline.md#skill-frontmatter)
for other fields and host-specific behaviour; do not copy a second complete
schema here.

In this marketplace, use single-line top-level values. Do not add YAML block
scalars or nested metadata maps. `allowed-tools`, when justified, uses a
space-separated scalar. Tool pre-approval changes authority: do not pre-approve
shell/bash as a convenience. Review the skill and every referenced script
before proposing any such exception.

Put compatibility constraints in `compatibility` and relevant body instructions.
The host may strip frontmatter from injected content. Do not leave a necessary
runtime precondition only in metadata.

## Allocate context by task

The root should contain the decisions and safeguards common to its workflows.
Link each conditional reference directly from the root with its use condition.
Moving everything into one mandatory reference does not reduce reading.

Use 500 lines as a warning threshold, not proof of efficiency below it.
Inspect both bytes/tokens and the files required on representative paths.
Descriptions compete in the discovery inventory; root bodies and selected
references contribute to the task's reading cost.

Avoid duplicate schemas and procedures. Point to their owner. Give references
over about 100 lines a contents list. Use existing scripts for repeatable work;
add a helper only when it removes a real repeated or error-prone operation.

## Model changes and completion

Keep shared guidance suitable for the intended model families. Record which
models an evaluation exercised. Isolate any justified model-specific advice;
do not weaken shared safeguards or prescribe extra reasoning for every task.

Define the artifact and observable success before implementation. Give the
agent room to finish in-scope corrections after affected checks fail. Honour
plan-only requests, user review stops, and release gates. State a blocker rather
than treating an incomplete first draft as finished.

Design source considered: OpenAI, 11 September 2026,
`https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra`.
This library keeps host-specific behaviour in its feature baseline and treats
model-specific advice as a hypothesis to evaluate.
