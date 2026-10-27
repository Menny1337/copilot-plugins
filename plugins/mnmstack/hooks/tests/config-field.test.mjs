#!/usr/bin/env node
// config-field.test.mjs — node:test coverage for the dependency-free Node
// fallback (r3 finding 8) github-session-sync.sh uses to read
// ~/.copilot/assistant/config.json fields when `jq` is not on PATH.
//
// This file exercises config-field.mjs directly (fast, deterministic) for
// every query kind and the fail-closed contract on malformed/absent config.
// github-session-sync.test.mjs complements this with end-to-end coverage of
// the shell script itself with jq removed from PATH, proving the fallback is
// actually wired in (not just correct in isolation).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'config-field.mjs');

function withConfig(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'config-field-test-'));
  const path = join(dir, 'config.json');
  if (contents !== undefined) {
    writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  try {
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(query, configPath, extraArgs = []) {
  const result = execFileSync(process.execPath, [SCRIPT, query, configPath, ...extraArgs], {
    encoding: 'utf8',
  });
  return result;
}

describe('config-field.mjs — enabled', () => {
  test('true when taskSessionSync.enabled === true and taskBackend matches --backend', () => {
    withConfig({ taskBackend: 'github', taskSessionSync: { enabled: true } }, (cfg) => {
      assert.equal(run('enabled', cfg, ['--backend', 'github']), 'true\n');
    });
  });

  test('false when taskBackend does not match --backend, even if enabled === true', () => {
    withConfig({ taskBackend: 'ado', taskSessionSync: { enabled: true } }, (cfg) => {
      assert.equal(run('enabled', cfg, ['--backend', 'github']), 'false\n');
    });
  });

  test('false when taskSessionSync.enabled is absent', () => {
    withConfig({ taskBackend: 'github' }, (cfg) => {
      assert.equal(run('enabled', cfg, ['--backend', 'github']), 'false\n');
    });
  });

  test('false when taskSessionSync.enabled is truthy-but-not-boolean-true (e.g. "true" string)', () => {
    withConfig({ taskBackend: 'github', taskSessionSync: { enabled: 'true' } }, (cfg) => {
      assert.equal(run('enabled', cfg, ['--backend', 'github']), 'false\n');
    });
  });

  test('does not confuse a sibling top-level "enabled" key (e.g. leftover adoSessionSync.enabled) with taskSessionSync.enabled', () => {
    withConfig(
      { taskBackend: 'github', adoSessionSync: { enabled: true }, taskSessionSync: { enabled: false } },
      (cfg) => {
        assert.equal(run('enabled', cfg, ['--backend', 'github']), 'false\n');
      },
    );
  });

  test('without --backend, only taskSessionSync.enabled matters', () => {
    withConfig({ taskBackend: 'ado', taskSessionSync: { enabled: true } }, (cfg) => {
      assert.equal(run('enabled', cfg), 'true\n');
    });
  });
});

describe('config-field.mjs — debounce-minutes', () => {
  test('prints the configured integer', () => {
    withConfig({ taskSessionSync: { debounceMinutes: 42 } }, (cfg) => {
      assert.equal(run('debounce-minutes', cfg), '42\n');
    });
  });

  test('prints 0 when explicitly zero (falsy-but-valid)', () => {
    withConfig({ taskSessionSync: { debounceMinutes: 0 } }, (cfg) => {
      assert.equal(run('debounce-minutes', cfg), '0\n');
    });
  });

  test('prints nothing when absent (caller default applies)', () => {
    withConfig({ taskSessionSync: {} }, (cfg) => {
      assert.equal(run('debounce-minutes', cfg), '');
    });
  });

  test('prints nothing when non-numeric (fail-closed to caller default, never a crash)', () => {
    withConfig({ taskSessionSync: { debounceMinutes: 'soon' } }, (cfg) => {
      assert.equal(run('debounce-minutes', cfg), '');
    });
  });

  test('prints nothing for a negative number (rejects, does not pass through)', () => {
    withConfig({ taskSessionSync: { debounceMinutes: -5 } }, (cfg) => {
      assert.equal(run('debounce-minutes', cfg), '');
    });
  });
});

describe('config-field.mjs — sync-repos-count / sync-repos-list', () => {
  test('count reflects array length; list prints one entry per line', () => {
    withConfig({ taskSessionSync: { syncRepos: ['/a', '/b', '/c'] } }, (cfg) => {
      assert.equal(run('sync-repos-count', cfg), '3\n');
      assert.equal(run('sync-repos-list', cfg), '/a\n/b\n/c\n');
    });
  });

  test('count is 0 and list is empty when syncRepos is absent', () => {
    withConfig({ taskSessionSync: {} }, (cfg) => {
      assert.equal(run('sync-repos-count', cfg), '0\n');
      assert.equal(run('sync-repos-list', cfg), '');
    });
  });

  test('non-string / empty-string entries are skipped in the list but still counted', () => {
    withConfig({ taskSessionSync: { syncRepos: ['/a', '', 42, null, '/b'] } }, (cfg) => {
      assert.equal(run('sync-repos-count', cfg), '5\n');
      assert.equal(run('sync-repos-list', cfg), '/a\n/b\n');
    });
  });

  test('count is 0 when syncRepos is not an array', () => {
    withConfig({ taskSessionSync: { syncRepos: 'not-an-array' } }, (cfg) => {
      assert.equal(run('sync-repos-count', cfg), '0\n');
    });
  });
});

describe('config-field.mjs — session-state-dir', () => {
  test('prints __unset__ when the key is genuinely absent', () => {
    withConfig({ taskSessionSync: {} }, (cfg) => {
      assert.equal(run('session-state-dir', cfg), '__unset__\n');
    });
  });

  test('prints empty string when explicitly set to "" (distinct from unset)', () => {
    withConfig({ taskSessionSync: { sessionStateDir: '' } }, (cfg) => {
      assert.equal(run('session-state-dir', cfg), '\n');
    });
  });

  test('prints the configured value, including a leading ~', () => {
    withConfig({ taskSessionSync: { sessionStateDir: '~/custom-sync-state' } }, (cfg) => {
      assert.equal(run('session-state-dir', cfg), '~/custom-sync-state\n');
    });
  });

  test('prints __unset__ when taskSessionSync itself is absent', () => {
    withConfig({ taskBackend: 'github' }, (cfg) => {
      assert.equal(run('session-state-dir', cfg), '__unset__\n');
    });
  });
});

describe('config-field.mjs — GitHub owner identity', () => {
  test('prints the configured owner and defaults ownerType to user', () => {
    withConfig({ github: { owner: 'example-user' } }, (cfg) => {
      assert.equal(run('github-owner', cfg), 'example-user\n');
      assert.equal(run('github-owner-type', cfg), 'user\n');
    });
  });

  test('preserves an explicit org ownerType', () => {
    withConfig({ github: { owner: 'example-org', ownerType: 'org' } }, (cfg) => {
      assert.equal(run('github-owner', cfg), 'example-org\n');
      assert.equal(run('github-owner-type', cfg), 'org\n');
    });
  });
});

describe('config-field.mjs — fail-closed contract on malformed/absent config', () => {
  test('missing config file: every query behaves as if every field were absent', () => {
    withConfig(undefined, (cfg) => {
      assert.equal(run('enabled', cfg, ['--backend', 'github']), 'false\n');
      assert.equal(run('debounce-minutes', cfg), '');
      assert.equal(run('sync-repos-count', cfg), '0\n');
      assert.equal(run('sync-repos-list', cfg), '');
      assert.equal(run('session-state-dir', cfg), '__unset__\n');
      assert.equal(run('github-owner', cfg), '');
      assert.equal(run('github-owner-type', cfg), 'user\n');
    });
  });

  test('invalid JSON (truncated/corrupt): every query fails closed, never throws', () => {
    withConfig('{ "taskSessionSync": { "enabled": true, ', (cfg) => {
      assert.equal(run('enabled', cfg, ['--backend', 'github']), 'false\n');
      assert.equal(run('debounce-minutes', cfg), '');
      assert.equal(run('sync-repos-count', cfg), '0\n');
      assert.equal(run('session-state-dir', cfg), '__unset__\n');
      assert.equal(run('github-owner', cfg), '');
      assert.equal(run('github-owner-type', cfg), 'user\n');
    });
  });

  test('top-level JSON array (not an object): fails closed rather than throwing', () => {
    withConfig('[1, 2, 3]', (cfg) => {
      assert.equal(run('enabled', cfg, ['--backend', 'github']), 'false\n');
      assert.equal(run('sync-repos-count', cfg), '0\n');
    });
  });

  test('taskSessionSync itself is a non-object (e.g. a string): fails closed rather than throwing', () => {
    withConfig({ taskSessionSync: 'oops' }, (cfg) => {
      assert.equal(run('enabled', cfg, ['--backend', 'github']), 'false\n');
      assert.equal(run('debounce-minutes', cfg), '');
      assert.equal(run('sync-repos-count', cfg), '0\n');
      assert.equal(run('session-state-dir', cfg), '__unset__\n');
    });
  });
});

describe('config-field.mjs — CLI invocation contract', () => {
  test('exits 1 with usage on missing arguments', () => {
    assert.throws(() => execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' }));
  });

  test('exits 1 on an unknown query name', () => {
    withConfig({}, (cfg) => {
      assert.throws(() => execFileSync(process.execPath, [SCRIPT, 'nonsense-query', cfg], { encoding: 'utf8' }));
    });
  });
});
