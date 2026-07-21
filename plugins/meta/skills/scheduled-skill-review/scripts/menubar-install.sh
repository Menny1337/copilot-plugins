#!/usr/bin/env bash
set -euo pipefail

PRODUCT_NAME="SkillReviewMenuBar"
LABEL="com.copilotplugins.skill-review.menubar"
WS="${HOME}/.copilot/agent-architect/skill-reviews"
BASE_PATH="/opt/homebrew/bin:/usr/local/bin:/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LAUNCH_PATH="${BASE_PATH}${PATH:+:${PATH}}"
export PATH="${LAUNCH_PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_BUNDLE="$("${SCRIPT_DIR}/menubar-build.sh")"
INSTALL_APP_DIR="${HOME}/Applications"
INSTALLED_APP="${INSTALL_APP_DIR}/${PRODUCT_NAME}.app"
APP_BINARY="${INSTALLED_APP}/Contents/MacOS/${PRODUCT_NAME}"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${LAUNCH_AGENTS_DIR}/${LABEL}.plist"
TEMPLATE_PATH="${SCRIPT_DIR}/menubar-app/packaging/${LABEL}.plist.in"
RUN_NOW_WRAPPER="${WS}/RunSkillReviewNow.command"

xml_escape() {
  perl -CS -e 'my $s = shift; $s =~ s/&/&amp;/g; $s =~ s/</&lt;/g; $s =~ s/>/&gt;/g; print $s;' "$1"
}

mkdir -p "${INSTALL_APP_DIR}" "${LAUNCH_AGENTS_DIR}" "${WS}/logs"
rm -rf "${INSTALLED_APP}"
cp -R "${APP_BUNDLE}" "${INSTALLED_APP}"

SCRIPT_DIR_JSON="$(SCRIPT_DIR="${SCRIPT_DIR}" node -e 'process.stdout.write(JSON.stringify({ scriptDir: process.env.SCRIPT_DIR }) + "\n")')"
printf '%s' "${SCRIPT_DIR_JSON}" > "${WS}/menubar.json"

cat > "${RUN_NOW_WRAPPER}" <<EOF
#!/bin/bash
exec "${SCRIPT_DIR}/daemon-ctl.sh" run-now
EOF
chmod +x "${RUN_NOW_WRAPPER}"

APP_BINARY_ESC="$(xml_escape "${APP_BINARY}")"
LAUNCH_PATH_ESC="$(xml_escape "${LAUNCH_PATH}")"
SCRIPT_DIR_ESC="$(xml_escape "${SCRIPT_DIR}")"
WS_ESC="$(xml_escape "${WS}")"
APP_BINARY="${APP_BINARY_ESC}" PATH_VALUE="${LAUNCH_PATH_ESC}" SCRIPT_DIR_VALUE="${SCRIPT_DIR_ESC}" WS_VALUE="${WS_ESC}" \
  perl -0pe 's/\@APP_BINARY\@/$ENV{APP_BINARY}/g; s/\@PATH\@/$ENV{PATH_VALUE}/g; s/\@SCRIPT_DIR\@/$ENV{SCRIPT_DIR_VALUE}/g; s/\@WS\@/$ENV{WS_VALUE}/g' \
  "${TEMPLATE_PATH}" > "${PLIST_PATH}"

DOMAIN="gui/$(id -u)"

# Tear down any existing instance, then (re)load. `bootstrap` can transiently
# fail with EIO (5: Input/output error) when the just-booted-out job is still
# tearing down, so retry with a fresh bootout and short backoff between tries.
launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true

bootstrap_ok=0
bootstrap_err=""
for attempt in 1 2 3 4 5; do
  if bootstrap_err="$(launchctl bootstrap "${DOMAIN}" "${PLIST_PATH}" 2>&1)"; then
    bootstrap_ok=1
    break
  fi
  echo "LaunchAgent bootstrap attempt ${attempt} failed: ${bootstrap_err}" >&2
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  sleep "${attempt}"
done

if [ "${bootstrap_ok}" -ne 1 ]; then
  echo "Failed to bootstrap ${LABEL} after retries. Last error: ${bootstrap_err}" >&2
  echo "Retry manually once the old instance has exited:" >&2
  echo "  launchctl bootout ${DOMAIN}/${LABEL}; launchctl bootstrap ${DOMAIN} \"${PLIST_PATH}\"" >&2
  exit 1
fi

# Guarantee a fresh running instance even if an older copy was still resident.
launchctl kickstart -k "${DOMAIN}/${LABEL}" 2>/dev/null || true

echo "Installed ${PRODUCT_NAME} to ${INSTALLED_APP}"
echo "Loaded LaunchAgent ${LABEL}"
echo "Verify with: launchctl print ${DOMAIN}/${LABEL}"
echo "Logs: ${WS}/logs/menubar.out.log and ${WS}/logs/menubar.err.log"
