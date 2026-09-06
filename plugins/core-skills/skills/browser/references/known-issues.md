# Dedicated browser window: known issues

This reference covers the only supported browser path: a normal Edge or Chrome window created
by `browser-window.mjs`, attached through the Playwright Bridge extension, and driven with
ordinary `playwright-cli`.

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

The helper explicitly opens the profile whose Bridge token it resolved. It uses the browser's
last-used profile by default, or the profile selected with `--profile`. That profile inherits
its cookies and connected site accounts. If the site shows an account picker, select the
account implied by the request; if context is unclear, try the first saved account.

Ask only for MFA, CAPTCHA, passkey/security-key checks, or an authorization decision that
cannot be completed automatically.
