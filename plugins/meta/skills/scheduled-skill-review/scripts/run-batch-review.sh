#!/usr/bin/env bash
# run-batch-review.sh — orchestrate one autonomous review cycle.
#
# Flow:
#   0. load config; honor soft-pause; acquire scheduler lock (stale-safe); sync
#      repoDir by verified fast-forward; abort if inspection state prevents sync
#   1. scan-usage.mjs        → runs/<id>/manifest.json
#   2. lifecycle select      → work list (new candidates + due re-reviews)
#   3. per unit (bounded concurrency): git worktree + branch, run the review
#      subprocess via `agency copilot -p ... --agent meta:agent-architect`,
#      which writes runs/<id>/results/<unit>.json and commits on its branch
#   4. SERIALIZED integration: merge auto units or prepare a PR branch, bump versions (version.mjs
#      apply: plugin.json + marketplace + CHANGELOG), generate catalog + plugin
#      READMEs, validate + check both outputs, then commit→push→plugin refresh
#   5. make-digest.mjs; advance watermark; record run; notify; release lock
#
# Flags: --only <unit>   review just one unit (ignores threshold + pause)
#        --dry-run        fetch + scan + select + stub results; no checkout/deploy
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS="$HOME/.copilot/agent-architect/skill-reviews"
CONFIG="$WS/config.json"
LOCK="$WS/lock"
LOGDIR="$WS/logs"
mkdir -p "$WS" "$LOGDIR" "$WS/runs"

ONLY=""
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOGDIR/daemon.log" >&2; }

# Read a config scalar (dot-path, e.g. "schedule.hour"), with DEFAULT_CONFIG merged
# in so keys absent from config.json still resolve to their defaults.
cfg_get() {
  node --input-type=module -e "
    const { loadConfig } = await import('${DIR}/lib.mjs');
    const c = loadConfig();
    let v = c; for (const p of process.argv[1].split('.')) { v = (v==null?undefined:v[p]); }
    process.stdout.write(v==null?'':String(v));
  " "$1"
}

ENABLED="$(cfg_get enabled)"
REPO_DIR="$(cfg_get repoDir)"
PLUGIN_DIR="$(cfg_get pluginDir)"
MARKETPLACE_NAME="$(cfg_get marketplaceName)"
DEFAULT_BRANCH="$(cfg_get defaultBranch)"; [ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH="main"
REMOTE_NAME="$(cfg_get remoteName)"; [ -n "$REMOTE_NAME" ] || REMOTE_NAME="origin"
AUTO_DEPLOY="$(cfg_get autoDeploy)"
CONCURRENCY="$(cfg_get concurrency)"; [ -n "$CONCURRENCY" ] || CONCURRENCY=2
SELF_MARKER="$(cfg_get selfMarker)"; [ -n "$SELF_MARKER" ] || SELF_MARKER="COPILOT_PLUGIN_SCHEDULED_REVIEW"
GH_ACCOUNT="$(cfg_get ghAccount)"

# gh account pinning helper (exports GH_TOKEN for THIS run so a stray global
# `gh auth switch` can't silently break PR creation / reconcile — see the file).
# shellcheck source=gh-pin-account.sh
. "$DIR/gh-pin-account.sh"

# 0a. Soft pause (unless a forced single-unit run).
if [ "$ENABLED" = "false" ] && [ -z "$ONLY" ]; then
  log "paused (config.enabled=false) — heartbeat only"
  exit 0
fi

# 0b. Scheduler lock (stale-safe). The lock dir holds a pid file.
acquire_lock() {
  if mkdir "$LOCK" 2>/dev/null; then echo $$ > "$LOCK/pid"; return 0; fi
  local oldpid; oldpid="$(cat "$LOCK/pid" 2>/dev/null || echo '')"
  if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
    log "another run (pid $oldpid) holds the lock — exiting"; exit 0
  fi
  log "removing stale lock (pid ${oldpid:-none})"; rm -rf "$LOCK"
  mkdir "$LOCK" && echo $$ > "$LOCK/pid"
}
acquire_lock
cleanup() { rm -rf "$LOCK"; }
trap cleanup EXIT INT TERM

if [ -z "$REPO_DIR" ] || [ ! -d "$REPO_DIR" ]; then
  log "ERROR: config.repoDir is unset or missing ('$REPO_DIR'). Cannot proceed."
  exit 2
fi

# 0c. Sync repoDir to the latest default branch BEFORE anything reads it (scan-usage,
# worktree branch-cutting, integrate). Only a clean default checkout may advance
# by verified fast-forward. Local unpushed/diverged commits and dirty or non-default
# checkouts may be failed-operation inspection state; preserve them across runs.
#
# Self-update: this script lives inside repoDir, so the sync may replace this very file.
# git swaps files via atomic rename (new inode) and the running bash keeps the original
# inode open through its script fd, so the in-flight run finishes on the already-loaded
# code; worktrees are cut from the freshly-synced <branch> (so units under review are
# current), and the next launchd invocation picks up the updated orchestrator.
checkout_is_clean() {
  local status
  status="$(git status --porcelain --untracked-files=all)" || return 1
  [ -z "$status" ]
}

default_checkout_is_clean() {
  local current
  current="$(git symbolic-ref --quiet --short HEAD)" || return 1
  [ "$current" = "$DEFAULT_BRANCH" ] && checkout_is_clean
}

sync_repo() {
  ( cd "$REPO_DIR" || return 1
    local head remote_head
    default_checkout_is_clean || { log "ERROR: unsafe sync checkout; preserving inspection state"; return 1; }
    head="$(git rev-parse HEAD)" || return 1
    git fetch "$REMOTE_NAME" "$DEFAULT_BRANCH" >>"$LOGDIR/daemon.log" 2>&1 \
      || { log "ERROR: git fetch failed; not syncing"; return 1; }
    default_checkout_is_clean && [ "$(git rev-parse HEAD)" = "$head" ] \
      || { log "ERROR: checkout changed during fetch; preserving inspection state"; return 1; }
    remote_head="$(git rev-parse --verify "$REMOTE_NAME/$DEFAULT_BRANCH^{commit}")" || return 1
    git merge-base --is-ancestor "$head" "$remote_head" >>"$LOGDIR/daemon.log" 2>&1 \
      || { log "ERROR: sync is not a verified fast-forward; preserving local commits for inspection"; return 1; }
    git merge --ff-only "$remote_head" >>"$LOGDIR/daemon.log" 2>&1 \
      || { log "ERROR: fast-forward failed; preserving checkout for inspection"; return 1; }
    default_checkout_is_clean && [ "$(git rev-parse HEAD)" = "$remote_head" ] \
      || { log "ERROR: sync result is unverified; preserving checkout for inspection"; return 1; }
    log "repo synced: $DEFAULT_BRANCH @ $remote_head"
  )
}
if [ "$DRY_RUN" = "1" ]; then
  ( cd "$REPO_DIR" && default_checkout_is_clean \
      || { log "ERROR: unsafe dry-run checkout; preserving inspection state"; exit 1; }
    git fetch "$REMOTE_NAME" "$DEFAULT_BRANCH" >>"$LOGDIR/daemon.log" 2>&1 \
      || { log "ERROR: dry-run fetch failed"; exit 1; }
    behind="$(git rev-list "$DEFAULT_BRANCH..$REMOTE_NAME/$DEFAULT_BRANCH" --count)" || exit 1
    log "dry-run: $DEFAULT_BRANCH is $behind commit(s) behind $REMOTE_NAME/$DEFAULT_BRANCH (no sync performed)" ) \
      || exit 1
else
  sync_repo || { log "ERROR: repo sync failed — aborting run"; exit 1; }
  # Ensure gh targets the repo-owner account before any PR/reconcile work. Pins
  # GH_TOKEN for this process (and its reconcile child), not the global active
  # account; no-ops if the active account already resolves the repo.
  pin_gh_account
fi

RUN_ID="$(date -u +%Y%m%d-%H%M%S)"
RUN_DIR="$WS/runs/$RUN_ID"
mkdir -p "$RUN_DIR/results" "$RUN_DIR/wt" "$RUN_DIR/external"
log "run $RUN_ID started (dry-run=$DRY_RUN only='${ONLY}')"

# 1. Scan usage (read-only).
MANIFEST="$RUN_DIR/manifest.json"
if ! node "$DIR/scan-usage.mjs" --repo "$REPO_DIR" --out "$MANIFEST" >/dev/null; then
  log "ERROR: scan-usage failed"; exit 1
fi

# 1b. Reconcile any PRs awaiting human merge BEFORE selecting work, so a just-merged
# PR's unit can be picked up for its post-deploy re-review in this same run. The
# shared reconciler (foreground here) advances merged→deployed / closed→closed and
# refreshes installed plugins; it self-locks and is a no-op without gh.
if [ "$DRY_RUN" = "0" ]; then bash "$DIR/reconcile-prs.sh" || true; fi

# 2. Select work.
WORK="$RUN_DIR/work.json"
if [ -n "$ONLY" ]; then
  # Forced single-unit: synthesize a work item (determine type from manifest/repo).
  ONLY="$ONLY" MANIFEST="$MANIFEST" REPO_DIR="$REPO_DIR" node --input-type=module -e "
    import { readFileSync, existsSync } from 'node:fs';
    import { join } from 'node:path';
    const m=JSON.parse(readFileSync(process.env.MANIFEST,'utf8'));
    const u=process.env.ONLY;
    let type=(m.ourUnits?.skills||[]).includes(u)?'skill':((m.ourUnits?.agents||[]).includes(u)?'agent':'skill');
    const work={selectedAt:new Date().toISOString(),count:1,work:[{mode:'review',unit:u,type}]};
    process.stdout.write(JSON.stringify(work,null,2));
  " > "$WORK"
else
  node "$DIR/lifecycle.mjs" select --manifest "$MANIFEST" --out "$WORK" >/dev/null
fi

# Extract work items as TSV: mode<TAB>unit<TAB>type<TAB>cycleId
WORK_TSV="$(WORK="$WORK" node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  const w=JSON.parse(readFileSync(process.env.WORK,'utf8'));
  for(const it of (w.work||[])) process.stdout.write([it.mode,it.unit,it.type,it.cycleId||''].join('\t')+'\n');
")"

if [ -z "$WORK_TSV" ]; then
  log "no work selected this run"
  node "$DIR/make-digest.mjs" --run "$RUN_ID" >/dev/null || true
  # Durable state mutations (watermark advance + run record) must not happen on a
  # dry-run — it is a read-only preview.
  if [ "$DRY_RUN" = "0" ]; then
    node "$DIR/lifecycle.mjs" advance-watermark --to-manifest "$MANIFEST" >/dev/null || true
    node "$DIR/lifecycle.mjs" record-run --json "{\"runId\":\"$RUN_ID\",\"reviewed\":0,\"applied\":0,\"reverted\":0,\"prs\":0,\"failed\":0,\"status\":\"ok\"}" >/dev/null || true
  fi
  log "run $RUN_ID complete (nothing to do)"
  exit 0
fi

# 3. Per-unit review subprocesses (bounded concurrency, portable to bash 3.2).
# Ensure the `agency` CLI is resolvable even under a minimal PATH. The launchd agent
# runs with a reduced PATH that omits ~/.config/agency (where the agency CLI installs),
# so `command -v agency` fails and EVERY review silently degrades to a no-op stub.
# Self-heal by prepending the known install dir if agency isn't already on PATH.
if ! command -v agency >/dev/null 2>&1; then
  for d in "$HOME/.config/agency/CurrentVersion" "$HOME/.config/agency"/*; do
    [ -x "$d/agency" ] || continue
    PATH="$d:$PATH"; export PATH; break
  done
fi
have_agency=0
if command -v agency >/dev/null 2>&1; then
  have_agency=1
else
  log "WARNING: agency CLI not found on PATH or under ~/.config/agency — reviews will run as no-op stubs"
fi

review_external_unit() {
  local mode="$1" unit="$2" type="$3" cycleId="$4" skillPath="$5"
  local safe="$6" result="$7"
  local cid stage manifest stagedSkill backup localResult applyOut applyErr action
  stage="$RUN_DIR/external/$safe"
  manifest="$RUN_DIR/external/$safe.stage.json"
  stagedSkill="$stage/SKILL.md"
  backup="$RUN_DIR/external/$safe.original-SKILL.md"
  localResult="$stage/.review-result.json"
  applyErr="$RUN_DIR/results/$safe.apply.err"

  if [ -n "$cycleId" ]; then cid="$cycleId";
  else cid="$(node "$DIR/lifecycle.mjs" open --unit "$unit" --type "$type" --mode "$mode" --run "$RUN_ID" --source external --source-path "$skillPath")"; fi

  if [ ! -f "$skillPath" ] || [ "$(basename "$skillPath")" != "SKILL.md" ]; then
    printf '%s\n' '{"schema":"skill-review-result/1","unit":"'"$unit"'","unitType":"skill","source":"external","action":"failed","notes":"configured external SKILL.md is missing"}' > "$result"
    node "$DIR/lifecycle.mjs" ingest-result "$cid" "$result" >/dev/null 2>&1 || true
    node "$DIR/lifecycle.mjs" set "$cid" status=failed >/dev/null 2>&1 || true
    return
  fi

  if ! node "$DIR/external-skill-stage.mjs" stage \
      --source "$skillPath" --destination "$stage" --manifest "$manifest" \
      >"$RUN_DIR/external/$safe.stage-output.json" 2>"$RUN_DIR/external/$safe.stage.err"; then
    printf '%s\n' '{"schema":"skill-review-result/1","unit":"'"$unit"'","unitType":"skill","source":"external","action":"failed","notes":"could not stage external skill safely"}' > "$result"
    node "$DIR/lifecycle.mjs" ingest-result "$cid" "$result" >/dev/null 2>&1 || true
    node "$DIR/lifecycle.mjs" set "$cid" status=failed >/dev/null 2>&1 || true
    return
  fi
  cp "$skillPath" "$backup"
  node "$DIR/lifecycle.mjs" set "$cid" backupPath="$backup" >/dev/null 2>&1 || true

  if [ "$have_agency" = "0" ]; then
    log "review $unit: external stub (agency unavailable)"
    printf '%s\n' '{"schema":"skill-review-result/1","unit":"'"$unit"'","unitType":"skill","source":"external","action":"no-change","rootCauseLayer":"none","evidenceGrade":"weak-inferred","sessionsConsidered":0,"changeSummary":null,"verdict":null,"notes":"stub: agency unavailable"}' > "$result"
  else
    local prompt="[$SELF_MARKER run=$RUN_ID] You are running the skill-improvement-loop on the external skill \"$unit\". Mode: $mode. The user explicitly authorized an in-place change without marketplace git governance. Work ONLY in this staged skill directory: $stage. It intentionally contains only the selected SKILL.md so unrelated neighboring files and the source path are never exposed to this subprocess. The orchestrator applies a validated SKILL.md afterward. Modify ONLY '$stagedSkill'. Do not create, edit, rename, or delete any other file. Do not run marketplace versioning, catalog generation, git commit, push, PR, or deployment steps. Use evidence from past sessions, make at most ONE focused change, and validate the resulting SKILL.md frontmatter and instructions. Then write your JSON result atomically to '$localResult' using '$localResult.tmp'. JSON keys: schema='skill-review-result/1', unit, unitType='skill', action(patched|no-change|re-review|revert|failed), rootCauseLayer, evidenceGrade, sessionsConsidered, changeSummary, diffStat, verdict, notes (all redacted, no secrets)."
    ( cd "$stage" && agency copilot \
        --no-config-plugins \
        --plugin "local:$PLUGIN_DIR" \
        --agent meta:agent-architect \
        -p "$prompt" \
        --disable-mcp-server computer-use \
        --allow-all-tools ) >>"$LOGDIR/review-$safe-$RUN_ID.log" 2>&1 || true
    if [ -f "$localResult" ]; then
      cp "$localResult" "$result"
    else
      printf '%s\n' '{"schema":"skill-review-result/1","unit":"'"$unit"'","unitType":"skill","source":"external","action":"failed","notes":"external review produced no result JSON"}' > "$result"
    fi
  fi

  # Canonicalize identity before deciding whether a staged edit is eligible to
  # touch the original file.
  RES="$result" UNIT="$unit" node --input-type=module -e "
    import { readFileSync, writeFileSync } from 'node:fs';
    const ok=['patched','no-change','re-review','revert','failed'];
    let r; try{r=JSON.parse(readFileSync(process.env.RES,'utf8'))}catch{r=null}
    if(!r||typeof r!=='object') r={action:'failed',notes:'unparseable external result JSON'};
    const action=ok.includes(r.action)?r.action:'failed';
    writeFileSync(process.env.RES, JSON.stringify({...r,schema:'skill-review-result/1',unit:process.env.UNIT,unitType:'skill',source:'external',action}));
  " 2>/dev/null || true
  action="$(RES="$result" node --input-type=module -e "import{readFileSync}from'node:fs';let r={};try{r=JSON.parse(readFileSync(process.env.RES,'utf8'))}catch{};process.stdout.write(r.action||'failed')")"

  if { [ "$action" = "patched" ] || [ "$action" = "revert" ]; } && [ "$AUTO_DEPLOY" != "false" ]; then
    if applyOut="$(node "$DIR/external-skill-stage.mjs" apply \
        --staged-skill "$stagedSkill" --source "$skillPath" --manifest "$manifest" \
        2>"$applyErr")"; then
      APPLY_OUT="$applyOut" RES="$result" node --input-type=module -e "
        import { readFileSync, writeFileSync } from 'node:fs';
        const applied=JSON.parse(process.env.APPLY_OUT);
        const r=JSON.parse(readFileSync(process.env.RES,'utf8'));
        if(!applied.changed) {
          r.action='no-change';
          r.notes=((r.notes||'')+' Staged SKILL.md was unchanged.').trim();
        } else {
          r.appliedInPlace=true;
        }
        writeFileSync(process.env.RES,JSON.stringify(r));
      "
      action="$(RES="$result" node --input-type=module -e "import{readFileSync}from'node:fs';process.stdout.write(JSON.parse(readFileSync(process.env.RES,'utf8')).action)")"
    else
      local applyMessage
      applyMessage="$(head -c 1000 "$applyErr" 2>/dev/null || echo 'in-place apply failed')"
      APPLY_MESSAGE="$applyMessage" RES="$result" node --input-type=module -e "
        import { readFileSync, writeFileSync } from 'node:fs';
        const r=JSON.parse(readFileSync(process.env.RES,'utf8'));
        r.action='failed';
        r.notes=((r.notes||'')+' In-place apply failed: '+process.env.APPLY_MESSAGE).trim();
        writeFileSync(process.env.RES,JSON.stringify(r));
      "
      action="failed"
    fi
  elif [ "$action" = "patched" ] || [ "$action" = "revert" ]; then
    RES="$result" node --input-type=module -e "
      import { readFileSync, writeFileSync } from 'node:fs';
      const r=JSON.parse(readFileSync(process.env.RES,'utf8'));
      r.action='no-change';
      r.notes=((r.notes||'')+' In-place apply skipped because autoDeploy is disabled; staged output remains in the run directory.').trim();
      writeFileSync(process.env.RES,JSON.stringify(r));
    "
    action="no-change"
  fi

  node "$DIR/lifecycle.mjs" ingest-result "$cid" "$result" >/dev/null 2>&1 || true
  case "$action" in
    patched|revert) node "$DIR/lifecycle.mjs" set "$cid" status=deployed >/dev/null ;;
    failed) node "$DIR/lifecycle.mjs" set "$cid" status=failed >/dev/null ;;
    *) node "$DIR/lifecycle.mjs" set "$cid" status=closed >/dev/null ;;
  esac
  rm -f "$localResult" "$localResult.tmp" 2>/dev/null || true
}

review_unit() {
  local mode="$1" unit="$2" type="$3" cycleId="$4"
  local safe; safe="$(echo "$unit" | sed 's/[^A-Za-z0-9._-]/-/g')"
  local branch="skill-review/$safe/$RUN_ID"
  local wt="$RUN_DIR/wt/$safe"
  local result="$RUN_DIR/results/$unit.json"
  # The copilot -p subprocess runs under a permission boundary that forbids writing
  # ABOVE its worktree (the canonical $result lives under ~/.copilot/.../runs, which
  # is read/write-blocked for it). Its only guaranteed-writable, orchestrator-known
  # location is its own worktree, so the result handoff is a git-excluded file there.
  local rbase=".review-result.json"
  local wt_result="$wt/$rbase"
  local tmp_result="$RUN_DIR/results/$safe.diagnostic.json"
  local unitMeta unitSource unitPath
  unitMeta="$(UNIT="$unit" TYPE="$type" MANIFEST="$MANIFEST" node --input-type=module -e "
    import { readFileSync } from 'node:fs';
    const m=JSON.parse(readFileSync(process.env.MANIFEST,'utf8'));
    const matches=(m.unitEntries||[]).filter(x =>
      x.name===process.env.UNIT && x.type===process.env.TYPE &&
      x.exists && !x.conflict
    );
    const e=matches.length===1?matches[0]:null;
    process.stdout.write(e ? e.source+'\\t'+e.path : 'unresolved\\t');
  ")"
  unitSource="${unitMeta%%$'\t'*}"
  unitPath="${unitMeta#*$'\t'}"

  if [ "$unitSource" = "unresolved" ]; then
    log "review $unit: source is missing or ambiguous"
    echo '{"schema":"skill-review-result/1","unit":"'"$unit"'","unitType":"'"$type"'","action":"failed","notes":"review source is missing or ambiguous"}' > "$result"
    return
  fi

  # Dry-run is a selection PREVIEW: it must not mutate durable state (no lifecycle
  # cycle, no git worktree/branch, no lifecycle set/ingest). Emit only a run-local
  # stub result so the summary can still count "would review N". (A real run with
  # no `agency` binary is NOT short-circuited here — it keeps full lifecycle
  # accounting via the stub path below so its cycle trail is preserved.)
  if [ "$DRY_RUN" = "1" ]; then
    log "review $unit: dry-run preview (lifecycle not opened)"
    echo '{"schema":"skill-review-result/1","unit":"'"$unit"'","unitType":"'"$type"'","source":"'"$unitSource"'","action":"no-change","rootCauseLayer":"none","evidenceGrade":"weak-inferred","sessionsConsidered":0,"changeSummary":null,"verdict":null,"notes":"dry-run preview; lifecycle not opened"}' > "$result"
    return
  fi

  if [ "$unitSource" = "external" ]; then
    review_external_unit "$mode" "$unit" "$type" "$cycleId" "$unitPath" "$safe" "$result"
    return
  fi

  # Open (or reuse) a lifecycle cycle.
  local cid
  if [ -n "$cycleId" ]; then cid="$cycleId";
  else cid="$(node "$DIR/lifecycle.mjs" open --unit "$unit" --type "$type" --mode "$mode" --run "$RUN_ID" --branch "$branch" --source "$unitSource" --source-path "$unitPath")"; fi

  # Create a clean worktree off the default branch.
  ( cd "$REPO_DIR" && git worktree add -B "$branch" "$wt" "$DEFAULT_BRANCH" ) >>"$LOGDIR/daemon.log" 2>&1 \
    || { log "worktree create failed for $unit"; echo '{"schema":"skill-review-result/1","unit":"'"$unit"'","unitType":"'"$type"'","action":"failed","notes":"worktree create failed"}' > "$result"; return; }

  # Hide the result-handoff file from git in this worktree so it can never be staged,
  # committed, or dirty the subprocess's clean-tree checks.
  local ex; ex="$(git -C "$wt" rev-parse --git-path info/exclude 2>/dev/null || echo '')"
  [ -n "$ex" ] && ( cd "$wt" && printf '%s\n' "$rbase" >> "$ex" ) 2>/dev/null || true

  local prompt="[$SELF_MARKER run=$RUN_ID] You are running the skill-improvement-loop on the $type \"$unit\". Mode: $mode. Working tree: $wt. Use evidence from past sessions. If mode is re-review, run Phase E against post-deploy sessions. Make at most ONE governed change to this $type only. Before committing, run 'node scripts/catalog.mjs', 'node scripts/plugin-readme.mjs', 'node scripts/validate.mjs', 'node scripts/catalog.mjs --check', and 'node scripts/plugin-readme.mjs --check' in that order. Stop on any generator or check failure: report action=failed and do not commit a change that failed validation. Otherwise commit your change and generated documentation on the current branch with a Conventional Commit message and the Copilot co-author trailer. Use an ACCURATE Conventional Commit type — the plugin version bump is derived from it (feat → minor; fix/docs/refactor/chore/etc → patch; a '!' suffix or 'BREAKING CHANGE:' footer → major). Do NOT hand-edit plugin.json, marketplace.json, or CHANGELOG.md — the orchestrator runs 'node scripts/version.mjs apply' to bump the version and write the changelog automatically at integration, so a manual bump would only conflict. Then, AFTER committing (or after reporting failure without a commit), write your JSON result by writing to '$wt_result.tmp' and renaming it to '$wt_result' (atomic). IMPORTANT: write ONLY to that path inside your worktree — paths above the worktree (e.g. the runs/ tree) are not writable from here, so do not attempt them. JSON keys: schema='skill-review-result/1', unit, unitType, action(patched|no-change|re-review|revert|failed), rootCauseLayer, evidenceGrade, sessionsConsidered, changeSummary, diffStat, verdict, notes (all redacted, no secrets)."

  if [ "$have_agency" = "0" ]; then
    log "review $unit: stub (agency unavailable)"
    echo '{"schema":"skill-review-result/1","unit":"'"$unit"'","unitType":"'"$type"'","action":"no-change","rootCauseLayer":"none","evidenceGrade":"weak-inferred","sessionsConsidered":0,"changeSummary":null,"verdict":null,"notes":"stub: dry-run or agency unavailable"}' > "$result"
  else
    # --no-config-plugins makes the reviewer's plugin set hermetic: load ONLY the
    # explicit --plugin below. Without it, Agency merges every `agency.toml`
    # `[plugins].default` discovered by walking up from cwd — and because the
    # worktree lives under ~/.copilot, that walk finds BOTH the worktree's own
    # repo config (relative `local:./plugins/*` → the worktree) AND the ancestor
    # ~/.copilot/agency.toml (absolute paths → the live checkout). Agency 2026.6.28+
    # treats two local sources sharing a plugin folder name (e.g. core-skills)
    # as a fatal conflict and aborts before the agent loads, so every review then
    # fails with "subprocess produced no result JSON".
    #
    # User settings are a separate source: a globally enabled computer-use MCP is
    # still loaded despite --no-config-plugins. Reviews never automate the desktop,
    # so exclude it to avoid unnecessary macOS Accessibility prompts whenever
    # Agency's CurrentVersion symlink advances to a new versioned executable path.
    ( cd "$wt" && agency copilot \
        --no-config-plugins \
        --plugin "local:$PLUGIN_DIR" \
        --agent meta:agent-architect \
        -p "$prompt" \
        --disable-mcp-server computer-use \
        --allow-all-tools ) >>"$LOGDIR/review-$safe-$RUN_ID.log" 2>&1 || true
    # Resolve the result handoff (priority: direct canonical write, then the
    # worktree-internal file, then a run-local diagnostic fallback). The orchestrator is
    # unrestricted, so it copies whichever it finds into the canonical $result.
    local src="none"
    if [ -f "$result" ]; then src="direct"
    elif [ -f "$wt_result" ] && cp "$wt_result" "$result" 2>/dev/null; then src="worktree"
    elif [ -f "$tmp_result" ] && cp "$tmp_result" "$result" 2>/dev/null; then src="tmp"
    fi
    if [ ! -f "$result" ]; then
      echo '{"schema":"skill-review-result/1","unit":"'"$unit"'","unitType":"'"$type"'","action":"failed","notes":"subprocess produced no result JSON (no handoff at canonical/worktree/run-local diagnostic)"}' > "$result"
      src="none"
    fi
    log "review $unit: result source=$src"
    rm -f "$tmp_result" 2>/dev/null || true
  fi

  # Record commit (if the subprocess committed on the branch).
  local sha; sha="$( cd "$wt" 2>/dev/null && git rev-parse HEAD 2>/dev/null || echo '' )"
  local baseSha; baseSha="$( cd "$REPO_DIR" && git rev-parse "$DEFAULT_BRANCH" )"
  local hasCommit=0; [ -n "$sha" ] && [ "$sha" != "$baseSha" ] && hasCommit=1

  # Canonicalize/validate the result JSON: enforce schema + identity, restrict the
  # action to the allowlist, and downgrade a patch-like claim that has no real commit
  # on the branch (defense-in-depth; integration also only acts on 'proposed' cycles,
  # which require a real commit below).
  RES="$result" UNIT="$unit" TYPE="$type" HAS="$hasCommit" node --input-type=module -e "
    import { readFileSync, writeFileSync } from 'node:fs';
    const ok=['patched','no-change','re-review','revert','failed'];
    const can={schema:'skill-review-result/1',unit:process.env.UNIT,unitType:process.env.TYPE};
    let r; try{ r=JSON.parse(readFileSync(process.env.RES,'utf8')); }catch{ r=null; }
    if(!r||typeof r!=='object'){ writeFileSync(process.env.RES, JSON.stringify({...can,action:'failed',notes:'unparseable result JSON; canonicalized'})); process.exit(0); }
    let action=ok.includes(r.action)?r.action:'failed';
    let notes=typeof r.notes==='string'?r.notes:'';
    if((action==='patched'||action==='revert') && process.env.HAS!=='1'){ notes=('claimed '+r.action+' but no commit on branch; downgraded to no-change. '+notes).trim(); action='no-change'; }
    writeFileSync(process.env.RES, JSON.stringify({...r,...can,action,notes}));
  " 2>/dev/null || true

  # Persist the result's provenance (verdict/changeSummary/evidenceGrade/…) onto
  # the durable cycle record so it isn't lost when the run dir is pruned.
  [ -f "$result" ] && node "$DIR/lifecycle.mjs" ingest-result "$cid" "$result" >/dev/null 2>&1 || true

  if [ "$hasCommit" = "1" ]; then
    node "$DIR/lifecycle.mjs" set "$cid" status=proposed commit="$sha" branch="$branch" >/dev/null
  else
    node "$DIR/lifecycle.mjs" set "$cid" status=closed >/dev/null
  fi
}

# Bounded-concurrency launcher (portable; no `wait -n`).
running_jobs() { jobs -pr | wc -l | tr -d ' '; }
PIDS=""
while IFS=$'\t' read -r mode unit type cycleId; do
  [ -n "$unit" ] || continue
  while [ "$(running_jobs)" -ge "$CONCURRENCY" ]; do sleep 1; done
  review_unit "$mode" "$unit" "$type" "$cycleId" &
  PIDS="$PIDS $!"
done <<EOF
$WORK_TSV
EOF
for p in $PIDS; do wait "$p" 2>/dev/null || true; done

# Clean up worktrees now (before integration) so their branches are no longer
# "checked out" — integrate_one/open_pr operate on those branches in $REPO_DIR.
# Branches themselves are kept for traceability/rollback/PRs.
( cd "$REPO_DIR" && for d in "$RUN_DIR"/wt/*; do [ -d "$d" ] && git worktree remove --force "$d" 2>/dev/null || true; done; git worktree prune 2>/dev/null || true )

# 4. SERIALIZED integration (skip entirely on dry-run or autoDeploy=false).
applied=0; reverted=0; failed=0; deploy_failed=0; reviewed=0; prs=0
reviewed="$(printf '%s\n' "$WORK_TSV" | grep -c . || true)"

# Apply version governance for a just-committed plugin source change, then commit it.
# CI's `version.mjs check` (and repo rule 9) require any non-CHANGELOG change under
# plugins/<name>/ to bump plugin.json + the marketplace entry, add a populated CHANGELOG
# section, and bump marketplace metadata.version — so the daemon must do this on every
# branch it merges or opens a PR for, or the change is rejected. `version.mjs apply`
# runs on a clean tree (content already committed), derives the level from the
# Conventional Commit history (always ≥ patch for a changed plugin), and writes the
# bumps + changelog; we then commit them before both documentation generators.
# The catalog includes versions; plugin README generation intentionally excludes them.
# Caller must already be cd'd into $REPO_DIR.
# Predict exact version-owned bytes from the read-only planner and captured Git
# blobs. Keep this contract aligned with version.mjs's JSON/changelog writers.
version_owned_outputs() {
  node --input-type=module - "$1" "$2" "$3" <<'NODE'
    import { execFileSync } from "node:child_process";
    const [head, base, plan] = process.argv.slice(2);
    const git = args => execFileSync("git", args, { encoding: "utf8" });
    const read = path => {
      const bytes = execFileSync("git", ["show", head + ":" + path]);
      const text = bytes.toString("utf8");
      if (!Buffer.from(text).equals(bytes)) throw new Error("Non-UTF8 version snapshot: " + path);
      return text;
    };
    const json = path => JSON.parse(read(path));
    const levels = { none: 0, patch: 1, minor: 2, major: 3 };
    function semver(text) {
      if (!/^\d+\.\d+\.\d+$/.test(text)) throw new Error("Invalid snapshot version");
      const parts = text.split(".").map(Number);
      if (!parts.every(Number.isSafeInteger)) throw new Error("Unsafe snapshot version");
      return parts;
    }
    function bump(text, level) {
      const parts = semver(text), i = 3 - levels[level];
      parts[i]++;
      if (!Number.isSafeInteger(parts[i])) throw new Error("Unsafe bumped version");
      for (let j = i + 1; j < 3; j++) parts[j] = 0;
      return parts.join(".");
    }
    function alreadyBumped(from, current, level) {
      const a = semver(from), b = semver(current);
      for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return b[i] > a[i] && 3 - i >= levels[level];
      }
      return false;
    }
    try {
      const marketplacePath = ".github/plugin/marketplace.json";
      const marketplace = json(marketplacePath), outputs = {};
      let max = "none", count = 0;
      const header = "# Changelog\n\nAll notable changes to this plugin are documented here.\n" +
        "Format follows [Keep a Changelog](https://keepachangelog.com/); this project adheres to [Semantic Versioning](https://semver.org/).\n";
      for (const line of plan.split("\n").map(line => line.trim())) {
        if (line.startsWith("marketplace metadata.version:")) {
          if (!/^marketplace metadata\.version: (\(none\)|\d+\.\d+\.\d+) → needs ≥ (patch|minor|major) \(current (\(none\)|\d+\.\d+\.\d+)\)$/.test(line)) {
            throw new Error("Unsupported marketplace version summary");
          }
          continue;
        }
        if (line.includes(" → removed (needs marketplace major)")) {
          const name = line.split(/\s/)[0];
          if (marketplace.plugins.some(entry => entry.name === name)) throw new Error("Invalid removal plan");
          max = "major"; count++; continue;
        }
        if (!line.includes(" → needs ≥ ")) continue;
        const match = /^(\S+)\s+(\(new\)|\d+\.\d+\.\d+)\s+→ needs ≥ (patch|minor|major)\s+\(current (\d+\.\d+\.\d+), applied bump: \w+\)$/.exec(line);
        if (!match) throw new Error("Unsupported version planner output");
        const [, name, from, level, current] = match;
        const entry = marketplace.plugins.find(entry => entry.name === name);
        if (!entry || current !== entry.version) throw new Error("Version plan does not match snapshot");
        const dir = entry.source.replace(/^\.\//, "").replace(/\/$/, "");
        if (!/^plugins\/[A-Za-z0-9_-]+$/.test(dir)) throw new Error("Unsupported version-owned path");
        const manifestPath = dir + "/plugin.json", manifest = json(manifestPath);
        if (manifest.version !== current) throw new Error("Inconsistent snapshot versions");
        if (from !== "(new)" && alreadyBumped(from, current, level)) continue;
        const version = bump(from === "(new)" ? current : from, level);
        manifest.version = version; entry.version = version;
        outputs[manifestPath] = JSON.stringify(manifest, null, 2) + "\n";
        const changelogPath = dir + "/CHANGELOG.md";
        const tracked = git(["ls-tree", "--name-only", head, "--", changelogPath]).trim();
        const existing = tracked ? read(changelogPath) : header;
        const raw = git(["log", "--no-merges", "--format=%s", base + ".." + head, "--", dir]);
        const subjects = raw.split("\n").map(s => s.trim()).filter(Boolean);
        const section = [
          "## [" + version + "] - " + new Date().toISOString().slice(0, 10), "",
          "_" + level + " release._", "",
          ...(subjects.length ? subjects : ["Maintenance changes."]).map(s => "- " + s), "",
        ].join("\n");
        const idx = existing.indexOf("\n## ");
        outputs[changelogPath] = idx < 0
          ? (existing.endsWith("\n") ? existing : existing + "\n") + "\n" + section
          : existing.slice(0, idx + 1) + section + "\n" + existing.slice(idx + 1);
        if (levels[level] > levels[max]) max = level;
        count++;
      }
      if (!count && !plan.includes("No plugin source changes detected.") && !plan.includes(" → needs ≥ ")) {
        throw new Error("Unrecognized version plan");
      }
      if (count) {
        marketplace.metadata = marketplace.metadata ?? {};
        marketplace.metadata.version = bump(marketplace.metadata.version ?? "0.0.0", max);
        outputs[marketplacePath] = JSON.stringify(marketplace, null, 2) + "\n";
      }
      process.stdout.write(JSON.stringify(outputs));
    } catch (error) {
      console.error("Version snapshot failed: " + error.message);
      process.exitCode = 1;
    }
NODE
}

verify_version_outputs() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { execFileSync } from "node:child_process";
    const [head, staged] = process.argv.slice(1);
    const git = args => execFileSync("git", args);
    try {
      const outputs = JSON.parse(readFileSync(0, "utf8"));
      const current = git(["rev-parse", "HEAD"]).toString().trim();
      if (staged === "committed") {
        if (git(["rev-parse", "HEAD^"]).toString().trim() !== head) throw new Error("Unexpected version commit parent");
      } else if (current !== head) throw new Error("Version HEAD changed");
      const changed = new Set([
        ...git(["diff", "--name-only", "-z", head]).toString().split("\0"),
        ...git(["diff", "--cached", "--name-only", "-z", head]).toString().split("\0"),
        ...git(["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0"),
      ]);
      for (const path of changed) {
        if (path && !Object.hasOwn(outputs, path)) throw new Error("Unexpected version edit: " + path);
      }
      for (const [path, text] of Object.entries(outputs)) {
        if (!readFileSync(path).equals(Buffer.from(text))) throw new Error("Unexpected version content: " + path);
        const tracked = git(["ls-tree", "--name-only", head, "--", path]).toString().trim();
        const indexed = git(["ls-files", "--", path]).toString().trim();
        if (staged === "yes" || staged === "committed") {
          if (!git(["show", ":" + path]).equals(Buffer.from(text))) throw new Error("Unexpected version index: " + path);
          if (staged === "committed" && !git(["show", "HEAD:" + path]).equals(Buffer.from(text))) {
            throw new Error("Unexpected committed version content: " + path);
          }
        } else if (tracked) {
          if (!git(["show", ":" + path]).equals(git(["show", head + ":" + path]))) throw new Error("Concurrent version index: " + path);
        } else if (indexed) {
          throw new Error("Unexpected new version index: " + path);
        }
      }
    } catch (error) {
      console.error("Version ownership failed: " + error.message);
      process.exitCode = 1;
    }
  ' "$1" "$2"
}

bump_versions() {
  local unit="$1" base="$2" head plan outputs targets
  checkout_is_clean || { log "unsafe pre-version checkout for $unit"; return 1; }
  head="$(git rev-parse HEAD)" || return 1
  base="$(git merge-base "$base" "$head")" || { log "version base resolution failed for $unit"; return 1; }
  plan="$(node scripts/version.mjs plan --base "$base" --head "$head" 2>>"$LOGDIR/daemon.log")" || { log "version plan failed for $unit"; return 1; }
  checkout_is_clean && [ "$(git rev-parse HEAD)" = "$head" ] || { log "checkout changed during version planning for $unit"; return 1; }
  outputs="$(version_owned_outputs "$head" "$base" "$plan" 2>>"$LOGDIR/daemon.log")" || { log "version snapshot failed for $unit"; return 1; }
  checkout_is_clean && [ "$(git rev-parse HEAD)" = "$head" ] || { log "checkout changed before version apply for $unit"; return 1; }
  if ! node scripts/version.mjs apply --base "$base" >>"$LOGDIR/daemon.log" 2>&1; then
    log "version.mjs apply failed for $unit"
    return 1
  fi
  verify_version_outputs "$head" no <<<"$outputs" >>"$LOGDIR/daemon.log" 2>&1 \
    || { log "unexpected version edits for $unit; preserving checkout"; return 1; }
  targets="$(node -e 'for (const path of Object.keys(JSON.parse(require("fs").readFileSync(0,"utf8")))) console.log(path);' <<<"$outputs")" || return 1
  if [ -n "$targets" ]; then
    local paths=() path
    while IFS= read -r path; do paths+=("$path"); done <<<"$targets"
    git add -- "${paths[@]}" >>"$LOGDIR/daemon.log" 2>&1 || { log "version staging failed for $unit"; return 1; }
    verify_version_outputs "$head" yes <<<"$outputs" >>"$LOGDIR/daemon.log" 2>&1 \
      || { log "unexpected staged version edits for $unit; preserving checkout"; return 1; }
    git commit --only \
      -m "chore(release): bump versions after $unit review" \
      -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>" \
      -- "${paths[@]}" >>"$LOGDIR/daemon.log" 2>&1 \
      || { log "version commit failed for $unit; preserving checkout"; return 1; }
    verify_version_outputs "$head" committed <<<"$outputs" >>"$LOGDIR/daemon.log" 2>&1 \
      || { log "version commit result unverified for $unit; preserving checkout"; return 1; }
  fi
  checkout_is_clean || { log "version commit left a dirty checkout for $unit"; return 1; }
}

# Called from the target checkout after version governance. Both publication paths
# use this gate; a generator failure is not excused by previously fresh outputs.
generate_and_check_docs() {
  generated_changes_are_scoped "$1" || return 1
  node scripts/catalog.mjs >>"$LOGDIR/daemon.log" 2>&1 || return 1
  generated_changes_are_scoped "$1" || return 1
  node scripts/plugin-readme.mjs >>"$LOGDIR/daemon.log" 2>&1 || return 1
  node scripts/validate.mjs >>"$LOGDIR/daemon.log" 2>&1 || return 1
  node scripts/catalog.mjs --check >>"$LOGDIR/daemon.log" 2>&1 || return 1
  node scripts/plugin-readme.mjs --check >>"$LOGDIR/daemon.log" 2>&1 || return 1
}

# README paths contain authored content too. Check both index and working bytes
# outside the single generated region before staging, committing or restoring.
readme_authored_regions_are_unchanged() {
  node --input-type=module - "$1" >>"$LOGDIR/daemon.log" 2>&1 <<'NODE'
    import { readFileSync } from "node:fs";
    import { spawnSync } from "node:child_process";
    const head = process.argv[2];
    function git(args) {
      const result = spawnSync("git", args, { maxBuffer: 16 * 1024 * 1024 });
      if (result.error || result.status !== 0) {
        throw new Error("Cannot read Git ownership snapshot: " + args[0]);
      }
      return result.stdout;
    }
    function paths(buffer) {
      return buffer.toString("utf8").split("\0").filter(Boolean);
    }
    function authored(buffer, prefix, path) {
      const start = Buffer.from("<!-- " + prefix + ":start -->");
      const end = Buffer.from("<!-- " + prefix + ":end -->");
      const a = buffer.indexOf(start);
      const b = buffer.indexOf(end);
      if (a < 0 || b < a + start.length ||
          buffer.indexOf(start, a + start.length) !== -1 ||
          buffer.indexOf(end, b + end.length) !== -1) {
        throw new Error("Ambiguous or missing generated markers: " + path);
      }
      return { before: buffer.subarray(0, a), after: buffer.subarray(b + end.length) };
    }
    try {
      const candidates = new Set([
        ...paths(git(["ls-tree", "-r", "-z", "--name-only", head])),
        ...paths(git(["ls-files", "-z"])),
      ]);
      for (const path of candidates) {
        const prefix = path === "README.md" ? "mnm:catalog" :
          /^plugins\/[^/]+\/README\.md$/.test(path) ? "mnm:plugin-readme" : null;
        if (!prefix) continue;
        const baseline = authored(git(["show", head + ":" + path]), prefix, path);
        const index = authored(git(["show", ":" + path]), prefix, path);
        const working = authored(readFileSync(path), prefix, path);
        if (!baseline.before.equals(index.before) || !baseline.after.equals(index.after) ||
            !baseline.before.equals(working.before) || !baseline.after.equals(working.after)) {
          throw new Error("Authored README content changed: " + path);
        }
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
NODE
}

generated_changes_are_scoped() {
  local head="$1" untracked
  untracked="$(git ls-files --others --exclude-standard)" || return 1
  [ -z "$untracked" ] || return 1
  git diff --quiet "$head" -- . ':(exclude)CATALOG.md' ':(exclude)README.md' ':(exclude,glob)plugins/*/README.md' || return 1
  git diff --cached --quiet "$head" -- . ':(exclude)CATALOG.md' ':(exclude)README.md' ':(exclude,glob)plugins/*/README.md' || return 1
  readme_authored_regions_are_unchanged "$head"
}

# Restore only tracked generator outputs owned by this operation. Unexpected
# edits, new files or a changed HEAD are preserved and stop the integration batch.
restore_generated_docs() {
  local head="$1" current
  current="$(git rev-parse HEAD)" || return 1
  [ "$current" = "$head" ] && generated_changes_are_scoped "$head" || return 1
  git restore --source="$head" --staged --worktree -- CATALOG.md README.md ':(glob)plugins/*/README.md' >>"$LOGDIR/daemon.log" 2>&1 || return 1
  checkout_is_clean
}

return_to_default() {
  checkout_is_clean || return 1
  git checkout "$DEFAULT_BRANCH" >>"$LOGDIR/daemon.log" 2>&1 || return 1
  default_checkout_is_clean
}

recover_pr_checkout() {
  restore_generated_docs "$1" && return_to_default
}

recover_integration_checkout() {
  local base="$1" head="$2" current
  restore_generated_docs "$head" || return 1
  # The entry HEAD predates this operation's merge. --keep requires the verified
  # clean checkout and will not force away conflicting local work.
  git reset --keep "$base" >>"$LOGDIR/daemon.log" 2>&1 || return 1
  current="$(git rev-parse HEAD)" || return 1
  [ "$current" = "$base" ] && default_checkout_is_clean
}

# Status 3 means checkout safety is unverified; the caller must stop the batch.
# Ordinary failures return 1 only after recovery has restored a clean checkout.
integrate_one() {
  local cid="$1" unit="$2" branch="$3" action="$4"
  ( cd "$REPO_DIR" || return 3
    local base_head docs_head
    if ! default_checkout_is_clean; then
      log "unsafe integration checkout for $unit; preserving existing work"
      return 3
    fi
    base_head="$(git rev-parse HEAD)" || return 3
    if ! git merge --no-ff "$branch" -m "merge $branch" >>"$LOGDIR/daemon.log" 2>&1; then
      log "merge conflict for $unit; leaving as proposal"
      git merge --abort 2>>"$LOGDIR/daemon.log" && default_checkout_is_clean || return 3
      return 1
    fi
    # Govern versions before both generators. Only the catalog includes versions;
    # plugin README generation excludes them to avoid version-only stale outputs.
    if ! bump_versions "$unit" "$base_head"; then
      log "version bump failed after merging $unit; preserving checkout for recovery"
      return 3
    fi
    checkout_is_clean || { log "version governance left a dirty checkout for $unit"; return 3; }
    docs_head="$(git rev-parse HEAD)" || return 3
    # Generate and check both documentation outputs before committing or pushing.
    if ! generate_and_check_docs "$docs_head"; then
      log "documentation generation or validation failed after merging $unit — rolling back main"
      recover_integration_checkout "$base_head" "$docs_head" || return 3
      return 1
    fi
    generated_changes_are_scoped "$docs_head" || { log "unexpected edits during generation for $unit; preserving checkout"; return 3; }
    if ! git diff --quiet; then
      if ! { git add -u -- CATALOG.md README.md ':(glob)plugins/*/README.md' && generated_changes_are_scoped "$docs_head" && git commit --only -m "docs(catalog): regenerate catalog and plugin READMEs after $unit review" -- CATALOG.md README.md ':(glob)plugins/*/README.md'; } >>"$LOGDIR/daemon.log" 2>&1; then
        log "documentation commit failed after merging $unit — rolling back main"
        recover_integration_checkout "$base_head" "$docs_head" || return 3
        return 1
      fi
    fi
    checkout_is_clean || { log "documentation commit left a dirty checkout for $unit"; return 3; }
    docs_head="$(git rev-parse HEAD)" || return 3
    # No half-deploys: push must succeed, else undo the local merge.
    if ! git push "$REMOTE_NAME" "$DEFAULT_BRANCH" >>"$LOGDIR/daemon.log" 2>&1; then
      log "push failed for $unit — rolling back local merge (no half-deploy)"
      recover_integration_checkout "$base_head" "$docs_head" || return 3
      return 2
    fi
    return 0
  )
}

# Open a GitHub PR for a 'pr'-policy unit instead of merging. Pushes the proposal
# branch (with fresh catalog and plugin READMEs so CI's generated-output checks pass) and
# opens/looks-up a PR, writing its URL+number to results/<unit>.{prurl,prnum} for
# the caller. Never touches main. Returns 0 only if PR identity was captured.
open_pr() {
  local cid="$1" unit="$2" branch="$3" action="$4"
  local prurl_file="$RUN_DIR/results/$unit.prurl" prnum_file="$RUN_DIR/results/$unit.prnum"
  rm -f "$prurl_file" "$prnum_file"
  if ! command -v gh >/dev/null 2>&1; then
    log "gh unavailable — cannot open PR for $unit; leaving as proposal"; return 1
  fi
  local prepare_status=0
  ( cd "$REPO_DIR" || exit 3
    local docs_head base_head
    if ! default_checkout_is_clean; then
      log "unsafe PR checkout for $unit; preserving existing work"
      exit 3
    fi
    base_head="$(git rev-parse HEAD)" || exit 3
    if ! git checkout "$branch" >>"$LOGDIR/daemon.log" 2>&1; then
      log "checkout $branch failed for $unit"
      default_checkout_is_clean || exit 3
      exit 1
    fi
    # Govern versions before both generators on the proposal branch. The catalog
    # includes version numbers; plugin README generation intentionally excludes them.
    if ! bump_versions "$unit" "$base_head"; then
      log "version bump failed on PR branch for $unit — not opening PR"
      exit 3
    fi
    checkout_is_clean || { log "version governance left a dirty checkout for $unit"; exit 3; }
    docs_head="$(git rev-parse HEAD)" || exit 3
    # Regenerate documentation ON the branch so the branch is internally consistent
    # for CI; do NOT merge main in (avoids generated-file conflicts — GitHub will
    # surface any real merge conflicts for the human reviewer).
    if ! generate_and_check_docs "$docs_head"; then
      log "documentation generation or validation failed on PR branch for $unit — not opening PR"
      recover_pr_checkout "$docs_head" || exit 3
      exit 1
    fi
    generated_changes_are_scoped "$docs_head" || { log "unexpected edits during generation for $unit; preserving checkout"; exit 3; }
    if ! git diff --quiet; then
      if ! { git add -u -- CATALOG.md README.md ':(glob)plugins/*/README.md' && generated_changes_are_scoped "$docs_head" && git commit --only -m "docs(catalog): regenerate catalog and plugin READMEs for $unit review PR" -- CATALOG.md README.md ':(glob)plugins/*/README.md'; } >>"$LOGDIR/daemon.log" 2>&1; then
        log "documentation commit failed on PR branch for $unit — not opening PR"
        recover_pr_checkout "$docs_head" || exit 3
        exit 1
      fi
    fi
    checkout_is_clean || { log "documentation commit left a dirty checkout for $unit"; exit 3; }
    docs_head="$(git rev-parse HEAD)" || exit 3
    if ! git push -u "$REMOTE_NAME" "$branch" >>"$LOGDIR/daemon.log" 2>&1; then
      log "push of $branch failed for $unit — cannot open PR"
      recover_pr_checkout "$docs_head" || exit 3
      exit 1
    fi
    return_to_default || exit 3
    exit 0
  ) || prepare_status=$?
  [ "$prepare_status" -eq 0 ] || return "$prepare_status"
  # Build a rich, human-readable PR body from the persisted result provenance plus
  # the branch's diff (3-dot diff = PR semantics; 2-dot log = commits on the branch).
  # Fall back to a minimal one-liner if generation yields an empty file.
  local title safe_unit body_file filestat commits url num
  title="[skill-review] $action: $unit"
  safe_unit="$(printf '%s' "$unit" | sed 's/[^A-Za-z0-9._-]/-/g')"
  body_file="$RUN_DIR/results/$safe_unit.prbody.md"
  filestat="$( cd "$REPO_DIR" && git diff --stat "$DEFAULT_BRANCH...$branch" 2>/dev/null )"
  commits="$( cd "$REPO_DIR" && git log --format='- `%h` %s' "$DEFAULT_BRANCH..$branch" 2>/dev/null )"
  RES="$RUN_DIR/results/$unit.json" UNIT="$unit" RUNID="$RUN_ID" ACTION="$action" \
  FILESTAT="$filestat" COMMITS="$commits" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const e = process.env;
    let r = {};
    try { r = JSON.parse(readFileSync(e.RES, "utf8")) || {}; } catch {}
    const S = (x) => (x === undefined || x === null) ? "" : String(x);
    const cap = (x, n) => { const s = S(x).trim(); return s.length > n ? s.slice(0, n) + "\n\n_…(truncated)_" : s; };
    const v = (x, d) => { const s = cap(x, 4000); return s === "" ? d : s; };
    const type = S(r.unitType) || "unit";
    const action = S(r.action) || S(e.ACTION) || "patched";
    const o = [];
    o.push("## 🤖 Autonomous skill-review proposal");
    o.push("");
    o.push("**Unit:** `" + S(e.UNIT) + "` (" + type + ")  ·  **Action:** `" + action + "`  ·  **Run:** `" + S(e.RUNID) + "`");
    o.push("");
    o.push("Opened by the **scheduled-skill-review** daemon: it reviewed this " + type + " with the `skill-improvement-loop` against recent session evidence and made a single governed change. **Review the diff and merge to deploy** — on its next run the daemon reconciles the merge and opens the post-deploy observation window.");
    o.push("");
    o.push("### What changed");
    o.push(v(r.changeSummary, "_No change summary was provided by the reviewer._"));
    o.push("");
    o.push("### Why — root cause");
    o.push("- **Layer:** " + v(r.rootCauseLayer, "_unspecified_"));
    o.push("- **Evidence grade:** " + v(r.evidenceGrade, "_unspecified_"));
    o.push("- **Sessions considered:** " + (S(r.sessionsConsidered) || "_n/a_"));
    o.push("");
    const verdict = v(r.verdict, "");
    if (verdict) { o.push("### Verdict"); o.push(verdict); o.push(""); }
    const filestat = S(e.FILESTAT).trim();
    if (filestat) { o.push("### Files changed"); o.push("```"); o.push(filestat); o.push("```"); o.push(""); }
    else if (S(r.diffStat).trim()) { o.push("### Files changed"); o.push("`" + S(r.diffStat).trim() + "`"); o.push(""); }
    const commits = S(e.COMMITS).trim();
    if (commits) { o.push("### Commits"); o.push(commits); o.push(""); }
    const notes = cap(r.notes, 6000);
    o.push("<details><summary>Reviewer notes &amp; raw result</summary>");
    o.push("");
    if (notes) { o.push("**Notes:** " + notes); o.push(""); }
    let raw = JSON.stringify(r, null, 2);
    if (raw.length > 12000) raw = raw.slice(0, 12000) + "\n…(truncated)";
    const runs = (raw.match(/`+/g) || []).map((m) => m.length);
    const fence = "`".repeat(Math.max(3, ...(runs.length ? runs.map((n) => n + 1) : [3])));
    o.push(fence + "json"); o.push(raw); o.push(fence);
    o.push("</details>");
    o.push("");
    o.push("---");
    o.push("> Generated by the `scheduled-skill-review` daemon. You can push edits to this branch — the daemon only reconciles merge/close state and will not overwrite your changes.");
    let body = o.join("\n") + "\n";
    body = body
      .replace(/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
      .replace(/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g, "[REDACTED TOKEN]")
      .replace(/\bsk-[A-Za-z0-9]{20,}/g, "[REDACTED TOKEN]")
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED AWS KEY]")
      .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED TOKEN]")
      .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
    process.stdout.write(body);
  ' > "$body_file" 2>>"$LOGDIR/daemon.log" || true
  if [ -s "$body_file" ]; then
    url="$( cd "$REPO_DIR" && gh pr create --base "$DEFAULT_BRANCH" --head "$branch" --title "$title" --body-file "$body_file" 2>>"$LOGDIR/daemon.log" )"
  else
    log "PR body generation produced no file for $unit — using minimal body"
    url="$( cd "$REPO_DIR" && gh pr create --base "$DEFAULT_BRANCH" --head "$branch" --title "$title" --body "Autonomous skill-review proposal for \`$unit\` (action: $action, run $RUN_ID). Review and merge to deploy." 2>>"$LOGDIR/daemon.log" )"
  fi
  if [ -z "$url" ]; then
    url="$( cd "$REPO_DIR" && gh pr view "$branch" --json url -q .url 2>/dev/null || echo '' )"
  fi
  [ -n "$url" ] || { log "gh pr create/view failed for $unit"; return 1; }
  num="$( cd "$REPO_DIR" && gh pr view "$branch" --json number -q .number 2>/dev/null || echo '' )"
  printf '%s' "$url" > "$prurl_file"
  printf '%s' "$num" > "$prnum_file"
  log "opened PR for $unit: $url"
  return 0
}

if [ "$DRY_RUN" = "0" ] && [ "$AUTO_DEPLOY" != "false" ]; then
  # Iterate proposed cycles for THIS run, one at a time.
  PROPOSED="$(node "$DIR/lifecycle.mjs" list --status proposed | RUN_ID="$RUN_ID" node --input-type=module -e "
    import { readFileSync } from 'node:fs';
    const all=JSON.parse(readFileSync(0,'utf8'));
    for(const c of all){ if(c.runId===process.env.RUN_ID) process.stdout.write([c.id,c.unit,c.branch].join('\t')+'\n'); }
  ")"
  while IFS=$'\t' read -r cid unit branch; do
    [ -n "$cid" ] || continue
    # Determine declared action from the result JSON.
    action="$(RES="$RUN_DIR/results/$unit.json" node --input-type=module -e "import{readFileSync}from'node:fs';let r={};try{r=JSON.parse(readFileSync(process.env.RES,'utf8'))}catch{};process.stdout.write(r.action||'failed')")"
    if [ "$action" = "no-change" ] || [ "$action" = "failed" ]; then
      # Review-level failures are tallied authoritatively from the result JSONs
      # after this loop (so units whose subprocess died pre-commit — which never
      # reach this 'proposed' loop — are still counted). Just close the cycle here.
      node "$DIR/lifecycle.mjs" set "$cid" status=closed >/dev/null
      continue
    fi
    # Resolve this unit's integration policy (auto-merge vs open-a-PR).
    policy="$(node "$DIR/lifecycle.mjs" policy --unit "$unit" --action "$action" 2>/dev/null)"; [ -n "$policy" ] || policy="auto"
    if [ "$policy" = "pr" ]; then
      if open_pr "$cid" "$unit" "$branch" "$action"; then
        prurl="$(cat "$RUN_DIR/results/$unit.prurl" 2>/dev/null || echo '')"
        prnum="$(cat "$RUN_DIR/results/$unit.prnum" 2>/dev/null || echo '')"
        node "$DIR/lifecycle.mjs" set "$cid" status=pr prUrl="$prurl" prNumber="$prnum" prOpenedAt="$(date -u +%Y-%m-%dT%H:%M:%SZ)" >/dev/null
        prs=$((prs+1))
      else
        integration_status=$?
        node "$DIR/lifecycle.mjs" set "$cid" status=proposed >/dev/null
        deploy_failed=$((deploy_failed+1))
        if [ "$integration_status" -eq 3 ]; then
          log "checkout recovery unverified; aborting remaining unit integration"
          break
        fi
      fi
      continue
    fi
    if integrate_one "$cid" "$unit" "$branch" "$action"; then
      node "$DIR/lifecycle.mjs" set "$cid" status=deployed >/dev/null
      # Refresh the catalog AND upgrade installed plugins so real sessions pick up the change.
      bash "$DIR/refresh-plugins.sh" "$MARKETPLACE_NAME" >>"$LOGDIR/daemon.log" 2>&1 || \
        log "plugin refresh failed for $unit (installed plugins may be stale)"
      if [ "$action" = "revert" ]; then reverted=$((reverted+1)); else applied=$((applied+1)); fi
    else
      integration_status=$?
      node "$DIR/lifecycle.mjs" set "$cid" status=proposed >/dev/null
      deploy_failed=$((deploy_failed+1))
      if [ "$integration_status" -eq 3 ]; then
        log "checkout recovery unverified; aborting remaining unit integration"
        break
      fi
    fi
  done <<EOF2
$PROPOSED
EOF2
fi

# External skills bypass the marketplace integration loop and are applied
# directly after safe staging. Fold those successful in-place edits into the run
# counters so status, digest summaries, and notifications remain truthful.
EXTERNAL_COUNTS="$(RESDIR="$RUN_DIR/results" node --input-type=module -e '
  import { readdirSync, readFileSync } from "node:fs";
  import { join } from "node:path";
  let applied=0,reverted=0;
  for(const file of readdirSync(process.env.RESDIR)){
    if(!file.endsWith(".json")) continue;
    let r;try{r=JSON.parse(readFileSync(join(process.env.RESDIR,file),"utf8"))}catch{continue}
    if(r.source!=="external"||r.appliedInPlace!==true) continue;
    if(r.action==="revert") reverted++; else if(r.action==="patched") applied++;
  }
  process.stdout.write(applied+" "+reverted);
' 2>/dev/null || echo '0 0')"
external_applied="${EXTERNAL_COUNTS%% *}"
external_reverted="${EXTERNAL_COUNTS#* }"
case "$external_applied" in ''|*[!0-9]*) external_applied=0 ;; esac
case "$external_reverted" in ''|*[!0-9]*) external_reverted=0 ;; esac
applied=$(( applied + external_applied ))
reverted=$(( reverted + external_reverted ))

# Tally review-level failures authoritatively from the canonical result JSONs — the
# SAME source make-digest.mjs reads (every selected unit always has one; see the
# handoff fallback above) — so the run-level counter matches the digest even when
# subprocesses die before committing and never reach the 'proposed' loop above. Add
# the disjoint deploy-time failures (those carry a patched/revert action, not 'failed').
# This is what lights the menu-bar ⚠️ icon, which keys off state.json lastRun.failed != 0.
review_failed="$(RESDIR="$RUN_DIR/results" LIB="$DIR/lib.mjs" node --input-type=module -e '
  import { readdirSync, readFileSync, existsSync } from "node:fs";
  import { join } from "node:path";
  const { validateResult } = await import("file://" + process.env.LIB);
  const d = process.env.RESDIR; let n = 0;
  if (existsSync(d)) {
    for (const f of readdirSync(d)) {
      if (!f.endsWith(".json")) continue;
      let r; try { r = JSON.parse(readFileSync(join(d, f), "utf8")); } catch { n++; continue; }
      const action = validateResult(r).length ? "failed" : r.action;
      if (action === "failed") n++;
    }
  }
  process.stdout.write(String(n));
' 2>/dev/null || echo 0)"
case "$review_failed" in ''|*[!0-9]*) review_failed=0 ;; esac
failed=$(( review_failed + deploy_failed ))
# Health status for the run record / notification (humans + logs). The menu bar derives
# its own state from lastRun.failed; this string is the human-readable verdict: a total
# wipe-out (every reviewed unit failed) is "failed"; any failures at all is "degraded".
run_status="ok"
if [ "${reviewed:-0}" -gt 0 ] && [ "$failed" -ge "${reviewed:-0}" ]; then run_status="failed";
elif [ "$failed" -gt 0 ]; then run_status="degraded"; fi

# 5. Digest, watermark, run record (worktrees were cleaned up before integration).
node "$DIR/make-digest.mjs" --run "$RUN_ID" >/dev/null || true
if [ "$DRY_RUN" = "0" ]; then
  node "$DIR/lifecycle.mjs" advance-watermark --to-manifest "$MANIFEST" >/dev/null || true
  node "$DIR/lifecycle.mjs" record-run --json "{\"runId\":\"$RUN_ID\",\"reviewed\":${reviewed:-0},\"applied\":$applied,\"reverted\":$reverted,\"prs\":$prs,\"failed\":$failed,\"status\":\"$run_status\"}" >/dev/null || true
fi

# 6. Notify (unless notify=none).
SUMMARY="run $RUN_ID: reviewed ${reviewed:-0}, applied $applied, reverted $reverted, PRs $prs, failed $failed"
[ "$run_status" != "ok" ] && SUMMARY="⚠️ [$run_status] $SUMMARY"
log "$SUMMARY"
NOTIFY="$(cfg_get notify)"; [ -n "$NOTIFY" ] || NOTIFY="auto"
if [ "$DRY_RUN" = "0" ] && [ "$NOTIFY" != "none" ]; then
  # Prefer terminal-notifier: its notifications are *clickable* and `-open` makes the
  # click open the digest. Plain `osascript display notification` is not actionable —
  # clicking it just launches Script Editor (the osascript host), which is useless.
  if command -v terminal-notifier >/dev/null 2>&1; then
    terminal-notifier -title "Skill Review" -message "$SUMMARY" \
      -open "file://$WS/latest-digest.md" -group skill-review >/dev/null 2>&1 || true
  elif command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$SUMMARY\" with title \"Skill Review\"" 2>/dev/null || true
  fi
fi
echo "$SUMMARY"
