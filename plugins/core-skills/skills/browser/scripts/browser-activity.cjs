'use strict';

const { readFileSync, realpathSync } = require('node:fs');
const Module = require('node:module');
const { basename, dirname, join } = require('node:path');

const VERIFIED_CORE_VERSION = '1.63.0-alpha-2026-08-31';
const FOCUS_INITIALIZATION = `if (this._isMainFrame() && !skipDefaultOverrides)
            promises2.push(this._client.send("Emulation.setFocusEmulationEnabled", { enabled: true }));`;

function unsupported() {
  throw new Error('COPILOT_BROWSER_ACTIVITY_UNSUPPORTED: unverified native focus initialization');
}

function activeSource(file) {
  const metadata = JSON.parse(readFileSync(join(dirname(file), '..', 'package.json'), 'utf8'));
  const source = readFileSync(file, 'utf8');
  if (metadata.name !== 'playwright-core' || metadata.version !== VERIFIED_CORE_VERSION ||
      source.split(FOCUS_INITIALIZATION).length !== 2) unsupported();
  // Bridge noDefaults must still suppress every override except native focus.
  return source.replace(FOCUS_INITIALIZATION, FOCUS_INITIALIZATION.replace(
    'this._isMainFrame() && !skipDefaultOverrides', 'this._isMainFrame()',
  ));
}

function install() {
  const entry = realpathSync(process.argv[1]);
  if (!['playwright-cli.js', 'cliDaemon.js'].includes(basename(entry))) return;
  let core;
  try {
    core = Module.createRequire(entry).resolve('playwright-core/lib/coreBundle');
    activeSource(core);
  } catch {
    unsupported();
  }
  if (require.cache[core]) unsupported();
  const original = Module._extensions['.js'];
  Module._extensions['.js'] = function load(module, filename) {
    if (filename !== core) return original(module, filename);
    Module._extensions['.js'] = original;
    module._compile(activeSource(filename), filename);
  };
}

install();
