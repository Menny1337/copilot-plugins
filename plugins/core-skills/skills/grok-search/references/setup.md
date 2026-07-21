# grok-search — one-time setup

Only needed if a run fails because a prerequisite is missing. If queries already
work, skip this — everything here is one-time.

## 1. Node.js 18+

```bash
node --version   # expect v18 or newer
```

## 2. `playwright-cli` on PATH

```bash
command -v playwright-cli || npm install -g @playwright/cli@latest
playwright-cli --version
```

Treat any `playwright-cli` already on `PATH` (Homebrew, npm, or other) as installed
— don't reinstall.

## 3. Playwright Bridge extension in Chrome

Install the **Playwright Bridge** extension from the
[Chrome Web Store](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm).
This is what lets the script attach to your real, already-logged-in Chrome.

## 4. Capture the bridge token (once)

The first attach opens a consent dialog in the browser showing a line
`PLAYWRIGHT_MCP_EXTENSION_TOKEN=<token>`. Save that token where the script looks for
it:

```bash
mkdir -p ~/.config/playwright-bridge && chmod 700 ~/.config/playwright-bridge
printf '%s\n' '<token-from-dialog>' > ~/.config/playwright-bridge/chrome.token
chmod 600 ~/.config/playwright-bridge/chrome.token
```

On later runs the script reads this token automatically. If it's absent, the script
errors with the exact `playwright-cli attach --extension=chrome` command to run.

## 5. Sign in to the surface you'll use

In the bridge Chrome, sign in to:

- **x.com** — required for `--surface=x` (the X Premium login).
- **grok.com** — required for `--surface=grok.com`.

## 6. Headless (default) auth seeding

Headless is the **default** run mode. Export login state explicitly before the first
query, or later when the windowless session gets logged out:

```bash
node scripts/ask-grok-x.mjs --setup-auth
```

This exports login state to `~/grok-x-tool/.auth.json` (chmod 600, never committed) and
loads it into the windowless `grokhl` session. The script never exports cookies or
switches to the visible browser automatically.

If headless is persistently logged out or bot-flagged, fall back to driving the visible
Chrome with `--attached`.
