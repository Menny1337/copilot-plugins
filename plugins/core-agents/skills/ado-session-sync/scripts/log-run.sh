#!/usr/bin/env bash
# log-run.sh — structured logger for ado-session-sync observability.
#
# Single source of truth for the runs.jsonl event schema. Appends one JSON line
# (atomic, <PIPE_BUF) to ~/.copilot/logs/ado-session-sync/runs.jsonl and a
# human-readable line to runs.log. Used by BOTH the agentStop launcher and the
# ado-session-sync skill so every gate decision, launch, child exit, and outcome
# lands in one audit trail.
#
# Verbosity: the selected backend's sync block logLevel in the selected config
#   (or env COPILOT_PLUGIN_ADO_SYNC_LOGLEVEL) = off | result | debug. Default "result".
#   High-frequency gate skips (opt-in-disabled, recursion-guard) are debug-only.
#
# Always fail-open (exit 0) — logging must never break a sync or a session.
#
# Usage:
#   log-run.sh --event <launch|skip|child-exit|result|error> [flags]
# Flags (all optional except --event):
#   --parent <id>   parent (triggering) session id
#   --child <id>    child (sync) session id
#   --cwd <path>    working directory
#   --childlog <p>  path to the child's full stdout log
#   --reason <r>    skip/error reason (e.g. debounced, ambiguous, no-work)
#   --item <n>      ADO work item id (numeric)
#   --action <a>    commented+tagged | tagged-only | state-nudged | skipped
#   --note <text>   short human note (kept terse; no secrets)
#   --detail <text> extra context for skips/errors
#   --stage <s>     error stage (precondition|infer|update)
#   --exit <n>      child process exit code (numeric)
#   --duration <n>  child duration in seconds (numeric)
#   --maybe-prune   opportunistically prune old logs (throttled to once/day)

set -u

LOG_DIR="$HOME/.copilot/logs/ado-session-sync"
. "$(dirname "${BASH_SOURCE[0]}")/../../../shared/assistant-config.sh" || exit 0
CONFIG="$(plugins_config_path)" || exit 0
backend="$(plugins_config_backend "$CONFIG")" || exit 0
sync_block="adoSessionSync"
[ "$backend" = "github" ] && sync_block="taskSessionSync"
CONFIG_FIELD="$(dirname "${BASH_SOURCE[0]}")/../../../hooks/scripts/config-field.mjs"

event=""; parent=""; child=""; cwd=""; childlog=""; reason=""
item=""; action=""; note=""; detail=""; stage=""; exitc=""; duration=""; maybe_prune=0
while [ $# -gt 0 ]; do
  case "$1" in
    --event)      event="${2:-}"; shift 2 ;;
    --parent)     parent="${2:-}"; shift 2 ;;
    --child)      child="${2:-}"; shift 2 ;;
    --cwd)        cwd="${2:-}"; shift 2 ;;
    --childlog)   childlog="${2:-}"; shift 2 ;;
    --reason)     reason="${2:-}"; shift 2 ;;
    --item)       item="${2:-}"; shift 2 ;;
    --action)     action="${2:-}"; shift 2 ;;
    --note)       note="${2:-}"; shift 2 ;;
    --detail)     detail="${2:-}"; shift 2 ;;
    --stage)      stage="${2:-}"; shift 2 ;;
    --exit)       exitc="${2:-}"; shift 2 ;;
    --duration)   duration="${2:-}"; shift 2 ;;
    --maybe-prune) maybe_prune=1; shift ;;
    *)            shift ;;
  esac
done
[ -n "$event" ] || exit 0

# Resolve verbosity (env override wins, then config, then default).
level="${COPILOT_PLUGIN_ADO_SYNC_LOGLEVEL:-}"
if [ -z "$level" ] && [ -f "$CONFIG" ]; then
  if command -v jq >/dev/null 2>&1; then
    level="$(jq -r --arg block "$sync_block" '.[$block].logLevel // "result"' "$CONFIG" 2>/dev/null)"
  elif command -v node >/dev/null 2>&1; then
    level="$(node "$CONFIG_FIELD" log-level "$CONFIG" --backend "$backend")"
  fi
fi
case "$level" in off|result|debug) ;; *) level="result" ;; esac
[ "$level" = "off" ] && exit 0

# Event level: noisy gate skips are debug-only; everything else is result-level.
ev_level="result"
case "$event:$reason" in
  skip:opt-in-disabled|skip:recursion-guard) ev_level="debug" ;;
esac
[ "$level" = "result" ] && [ "$ev_level" = "debug" ] && exit 0

mkdir -p "$LOG_DIR" 2>/dev/null || exit 0
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

is_int() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

# Build the JSON line (jq for safe escaping; python3 fallback).
line=""
if command -v jq >/dev/null 2>&1; then
  args=(--arg ts "$ts" --arg event "$event")
  filt='{ts:$ts,event:$event'
  add_s() { [ -n "$2" ] && { args+=(--arg "$1" "$2"); filt="$filt,$1:\$$1"; }; }
  add_n() { [ -n "$2" ] && is_int "$2" && { args+=(--argjson "$1" "$2"); filt="$filt,$1:\$$1"; }; }
  add_s parent "$parent"; add_s child "$child"; add_s cwd "$cwd"
  add_s childLog "$childlog"; add_s reason "$reason"; add_s action "$action"
  add_s note "$note"; add_s detail "$detail"; add_s stage "$stage"
  add_n item "$item"; add_n exit "$exitc"; add_n durationSec "$duration"
  filt="$filt}"
  line="$(jq -nc "${args[@]}" "$filt" 2>/dev/null)"
fi
if [ -z "$line" ] && command -v python3 >/dev/null 2>&1; then
  line="$(python3 - "$ts" "$event" "$parent" "$child" "$cwd" "$childlog" "$reason" \
    "$action" "$note" "$detail" "$stage" "$item" "$exitc" "$duration" <<'PY' 2>/dev/null
import json,sys
(ts,event,parent,child,cwd,childlog,reason,action,note,detail,stage,item,exitc,duration)=sys.argv[1:16]
o={"ts":ts,"event":event}
for k,v in (("parent",parent),("child",child),("cwd",cwd),("childLog",childlog),
            ("reason",reason),("action",action),("note",note),("detail",detail),("stage",stage)):
    if v: o[k]=v
for k,v in (("item",item),("exit",exitc),("durationSec",duration)):
    if v and v.lstrip("-").isdigit(): o[k]=int(v)
print(json.dumps(o,separators=(",",":")))
PY
)"
fi
[ -n "$line" ] && printf '%s\n' "$line" >> "$LOG_DIR/runs.jsonl" 2>/dev/null

# Human-readable mirror.
h="$ts  $event"
[ -n "$parent" ]   && h="$h  parent=$parent"
[ -n "$child" ]    && h="$h  child=$child"
[ -n "$item" ]     && h="$h  item=$item"
[ -n "$action" ]   && h="$h  action=$action"
[ -n "$reason" ]   && h="$h  reason=$reason"
[ -n "$stage" ]    && h="$h  stage=$stage"
[ -n "$exitc" ]    && h="$h  exit=$exitc"
[ -n "$duration" ] && h="$h  ${duration}s"
short="${note:-$detail}"
[ -n "$short" ]    && h="$h  — $(printf '%s' "$short" | tr '\n' ' ' | cut -c1-160)"
printf '%s\n' "$h" >> "$LOG_DIR/runs.log" 2>/dev/null

# Opportunistic, throttled retention (once per day).
if [ "$maybe_prune" = "1" ]; then
  retdays=30
  if [ -f "$CONFIG" ]; then
    v=""
    if command -v jq >/dev/null 2>&1; then
      v="$(jq -r --arg block "$sync_block" '.[$block].retentionDays // empty' "$CONFIG" 2>/dev/null)"
    elif command -v node >/dev/null 2>&1; then
      v="$(node "$CONFIG_FIELD" retention-days "$CONFIG" --backend "$backend")"
    fi
    is_int "$v" && retdays="$v"
  fi
  if [ "$retdays" -gt 0 ] 2>/dev/null; then
    marker="$LOG_DIR/.last-prune"; now="$(date +%s)"; lastp=0
    [ -f "$marker" ] && { lastp="$(cat "$marker" 2>/dev/null || echo 0)"; is_int "$lastp" || lastp=0; }
    if [ $(( now - lastp )) -ge 86400 ]; then
      printf '%s' "$now" > "$marker" 2>/dev/null || true
      find "$LOG_DIR" -maxdepth 1 -name '*.log' ! -name 'runs.log' -mtime +"$retdays" -delete 2>/dev/null || true
      cutoff="$(date -u -v-"${retdays}"d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
        || date -u -d "${retdays} days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"
      if [ -n "$cutoff" ] && [ -f "$LOG_DIR/runs.jsonl" ] && command -v jq >/dev/null 2>&1; then
        tmp="$LOG_DIR/.runs.jsonl.tmp"
        if jq -c "select((.ts // .timestamp // \"\") >= \"$cutoff\")" "$LOG_DIR/runs.jsonl" > "$tmp" 2>/dev/null; then
          mv "$tmp" "$LOG_DIR/runs.jsonl" 2>/dev/null || rm -f "$tmp" 2>/dev/null
        else
          rm -f "$tmp" 2>/dev/null
        fi
      fi
    fi
  fi
fi

exit 0
