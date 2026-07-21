# Agent Patterns for Browser Automation

> **Reference companion** to the `browser` skill (`SKILL.md`).
> Contains ecosystem context, the MCP-vs-CLI decision table, and durable design patterns for AI-driven browser automation.
> Sources are cited inline; the May-2026 deep research lives at `~/.copilot/research/browser-use-2026/research.md` and `v2-addendum-findings.md`.

---

## AI Browser Automation Ecosystem (May 2026 snapshot)

The field has converged in a notable way: **almost everything wraps Playwright**, and Microsoft itself now publicly recommends **CLI + SKILLS over MCP for coding-agent contexts** (vendor-only claim — see caveat below).

| Project | Repo | Latest | Licence | Stars | Architecture | Notes |
|---|---|---|---|---|---|---|
| **`@playwright/cli`** | microsoft/playwright-cli | v0.1.13 (May 2026) | Apache-2.0 | ~10K | Playwright + CLI + ships SKILL.md | **Our primary.** Same Playwright core as playwright-mcp, exposed as a CLI with a 388-LOC SKILL.md + 10 reference files. Microsoft's official CLI+SKILLS pattern for coding agents. |
| **`@playwright/mcp`** | microsoft/playwright-mcp | v0.0.75 (May 2026) | Apache-2.0 | ~22K | Playwright + MCP server, accessibility-tree first | **Our secondary** (already builtin in Copilot CLI — verify with `/mcp`). Default browser MCP server in 2026; ships in Clawpilot, VS Code Insiders MCP suggestions. Reserved for long iterative single-page sessions. |
| **Browser Use (Python)** | browser-use/browser-use | 0.10.x (active) | MIT | ~93K | Python; Playwright underneath; agent loop with multi-LLM | Autonomous agent product; cloud + open-source. Most-starred browser agent of 2026. |
| **Browser Use CLI 2.0** | browser-use/browser-use (subdir) | 2026 launch | MIT | included | Daemon CDP, persistent profile, element-index actions, ships SKILL.md | **Intentionally not used here** — Chrome-only by stated design (no Edge channel), security #4763 (`data:`/`blob:` bypass `allowed_domains`), Auth0 bug #4796 hits M365 SSO flows. Wrong fit for Microsoft-tenant Edge user. |
| **Stagehand** | browserbase/stagehand | active (2026) | MIT | ~16K | Playwright-based with `act()`/`agent()`/`extract()` Zod-typed API | Framework for production automations; cloud (Browserbase) or self-host. Not the right shape for an interactive Copilot CLI skill. |
| **`mcp-server-browserbase`** | browserbase/mcp-server-browserbase | active (2026) | MIT | smaller | 6-tool MCP server; hosted SHTTP at `mcp.browserbase.com` | The MCP face of Stagehand, cloud-first. |
| **Skyvern** | Skyvern-AI/skyvern | v1.0.32 (May 2026) | AGPL-3.0 | ~20K | Vision + LLM, native CAPTCHA/2FA handling | Enterprise / no-code vertical; AGPL is a publishing risk. |
| **Magnitude** | magnitude-run | active (2026) | open-source | smaller | Vision-first agent, integrates with Anthropic & Steel | Niche but interesting for canvas-heavy or non-DOM apps. |
| **Steel-browser** | steel-dev/steel-browser | active (2026) | Apache-2.0 | growing | Browser-as-a-service infra (cloud or self-host Docker) | Backend for other agents (Magnitude, etc.) — not an agent itself. |
| **HyperAgent** | hyperbrowser-ai | active (2026) | open | smaller | Adds `page.ai()` / `page.extract()` to Playwright | A small library, not a paradigm shift. |
| **Anthropic Computer Use** | platform.claude.com docs | Sonnet 4 / 4.5 / 4.6 (2026) | API | n/a | Vision-driven; screenshot → mouse/keyboard | Reserve for non-DOM content. ~10× cost, ~10–30× latency vs DOM/A11y for typical web tasks. |
| **OpenAI CUA / Operator** | OpenAI Agents SDK (Apr 2026) | ongoing | API | n/a | Vision agent in cloud sandbox | Mature consumer/enterprise product; not a personal-skill embed. |

> **Caveat on Microsoft's "CLI+SKILLS over MCP for coding agents" claim.** The claim's source is Microsoft itself (the `playwright-mcp` and `playwright-cli` READMEs, both authored by the same team). Independent practitioner write-ups echo it but trace back to those READMEs. Treat as **vendor-only** — directionally true but not independently corroborated.

---

## MCP vs CLI — when to use which

For a Copilot CLI plugin (which is an agent context, not an IDE-style assistant), the calculus from `~/.copilot/research/browser-use-2026/research.md §5.3` is:

| Tool path | Cost model | Wins when |
|---|---|---|
| **CLI (`playwright-cli`)** | SKILL.md ~500–2K tokens read once; per-action stdout ~100–500 tokens | Routine actions: nav, snapshot, click, fill, screenshot, multi-tool sessions, anything where the per-prompt MCP token tax compounds. **The 90% case.** |
| **MCP (`@playwright/mcp` builtin)** | Tool schema ~7K–15K tokens permanent in system prompt; per-snapshot 1K–5K | Long iterative single-page exploration where server-held browser state across many turns pays back the token tax. **The 10% case.** |
| **Raw CDP (`scripts/cdp.mjs`)** | Lowest per-action cost; minimal stdout | Raw CDP method passthrough (`Network.*`, `Performance.*`, `Target.*`); cross-origin iframe text input; attaching to user's already-running browser without an extension install. **The 5% escape hatch.** |

The compounding gap **over a 20-action session** is on the order of **30K–80K tokens in favour of the CLI** (synthesised from Karate Labs 2026, pagebolt 2026, and the playwright-mcp tool surface).

### Decision flow

1. **Is this a one-shot or short-burst interaction?** → CLI
2. **Will the agent iterate over the same page across 10+ turns and benefit from server-held state?** → MCP secondary
3. **Do I need a raw CDP method the high-level CLI can't express?** → escape hatch (`cdp.mjs evalraw`)
4. **Do I need to drive the user's daily Edge without launching anything new?** → escape hatch (`cdp.mjs list/snap/...`) or `playwright-cli attach --extension=msedge` if the extension is installed

### Canonical `.mcp.json` shape (advanced — for custom MCP configurations only)

The `playwright` MCP server is **already builtin** in Copilot CLI, so you typically do not need to write any `.mcp.json`. If you want a custom configuration (e.g., `--isolated`, a specific `--user-data-dir`, `--storage-state file.json`, `--extension`), the canonical Copilot CLI plugin shape — verified via Microsoft's own `workiq` plugin — is:

```jsonc
// .mcp.json at the plugin root, OR ~/.copilot/mcp-config.json for user-global
{
  "mcpServers": {
    "playwright-custom": {
      "command": "npx",
      "args": [
        "-y", "@playwright/mcp@latest",
        "--user-data-dir=/path/to/profile",
        "--isolated"
      ],
      "tools": ["*"]
    }
  }
}
```

For the default case, do nothing — the builtin already covers it. Inspect what's loaded with `/mcp` inside Copilot CLI.

---

## DOM/A11y vs Vision — field consensus (May 2026)

> **DOM/accessibility-tree first, vision as fallback.** Pure vision is reserved for non-DOM content. Hybrid (DOM primary + vision when ambiguous) is the production default.

Triangulated from Karate Labs 2026, rover.rtrvr.ai 2026, Notte 2026, paperclipped.de 2026:

- **Token-cost gap:** 5×–170× in favour of DOM
- **Latency gap:** 3×–10× in favour of DOM
- **Accuracy:** small gap on text-heavy UIs; reverses on canvas-heavy ones

`playwright-cli` defaults to DOM/A11y and exposes vision via `--caps vision` (in the MCP cousin). Use vision only when the DOM doesn't carry the meaning (canvas, 3D, image-only content, OCR-of-rendered-content tasks).

### Where agents fail most often (in order of frequency)

1. **Auth challenges** — Entra MFA prompts, captcha, "this looks like a new device" interstitials. *Solution:* persistent profile + one-time human login (the `playwright-cli --persistent` pattern).
2. **Cross-origin iframes** — fundamental browser limit, no library escapes it cleanly.
3. **Shadow DOM** with web-component-heavy SPAs — Playwright's locator engine handles open shadow roots well; closed ones are unreachable for everyone.
4. **Captchas** — Skyvern claims native handling; everything else punts to a human or a paid solver.
5. **Rate-limit / bot-detection** triggered by headless or `--persistent` flags. The persistent-profile pattern reduces but does not eliminate this.

---

## Durable design patterns

These are pre-existing notes that survive the May-2026 ecosystem refresh — they're about *how to design* an agent loop, not which library to use.

### Token & cost ranges per task (order-of-magnitude)

| Approach | Cost per task | Tokens per action | Speed |
|----------|---------------|-------------------|-------|
| Raw Playwright (no LLM) | $0 | 0 | Fastest (~ms) |
| `playwright-cli` from agent | ~$0.005–$0.05 | ~100–500 | Fast (~1 s/action) |
| `@playwright/mcp` from agent | ~$0.01–$0.10 | ~1K–5K | Medium (~100–300 ms + snapshot) |
| Browser Use (full agent) | ~$0.05–$0.50 | ~5K–50K | Slow (~30–120 s) |
| Anthropic CUA | ~$0.50–$5.00 | ~50K–500K | Slowest |

### Structured data extraction with schemas

Use Zod (or equivalent typed schema) for structured output instead of free-form scraping:

```typescript
// Stagehand pattern — the same shape works elsewhere
const { author, title } = await stagehand.extract(
  "extract the author and title of the PR",
  z.object({
    author: z.string().describe("The username of the PR author"),
    title: z.string().describe("The title of the PR"),
  }),
);
```

For pages exceeding ~20K tokens, run a **separate LLM call against the page markdown** rather than dumping everything into agent context. This is the `extract()` pattern Browser Use, Stagehand, and HyperAgent all converged on independently.

### Two-tier model selection

Cheap/fast model for routine navigation; large/expensive model only for planning and complex decisions.

> *"Output tokens cost ~215× more time than input tokens."* — Browser Use benchmarks

Navigation produces many output tokens (selectors, coordinates, actions) but needs minimal reasoning. Planning produces few output tokens (a strategy) but needs deep reasoning. Match model tier to task tier.

### Ephemeral context management

Browser state is large and transient. The model only needs the **recent** state — old browser snapshots are noise.

- **CLI variant:** Save snapshots to files (`playwright-cli snapshot --filename=x.yaml`) instead of inlining their content. Reference the file path; read it only when needed.
- **MCP variant:** Mark browser-state tool calls as ephemeral with a sliding window (e.g., keep last 3). Newer calls automatically remove older outputs from the conversation history.

This is the single most effective mitigation for the "token death spiral" where accumulated snapshots consume the context window.

### The "bitter lesson" for agent design

> *"An agent is just a for-loop of messages. Agent frameworks fail not because models are weak, but because their action spaces are incomplete. Give the LLM as much freedom as possible, then vibe-restrict based on evals."* — Browser Use blog

Translations:

1. **Maximise the action space** — give the agent all `playwright-cli` verbs rather than a curated subset. Incomplete action spaces force LLM workarounds that are more expensive and less reliable than the direct action.
2. **Minimise the framework** — a loop + tool calls + explicit exit condition. Heavy frameworks add abstraction the LLM must reason through.
3. **Manage context aggressively** — ephemeral messages, windowed history, selective snapshots. Context is the scarcest resource; treat every token as cost.
4. **Cache successful patterns** — replay deterministically when possible; fall back to LLM only when the page structure changes.

---

## Sources

### Primary (verified May 2026)

- Microsoft. (2026). *playwright-cli* — https://github.com/microsoft/playwright-cli
- Microsoft. (2026). *playwright-mcp* — https://github.com/microsoft/playwright-mcp
- Microsoft. (2026). *workiq plugin* — canonical `.mcp.json` shape reference
- Browser Use. (2026). *browser-use Releases — Browser Use CLI 2.0* — https://github.com/browser-use/browser-use/releases
- Browser Use. (2026). *browser-use issue tracker* — #3015 (msedge channel), #4763 (data/blob bypass), #4796 (Auth0 input_text bug)
- Browserbase. (2026). *Stagehand* — https://github.com/browserbase/stagehand
- Microsoft Learn. (2026). *Conditional Access — supported browsers* — Edge tier-1 status

### In-house research (cited inline)

- Researcher. (2026-05-11). *Should I replace my custom CDP/Playwright skill with `@playwright/mcp` — or do something else?* — `~/.copilot/research/browser-use-2026/research.md`
- Researcher. (2026-05-12). *V2 Addendum: First-class evaluation of `microsoft/playwright-cli` and `browser-use` CLI 2.0* — `~/.copilot/research/browser-use-2026/v2-addendum-findings.md`
- Verification. (2026-05-12). *Browser Skill 2026 — Phase 1 Verification* — `~/.copilot/agent-architect/browser-skill-2026-verification.md`

### Practitioner / trend pieces (medium confidence on specific numbers)

- Karate Labs. (2026). *DOM vs Screenshot AI Testing: Why Tokens Matter*
- Notte. (2026). *How does a browser agent perceive a page (vision vs DOM)?*
- Pagebolt. (2026). *Why screenshot MCPs cost 170x less than Playwright MCP*
- Rover.rtrvr.ai. (2026). *DOM-Native vs. Screenshot Agents*
- paperclipped.de. (2026). *Browser AI Agents: Web Automation with Playwright & Vision Models*
