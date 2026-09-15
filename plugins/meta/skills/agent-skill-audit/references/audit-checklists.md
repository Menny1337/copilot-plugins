# Type-specific audit checks

Read only the sections relevant to the units under review.

## Contents

- Common checks
- Agents
- Skills
- Hooks
- Instructions and completion

## Common checks

Use the existing repository validator first. Check frontmatter, manifest
agreement, referenced files, and generated documentation for the scoped units.
Classify a reproducible contract violation as a verified defect, while
separating repository governance from the host's runtime acceptance.

Use `cli-feature-baseline.md` for versioned fields and semantics, and the
matching authoring skill for implementation guidance. Do not maintain another
hard-coded platform schema in this checklist. Unknown or disputed fields need
evidence from the intended host, not removal based on an old list.

Scope and permission checks apply to inspection too. Do not read private
memory, logs, or configuration merely because an example mentions their path.

## Agents

Assess these properties:

- one clear role with a task boundary
- short, conditional routes to available skills
- ownership and explicit normal, approval-required, and forbidden actions
- justified tool authority and preserved compatibility exceptions
- no reusable procedure duplicated from a skill
- description consistent with tools, permissions, and actual capabilities
- observable completion and appropriate handoffs
- authorized memory duties where applicable

For frontmatter, check required description, filename/name conventions,
single-line repository syntax, and supported attributes against the baseline's
agent section. Include version-specific fields such as `model-policy` when
the target supports them. Do not restrict tool entries to aliases when the
host also supports namespaced tools.

Check `skills:` for deliberate eager loading. A long roster is not itself a
defect; ambiguous selection or needless loading is. In agent-only hosts,
necessary commands in the body are valid; in skill-backed hosts, reusable
procedures should have one owner.

Use positive, near-miss, and executed outcome cases for substantive routing or
boundary changes. A description rewrite is not evidence that the agent loads.

## Skills

Check purpose and routing:

- the description names the task rather than an entire adjacent domain
- use/skip sections clarify the boundary without repeating keyword lists
- neighbouring skills do not compete for the same task without a distinction
- procedure and outputs match the advertised capability
- dependencies are absent or declared and justified

Check structure and trust:

- required name/description and use/skip/procedure sections
- frontmatter follows the intended host and repository restrictions
- scripts, assets, dependencies, and external URLs stay within the stated task
- no hidden persona or reliance on an agent body for missing workflow steps
- references resolve and important conditional resources have direct root links

For portable authoring, enforce the specification's name form and folder
match. For third-party runtime review, consult the baseline's recorded
tolerance and verify loading separately. A mismatch is not automatically a
proven trigger failure.

Check context and outcomes:

- common rules stay in the root; unrelated workflow detail loads conditionally
- root length under 500 lines does not substitute for measuring a reading path
- examples teach a needed decision rather than an arbitrary sequence
- exact commands remain where the interface is fragile
- completion criteria include the actual artifact and relevant recovery
- new/substantive changes have positive, near-miss, baseline, and held-out cases

Use `skill-crafting` for edits and its evaluation reference for model and
baseline comparisons. A no-skill baseline retains all external safeguards.

## Hooks

Invoke `hooks-crafting` when authoring a repair. Use its event reference and
the feature baseline for the target host's event names, payloads, decision
schemas, supported types, and exit-code behaviour.

Check these source properties:

- valid version, hook container, event names, and handler types
- required fields supported by the host and the repository validator
- manifest paths point at hook files, not bare directories
- scripts exist, have a shebang, and have appropriate executable permissions
- platform coverage is provided or a platform limit is explicit
- timeouts and matchers fit the actual event and naming convention
- secrets are not exposed through output, logs, or broad environment forwarding
- payloads are parsed, validated, and quoted rather than interpolated into commands

Exercise the relevant success, denial, error, and timeout paths using synthetic
payloads where possible. Check the exact event's failure behaviour; do not
assume every hook fails open or that a timeout behaves like a process error.
Verify stdout and exit status, not merely that a script ran.

Hooks do not replace the host's security boundary. Permission-granting
responses, HTTPS requirements, and allowed environment variables deserve
explicit inspection. Do not trigger live integrations as an audit side effect.

## Instructions and completion

Inspect always-loaded instructions alongside the scoped definitions:

- use task-specific documentation pointers rather than mandatory full-repo reading
- keep non-obvious domain facts and remove duplicate procedure copies
- let routine in-scope work finish without artificial first-draft stops
- retain requested review stops, approval tiers, and access restrictions
- run affected checks, expanding only when failures or coupling require it
- evaluate model-specific changes on intended targets; state coverage limits

Do not treat fewer rules as inherently better. For each proposed cut, explain
what requirement remains, who owns it, or which evidence shows it is no longer
needed.
