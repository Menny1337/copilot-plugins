#!/usr/bin/env bash
# link-commands.sh — expose this plugin's CLI command(s) on PATH (sessionStart). Best-effort.
#
# Copilot plugins have no native command->PATH installer, so this hook reproduces that the
# same way the repo's other sessionStart hooks self-provision (e.g. ensure-core-skills.sh):
# on each session it idempotently links the plugin's command script(s) into ~/.local/bin,
# so an installed plugin's command(s) (e.g. `ado-query`) work out of the box — no manual step.
#
# The script(s) stay in their owning skill's scripts/ dir (the single source of truth); this
# hook only links them onto PATH. To expose another command, add its plugin-relative path to
# COMMANDS below. The PATH name is the file's basename minus its script extension.
#
# Contract (see plugins/meta/skills/hooks-crafting): a sessionStart hook must never block
# or fail startup, so this is best-effort and ALWAYS exits 0. It announces via a single
# { "additionalContext": "..." } line ONLY when it creates/updates a link (or the target dir
# is not on PATH) — silent otherwise. It never clobbers a command it does not own (a foreign
# file/symlink of the same name is skipped).

set -u

# Plugin-relative paths to the executable command script(s) this plugin exposes on PATH.
COMMANDS="
skills/assistant-capture/scripts/assistant-store.mjs
skills/assistant-query/scripts/ado-query.mjs
skills/ado-session-sync/scripts/sync-status.sh
skills/ado-session-sync/scripts/sync-ui.mjs
skills/ado-session-sync/scripts/ado-auth.sh
"

# --- run-once-per-session guard -------------------------------------------------------
# This hook can fire more than once per session (installed copy plus a --plugin-dir copy).
# De-dupe on the sessionId from the sessionStart stdin payload via an atomic mkdir lock.
# Best-effort: with no clean sessionId, run normally.
__sid=""
if [ ! -t 0 ]; then
  __payload="$(cat 2>/dev/null || true)"
  __sid="$(printf '%s' "$__payload" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p' | head -1)"
fi
case "$__sid" in
  ''|*[!A-Za-z0-9._-]*) __sid="" ;;
esac
if [ -n "$__sid" ]; then
  mkdir "${TMPDIR:-/tmp}/link-commands.$__sid" 2>/dev/null || exit 0
fi

[ -n "${HOME:-}" ] || exit 0
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)" || exit 0
PLUGIN_DIR="$(cd "$HOOK_DIR/.." 2>/dev/null && pwd)" || exit 0
PLUGIN_NAME="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PLUGIN_DIR/plugin.json" 2>/dev/null | head -1)"
DEST_DIR="$HOME/.local/bin"

mkdir -p "$DEST_DIR" 2>/dev/null || exit 0

# command name = basename minus a known script extension
__cmd_name() {
  case "$1" in
    *.mjs) printf '%s' "${1%.mjs}" ;;
    *.cjs) printf '%s' "${1%.cjs}" ;;
    *.js)  printf '%s' "${1%.js}" ;;
    *.sh)  printf '%s' "${1%.sh}" ;;
    *.ps1) printf '%s' "${1%.ps1}" ;;
    *.cmd) printf '%s' "${1%.cmd}" ;;
    *.bat) printf '%s' "${1%.bat}" ;;
    *)     printf '%s' "$1" ;;
  esac
}

__canonical_root() {
  if [ -d "$1" ]; then
    (cd "$1" 2>/dev/null && pwd -P) || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

COPILOT_HOME_DIR="$(__canonical_root "${COPILOT_HOME:-$HOME/.copilot}")"
MAC_CACHE_DIR="$(__canonical_root "$HOME/Library/Caches/copilot")"
XDG_CACHE_DIR="$(__canonical_root "${XDG_CACHE_HOME:-$HOME/.cache}/copilot")"
CUSTOM_CACHE_DIR=""
[ -z "${COPILOT_CACHE_HOME:-}" ] || CUSTOM_CACHE_DIR="$(__canonical_root "$COPILOT_CACHE_HOME")"

__linked=""

__owns_target() {
  __target="$1"
  __rel="$2"
  __target_parent="$(dirname "$__target" 2>/dev/null || true)"
  if [ -d "$__target_parent" ]; then
    __target="$(cd "$__target_parent" 2>/dev/null && pwd -P)/$(basename "$__target")"
  fi
  case "$__target" in
    "$PLUGIN_DIR/$__rel") return 0 ;;
  esac
  [ -n "$PLUGIN_NAME" ] || return 1
  case "$__target" in
    "$COPILOT_HOME_DIR/installed-plugins/"*/"$PLUGIN_NAME/$__rel") return 0 ;;
    "$MAC_CACHE_DIR/marketplaces/"*/plugins/"$PLUGIN_NAME/$__rel") return 0 ;;
    "$XDG_CACHE_DIR/marketplaces/"*/plugins/"$PLUGIN_NAME/$__rel") return 0 ;;
  esac
  if [ -n "$CUSTOM_CACHE_DIR" ]; then
    case "$__target" in
      "$CUSTOM_CACHE_DIR/marketplaces/"*/plugins/"$PLUGIN_NAME/$__rel") return 0 ;;
    esac
  fi
  return 1
}

# --- link each declared command directly to its skill-bundled script ------------------
while IFS= read -r rel; do
  rel="$(printf '%s' "$rel" | tr -d '[:space:]')"
  [ -n "$rel" ] || continue
  src="$PLUGIN_DIR/$rel"
  [ -e "$src" ] || continue
  base="$(basename "$src")"
  real="$(cd "$(dirname "$src")" 2>/dev/null && pwd -P)/$base" || continue
  cmd="$(__cmd_name "$base")"
  [ -n "$cmd" ] || continue
  dest="$DEST_DIR/$cmd"

  if [ -L "$dest" ]; then
    cur="$(readlink "$dest" 2>/dev/null || true)"
    # Update only links into this plugin (including an older installed/cache copy).
    # A foreign link with the same command basename is never sufficient ownership.
    if __owns_target "${cur:-}" "$rel"; then
      if [ "$cur" != "$real" ]; then
        ln -sf "$real" "$dest" 2>/dev/null && __linked="$__linked $cmd"
      fi
    fi
    continue
  fi
  if [ -e "$dest" ]; then
    continue                            # foreign regular file — never clobber
  fi
  ln -s "$real" "$dest" 2>/dev/null && __linked="$__linked $cmd"
done <<EOF
$COMMANDS
EOF

# Self-heal: prune our own dangling links (target script removed, e.g. uninstalled),
# matched precisely against the command basenames we manage — never foreign entries.
while IFS= read -r rel; do
  rel="$(printf '%s' "$rel" | tr -d '[:space:]')"
  [ -n "$rel" ] || continue
  base="$(basename "$rel")"
  cmd="$(__cmd_name "$base")"
  dest="$DEST_DIR/$cmd"
  if [ -L "$dest" ] && [ ! -e "$dest" ]; then
    tgt="$(readlink "$dest" 2>/dev/null || true)"
    __owns_target "${tgt:-}" "$rel" && rm -f "$dest" 2>/dev/null || true
  fi
done <<EOF
$COMMANDS
EOF

# --- announce only when there is news -------------------------------------------------
__linked="$(printf '%s' "$__linked" | sed 's/^ *//;s/ *$//')"
[ -n "$__linked" ] || exit 0           # nothing changed — stay silent

__list="$(printf '%s' "$__linked" | tr ' ' '\n' | sort -u | paste -sd ',' - | sed 's/,/, /g')"

__path_note=""
case ":${PATH:-}:" in
  *":$DEST_DIR:"*) : ;;
  *) __path_note=" NOTE: $DEST_DIR is not on your PATH — add it (e.g. 'export PATH=\$HOME/.local/bin:\$PATH') to use the command(s) directly." ;;
esac

__msg="[core-agents — sessionStart] Linked plugin command(s) onto PATH in ~/.local/bin: ${__list}. Run \`<cmd> --help\` to get started.${__path_note}"
printf '{"additionalContext":"%s"}' "$__msg"
exit 0
