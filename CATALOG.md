<!-- GENERATED FILE — do not edit by hand. Run `node scripts/catalog.mjs` to regenerate. -->

# Catalog

**7** plugins · **9** agents · **36** skills · **5** hooks

A single index of every agent, skill, and hook across all plugins in this marketplace. Source files (`SKILL.md`, `*.agent.md`, `hooks.json`) remain the only source of truth — this catalog is regenerated from their frontmatter by `scripts/catalog.mjs`.

> **Legend.** 📜 = ships scripts · 📚 = ships references · 🔒 = `user-invocable: false`

## Quick index

Flat alphabetical lookup. Click a name to jump to its source file.

| Name | Type | Plugin | Description |
| --- | --- | --- | --- |
| [`ado-session-sync`](plugins/core-agents/skills/ado-session-sync/SKILL.md) 📜 🔒 | skill | `core-agents` | Reviews the just-finished Copilot session and updates the related Azure DevOps work item so the ADO board stays a source of truth linking work items to the sessions that produced… |
| [`agent-architect`](plugins/meta/agents/agent-architect.agent.md) | agent | `meta` | Designs and improves Copilot agent systems. Use for agents, skills, hooks, plugin architecture, extension or canvas boundaries, routing, audits, and evidence-based evolution. |
| [`agent-architect-self-audit`](plugins/meta/skills/agent-architect-self-audit/SKILL.md) 📚 | skill | `meta` | Audits the Agent Architect's own instructions, skills, references, and memory, producing a prioritized update checklist. |
| [`agent-crafting`](plugins/meta/skills/agent-crafting/SKILL.md) 📚 🔒 | skill | `meta` | Creates and troubleshoots Copilot agent definitions (.agent.md). Use for persona, frontmatter, tool access, or loading and routing changes. |
| [`agent-skill-audit`](plugins/meta/skills/agent-skill-audit/SKILL.md) 📚 🔒 | skill | `meta` | Audits agent, skill, and hook definitions for structural quality, routing, and inventory. Use for static reviews, not architect self-audits or session-history analysis. |
| [`agentStop: hooks/ado-session-sync.sh`](plugins/core-agents/hooks/ado-session-sync.sh) | hook | `core-agents` | On `agentStop` runs `hooks/ado-session-sync.sh` (timeout 20s). |
| [`assistant`](plugins/core-agents/agents/assistant.agent.md) | agent | `core-agents` | Personal assistant for notes, tasks, reminders, and Microsoft Teams messaging. Takes meeting notes, captures ideas, tracks decisions, manages todo lists with priorities and due… |
| [`assistant-capture`](plugins/core-agents/skills/assistant-capture/SKILL.md) 📜 📚 | skill | `core-agents` | Captures personal notes, tasks, and reminders. Use to save a note, manage a task or reminder, or turn meeting action items into tasks. |
| [`assistant-query`](plugins/core-agents/skills/assistant-query/SKILL.md) 📜 📚 | skill | `core-agents` | Queries saved notes, tasks, reminders, and open pull requests, and creates daily or weekly briefings. Use to find personal context, check what is due, or get a briefing. |
| [`az`](plugins/core-skills/skills/az/SKILL.md) 📚 | skill | `core-skills` | Generate and explain Azure CLI (`az`) commands for managing Azure and Azure DevOps. Use when the user asks for Azure CLI commands or wants to manage Azure or Azure DevOps from the… |
| [`azure-ops`](plugins/core-agents/agents/azure-ops.agent.md) | agent | `core-agents` | Azure CLI operations expert. Manages Azure resources, DevOps (boards, repos, pipelines, wiki), identity, infrastructure, monitoring, and more via the az CLI. |
| [`browser`](plugins/core-skills/skills/browser/SKILL.md) 📜 📚 | skill | `core-skills` | Automates websites in a dedicated signed-in browser window. Use for screenshots, rendered pages, forms, account flows, or browser network/storage inspection; not API-only tasks,… |
| [`create-image`](plugins/core-skills/skills/create-image/SKILL.md) 📜 📚 | skill | `core-skills` | Generates and edits raster images with gpt-image-2 on Azure AI Foundry. Use for image generation or gpt-image command and setup help; use nano-banana-cli for Gemini. |
| [`grok-search`](plugins/core-skills/skills/grok-search/SKILL.md) 📜 📚 | skill | `core-skills` | Searches live X/Twitter posts and sentiment through Grok. For other web research, use only when the user or workflow selects Grok; general news or citation requests alone do not… |
| [`hooks-crafting`](plugins/meta/skills/hooks-crafting/SKILL.md) 📚 🔒 | skill | `meta` | Authors and troubleshoots GitHub Copilot hooks. Use for hooks.json, lifecycle events, command/HTTP/prompt configurations, tool-call decisions, context injection, notifications,… |
| [`html-presentation`](plugins/presentation/skills/html-presentation/SKILL.md) 🔒 | skill | `presentation` | Create beautiful browser-runnable HTML presentations using reveal.js. Single self-contained HTML file with slides, transitions, speaker notes, and responsive design. |
| [`interview-management`](plugins/duty/skills/interview-management/SKILL.md) 🔒 | skill | `duty` | Manage structured engineering interviews for Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer loops. |
| [`interview-manager`](plugins/duty/agents/interview-manager.agent.md) | agent | `duty` | Engineering interviewer sidekick. Helps prepare, run, and debrief Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer interviews with question banks, STAR-style… |
| [`m365-messaging`](plugins/core-agents/skills/m365-messaging/SKILL.md) | skill | `core-agents` | Read and send Microsoft Teams messages via the Teams MCP server (chats, channels, presence, mentions, search). |
| [`memory`](plugins/core-skills/skills/memory/SKILL.md) 📜 🔒 | skill | `core-skills` | Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from… |
| [`multi-model-review`](plugins/core-skills/skills/multi-model-review/SKILL.md) | skill | `core-skills` | Runs independent critics from different model vendors over one artifact, then synthesizes their findings into a ship-or-hold decision. |
| [`nano-banana-cli`](plugins/presentation/skills/nano-banana-cli/SKILL.md) 📜 📚 🔒 | skill | `presentation` | Generates and edits raster images with the Nano Banana CLI. Use when the user or workflow selects Nano Banana/Gemini for images, commands, or setup. |
| [`narrate`](plugins/core-skills/skills/narrate/SKILL.md) 📜 📚 | skill | `core-skills` | Creates MP3 narration and matching transcripts from documents or text. Use for read-aloud audio, audio summaries or briefs, voiceovers, podcast-style narration, and timed meeting… |
| [`oncall`](plugins/duty/agents/oncall.agent.md) | agent | `duty` | Personal on-call operations manager. Logs incidents, actions, escalations, notes, and communications with structured timestamps. |
| [`oncall-logging`](plugins/duty/skills/oncall-logging/SKILL.md) | skill | `duty` | Structured on-call data entry: workspace initialization, shift lifecycle, log entries (incidents, actions, notes, escalations, comms), entry linking, incident management, and file… |
| [`oncall-query`](plugins/duty/skills/oncall-query/SKILL.md) | skill | `duty` | Search, filter, aggregate, and report on on-call data. Timeline views, active incidents, shift handoffs, weekly summaries, and metrics. |
| [`plugin-crafting`](plugins/meta/skills/plugin-crafting/SKILL.md) 🔒 | skill | `meta` | Builds and troubleshoots Copilot CLI plugins and marketplaces. Use for plugin.json or marketplace.json, packaging agents/skills/hooks/commands/extensions/MCP/LSP servers, install… |
| [`pptx-creation`](plugins/presentation/skills/pptx-creation/SKILL.md) 📜 📚 🔒 | skill | `presentation` | Create and rebuild professional PowerPoint presentations (.pptx) from content, outlines, or approved slide plans. |
| [`prd-to-work-items`](plugins/docs/skills/prd-to-work-items/SKILL.md) | skill | `docs` | Decompose and create vertical-slice work items from a PRD with dependency tracking. Use when breaking down a PRD, feature spec, or requirements document into trackable GitHub… |
| [`presentation-critique`](plugins/presentation/skills/presentation-critique/SKILL.md) 🔒 | skill | `presentation` | Structured evaluation procedure for PowerPoint presentations against professional standards. |
| [`presentation-designer`](plugins/presentation/agents/presentation-designer.agent.md) | agent | `presentation` | Create or revise professional presentations in PPTX or HTML. Handles outline design, AI-generated visuals, slide production, speaker notes, and multi-model quality review — all… |
| [`presentation-workflow`](plugins/presentation/skills/presentation-workflow/SKILL.md) 🔒 | skill | `presentation` | End-to-end orchestration procedure for creating presentations. Covers intent capture, outline planning, image generation delegation, slide building, multi-model parallel critique,… |
| [`prompt-builder`](plugins/core-skills/skills/prompt-builder/SKILL.md) 📚 | skill | `core-skills` | Writes and improves prompts for AI agents. Use when asked for a task prompt, not to execute the task or author skill or agent definitions. |
| [`publish-html`](plugins/core-skills/skills/publish-html/SKILL.md) 📜 📚 | skill | `core-skills` | Publishes and replaces trusted HTML reports on an existing entitlement-protected Azure host, returning a shareable link, with recovery for interrupted uploads. |
| [`research-methodology`](plugins/core-skills/skills/research-methodology/SKILL.md) | skill | `core-skills` | Structured methodology for externally sourced, cited research: web search, source verification, synthesis, and adversarial review. |
| [`researcher`](plugins/core-agents/agents/researcher.agent.md) | agent | `core-agents` | Research agent that creates academic papers, comprehensive reports, and detailed analyses with proper citations. Answers follow-up questions about completed research. |
| [`scheduled-headless-copilot`](plugins/meta/skills/scheduled-headless-copilot/SKILL.md) 📜 📚 | skill | `meta` | Manages unattended Copilot CLI and executable tasks via Copilot Loops on macOS or OS schedulers. |
| [`scheduled-skill-review`](plugins/meta/skills/scheduled-skill-review/SKILL.md) 📜 📚 | skill | `meta` | Manages scheduled Copilot skill-and-agent reviews on macOS with a menu-bar app for status, control, and per-unit settings. |
| [`sessionStart: hooks/ado-sync-advisory.sh`](plugins/core-agents/hooks/ado-sync-advisory.sh) | hook | `core-agents` | On `sessionStart` runs `hooks/ado-sync-advisory.sh` (timeout 10s). |
| [`sessionStart: hooks/detect-tools.sh`](plugins/core-skills/hooks/detect-tools.sh) | hook | `core-skills` | On `sessionStart` runs `hooks/detect-tools.sh` (timeout 15s). |
| [`sessionStart: hooks/link-commands.sh`](plugins/core-agents/hooks/link-commands.sh) | hook | `core-agents` | On `sessionStart` runs `hooks/link-commands.sh` (timeout 10s). |
| [`sessionStart: hooks/lint-memory-advisory.sh`](plugins/core-skills/hooks/lint-memory-advisory.sh) | hook | `core-skills` | On `sessionStart` runs `hooks/lint-memory-advisory.sh` (timeout 15s). |
| [`skill-crafting`](plugins/meta/skills/skill-crafting/SKILL.md) 📚 🔒 | skill | `meta` | Finds, installs, creates, and refines Agent Skills. Use for skill discovery, SKILL.md changes, or installation. |
| [`skill-improvement-loop`](plugins/meta/skills/skill-improvement-loop/SKILL.md) 📚 🔒 | skill | `meta` | Improves agents or skills using observed session evidence. Use for triggering issues, procedure-adherence gaps, repeated tool failures, user corrections, feedback loops, and… |
| [`ui-critic`](plugins/ui/agents/ui-critic.agent.md) | agent | `ui` | Senior design critic and accessibility specialist. Evaluates React/TypeScript UI against design system constraints, hierarchy, accessibility, and micro-interactions. |
| [`ui-critique`](plugins/ui/skills/ui-critique/SKILL.md) | skill | `ui` | Review and evaluate UI components against design principles. Use when reviewing, scoring, or critiquing React/TypeScript UI code for quality, accessibility, hierarchy, and design… |
| [`ui-design-system`](plugins/ui/skills/ui-design-system/SKILL.md) | skill | `ui` | Review and apply design system constraints and tokens for beautiful UI generation. Use when creating, styling, or reviewing React/TypeScript UI components. |
| [`ui-designer`](plugins/ui/agents/ui-designer.agent.md) | agent | `ui` | Senior UI designer and React engineer. Creates beautiful, accessible, production-quality React/TypeScript/Tailwind components. |
| [`ui-generation`](plugins/ui/skills/ui-generation/SKILL.md) 📚 | skill | `ui` | Generate beautiful React/TypeScript UI components through a step-by-step workflow. Use when building new components, layouts, pages, or UI features. |
| [`write-prd`](plugins/docs/skills/write-prd/SKILL.md) | skill | `docs` | Create product requirements documents through structured discovery and interview. Use when creating a PRD, planning a feature, writing a spec, or designing a solution before… |

## By plugin

### `core-skills`

Broadly-useful, standalone skills: memory, browser, research-methodology, prompt-builder (situation → engineered AI-agent prompt), multi-model-review (adversarial cross-vendor review panel with synthesis), az (Azure CLI domain reference), narrate (doc/text → spoken-audio MP3), create-image (gpt-image-2 image generation/editing on Azure AI Foundry), grok-search (zero-cost real-time X/Twitter + web search via Grok in a logged-in browser).

_Source: [`plugins/core-skills/`](plugins/core-skills/)_

**Skills**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`az`](plugins/core-skills/skills/az/SKILL.md) 📚 | Generate and explain Azure CLI (`az`) commands for managing Azure and Azure DevOps. Use when the user asks for Azure CLI commands or wants to manage Azure or Azure DevOps from the… | — |
| [`browser`](plugins/core-skills/skills/browser/SKILL.md) 📜 📚 | Automates websites in a dedicated signed-in browser window. Use for screenshots, rendered pages, forms, account flows, or browser network/storage inspection; not API-only tasks,… | — |
| [`create-image`](plugins/core-skills/skills/create-image/SKILL.md) 📜 📚 | Generates and edits raster images with gpt-image-2 on Azure AI Foundry. Use for image generation or gpt-image command and setup help; use nano-banana-cli for Gemini. | — |
| [`grok-search`](plugins/core-skills/skills/grok-search/SKILL.md) 📜 📚 | Searches live X/Twitter posts and sentiment through Grok. For other web research, use only when the user or workflow selects Grok; general news or citation requests alone do not… | — |
| [`memory`](plugins/core-skills/skills/memory/SKILL.md) 📜 🔒 | Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from… | — |
| [`multi-model-review`](plugins/core-skills/skills/multi-model-review/SKILL.md) | Runs independent critics from different model vendors over one artifact, then synthesizes their findings into a ship-or-hold decision. | — |
| [`narrate`](plugins/core-skills/skills/narrate/SKILL.md) 📜 📚 | Creates MP3 narration and matching transcripts from documents or text. Use for read-aloud audio, audio summaries or briefs, voiceovers, podcast-style narration, and timed meeting… | — |
| [`prompt-builder`](plugins/core-skills/skills/prompt-builder/SKILL.md) 📚 | Writes and improves prompts for AI agents. Use when asked for a task prompt, not to execute the task or author skill or agent definitions. | — |
| [`publish-html`](plugins/core-skills/skills/publish-html/SKILL.md) 📜 📚 | Publishes and replaces trusted HTML reports on an existing entitlement-protected Azure host, returning a shareable link, with recovery for interrupted uploads. | — |
| [`research-methodology`](plugins/core-skills/skills/research-methodology/SKILL.md) | Structured methodology for externally sourced, cited research: web search, source verification, synthesis, and adversarial review. | — |

**Hooks**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`sessionStart: hooks/lint-memory-advisory.sh`](plugins/core-skills/hooks/lint-memory-advisory.sh) | On `sessionStart` runs `hooks/lint-memory-advisory.sh` (timeout 15s). | — |
| [`sessionStart: hooks/detect-tools.sh`](plugins/core-skills/hooks/detect-tools.sh) | On `sessionStart` runs `hooks/detect-tools.sh` (timeout 15s). | — |

### `core-agents`

Broadly-useful agents and supporting skills: assistant (notes, tasks, reminders, briefings, Teams messaging, optional ADO session sync), researcher (citation-driven reports), and azure-ops (Azure CLI and DevOps operations).

_Source: [`plugins/core-agents/`](plugins/core-agents/)_

**Agents**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`assistant`](plugins/core-agents/agents/assistant.agent.md) | Personal assistant for notes, tasks, reminders, and Microsoft Teams messaging. Takes meeting notes, captures ideas, tracks decisions, manages todo lists with priorities and due… | note, task, todo, remind, meeting notes, decision, what's due, daily summary, action items, ideas, take a note, add task, set reminder, what did I decide, scratch, jot down, work items, ADO, sprint, my bugs, check Teams, any new messages, unread, DMs, message a teammate, ping the team, post to channel, what did X say, Teams catch up, is X online, notes to self |
| [`azure-ops`](plugins/core-agents/agents/azure-ops.agent.md) | Azure CLI operations expert. Manages Azure resources, DevOps (boards, repos, pipelines, wiki), identity, infrastructure, monitoring, and more via the az CLI. | — |
| [`researcher`](plugins/core-agents/agents/researcher.agent.md) | Research agent that creates academic papers, comprehensive reports, and detailed analyses with proper citations. Answers follow-up questions about completed research. | — |

**Skills**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`ado-session-sync`](plugins/core-agents/skills/ado-session-sync/SKILL.md) 📜 🔒 | Reviews the just-finished Copilot session and updates the related Azure DevOps work item so the ADO board stays a source of truth linking work items to the sessions that produced… | ado session sync, update work item with progress, session-to-task, sync session to ADO, stamp session id on work item, session-yield hook |
| [`assistant-capture`](plugins/core-agents/skills/assistant-capture/SKILL.md) 📜 📚 | Captures personal notes, tasks, and reminders. Use to save a note, manage a task or reminder, or turn meeting action items into tasks. | — |
| [`assistant-query`](plugins/core-agents/skills/assistant-query/SKILL.md) 📜 📚 | Queries saved notes, tasks, reminders, and open pull requests, and creates daily or weekly briefings. Use to find personal context, check what is due, or get a briefing. | — |
| [`m365-messaging`](plugins/core-agents/skills/m365-messaging/SKILL.md) | Read and send Microsoft Teams messages via the Teams MCP server (chats, channels, presence, mentions, search). | check Teams, any new messages, unread, DMs, message a teammate, ping the team, post to channel, what did X say, mentions, who messaged me, Teams catch up, is X online, send Teams message, notes to self, reply on Teams, send Teams file, m365 user lookup |

**Hooks**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`sessionStart: hooks/link-commands.sh`](plugins/core-agents/hooks/link-commands.sh) | On `sessionStart` runs `hooks/link-commands.sh` (timeout 10s). | — |
| [`sessionStart: hooks/ado-sync-advisory.sh`](plugins/core-agents/hooks/ado-sync-advisory.sh) | On `sessionStart` runs `hooks/ado-sync-advisory.sh` (timeout 10s). | — |
| [`agentStop: hooks/ado-session-sync.sh`](plugins/core-agents/hooks/ado-session-sync.sh) | On `agentStop` runs `hooks/ado-session-sync.sh` (timeout 20s). | — |

### `meta`

Meta-tooling for creating, auditing, packaging, scheduling, and continuously improving Copilot agents, skills, hooks, plugins, and workflows.

_Source: [`plugins/meta/`](plugins/meta/)_

**Agents**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`agent-architect`](plugins/meta/agents/agent-architect.agent.md) | Designs and improves Copilot agent systems. Use for agents, skills, hooks, plugin architecture, extension or canvas boundaries, routing, audits, and evidence-based evolution. | — |

**Skills**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`agent-architect-self-audit`](plugins/meta/skills/agent-architect-self-audit/SKILL.md) 📚 | Audits the Agent Architect's own instructions, skills, references, and memory, producing a prioritized update checklist. | — |
| [`agent-crafting`](plugins/meta/skills/agent-crafting/SKILL.md) 📚 🔒 | Creates and troubleshoots Copilot agent definitions (.agent.md). Use for persona, frontmatter, tool access, or loading and routing changes. | — |
| [`agent-skill-audit`](plugins/meta/skills/agent-skill-audit/SKILL.md) 📚 🔒 | Audits agent, skill, and hook definitions for structural quality, routing, and inventory. Use for static reviews, not architect self-audits or session-history analysis. | — |
| [`hooks-crafting`](plugins/meta/skills/hooks-crafting/SKILL.md) 📚 🔒 | Authors and troubleshoots GitHub Copilot hooks. Use for hooks.json, lifecycle events, command/HTTP/prompt configurations, tool-call decisions, context injection, notifications,… | — |
| [`plugin-crafting`](plugins/meta/skills/plugin-crafting/SKILL.md) 🔒 | Builds and troubleshoots Copilot CLI plugins and marketplaces. Use for plugin.json or marketplace.json, packaging agents/skills/hooks/commands/extensions/MCP/LSP servers, install… | — |
| [`scheduled-headless-copilot`](plugins/meta/skills/scheduled-headless-copilot/SKILL.md) 📜 📚 | Manages unattended Copilot CLI and executable tasks via Copilot Loops on macOS or OS schedulers. | — |
| [`scheduled-skill-review`](plugins/meta/skills/scheduled-skill-review/SKILL.md) 📜 📚 | Manages scheduled Copilot skill-and-agent reviews on macOS with a menu-bar app for status, control, and per-unit settings. | — |
| [`skill-crafting`](plugins/meta/skills/skill-crafting/SKILL.md) 📚 🔒 | Finds, installs, creates, and refines Agent Skills. Use for skill discovery, SKILL.md changes, or installation. | — |
| [`skill-improvement-loop`](plugins/meta/skills/skill-improvement-loop/SKILL.md) 📚 🔒 | Improves agents or skills using observed session evidence. Use for triggering issues, procedure-adherence gaps, repeated tool failures, user corrections, feedback loops, and… | — |

### `presentation`

Presentation-designer agent and supporting skills for PPTX and HTML decks, structured presentation workflows, critique, and image generation.

_Source: [`plugins/presentation/`](plugins/presentation/)_

**Agents**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`presentation-designer`](plugins/presentation/agents/presentation-designer.agent.md) | Create or revise professional presentations in PPTX or HTML. Handles outline design, AI-generated visuals, slide production, speaker notes, and multi-model quality review — all… | presentation, slides, deck, pptx, powerpoint, reveal.js, slide deck, create presentation, revise deck, edit presentation, investor deck, sales deck, training slides, exec review |

**Skills**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`html-presentation`](plugins/presentation/skills/html-presentation/SKILL.md) 🔒 | Create beautiful browser-runnable HTML presentations using reveal.js. Single self-contained HTML file with slides, transitions, speaker notes, and responsive design. | — |
| [`nano-banana-cli`](plugins/presentation/skills/nano-banana-cli/SKILL.md) 📜 📚 🔒 | Generates and edits raster images with the Nano Banana CLI. Use when the user or workflow selects Nano Banana/Gemini for images, commands, or setup. | — |
| [`pptx-creation`](plugins/presentation/skills/pptx-creation/SKILL.md) 📜 📚 🔒 | Create and rebuild professional PowerPoint presentations (.pptx) from content, outlines, or approved slide plans. | — |
| [`presentation-critique`](plugins/presentation/skills/presentation-critique/SKILL.md) 🔒 | Structured evaluation procedure for PowerPoint presentations against professional standards. | critique presentation, review slides, presentation feedback, deck review, slide quality |
| [`presentation-workflow`](plugins/presentation/skills/presentation-workflow/SKILL.md) 🔒 | End-to-end orchestration procedure for creating presentations. Covers intent capture, outline planning, image generation delegation, slide building, multi-model parallel critique,… | — |

### `docs`

Product/work-item planning skills (no agents): write-prd, prd-to-work-items.

_Source: [`plugins/docs/`](plugins/docs/)_

**Skills**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`prd-to-work-items`](plugins/docs/skills/prd-to-work-items/SKILL.md) | Decompose and create vertical-slice work items from a PRD with dependency tracking. Use when breaking down a PRD, feature spec, or requirements document into trackable GitHub… | — |
| [`write-prd`](plugins/docs/skills/write-prd/SKILL.md) | Create product requirements documents through structured discovery and interview. Use when creating a PRD, planning a feature, writing a spec, or designing a solution before… | — |

### `ui`

UI design agents (ui-designer, ui-critic) and supporting skills (ui-generation, ui-critique, ui-design-system) for production-quality React/TypeScript/Tailwind UI.

_Source: [`plugins/ui/`](plugins/ui/)_

**Agents**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`ui-critic`](plugins/ui/agents/ui-critic.agent.md) | Senior design critic and accessibility specialist. Evaluates React/TypeScript UI against design system constraints, hierarchy, accessibility, and micro-interactions. | — |
| [`ui-designer`](plugins/ui/agents/ui-designer.agent.md) | Senior UI designer and React engineer. Creates beautiful, accessible, production-quality React/TypeScript/Tailwind components. | — |

**Skills**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`ui-critique`](plugins/ui/skills/ui-critique/SKILL.md) | Review and evaluate UI components against design principles. Use when reviewing, scoring, or critiquing React/TypeScript UI code for quality, accessibility, hierarchy, and design… | — |
| [`ui-design-system`](plugins/ui/skills/ui-design-system/SKILL.md) | Review and apply design system constraints and tokens for beautiful UI generation. Use when creating, styling, or reviewing React/TypeScript UI components. | — |
| [`ui-generation`](plugins/ui/skills/ui-generation/SKILL.md) 📚 | Generate beautiful React/TypeScript UI components through a step-by-step workflow. Use when building new components, layouts, pages, or UI features. | — |

### `duty`

Role-based operational workflows: on-call incident logging/querying and structured engineering interview preparation, execution, and debriefing.

_Source: [`plugins/duty/`](plugins/duty/)_

**Agents**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`interview-manager`](plugins/duty/agents/interview-manager.agent.md) | Engineering interviewer sidekick. Helps prepare, run, and debrief Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer interviews with question banks, STAR-style… | — |
| [`oncall`](plugins/duty/agents/oncall.agent.md) | Personal on-call operations manager. Logs incidents, actions, escalations, notes, and communications with structured timestamps. | on-call, oncall, incident, shift, log, escalation, handoff, page, alert |

**Skills**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`interview-management`](plugins/duty/skills/interview-management/SKILL.md) 🔒 | Manage structured engineering interviews for Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer loops. | interviewer, frontend interview, fullstack interview, hiring loop, question bank, interview history, scorecard, rubric, debrief |
| [`oncall-logging`](plugins/duty/skills/oncall-logging/SKILL.md) | Structured on-call data entry: workspace initialization, shift lifecycle, log entries (incidents, actions, notes, escalations, comms), entry linking, incident management, and file… | log, incident, shift start, shift end, on-call entry, escalation, action taken |
| [`oncall-query`](plugins/duty/skills/oncall-query/SKILL.md) | Search, filter, aggregate, and report on on-call data. Timeline views, active incidents, shift handoffs, weekly summaries, and metrics. | query, search, find, show, list, report, handoff, summary, metrics, timeline, what happened, open incidents |

## By type

### Agents

| Name | Plugin | Description | Triggers / Keywords |
| --- | --- | --- | --- |
| [`agent-architect`](plugins/meta/agents/agent-architect.agent.md) | `meta` | Designs and improves Copilot agent systems. Use for agents, skills, hooks, plugin architecture, extension or canvas boundaries, routing, audits, and evidence-based evolution. | — |
| [`assistant`](plugins/core-agents/agents/assistant.agent.md) | `core-agents` | Personal assistant for notes, tasks, reminders, and Microsoft Teams messaging. Takes meeting notes, captures ideas, tracks decisions, manages todo lists with priorities and due… | note, task, todo, remind, meeting notes, decision, what's due, daily summary, action items, ideas, take a note, add task, set reminder, what did I decide, scratch, jot down, work items, ADO, sprint, my bugs, check Teams, any new messages, unread, DMs, message a teammate, ping the team, post to channel, what did X say, Teams catch up, is X online, notes to self |
| [`azure-ops`](plugins/core-agents/agents/azure-ops.agent.md) | `core-agents` | Azure CLI operations expert. Manages Azure resources, DevOps (boards, repos, pipelines, wiki), identity, infrastructure, monitoring, and more via the az CLI. | — |
| [`interview-manager`](plugins/duty/agents/interview-manager.agent.md) | `duty` | Engineering interviewer sidekick. Helps prepare, run, and debrief Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer interviews with question banks, STAR-style… | — |
| [`oncall`](plugins/duty/agents/oncall.agent.md) | `duty` | Personal on-call operations manager. Logs incidents, actions, escalations, notes, and communications with structured timestamps. | on-call, oncall, incident, shift, log, escalation, handoff, page, alert |
| [`presentation-designer`](plugins/presentation/agents/presentation-designer.agent.md) | `presentation` | Create or revise professional presentations in PPTX or HTML. Handles outline design, AI-generated visuals, slide production, speaker notes, and multi-model quality review — all… | presentation, slides, deck, pptx, powerpoint, reveal.js, slide deck, create presentation, revise deck, edit presentation, investor deck, sales deck, training slides, exec review |
| [`researcher`](plugins/core-agents/agents/researcher.agent.md) | `core-agents` | Research agent that creates academic papers, comprehensive reports, and detailed analyses with proper citations. Answers follow-up questions about completed research. | — |
| [`ui-critic`](plugins/ui/agents/ui-critic.agent.md) | `ui` | Senior design critic and accessibility specialist. Evaluates React/TypeScript UI against design system constraints, hierarchy, accessibility, and micro-interactions. | — |
| [`ui-designer`](plugins/ui/agents/ui-designer.agent.md) | `ui` | Senior UI designer and React engineer. Creates beautiful, accessible, production-quality React/TypeScript/Tailwind components. | — |

### Skills

| Name | Plugin | Description | Triggers / Keywords |
| --- | --- | --- | --- |
| [`ado-session-sync`](plugins/core-agents/skills/ado-session-sync/SKILL.md) 📜 🔒 | `core-agents` | Reviews the just-finished Copilot session and updates the related Azure DevOps work item so the ADO board stays a source of truth linking work items to the sessions that produced… | ado session sync, update work item with progress, session-to-task, sync session to ADO, stamp session id on work item, session-yield hook |
| [`agent-architect-self-audit`](plugins/meta/skills/agent-architect-self-audit/SKILL.md) 📚 | `meta` | Audits the Agent Architect's own instructions, skills, references, and memory, producing a prioritized update checklist. | — |
| [`agent-crafting`](plugins/meta/skills/agent-crafting/SKILL.md) 📚 🔒 | `meta` | Creates and troubleshoots Copilot agent definitions (.agent.md). Use for persona, frontmatter, tool access, or loading and routing changes. | — |
| [`agent-skill-audit`](plugins/meta/skills/agent-skill-audit/SKILL.md) 📚 🔒 | `meta` | Audits agent, skill, and hook definitions for structural quality, routing, and inventory. Use for static reviews, not architect self-audits or session-history analysis. | — |
| [`assistant-capture`](plugins/core-agents/skills/assistant-capture/SKILL.md) 📜 📚 | `core-agents` | Captures personal notes, tasks, and reminders. Use to save a note, manage a task or reminder, or turn meeting action items into tasks. | — |
| [`assistant-query`](plugins/core-agents/skills/assistant-query/SKILL.md) 📜 📚 | `core-agents` | Queries saved notes, tasks, reminders, and open pull requests, and creates daily or weekly briefings. Use to find personal context, check what is due, or get a briefing. | — |
| [`az`](plugins/core-skills/skills/az/SKILL.md) 📚 | `core-skills` | Generate and explain Azure CLI (`az`) commands for managing Azure and Azure DevOps. Use when the user asks for Azure CLI commands or wants to manage Azure or Azure DevOps from the… | — |
| [`browser`](plugins/core-skills/skills/browser/SKILL.md) 📜 📚 | `core-skills` | Automates websites in a dedicated signed-in browser window. Use for screenshots, rendered pages, forms, account flows, or browser network/storage inspection; not API-only tasks,… | — |
| [`create-image`](plugins/core-skills/skills/create-image/SKILL.md) 📜 📚 | `core-skills` | Generates and edits raster images with gpt-image-2 on Azure AI Foundry. Use for image generation or gpt-image command and setup help; use nano-banana-cli for Gemini. | — |
| [`grok-search`](plugins/core-skills/skills/grok-search/SKILL.md) 📜 📚 | `core-skills` | Searches live X/Twitter posts and sentiment through Grok. For other web research, use only when the user or workflow selects Grok; general news or citation requests alone do not… | — |
| [`hooks-crafting`](plugins/meta/skills/hooks-crafting/SKILL.md) 📚 🔒 | `meta` | Authors and troubleshoots GitHub Copilot hooks. Use for hooks.json, lifecycle events, command/HTTP/prompt configurations, tool-call decisions, context injection, notifications,… | — |
| [`html-presentation`](plugins/presentation/skills/html-presentation/SKILL.md) 🔒 | `presentation` | Create beautiful browser-runnable HTML presentations using reveal.js. Single self-contained HTML file with slides, transitions, speaker notes, and responsive design. | — |
| [`interview-management`](plugins/duty/skills/interview-management/SKILL.md) 🔒 | `duty` | Manage structured engineering interviews for Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer loops. | interviewer, frontend interview, fullstack interview, hiring loop, question bank, interview history, scorecard, rubric, debrief |
| [`m365-messaging`](plugins/core-agents/skills/m365-messaging/SKILL.md) | `core-agents` | Read and send Microsoft Teams messages via the Teams MCP server (chats, channels, presence, mentions, search). | check Teams, any new messages, unread, DMs, message a teammate, ping the team, post to channel, what did X say, mentions, who messaged me, Teams catch up, is X online, send Teams message, notes to self, reply on Teams, send Teams file, m365 user lookup |
| [`memory`](plugins/core-skills/skills/memory/SKILL.md) 📜 🔒 | `core-skills` | Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from… | — |
| [`multi-model-review`](plugins/core-skills/skills/multi-model-review/SKILL.md) | `core-skills` | Runs independent critics from different model vendors over one artifact, then synthesizes their findings into a ship-or-hold decision. | — |
| [`nano-banana-cli`](plugins/presentation/skills/nano-banana-cli/SKILL.md) 📜 📚 🔒 | `presentation` | Generates and edits raster images with the Nano Banana CLI. Use when the user or workflow selects Nano Banana/Gemini for images, commands, or setup. | — |
| [`narrate`](plugins/core-skills/skills/narrate/SKILL.md) 📜 📚 | `core-skills` | Creates MP3 narration and matching transcripts from documents or text. Use for read-aloud audio, audio summaries or briefs, voiceovers, podcast-style narration, and timed meeting… | — |
| [`oncall-logging`](plugins/duty/skills/oncall-logging/SKILL.md) | `duty` | Structured on-call data entry: workspace initialization, shift lifecycle, log entries (incidents, actions, notes, escalations, comms), entry linking, incident management, and file… | log, incident, shift start, shift end, on-call entry, escalation, action taken |
| [`oncall-query`](plugins/duty/skills/oncall-query/SKILL.md) | `duty` | Search, filter, aggregate, and report on on-call data. Timeline views, active incidents, shift handoffs, weekly summaries, and metrics. | query, search, find, show, list, report, handoff, summary, metrics, timeline, what happened, open incidents |
| [`plugin-crafting`](plugins/meta/skills/plugin-crafting/SKILL.md) 🔒 | `meta` | Builds and troubleshoots Copilot CLI plugins and marketplaces. Use for plugin.json or marketplace.json, packaging agents/skills/hooks/commands/extensions/MCP/LSP servers, install… | — |
| [`pptx-creation`](plugins/presentation/skills/pptx-creation/SKILL.md) 📜 📚 🔒 | `presentation` | Create and rebuild professional PowerPoint presentations (.pptx) from content, outlines, or approved slide plans. | — |
| [`prd-to-work-items`](plugins/docs/skills/prd-to-work-items/SKILL.md) | `docs` | Decompose and create vertical-slice work items from a PRD with dependency tracking. Use when breaking down a PRD, feature spec, or requirements document into trackable GitHub… | — |
| [`presentation-critique`](plugins/presentation/skills/presentation-critique/SKILL.md) 🔒 | `presentation` | Structured evaluation procedure for PowerPoint presentations against professional standards. | critique presentation, review slides, presentation feedback, deck review, slide quality |
| [`presentation-workflow`](plugins/presentation/skills/presentation-workflow/SKILL.md) 🔒 | `presentation` | End-to-end orchestration procedure for creating presentations. Covers intent capture, outline planning, image generation delegation, slide building, multi-model parallel critique,… | — |
| [`prompt-builder`](plugins/core-skills/skills/prompt-builder/SKILL.md) 📚 | `core-skills` | Writes and improves prompts for AI agents. Use when asked for a task prompt, not to execute the task or author skill or agent definitions. | — |
| [`publish-html`](plugins/core-skills/skills/publish-html/SKILL.md) 📜 📚 | `core-skills` | Publishes and replaces trusted HTML reports on an existing entitlement-protected Azure host, returning a shareable link, with recovery for interrupted uploads. | — |
| [`research-methodology`](plugins/core-skills/skills/research-methodology/SKILL.md) | `core-skills` | Structured methodology for externally sourced, cited research: web search, source verification, synthesis, and adversarial review. | — |
| [`scheduled-headless-copilot`](plugins/meta/skills/scheduled-headless-copilot/SKILL.md) 📜 📚 | `meta` | Manages unattended Copilot CLI and executable tasks via Copilot Loops on macOS or OS schedulers. | — |
| [`scheduled-skill-review`](plugins/meta/skills/scheduled-skill-review/SKILL.md) 📜 📚 | `meta` | Manages scheduled Copilot skill-and-agent reviews on macOS with a menu-bar app for status, control, and per-unit settings. | — |
| [`skill-crafting`](plugins/meta/skills/skill-crafting/SKILL.md) 📚 🔒 | `meta` | Finds, installs, creates, and refines Agent Skills. Use for skill discovery, SKILL.md changes, or installation. | — |
| [`skill-improvement-loop`](plugins/meta/skills/skill-improvement-loop/SKILL.md) 📚 🔒 | `meta` | Improves agents or skills using observed session evidence. Use for triggering issues, procedure-adherence gaps, repeated tool failures, user corrections, feedback loops, and… | — |
| [`ui-critique`](plugins/ui/skills/ui-critique/SKILL.md) | `ui` | Review and evaluate UI components against design principles. Use when reviewing, scoring, or critiquing React/TypeScript UI code for quality, accessibility, hierarchy, and design… | — |
| [`ui-design-system`](plugins/ui/skills/ui-design-system/SKILL.md) | `ui` | Review and apply design system constraints and tokens for beautiful UI generation. Use when creating, styling, or reviewing React/TypeScript UI components. | — |
| [`ui-generation`](plugins/ui/skills/ui-generation/SKILL.md) 📚 | `ui` | Generate beautiful React/TypeScript UI components through a step-by-step workflow. Use when building new components, layouts, pages, or UI features. | — |
| [`write-prd`](plugins/docs/skills/write-prd/SKILL.md) | `docs` | Create product requirements documents through structured discovery and interview. Use when creating a PRD, planning a feature, writing a spec, or designing a solution before… | — |

### Hooks

| Name | Plugin | Description | Triggers / Keywords |
| --- | --- | --- | --- |
| [`agentStop: hooks/ado-session-sync.sh`](plugins/core-agents/hooks/ado-session-sync.sh) | `core-agents` | On `agentStop` runs `hooks/ado-session-sync.sh` (timeout 20s). | — |
| [`sessionStart: hooks/ado-sync-advisory.sh`](plugins/core-agents/hooks/ado-sync-advisory.sh) | `core-agents` | On `sessionStart` runs `hooks/ado-sync-advisory.sh` (timeout 10s). | — |
| [`sessionStart: hooks/link-commands.sh`](plugins/core-agents/hooks/link-commands.sh) | `core-agents` | On `sessionStart` runs `hooks/link-commands.sh` (timeout 10s). | — |
| [`sessionStart: hooks/detect-tools.sh`](plugins/core-skills/hooks/detect-tools.sh) | `core-skills` | On `sessionStart` runs `hooks/detect-tools.sh` (timeout 15s). | — |
| [`sessionStart: hooks/lint-memory-advisory.sh`](plugins/core-skills/hooks/lint-memory-advisory.sh) | `core-skills` | On `sessionStart` runs `hooks/lint-memory-advisory.sh` (timeout 15s). | — |
