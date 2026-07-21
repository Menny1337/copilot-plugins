#!/usr/bin/env bash
# ado-sync-advisory.sh — sessionStart advisory for ado-session-sync.
#
# Surfaces a one-line summary of ado-session-sync outcomes that happened since you
# last saw them, by injecting { "additionalContext": "..." } at session start.
# Watermarked (seen.watermark) so each outcome is surfaced exactly once. Silent
# when the feature is disabled, when there's nothing new, or on the very first run
# (it just establishes a baseline). Best-effort: never blocks startup, always exits 0.
#
# Opt-in, with an explicit env override precedence (mirrors ado-session-sync.sh):
#   ADO_SESSION_SYNC=0 -> force-DISABLED, regardless of config. Checked FIRST,
#                             before reading the sessionStart payload or creating the
#                             per-session advisory lock, so a force-disabled session
#                             touches NEITHER the lock dir NOR seen.watermark/suggested-
#                             repos state — not just "stays silent" but genuinely inert.
#   ADO_SESSION_SYNC=1 -> force-ENABLED, regardless of config.
#   otherwise              -> existing config rule: adoSessionSync.enabled == true AND
#                             taskBackend == "ado" in ~/.copilot/assistant/config.json.

set -u

# Force-disable, checked before ANYTHING else touches disk (payload/lock/watermark).
if [ "${ADO_SESSION_SYNC:-}" = "0" ]; then
  exit 0
fi

LOG_DIR="$HOME/.copilot/logs/ado-session-sync"
JSONL="$LOG_DIR/runs.jsonl"
WM="$LOG_DIR/seen.watermark"
CONFIG="$HOME/.copilot/assistant/config.json"

# Read sessionStart payload for a run-once-per-session lock (this hook may fire
# from several plugin copies in one session).
payload=""
[ ! -t 0 ] && payload="$(cat 2>/dev/null || true)"
sid="$(printf '%s' "$payload" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' | head -1)"
case "$sid" in ''|*[!A-Za-z0-9._-]*) sid="" ;; esac
if [ -n "$sid" ]; then
  mkdir "${TMPDIR:-/tmp}/ado-advisory.$sid" 2>/dev/null || exit 0
fi

# Opt-in: stay silent unless the feature is enabled (env=0 already exited above).
enabled=0
if [ "${ADO_SESSION_SYNC:-}" = "1" ]; then
  enabled=1
elif [ -f "$CONFIG" ] && command -v jq >/dev/null 2>&1; then
  if [ "$(jq -r '.adoSessionSync.enabled // false' "$CONFIG" 2>/dev/null)" = "true" ] \
     && [ "$(jq -r '.taskBackend // ""' "$CONFIG" 2>/dev/null)" = "ado" ]; then
    enabled=1
  fi
fi
[ "$enabled" = "1" ] || exit 0


command -v jq >/dev/null 2>&1 || exit 0
[ -f "$JSONL" ] || exit 0

norm='.ts = (.ts // .timestamp // "") | .parent = (.parent // .parentSession // "") | .child = (.child // .syncSession // "")'
latest_ts="$(jq -r "$norm | .ts" "$JSONL" 2>/dev/null | tail -1)"
[ -n "$latest_ts" ] || exit 0

# First ever run: establish a baseline silently so we don't dump history.
if [ ! -f "$WM" ]; then
  printf '%s' "$latest_ts" > "$WM" 2>/dev/null || true
  exit 0
fi
last_seen="$(cat "$WM" 2>/dev/null || echo '')"

# Count meaningful new outcomes since the watermark.
new="$(jq -c "$norm | select(.ts > \"$last_seen\")" "$JSONL" 2>/dev/null)"
[ -n "$new" ] || exit 0

count() { printf '%s\n' "$new" | jq -c "select($1)" 2>/dev/null | grep -c . ; }
updated="$(printf '%s\n' "$new" | jq -c 'select(.event=="result" and .action!="skipped")' 2>/dev/null | grep -c .)"
skipped="$(printf '%s\n' "$new" | jq -c 'select(.event=="result" and .action=="skipped")' 2>/dev/null | grep -c .)"
errors="$(printf '%s\n' "$new"  | jq -c 'select(.event=="error" or (.event=="child-exit" and .exit!=0))' 2>/dev/null | grep -c .)"

# Always advance the watermark so nothing is surfaced twice.
printf '%s' "$latest_ts" > "$WM" 2>/dev/null || true

# Only speak when there is a real outcome (updates or errors); pure skips stay quiet.
if [ "$updated" -eq 0 ] && [ "$errors" -eq 0 ]; then
  exit 0
fi

parts=""
[ "$updated" -gt 0 ] && parts="${parts}${updated} item(s) updated"
if [ "$skipped" -gt 0 ]; then
  [ -n "$parts" ] && parts="$parts, "
  parts="${parts}${skipped} skipped"
fi
if [ "$errors" -gt 0 ]; then
  [ -n "$parts" ] && parts="$parts, "
  parts="${parts}${errors} error(s)"
fi

# Allowlist nudge: surface (once) a productive repo that is syncing but is NOT in
# adoSessionSync.syncRepos, so you can choose to always-sync it. Repos already in
# syncRepos are never nudged; de-duped via a suggested-repos watermark.
sugg_line=""
SUGG="$LOG_DIR/suggested-repos"
syncrepos_json="$(jq -c '.adoSessionSync.syncRepos // []' "$CONFIG" 2>/dev/null || echo '[]')"
suggest_repo="$(jq -rs --argjson repos "$syncrepos_json" --arg home "$HOME" '
  def expand($p): if $p=="~" then $home elif ($p|startswith("~/")) then $home + ($p|ltrimstr("~")) else $p end;
  def under($c;$p): ($p|rtrimstr("/")) as $pp | ($c==$pp or ($c|startswith($pp+"/")));
  def inrepos($c): ($repos // []) | any(. as $p | under($c; expand($p)));
  map('"$norm"') as $events
  | ($events | map(select(.event=="launch" and (.parent // "")!="")) | map({key:.parent, value:(.cwd // "")}) | from_entries) as $pcwd
  | [ $events | map(select(.event=="result" and (.action=="commented+tagged" or .action=="state-nudged" or .action=="tagged-only")))[] | $pcwd[(.parent // "")] // empty ]
  | map(select(. != "" and (inrepos(.)|not)))
  | (group_by(.) | map({cwd:.[0], n:length}) | sort_by(-.n))
  | (.[0].cwd // empty)
' "$JSONL" 2>/dev/null)"
if [ -n "$suggest_repo" ] && [ -f "$SUGG" ] && grep -qxF "$suggest_repo" "$SUGG" 2>/dev/null; then
  suggest_repo=""   # already nudged once
fi
if [ -n "$suggest_repo" ]; then
  printf '%s\n' "$suggest_repo" >> "$SUGG" 2>/dev/null || true
  sugg_line=" Tip: '$suggest_repo' is syncing but not in adoSessionSync.syncRepos — add it to always-sync (\`sync-status --repos\`)."
fi

msg="ⓘ ado-session-sync: since you last looked, ${parts}.${sugg_line} Run \`sync-status --errors\` for detail."
jq -nc --arg c "$msg" '{additionalContext:$c}' 2>/dev/null || true
exit 0
