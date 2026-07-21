#!/usr/bin/env bash
# Advisory memory-lint hook (sessionStart). Best-effort; never blocks the session.
# Delegates to lint-memory-advisory.mjs, which surfaces drift via additionalContext
# and always exits 0. Silent when node is unavailable or memory is clean.

set -u

# Run-once-per-session guard: this hook can fire more than once per session when
# core-skills is loaded from multiple sources (e.g. an installed copy plus a
# --plugin-dir copy). De-dupe on the sessionId from the sessionStart stdin payload
# via an atomic mkdir lock. Best-effort: with no clean sessionId, run normally so
# we never wrongly suppress the advisory.
__sid=""
if [ ! -t 0 ]; then
  __payload="$(cat 2>/dev/null || true)"
  __sid="$(printf '%s' "$__payload" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' | head -1)"
fi
case "$__sid" in
  ''|*[!A-Za-z0-9._-]*) __sid="" ;;
esac
if [ -n "$__sid" ]; then
  mkdir "${TMPDIR:-/tmp}/lint-memory-advisory.$__sid" 2>/dev/null || exit 0
fi

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

command -v node >/dev/null 2>&1 || exit 0
node "$HOOK_DIR/lint-memory-advisory.mjs" 2>/dev/null || true
exit 0
