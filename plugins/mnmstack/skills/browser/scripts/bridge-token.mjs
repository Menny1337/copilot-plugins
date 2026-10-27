#!/usr/bin/env node
// bridge-token.mjs - resolve, verify and repair Playwright Bridge extension tokens.
//
// Why this exists: `playwright-cli attach --extension` never validates the token
// itself. It spawns the browser at connect.html?token=<token> and then waits
// forever for the extension to call back. A wrong or cross-profile token means
// the extension refuses and the CLI hangs with no output.
//
// The extension stores its own token in the extension page's localStorage under
// the key "auth-token", which is persisted in the profile's Local Storage
// leveldb. That makes the real token readable from disk, so a bad token can be
// detected in milliseconds instead of waiting out a timeout - and usually
// repaired automatically, with no consent-dialog recapture at all.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXTENSION_ID = 'mmlmfjhmonkocbjadbfplnigmagldckm';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// ---------------------------------------------------------------------------
// browser roots
// ---------------------------------------------------------------------------

function browserRoots() {
  const home = homedir();
  const p = platform();
  const mac = {
    msedge: join(home, 'Library/Application Support/Microsoft Edge'),
    chrome: join(home, 'Library/Application Support/Google/Chrome'),
    chromium: join(home, 'Library/Application Support/Chromium'),
  };
  const win = {
    msedge: join(process.env.LOCALAPPDATA || join(home, 'AppData/Local'), 'Microsoft/Edge/User Data'),
    chrome: join(process.env.LOCALAPPDATA || join(home, 'AppData/Local'), 'Google/Chrome/User Data'),
    chromium: join(process.env.LOCALAPPDATA || join(home, 'AppData/Local'), 'Chromium/User Data'),
  };
  const linux = {
    msedge: join(home, '.config/microsoft-edge'),
    chrome: join(home, '.config/google-chrome'),
    chromium: join(home, '.config/chromium'),
  };
  return p === 'darwin' ? mac : p === 'win32' ? win : linux;
}

/** Split a playwright-cli session name into a browser key and a profile hint. */
export function parseSession(session) {
  const s = String(session || 'msedge').trim();
  const m = s.match(/^(msedge|edge|chrome|chromium)(?:[-_](.+))?$/i);
  if (!m) return { browser: 'msedge', hint: s.toLowerCase() || null, raw: s };
  const browser = m[1].toLowerCase() === 'edge' ? 'msedge' : m[1].toLowerCase();
  return { browser, hint: m[2] ? m[2].toLowerCase() : null, raw: s };
}

const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export function isSafeProfileDirectory(value) {
  return value !== '.' && value !== '..' && value.length <= 64 && !/[\\/]/.test(value);
}

// ---------------------------------------------------------------------------
// profile discovery
// ---------------------------------------------------------------------------

export function listProfiles(browser = 'msedge') {
  const root = browserRoots()[browser];
  if (!root || !existsSync(root)) return [];

  let info = {};
  try {
    info = JSON.parse(readFileSync(join(root, 'Local State'), 'utf8'))?.profile?.info_cache || {};
  } catch {
    /* Local State is optional - fall back to directory scanning. */
  }

  const dirs = new Set(Object.keys(info));
  try {
    for (const d of readdirSync(root)) {
      if (d === 'Default' || /^Profile \d+$/.test(d)) dirs.add(d);
    }
  } catch {
    /* unreadable root */
  }

  return [...dirs]
    .filter(isSafeProfileDirectory)
    .filter((d) => existsSync(join(root, d)))
    .map((dir) => ({
      browser,
      dir,
      path: join(root, dir),
      name: info[dir]?.name || dir,
      account: info[dir]?.user_name || null,
      hasExtension: hasExtension(join(root, dir)),
    }))
    .sort((a, b) => (a.dir === 'Default' ? -1 : b.dir === 'Default' ? 1 : a.dir.localeCompare(b.dir)));
}

export function readLastUsedProfile(root) {
  try {
    const profile = JSON.parse(readFileSync(join(root, 'Local State'), 'utf8'))?.profile;
    return profile?.last_used || profile?.last_active_profiles?.[0] || null;
  } catch {
    return null;
  }
}

function hasExtension(profilePath) {
  if (existsSync(join(profilePath, 'Extensions', EXTENSION_ID))) return true;
  try {
    const prefs = JSON.parse(readFileSync(join(profilePath, 'Secure Preferences'), 'utf8'));
    return Boolean(prefs?.extensions?.settings?.[EXTENSION_ID]);
  } catch {
    return false;
  }
}

/** Resolve the profile a session name refers to. */
export function profileForSession(session) {
  const { browser, hint } = parseSession(session);
  const profiles = listProfiles(browser);
  return selectProfile(profiles, hint, readLastUsedProfile(browserRoots()[browser])).profile;
}

export function selectProfile(profiles, hint = null, lastUsed = null) {
  if (!profiles.length) return { profile: null, reason: 'profile-not-found', matches: [] };
  if (!hint) {
    return {
      profile: profiles.find((p) => p.dir === lastUsed) ||
        profiles.find((p) => p.dir === 'Default') ||
        profiles[0],
      reason: null,
      matches: [],
    };
  }

  const want = slug(hint);
  if (!want) return { profile: null, reason: 'profile-not-found', matches: [] };

  const exactMatches = profiles.filter((p) =>
    slug(p.dir) === want || slug(p.name) === want);
  if (exactMatches.length === 1) {
    return { profile: exactMatches[0], reason: null, matches: [] };
  }
  if (exactMatches.length > 1) {
    return { profile: null, reason: 'profile-ambiguous', matches: exactMatches };
  }

  const prefixes = profiles.filter((p) =>
    slug(p.account).startsWith(want) || slug(p.name).startsWith(want));
  if (prefixes.length === 1) return { profile: prefixes[0], reason: null, matches: [] };
  if (prefixes.length > 1) {
    return { profile: null, reason: 'profile-ambiguous', matches: prefixes };
  }
  return { profile: null, reason: 'profile-not-found', matches: [] };
}

// ---------------------------------------------------------------------------
// token extraction from the profile's Local Storage leveldb
// ---------------------------------------------------------------------------

// A localStorage record is keyed "_chrome-extension://<id>\0\x01auth-token".
// leveldb prefix-compresses keys inside a block, so the origin - and even part
// of the extension id - may be truncated. Anchor on the stable "\0\x01auth-token"
// suffix and confirm the record belongs to the extension by looking back for a
// surviving id fragment.
const KEY_ANCHOR = Buffer.from('\u0000\u0001auth-token', 'binary');
const ID_FRAGMENTS = [
  EXTENSION_ID.slice(0, 18),
  EXTENSION_ID.slice(-18),
].map((fragment) => Buffer.from(fragment, 'binary'));
const KEY_SCOPE_BYTES = 64;
const VALUE_SCAN_BYTES = 256;

function tokensInBuffer(buf) {
  const out = [];
  let at = 0;
  for (;;) {
    const i = buf.indexOf(KEY_ANCHOR, at);
    if (i === -1) break;
    at = i + KEY_ANCHOR.length;

    // The value follows a short binary header; a bare 43-char base64url run is
    // the extension's token format. JSON values (other origins) never match.
    const tail = buf.subarray(at, at + VALUE_SCAN_BYTES).toString('binary');
    for (const m of tail.matchAll(/[A-Za-z0-9_-]{43}/g)) {
      const before = m.index > 0 ? tail[m.index - 1] : '';
      const after = tail[m.index + 43] || '';
      if (/[A-Za-z0-9_-]/.test(before) || /[A-Za-z0-9_-]/.test(after)) continue;

      const keyPrefix = buf.subarray(Math.max(0, i - KEY_SCOPE_BYTES), i);
      const scoped = ID_FRAGMENTS.some((fragment) => {
        const fragmentAt = keyPrefix.lastIndexOf(fragment);
        return fragmentAt !== -1 &&
          keyPrefix.length - fragmentAt - fragment.length <= 32;
      });
      out.push({ token: m[0], scoped, offset: i });
    }
  }
  return out;
}

/** Read the token the extension actually expects for this profile. */
export function readProfileToken(profilePath) {
  const dir = join(profilePath, 'Local Storage', 'leveldb');
  if (!existsSync(dir)) return null;

  let files;
  try {
    files = readdirSync(dir)
      .filter((f) => /\.(ldb|log)$/.test(f))
      .map((f) => join(dir, f))
      .map((f) => ({ f, mtime: statSync(f).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return null;
  }

  const candidates = [];
  for (const { f, mtime } of files) {
    let buf;
    try {
      buf = readFileSync(f);
    } catch {
      continue;
    }
    for (const hit of tokensInBuffer(buf)) candidates.push({ ...hit, mtime, file: f });
  }
  if (!candidates.length) return null;

  const scoped = candidates.filter((candidate) => candidate.scoped);
  if (!scoped.length) return null;
  scoped.sort((a, b) => b.mtime - a.mtime || b.offset - a.offset);
  return scoped[0].token;
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the token held by the extension in the browser's last-used profile.
 * Returns { ok, token, source, profile, reason }.
 */
export function resolveToken(session = 'msedge', profileHint = null) {
  const { browser, hint } = parseSession(session);
  const profiles = listProfiles(browser);
  const selection = selectProfile(
    profiles,
    profileHint === null ? hint : profileHint,
    readLastUsedProfile(browserRoots()[browser]),
  );
  const profile = selection.profile;
  const diskToken = profile ? readProfileToken(profile.path) : null;

  if (diskToken && TOKEN_RE.test(diskToken)) {
    return {
      ok: true,
      token: diskToken,
      source: 'profile',
      profile,
    };
  }

  if (!profile) {
    return {
      ok: false,
      reason: selection.reason,
      profile: null,
      matches: selection.matches,
    };
  }
  if (!profile.hasExtension) {
    return { ok: false, reason: 'extension-not-installed', profile };
  }
  return { ok: false, reason: 'no-token', profile };
}

/** Human-readable guidance for a failed resolution. */
export function explain(session, res) {
  const L = [];
  const p = res.profile;
  switch (res.reason) {
    case 'profile-not-found':
      L.push(`No browser profile matches session "${session}".`);
      L.push('Run `bridge-token.mjs list` to see the available profiles.');
      break;
    case 'profile-ambiguous':
      L.push(`Browser profile selector "${session}" matches multiple profiles:`);
      for (const match of res.matches || []) L.push(`- ${match.name} (${match.dir})`);
      L.push('Use the exact profile directory or a unique displayed name.');
      break;
    case 'extension-not-installed':
      L.push(`The Playwright Bridge extension is not installed in ${p.browser} profile "${p.name}" (${p.dir}).`);
      L.push('Switch the browser to that profile, install the extension, then retry browser-window.mjs start.');
      break;
    default:
      L.push(`No token found for session "${session}".`);
      if (p) L.push(`Profile: ${p.browser} "${p.name}" (${p.dir}).`);
      L.push('Open the browser on that profile once so the extension mints a token, then retry.');
  }
  L.push('');
  L.push('Note: `playwright-cli attach --extension` never validates the token itself -');
  L.push('a wrong one makes it hang forever, so this check runs against the profile on disk.');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `bridge-token - inspect Playwright Bridge token readiness

Usage:
  bridge-token.mjs list [--browser msedge|chrome|chromium]
  bridge-token.mjs check [--browser msedge|chrome|chromium] [--profile name]

The browser's last-used profile is selected unless --profile is provided.
Token values are never printed.`;

function main(argv) {
  const cmd = argv[0];
  const flag = (n, d = null) => {
    const i = argv.indexOf(`--${n}`);
    if (i !== -1 && argv[i + 1]) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`--${n}=`));
    return eq ? eq.slice(n.length + 3) : d;
  };
  const browser = flag('browser', 'msedge');
  const profile = flag('profile');
  const out = (o) => console.log(JSON.stringify(o, null, 2));

  switch (cmd) {
    case 'list': {
      const profiles = listProfiles(browser).map((p) => {
        const token = p.hasExtension ? readProfileToken(p.path) : null;
        const guess = p.dir === 'Default' ? browser : `${browser}-${slug(p.name)}`;
        return {
          profile: p.dir,
          name: p.name,
          account: p.account,
          extension: p.hasExtension,
          session: guess,
          tokenAvailable: Boolean(token),
          status: !p.hasExtension
            ? 'no-extension'
            : !token
              ? 'no-token-yet'
              : 'ok',
        };
      });
      out({ ok: true, browser, profiles });
      return 0;
    }

    case 'check': {
      const r = resolveToken(browser, profile);
      if (!r.ok) {
        out({
          ok: false,
          error: r.reason,
          message: explain(profile ? `${browser}-${profile}` : browser, r),
        });
        return 1;
      }
      out({ ok: true, browser, source: r.source, profile: `${r.profile.name} (${r.profile.dir})` });
      return 0;
    }

    default:
      console.log(USAGE);
      return cmd ? 1 : 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
