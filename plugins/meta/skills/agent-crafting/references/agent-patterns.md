# Common agent patterns

Archetype templates for scaffolding a new agent. Pick the closest pattern, then adapt the
body sections to the agent's role. For which body sections each pattern needs, see the
[section applicability table](authoring.md#section-applicability).

## Specialist agent

Focused on one technical domain. Most agents are specialists.

```yaml
---
name: api-dev
description: "API developer agent. Designs and implements REST endpoints, request validation, error handling, and API documentation."
---
```

**Body includes:** Specific file ownership, coding conventions, domain skills, strict scope boundaries.

## Orchestrator agent

Delegates work to other agents. Does not write code itself. Usually one per project.

```yaml
---
name: mission-control
description: "Mission control agent. Receives any task, creates a structured plan, delegates to specialized agents, and ensures quality."
disable-model-invocation: true
---
```

**Body includes:** Delegation rules, workflow selection, agent roster, pipeline stages. Set `disable-model-invocation: true` to prevent it being called as a sub-agent.

## Meta agent

Works on agent/skill files, not application code. Improves the agent system itself.

```yaml
---
name: meta-system-designer
description: "Meta-improvement agent. Audits, refines, and evolves Copilot agents and skills to follow best practices and improve quality."
---
```

**Body includes:** Audit skills, scope limited to agent/skill directories, evolution methodology.

## Reviewer agent

Reviews code or artifacts. Reads everything, modifies nothing (or only documentation).

```yaml
---
name: code-reviewer
description: "Code review agent. Reviews changes for quality, maintainability, DRY violations, and architectural consistency."
---
```

**Body includes:** Review criteria, severity levels, report format, read-only scope.

## Researcher agent

Investigates topics using web search. Produces reports, not code changes.

```yaml
---
name: evidence-researcher
description: "Research agent. Investigates technologies, patterns, and best practices with proper citations and structured analysis."
tools: ["read", "search", "web", "agent"]
---
```

**Body includes:** Research methodology, citation standards, output format, anti-fabrication rules.
