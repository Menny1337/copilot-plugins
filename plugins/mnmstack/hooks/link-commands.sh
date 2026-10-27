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
skills/assistant-capture/scripts/github-state-transition.mjs
skills/assistant-query/scripts/ado-query.mjs
skills/assistant-query/scripts/github-query.mjs
skills/ado-session-sync/scripts/sync-status.sh
skills/ado-session-sync/scripts/sync-ui.mjs
skills/ado-session-sync/scripts/ado-auth.sh
"

[ -n "${HOME:-}" ] || exit 0
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)" || exit 0
INVOKED_PLUGIN_DIR="$(cd "$HOOK_DIR/.." 2>/dev/null && pwd -P)" || exit 0
PLUGIN_NAME="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$INVOKED_PLUGIN_DIR/plugin.json" 2>/dev/null | head -1)"
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
AGENCY_SESSIONS_DIR="$(__canonical_root "$HOME/.local/agency/plugins/sessions")"
TMP_INPUT_ROOT="${TMPDIR:-/tmp}"
TMP_ROOT="$(__canonical_root "${TMPDIR:-/tmp}")"
CUSTOM_CACHE_DIR=""
[ -z "${COPILOT_CACHE_HOME:-}" ] || CUSTOM_CACHE_DIR="$(__canonical_root "$COPILOT_CACHE_HOME")"

# Prefer a healthy installed copy even when an ephemeral Agency copy fires the
# hook first. The hook is idempotent, so every loaded copy may run; ranking
# below prevents a later ephemeral invocation from downgrading stable links.
PLUGIN_DIR="$INVOKED_PLUGIN_DIR"
INVOKED_IS_EPHEMERAL=0
case "$INVOKED_PLUGIN_DIR" in
  "$AGENCY_SESSIONS_DIR"/agency-plugin-*|"$TMP_INPUT_ROOT"/agency-plugin-*|"$TMP_ROOT"/agency-plugin-*) INVOKED_IS_EPHEMERAL=1 ;;
esac
if [ "$INVOKED_IS_EPHEMERAL" = 1 ] && [ -n "$PLUGIN_NAME" ]; then
  for __candidate in "$COPILOT_HOME_DIR/installed-plugins/"*/"$PLUGIN_NAME"; do
    [ -d "$__candidate" ] || continue
    __candidate="$(__canonical_root "$__candidate")"
    __candidate_name="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$__candidate/plugin.json" 2>/dev/null | head -1)"
    [ "$__candidate_name" = "$PLUGIN_NAME" ] || continue
    PLUGIN_DIR="$__candidate"
    break
  done
fi

__linked=""

__target_rank() {
  __target="$1"
  __rel="$2"
  __target_parent="$(dirname "$__target" 2>/dev/null || true)"
  if [ -d "$__target_parent" ]; then
    __target="$(cd "$__target_parent" 2>/dev/null && pwd -P)/$(basename "$__target")"
  fi
  [ -n "$PLUGIN_NAME" ] || { printf '0'; return; }
  case "$__target" in
    "$COPILOT_HOME_DIR/installed-plugins/"*/"$PLUGIN_NAME/$__rel") printf '40'; return ;;
    "$MAC_CACHE_DIR/marketplaces/"*/plugins/"$PLUGIN_NAME/$__rel") printf '30'; return ;;
    "$XDG_CACHE_DIR/marketplaces/"*/plugins/"$PLUGIN_NAME/$__rel") printf '30'; return ;;
  esac
  if [ -n "$CUSTOM_CACHE_DIR" ]; then
    case "$__target" in
      "$CUSTOM_CACHE_DIR/marketplaces/"*/plugins/"$PLUGIN_NAME/$__rel") printf '30'; return ;;
    esac
  fi
  case "$__target" in
    "$AGENCY_SESSIONS_DIR"/agency-plugin-*/"$PLUGIN_NAME/$__rel") printf '10'; return ;;
    "$TMP_INPUT_ROOT"/agency-plugin-*/"$PLUGIN_NAME/$__rel") printf '10'; return ;;
    "$TMP_ROOT"/agency-plugin-*/"$PLUGIN_NAME/$__rel") printf '10'; return ;;
    "$INVOKED_PLUGIN_DIR/$__rel")
      if [ "$INVOKED_IS_EPHEMERAL" = 1 ]; then printf '10'; else printf '50'; fi
      return ;;
    "$PLUGIN_DIR/$__rel") printf '30'; return ;;
  esac
  printf '0'
}

__owns_target() {
  [ "$(__target_rank "$1" "$2")" -gt 0 ] 2>/dev/null
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
  source_rank="$(__target_rank "$real" "$rel")"

  if [ -L "$dest" ]; then
    cur="$(readlink "$dest" 2>/dev/null || true)"
    # Update only links into this plugin (including an older installed/cache copy).
    # A foreign link with the same command basename is never sufficient ownership.
    if __owns_target "${cur:-}" "$rel"; then
      current_rank="$(__target_rank "${cur:-}" "$rel")"
      if [ "$cur" != "$real" ] && [ "$source_rank" -ge "$current_rank" ] 2>/dev/null; then
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
