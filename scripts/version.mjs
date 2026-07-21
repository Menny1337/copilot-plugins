#!/usr/bin/env node
/**
 * version.mjs — versioning & release governance for the marketplace.
 *
 * The repo versions content at two granularities:
 *   • each plugin is independently semver'd (plugin.json ⇄ marketplace entry)
 *   • the marketplace itself has a release version (marketplace.json metadata.version)
 *
 * Bump policy (this repo's markdown IS the product, so every content change is
 * releasable — there is no "no-release" commit type):
 *   • breaking  (`type!:` or a `BREAKING CHANGE:` footer) → major
 *   • feat                                                → minor
 *   • anything else (fix, docs, refactor, chore, …)       → patch
 *
 * Subcommands:
 *   plan   [--base <ref>] [--head <ref>]   read-only report of required bumps
 *   check  [--base <ref>] [--head <ref>]   CI guard (ci-hard); exit 1 if a plugin's
 *                                          source changed without a sufficient bump,
 *                                          a CHANGELOG section, or a marketplace bump
 *   apply  [--base <ref>] [--set p=lvl…]   write computed bumps into plugin.json,
 *          [--allow-dirty]                 marketplace.json, and per-plugin CHANGELOG
 *   tags   [--json] [--all]                list release tags for current versions
 *                                          (missing only by default; --all includes existing)
 *   notes  --tag <tag>                      print release notes for a tag (from CHANGELOG)
 *
 * Base/head resolution:
 *   --base defaults to merge-base(HEAD, origin/main); --head defaults to HEAD.
 *   In PR CI pass the explicit SHAs:
 *     --base ${{ github.event.pull_request.base.sha }}
 *     --head ${{ github.event.pull_request.head.sha }}
 *
 * Pure Node, zero deps — mirrors validate.mjs / catalog.mjs.
 * Exits 0 on success; check/apply exit 1 on failure.
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const MARKETPLACE_REL = '.github/plugin/marketplace.json';

// ── arg parsing ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'plan';
function flag(name) { return argv.includes(`--${name}`); }
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
function opts(name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === `--${name}` && argv[i + 1]) out.push(argv[i + 1]);
  return out;
}

// ── git + fs helpers ─────────────────────────────────────────────────────────
function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], // capture stderr so probes don't leak `fatal:` noise
    });
  } catch (e) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${(e.stderr || e.message).toString().trim()}`);
  }
}
function exists(p) { try { statSync(p); return true; } catch { return false; } }
function readJsonFile(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function readJsonAtRef(ref, relPath) {
  const out = git(['show', `${ref}:${relPath}`], { allowFail: true });
  if (out == null) return null;
  try { return JSON.parse(out); } catch { return null; }
}
function fileAtRef(ref, relPath) {
  return git(['show', `${ref}:${relPath}`], { allowFail: true });
}

// ── semver ───────────────────────────────────────────────────────────────────
const LEVEL = { none: 0, patch: 1, minor: 2, major: 3 };
const LEVEL_NAME = ['none', 'patch', 'minor', 'major'];

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function cmpSemver(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
/** Level of the increase from base→head, or 'none' if equal, or 'invalid' if head<base. */
function bumpLevel(base, head) {
  const a = parseSemver(base), b = parseSemver(head);
  if (!a || !b) return 'invalid';
  const c = cmpSemver(a, b);
  if (c === 0) return 'none';
  if (c > 0) return 'invalid'; // went backwards
  if (b[0] !== a[0]) return 'major';
  if (b[1] !== a[1]) return 'minor';
  return 'patch';
}
function applyBump(version, level) {
  const [x, y, z] = parseSemver(version);
  if (level === 'major') return `${x + 1}.0.0`;
  if (level === 'minor') return `${x}.${y + 1}.0`;
  if (level === 'patch') return `${x}.${y}.${z + 1}`;
  return version;
}

// ── conventional commits ─────────────────────────────────────────────────────
const REC = '\x1e'; // record separator
const UNIT = '\x1f'; // unit separator

/** Highest bump level implied by a single commit (subject + body). */
function levelFromCommit(subject, body) {
  const text = `${subject}\n${body}`;
  if (/^[a-z]+(\([^)]*\))?!:/i.test(subject) || /\bBREAKING[ -]CHANGE:/.test(text)) return 'major';
  if (/^feat(\([^)]*\))?:/i.test(subject)) return 'minor';
  return 'patch';
}

/** Highest bump level across all (non-merge) commits in base..head touching `pathPrefix`. */
function requiredLevelForPath(base, head, pathPrefix) {
  const raw = git([
    'log', '--no-merges', `--format=%s${UNIT}%b${REC}`, `${base}..${head}`, '--', pathPrefix,
  ], { allowFail: true });
  if (!raw) return 'none';
  let max = 'none';
  for (const rec of raw.split(REC)) {
    const trimmed = rec.replace(/^\n+/, '');
    if (!trimmed.trim()) continue;
    const [subject = '', body = ''] = trimmed.split(UNIT);
    const lvl = levelFromCommit(subject.trim(), body);
    if (LEVEL[lvl] > LEVEL[max]) max = lvl;
  }
  return max;
}

/** Commit subjects (non-merge) in base..head touching `pathPrefix`, newest first. */
function commitSubjects(base, head, pathPrefix) {
  const raw = git(['log', '--no-merges', '--format=%s', `${base}..${head}`, '--', pathPrefix], { allowFail: true });
  if (!raw) return [];
  return raw.split('\n').map(s => s.trim()).filter(Boolean);
}

// ── changed-file detection ───────────────────────────────────────────────────
function changedFiles(base, head) {
  const raw = git(['diff', '--name-only', `${base}...${head}`], { allowFail: true });
  if (raw == null) return [];
  return raw.split('\n').map(s => s.trim()).filter(Boolean);
}
/** True if the plugin dir has a real (non-CHANGELOG) content diff between refs. */
function pluginContentChanged(base, head, sourceRel) {
  const raw = git([
    'diff', '--name-only', `${base}...${head}`, '--',
    sourceRel + '/', `:(exclude)${sourceRel}/CHANGELOG.md`,
  ], { allowFail: true });
  return !!(raw && raw.split('\n').some(l => l.trim()));
}

// ── base/head resolution ─────────────────────────────────────────────────────
function resolveRefs() {
  const head = opt('head', 'HEAD');
  let base = opt('base', null);
  if (!base) {
    const mb = git(['merge-base', head, 'origin/main'], { allowFail: true })
      || git(['merge-base', head, 'main'], { allowFail: true });
    base = mb ? mb.trim() : git(['rev-parse', `${head}~1`], { allowFail: true })?.trim();
  }
  if (!base) {
    console.error('✗ version.mjs: could not resolve a base ref (pass --base <ref>).');
    process.exit(2);
  }
  return { base: base.trim(), head };
}

// ── changelog helpers ────────────────────────────────────────────────────────
/** Does the changelog text contain a populated section for `version`? */
function changelogHasVersion(text, version) {
  if (!text) return false;
  const lines = text.split(/\r?\n/);
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`^##\\s+\\[?${esc}\\]?(\\s|$|\\])`);
  for (let i = 0; i < lines.length; i++) {
    if (head.test(lines[i])) {
      // require at least one bullet before the next "## " heading
      for (let j = i + 1; j < lines.length; j++) {
        if (/^##\s/.test(lines[j])) break;
        if (/^\s*[-*]\s+\S/.test(lines[j])) return true;
      }
      return false;
    }
  }
  return false;
}

const CHANGELOG_HEADER = [
  '# Changelog',
  '',
  'All notable changes to this plugin are documented here.',
  'Format follows [Keep a Changelog](https://keepachangelog.com/); this project adheres to [Semantic Versioning](https://semver.org/).',
  '',
].join('\n');

function today() { return new Date().toISOString().slice(0, 10); }

function renderChangelogSection(version, level, subjects) {
  const bullets = subjects.length ? subjects : ['Maintenance changes.'];
  return [
    `## [${version}] - ${today()}`,
    '',
    `_${level} release._`,
    '',
    ...bullets.map(s => `- ${s}`),
    '',
  ].join('\n');
}

// ── load current marketplace + plugins ───────────────────────────────────────
function loadPlugins() {
  const marketplace = readJsonFile(resolve(repoRoot, MARKETPLACE_REL));
  const plugins = (marketplace.plugins ?? []).map(entry => {
    const sourceRel = entry.source.replace(/^\.\//, '').replace(/\/$/, '');
    const dir = resolve(repoRoot, sourceRel);
    const pluginJsonRel = `${sourceRel}/plugin.json`;
    const changelogRel = `${sourceRel}/CHANGELOG.md`;
    let pluginJson = null;
    if (exists(join(dir, 'plugin.json'))) pluginJson = readJsonFile(join(dir, 'plugin.json'));
    return { entry, name: entry.name, sourceRel, dir, pluginJsonRel, changelogRel, pluginJson };
  });
  return { marketplace, plugins };
}

// ── analysis core (shared by plan/check) ─────────────────────────────────────
function analyze(base, head) {
  const { marketplace, plugins } = loadPlugins();
  const baseMarketplace = readJsonAtRef(base, MARKETPLACE_REL);
  const baseEntries = new Map((baseMarketplace?.plugins ?? []).map(e => [e.name, e]));

  const results = [];
  for (const p of plugins) {
    const baseEntry = baseEntries.get(p.name) ?? null;
    const basePluginJson = readJsonAtRef(base, p.pluginJsonRel);
    const isNew = basePluginJson == null;

    const contentChanged = pluginContentChanged(base, head, p.sourceRel);
    const descChanged = !!baseEntry && baseEntry.description !== p.entry.description;
    const changed = isNew || contentChanged || descChanged;

    const headVersion = p.entry.version;
    const baseVersion = basePluginJson?.version ?? null;
    const requiredLevel = changed
      ? (isNew ? 'patch' : maxLevel('patch', requiredLevelForPath(base, head, p.sourceRel)))
      : 'none';
    const actualLevel = isNew ? 'minor' : bumpLevel(baseVersion, headVersion);

    results.push({
      name: p.name, sourceRel: p.sourceRel, changelogRel: p.changelogRel,
      isNew, changed, contentChanged, descChanged,
      baseVersion, headVersion, requiredLevel, actualLevel, plugin: p,
    });
  }

  const currentNames = new Set(plugins.map(p => p.name));
  for (const [name, baseEntry] of baseEntries) {
    if (currentNames.has(name)) continue;
    const sourceRel = String(baseEntry.source ?? '').replace(/^\.\//, '').replace(/\/$/, '');
    const basePluginJson = sourceRel ? readJsonAtRef(base, `${sourceRel}/plugin.json`) : null;
    results.push({
      name,
      sourceRel,
      changelogRel: sourceRel ? `${sourceRel}/CHANGELOG.md` : '',
      isNew: false,
      isRemoved: true,
      changed: true,
      contentChanged: false,
      descChanged: false,
      baseVersion: basePluginJson?.version ?? baseEntry.version ?? null,
      headVersion: null,
      requiredLevel: 'major',
      actualLevel: 'none',
      plugin: null,
    });
  }

  const baseMeta = baseMarketplace?.metadata?.version ?? null;
  const headMeta = marketplace.metadata?.version ?? null;
  return { results, marketplace, baseMeta, headMeta };
}
function maxLevel(a, b) { return LEVEL[a] >= LEVEL[b] ? a : b; }

// ── command: plan ────────────────────────────────────────────────────────────
function cmdPlan() {
  const { base, head } = resolveRefs();
  const { results, baseMeta, headMeta } = analyze(base, head);
  console.log(`version plan — base ${short(base)} … head ${short(head)}\n`);
  const changed = results.filter(r => r.changed);
  if (!changed.length) {
    console.log('No plugin source changes detected. No version bumps required.');
  } else {
    for (const r of changed) {
      if (r.isRemoved) {
        console.log(`  ${pad(r.name, 22)} ${pad(r.baseVersion ?? '(unknown)', 8)} → removed (needs marketplace major)`);
        continue;
      }
      const from = r.isNew ? '(new)' : r.baseVersion;
      console.log(
        `  ${pad(r.name, 22)} ${pad(from, 8)} → needs ≥ ${pad(r.requiredLevel, 6)}` +
        ` (current ${r.headVersion}, applied bump: ${r.actualLevel})`,
      );
    }
    const maxReq = changed.reduce((m, r) => maxLevel(m, r.requiredLevel), 'none');
    console.log(`\n  marketplace metadata.version: ${baseMeta ?? '(none)'} → needs ≥ ${maxReq} (current ${headMeta})`);
  }
  process.exit(0);
}

// ── command: check ───────────────────────────────────────────────────────────
function cmdCheck() {
  const { base, head } = resolveRefs();
  const { results, baseMeta, headMeta } = analyze(base, head);
  const errors = [];
  let anyBumped = false;
  let maxRequired = 'none';

  for (const r of results) {
    if (!r.changed) continue;
    maxRequired = maxLevel(maxRequired, r.requiredLevel);

    if (r.isRemoved) {
      anyBumped = true;
      continue;
    }

    if (r.isNew) {
      if (!parseSemver(r.headVersion)) {
        errors.push(`${r.name}: new plugin has invalid version "${r.headVersion}" (want X.Y.Z).`);
      }
      const cl = readFileText(r.changelogRel);
      if (!changelogHasVersion(cl, r.headVersion)) {
        errors.push(`${r.name}: new plugin missing a populated CHANGELOG.md section for ${r.headVersion}.`);
      }
      anyBumped = true;
      continue;
    }

    if (r.actualLevel === 'invalid') {
      errors.push(`${r.name}: version went backwards or is malformed (${r.baseVersion} → ${r.headVersion}).`);
      continue;
    }
    if (r.actualLevel === 'none') {
      errors.push(
        `${r.name}: source changed but version was not bumped (still ${r.headVersion}). ` +
        `Bump plugin.json + marketplace entry to at least a ${r.requiredLevel} and add a CHANGELOG entry ` +
        `(\`node scripts/version.mjs apply\`).`,
      );
      continue;
    }
    anyBumped = true;
    if (LEVEL[r.actualLevel] < LEVEL[r.requiredLevel]) {
      errors.push(
        `${r.name}: bump too small — commits imply a ${r.requiredLevel} but version moved only ${r.actualLevel} ` +
        `(${r.baseVersion} → ${r.headVersion}).`,
      );
    }
    const cl = readFileText(r.changelogRel);
    if (!changelogHasVersion(cl, r.headVersion)) {
      errors.push(`${r.name}: CHANGELOG.md is missing a populated section for ${r.headVersion}.`);
    }
  }

  if (anyBumped) {
    const metaLevel = bumpLevel(baseMeta, headMeta);
    if (baseMeta == null) {
      // first-ever marketplace metadata baseline — accept any valid version
      if (!parseSemver(headMeta)) errors.push(`marketplace metadata.version invalid: "${headMeta}".`);
    } else if (metaLevel === 'invalid') {
      errors.push(`marketplace metadata.version went backwards or is malformed (${baseMeta} → ${headMeta}).`);
    } else if (metaLevel === 'none') {
      errors.push(
        `marketplace metadata.version not bumped (still ${headMeta}) even though a plugin was released. ` +
        `Bump it to at least a ${maxRequired}.`,
      );
    } else if (LEVEL[metaLevel] < LEVEL[maxRequired]) {
      errors.push(
        `marketplace metadata.version bump too small — plugins imply ${maxRequired} but it moved only ${metaLevel} ` +
        `(${baseMeta} → ${headMeta}).`,
      );
    }
  }

  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    console.error(`\n❌ version check: ${errors.length} problem(s). base ${short(base)} … head ${short(head)}`);
    process.exit(1);
  }
  const n = results.filter(r => r.changed).length;
  console.log(`✅ version check: ${n} plugin(s) changed and correctly versioned (base ${short(base)} … head ${short(head)}).`);
  process.exit(0);
}

function readFileText(relPath) {
  const p = resolve(repoRoot, relPath);
  return exists(p) ? readFileSync(p, 'utf8') : '';
}

// ── command: apply ───────────────────────────────────────────────────────────
function cmdApply() {
  const dirty = git(['status', '--porcelain'], { allowFail: true })?.trim();
  if (dirty && !flag('allow-dirty')) {
    console.error('✗ version.mjs apply: working tree is dirty. Commit/stash first, or pass --allow-dirty.');
    process.exit(1);
  }
  const { base, head } = resolveRefs();
  const { results } = analyze(base, head);

  const overrides = new Map();
  for (const s of opts('set')) {
    const m = /^([^=]+)=(major|minor|patch)$/.exec(s.trim());
    if (!m) { console.error(`✗ bad --set "${s}" (want plugin=major|minor|patch).`); process.exit(1); }
    overrides.set(m[1], m[2]);
  }

  const { marketplace, plugins } = loadPlugins();
  const marketplacePath = resolve(repoRoot, MARKETPLACE_REL);
  const byName = new Map(plugins.map(p => [p.name, p]));
  let maxApplied = 'none';
  const touched = [];

  for (const r of results) {
    const override = overrides.get(r.name);
    if (!r.changed && !override) continue;
    if (r.isRemoved) {
      maxApplied = maxLevel(maxApplied, 'major');
      touched.push(`${r.name} → removed (major)`);
      continue;
    }
    const level = override ?? (r.requiredLevel === 'none' ? 'patch' : r.requiredLevel);
    const p = byName.get(r.name);
    const current = p.pluginJson.version;
    // Skip if already bumped past base by ≥ required level.
    if (!override && !r.isNew && LEVEL[bumpLevel(r.baseVersion, current)] >= LEVEL[level]) {
      continue;
    }
    const fromForBump = (!r.isNew && r.baseVersion) ? r.baseVersion : current;
    const newVersion = applyBump(fromForBump, level);
    maxApplied = maxLevel(maxApplied, level);

    // plugin.json
    p.pluginJson.version = newVersion;
    writeFileSync(join(p.dir, 'plugin.json'), JSON.stringify(p.pluginJson, null, 2) + '\n');
    // marketplace entry
    const entry = marketplace.plugins.find(e => e.name === r.name);
    entry.version = newVersion;
    // changelog
    const subjects = commitSubjects(base, head, r.sourceRel);
    const clPath = resolve(repoRoot, r.changelogRel);
    const existing = exists(clPath) ? readFileSync(clPath, 'utf8') : CHANGELOG_HEADER;
    const section = renderChangelogSection(newVersion, level, subjects);
    writeFileSync(clPath, insertChangelogSection(existing, section));
    touched.push(`${r.name} → ${newVersion} (${level})`);
  }

  if (!touched.length) {
    console.log('Nothing to apply — no changed plugins needed a bump.');
    process.exit(0);
  }

  // marketplace metadata.version
  marketplace.metadata = marketplace.metadata ?? {};
  marketplace.metadata.version = applyBump(marketplace.metadata.version ?? '0.0.0', maxApplied);
  writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n');

  console.log('Applied version bumps:');
  for (const t of touched) console.log(`  • ${t}`);
  console.log(`  • marketplace metadata.version → ${marketplace.metadata.version} (${maxApplied})`);
  console.log('\nNext: review the diff, then `node scripts/catalog.mjs` (descriptions/versions may affect the catalog) and `node scripts/validate.mjs`.');
  process.exit(0);
}

function insertChangelogSection(existing, section) {
  const idx = existing.indexOf('\n## ');
  if (idx < 0) {
    const base = existing.endsWith('\n') ? existing : existing + '\n';
    return `${base}\n${section}`;
  }
  return existing.slice(0, idx + 1) + section + '\n' + existing.slice(idx + 1);
}

// ── command: tags ────────────────────────────────────────────────────────────
function cmdTags() {
  const { marketplace, plugins } = loadPlugins();
  const wanted = [];
  const meta = marketplace.metadata?.version;
  if (meta) wanted.push({ tag: `v${meta}`, kind: 'marketplace', name: marketplace.name ?? 'marketplace', version: meta });
  for (const p of plugins) {
    if (p.pluginJson?.version) {
      wanted.push({ tag: `${p.name}-v${p.pluginJson.version}`, kind: 'plugin', name: p.name, version: p.pluginJson.version });
    }
  }
  const missing = wanted.filter(w => git(['rev-parse', '-q', '--verify', `refs/tags/${w.tag}`], { allowFail: true }) == null);
  const selected = flag('all') ? wanted : missing;
  if (flag('json')) {
    process.stdout.write(JSON.stringify(selected) + '\n');
  } else if (!selected.length) {
    console.log('All release tags already exist.');
  } else {
    console.log(flag('all') ? 'Release tags:' : 'Missing release tags:');
    for (const m of selected) console.log(`  ${m.tag}\t(${m.kind} ${m.name} ${m.version})`);
  }
  process.exit(0);
}

// ── command: notes ───────────────────────────────────────────────────────────
/** Extract the body of a changelog section for `version` (without the heading). */
function changelogSection(text, version) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`^##\\s+\\[?${esc}\\]?(\\s|$|\\])`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (head.test(lines[i])) { start = i + 1; break; }
  }
  if (start < 0) return '';
  const out = [];
  for (let j = start; j < lines.length; j++) {
    if (/^##\s/.test(lines[j])) break;
    out.push(lines[j]);
  }
  return out.join('\n').trim();
}

function textAtTag(tag, path) {
  try {
    return execFileSync('git', ['show', `${tag}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function cmdNotes() {
  const tag = opt('tag', null);
  if (!tag) { console.error('✗ notes: pass --tag <tag>'); process.exit(2); }
  const { marketplace, plugins } = loadPlugins();

  const pluginMatch = tag.match(/^(.+)-v(\d+\.\d+\.\d+)$/);
  if (pluginMatch) {
    const [, name, version] = pluginMatch;
    const p = plugins.find(pl => pl.name === name);
    const historical = textAtTag(tag, `plugins/${name}/CHANGELOG.md`);
    const body = changelogSection(historical || (p ? readFileText(p.changelogRel) : ''), version);
    process.stdout.write(`${name} ${version}\n\n${body || '_No changelog entry._'}\n`);
    process.exit(0);
  }
  const metaMatch = tag.match(/^v(\d+\.\d+\.\d+)$/);
  if (metaMatch) {
    const version = metaMatch[1];
    const historical = textAtTag(tag, '.github/plugin/marketplace.json');
    let releasedPlugins = plugins
      .filter(p => p.pluginJson?.version)
      .map(p => ({ name: p.name, version: p.pluginJson.version }));
    if (historical) {
      try {
        const released = JSON.parse(historical);
        releasedPlugins = (released.plugins ?? []).map(p => ({
          name: p.name,
          version: p.version,
        }));
      } catch {
        console.error(`✗ notes: invalid marketplace manifest at tag "${tag}"`);
        process.exit(2);
      }
    }
    const rows = releasedPlugins.map(p => `- \`${p.name}\` ${p.version}`);
    process.stdout.write(
      `${marketplace.name ?? 'marketplace'} ${version}\n\n` +
      `Marketplace release. Plugin versions in this release:\n\n${rows.join('\n')}\n`,
    );
    process.exit(0);
  }
  console.error(`✗ notes: unrecognized tag "${tag}"`);
  process.exit(2);
}

// ── misc ─────────────────────────────────────────────────────────────────────
function short(ref) { return /^[0-9a-f]{7,40}$/i.test(ref) ? ref.slice(0, 7) : ref; }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

// ── dispatch ─────────────────────────────────────────────────────────────────
switch (cmd) {
  case 'plan': cmdPlan(); break;
  case 'check': cmdCheck(); break;
  case 'apply': cmdApply(); break;
  case 'tags': cmdTags(); break;
  case 'notes': cmdNotes(); break;
  default:
    console.error(`Unknown command "${cmd}". Use: plan | check | apply | tags | notes`);
    process.exit(2);
}
