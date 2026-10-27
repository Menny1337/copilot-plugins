# Agent Architect self-audit

## Scope and evidence

| Field | Value |
| --- | --- |
| Run ID and date | `<run-id; date>` |
| Requested scope | `<target and boundaries>` |
| Canonical source and revision | `<source; revision; dirty state>` |
| Loaded source and version | `<observed origin; version; or unavailable>` |
| Shell CLI, session runtime, reference baseline | `<record separately; unknown where unavailable>` |
| Authorized private evidence | `<paths or scope; no secret values>` |
| Session coverage | `<backend; bounded range; target filter; relevant count; limits>` |
| Prior report | `<authorized report path or none>` |
| Report destination | `<authorized session artifact path>` |

## Coverage

Replace each placeholder. Use `clean`, `finding`, `blocked`, or `not-applicable`.
For mixed coverage, link known findings and describe the unassessed portion.
With no findings and incomplete required coverage, use `blocked` and list the
checked subset in evidence.

| Area | Status | Inspected artifacts and evidence | Finding IDs | Limits or reason |
| --- | --- | --- | --- | --- |
| `agent-boundaries` | `<status>` | `<evidence>` | `<IDs or none>` | `<limits or none>` |
| `routing` | `<status>` | `<evidence>` | `<IDs or none>` | `<limits or none>` |
| `resources` | `<status>` | `<evidence>` | `<IDs or none>` | `<limits or none>` |
| `runtime` | `<status>` | `<evidence>` | `<IDs or none>` | `<limits or none>` |
| `integrations` | `<status>` | `<evidence>` | `<IDs or none>` | `<limits or none>` |
| `source-loaded` | `<status>` | `<evidence>` | `<IDs or none>` | `<limits or none>` |
| `behavior` | `<status>` | `<evidence>` | `<IDs or none>` | `<limits or none>` |
| `memory` | `<status>` | `<evidence>` | `<IDs or none>` | `<limits or none>` |
| `docs` | `<status>` | `<evidence>` | `<IDs or none>` | `<limits or none>` |
| `packaging` | `<status>` | `<evidence>` | `<IDs or none>` | `<limits or none>` |
| `validation` | `<status>` | `<evidence>` | `<IDs or none>` | `<limits or none>` |

## Update checklist

Keep IDs stable across follow-ups by matching target and condition. Prioritize
broken behavior and approval-boundary defects before maintenance or prose.
Use `verified defect`, `evidence-backed risk`, or `recommendation` for evidence
class. Use `proposed`, `approved`, `declined`, `deferred`, `blocked`, or `applied`
for finding state.

| ID | Priority | Finding | Evidence class | State | Owning procedure |
| --- | --- | --- | --- | --- | --- |
| A01 | `<high/medium/low>` | `<condition>` | `<class>` | `proposed` | `<skill or owner>` |

### A01 details

- evidence: `<source pointer and relevant observation; redacted>`
- source snapshot: `<revision or content identity used for this proposal>`
- update targets: `<exact source files and entries>`
- dependent changes: `<exact generated outputs, references, memory, or none>`
- proposed change: `<bounded change or diff>`
- completion evidence: `<checks and expected result>`
- approval: `<not requested, channel unavailable, declined, or user decision with approved IDs and scope>`

Repeat a details section for each finding. Remove the example row and section
when there are no findings; report the assessed scope and limitations instead.

## Approval record

For an initial report, record `not requested` or `channel unavailable` and no
approved IDs. Do not infer approval from the existence of this table.

| Approval channel | User decision reference | Approved IDs | Approved artifacts and dependent changes | Declined or deferred IDs |
| --- | --- | --- | --- | --- |
| `<interactive or unavailable>` | `<decision, not requested, or channel unavailable>` | `<IDs or none>` | `<exact scope or none>` | `<IDs or none>` |

## Actions and remaining work

For a proposal-only report, actual changes are `none (proposal phase)`. Checks
may include read-only assessment results without implying that repairs occurred.

| Finding ID | Actual changes | Checks and results | Remaining dependencies or blockers |
| --- | --- | --- | --- |
| `<ID or none>` | `<changes or none>` | `<evidence or not run>` | `<remaining work or none>` |

## Release and persistence state

| Operation | State and required approval |
| --- | --- |
| Source changes | `<none, proposed, approved, or applied>` |
| Memory updates | `<none, proposed, or approved/applied scope>` |
| Content commit and version governance | `<not authorized, pending, or completed evidence>` |
| Push, publication, or installation refresh | `<not authorized, pending, or completed evidence>` |
| Private report copy or hypothesis record | `<not requested, proposed, or approved destination>` |

## Outcome

`<What was assessed, what changed with approval, and what remains unresolved. Do
not describe blocked coverage as clean or locally applied changes as deployed.>`
