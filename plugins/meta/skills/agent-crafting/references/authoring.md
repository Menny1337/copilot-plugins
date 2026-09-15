# Author an agent body

Read when creating an agent or changing its role, ownership, or instructions.
New agents also need the root's frontmatter route. Existing body-only edits
need that route only when configuration changes.

## Contents

- Establish the role
- Body template
- Section applicability
- Context and autonomy
- Verify the changed behaviour

## Establish the role

Choose one responsibility and the files or artifacts the agent owns. Identify
the reusable skills it needs and the actions requiring approval. Define
representative tasks and completion criteria before adding detailed rules.

An agent describes who acts, with what authority. A skill describes how a
reusable workflow runs. In an agent-only host, include the otherwise missing
procedures; do not copy them into both layers when skills are available.

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

Keep reusable commands, checklists, and verification mechanics in their owning
skills. Add memory guidance only when it is part of the role and the run has
authorized access. State what may be recorded and preserve privacy boundaries.

## Section applicability

| Section | Specialist | Orchestrator | Meta | Reviewer |
| --- | --- | --- | --- | --- |
| Role and task boundary | required | required | required | required |
| Skill routes | when available | when available | when available | when available |
| File ownership | owned files | delegated ownership | customization files | read scope |
| Conventions | domain-specific | handoff constraints | authoring constraints | review criteria |
| Memory | if authorized | if authorized | if authorized | optional and authorized |
| Completion | task outcomes | integrated outcome | valid definitions | supported findings |
| Approval | explicit tiers | explicit tiers | explicit tiers | read-only unless authorized |

Research agents specialize the reviewer pattern: define authorized evidence
sources, citation requirements, uncertainty, and report completion. Limit
writes to authorized report artifacts rather than the product under study.

Use `agent-patterns.md` for archetype examples, not as an additional mandatory
read for every body edit.

Check the modified body's character count against the target host's limit.
The [recorded Copilot limit](../../agent-skill-audit/references/cli-feature-baseline.md#agent-frontmatter)
is 30,000 characters. Do not assume the repository frontmatter validator
enforces body length.

## Context and autonomy

Replace broad "read all documentation first" rules with task-specific pointers.
State non-obvious repository facts rather than a full repository map. Keep
skill references short; their descriptions already explain the capability.

Give the agent an observable definition of done. Allow local, authorized
edit/check/fix cycles until it reaches that result. Preserve explicit review
stops, access limits, destructive-action approvals, and release gates.
Precise completion criteria should prevent both premature stopping and
unbounded work.

Share constraints across models unless an evaluated difference justifies
conditional guidance. Do not assume a frontier model's performance applies to
every contributor's model, or remove safeguards based on that assumption.

## Verify the changed behaviour

For a new or substantive revision:

1. Define at least two should-select prompts and two close near-misses for an
   auto-routed agent.
2. Execute a representative task in a fresh context. Inspect tool choice,
   handoffs, boundary compliance, and the actual artifact.
3. Compare previous and revised profiles on the same tasks. Retain a held-out
   case that did not shape the wording.
4. Exercise critical cases on intended model families/tiers available to the
   run. Record unavailable coverage without claiming a pass.
5. Use `multi-model-review` for routing, schema, security, or system-wide
   changes. It owns reviewer selection and synthesis.

For a non-behavioural edit, run the existing frontmatter/reference checks and
affected generators. Do not add an unrelated test suite. A validator does not
prove runtime routing, and a simulated walkthrough does not prove execution.
