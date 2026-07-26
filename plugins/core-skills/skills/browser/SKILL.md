---
name: browser
description: "Drive, inspect, and automate the user's live browser — open pages, click, fill forms, take screenshots, read page content, sign in to sites, capture network traffic, manage cookies. Includes a one-shot Outlook on the web driver for drafting, replying to, and reading mail. Use when the user asks to open a URL, screenshot a page, automate a flow, log into a site, draft or reply to an email in Outlook/OWA, scrape something interactively, or inspect what's on screen. Not for mockups, UI components, headless scraping pipelines, or authoring Playwright tests."
argument-hint: "<URL, or what to do in the browser>"
---

# Browser Automation — Live Session

## ⚡ Decision rule — read this first

> **Default tool: `playwright-cli`.** Use it for every routine browser action.
> **Escape hatch: `scripts/cdp.mjs`.** Use it only when one of these is true:
>
> 1. You need a raw CDP method `playwright-cli` doesn't expose (`Network.*`, `Performance.*`, `Target.*`, etc.) → `cdp.mjs evalraw`
> 2. You need to drive the user's already-running Chrome/Edge **without closing it** AND without installing the Playwright Bridge extension → `cdp.mjs list/snap/...`
> 3. You need to type into a cross-origin iframe via `Input.insertText` → `cdp.mjs type`
>
> **In all other cases — including "drive my real daily browser with all my logins" — use `playwright-cli`** (see Mode A in Quick Start). If `playwright-cli` is not installed, **auto-install it** (`npm install -g @playwright/cli@latest`, no need to ask) and retry — see Prerequisites. A *missing* `playwright-cli` is NEVER a reason to fall back to `cdp.mjs`; the escape hatch is for the three cases above, not for a tool that simply hasn't been installed yet.

## 📖 Site playbooks — check before improvising

Some sites have already been mapped, with the traps documented and a bundled driver written.
If the task touches one of them, **read the playbook first**. Improvising against a mapped
site is the main cause of retry loops.

| Site | Playbook | One-shot driver |
|---|---|---|
| **Outlook on the web** (`outlook.office.com`, `outlook.cloud.microsoft`) — drafting, replying, reading mail | [references/outlook-web.md](references/outlook-web.md) | `scripts/owa-compose.mjs` |

> 🚨 **Outlook, in one line:** don't hand-drive it. Run
> `node scripts/owa-compose.mjs draft --spec mail.json` — it opens the compose, fills
> To/Cc/Bcc, sets the subject, injects rich HTML, and verifies the result in a single
> command. **Never press `Escape` in an OWA compose** — it maps to *Discard* and silently
> destroys the draft. Drafting is the default; sending requires an explicit `--confirm`.

## 🎯 Pick your mode — keyed on user pain

The most common situations drive mode choice. Use this table before reading Quick Start —
the top rows are the highest-priority triggers:

| User goal / pain | Recommended mode |
|---|---|
| **"It's already open and I'm signed in — use *that*"** (the page/dashboard is already loaded and authenticated in the real browser) | **Attach — do not launch a fresh browser.** A fresh launch starts a clean, *unauthenticated* browser and hits the login wall. If the Bridge extension is installed → **Mode A (`attach --extension`)**. If not, attach with **zero install via the escape hatch `scripts/cdp.mjs list/snap/...`**, or do the one-time Mode A install. Relaunch (`open --profile`/`--persistent`) only if attaching is impossible **and** the user agrees to close their windows. |
| **"Don't make me close my browser"** | **Mode A — `attach --extension`** (one-time extension install **+ token capture**, then zero interaction forever — see Mode A setup) |
| **"Don't show the 'unsupported flag — security will suffer' infobar"** | **Mode A — `attach --extension`** (the only path that doesn't relaunch Chromium with `--disable-blink-features=AutomationControlled`; see [known-issues](references/known-issues.md#the-automationcontrolled-infobar--cosmetic-unfixable-in-launch-modes)) |
| **Driving a work-managed Edge or Chrome profile (M365/Entra-bound)** | **Mode A only.** Mode C corrupts the work-account binding (`managed_user_id` cleared) and triggers Conditional Access error `AADSTS530003`. See [known-issues](references/known-issues.md#edge-work-account-sign-out--conditional-access-aadsts530003-after-mode-c-launch). Verified 2026-05-28. |
| Throwaway sign-in-once automation, isolated from daily browsing | Mode B — `-s=<name> open --persistent` |
| Drive daily profile via a freshly-launched browser (logins/extensions intact) | Mode C — `open --profile=<daily-dir>` ⚠️ **requires closing the daily browser AND killing any playwright orphans first** — see [orphan diagnosis](#first-aid--browser-wont-launch-orphan-diagnosis) |
| Attach to a browser that's already running **with `--remote-debugging-port=N` enabled** (CI harness, Clawpilot) | Mode D — `attach --cdp=<channel\|url>` |
| Attach to the user's already-running browser **without any install** (one-off, accepts per-tab modal) | Escape hatch — `scripts/cdp.mjs list/snap/...` |

> **Already authenticated? Attach, don't relaunch.** When the user says the page or dashboard is already open and they're signed in, attach to that live tab so their session is preserved. A fresh `open`/`--profile` launch starts an unauthenticated browser and forces them to close windows or sign in again. Reach for a fresh launch only when nothing relevant is open yet, or the user explicitly opts into it.

## ⚙️ Tool inventory

| Tool | Role | Source | When |
|------|------|--------|------|
| **`playwright-cli`** | **PRIMARY** — use for ~95% of browser work | External: `npm install -g @playwright/cli@latest` (Microsoft, Apache-2.0) | Default. Auto-waiting clicks, multi-tab, daily-profile (`--profile=<dir>`) and isolated sessions (`--persistent`), screenshots, snapshots, network inspection, cookie/storage management, tracing, video. |
| **`scripts/cdp.mjs`** | **ESCAPE HATCH** — use only when the decision rule above triggers | Bundled with this skill (Node 22+, zero deps) | Raw CDP passthrough, attaching to user's daily browser without extension install, cross-origin iframe text input. |

> **Always ask the user for explicit approval before connecting to their browser.** Do not invoke silently.

## When to use this skill

- Inspect, debug, or interact with a web page (default: `playwright-cli open <url>`)
- Take a screenshot of a page — viewport, full page, or a single element (`playwright-cli screenshot`)
- Read the accessibility tree (`playwright-cli snapshot` — preferred over HTML for understanding structure)
- Click elements, fill forms, type text, press keys, hover, scroll, navigate (`playwright-cli click/fill/type/press/hover/mousewheel/goto`)
- Evaluate JavaScript in a live page context (`playwright-cli eval`)
- Capture network requests, headers, bodies, or mock responses (`playwright-cli requests/request/route`)
- Manage cookies, localStorage, sessionStorage (`playwright-cli cookie-*/localstorage-*/sessionstorage-*`)
- Drive multi-tab workflows (`playwright-cli tab-*`)
- Drive the user's **real daily browser** with all their logins — **attach to it** (`playwright-cli attach --extension`, Mode A; or the `scripts/cdp.mjs` escape hatch with no install). Relaunch via `open --profile=<daily-dir>` (Mode C) only when attaching is impossible and the user agrees to close their windows.
- Run a sign-in-once **isolated automation session**, separate from daily browsing (`playwright-cli -s=<name> open ... --persistent`)
- Send raw CDP commands the high-level CLI doesn't expose (escape hatch — `scripts/cdp.mjs evalraw`)

## When to skip

- **Headless browser scripting / web scraping outside an interactive session** → use the Playwright library directly
- **End-to-end test authoring** → use `@playwright/test`
- **Generating static HTML or building UI components** → use `ui-generation` / `html-presentation`
- **The user hasn't approved browser access**

> **`browser-use` CLI 2.0 is intentionally not used here** — Chrome-only by design (no first-class Edge channel), open security bypass for `data:`/`blob:` URLs (#4763), open Auth0/SSO bug affecting third-party login flows including M365 (#4796). See `references/agent-patterns.md` for the rejection rationale.

## Prerequisites

**`playwright-cli` is REQUIRED. Detect it, and auto-install it if absent — never fall back to `cdp.mjs` because the primary tool is missing.** Run this before any browser work:

```bash
# 1. Detect — treat ANY executable on PATH as installed (Homebrew, npm, or other).
if command -v playwright-cli >/dev/null 2>&1; then
  playwright-cli --version          # already installed — done, do NOT reinstall
else
  # 2. Only if truly absent: auto-install (no need to ask), then retry.
  npm install -g @playwright/cli@latest
  playwright-cli --version
fi
```

- **Do not `npm install` over an existing binary.** A working Homebrew (or other) install is fine; reinstalling risks PATH shadowing / version confusion. Install **only** when `command -v playwright-cli` finds nothing.
- If the install itself genuinely fails (capture the error), *then* the escape hatch is permitted — but a *missing* primary is never a reason to use `cdp.mjs`.
- Target v0.1.13+; pin a version if reproducibility matters.

- Node.js 18+ for `playwright-cli`; **Node 22+ for `cdp.mjs`** (it uses the built-in global `WebSocket`). On older Node, `cdp.mjs` exits early with a clear message — re-run under Node 22+ (e.g. `nvm use 22`).
- Cross-platform: macOS, Windows, Linux
- For the escape hatch (`cdp.mjs`) only when attaching to an existing browser: launch Chrome/Edge with `--remote-debugging-port=9222`, **or** open `chrome://inspect/#remote-debugging` and toggle the switch

## Quick start — choose your mode

`playwright-cli` has four profile modes. **Pick the one that matches your goal**, not the first command you see. Modes are ordered by recommendation: **A is the friendliest path for driving the user's real browser; C is the historical default with the most pitfalls.**

### Mode A — attach to my **already-running** Chrome/Edge via the Playwright Bridge extension ★ recommended

This is the only path that **does not require closing your browser** and **does not trigger the "unsupported flag — security will suffer" infobar**. It requires a **one-time** extension install **plus a one-time token capture**; after that, every subsequent attach is silent and zero-interaction.

**One-time setup (per browser):**

1. Install the Playwright Bridge extension from the Chrome Web Store:
   - **Chrome / Edge:** https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm
2. Verify the extension is enabled in `chrome://extensions` (or `edge://extensions`).
3. **Capture the bridge token so attach is zero-click.** The first `attach --extension`
   opens a *"…is trying to connect to the Playwright Extension"* dialog in the browser.
   That dialog shows a line `PLAYWRIGHT_MCP_EXTENSION_TOKEN=<token>` (with a copy button).
   This token is **random and per-browser** — Chrome and Edge each have their own. Save
   each one to its own file so the agent can supply it automatically:

   ```bash
   mkdir -p ~/.config/playwright-bridge && chmod 700 ~/.config/playwright-bridge
   # paste the value shown in each browser's dialog (token only, no VAR= prefix):
   printf '%s\n' '<edge-token>'   > ~/.config/playwright-bridge/msedge.token
   printf '%s\n' '<chrome-token>' > ~/.config/playwright-bridge/chrome.token
   chmod 600 ~/.config/playwright-bridge/*.token
   ```

   > **Why this matters:** without the token, the extension shows that consent dialog on
   > **every** attach (this is the "had to click Allow every time" symptom). Passing the
   > stored token via `PLAYWRIGHT_MCP_EXTENSION_TOKEN` makes the extension auto-connect with
   > no dialog. Re-clicking the dialog's regenerate ↻ button invalidates the saved token —
   > re-capture it if you do. Treat the token like a credential: it grants full control of
   > that browser (chmod 600, never commit it).

**Every subsequent use** — export the matching per-browser token, then attach:

```bash
# Attach to whichever Chrome/Edge is already running (no port flag, no relaunch, no dialog)
PLAYWRIGHT_MCP_EXTENSION_TOKEN=$(cat ~/.config/playwright-bridge/chrome.token) \
  playwright-cli attach --extension=chrome
PLAYWRIGHT_MCP_EXTENSION_TOKEN=$(cat ~/.config/playwright-bridge/msedge.token) \
  playwright-cli attach --extension=msedge

# The attach session is named after the channel — query it with --s=<channel>:
playwright-cli --s=chrome tab-list
playwright-cli --s=msedge snap <id>

# Tear down without affecting the browser
playwright-cli --s=chrome detach
```

> ⚠️ **Mode A attaches to the user's *live* browser — recover gently, never loop.** The
> `attach --extension` session is a daemon you must keep alive: run the attach **and** the
> follow-up `--s=<channel>` commands from the **same long-lived shell/session** (an `async`
> shell you keep open), not as separate one-shot `bash` calls — a fresh invocation may not
> see an attach started in a previous one. If the session seems to drop, do **not** rapidly
> cycle `playwright-cli kill-all` + `attach --extension` against the running browser to force
> it back: that repeated teardown/re-attach can destabilize and **crash the user's live
> Chromium/Edge** (a Chromium `CHECK()` → `EXC_BREAKPOINT` in `CrBrowserMain`). Instead:
> `detach` cleanly, verify with `--s=<channel> tab-list`, re-attach **at most once**, and if
> it drops again **stop and ask the user** before any further browser-control attempts (or
> switch to the `scripts/cdp.mjs` escape hatch). Reserve `kill-all` for orphan cleanup in the
> launch modes (B/C) — it is not a Mode A retry primitive.

> ♻️ **Tab hygiene — attach once, reuse one tab, and clean up only what *you* opened.** The
> leak to avoid (observed in the wild — see
> [known-issues](references/known-issues.md#mode-a-looped-attachdetach-leaks-tabs---high)):
> `attach → tab-new → one action → detach`, looped per action, piling up orphan tabs in the
> user's real browser. Three rules prevent it:
> 1. **One long-lived attach, one working tab.** Attach **once** (from a long-lived async
>    shell) and run the whole flow through `--s=<channel>` against a **single** tab. Do
>    **not** `attach`/`detach` per action: a fresh Mode A attach can't see a tab opened by a
>    previous (now-detached) attach — its `tab-list` shows only the extension's
>    `connect.html` — so it opens **another** `tab-new` and strands the old one. At most one
>    `tab-new` per flow unless there's an explicit multi-tab reason.
> 2. **Track the tab you open.** After `tab-new`, note its id/title/url and reuse that tab
>    for every later action. If you've lost track of it, inspect `--s=<channel> tab-list` —
>    do **not** blindly `tab-new` again.
> 3. **`detach` does NOT close tabs.** It only drops the CDP connection; every tab you opened
>    with `tab-new` stays. In Mode A you only ever see your own tabs (the extension exposes
>    the agent's tabs plus its `connect.html` — never the user's other open tabs), so before
>    you finish, close the tabs you opened (`--s=<channel> tab-close`), then `detach` last.
>    If the flow errors out, best-effort close your tabs before detaching; if the user wants
>    the result left on screen, skip `tab-close`, say so, and still `detach` last.

> If `~/.config/playwright-bridge/<channel>.token` is missing, run `attach --extension`
> once **without** the env var, copy the token from the dialog into that file (step 3), then
> re-run with the env var for silent attach thereafter.

Why this avoids both pain points:

- **No "must close browser":** the extension does the CDP handshake from inside the user's already-running browser process — no second Chromium instance, no `--user-data-dir` lock conflict.
- **No infobar:** nothing is relaunched, so playwright-cli never appends `--disable-blink-features=AutomationControlled` to your browser's launch args. Your daily Chrome is already running with whatever flags *you* gave it (typically none of the debug ones), so the "unsupported flag" banner does not appear.

### Mode B — fresh, isolated session (sign-in-once automation)

Launch a brand-new persistent profile under playwright-cli's daemon directory. Use this when you want a dedicated, throw-away-able browser session — e.g., to automate a workflow without touching the user's daily browser. After the user signs in once, the session persists across `close`/restart.

```bash
playwright-cli -s=<session-name> open <url> --browser=msedge --persistent --headed

# Examples
playwright-cli -s=automation open https://example.com --browser=msedge --persistent --headed
playwright-cli -s=demo       open about:blank          --browser=chrome --persistent --headed
```

Profile lives under `~/Library/Caches/ms-playwright/daemon/<hash>/ud-<session>-<browser>/` (macOS; equivalent paths on Linux/Windows). Wipe with `playwright-cli -s=<session-name> delete-data`.

> **Modal-free, but the infobar still appears** — playwright-cli launches the browser itself with `--disable-blink-features=AutomationControlled`, so Chromium will show the cosmetic "unsupported command-line flag" banner. See [known-issues](references/known-issues.md#the-automationcontrolled-infobar--cosmetic-unfixable-in-launch-modes). Use Mode A to avoid it.

### Mode C — drive my real daily profile via a relaunched browser ⚠️ pitfalls

Open a fresh window of Edge/Chrome backed by the user's daily profile dir. **Use Mode A instead whenever possible** — Mode C is included for completeness and for edge cases where the Bridge extension can't be installed (locked-down corp policy, etc.).

> 🚨 **Do NOT use Mode C against a work-managed Edge/Chrome profile (M365/Entra-bound).** Playwright's launch flags (`--disable-features=msForceBrowserSignIn`, `--disable-sync`, `--disable-component-extensions-with-background-pages`) corrupt the work-account → profile binding. Symptom: `managed_user_id` cleared in `<dir>/Default/Preferences`, next sign-in fails with `AADSTS530003`, user is signed out and must re-sign-in manually via `edge://settings/profiles`. See [known-issues](references/known-issues.md#edge-work-account-sign-out--conditional-access-aadsts530003-after-mode-c-launch).
>
> **Pre-flight check — refuse to proceed if this prints `REFUSE`:**
>
> ```bash
> python3 -c "import json,sys; p=json.load(open(sys.argv[1]+'/Default/Preferences')); ai=p.get('account_info',[]); print('REFUSE — account bound:', ai[0].get('email','?')) if ai else print('OK — no account bound')" \
>   "$HOME/Library/Application Support/Microsoft Edge"
> ```
>
> If the daily profile has a bound work account, use **Mode A** (attach to the already-running browser — never touches profile state) or the **profile-clone recipe** below.

#### Mode C-safe — profile clone (recommended when Mode C is needed at all)

Snapshot the daily profile to a sibling dir and point Playwright at the clone. Cookies/logins are present at clone time (file-based); the live profile is never touched, so `managed_user_id` and the SSO binding stay intact. The clone is throwaway.

```bash
# macOS — Edge example
SRC="$HOME/Library/Application Support/Microsoft Edge"
CLONE="$HOME/Library/Application Support/Microsoft Edge.playwright-clone"
cp -R "$SRC" "$CLONE"
playwright-cli open --browser=msedge --headed --profile="$CLONE"

# When done
playwright-cli close
rm -rf "$CLONE"
```

Caveats: any new cookies the clone acquires (e.g., a fresh login) do NOT flow back to the daily profile. Treat the clone as a one-shot session.

```bash
# macOS — Edge
playwright-cli open --browser=msedge --headed \
  --profile="$HOME/Library/Application Support/Microsoft Edge"

# macOS — Chrome
playwright-cli open --browser=chrome --headed \
  --profile="$HOME/Library/Application Support/Google/Chrome"
```

| OS | Edge daily profile path | Chrome daily profile path |
|---|---|---|
| **macOS** | `$HOME/Library/Application Support/Microsoft Edge` | `$HOME/Library/Application Support/Google/Chrome` |
| **Linux** | `$HOME/.config/microsoft-edge` | `$HOME/.config/google-chrome` |
| **Windows (PowerShell)** | `$env:LOCALAPPDATA\Microsoft\Edge\User Data` | `$env:LOCALAPPDATA\Google\Chrome\User Data` |

> **Two unavoidable pitfalls in this mode:**
>
> 1. **"Single-instance per profile" lock.** Chromium refuses to launch a second instance against the same `--user-data-dir`. The user must close all Edge/Chrome windows for that profile first, AND any prior playwright-cli daemon must be cleaned up (see [orphan diagnosis](#first-aid--browser-wont-launch-orphan-diagnosis) — this is the most common cause of "I closed my browser but it still won't launch").
> 2. **"Unsupported command-line flag" infobar.** playwright-cli appends `--disable-blink-features=AutomationControlled` on every launch. Cosmetic but always visible. Not suppressible via any config knob. See [known-issues](references/known-issues.md#the-automationcontrolled-infobar--cosmetic-unfixable-in-launch-modes).
>
> Workflow when Mode C is the only option:
>
> 1. `playwright-cli kill-all` (kills daemons) AND check for orphan Chromium processes against the daily dir (see orphan diagnosis below)
> 2. Ask the user to close all Edge/Chrome windows for that profile
> 3. Run the `playwright-cli open --profile=...` command above
> 4. When done: `playwright-cli close`. The user can then re-open their normal browser and tabs will restore from session.

### Mode D — attach to a browser launched with `--remote-debugging-port=N`

Useful when another tool (e.g., Clawpilot, a CI harness, or the user explicitly launching Chrome with `--remote-debugging-port=9222`) has exposed a CDP endpoint. Connects without launching a new instance.

```bash
# By channel — Playwright reads <user-data-dir>/DevToolsActivePort and resolves to ws://localhost:<port>
playwright-cli attach --cdp=msedge
playwright-cli attach --cdp=chrome

# By explicit endpoint
playwright-cli attach --cdp=http://localhost:9222
playwright-cli detach            # leaves the external browser running
```

> **⚠️ This does NOT work against a normally-running Chrome/Edge.** Verified May 2026 against a fresh `--remote-debugging-pipe` Chrome: `--cdp=chrome` resolves to `ws://localhost:9222` and gets `ECONNREFUSED` because no TCP port is listening. For this mode to work, the browser must have been launched with `--remote-debugging-port=N`, **or** the user must manually open `chrome://inspect/#remote-debugging` and toggle "Allow remote debugging for this browser instance" **every session** (interactive).
>
> If you want a no-interaction attach to a normally-running browser, **use Mode A (Bridge extension)** instead.

The first attach in this mode triggers Chromium's "Allow debugging" modal once per tab.

### First aid — "browser won't launch" / orphan diagnosis

If Mode C (or any `open --profile`/`open --persistent`) fails with `Browser is already in use for <dir>` or `ProcessSingleton` errors, the cause is almost always a **playwright-launched Chromium process that survived its daemon's death** and is still holding the user-data-dir lock. The user has likely already closed their real browser; the orphan is invisible to them.

**Diagnose and clean up:**

```bash
# 1. Kill any live playwright-cli daemons (also reaps their browsers if attached)
playwright-cli kill-all

# 2. List browser processes still holding the daily user-data-dir
#    (substitute the daily dir for your OS — see Mode C table)
ps -ef | grep -- "--user-data-dir=$HOME/Library/Application Support/Google/Chrome" | grep -v grep

# 3. Kill each PID returned in step 2
kill <PID>
# (use kill -9 <PID> only if the process ignores SIGTERM)

# 4. Re-confirm nothing is holding the dir
ps -ef | grep -- '--user-data-dir=' | grep -v grep
```

Signs of an orphan you should suspect:

- `playwright-cli list` says `(no browsers)` but `ps` shows a Chromium with `--disable-blink-features=AutomationControlled --user-data-dir=<daily-dir>` and `--remote-debugging-pipe`. That flag combination is playwright-cli's signature — it is not your real browser.
- The user insists they closed their browser, yet `--profile=<daily-dir>` still complains about a lock.

### Common interaction loop (any mode)

```bash
playwright-cli snapshot              # compact A11y tree with e<N> refs
playwright-cli click e15
playwright-cli fill e23 "user@example.com" --submit
playwright-cli close                 # or `detach` for Mode A / Mode D
```

## Primary command surface — `playwright-cli`

The bundled Microsoft skill ships the canonical command reference (388-line `SKILL.md` + 10 reference files). Read it directly for the full surface:

- **Bundled skill:** under the install's `node_modules`, at
  `…/@playwright/cli/node_modules/playwright-core/lib/tools/cli-client/skill/SKILL.md`.
  Resolve the prefix from the install method — npm: `$(npm prefix -g)/lib/node_modules`;
  Homebrew: `$(brew --prefix)/lib/node_modules` (e.g. `/opt/homebrew/lib/node_modules`).
  When unsure, locate it directly: `dirname "$(command -v playwright-cli)"` then search
  upward, or `find "$(npm prefix -g)/lib/node_modules/@playwright" -name SKILL.md 2>/dev/null`.
- **Install into a project workspace:** `playwright-cli install --skills` (writes to `.claude/skills/playwright-cli/`; `--skills=agents` writes to `.agents/skills/playwright-cli/`; **no `copilot` target exists** — for Copilot CLI users, just read the bundled path above)

The headline verbs the agent should reach for first:

| Category | Commands |
|----------|----------|
| **Lifecycle** | `open [url]`, `close`, `goto <url>`, `list`, `close-all`, `kill-all`, `delete-data`, `-s=<name>` for named sessions |
| **Read** | `snapshot [target]` (compact A11y tree with `e<N>` refs), `screenshot [target]`, `eval <fn>`, `console`, `requests`, `request <i>`, `request-headers <i>`, `request-body <i>`, `response-body <i>` |
| **Interact** | `click <ref>`, `dblclick <ref>`, `fill <ref> <text> [--submit]`, `type <text>`, `press <key>`, `hover <ref>`, `select <ref> <val>`, `check <ref>`, `uncheck <ref>`, `drag <a> <b>`, `drop <ref>`, `upload <file>`, `dialog-accept`, `dialog-dismiss` |
| **Tabs** | `tab-list`, `tab-new [url]`, `tab-close [i]`, `tab-select <i>` |
| **Storage** | `state-save [file]`, `state-load <file>`, `cookie-list`, `cookie-get/set/delete/clear`, `localstorage-*`, `sessionstorage-*` |
| **Network** | `route <pattern>` (mock), `route-list`, `unroute`, `network-state-set online|offline` |
| **DevTools** | `tracing-start`, `tracing-stop`, `video-start`, `video-stop`, `video-chapter`, `pdf`, `show --annotate` (interactive UI review with the user) |
| **Targeting** | `e<N>` refs (default, from snapshot) · CSS selectors · Playwright locators (`getByRole(...)`, `getByTestId(...)`) |

Two flags worth memorising:

- `--raw` strips status/code/snapshot from output — use to pipe into `jq`, `diff`, etc.
- `--json` wraps every reply as JSON — use for scripted reading.

## Profile-mode summary (which one when?)

| Goal | Mode | Closes browser? | Infobar? | Modal? | Profile location |
|------|------|------------------|----------|--------|------------------|
| **Drive the user's real session without closing it** ★ recommended | **A** (`attach --extension=<channel>`) | **No** | **No** | No (one-time extension install) | The running browser's profile |
| Sign-in-once automation, isolated from daily browsing | B (`-s=<name> open --persistent`) | No | Yes (cosmetic) | No | `~/Library/Caches/ms-playwright/daemon/<hash>/ud-<session>-<browser>/` (macOS) |
| Drive daily profile via a relaunched browser | C (`open --profile=<daily-dir>`) | **Yes — daily browser must be closed AND orphans cleaned** | Yes (cosmetic) | No | User's daily user-data-dir |
| Attach to a browser launched with `--remote-debugging-port=N` | D (`attach --cdp=<channel\|url>`) | No | Inherits launcher's flags | Yes (per tab, once) | The running browser's profile |
| Attach to running browser without install (one-off) | Escape hatch (`scripts/cdp.mjs`) | No | Inherits launcher's flags | Yes (per tab, once) | The running browser's profile |

## Escape hatch — `scripts/cdp.mjs` (raw Chrome DevTools Protocol)

> **Stop.** Before reading the commands below, re-read the **Decision rule** at the top of this file. If your task is anything other than the three escape-hatch cases listed there, **close this section and use `playwright-cli`**. Specifically: do not use `cdp.mjs` for routine clicks, fills, navigation, screenshots, snapshots, or website logins.

Use only when one of the three escape-hatch triggers applies (raw CDP method, attach-without-extension, or cross-origin iframe `Input.insertText`).

```bash
scripts/cdp.mjs list                      # list open pages in the user's Chrome/Edge
scripts/cdp.mjs snap     <target>         # accessibility tree snapshot (when attached to user's daily browser)
scripts/cdp.mjs eval     <target> <expr>  # evaluate JS expression
scripts/cdp.mjs evalraw  <target> <method> [json]  # raw CDP command passthrough — the main reason this exists
                                           # e.g. evalraw <t> "Network.setBlockedURLs" '{"urls":["*.jpg"]}'
scripts/cdp.mjs nav      <target> <url>   # navigate + wait for load
scripts/cdp.mjs net      <target>         # resource timing entries
scripts/cdp.mjs clickxy  <target> <x> <y> # click at CSS pixel coords (when ref-based addressing isn't possible)
scripts/cdp.mjs type     <target> <text>  # insert text at focus (cross-origin iframes — playwright-cli can't reach them)
scripts/cdp.mjs key      <target> <key>   # press key (Enter, Tab, Escape, ArrowDown, etc.)
scripts/cdp.mjs wait     <target> <selector> [ms]  # wait for selector
scripts/cdp.mjs loadall  <target> <selector> [ms]  # click "load more" until gone
scripts/cdp.mjs stop     [target]         # stop daemon(s)
```

`<target>` is a unique targetId prefix from `cdp.mjs list`. To target Edge: `CDP_BROWSER=edge`. The first CDP attach to a tab triggers Chromium's "Allow debugging" modal (**once per tab**); a background daemon then holds that single approval alive for the rest of the session.

> **Make one approval stick.** The daemon keeps the granted "Allow debugging" approval alive across many commands on the same tab, so you should only ever click *Allow* **once per tab**. To avoid re-prompts:
> - **Reuse the same tab/daemon** for a multi-step flow — don't re-`list` and re-attach unnecessarily, and don't spread one task across many tabs.
> - `list` is browser-level and does **not** prompt — only per-tab commands (`snap`, `eval`, `nav`, …) do, and only the first time for that tab.
> - The daemon idles out after **60 min** by default (override with `CDP_IDLE_TIMEOUT`, in minutes); a longer timeout means fewer re-approvals at the cost of holding a CDP session open longer. Tear down explicitly with `cdp.mjs stop [target]`.
> - **If repeated approvals are still annoying the user, stop using `cdp.mjs` and switch to Mode A (the Playwright Bridge extension)** — it is the only path that is *truly* zero-click after a one-time extension install **and token capture** (`PLAYWRIGHT_MCP_EXTENSION_TOKEN`; see Mode A). Per-tab re-prompting is a Chrome security behavior `cdp.mjs` cannot fully eliminate.

**These commands no longer exist** because `playwright-cli` does them better (auto-waiting, no daemon plumbing, cross-browser): `shot`, `fullshot`, `html`, `click`, `hover`, `scroll`. Reach for the `playwright-cli` equivalent (`screenshot`, `eval "el => el.outerHTML"`, `click`, `hover`, `mousewheel`).

## MCP secondary

For long, iterative single-page exploration sessions (where the agent benefits from server-held browser state across many turns), the **`playwright` MCP server is already builtin** in Copilot CLI — verify with `/mcp`. The CLI surface above wins for almost everything else; see `references/agent-patterns.md` for the MCP-vs-CLI decision table and the canonical `.mcp.json` snippet for advanced custom configurations.

## Known constraints (May 2026)

- **`playwright-cli` is 0.1.x** — single-maintainer cadence, weekly releases, breaking changes possible. Pin a version in production scripts.
- **~1 s per command latency (#387).** `snapshot` is faster (~95 ms); other commands carry daemon overhead. Acceptable for interactive use; consider batching for tight loops.
- **Auto-snapshot bug #370 does not reproduce in v0.1.13.** Snapshots are post-action only; nothing fires during idle. Interactive MFA flows (M365/Entra, Okta, Auth0, etc.) are safe (verified 2026-05-12 against Outlook + Azure + Defender).
- **Cloudflare bot detection still applies (#372).** `--persistent --headed` does not, by itself, defeat aggressive bot detection on sites that fingerprint Chromium-revealing flags.
- **Edge in `attach --extension` mode had rough edges through v0.1.11.** Fixes landed in v0.1.12 (`tab-new` crash) and v0.1.13 (browser-level CDP forwarding). As of v0.1.13 it is the **recommended** path for driving the user's real Edge/Chrome (see Mode A in Quick Start). If you hit a regression, fall back to Mode B (`-s=<name> open --persistent`).
- **Default profile dir is daemon-internal.** `-s=<session>` derives a stable path from session name + browser channel. Inspect via `playwright-cli list`. Wipe via `playwright-cli -s=<name> delete-data`.

## Tips

- Prefer `snapshot` over `eval`/HTML dumps to understand page structure — compact, ref-addressable, designed for agents.
- Use `cdp.mjs type` (not `eval`-based input) inside cross-origin iframes — `clickxy` to focus first, then `type`.
- For DPR-aware coordinates with `cdp.mjs clickxy`: CSS px = screenshot image px / DPR. Typical Retina (DPR=2): divide by 2.
- After an interactive sign-in on any site (M365, GitHub, your bank, etc.) in a Mode A or Mode B session, the cookies survive `close`/restart cycles. No need to re-authenticate per run.
- Reach for `cdp.mjs evalraw` when you need a raw `Network.*`, `Performance.*`, `Target.*`, or other CDP method that `playwright-cli`'s `run-code` can't reach ergonomically.
- **Drafting mail in Outlook? Use `scripts/owa-compose.mjs`, not hand-rolled clicks.** See [references/outlook-web.md](references/outlook-web.md) for the verified DOM contract and the trap list (Escape = Discard, Bcc hidden until toggled, invisible decoy Close button, full-page compose has no Close).
- **Each browser profile has its own Playwright Bridge token**, and `attach --extension` **never validates it** — a wrong token makes the CLI hang forever with no output, because validation happens inside the extension. Don't guess the token: `scripts/bridge-token.mjs` reads the real one straight from the profile on disk (`list` / `check` / `sync-all`, ~0.1s, no browser launch, no consent dialog). See [known-issues](references/known-issues.md#attach---extension-hangs-forever-on-a-stalewrong-token--high-solved).

## Bundled References

Load these only when the trigger applies — none are needed for routine navigation, clicking,
or form filling.

| Read | When |
|------|------|
| `references/outlook-web.md` | Any Outlook / OWA task: drafting, replying, forwarding, reading mail, or picking a browser profile |
| `references/known-issues.md` | An attach hangs or fails, a launch mode misbehaves, you hit the automation infobar, a work profile gets signed out, or you need the security/mitigation notes |
| `references/agent-patterns.md` | Choosing between the CLI, MCP, and `cdp.mjs`; wiring `.mcp.json`; or justifying the DOM/A11y-vs-vision approach |

## Bundled Scripts

| Run | When |
|-----|------|
| `scripts/owa-compose.mjs` | Drafting, replying to, reading, or sending Outlook mail. Use it instead of hand-driving OWA — `draft --spec` is one shot and self-verifying |
| `scripts/bridge-token.mjs` | Anything token- or profile-related: an attach hangs, you need a different browser profile, or you want to see/repair every profile's Playwright Bridge token (`list`, `check`, `sync-all` — no browser launch) |
| `scripts/cdp.mjs` | Raw CDP escape hatch only — `Network.*`/`Performance.*`/`Target.*` methods, cross-origin iframe input, or driving a running browser without the bridge extension |
