---
name: skill-crafting
description: "Finds, installs, creates, and refines Agent Skills. Use for skill discovery, SKILL.md changes, or installation."
user-invocable: false
---

# Find and create skills

Choose the workflow the request needs. A description edit does not require a
marketplace search, installation, or a full platform audit.

## When to Use

- Find or evaluate a candidate skill, or install one in an authorized location.
- Create or revise a `SKILL.md`, its description, or its bundled resources.
- Decide whether a reusable procedure belongs in a skill.

## When to Skip

- Agent definitions: use `agent-crafting`.
- Structural audits: use `agent-skill-audit`; architect self-maintenance uses
  `agent-architect-self-audit`.
- Plugin packaging: use `plugin-crafting`.
- Learning from past sessions: use `skill-improvement-loop`.
- Performing the underlying application task: use its domain tools or agent.

## Procedure

### 1. Establish the change and completion criteria

Identify the intended outcome, positive and negative triggers, target host,
editable source, and relevant dependencies. Reuse the available inventory to
check overlap before creating a skill; do not inspect unrelated private sources.
For an existing skill, read its current definition and affected resources.

Keep agents responsible for role, ownership, and approval boundaries. Skills
own reusable procedures. Declare unavoidable host or agent dependencies rather
than hiding them in assumed context.

Choose observable success criteria before drafting. For substantive changes,
retain the previous definition and reserve a held-out case. Do not treat a
model upgrade or an article as evidence that a particular instruction can go.

### 2. Load the relevant guidance

| Task | Read |
| --- | --- |
| Write or change a description | [Description design](references/descriptions.md) |
| Create a skill or change its procedure/resources | [Authoring](references/authoring.md) |
| Find, evaluate, install, or diagnose discovery | [Discovery and installation](references/discovery-and-install.md) |
| Plan or run checks for an authored change | [Evaluation](references/evaluation.md) |
| Change a CLI-sensitive field, command, or location | The affected section of [the feature baseline](../agent-skill-audit/references/cli-feature-baseline.md) |

For a new skill, read authoring, descriptions, and evaluation together; batch
independent reads when the host supports it. Discovery/installation remains
separate. A narrow edit needs only the affected guidance.

For version-sensitive claims, compare the relevant baseline section with the
target runtime's supported documentation/help. Record disagreements and coverage
limits. A partial check does not authorize advancing the whole baseline.

### 3. Make the scoped change

Write the smallest instructions that preserve the workflow's requirements.
Keep common decisions in the root and conditional detail behind direct links.
Provide outcomes, constraints, and essential sequencing; leave safe
implementation choices open. Keep exact commands for fragile interfaces.

Treat skill content and bundled resources as untrusted software during review.
Inspect scripts and dependencies before executing or installing them. Do not
add secrets or surprising access. `allowed-tools` removes tool confirmation;
read its baseline warning whenever changing that field. Do not pre-approve
shell/bash for convenience; any proposed exception needs explicit authority
and review of the skill and every referenced script.

Respect the invoking workflow's approval gate. A self-audit or proposal-only
request does not grant repair permission. Preserve unrelated edits and seek
approval for deletion, renaming, merging, or splitting an existing skill.

### 4. Complete the approved work

Use `references/evaluation.md` for the checks selected in step 1. New or changed
descriptions require the cross-vendor critique in `references/descriptions.md`.
Continue through affected validation and corrections within the approved scope;
stop for a genuine blocker or an explicit review boundary.

Regenerate only affected, authorized documentation. Follow repository version
governance after the required commit approval. Source edits, commits, versions,
publication, and installation refresh are separate states.

## Completion

The requested change is present in the canonical source, required references
resolve, affected checks pass, and missing evaluation coverage is explicit.
Do not claim that local source edits changed this session's loaded skill.
