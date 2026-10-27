---
name: scheduled-headless-copilot
description: "Manages unattended Copilot CLI and executable tasks via Copilot Loops on macOS or OS schedulers. Use for persistent schedules, monitoring, and troubleshooting, not session-bound /every tasks."
argument-hint: "<task to run on a schedule>"
user-invocable: true
compatibility: "Requires GitHub Copilot CLI and launchd, cron, systemd, or Windows Task Scheduler."
---

# Scheduling Headless Copilot Tasks

Make a Copilot CLI task run on a clock — unattended, with no session or terminal open — by
driving a headless `copilot -p` run from an OS-level scheduler.

> **Why this skill exists.** The in-session `/every` and `/after` commands are
> **session-bound**: they only fire while a Copilot session stays alive, and stop the moment
> you quit. To run *when Copilot is off*, you need an OS scheduler (launchd / cron / systemd /
> Task Scheduler) that launches Copilot headlessly. This skill is the reusable pattern;
> `scheduled-skill-review` is one concrete, shipped implementation of it.
>
> On macOS, **Copilot Loops** is the managed app for this workflow. Use it when the user wants
> a menu-bar status surface, visual builders, launchd scheduling, live runs, history, Keychain
> secrets, or direct executable automations. Read
> [`references/copilot-loops-app.md`](./references/copilot-loops-app.md) before installing or
> operating it.

## When to Use

- Schedule a headless `copilot -p` task to run when **no Copilot session is open** (nightly,
  hourly, weekday mornings, etc.).
- Wire a **launchd / cron / systemd timer / Task Scheduler** job that invokes Copilot.
- Run periodic unattended agent work — triage, audits, reports, digests, maintenance.
- Promote a working one-off `copilot -p` command into a durable, scheduled job.
- Create or operate **Copilot Loops** automations on macOS, including direct script or
  executable tasks.

## When to Skip

- You only need recurrence **while a Copilot session stays open** → use the in-session
  `/every` (recurring) or `/after` (one-shot, delayed) commands. Both accept natural language
  and can schedule slash commands, but both are session-bound and stop when Copilot closes —
  they do **not** run when Copilot is off.
- You want the specific *\* skill/agent self-review daemon* → use `scheduled-skill-review`,
  which is a ready-made implementation of this pattern (scan → review → deploy → revert) with
  a menu-bar UI. Use this skill only when building a **different** scheduled task.
- You need **event-driven** automation inside a running session (gate a tool call, inject
  context, notify on stop) → use `hooks-crafting` (`hooks.json`), not a scheduler.
- It is a **one-off** run with no schedule → just run `copilot -p "…" --allow-all-tools`.

## Mental Model — three layers

```
OS scheduler        launchd · cron · systemd timer · Task Scheduler
   │                the ONLY layer that fires when Copilot is off
   ▼
Runner script       sets PATH + env + auth, locks, logs, times out, captures exit
   │
   ▼
Headless Copilot    copilot -p "<prompt>" --allow-all-tools …   (runs, then exits)
```

**The scheduler never calls `copilot` directly — always through a runner script.** Schedulers
launch with a stripped-down environment (minimal `PATH`, no interactive shell, no keychain
prompt). The runner is where you make the environment sane, deterministic, and debuggable, and
it is the exact thing you test by hand before trusting the clock.

## Procedure

### Step 0 — Choose the managed app or manual workflow

- **Copilot Loops on macOS:** use the native manager for visual creation, schedules, run
  controls, history, notifications, approval review, Keychain-backed secrets, and the local
  identity profile required to preserve an existing installation. Follow
  [`references/copilot-loops-app.md`](./references/copilot-loops-app.md).
- **Portable or hand-built task:** continue with the procedure below for launchd, cron,
  systemd, or Windows Task Scheduler.

Do not make Copilot Loops adopt existing LaunchAgents or manual tasks. Its managed runtime and
the portable templates are intentionally separate.

### Step 1 — Define the task as one self-contained prompt

A scheduled run has no human to answer questions, so the prompt must stand alone:

- **One prompt string**, fully specified. No follow-up turns.
- **Idempotent and bounded** — assume it may run on a machine that just woke, on a dirty repo,
  or twice if a run overlaps. Prefer "ensure X", "append to Y", "open a PR if needed" over
  destructive one-shot actions.
- **Push complexity into a skill or agent.** For anything non-trivial, encode the *how* in a
  skill or a custom `--agent`, so the prompt is a thin "run the X procedure on Y" trigger. This
  keeps the scheduled command stable and reviewable.
- **Define the schedule's lifetime budget, not only each run's timeout.** For monitor/poll jobs,
  state the success condition that disables the schedule, the blocker condition that escalates
  instead of polling forever, and a maximum attempts, elapsed-time, or consecutive-failure
  budget. A runner timeout bounds one invocation; it does not prevent an unattended schedule
  from consuming time and credits indefinitely across repeated fires.
- **Add a self-marker** if the task inspects session history, so future runs can exclude their
  own sessions (e.g. embed a token like `MY_TASK_RUN` in the prompt and filter on it — this is
  how `scheduled-skill-review` avoids reviewing itself).

### Step 2 — Compose the headless invocation

Start from the minimal non-interactive form and add only what the task needs:

```bash
copilot -p "<prompt>" --allow-all-tools --no-color
```

Flags that matter for **unattended** runs:

| Flag / env | Why it matters unattended |
|---|---|
| `-p, --prompt "<text>"` | Non-interactive mode; runs the prompt and **exits**. |
| `--allow-all-tools` (env `COPILOT_ALLOW_ALL=true`) | **Required** for non-interactive — without it the run blocks on permission prompts. `--allow-all` / `--yolo` also add paths + URLs. |
| `--no-ask-user` | Agent won't block waiting for a human answer — it works autonomously. |
| `-C <dir>` | Working directory (e.g. the repo). Schedulers start in `/` or `$HOME`. |
| `--agent <plugin:agent>` | Select a custom agent that carries the procedure. |
| `--model <model>` (env `COPILOT_MODEL`) | Pin the model for reproducible runs. |
| `--add-dir <dir>` | Grant access to a trusted extra path without `--allow-all-paths`; CLI 1.0.81 also discovers `.github/skills/` and `.github/agents/` below it. Relative paths follow `-C` and resumed/worktree cwd in 1.0.83. |
| `--plugin-dir <dir>` | Load a local plugin (for skills/agents not globally installed). Relative paths follow `-C` and resumed/worktree cwd in 1.0.83. |
| `--sandbox` / `--no-sandbox` | Pin the selected sandbox policy for this run rather than inheriting saved state. Prefer `--sandbox` after provisioning and testing the host; use `--no-sandbox` only when policy permits and the unsandboxed risk is accepted. |
| `-s, --silent` + `--output-format json` | Quiet, machine-readable JSONL output for logging/parsing. |
| `--usage-output-file <file>` | Write final usage statistics as JSON, including per-agent usage. |
| `--bash-env=<on\|off>` / `--no-bash-env` | Pin whether `BASH_ENV` is honored; default is off and the preference persists. |
| `--no-auto-update` (env `COPILOT_AUTO_UPDATE=false`) | Don't self-upgrade mid-run in a headless context. |
| `--log-dir <dir>` | Capture CLI logs for the run. |
| `--share[=path]` / `--share-gist` | Persist a transcript artifact you can read later. |

> **Permissions reality:** unattended means **full autonomy with no confirmation**. Scope the
> blast radius — prefer `--allow-all-tools` plus targeted `-C` / `--add-dir` over
> `--allow-all-paths`, and treat the job as acting on your behalf with your credentials.
> Only add directories you control: `--add-dir` is also a customization-discovery root.

### Step 3 — Wrap the invocation in a runner script

Copy `templates/runner.sh`, then customize the prompt, paths, and cadence-independent settings.
The template intentionally leaves sandbox policy unset: during setup, add the chosen
`--sandbox` or `--no-sandbox` flag to its Copilot invocation rather than silently inheriting a
saved/default value. A managed policy can enforce `--sandbox` and reject disable attempts.
The runner is responsible for everything the scheduler strips away:

- **`PATH`** that resolves `copilot`, `node`, `git`, `gh` (and `agency` if you use it).
- **Auth/env** export (see Step 5) — usually nothing, because stored login is reused.
- **Single-flight lock** so an overlapping fire doesn't stack a second run on the first.
- **Timestamped logging** to an append log under a per-task state dir.
- **Optional timeout** to kill a hung run instead of leaving it forever.
- **Exit-code capture** so the scheduler/log records success vs failure.

Keep durable state (logs, lock, last-run marker) in a per-task directory such as
`~/.copilot/scheduled-tasks/<task-name>/` — outside the repo so a `git clean` can't wipe it.

### Step 4 — Register with the OS scheduler

**macOS (`launchd`) — the primary path on this machine.** Install a *LaunchAgent* (per-user,
runs at login; no root) from `templates/com.example.copilot-task.plist`:

```xml
<key>ProgramArguments</key>
<array>
  <string>/bin/bash</string>
  <string>/Users/USERNAME/.copilot/scheduled-tasks/copilot-task/runner.sh</string>
</array>
<key>StartCalendarInterval</key>
<dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
<key>EnvironmentVariables</key>
<dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>StandardOutPath</key><string>/Users/USERNAME/.copilot/scheduled-tasks/copilot-task/launchd.out.log</string>
<key>StandardErrorPath</key><string>/Users/USERNAME/.copilot/scheduled-tasks/copilot-task/launchd.err.log</string>
<key>RunAtLoad</key><false/>
```

```bash
launchctl load   ~/Library/LaunchAgents/com.example.copilot-task.plist   # enable
launchctl list | grep com.example.copilot-task                           # verify loaded
launchctl unload ~/Library/LaunchAgents/com.example.copilot-task.plist   # hard stop
```

`StartCalendarInterval` fires at the next matching wall-clock time, and **once on wake** if the
machine was asleep at the scheduled moment. It has **no native "every N days"** — to thin a
daily cadence, pass an **array** of dicts with a `Weekday` key (see `references/schedulers.md`).
Paths in the plist are literal — launchd does **not** expand `~` or `$HOME`, so use absolute
paths (replace `USERNAME`), and `mkdir -p` the log directory before loading.

**Linux (`cron` or `systemd` timer) and Windows (Task Scheduler):** read
`references/schedulers.md` for the exact registration syntax, env handling, and gotchas per
platform.

### Step 5 — Solve the headless gotchas (the part that actually breaks)

These five are why a command that works in your terminal fails at 3 a.m. Full detail and copy-
paste checks are in `references/headless-invocation.md`:

1. **`PATH`** — launchd/cron start with a minimal `PATH`. Set it explicitly (in the plist
   `EnvironmentVariables` *and* defensively in the runner) so `copilot`, `node`, `git`, `gh`
   resolve. A missing binary makes the whole job silently no-op.
2. **Copilot auth** — a one-time `copilot login` stores credentials under `~/.copilot`
   (override with `COPILOT_HOME`). LaunchAgents/cron run as **your user with `$HOME` set**, so
   those credentials are reused — usually no token needed. On a server/CI or a different user,
   inject `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` instead.
3. **git / `gh` push auth** — if the task pushes or opens PRs, that must work **without a
   keychain prompt**. Use the `gh` credential helper (`gh auth setup-git`) or an SSH key loaded
   into the agent. Verify under a scheduler-like env:
   `env -i HOME="$HOME" PATH="$PATH" git -C <repo> push --dry-run`.
4. **Working directory & writable paths** — schedulers start in `/` or `$HOME`. Always pass
   `-C <repo>` and grant extra paths with `--add-dir`. Since CLI 1.0.83, relative
   `--add-dir` and `--plugin-dir` values resolve after `-C` and against resumed/worktree cwd
   regardless of option order.
5. **Sleep / network / login** — if the laptop is asleep at fire time, launchd runs **once on
   wake** (cron simply skips the slot). Make sure the task tolerates a delayed start and that
   network/login state is available when it runs.

If you pin `--sandbox`, account for the 1.0.83 network model: host and localhost services are
blocked by default (including localhost servers started by the command on macOS). Set
`sandbox.userPolicy.network.allowLocalNetwork` only when the job needs that access.
Linux requires `bwrap` 0.5.0+; every Linux sandbox also needs `slirp4netns`, util-linux 2.35+
(`unshare` with `--map-current-user` and `--keep-caps`, plus `nsenter`), `iptables`,
`ip6tables`, both restore binaries, and read/write `/dev/net/tun`. Unprivileged hosts normally
need the `nf_tables` backend. The host-support probe checks only `bwrap` on Linux and
`sandbox-exec` on macOS, so missing namespace prerequisites fail sandbox startup later.
If sandboxing is enabled by the flag, saved state, or policy on an unsupported host, sandboxed
shell commands and sandboxed MCP/LSP servers fail with a startup warning; the setting is not
ignored.
Managed enforcement cannot be disabled locally, so provision the host or contact the
administrator instead of treating `--no-sandbox` as a universal recovery.

### Step 6 — Verify before trusting the schedule

Never wait for the real fire time to find out it's broken:

```bash
# 1. Run the runner directly — does the task itself work?
bash /ABSOLUTE/PATH/TO/runner.sh

# 2. Simulate the scheduler's clean environment — catches PATH/auth gaps
#    that ONLY appear unattended. Use the same PATH you put in the plist.
env -i HOME="$HOME" PATH="/opt/homebrew/bin:/usr/bin:/bin" bash /ABSOLUTE/PATH/TO/runner.sh
```

Then confirm: log file written, exit code `0`, expected side effects present, and the **next
fire time** is scheduled (`launchctl print gui/$(id -u)/<label>`,
`systemctl --user list-timers`, `crontab -l`, or `schtasks /query`). To fire immediately once,
set `RunAtLoad` true, `load`, observe, then revert.

### Step 7 — Manage the lifecycle

- **Enable / disable:** `launchctl load`/`unload` (macOS), `systemctl --user enable`/`disable`,
  `crontab -e`, or `schtasks /change /disable`.
- **Pause without unscheduling:** have the runner check a guard flag (e.g. an `enabled:false`
  in a config file or a `PAUSED` sentinel) and no-op early — the job still launches but does
  nothing. This is how `scheduled-skill-review` implements soft pause.
- **Change cadence:** edit the plist/timer/crontab and reload (`unload` then `load` for
  launchd). Keep one source of truth for the schedule.
- **Observe:** tail the runner log; optionally notify on completion/failure
  (`terminal-notifier` or `osascript` on macOS, `MAILTO=` for cron, etc.).

## Worked Example — nightly dependency audit (macOS)

Goal: every night at 02:30, have Copilot audit a repo's dependencies and append a dated note to
a report file. No pushing, so no git-auth complication.

**Prompt** (in the runner): `"Review this repo's dependency manifests for outdated or
vulnerable packages. Append a concise dated summary to reports/dependency-audit.md; create the
file if missing. Do not modify any other files. (NIGHTLY_DEP_AUDIT)"`

**Runner** (`~/.copilot/scheduled-tasks/dep-audit/runner.sh`, from `templates/runner.sh`):
sets `PATH`, locks, logs, then:

```bash
copilot -p "$PROMPT" -C "$REPO" --sandbox --allow-all-tools --no-ask-user --no-color --no-auto-update \
  --add-dir "$REPO/reports" --log-dir "$STATE/cli-logs" >>"$LOG" 2>&1
```

**Schedule** (`com.example.copilot-task.plist`): `StartCalendarInterval` `Hour 2 / Minute 30`,
`PATH` env, stdout/stderr log paths, `RunAtLoad false`. Then `launchctl load …`.

**Verify:** run the runner by hand, then under `env -i HOME=… PATH=…`, confirm
`reports/dependency-audit.md` gets a new dated section and the log shows exit `0`.

## Pitfalls

- **Calling `copilot` straight from the plist/crontab** — no controlled env, no log, no lock.
  Always go through a runner.
- **Forgetting `--allow-all-tools` / `--no-ask-user`** — the run hangs on a prompt nobody
  answers, then the scheduler kills or abandons it.
- **Assuming your interactive `PATH`** — the job can't find `copilot`/`node` and silently does
  nothing. Test with `env -i`.
- **Overlapping runs** — a slow run still going when the next fires. Use the lock.
- **Destructive, non-idempotent prompts** — a retried or doubled run corrupts state.
- **Push tasks with interactive git auth** — works in your terminal, blocks under launchd.

## References

- `references/schedulers.md` — per-platform registration: launchd (full, incl. `Weekday`
  arrays), cron, systemd `.timer`/`.service`, Windows Task Scheduler.
- `references/headless-invocation.md` — full flag/env table, auth (stored login vs token),
  `PATH`, non-interactive git/`gh`, secrets, and a failure→fix troubleshooting matrix.
- `templates/runner.sh` — parameterized runner (PATH, lock, logging, timeout, exit capture).
- `templates/com.example.copilot-task.plist` — macOS LaunchAgent template.
- **Related:** `scheduled-skill-review` (a full real-world build of this pattern),
  `hooks-crafting` (in-session event automation), and the in-session `/every` command
  (recurrence only while Copilot is open).
