# Known Issues & Mitigations for Agent-Driven Browser Automation

This is a reference companion to the `browser` skill. It catalogs critical failures, high-severity bugs, and proven mitigations across the two browser-automation paths the skill uses (`playwright-cli` as primary, `@playwright/mcp` as MCP secondary) plus the rationale for the one tool we explicitly rejected (`browser-use` CLI 2.0). Sources include 100+ GitHub issues on [`microsoft/playwright-mcp`](https://github.com/microsoft/playwright-mcp), the [`microsoft/playwright-cli`](https://github.com/microsoft/playwright-cli) and [`browser-use/browser-use`](https://github.com/browser-use/browser-use) issue trackers, and the in-house May 2026 research at `~/.copilot/research/browser-use-2026/`. Consult this file before building agent-driven browser automation to avoid known pitfalls.

---

## Critical Failures (§13.1)

### Token Death Spiral — 🔴 CRITICAL

Every browser action returns a large accessibility snapshot, rapidly consuming the LLM context window. On complex pages (Amazon, LinkedIn), a single snapshot can be **2,000+ lines**.

> *"Each action generates large responses... context window quickly used up... frequently ends up 'compacting'"* — [playwright-mcp #1274](https://github.com/microsoft/playwright-mcp/issues/1274)

> *"Tool definitions alone consume 14.4k tokens (9.2% of Claude's window). 33% is spent on descriptions."* — [playwright-mcp #1290](https://github.com/microsoft/playwright-mcp/issues/1290)

**Mitigation:**
- CLI approach saves snapshots to files instead of consuming context
- Use `--snapshot-mode=none` and invoke snapshots selectively
- Consider community forks with snapshot caching

### Infinite Tab/Retry Loops — 🔴 CRITICAL

LLMs will retry failing actions indefinitely without meta-reasoning about fundamentally broken approaches.

> *"Agent opens 1000 tabs and keeps failing"* — [playwright-mcp #1299](https://github.com/microsoft/playwright-mcp/issues/1299)

**Mitigation:**
- Implement explicit `max_steps` / `max_actions` circuit breakers
- Use meta-prompts: *"If last 3 actions failed, try a completely different approach"*

### 5-Second HTTP Timeout — 🔴 CRITICAL (HTTP transport only)

The HTTP/SSE transport has a hard 5-second timeout that silently kills navigation to real-world websites.

> *"100% success at 4s, 100% failure at 6s. Navigate to Amazon: 5-10s → ❌"* — [playwright-mcp #1293](https://github.com/microsoft/playwright-mcp/issues/1293)

**Mitigation:**
- Use **stdio transport** (not HTTP) for anything involving real websites
- HTTP transport is only safe for fast, controlled test environments

---

## High-Severity Issues (§13.2)

| Issue | Severity | Description | Source |
|-------|----------|-------------|--------|
| **Dialog hangs** | 🟡 HIGH | JS alerts during navigation freeze the entire session | [playwright-mcp #1279](https://github.com/microsoft/playwright-mcp/issues/1279) |
| **New tab blindness** | 🟡 HIGH | Clicks that open new tabs go undetected | [playwright-mcp #1391](https://github.com/microsoft/playwright-mcp/issues/1391) |
| **iFrame verification gaps** | 🟡 HIGH | `verify_element_visible` can't find elements inside iframes | [playwright-mcp #1394](https://github.com/microsoft/playwright-mcp/issues/1394) |
| **Entra ID 2FA broken** | 🟡 HIGH | Enterprise 2FA defaults to "Security Key only" — no Authenticator | [playwright-mcp #1097](https://github.com/microsoft/playwright-mcp/issues/1097) |
| **storage-state doesn't apply** | 🟡 HIGH | Cookies from storage state not loaded | [playwright-mcp #1388](https://github.com/microsoft/playwright-mcp/issues/1388) |
| **Snapshot insufficient** | 🟡 HIGH | Accessibility tree misses images, spatial relationships | [playwright-mcp #1193](https://github.com/microsoft/playwright-mcp/issues/1193) |

---

## What Makes Agent-Driven Playwright Harder (§13.3)

Five fundamental challenges distinguish agent-driven browser automation from human-driven:

1. **No visual intuition** — Agents can't tell if a button is below the fold or if a spinner is still spinning
2. **No temporal awareness** — Agents either don't wait, wait too long, or burn tokens polling
3. **Token cost per "look"** — A human glancing at a page costs nothing; an agent costs 500–3,000 tokens per view
4. **No error recovery intuition** — Humans try different approaches; LLMs retry the same failing action
5. **Stateless reasoning** — Each LLM call re-reads entire context; no accumulated "mental model" of the page

These challenges compound: a single retry loop (challenge 4) costs tokens (challenge 3), without temporal awareness of how long it has been looping (challenge 2), and without visual feedback that the page state has changed (challenge 1).

---

## Proven Mitigations (§13.4)

| Problem | Mitigation |
|---------|------------|
| **Token bloat** | Use CLI (snapshots to files), `--snapshot-mode=none`, selective snapshots |
| **Agent loops** | `max_steps` circuit breakers, "try different approach" meta-prompts |
| **Timing issues** | `waitUntil: 'domcontentloaded'`, `browser_wait_for` with text predicates |
| **Auth failures** | Persistent profiles, `--extension` mode to connect to real Chrome |
| **Browser profile locks** | Kill browser processes before new sessions, use `--isolated` |
| **Bot detection** | `--extension` mode, real profiles, residential proxies, cloud browsers |
| **iFrame issues** | `browser_evaluate` with targeted DOM queries instead of verification tools |

### Quick decision tree

```
Is the page complex (>50 interactive elements)?
  YES → Use --snapshot-mode=none, take targeted snapshots
  NO  → Default snapshot mode is fine

Are you navigating real websites (not localhost)?
  YES → Use stdio transport, NOT HTTP/SSE
  NO  → Either transport works

Does the site require authentication?
  YES → Use --persistent profile or --extension mode
  NO  → Default ephemeral context is fine

Is the agent looping on the same action?
  YES → Check for dialog hangs, new tab blindness, or iFrame gaps
  NO  → Continue normally
```

---

## Security Considerations (§9.2)

| Concern | Detail |
|---------|--------|
| **Storage state files** | Contain cookies and auth tokens — **never commit to repos**. Add to `.gitignore`. |
| **MCP `--allowed-origins`** | Configure to restrict which origins the browser can navigate to. Prevents agent from browsing arbitrary sites. |
| **CLI `--persistent` profiles** | Store browsing data (cookies, localStorage, history) on disk. Treat as sensitive data. |
| **`page.evaluate()`** | Runs arbitrary JavaScript in the browser context. **Sanitize all inputs** when used in agent pipelines to prevent injection. |

### Recommendations

- Store `storageState.json` files in a secrets manager or encrypted volume, not in source control
- Use `--isolated` mode when you don't need persistent state between sessions
- Audit `page.evaluate()` calls in agent-generated code — an LLM could be manipulated into injecting malicious JS
- Set `--allowed-origins` to a strict allowlist in production agent deployments

---

*Last updated 2026-05-12 with `playwright-cli` v0.1.13 and `browser-use` CLI 2.0 issue trackers.*
*MCP issues sourced from 100+ GitHub issues on [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp).*

---

## `playwright-cli` known issues (May 2026, v0.1.13)

These apply to the **primary** path. Severity is classified for *our* use case (Microsoft-tenant Edge user, M365 SSO workflows, single-developer Copilot CLI). General severity may differ.

### Auto-snapshot footgun (#370) — 🟢 NOT REPRODUCIBLE in v0.1.13

> *"playwright-cli auto-snapshots every ~30 seconds; this can refresh the page mid-MFA"* — claim under [issue #370](https://github.com/microsoft/playwright-cli/issues/370), closed 2026-04-16.

**Status (verified 2026-05-12):** Held the daemon idle for 35+ seconds with `playwright-cli open https://example.com`; only the initial post-`goto` snapshot file existed. **No periodic snapshot fires during idle.** Snapshots are post-action only — they fire after each explicit `playwright-cli` command or on demand via `playwright-cli snapshot`. The mechanism behind #370 does not exist in v0.1.13. M365 MFA flows are safe.

**Mitigation:** None needed in v0.1.13. If reproduced on a future version, reach for `--snapshot-mode=none`-style flags if/when they are added, or wrap the MFA window in a `delete-data` + manual login sequence.

### ~1 second per command latency (#387) — 🟡 HIGH

> *"~1s latency per command, even for trivial click / run-code; ~95ms for snapshot"* — [issue #387](https://github.com/microsoft/playwright-cli/issues/387)

The 50 ms/action figure quoted in some marketing material is the *daemon-internal* latency. Real wall-clock cost is ~1 s/command for non-snapshot operations. Over a 20-action sequence that's ~20 s of overhead.

**Mitigations:**
- Batch interactive flows (`fill --submit`, multi-step `run-code` snippets) where possible
- Use `--raw` output to skip snapshot regeneration when you don't need page state back
- Accept the cost for routine work; if it bites, drop down to `cdp.mjs` for the hot loop

### `attach --extension=msedge` is tier-2 (#373) — 🟡 HIGH

> *"`tab-new` crashes in `attach --extension=msedge`"* — [issue #373](https://github.com/microsoft/playwright-cli/issues/373), fixed in v0.1.12.
> *"Forward browser-level CDP commands in extension mode"* — v0.1.13 release notes.

The msedge extension path is the project's bleeding edge. Two recent fixes (v0.1.12 and v0.1.13) landed within days of the May 2026 research. Treat as **tier-2 within extension mode, tier-1 within launch mode** for Edge.

**Mitigation:** Prefer `playwright-cli open --persistent --browser=msedge` (launch mode) over `attach --extension=msedge` until the extension path has more soak time. Verified 2026-05-12: launch mode survives Entra MFA cleanly across `close`/restart cycles.

> **Update 2026-05-30:** `attach --extension` (Mode A) is now validated end-to-end on **both Edge and Chrome** — silent token-bypass attach, plus driving a real Entra-authenticated page (`ai.azure.com`) with **no sign-in wall**. See the three subsections below. Mode A is the recommended path for the user's real daily browser; launch mode remains the fallback if the extension path regresses.

### Mode A extension attach: token bypass, scoped tabs, auth inheritance — ✅ VALIDATED 2026-05-30

Three behaviors of `attach --extension` that the agent **must** understand, all verified on Edge + Chrome:

**1. The connection dialog re-appears on every attach unless you supply the token.**
The first `attach --extension` opens a *"…is trying to connect to the Playwright Extension"* consent dialog in the browser. This is the *"had to click Allow every time"* symptom — it is **not** the same bug as the `cdp.mjs` modal (that one was the missing-import death spiral). The extension stores a **random, per-browser** `auth-token` in its own `localStorage` (`getOrCreateAuthToken()` in the extension's `connect.js`). The dialog displays it as `PLAYWRIGHT_MCP_EXTENSION_TOKEN=<token>`. On connect, the extension compares the env var to the stored token; **exact match → auto-connect, no dialog**; mismatch → `"Invalid token provided."`; absent → the manual tab-picker dialog.

- **Fix (zero-click):** capture each browser's token once and store it per-channel:
  `~/.config/playwright-bridge/msedge.token`, `~/.config/playwright-bridge/chrome.token`
  (dir `chmod 700`, files `chmod 600`). Then attach with
  `PLAYWRIGHT_MCP_EXTENSION_TOKEN=$(cat ~/.config/playwright-bridge/<channel>.token) playwright-cli attach --extension=<channel>`.
  See Mode A in `SKILL.md` for the canonical commands.
- One env var holds one value → Chrome and Edge tokens differ, so the agent must export the **matching** per-channel token (don't try to unify; the extension UI only offers random regenerate, not set-a-value).
- Clicking the dialog's regenerate ↻ button **invalidates the saved token** — re-capture if the user does this. Treat the token as a credential (full control of that browser); never commit it.
- No browser restart is needed — the extension reads `localStorage` live on each connect.

**2. Tab visibility is scoped (opt-in), unlike `cdp.mjs`.**
After a token attach, `--s=<channel> tab-list` shows **only** the extension's own `connect.html`/`Welcome` page — **not** the user's other open tabs. The extension exposes a real tab only when the user clicks **"Allow & select"** in the dialog or drags the tab into the Playwright tab group; the agent can also drive a tab it opens itself via `tab-new <url>`. By contrast `cdp.mjs list` enumerates **every** open tab (verified 2026-05-30: it listed real `x.com`/`github.com`/etc. tabs the extension's `tab-list` did not). Trade-off: Mode A = higher privacy (per-tab opt-in); `cdp.mjs` = full browser exposure + one Allow per tab.

**3. Mode A inherits the user's real session — already-logged-in.**
Because Mode A drives the *already-running* browser process through the extension (no new profile, no relaunch), it carries the user's real cookies/tokens. Verified 2026-05-30 on Edge: `tab-new` to a deep `ai.azure.com` deployment URL rendered the authenticated page (`signInWall: false`, deployment details visible) with **no Entra login wall**. This is the core reason Mode A is the recommended path for *"drive my real daily browser with all my logins."* Mode B/C launch a fresh profile and **would** hit the sign-in screen.

### Mode A looped attach/detach leaks tabs — 🟡 HIGH

> *Observed in the wild 2026-06-04 (Edge, Mode A): the agent looped `attach --extension=msedge` → `--s=msedge tab-new https://ecs.skype.com/` → one `eval` → `--s=msedge detach`, each cycle a separate one-shot shell, ~20+ times — leaving a pile of identical orphan tabs in the user's real browser.*

**Root cause — two mechanics compound:**

1. **Per-action attach/detach can't reuse a tab.** Each cycle did a *fresh* attach in its own one-shot shell, then `tab-new`. A fresh Mode A attach's `tab-list` shows **only** the extension's own `connect.html` — it cannot see a tab opened by a previous, now-detached attach (tab visibility is scoped/opt-in; see the "Tab visibility is scoped" note above). So the agent opened **another** `tab-new` every cycle instead of reusing one.
2. **`detach` is connection cleanup, not tab cleanup.** `detach` drops the CDP connection but leaves every `tab-new` tab open. Nothing ever closed them.

**Fix / rule (guidance — `playwright-cli` is external and can't be changed):** see [SKILL.md → Mode A "Tab hygiene"](../SKILL.md). In short: attach **once** from a long-lived async shell, reuse a **single** working tab (track its id after `tab-new`; at most one `tab-new` per flow), and before finishing close the tabs you opened with `--s=<channel> tab-close`, then `detach` last. In Mode A `tab-list` only ever shows the agent's own tabs plus the extension's `connect.html` — the user's other tabs are never visible, so there's nothing of theirs to close. On error, best-effort close your own tabs before detaching.

### Cloudflare bot detection on `--persistent` (#372) — 🟡 HIGH

> *"Cloudflare bot detection blocks Google login under `--headed --persistent`; workaround using `--browser chrome --profile <real-Chrome-User-Data>` also failed"* — [issue #372](https://github.com/microsoft/playwright-cli/issues/372), closed 2026-04-22.

The persistent-profile pattern reduces bot-detection friction but does not eliminate it. Cloudflare and similar services fingerprint Chromium-revealing flags that survive persistent profiles.

**Mitigations:**
- For Cloudflare-protected logins, fall back to `cdp.mjs list` + attach to the user's already-running daily browser (no Chromium-flag leak — it's their real session)
- Use `playwright-cli attach --extension=msedge` once the extension path is solid (the extension trust handshake doesn't carry the same fingerprint signature)

### Distribution polish gaps (#396, #403) — 🟢 LOW

> *"`pnpm install -g` fails because `playwright-core` was not declared as a direct dep"* — [#396](https://github.com/microsoft/playwright-cli/issues/396), fixed in v0.1.12.
> *"Windows: URL with `&` query params truncated and shell-misparsed"* — [#403](https://github.com/microsoft/playwright-cli/issues/403), fixed 2026-05-09.

Cross-platform polish is incomplete. macOS install via `npm` (the supported path) is fine. Windows users should pin a recent version. `pnpm` users should pin v0.1.12+.

### Single-maintainer cadence — 🟡 HIGH (operational)

The v0.1.x release line is tagged by Yury Semikhatsky (Microsoft Playwright team). Outside contributors land fixes, but design and release cadence are one person + the upstream `microsoft/playwright` team. **Pin a version in production scripts.** A maintainer vacation = no fixes for a week.

### The `AutomationControlled` infobar — 🟢 COSMETIC, unfixable in launch modes

> *"You are using an unsupported command-line flag: `--disable-blink-features=AutomationControlled`. Stability and security will suffer."*

Every Chromium launched by `playwright-cli` shows this yellow infobar at the top of every tab. Verified against v0.1.13 source — `coreBundle.js:65381` unconditionally appends the flag on every Chromium launch:

```js
if (browserName === "chromium") {
  browser.launchOptions.args = browser.launchOptions.args ?? [];
  if (!browser.launchOptions.args.some(a => a.includes("--disable-blink-features")))
    browser.launchOptions.args.push(`--disable-blink-features=AutomationControlled`);
}
```

The flag suppresses `navigator.webdriver = true` so bot-detection scripts don't fingerprint the agent. **Chromium then displays the infobar for *any* value of `--disable-blink-features=*`** — this is by Chromium design and there is no Chromium flag that suppresses both the detection bypass and the warning. The `cli.config.json` schema accepts `browser.launchOptions.args` and `browser.launchOptions.ignoreDefaultArgs`, but neither helps: any value you set still produces a `--disable-blink-features=*` arg, which still triggers the same banner.

**The infobar is cosmetic** — nothing in your session is actually less secure than launching Chromium normally with the same `--user-data-dir`. The flag flips one navigator property; it does not disable sandboxing, certificate validation, or any actual security control.

**Mitigations:**

- **To make it disappear entirely:** use **Mode A** (`attach --extension=<channel>`) — playwright-cli connects to a browser the user launched themselves, so it never appends the flag and the banner never appears. This is the only working fix today.
- If Mode A is not available (locked-down corp policy preventing extension install), accept the banner. Surface to the user that it is purely cosmetic so they don't escalate.
- Do not waste effort patching `args` / `ignoreDefaultArgs` in `cli.config.json` — confirmed it cannot suppress the banner without disabling the underlying webdriver hide (which then breaks bot-detection workarounds).

### Edge work-account sign-out + Conditional Access AADSTS530003 after Mode C launch — 🔴 CRITICAL

**Symptom:** After running `playwright-cli open --profile="$HOME/Library/Application Support/Microsoft Edge"` (Mode C) against a work-managed Edge profile, the user finds:

- They have been signed out of their work account in Edge
- Re-signing in fails with `AADSTS530003: Your device is required to be managed to access this resource` even though Platform SSO / Company Portal is healthy and the device cert is valid
- `<edge-user-data-dir>/Default/Preferences` shows `profile.managed_user_id: ""` (empty string) — the work-account binding has been cleared
- Conditional Access no longer recognizes the device as managed for browser-based sign-in

Verified live on macOS 2026-05-28 against Edge stable + M365 tenant with device-compliance Conditional Access.

**Root cause:** Playwright launches Chromium with a deterministic-automation flag set that includes (visible via `ps -ef | grep -- '--user-data-dir='` while the session is live):

```
--disable-features=...,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion
--disable-component-extensions-with-background-pages
--disable-sync
--no-first-run --no-default-browser-check
```

`msForceBrowserSignIn` is the Edge-specific feature that re-asserts the work-account → profile binding on every launch and writes `managed_user_id` back into `Preferences`. Disabling it while writing to a profile that was previously bound, combined with `--disable-sync` (which prevents the binding from being restored from cloud), causes the binding to be cleared when Edge shuts down. This is **structural to how Playwright launches Chromium** — there is no `cli.config.json` knob that re-enables `msForceBrowserSignIn` without breaking automation determinism, and even if there were, `--disable-component-extensions-with-background-pages` would still take out the Edge SSO extension.

**Why it persists across re-sign-in:** The `AADSTS530003` error fires because Conditional Access compares the *current* profile binding to the device-compliance record. With `managed_user_id` empty, Edge sends the sign-in request as an unmanaged-browser flow, which the CA policy rejects. The user can recover by manually re-signing in to the work account from `edge://settings/profiles`, which re-binds the profile — but they may need IT help if the binding was tied to a specific token issuance.

**Prevention (only safe options):**

1. **Mode A (`attach --extension=msedge`)** — Playwright never launches Edge, so none of these flags are applied. The user's daily Edge stays normal. **This is the recommended path for any managed Edge profile.**
2. **Profile-clone recipe** (see `SKILL.md` → Mode C-safe) — copy the user-data-dir to a sibling and point Playwright at the clone. The live profile is untouched, so binding stays intact.
3. **Pre-flight check** — before any Mode C launch, refuse if `<dir>/Default/Preferences` contains a non-empty `account_info` array (means a Microsoft account is bound). The exact snippet is in `SKILL.md` → Mode C.

**Recovery (if it already happened):**

1. Open Edge normally (not via Playwright)
2. Go to `edge://settings/profiles`
3. Sign in with the work Microsoft account
4. If sign-in still fails with `530003`, ask IT to re-issue the device-compliance token (Intune → Devices → user's machine → Sync)
5. Verify recovery: `python3 -c "import json; print(repr(json.load(open(...+'Default/Preferences'))['profile']['managed_user_id']))"` should print a non-empty UUID

### Orphan Chromium holding the daily profile lock — 🟡 HIGH (UX)

**Symptom:** User reports "playwright-cli always tells me to close my browser." User insists they did close it. `playwright-cli open --profile=<daily-dir>` still fails with `Browser is already in use for <dir>` or `ProcessSingleton`.

**Root cause:** When a `playwright-cli` daemon dies (crash, `kill -9`, shell session ending without `close`), the Chromium browser it launched can survive as an orphan process. The orphan keeps the `--user-data-dir` lock on the daily profile dir. The orphan is invisible to the user (no taskbar/Dock icon if the windows were closed) and invisible to `playwright-cli list` (the daemon that registered it is gone).

**Reproduction signature (verified 2026-05-28):**

```bash
# After an orphan appears:
$ playwright-cli list
(no browsers)

$ ps -ef | grep -- '--user-data-dir=' | grep -v grep
501 73197 ... Google Chrome ... --disable-blink-features=AutomationControlled \
              --user-data-dir=/Users/<u>/Library/Application Support/Google/Chrome \
              --remote-debugging-pipe about:blank
```

The `--disable-blink-features=AutomationControlled` + `--remote-debugging-pipe` combination is playwright-cli's signature — a real user-launched Chrome never has both.

**Mitigation:**

1. **Diagnose first, ask the user to close their browser second.** Before telling the user to close anything, run the orphan diagnostic in [`SKILL.md` → First aid](../SKILL.md#first-aid--browser-wont-launch-orphan-diagnosis).
2. **Always run `playwright-cli kill-all` after any session that used Mode B or Mode C**, especially in scripts or CI that may exit before `close`.
3. **Prefer Mode A (`attach --extension`)** — it does not launch a Chromium process at all, so orphans are impossible by construction.

---

## `cdp.mjs` escape-hatch known issues

### Repeated "Allow debugging" modal — 🔴 ROOT CAUSE FOUND & FIXED (2026-05-30)

**Symptom:** While using the `cdp.mjs` escape hatch against the user's running browser, the user is asked to click Chrome's *Allow debugging* modal **over and over** — once is expected per tab, but it re-prompts on nearly every command.

**Root cause:** `cdp.mjs` ran the per-tab daemon that *should* hold the single approval alive, but `writeFileSync` was used (daemon port file at `runDaemon`, and the `list` page cache) **without being imported from `fs`**. Sequence of the failure:

1. The agent issues a per-tab command → parent spawns the daemon.
2. The daemon connects and calls `Target.attachToTarget` → **the *Allow* modal fires and the user clicks it.**
3. The daemon then tries `writeFileSync(portFile, …)` → throws `writeFileSync is not defined` → daemon process dies.
4. The parent never sees the port file → `Daemon failed to start — did you click Allow debugging?`
5. Next command re-spawns a fresh daemon → re-attaches → **the *Allow* modal fires again.**

So every action re-triggered the approval because the daemon could never persist. (The same missing import also broke `cdp.mjs list` outright.)

**Fix:** import `writeFileSync` from `fs`. The daemon now persists its port file, so the granted approval is reused across commands — **one click per tab**, as designed.

### Node 22+ required — 🟡 guard added

`cdp.mjs` uses the **global `WebSocket`**, available only on **Node 22+**. On Node ≤ 21 it previously failed with a cryptic `ReferenceError` deep inside `connect()`. It now exits early with a clear message:

```
cdp.mjs requires Node 22+ (built-in WebSocket); current runtime is v20.x.x.
Re-run under Node 22 or newer (e.g. `nvm use 22`, ...).
```

If a machine's default `node` is older (e.g. an nvm/Homebrew Node 20 on PATH) but a Node 22+ is installed, invoke `cdp.mjs` under that newer runtime.

### Per-tab approval is by design — the durable zero-click path is the extension

Even with the fixes above, Chrome re-prompts *Allow debugging* **per tab** — this is a Chromium security behavior `cdp.mjs` cannot eliminate. Mitigations:

- **Reuse one tab/daemon** for a multi-step flow; don't fan a task across tabs or needlessly re-`list`+re-attach. `list` is browser-level and never prompts.
- The daemon idle timeout is now **60 min** (was 20), configurable via `CDP_IDLE_TIMEOUT` (minutes). A longer-lived daemon means fewer re-approvals but holds a CDP session open longer — tear down with `cdp.mjs stop [target]`.
- **If repeated approvals annoy the user, abandon `cdp.mjs` and use Mode A (Playwright Bridge extension).** It is the only *truly* zero-click path after a one-time extension install — no per-tab modal, ever.

---

## Why we don't ship `browser-use` CLI 2.0

`browser-use` CLI 2.0 is an excellent tool for a Python-shop, Chrome-using, non-Microsoft user. It is the **wrong** answer for our context. The decisive issues:

| Issue | Status | Why it disqualifies for us |
|---|---|---|
| **Chrome-only by stated design** | Documented in release notes | The CLI uses CDP and is "Chrome/Chromium-specific. Safari and Firefox are not supported." Edge is undocumented and the channel=msedge path is historically buggy ([#3015](https://github.com/browser-use/browser-use/issues/3015)). Edge is our daily browser. |
| **#4796 — Auth0 `input_text` boolean-vs-int bug** | Open as of May 2026 | The CLI emits `{input_text: {index: true}}` (boolean) instead of integer on Auth0-style login pages. M365 SSO is Auth0-shaped — exactly our primary use case. |
| **#4763 — `data:`/`blob:` URLs bypass `allowed_domains`** | Open security issue | A tool that will run with our real M365 cookies and a documented domain allowlist that doesn't actually enforce. Non-trivial blast radius. |
| **#4783 — Azure OpenAI false positives** | Microsoft-employee-relevant | Azure OpenAI (the most-likely LLM backend for an MS employee) throws `ResponsibleAIPolicyViolation` content-policy false positives on browser-use's own system prompts. |
| **#4571 — CDP coordinate offset on Win HiDPI** | Open | Click coordinates are wrong on Surface / Win11 200%-scaling setups. Indicative polish gap. |
| **Cloud upsell aggressiveness** | Documentation pattern | Heavy steering toward `cloud.browser-use.com` (paid SaaS). Local-first story is real but commercial pressure is constant. |
| **Install footprint** | Documented | Python venv + Chromium + Go binary + optional Cloudflare tunnel binary. Heaviest of any candidate. |

> **Re-evaluation triggers (per `~/.copilot/research/browser-use-2026/v2-addendum-findings.md` §5.6):** Reconsider only if (a) first-class Edge channel support lands with `--browser=msedge`, AND (b) #4763 closes, AND (c) Auth0/SSO bugs (#4796) close. Until all three, the project is structurally wrong for this user.

---

## `attach --extension` hangs forever on a stale/wrong token — HIGH (solved)

**Verified live 2026-07-25.** `playwright-cli attach --extension=<session>` has **no timeout
flag** and **never validates the token itself**. Reading `coreBundle.js`, `attach` starts a
local WebSocket relay, spawns the browser at
`chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?mcpRelayUrl=…&token=<token>`,
then `await`s the extension's callback. Validation happens **inside the extension**
(`lib/ui/connect.js`: `if (token === expectedToken)`), and a mismatch just shows
*"Invalid token provided."* in a browser tab — so the CLI waits **forever with no output**.
That is the "the script got stuck" symptom, and it is easily misread as a slow attach.

**Root cause of mismatches.** The extension is installed **per browser profile**, and each
installation mints its own token, so a token is only valid for the profile that minted it.
Copying one profile's token over another's guarantees a permanent hang.

### The fix: read the token from the profile instead of guessing

The extension stores its own token in the extension page's `localStorage` under the key
`auth-token` (`lib/ui/authToken.js`), which Chromium persists in the profile's
`Local Storage/leveldb`. It is therefore readable from disk **without launching anything**.

`scripts/bridge-token.mjs` does exactly that:

```bash
node scripts/bridge-token.mjs list                    # every profile: name, account, token, status
node scripts/bridge-token.mjs check --session msedge  # exit 1 on drift
node scripts/bridge-token.mjs sync-all                # refresh one token file per profile
node scripts/bridge-token.mjs get --session msedge --raw   # for `export PLAYWRIGHT_MCP_EXTENSION_TOKEN=…`
```

Measured against the failure that motivated this work:

| Situation | Before | After |
|---|---|---|
| Stale/cross-profile token file | hang forever | **attaches anyway in ~1.1s** (profile token wins) |
| Session names a non-existent profile | hang forever | **fails in ~0.15s**, `profile-not-found` |
| Profile lacks the extension | hang forever | **fails in ~0.15s**, `extension-not-installed` |
| Enumerating all profiles + tokens | manual, per-profile consent dialog | **~0.11s**, no UI |

Implementation notes, if the extractor ever needs repair:

- localStorage records are keyed `_chrome-extension://<id>\0\x01auth-token`, but leveldb
  **prefix-compresses keys within a block**, so the origin and even part of the extension id
  can be truncated mid-string (observed: `mmlmfjhmonkocbjadbfpln\x0e\x80\x08Lgldckm`).
  Anchor on the stable `\0\x01auth-token` suffix, then confirm scope by looking **back** for
  a surviving id fragment — matching the full id fails.
- The value is a bare 43-char `[A-Za-z0-9_-]` run. Requiring the following byte to be outside
  that class rejects other origins' JSON `auth-token` values.
- Prefer scoped hits, then the newest file by mtime, then the latest offset (leveldb appends).

**Residual guidance.** Keep a bounded attach (`timeout 25 playwright-cli attach …`) as a
backstop for cases where the profile cannot be read, and never treat a hanging attach as
progress. Token files remain useful as a cache for tools that read
`PLAYWRIGHT_MCP_EXTENSION_TOKEN` from the environment; refresh them with `sync-all`. Two
files with identical contents still means one was overwritten (`md5 …/*.token`). Tokens are
43 characters, do not rotate on their own, and must never be committed.

---
