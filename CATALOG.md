<!-- GENERATED FILE — do not edit by hand. Run `node scripts/catalog.mjs` to regenerate. -->

# Catalog

**5** plugins · **4** agents · **17** skills · **2** hooks

A single index of every agent, skill, and hook across all plugins in this marketplace. Source files (`SKILL.md`, `*.agent.md`, `hooks.json`) remain the only source of truth — this catalog is regenerated from their frontmatter by `scripts/catalog.mjs`.

> **Legend.** 📜 = ships scripts · 📚 = ships references · 🔒 = `user-invocable: false`

## Quick index

Flat alphabetical lookup. Click a name to jump to its source file.

| Name | Type | Plugin | Description |
| --- | --- | --- | --- |
| [`agent-architect`](plugins/meta/agents/agent-architect.agent.md) | agent | `meta` | Meta-improvement agent for Copilot agent systems. Audits, creates, refines, and evolves agents and skills across any repository. |
| [`agent-crafting`](plugins/meta/skills/agent-crafting/SKILL.md) 🔒 | skill | `meta` | Guide for creating and configuring custom Copilot agents. Use when asked to create, scaffold, or modify an agent, or when troubleshooting agent frontmatter errors. |
| [`agent-skill-audit`](plugins/meta/skills/agent-skill-audit/SKILL.md) 🔒 | skill | `meta` | Audit, refine, and evolve Copilot agents, skills, and hooks in any repository. Use when reviewing agent/skill/hook quality, fixing frontmatter or hooks.json errors, detecting… |
| [`az`](plugins/core-skills/skills/az/SKILL.md) 📚 | skill | `core-skills` | Generate and explain Azure CLI (`az`) commands for managing Azure and Azure DevOps. Use when the user asks for Azure CLI commands or wants to manage Azure or Azure DevOps from the… |
| [`browser`](plugins/core-skills/skills/browser/SKILL.md) 📜 📚 | skill | `core-skills` | Drive, inspect, and automate the user's live browser — open pages, click, fill forms, take screenshots, read page content, sign in to sites, capture network traffic, manage… |
| [`create-image`](plugins/core-skills/skills/create-image/SKILL.md) 📜 📚 | skill | `core-skills` | Generate and edit images with OpenAI gpt-image-2 deployed on Azure AI Foundry, via the bundled `gpt-image` Node wrapper (no external CLI required). |
| [`grok-search`](plugins/core-skills/skills/grok-search/SKILL.md) 📜 📚 | skill | `core-skills` | Ask Grok a question through the user's own logged-in browser at zero API cost, and get the answer plus cited X post links. |
| [`hooks-crafting`](plugins/meta/skills/hooks-crafting/SKILL.md) 📚 🔒 | skill | `meta` | Guide for authoring, configuring, and debugging GitHub Copilot hooks (the hooks.json system). |
| [`memory`](plugins/core-skills/skills/memory/SKILL.md) 📜 🔒 | skill | `core-skills` | Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from… |
| [`narrate`](plugins/core-skills/skills/narrate/SKILL.md) 📜 📚 | skill | `core-skills` | Turn documents or text into spoken-audio (MP3) via a two-phase workflow: first rewrite the source as a TTS-friendly narration script (.md), then synthesize audio with Azure OpenAI… |
| [`prd-to-work-items`](plugins/docs/skills/prd-to-work-items/SKILL.md) | skill | `docs` | Decompose and create vertical-slice work items from a PRD with dependency tracking. Use when breaking down a PRD, feature spec, or requirements document into trackable GitHub… |
| [`prompt-builder`](plugins/core-skills/skills/prompt-builder/SKILL.md) 📚 | skill | `core-skills` | Turns a plain-language situation and goal into a well-engineered prompt for an AI agent. Use when the user wants help writing, drafting, improving, or structuring a prompt, says I… |
| [`research-methodology`](plugins/core-skills/skills/research-methodology/SKILL.md) | skill | `core-skills` | Structured 8-step research methodology for conducting rigorous, cited, evidence-based research. |
| [`researcher`](plugins/core-agents/agents/researcher.agent.md) | agent | `core-agents` | Research agent that creates academic papers, comprehensive reports, and detailed analyses with proper citations. Answers follow-up questions about completed research. |
| [`sessionStart: hooks/detect-tools.sh`](plugins/core-skills/hooks/detect-tools.sh) | hook | `core-skills` | On `sessionStart` runs `hooks/detect-tools.sh` (timeout 15s). |
| [`sessionStart: hooks/lint-memory-advisory.sh`](plugins/core-skills/hooks/lint-memory-advisory.sh) | hook | `core-skills` | On `sessionStart` runs `hooks/lint-memory-advisory.sh` (timeout 15s). |
| [`skill-crafting`](plugins/meta/skills/skill-crafting/SKILL.md) 🔒 | skill | `meta` | Guide for discovering existing Copilot Agent Skills and creating new ones. Use when asked to find, browse, or recommend skills, or when asked to create or scaffold a new skill. |
| [`ui-critic`](plugins/ui/agents/ui-critic.agent.md) | agent | `ui` | Senior design critic and accessibility specialist. Evaluates React/TypeScript UI against design system constraints, hierarchy, accessibility, and micro-interactions. |
| [`ui-critique`](plugins/ui/skills/ui-critique/SKILL.md) | skill | `ui` | Review and evaluate UI components against design principles. Use when reviewing, scoring, or critiquing React/TypeScript UI code for quality, accessibility, hierarchy, and design… |
| [`ui-design-system`](plugins/ui/skills/ui-design-system/SKILL.md) | skill | `ui` | Review and apply design system constraints and tokens for beautiful UI generation. Use when creating, styling, or reviewing React/TypeScript UI components. |
| [`ui-designer`](plugins/ui/agents/ui-designer.agent.md) | agent | `ui` | Senior UI designer and React engineer. Creates beautiful, accessible, production-quality React/TypeScript/Tailwind components. |
| [`ui-generation`](plugins/ui/skills/ui-generation/SKILL.md) 📚 | skill | `ui` | Generate beautiful React/TypeScript UI components through a step-by-step workflow. Use when building new components, layouts, pages, or UI features. |
| [`write-prd`](plugins/docs/skills/write-prd/SKILL.md) | skill | `docs` | Create product requirements documents through structured discovery and interview. Use when creating a PRD, planning a feature, writing a spec, or designing a solution before… |

## By plugin

### `core-skills`

Broadly-useful, standalone skills: memory, browser, research-methodology, prompt-builder (situation → engineered AI-agent prompt), az (Azure CLI domain reference), narrate (doc/text → spoken-audio MP3), create-image (gpt-image-2 image generation/editing on Azure AI Foundry), grok-search (zero-cost real-time X/Twitter + web search via Grok in a logged-in browser).

_Source: [`plugins/core-skills/`](plugins/core-skills/)_

**Skills**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`az`](plugins/core-skills/skills/az/SKILL.md) 📚 | Generate and explain Azure CLI (`az`) commands for managing Azure and Azure DevOps. Use when the user asks for Azure CLI commands or wants to manage Azure or Azure DevOps from the… | — |
| [`browser`](plugins/core-skills/skills/browser/SKILL.md) 📜 📚 | Drive, inspect, and automate the user's live browser — open pages, click, fill forms, take screenshots, read page content, sign in to sites, capture network traffic, manage… | — |
| [`create-image`](plugins/core-skills/skills/create-image/SKILL.md) 📜 📚 | Generate and edit images with OpenAI gpt-image-2 deployed on Azure AI Foundry, via the bundled `gpt-image` Node wrapper (no external CLI required). | generate image, create image, edit image, gpt-image, gpt-image-2, Azure image, transparent asset, mascot, icon, sticker, mockup, hero image, illustration, Foundry image |
| [`grok-search`](plugins/core-skills/skills/grok-search/SKILL.md) 📜 📚 | Ask Grok a question through the user's own logged-in browser at zero API cost, and get the answer plus cited X post links. | Grok, X, Twitter, latest tweet, what did X post, real-time tweets, X sentiment, tweet with citations, live web search, current events, xAI. Not for static general-knowledge questions, headless scraping pipelines, or when no logged-in browser is available |
| [`memory`](plugins/core-skills/skills/memory/SKILL.md) 📜 🔒 | Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from… | — |
| [`narrate`](plugins/core-skills/skills/narrate/SKILL.md) 📜 📚 | Turn documents or text into spoken-audio (MP3) via a two-phase workflow: first rewrite the source as a TTS-friendly narration script (.md), then synthesize audio with Azure OpenAI… | narrate, narration, audio version, listen to this, read out loud, audio summary, audio brief, voiceover, podcast, tts, text-to-speech, mp3 from doc |
| [`prompt-builder`](plugins/core-skills/skills/prompt-builder/SKILL.md) 📚 | Turns a plain-language situation and goal into a well-engineered prompt for an AI agent. Use when the user wants help writing, drafting, improving, or structuring a prompt, says I… | prompt, prompt engineering, write a prompt, craft a prompt, meta-prompt. Not for creating or modifying Copilot skill or agent definition files (use skill-crafting or agent-crafting) |
| [`research-methodology`](plugins/core-skills/skills/research-methodology/SKILL.md) | Structured 8-step research methodology for conducting rigorous, cited, evidence-based research. | — |

**Hooks**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`sessionStart: hooks/lint-memory-advisory.sh`](plugins/core-skills/hooks/lint-memory-advisory.sh) | On `sessionStart` runs `hooks/lint-memory-advisory.sh` (timeout 15s). | — |
| [`sessionStart: hooks/detect-tools.sh`](plugins/core-skills/hooks/detect-tools.sh) | On `sessionStart` runs `hooks/detect-tools.sh` (timeout 15s). | — |

### `core-agents`

Research agent that creates citation-driven academic papers, comprehensive reports, and evidence-based analyses, and answers follow-up questions about completed research.

_Source: [`plugins/core-agents/`](plugins/core-agents/)_

**Agents**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`researcher`](plugins/core-agents/agents/researcher.agent.md) | Research agent that creates academic papers, comprehensive reports, and detailed analyses with proper citations. Answers follow-up questions about completed research. | — |

### `meta`

Meta-tooling for designing and auditing Copilot agents and skills: agent-architect agent + agent-crafting, skill-crafting, agent-skill-audit, and hooks-crafting skills.

_Source: [`plugins/meta/`](plugins/meta/)_

**Agents**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`agent-architect`](plugins/meta/agents/agent-architect.agent.md) | Meta-improvement agent for Copilot agent systems. Audits, creates, refines, and evolves agents and skills across any repository. | — |

**Skills**

| Name | Description | Triggers / Keywords |
| --- | --- | --- |
| [`agent-crafting`](plugins/meta/skills/agent-crafting/SKILL.md) 🔒 | Guide for creating and configuring custom Copilot agents. Use when asked to create, scaffold, or modify an agent, or when troubleshooting agent frontmatter errors. | — |
| [`agent-skill-audit`](plugins/meta/skills/agent-skill-audit/SKILL.md) 🔒 | Audit, refine, and evolve Copilot agents, skills, and hooks in any repository. Use when reviewing agent/skill/hook quality, fixing frontmatter or hooks.json errors, detecting… | — |
| [`hooks-crafting`](plugins/meta/skills/hooks-crafting/SKILL.md) 📚 🔒 | Guide for authoring, configuring, and debugging GitHub Copilot hooks (the hooks.json system). | hooks, hooks.json, sessionStart, preToolUse, postToolUse, permissionRequest, agentStop, lifecycle automation |
| [`skill-crafting`](plugins/meta/skills/skill-crafting/SKILL.md) 🔒 | Guide for discovering existing Copilot Agent Skills and creating new ones. Use when asked to find, browse, or recommend skills, or when asked to create or scaffold a new skill. | — |

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

## By type

### Agents

| Name | Plugin | Description | Triggers / Keywords |
| --- | --- | --- | --- |
| [`agent-architect`](plugins/meta/agents/agent-architect.agent.md) | `meta` | Meta-improvement agent for Copilot agent systems. Audits, creates, refines, and evolves agents and skills across any repository. | — |
| [`researcher`](plugins/core-agents/agents/researcher.agent.md) | `core-agents` | Research agent that creates academic papers, comprehensive reports, and detailed analyses with proper citations. Answers follow-up questions about completed research. | — |
| [`ui-critic`](plugins/ui/agents/ui-critic.agent.md) | `ui` | Senior design critic and accessibility specialist. Evaluates React/TypeScript UI against design system constraints, hierarchy, accessibility, and micro-interactions. | — |
| [`ui-designer`](plugins/ui/agents/ui-designer.agent.md) | `ui` | Senior UI designer and React engineer. Creates beautiful, accessible, production-quality React/TypeScript/Tailwind components. | — |

### Skills

| Name | Plugin | Description | Triggers / Keywords |
| --- | --- | --- | --- |
| [`agent-crafting`](plugins/meta/skills/agent-crafting/SKILL.md) 🔒 | `meta` | Guide for creating and configuring custom Copilot agents. Use when asked to create, scaffold, or modify an agent, or when troubleshooting agent frontmatter errors. | — |
| [`agent-skill-audit`](plugins/meta/skills/agent-skill-audit/SKILL.md) 🔒 | `meta` | Audit, refine, and evolve Copilot agents, skills, and hooks in any repository. Use when reviewing agent/skill/hook quality, fixing frontmatter or hooks.json errors, detecting… | — |
| [`az`](plugins/core-skills/skills/az/SKILL.md) 📚 | `core-skills` | Generate and explain Azure CLI (`az`) commands for managing Azure and Azure DevOps. Use when the user asks for Azure CLI commands or wants to manage Azure or Azure DevOps from the… | — |
| [`browser`](plugins/core-skills/skills/browser/SKILL.md) 📜 📚 | `core-skills` | Drive, inspect, and automate the user's live browser — open pages, click, fill forms, take screenshots, read page content, sign in to sites, capture network traffic, manage… | — |
| [`create-image`](plugins/core-skills/skills/create-image/SKILL.md) 📜 📚 | `core-skills` | Generate and edit images with OpenAI gpt-image-2 deployed on Azure AI Foundry, via the bundled `gpt-image` Node wrapper (no external CLI required). | generate image, create image, edit image, gpt-image, gpt-image-2, Azure image, transparent asset, mascot, icon, sticker, mockup, hero image, illustration, Foundry image |
| [`grok-search`](plugins/core-skills/skills/grok-search/SKILL.md) 📜 📚 | `core-skills` | Ask Grok a question through the user's own logged-in browser at zero API cost, and get the answer plus cited X post links. | Grok, X, Twitter, latest tweet, what did X post, real-time tweets, X sentiment, tweet with citations, live web search, current events, xAI. Not for static general-knowledge questions, headless scraping pipelines, or when no logged-in browser is available |
| [`hooks-crafting`](plugins/meta/skills/hooks-crafting/SKILL.md) 📚 🔒 | `meta` | Guide for authoring, configuring, and debugging GitHub Copilot hooks (the hooks.json system). | hooks, hooks.json, sessionStart, preToolUse, postToolUse, permissionRequest, agentStop, lifecycle automation |
| [`memory`](plugins/core-skills/skills/memory/SKILL.md) 📜 🔒 | `core-skills` | Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from… | — |
| [`narrate`](plugins/core-skills/skills/narrate/SKILL.md) 📜 📚 | `core-skills` | Turn documents or text into spoken-audio (MP3) via a two-phase workflow: first rewrite the source as a TTS-friendly narration script (.md), then synthesize audio with Azure OpenAI… | narrate, narration, audio version, listen to this, read out loud, audio summary, audio brief, voiceover, podcast, tts, text-to-speech, mp3 from doc |
| [`prd-to-work-items`](plugins/docs/skills/prd-to-work-items/SKILL.md) | `docs` | Decompose and create vertical-slice work items from a PRD with dependency tracking. Use when breaking down a PRD, feature spec, or requirements document into trackable GitHub… | — |
| [`prompt-builder`](plugins/core-skills/skills/prompt-builder/SKILL.md) 📚 | `core-skills` | Turns a plain-language situation and goal into a well-engineered prompt for an AI agent. Use when the user wants help writing, drafting, improving, or structuring a prompt, says I… | prompt, prompt engineering, write a prompt, craft a prompt, meta-prompt. Not for creating or modifying Copilot skill or agent definition files (use skill-crafting or agent-crafting) |
| [`research-methodology`](plugins/core-skills/skills/research-methodology/SKILL.md) | `core-skills` | Structured 8-step research methodology for conducting rigorous, cited, evidence-based research. | — |
| [`skill-crafting`](plugins/meta/skills/skill-crafting/SKILL.md) 🔒 | `meta` | Guide for discovering existing Copilot Agent Skills and creating new ones. Use when asked to find, browse, or recommend skills, or when asked to create or scaffold a new skill. | — |
| [`ui-critique`](plugins/ui/skills/ui-critique/SKILL.md) | `ui` | Review and evaluate UI components against design principles. Use when reviewing, scoring, or critiquing React/TypeScript UI code for quality, accessibility, hierarchy, and design… | — |
| [`ui-design-system`](plugins/ui/skills/ui-design-system/SKILL.md) | `ui` | Review and apply design system constraints and tokens for beautiful UI generation. Use when creating, styling, or reviewing React/TypeScript UI components. | — |
| [`ui-generation`](plugins/ui/skills/ui-generation/SKILL.md) 📚 | `ui` | Generate beautiful React/TypeScript UI components through a step-by-step workflow. Use when building new components, layouts, pages, or UI features. | — |
| [`write-prd`](plugins/docs/skills/write-prd/SKILL.md) | `docs` | Create product requirements documents through structured discovery and interview. Use when creating a PRD, planning a feature, writing a spec, or designing a solution before… | — |

### Hooks

| Name | Plugin | Description | Triggers / Keywords |
| --- | --- | --- | --- |
| [`sessionStart: hooks/detect-tools.sh`](plugins/core-skills/hooks/detect-tools.sh) | `core-skills` | On `sessionStart` runs `hooks/detect-tools.sh` (timeout 15s). | — |
| [`sessionStart: hooks/lint-memory-advisory.sh`](plugins/core-skills/hooks/lint-memory-advisory.sh) | `core-skills` | On `sessionStart` runs `hooks/lint-memory-advisory.sh` (timeout 15s). | — |
