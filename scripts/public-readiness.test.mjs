import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { residualGuardNames } from './publish-public-guard.mjs';

test('documented App Service runtime paths are public infrastructure, not user homes', () => {
  for (const value of [
    '/home/site', "'/home/site'", '/home/site/wwwroot/content',
    '/home/site/html-manager/state', '/home/site/html-manager/releases/abcdef/start-host.mjs',
  ]) {
    assert.deepEqual(residualGuardNames(value), [], value);
  }
  for (const relative of [
    'synthetic-privateuser/project', 'site/private', 'sitebackup/wwwroot',
    'site/wwwroot-other', 'site/html-manager-other', 'site/html-managerprivate/state',
  ]) {
    const value = path.posix.join('/home', relative);
    assert.ok(residualGuardNames(value).includes('absolute Linux user path'), value);
  }
});
