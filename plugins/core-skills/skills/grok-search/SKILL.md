---
name: grok-search
description: "Ask Grok a question through the user's own logged-in browser at zero API cost, and get the answer plus cited X post links. Use for real-time X/Twitter questions and Grok-powered web search: latest tweet, what did someone post on X, search X/Twitter, live tweet sentiment, breaking news with sources, or any current-events query that benefits from Grok's live retrieval. Keywords: Grok, X, Twitter, latest tweet, what did X post, real-time tweets, X sentiment, tweet with citations, live web search, current events, xAI. Not for static general-knowledge questions, headless scraping pipelines, or when no logged-in browser is available."
user-invocable: true
---

# Grok Search (X + Web)

Drives **Grok** through the user's own logged-in browser via `playwright-cli` and
returns the answer plus any cited X post links — **no API key, no per-token cost**.
Because it reuses the real login, it gives the same real-time X search Grok offers
in the app (latest tweets, live sentiment, breaking news with sources).

The tool is bundled in this skill at **`scripts/ask-grok-x.mjs`** (Node 18+, single
file, no deps beyond `playwright-cli`).

## When to Use

- A question about **live X/Twitter activity**: "what's the latest tweet from @NASA",
  "what did @Polymarket post on X", "X sentiment on the Fed decision today".
- **Real-time / current-events web search** that benefits from Grok's live retrieval:
  "latest AI news with sources", "what's happening with X right now".
- The user wants an answer **with citations** (Grok returns `/status/` post links).
- Zero-cost Grok access is preferred over a paid API.

## When to Skip

- **Static general-knowledge** questions a model can answer directly (no live data
  needed) — just answer; don't drive a browser.
- **No logged-in browser available** — this skill needs a signed-in X or grok.com
  session reachable via `playwright-cli`.
- **Bulk scraping or automated pipelines** — this is interactive, one-query-at-a-time.
- **General browser automation** (clicking, forms, screenshots, scraping a page) —
  this skill only asks Grok; use a general browser-automation tool instead.

## Invocation

> **Confirm the user is OK with driving their browser before the first run** — it
> reuses their real login. (Skip asking if they explicitly requested Grok/X.)

Just run the bundled script from the skill directory — no setup step needed in the
common case (it's almost always already configured):

```bash
# Default surface is X (uses the X Premium login)
node scripts/ask-grok-x.mjs "What was the most recent thing @Polymarket posted on X?"

# Pick a surface and response mode
node scripts/ask-grok-x.mjs --surface=grok.com --mode=fast "Latest AI news with sources"

# Print ONLY the answer (good for piping/parsing)
node scripts/ask-grok-x.mjs --quiet "Sentiment on X about the Fed decision today?"
```

It prints the answer plus any cited `/status/` links, and always appends a history
log (see [Output & history](#output--history)).

### Flags

| Flag | Description |
|------|-------------|
| `--surface=x` \| `grok.com` | Which Grok to drive. Default `x` (X Premium login). `grok` / `grokcom` alias to `grok.com`. |
| `--mode=auto` \| `fast` \| `expert` | Grok response mode. `auto` lets Grok choose, `fast` is quick, `expert` thinks longer. Default: leave the UI as-is. (`heavy` needs a paid SuperGrok tier and is intentionally unavailable.) |
| `--quiet`, `-q` | Print only the answer text (no preamble/citations). Still writes the log. |
| `--headless` | Run windowless via the dedicated `grokhl` session. Requires a prior `--setup-auth`. |
| `--setup-auth` | Export logged-in state from the bridge Chrome and seed the headless session, then exit. Re-run if headless gets logged out. |

## Choosing surface & mode

- **Surface:** prefer `--surface=x` for X/Twitter-specific questions (richest live
  post data). Prefer `--surface=grok.com` for general web search, or as a **fallback
  when X is bot-blocking** (see below).
- **Mode (speed vs depth):** `fast` ~15–20s, `auto` ~25s, `expert` ~40–55s. Use
  `fast` for simple lookups, `expert` for synthesis. Mode availability is per-surface.

## Bot-detection caveat — do NOT loop-retry

X intermittently serves a soft anti-automation interstitial (*"JavaScript is not
available"* / *"Something went wrong… privacy related extensions"*). The script
detects it and **bails fast (~2s)** instead of hanging — you'll see
`served a bot-detection/error page (no composer)`.

- It is **not** a timed account ban; it's session/fingerprint-based and usually
  clears in a few minutes to ~30 min.
- **Retrying in a tight loop prolongs it.** Wait, then try a single query — or
  switch to `--surface=grok.com`, which is rarely affected.
- Grok itself also has a transient per-conversation throttle (*"unable to reply /
  open a new conversation"*) — just retry once or switch surface.

## Headless (windowless) mode

`--headless` runs without a visible browser via a dedicated `grokhl` session, seeded
once from the user's real login:

```bash
# 1. With the real Chrome open and signed in to X / grok.com:
node scripts/ask-grok-x.mjs --setup-auth

# 2. Then run windowless any time:
node scripts/ask-grok-x.mjs --headless --surface=x --mode=fast "What's the latest from @NASA?"
```

Headless is ~tied on speed (~17s) but **less resilient to throttling** and gets
bot-flagged faster than attached. If headless gets logged out, re-run `--setup-auth`.

## Output & history

Every run prints the answer and any cited post links, and appends to a runtime data
directory **outside this repo** at `~/grok-x-tool/`:

- `~/grok-x-tool/history/grok-YYYY-MM-DD.log` — human-readable dated log.
- `~/grok-x-tool/history/history.jsonl` — one JSON object per run, machine-readable.

Error/interstitial pages are never dumped into the logs (detected, collapsed to a
short marker; raw capture capped at 4000 chars).

> **Every query and answer is persisted** to the history log above. Avoid sending
> secrets or private content in prompts unless the user accepts that they're logged
> locally.

## Security

- `--setup-auth` writes **live session cookies** to `~/grok-x-tool/.auth.json`
  (`chmod 600`). This file and the `history/` logs live **outside this repository**
  and **must never be committed**. Do not copy them into the skill directory.
- The bridge token at `~/.config/playwright-bridge/chrome.token` is a credential —
  never embed it in skill files or output.

## If a run fails

Only if invocation errors with a **missing tool**, **missing/invalid token**, or
**not-attached / not-logged-in** message is there setup to do — the one-time steps
live in [`references/setup.md`](references/setup.md). Don't run setup pre-emptively.
