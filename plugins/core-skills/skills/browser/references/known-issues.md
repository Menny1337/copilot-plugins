# Dedicated browser window: known issues

## Contents

- [Error lookup](#error-lookup)
- [Managed primary path](#managed-primary-path)
- [Existing-profile Bridge fallback](#explicit-existing-profile-bridge-fallback)
- [Tokens](#attach-hangs-on-a-stale-or-wrong-token)
- [Foreground targeting](#foreground-targeting-is-brief-but-required)
- [Background activity](#active-pages-in-a-background-window)
- [Concurrency](#concurrent-agents)
- [Page isolation](#playwright-sees-only-its-own-pages)
- [Native closure](#detach-and-tab-close-do-not-close-the-native-window)
- [Window identity](#native-window-identifiers-can-be-reused)
- [Already-closed windows](#user-closes-the-window-first)
- [macOS permissions](#macos-permission)
- [macOS discovery](#macos-startup-discovery-races)
- [Failure cleanup](#startup-failure-cleanup)
- [Account prompts](#account-prompts)

## Error lookup

Correct the cause before retrying. Never retry-loop, adopt another session,
kill by process name, or infer native closure from missing CLI state.

### Managed launch and shared errors

| Error | Action |
| --- | --- |
| `managed-config-conflict` | Resolve global CLI configuration scope explicitly; do not silently ignore or modify it. |
| `managed-native-unsupported` | Native needs an explicitly requested `--profile <name> --activity native` Bridge session. No profile was allocated. |
| `foreground-browser` | Put a stable non-browser app in front before starting. |
| `foreground-unavailable` | Resolve native observation or permission failure. No browser was launched. |
| `ownership-unverified`, `owned-launch-failed` | Inspect retained profile and cleanup status; missing sockets do not prove shutdown. |
| `owned-identity-mismatch`, `owned-close-failed` | Preserve state; never close another identity or use browser-wide cleanup. |
| `foreground-interrupted` | Startup observed another foreground identity. Resolve the interference; do not force focus repeatedly. |
| `session-exists` | Choose a new name. Managed names remain reserved after close. |
| `invalid-activity` | Use `active` or `native` on `start` only; managed mode supports active only. |
| `startup-busy` | Another start owns the short handshake lock. Wait a few seconds. |
| `session-busy` | A same-session start/close exceeded the bounded lock wait. Resolve its owner before retrying. |

### Existing-profile fallback errors

| Error | Action |
| --- | --- |
| `activity-unsupported` | Update and verify the adapter, or explicitly choose native mode. Never patch global dependencies or silently change activity. |
| `activity-verification-failed` | Fresh-page activity did not match. Startup attempted exact-window cleanup; inspect its result. |
| `activity-verification-interrupted` | Foreground changed during verification; background behavior was not proven. Let it settle. |
| `foreground-restore-failed` | Previous foreground could not be restored. Inspect startup cleanup. |
| `bridge-token-unavailable` | Enable the extension in the selected profile and open it once to create a token. Check `bridge-token.mjs list`. |
| `profile-not-found`, `profile-ambiguous` | Select a unique displayed name or exact directory from `bridge-token.mjs list`. |
| `extension-not-installed` | Install the Bridge extension in the selected profile. |
| `invalid-profile` | Remove path separators, control characters, or bare `.` / `..`. |
| `attach-timeout` | Inspect `playwright-cli list` and cleanup. Retry once only after correcting token/extension state. |
| `scope-verification-failed` | Stop: Playwright exposed more than the Welcome page. Isolation was not proven. |
| `scope-sanitization-failed` | Stop: the credential-bearing Welcome URL could not be replaced. |
| `attachment-target-lost` | Foreground identity differed after attach. External interruption or native targeting/timing may be responsible; do not assume user action or successful cleanup. |
| `attachment-binding-failed` | The marker page could not be proven to belong to the tracked native window. |
| `window-mark-failed` | Exact cleanup identity could not be marked. Inspect startup diagnostics. |
| `native-connection-invalid` | Read-only macOS discovery still failed with `-609` after bounded recovery. Preserve `details.startupWindow`; an unidentified window may remain. |
| `window-not-created` | No single marker-matched window was identified. Preserve `details.startupWindow`; resolve possible residue before another start. |
| `window-marker-missing` | Follow the [marker recovery rules](#native-window-identifiers-can-be-reused); never guess which window to close. |
| `window-identity-mismatch` | Do not close the window. Preserve state and ask before manual cleanup. |

## Managed primary path

Each task gets a fresh profile and private CLI workspace. Run every CLI and site-driver
command from the returned `cwd`, with its explicit session name. A new task never reuses
a retained profile. Close retains profile data and the ownership record intentionally.
No Bridge token, native-window marker, profile launcher preload or private activity
adaptation is used on this path.

Owned `tab-new`/`tab-select` may activate the browser at the OS level. This is an accepted
ordinary-CLI limitation, separate from active page focus emulation. Prefer one working tab;
navigation and reload need no foreground restoration. Do not add a focus loop or claim a
background sample while the browser is actually foreground.

`managed-config-conflict` rejects a global CLI configuration rather than inheriting an
unexpected endpoint or launch override. No configuration is changed. Managed launch also
strips inherited MCP transport, CLI session, testing and Node preload variables from its
own CLI child environment.

Owned Chromium enables native focus emulation; managed sessions support active mode only.
`start --activity native` fails before launch/profile allocation. Native needs an explicit
existing-profile request: `start --profile <name> --activity native`, using Bridge.
A separate public CDP focus-disable session did not meet native startup/readback and renderer
replacement guarantees. That rejected hook is not shipped. No hidden fallback or getter
replacement is used.

Owned close verifies process identity and waits for native process absence. It cannot
close a different profile or reused PID. A startup error reports `cleanupVerified`; when
false, keep the retained state and report the incomplete cleanup. Never claim that absence
of a CLI socket alone proves browser shutdown.

## Explicit existing-profile Bridge fallback

The following sections cover a normal Edge or Chrome window created
by `browser-window.mjs`, attached through the Playwright Bridge extension, and driven with
ordinary `playwright-cli`. Select it only with an explicitly requested `--profile`.

## Attach hangs on a stale or wrong token

`playwright-cli attach --extension` validates the token inside the browser extension and has
no useful wrong-token response. A mismatch can otherwise wait indefinitely.

The lifecycle helper prevents that failure in two ways:

1. `bridge-token.mjs` reads the token held by the selected browser profile instead of
   guessing or trusting a stale cache.
2. A bundled launcher forces Playwright's Bridge connect page into the selected profile
   instead of letting Playwright independently choose the browser's last-used profile.
3. The attach subprocess has a 25-second timeout and fail-closed cleanup.

Never print a token in diagnostics. Never copy one browser/profile token over another.

## Foreground targeting is brief but required

The Bridge extension attaches to the foreground browser window and offers no native window-ID
argument. The helper therefore:

1. records the user's foreground window
2. creates and identifies one new browser window
3. marks and foregrounds that exact native window
4. attaches, checks the foreground identity, and stamps the verified Welcome page title
5. verifies that title on the recorded native window, then restores focus

Do not remove the post-focus identity check. Without it, concurrent user activity can route the
Bridge to the wrong window.

## Active pages in a background window

`start` defaults to `--activity active`. The current adapter supports CLI 0.1.19 with
`playwright-core` `1.63.0-alpha-2026-08-31`, on the existing macOS/Windows Edge/Chrome path.
The compatibility guard alone does not prove live background behavior for a browser/OS
combination; confirm native foreground and page activity together.

The Bridge connection uses `noDefaults: true`, which skips Playwright's native focus
initialization. The profile launcher preload checks the resolved core package version and
one exact initialization block before adapting that block in memory. It enables
`Emulation.setFocusEmulationEnabled` on the existing authorized main-frame session.
Other `noDefaults` behavior stays unchanged. This is a private runtime compatibility boundary,
not an upstream supported focus API. No installed package is written or copied.

The helper restores the prior foreground window and reads the fresh page's native visibility
and focus before returning success. `activity-verification-interrupted` means foreground
changed during that check, not that focus emulation failed. Do not count
a foreground browser as proof that background emulation works. If another agent is starting
a browser or the user is switching applications, allow the foreground to settle before a
new attempt. Do not force focus repeatedly during automation.

`activity-unsupported` means the version or initialization shape is unverified, not that
the extension needs more permissions. Use `start --profile <name> --activity native` to retain real
visibility/focus, or update and verify the adapter. Do not bypass the guard, spoof DOM
getters, open DevTools manually, expose a debug port, or replace the Bridge transport.

Native focus emulation does not promise faster HTML loads or backend telemetry ingestion.
It changes page activity signals only.

## Concurrent agents

Each start generates a unique Playwright session and native window. A cross-process lock
serializes only the create/identify/focus/attach handshake because those operations depend on
global foreground state. Start claims its per-session lock before waiting for that global
handshake lock, so once startup owns the session, a close cannot overtake it while it waits.
Established sessions and closes for different sessions run concurrently.

An explicit session-name collision fails. Do not reuse another agent's session.
Close waits for an in-progress start holding the same session lock. The wait is bounded so a
stale-but-parseable lock cannot hang cleanup forever; `session-busy` means the owning process
did not finish within that recovery window.

## Playwright sees only its own pages

Immediately after attach, the helper privately verifies that Playwright exposes exactly the
Bridge Welcome page. Because that URL contains the Bridge token, the helper opens a fresh
`about:blank` tab, closes the Welcome and binding tabs, and verifies that normal `tab-list`
output can no longer reveal the credential before returning. The browser profile may retain
ordinary recently-closed/history metadata; do not describe sanitization as profile-history
deletion. Pages created later belong to that session; the user's existing pages remain hidden.

If scope verification fails, the helper closes the new window and returns
`scope-verification-failed`. Do not continue.

## `detach` and `tab-close` do not close the native window

The original local marker tab is not exposed to Playwright. Closing every visible Playwright
tab can therefore leave the created window open.

Always finish with:

```bash
node scripts/browser-window.mjs close --session <session>
```

The helper closes and verifies the recorded native window first, then detaches and removes
state. Do not claim cleanup from Playwright output alone.

## Native window identifiers can be reused

A user may close the agent window before cleanup, and an OS can later reuse its numeric
identifier. Windows state therefore includes HWND, process ID, and a per-window User32 marker.
macOS requires the window ID, browser process ID, and the original marker tab URL. Leave the
marker tab open until cleanup; recreating it automatically could authenticate a reused
user-owned window.

When identity validation fails, cleanup refuses to act and preserves state. Never fall back to
closing a window by title, index, current focus, or process name.

If macOS returns `window-marker-missing`, the marker tab may have been closed or the numeric
window ID may belong to a replacement window. Confirm the visible window is the dedicated agent
window before closing it manually; if unsure, leave it open. Then rerun
`browser-window.mjs close --session <session>`. Once the recorded window is absent, the helper
detaches Playwright and removes the retained state without closing any other window.

## User closes the window first

`close` is idempotent. If the tracked window no longer exists, the helper detaches the matching
Playwright session, removes state, and reports `alreadyClosed: true`.

If the identifier exists but no longer matches, it is not treated as already closed; see the
reuse rule above.

## macOS permission

Exact window focus and closure use macOS Automation/Accessibility access. The first run may
show a one-time OS prompt. If permission is denied, targeting fails closed.

Do not replace exact targeting with `open`, `activate`, or closing the front window without an
ID check.

## macOS startup discovery races

Chromium can reorder native windows while a new window opens. AppleScript window-index
references are live, so separate title and ID reads can refer to different windows or repeat
an ID. Discovery takes one native property snapshot instead. Marker validation addresses the
recorded window ID directly and takes a snapshot of its tab URLs.

An Apple event can also fail with `Connection is invalid. (-609)` during discovery. Only
this numbered error from the read-only window-list operation is retried, at most twice,
100 ms apart. The helper does not relaunch the browser or repeat native actions. Persistent
failure returns `native-connection-invalid`; permission errors and other native failures are
not retried. A successful later run does not establish the cause of an earlier transient
connection failure.

If launch was attempted but ownership was never established, the error includes
`details.startupWindow` with the session, browser, and non-secret random marker. Preserve it
for diagnosis. It is not a tracked native identity and does not authorize window closure.
No ready-session state exists in this case, and `close` returning `alreadyClosed` does not
prove that no unidentified native window remains. Do not retry startup until that uncertainty
has been resolved.

## Startup failure cleanup

After a new window has been identified, any later start failure attempts to:

1. detach the generated Playwright session
2. validate and close only the recorded native window
3. verify closure
4. remove state only after successful cleanup
5. restore the user's prior foreground window

If cleanup itself fails, the error includes `cleanupError` and state remains available for
diagnosis.

## Account prompts

The fallback explicitly opens the profile whose Bridge token it resolved, selected with
`--profile`. That profile inherits
its cookies and connected site accounts. If the site shows an account picker, select the
account implied by the request; if context is unclear, ask rather than switching identities.

Ask only for MFA, CAPTCHA, passkey/security-key checks, or an authorization decision that
cannot be completed automatically.
