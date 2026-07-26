/**
 * lib.mjs — shared helpers, paths, and contracts for the scheduled-skill-review
 * daemon. Zero-dependency ES module; imported by the other *.mjs scripts.
 *
 * All durable state lives under the workspace:
 *   ~/.copilot/agent-architect/skill-reviews/
 *     config.json            control + tuning (see DEFAULT_CONFIG)
 *     state.json             { watermark, lastRun, selfMarker }
 *     cycles.json            [ cycle, ... ]  durable lifecycle records
 *     lock                   scheduler lock dir (mkdir = atomic acquire)
 *     runs/<runId>/manifest.json | results/<unit>.json | digest.md
 *     latest-digest.md       copy of the most recent digest
 *     logs/daemon.log
 *
 * Paths that touch ~/.copilot/{skills,agents}/ are intentionally absent — the
 * repo validator bans them. We only use ~/.copilot/agent-architect/,
 * ~/.copilot/session-state/, and the configured plugin directory
 * (`config.pluginDir`, defaulting to the plugin that ships these scripts).
 */

import { homedir } from 'node:os';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync,
  realpathSync, rmSync, statSync,
} from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOME = homedir();
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGIN_DIR = resolve(SCRIPT_DIR, '..', '..', '..');

/** Expand a leading ~ to the user's home directory. */
export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return join(HOME, p.slice(2));
  return p;
}

export const WORKSPACE = join(HOME, '.copilot', 'agent-architect', 'skill-reviews');

export const PATHS = {
  workspace: WORKSPACE,
  config: join(WORKSPACE, 'config.json'),
  state: join(WORKSPACE, 'state.json'),
  cycles: join(WORKSPACE, 'cycles.json'),
  lock: join(WORKSPACE, 'lock'),
  runs: join(WORKSPACE, 'runs'),
  logs: join(WORKSPACE, 'logs'),
  latestDigest: join(WORKSPACE, 'latest-digest.md'),
  daemonLog: join(WORKSPACE, 'logs', 'daemon.log'),
};

/** Default configuration. Written to config.json on first run if absent. */
export const DEFAULT_CONFIG = {
  enabled: true,
  // schedule.weekdays restricts which days the launchd agent fires (1=Mon..5=Fri;
  // empty = every day). It must mirror the plist's StartCalendarInterval; it only
  // informs the menu-bar "next run" estimate (launchd itself owns the real trigger).
  schedule: { hour: 3, minute: 0, weekdays: [] },
  concurrency: 2,
  autoDeploy: true,       // master switch. false = deploy NOTHING (leave proposal
                          // branches only). When true, each unit integrates per its
                          // resolved policy below. Gates BOTH auto-merge and PRs.
  autoRevert: true,
  // Per-unit integration policy. Resolution (see `lifecycle.mjs policy --unit U`):
  //   prUnits ∋ u → 'pr'  ·  else autoMergeUnits ∋ u → 'auto'  ·  else deployMode.
  //   'auto' = merge→push→plugin refresh (fully autonomous, goes live immediately).
  //   'pr'   = push the proposal branch + open a GitHub PR for human review; the
  //            change goes live only when YOU merge it (CI validates; the daemon
  //            reconciles the merge on its next run and starts the re-review window).
  deployMode: 'auto',
  autoMergeUnits: [],     // units forced to 'auto' regardless of deployMode
  prUnits: [],            // units forced to 'pr' regardless of deployMode
  // Regression-reverts restore a known-good state and are safety-critical, so by
  // default they fast-path via auto-merge even for pr-mode units. Set to 'unit' to
  // make reverts follow the unit's policy, or 'pr' to always route reverts to a PR.
  revertDeployMode: 'auto', // 'auto' | 'pr' | 'unit'
  include: [],            // if non-empty, ONLY these units are eligible
  exclude: [],            // these units are always skipped
  skillPaths: [],         // external SKILL.md files reviewed in place
  skillFolders: [],       // folders containing one or more external skills
  signalThreshold: 3,     // min relevant sessions to open a new cycle
  observationWindowDays: 3, // post-deploy wait before Phase E re-review
  firstRunLookbackDays: 7,
  maxFirstRunSessions: 200,
  // Absolute path to the git working tree the daemon commits/pushes from.
  // MUST be set for autoDeploy to work (the cache copy is read-only/derived).
  repoDir: '',
  // Local plugin root passed to `agency copilot --plugin local:<path>`.
  // Defaults to the plugin containing these scripts, avoiding marketplace-cache
  // or checkout names baked into the code.
  pluginDir: DEFAULT_PLUGIN_DIR,
  // Optional Copilot marketplace alias to refresh before updating its installed plugins.
  // Registered GitHub marketplaces use system Git so private-repo helpers still work.
  // Leave empty to run the legacy `copilot plugin update --all` behavior.
  marketplaceName: '',
  sessionStateDir: join(HOME, '.copilot', 'session-state'),
  // Marker embedded in review subprocess prompts so we can exclude our own
  // sessions from future scans (don't review the reviewer).
  selfMarker: 'COPILOT_PLUGIN_SCHEDULED_REVIEW',
  branchPrefix: 'skill-review',
  defaultBranch: 'main',
  remoteName: 'origin',
  // gh CLI account that owns the repo (e.g. a personal account). gh keeps ONE
  // global active account independent of git's credentials, so if another
  // account is active, `gh pr create`/reconcile fail with "Could not resolve to
  // a Repository" while `git push` still works. Empty = derive the owner from
  // the remote URL; set this to force a specific gh account for PR/reconcile.
  ghAccount: '',
  notify: 'auto',         // auto | none
};

export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
  return p;
}

export function readJson(path, fallback = undefined) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Atomic JSON write (temp file + rename) so concurrent readers never see a torn file. */
export function writeJson(path, obj) {
  ensureDir(resolve(path, '..'));
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, path);
}

export function loadConfig() {
  const cfg = readJson(PATHS.config);
  if (!cfg) return { ...DEFAULT_CONFIG };
  // shallow-merge defaults so new keys appear without losing user overrides
  const merged = { ...DEFAULT_CONFIG, ...cfg, schedule: { ...DEFAULT_CONFIG.schedule, ...(cfg.schedule || {}) } };
  // Backward compatibility for older config files that used cacheDir as the
  // source of the local plugin path.
  if (!cfg.pluginDir && cfg.cacheDir) merged.pluginDir = join(expandHome(cfg.cacheDir), 'plugins', 'meta');
  if (!merged.pluginDir) merged.pluginDir = DEFAULT_PLUGIN_DIR;
  return merged;
}

export function saveConfig(cfg) { writeJson(PATHS.config, cfg); }

export function loadState() {
  return readJson(PATHS.state, { watermark: null, lastRun: null });
}
export function saveState(s) { writeJson(PATHS.state, s); }

export function loadCycles() {
  return readJson(PATHS.cycles, []);
}
export function saveCycles(c) { writeJson(PATHS.cycles, c); }

/** Synchronous sleep (no busy-wait) used by withLock's acquire backoff. */
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms)); } catch { /* noop */ }
}

/**
 * Serialize a read-modify-write critical section across the short-lived
 * lifecycle.mjs CLI processes that the orchestrator spawns concurrently.
 *
 * Without this, parallel `open`/`set`/`ingest-result` invocations each do
 * loadCycles()→mutate→saveCycles() with no coordination, so concurrent writers
 * clobber one another (lost updates). The caller MUST perform BOTH the load and
 * the save inside `fn` so the whole critical section is covered by the lock.
 *
 * Lock = an atomic `mkdir` of `<workspace>/<name>.lock` holding an owner token.
 * A stale lock (older than staleMs — i.e. a crashed/hung holder) is stolen.
 * Release only removes the dir if WE still own the token, so a process whose
 * lock was stolen can never delete the new owner's lock.
 */
export function withLock(fn, { name = 'cycles', staleMs = 15000, timeoutMs = 20000, retryMs = 50 } = {}) {
  const dir = join(WORKSPACE, `${name}.lock`);
  const ownerFile = join(dir, 'owner.json');
  const token = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + timeoutMs;
  let held = false;
  while (!held) {
    try {
      mkdirSync(dir);
      writeFileSync(ownerFile, JSON.stringify({ token, pid: process.pid, at: Date.now() }));
      held = true;
    } catch {
      let owner = null;
      try { owner = JSON.parse(readFileSync(ownerFile, 'utf8')); } catch { /* mid-acquire or torn */ }
      let age = staleMs + 1;
      if (owner && typeof owner.at === 'number') age = Date.now() - owner.at;
      else { try { age = Date.now() - statSync(dir).mtimeMs; } catch { age = staleMs + 1; } }
      if (age > staleMs || Date.now() > deadline) {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* lost the steal race; retry */ }
        continue;
      }
      sleepSync(retryMs);
    }
  }
  try {
    return fn();
  } finally {
    let mine = false;
    try { mine = JSON.parse(readFileSync(ownerFile, 'utf8')).token === token; } catch { /* unreadable */ }
    if (mine) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } }
  }
}

export function nowIso() { return new Date().toISOString(); }

export function newRunId(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Sanitize a unit name for use in a git branch / filesystem path. */
export function safeName(name) {
  return String(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unit';
}

/** Read a skill's scalar `name` frontmatter value without a YAML dependency. */
export function readSkillName(skillPath) {
  let raw;
  try { raw = readFileSync(skillPath, 'utf8'); } catch { return ''; }
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return '';
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') break;
    const match = line.match(/^name:\s*(.+?)\s*$/);
    if (!match) continue;
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value.trim();
  }
  return '';
}

export function isValidSkillName(name) {
  return typeof name === 'string' &&
    name.length >= 1 &&
    name.length <= 64 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

/**
 * Enumerate reviewable units with their source paths. Marketplace units are
 * discovered from the configured repo; external skills come from `skillPaths`
 * plus `skillFolders` (the folder itself and its immediate child folders).
 */
export function enumerateUnitEntries(repoDir, skillPaths = [], skillFolders = []) {
  const entries = [];
  const resolvedRepo = repoDir ? resolve(expandHome(repoDir)) : '';
  const mp = resolvedRepo
    ? readJson(join(resolvedRepo, '.github', 'plugin', 'marketplace.json'))
    : null;

  if (mp && Array.isArray(mp.plugins)) {
    for (const plugin of mp.plugins) {
      if (!plugin.source) continue;
      const pdir = resolve(resolvedRepo, plugin.source);
      const sdir = join(pdir, 'skills');
      if (existsSync(sdir)) {
        for (const name of readdirSync(sdir)) {
          const skillPath = join(sdir, name, 'SKILL.md');
          if (!existsSync(skillPath)) continue;
          entries.push({
            name,
            type: 'skill',
            path: skillPath,
            source: 'marketplace',
            plugin: plugin.name || '',
            exists: true,
          });
        }
      }
      const adir = join(pdir, 'agents');
      if (existsSync(adir)) {
        for (const file of readdirSync(adir)) {
          if (!file.endsWith('.agent.md')) continue;
          entries.push({
            name: file.replace(/\.agent\.md$/, ''),
            type: 'agent',
            path: join(adir, file),
            source: 'marketplace',
            plugin: plugin.name || '',
            exists: true,
          });
        }
      }
    }
  }

  const addExternalSkill = (configuredPath, sourceKind, sourceRoot) => {
    if (typeof configuredPath !== 'string' || !configuredPath.trim()) return;
    const requestedPath = resolve(expandHome(configuredPath.trim()));
    let skillPath = requestedPath;
    let isFile = false;
    try {
      isFile = statSync(requestedPath).isFile();
      if (isFile) skillPath = realpathSync(requestedPath);
    } catch {}
    const declaredName = readSkillName(skillPath);
    const name = declaredName || basename(dirname(skillPath));
    entries.push({
      name,
      type: 'skill',
      path: skillPath,
      source: 'external',
      sourceKind,
      sourceRoot,
      plugin: '',
      exists: isFile && basename(skillPath) === 'SKILL.md' && isValidSkillName(declaredName),
    });
  };

  for (const configuredPath of skillPaths || []) {
    if (typeof configuredPath !== 'string' || !configuredPath.trim()) continue;
    const skillPath = resolve(expandHome(configuredPath.trim()));
    addExternalSkill(skillPath, 'file', skillPath);
  }

  for (const configuredFolder of skillFolders || []) {
    if (typeof configuredFolder !== 'string' || !configuredFolder.trim()) continue;
    const folderPath = resolve(expandHome(configuredFolder.trim()));
    let isDirectory = false;
    try { isDirectory = statSync(folderPath).isDirectory(); } catch {}
    if (!isDirectory) continue;

    const candidates = new Set();
    const directSkill = join(folderPath, 'SKILL.md');
    if (existsSync(directSkill)) candidates.add(directSkill);
    let children = [];
    try { children = readdirSync(folderPath); } catch {}
    for (const child of children) {
      const childDirectory = join(folderPath, child);
      try {
        if (!statSync(childDirectory).isDirectory()) continue;
      } catch {
        continue;
      }
      const childSkill = join(childDirectory, 'SKILL.md');
      if (existsSync(childSkill)) candidates.add(childSkill);
    }
    for (const skillPath of candidates) {
      addExternalSkill(skillPath, 'folder', folderPath);
    }
  }

  const uniqueEntries = [];
  const seenPaths = new Set();
  for (const entry of entries) {
    const key = `${entry.type}:${entry.path}`;
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    uniqueEntries.push(entry);
  }

  uniqueEntries.sort((a, b) =>
    a.type.localeCompare(b.type) ||
    a.name.localeCompare(b.name) ||
    a.source.localeCompare(b.source) ||
    a.path.localeCompare(b.path)
  );

  const nameCounts = new Map();
  for (const entry of uniqueEntries) {
    const key = entry.name;
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  return uniqueEntries.map((entry) => {
    const key = entry.name;
    return { ...entry, conflict: nameCounts.get(key) > 1 };
  });
}

/**
 * Enumerate unit names used by session scanning. The returned `entries` retain
 * paths so the orchestrator can distinguish marketplace and external skills.
 */
export function enumerateUnits(repoDir, skillPaths = [], skillFolders = []) {
  const skills = new Set();
  const agents = new Set();
  const entries = enumerateUnitEntries(repoDir, skillPaths, skillFolders);
  for (const entry of entries) {
    if (!entry.name || !entry.exists || entry.conflict) continue;
    if (entry.type === 'skill') skills.add(entry.name);
    if (entry.type === 'agent') agents.add(entry.name);
  }
  return { skills, agents, entries };
}

/** Strip a plugin prefix from an agentName (meta:agent-architect → agent-architect). */
export function bareAgentName(agentName) {
  if (!agentName) return agentName;
  const i = agentName.indexOf(':');
  return i >= 0 ? agentName.slice(i + 1) : agentName;
}

/**
 * Compare two watermark points {timestamp, session_id, line}. Returns <0, 0, >0.
 * Ordering is by timestamp, then session_id, then line — a total order that lets
 * us resume mid-session without reprocessing already-seen events.
 */
export function cmpWatermark(a, b) {
  if (!a) return -1;
  if (!b) return 1;
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  const sa = a.session_id || '', sb = b.session_id || '';
  if (sa !== sb) return sa < sb ? -1 : 1;
  return (a.line || 0) - (b.line || 0);
}

/** Result JSON schema id written by each per-unit review subprocess. */
export const RESULT_SCHEMA = 'skill-review-result/1';

/** Validate a per-unit result object against the strict schema. Returns string[] of problems. */
export function validateResult(r) {
  const problems = [];
  if (!r || typeof r !== 'object') return ['result is not an object'];
  if (r.schema !== RESULT_SCHEMA) problems.push(`schema must be "${RESULT_SCHEMA}"`);
  if (!r.unit) problems.push('missing unit');
  if (!['skill', 'agent'].includes(r.unitType)) problems.push('unitType must be skill|agent');
  const actions = ['patched', 'no-change', 're-review', 'revert', 'failed'];
  if (!actions.includes(r.action)) problems.push(`action must be one of ${actions.join('|')}`);
  return problems;
}
