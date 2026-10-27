#!/usr/bin/env node
// pending-inbox-resolution.test.mjs — regression coverage for the "Pending
// Inbox Sync" bash snippets documented in references/ado-inbox-sync.md and
// references/github-inbox-sync.md. Extracts the ACTUAL fenced bash block from
// the selected reference (not a reimplementation) and executes it in a sandbox, so
// a future edit that reintroduces a hardcoded ~/.copilot/assistant/inbox.md
// path (ignoring a configured `fallbackInbox`) fails this test.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCES = join(HERE, '..', '..', 'references');

/**
 * Pull the bash fenced code block that immediately follows the
 * "### Pending Inbox Sync" heading in the selected backend reference.
 */
function extractPendingInboxSnippet(backend) {
  const text = readFileSync(join(REFERENCES, `${backend}-inbox-sync.md`), 'utf8');
  const heading = '### Pending Inbox Sync';
  const idx = text.indexOf(heading);
  assert.ok(idx !== -1, `expected to find "${heading}" in ${backend}-inbox-sync.md`);
  const afterHeading = text.slice(idx);
  const fenceStart = afterHeading.indexOf('```bash');
  assert.ok(fenceStart !== -1, 'expected a ```bash fenced block after the heading');
  const bodyStart = afterHeading.indexOf('\n', fenceStart) + 1;
  const fenceEnd = afterHeading.indexOf('```', bodyStart);
  assert.ok(fenceEnd !== -1, 'expected a closing ``` fence');
  return afterHeading.slice(bodyStart, fenceEnd);
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'pending-inbox-'));
  const home = join(root, 'home');
  mkdirSync(join(home, '.copilot', 'assistant'), { recursive: true });
  return { root, home };
}

function writeConfig(home, cfg) {
  writeFileSync(join(home, '.copilot', 'assistant', 'config.json'), JSON.stringify(cfg));
}

function runSnippet(snippet, home) {
  return spawnSync('bash', ['-c', snippet], { encoding: 'utf8', env: { ...process.env, HOME: home } });
}

for (const backend of ['ado', 'github']) {
  for (const statusKey of ['status', 'ado_status']) {
    test(`${backend} inbox scan accepts ${statusKey}: pending`, () => {
      const { root, home } = sandbox();
      try {
        writeConfig(home, { taskBackend: backend });
        writeFileSync(join(home, '.copilot', 'assistant', 'inbox.md'),
          `## synthetic capture\n- ${statusKey}: pending\n- title: "Cross-backend pending item"\n`);
        const result = runSnippet(extractPendingInboxSnippet(backend), home);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Cross-backend pending item/);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
}

describe('ADO-mode Pending Inbox Sync snippet (§8a) resolves config.fallbackInbox', () => {
  const snippet = extractPendingInboxSnippet('ado');

  test('the snippet does not hardcode the default path — it reads fallbackInbox from config', () => {
    // A hardcoded path would be a bare `~/.copilot/assistant/inbox.md` with no
    // `config`/`fallbackInbox` resolution step preceding it in the same block.
    assert.match(snippet, /fallbackInbox/);
    assert.match(snippet, /config\.json/);
  });

  test('reads from a CUSTOM configured fallbackInbox path, not the default', () => {
    const { root, home } = sandbox();
    try {
      const customInbox = join(root, 'custom-location', 'my-inbox.md');
      mkdirSync(dirname(customInbox), { recursive: true });
      writeFileSync(customInbox, '## 2026-01-01T00:00:00Z (clientCaptureId: abc123)\n- ado_status: pending\n- title: "Custom inbox item"\n');
      writeConfig(home, { taskBackend: 'ado', fallbackInbox: customInbox });
      // Also plant a decoy at the DEFAULT path to prove it is NOT read.
      writeFileSync(join(home, '.copilot', 'assistant', 'inbox.md'), '## decoy\n- ado_status: pending\n- title: "WRONG FILE"\n');

      const r = runSnippet(snippet, home);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Custom inbox item/);
      assert.doesNotMatch(r.stdout, /WRONG FILE/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('defaults to ~/.copilot/assistant/inbox.md only when fallbackInbox is absent from config', () => {
    const { root, home } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'ado' }); // no fallbackInbox key at all
      writeFileSync(join(home, '.copilot', 'assistant', 'inbox.md'), '## default\n- ado_status: pending\n- title: "Default inbox item"\n');

      const r = runSnippet(snippet, home);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Default inbox item/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('GitHub-mode Pending Inbox Sync snippet (§8b) resolves config.fallbackInbox', () => {
  const snippet = extractPendingInboxSnippet('github');

  test('the snippet does not hardcode the default path — it reads fallbackInbox from config', () => {
    assert.match(snippet, /fallbackInbox/);
    assert.match(snippet, /config\.json/);
  });

  test('reads from a CUSTOM configured fallbackInbox path, not the default', () => {
    const { root, home } = sandbox();
    try {
      const customInbox = join(root, 'somewhere-else', 'inbox-custom.md');
      mkdirSync(dirname(customInbox), { recursive: true });
      writeFileSync(customInbox, '## 2026-01-01T00:00:00Z (clientCaptureId: xyz789)\n- status: pending\n- title: "Custom GitHub inbox item"\n');
      writeConfig(home, { taskBackend: 'github', fallbackInbox: customInbox });
      writeFileSync(join(home, '.copilot', 'assistant', 'inbox.md'), '## decoy\n- status: pending\n- title: "WRONG FILE"\n');

      const r = runSnippet(snippet, home);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Custom GitHub inbox item/);
      assert.doesNotMatch(r.stdout, /WRONG FILE/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('defaults to ~/.copilot/assistant/inbox.md only when fallbackInbox is absent from config', () => {
    const { root, home } = sandbox();
    try {
      writeConfig(home, { taskBackend: 'github' });
      writeFileSync(join(home, '.copilot', 'assistant', 'inbox.md'), '## default\n- status: pending\n- title: "Default GitHub inbox item"\n');

      const r = runSnippet(snippet, home);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Default GitHub inbox item/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
