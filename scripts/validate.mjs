#!/usr/bin/env node
/**
 * validate.mjs — sanity check the marketplace before push/install.
 *
 * Asserts:
 *   1. .github/plugin/marketplace.json exists and parses
 *   2. Every plugin entry's `source` directory exists
 *   3. Every plugin has a plugin.json with name + version + description
 *   4. marketplace entry version matches the plugin's plugin.json version
 *   5. Every skills/<name>/ has SKILL.md with valid YAML-style frontmatter
 *   6. Every agents/*.agent.md has valid YAML-style frontmatter
 *   7. No remaining `~/.copilot/skills/` references inside SKILL.md / .agent.md
 *      (allowlist: documentation-only files explicitly tagged with HTML comment
 *       <!-- validate:allow-user-paths -->)
 *   8. No broken symlinks
 *   9. No skill-name collisions across plugins
 *  10. Every plugin.json with a "hooks" field points to an existing hooks JSON
 *      FILE (e.g. "hooks/hooks.json", not a directory — a dir throws EISDIR at
 *      load time), and that hooks.json has a valid schema (version, known event
 *      names, valid hook types, required fields per type, https for
 *      permission-granting events)
 *
 * Usage: node scripts/validate.mjs
 * Exits 0 on success, 1 on any failure.
 */

import { readFileSync, statSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const errors = [];
const warnings = [];

function err(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

function exists(p) {
  try { statSync(p); return true; } catch { return false; }
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(`Failed to parse JSON ${relative(repoRoot, path)}: ${e.message}`);
    return null;
  }
}

function readFrontmatter(path) {
  const raw = readFileSync(path, 'utf8');
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { ok: false, reason: 'missing frontmatter (must start with `---`)' };
  }
  const end = raw.indexOf('\n---', 4);
  if (end < 0) return { ok: false, reason: 'unterminated frontmatter (no closing `---`)' };
  const body = raw.slice(4, end);
  // Minimal sanity: at least one `key:` line
  if (!/\n?[a-zA-Z_][\w-]*\s*:/.test(body)) {
    return { ok: false, reason: 'frontmatter has no key:value lines' };
  }
  return { ok: true, body };
}

// ── Hook schema validation ───────────────────────────────────────────────────
const HOOK_EVENTS = new Set([
  // camelCase
  'sessionStart', 'sessionEnd', 'userPromptSubmitted', 'preToolUse', 'postToolUse',
  'postToolUseFailure', 'permissionRequest', 'agentStop', 'subagentStart', 'subagentStop',
  'errorOccurred', 'preCompact', 'notification',
  // VS Code compatible PascalCase
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'PermissionRequest', 'Stop', 'SubagentStart', 'SubagentStop',
  'ErrorOccurred', 'PreCompact', 'Notification',
]);
const HTTPS_REQUIRED_EVENTS = new Set(['preToolUse', 'PreToolUse', 'permissionRequest', 'PermissionRequest']);

function isLocalhostHttp(url) {
  return /^http:\/\/(localhost|127\.|\[::1\])/.test(url);
}

function validateHooks(hooksJsonPath, pluginName) {
  const rel = relative(repoRoot, hooksJsonPath);
  const hj = readJson(hooksJsonPath);
  if (!hj) return; // readJson already reported the parse error
  if (hj.version !== 1) err(`${pluginName}: ${rel} must set "version": 1`);
  if (hj.hooks == null) { err(`${pluginName}: ${rel} missing "hooks" object`); return; }
  if (typeof hj.hooks !== 'object' || Array.isArray(hj.hooks)) {
    err(`${pluginName}: ${rel} "hooks" must be an object keyed by event name`);
    return;
  }
  for (const [eventName, handlers] of Object.entries(hj.hooks)) {
    if (!HOOK_EVENTS.has(eventName)) {
      err(`${pluginName}: ${rel} unknown hook event "${eventName}"`);
      continue;
    }
    if (!Array.isArray(handlers)) {
      err(`${pluginName}: ${rel} event "${eventName}" must map to an array of hook entries`);
      continue;
    }
    const isSessionStart = eventName === 'sessionStart' || eventName === 'SessionStart';
    for (const h of handlers) {
      if (!h || typeof h !== 'object') { err(`${pluginName}: ${rel} ${eventName}: hook entry must be an object`); continue; }
      const type = h.type ?? 'command';
      if (!['command', 'http', 'prompt'].includes(type)) {
        err(`${pluginName}: ${rel} ${eventName}: invalid hook type "${type}"`);
        continue;
      }
      if (type === 'command') {
        if (!h.bash && !h.powershell && !h.command) {
          err(`${pluginName}: ${rel} ${eventName}: command hook needs one of "bash", "powershell", or "command"`);
        }
      } else if (type === 'http') {
        if (!h.url) err(`${pluginName}: ${rel} ${eventName}: http hook needs "url"`);
        else if (!/^https:\/\//.test(h.url) && !isLocalhostHttp(h.url)) {
          err(`${pluginName}: ${rel} ${eventName}: http hook url must use https:// (localhost http allowed)`);
        } else if (HTTPS_REQUIRED_EVENTS.has(eventName) && !/^https:\/\//.test(h.url)) {
          err(`${pluginName}: ${rel} ${eventName}: http hook url must use https:// for permission-granting events`);
        }
      } else if (type === 'prompt') {
        if (!isSessionStart) err(`${pluginName}: ${rel} ${eventName}: prompt hooks are only allowed on sessionStart`);
        if (!h.prompt) err(`${pluginName}: ${rel} ${eventName}: prompt hook needs "prompt"`);
      }
      if (h.timeoutSec != null && typeof h.timeoutSec !== 'number') {
        err(`${pluginName}: ${rel} ${eventName}: "timeoutSec" must be a number`);
      }
    }
  }
}

// ── 1. Read marketplace.json ─────────────────────────────────────────────────
const marketplacePath = resolve(repoRoot, '.github/plugin/marketplace.json');
if (!exists(marketplacePath)) {
  err('Missing .github/plugin/marketplace.json');
  printAndExit();
}
const marketplace = readJson(marketplacePath);
if (!marketplace) printAndExit();

if (!marketplace.name) err('marketplace.json: missing top-level "name"');
if (!Array.isArray(marketplace.plugins)) err('marketplace.json: missing "plugins" array');

// ── Walk plugins ────────────────────────────────────────────────────────────
const pluginNames = new Set();
const skillIndex = new Map(); // skillName -> [plugin, ...]
const agentIndex = new Map(); // agentName -> [plugin, ...]

for (const entry of marketplace.plugins ?? []) {
  if (!entry.name) { err(`marketplace.json: plugin entry missing "name"`); continue; }
  if (pluginNames.has(entry.name)) err(`marketplace.json: duplicate plugin name "${entry.name}"`);
  pluginNames.add(entry.name);

  if (!entry.version) err(`${entry.name}: marketplace entry missing "version"`);
  if (!entry.source) { err(`${entry.name}: marketplace entry missing "source"`); continue; }

  const pluginDir = resolve(repoRoot, entry.source);
  if (!isDir(pluginDir)) { err(`${entry.name}: source dir not found: ${entry.source}`); continue; }

  // 3 + 4. plugin.json
  const pluginJsonPath = join(pluginDir, 'plugin.json');
  if (!exists(pluginJsonPath)) {
    err(`${entry.name}: missing plugin.json`);
  } else {
    const pj = readJson(pluginJsonPath);
    if (pj) {
      if (pj.name !== entry.name) err(`${entry.name}: plugin.json name "${pj.name}" != marketplace entry name`);
      if (pj.version !== entry.version) err(`${entry.name}: plugin.json version "${pj.version}" != marketplace entry version "${entry.version}"`);
      if (!pj.description) err(`${entry.name}: plugin.json missing "description"`);

      // 10. hooks file consistency + schema. plugin.json "hooks" must reference
      // the hooks JSON FILE (e.g. "hooks/hooks.json"), NOT a directory: the CLI
      // readFile()s this path at load time, so a directory throws EISDIR and the
      // whole plugin fails to load.
      if (pj.hooks) {
        const hooksPath = join(pluginDir, pj.hooks);
        if (isDir(hooksPath)) {
          err(`${entry.name}: plugin.json hooks="${pj.hooks}" points to a directory — it must reference the hooks JSON file (e.g. "hooks/hooks.json"). The CLI readFile()s this path, so a directory throws EISDIR and the plugin fails to load.`);
        } else if (!exists(hooksPath)) {
          err(`${entry.name}: plugin.json declares hooks="${pj.hooks}" but file not found`);
        } else {
          validateHooks(hooksPath, entry.name);
        }
      }
    }
  }

  // 5. Skills frontmatter
  const skillsDir = join(pluginDir, 'skills');
  if (isDir(skillsDir)) {
    for (const skillName of readdirSync(skillsDir)) {
      const skillDir = join(skillsDir, skillName);
      if (!isDir(skillDir)) continue;
      // Track for collision detection
      const arr = skillIndex.get(skillName) ?? [];
      arr.push(entry.name);
      skillIndex.set(skillName, arr);

      const skillMd = join(skillDir, 'SKILL.md');
      if (!exists(skillMd)) {
        err(`${entry.name}/skills/${skillName}: missing SKILL.md`);
        continue;
      }
      const fm = readFrontmatter(skillMd);
      if (!fm.ok) err(`${entry.name}/skills/${skillName}/SKILL.md: ${fm.reason}`);
    }
  }

  // 6. Agents frontmatter
  const agentsDir = join(pluginDir, 'agents');
  if (isDir(agentsDir)) {
    for (const f of readdirSync(agentsDir)) {
      if (!f.endsWith('.agent.md')) continue;
      const agentName = f.replace(/\.agent\.md$/, '');
      const arr = agentIndex.get(agentName) ?? [];
      arr.push(entry.name);
      agentIndex.set(agentName, arr);
      const agentPath = join(agentsDir, f);
      const fm = readFrontmatter(agentPath);
      if (!fm.ok) err(`${entry.name}/agents/${f}: ${fm.reason}`);
    }
  }

  // 7. Hardcoded ~/.copilot path scan
  walkAndScan(pluginDir, entry.name);

  // 7b. Refuse Clawpilot-bundled skills (they ship a .bundled-version marker)
  walkBundledMarkers(pluginDir, entry.name);

  // 8. Broken symlinks
  walkSymlinks(pluginDir, entry.name);
}

// 9. Collisions
for (const [name, owners] of skillIndex) {
  if (owners.length > 1) err(`Skill name collision: "${name}" defined in plugins ${owners.join(', ')}`);
}
for (const [name, owners] of agentIndex) {
  if (owners.length > 1) err(`Agent name collision: "${name}" defined in plugins ${owners.join(', ')}`);
}

function walkAndScan(dir, pluginName) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.git') continue;
    const p = join(dir, f);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) { walkAndScan(p, pluginName); continue; }
    if (!/\.(md|mjs|js|sh|ps1)$/.test(f)) continue;
    if (f.endsWith('.orig')) continue;
    let content;
    try { content = readFileSync(p, 'utf8'); } catch { continue; }
    if (content.includes('<!-- validate:allow-user-paths -->')) continue;
    if (/~\/\.copilot\/(skills|agents)\//.test(content)) {
      err(`${pluginName}: ${relative(repoRoot, p)} still contains "~/.copilot/{skills,agents}/" reference`);
    }
  }
}

function walkBundledMarkers(dir, pluginName) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.git') continue;
    const p = join(dir, f);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) { walkBundledMarkers(p, pluginName); continue; }
    if (f === '.bundled-version') {
      err(`${pluginName}: ${relative(repoRoot, p)} — Clawpilot-bundled skills (marked by .bundled-version) must not be vendored into this marketplace`);
    }
  }
}

function walkSymlinks(dir, pluginName) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.git') continue;
    const p = join(dir, f);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) {
      try { statSync(p); } catch { err(`${pluginName}: broken symlink ${relative(repoRoot, p)}`); }
      continue;
    }
    if (st.isDirectory()) walkSymlinks(p, pluginName);
  }
}

// ── Output ──────────────────────────────────────────────────────────────────
function printAndExit() {
  for (const w of warnings) console.warn(`⚠ ${w}`);
  if (errors.length === 0) {
    console.log(`✅ validate.mjs: ${marketplace?.plugins?.length ?? 0} plugins OK (${skillIndex.size} skills, ${agentIndex.size} agents)`);
    process.exit(0);
  }
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\n❌ validate.mjs: ${errors.length} error(s)`);
  process.exit(1);
}

printAndExit();
