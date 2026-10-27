#!/usr/bin/env bash
# Sourced by hooks and commands; never reads config or changes the caller's env on load.

plugins_config_path() {
  local path="${COPILOT_PLUGIN_ASSISTANT_CONFIG:-${COPILOT_PLUGIN_ADO_CONFIG:-$HOME/.copilot/assistant/config.json}}"
  case "$path" in
    "~") path="$HOME" ;;
    "~/"*|"~\\"*) path="$HOME/${path:2}" ;;
  esac
  case "$path" in /*|[a-zA-Z]:[/\\]*) ;; *) path="$PWD/$path" ;; esac
  printf '%s\n' "$path"
}

# Missing default config is local Markdown; an invalid selected file is an error.
# Use jq when available, otherwise the bundled Node reader. Never grep JSON.
plugins_config_backend() {
  local path="$1" mode="${2:-backend}"
  if [ ! -e "$path" ] && [ ! -L "$path" ] \
     && [ -z "${COPILOT_PLUGIN_ASSISTANT_CONFIG:-}${COPILOT_PLUGIN_ADO_CONFIG:-}" ]; then
    printf 'markdown\n'; return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -ers --arg mode "$mode" '
      def text: type == "string" and test("\\S");
      def board: (.org | text) and (.project | text);
      def github:
        (.owner | text) and (.repo | text)
        and ((.projectNumber | type) == "number" or (.projectNumber | type) == "string")
        and ((.projectNumber | tonumber) as $n | $n > 0 and $n <= 9007199254740991 and ($n | floor) == $n)
        and ((has("ownerType") | not) or .ownerType == "user" or .ownerType == "org");
      if length != 1 or (.[0] | type) != "object" then error("object required") else .[0] end
      | if $mode == "object" then "object" else
        (if has("taskBackend") then .taskBackend else "markdown" end) as $backend
      | if $backend == "markdown" then $backend
        elif $backend == "ado" and (.ado | board) then $backend
        elif $backend == "github" and (.github | github) then $backend
        else error("invalid backend or target") end end
    ' "$path" 2>/dev/null && return 0
  elif command -v node >/dev/null 2>&1; then
    node --input-type=module - "$path" "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/assistant-config.mjs" "$mode" <<'NODE' && return 0
import { pathToFileURL } from 'node:url';
const { readAssistantConfig, selectedBackend } = await import(pathToFileURL(process.argv[3]));
try {
  const { cfg } = readAssistantConfig(process.argv[2]);
  console.log(process.argv[4] === 'object' ? 'object' : selectedBackend(cfg));
} catch {
  process.exitCode = 1;
}
NODE
  fi
  printf 'assistant config: cannot read a valid backend and target; check COPILOT_PLUGIN_ASSISTANT_CONFIG (legacy COPILOT_PLUGIN_ADO_CONFIG) or the default config, and jq/Node availability\n' >&2
  return 1
}
