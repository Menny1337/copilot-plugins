# Setup — scheduling the autonomous review daemon (macOS `launchd`)

This wires the daemon to run at a fixed hour daily, deploy validated changes, and
survive logout/login. All durable state lives in the workspace
`~/.copilot/agent-architect/skill-reviews/`.

> Paths below use a placeholder `REPO=…`. Replace it with the absolute path to your
> checkout of this repository (the **git working tree** the daemon commits/pushes
> from — the plugin cache is read-only and must not be used as `repoDir`).
>
> **Use a dedicated checkout for `repoDir`.** The daemon does `git checkout main`,
> `git merge`, and hard resets to the configured remote/default branch during integration —
> any uncommitted work there would be clobbered. Point `repoDir` at a clone reserved
> for the daemon (e.g. `~/.copilot/agent-architect/checkout`), not the checkout you
> edit by hand. The `scripts/` and `references/` the daemon runs are read from this
> same checkout, so keep it on `main` and current.

```sh
REPO="/ABSOLUTE/PATH/TO/CHECKOUT"   # adjust to your dedicated daemon checkout
SKILL="$REPO/plugins/meta/skills/scheduled-skill-review"
WS="$HOME/.copilot/agent-architect/skill-reviews"
```

## 1. One-time prerequisites

- **Node** (for the `.mjs` scripts), **sqlite3** (for expiring cross-process
  refresh/settings leases), and **bash 3.2+** (the stock macOS shell — the scripts
  avoid `wait -n` and other bash 4 features). macOS includes `sqlite3`.
- **Agency + Copilot CLI** on `PATH` for the headless orchestrator.
- **Copilot plugin refresh**: set `marketplaceName` in `config.json` to the local
  marketplace alias you want refreshed. The daemon refreshes that catalog and updates
  only plugins installed from that marketplace. If omitted, it retains the legacy
  `copilot plugin update --all` behavior. Registered GitHub marketplaces use normal
  system Git because Copilot CLI 1.0.70+ disables credential helpers inside its own
  marketplace clone.
- **Native menu-bar app** (optional but recommended — this is the badge you
  watch the daemon from): build and autostart it with `bash "$SKILL/scripts/menubar-install.sh"`
  (see `menubar.md`). It installs the separate LaunchAgent
  `com.copilotplugins.skill-review.menubar`.
- **terminal-notifier** for *clickable* notifications (optional): `brew install
  terminal-notifier`. When present, the end-of-run notification opens the latest
  digest on click; without it the daemon falls back to a plain `osascript`
  notification (not clickable — clicking it just opens Script Editor). On first use,
  allow it under System Settings → Notifications → terminal-notifier.

## 2. Configure

Create/edit `$WS/config.json`. Only `repoDir` is strictly required; everything else
falls back to `DEFAULT_CONFIG` in `scripts/lib.mjs`.

```json
{
  "enabled": true,
  "schedule": { "hour": 3, "minute": 0 },
  "concurrency": 2,
  "autoDeploy": true,
  "autoRevert": true,
  "deployMode": "auto",
  "autoMergeUnits": [],
  "prUnits": [],
  "revertDeployMode": "auto",
  "include": [],
  "exclude": [],
  "skillPaths": [],
  "skillFolders": [],
  "signalThreshold": 3,
  "observationWindowDays": 3,
  "firstRunLookbackDays": 7,
  "maxFirstRunSessions": 200,
  "repoDir": "/ABSOLUTE/PATH/TO/CHECKOUT",
  "pluginDir": "/ABSOLUTE/PATH/TO/CHECKOUT/plugins/meta",
  "marketplaceName": "",
  "remoteName": "origin",
  "ghAccount": "",
  "notify": "auto"
}
```

Set `marketplaceName` to your local Copilot marketplace alias if you want the daemon
to refresh the marketplace catalog and update only that marketplace's installed
plugins. The alias must exist in `$COPILOT_HOME/settings.json`; that registration supplies the GitHub
`owner/repo` used for the first system-Git refresh. The helper then re-registers
the checkout as a local marketplace and updates only installed plugins belonging
to that marketplace, avoiding unrelated private-marketplace failures. It stores
the credential-free origin URL and coordination locks under
`$COPILOT_HOME/marketplace-state/`, so launchers and daemons share recovery state
even when `COPILOT_CACHE_HOME` is customized. A later cache eviction can therefore
be re-cloned even though Copilot now sees a local source. Full Git URL marketplace
sources use the same system-Git path.

`include` (allowlist) and `exclude` (denylist) take **bare** unit names
(`memory`, `agent-architect`). Manage them live with `daemon-ctl.sh include/exclude`.

`skillPaths` contains absolute paths to individual external `SKILL.md` files.
`skillFolders` contains persistent folder roots. Each root contributes a
`SKILL.md` in the root itself, when present, plus every `SKILL.md` in an immediate
child directory; deeper descendants are not scanned. Folder roots are rediscovered
on each catalog/scan run, so newly added child skills need no config change.

Prefer adding both source types from the native Settings window's **Add** menu.
The individual-file picker starts in `~/.copilot`; the folder picker starts in
`~/.copilot/skills` when it exists. Both can navigate anywhere on the machine.
External names must be kebab-case and globally unique across reviewed skills and
agents because lifecycle and policy controls use bare unit names. The daemon
copies only each selected/discovered `SKILL.md` into a private staging directory
(never neighboring files), then applies the validated file back in place if the
original did not change concurrently or resolve to a different target. Removing
an external source also prevents its old lifecycle cycle from being routed to a
marketplace unit with the same name. External review does not commit, push, open
a PR, version a plugin, or perform automatic git rollback.

## 3. Headless git-push authentication (the autoDeploy blocker)

`launchd` jobs run without your interactive shell/keychain, so pushing to GitHub must
work non-interactively. Pick **one**:

- **gh credential helper (recommended):** `gh auth login` once, then
  `gh auth setup-git`. Confirm under launchd-like conditions:
  `env -i HOME="$HOME" PATH="$PATH" git -C "$REPO" push --dry-run`.
- **SSH remote + key in the agent:** switch the remote to `git@github.com:…`, add the
  key with `ssh-add --apple-use-keychain`, and ensure `IdentityFile` is set in
  `~/.ssh/config` (launchd can't prompt for a passphrase).
- **PAT in `~/.netrc`** (least preferred): `machine github.com login <user> password
  <PAT>` with `chmod 600`.

If push fails at runtime the daemon **does not leave a half-deploy**: it
hard-resets the merge to the configured remote/default branch, keeps the proposal
branch, and notifies.

### gh active-account pinning (PR creation & reconcile)

Opening PRs and reconciling merges go through the `gh` CLI, which keeps **one
global active account** independent of git's push credentials. If you switch the
active account (`gh auth switch`, e.g. to a work account) the daemon's `gh pr
create`/`gh pr view` calls fail with `Could not resolve to a Repository` while
`git push` keeps working — so review branches upload but no PR opens.

The daemon guards against this automatically: before any PR/reconcile work it
resolves the repo owner's stored token and exports `GH_TOKEN` for that run only,
so it works **regardless** of the global active account and never changes your
interactive selection. The owner is parsed from the remote URL by default; set
`ghAccount` in `config.json` to force a specific gh account. The account must be
logged in (`gh auth login --user <owner>`); otherwise the daemon logs a clear
warning and PR steps are skipped.

## 3a. Per-unit deploy policy (auto-merge vs. review PR)

`autoDeploy` is the master switch: when `false` the daemon never merges, opens PRs,
or applies a staged external edit — a no-side-effects test mode. When `true`, each
passing marketplace change is routed per unit:

- **`deployMode`** (`"auto"` | `"pr"`) — the default for any unit not named in a list.
  `auto` merges straight to `main` + pushes + plugin refresh; `pr` opens a GitHub PR and
  leaves the cycle in `pr` (awaiting your review) instead of deploying.
- **`autoMergeUnits[]`** — units pinned to fully-autonomous auto-merge regardless of
  `deployMode`.
- **`prUnits[]`** — units pinned to PR-for-review regardless of `deployMode`.
  `prUnits` wins over `autoMergeUnits` if a name is (mistakenly) in both.
- **`revertDeployMode`** (`"auto"` | `"pr"` | `"unit"`) — how regression **reverts** are
  deployed. Defaults to `"auto"` so a safety revert fast-paths to `main` even for
  pr-mode units; set `"unit"` to make reverts follow each unit's normal policy.

External skills always use the explicit in-place path described above; marketplace
deploy-policy and revert-policy pins do not apply to them.

Manage these live (writes `config.json`, no restart needed):

```sh
./scripts/daemon-ctl.sh deploy-default auto      # or: pr
./scripts/daemon-ctl.sh auto-merge <unit>        # pin unit to auto-merge
./scripts/daemon-ctl.sh review-pr  <unit>        # pin unit to review-PR
./scripts/daemon-ctl.sh unset      <unit>        # clear unit's pin (back to default)
```

When a PR is opened the cycle holds `status=pr` with `prUrl`/`prNumber`. On the next
run the daemon **reconciles** open PRs via `gh`: a **merged** PR flips the unit to
`deployed` (using the PR's `mergedAt`, which starts the post-deploy observation
window) and runs the plugin refresh; a **closed-unmerged** PR closes the cycle; an **open**
PR is left untouched. The menu bar lists open PRs with a click-through to GitHub, and
the digest reports "PRs opened for review" with their URLs.

## 4. The orchestrator invocation

`launchd` runs `scripts/run-batch-review.sh`, which performs scan → select →
per-unit worktree review → serialized integrate/deploy → digest → watermark → notify.
Each per-unit review is a headless subprocess resolved through Agency:

```sh
agency copilot \
  --no-config-plugins \
  --plugin "local:$PLUGIN_DIR" \
  --agent meta:agent-architect \
  -p "run skill-improvement-loop on <unit> … (COPILOT_PLUGIN_SCHEDULED_REVIEW)" \
  --disable-mcp-server computer-use \
  --allow-all-tools
```

The per-unit subprocess runs with the worktree as its working directory (the
orchestrator `cd`s into it first). `--plugin local:<path>` loads the plugin root
from `config.pluginDir` (defaulting to the plugin containing these scripts);
`--agent meta:agent-architect` selects the agent
(plugin:agent syntax); `-p` passes the prompt; `--allow-all-tools` is forwarded to
the underlying Copilot CLI for non-interactive execution.

`--no-config-plugins` isolates the review from plugins discovered through ambient
Agency configuration. User-level Copilot settings are separate, so
`--disable-mcp-server computer-use` also excludes a globally enabled desktop
automation server. Scheduled reviews do not control local applications and should
not require macOS Accessibility or Screen Recording permission. Without this
exclusion, loading `computer-use` can request Accessibility again after an Agency
update because `~/.config/agency/CurrentVersion` resolves to a new versioned
executable path that macOS treats as a distinct permission subject.

After applying this fix, remove obsolete `agency` rows once from System Settings →
Privacy & Security → Accessibility. Remove them manually rather than running a
broad `tccutil reset Accessibility`, which would also revoke unrelated
applications.

The `COPILOT_PLUGIN_SCHEDULED_REVIEW` marker (configurable as `selfMarker`) is embedded so
`scan-usage.mjs` excludes the daemon's own sessions on the next run.

## 5. Install the launchd agent

Save as `~/Library/LaunchAgents/com.example.skill-review.plist` (edit the two absolute
paths and the hour to match your config):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.skill-review</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/ABSOLUTE/PATH/TO/CHECKOUT/plugins/meta/skills/scheduled-skill-review/scripts/run-batch-review.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/Users/USERNAME/.config/agency/CurrentVersion:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/USERNAME/.copilot/agent-architect/skill-reviews/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/USERNAME/.copilot/agent-architect/skill-reviews/logs/launchd.err.log</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
```

Load / unload:

```sh
mkdir -p "$WS/logs"
launchctl load   ~/Library/LaunchAgents/com.example.skill-review.plist   # enable
launchctl unload ~/Library/LaunchAgents/com.example.skill-review.plist   # HARD stop
launchctl list | grep com.example.skill-review                           # verify loaded
```

`StartCalendarInterval` fires at the next matching wall-clock time (and once on wake
if the machine was asleep at the scheduled moment). Set `Hour`/`Minute` to match
`config.schedule`.

**Run less often than daily.** `StartCalendarInterval` also accepts an **array** of
dicts, and a `Weekday` key (`0`/`7` = Sunday … `1` = Monday … `5` = Friday, `6` =
Saturday). For a weekday-only cadence (Mon–Fri at 18:00), replace the single dict with:

```xml
<key>StartCalendarInterval</key>
<array>
  <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
  <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
  <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
  <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
  <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
</array>
```

After editing, reload (`launchctl unload` then `load`) and confirm with
`launchctl print gui/$(id -u)/com.copilotplugins.skill-review`. launchd has no native
"every N days" calendar match, so weekdays is the clean way to thin out a daily
cadence. launchd remains the source of truth for *when* the job actually fires:
`daemon-ctl.sh status` reads this plist's `StartCalendarInterval` directly (via
`schedule.mjs`) to compute the menu-bar "next run", and the Settings window's
schedule editor (`config-set`) writes any change back into this plist and reloads
launchd — so `config.schedule` and the plist stay in sync automatically and you
don't have to hand-edit both. (`config.schedule` is the fallback the menu bar uses
only when no plist is installed.)

> **PATH must include the `agency` CLI.** launchd runs with a minimal PATH, and the
> `agency` CLI installs to `~/.config/agency/CurrentVersion` (outside the usual bin
> dirs). If that directory is missing from the plist's `PATH`, `run-batch-review.sh`
> can't find `agency` and every review silently degrades to a no-op stub. The script
> self-heals by probing `~/.config/agency` at runtime, but keep the dir in the plist
> `PATH` (as shown above) as the primary fix. `node` and `gh` resolve from
> `/opt/homebrew/bin`; `agency` resolves Copilot CLI internally, so `copilot` need
> not be on PATH.

## 6. Pause vs stop

- **Soft pause** (`daemon-ctl.sh pause` → `enabled=false`): the job still launches on
  schedule but no-ops after a heartbeat, so the menu bar shows "paused". Resume with
  `daemon-ctl.sh resume`.
- **Hard stop** (`launchctl unload …`): the job won't launch at all. Use this to fully
  disable; re-`load` to re-enable.
- An in-flight run is independent of pause; kill it by PID if needed
  (`kill <pid>` of the `run-batch-review.sh` process).

## 7. Dry run & first run

```sh
# read-only scan against your real session history (no git, no deploy)
node "$SKILL/scripts/scan-usage.mjs" --repo "$REPO"

# selection PREVIEW only — no durable side effects: no git worktrees/branches,
# no lifecycle cycles, no watermark/run-record mutation. Writes only run-local
# stub results + a digest so you can see which units WOULD be reviewed.
bash "$SKILL/scripts/run-batch-review.sh" --dry-run

# limit a real run to a single unit
bash "$SKILL/scripts/run-batch-review.sh" --only memory
```

The **first** real run has no watermark, so it looks back `firstRunLookbackDays` and
caps at `maxFirstRunSessions`; truncation is noted in the digest. Subsequent runs
resume from the event-time watermark `{timestamp, session_id, line}`.

## 8. Where to look

- Latest human-readable digest: `$WS/latest-digest.md` (and `runs/<runId>/digest.md`).
- Durable lifecycle records: `$WS/cycles.json`. Run/watermark state: `$WS/state.json`.
  Mutations to these are serialized across the concurrent review subprocesses by
  filesystem locks (`$WS/cycles.lock` / `$WS/state.lock`, atomic `mkdir` + owner
  token, stale-lock steal) so parallel `lifecycle.mjs` writes can't clobber each
  other (lost updates).
- Daemon log: `$WS/logs/daemon.log`; launchd stdio: `$WS/logs/launchd.{out,err}.log`.
- Git history on `main` is the deploy audit trail (each apply/revert is a commit).

## 9. Notifications & menu bar (how you actually watch it)

Two surfaces report the daemon's activity; both are optional installs from §1.

- **Menu bar (native app):** `scripts/menubar-install.sh` builds the self-built
  `SkillReviewMenuBar` SwiftUI `MenuBarExtra` app, installs it at
  `~/Applications/SkillReviewMenuBar.app`, and loads the autostart LaunchAgent
  `com.copilotplugins.skill-review.menubar`. This LaunchAgent is distinct from the scheduler
  job `com.copilotplugins.skill-review`. The icon shows state at a glance (green = re-reviews
  due · purple = reviewing now · blue = PRs awaiting merge · amber = paused · red =
  last run failed · gray/template = idle), and the dropdown exposes Pause/Resume,
  Run now, Reconcile PRs, Open digest/config/workspace, and Refresh. Uninstall it
  with `scripts/menubar-uninstall.sh` when you no longer want the badge.
- **Notification on run completion:** if `terminal-notifier` is installed, the
  notification is **clickable and opens `latest-digest.md`**. Without it, a plain
  `osascript` notification is shown which is *not* actionable (clicking opens Script
  Editor — a macOS limitation of `display notification`). The `notify` config key
  (`auto`/`none`) gates whether a notification is sent at all.
