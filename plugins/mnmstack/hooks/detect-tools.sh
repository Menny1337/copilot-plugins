#!/usr/bin/env bash
# detect-tools.sh — environment tool-awareness hook (sessionStart). Best-effort.
#
# Probes a CURATED list of dev-relevant CLI tools (hooks/default-tools.txt, plus an
# optional per-machine ~/.copilot/env-tools.txt) and injects a single concise
# line of awareness into the session via { "additionalContext": "..." } on stdout.
# The agent can then run `<tool> --help` on demand — we deliberately do NOT teach
# usage or create a skill per tool (that would clog context). Names only, no versions.
#
# Contract (see plugins/meta/skills/hooks-crafting): a sessionStart hook must
# never block or fail startup, so this is best-effort and ALWAYS exits 0:
#   - data file missing / no tools found -> silent, exit 0
#   - otherwise                          -> emit one additionalContext line, exit 0

set -u

# Run-once-per-session guard. This hook can fire more than once per session when the
# plugin is loaded from multiple sources (installed copy plus a --plugin-dir copy).
# De-dupe on the sessionId from the sessionStart stdin payload via an atomic mkdir
# lock. Best-effort: with no clean sessionId, run normally rather than risk a global
# empty-key lock that could suppress future sessions.
__sid=""
if [ ! -t 0 ]; then
  __payload="$(cat 2>/dev/null || true)"
  __sid="$(printf '%s' "$__payload" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' | head -1)"
fi
case "$__sid" in
  ''|*[!A-Za-z0-9._-]*) __sid="" ;;
esac
if [ -n "$__sid" ]; then
  mkdir "${TMPDIR:-/tmp}/detect-tools.$__sid" 2>/dev/null || exit 0
fi

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)" || exit 0
DEFAULTS="$HOOK_DIR/default-tools.txt"
OVERRIDE="${HOME:-}/.copilot/env-tools.txt"

[ -r "$DEFAULTS" ] || exit 0

# Collect candidate tool names: defaults first, then a strictly-sanitized override.
# Treat every line as data only (no eval). Allow conservative names; skip blanks and
# comments; cap the override to bound work and output.
__candidates=""
__add_from_file() {
  # $1 = file, $2 = max lines to honor (0 = unlimited)
  local f="$1" cap="$2" n=0 line t
  [ -r "$f" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    # trim surrounding whitespace
    line="$(printf '%s' "$line" | tr -d '[:space:]')"
    [ -n "$line" ] || continue
    case "$line" in
      *[!A-Za-z0-9._+-]*) continue ;;  # reject anything outside the safe charset
    esac
    [ "${#line}" -le 64 ] || continue
    __candidates="$__candidates$line
"
    n=$((n + 1))
    if [ "$cap" -gt 0 ] && [ "$n" -ge "$cap" ]; then break; fi
  done < "$f"
}

__add_from_file "$DEFAULTS" 0
__add_from_file "$OVERRIDE" 50

# Probe each unique candidate; keep only those resolvable on PATH. Sort + de-dupe for
# stable output.
__found=""
while IFS= read -r t; do
  [ -n "$t" ] || continue
  if command -v -- "$t" >/dev/null 2>&1; then
    __found="$__found$t
"
  fi
done <<EOF
$(printf '%s' "$__candidates" | sort -u)
EOF

__list="$(printf '%s' "$__found" | sort -u | sed '/^$/d' | paste -sd ',' - | sed 's/,/, /g')"
[ -n "$__list" ] || exit 0

__msg="[Environment — sessionStart hook] Detected executable names on PATH (curated probe): ${__list}. This list is curated, not exhaustive — tools not listed may still be available, and presence on PATH does not guarantee a tool is configured/authenticated. Verify with \`<tool> --help\` before nontrivial use."

# The message contains only safe ASCII (sanitized tool names + fixed text: no quotes,
# backslashes, or newlines), so it needs no further JSON escaping.
printf '{"additionalContext":"%s"}' "$__msg"
exit 0
