<!-- GENERATED FILE — do not edit by hand. Run `node scripts/catalog.mjs` to regenerate. -->

# Catalog

**5** plugins · **5** agents · **39** skills · **4** hooks

A single index of every agent, skill, and hook across all plugins in this marketplace. Source files (`SKILL.md`, `*.agent.md`, `hooks.json`) remain the only source of truth — this catalog is regenerated from their frontmatter by `scripts/catalog.mjs`.

> **Legend.** 📜 = ships scripts · 📚 = ships references · 🔒 = `user-invocable: false`

## Quick index

Flat alphabetical lookup. Click a name to jump to its source file.

| Name | Type | Plugin | Description |
| --- | --- | --- | --- |
| [`ado-session-sync`](plugins/mnmstack/skills/ado-session-sync/SKILL.md) 📜 🔒 | skill | `mnmstack` | Reviews the just-finished Copilot session and updates the related Azure DevOps work item so the ADO board stays a source of truth linking work items to the sessions that produced… |
| [`agent-architect-self-audit`](plugins/mnmstack/skills/agent-architect-self-audit/SKILL.md) 📚 | skill | `mnmstack` | Audits the agent-system design toolkit's instructions, skills, references, and authorized memory. |
| [`agent-crafting`](plugins/mnmstack/skills/agent-crafting/SKILL.md) 📚 🔒 | skill | `mnmstack` | Creates and troubleshoots Copilot agent definitions (.agent.md). Use for persona, frontmatter, tool access, or loading and routing changes. |
| [`agent-skill-audit`](plugins/mnmstack/skills/agent-skill-audit/SKILL.md) 📚 🔒 | skill | `mnmstack` | Audits agent, skill, and hook definitions for structural quality, routing, and inventory. Use for static reviews, not architect self-audits or session-history analysis. |
| [`agent-system-design`](plugins/mnmstack/skills/agent-system-design/SKILL.md) | skill | `mnmstack` | Designs customization workflows across skills, agents, hooks, plugins, and extension or canvas boundaries. |
| [`assistant-capture`](plugins/mnmstack/skills/assistant-capture/SKILL.md) 📜 📚 | skill | `mnmstack` | Captures personal notes, tasks, and reminders. Use to save a note, manage a task or reminder, or turn meeting action items into tasks. |
| [`assistant-query`](plugins/mnmstack/skills/assistant-query/SKILL.md) 📜 📚 | skill | `mnmstack` | Queries saved notes, tasks, reminders, and open pull requests, and creates daily or weekly briefings. Use to find personal context, check what is due, or get a briefing. |
| [`az`](plugins/mnmstack/skills/az/SKILL.md) 📚 | skill | `mnmstack` | Generate and explain Azure CLI (`az`) commands for managing Azure and Azure DevOps. Use when the user asks for Azure CLI commands or wants to manage Azure or Azure DevOps from the… |
| [`browser`](plugins/mnmstack/skills/browser/SKILL.md) 📜 📚 | skill | `mnmstack` | Automates websites in a dedicated signed-in browser window. Use for screenshots, rendered pages, forms, account flows, or browser network/storage inspection; not API-only tasks,… |
| [`create-image`](plugins/mnmstack/skills/create-image/SKILL.md) 📜 📚 | skill | `mnmstack` | Generates and edits raster images with gpt-image-2 on Azure AI Foundry. Use for image generation or gpt-image command and setup help; use nano-banana-cli for Gemini. |
| [`github-session-sync`](plugins/mnmstack/skills/github-session-sync/SKILL.md) 📜 🔒 | skill | `mnmstack` | Reviews the just-finished Copilot session and updates the related GitHub issue so the GitHub personal board stays a source of truth linking issues to the sessions that produced… |
| [`grok-search`](plugins/mnmstack/skills/grok-search/SKILL.md) 📜 📚 | skill | `mnmstack` | Searches live X/Twitter posts and sentiment through Grok. For other web research, use only when the user or workflow selects Grok; general news or citation requests alone do not… |
| [`hooks-crafting`](plugins/mnmstack/skills/hooks-crafting/SKILL.md) 📚 🔒 | skill | `mnmstack` | Authors and troubleshoots GitHub Copilot hooks. Use for hooks.json, lifecycle events, command/HTTP/prompt configurations, tool-call decisions, context injection, notifications,… |
| [`html-presentation`](plugins/presentation/skills/html-presentation/SKILL.md) 🔒 | skill | `presentation` | Create beautiful browser-runnable HTML presentations using reveal.js. Single self-contained HTML file with slides, transitions, speaker notes, and responsive design. |
| [`interview-management`](plugins/duty/skills/interview-management/SKILL.md) 🔒 | skill | `duty` | Manage structured engineering interviews for Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer loops. |
| [`interview-manager`](plugins/duty/agents/interview-manager.agent.md) | agent | `duty` | Engineering interviewer sidekick. Helps prepare, run, and debrief Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer interviews with question banks, STAR-style… |
| [`issue-updates`](plugins/mnmstack/skills/issue-updates/SKILL.md) | skill | `mnmstack` | Updates existing GitHub issues and Azure DevOps work items: comments, fields, assignments, and state. |
| [`m365-messaging`](plugins/mnmstack/skills/m365-messaging/SKILL.md) | skill | `mnmstack` | Read and send Microsoft Teams messages via the Teams MCP server (chats, channels, presence, mentions, search). |
| [`memory`](plugins/mnmstack/skills/memory/SKILL.md) 📜 🔒 | skill | `mnmstack` | Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from… |
| [`multi-model-review`](plugins/mnmstack/skills/multi-model-review/SKILL.md) | skill | `mnmstack` | Runs independent critics from different model vendors over one artifact, then synthesizes their findings into a ship-or-hold decision. |
| [`nano-banana-cli`](plugins/presentation/skills/nano-banana-cli/SKILL.md) 📜 📚 🔒 | skill | `presentation` | Generates and edits raster images with the Nano Banana CLI. Use when the user or workflow selects Nano Banana/Gemini for images, commands, or setup. |
| [`narrate`](plugins/mnmstack/skills/narrate/SKILL.md) 📜 📚 | skill | `mnmstack` | Creates MP3 narration and matching transcripts from documents or text. Use for read-aloud audio, audio summaries or briefs, voiceovers, podcast-style narration, and timed meeting… |
| [`oncall`](plugins/duty/agents/oncall.agent.md) | agent | `duty` | Personal on-call operations manager. Logs incidents, actions, escalations, notes, and communications with structured timestamps. |
| [`oncall-logging`](plugins/duty/skills/oncall-logging/SKILL.md) | skill | `duty` | Structured on-call data entry: workspace initialization, shift lifecycle, log entries (incidents, actions, notes, escalations, comms), entry linking, incident management, and file… |
| [`oncall-query`](plugins/duty/skills/oncall-query/SKILL.md) | skill | `duty` | Search, filter, aggregate, and report on on-call data. Timeline views, active incidents, shift handoffs, weekly summaries, and metrics. |
| [`plugin-crafting`](plugins/mnmstack/skills/plugin-crafting/SKILL.md) 🔒 | skill | `mnmstack` | Builds and troubleshoots Copilot CLI plugins and marketplaces. Use for plugin.json or marketplace.json, packaging agents/skills/hooks/commands/extensions/MCP/LSP servers, install… |
| [`pptx-creation`](plugins/presentation/skills/pptx-creation/SKILL.md) 📜 📚 🔒 | skill | `presentation` | Create and rebuild professional PowerPoint presentations (.pptx) from content, outlines, or approved slide plans. |
| [`prd-to-work-items`](plugins/docs/skills/prd-to-work-items/SKILL.md) | skill | `docs` | Decompose and create vertical-slice work items from a PRD with dependency tracking. Use when breaking down a PRD, feature spec, or requirements document into trackable GitHub… |
| [`presentation-critique`](plugins/presentation/skills/presentation-critique/SKILL.md) 🔒 | skill | `presentation` | Structured evaluation procedure for PowerPoint presentations against professional standards. |
| [`presentation-designer`](plugins/presentation/agents/presentation-designer.agent.md) | agent | `presentation` | Create or revise professional presentations in PPTX or HTML. Handles outline design, AI-generated visuals, slide production, speaker notes, and multi-model quality review — all… |
| [`presentation-workflow`](plugins/presentation/skills/presentation-workflow/SKILL.md) 🔒 | skill | `presentation` | End-to-end orchestration procedure for creating presentations. Covers intent capture, outline planning, image generation delegation, slide building, multi-model parallel critique,… |
| [`prompt-builder`](plugins/mnmstack/skills/prompt-builder/SKILL.md) 📚 | skill | `mnmstack` | Writes and improves prompts for AI agents. Use when asked for a task prompt, not to execute the task or author skill or agent definitions. |
| [`publish-html`](plugins/mnmstack/skills/publish-html/SKILL.md) 📜 📚 | skill | `mnmstack` | Publishes and replaces trusted HTML reports on an existing entitlement-protected Azure host, returning a shareable link, with recovery for interrupted uploads. |
| [`research-methodology`](plugins/mnmstack/skills/research-methodology/SKILL.md) 📚 | skill | `mnmstack` | Conducts cited external research and answers questions about saved research reports. Use for literature reviews, technology comparisons, market reports, or multi-source… |
| [`scheduled-headless-copilot`](plugins/mnmstack/skills/scheduled-headless-copilot/SKILL.md) 📜 📚 | skill | `mnmstack` | Manages unattended Copilot CLI and executable tasks via Copilot Loops on macOS or OS schedulers. |
| [`scheduled-skill-review`](plugins/mnmstack/skills/scheduled-skill-review/SKILL.md) 📜 📚 | skill | `mnmstack` | Manages scheduled Copilot skill-and-agent reviews on macOS with a menu-bar app for status, control, and per-unit settings. |
| [`sessionStart: hooks/ado-sync-advisory.sh`](plugins/mnmstack/hooks/ado-sync-advisory.sh) | hook | `mnmstack` | On `sessionStart` runs `hooks/ado-sync-advisory.sh` (timeout 10s). |
| [`sessionStart: hooks/detect-tools.sh`](plugins/mnmstack/hooks/detect-tools.sh) | hook | `mnmstack` | On `sessionStart` runs `hooks/detect-tools.sh` (timeout 15s). |
| [`sessionStart: hooks/link-commands.sh`](plugins/mnmstack/hooks/link-commands.sh) | hook | `mnmstack` | On `sessionStart` runs `hooks/link-commands.sh` (timeout 10s). |
| [`sessionStart: hooks/lint-memory-advisory.sh`](plugins/mnmstack/hooks/lint-memory-advisory.sh) | hook | `mnmstack` | On `sessionStart` runs `hooks/lint-memory-advisory.sh` (timeout 15s). |
| [`skill-crafting`](plugins/mnmstack/skills/skill-crafting/SKILL.md) 📚 🔒 | skill | `mnmstack` | Finds, installs, creates, and refines Agent Skills. Use for skill discovery, SKILL.md changes, or installation. |
| [`skill-improvement-loop`](plugins/mnmstack/skills/skill-improvement-loop/SKILL.md) 📚 🔒 | skill | `mnmstack` | Improves agents or skills using observed session evidence. Use for triggering issues, procedure-adherence gaps, repeated tool failures, user corrections, feedback loops, and… |
| [`ui-critic`](plugins/ui/agents/ui-critic.agent.md) | agent | `ui` | Senior design critic and accessibility specialist. Evaluates React/TypeScript UI against design system constraints, hierarchy, accessibility, and micro-interactions. |
| [`ui-critique`](plugins/ui/skills/ui-critique/SKILL.md) | skill | `ui` | Review and evaluate UI components against design principles. Use when reviewing, scoring, or critiquing React/TypeScript UI code for quality, accessibility, hierarchy, and design… |
| [`ui-design-system`](plugins/ui/skills/ui-design-system/SKILL.md) | skill | `ui` | Review and apply design system constraints and tokens for beautiful UI generation. Use when creating, styling, or reviewing React/TypeScript UI components. |
| [`ui-designer`](plugins/ui/agents/ui-designer.agent.md) | agent | `ui` | Senior UI designer and React engineer. Creates beautiful, accessible, production-quality React/TypeScript/Tailwind components. |
| [`ui-generation`](plugins/ui/skills/ui-generation/SKILL.md) 📚 | skill | `ui` | Generate beautiful React/TypeScript UI components through a step-by-step workflow. Use when building new components, layouts, pages, or UI features. |
| [`write-prd`](plugins/docs/skills/write-prd/SKILL.md) | skill | `docs` | Create product requirements documents through structured discovery and interview. Use when creating a PRD, planning a feature, writing a spec, or designing a solution before… |

## By plugin

### `mnmstack`

Skills for browser automation, Azure and DevOps, research, personal tasks and messaging, and Copilot customization. Replaces core-skills, core-agents, and meta without custom agent definitions.

_Source: [`plugins/mnmstack/`](plugins/mnmstack/)_

**Skills**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`ado-session-sync`](plugins/mnmstack/skills/ado-session-sync/SKILL.md) 📜 🔒 | Reviews the just-finished Copilot session and updates the related Azure DevOps work item so the ADO board stays a source of truth linking work items to the sessions that produced… | ado session sync, update work item with progress, session-to-task, sync session to ADO, stamp session id on work item, session-yield hook |
| [`agent-architect-self-audit`](plugins/mnmstack/skills/agent-architect-self-audit/SKILL.md) 📚 | Audits the agent-system design toolkit's instructions, skills, references, and authorized memory. | — |
| [`agent-crafting`](plugins/mnmstack/skills/agent-crafting/SKILL.md) 📚 🔒 | Creates and troubleshoots Copilot agent definitions (.agent.md). Use for persona, frontmatter, tool access, or loading and routing changes. | — |
| [`agent-skill-audit`](plugins/mnmstack/skills/agent-skill-audit/SKILL.md) 📚 🔒 | Audits agent, skill, and hook definitions for structural quality, routing, and inventory. Use for static reviews, not architect self-audits or session-history analysis. | — |
| [`agent-system-design`](plugins/mnmstack/skills/agent-system-design/SKILL.md) | Designs customization workflows across skills, agents, hooks, plugins, and extension or canvas boundaries. | — |
| [`assistant-capture`](plugins/mnmstack/skills/assistant-capture/SKILL.md) 📜 📚 | Captures personal notes, tasks, and reminders. Use to save a note, manage a task or reminder, or turn meeting action items into tasks. | — |
| [`assistant-query`](plugins/mnmstack/skills/assistant-query/SKILL.md) 📜 📚 | Queries saved notes, tasks, reminders, and open pull requests, and creates daily or weekly briefings. Use to find personal context, check what is due, or get a briefing. | — |
| [`az`](plugins/mnmstack/skills/az/SKILL.md) 📚 | Generate and explain Azure CLI (`az`) commands for managing Azure and Azure DevOps. Use when the user asks for Azure CLI commands or wants to manage Azure or Azure DevOps from the… | — |
| [`browser`](plugins/mnmstack/skills/browser/SKILL.md) 📜 📚 | Automates websites in a dedicated signed-in browser window. Use for screenshots, rendered pages, forms, account flows, or browser network/storage inspection; not API-only tasks,… | — |
| [`create-image`](plugins/mnmstack/skills/create-image/SKILL.md) 📜 📚 | Generates and edits raster images with gpt-image-2 on Azure AI Foundry. Use for image generation or gpt-image command and setup help; use nano-banana-cli for Gemini. | — |
| [`github-session-sync`](plugins/mnmstack/skills/github-session-sync/SKILL.md) 📜 🔒 | Reviews the just-finished Copilot session and updates the related GitHub issue so the GitHub personal board stays a source of truth linking issues to the sessions that produced… | github session sync, update issue with progress, session-to-issue, sync session to github, stamp issue with session, session-yield hook |
| [`grok-search`](plugins/mnmstack/skills/grok-search/SKILL.md) 📜 📚 | Searches live X/Twitter posts and sentiment through Grok. For other web research, use only when the user or workflow selects Grok; general news or citation requests alone do not… | — |
| [`hooks-crafting`](plugins/mnmstack/skills/hooks-crafting/SKILL.md) 📚 🔒 | Authors and troubleshoots GitHub Copilot hooks. Use for hooks.json, lifecycle events, command/HTTP/prompt configurations, tool-call decisions, context injection, notifications,… | — |
| [`issue-updates`](plugins/mnmstack/skills/issue-updates/SKILL.md) | Updates existing GitHub issues and Azure DevOps work items: comments, fields, assignments, and state. | — |
| [`m365-messaging`](plugins/mnmstack/skills/m365-messaging/SKILL.md) | Read and send Microsoft Teams messages via the Teams MCP server (chats, channels, presence, mentions, search). | check Teams, any new messages, unread, DMs, message a teammate, ping the team, post to channel, what did X say, mentions, who messaged me, Teams catch up, is X online, send Teams message, notes to self, reply on Teams, send Teams file, m365 user lookup |
| [`memory`](plugins/mnmstack/skills/memory/SKILL.md) 📜 🔒 | Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from… | — |
| [`multi-model-review`](plugins/mnmstack/skills/multi-model-review/SKILL.md) | Runs independent critics from different model vendors over one artifact, then synthesizes their findings into a ship-or-hold decision. | — |
| [`narrate`](plugins/mnmstack/skills/narrate/SKILL.md) 📜 📚 | Creates MP3 narration and matching transcripts from documents or text. Use for read-aloud audio, audio summaries or briefs, voiceovers, podcast-style narration, and timed meeting… | — |
| [`plugin-crafting`](plugins/mnmstack/skills/plugin-crafting/SKILL.md) 🔒 | Builds and troubleshoots Copilot CLI plugins and marketplaces. Use for plugin.json or marketplace.json, packaging agents/skills/hooks/commands/extensions/MCP/LSP servers, install… | — |
| [`prompt-builder`](plugins/mnmstack/skills/prompt-builder/SKILL.md) 📚 | Writes and improves prompts for AI agents. Use when asked for a task prompt, not to execute the task or author skill or agent definitions. | — |
| [`publish-html`](plugins/mnmstack/skills/publish-html/SKILL.md) 📜 📚 | Publishes and replaces trusted HTML reports on an existing entitlement-protected Azure host, returning a shareable link, with recovery for interrupted uploads. | — |
| [`research-methodology`](plugins/mnmstack/skills/research-methodology/SKILL.md) 📚 | Conducts cited external research and answers questions about saved research reports. Use for literature reviews, technology comparisons, market reports, or multi-source… | — |
| [`scheduled-headless-copilot`](plugins/mnmstack/skills/scheduled-headless-copilot/SKILL.md) 📜 📚 | Manages unattended Copilot CLI and executable tasks via Copilot Loops on macOS or OS schedulers. | — |
| [`scheduled-skill-review`](plugins/mnmstack/skills/scheduled-skill-review/SKILL.md) 📜 📚 | Manages scheduled Copilot skill-and-agent reviews on macOS with a menu-bar app for status, control, and per-unit settings. | — |
| [`skill-crafting`](plugins/mnmstack/skills/skill-crafting/SKILL.md) 📚 🔒 | Finds, installs, creates, and refines Agent Skills. Use for skill discovery, SKILL.md changes, or installation. | — |
| [`skill-improvement-loop`](plugins/mnmstack/skills/skill-improvement-loop/SKILL.md) 📚 🔒 | Improves agents or skills using observed session evidence. Use for triggering issues, procedure-adherence gaps, repeated tool failures, user corrections, feedback loops, and… | — |

**Hooks**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`sessionStart: hooks/lint-memory-advisory.sh`](plugins/mnmstack/hooks/lint-memory-advisory.sh) | On `sessionStart` runs `hooks/lint-memory-advisory.sh` (timeout 15s). | — |
| [`sessionStart: hooks/detect-tools.sh`](plugins/mnmstack/hooks/detect-tools.sh) | On `sessionStart` runs `hooks/detect-tools.sh` (timeout 15s). | — |
| [`sessionStart: hooks/link-commands.sh`](plugins/mnmstack/hooks/link-commands.sh) | On `sessionStart` runs `hooks/link-commands.sh` (timeout 10s). | — |
| [`sessionStart: hooks/ado-sync-advisory.sh`](plugins/mnmstack/hooks/ado-sync-advisory.sh) | On `sessionStart` runs `hooks/ado-sync-advisory.sh` (timeout 10s). | — |

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
| [`interview-manager`](plugins/duty/agents/interview-manager.agent.md) | `duty` | Engineering interviewer sidekick. Helps prepare, run, and debrief Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer interviews with question banks, STAR-style… | — |
| [`oncall`](plugins/duty/agents/oncall.agent.md) | `duty` | Personal on-call operations manager. Logs incidents, actions, escalations, notes, and communications with structured timestamps. | on-call, oncall, incident, shift, log, escalation, handoff, page, alert |
| [`presentation-designer`](plugins/presentation/agents/presentation-designer.agent.md) | `presentation` | Create or revise professional presentations in PPTX or HTML. Handles outline design, AI-generated visuals, slide production, speaker notes, and multi-model quality review — all… | presentation, slides, deck, pptx, powerpoint, reveal.js, slide deck, create presentation, revise deck, edit presentation, investor deck, sales deck, training slides, exec review |
| [`ui-critic`](plugins/ui/agents/ui-critic.agent.md) | `ui` | Senior design critic and accessibility specialist. Evaluates React/TypeScript UI against design system constraints, hierarchy, accessibility, and micro-interactions. | — |
| [`ui-designer`](plugins/ui/agents/ui-designer.agent.md) | `ui` | Senior UI designer and React engineer. Creates beautiful, accessible, production-quality React/TypeScript/Tailwind components. | — |

### Skills

| Name | Plugin | Description | Triggers / Keywords |
| --- | --- | --- | --- |
| [`ado-session-sync`](plugins/mnmstack/skills/ado-session-sync/SKILL.md) 📜 🔒 | `mnmstack` | Reviews the just-finished Copilot session and updates the related Azure DevOps work item so the ADO board stays a source of truth linking work items to the sessions that produced… | ado session sync, update work item with progress, session-to-task, sync session to ADO, stamp session id on work item, session-yield hook |
| [`agent-architect-self-audit`](plugins/mnmstack/skills/agent-architect-self-audit/SKILL.md) 📚 | `mnmstack` | Audits the agent-system design toolkit's instructions, skills, references, and authorized memory. | — |
| [`agent-crafting`](plugins/mnmstack/skills/agent-crafting/SKILL.md) 📚 🔒 | `mnmstack` | Creates and troubleshoots Copilot agent definitions (.agent.md). Use for persona, frontmatter, tool access, or loading and routing changes. | — |
| [`agent-skill-audit`](plugins/mnmstack/skills/agent-skill-audit/SKILL.md) 📚 🔒 | `mnmstack` | Audits agent, skill, and hook definitions for structural quality, routing, and inventory. Use for static reviews, not architect self-audits or session-history analysis. | — |
| [`agent-system-design`](plugins/mnmstack/skills/agent-system-design/SKILL.md) | `mnmstack` | Designs customization workflows across skills, agents, hooks, plugins, and extension or canvas boundaries. | — |
| [`assistant-capture`](plugins/mnmstack/skills/assistant-capture/SKILL.md) 📜 📚 | `mnmstack` | Captures personal notes, tasks, and reminders. Use to save a note, manage a task or reminder, or turn meeting action items into tasks. | — |
| [`assistant-query`](plugins/mnmstack/skills/assistant-query/SKILL.md) 📜 📚 | `mnmstack` | Queries saved notes, tasks, reminders, and open pull requests, and creates daily or weekly briefings. Use to find personal context, check what is due, or get a briefing. | — |
| [`az`](plugins/mnmstack/skills/az/SKILL.md) 📚 | `mnmstack` | Generate and explain Azure CLI (`az`) commands for managing Azure and Azure DevOps. Use when the user asks for Azure CLI commands or wants to manage Azure or Azure DevOps from the… | — |
| [`browser`](plugins/mnmstack/skills/browser/SKILL.md) 📜 📚 | `mnmstack` | Automates websites in a dedicated signed-in browser window. Use for screenshots, rendered pages, forms, account flows, or browser network/storage inspection; not API-only tasks,… | — |
| [`create-image`](plugins/mnmstack/skills/create-image/SKILL.md) 📜 📚 | `mnmstack` | Generates and edits raster images with gpt-image-2 on Azure AI Foundry. Use for image generation or gpt-image command and setup help; use nano-banana-cli for Gemini. | — |
| [`github-session-sync`](plugins/mnmstack/skills/github-session-sync/SKILL.md) 📜 🔒 | `mnmstack` | Reviews the just-finished Copilot session and updates the related GitHub issue so the GitHub personal board stays a source of truth linking issues to the sessions that produced… | github session sync, update issue with progress, session-to-issue, sync session to github, stamp issue with session, session-yield hook |
| [`grok-search`](plugins/mnmstack/skills/grok-search/SKILL.md) 📜 📚 | `mnmstack` | Searches live X/Twitter posts and sentiment through Grok. For other web research, use only when the user or workflow selects Grok; general news or citation requests alone do not… | — |
| [`hooks-crafting`](plugins/mnmstack/skills/hooks-crafting/SKILL.md) 📚 🔒 | `mnmstack` | Authors and troubleshoots GitHub Copilot hooks. Use for hooks.json, lifecycle events, command/HTTP/prompt configurations, tool-call decisions, context injection, notifications,… | — |
| [`html-presentation`](plugins/presentation/skills/html-presentation/SKILL.md) 🔒 | `presentation` | Create beautiful browser-runnable HTML presentations using reveal.js. Single self-contained HTML file with slides, transitions, speaker notes, and responsive design. | — |
| [`interview-management`](plugins/duty/skills/interview-management/SKILL.md) 🔒 | `duty` | Manage structured engineering interviews for Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer loops. | interviewer, frontend interview, fullstack interview, hiring loop, question bank, interview history, scorecard, rubric, debrief |
| [`issue-updates`](plugins/mnmstack/skills/issue-updates/SKILL.md) | `mnmstack` | Updates existing GitHub issues and Azure DevOps work items: comments, fields, assignments, and state. | — |
| [`m365-messaging`](plugins/mnmstack/skills/m365-messaging/SKILL.md) | `mnmstack` | Read and send Microsoft Teams messages via the Teams MCP server (chats, channels, presence, mentions, search). | check Teams, any new messages, unread, DMs, message a teammate, ping the team, post to channel, what did X say, mentions, who messaged me, Teams catch up, is X online, send Teams message, notes to self, reply on Teams, send Teams file, m365 user lookup |
| [`memory`](plugins/mnmstack/skills/memory/SKILL.md) 📜 🔒 | `mnmstack` | Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from… | — |
| [`multi-model-review`](plugins/mnmstack/skills/multi-model-review/SKILL.md) | `mnmstack` | Runs independent critics from different model vendors over one artifact, then synthesizes their findings into a ship-or-hold decision. | — |
| [`nano-banana-cli`](plugins/presentation/skills/nano-banana-cli/SKILL.md) 📜 📚 🔒 | `presentation` | Generates and edits raster images with the Nano Banana CLI. Use when the user or workflow selects Nano Banana/Gemini for images, commands, or setup. | — |
| [`narrate`](plugins/mnmstack/skills/narrate/SKILL.md) 📜 📚 | `mnmstack` | Creates MP3 narration and matching transcripts from documents or text. Use for read-aloud audio, audio summaries or briefs, voiceovers, podcast-style narration, and timed meeting… | — |
| [`oncall-logging`](plugins/duty/skills/oncall-logging/SKILL.md) | `duty` | Structured on-call data entry: workspace initialization, shift lifecycle, log entries (incidents, actions, notes, escalations, comms), entry linking, incident management, and file… | log, incident, shift start, shift end, on-call entry, escalation, action taken |
| [`oncall-query`](plugins/duty/skills/oncall-query/SKILL.md) | `duty` | Search, filter, aggregate, and report on on-call data. Timeline views, active incidents, shift handoffs, weekly summaries, and metrics. | query, search, find, show, list, report, handoff, summary, metrics, timeline, what happened, open incidents |
| [`plugin-crafting`](plugins/mnmstack/skills/plugin-crafting/SKILL.md) 🔒 | `mnmstack` | Builds and troubleshoots Copilot CLI plugins and marketplaces. Use for plugin.json or marketplace.json, packaging agents/skills/hooks/commands/extensions/MCP/LSP servers, install… | — |
| [`pptx-creation`](plugins/presentation/skills/pptx-creation/SKILL.md) 📜 📚 🔒 | `presentation` | Create and rebuild professional PowerPoint presentations (.pptx) from content, outlines, or approved slide plans. | — |
| [`prd-to-work-items`](plugins/docs/skills/prd-to-work-items/SKILL.md) | `docs` | Decompose and create vertical-slice work items from a PRD with dependency tracking. Use when breaking down a PRD, feature spec, or requirements document into trackable GitHub… | — |
| [`presentation-critique`](plugins/presentation/skills/presentation-critique/SKILL.md) 🔒 | `presentation` | Structured evaluation procedure for PowerPoint presentations against professional standards. | critique presentation, review slides, presentation feedback, deck review, slide quality |
| [`presentation-workflow`](plugins/presentation/skills/presentation-workflow/SKILL.md) 🔒 | `presentation` | End-to-end orchestration procedure for creating presentations. Covers intent capture, outline planning, image generation delegation, slide building, multi-model parallel critique,… | — |
| [`prompt-builder`](plugins/mnmstack/skills/prompt-builder/SKILL.md) 📚 | `mnmstack` | Writes and improves prompts for AI agents. Use when asked for a task prompt, not to execute the task or author skill or agent definitions. | — |
| [`publish-html`](plugins/mnmstack/skills/publish-html/SKILL.md) 📜 📚 | `mnmstack` | Publishes and replaces trusted HTML reports on an existing entitlement-protected Azure host, returning a shareable link, with recovery for interrupted uploads. | — |
| [`research-methodology`](plugins/mnmstack/skills/research-methodology/SKILL.md) 📚 | `mnmstack` | Conducts cited external research and answers questions about saved research reports. Use for literature reviews, technology comparisons, market reports, or multi-source… | — |
| [`scheduled-headless-copilot`](plugins/mnmstack/skills/scheduled-headless-copilot/SKILL.md) 📜 📚 | `mnmstack` | Manages unattended Copilot CLI and executable tasks via Copilot Loops on macOS or OS schedulers. | — |
| [`scheduled-skill-review`](plugins/mnmstack/skills/scheduled-skill-review/SKILL.md) 📜 📚 | `mnmstack` | Manages scheduled Copilot skill-and-agent reviews on macOS with a menu-bar app for status, control, and per-unit settings. | — |
| [`skill-crafting`](plugins/mnmstack/skills/skill-crafting/SKILL.md) 📚 🔒 | `mnmstack` | Finds, installs, creates, and refines Agent Skills. Use for skill discovery, SKILL.md changes, or installation. | — |
| [`skill-improvement-loop`](plugins/mnmstack/skills/skill-improvement-loop/SKILL.md) 📚 🔒 | `mnmstack` | Improves agents or skills using observed session evidence. Use for triggering issues, procedure-adherence gaps, repeated tool failures, user corrections, feedback loops, and… | — |
| [`ui-critique`](plugins/ui/skills/ui-critique/SKILL.md) | `ui` | Review and evaluate UI components against design principles. Use when reviewing, scoring, or critiquing React/TypeScript UI code for quality, accessibility, hierarchy, and design… | — |
| [`ui-design-system`](plugins/ui/skills/ui-design-system/SKILL.md) | `ui` | Review and apply design system constraints and tokens for beautiful UI generation. Use when creating, styling, or reviewing React/TypeScript UI components. | — |
| [`ui-generation`](plugins/ui/skills/ui-generation/SKILL.md) 📚 | `ui` | Generate beautiful React/TypeScript UI components through a step-by-step workflow. Use when building new components, layouts, pages, or UI features. | — |
| [`write-prd`](plugins/docs/skills/write-prd/SKILL.md) | `docs` | Create product requirements documents through structured discovery and interview. Use when creating a PRD, planning a feature, writing a spec, or designing a solution before… | — |

### Hooks

| Name | Plugin | Description | Triggers / Keywords |
| --- | --- | --- | --- |
| [`sessionStart: hooks/ado-sync-advisory.sh`](plugins/mnmstack/hooks/ado-sync-advisory.sh) | `mnmstack` | On `sessionStart` runs `hooks/ado-sync-advisory.sh` (timeout 10s). | — |
| [`sessionStart: hooks/detect-tools.sh`](plugins/mnmstack/hooks/detect-tools.sh) | `mnmstack` | On `sessionStart` runs `hooks/detect-tools.sh` (timeout 15s). | — |
| [`sessionStart: hooks/link-commands.sh`](plugins/mnmstack/hooks/link-commands.sh) | `mnmstack` | On `sessionStart` runs `hooks/link-commands.sh` (timeout 10s). | — |
| [`sessionStart: hooks/lint-memory-advisory.sh`](plugins/mnmstack/hooks/lint-memory-advisory.sh) | `mnmstack` | On `sessionStart` runs `hooks/lint-memory-advisory.sh` (timeout 15s). | — |
