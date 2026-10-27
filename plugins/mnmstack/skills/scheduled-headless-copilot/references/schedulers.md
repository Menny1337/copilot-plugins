# Schedulers — registering an unattended Copilot job per platform

Reference for Step 4 of `scheduled-headless-copilot`. Each platform launches the **runner
script**, never `copilot` directly. Pick the section for your OS.

## Contents

- [macOS — launchd LaunchAgent](#macos--launchd-launchagent)
- [Linux — cron](#linux--cron)
- [Linux — systemd user timer](#linux--systemd-user-timer)
- [Windows — Task Scheduler](#windows--task-scheduler)
- [Cadence cheat-sheet](#cadence-cheat-sheet)

---

## macOS — launchd LaunchAgent

For a managed menu-bar app, visual builders, live status, and run history, use
[`copilot-loops-app.md`](./copilot-loops-app.md). The instructions below remain the portable
copy-and-edit workflow and are not imported into Copilot Loops.

A **LaunchAgent** runs per-user at login with no root. Save to
`~/Library/LaunchAgents/com.example.copilot-task.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.copilot-task</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/ABSOLUTE/PATH/TO/runner.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>3</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>/ABSOLUTE/PATH/state/launchd.out.log</string>
  <key>StandardErrorPath</key><string>/ABSOLUTE/PATH/state/launchd.err.log</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
```

Lifecycle:

```bash
launchctl load   ~/Library/LaunchAgents/com.example.copilot-task.plist   # enable
launchctl unload ~/Library/LaunchAgents/com.example.copilot-task.plist   # hard stop
launchctl list | grep com.example.copilot-task                           # verify loaded
launchctl print gui/$(id -u)/com.example.copilot-task                    # next fire + state
launchctl kickstart -k gui/$(id -u)/com.example.copilot-task             # run now (debug)
```

**Behavior notes**

- Fires at the next matching wall-clock time; if the Mac was **asleep** at that moment it fires
  **once on wake** (it does not back-fill every missed slot).
- `RunAtLoad` true runs the job immediately on `load` — handy to smoke-test, then set it back.
- **No native "every N days".** `StartCalendarInterval` also accepts an **array** of dicts and
  a `Weekday` key (`0` or `7` = Sunday … `1` = Monday … `5` = Friday, `6` = Saturday). Weekday-
  only (Mon–Fri at 18:00):

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

- After editing a loaded plist, **`unload` then `load`** — launchd does not hot-reload.
- `EnvironmentVariables.PATH` is the authoritative `PATH` for the job. Include every bin dir the
  runner needs; the runner should also self-heal defensively (see `headless-invocation.md`).
- Logs: `StandardOutPath`/`StandardErrorPath` capture the runner's stdout/stderr. Create their
  parent directory first (`mkdir -p`). Paths are **literal** — launchd does not expand `~` or
  `$HOME`, so use absolute paths.

---

## Linux — cron

Per-user crontab, edited with `crontab -e`. cron runs with a **very** minimal environment, so
set `PATH` and `SHELL` at the top and always log:

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
MAILTO=you@example.com            # mails any stdout/stderr; leave unset to rely on the log file

# minute hour day-of-month month day-of-week
30 2 * * *   /bin/bash /ABSOLUTE/PATH/TO/runner.sh >> /ABSOLUTE/PATH/state/cron.log 2>&1   # nightly 02:30
0 18 * * 1-5 /bin/bash /ABSOLUTE/PATH/TO/runner.sh >> /ABSOLUTE/PATH/state/cron.log 2>&1   # weekdays 18:00
```

**Behavior notes**

- If the machine is **off/asleep** at the slot, cron **skips** it (no catch-up). Use
  [`anacron`](https://man7.org/linux/man-pages/man8/anacron.8.html) or a systemd timer with
  `Persistent=true` if you need missed runs to fire on next boot.
- `%` is special in crontab (means newline) — escape as `\%` or keep it out of the line; put
  complex prompts inside the runner, not the crontab.
- cron does not load your shell profile — do **not** rely on `~/.bashrc` exports. Set everything
  in the runner or the crontab header.
- Invoke the runner as `/bin/bash …/runner.sh` (as above) so it needs no execute bit.
- Token auth: export `GH_TOKEN`/`COPILOT_GITHUB_TOKEN` inside the runner (never paste a secret
  into the crontab in plaintext — source it from a `chmod 600` file).

---

## Linux — systemd user timer

More robust than cron: structured logs (`journalctl`), `Persistent=true` catch-up, and clean
start/stop. Two unit files under `~/.config/systemd/user/`.

`copilot-task.service`:

```ini
[Unit]
Description=Headless Copilot scheduled task

[Service]
Type=oneshot
# systemd passes a minimal env; set what the runner needs:
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/bin/bash /ABSOLUTE/PATH/TO/runner.sh
```

`copilot-task.timer`:

```ini
[Unit]
Description=Run headless Copilot task nightly

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true                 # run on next boot if the scheduled time was missed

[Install]
WantedBy=timers.target
```

Enable and inspect:

```bash
systemctl --user daemon-reload
systemctl --user enable --now copilot-task.timer
systemctl --user list-timers copilot-task.timer     # next/last fire
journalctl --user -u copilot-task.service -e         # run logs
```

> For timers to run **while you are logged out**, enable lingering once:
> `loginctl enable-linger "$USER"`. `OnCalendar` syntax: `Mon..Fri 18:00`, `daily`, `hourly`,
> `*-*-01 09:00` (monthly), etc. — validate with `systemd-analyze calendar "<expr>"`.

---

## Windows — Task Scheduler

Register a task that runs the runner (here a PowerShell `.ps1`; a `.cmd`/bash-via-WSL runner
works the same way). One-time registration via `schtasks` (`cmd` syntax — the `^` is the CMD
line-continuation; in PowerShell put it on one line or use a backtick instead):

```bat
schtasks /Create /TN "CopilotNightlyTask" /SC DAILY /ST 02:30 ^
  /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\path\to\runner.ps1" ^
  /RL LIMITED /F

schtasks /Query  /TN "CopilotNightlyTask" /V /FO LIST    # inspect, incl. next run time
schtasks /Run    /TN "CopilotNightlyTask"                 # run now (debug)
schtasks /Change /TN "CopilotNightlyTask" /DISABLE        # pause
schtasks /Delete /TN "CopilotNightlyTask" /F              # remove
```

**Behavior notes**

- `/RU`/`/RP` set the run-as user; to run whether or not that user is logged in, register with
  stored credentials (Task Scheduler "Run whether user is logged on or not"). Auth and `PATH`
  then resolve against **that** account — make sure `copilot login` (or a token env) is set up
  for it.
- To catch up missed runs, enable **"Run task as soon as possible after a scheduled start is
  missed"** (the `StartWhenAvailable` setting in the XML / GUI).
- `-NoProfile` keeps the run deterministic; set `PATH` and any token env inside `runner.ps1`.

---

## Cadence cheat-sheet

| Cadence | launchd | cron | systemd `OnCalendar` |
|---|---|---|---|
| Daily 03:00 | `Hour 3 / Minute 0` | `0 3 * * *` | `*-*-* 03:00:00` |
| Weekdays 18:00 | `Weekday` array 1–5 | `0 18 * * 1-5` | `Mon..Fri 18:00` |
| Every hour | array of 24 dicts, or `StartInterval 3600` | `0 * * * *` | `hourly` |
| Weekly Sun 09:00 | `Weekday 0 / Hour 9` | `0 9 * * 0` | `Sun 09:00` |
| Monthly 1st 09:00 | `Day 1 / Hour 9` | `0 9 1 * *` | `*-*-01 09:00` |

> launchd `StartInterval` (seconds) is a simple fixed-interval alternative to
> `StartCalendarInterval` when you want "every N seconds/minutes" rather than a wall-clock time.
