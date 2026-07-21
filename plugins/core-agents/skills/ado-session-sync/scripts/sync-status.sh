#!/usr/bin/env bash
# sync-status.sh — monitoring viewer for ado-session-sync.
#
# Summarizes the observability trail at ~/.copilot/logs/ado-session-sync/runs.jsonl:
# counts, recent runs, errors, and (optionally) a reconcile against the ADO board's
# session:<id> tags. Read-only; fail-soft.
#
# Usage:
#   sync-status.sh                 # summary + recent runs
#   sync-status.sh --follow        # summary + recent, then live-stream new events (-f)
#   sync-status.sh --tail 40       # show more recent events
#   sync-status.sh --session <id>  # only one parent session
#   sync-status.sh --since 2026-06-01   # only events on/after an ISO date
#   sync-status.sh --errors        # only failures (errors, blocked writes, nonzero exits)
#   sync-status.sh --reconcile     # cross-check the log against ADO session: tags
#   sync-status.sh --repos         # per-repo launches/outcomes + syncRepos allowlist suggestions
#   sync-status.sh --json          # emit filtered JSONL, normalizing legacy event fields
#   sync-status.sh --pretty        # force the framed, colorized human view
#   sync-status.sh --plain         # force the plain machine/agent view
#
# Presentation: by default the output auto-detects the terminal — a framed,
# colorized human view when stdout is a TTY, and the plain text below when piped
# or redirected (so agents and `| jq` keep working). Force either with --pretty /
# --plain; color also honors the NO_COLOR env var. --json is always machine output.
# --follow/-f prints the basic status first, then keeps rendering each new event as
# the hook appends it (Ctrl-C to stop); combine with --session/--since/--errors.

set -u

LOG_DIR="${COPILOT_PLUGIN_ADO_SYNC_LOGDIR:-$HOME/.copilot/logs/ado-session-sync}"
JSONL="$LOG_DIR/runs.jsonl"
HUMAN="$LOG_DIR/runs.log"
CONFIG="$HOME/.copilot/assistant/config.json"

session=""; since=""; tailn=20; reconcile=0; errors_only=0; want_json=0; follow=0; repos_view=0
pretty_opt=""; force_nocolor=0
while [ $# -gt 0 ]; do
  case "$1" in
    --session)  session="${2:-}"; shift 2 ;;
    --since)    since="${2:-}"; shift 2 ;;
    --tail)     tailn="${2:-20}"; shift 2 ;;
    --errors)   errors_only=1; shift ;;
    --follow|-f) follow=1; shift ;;
    --reconcile) reconcile=1; shift ;;
    --repos)    repos_view=1; shift ;;
    --json)     want_json=1; shift ;;
    --pretty|--human) pretty_opt=1; shift ;;
    --plain|--raw)    pretty_opt=0; shift ;;
    --no-color)       force_nocolor=1; shift ;;
    -h|--help)
      awk 'NR==1{next} /^#/{sub(/^# ?/,"");print;next} {exit}' "$0"; exit 0 ;;
    *) shift ;;
  esac
done

# Presentation mode: explicit flag wins, else auto-detect a TTY on stdout.
if [ -n "$pretty_opt" ]; then pretty="$pretty_opt"
elif [ -t 1 ]; then pretty=1
else pretty=0; fi
# Color is a subset of pretty: on only when pretty, NO_COLOR is unset, and not --no-color.
color=0
[ "$pretty" = 1 ] && [ -z "${NO_COLOR:-}" ] && [ "$force_nocolor" != 1 ] && color=1
if [ "$color" = 1 ]; then
  RST=$'\033[0m'; B=$'\033[1m'; DIM=$'\033[2m'
  RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; BLU=$'\033[34m'; CYN=$'\033[36m'; GRY=$'\033[90m'
else
  RST=""; B=""; DIM=""; RED=""; GRN=""; YLW=""; BLU=""; CYN=""; GRY=""
fi
DASHES="────────────────────────────────────────────────"
PR_ARGS=(--arg RST "$RST" --arg B "$B" --arg DIM "$DIM" --arg RED "$RED" \
         --arg GRN "$GRN" --arg YLW "$YLW" --arg BLU "$BLU" --arg GRY "$GRY")

# Plain per-event line (machine/agent view): unchanged, shared by recent + --follow.
RENDER_EXPR='
    (.ts) + "  " + (.event)
    + (if .parent then "  " + (.parent|tostring)[0:8] else "" end)
    + (if .item then "  item=" + (.item|tostring) else "" end)
    + (if .action then "  " + .action else "" end)
    + (if .reason then "  reason=" + .reason else "" end)
    + (if .stage then "  stage=" + .stage else "" end)
    + (if .event=="child-exit" then "  exit=" + (.exit|tostring) + "  " + ((.durationSec//0)|tostring) + "s" else "" end)
    + (if .note then "  — " + .note elif .detail then "  — " + .detail else "" end)
'

# Pretty per-event row: colored event glyph, HH:MM:SS, padded event, short session,
# #item, action/reason, child-exit code+duration, and the note on a dimmed indent.
PRETTY_EXPR='
    def pad(s;n): (s + "                    ")[0:n];
    (if .event=="launch" then $BLU
     elif .event=="result" and (.action=="blocked" or ((.reason//"")|startswith("write-block"))) then $RED
     elif .event=="result" and (.action=="skipped") then $YLW
     elif .event=="result" then $GRN
     elif .event=="skip" then $YLW
     elif .event=="error" then $RED
     elif .event=="child-exit" and ((.exit//0)!=0) then $RED
     elif .event=="child-exit" then $GRY
     else $RST end) as $c
    | $c + "●" + $RST + " "
    + $DIM + (.ts|tostring)[11:19] + $RST + "  "
    + $c + pad(.event;11) + $RST
    + (if .parent then " " + $DIM + (.parent|tostring)[0:8] + $RST else "" end)
    + (if .item then "  " + $B + "#" + (.item|tostring) + $RST else "" end)
    + (if .action then "  " + .action else "" end)
    + (if .reason then "  " + $YLW + .reason + $RST else "" end)
    + (if .stage then "  " + $DIM + "stage=" + .stage + $RST else "" end)
    + (if .event=="child-exit" then "  " + $DIM + "exit=" + ((.exit//0)|tostring) + " " + ((.durationSec//0)|tostring) + "s" + $RST else "" end)
    + (if (.note // .detail) then "\n     " + $DIM + "↳ " + ((.note // .detail)|tostring) + $RST else "" end)
'

# Normalize historical/manual fallback events that used the prompt payload names
# (`timestamp`, `parentSession`, `syncSession`) instead of the logger schema.
NORM_EXPR='
  . as $e
  | .ts = ($e.ts // $e.timestamp // "")
  | .parent = ($e.parent // $e.parentSession // "")
  | .child = ($e.child // $e.syncSession // "")
'

# render(): format event JSON from stdin — pretty rows or the plain line.
render() {
  if [ "$pretty" = 1 ]; then jq -r "${PR_ARGS[@]}" "$PRETTY_EXPR" 2>/dev/null
  else jq -r "$RENDER_EXPR" 2>/dev/null; fi
}

# divider(): a labeled section rule (pretty only; caller guards plain text).
divider() { printf '%s\n' "${CYN}──${RST} ${B}$1${RST} ${DIM}${DASHES}${RST}"; }

# live(): follow runs.jsonl and render each newly-appended event as it arrives.
# tail -n 0 = start from now (history was already printed); -F = keep following
# across the log's retention prune/rotation. $1 is the jq selection filter, so the
# live stream honors the same --session/--since/--errors filters as the static view.
live() {
  if [ "$pretty" = 1 ]; then
    echo; divider "live · following new events (Ctrl-C to stop)"
    tail -n 0 -F "$JSONL" 2>/dev/null \
      | jq -r --unbuffered "${PR_ARGS[@]}" "$NORM_EXPR | select($1) | $PRETTY_EXPR" 2>/dev/null
  else
    echo
    echo "── live · following new events (Ctrl-C to stop) ──"
    tail -n 0 -F "$JSONL" 2>/dev/null \
      | jq -r --unbuffered "$NORM_EXPR | select($1) | $RENDER_EXPR" 2>/dev/null
  fi
}

if [ ! -f "$JSONL" ]; then
  echo "No sync activity yet — $JSONL not found."
  echo "(The hook is opt-in: set adoSessionSync.enabled=true or ADO_SESSION_SYNC=1.)"
  if [ "$follow" = 1 ] && command -v jq >/dev/null 2>&1; then
    live "true"
  fi
  exit 0
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found — showing the raw human log tail instead:"
  [ -f "$HUMAN" ] && tail -n "$tailn" "$HUMAN"
  exit 0
fi

# Selection filter (parent session and/or since-date).
filt='true'
[ -n "$session" ] && filt="$filt and (.parent==\"$session\")"
[ -n "$since" ]   && filt="$filt and (.ts >= \"$since\")"
sel() { jq -c "$NORM_EXPR | select($filt)" "$JSONL" 2>/dev/null; }

# Genuine failures (NOT benign skips): error events, nonzero child-exits, and blocked/failed
# writes — logged as event=error reason=write-blocked, or (legacy) a result mislabeled
# action=blocked / reason=write-blocked*. Deliberate skips are a healthy outcome, not a failure.
# Match the write-block* prefix so both the canonical reason and legacy variants are caught.
FAIL_PRED='.event=="error" or (.event=="child-exit" and (.exit//0)!=0) or (.event=="result" and (.action=="blocked" or ((.reason//"")|startswith("write-block"))))'

# Selector for the live stream: base filter, plus the --errors predicate when set.
live_filt() {
  if [ "$errors_only" = 1 ]; then
    printf '%s' "$filt and ($FAIL_PRED)"
  else
    printf '%s' "$filt"
  fi
}

if [ "$want_json" = 1 ]; then
  if [ "$errors_only" = 1 ]; then sel | jq -c "select($FAIL_PRED)"; else sel; fi
  exit 0
fi

cnt() { sel | jq -c "select($1)" 2>/dev/null | wc -l | tr -d ' '; }

total="$(sel | wc -l | tr -d ' ')"
first_ts="$(sel | jq -r '.ts' 2>/dev/null | head -1)"
last_ts="$(sel | jq -r '.ts' 2>/dev/null | tail -1)"

# Header.
if [ "$pretty" = 1 ]; then
  printf '%s\n' "${CYN}╭─${RST} ${B}ado-session-sync${RST} ${DIM}· monitoring${RST} ${DIM}${CYN}${DASHES}${RST}"
  printf '%s\n' "  ${DIM}Log${RST}     $JSONL"
  if [ -n "$first_ts" ]; then
    printf '%s\n' "  ${DIM}Events${RST}  ${B}${total}${RST}   ${DIM}${first_ts} → ${last_ts}${RST}"
  else
    printf '%s\n' "  ${DIM}Events${RST}  ${B}${total}${RST}"
  fi
  [ -n "$session" ] && printf '%s\n' "  ${DIM}Filter${RST}  parent=$session"
  [ -n "$since" ]   && printf '%s\n' "  ${DIM}Filter${RST}  since=$since"
  echo
else
  echo "ado-session-sync — monitoring"
  echo "Log: $JSONL"
  echo "Events: $total${first_ts:+   ($first_ts → $last_ts)}"
  [ -n "$session" ] && echo "Filter: parent=$session"
  [ -n "$since" ]   && echo "Filter: since=$since"
  echo
fi

# Per-repo view: launches / outcomes (joined launch.cwd → result via parent) and
# repo-not-eligible children saved by the syncRepos gate, with allowlist suggestions.
if [ "$repos_view" = 1 ]; then
  syncrepos_json='[]'
  [ -f "$CONFIG" ] && syncrepos_json="$(jq -c '.adoSessionSync.syncRepos // []' "$CONFIG" 2>/dev/null || echo '[]')"
  if [ "$pretty" = 1 ]; then divider "Repos · launches / outcomes / saved children"
  else echo "Repos (launches / outcomes / saved children):"; fi
  sel | jq -rs "${PR_ARGS[@]}" --argjson repos "$syncrepos_json" --arg home "$HOME" '
    def expand($p): if $p=="~" then $home elif ($p|startswith("~/")) then $home + ($p|ltrimstr("~")) else $p end;
    def under($c;$p): ($p|rtrimstr("/")) as $pp | ($c==$pp or ($c|startswith($pp+"/")));
    def inrepos($c): ($repos // []) | any(. as $p | under($c; expand($p)));
    (map(select(.event=="launch" and (.parent // "")!="")) | map({key:.parent, value:(.cwd // "(none)")}) | from_entries) as $pcwd
    | (map(select(.event=="result"))) as $res
    | (map(select(.event=="skip" and .reason=="repo-not-eligible"))) as $saved
    | (( $pcwd | to_entries | map(.value)) + ($saved | map(.cwd // "(none)")) | unique) as $cwds
    | ($cwds | map( . as $c | {
        cwd:$c,
        launches: ([$pcwd|to_entries[]|select(.value==$c)]|length),
        saved:    ([$saved[]|select((.cwd // "(none)")==$c)]|length),
        updated:  ([$res[]|select(($pcwd[(.parent // "")] // "(none)")==$c and (.action=="commented+tagged" or .action=="state-nudged" or .action=="tagged-only"))]|length),
        skipped:  ([$res[]|select(($pcwd[(.parent // "")] // "(none)")==$c and .action=="skipped")]|length),
        allowed: inrepos($c)
      } ) | sort_by(-(.launches + .saved))) as $rows
    | ( $rows[] |
        (if .allowed then $GRN + "[sync]" + $RST else $DIM + "[    ]" + $RST end) as $mark
        | (if (.updated+.skipped)>0 then ((.updated*100/(.updated+.skipped))|floor) else null end) as $hit
        | "  " + $mark + " " + $B + .cwd + $RST
          + "\n         launches=" + (.launches|tostring)
          + (if .saved>0 then "  " + $GRN + "saved=" + (.saved|tostring) + $RST else "" end)
          + "  updated=" + (.updated|tostring) + "  skipped=" + (.skipped|tostring)
          + (if $hit!=null then "  hit=" + (if $hit==0 then $YLW else $GRN end) + ($hit|tostring) + "%" + $RST else "" end) ),
      "",
      "  " + $DIM + "Suggestions" + $RST + " (repos not in syncRepos):",
      ( [ $rows[] | select((.allowed|not) and .updated>0) ]
        | if length==0 then "    " + $DIM + "(none — every productive repo is already in syncRepos)" + $RST
          else (.[] | "    " + $GRN + "+ add to syncRepos:" + $RST + " " + .cwd + "  (" + (.updated|tostring) + " successful sync(s), not allowlisted)") end )
  '
  echo
  exit 0
fi

if [ "$errors_only" = 1 ]; then
  if [ "$pretty" = 1 ]; then divider "Failures · errors / blocked writes / nonzero exits"
  else echo "Failures (errors, blocked writes, nonzero exits):"; fi
  sel | jq -c "select($FAIL_PRED)" \
      | tail -n "$tailn" | render
  [ "$follow" = 1 ] && live "$(live_filt)"
  exit 0
fi

# Launches whose parent never logged a terminal result/error (the invariant is exactly one
# outcome per launch). Parent-based and conservative: a count >0 means sessions were launched
# whose sync child crashed or exited without recording any outcome.
nooutcome="$(comm -23 \
  <(sel | jq -r 'select(.event=="launch")|.parent // empty' 2>/dev/null | sort -u) \
  <(sel | jq -r 'select(.event=="result" or .event=="error")|.parent // empty' 2>/dev/null | sort -u) \
  2>/dev/null | grep -c .)"
[ -n "$nooutcome" ] || nooutcome=0

# Counts.
if [ "$pretty" = 1 ]; then
  divider "Counts"
  rt="$(cnt '.event=="result"')"; ro="$(cnt '.event=="result" and .action!="skipped"')"; rs="$(cnt '.event=="result" and .action=="skipped"')"
  et="$(cnt '.event=="child-exit"')"; eb="$(cnt '.event=="child-exit" and .exit!=0')"; ec="$(cnt '.event=="error"')"
  ecc="${B}${ec}${RST}"; [ "$ec" -gt 0 ] 2>/dev/null && ecc="${RED}${ec}${RST}"
  printf '  %s%-15s%s%s\n' "$DIM" "launches" "$RST" "${B}$(cnt '.event=="launch"')${RST}"
  printf '  %s%-15s%s%s\n' "$DIM" "results" "$RST" "${B}${rt}${RST}  ${DIM}(updated ${RST}${GRN}${ro}${RST}${DIM}, skipped ${RST}${YLW}${rs}${RST}${DIM})${RST}"
  printf '  %s%-15s%s%s\n' "$DIM" "gate-skips" "$RST" "${B}$(cnt '.event=="skip"')${RST}"
  printf '  %s%-15s%s%s\n' "$DIM" "child-exits" "$RST" "${B}${et}${RST}  ${DIM}(nonzero ${RST}${RED}${eb}${RST}${DIM})${RST}"
  printf '  %s%-15s%s%s\n' "$DIM" "errors" "$RST" "$ecc"
  bw="$(cnt '(.event=="error" and ((.reason//"")|startswith("write-block"))) or (.event=="result" and (.action=="blocked" or ((.reason//"")|startswith("write-block"))))')"
  bwc="${B}${bw}${RST}"; [ "${bw:-0}" -gt 0 ] 2>/dev/null && bwc="${RED}${bw}${RST}"
  printf '  %s%-15s%s%s\n' "$DIM" "blocked-writes" "$RST" "$bwc"
  noc="${B}${nooutcome}${RST}"; [ "${nooutcome:-0}" -gt 0 ] 2>/dev/null && noc="${YLW}${nooutcome}${RST}"
  printf '  %s%-15s%s%s\n' "$DIM" "no-outcome" "$RST" "$noc"
  echo
else
  echo "Counts:"
  printf '  launches     %s\n' "$(cnt '.event=="launch"')"
  res_total="$(cnt '.event=="result"')"
  res_ok="$(cnt '.event=="result" and .action!="skipped"')"
  res_skip="$(cnt '.event=="result" and .action=="skipped"')"
  printf '  results      %s  (updated %s, skipped %s)\n' "$res_total" "$res_ok" "$res_skip"
  printf '  gate-skips   %s\n' "$(cnt '.event=="skip"')"
  exits_total="$(cnt '.event=="child-exit"')"
  exits_bad="$(cnt '.event=="child-exit" and .exit!=0')"
  printf '  child-exits  %s  (nonzero %s)\n' "$exits_total" "$exits_bad"
  printf '  errors       %s\n' "$(cnt '.event=="error"')"
  printf '  blocked-writes %s\n' "$(cnt '(.event=="error" and ((.reason//"")|startswith("write-block"))) or (.event=="result" and (.action=="blocked" or ((.reason//"")|startswith("write-block"))))')"
  printf '  no-outcome     %s\n' "${nooutcome:-0}"
  echo
fi

# Breakdown of result actions and skip/error reasons (only if present).
actions="$(sel | jq -r 'select(.event=="result" and .action!=null)|.action' 2>/dev/null | sort | uniq -c | sort -rn)"
if [ -n "$actions" ]; then
  if [ "$pretty" = 1 ]; then divider "Result actions"; else echo "Result actions:"; fi
  printf '%s\n' "$actions" | sed 's/^/  /'; echo
fi
reasons="$(sel | jq -r 'select(.reason!=null)|.reason' 2>/dev/null | sort | uniq -c | sort -rn)"
if [ -n "$reasons" ]; then
  if [ "$pretty" = 1 ]; then divider "Reasons · skips / errors"; else echo "Reasons (skips/errors):"; fi
  printf '%s\n' "$reasons" | sed 's/^/  /'; echo
fi

if [ "$pretty" = 1 ]; then divider "Recent · last $tailn"; else echo "Recent (last $tailn):"; fi
sel | tail -n "$tailn" | render

# Live follow: after the basic status above, stream new events until Ctrl-C.
if [ "$follow" = 1 ]; then
  live "$(live_filt)"
  exit 0
fi

# Optional reconcile against the ADO board: verify each logged update's session
# tag actually landed. ADO WIQL `[System.Tags] CONTAINS` matches whole tags (not
# the `session:` prefix), so a board-wide tag query returns nothing — instead we
# read each logged item's System.Tags once and substring-check it locally.
if [ "$reconcile" = 1 ]; then
  echo
  if [ "$pretty" = 1 ]; then divider "Reconcile · ADO session: tags"
  else echo "Reconcile logged updates against ADO session: tags:"; fi
  if ! command -v az >/dev/null 2>&1; then
    echo "  az not on PATH — skipping reconcile."; exit 0
  fi
  org=""
  [ -f "$CONFIG" ] && org="$(jq -r '.ado.org // empty' "$CONFIG" 2>/dev/null)"
  if [ -z "$org" ]; then
    echo "  ado.org not in $CONFIG — skipping reconcile."; exit 0
  fi
  # Logged successful updates as "item<TAB>parent" pairs (skips excluded), sorted
  # by item so each item's tags are fetched only once.
  pairs="$(sel | jq -r 'select(.event=="result" and .item!=null and .action!="skipped") | "\(.item)\t\(.parent)"' 2>/dev/null | sort -u)"
  if [ -z "$pairs" ]; then
    echo "  no logged updates to reconcile."; exit 0
  fi
  ok=0; missing=0; unknown=0; last_it=""; tags=""
  TAB="$(printf '\t')"
  while IFS="$TAB" read -r it parent; do
    [ -z "$it" ] && continue
    if [ "$it" != "$last_it" ]; then
      tags="$(az boards work-item show --id "$it" --org "$org" \
                --query 'fields."System.Tags"' -o tsv </dev/null 2>/dev/null)"
      last_it="$it"
    fi
    if [ -z "$tags" ]; then
      unknown=$((unknown+1)); printf '%s\n' "  ${YLW}?${RST} #$it — could not read tags (logged session:${parent%%-*}…)"
    elif printf '%s' "$tags" | grep -qF "session:${parent%%-*}"; then
      # Matches the canonical full tag and the short-form session:<8-hex> variant
      # (a full tag begins with that prefix, so matching the prefix covers both).
      ok=$((ok+1))
    else
      missing=$((missing+1)); printf '%s\n' "  ${RED}⚠${RST} #$it — logged session:${parent%%-*}… NOT on board (update may have failed)"
    fi
  done <<EOF
$pairs
EOF
  printf '%s\n' "  verified: ${GRN}$ok${RST}    missing: ${RED}$missing${RST}    unreadable: ${YLW}$unknown${RST}"
  [ "$missing" -eq 0 ] && [ "$unknown" -eq 0 ] && printf '%s\n' "  ${GRN}✓${RST} all $ok logged update(s) are present on the board."
fi
