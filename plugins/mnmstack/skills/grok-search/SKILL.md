---
name: grok-search
description: "Searches live X/Twitter posts and sentiment through Grok. For other web research, use only when the user or workflow selects Grok; general news or citation requests alone do not qualify."
argument-hint: "<question to ask Grok>"
user-invocable: true
---

# Grok Search (X + Web)

Queries **Grok** for live X activity or web questions when the user or workflow
selects Grok. It uses the user's logged-in session via `playwright-cli` and
returns the answer plus any cited X post links. General news or citation requests
alone do not select this workflow.

By default it runs **headless (windowless)** after an explicit one-time
`--setup-auth` export. Later runs work in a dedicated background session **without
opening or touching your visible browser**. Use `--attached` only when you explicitly
want to drive the visible Chrome.

The tool is bundled in this skill at **`scripts/ask-grok-x.mjs`** (Node 18+, single
file, no deps beyond `playwright-cli`).

## When to Use

- A question about **live X/Twitter activity**: "what's the latest tweet from @NASA",
  "what did @Polymarket post on X", "X sentiment on the Fed decision today".
- Web research when the user or invoking workflow selects **Grok**:
  "ask Grok for the latest AI news with sources".
- The user requests Grok's answer or cited X post links.

## When to Skip

- **Static general-knowledge** questions a model can answer directly (no live data
  needed) — just answer; don't drive a browser.
- **No logged-in browser available** — this skill needs a signed-in X or grok.com
  session reachable via `playwright-cli`.
- **Bulk scraping or automated pipelines** — this is interactive, one-query-at-a-time.
- **General browser automation** (clicking, forms, screenshots, scraping a page) —
  this skill only asks Grok; use a general browser-automation tool instead.
- A request for **current information or citations alone** does not select Grok.
  Use the available search/fetch tools unless X activity or a Grok-specific
  request makes this workflow relevant.

## Invocation

> The default headless path runs **windowless and never touches the visible browser**,
> but it requires explicit one-time consent via `--setup-auth`, which exports live
> session cookies. `--attached` drives the visible Chrome and must also be chosen
> explicitly.

Before the first headless query, export auth explicitly with the logged-in Chrome open:

```bash
PLAYWRIGHT_MCP_EXTENSION_TOKEN='<token>' node scripts/ask-grok-x.mjs --setup-auth

# Default: headless (windowless), surface X (uses the X Premium login)
node scripts/ask-grok-x.mjs "What was the most recent thing @Polymarket posted on X?"

# Pick a surface and response mode
node scripts/ask-grok-x.mjs --surface=grok.com --mode=fast "Latest AI news with sources"

# Print ONLY the answer (good for piping/parsing)
node scripts/ask-grok-x.mjs --quiet "Sentiment on X about the Fed decision today?"

# Drive the VISIBLE Chrome instead of headless (fallback if headless is logged out)
node scripts/ask-grok-x.mjs --attached --surface=grok.com "Latest AI news with sources"
```

It prints the answer plus any cited `/status/` links, and always appends a history
log (see [Output & history](#output--history)).

### Flags

| Flag | Description |
|------|-------------|
| `--surface=x` \| `grok.com` | Which Grok to drive. Default `x` (X Premium login). `grok` / `grokcom` alias to `grok.com`. |
| `--mode=auto` \| `fast` \| `expert` | Grok response mode. `auto` lets Grok choose, `fast` is quick, `expert` thinks longer. Default: leave the UI as-is. (`heavy` needs a paid SuperGrok tier and is intentionally unavailable.) |
| `--quiet`, `-q` | Print only the answer text (no preamble/citations). Still writes the log. |
| `--attached` | Drive your **visible** Chrome via the bridge instead of the default windowless session. Use if headless is logged out or bot-flagged. (`--headed` / `--no-headless` are aliases.) |
| `--headless` | Explicit windowless session via the dedicated `grokhl` session — this is the **default**, so the flag is optional (kept for back-compat). |
| `--setup-auth` | Explicitly export logged-in state from the bridge Chrome and seed the headless session, then exit. Run once before the first headless query and again only to refresh a logged-out session. |

`--setup-auth` and attached runs require a Playwright Bridge token. Pass it in
`PLAYWRIGHT_MCP_EXTENSION_TOKEN`; the saved
`~/.config/playwright-bridge/chrome.token` file remains a fallback. The script fails
immediately with setup instructions if neither source contains a token.

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

- On **headless** (the default), a bot-detection page exits with guidance. The script
  never switches to the visible Chrome automatically; rerun with `--attached` only if
  you explicitly accept visible-browser automation.
- It is **not** a timed account ban; it's session/fingerprint-based and usually
  clears in a few minutes to ~30 min.
- **Retrying in a tight loop prolongs it.** Wait, then try a single query — or
  switch to `--surface=grok.com`, which is rarely affected.
- Grok itself also has a transient per-conversation throttle (*"unable to reply /
  open a new conversation"*) — just retry once or switch surface.

## Headless (windowless) mode — the default

Headless is the **primary way this skill runs**: a dedicated windowless `grokhl` session
that never opens or steals focus from the user's visible browser. Seed it explicitly
once from the signed-in Chrome via the bridge:

```bash
PLAYWRIGHT_MCP_EXTENSION_TOKEN='<token>' node scripts/ask-grok-x.mjs --setup-auth
node scripts/ask-grok-x.mjs --surface=x --mode=fast "What's the latest from @NASA?"
```

If cookies later expire, the script reports the login wall without reading from the
visible browser. Refresh explicitly with `--setup-auth` and your logged-in Chrome open:

```bash
PLAYWRIGHT_MCP_EXTENSION_TOKEN='<token>' node scripts/ask-grok-x.mjs --setup-auth
```

**When to use `--attached`** (driving the visible Chrome): choose it explicitly if
headless is persistently blocked or you prefer the live bridge session:

```bash
node scripts/ask-grok-x.mjs --attached --surface=grok.com --mode=fast "Latest AI news"
```

Headless and attached are ~tied on speed (~17s for `fast`). Headless keeps the user's
browser untouched; attached is the more throttle-resilient fallback.

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
  (`chmod 600`). Runtime directories are forced to `0700`, and history files to
  `0600`. These files live **outside this repository** and **must never be
  committed**. Do not copy them into the skill directory.
- The bridge token in `PLAYWRIGHT_MCP_EXTENSION_TOKEN` or
  `~/.config/playwright-bridge/chrome.token` is a credential — never embed it in skill
  files or output.

## If a run fails

Run the one-time auth export before the first headless query. Other setup is needed
only for a **missing tool**, **missing/invalid token**, or **not-attached /
not-logged-in** error; see [`references/setup.md`](references/setup.md).
