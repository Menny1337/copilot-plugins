# Agent review signals

Use these signals in the improvement loop's harvest and diagnosis phases.

| Signal | Evidence in sessions/events.jsonl |
| --- | --- |
| primary-agent-used | Target is the active responder or named agent; otherwise attribution is uncertain or outside scope. |
| Sub-agent delegation | Wrong specialist, unnecessary delegation, or a missed useful context boundary. Complexity alone does not require subagents. |
| ignored-skill-reference | Referenced skill/procedure has no matching invocation, steps, or tool pattern. |
| Scope-boundary failure | Out-of-scope work, refusal of suitable work, or unjustified routing away. |
| Tool-permission mismatch | Responsibilities and declared tools conflict; attempts or recurring failures expose the mismatch. |
| Conflicting-instructions | Contradictory guidance produces oscillation, conflicting plans, or restarts. |
| Persona/identity drift | Behavior conflicts with the role, such as a reviewer editing or an implementer only advising. |
| Handoff loss / overhead | Summaries drop constraints, specialists repeat lookups, or routing adds calls without useful results. |
| Unverified completion | No artifact/state readback, or local success hides failed integrated outcomes, approvals, or cleanup. |

## Choose the owner

Fix description/tools frontmatter for selection, declared scope, or tool
availability problems. Fix body scope/skill references for ignored guidance or
crossed boundaries. Adjust delegation guidance for observed routing failures.
Keep tool/platform blockers separate from unit failures.

Use the loop's direct, strong-inferred, and weak-inferred grades. Record uncertain
agent attribution and redacted evidence. A missed trigger is direct only with an
explicit user statement; keywords alone never justify edits. Keep one unit,
layer, and patch per cycle.

For delegation choices, use
[context-boundary guidance](../../agent-crafting/references/advanced-topics.md#choose-the-context-boundary).
The [shared outcome contract](../../skill-crafting/references/evaluation.md#verify-task-completion)
owns comparative runs and integrated artifact/state checks. Record observed
overhead, not assumed savings; missing readback stays unknown.
