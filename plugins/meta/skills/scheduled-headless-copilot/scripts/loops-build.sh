#!/usr/bin/env bash
set -euo pipefail

PRODUCT_NAME="CopilotLoops"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}/loops-app"
PACKAGING_DIR="${APP_DIR}/packaging"
IDENTITY_CLI="${SCRIPT_DIR}/loops/lib/identity-cli.mjs"
BUILD_APP_DIR="${APP_DIR}/.build/app"
APP_BUNDLE="${BUILD_APP_DIR}/${PRODUCT_NAME}.app"
CONTENTS_DIR="${APP_BUNDLE}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
HELPERS_DIR="${CONTENTS_DIR}/Helpers"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"
PLUGIN_JSON="${SCRIPT_DIR}/../../../plugin.json"
ICON_SOURCE="${PACKAGING_DIR}/appicon-1024.png"
ICONSET_DIR="${APP_DIR}/.build/AppIcon.iconset"

VERSION="1.0.0"
if [[ -f "${PLUGIN_JSON}" ]] && command -v node >/dev/null 2>&1; then
  VERSION="$(node -e 'const fs=require("fs"); try { const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version; process.stdout.write(typeof value==="string"&&value?value:"1.0.0"); } catch { process.stdout.write("1.0.0"); }' "${PLUGIN_JSON}")"
fi
BUNDLE_VERSION="${VERSION%%-*}"
[[ -n "${BUNDLE_VERSION}" ]] || BUNDLE_VERSION="1.0.0"
BUNDLE_IDENTIFIER="$(
  node "${IDENTITY_CLI}" resolve |
    node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        const value = JSON.parse(input);
        if (typeof value.bundleIdentifier !== "string" || value.bundleIdentifier.length === 0) process.exit(2);
        process.stdout.write(value.bundleIdentifier);
      });
    '
)"

(cd "${APP_DIR}" && swift build -c release >&2)
BIN_DIR="$(cd "${APP_DIR}" && swift build -c release --show-bin-path)"

rm -rf "${APP_BUNDLE}" "${ICONSET_DIR}"
mkdir -p "${MACOS_DIR}" "${HELPERS_DIR}" "${RESOURCES_DIR}" "${ICONSET_DIR}"
install -m 755 "${BIN_DIR}/CopilotLoops" "${MACOS_DIR}/CopilotLoops"
install -m 755 "${BIN_DIR}/CopilotLoopsSecrets" "${HELPERS_DIR}/CopilotLoopsSecrets"

if [[ ! -f "${ICON_SOURCE}" ]]; then
  echo "Missing app icon source: ${ICON_SOURCE}" >&2
  exit 1
fi

while read -r size filename; do
  sips -z "${size}" "${size}" "${ICON_SOURCE}" --out "${ICONSET_DIR}/${filename}" >/dev/null
done <<'EOF'
16 icon_16x16.png
32 icon_16x16@2x.png
32 icon_32x32.png
64 icon_32x32@2x.png
128 icon_128x128.png
256 icon_128x128@2x.png
256 icon_256x256.png
512 icon_256x256@2x.png
512 icon_512x512.png
1024 icon_512x512@2x.png
EOF
iconutil -c icns "${ICONSET_DIR}" -o "${RESOURCES_DIR}/AppIcon.icns"

SHORT_VERSION="${VERSION}" BUNDLE_VERSION="${BUNDLE_VERSION}" BUNDLE_IDENTIFIER="${BUNDLE_IDENTIFIER}" \
  perl -0pe '
    s/\@SHORT_VERSION\@/$ENV{SHORT_VERSION}/g;
    s/\@BUNDLE_VERSION\@/$ENV{BUNDLE_VERSION}/g;
    s/\@BUNDLE_IDENTIFIER\@/$ENV{BUNDLE_IDENTIFIER}/g
  ' \
  "${PACKAGING_DIR}/Info.plist.in" > "${CONTENTS_DIR}/Info.plist"

codesign --force --sign - --options runtime "${HELPERS_DIR}/CopilotLoopsSecrets" >&2
codesign --force --deep --sign - --options runtime "${APP_BUNDLE}" >&2
rm -rf "${ICONSET_DIR}"
printf '%s\n' "${APP_BUNDLE}"
