import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';

const infra = path.dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(path.join(homedir(), '.publish-html-tests-'));
test.after(() => rmSync(root, { recursive: true, force: true }));

for (const scenario of [
  'azure-wrapper', 'missing-config', 'validation', 'init', 'unsafe-host', 'unsafe-auth', 'unsafe-readers',
  'basic-auth', 'upload', 'overwrite-refusal', 'overwrite', 'drift', 'auth-drift',
  'open-failure', 'read-failure', 'deploy-failure', 'hash-mismatch', 'restore-failure',
  'recovery', 'lock',
]) {
  test(`uploader: ${scenario}`, () => {
    const work = path.join(root, scenario);
    mkdirSync(work);
    const result = spawnSync('pwsh', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      path.join(infra, 'upload-html.test-harness.ps1'), '-Scenario', scenario, '-WorkRoot', work,
    ], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`PASS ${scenario}`));
    assert.doesNotMatch(result.stdout + result.stderr, /FAKE-IN-MEMORY-TOKEN/);
  });
}

test('uploader: transport and interface safety guards', () => {
  const source = readFileSync(path.join(infra, 'upload-html.ps1'), 'utf8');
  assert.match(source, /--subscription', \$script:Publisher\.subscriptionId/);
  assert.match(source, /AllowAutoRedirect = \$false/);
  assert.match(source, /--resource', 'https:\/\/management\.azure\.com\/'/);
  assert.doesNotMatch(source, /publishing-credentials|list-publishing|inventory\.json|C:\\Users\\/i);
  assert.match(source, /FileMode\]::CreateNew/);
  assert.match(source, /FileShare\]::None/);
  assert.match(source, /ResponseHeadersRead/);
});
