# Headless invocation, auth & environment — reference

Reference for Steps 2 and 5 of `scheduled-headless-copilot`. This is the detail behind the
runner: every flag/env var that matters unattended, how authentication actually resolves, and a
failure→fix matrix. All flags below are from `copilot --help` / `copilot help environment`.

Authoritative, regularly-refreshed CLI surface: `../../agent-skill-audit/references/cli-feature-baseline.md`; `copilot --help` is always definitive.

## Contents

- [Full flag reference](#full-flag-reference)
- [Environment variables](#environment-variables)
- [Authentication — how it resolves unattended](#authentication--how-it-resolves-unattended)
- [git / gh push without a prompt](#git--gh-push-without-a-prompt)
- [PATH under a scheduler](#path-under-a-scheduler)
- [Secrets](#secrets)
- [Troubleshooting matrix](#troubleshooting-matrix)

---

## Full flag reference

| Flag | Effect | Unattended use |
|---|---|---|
| `-p, --prompt <text>` | Run a prompt non-interactively, then exit. | The core of every scheduled run. Note the hook semantics: `sessionEnd` fires **once per completed turn** with `reason` `complete`/`error`, not once at shutdown with `user_exit`. A run that dies before completing a turn fires no `sessionEnd` at all — don't rely on it for cleanup. Piping the prompt on stdin behaves identically as of 1.0.78. |
| `--mode <interactive\|plan\|autopilot>` | Set the initial agent mode. | Prefer `autopilot` for unattended execution; use `plan` only when the output should be a plan. |
| `--autopilot` / `--plan` | Shorthands for the corresponding `--mode`. | `--autopilot` is the usual unattended mode. |
| `--max-autopilot-continues <n>` | Continuation cap in autopilot (default 5). | Bounds self-continuation loops. |
| `--allow-all-tools` | Run all tools without confirmation. | **Required** — without it the run blocks. |
| `--allow-all` / `--yolo` | `--allow-all-tools` + `--allow-all-paths` + `--allow-all-urls`. | Broadest; only when the task genuinely needs any path/URL. |
| `--allow-all-paths` | Disable path verification. | Avoid if you can scope with `-C`/`--add-dir`. |
| `--allow-tool[=t]` / `--deny-tool[=t]` | Allow/deny specific tools; deny wins. | Tighten the blast radius vs `--allow-all-tools`. |
| `--available-tools` / `--excluded-tools` | Filter which tools the model can see. | Reduce the tool surface for narrow jobs. |
| `--no-ask-user` | Disable the `ask_user` tool. | Agent never blocks for human input. |
| `-C <dir>` | Change working directory first. | Point at the repo; schedulers start in `/` or `$HOME`. |
| `--add-dir <dir>` | Allow file access to a trusted extra dir. | Grant a writable output/report path; CLI 1.0.81 also discovers `.github/skills/` and `.github/agents/` below it, so do not add untrusted trees. Relative paths follow `-C` and resumed/worktree cwd in 1.0.83. |
| `--agent <plugin:agent>` | Use a custom agent. | Carry the procedure in the agent, keep the prompt thin. |
| `--model <model>` | Pick the model (`auto` to let Copilot choose). | Pin for reproducibility. |
| `--effort, --reasoning-effort <level>` | Set reasoning effort (`none` through `max`). | Pin only when the job needs predictable depth/cost. |
| `--context <default\|long_context>` | Select the context window tier. | Use `long_context` for large repo/doc sweeps. |
| `--attachment <path>` | Attach an image or native document; non-interactive only. | Feed screenshots/docs to scheduled runs without a UI. |
| `--max-ai-credits <n>` | Soft AI-credit cap for the session (minimum 30). | Cost guardrail; still use an outer process timeout. |
| `--plugin-dir <dir>` | Load a local plugin. | Use skills/agents not globally installed. Relative paths follow `-C` and resumed/worktree cwd in 1.0.83. |
| `--disable-builtin-mcps` / `--disable-mcp-server <name>` / `--enable-mcp-server <name>` | Disable built-ins/a named server, or re-enable a server disabled in settings for this run. | Reduce startup/surface area, with an explicit temporary override when needed. |
| `--add-github-mcp-toolset <ts>` / `--add-github-mcp-tool <t>` / `--enable-all-github-mcp-tools` | Scope the GitHub MCP surface; the `--enable-all` form overrides the two narrower flags. | Enable only the toolsets the job needs instead of everything. Persisted equivalents: `githubMcpToolsets` / `githubMcpTools` in settings. |
| `--allow-all-mcp-server-instructions` | Include MCP servers' own initialization instructions. | Review trust and context cost before enabling. |
| `--sandbox` / `--no-sandbox` | Turn the OS-level shell sandbox on/off **for this run only**, without changing the saved setting (1.0.70). Hidden from `--help`. | Pin explicitly in unattended runs so behaviour doesn't shift with saved state. Prefer `--sandbox` after provisioning and testing the host; `--no-sandbox` works only when managed policy permits it. |
| `--enable-memory` | Enable persistent memory in prompt mode (off by default there). | Only when the job should read/write the CLI's own memory. |
| `--bash-env=<on\|off>` / `--no-bash-env` | Enable or disable `BASH_ENV` support and persist the preference; default is off. | Pin explicitly when runner startup depends on a `BASH_ENV` file. |
| `--resume[=id]` / `--continue` | Resume by id, prefix, name, or most recent. | Continue a known session instead of starting fresh. |
| `--connect[=id]` | Attach directly to a remote session or task. | Use only when the scheduler is meant to monitor/join remote work. |
| `--session-id <id>` | Set/resume a session UUID. | Stable id for correlating runs. |
| `-s, --silent` | Output only the agent response (no stats). | Cleaner logs when scripting with `-p`. |
| `--output-format <text\|json>` | `json` = JSONL, one object per line. | Machine-readable run output to parse. |
| `--usage-output-file <file>` | Write final usage statistics as JSON, including per-agent usage. | Separate accounting data from response/log output. |
| `--stream <on\|off>` | Control streaming mode. | Turn off when consumers need buffered output. |
| `--no-color` (env `NO_COLOR`) | No ANSI color. | Keeps log files clean. |
| `--no-auto-update` | Don't download a CLI update. | Avoid a mid-run upgrade; auto-off in CI. |
| `--log-dir <dir>` | CLI log directory. | Capture internal logs per task. |
| `--log-level <level>` | `none`…`debug`/`all`. | Bump to `debug` when diagnosing a silent failure. |
| `--share[=path]` / `--share-gist` | Save a transcript after completion. | Durable artifact of what the run did. |
| `--remote` / `--remote-export` / `--no-remote` / `--no-remote-export` | Explicitly enable or disable remote control/export. | Pin the desired exposure rather than inheriting saved state. |
| `--no-custom-instructions` | Ignore `AGENTS.md` etc. | Use when the repo's instructions shouldn't apply to the job. |
| `--secret-env-vars <vars…>` | Strip named values from shell/MCP envs and redact them from output. | Protect injected tokens. |

Recommended unattended baseline:

```bash
copilot -p "$PROMPT" -C "$REPO" \
  --autopilot --sandbox --allow-all-tools --no-ask-user --no-color --no-auto-update \
  --add-dir "$REPO/reports" --log-dir "$STATE/cli-logs"
```

Create and control every `--add-dir` root. Since CLI 1.0.81 it is also a
customization-discovery root, not only a filesystem permission. Since CLI
1.0.83, relative `--add-dir` and `--plugin-dir` values are resolved after `-C`
and against a resumed/worktree session's cwd regardless of option order.
The shipped `templates/runner.sh` intentionally does not choose a sandbox mode.
During setup, add the chosen `--sandbox` or `--no-sandbox` flag to its Copilot
invocation; do not leave a scheduled job to inherit mutable saved state.

### Sandbox requirements in 1.0.83

- macOS and Linux sandboxes block services on the host by default. On macOS this
  also includes localhost services started by the sandboxed command. Set
  `sandbox.userPolicy.network.allowLocalNetwork` only when the job requires it.
- Linux requires `bwrap` 0.5.0+ on `PATH`. Every Linux sandbox also creates a
  private network namespace and requires `slirp4netns`, util-linux 2.35+
  (`unshare` with `--map-current-user` and `--keep-caps`, plus `nsenter`),
  `iptables`, `ip6tables`, both restore binaries, and read/write access to
  `/dev/net/tun`. Unprivileged hosts normally need the `nf_tables` backend.
- The host-support probe checks only `bwrap` on Linux and `sandbox-exec` on
  macOS. Missing namespace prerequisites therefore cause sandbox startup
  failures after the host has passed that probe.
- If sandboxing is already enabled by `--sandbox`, saved `sandbox.enabled`, or
  organization policy on an unsupported host, sandboxed shell commands and
  sandboxed MCP/LSP servers fail with a startup warning; sandboxing is not
  ignored.
- Managed enforced sandboxing cannot be disabled locally. Provision the host or
  contact the administrator; a per-command bypass exists only if policy leaves
  `allowBypass` enabled.
- Sandboxed commands can receive ecosystem-scoped access to developer-tool paths, including
  credential-bearing files such as `.npmrc`. Set
  `sandbox.allowDevToolAccess=false` when the job should not receive that grant.
- Sandboxed `gh` commands use the account configured for the repository. This
  does not remove the need to test non-interactive git credentials.

---

## Environment variables

| Variable | Purpose |
|---|---|
| `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` | Auth token, in this precedence order; **takes precedence** over stored login credentials. |
| `COPILOT_ALLOW_ALL=true` | Same as `--allow-all-tools`. |
| `COPILOT_HOME` | Override the config/state/credentials dir (default `$HOME/.copilot`); replaces deprecated `--config-dir`. |
| `COPILOT_MODEL` | Default model (overridden by `--model`). |
| `COPILOT_AUTO_UPDATE=false` | Disable auto-update (same as `--no-auto-update`). |
| `COPILOT_TASK_WAIT_TIMEOUT_SECONDS` | Bounds the wait when a background shell or background agent outlives a `-p` turn. Predates 1.0.71 for plain `-p`; 1.0.71 extended `--autopilot` to honor it too. |
| `COPILOT_PLUGIN_DIR_ONLY` | Disable automatic plugin discovery. |
| `GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS=true` | **Required in `-p` mode** for project extensions (`.github/extensions`) and extension-management tools to load. User extensions load by default; project ones silently do not without this. |
| `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` | Extra custom-instruction directories. |
| `GH_HOST` / `COPILOT_GH_HOST` | Target a GitHub Enterprise host for auth/API. |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Proxy config for outbound requests. |
| `COPILOT_CACHE_HOME` | Override the CLI cache root (downloaded packages, marketplace cache). |
| `COPILOT_HOOK_ALLOW_LOCALHOST=1` | Permit `http://localhost` HTTP hooks (must be the literal `1`). Sibling: `COPILOT_HOOK_ALLOW_HTTP_AUTH_HOOKS=1`. |
| `COPILOT_OFFLINE=true` + `COPILOT_PROVIDER_*` | Offline / bring-your-own-model provider (no GitHub auth). |
| `COPILOT_OTEL_*` | OpenTelemetry monitoring/export configuration. |

Set these in the **runner** (or the plist `EnvironmentVariables` / systemd `Environment=`), not
in an interactive profile the scheduler never sources. For `-p --autopilot` jobs that appear to
hang after the visible answer, set `COPILOT_TASK_WAIT_TIMEOUT_SECONDS` to bound waits for
background shell/agent work; keep the runner's outer `TIMEOUT_SECS` as the hard process cap.

---

## Authentication — how it resolves unattended

Two independent auths are in play; a scheduled task that pushes needs **both**.

**1. Copilot model access.** Resolved in this order:

1. `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` if set, else
2. credentials stored by a prior interactive `copilot login`, under `~/.copilot`
   (`COPILOT_HOME`).

Because launchd LaunchAgents and per-user cron/systemd jobs run **as your user with `$HOME`
set**, a one-time `copilot login` on that machine is normally enough — the job reuses the stored
credentials with no token in sight. Inject a token only when there is no stored login: a
headless server, CI, a different service account, or a non-default `COPILOT_HOME`.

> There is no `copilot auth` or `copilot logout` subcommand. Sign **in** with `copilot login`
> (or token env vars); to sign **out**, clear the stored credential under `~/.copilot`
> (`COPILOT_HOME`) or your system credential store. Verify the stored login works headlessly by
> running the runner under `env -i HOME="$HOME" PATH="…"` (see Step 6).

**2. git / GitHub write access** (only if the task commits/pushes/opens PRs) — see next section.

---

## git / gh push without a prompt

Scheduler jobs have **no keychain/GUI prompt**, so interactive git credential helpers hang or
fail. Pick one non-interactive path:

- **`gh` credential helper (recommended):** `gh auth login` once, then `gh auth setup-git`.
- **SSH remote + key in the agent:** switch the remote to `git@github.com:…`, `ssh-add
  --apple-use-keychain <key>`, and set `IdentityFile` in `~/.ssh/config` (launchd can't type a
  passphrase).
- **PAT in `~/.netrc`** (least preferred): `machine github.com login <user> password <PAT>`,
  `chmod 600`.

Outside the sandbox, `gh` keeps **one global active account** separate from git's push creds.
If you switch it (`gh auth switch`), `gh pr create`/`view` can fail with *Could not resolve to
a Repository* while `git push` still works. Sandboxed `gh` in CLI 1.0.83 uses the account
configured for the repository. For PR/reconcile steps, resolve the owner's token and export
`GH_TOKEN` for that run only when required. **Always confirm under a scheduler-like env before
trusting it:**

```bash
env -i HOME="$HOME" PATH="$PATH" git -C "$REPO" push --dry-run
```

---

## PATH under a scheduler

launchd and cron start with a **minimal** `PATH` (often just `/usr/bin:/bin`). If `copilot`,
`node`, `git`, or `gh` aren't on it, the job silently no-ops. Two layers of defense:

1. **Declarative:** set `PATH` in the plist `EnvironmentVariables` (macOS), the crontab header,
   or systemd `Environment=`.
2. **Defensive (in the runner):** prepend the known install dirs so the job self-heals even if
   the declarative `PATH` is wrong:

   ```bash
   export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:$PATH"
   command -v copilot >/dev/null || { echo "copilot not on PATH" >&2; exit 127; }
   ```

Find the real dirs with `command -v copilot node git gh` in your interactive shell, then bake
those parents into the runner/plist. (If you drive Copilot through the `agency` CLI, also add
`~/.config/agency/CurrentVersion`, which lives outside the usual bin dirs.)

---

## Secrets

- Never paste tokens into a crontab, plist, or committed file in plaintext.
- Keep secrets in a `chmod 600` file the runner sources (`set -a; . "$HOME/.config/<task>/env";
  set +a`), or in the OS keychain/credential store fetched at runtime.
- Use `--secret-env-vars=NAME1,NAME2` so Copilot strips those values from shell/MCP environments
  and redacts them from output.
- Scope tokens to least privilege; rotate on a schedule.

---

## Troubleshooting matrix

| Symptom | Likely cause | Fix |
|---|---|---|
| Job "runs" but nothing happens, log empty | `copilot`/`node` not on the scheduler `PATH` | Set `PATH` in plist/cron/systemd **and** defensively in the runner; test with `env -i`. |
| Run hangs before doing work | Missing `--allow-all-tools` or a question via `ask_user` | Add `--allow-all-tools` and `--no-ask-user`. |
| Run appears done but `-p --autopilot` never exits | Background shell/agent work outlived the turn | Set `COPILOT_TASK_WAIT_TIMEOUT_SECONDS`; keep the runner `TIMEOUT_SECS` outer watchdog. |
| `not authenticated` / model calls fail | No stored login for this user, or wrong `COPILOT_HOME` | `copilot login` as that user, or export `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`. |
| Task works by hand, fails only when scheduled | Interactive-only env (`PATH`/auth from `~/.bashrc`) | Move all env into the runner; re-test under `env -i`. |
| Project extension or its tools silently missing in `-p` | Project extensions don't load in prompt mode by default | Set `GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS=true` in the runner. |
| Shell commands, file reads, or network blocked only when scheduled | The OS sandbox is on and its policy differs from the tested setup | Pin and test the intended mode during setup. Prefer `--sandbox` with an explicit policy; use `--no-sandbox` only when policy permits and the risk is accepted. |
| Sandboxed command cannot reach a host/localhost service | Host network access is blocked by the 1.0.83 sandbox policy | Set `sandbox.userPolicy.network.allowLocalNetwork` only for jobs that require it. |
| Linux sandbox fails before running the command | `bwrap` or a private-network-namespace prerequisite is unavailable or incompatible | Provide `bwrap` 0.5.0+, `slirp4netns`, util-linux 2.35+ (`unshare` with `--map-current-user` and `--keep-caps`, plus `nsenter`), `iptables`, `ip6tables`, both restore binaries, read/write `/dev/net/tun`, and normally the `nf_tables` backend on an unprivileged host. The host probe checks only `bwrap`, so use the MXC startup error to identify the missing prerequisite. If policy enforces sandboxing, provision the host or contact the administrator rather than trying to disable it. |
| `git push` fails or hangs | Interactive credential helper, no keychain under scheduler | `gh auth setup-git` or SSH key in agent; verify with `git push --dry-run` under `env -i`. |
| `gh pr create`: *Could not resolve to a Repository* | Wrong `gh` active account | Export `GH_TOKEN` for the repo owner for that run. |
| Two runs clobber each other | Overlapping fire with no lock | Add the single-flight lock (see `templates/runner.sh`). |
| Missed run never happened | Machine asleep/off; cron skips | Use launchd (fires on wake), systemd `Persistent=true`, or Task Scheduler "run if missed". |
| Mid-run CLI upgrade changes behavior | Auto-update fired | `--no-auto-update` / `COPILOT_AUTO_UPDATE=false`. |
| Hung run never hits a hard cap | `TIMEOUT_SECS` set too high or `0` | The runner's built-in polling watchdog enforces `TIMEOUT_SECS` natively (no `coreutils`/`timeout` needed): it group-signals TERM then KILL to the whole `copilot` process tree. Lower `TIMEOUT_SECS`; `0` disables it. |
| Can't tell what the run did | No transcript | Add `--share[=path]` and/or `--output-format json`; raise `--log-level`. |
