#!/usr/bin/env bash
# github-session-sync.sh — agentStop hook launcher (session-yield → GitHub sync).
#
# GitHub-backend twin of ado-session-sync.sh, invoked by task-session-sync.sh (the
# backend dispatcher) when `taskBackend == "github"`. Best-effort, fail-open, and
# NON-BLOCKING: does the cheap gating here, logs each decision to the SAME shared
# observability trail ado-session-sync uses (~/.copilot/logs/ado-session-sync/ —
# the directory name is a legacy artifact kept so sync-status.sh and the
# sessionStart advisory hook work for BOTH backends with zero changes), then spawns
# a detached headless `copilot -p` agent that runs the `github-session-sync` skill.
# The user's turn returns immediately. Always prints `{}` and exits 0.
#
# Gating, in order (mirrors ado-session-sync.sh exactly, same rationale):
#   1. Recursion guard  — COPILOT_PLUGIN_TASK_SYNC_ACTIVE/ADO_SYNC_ACTIVE already handled by
#                         the dispatcher; this script also checks COPILOT_PLUGIN_TASK_SYNC_ACTIVE
#                         directly so it stays safe if ever invoked standalone.
#   2. Opt-in           — COPILOT_PLUGIN_GITHUB_SESSION_SYNC=0 or COPILOT_PLUGIN_TASK_SESSION_SYNC=0
#                         force-DISABLES (checked first, always wins); =1 force-
#                         ENABLES; otherwise config taskSessionSync.enabled (and
#                         taskBackend=github) in ~/.copilot/assistant/config.json.
#   3. Session scope    — only top-level user sessions (UUID session ids).
#   4. Repo eligibility — same allowlist + work-item-signal fast-path as ADO.
#   5. Debounce         — skip if this eligible session synced within the last N minutes.
#
# The headless child is tagged with --name "github-sync:<parentSession>". After it
# exits, its transient session-state dir is relocated and its session-store.db row
# purged, exactly like the ADO launcher (same shared scripts, reused by relative
# path into the ado-session-sync skill — these are backend-neutral utilities).

set -u

SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
PLUGIN_ROOT="$(cd "$SELF_DIR/.." 2>/dev/null && pwd)"
LOGGER="$SELF_DIR/../skills/ado-session-sync/scripts/log-run.sh"
log()     { [ -x "$LOGGER" ] && "$LOGGER" "$@" >/dev/null 2>&1 || true; }
dbg_log() { [ "${COPILOT_PLUGIN_ADO_SYNC_LOGLEVEL:-}" = "debug" ] && log "$@" || true; }
emit()    { printf '{}'; exit 0; }

# 1. Recursion guard.
if [ -n "${COPILOT_PLUGIN_TASK_SYNC_ACTIVE:-}" ]; then
  dbg_log --event skip --reason recursion-guard
  emit
fi

# A force-disable must remain inert even when the selected config is invalid.
if [ "${COPILOT_PLUGIN_GITHUB_SESSION_SYNC:-}" = "0" ] || [ "${COPILOT_PLUGIN_TASK_SESSION_SYNC:-}" = "0" ]; then
  dbg_log --event skip --reason env-force-disabled
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

# shellcheck source=plugins/core-agents/shared/assistant-config.sh
. "$SELF_DIR/../shared/assistant-config.sh" || emit
CONFIG="$(plugins_config_path)" || emit
backend="$(plugins_config_backend "$CONFIG")" || emit
[ "$backend" = "github" ] || emit
# Dependency-free Node fallback (r3 finding 8) for the config.json field reads
# below, used ONLY when jq is not on PATH. jq stays the preferred path
# everywhere it's available; every call-site below tries jq first.
CONFIG_FIELD_SCRIPT="$SELF_DIR/scripts/config-field.mjs"

# 2. Opt-in, with an explicit env override precedence:
#      COPILOT_PLUGIN_GITHUB_SESSION_SYNC=0 / COPILOT_PLUGIN_TASK_SESSION_SYNC=0 -> force-disabled.
#      COPILOT_PLUGIN_GITHUB_SESSION_SYNC=1 / COPILOT_PLUGIN_TASK_SESSION_SYNC=1 -> force-enabled.
#      otherwise -> config rule: taskSessionSync.enabled == true AND
#                   taskBackend == "github" in ~/.copilot/assistant/config.json.
enabled=0
if [ "${COPILOT_PLUGIN_GITHUB_SESSION_SYNC:-}" = "1" ] || [ "${COPILOT_PLUGIN_TASK_SESSION_SYNC:-}" = "1" ]; then
  enabled=1
elif [ -f "$CONFIG" ]; then
  if command -v jq >/dev/null 2>&1; then
    if [ "$(jq -r '.taskSessionSync.enabled // false' "$CONFIG" 2>/dev/null)" = "true" ] \
       && [ "$(jq -r '.taskBackend // ""' "$CONFIG" 2>/dev/null)" = "github" ]; then
      enabled=1
    fi
  elif command -v node >/dev/null 2>&1 && [ -f "$CONFIG_FIELD_SCRIPT" ]; then
    # No jq, but node IS available: use the dependency-free Node fallback
    # (finding 8) rather than a naive grep. A real JSON.parse can safely
    # distinguish the nested taskSessionSync.enabled key from an unrelated
    # top-level/sibling "enabled" key elsewhere in the file, so this is a
    # like-for-like substitute for the jq read above — never a downgrade.
    if [ "$(node "$CONFIG_FIELD_SCRIPT" enabled "$CONFIG" --backend github 2>/dev/null)" = "true" ]; then
      enabled=1
    fi
  else
    # Neither jq nor node: fail CLOSED rather than parse nested JSON with
    # grep. A naive `grep '"enabled":[[:space:]]*true'` cannot distinguish
    # the nested `taskSessionSync.enabled` key from a top-level sibling like
    # a leftover `adoSessionSync.enabled: true` (or any other "enabled" key
    # anywhere in the file) — it would incorrectly activate GitHub sync
    # purely because an unrelated ADO config still says enabled, even when
    # `taskSessionSync` is absent or explicitly false. Without a real JSON
    # parser available at all, refuse rather than risk writing to the wrong
    # backend's board; this reads as a normal opt-in-disabled skip below
    # (fail-open for startup, fail-closed for the write decision).
    dbg_log --event skip --parent "$SID" --reason no-jq-no-node-fail-closed \
      --detail "neither jq nor node on PATH — cannot safely parse nested taskSessionSync.enabled; refusing rather than risk a false-positive from an unrelated \"enabled\" key"
  fi
fi
if [ "$enabled" != "1" ]; then
  dbg_log --event skip --parent "$SID" --reason opt-in-disabled
  emit
fi

# Need copilot and gh on PATH, plus a usable session id.
if ! command -v copilot >/dev/null 2>&1; then
  log --event skip --parent "$SID" --reason no-copilot --detail "copilot not on PATH"
  emit
fi
if ! command -v gh >/dev/null 2>&1; then
  log --event skip --parent "$SID" --reason no-gh --detail "gh CLI not on PATH"
  emit
fi
if [ -z "$SID" ]; then
  log --event skip --reason no-session-id --detail "no sessionId in payload"
  emit
fi

# 3. Session scope: only top-level user sessions (UUID session ids) drive a sync.
case "$SID" in
  [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) ;;
  *)
    dbg_log --event skip --parent "$SID" --reason non-uuid-parent \
      --detail "sessionId is not a session UUID (sub-agent/sidekick stop); top-level session owns the sync"
    emit ;;
esac

# 4. Repo eligibility (allowlist) with an explicit work-item signal fast-path —
#    same shape as ado-session-sync.sh, reading taskSessionSync.syncRepos instead
#    of adoSessionSync.syncRepos. Bare "#NN" is a strong signal here (unlike ADO,
#    where it's ambiguous with a PR ref) since GitHub issue refs commonly appear
#    as bare "#NN" in commit messages/branches for this backend.
repos_count=0
if [ -f "$CONFIG" ]; then
  if command -v jq >/dev/null 2>&1; then
    repos_count="$(jq -r '(.taskSessionSync.syncRepos // []) | length' "$CONFIG" 2>/dev/null || echo 0)"
  elif command -v node >/dev/null 2>&1 && [ -f "$CONFIG_FIELD_SCRIPT" ]; then
    repos_count="$(node "$CONFIG_FIELD_SCRIPT" sync-repos-count "$CONFIG" 2>/dev/null || echo 0)"
  fi
  case "$repos_count" in ''|*[!0-9]*) repos_count=0 ;; esac
fi
if [ "$repos_count" -gt 0 ] 2>/dev/null; then
  eligible=0
  exp_tilde() { case "$1" in \~) printf '%s' "$HOME" ;; \~/*) printf '%s' "$HOME${1#\~}" ;; *) printf '%s' "$1" ;; esac; }
  ccwd="$(exp_tilde "$CWD")"; ccwd="${ccwd%/}"
  while IFS= read -r pfx; do
    [ -z "$pfx" ] && continue
    pfx="$(exp_tilde "$pfx")"; pfx="${pfx%/}"
    case "$ccwd" in "$pfx"|"$pfx"/*) eligible=1; break ;; esac
  done <<EOF
$(if command -v jq >/dev/null 2>&1; then
    jq -r '.taskSessionSync.syncRepos[]? // empty' "$CONFIG" 2>/dev/null
  elif command -v node >/dev/null 2>&1 && [ -f "$CONFIG_FIELD_SCRIPT" ]; then
    node "$CONFIG_FIELD_SCRIPT" sync-repos-list "$CONFIG" 2>/dev/null
  fi)
EOF
  if [ "$eligible" != 1 ]; then
    if [ -n "$TP" ] && [ -f "$TP" ] \
       && grep -qiE '#[0-9]+|issues/[0-9]+' "$TP" 2>/dev/null; then
      eligible=1
    elif command -v git >/dev/null 2>&1; then
      br="$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
      case "$br" in
        [0-9]*[-/]*|*/[0-9]*) eligible=1 ;;
        *) git -C "$CWD" log -3 --format='%B' 2>/dev/null | grep -qiE '#[0-9]+' && eligible=1 || true ;;
      esac
    fi
  fi
  if [ "$eligible" != 1 ]; then
    log --event skip --parent "$SID" --cwd "$CWD" --reason repo-not-eligible \
        --detail "cwd not under taskSessionSync.syncRepos and no explicit issue signal — skipped without spawning a sync child"
    emit
  fi
fi

# 5. Debounce (per eligible session). Ineligible/no-signal stops must not consume
# the window and suppress a later eligible stop from the same session.
debounce_min=10
if [ -f "$CONFIG" ]; then
  if command -v jq >/dev/null 2>&1; then
    v="$(jq -r '.taskSessionSync.debounceMinutes // empty' "$CONFIG" 2>/dev/null)"
  elif command -v node >/dev/null 2>&1 && [ -f "$CONFIG_FIELD_SCRIPT" ]; then
    v="$(node "$CONFIG_FIELD_SCRIPT" debounce-minutes "$CONFIG" 2>/dev/null)"
  else
    v=""
  fi
  case "$v" in ''|*[!0-9]*) ;; *) debounce_min="$v" ;; esac
fi
state_dir="${TMPDIR:-/tmp}/github-session-sync"
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

# Resolve only the local config fields needed by the detached runner's auth
# selection. Network identity probes happen after detachment so agentStop stays
# non-blocking even when GitHub is slow or unreachable.
github_owner=""
github_owner_type="user"
if [ -f "$CONFIG" ]; then
  if command -v jq >/dev/null 2>&1; then
    github_owner="$(jq -r 'if (.github.owner | type) == "string" then .github.owner else "" end' "$CONFIG" 2>/dev/null)"
    github_owner_type="$(jq -r 'if .github.ownerType == "org" then "org" else "user" end' "$CONFIG" 2>/dev/null)"
  elif command -v node >/dev/null 2>&1 && [ -f "$CONFIG_FIELD_SCRIPT" ]; then
    github_owner="$(node "$CONFIG_FIELD_SCRIPT" github-owner "$CONFIG" 2>/dev/null)"
    github_owner_type="$(node "$CONFIG_FIELD_SCRIPT" github-owner-type "$CONFIG" 2>/dev/null)"
  fi
fi

# Correlate parent -> child with a stable child session id.
CHILD="$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]')"
[ -z "$CHILD" ] && CHILD="$(python3 -c 'import uuid;print(uuid.uuid4())' 2>/dev/null || true)"
[ -z "$CHILD" ] && CHILD="${SID}-sync-${now}"

log_dir="$HOME/.copilot/logs/ado-session-sync"
mkdir -p "$log_dir" 2>/dev/null || true
child_log="$log_dir/$SID.log"

log --event launch --parent "$SID" --child "$CHILD" --cwd "$CWD" --childlog "$child_log" --maybe-prune

export COPILOT_PLUGIN_TASK_SYNC_ACTIVE=1
export COPILOT_PLUGIN_SYNC_CWD="$CWD"
export COPILOT_PLUGIN_SYNC_LOG="$child_log"
export COPILOT_PLUGIN_SYNC_LOGGER="$LOGGER"
export COPILOT_PLUGIN_SYNC_PARENT="$SID"
export COPILOT_PLUGIN_SYNC_CHILD="$CHILD"
export COPILOT_PLUGIN_SYNC_ADDDIR="$HOME/.copilot"
export COPILOT_PLUGIN_SYNC_PLUGIN_DIR="$PLUGIN_ROOT"
export COPILOT_PLUGIN_SYNC_NAME="github-sync:$SID"
export COPILOT_PLUGIN_SYNC_GITHUB_OWNER="$github_owner"
export COPILOT_PLUGIN_SYNC_GITHUB_OWNER_TYPE="$github_owner_type"

state_base="${COPILOT_HOME:-$HOME/.copilot}/session-state"
state_dest="$HOME/.copilot/ado-sync-sessions"
if [ -f "$CONFIG" ]; then
  if command -v jq >/dev/null 2>&1; then
    sd="$(jq -r 'if (.taskSessionSync|type=="object") and (.taskSessionSync|has("sessionStateDir")) then (.taskSessionSync.sessionStateDir // "") else "__unset__" end' "$CONFIG" 2>/dev/null)"
  elif command -v node >/dev/null 2>&1 && [ -f "$CONFIG_FIELD_SCRIPT" ]; then
    sd="$(node "$CONFIG_FIELD_SCRIPT" session-state-dir "$CONFIG" 2>/dev/null)"
  else
    sd="__unset__"
  fi
  case "$sd" in
    __unset__) ;;
    "")     state_dest="" ;;
    \~)     state_dest="$HOME" ;;
    \~/*)   state_dest="$HOME${sd#\~}" ;;
    *)      state_dest="$sd" ;;
  esac
fi
export COPILOT_PLUGIN_SYNC_STATE_SRC="$state_base/$CHILD"
export COPILOT_PLUGIN_SYNC_STATE_DEST="$state_dest"
export COPILOT_PLUGIN_SYNC_PURGE="$SELF_DIR/../skills/ado-session-sync/scripts/purge-session.sh"

export COPILOT_PLUGIN_SYNC_PROMPT="A Copilot session just yielded control back to the user. parentSession=$SID syncSession=$CHILD transcriptPath=$TP cwd=$CWD. Invoke the github-session-sync skill and follow its procedure to update the related GitHub issue: post a concise progress comment carrying the hidden marker <!-- copilot-session:$SID --> (use the bundled session-map.mjs script — 'marker'/'record'/'lookup' subcommands — for the exact marker text and the local session-to-issue cache; never hand-write the marker), then record the outcome via the skill's logger. If you cannot confidently identify a single related issue, skip without updating anything (and still record the skip). FALLBACK (only if the github-session-sync skill is NOT loadable in this runtime): perform the same procedure from context and record exactly ONE terminal event via the logger at the path in env COPILOT_PLUGIN_SYNC_LOGGER, or if that is unavailable by appending one JSON line to ~/.copilot/logs/ado-session-sync/runs.jsonl using logger-compatible field names ts,parent,child. Use ONLY this closed vocabulary: event=result with action in {commented+tagged,tagged-only,skipped}; a skipped result also needs reason in {no-work,ambiguous,closed-item,duplicate}; if you TRIED to write to GitHub but it was denied or failed, log event=error stage=update reason=write-blocked, NOT a skipped result. Keep the note to 2-5 sentences, terse, no secrets, and NEVER log a token."

# shellcheck disable=SC2016
runner='auth_ok=1; if [ "$COPILOT_PLUGIN_SYNC_GITHUB_OWNER_TYPE" = "user" ] && [ -n "$COPILOT_PLUGIN_SYNC_GITHUB_OWNER" ]; then ambient_login="$(gh api user --jq .login 2>/dev/null || true)"; if [ "$ambient_login" != "$COPILOT_PLUGIN_SYNC_GITHUB_OWNER" ]; then if [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then keyring_login="$(env -u GH_TOKEN -u GITHUB_TOKEN gh api user --jq .login 2>/dev/null || true)"; if [ "$keyring_login" = "$COPILOT_PLUGIN_SYNC_GITHUB_OWNER" ]; then unset GH_TOKEN GITHUB_TOKEN; else auth_ok=0; fi; else auth_ok=0; fi; fi; fi; start=$(date +%s); cd "$HOME" 2>/dev/null; if [ "$auth_ok" = 1 ]; then copilot -p "$COPILOT_PLUGIN_SYNC_PROMPT" --name "$COPILOT_PLUGIN_SYNC_NAME" --session-id "$COPILOT_PLUGIN_SYNC_CHILD" --plugin-dir "$COPILOT_PLUGIN_SYNC_PLUGIN_DIR" --no-ask-user --allow-all --add-dir "$COPILOT_PLUGIN_SYNC_ADDDIR" --add-dir "$COPILOT_PLUGIN_SYNC_PLUGIN_DIR" -s --no-color --no-auto-update >"$COPILOT_PLUGIN_SYNC_LOG" 2>&1; rc=$?; else rc=4; [ -x "$COPILOT_PLUGIN_SYNC_LOGGER" ] && "$COPILOT_PLUGIN_SYNC_LOGGER" --event error --parent "$COPILOT_PLUGIN_SYNC_PARENT" --child "$COPILOT_PLUGIN_SYNC_CHILD" --stage update --reason write-blocked --detail "GitHub CLI login does not match the configured user owner; sync child was not started" >/dev/null 2>&1; fi; end=$(date +%s); [ -x "$COPILOT_PLUGIN_SYNC_LOGGER" ] && "$COPILOT_PLUGIN_SYNC_LOGGER" --event child-exit --parent "$COPILOT_PLUGIN_SYNC_PARENT" --child "$COPILOT_PLUGIN_SYNC_CHILD" --exit "$rc" --duration "$((end-start))" >/dev/null 2>&1; if [ -n "$COPILOT_PLUGIN_SYNC_STATE_DEST" ]; then if [ -d "$COPILOT_PLUGIN_SYNC_STATE_SRC" ]; then mkdir -p "$COPILOT_PLUGIN_SYNC_STATE_DEST" 2>/dev/null && mv "$COPILOT_PLUGIN_SYNC_STATE_SRC" "$COPILOT_PLUGIN_SYNC_STATE_DEST/" 2>/dev/null; fi; [ -x "$COPILOT_PLUGIN_SYNC_PURGE" ] && "$COPILOT_PLUGIN_SYNC_PURGE" --id "$COPILOT_PLUGIN_SYNC_CHILD" --quiet >/dev/null 2>&1; fi'

if command -v setsid >/dev/null 2>&1; then
  setsid sh -c "$runner" >/dev/null 2>&1 &
else
  nohup sh -c "$runner" >/dev/null 2>&1 &
fi
disown 2>/dev/null || true

emit
