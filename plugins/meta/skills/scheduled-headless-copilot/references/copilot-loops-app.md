# Copilot Loops

Copilot Loops is the native macOS manager for automations created by the
`scheduled-headless-copilot` skill. It combines a menu-bar status surface with a full manager
for building, scheduling, monitoring, and reviewing headless Copilot and direct executable
tasks.

## Contents

- [What it manages](#what-it-manages)
- [Requirements](#requirements)
- [Build and install](#build-and-install)
- [Create a Copilot loop](#create-a-copilot-loop)
- [Create a script or executable loop](#create-a-script-or-executable-loop)
- [Schedules](#schedules)
- [Permission review](#permission-review)
- [Secrets](#secrets)
- [Monitor and control runs](#monitor-and-control-runs)
- [Managed files](#managed-files)
- [Update or uninstall](#update-or-uninstall)
- [Troubleshooting](#troubleshooting)
- [Limits](#limits)

## What it manages

Copilot Loops only lists and controls loops created through its own managed runtime. It does
not discover, import, or modify:

- arbitrary LaunchAgents
- tasks made by copying the manual `templates/runner.sh` workflow
- the separate `scheduled-skill-review` daemon or its menu-bar app

launchd owns scheduled execution. Closing Copilot Loops does not stop enabled loops. The app
provides configuration, status, history, controls, and best-effort notifications over the
durable local runtime.

## Requirements

- macOS 13 or later
- Swift 5.9 or later to build the source package
- Node.js 18 or later and GitHub Copilot CLI on `PATH`
- a logged-in GUI user session when LaunchAgents fire
- a working non-interactive Copilot login

Tasks that push with git or GitHub CLI also need non-interactive git credentials. Verify them
under a clean environment as described in
[`headless-invocation.md`](./headless-invocation.md).

## Build and install

From the `scheduled-headless-copilot` skill directory:

```bash
bash scripts/loops-install.sh
```

The installer:

1. builds and ad-hoc signs `CopilotLoops.app` and its Keychain helper
2. installs the app at `~/Applications/CopilotLoops.app`
3. copies the Node control and runner code to a stable managed runtime
4. writes the app LaunchAgent
5. starts the menu-bar app

The task LaunchAgents always reference the stable installed runtime. They never point into a
temporary plugin cache or Swift build directory.

### Local identity profile

Copilot Loops keeps durable bundle, LaunchAgent, task-label, and Keychain identities in:

```text
${COPILOT_LOOPS_HOME}/identity.json
```

When `COPILOT_LOOPS_HOME` is unset, the precise path is:

```text
~/.copilot/scheduled-tasks/copilot-loops/identity.json
```

The state-root environment override takes precedence over the default path. There is no
machine-wide or repository identity config, and individual identity fields cannot be
overridden by environment variables.

A genuinely new installation creates the public default profile:

```json
{
  "schemaVersion": 1,
  "profile": "default"
}
```

It derives the public `com.copilotplugins.copilot-loops` namespace. To preserve an existing installation
that used another namespace, create a private custom profile before installing or uninstalling:

```json
{
  "schemaVersion": 1,
  "profile": "custom",
  "namespace": "com.example.copilot-loops"
}
```

The namespace must contain at least three lowercase reverse-DNS segments. It derives:

- app bundle identifier: `<namespace>`
- app LaunchAgent label: `<namespace>.app`
- task LaunchAgent prefix: `<namespace>.task.`
- Keychain service: `<namespace>.secrets`

Unknown non-identity fields are retained because the installer never rewrites an existing
valid profile. An unknown profile, unsupported schema version, malformed JSON, or invalid
namespace fails visibly.

If app or state artifacts already exist but `identity.json` does not, install and uninstall
stop before changing anything. This is the bounded legacy-upgrade gate: create the custom
profile with the namespace already used by that installation, then retry. Copilot Loops does
not guess old identities, rename loaded services, migrate Keychain items, or delete data from
an unsupported namespace.

To rebuild an app bundle without installing it:

```bash
bash scripts/loops-build.sh
```

The command prints the resulting `.app` path.

## Create a Copilot loop

1. Open the manager from the infinity menu-bar item.
2. Choose **New loop**, then **Copilot**.
3. Enter a bounded, self-contained prompt.
4. Select an installed plugin for provenance if needed.
5. Select an agent and skill, or enter a model or agent manually.
6. Choose the working directory and any explicitly approved extra paths.
7. Set the schedule, timeout, retry, notification, and retention policies.
8. Review the exact redacted execution and capability summary.
9. Approve the fingerprint, then enable the loop.

Plugin selection records provenance and filters inventory. A local plugin directory is passed
to Copilot with `--plugin-dir`. An installed plugin name is not itself a CLI execution flag.

Copilot CLI has no `--skill` flag. A selected skill is validated against the inventory and
added to the prompt as an explicit instruction.

Copilot loops run prompt mode with `--autopilot` so unattended agents can continue bounded
multi-step work without waiting for interactive mode changes. The loop's outer timeout remains
the hard process limit.

The default **Full tool autonomy** profile maps to `--allow-all-tools`, not `--allow-all`.
Filesystem access remains limited to the working directory and approved extra paths, and URL
access remains subject to explicit custom allow/deny rules.

## Create a script or executable loop

Script mode never accepts a shell command string and never uses `sh -c`.

Choose one of:

- **Script file** — an absolute path to an executable file with a shebang, plus a discrete
  argument array.
- **Executable** — an absolute executable path plus a discrete argument array.

The permission review shows the exact executable, ordered arguments, working directory,
environment variable names, timeout, retry authority, and SHA-256 file hash. Changing any of
these fields invalidates approval.

Scripts execute with the user's authority and can do anything that user can do. Review the
path, content, arguments, environment, and schedule before enabling one.

## Schedules

Copilot Loops supports:

| Schedule | Behavior |
| --- | --- |
| Manual | Runs only when **Run now** or **Retry** is requested |
| One time | Runs once at a local date and time |
| Calendar | Runs at a local time every day or on selected weekdays |
| Interval | Runs every fixed number of seconds |

Calendar and one-time runs use a five-minute launch tolerance by default. A fire delayed
beyond that window, such as a laptop waking much later, is recorded as skipped rather than
running stale work.

Interval loops track their next expected time. A wake-delayed interval is skipped and starts
a fresh interval baseline.

If an earlier run still owns the loop lock, the new fire is recorded as an overlap skip. The
same applies when a previous run's process group could not be confirmed dead: that group is
recorded in the loop's live state, every later fire retries the bounded terminate-and-confirm
teardown first, and until it succeeds the fire is skipped (and surfaced as an issue) rather
than risking two overlapping runs. Retries are off by default.

macOS and launchd own local time and daylight-saving behavior. There is no timezone picker in
the first release.

## Permission review

A loop cannot be enabled until its current capability fingerprint is approved.

The review includes:

- prompt and model
- agent and skill selection
- working and extra paths
- tool and URL authority
- local plugin directories
- executable and ordered arguments
- plain environment names and Keychain secret names
- timeout and retry authority
- script or executable hashes

Capability-changing edits create `approval.blocked` before the new manifest is written. The
existing task is prevented from starting new work, and the runner independently rejects a
missing or mismatched fingerprint.

Renaming a loop, changing its schedule, notification choices, or retention does not require
new approval.

## Secrets

Secret values are stored in the login Keychain by the bundled `CopilotLoopsSecrets` helper.
They are never written to:

- `loop.json`
- task plists
- process arguments
- events or run records
- retained stdout, stderr, or Copilot JSON output

Only secret names appear in the manifest and permission review. Copilot runs pass all
injected secret names through `--secret-env-vars`.

A Keychain read that fails, times out, or requires interaction becomes an actionable
`launchFailed` result. The runner never falls back to plaintext storage.

Use plain environment values only for values that are safe to retain in `loop.json`.

## Monitor and control runs

The menu-bar popover shows aggregate running, failed, attention, and next-run state. Open the
manager for:

- Dashboard activity and upcoming runs
- week and list schedule views
- live stage and log tailing
- run history and retry lineage
- Stop, Run now, Retry, Pause, Resume, Archive, and Purge controls
- runtime, Copilot, notification, and LaunchAgent diagnostics

**Pause** keeps the task service loaded. Scheduled fires record a paused skip; an explicit
manual request may still run the paused loop.

**Archive** boots out the task LaunchAgent and removes its plist while preserving its
definition and history.

**Purge** is a separate confirmed action that removes the definition, history, LaunchAgent,
and associated Keychain items.

## Managed files

```text
~/Applications/CopilotLoops.app
~/Library/LaunchAgents/<namespace>.app.plist
~/Library/LaunchAgents/<namespace>.task.<loop-id>.plist

~/.copilot/scheduled-tasks/copilot-loops/
  identity.json
  runtime.json
  settings.json
  runtime/
  tasks/<loop-id>/
    loop.json
    state.json
    approval.blocked
    active.lock/
    manual-request.json
    generated.plist.sha256
    runs/<run-id>/
      run.json
      events.jsonl
      stdout.log
      stderr.log
      copilot.jsonl
      cli-logs/
  user-templates/
```

Replace `com.copilotplugins.copilot-loops` with the namespace in `identity.json` when using a custom
profile.

All JSON state mutations use a temporary sibling file and atomic rename. Run history remains
local.

## Update or uninstall

Run the installer again to rebuild the app, replace the stable runtime, and reload the app
LaunchAgent:

```bash
bash scripts/loops-install.sh
```

Normal uninstall removes the app, installed runtime, app LaunchAgent, and task LaunchAgents,
but preserves the identity profile, loop definitions, and history:

```bash
bash scripts/loops-uninstall.sh
```

Confirmed purge also removes preserved definitions, history, and the loops' Keychain items:

```bash
bash scripts/loops-uninstall.sh --purge
```

Purge uses only the configured namespace's task labels and Keychain service. It does not scan
for or remove data belonging to another or unsupported namespace.

## Troubleshooting

### The menu-bar item does not appear

Re-run the installer, then inspect:

```bash
launchctl print "gui/$(id -u)/com.copilotplugins.copilot-loops.app"
tail -n 100 ~/.copilot/scheduled-tasks/copilot-loops/logs/app.err.log
```

### A loop says launch failed

Open **Settings** and run diagnostics. Check:

- Node and `copilot` resolve under the displayed launchd `PATH`
- the working directory and executable still exist
- the Keychain helper can read every declared secret without interaction
- Copilot login is valid under a clean environment

### A loop needs review after an edit

The edit changed execution authority. Open the loop, inspect the new capability summary, and
approve its new fingerprint. Do not remove `approval.blocked` manually.

### A task was skipped after wake

The fire was outside its launch tolerance. This is expected stale-work protection. Use **Run
now** if the work is still wanted.

### Notifications do not arrive

Notifications are best effort and require:

- notification permission for Copilot Loops
- **Notifications** enabled in Settings
- the menu-bar app running when a terminal run transition is observed

Task execution and history do not depend on notification delivery.

## Limits

- macOS only for the native app; the manual skill procedure remains cross-platform.
- LaunchAgents run only while the user has a logged-in GUI session.
- No adoption of external LaunchAgents or legacy manual tasks.
- No cron expression editor; v1 uses manual, one-time, weekday/calendar, and interval forms.
- No automatic retries unless configured on the loop.
- No signed download, notarization, App Store distribution, or automatic updater.
- No cloud synchronization; definitions, secrets, logs, and history stay on the Mac.
