# Author an agent body

Use this when creating or changing an agent body. Follow the root's frontmatter
route for new agents or configuration changes.

## Contents

- Establish the role
- Body template
- Section applicability
- Context and autonomy
- Verify the changed behaviour

## Establish the role

Choose one responsibility, owned artifacts, required skills, and actions needing
approval. Define representative tasks and completion criteria before adding rules.

An agent defines the actor and its authority; skills own reusable procedures.
Include necessary procedures in agent-only hosts, without duplicating them
when skills are available.

## Body template

Adapt sections to the role. Do not fill a template for its own sake.

```markdown
# Display name

You are a <specialist role> responsible for <bounded outcome>.

## Skills

| Task | Procedure |
| --- | --- |
| <specific condition> | <skill name> |

## Ownership

<Owned files, artifacts, and handoff boundary.>

## Working constraints

<Non-obvious domain facts, required conventions, and completion criteria.>

## Approval boundaries

- Normal: <in-scope actions authorized by the task>.
- Ask first: <specific risky or ownership-changing actions>.
- Never: <actions outside the role or trust boundary>.
```

Keep commands, checklists, and verification mechanics in their owning skills.
Add memory duties only with authorized access; state what may be recorded and
preserve privacy boundaries.

## Section applicability

Every role needs a task boundary, ownership, completion criteria, approval tiers,
and routes to available skills. Add conventions only where they affect the work.

- Specialists own bounded artifacts; orchestrators own delegated boundaries and
  the integrated result.
- Meta agents own customization files and authoring constraints.
- Reviewers define read scope and supported findings; writes require authorization.
  Researchers also define allowed evidence sources, citations, uncertainty, and
  report completion. Limit writes to authorized reports, not the product studied.

Use `agent-patterns.md` for examples when needed. Check body length against the
[host limit](../../agent-skill-audit/references/cli-feature-baseline.md#agent-frontmatter)
(recorded Copilot limit: 30,000 characters); the frontmatter validator may not
enforce it.

## Context and autonomy

Use task-specific pointers and non-obvious repository facts. Avoid mandatory
full-documentation reading, repository maps, and repeated skill descriptions.

Allow authorized edit/check/fix cycles until observable completion. Keep review
stops, access limits, destructive-action approvals, and release gates. Bound the
work so it neither stops at a first draft nor continues indefinitely.

Share constraints across models unless evaluation supports conditional guidance.
One model's performance does not justify removing safeguards for other models.
Use [context-boundary guidance](advanced-topics.md#choose-the-context-boundary)
when deciding whether work needs a separate context.

## Verify the changed behaviour

Use the shared [evaluation reference](../../skill-crafting/references/evaluation.md#verify-task-completion)
for routing cases, executed outcomes, comparisons, model coverage, and independent
review. Check agent loading, tool choice, handoffs, and authority boundaries in
the target host; valid source alone does not establish runtime behaviour.

For non-behavioural edits, run existing frontmatter/reference checks and affected
generators. Do not add unrelated suites.
