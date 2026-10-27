#!/usr/bin/env bash
set -euo pipefail

PRODUCT_NAME="CopilotLoops"
PURGE=0

if [[ $# -gt 1 ]]; then
  echo "usage: $0 [--purge]" >&2
  exit 2
fi
if [[ $# -eq 1 ]]; then
  if [[ "$1" != "--purge" ]]; then
    echo "usage: $0 [--purge]" >&2
    exit 2
  fi
  PURGE=1
fi

STATE_ROOT="${COPILOT_LOOPS_HOME:-${HOME}/.copilot/scheduled-tasks/copilot-loops}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IDENTITY_CLI="${SCRIPT_DIR}/loops/lib/identity-cli.mjs"
INSTALL_APP="${HOME}/Applications/${PRODUCT_NAME}.app"
SECRETS_HELPER="${INSTALL_APP}/Contents/Helpers/CopilotLoopsSecrets"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
LAUNCHCTL="${COPILOT_LOOPS_LAUNCHCTL:-launchctl}"
PLUTIL="${COPILOT_LOOPS_PLUTIL:-plutil}"
SECURITY="${COPILOT_LOOPS_SECURITY:-security}"

case "${STATE_ROOT}" in
  /*/copilot-loops) ;;
  *)
    echo "COPILOT_LOOPS_HOME must be an absolute directory named copilot-loops" >&2
    exit 2
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "Required command not found: node" >&2
  exit 1
fi

IDENTITY_JSON="$(COPILOT_LOOPS_HOME="${STATE_ROOT}" node "${IDENTITY_CLI}" prepare-uninstall)"
identity_field() {
  IDENTITY_JSON="${IDENTITY_JSON}" node -e '
    const value = JSON.parse(process.env.IDENTITY_JSON);
    const field = process.argv[1];
    if (typeof value[field] !== "string" || value[field].length === 0) process.exit(2);
    process.stdout.write(value[field]);
  ' "$1"
}
APP_LABEL="$(identity_field appLabel)"
TASK_LABEL_PREFIX="$(identity_field taskLabelPrefix)"
KEYCHAIN_SERVICE="$(identity_field keychainService)"
APP_PLIST="${LAUNCH_AGENTS_DIR}/${APP_LABEL}.plist"

shopt -s nullglob
for plist in "${LAUNCH_AGENTS_DIR}/${TASK_LABEL_PREFIX}"*.plist; do
  label="$("${PLUTIL}" -extract Label raw -o - "${plist}" 2>/dev/null || true)"
  case "${label}" in
    "${TASK_LABEL_PREFIX}"*)
      "${LAUNCHCTL}" bootout "${DOMAIN}/${label}" 2>/dev/null || true
      rm -f "${plist}"
      ;;
    *)
      echo "Refusing to remove unexpected LaunchAgent: ${plist}" >&2
      exit 1
      ;;
  esac
done

"${LAUNCHCTL}" bootout "${DOMAIN}/${APP_LABEL}" 2>/dev/null || true
rm -f "${APP_PLIST}"

if [[ "${PURGE}" -eq 1 && -d "${STATE_ROOT}/tasks" ]]; then
  ACCOUNTS_FILE="${STATE_ROOT}/.purge-accounts.$$"
  trap 'rm -f "${ACCOUNTS_FILE}"' EXIT
  node - "${STATE_ROOT}/tasks" > "${ACCOUNTS_FILE}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const tasksRoot = process.argv[2];
for (const entry of fs.readdirSync(tasksRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = path.join(tasksRoot, entry.name, "loop.json");
  if (!fs.existsSync(manifestPath)) continue;
  const loop = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const name of loop.environment?.secretNames ?? []) {
    process.stdout.write(`${loop.id}:${name}\0`);
  }
}
NODE

  SECURITY_PATH=""
  if [[ -s "${ACCOUNTS_FILE}" && ! -x "${SECRETS_HELPER}" ]]; then
    SECURITY_PATH="$(command -v "${SECURITY}" || true)"
    if [[ -z "${SECURITY_PATH}" ]]; then
      echo "Cannot purge Keychain secrets: neither the app helper nor security CLI is available" >&2
      exit 1
    fi
    echo "Keychain helper is unavailable; deleting managed secrets with ${SECURITY_PATH}" >&2
  fi

  while IFS= read -r -d '' account; do
    if [[ -x "${SECRETS_HELPER}" ]]; then
      "${SECRETS_HELPER}" delete "${account}" >/dev/null
    else
      security_status=0
      security_error="$("${SECURITY_PATH}" delete-generic-password \
        -s "${KEYCHAIN_SERVICE}" -a "${account}" 2>&1)" || security_status=$?
      if [[ "${security_status}" -ne 0 && "${security_status}" -ne 44 ]]; then
        echo "Failed to delete Keychain account ${account}: ${security_error}" >&2
        exit 1
      fi
    fi
  done < "${ACCOUNTS_FILE}"
  rm -f "${ACCOUNTS_FILE}"
  trap - EXIT
fi

rm -rf "${INSTALL_APP}"
rm -rf "${STATE_ROOT}/runtime"
rm -f "${STATE_ROOT}/runtime.json"

if [[ "${PURGE}" -eq 1 ]]; then
  rm -rf "${STATE_ROOT}"
  echo "Uninstalled Copilot Loops and purged managed definitions, history, and Keychain secrets"
else
  echo "Uninstalled Copilot Loops; managed definitions and history remain in ${STATE_ROOT}"
fi
