# Explicit existing-profile fallback

Read only when the user requests an existing normal browser profile or native
activity. Do not select this path to bypass a managed launch or sign-in failure.
Native activity requires the user to explicitly choose an existing profile.

## Start

The selected profile needs the
[Playwright Bridge extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm).
The helper resolves its token internally. Never print, paste, or copy tokens
between profiles.

```bash
node scripts/bridge-token.mjs list --browser chrome
node scripts/browser-window.mjs start --browser chrome --profile "Work"
```

Edge is the default. `--profile` accepts an exact displayed/directory name or a
unique displayed-name/account prefix. Ambiguous selectors fail closed; choose
a unique name or exact directory from the list. Omitting `--profile` creates a
fresh managed profile, not the last-used normal profile.

Pages are active by default. For real native visibility and focus:

```bash
node scripts/browser-window.mjs start --profile "Default" --activity native
```

Active fallback requires CLI 0.1.19 and core `1.63.0-alpha-2026-08-31`.
Its private compatibility adapter checks the exact runtime shape and enables
only Chromium's native focus initialization in memory. It does not modify
installed packages, open debug ports, or change other Playwright defaults.
Other cores fail closed or require explicit native mode. Native mode does not
load the adapter. Managed launch never loads it.

## Work and sign in

Start creates a new dedicated window in the selected normal profile. It returns
a unique `session` but no `cwd`; keep the original launch directory. Pass
`-s=<session>` to ordinary CLI commands.

The profile keeps its existing cookies and accounts. Verify the intended account
and protected app readiness. Ask if identity is ambiguous; never silently switch
profiles. Complete user-required challenges in the same session and tab.

## Isolation and attachment

The helper creates a one-time marker page, targets the exact native window,
then briefly foregrounds it for Bridge attachment. The profile launcher forces
the connect page into the selected profile.

It verifies that Playwright sees only the Welcome page, binds it to the tracked
native window, then replaces credential-bearing pages with one safe blank page.
This does not erase profile history. The helper restores the previous foreground
and checks background visibility/focus before reporting active-mode success.

Concurrent starts serialize this handshake. Established sessions use separate
windows; they may share the explicitly selected normal profile. Never attach
to user-existing windows or weaken scope/identity checks.

## Close

```bash
node "<browser-skill>/scripts/browser-window.mjs" close --session <session>
```

The helper validates and closes only the marked native window, verifies absence,
detaches best-effort, and removes state. Repeated close is safe.

On macOS, keep the internal marker tab open until cleanup; Playwright cannot see
it. If it is lost, confirm the visible window is the dedicated agent window
before closing it manually. If unsure, leave it open. Rerun `close` once the
recorded window is absent. Never close an identity-mismatched window.

See [known issues](known-issues.md) for token, attachment, marker, and cleanup
failures.
