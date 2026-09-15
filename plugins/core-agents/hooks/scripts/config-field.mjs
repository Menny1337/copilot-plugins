#!/usr/bin/env node
// config-field.mjs — small dependency-free Node fallback for the handful of
// selected assistant config field reads the sync hooks and logger need,
// used ONLY when `jq` is not on PATH. jq stays the preferred path whenever
// it's available; this is not a general JSON-query tool, just a like-for-like
// substitute for the specific nested-field reads below (a real JSON.parse
// avoids the single-key-grep footgun of confusing a nested
// `taskSessionSync.enabled` with an unrelated top-level `enabled`).
//
// FAIL-CLOSED CONTRACT: any config that can't be read as a JSON object
// (missing file, unreadable, invalid JSON, non-object/array at the top
// level) yields exactly the same output every query below would produce for
// a config that simply doesn't set the field — malformed is indistinguishable
// from absent, and this script never throws (a throw must not crash the
// parent hook).
//
// Usage: node config-field.mjs <query> <config-path> [--backend NAME]
//   enabled            "true" iff taskSessionSync.enabled === true AND (no
//                       --backend given OR taskBackend === --backend).
//   debounce-minutes   taskSessionSync.debounceMinutes if a finite
//                       non-negative integer; else nothing (caller defaults).
//   log-level          off | result | debug; else nothing (caller defaults).
//   retention-days     non-negative integer; else nothing (caller defaults).
//   sync-repos-count   length of taskSessionSync.syncRepos if an array; else 0.
//   sync-repos-list    each non-empty-string syncRepos entry, one per line.
//   session-state-dir  "__unset__" if taskSessionSync has no OWN
//                       "sessionStateDir" key; else the value as a string
//                       (present-and-empty vs. absent both matter to the
//                       caller, so this preserves jq's `has()` tri-state).
//   github-owner       config.github.owner when it is a non-empty string.
//   github-owner-type  "org" only when config.github.ownerType is exactly
//                       "org"; otherwise the runtime default "user".
//
// Exit code is always 0 for a recognized query, even for malformed config
// (the caller reads stdout, not the exit code). Exit 1 means a bad
// invocation (unknown query / missing args), not a config-parsing outcome.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Load `path` as a JSON object. Returns `{}` — the same shape as "every
 * field below is absent" — for anything that isn't a clean top-level object:
 * missing file, unreadable, invalid JSON, or a JSON array/scalar at the top
 * level. Never throws.
 */
function loadConfigObject(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Missing file, unreadable, invalid JSON, etc. — fall through to the
    // fail-closed default below rather than propagating.
  }
  return {};
}

function taskSessionSyncOf(cfg) {
  const tss = cfg.taskSessionSync;
  return tss && typeof tss === 'object' && !Array.isArray(tss) ? tss : {};
}

function main(argv) {
  const [query, configPath, ...rest] = argv;
  if (!query || !configPath) {
    process.stderr.write(
      'usage: config-field.mjs <enabled|debounce-minutes|log-level|retention-days|sync-repos-count|sync-repos-list|session-state-dir|github-owner|github-owner-type> <config-path> [--backend NAME]\n',
    );
    return 1;
  }
  const cfg = loadConfigObject(configPath);
  const backendFlagIdx = rest.indexOf('--backend');
  const backend = backendFlagIdx !== -1 ? rest[backendFlagIdx + 1] : undefined;
  const tss = backend === 'ado' ? taskSessionSyncOf({ taskSessionSync: cfg.adoSessionSync }) : taskSessionSyncOf(cfg);

  switch (query) {
    case 'enabled': {
      const isEnabled = tss.enabled === true && (backend === undefined || cfg.taskBackend === backend);
      process.stdout.write(`${isEnabled ? 'true' : 'false'}\n`);
      return 0;
    }
    case 'debounce-minutes': {
      const v = tss.debounceMinutes;
      if (Number.isInteger(v) && v >= 0) process.stdout.write(`${v}\n`);
      return 0;
    }
    case 'log-level': {
      if (['off', 'result', 'debug'].includes(tss.logLevel)) process.stdout.write(`${tss.logLevel}\n`);
      return 0;
    }
    case 'retention-days': {
      if (Number.isSafeInteger(tss.retentionDays) && tss.retentionDays >= 0) process.stdout.write(`${tss.retentionDays}\n`);
      return 0;
    }
    case 'sync-repos-count': {
      const arr = Array.isArray(tss.syncRepos) ? tss.syncRepos : [];
      process.stdout.write(`${arr.length}\n`);
      return 0;
    }
    case 'sync-repos-list': {
      const arr = Array.isArray(tss.syncRepos) ? tss.syncRepos : [];
      for (const entry of arr) {
        if (typeof entry === 'string' && entry.length > 0) process.stdout.write(`${entry}\n`);
      }
      return 0;
    }
    case 'session-state-dir': {
      const hasOwn = Object.prototype.hasOwnProperty.call(tss, 'sessionStateDir');
      if (!hasOwn) {
        process.stdout.write('__unset__\n');
      } else {
        const v = tss.sessionStateDir;
        process.stdout.write(`${typeof v === 'string' ? v : ''}\n`);
      }
      return 0;
    }
    case 'github-owner': {
      const owner = cfg.github && typeof cfg.github === 'object' && !Array.isArray(cfg.github)
        ? cfg.github.owner
        : undefined;
      if (typeof owner === 'string' && owner.length > 0) process.stdout.write(`${owner}\n`);
      return 0;
    }
    case 'github-owner-type': {
      const ownerType = cfg.github && typeof cfg.github === 'object' && !Array.isArray(cfg.github)
        ? cfg.github.ownerType
        : undefined;
      process.stdout.write(`${ownerType === 'org' ? 'org' : 'user'}\n`);
      return 0;
    }
    default:
      process.stderr.write(`config-field.mjs: unknown query: ${query}\n`);
      return 1;
  }
}

const isMain = process.argv[1] && existsSync(process.argv[1])
  && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) process.exit(main(process.argv.slice(2)));

export { loadConfigObject, taskSessionSyncOf };
