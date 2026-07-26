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
 *   9. No agent-name collisions across plugins (skill-name collisions warn only —
 *      Copilot CLI 1.0.66+ disambiguates same-named plugin skills via invocationName)
 *  10. Every plugin.json with a "hooks" field points to an existing hooks JSON
 *      FILE (e.g. "hooks/hooks.json", not a directory — a dir throws EISDIR at
 *      load time), and that hooks.json has a valid schema (version, known event
 *      names, valid hook types, required fields per type, https for
 *      permission-granting events)
 *
 * Usage:
 *   node scripts/validate.mjs                  # full marketplace validation (CI)
 *   node scripts/validate.mjs --check-cli-schema [--copilot <path>]
 *                                              # probe the installed Copilot CLI
 *                                              # with boundary skills to confirm
 *                                              # SKILL_LIMITS still matches what
 *                                              # it enforces (fails closed)
 * Exits 0 on success, 1 on any failure.
 */

import { readFileSync, statSync, readdirSync, lstatSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

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
// SOURCE OF TRUTH: the Copilot CLI itself. As of CLI 1.0.75 these constants are
// NOT statically scrapable — they moved out of the JS bundle into the native
// `prebuilds/<platform>/runtime.node`, where the messages are assembled from
// fragments at runtime. So we verify them BEHAVIOURALLY instead: run
// `node scripts/validate.mjs --check-cli-schema` and it feeds the installed CLI
// purpose-built probe skills that sit exactly on, and one past, each boundary,
// then asserts the CLI accepted/rejected each one as we predict. It fails loudly
// on any mismatch and never rewrites anything.
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
// Optional, local-only check: confirm SKILL_LIMITS above still matches what the
// installed Copilot CLI actually enforces.
//
// This is a BEHAVIOURAL probe, not a string scrape. It writes throwaway skills
// into a temp project — one sitting exactly on each limit (must load) and one
// sitting just past it (must be rejected) — then runs `copilot skill list --json`
// there and checks the CLI's own verdict. That survives minification, bundling,
// and the constants moving into the native runtime, which is what broke the
// previous string-anchor approach at CLI 1.0.75.
//
// It NEVER rewrites anything, and it FAILS CLOSED:
//   • CLI present + a boundary behaves unexpectedly → exit 1 (update SKILL_LIMITS)
//   • CLI present + probe could not be run/parsed   → exit 1 (unverified is not OK)
//   • no `copilot` on PATH                          → exit 0 (nothing to check;
//                                                     expected in CI)
// Point at a specific binary with `--copilot <path>`.

const PROBE_PREFIX = 'zzprobe';

/** Locate the Copilot CLI executable. Returns {bin, version} or null. */
function locateCopilotCli(override) {
  const bin = override || 'copilot';
  if (override && !exists(override)) {
    console.error(`✗ --copilot path not found: ${override}`);
    process.exit(1);
  }
  try {
    // spawnSync (no shell) — `execSync` would run `bin` through /bin/sh, so a
    // path like `$(...)` passed to --copilot would be evaluated as a command.
    const res = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 60_000 });
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error(`exited with status ${res.status}`);
    const version = ((res.stdout || '').match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/) || [])[0];
    return { bin, version: version || 'unknown' };
  } catch (e) {
    // An explicitly requested binary that cannot be run is a hard failure —
    // silently reporting "nothing to check" would be a false green.
    if (override) {
      console.error(`✗ --check-cli-schema: \`${override} --version\` failed: ${e.message.split('\n')[0]}`);
      console.error('  Refusing to report success without a verified comparison.');
      process.exit(1);
    }
    return null;
  }
}

/**
 * Probe cases. `name`/`description` are fed to the CLI verbatim; `shouldLoad`
 * is what SKILL_LIMITS predicts. Any disagreement means our constants are stale.
 */
function buildProbeCases() {
  const { descriptionMax, nameMax } = SKILL_LIMITS;
  const okName = `${PROBE_PREFIX}-desc`;
  return [
    { dir: 'desc-at',   name: okName,                                   description: 'x'.repeat(descriptionMax),     shouldLoad: true,  what: `description of exactly ${descriptionMax} chars` },
    { dir: 'desc-over', name: `${PROBE_PREFIX}-desc-over`,              description: 'x'.repeat(descriptionMax + 1), shouldLoad: false, what: `description of ${descriptionMax + 1} chars` },
    { dir: 'name-at',   name: PROBE_PREFIX + 'a'.repeat(nameMax - PROBE_PREFIX.length),     description: 'probe', shouldLoad: true,  what: `name of exactly ${nameMax} chars` },
    { dir: 'name-over', name: PROBE_PREFIX + 'a'.repeat(nameMax - PROBE_PREFIX.length + 1), description: 'probe', shouldLoad: false, what: `name of ${nameMax + 1} chars` },
    { dir: 'name-lead', name: `-${PROBE_PREFIX}`,                       description: 'probe', shouldLoad: false, what: 'name with a leading hyphen' },
    { dir: 'name-char', name: `${PROBE_PREFIX}/slash`,                  description: 'probe', shouldLoad: false, what: 'name containing a slash' },
  ];
}

/**
 * Pull the first well-formed JSON array out of `text`, ignoring surrounding
 * noise (update notices, warnings) that may itself contain brackets. Scans
 * candidate `[` positions and bracket-matches with string/escape awareness,
 * so a banner like `[Notice] ...` can't swallow the real payload.
 */
function extractJsonArray(text) {
  for (let start = text.indexOf('['); start !== -1; start = text.indexOf('[', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(start, i + 1));
            if (Array.isArray(parsed)) return parsed;
          } catch { /* not this candidate */ }
          break;
        }
      }
    }
  }
  return null;
}

function checkCliSchemaDrift() {
  const cli = locateCopilotCli(flagValue('--copilot'));
  if (!cli) {
    console.log('ℹ --check-cli-schema: no runnable `copilot` CLI found — nothing to probe (expected in CI). Pass --copilot <path> to force.');
    process.exit(0);
  }

  const cases = buildProbeCases();

  // Sanity-check the probe itself: every case must agree with SKILL_LIMITS
  // locally, otherwise a green run would prove nothing.
  for (const c of cases) {
    const localOk = c.name.length <= SKILL_LIMITS.nameMax
      && SKILL_LIMITS.namePattern.test(c.name)
      && c.description.length <= SKILL_LIMITS.descriptionMax;
    if (localOk !== c.shouldLoad) {
      console.error(`✗ --check-cli-schema: internal probe error — case "${c.dir}" (${c.what}) contradicts SKILL_LIMITS. Fix buildProbeCases().`);
      process.exit(1);
    }
  }

  const tmp = mkdtempSync(join(tmpdir(), 'cli-schema-'));
  let stdout = '';
  let stderr = '';
  try {
    for (const c of cases) {
      const d = join(tmp, '.github', 'skills', c.dir);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'SKILL.md'), `---\nname: ${c.name}\ndescription: ${c.description}\n---\n\nThrowaway probe skill.\n`);
    }
    const res = spawnSync(cli.bin, ['skill', 'list', '--json', '--no-auto-update'], {
      cwd: tmp, encoding: 'utf8', timeout: 180_000,
    });
    if (res.error) {
      console.error(`✗ --check-cli-schema: could not run \`${cli.bin} skill list --json\`: ${res.error.message}`);
      console.error('  Refusing to report success without a verified comparison.');
      // process.exit() skips `finally`, so clean up before bailing.
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
      process.exit(1);
    }
    stdout = res.stdout || '';
    stderr = res.stderr || '';
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  // `skill list --json` prints the JSON array on stdout; skills the CLI refused
  // are reported separately on stderr.
  const listed = extractJsonArray(stdout);
  if (!listed) {
    console.error('✗ --check-cli-schema: could not parse `copilot skill list --json` output.');
    console.error('  The CLI changed its output format — update checkCliSchemaDrift() in scripts/validate.mjs.');
    console.error(`  First 400 chars of stdout: ${JSON.stringify(stdout.slice(0, 400))}`);
    process.exit(1);
  }
  const loaded = new Set(listed.filter((s) => s && s.source === 'project').map((s) => s.name));

  const diffs = [];
  for (const c of cases) {
    const didLoad = loaded.has(c.name);
    if (didLoad === c.shouldLoad) continue;
    diffs.push(c.shouldLoad
      ? `we predict a ${c.what} is VALID, but the CLI rejected it`
      : `we predict a ${c.what} is INVALID, but the CLI accepted it`);
  }

  console.log(`ℹ --check-cli-schema: probed Copilot CLI ${cli.version} with ${cases.length} boundary skills`);
  if (diffs.length) {
    console.error('✗ --check-cli-schema: SKILL_LIMITS is stale — update scripts/validate.mjs:');
    for (const d of diffs) console.error(`    • ${d}`);
    const reported = stderr.split('\n').filter((l) => l.includes(PROBE_PREFIX) || /must be at most|must start with/.test(l));
    if (reported.length) {
      console.error('  The CLI reported:');
      for (const l of reported) console.error(`    ${l.trim()}`);
    }
    process.exit(1);
  }
  console.log(`✅ --check-cli-schema: SKILL_LIMITS matches the installed CLI (descriptionMax=${SKILL_LIMITS.descriptionMax}, nameMax=${SKILL_LIMITS.nameMax}, namePattern=${SKILL_LIMITS.namePattern.source}).`);
  process.exit(0);
}

// ── Hook schema validation ───────────────────────────────────────────────────
const HOOK_EVENTS = new Set([
  // camelCase — the CLI's canonical event enum (verified against the 1.0.75
  // native runtime's contiguous event-name cluster).
  'sessionStart', 'sessionEnd', 'userPromptSubmitted', 'userPromptTransformed',
  'preToolUse', 'preMcpToolCall', 'postToolUse', 'postToolUseFailure',
  'errorOccurred', 'agentStop', 'subagentStart', 'subagentStop',
  'preCompact', 'permissionRequest', 'notification',
  // Claude-format aliases. NOT a mechanical PascalCase of the above:
  // `userPromptSubmitted` maps to `UserPromptSubmit` and `agentStop` to `Stop`,
  // while `userPromptTransformed` and `preMcpToolCall` have no alias.
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
// Copilot CLI 1.0.66 lets same-named skills from different plugins coexist, disambiguating
// them via invocationName — so a cross-plugin skill collision is a clarity problem, not a
// load failure. Agent names still have to be unique.
for (const [name, owners] of skillIndex) {
  if (owners.length > 1) warn(`Skill name collision: "${name}" defined in plugins ${owners.join(', ')} — the CLI disambiguates via invocationName, but duplicate names are ambiguous for users. Prefer distinct names.`);
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
