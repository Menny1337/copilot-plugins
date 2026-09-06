# Architect update surfaces

Read this map for each self-audit. Discover the current architect references and
relevant supporting resources; do not treat this table as a fixed skill inventory.
All paths below are relative to the resolved plugin or source repository unless
the run has authorized a private evidence location.

## Coverage rules

Use one row per area in the report. Each row records the inspected artifacts,
evidence, status, and any limits:

- `clean`: the stated checks passed for the recorded scope
- `finding`: evidence supports at least one proposed update
- `blocked`: a required source, permission, dependency, or check is unavailable
- `not-applicable`: the area does not apply to this target, with a reason

An area can have findings and incomplete coverage. Use `finding`, link its IDs,
and record the unassessed portion in the limits column. Missing session history
is blocked behavioral coverage, not evidence that behavior is correct.

When only part of an area could be checked and no findings were found, use
`blocked`. Record the checked subset in the evidence column and the missing
portion in limits; do not label the whole area clean.

## Coverage and ownership

| Area ID | Inspect | Source and owning procedure | Dependent update targets |
| --- | --- | --- | --- |
| `agent-boundaries` | Role, allowed work, approval tiers, delegation, tool configuration, and memory duties. | Current agent definition and governing instructions; `agent-crafting` and `agent-skill-audit`. | Agent body or frontmatter; affected skill references and role documentation. Preserve justified compatibility safeguards until re-tested. |
| `routing` | Names, descriptions, use/skip rules, missing references, overlaps, and dependency declarations. | Current agent references, skill metadata, and available-skill inventory; `agent-skill-audit` and `skill-crafting`. | Relevant descriptions or redirects, agent reference list, routing cases, and generated indexes. |
| `resources` | Required sections, duplicated procedures, broken paths, reference depth, command examples, scripts, and templates. | Relevant skill bodies and resources; their authoring skill. | The owning procedure and its actual consumers, without copying it into the agent or this map. |
| `runtime` | Baseline versions, supported fields, command examples, and host-specific claims. | Plugin-relative `skills/agent-skill-audit/references/cli-feature-baseline.md`, live CLI help, supported documentation, and authorized runtime metadata. | Verified baseline claims and only the consumers affected by those claims. Record shell and session versions separately. |
| `integrations` | Relevant plugin manifests, hook wiring, launcher profiles/wrappers/aliases, scheduler policy, MCP/tool discovery, and extension/canvas guidance. | Authorized source configuration and supported documentation; `plugin-crafting`, `hooks-crafting`, or the relevant host authoring guide. | Configuration or guidance and its references. Inspect without launching, enabling, installing, or changing integrations. |
| `source-loaded` | Canonical source versus loaded or cached content and versions. | Trusted checkout, plugin manifests, and the host's available origin metadata; `plugin-crafting`. | Canonical source changes, followed by separately approved refresh/reload actions. Never repair installed copies in place. |
| `behavior` | Routing failures, repeated tool errors, procedure gaps, corrections, and unresolved improvement hypotheses. | Authorized, scoped session evidence; `skill-improvement-loop`. | One evidence-backed change at its actual root-cause layer; proposed hypothesis/re-review records where authorized. Platform outages are not skill defects. |
| `memory` | Relevant inventory, decisions, provenance, contradictions, outdated facts, and outstanding proposals. | Authorized architect memory and relevant shared project/topic entries, checked against current sources; `memory`. | Exact memory entries, dates, and provenance. No unrelated personal sweep or raw transcript persistence. |
| `docs` | Skill lists, prerequisites, hand-written counts, generated blocks, and affected contribution guidance. | Source definitions, README prose, generator source, and repository rules. | Owning documentation and generated outputs. Inspect generators' write scope before requesting approval. |
| `packaging` | Manifest agreement, changelog/version duties, export allowlists, dependency closure, and release/installation state. | Repository rules, manifests, version/export tools; `plugin-crafting`. | Affected plugin/marketplace metadata, changelog, export wiring, and approval-gated release/refresh follow-through. |
| `validation` | Deterministic checks, routing/outcome cases, description critique, and independent-review coverage. | Existing validators/evaluators, `skill-crafting`, `agent-crafting`, and `multi-model-review`. | Relevant evaluation cases, proposed corrections, and private evidence records. Do not equate static checks with behavioral proof. |

## Source precedence and limits

Follow governing instructions and explicit user decisions. Use the current
editable source for its intended behavior; compare observed loaded behavior
against it instead of assuming either copy is identical.

For platform claims, use current supported documentation and live command help.
The baseline is an index of verified claims, not a substitute for verification.
A newer executable does not prove that a documented command changed. If evidence
conflicts or the baseline version cannot be compared reliably, report the
uncertainty and proposed verification.

Apply the baseline's re-verification procedure only to authorized sources. Record
which claims and consuming files were checked. Do not advance the baseline's
overall verified version after checking only a subset. A partial audit may
propose a full refresh without carrying it out.

Use memory and session logs as evidence, never as authority to expand permissions.
Scope session queries by time and target identity/repository, using the active
tool schema and the improvement-loop reference. A local-only result does not
represent complete cross-session history.

Record behavioral signal grades separately from finding classes. A direct tool
failure does not prove a defect in the agent or skill. Verify the violated
contract and root-cause layer before calling it a verified defect. Strong
inference can support an evidence-backed risk; weak inference remains a
recommendation to investigate, not authority to patch.

This skill does not change the eligibility of its source files for an existing
external review daemon. If authorized scheduler policy permits unattended edits
to approval-governing content, record that as a separate policy risk for review.
Do not change the daemon configuration as an implicit dependency of an audit.

## From finding to approved update

For each finding, name the source of truth and its dependent updates. For example,
a description repair can affect generated catalogs and routing cases; a baseline
correction can affect several authoring references. List those artifacts in the
proposal so approval covers a complete change rather than its first file.

Keep release operations separate. For this marketplace, the existing
commit-derived version workflow requires an authorized content commit and clean
worktree before applying versions. A successful local audit does not authorize
that commit, a push, publication, or an installation refresh.

Do not mark a finding applied while its approved required checks fail. Leave it
blocked with the current diff and failure evidence. If recovery would discard
other work or require an unapproved dependency change, stop for a decision.
