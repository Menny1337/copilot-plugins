# Type-specific audit checks

Read only the sections relevant to the units under review.

## Contents

- Common checks
- Agents
- Skills
- Hooks
- Instructions and completion

## Common checks

Run the existing repository validator for scoped units. Check frontmatter,
manifest agreement, references, and generated documentation. A reproducible
contract violation is a verified defect; distinguish repository governance
from host acceptance.

Use [the feature baseline](cli-feature-baseline.md) for versioned syntax and
semantics, and the matching authoring skill for repairs. Resolve disputed fields
with target-host evidence before removing them.

Inspection also requires permission. Example paths do not authorize reading
private memory, logs, or configuration.

## Agents

Check:

- one bounded role, owned artifacts, observable completion, and handoffs
- conditional routes to available skills
- normal, approval-required, and forbidden actions; justified tool authority
- description consistent with permissions and actual capabilities
- preserved tested compatibility exceptions and authorized memory duties
- reusable procedures owned by skills, except where an agent-only host needs them

Check required description, filename/name conventions, scalar-only single-line
repository syntax, and supported attributes against
[agent frontmatter](cli-feature-baseline.md#agent-frontmatter). Retain supported
namespaced tool entries and version-specific fields such as `model-policy`.
Inspect `skills:` for deliberate eager loading and clear selection; roster size
alone does not prove a defect.

For boundary changes, use
[context guidance](../../agent-crafting/references/advanced-topics.md#choose-the-context-boundary).
Repeated handoffs, planner-only hops, or procedures already owned by skills
suggest candidates for measurement, not proven defects. Preserve independent
verification. Routine edits need not re-justify existing architecture.

## Skills

Check:

- description names a specific task; use/skip/procedure sections distinguish
  neighbouring skills without repeated keyword lists
- procedure and outputs match the advertised capability
- required name/description and frontmatter meet host and repository restrictions
- dependencies are declared and justified when present
- scripts, assets, dependencies, and external URLs stay within the task's trust scope
- no hidden persona or missing workflow supplied only by an agent body
- references resolve; important conditional resources have direct root links
- common rules stay in the root; workflow details load when needed
- examples teach decisions; fragile interfaces retain exact commands
- completion covers the actual artifact and relevant recovery

For portable authoring, enforce specification naming and folder matching. For
third-party reviews, consult [recorded runtime tolerance](cli-feature-baseline.md#skill-frontmatter)
and verify loading separately; a naming mismatch alone does not prove trigger
failure. A root under 500 lines still needs reading-path measurement. Use
`skill-crafting` for repairs.

## Hooks

Use `hooks-crafting` for repairs and its event reference plus
[hook semantics](cli-feature-baseline.md#hook-semantics-that-changed) for host
payloads, decisions, types, and exit behaviour.

Check:

- valid version, hook container, event names, and handler types
- required fields supported by the host and the repository validator
- manifest paths point at hook files, not bare directories
- scripts exist, have a shebang, and have appropriate executable permissions
- platform coverage is provided or a platform limit is explicit
- timeouts and matchers fit the actual event and naming convention
- secrets are not exposed through output, logs, or broad environment forwarding
- payloads are parsed, validated, and quoted rather than interpolated into commands

Exercise relevant success, denial, error, and timeout paths with synthetic
payloads where possible. Verify stdout and exit status against the exact event;
failures do not universally fail open, and timeouts can differ from process errors.

Inspect permission-granting responses, HTTPS requirements, and allowed environment
variables. Hooks do not replace host security. Do not trigger live integrations
as an audit side effect.

## Instructions and completion

Inspect scoped, always-loaded instructions alongside definitions:

- use task-specific documentation pointers rather than mandatory full-repo reading
- keep non-obvious domain facts and remove duplicate procedure copies
- let routine in-scope work finish without artificial first-draft stops
- retain requested review stops, approval tiers, and access restrictions
- run affected checks, expanding only when failures or coupling require it
- keep authority and trust boundaries when removing or moving instructions

Use the shared [outcome contract](../../skill-crafting/references/evaluation.md#verify-task-completion)
for substantive changes: routing and loading checks alone do not prove completion.
It owns baseline/held-out cases, model coverage, integrated results, and readbacks.
Comparisons retain external safeguards.

For each cut, identify the surviving requirement, its owner, or evidence that it
is no longer needed. Fewer instructions alone do not establish improvement.
