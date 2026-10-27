#!/usr/bin/env bash
# reconcile-prs.sh — reconcile review cycles that are awaiting a human PR merge.
#
# For every cycle in `status=pr`, ask GitHub (via `gh`) whether its PR has been
# merged or closed, and advance the lifecycle accordingly:
#   MERGED → status=deployed (+deployedAt) → starts the post-deploy re-review
#            window; then refresh installed plugins so the merged
#            change is live, UNLESS RECONCILE_REFRESH=none.
#   CLOSED (unmerged) → status=closed.
# A PR still OPEN, an unreadable PR, or a missing `gh` leaves the cycle as `pr`
# (surfaced in the menu bar / digest). The script is best-effort and always
# exits 0.
#
# Shared by run-batch-review.sh (foreground, at run start) and daemon-ctl.sh
# (status launches it DETACHED so the menu bar self-heals without blocking the
# render; `reconcile` runs it foreground). A stale-safe lock serializes all
# reconciles so concurrent invocations cannot clobber cycles.json (lost update)
# or double-run the plugin refresh.
#
# Env:
#   RECONCILE_REFRESH = refresh|none   (default refresh) — run the plugin refresh on a
#                                       detected merge, or skip it.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS="$HOME/.copilot/agent-architect/skill-reviews"
CONFIG="$WS/config.json"
LOGDIR="$WS/logs"
RLOCK="$WS/reconcile.lock"
mkdir -p "$WS" "$LOGDIR"

REFRESH="${RECONCILE_REFRESH:-refresh}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOGDIR/daemon.log" >&2; }

cfg_get() {
  node --input-type=module -e "
    const { loadConfig } = await import('${DIR}/lib.mjs');
    const c = loadConfig();
    let v = c; for (const p of process.argv[1].split('.')) { v = (v==null?undefined:v[p]); }
    process.stdout.write(v==null?'':String(v));
  " "$1"
}

REPO_DIR="$(cfg_get repoDir)"
if [ -z "$REPO_DIR" ] || [ ! -d "$REPO_DIR" ]; then
  log "reconcile: config.repoDir unset or missing ('$REPO_DIR') — skipping"; exit 0
fi
MARKETPLACE_NAME="$(cfg_get marketplaceName)"
REMOTE_NAME="$(cfg_get remoteName)"; [ -n "$REMOTE_NAME" ] || REMOTE_NAME="origin"
GH_ACCOUNT="$(cfg_get ghAccount)"

command -v gh >/dev/null 2>&1 || { log "reconcile: gh unavailable — skipping PR reconciliation"; exit 0; }

# Pin gh to the repo-owner account (exports GH_TOKEN for this process only) so a
# stray global `gh auth switch` can't make every PR lookup fail. Inherited GH_TOKEN
# from a parent run-batch-review.sh makes this a no-op.
# shellcheck source=gh-pin-account.sh
. "$DIR/gh-pin-account.sh"
pin_gh_account

# Stale-safe try-lock. If another reconcile holds it and is alive, skip (it does
# the same work); reclaim a stale lock left by a dead pid.
if ! mkdir "$RLOCK" 2>/dev/null; then
  oldpid="$(cat "$RLOCK/pid" 2>/dev/null || echo '')"
  if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
    exit 0
  fi
  rm -rf "$RLOCK"; mkdir "$RLOCK" 2>/dev/null || exit 0
fi
echo $$ > "$RLOCK/pid"
trap 'rm -rf "$RLOCK"' EXIT INT TERM

# Resolve the canonical repo slug from the local remote (no network) so the gh
# query targets the right repo even if the cwd resolves ambiguously.
GH_REPO="$(git -C "$REPO_DIR" remote get-url "$REMOTE_NAME" 2>/dev/null \
  | sed -E 's#^git@github\.com:#https://github.com/#' \
  | sed -E 's#^https://github\.com/##; s#\.git$##' \
  | grep -E '^[^/]+/[^/]+$' || echo '')"

gh_pr() { # $1=ref  $2=json field
  ( cd "$REPO_DIR" && gh pr view "$1" ${GH_REPO:+--repo "$GH_REPO"} --json "$2" -q ".$2" 2>/dev/null ) || echo ''
}

plugins_update() {
  bash "$DIR/refresh-plugins.sh" "$MARKETPLACE_NAME" >>"$LOGDIR/daemon.log" 2>&1 || \
    log "reconcile: plugin refresh failed (installed plugins may be stale)"
}

rows="$(node "$DIR/lifecycle.mjs" list --status pr 2>/dev/null | node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  let all=[]; try{ all=JSON.parse(readFileSync(0,'utf8')); }catch{}
  for(const c of all){ process.stdout.write([c.id,c.unit,c.prNumber||'',c.branch||''].join('\t')+'\n'); }
" 2>/dev/null)"
[ -n "$rows" ] || exit 0

while IFS=$'\t' read -r cid unit prnum branch; do
  [ -n "$cid" ] || continue
  ref="$prnum"; [ -n "$ref" ] || ref="$branch"
  [ -n "$ref" ] || continue
  state="$(gh_pr "$ref" state)"
  if [ -z "$state" ]; then log "reconcile: could not read PR for $unit ($ref)"; continue; fi
  if [ "$state" = "MERGED" ]; then
    mergedAt="$(gh_pr "$ref" mergedAt)"
    log "reconcile: PR for $unit merged (${mergedAt:-unknown}) — marking deployed"
    node "$DIR/lifecycle.mjs" set "$cid" status=deployed ${mergedAt:+deployedAt="$mergedAt"} >/dev/null
    [ "$REFRESH" != "none" ] && plugins_update
  elif [ "$state" = "CLOSED" ]; then
    log "reconcile: PR for $unit closed unmerged — marking closed"
    node "$DIR/lifecycle.mjs" set "$cid" status=closed >/dev/null
  fi
done <<EOF_RC
$rows
EOF_RC

exit 0
