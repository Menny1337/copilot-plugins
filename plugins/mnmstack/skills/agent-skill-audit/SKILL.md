---
name: agent-skill-audit
description: "Audits agent, skill, and hook definitions for structural quality, routing, and inventory. Use for static reviews, not architect self-audits or session-history analysis."
user-invocable: false
---

# Audit agents, skills, and hooks

Assess the requested definitions and their relevant dependencies. Separate
verified defects, evidence-backed risks, and recommendations before proposing
changes.

## When to Use

- Review agent, skill, or hook structure, correctness, routing, or overlap.
- Check a changed definition or inventory a specified customization scope.
- Assess whether a unit needs refinement, consolidation, or retirement.

## When to Skip

- Architect self-maintenance: use `agent-architect-self-audit`, which may invoke
  this procedure for a scoped structural assessment.
- Past-session behaviour: use `skill-improvement-loop`.
- Authoring a known change: use `agent-crafting`, `skill-crafting`, or
  `hooks-crafting`.
- Application work or reading definitions only for context: no structural audit.

## Procedure

### 1. Establish scope and evidence

Identify the requested units, canonical source, target host, worktree state,
and approval boundary. Use the supplied inventory or search only authorized
locations. A plugin review does not authorize a personal-directory sweep.

Run existing read-only validators and affected generated-output checks before
subjective assessment. Inspect unfamiliar commands for writes. Under a
self-audit or report-only request, do not regenerate files or repair defects.

Record missing sources or evidence. A narrow review can be complete for its
declared scope without implying that the entire system is clean.

### 2. Load the applicable checks

| Need | Read |
| --- | --- |
| Agent, skill, or hook assessment | The relevant type section of [audit checklists](references/audit-checklists.md) |
| Platform field, command, or host behaviour | The affected section of [the feature baseline](references/cli-feature-baseline.md) and the owning authoring skill |
| Scoring, inventory format, or a full report | [Reporting](references/reporting.md) |

Compare changed or disputed platform claims with current supported
documentation and the target runtime. Distinguish portable syntax from
runtime tolerance. Record shell/session/baseline versions separately.
A version difference alone does not establish an error or justify a rewrite.

### 3. Assess the selected paths

Check purpose, authority, routing, dependencies, and success criteria. Inspect
the source that supports a finding; do not infer it from a filename or a
validator's silence.

For context efficiency, follow a representative small task and a substantive
one. Count required reading, not just root length. Look for competing
descriptions, duplicated procedures, unconditional reference stacks, and
fixed recipes without a workflow dependency.

Keep exact contracts and safeguards. Treat suggestions to remove guidance as
hypotheses, especially across model families. Missing behavioural evidence
limits the claim; static checks cannot establish a trigger failure rate.

### 4. Propose the complete repair

For each finding, identify evidence, the owning layer, exact source targets,
dependent outputs, and completion criteria. Use `references/reporting.md` for
larger audits; a small audit can use a concise finding table.

A tool outage belongs to the tool layer. Reusable procedures belong in skills;
roles and authority belong in agents. Do not add a new unit when an existing
owner can address the problem.

Respect the invoking workflow's repair approval. Deletion, renaming,
splitting/merging, commits, and release operations require their own authority.
Scheduled AUTO-DEPLOY instructions do not override a self-audit's approval gate.

### 5. Apply and finish when authorized

Load the matching authoring skill before editing. Use `multi-model-review` for
routing, schema, security, or system-wide changes, and `skill-crafting`'s
cross-vendor critique for changed skill descriptions.

Preserve unrelated edits. Run the existing targeted checks, representative
behavioural cases for substantive changes, and authorized generators. Continue
through failures caused by the change; report blockers that need new scope.

## Completion

The report accounts for inspected scope, findings, evidence limits, approvals,
and any applied changes. Do not describe a proposal as a repair, a static pass
as behavioural proof, or a source edit as a deployed update.
