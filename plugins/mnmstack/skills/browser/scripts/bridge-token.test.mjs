import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  EXTENSION_ID,
  isSafeProfileDirectory,
  parseSession,
  readLastUsedProfile,
  readProfileToken,
  selectProfile,
} from './bridge-token.mjs';

const token = 'a'.repeat(43);

function tokenFixture(extensionFragment, {
  header = Buffer.from([0, 1, 2, 3]),
  value = token,
  gap = '',
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bridge-token-leveldb-'));
  const leveldb = join(root, 'Local Storage', 'leveldb');
  mkdirSync(leveldb, { recursive: true });
  writeFileSync(join(leveldb, '000001.ldb'), Buffer.concat([
    Buffer.from(`prefix:${extensionFragment}${gap}`, 'binary'),
    Buffer.from('\u0000\u0001auth-token', 'binary'),
    header,
    Buffer.from(value, 'binary'),
  ]));
  return root;
}

test('parseSession separates browser and optional profile hint', () => {
  assert.deepEqual(parseSession('msedge'), {
    browser: 'msedge',
    hint: null,
    raw: 'msedge',
  });
  assert.deepEqual(parseSession('chrome-work'), {
    browser: 'chrome',
    hint: 'work',
    raw: 'chrome-work',
  });
});

test('readLastUsedProfile follows browser Local State and fails safely', () => {
  const root = mkdtempSync(join(tmpdir(), 'bridge-token-test-'));
  writeFileSync(join(root, 'Local State'), JSON.stringify({
    profile: {
      last_used: 'Profile 2',
      last_active_profiles: ['Profile 1'],
    },
  }));
  assert.equal(readLastUsedProfile(root), 'Profile 2');

  const missing = join(root, 'missing');
  mkdirSync(missing);
  assert.equal(readLastUsedProfile(missing), null);
});

test('profile directory validation rejects path traversal and separators', () => {
  assert.equal(isSafeProfileDirectory('Default'), true);
  assert.equal(isSafeProfileDirectory('Profile 2'), true);
  assert.equal(isSafeProfileDirectory('..'), false);
  assert.equal(isSafeProfileDirectory('../Other'), false);
  assert.equal(isSafeProfileDirectory('nested\\Other'), false);
});

test('token extraction accepts either surviving side of a prefix-compressed extension ID', () => {
  assert.equal(readProfileToken(tokenFixture(EXTENSION_ID)), token);
  assert.equal(readProfileToken(tokenFixture(EXTENSION_ID.slice(1))), token);
  assert.equal(readProfileToken(tokenFixture(
    EXTENSION_ID,
    { header: Buffer.alloc(80, 1) },
  )), token);
});

test('token extraction rejects an unscoped auth-token record', () => {
  assert.equal(readProfileToken(tokenFixture('not-the-bridge-extension')), null);
  assert.equal(readProfileToken(tokenFixture(
    EXTENSION_ID,
    { gap: 'x'.repeat(80) },
  )), null);
  assert.equal(readProfileToken(tokenFixture(
    EXTENSION_ID,
    { value: 'b'.repeat(44) },
  )), null);
});

test('profile selection fails closed for empty and ambiguous selectors', () => {
  const profiles = [
    { dir: 'Default', name: 'Alex Personal', account: 'alex@example.com' },
    { dir: 'Profile 1', name: 'Alex Work', account: 'alex@work.example' },
  ];
  assert.equal(selectProfile(profiles, '@@@').reason, 'profile-not-found');
  assert.equal(selectProfile(profiles, 'alex').reason, 'profile-ambiguous');
  assert.equal(selectProfile(profiles, 'Profile 1').profile.dir, 'Profile 1');

  const directoryNameCollision = [
    { dir: 'Default', name: 'Personal', account: null },
    { dir: 'Profile 1', name: 'Default', account: null },
  ];
  assert.equal(
    selectProfile(directoryNameCollision, 'Default').reason,
    'profile-ambiguous',
  );
});
