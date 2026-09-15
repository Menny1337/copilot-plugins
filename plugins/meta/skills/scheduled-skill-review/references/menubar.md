# Menu-bar control (native macOS app)

The daemon ships a self-built native macOS menu-bar app, `SkillReviewMenuBar`, for status and control. It is a SwiftUI `MenuBarExtra` app with no third-party menu-bar runtime. The app is only a presentation/control layer over `scripts/daemon-ctl.sh`; daemon logic stays in the scripts.

## Prerequisites

- macOS 13 or newer (`MenuBarExtra` support).
- Apple Swift Command Line Tools. The supported setup uses the existing CLT Swift toolchain; full Xcode is not required.
- The daemon checkout must contain the skill scripts, because the installed app discovers and calls `daemon-ctl.sh` from that checkout.

## Build and install

From the skill directory:

```sh
cd "$REPO/plugins/meta/skills/scheduled-skill-review"
bash scripts/menubar-install.sh
```

The installer builds the Swift package under `scripts/menubar-app/`, assembles and ad-hoc codesigns `SkillReviewMenuBar.app`, installs it at `~/Applications/SkillReviewMenuBar.app`, writes menu-bar support files into `~/.copilot/agent-architect/skill-reviews/`, and bootstraps the LaunchAgent.

Installed support files:

- `~/.copilot/agent-architect/skill-reviews/menubar.json` records the absolute `scriptDir` for `daemon-ctl.sh` discovery.
- `~/.copilot/agent-architect/skill-reviews/RunSkillReviewNow.command` opens a visible Terminal and executes `daemon-ctl.sh run-now`.
- `~/.copilot/agent-architect/skill-reviews/logs/menubar.out.log` and `menubar.err.log` capture LaunchAgent stdout/stderr.

## Migrating from SwiftBar

Earlier versions of this skill rendered the menu bar through the third-party SwiftBar app and a `menubar-status.5m.sh` plugin symlink. That shim has been removed, so its symlink in the SwiftBar plugins folder is now broken. After installing the native app, retire the old setup:

```sh
# Remove the stale plugin symlink (path matches your SwiftBar plugins folder)
rm -f "$HOME/Library/Application Support/SwiftBar/Plugins/menubar-status.5m.sh"

# If SwiftBar was used only for this daemon, uninstall it entirely
brew uninstall --cask swiftbar   # or quit and delete SwiftBar.app manually
```

Until SwiftBar is removed, both its icon and the native `SkillReviewMenuBar` icon appear during the transition. Removing the SwiftBar plugin (or SwiftBar itself) leaves only the native app.

## Uninstall

```sh
cd "$REPO/plugins/meta/skills/scheduled-skill-review"
bash scripts/menubar-uninstall.sh
```

The uninstaller boots out the menu-bar LaunchAgent before removing `~/Applications/SkillReviewMenuBar.app` and the menu-bar helper files from the workspace.

## Autostart

The app autostarts through the LaunchAgent label `com.copilotplugins.skill-review.menubar`, installed at `~/Library/LaunchAgents/com.copilotplugins.skill-review.menubar.plist`.

The installer and uninstaller also remove older menu-bar LaunchAgents whose
arguments point to this installed app. They read each label from its plist and
leave other applications' jobs untouched. Reinstallation uses the new bundle
identifier; macOS permissions associated with an older identifier may need
approval again.

This is separate from the scheduler job `com.copilotplugins.skill-review`:

- `com.copilotplugins.skill-review` launches the review daemon on its schedule.
- `com.copilotplugins.skill-review.menubar` launches only the menu-bar UI at login and relaunches it after crashes.

Existing scheduler labels need no migration. The daemon still discovers their
plists by the `run-batch-review.sh` argument. Do not install a second scheduler
job alongside an existing one.

The menu-bar LaunchAgent sets `SKILL_REVIEW_SCRIPT_DIR` and a PATH that includes Homebrew, Command Line Tools, and system locations so the app can run `daemon-ctl.sh`, `node`, and `gh` outside an interactive shell.

## What the title shows

The title is icon-only. The app reads `daemon-ctl.sh status` JSON and selects one bundled PNG by first-match precedence:

1. `failed` — the last run reported failures.
2. `paused` — `enabled=false`.
3. `reviewing` — a review cycle is running now.
4. `prs` — PRs are awaiting review/merge.
5. `running` — re-reviews are due now.
6. `idle` — enabled with nothing due.

Icons are bundled in the app at `Contents/Resources/icons/<state>.png`. The `idle` icon is a template image that macOS tints automatically; the other states render full-color. Missing icons fall back to emoji.

## Dropdown

| Line / action | What it does |
| --- | --- |
| `State: paused` / `State: enabled` | Shows the soft-pause state from `daemon-ctl.sh status`. |
| `Run in progress…` | Appears only while the daemon lock indicates a cycle is running. |
| `Open cycles: N · Due re-reviews: M` | Shows lifecycle counts from `status`. |
| `Next run: <Day HH:MM> (in <countdown>)` | Shows the next scheduled launch, read straight from the launchd plist's `StartCalendarInterval` (the real trigger) via `status`; adds `— paused, will no-op` when disabled. |
| `🔬 PRs awaiting your review: N` | Opens a flyout submenu when `openPRs>0`. |
| `Open PR: <url>` | Opens each PR URL from `prUrls[]` in the browser. |
| `Reconcile PRs now (sync merged/closed)` | Runs `daemon-ctl.sh reconcile`, then refreshes status. |
| `Last run: <runId> (<status>)` | Shows the most recent cycle plus applied/reverted/PR/failed counts. |
| `Pause daemon` / `Resume daemon` | Runs `daemon-ctl.sh pause` or `daemon-ctl.sh resume`, then refreshes status. |
| `Run now` | Opens Terminal on `RunSkillReviewNow.command`, which runs `daemon-ctl.sh run-now` visibly. |
| `Open latest digest` | Opens `~/.copilot/agent-architect/skill-reviews/latest-digest.md`. |
| `Settings…` | Opens the native settings window (below) to edit `config.json` through a form. |
| `Open workspace` | Opens `~/.copilot/agent-architect/skill-reviews/`. |
| `Refresh` | Re-runs `daemon-ctl.sh status` immediately. |

Every control action triggers a status refresh afterward. Silent actions spawn `daemon-ctl.sh <subcommand>`; openers use `/usr/bin/open`.

## Settings window

`Settings…` opens a native SwiftUI window (`ConfigWindow`) that edits the daemon's
`config.json` through a real form instead of raw JSON. It is a presentation layer
over three `daemon-ctl.sh` subcommands and never writes `config.json` directly:

- `daemon-ctl.sh config-get` prints the full effective config (defaults merged) as JSON.
- `daemon-ctl.sh config-set` reads a JSON patch on stdin, validates and coerces each
  managed key, deep-merges `schedule`, keeps `autoMergeUnits`/`prUnits` mutually
  exclusive, and preserves any keys the UI does not manage. When the patch changes
  `schedule`, it also rewrites the launchd plist's `StartCalendarInterval` (via
  `schedule.mjs`) and reloads launchd, so editing the schedule here reschedules the
  **real** trigger — no separate plist edit needed.
- `daemon-ctl.sh unit-catalog` returns every marketplace skill/agent plus configured
  external `SKILL.md` files and folder-discovered skills, including source paths,
  source roots, and missing/conflict state.

The form mirrors the dropdown's visual language (teal test-tube glyph, green/blue
toggles, orange numeric values) and is grouped into sections:

| Section | Controls |
| --- | --- |
| General | `Daemon enabled` toggle, `Notifications` (auto/none). |
| Schedule | `Hour`, `Minute` steppers, and seven `Days of week` circle toggles (Sun…Sat = JS `getDay` 0…6; empty = every day). Saving rewrites the launchd plist and reloads it, so the change takes effect on the next fire. |
| Deployment | `Auto-deploy` / `Auto-revert` toggles, `Default policy` (auto/PR), `Reverts` (auto/PR/per-unit), `Concurrency` stepper. |
| Selection & tuning | `Signal threshold`, `Observation window`, `First-run lookback`, `Max first-run sessions` steppers. |
| Skills & agents under review | Native searchable full-height row list showing every evaluated unit, its path and policy, plus per-row `Edit`, `Run now`, and `More` controls. Type, source, policy, and availability filters can be combined, and the visible count updates immediately. It shares the form's single scrollbar so no rows are trapped inside a nested scroll surface. `Edit` opens a native settings sheet for eligibility/policy and file opening. |
| Paths & identity | `Repo directory`, `Marketplace name`, `gh account` text fields. |

**Add** is a native menu with two `NSOpenPanel` flows. **SKILL.md…** starts at
`~/.copilot` and adds one file. **Skills folder…** starts at `~/.copilot/skills`
when available and persists the selected root; the root's own `SKILL.md` and
immediate child directories containing `SKILL.md` are discovered on every
catalog refresh and scheduled scan. **Sources…** lists configured files and
folders for removal, while **Refresh** immediately reloads folder contents.

The app validates scalar kebab-case frontmatter names and rejects names that
collide with any reviewed skill or agent. External rows show `Edit in place`
instead of a marketplace deploy policy. Their review runs copy only the
selected/discovered `SKILL.md` into
private staging and apply it atomically only when the source remained unchanged.

The footer offers `Edit raw JSON…` (opens `config.json` in the default editor for
keys the form does not expose) and an autosave indicator. There is no Save button:
every edit is written automatically. Changes are debounced (~0.6s) and serialized,
so rapid edits coalesce into a single `config-set` call; the indicator shows
`Saving…`, then `Saved`, or an error. The `Auto-merge` and `Review via PR` lists
are kept mutually exclusive as you edit (matching `config-set`, where `prUnits`
wins). The window reloads fresh config each time it opens.

`Run now` invokes `daemon-ctl.sh review-unit <name>` without opening Terminal. The
row uses native `ProgressView` and completion/failure states while the asynchronous
review runs; only one review cycle can run at a time.

Window scenes for the menu bar are accessory by default; opening Settings switches
the app to a regular activation policy so the window can take focus, and restores
accessory policy when it closes.

## Refresh model

The app refreshes status on a timer and watches `~/.copilot/agent-architect/skill-reviews/` with FSEvents. Writes touching `state.json`, `cycles.json`, `config.json`, `lock`, `cycles.lock`, or `latest-digest.md` are debounced and then refetched so the icon and dropdown update quickly after daemon changes.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Icon missing or emoji fallback appears | A PNG was not copied into the app bundle | Rebuild/reinstall and check `~/Applications/SkillReviewMenuBar.app/Contents/Resources/icons/` contains all six state PNGs. |
| `⚠︎ status error` appears | The app could not run or decode `daemon-ctl.sh status` | Check `~/.copilot/agent-architect/skill-reviews/logs/menubar.err.log`; confirm `node` is on the LaunchAgent PATH and the checkout still has `scripts/daemon-ctl.sh`. |
| App cannot find `daemon-ctl.sh` | Missing `SKILL_REVIEW_SCRIPT_DIR` or stale `menubar.json` | Re-run `scripts/menubar-install.sh` from the current checkout. |
| App does not start at login | LaunchAgent not loaded or failed | Run `launchctl print gui/$(id -u)/com.copilotplugins.skill-review.menubar`; if absent, rerun the installer. |
| Run now does not open visibly | Helper command missing or not executable | Re-run the installer and check `~/.copilot/agent-architect/skill-reviews/RunSkillReviewNow.command`. |
| External skill is missing or cannot run | The configured path moved, the file is not named `SKILL.md`, or its frontmatter name is invalid/duplicated | Use the row's `Edit`/`More` controls to remove it, then add the correct file again. |

Soft pause does not unload either LaunchAgent: it only sets `enabled=false`, so scheduled launches no-op and the menu-bar app reports `paused`.
