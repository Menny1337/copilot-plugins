'use strict';

const { spawnSync } = require('node:child_process');
const { isAbsolute } = require('node:path');

const EXTENSION_ID = 'mmlmfjhmonkocbjadbfplnigmagldckm';
const PROFILE_RE = /^(?!\.\.?$)[^\\/\u0000-\u001f\u007f]{1,128}$/;
const BROKER = `
const { spawn } = require('node:child_process');
const [executable, profile, target] = process.argv.slice(1);
const child = spawn(executable, [\`--profile-directory=\${profile}\`, target], {
  detached: true,
  stdio: 'ignore',
  windowsHide: false,
});
child.once('spawn', () => child.unref());
child.once('error', () => { process.exitCode = 1; });
`;

function isConnectPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'chrome-extension:' &&
      url.host === EXTENSION_ID &&
      url.pathname === '/connect.html';
  } catch {
    return false;
  }
}

function connectPageFromArg(value) {
  if (isConnectPage(value)) return value;
  const normalized = String(value || '').replaceAll('\\', '/');
  const marker = `chrome-extension:/${EXTENSION_ID}/connect.html`;
  const markerAt = normalized.lastIndexOf(marker);
  if (markerAt === -1) return null;
  const suffix = normalized.slice(markerAt + marker.length);
  if (suffix && !suffix.startsWith('?')) return null;
  const reconstructed = `chrome-extension://${EXTENSION_ID}/connect.html${suffix}`;
  return isConnectPage(reconstructed) ? reconstructed : null;
}

module.exports = { connectPageFromArg };

const target = connectPageFromArg(process.argv[1]);
if (process.env.COPILOT_PLUGIN_BROWSER_PROFILE_LAUNCH === '1' && target) {
  const executable = process.env.COPILOT_PLUGIN_BROWSER_EXECUTABLE || '';
  const profile = process.env.COPILOT_PLUGIN_BROWSER_PROFILE_DIRECTORY || '';
  if (!isAbsolute(executable) || !PROFILE_RE.test(profile)) process.exit(2);

  const result = spawnSync(process.execPath, [
    '-e',
    BROKER,
    executable,
    profile,
    target,
  ], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 5_000,
  });
  process.exit(result.status === 0 ? 0 : 1);
}
