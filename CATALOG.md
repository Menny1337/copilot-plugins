<!-- GENERATED FILE — do not edit by hand. Run `node scripts/catalog.mjs` to regenerate. -->

# Catalog

**7** plugins · **9** agents · **34** skills · **5** hooks

A single index of every agent, skill, and hook across all plugins in this marketplace. Source files (`SKILL.md`, `*.agent.md`, `hooks.json`) remain the only source of truth — this catalog is regenerated from their frontmatter by `scripts/catalog.mjs`.

> **Legend.** 📜 = ships scripts · 📚 = ships references · 🔒 = `user-invocable: false`

## Quick index

Flat alphabetical lookup. Click a name to jump to its source file.

| Name | Type | Plugin | Description |
| --- | --- | --- | --- |
| [`ado-session-sync`](plugins/core-agents/skills/ado-session-sync/SKILL.md) 📜 🔒 | skill | `core-agents` | Reviews the just-finished Copilot session and updates the related Azure DevOps work item so the ADO board stays a source of truth linking work items to the sessions that produced… |
| [`agent-architect`](plugins/meta/agents/agent-architect.agent.md) | agent | `meta` | Designs and improves Copilot agent systems. Use for agent or skill audits, creation, frontmatter and routing problems, hooks or plugin architecture, and evidence-based evolution. |
| [`agent-crafting`](plugins/meta/skills/agent-crafting/SKILL.md) 📚 🔒 | skill | `meta` | Creates and refines custom Copilot agents. Use for scaffolding, frontmatter or tool configuration, role and boundary design, invocation behavior, and troubleshooting loading or… |
| [`agent-skill-audit`](plugins/meta/skills/agent-skill-audit/SKILL.md) 📚 🔒 | skill | `meta` | Audits and improves Copilot agents, skills, and hooks. Use for inventory, frontmatter validation, routing or overlap issues, quality scoring, separation-of-concerns, security… |
| [`agentStop: hooks/ado-session-sync.sh`](plugins/core-agents/hooks/ado-session-sync.sh) | hook | `core-agents` | On `agentStop` runs `hooks/ado-session-sync.sh` (timeout 20s). |
| [`assistant`](plugins/core-agents/agents/assistant.agent.md) | agent | `core-agents` | Personal assistant for notes, tasks, reminders, and Microsoft Teams messaging. Takes meeting notes, captures ideas, tracks decisions, manages todo lists with priorities and due… |
| [`assistant-capture`](plugins/core-agents/skills/assistant-capture/SKILL.md) 📜 | skill | `core-agents` | Structured data entry for personal assistant: note creation (meetings, decisions, ideas, scratch), task management (add, update, complete, reopen), reminder management (set,… |
| [`assistant-query`](plugins/core-agents/skills/assistant-query/SKILL.md) 📜 | skill | `core-agents` | Search, filter, and summarize personal assistant data: find notes by keyword or date, list tasks by status or priority, check due reminders, surface related context, and generate… |
| [`az`](plugins/core-skills/skills/az/SKILL.md) 📚 | skill | `core-skills` | Generate and explain Azure CLI (`az`) commands for managing Azure and Azure DevOps. Use when the user asks for Azure CLI commands or wants to manage Azure or Azure DevOps from the… |
| [`azure-ops`](plugins/core-agents/agents/azure-ops.agent.md) | agent | `core-agents` | Azure CLI operations expert. Manages Azure resources, DevOps (boards, repos, pipelines, wiki), identity, infrastructure, monitoring, and more via the az CLI. |
| [`browser`](plugins/core-skills/skills/browser/SKILL.md) 📜 📚 | skill | `core-skills` | Drive, inspect, and automate the user's live browser — open pages, click, fill forms, take screenshots, read page content, sign in to sites, capture network traffic, manage… |
| [`create-image`](plugins/core-skills/skills/create-image/SKILL.md) 📜 📚 | skill | `core-skills` | Generate and edit images with OpenAI gpt-image-2 deployed on Azure AI Foundry, via the bundled `gpt-image` Node wrapper (no external CLI required). |
| [`grok-search`](plugins/core-skills/skills/grok-search/SKILL.md) 📜 📚 | skill | `core-skills` | Ask Grok a question through the user's own logged-in browser at zero API cost, and get the answer plus cited X post links. |
| [`hooks-crafting`](plugins/meta/skills/hooks-crafting/SKILL.md) 📚 🔒 | skill | `meta` | Authors and troubleshoots GitHub Copilot hooks. Use for hooks.json, lifecycle events, command/HTTP/prompt configurations, tool-call decisions, context injection, notifications,… |
| [`html-presentation`](plugins/presentation/skills/html-presentation/SKILL.md) 🔒 | skill | `presentation` | Create beautiful browser-runnable HTML presentations using reveal.js. Single self-contained HTML file with slides, transitions, speaker notes, and responsive design. |
| [`interview-management`](plugins/duty/skills/interview-management/SKILL.md) 🔒 | skill | `duty` | Manage structured engineering interviews for Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer loops. |
| [`interview-manager`](plugins/duty/agents/interview-manager.agent.md) | agent | `duty` | Engineering interviewer sidekick. Helps prepare, run, and debrief Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer interviews with question banks, STAR-style… |
| [`m365-messaging`](plugins/core-agents/skills/m365-messaging/SKILL.md) | skill | `core-agents` | Read and send Microsoft Teams messages via the Teams MCP server (chats, channels, presence, mentions, search). |
| [`memory`](plugins/core-skills/skills/memory/SKILL.md) 📜 🔒 | skill | `core-skills` | Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from… |
| [`multi-model-review`](plugins/core-skills/skills/multi-model-review/SKILL.md) | skill | `core-skills` | Runs several independent critics from different model vendors over one artifact, then synthesizes their findings into a severity-ranked decision that keeps consensus and lone… |
| [`nano-banana-cli`](plugins/presentation/skills/nano-banana-cli/SKILL.md) 📜 📚 🔒 | skill | `presentation` | Run the `nano-banana` CLI (command: `nano-banana`) for Gemini image generation/editing, transparent assets, presentation visuals, UI mockups, and reference-image edits. |
| [`narrate`](plugins/core-skills/skills/narrate/SKILL.md) 📜 📚 | skill | `core-skills` | Turn documents or text into spoken-audio (MP3) via a two-phase workflow: first rewrite the source as a TTS-friendly narration script (.md), then synthesize audio with Azure OpenAI… |
| [`oncall`](plugins/duty/agents/oncall.agent.md) | agent | `duty` | Personal on-call operations manager. Logs incidents, actions, escalations, notes, and communications with structured timestamps. |
| [`oncall-logging`](plugins/duty/skills/oncall-logging/SKILL.md) | skill | `duty` | Structured on-call data entry: workspace initialization, shift lifecycle, log entries (incidents, actions, notes, escalations, comms), entry linking, incident management, and file… |
| [`oncall-query`](plugins/duty/skills/oncall-query/SKILL.md) | skill | `duty` | Search, filter, aggregate, and report on on-call data. Timeline views, active incidents, shift handoffs, weekly summaries, and metrics. |
| [`plugin-crafting`](plugins/meta/skills/plugin-crafting/SKILL.md) 🔒 | skill | `meta` | Builds and troubleshoots Copilot CLI plugins and marketplaces. Use for plugin.json or marketplace.json, packaging agents/skills/hooks/commands/extensions/MCP/LSP servers, install… |
| [`pptx-creation`](plugins/presentation/skills/pptx-creation/SKILL.md) 📜 📚 🔒 | skill | `presentation` | Create and rebuild professional PowerPoint presentations (.pptx) from content, outlines, or approved slide plans. |
| [`prd-to-work-items`](plugins/docs/skills/prd-to-work-items/SKILL.md) | skill | `docs` | Decompose and create vertical-slice work items from a PRD with dependency tracking. Use when breaking down a PRD, feature spec, or requirements document into trackable GitHub… |
| [`presentation-critique`](plugins/presentation/skills/presentation-critique/SKILL.md) 🔒 | skill | `presentation` | Structured evaluation procedure for PowerPoint presentations against professional standards. |
| [`presentation-designer`](plugins/presentation/agents/presentation-designer.agent.md) | agent | `presentation` | Create or revise professional presentations in PPTX or HTML. Handles outline design, AI-generated visuals, slide production, speaker notes, and multi-model quality review — all… |
| [`presentation-workflow`](plugins/presentation/skills/presentation-workflow/SKILL.md) 🔒 | skill | `presentation` | End-to-end orchestration procedure for creating presentations. Covers intent capture, outline planning, image generation delegation, slide building, multi-model parallel critique,… |
| [`prompt-builder`](plugins/core-skills/skills/prompt-builder/SKILL.md) 📚 | skill | `core-skills` | Turns a plain-language situation and goal into a well-engineered prompt for an AI agent. Use when the user wants help writing, drafting, improving, or structuring a prompt, says I… |
| [`research-methodology`](plugins/core-skills/skills/research-methodology/SKILL.md) | skill | `core-skills` | Structured methodology for externally sourced, cited research: web search, source verification, synthesis, and adversarial review. |
| [`researcher`](plugins/core-agents/agents/researcher.agent.md) | agent | `core-agents` | Research agent that creates academic papers, comprehensive reports, and detailed analyses with proper citations. Answers follow-up questions about completed research. |
| [`scheduled-headless-copilot`](plugins/meta/skills/scheduled-headless-copilot/SKILL.md) 📚 | skill | `meta` | Schedules unattended Copilot CLI tasks via launchd, cron, systemd, or Windows Task Scheduler. Use to run copilot -p periodically when the terminal or session is closed. |
| [`scheduled-skill-review`](plugins/meta/skills/scheduled-skill-review/SKILL.md) 📜 📚 | skill | `meta` | Manages scheduled Copilot skill-and-agent reviews on macOS with a menu-bar app for status, control, and per-unit settings. |
| [`sessionStart: hooks/ado-sync-advisory.sh`](plugins/core-agents/hooks/ado-sync-advisory.sh) | hook | `core-agents` | On `sessionStart` runs `hooks/ado-sync-advisory.sh` (timeout 10s). |
| [`sessionStart: hooks/detect-tools.sh`](plugins/core-skills/hooks/detect-tools.sh) | hook | `core-skills` | On `sessionStart` runs `hooks/detect-tools.sh` (timeout 15s). |
| [`sessionStart: hooks/link-commands.sh`](plugins/core-agents/hooks/link-commands.sh) | hook | `core-agents` | On `sessionStart` runs `hooks/link-commands.sh` (timeout 10s). |
| [`sessionStart: hooks/lint-memory-advisory.sh`](plugins/core-skills/hooks/lint-memory-advisory.sh) | hook | `core-skills` | On `sessionStart` runs `hooks/lint-memory-advisory.sh` (timeout 15s). |
| [`skill-crafting`](plugins/meta/skills/skill-crafting/SKILL.md) 🔒 | skill | `meta` | Finds, evaluates, creates, and refines Copilot Agent Skills. Use for skill discovery or installation, SKILL.md and frontmatter design, trigger descriptions, progressive… |
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
| [`browser`](plugins/core-skills/skills/browser/SKILL.md) 📜 📚 | Drive, inspect, and automate the user's live browser — open pages, click, fill forms, take screenshots, read page content, sign in to sites, capture network traffic, manage… | — |
| [`create-image`](plugins/core-skills/skills/create-image/SKILL.md) 📜 📚 | Generate and edit images with OpenAI gpt-image-2 deployed on Azure AI Foundry, via the bundled `gpt-image` Node wrapper (no external CLI required). | generate image, create image, edit image, gpt-image, gpt-image-2, Azure image, transparent asset, mascot, icon, sticker, mockup, hero image, illustration, Foundry image |
| [`grok-search`](plugins/core-skills/skills/grok-search/SKILL.md) 📜 📚 | Ask Grok a question through the user's own logged-in browser at zero API cost, and get the answer plus cited X post links. | Grok, X, Twitter, latest tweet, what did X post, real-time tweets, X sentiment, tweet with citations, live web search, current events, xAI. Not for static general-knowledge questions, headless scraping pipelines, or when no logged-in browser is available |
| [`memory`](plugins/core-skills/skills/memory/SKILL.md) 📜 🔒 | Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from… | — |
| [`multi-model-review`](plugins/core-skills/skills/multi-model-review/SKILL.md) | Runs several independent critics from different model vendors over one artifact, then synthesizes their findings into a severity-ranked decision that keeps consensus and lone… | multi-model review, panel review, fleet review, cross-vendor critique, red-team, devil's advocate, second opinion from another model, ship-or-hold call |
| [`narrate`](plugins/core-skills/skills/narrate/SKILL.md) 📜 📚 | Turn documents or text into spoken-audio (MP3) via a two-phase workflow: first rewrite the source as a TTS-friendly narration script (.md), then synthesize audio with Azure OpenAI… | narrate, narration, audio version, listen to this, read out loud, audio summary, audio brief, voiceover, podcast, tts, text-to-speech, mp3 from doc |
| [`prompt-builder`](plugins/core-skills/skills/prompt-builder/SKILL.md) 📚 | Turns a plain-language situation and goal into a well-engineered prompt for an AI agent. Use when the user wants help writing, drafting, improving, or structuring a prompt, says I… | prompt, prompt engineering, write a prompt, craft a prompt, meta-prompt. Not for creating or modifying Copilot skill or agent definition files (use skill-crafting or agent-crafting) |
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
| [`assistant`](plugins/core-agents/agents/assistant.agent.md) | Personal assistant for notes, tasks, reminders, and Microsoft Teams messaging. Takes meeting notes, captures ideas, tracks decisions, manages todo lists with priorities and due… | note, task, todo, remind, meeting notes, decision, what's due, daily summary, action items, ideas, take a note, add task, set reminder, what did I decide, scratch, jot down, work items, ADO, sprint, my bugs, check Teams, any new messages, unread, DMs, message Sarah, ping the team, post to channel, what did X say, Teams catch up, is X online, notes to self |
| [`azure-ops`](plugins/core-agents/agents/azure-ops.agent.md) | Azure CLI operations expert. Manages Azure resources, DevOps (boards, repos, pipelines, wiki), identity, infrastructure, monitoring, and more via the az CLI. | — |
| [`researcher`](plugins/core-agents/agents/researcher.agent.md) | Research agent that creates academic papers, comprehensive reports, and detailed analyses with proper citations. Answers follow-up questions about completed research. | — |

**Skills**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`ado-session-sync`](plugins/core-agents/skills/ado-session-sync/SKILL.md) 📜 🔒 | Reviews the just-finished Copilot session and updates the related Azure DevOps work item so the ADO board stays a source of truth linking work items to the sessions that produced… | ado session sync, update work item with progress, session-to-task, sync session to ADO, stamp session id on work item, session-yield hook |
| [`assistant-capture`](plugins/core-agents/skills/assistant-capture/SKILL.md) 📜 | Structured data entry for personal assistant: note creation (meetings, decisions, ideas, scratch), task management (add, update, complete, reopen), reminder management (set,… | take note, log, capture, add task, new task, set reminder, done with, complete task, jot down |
| [`assistant-query`](plugins/core-agents/skills/assistant-query/SKILL.md) 📜 | Search, filter, and summarize personal assistant data: find notes by keyword or date, list tasks by status or priority, check due reminders, surface related context, and generate… | good morning, morning, boker tov, daily brief, today's briefing, weekly brief, weekly review, what's due, find notes, search, show tasks, daily summary, what did I decide, overdue, list, briefing |
| [`m365-messaging`](plugins/core-agents/skills/m365-messaging/SKILL.md) | Read and send Microsoft Teams messages via the Teams MCP server (chats, channels, presence, mentions, search). | check Teams, any new messages, unread, DMs, message Sarah, ping the team, post to channel, what did X say, mentions, who messaged me, Teams catch up, is X online, send Teams message, notes to self, reply on Teams, send Teams file, m365 user lookup |

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
| [`agent-architect`](plugins/meta/agents/agent-architect.agent.md) | Designs and improves Copilot agent systems. Use for agent or skill audits, creation, frontmatter and routing problems, hooks or plugin architecture, and evidence-based evolution. | — |

**Skills**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`agent-crafting`](plugins/meta/skills/agent-crafting/SKILL.md) 📚 🔒 | Creates and refines custom Copilot agents. Use for scaffolding, frontmatter or tool configuration, role and boundary design, invocation behavior, and troubleshooting loading or… | — |
| [`agent-skill-audit`](plugins/meta/skills/agent-skill-audit/SKILL.md) 📚 🔒 | Audits and improves Copilot agents, skills, and hooks. Use for inventory, frontmatter validation, routing or overlap issues, quality scoring, separation-of-concerns, security… | — |
| [`hooks-crafting`](plugins/meta/skills/hooks-crafting/SKILL.md) 📚 🔒 | Authors and troubleshoots GitHub Copilot hooks. Use for hooks.json, lifecycle events, command/HTTP/prompt configurations, tool-call decisions, context injection, notifications,… | — |
| [`plugin-crafting`](plugins/meta/skills/plugin-crafting/SKILL.md) 🔒 | Builds and troubleshoots Copilot CLI plugins and marketplaces. Use for plugin.json or marketplace.json, packaging agents/skills/hooks/commands/extensions/MCP/LSP servers, install… | — |
| [`scheduled-headless-copilot`](plugins/meta/skills/scheduled-headless-copilot/SKILL.md) 📚 | Schedules unattended Copilot CLI tasks via launchd, cron, systemd, or Windows Task Scheduler. Use to run copilot -p periodically when the terminal or session is closed. | — |
| [`scheduled-skill-review`](plugins/meta/skills/scheduled-skill-review/SKILL.md) 📜 📚 | Manages scheduled Copilot skill-and-agent reviews on macOS with a menu-bar app for status, control, and per-unit settings. | — |
| [`skill-crafting`](plugins/meta/skills/skill-crafting/SKILL.md) 🔒 | Finds, evaluates, creates, and refines Copilot Agent Skills. Use for skill discovery or installation, SKILL.md and frontmatter design, trigger descriptions, progressive… | — |
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
| [`nano-banana-cli`](plugins/presentation/skills/nano-banana-cli/SKILL.md) 📜 📚 🔒 | Run the `nano-banana` CLI (command: `nano-banana`) for Gemini image generation/editing, transparent assets, presentation visuals, UI mockups, and reference-image edits. | nano banana, generate image, edit image, transparent, hero image, mascot, sprite, mockup, Gemini, illustration |
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
| [`agent-architect`](plugins/meta/agents/agent-architect.agent.md) | `meta` | Designs and improves Copilot agent systems. Use for agent or skill audits, creation, frontmatter and routing problems, hooks or plugin architecture, and evidence-based evolution. | — |
| [`assistant`](plugins/core-agents/agents/assistant.agent.md) | `core-agents` | Personal assistant for notes, tasks, reminders, and Microsoft Teams messaging. Takes meeting notes, captures ideas, tracks decisions, manages todo lists with priorities and due… | note, task, todo, remind, meeting notes, decision, what's due, daily summary, action items, ideas, take a note, add task, set reminder, what did I decide, scratch, jot down, work items, ADO, sprint, my bugs, check Teams, any new messages, unread, DMs, message Sarah, ping the team, post to channel, what did X say, Teams catch up, is X online, notes to self |
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
| [`agent-crafting`](plugins/meta/skills/agent-crafting/SKILL.md) 📚 🔒 | `meta` | Creates and refines custom Copilot agents. Use for scaffolding, frontmatter or tool configuration, role and boundary design, invocation behavior, and troubleshooting loading or… | — |
| [`agent-skill-audit`](plugins/meta/skills/agent-skill-audit/SKILL.md) 📚 🔒 | `meta` | Audits and improves Copilot agents, skills, and hooks. Use for inventory, frontmatter validation, routing or overlap issues, quality scoring, separation-of-concerns, security… | — |
| [`assistant-capture`](plugins/core-agents/skills/assistant-capture/SKILL.md) 📜 | `core-agents` | Structured data entry for personal assistant: note creation (meetings, decisions, ideas, scratch), task management (add, update, complete, reopen), reminder management (set,… | take note, log, capture, add task, new task, set reminder, done with, complete task, jot down |
| [`assistant-query`](plugins/core-agents/skills/assistant-query/SKILL.md) 📜 | `core-agents` | Search, filter, and summarize personal assistant data: find notes by keyword or date, list tasks by status or priority, check due reminders, surface related context, and generate… | good morning, morning, boker tov, daily brief, today's briefing, weekly brief, weekly review, what's due, find notes, search, show tasks, daily summary, what did I decide, overdue, list, briefing |
| [`az`](plugins/core-skills/skills/az/SKILL.md) 📚 | `core-skills` | Generate and explain Azure CLI (`az`) commands for managing Azure and Azure DevOps. Use when the user asks for Azure CLI commands or wants to manage Azure or Azure DevOps from the… | — |
| [`browser`](plugins/core-skills/skills/browser/SKILL.md) 📜 📚 | `core-skills` | Drive, inspect, and automate the user's live browser — open pages, click, fill forms, take screenshots, read page content, sign in to sites, capture network traffic, manage… | — |
| [`create-image`](plugins/core-skills/skills/create-image/SKILL.md) 📜 📚 | `core-skills` | Generate and edit images with OpenAI gpt-image-2 deployed on Azure AI Foundry, via the bundled `gpt-image` Node wrapper (no external CLI required). | generate image, create image, edit image, gpt-image, gpt-image-2, Azure image, transparent asset, mascot, icon, sticker, mockup, hero image, illustration, Foundry image |
| [`grok-search`](plugins/core-skills/skills/grok-search/SKILL.md) 📜 📚 | `core-skills` | Ask Grok a question through the user's own logged-in browser at zero API cost, and get the answer plus cited X post links. | Grok, X, Twitter, latest tweet, what did X post, real-time tweets, X sentiment, tweet with citations, live web search, current events, xAI. Not for static general-knowledge questions, headless scraping pipelines, or when no logged-in browser is available |
| [`hooks-crafting`](plugins/meta/skills/hooks-crafting/SKILL.md) 📚 🔒 | `meta` | Authors and troubleshoots GitHub Copilot hooks. Use for hooks.json, lifecycle events, command/HTTP/prompt configurations, tool-call decisions, context injection, notifications,… | — |
| [`html-presentation`](plugins/presentation/skills/html-presentation/SKILL.md) 🔒 | `presentation` | Create beautiful browser-runnable HTML presentations using reveal.js. Single self-contained HTML file with slides, transitions, speaker notes, and responsive design. | — |
| [`interview-management`](plugins/duty/skills/interview-management/SKILL.md) 🔒 | `duty` | Manage structured engineering interviews for Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer loops. | interviewer, frontend interview, fullstack interview, hiring loop, question bank, interview history, scorecard, rubric, debrief |
| [`m365-messaging`](plugins/core-agents/skills/m365-messaging/SKILL.md) | `core-agents` | Read and send Microsoft Teams messages via the Teams MCP server (chats, channels, presence, mentions, search). | check Teams, any new messages, unread, DMs, message Sarah, ping the team, post to channel, what did X say, mentions, who messaged me, Teams catch up, is X online, send Teams message, notes to self, reply on Teams, send Teams file, m365 user lookup |
| [`memory`](plugins/core-skills/skills/memory/SKILL.md) 📜 🔒 | `core-skills` | Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from… | — |
| [`multi-model-review`](plugins/core-skills/skills/multi-model-review/SKILL.md) | `core-skills` | Runs several independent critics from different model vendors over one artifact, then synthesizes their findings into a severity-ranked decision that keeps consensus and lone… | multi-model review, panel review, fleet review, cross-vendor critique, red-team, devil's advocate, second opinion from another model, ship-or-hold call |
| [`nano-banana-cli`](plugins/presentation/skills/nano-banana-cli/SKILL.md) 📜 📚 🔒 | `presentation` | Run the `nano-banana` CLI (command: `nano-banana`) for Gemini image generation/editing, transparent assets, presentation visuals, UI mockups, and reference-image edits. | nano banana, generate image, edit image, transparent, hero image, mascot, sprite, mockup, Gemini, illustration |
| [`narrate`](plugins/core-skills/skills/narrate/SKILL.md) 📜 📚 | `core-skills` | Turn documents or text into spoken-audio (MP3) via a two-phase workflow: first rewrite the source as a TTS-friendly narration script (.md), then synthesize audio with Azure OpenAI… | narrate, narration, audio version, listen to this, read out loud, audio summary, audio brief, voiceover, podcast, tts, text-to-speech, mp3 from doc |
| [`oncall-logging`](plugins/duty/skills/oncall-logging/SKILL.md) | `duty` | Structured on-call data entry: workspace initialization, shift lifecycle, log entries (incidents, actions, notes, escalations, comms), entry linking, incident management, and file… | log, incident, shift start, shift end, on-call entry, escalation, action taken |
| [`oncall-query`](plugins/duty/skills/oncall-query/SKILL.md) | `duty` | Search, filter, aggregate, and report on on-call data. Timeline views, active incidents, shift handoffs, weekly summaries, and metrics. | query, search, find, show, list, report, handoff, summary, metrics, timeline, what happened, open incidents |
| [`plugin-crafting`](plugins/meta/skills/plugin-crafting/SKILL.md) 🔒 | `meta` | Builds and troubleshoots Copilot CLI plugins and marketplaces. Use for plugin.json or marketplace.json, packaging agents/skills/hooks/commands/extensions/MCP/LSP servers, install… | — |
| [`pptx-creation`](plugins/presentation/skills/pptx-creation/SKILL.md) 📜 📚 🔒 | `presentation` | Create and rebuild professional PowerPoint presentations (.pptx) from content, outlines, or approved slide plans. | — |
| [`prd-to-work-items`](plugins/docs/skills/prd-to-work-items/SKILL.md) | `docs` | Decompose and create vertical-slice work items from a PRD with dependency tracking. Use when breaking down a PRD, feature spec, or requirements document into trackable GitHub… | — |
| [`presentation-critique`](plugins/presentation/skills/presentation-critique/SKILL.md) 🔒 | `presentation` | Structured evaluation procedure for PowerPoint presentations against professional standards. | critique presentation, review slides, presentation feedback, deck review, slide quality |
| [`presentation-workflow`](plugins/presentation/skills/presentation-workflow/SKILL.md) 🔒 | `presentation` | End-to-end orchestration procedure for creating presentations. Covers intent capture, outline planning, image generation delegation, slide building, multi-model parallel critique,… | — |
| [`prompt-builder`](plugins/core-skills/skills/prompt-builder/SKILL.md) 📚 | `core-skills` | Turns a plain-language situation and goal into a well-engineered prompt for an AI agent. Use when the user wants help writing, drafting, improving, or structuring a prompt, says I… | prompt, prompt engineering, write a prompt, craft a prompt, meta-prompt. Not for creating or modifying Copilot skill or agent definition files (use skill-crafting or agent-crafting) |
| [`research-methodology`](plugins/core-skills/skills/research-methodology/SKILL.md) | `core-skills` | Structured methodology for externally sourced, cited research: web search, source verification, synthesis, and adversarial review. | — |
| [`scheduled-headless-copilot`](plugins/meta/skills/scheduled-headless-copilot/SKILL.md) 📚 | `meta` | Schedules unattended Copilot CLI tasks via launchd, cron, systemd, or Windows Task Scheduler. Use to run copilot -p periodically when the terminal or session is closed. | — |
| [`scheduled-skill-review`](plugins/meta/skills/scheduled-skill-review/SKILL.md) 📜 📚 | `meta` | Manages scheduled Copilot skill-and-agent reviews on macOS with a menu-bar app for status, control, and per-unit settings. | — |
| [`skill-crafting`](plugins/meta/skills/skill-crafting/SKILL.md) 🔒 | `meta` | Finds, evaluates, creates, and refines Copilot Agent Skills. Use for skill discovery or installation, SKILL.md and frontmatter design, trigger descriptions, progressive… | — |
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
