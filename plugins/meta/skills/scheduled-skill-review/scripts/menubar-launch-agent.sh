#!/usr/bin/env bash

# Discover previous labels from installed plists instead of embedding old identities.
remove_menubar_launch_agents() {
  local app_binary="$1"
  local launch_agents_dir="${HOME}/Library/LaunchAgents"
  local domain="gui/$(id -u)"
  local plist label program

  for plist in "${launch_agents_dir}"/com.*.skill-review.menubar.plist; do
    [ -f "${plist}" ] && [ ! -L "${plist}" ] || continue
    program="$(plutil -extract ProgramArguments.0 raw -o - "${plist}" 2>/dev/null)" || continue
    [ "${program}" = "${app_binary}" ] || continue
    label="$(plutil -extract Label raw -o - "${plist}" 2>/dev/null)" || continue
    [ "${plist}" = "${launch_agents_dir}/${label}.plist" ] || continue

    if ! launchctl bootout "${domain}/${label}" 2>/dev/null; then
      if launchctl print "${domain}/${label}" >/dev/null 2>&1; then
        echo "Could not unload the installed menu-bar LaunchAgent; leaving it unchanged." >&2
        return 1
      fi
    fi
    rm -f "${plist}" || return 1
  done
}
