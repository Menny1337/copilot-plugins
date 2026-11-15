import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RUNTIME_FILES } from './onboarding/azure.mjs';
import { aliasPrefix } from './htmlpub-catalog.mjs';

const exec = promisify(execFile), scripts = path.dirname(fileURLToPath(import.meta.url)), skill = path.dirname(scripts);
test('offline tarball excludes tests and fixtures; its private-prefix bin runs help, setup and local commands',
  { skip: process.platform === 'win32' ? 'POSIX packed-bin PTY; native Windows remains unverified' : false }, async t => {
    const approved = process.env.PUBLISH_HTML_TEST_ARTIFACT_DIR;
    assert.ok(approved && path.isAbsolute(approved), 'Select the approved external artifact directory');
    await mkdir(approved, { recursive: true, mode: 0o700 });
    const root = await mkdtemp(path.join(approved, 'packed-'));
    t.after(() => rm(root, { recursive: true }));
    const home = path.join(root, 'home'), prefix = path.join(root, 'prefix'), bin = path.join(root, 'bin');
    await mkdir(home, { mode: 0o700 }); await mkdir(bin, { mode: 0o700 });
    await symlink(process.execPath, path.join(bin, 'node'));
    const npm = await realpath(path.join(path.dirname(process.execPath), 'npm'));
    const npmrc = path.join(root, 'empty.npmrc'), globalNpmrc = path.join(root, 'empty-global.npmrc');
    await writeFile(npmrc, '', { mode: 0o600 });
    await writeFile(globalNpmrc, '', { mode: 0o600 });
    const env = { PATH: bin, HOME: home, AZURE_CONFIG_DIR: path.join(root, 'empty-azure'), TERM: 'dumb',
      NODE_OPTIONS: process.env.NODE_OPTIONS ?? '', npm_config_userconfig: npmrc, npm_config_globalconfig: globalNpmrc,
      npm_config_cache: path.join(root, 'npm-cache'), npm_config_update_notifier: 'false' };
    const packed = await exec(process.execPath, [npm, 'pack', skill, '--ignore-scripts', '--offline', '--json',
      '--pack-destination', root], { env, cwd: root });
    const [manifest] = JSON.parse(packed.stdout), files = new Set(manifest.files.map(item => item.path));
    assert.ok(files.size > 0);
    assert.deepEqual([...files].filter(name => /(?:^|\/)(?:test|tests|test-fixtures)(?:\/|$)|\.test\.|test-harness|evaluations\.json/.test(name)), []);
    const pkg = JSON.parse(await readFile(path.join(skill, 'package.json'), 'utf8'));
    assert.equal(pkg.private, true, 'Local installation must not authorize registry publication');
    assert.equal(pkg.license, 'MIT');
    assert.equal(manifest.version, pkg.version);
    assert.equal(await readFile(path.join(skill, 'LICENSE'), 'utf8'),
      await readFile(path.resolve(skill, '../../../../LICENSE'), 'utf8'));
    for (const file of pkg.files.filter(name => !name.includes('*'))) assert.ok(files.has(file), `missing packaged file: ${file}`);
    for (const file of RUNTIME_FILES) assert.ok(files.has(`scripts/hosted-manager/${file}`), `missing runtime dependency: ${file}`);
    const browserFiles = ['browser-window.mjs', 'browser-managed.mjs', 'browser-managed-owner.cjs',
      'browser-profile-launcher.cjs', 'browser-activity.cjs', 'bridge-token.mjs',
      'browser-window-macos.applescript', 'browser-window-windows.ps1'];
    for (const name of browserFiles) {
      assert.ok(files.has(`scripts/browser-runtime/${name}`), `missing browser dependency: ${name}`);
      assert.deepEqual(await readFile(path.join(scripts, 'browser-runtime', name)),
        await readFile(path.resolve(skill, '../browser/scripts', name)), `browser runtime mirror changed: ${name}`);
    }
    for (const file of ['package.json', 'references/htmlpub.md', 'references/onboarding.md', 'references/operations.md',
      'references/hosted-manager.md', 'templates/onboarding-request.example.json', 'templates/resource-inventory.schema.json',
      'templates/config.example.json']) assert.ok(files.has(file), `missing guide/template: ${file}`);

    await exec(process.execPath, [npm, 'install', '--global', '--prefix', prefix, path.join(root, manifest.filename),
      '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { env, cwd: root });
    const installed = path.join(prefix, 'lib/node_modules/@mnmstack/htmlpub'), command = path.join(prefix, 'bin/htmlpub');
    assert.equal(await readFile(path.join(installed, 'LICENSE'), 'utf8'),
      await readFile(path.join(skill, 'LICENSE'), 'utf8'));
    for (const name of browserFiles) assert.deepEqual(await readFile(path.join(installed, 'scripts/browser-runtime', name)),
      await readFile(path.resolve(skill, '../browser/scripts', name)), `installed browser runtime differs: ${name}`);
    await exec(process.execPath, ['--input-type=module', '-e',
      'await import(process.argv[2]); await import(process.argv[3]); await import(process.argv[4]);', 'import-check',
      path.join(installed, 'scripts/browser-runtime/browser-window.mjs'),
      path.join(installed, 'scripts/browser-runtime/browser-managed.mjs'),
      path.join(installed, 'scripts/hosted-manager/browser-transport.mjs')], { env, cwd: root });
    const run = args => exec(command, args, { env, cwd: root });
    const help = await run(['--help', '--json']);
    assert.match(JSON.parse(help.stdout).help, /htmlpub setup/);
    const config = path.join(home, 'resources.json');
    await assert.rejects(run(['setup', '--config', config, '--non-interactive']), error => {
      assert.match(JSON.parse(error.stderr).error, /needs a terminal/); return true;
    });
    const actualPty = await exec(process.env.PYTHON ?? 'python3', [path.join(scripts, 'test-fixtures/terminal-pty.py'),
      process.execPath, command, 'packed-alias', config, path.join(scripts, 'test-fixtures/packed-offline.mjs'), bin, installed],
    { timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.match(actualPty.stdout, /PASS packed-alias: real PTY/);
    const draft = JSON.parse(await readFile(config + '.guided.json', 'utf8'));
    assert.equal(draft.prefix, aliasPrefix({ user: { type: 'user', name: `${'a'.repeat(30)}@example.invalid` } }));
    for (const action of ['status', 'resources']) {
      const result = await run([action, '--config', config, '--json']);
      assert.equal(JSON.parse(result.stdout).status, 'draft');
    }
    const calls = (await readFile(config + '.calls.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(calls.map(item => item.command), ['account list', 'account show']);
    assert.ok(calls.every(item => item.synthetic === true && !item.forbidden));
  });
