# Default connection details

## Setup and compatibility

Requires Windows or macOS and Edge or Chrome. If the CLI is missing, install it:

```bash
npm install -g @playwright/cli@0.1.19
```

The current validation target is CLI 0.1.19 with core
`1.63.0-alpha-2026-08-31`. Verify behavior on other versions.
The CLI reuses Playwright's browser tool backend internally; this is not a
Bridge connection or an external MCP server.

A global `~/.playwright/cli.config.json` blocks managed launch. Resolve its scope
explicitly; the helper will not change it or inherit remote/launch overrides.

## Launch and ownership

To name a session explicitly:

```bash
node scripts/browser-window.mjs start --session agent-research
```

Success returns one JSON object:

```json
{"ok":true,"mode":"managed","session":"agent-msedge-<random>","browser":"msedge","activity":"active","cwd":"<private-task-directory>","profilePath":"<private-task-directory>/profile","profileRetained":true}
```

The helper locks the name, creates an exclusive profile and private CLI workspace,
then runs ordinary `open --persistent --headed --profile=<new-path>`.
Concurrent starts serialize launch/focus checks. Established sessions use
independent profiles and workspaces.

Public CDP captures the browser PID and process creation identity, not focus
behavior. Upstream Playwright initializes focus emulation. Pages report
`visibilityState: "visible"`, `hidden: false`, and `document.hasFocus(): true`
across navigation, reloads, and new tabs. No JavaScript getters are replaced.

Headed launch can briefly take focus. The native adapter restores the recorded
foreground once, only if the owned browser is still foreground, then verifies
background page activity. It does not activate windows repeatedly.

Ordinary `tab-new` and `tab-select` can activate the browser. Focus emulation
does not prevent OS activation. Prefer one tab; no forwarding wrapper is used.
For background checks after creating a tab, wait for the user to return to
their app and label this as manual assistance.

Managed mode supports active pages only. `start --activity native` rejects
before allocating a profile. A separate public CDP focus-disable session could
not preserve native behavior across Playwright initialization and renderer
replacement. That prototype is not shipped. Use the
[explicit existing-profile fallback](existing-profile.md) when requested.

Close verifies CLI profile ownership and process creation identity, then waits
for native process absence. It refuses mismatched sessions or reused PIDs.
Profiles and ownership records remain; session names stay reserved after close.
Startup errors report `cleanupVerified`. Preserve unresolved state and report
incomplete cleanup.

## Command lookup

Use `playwright-cli -s=<session> tab-list` for pages and `playwright-cli list`
for running sessions. There is no helper `status` command.

| Purpose | Commands |
| --- | --- |
| Read | `snapshot`, `screenshot`, `eval`, `console`, `requests`, `request`, `response-body` |
| Interact | `click`, `fill`, `type`, `press`, `hover`, `select`, `check`, `drag`, `upload` |
| Navigate | `goto`, `tab-list`, `tab-new`, `tab-select`, `tab-close` |
| Storage | `cookie-*`, `localstorage-*`, `sessionstorage-*`, `state-save`, `state-load` |
| Network | `route`, `route-list`, `unroute`, `network-state-set` |
| Diagnose | `tracing-start`, `tracing-stop`, `video-start`, `video-stop`, `pdf` |

Run `playwright-cli <command> --help` for syntax. Command availability does not
authorize exporting credentials or other sensitive state.

## Implementation map

| Script | Responsibility |
| --- | --- |
| `browser-window.mjs` | Lifecycle entry point and fallback routing |
| `browser-managed.mjs` | Fresh profiles, ownership, shutdown |
| `browser-managed-owner.cjs` | Public CDP ownership capture |
| `browser-activity.cjs` | Bridge-only focus compatibility |
| `bridge-token.mjs` | Bridge-only profile/token resolution |
| `owa-compose.mjs` | Outlook operations on an existing lifecycle session |
