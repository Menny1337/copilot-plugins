---
name: scheduled-skill-review
description: "Manages the macOS daemon that reviews this marketplace's used plugin agents and skills, deploys validated improvements, and reverts regressions. Use to install, run, pause, configure, monitor, or inspect scheduled reviews and menu-bar status."
user-invocable: true
compatibility: "Requires macOS, launchd, Git, Node.js, GitHub CLI, Agency, and the meta plugin."
---

# Scheduled Skill/Agent Review (autonomous, self-deploying)

The unattended companion to `skill-improvement-loop`. That skill evolves **one**
unit from real-session evidence interactively; this one runs the whole thing on a
schedule, across **all** units that were actually used, deploys what passes, and
reverts what regresses — with a menu-bar control surface for the human.

## When to Use

- Install or operate this marketplace's macOS `plugin` skill/agent review daemon.
- Run, pause, configure, monitor, or inspect review cycles and menu-bar status.
- Diagnose a daemon cycle, deployment, re-review, or automatic revert.

## When to Skip

- Schedule a different unattended Copilot task — use `scheduled-headless-copilot`.
- Improve one agent or skill interactively from session evidence — use `skill-improvement-loop`.
- Run a static structural review without session evidence — use `agent-skill-audit`.
- Target Linux or Windows — this implementation requires macOS and `launchd`.

Everything lives under the workspace `~/.copilot/agent-architect/skill-reviews/`
(config, durable cycle records, run logs, manifests, digests). The skill, its
scripts, and docs live in this repo.

## When this runs

`launchd` invokes the orchestrator at a configured hour daily (see
`references/setup-schedule.md`). The orchestrator is `agent-architect` running
headless via Agency; it must stay **lean** — it dispatches per-unit reviews to
isolated subprocesses and never reads raw transcripts itself.

## What it does each cycle

1. **Scan usage** — `scripts/scan-usage.mjs` reads each session's
   `events.jsonl` (`skill.invoked`, the agent that ran, `tool.execution_complete`
   failures, user corrections) since an **event-time watermark**, filtered to this
   repo's `plugin` skills and agents. Read-only. Honors include/exclude and
   **excludes self-generated review sessions**. Emits a usage manifest + coverage note.
2. **Select work** — `scripts/lifecycle.mjs select`: a unit becomes a **new
   candidate** if it has ≥ `signalThreshold` relevant sessions and no open cycle; a
   deployed unit whose observation window has elapsed becomes a **due re-review**.
   One change per unit per cycle.
3. **Review in isolation** — for each selected unit (bounded concurrency),
   `scripts/run-batch-review.sh` creates a git worktree + sanitized branch and runs
   `agency copilot -p --agent meta:agent-architect -C <worktree> "run
   skill-improvement-loop on <unit> …"`. The subprocess harvests/diagnoses/patches
   (or does post-deploy Phase E, or proposes a revert), runs `validate.mjs` +
   `catalog.mjs`, commits, and writes a **result JSON** (`skill-review-result/1`)
   to a git-excluded file **inside its worktree** (the subprocess's permission
   boundary forbids writing above the worktree into the `runs/` tree); the
   orchestrator then copies that handoff into `runs/<id>/results/<unit>.json` and
   canonicalizes it (schema/identity check; a patch-like action with no real commit
   is downgraded to `no-change`).
4. **Integrate (serialized, no half-deploys)** — for each passing change the daemon
   first runs `version.mjs apply` so the plugin source change is governed (bumps
   `plugin.json` + the marketplace entry, writes a populated `CHANGELOG.md` section, and
   bumps `metadata.version`; the bump level is derived from the subprocess's Conventional
   Commit), commits that, then regenerates the catalog. Auto-merge units are merged to
   `main` one at a time; pr-mode units get the same bump+catalog on their branch before
   the PR is pushed (so CI's `version.mjs check` passes). `validate.mjs` +
   `catalog.mjs --check` must pass, then push → plugin refresh. Any failure
   resets to the configured remote/default branch and leaves the proposal branch + a
   loud notification. `deployed_at` = the plugin-refresh completion time.
5. **Digest + bookkeeping** — `scripts/make-digest.mjs` assembles a human-friendly
   markdown digest; cycle records + run log persist; the watermark advances over the
   scanned range only; notify on apply/revert (Teams via `m365-messaging` if
   connected, else a note).

## Deploy lifecycle (durable, per unit)

```
candidate → proposed(branch+commit, validated) → integrated(merged+pushed)
→ deployed(plugin refresh done; deployed_at set; review due = deployed_at + window)
→ observing → closed | regressed → revert(merge revert→push→plugin refresh) → deployed → …
| failed (validation/push/auth failure — isolated, never touches a broken main)
```

A pr-mode unit instead becomes **pr** (branch+commit+open PR) and waits there until you
merge it on GitHub; the next run reconciles the merged PR into **deployed** (using the
PR's `mergedAt`) — see `references/setup-schedule.md` §3a.

Re-review (Phase E) runs **only after deploy**, against post-deploy sessions, so the
verdict reflects the real, live change. "Insufficient evidence" extends the window
rather than closing the cycle.

## Control surface

`scripts/daemon-ctl.sh` writes `config.json` and reports state; the native
`SkillReviewMenuBar` app installed by `scripts/menubar-install.sh` renders it and wires the dropdown actions:

| Command | Effect |
| --- | --- |
| `status` | JSON: enabled/paused, running, open cycles, due re-reviews, last run |
| `pause` / `resume` | soft pause (`enabled=false`; orchestrator no-ops, still heartbeats) |
| `run-now` | trigger a cycle immediately |
| `review-unit <name>` | force a specific unit into the next selection |
| `include <name>` / `exclude <name>` / `unset <name>` | scope which units are eligible |
| `deploy-default <auto\|pr>` | set the default deploy policy for unlisted units |
| `auto-merge <name>` / `review-pr <name>` | pin a unit to auto-merge or review-PR (cleared by `unset`) |
| `config-get` / `config-set` | print the full effective config / apply a JSON patch from stdin (backs the settings window) |
| `open-digest` / `open-config` | open the latest digest / config |

The menu bar's `Settings…` action opens a native form (`ConfigWindow`) that edits
`config.json` through `config-get`/`config-set` instead of raw JSON; see
`references/menubar.md`.

Hard stop = `launchctl unload` (see `references/setup-schedule.md`); soft pause keeps
the menu bar reporting "paused".

## Config (`config.json`)

`enabled`, `schedule{hour,minute,weekdays}` (`weekdays` = `0`–`6`, JS `getDay`
convention, `0`/`6` = Sun/Sat; empty = every day), `concurrency`, `autoDeploy`, `autoRevert`,
`deployMode` (`auto`|`pr` default for unlisted units), `autoMergeUnits[]`/`prUnits[]`
(per-unit policy pins), `revertDeployMode` (`auto`|`pr`|`unit`),
`include[]`/`exclude[]`, `signalThreshold`, `observationWindowDays`,
`firstRunLookbackDays`, `maxFirstRunSessions`, `repoDir` (**required** — absolute path
to the git working tree), `pluginDir`, `marketplaceName`, `selfMarker`, `branchPrefix`,
`defaultBranch`, `remoteName`, `notify`. Defaults live in `scripts/lib.mjs`
(`DEFAULT_CONFIG`); the file is created on first run.

## References

- `references/setup-schedule.md` — launchd plist, headless git-push auth, plugin-refresh
  wiring, exact Agency invocation, install/uninstall, dry-run, first-run cap.
- `references/menubar.md` — native menu-bar app install/uninstall, autostart, dropdown actions, and troubleshooting.
- `references/agent-signals.md` — agent-specific signals so agents are reviewed as
  agents (orchestration/delegation/scope), not as skills.

## Relationship to `skill-improvement-loop`

This skill **orchestrates and deploys**; `skill-improvement-loop` is the **per-unit
engine** (Phases A–F). Do not duplicate its A–F procedure here. Under this daemon,
"approval" is replaced by validated auto-deploy + post-deploy Phase E + auto-revert,
all git-tracked.
