#!/usr/bin/env bash
# task-session-sync.sh — agentStop hook dispatcher (session-yield → task backend sync).
#
# Backend-neutral replacement for wiring `ado-session-sync.sh` directly to the
# agentStop hook. This script does no gating of its own beyond a recursion guard —
# it reads only `taskBackend` from config, then hands off (via `exec`, so the
# original stdin/argv/env are preserved byte-for-byte) to the concrete per-backend
# launcher:
#
#   taskBackend == "github"        -> github-session-sync.sh (new: GitHub Issues +
#                                      Projects v2, hidden-marker comments, local
#                                      session-to-issue mapping)
#   taskBackend == "ado" (or unset/anything else) -> ado-session-sync.sh (untouched —
#                                      every existing config, env override, test, and
#                                      behavior keeps working exactly as before; that
#                                      script's own opt-in check already no-ops unless
#                                      taskBackend == "ado", so delegating to it
#                                      unconditionally for the non-github case is safe)
#
# Because the ado path is a direct `exec` (not a re-implementation), 100% of
# ado-session-sync.sh's existing behavior — debounce, repo allowlist, recursion
# guard, detached-child cleanup, logging, and the ADO_SESSION_SYNC env
# overrides — is preserved without any duplicated logic that could drift.
#
# Always fails open: if a target launcher is missing or not executable, this
# script prints `{}` and exits 0 rather than letting a shell "command not found"
# error escape to the hook runner.

set -u

SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
emit() { printf '{}'; exit 0; }

# Recursion guard — checked before anything else touches stdin/disk, so a
# dispatched child (either backend) can never re-dispatch itself. Honors both the
# legacy ADO-specific flag and the neutral one (either being set is sufficient).
if [ -n "${COPILOT_PLUGIN_TASK_SYNC_ACTIVE:-}" ] || [ -n "${ADO_SYNC_ACTIVE:-}" ]; then
  emit
fi

# shellcheck source=plugins/core-agents/shared/assistant-config.sh
. "$SELF_DIR/../shared/assistant-config.sh" || emit
CONFIG="$(plugins_config_path)" || emit
backend="$(plugins_config_backend "$CONFIG")" || emit

case "$backend" in
  github)
    target="$SELF_DIR/github-session-sync.sh"
    ;;
  ado)
    target="$SELF_DIR/ado-session-sync.sh"
    ;;
  *)
    emit
    ;;
esac

if [ -x "$target" ]; then
  exec "$target"
fi

emit
