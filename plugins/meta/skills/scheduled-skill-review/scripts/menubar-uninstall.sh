#!/usr/bin/env bash
set -euo pipefail

PRODUCT_NAME="SkillReviewMenuBar"
LABEL="com.copilotplugins.skill-review.menubar"
WS="${HOME}/.copilot/agent-architect/skill-reviews"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
INSTALLED_APP="${HOME}/Applications/${PRODUCT_NAME}.app"
RUN_NOW_WRAPPER="${WS}/RunSkillReviewNow.command"
MENUBAR_CONFIG="${WS}/menubar.json"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/menubar-launch-agent.sh"
remove_menubar_launch_agents "${INSTALLED_APP}/Contents/MacOS/${PRODUCT_NAME}"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
rm -f "${PLIST_PATH}"
rm -rf "${INSTALLED_APP}"
rm -f "${RUN_NOW_WRAPPER}" "${MENUBAR_CONFIG}"

echo "Unloaded LaunchAgent ${LABEL} (if it was loaded)"
echo "Removed ${PLIST_PATH}"
echo "Removed ${INSTALLED_APP}"
echo "Removed ${RUN_NOW_WRAPPER}"
echo "Removed ${MENUBAR_CONFIG}"
