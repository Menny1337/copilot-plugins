#!/usr/bin/env node
/**
 * validate.mjs — sanity check the marketplace before push/install.
 *
 * Asserts:
 *   1. .github/plugin/marketplace.json exists and parses
 *   2. Every plugin entry's `source` directory exists
 *   3. Every plugin has a plugin.json with name + version + description
 *   4. marketplace entry version matches the plugin's plugin.json version
 *   5. Every skills/<name>/ has SKILL.md with valid YAML-style frontmatter,
 *      a description within Copilot CLI's 1024-char limit, and a name matching
 *      the CLI's allowed pattern / 64-char cap (otherwise the skill fails to load)
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
 * Usage:
 *   node scripts/validate.mjs                  # full marketplace validation (CI)
 *   node scripts/validate.mjs --check-cli-schema [--bundle <index.js>]
 *                                              # compare SKILL_LIMITS against the
 *                                              # installed @github/copilot bundle
 *                                              # (local drift check; fails closed)
 * Exits 0 on success, 1 on any failure.
 */

import { readFileSync, statSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const argv = process.argv.slice(2);
function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

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
  // Parse top-level single-line scalars (key→value, outer quotes stripped) so
  // callers can enforce the Copilot CLI's frontmatter constraints. Indented and
  // blank lines are ignored — block scalars are caught by catalog.mjs.
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    if (!line || /^\s/.test(line)) continue;
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
        (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
      val = val.slice(1, -1);
    }
    fields[m[1]] = val;
  }
  return { ok: true, body, fields };
}

// ── Copilot CLI skill frontmatter limits ─────────────────────────────────────
// These mirror the zod schema baked into the @github/copilot CLI bundle. A skill
// that violates them fails to load at runtime ("Failed to load N skill"), even
// when the file is otherwise well-formed — so we enforce them here to catch the
// problem in CI before the CLI does.
//
// SOURCE OF TRUTH: @github/copilot/index.js. These constants are maintained by
// hand on purpose (they change rarely), but you do NOT have to discover drift by
// hand: run `node scripts/validate.mjs --check-cli-schema` to compare them
// against the locally-installed CLI bundle (it fails loudly on any mismatch).
// To verify manually, grep the bundle for these stable anchor strings:
//   "Skill description must be at most 1024 characters"      -> descriptionMax
//   "Skill name must be at most 64 characters"               -> nameMax
//   /^[a-zA-Z0-9][a-zA-Z0-9._\- ]*$/  (the skill-name regex)  -> namePattern
//
// Agents are intentionally NOT capped here: the CLI schema defines no agent
// description/name limit, so inventing one would reject valid agents.
const SKILL_LIMITS = {
  descriptionMax: 1024,
  nameMax: 64,
  namePattern: /^[a-zA-Z0-9][a-zA-Z0-9._\- ]*$/,
};

function checkSkillFrontmatter(fields, label) {
  const desc = fields.description;
  if (typeof desc === 'string' && desc.length > SKILL_LIMITS.descriptionMax) {
    err(`${label}: description is ${desc.length} chars — Copilot CLI rejects skills whose description exceeds ${SKILL_LIMITS.descriptionMax} characters (the skill fails to load).`);
  }
  const name = fields.name;
  if (typeof name === 'string' && name.length > 0) {
    if (name.length > SKILL_LIMITS.nameMax) {
      err(`${label}: name is ${name.length} chars — Copilot CLI caps skill names at ${SKILL_LIMITS.nameMax} characters.`);
    }
    if (!SKILL_LIMITS.namePattern.test(name)) {
      err(`${label}: name "${name}" must contain only letters, numbers, hyphens, underscores, dots, and spaces, and start with a letter or number.`);
    }
  }
}

// ── --check-cli-schema: drift detector ───────────────────────────────────────
// Optional, local-only check: when an installed @github/copilot bundle is
// available, confirm SKILL_LIMITS above still matches the CLI's real zod schema.
// It NEVER rewrites anything — it only reports drift, and it FAILS CLOSED:
//   • bundle present + values differ        → exit 1 (update SKILL_LIMITS)
//   • bundle present + an anchor won't match → exit 1 (the CLI changed its
//                                              wording/format; update the anchors)
//   • no bundle found                        → exit 0 (nothing to check; this is
//                                              expected in CI, which has no CLI)
// Pick the active bundle with `--bundle <path>`; otherwise it scans the bun
// cache and the npm global root and uses the highest version it finds.

/** Locate an installed @github/copilot CLI bundle (index.js). Returns {file, version} or null. */
function locateCopilotBundle(override) {
  if (override) {
    if (!exists(override)) {
      console.error(`✗ --bundle path not found: ${override}`);
      process.exit(1);
    }
    return { file: override, version: 'override' };
  }
  const found = [];
  // bun cache: ~/.bun/install/cache/@github/copilot@<ver>[@@@n]/index.js
  const bunDir = join(homedir(), '.bun/install/cache/@github');
  if (isDir(bunDir)) {
    for (const d of readdirSync(bunDir)) {
      if (!d.startsWith('copilot@')) continue;
      const file = join(bunDir, d, 'index.js');
      if (exists(file)) found.push({ file, version: d.slice('copilot@'.length) });
    }
  }
  // npm global: <npm root -g>/@github/copilot/index.js
  try {
    const ngr = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const file = join(ngr, '@github/copilot/index.js');
    if (exists(file)) {
      let version = 'npm-global';
      try { version = JSON.parse(readFileSync(join(ngr, '@github/copilot/package.json'), 'utf8')).version || version; } catch { /* ignore */ }
      found.push({ file, version });
    }
  } catch { /* npm not available */ }
  if (!found.length) return null;
  // highest version string wins (best-effort; the chosen version is always printed)
  found.sort((a, b) => (a.version < b.version ? 1 : -1));
  return found[0];
}

/** Require exactly one capture of `re` in `src`; fail closed otherwise. */
function extractOne(src, re, what) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const hits = [];
  let m;
  while ((m = g.exec(src)) !== null) hits.push(m[1]);
  if (hits.length !== 1) {
    console.error(`✗ --check-cli-schema: expected exactly 1 match for ${what} in the CLI bundle, found ${hits.length}.`);
    console.error(`  The CLI's frontmatter schema format changed — update the anchors and SKILL_LIMITS in scripts/validate.mjs.`);
    process.exit(1);
  }
  return hits[0];
}

function checkCliSchemaDrift() {
  const bundle = locateCopilotBundle(flagValue('--bundle'));
  if (!bundle) {
    console.log('ℹ --check-cli-schema: no installed @github/copilot bundle found — nothing to compare (expected in CI). Pass --bundle <path> to force.');
    process.exit(0);
  }
  const src = readFileSync(bundle.file, 'utf8');
  const descMax = Number(extractOne(src, /max\((\d+),"Skill description must be at most \d+ characters"\)/, 'description max'));
  const nameMax = Number(extractOne(src, /max\((\d+),"Skill name must be at most \d+ characters"\)/, 'name max'));
  const namePattern = extractOne(src, /(\/\^\[a-zA-Z0-9\]\[a-zA-Z0-9[^/]*\$\/)/, 'name regex').slice(1, -1);

  const diffs = [];
  if (descMax !== SKILL_LIMITS.descriptionMax) diffs.push(`descriptionMax: ours=${SKILL_LIMITS.descriptionMax} CLI=${descMax}`);
  if (nameMax !== SKILL_LIMITS.nameMax) diffs.push(`nameMax: ours=${SKILL_LIMITS.nameMax} CLI=${nameMax}`);
  if (namePattern !== SKILL_LIMITS.namePattern.source) diffs.push(`namePattern: ours=${SKILL_LIMITS.namePattern.source} CLI=${namePattern}`);

  console.log(`ℹ --check-cli-schema: compared against @github/copilot@${bundle.version}`);
  if (diffs.length) {
    console.error(`✗ --check-cli-schema: SKILL_LIMITS is stale — update scripts/validate.mjs:`);
    for (const d of diffs) console.error(`    • ${d}`);
    process.exit(1);
  }
  console.log('✅ --check-cli-schema: SKILL_LIMITS matches the installed CLI schema (descriptionMax, nameMax, namePattern).');
  process.exit(0);
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
      if (h.timeout != null && typeof h.timeout !== 'number') {
        err(`${pluginName}: ${rel} ${eventName}: "timeout" (alias for "timeoutSec") must be a number`);
      }
    }
  }
}

// ── Dispatch: optional CLI-schema drift check (exits) ────────────────────────
if (argv.includes('--check-cli-schema')) {
  checkCliSchemaDrift(); // exits
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
      else checkSkillFrontmatter(fm.fields, `${entry.name}/skills/${skillName}/SKILL.md`);
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
