#!/usr/bin/env bash
set -euo pipefail

PRODUCT_NAME="SkillReviewMenuBar"
BASE_PATH="/opt/homebrew/bin:/usr/local/bin:/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH="${BASE_PATH}${PATH:+:${PATH}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}/menubar-app"
PACKAGING_DIR="${APP_DIR}/packaging"
ICON_SOURCE_DIR="${APP_DIR}/../icons"
BUILD_APP_DIR="${APP_DIR}/.build/app"
APP_BUNDLE="${BUILD_APP_DIR}/${PRODUCT_NAME}.app"
CONTENTS_DIR="${APP_BUNDLE}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_ICON_DIR="${CONTENTS_DIR}/Resources/icons"
PLUGIN_JSON="${SCRIPT_DIR}/../../../plugin.json"

VERSION="1.0.0"
if [[ -f "${PLUGIN_JSON}" ]] && command -v node >/dev/null 2>&1; then
  VERSION="$(node -e 'const fs=require("fs"); try { const version = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version; process.stdout.write(typeof version === "string" && version.length ? version : "1.0.0"); } catch { process.stdout.write("1.0.0"); }' "${PLUGIN_JSON}")"
fi
BUNDLE_VERSION="${VERSION%%-*}"
if [[ -z "${BUNDLE_VERSION}" ]]; then
  BUNDLE_VERSION="1.0.0"
fi

(cd "${APP_DIR}" && swift build -c release >&2)
BIN_DIR="$(cd "${APP_DIR}" && swift build -c release --show-bin-path)"
BUILT_BINARY="${BIN_DIR}/${PRODUCT_NAME}"
if [[ ! -x "${BUILT_BINARY}" ]]; then
  echo "Built binary not found or not executable: ${BUILT_BINARY}" >&2
  exit 1
fi

rm -rf "${APP_BUNDLE}"
mkdir -p "${MACOS_DIR}" "${RESOURCES_ICON_DIR}"
install -m 755 "${BUILT_BINARY}" "${MACOS_DIR}/${PRODUCT_NAME}"

for state in running idle paused prs failed reviewing; do
  install -m 644 "${ICON_SOURCE_DIR}/${state}.png" "${RESOURCES_ICON_DIR}/${state}.png"
done

# Finder app icon: build AppIcon.icns from the committed 1024 master, if present.
ICON_MASTER="${PACKAGING_DIR}/appicon-1024.png"
if [[ -f "${ICON_MASTER}" ]] && command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
  ICONSET_PARENT="$(mktemp -d)"
  ICONSET_DIR="${ICONSET_PARENT}/AppIcon.iconset"
  mkdir -p "${ICONSET_DIR}"
  for sz in 16 32 128 256 512; do
    sips -z "${sz}" "${sz}" "${ICON_MASTER}" --out "${ICONSET_DIR}/icon_${sz}x${sz}.png" >/dev/null
    dbl=$((sz * 2))
    sips -z "${dbl}" "${dbl}" "${ICON_MASTER}" --out "${ICONSET_DIR}/icon_${sz}x${sz}@2x.png" >/dev/null
  done
  iconutil -c icns "${ICONSET_DIR}" -o "${CONTENTS_DIR}/Resources/AppIcon.icns" >&2
  rm -rf "${ICONSET_PARENT}"
fi

SHORT_VERSION="${VERSION}" BUNDLE_VERSION="${BUNDLE_VERSION}" \
  perl -0pe 's/\@SHORT_VERSION\@/$ENV{SHORT_VERSION}/g; s/\@BUNDLE_VERSION\@/$ENV{BUNDLE_VERSION}/g' \
  "${PACKAGING_DIR}/Info.plist.in" > "${CONTENTS_DIR}/Info.plist"

codesign --force --deep --sign - --options runtime "${APP_BUNDLE}" >&2

printf '%s\n' "${APP_BUNDLE}"
