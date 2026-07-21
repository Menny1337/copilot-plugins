#!/usr/bin/env bash
# ado-session-sync.sh — agentStop hook launcher (session-yield → ADO sync).
#
# Fires when the main agent yields control back to the user. Best-effort,
# fail-open, and NON-BLOCKING: it does the cheap gating here, logs each decision
# to the shared observability trail, then spawns a detached headless
# `copilot -p` agent that runs the `ado-session-sync` skill. The user's turn
# returns immediately. Always prints `{}` and exits 0; never returns
# decision:"block" (that would force another turn and could loop).
#
# Gating, in order:
#   1. Recursion guard  — ADO_SYNC_ACTIVE set ⇒ we're already inside a sync.
#   2. Opt-in           — ADO_SESSION_SYNC=0 force-DISABLES the hook regardless
#                         of config (highest precedence — always wins, even over an
#                         enabled config); ADO_SESSION_SYNC=1 force-ENABLES it
#                         regardless of config; otherwise config adoSessionSync.enabled
#                         (and taskBackend=ado) in ~/.copilot/assistant/config.json
#                         applies as before.
#   3. Session scope    — only top-level user sessions (UUID session ids) drive a
#                         sync. Sub-agent (tool-call id, e.g. toolu_*) and sidekick
#                         (sidekick-* agent id) stops also fire agentStop, but the
#                         skill cannot mint a valid session:<uuid> tag from a
#                         non-UUID id, and their work is already covered by the
#                         owning top-level session. Skip them cheaply here instead
#                         of spawning a doomed headless child.
#   4. Debounce         — skip if this session synced within the last N minutes.
#   4b. Repo eligibility — when adoSessionSync.syncRepos is set, only sessions whose
#                         cwd is under a listed prefix (or that carry an explicit
#                         work-item signal) spawn a sync child; others skip cheaply.
# The headless child is tagged with --name "ado-sync:<parentSession>" (identifiable
# in the session list, resumable by name). After it exits, its transient on-disk
# session-state dir is moved to adoSessionSync.sessionStateDir (default
# ~/.copilot/ado-sync-sessions; empty string disables), and its now-dangling row is
# deregistered from session-store.db via scripts/purge-session.sh — so relocation
# and store cleanup stay coupled (both gated on the same sessionStateDir setting).
# Each gate (and the launch + child exit) is recorded via scripts/log-run.sh.
# Recursion-guard and opt-in-disabled fire on every turn, so they are logged
# only when COPILOT_PLUGIN_ADO_SYNC_LOGLEVEL=debug (a zero-overhead env check) to keep the
# common path cheap; all other events log at the default level.

set -u

SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
PLUGIN_ROOT="$(cd "$SELF_DIR/.." 2>/dev/null && pwd)"
LOGGER="$SELF_DIR/../skills/ado-session-sync/scripts/log-run.sh"
log()     { [ -x "$LOGGER" ] && "$LOGGER" "$@" >/dev/null 2>&1 || true; }
dbg_log() { [ "${COPILOT_PLUGIN_ADO_SYNC_LOGLEVEL:-}" = "debug" ] && log "$@" || true; }
emit()    { printf '{}'; exit 0; }

# 1. Recursion guard: the headless child sets ADO_SYNC_ACTIVE=1, so a sync
#    can never trigger another sync.
if [ -n "${ADO_SYNC_ACTIVE:-}" ]; then
  dbg_log --event skip --reason recursion-guard
  emit
fi

# Read the agentStop payload (camelCase) from stdin.
payload=""
[ ! -t 0 ] && payload="$(cat 2>/dev/null || true)"
field() { printf '%s' "$payload" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" | head -1; }
SID="$(field sessionId)"
TP="$(field transcriptPath)"
CWD="$(field cwd)"
case "$SID" in ''|*[!A-Za-z0-9._-]*) SID="" ;; esac
[ -z "$CWD" ] && CWD="$(pwd)"

CONFIG="$HOME/.copilot/assistant/config.json"

# 2. Opt-in, with an explicit env override precedence:
#      ADO_SESSION_SYNC=0 -> force-disabled, regardless of config (checked FIRST,
#                                so it always wins even when config would enable sync).
#      ADO_SESSION_SYNC=1 -> force-enabled, regardless of config.
#      otherwise              -> existing config rule: adoSessionSync.enabled == true
#                                AND taskBackend == "ado" in ~/.copilot/assistant/config.json.
if [ "${ADO_SESSION_SYNC:-}" = "0" ]; then
  dbg_log --event skip --parent "$SID" --reason env-force-disabled
  emit
fi
enabled=0
if [ "${ADO_SESSION_SYNC:-}" = "1" ]; then
  enabled=1
elif [ -f "$CONFIG" ]; then
  if command -v jq >/dev/null 2>&1; then
    if [ "$(jq -r '.adoSessionSync.enabled // false' "$CONFIG" 2>/dev/null)" = "true" ] \
       && [ "$(jq -r '.taskBackend // ""' "$CONFIG" 2>/dev/null)" = "ado" ]; then
      enabled=1
    fi
  else
    if grep -q '"enabled"[[:space:]]*:[[:space:]]*true' "$CONFIG" 2>/dev/null \
       && grep -q '"taskBackend"[[:space:]]*:[[:space:]]*"ado"' "$CONFIG" 2>/dev/null; then
      enabled=1
    fi
  fi
fi
if [ "$enabled" != "1" ]; then
  dbg_log --event skip --parent "$SID" --reason opt-in-disabled
  emit
fi

# Need copilot on PATH and a usable session id.
if ! command -v copilot >/dev/null 2>&1; then
  log --event skip --parent "$SID" --reason no-copilot --detail "copilot not on PATH"
  emit
fi
if [ -z "$SID" ]; then
  log --event skip --reason no-session-id --detail "no sessionId in payload"
  emit
fi

# 3. Session scope: only top-level user sessions (UUID session ids) drive a sync.
#    Sub-agent stops carry a tool-call id (toolu_*/call_*) and sidekick/subconscious
#    stops carry a sidekick-* agent id; both fire agentStop but are NOT real sessions.
#    The skill refuses to write a session:<id> tag from a non-UUID (it would pollute
#    the board and break Step-5 idempotency), so such launches can only ever skip or
#    error after burning a full headless child. The owning top-level session sync-
#    covers the same work item, so skip non-UUID ids cheaply here. Logged at debug
#    level — this is a frequent structural no-op, not an actionable decision.
case "$SID" in
  [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) ;;
  *)
    dbg_log --event skip --parent "$SID" --reason non-uuid-parent \
      --detail "sessionId is not a session UUID (sub-agent/sidekick stop); top-level session owns the sync"
    emit ;;
esac

# 4. Debounce (per session). Default 10 minutes; override via config.
debounce_min=10
if command -v jq >/dev/null 2>&1 && [ -f "$CONFIG" ]; then
  v="$(jq -r '.adoSessionSync.debounceMinutes // empty' "$CONFIG" 2>/dev/null)"
  case "$v" in ''|*[!0-9]*) ;; *) debounce_min="$v" ;; esac
fi
state_dir="${TMPDIR:-/tmp}/ado-session-sync"
mkdir -p "$state_dir" 2>/dev/null || true
stamp="$state_dir/$SID.last"
now="$(date +%s)"
if [ -f "$stamp" ]; then
  last="$(cat "$stamp" 2>/dev/null || echo 0)"
  case "$last" in ''|*[!0-9]*) last=0 ;; esac
  if [ $(( now - last )) -lt $(( debounce_min * 60 )) ]; then
    log --event skip --parent "$SID" --reason debounced \
        --detail "last sync $(( (now - last) / 60 ))m ago (window ${debounce_min}m)"
    emit
  fi
fi
printf '%s' "$now" > "$stamp" 2>/dev/null || true

# 4b. Repo eligibility (allowlist) with an explicit work-item fast-path.
#    adoSessionSync.syncRepos is an allowlist of path prefixes whose sessions may
#    spawn a sync child. When set and non-empty, a session whose cwd is NOT under
#    any listed prefix is skipped cheaply HERE (no ~4-minute headless child) —
#    UNLESS it carries an explicit work-item signal (an AB#/"work item N"/_workitems
#    URL in the transcript, or a numeric branch / AB# commit trailer in cwd), which
#    always qualifies (mirrors the skill's Step-4 priority 1-2). The fast-path can
#    only ADD spawns, never suppress one, so the gate can never drop tracked work.
#    Unset/empty syncRepos preserves the original behavior: every session is eligible.
#    Runs AFTER debounce so a rapid burst of yields in a non-eligible repo logs one
#    repo-not-eligible (an honest "saved a child" count), not one per yield.
#    Bare "#NN" is intentionally NOT a fast-path signal (it is usually a GitHub PR/
#    issue ref); the allowlist therefore stays the effective control, and the child
#    still honors bare #NN via the full Step-4 when an allowlisted session does run.
if command -v jq >/dev/null 2>&1 && [ -f "$CONFIG" ] \
   && [ "$(jq -r '(.adoSessionSync.syncRepos // []) | length' "$CONFIG" 2>/dev/null || echo 0)" -gt 0 ] 2>/dev/null; then
  eligible=0
  exp_tilde() { case "$1" in "~") printf '%s' "$HOME" ;; "~/"*) printf '%s' "$HOME${1#\~}" ;; *) printf '%s' "$1" ;; esac; }
  ccwd="$(exp_tilde "$CWD")"; ccwd="${ccwd%/}"
  while IFS= read -r pfx; do
    [ -z "$pfx" ] && continue
    pfx="$(exp_tilde "$pfx")"; pfx="${pfx%/}"
    case "$ccwd" in "$pfx"|"$pfx"/*) eligible=1; break ;; esac
  done <<EOF
$(jq -r '.adoSessionSync.syncRepos[]? // empty' "$CONFIG" 2>/dev/null)
EOF
  if [ "$eligible" != 1 ]; then
    # Strong, precise work-item signals qualify a non-allowlisted repo.
    if [ -n "$TP" ] && [ -f "$TP" ] \
       && grep -qiE 'AB#[0-9]+|work item[s]? [0-9]+|_workitems/edit/[0-9]+' "$TP" 2>/dev/null; then
      eligible=1
    elif command -v git >/dev/null 2>&1; then
      br="$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
      case "$br" in
        [0-9]*[-/]*|*/[0-9]*) eligible=1 ;;
        *) git -C "$CWD" log -3 --format='%B' 2>/dev/null | grep -qiE 'AB#[0-9]+' && eligible=1 || true ;;
      esac
    fi
  fi
  if [ "$eligible" != 1 ]; then
    log --event skip --parent "$SID" --cwd "$CWD" --reason repo-not-eligible \
        --detail "cwd not under adoSessionSync.syncRepos and no explicit work-item signal — skipped without spawning a sync child"
    emit
  fi
fi

# Correlate parent → child with a stable child session id.
CHILD="$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z')"
[ -z "$CHILD" ] && CHILD="$(python3 -c 'import uuid;print(uuid.uuid4())' 2>/dev/null || true)"
[ -z "$CHILD" ] && CHILD="${SID}-sync-${now}"

# 4. Launch the headless sync, detached and non-blocking.
log_dir="$HOME/.copilot/logs/ado-session-sync"
mkdir -p "$log_dir" 2>/dev/null || true
child_log="$log_dir/$SID.log"

log --event launch --parent "$SID" --child "$CHILD" --cwd "$CWD" --childlog "$child_log" --maybe-prune

export ADO_SYNC_ACTIVE=1
export COPILOT_PLUGIN_SYNC_CWD="$CWD"
export COPILOT_PLUGIN_SYNC_LOG="$child_log"
export COPILOT_PLUGIN_SYNC_LOGGER="$LOGGER"
export COPILOT_PLUGIN_SYNC_PARENT="$SID"
export COPILOT_PLUGIN_SYNC_CHILD="$CHILD"
export COPILOT_PLUGIN_SYNC_ADDDIR="$HOME/.copilot"
export COPILOT_PLUGIN_SYNC_PLUGIN_DIR="$PLUGIN_ROOT"
# Tag the headless child session so it is identifiable/filterable in the session
# list and resumable by name (copilot --resume="ado-sync:<parentSession>").
export COPILOT_PLUGIN_SYNC_NAME="ado-sync:$SID"

# Session-state relocation: after the child exits, move its transient on-disk
# session-state dir out of the normal store (the session-store.db row stays; only
# the state files move). Target from adoSessionSync.sessionStateDir: unset =>
# default ~/.copilot/ado-sync-sessions; empty string => disabled (leave in place).
# Honors COPILOT_HOME for the source base. The move runs in the detached child
# AFTER the agent returns, so it never races a live session.
state_base="${COPILOT_HOME:-$HOME/.copilot}/session-state"
state_dest="$HOME/.copilot/ado-sync-sessions"
if command -v jq >/dev/null 2>&1 && [ -f "$CONFIG" ]; then
  sd="$(jq -r 'if (.adoSessionSync|type=="object") and (.adoSessionSync|has("sessionStateDir")) then (.adoSessionSync.sessionStateDir // "") else "__unset__" end' "$CONFIG" 2>/dev/null)"
  case "$sd" in
    __unset__) ;;
    "")     state_dest="" ;;
    "~")    state_dest="$HOME" ;;
    "~/"*)  state_dest="$HOME${sd#\~}" ;;
    *)      state_dest="$sd" ;;
  esac
fi
export COPILOT_PLUGIN_SYNC_STATE_SRC="$state_base/$CHILD"
export COPILOT_PLUGIN_SYNC_STATE_DEST="$state_dest"
# Deregister the child from the central session store (session-store.db) after its
# state dir is relocated, so the moved dir does not leave a dangling row that breaks
# --continue/--resume and pollutes session search. Coupled to relocation: only runs
# when COPILOT_PLUGIN_SYNC_STATE_DEST is set (empty => keep the row, matching move-disabled).
export COPILOT_PLUGIN_SYNC_PURGE="$SELF_DIR/../skills/ado-session-sync/scripts/purge-session.sh"

# ADO auth context (decoupled from the active `az` subscription): source the skill's
# auth helper so AZURE_DEVOPS_EXT_PAT is exported into this process and inherited by the
# headless child. By default the helper mints a short-lived Microsoft Entra (AAD) token
# for the org's tenant from your existing `az login` (a stored PAT is an optional
# override); the child then authenticates `az boards`/`az devops` by token — regardless
# of which az account/subscription/tenant happens to be active in the session — without
# reading or mutating ~/.azure. Fail-open: if nothing resolves, the child falls back to
# whatever ambient `az` auth exists (prior behavior).
AUTH_HELPER="$SELF_DIR/../skills/ado-session-sync/scripts/ado-auth.sh"
[ -f "$AUTH_HELPER" ] && . "$AUTH_HELPER" >/dev/null 2>&1 || true

export COPILOT_PLUGIN_SYNC_PROMPT="A Copilot session just yielded control back to the user. parentSession=$SID syncSession=$CHILD transcriptPath=$TP cwd=$CWD. Invoke the ado-session-sync skill and follow its procedure to update the related Azure DevOps work item: post a concise progress comment and add a session:<id> tag for rediscovery, then record the outcome via the skill's logger. If you cannot confidently identify a single related work item, skip without updating anything (and still record the skip). FALLBACK (only if the ado-session-sync skill is NOT loadable in this runtime): perform the same procedure from context and record exactly ONE terminal event via the logger at the path in env COPILOT_PLUGIN_SYNC_LOGGER, or if that is unavailable by appending one JSON line to ~/.copilot/logs/ado-session-sync/runs.jsonl using logger-compatible field names ts,parent,child (not timestamp,parentSession,syncSession). Use ONLY this closed vocabulary: event=result with action in {commented+tagged,tagged-only,state-nudged,skipped}; a skipped result also needs reason in {no-work,ambiguous,closed-item,duplicate}; if you TRIED to write to ADO but it was denied or failed (e.g. 'Permission denied and could not request permission from user'), log event=error stage=update reason=write-blocked, NOT a skipped result. Keep the note to 2-5 sentences, terse, no secrets."

# The runner references only env vars (inherited by the child), so nothing
# dynamic is interpolated into the command line. It records child-exit with the
# real exit code and duration after the agent returns, then relocates the child's
# session-state dir and deregisters its session-store.db row (both when
# COPILOT_PLUGIN_SYNC_STATE_DEST is set). The child is tagged via --name "$COPILOT_PLUGIN_SYNC_NAME"
# for later filtering/resume.
#
# Permissions: the child must run fully autonomously (--no-ask-user), so use
# --allow-all (tools + paths + URLs). Mutating `az boards work-item update`
# commands can still hit a no-user permission request with narrower grants.
# The child also receives the current plugin via --plugin-dir (so it can load
# ado-session-sync even in local plugin-dir sessions) plus explicit --add-dir
# entries for ~/.copilot and the plugin root.
#
# Trusted cwd: run the child from $HOME, NOT the parent's work repo ($COPILOT_PLUGIN_SYNC_CWD).
# A mutating `az` is denied when the process cwd is a content-excluded repo
# ("Permission denied and could not request permission from user") because the
# headless child cannot satisfy an interactive permission prompt. The skill reads
# the work-repo path from the prompt (cwd=...) and inspects it with `git -C "<cwd>"`,
# so it does not need the process cwd to BE the repo.
runner='start=$(date +%s); cd "$HOME" 2>/dev/null; copilot -p "$COPILOT_PLUGIN_SYNC_PROMPT" --name "$COPILOT_PLUGIN_SYNC_NAME" --session-id "$COPILOT_PLUGIN_SYNC_CHILD" --plugin-dir "$COPILOT_PLUGIN_SYNC_PLUGIN_DIR" --no-ask-user --allow-all --add-dir "$COPILOT_PLUGIN_SYNC_ADDDIR" --add-dir "$COPILOT_PLUGIN_SYNC_PLUGIN_DIR" -s --no-color >"$COPILOT_PLUGIN_SYNC_LOG" 2>&1; rc=$?; end=$(date +%s); [ -x "$COPILOT_PLUGIN_SYNC_LOGGER" ] && "$COPILOT_PLUGIN_SYNC_LOGGER" --event child-exit --parent "$COPILOT_PLUGIN_SYNC_PARENT" --child "$COPILOT_PLUGIN_SYNC_CHILD" --exit "$rc" --duration "$((end-start))" >/dev/null 2>&1; if [ -n "$COPILOT_PLUGIN_SYNC_STATE_DEST" ]; then if [ -d "$COPILOT_PLUGIN_SYNC_STATE_SRC" ]; then mkdir -p "$COPILOT_PLUGIN_SYNC_STATE_DEST" 2>/dev/null && mv "$COPILOT_PLUGIN_SYNC_STATE_SRC" "$COPILOT_PLUGIN_SYNC_STATE_DEST/" 2>/dev/null; fi; [ -x "$COPILOT_PLUGIN_SYNC_PURGE" ] && "$COPILOT_PLUGIN_SYNC_PURGE" --id "$COPILOT_PLUGIN_SYNC_CHILD" --quiet >/dev/null 2>&1; fi'

if command -v setsid >/dev/null 2>&1; then
  setsid sh -c "$runner" >/dev/null 2>&1 &
else
  nohup sh -c "$runner" >/dev/null 2>&1 &
fi
disown 2>/dev/null || true

emit
