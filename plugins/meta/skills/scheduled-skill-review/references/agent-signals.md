# Agent Review Signals

Skills are reviewed for discovery and procedure. Agents are reviewed for orchestration,
scope, and delegation. The `skill-improvement-loop` harvest and diagnose phases use
these signals when the reviewed unit is an agent.

| Signal | What it looks like in events.jsonl / sessions |
|--------|-----------------------------------------------|
| **primary-agent-used** | The target agent is the active responder or named agent for the session/turns being evaluated; otherwise attribution is weak or out of scope. |
| **Sub-agent delegation** | The agent delegates to an appropriate specialist, over-delegates simple work, delegates to the wrong agent, or handles complex cross-cutting work without delegation. |
| **ignored-skill-reference** | The agent body references a skill or procedure, but the session shows no corresponding skill invocation, procedure steps, or tool pattern. |
| **Scope-boundary failure** | The agent performs work outside its declared scope, refuses work that fits its scope, or routes in-scope work away without a clear reason. |
| **Tool-permission mismatch** | The agent attempts tools it does not have, lacks tools needed for its declared job, or repeatedly fails because its tool list does not match its responsibilities. |
| **Conflicting-instructions** | The agent body contradicts a skill, another instruction, or itself; sessions show hesitation, oscillation, contradictory plans, or repeated restarts. |
| **Persona/identity drift** | Responses do not match the declared role, such as a reviewer editing code, an implementer only advising, or a specialist acting as a generic assistant. |

## Diagnosing the agent layer

Map the strongest signal to one fix target:

- **Frontmatter description/tools:** fix discoverability, declared scope, agent summary,
  or tool availability when sessions show the wrong agent is selected or needed tools
  are missing.
- **Body scope and skill references:** clarify boundaries, required procedures, and when
  to invoke referenced skills when the agent ignored relevant guidance or crossed scope.
- **Delegation guidance:** add or narrow routing instructions when the agent
  over-delegates, under-delegates, or chooses the wrong specialist.

## Evidence & caution

Use the same grading discipline as skill reviews: direct, strong-inferred, or
weak-inferred. Agent attribution from `events.jsonl` can be ambiguous, so treat it as
best-effort and record uncertainty. Make one change per cycle, and redact sensitive
prompts, customer data, credentials, and proprietary snippets from durable records.
