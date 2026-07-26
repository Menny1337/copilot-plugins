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

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXTENSION_ID = 'mmlmfjhmonkocbjadbfplnigmagldckm';
export const TOKEN_DIR = join(homedir(), '.config', 'playwright-bridge');

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
  if (!profiles.length) return null;
  if (!hint) return profiles.find((p) => p.dir === 'Default') || profiles[0];
  const want = slug(hint);
  return (
    profiles.find((p) => slug(p.name) === want) ||
    profiles.find((p) => slug(p.dir) === want) ||
    profiles.find((p) => slug(p.account).startsWith(want)) ||
    profiles.find((p) => slug(p.name).startsWith(want)) ||
    null
  );
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
const ID_FRAGMENT = Buffer.from(EXTENSION_ID.slice(0, 18), 'binary');

function tokensInBuffer(buf) {
  const out = [];
  let at = 0;
  for (;;) {
    const i = buf.indexOf(KEY_ANCHOR, at);
    if (i === -1) break;
    at = i + KEY_ANCHOR.length;

    // The value follows a short binary header; a bare 43-char base64url run is
    // the extension's token format. JSON values (other origins) never match.
    const tail = buf.subarray(at, at + 64).toString('binary');
    const m = tail.match(/[A-Za-z0-9_-]{43}/);
    if (!m) continue;
    const after = tail[m.index + 43];
    if (after && /[A-Za-z0-9_-]/.test(after)) continue; // longer blob, not a token

    const scoped = buf.subarray(Math.max(0, i - 256), i).includes(ID_FRAGMENT);
    out.push({ token: m[0], scoped, offset: i });
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

  // Prefer records provably scoped to the extension, then the newest file, then
  // the latest record within that file (leveldb appends, so later wins).
  candidates.sort((a, b) => Number(b.scoped) - Number(a.scoped) || b.mtime - a.mtime || b.offset - a.offset);
  return candidates[0].token;
}

// ---------------------------------------------------------------------------
// token files
// ---------------------------------------------------------------------------

export const tokenFile = (session) => join(TOKEN_DIR, `${session}.token`);

export function readTokenFile(session) {
  const f = tokenFile(session);
  if (!existsSync(f)) return null;
  const v = readFileSync(f, 'utf8').trim();
  // Tolerate a pasted "VAR=value" line.
  const cleaned = v.includes('=') ? v.slice(v.lastIndexOf('=') + 1).trim() : v;
  return cleaned || null;
}

export function writeTokenFile(session, token) {
  mkdirSync(TOKEN_DIR, { recursive: true });
  const f = tokenFile(session);
  writeFileSync(f, `${token}\n`, { mode: 0o600 });
  try {
    chmodSync(f, 0o600);
  } catch {
    /* best effort */
  }
  return f;
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the token to attach with, preferring the value the extension itself
 * holds. Returns { ok, token, source, profile, fileToken, mismatch, reason }.
 */
export function resolveToken(session = 'msedge') {
  const profile = profileForSession(session);
  const fileToken = readTokenFile(session);
  const diskToken = profile ? readProfileToken(profile.path) : null;

  if (diskToken && TOKEN_RE.test(diskToken)) {
    return {
      ok: true,
      token: diskToken,
      source: 'profile',
      profile,
      fileToken,
      mismatch: Boolean(fileToken && fileToken !== diskToken),
    };
  }

  if (fileToken && TOKEN_RE.test(fileToken)) {
    return { ok: true, token: fileToken, source: 'file', profile, fileToken, mismatch: false };
  }

  if (fileToken) {
    return { ok: false, reason: 'malformed-file-token', profile, fileToken };
  }
  if (profile && !profile.hasExtension) {
    return { ok: false, reason: 'extension-not-installed', profile };
  }
  if (!profile) {
    return { ok: false, reason: 'profile-not-found', profile: null };
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
    case 'extension-not-installed':
      L.push(`The Playwright Bridge extension is not installed in ${p.browser} profile "${p.name}" (${p.dir}).`);
      L.push('Switch the browser to that profile, install the extension, then run:');
      L.push(`  playwright-cli attach --extension=${session}`);
      break;
    case 'malformed-file-token':
      L.push(`${tokenFile(session)} does not contain a valid 43-character token.`);
      L.push('Store the token value only, with no "VAR=" prefix.');
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

const USAGE = `bridge-token - resolve and repair Playwright Bridge tokens

Usage:
  bridge-token.mjs list [--browser msedge|chrome|chromium]
  bridge-token.mjs get     [--session <name>]   print the token to attach with
  bridge-token.mjs check   [--session <name>]   verify the token file (exit 1 on drift)
  bridge-token.mjs sync    [--session <name>]   write the profile's token to the file
  bridge-token.mjs sync-all [--browser msedge]  one token file per profile

The session name selects the profile: "msedge" is the default profile,
"msedge-woodgrove" matches the profile named "Woodgrove".`;

function mask(t) {
  return t ? `${t.slice(0, 6)}…${t.slice(-4)}` : null;
}

function main(argv) {
  const cmd = argv[0];
  const flag = (n, d = null) => {
    const i = argv.indexOf(`--${n}`);
    if (i !== -1 && argv[i + 1]) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`--${n}=`));
    return eq ? eq.slice(n.length + 3) : d;
  };
  const session = flag('session', 'msedge');
  const browser = flag('browser', parseSession(session).browser);
  const reveal = argv.includes('--reveal');
  const out = (o) => console.log(JSON.stringify(o, null, 2));

  switch (cmd) {
    case 'list': {
      const profiles = listProfiles(browser).map((p) => {
        const token = p.hasExtension ? readProfileToken(p.path) : null;
        const guess = p.dir === 'Default' ? browser : `${browser}-${slug(p.name)}`;
        const fileToken = readTokenFile(guess);
        return {
          profile: p.dir,
          name: p.name,
          account: p.account,
          extension: p.hasExtension,
          session: guess,
          token: reveal ? token : mask(token),
          tokenFile: existsSync(tokenFile(guess)) ? tokenFile(guess) : null,
          status: !p.hasExtension
            ? 'no-extension'
            : !token
              ? 'no-token-yet'
              : !fileToken
                ? 'ok (resolved from profile)'
                : fileToken === token
                  ? 'ok (file matches)'
                  : 'FILE STALE - would hang; run sync',
        };
      });
      out({ ok: true, browser, profiles });
      return 0;
    }

    case 'get': {
      const r = resolveToken(session);
      if (!r.ok) {
        out({ ok: false, error: r.reason, message: explain(session, r) });
        return 1;
      }
      if (argv.includes('--raw')) {
        console.log(r.token);
        return 0;
      }
      out({
        ok: true,
        session,
        source: r.source,
        profile: r.profile ? `${r.profile.name} (${r.profile.dir})` : null,
        token: reveal ? r.token : mask(r.token),
        staleFileIgnored: r.mismatch || undefined,
      });
      return 0;
    }

    case 'check': {
      const r = resolveToken(session);
      if (!r.ok) {
        out({ ok: false, error: r.reason, message: explain(session, r) });
        return 1;
      }
      if (r.mismatch) {
        out({
          ok: false,
          error: 'stale-token-file',
          session,
          profile: `${r.profile.name} (${r.profile.dir})`,
          message:
            `${tokenFile(session)} does not match the token held by profile "${r.profile.name}". ` +
            'Attaching with it would hang forever. Fix instantly with: ' +
            `bridge-token.mjs sync --session ${session}`,
        });
        return 1;
      }
      out({ ok: true, session, source: r.source, profile: `${r.profile.name} (${r.profile.dir})` });
      return 0;
    }

    case 'sync': {
      const r = resolveToken(session);
      if (!r.ok || r.source !== 'profile') {
        out({ ok: false, error: r.reason || 'no-profile-token', message: explain(session, r) });
        return 1;
      }
      const f = writeTokenFile(session, r.token);
      out({ ok: true, session, wrote: f, profile: `${r.profile.name} (${r.profile.dir})`, changed: r.mismatch });
      return 0;
    }

    case 'sync-all': {
      const wrote = [];
      for (const p of listProfiles(browser)) {
        if (!p.hasExtension) continue;
        const token = readProfileToken(p.path);
        if (!token) continue;
        const name = p.dir === 'Default' ? browser : `${browser}-${slug(p.name)}`;
        wrote.push({ session: name, profile: p.name, file: writeTokenFile(name, token) });
      }
      out({ ok: true, browser, wrote });
      return wrote.length ? 0 : 1;
    }

    default:
      console.log(USAGE);
      return cmd ? 1 : 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
