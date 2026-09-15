#!/usr/bin/env bash
set -euo pipefail

PRODUCT_NAME="CopilotLoops"
BASE_PATH="/opt/homebrew/bin:/usr/local/bin:/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LAUNCH_PATH="${BASE_PATH}${PATH:+:${PATH}}"
export PATH="${LAUNCH_PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_RUNTIME="${SCRIPT_DIR}/loops"
IDENTITY_CLI="${SOURCE_RUNTIME}/lib/identity-cli.mjs"
INSTALL_APP_DIR="${HOME}/Applications"
INSTALLED_APP="${INSTALL_APP_DIR}/${PRODUCT_NAME}.app"
APP_BINARY="${INSTALLED_APP}/Contents/MacOS/${PRODUCT_NAME}"
SECRETS_HELPER="${INSTALLED_APP}/Contents/Helpers/CopilotLoopsSecrets"
STATE_ROOT="${COPILOT_LOOPS_HOME:-${HOME}/.copilot/scheduled-tasks/copilot-loops}"
RUNTIME_ROOT="${STATE_ROOT}/runtime"
RUNTIME_BREADCRUMB_PATH="${STATE_ROOT}/runtime.json"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
TEMPLATE_PATH="${SCRIPT_DIR}/loops-app/packaging/copilot-loops.app.plist.in"
DOMAIN="gui/$(id -u)"
LAUNCHCTL="${COPILOT_LOOPS_LAUNCHCTL:-launchctl}"
PLUTIL="${COPILOT_LOOPS_PLUTIL:-plutil}"

xml_escape() {
  perl -CS -e 'my $s = shift; $s =~ s/&/&amp;/g; $s =~ s/</&lt;/g; $s =~ s/>/&gt;/g; print $s;' "$1"
}

safe_replace_directory() {
  local source="$1"
  local target="$2"
  local stage="${target}.install.$$"
  rm -rf "${stage}"
  cp -R "${source}" "${stage}"
  rm -rf "${target}"
  mv "${stage}" "${target}"
}

case "${STATE_ROOT}" in
  /*/copilot-loops) ;;
  *)
    echo "COPILOT_LOOPS_HOME must be an absolute directory named copilot-loops" >&2
    exit 2
    ;;
esac

for required in node perl; do
  if ! command -v "${required}" >/dev/null 2>&1; then
    echo "Required command not found: ${required}" >&2
    exit 1
  fi
done

IDENTITY_JSON="$(COPILOT_LOOPS_HOME="${STATE_ROOT}" node "${IDENTITY_CLI}" prepare-install)"
identity_field() {
  IDENTITY_JSON="${IDENTITY_JSON}" node -e '
    const value = JSON.parse(process.env.IDENTITY_JSON);
    const field = process.argv[1];
    if (typeof value[field] !== "string" || value[field].length === 0) process.exit(2);
    process.stdout.write(value[field]);
  ' "$1"
}
LABEL="$(identity_field appLabel)"
PLIST_PATH="${LAUNCH_AGENTS_DIR}/${LABEL}.plist"
if ! command -v "${LAUNCHCTL}" >/dev/null 2>&1; then
  echo "Required command not found: ${LAUNCHCTL}" >&2
  exit 1
fi
if ! command -v "${PLUTIL}" >/dev/null 2>&1; then
  echo "Required command not found: ${PLUTIL}" >&2
  exit 1
fi

if [[ -n "${COPILOT_LOOPS_APP_BUNDLE:-}" ]]; then
  APP_BUNDLE="${COPILOT_LOOPS_APP_BUNDLE}"
else
  APP_BUNDLE="$("${SCRIPT_DIR}/loops-build.sh")"
fi
if [[ ! -d "${APP_BUNDLE}" ]]; then
  echo "App bundle not found: ${APP_BUNDLE}" >&2
  exit 1
fi

mkdir -p "${INSTALL_APP_DIR}" "${LAUNCH_AGENTS_DIR}" "${STATE_ROOT}/logs"
safe_replace_directory "${APP_BUNDLE}" "${INSTALLED_APP}"

RUNTIME_STAGE="${STATE_ROOT}/.runtime-install.$$"
rm -rf "${RUNTIME_STAGE}"
trap 'rm -rf "${RUNTIME_STAGE}"' EXIT
mkdir -p "${RUNTIME_STAGE}/loops"
install -m 755 "${SCRIPT_DIR}/loops-ctl.mjs" "${RUNTIME_STAGE}/loops-ctl.mjs"
install -m 755 "${SCRIPT_DIR}/loops-runner.mjs" "${RUNTIME_STAGE}/loops-runner.mjs"
for component in commands contracts lib templates; do
  cp -R "${SOURCE_RUNTIME}/${component}" "${RUNTIME_STAGE}/loops/${component}"
done
rm -rf "${RUNTIME_ROOT}"
mv "${RUNTIME_STAGE}" "${RUNTIME_ROOT}"

RUNTIME_BREADCRUMB_TEMP="${RUNTIME_BREADCRUMB_PATH}.tmp.$$"
COPILOT_LOOPS_HOME="${STATE_ROOT}" \
COPILOT_LOOPS_APP="${INSTALLED_APP}" \
COPILOT_LOOPS_RUNTIME="${RUNTIME_ROOT}" \
COPILOT_LOOPS_CONTROL="${RUNTIME_ROOT}/loops-ctl.mjs" \
COPILOT_LOOPS_RUNNER="${RUNTIME_ROOT}/loops-runner.mjs" \
COPILOT_LOOPS_SECRETS_HELPER="${SECRETS_HELPER}" \
COPILOT_LOOPS_NODE="$(command -v node)" \
  node -e 'process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    loopsCtlPath: process.env.COPILOT_LOOPS_CONTROL,
    nodePath: process.env.COPILOT_LOOPS_NODE,
    stateRoot: process.env.COPILOT_LOOPS_HOME,
    appPath: process.env.COPILOT_LOOPS_APP,
    runtimePath: process.env.COPILOT_LOOPS_RUNTIME,
    controlPath: process.env.COPILOT_LOOPS_CONTROL,
    runnerPath: process.env.COPILOT_LOOPS_RUNNER,
    secretsHelperPath: process.env.COPILOT_LOOPS_SECRETS_HELPER,
    identityPath: process.env.COPILOT_LOOPS_HOME + "/identity.json",
    installedAt: new Date().toISOString()
  }, null, 2) + "\n")' > "${RUNTIME_BREADCRUMB_TEMP}"
mv "${RUNTIME_BREADCRUMB_TEMP}" "${RUNTIME_BREADCRUMB_PATH}"

APP_BINARY_VALUE="$(xml_escape "${APP_BINARY}")"
HOME_VALUE="$(xml_escape "${HOME}")"
PATH_VALUE="$(xml_escape "${LAUNCH_PATH}")"
STATE_ROOT_VALUE="$(xml_escape "${STATE_ROOT}")"
RUNTIME_ROOT_VALUE="$(xml_escape "${RUNTIME_ROOT}")"
SECRETS_HELPER_VALUE="$(xml_escape "${SECRETS_HELPER}")"
APP_LABEL_VALUE="$(xml_escape "${LABEL}")"
APP_BINARY_VALUE="${APP_BINARY_VALUE}" HOME_VALUE="${HOME_VALUE}" PATH_VALUE="${PATH_VALUE}" \
STATE_ROOT_VALUE="${STATE_ROOT_VALUE}" RUNTIME_ROOT_VALUE="${RUNTIME_ROOT_VALUE}" \
SECRETS_HELPER_VALUE="${SECRETS_HELPER_VALUE}" APP_LABEL_VALUE="${APP_LABEL_VALUE}" \
  perl -0pe '
    s/\@APP_LABEL\@/$ENV{APP_LABEL_VALUE}/g;
    s/\@APP_BINARY\@/$ENV{APP_BINARY_VALUE}/g;
    s/\@HOME\@/$ENV{HOME_VALUE}/g;
    s/\@PATH\@/$ENV{PATH_VALUE}/g;
    s/\@STATE_ROOT\@/$ENV{STATE_ROOT_VALUE}/g;
    s/\@RUNTIME_ROOT\@/$ENV{RUNTIME_ROOT_VALUE}/g;
    s/\@SECRETS_HELPER\@/$ENV{SECRETS_HELPER_VALUE}/g
  ' "${TEMPLATE_PATH}" > "${PLIST_PATH}"
"${PLUTIL}" -lint "${PLIST_PATH}" >/dev/null

"${LAUNCHCTL}" bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
"${LAUNCHCTL}" enable "${DOMAIN}/${LABEL}"
bootstrap_ok=0
bootstrap_err=""
for attempt in 1 2 3 4 5; do
  if bootstrap_err="$("${LAUNCHCTL}" bootstrap "${DOMAIN}" "${PLIST_PATH}" 2>&1)"; then
    bootstrap_ok=1
    break
  fi
  echo "LaunchAgent bootstrap attempt ${attempt} failed: ${bootstrap_err}" >&2
  "${LAUNCHCTL}" bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  sleep "${attempt}"
done

if [[ "${bootstrap_ok}" -ne 1 ]]; then
  echo "Failed to bootstrap ${LABEL} after retries. Last error: ${bootstrap_err}" >&2
  exit 1
fi

"${LAUNCHCTL}" kickstart -k "${DOMAIN}/${LABEL}"
trap - EXIT
rm -rf "${RUNTIME_STAGE}"

echo "Installed Copilot Loops to ${INSTALLED_APP}"
echo "Installed managed runtime to ${RUNTIME_ROOT}"
echo "Loaded LaunchAgent ${LABEL}"
echo "Logs: ${STATE_ROOT}/logs/app.out.log and ${STATE_ROOT}/logs/app.err.log"
