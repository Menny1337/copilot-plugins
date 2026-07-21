#!/usr/bin/env node
/**
 * catalog.mjs — generate CATALOG.md (and a README summary block) from the
 * frontmatter of every SKILL.md / *.agent.md and every hooks/hooks.json across
 * all plugins listed in .github/plugin/marketplace.json.
 *
 * The source files (SKILL.md, *.agent.md, hooks.json) remain the only source
 * of truth; CATALOG.md is purely derived. Re-run after adding or editing any
 * skill, agent, or hook.
 *
 * Modes:
 *   node scripts/catalog.mjs            write CATALOG.md and update README.md
 *   node scripts/catalog.mjs --check    diff-only; exit 1 if stale (CI mode)
 *   node scripts/catalog.mjs --stdout   render CATALOG.md to stdout, no writes
 *
 * Pure Node, zero deps — mirrors validate.mjs.
 */

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const STDOUT = args.has('--stdout');
if (CHECK && STDOUT) fail('--check and --stdout are mutually exclusive');

const README_START = '<!-- mnm:catalog:start -->';
const README_END = '<!-- mnm:catalog:end -->';

// ── small helpers ───────────────────────────────────────────────────────────
function exists(p) { try { statSync(p); return true; } catch { return false; } }
function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function fail(msg) { console.error(`✗ catalog.mjs: ${msg}`); process.exit(1); }

/**
 * Parse YAML-ish frontmatter into a flat key→string map. Supports:
 *   key: value
 *   key: "quoted value"
 *   key: 'quoted value'
 * Indented continuation lines (list items, nested maps) are ignored — we only
 * need top-level scalar fields (name, description, user-invocable).
 */
function readFrontmatter(path) {
  const raw = readFileSync(path, 'utf8');
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return null;
  const end = raw.indexOf('\n---', 4);
  if (end < 0) return null;
  const body = raw.slice(4, end);
  const out = {};
  const rel = relative(repoRoot, path);
  for (const line of body.split(/\r?\n/)) {
    if (!line || /^\s/.test(line)) continue; // skip blanks + indented lines
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    // refuse YAML block scalar markers (>, |, |-, >-) — generator only
    // supports single-line scalar values; otherwise downstream rendering is
    // silently wrong.
    if (/^[|>][+-]?\s*$/.test(val)) {
      fail(`${rel}: key "${m[1]}" uses a YAML block scalar (|/>); only single-line scalars are supported by the catalog generator.`);
    }
    // strip a single matching pair of outer quotes
    if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
        (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

/**
 * Pull a "Triggers: a, b, c." or "Keywords: a, b, c." trailer out of a
 * description. Returns { lead, triggers } where `lead` is the description
 * with the trailer stripped and `triggers` is the comma-separated list (or
 * empty array if absent).
 */
function splitTriggers(desc) {
  if (!desc) return { lead: '', triggers: [] };
  // Anchor on a sentence boundary (".", "!", "?") immediately before the
  // trailer keyword so prose words like "fixes trigger-related bugs" don't
  // accidentally get parsed as a trailer. The trailer must end the string.
  const m = desc.match(/^(.*[.!?])\s+(?:Triggers|Keywords)\s*:\s*(.+?)\.?\s*$/is);
  if (!m) return { lead: desc.trim(), triggers: [] };
  const triggers = m[2].split(',').map(s => s.trim()).filter(Boolean);
  return { lead: m[1].trim(), triggers };
}

/** Compress a multi-line/long lead into a single short summary cell. */
function shortLead(lead, max = 180) {
  const oneLine = lead.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  // cut at last sentence boundary before max, else hard cut
  const cut = oneLine.slice(0, max);
  const lastDot = cut.lastIndexOf('. ');
  return (lastDot > max * 0.5 ? cut.slice(0, lastDot + 1) : cut.replace(/\s+\S*$/, '') + '…');
}

/** Markdown-table-cell-safe escaping: pipes and newlines. */
function tdEscape(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function badge(entry) {
  const bits = [];
  if (entry.hasScripts) bits.push('📜');
  if (entry.hasReferences) bits.push('📚');
  if (entry.userInvocable === false) bits.push('🔒');
  return bits.join(' ');
}

// ── 1. Walk the marketplace ─────────────────────────────────────────────────
const marketplacePath = resolve(repoRoot, '.github/plugin/marketplace.json');
if (!exists(marketplacePath)) fail('Missing .github/plugin/marketplace.json');
const marketplace = readJson(marketplacePath);
if (!Array.isArray(marketplace.plugins)) fail('marketplace.json missing "plugins" array');

const plugins = []; // { name, description, dir, sourceRel, agents, skills, hooks }

for (const entry of marketplace.plugins) {
  const dir = resolve(repoRoot, entry.source);
  if (!isDir(dir)) fail(`${entry.name}: source dir not found: ${entry.source}`);
  const sourceRel = relative(repoRoot, dir).replace(/\\/g, '/');

  const plugin = {
    name: entry.name,
    description: entry.description ?? '',
    sourceRel,
    agents: [],
    skills: [],
    hooks: [],
  };

  // Skills
  const skillsDir = join(dir, 'skills');
  if (isDir(skillsDir)) {
    for (const skillName of readdirSync(skillsDir).sort()) {
      const skillDir = join(skillsDir, skillName);
      if (!isDir(skillDir)) continue;
      const skillMd = join(skillDir, 'SKILL.md');
      if (!exists(skillMd)) continue;
      const fm = readFrontmatter(skillMd);
      if (!fm) fail(`${entry.name}/skills/${skillName}/SKILL.md: bad/missing frontmatter`);
      if (!fm.description) fail(`${entry.name}/skills/${skillName}/SKILL.md: missing "description" in frontmatter`);
      const { lead, triggers } = splitTriggers(fm.description);
      plugin.skills.push({
        type: 'skill',
        name: fm.name ?? skillName,
        plugin: entry.name,
        lead,
        triggers,
        sourceRel: relative(repoRoot, skillMd).replace(/\\/g, '/'),
        userInvocable: fm['user-invocable'] === 'false' ? false : true,
        hasScripts: isDir(join(skillDir, 'scripts')),
        hasReferences: isDir(join(skillDir, 'references')),
      });
    }
  }

  // Agents
  const agentsDir = join(dir, 'agents');
  if (isDir(agentsDir)) {
    for (const f of readdirSync(agentsDir).sort()) {
      if (!f.endsWith('.agent.md')) continue;
      const agentMd = join(agentsDir, f);
      const fm = readFrontmatter(agentMd);
      if (!fm) fail(`${entry.name}/agents/${f}: bad/missing frontmatter`);
      if (!fm.description) fail(`${entry.name}/agents/${f}: missing "description" in frontmatter`);
      const { lead, triggers } = splitTriggers(fm.description);
      plugin.agents.push({
        type: 'agent',
        name: fm.name ?? f.replace(/\.agent\.md$/, ''),
        plugin: entry.name,
        lead,
        triggers,
        sourceRel: relative(repoRoot, agentMd).replace(/\\/g, '/'),
        userInvocable: true, // agents are launched explicitly
        hasScripts: false,
        hasReferences: false,
      });
    }
  }

  // Hooks. plugin.json "hooks" references the hooks JSON file (e.g.
  // "hooks/hooks.json"); tolerate a bare directory for robustness.
  const pluginJson = readJson(join(dir, 'plugin.json'));
  if (pluginJson.hooks) {
    let hooksJsonPath = join(dir, pluginJson.hooks);
    if (isDir(hooksJsonPath)) hooksJsonPath = join(hooksJsonPath, 'hooks.json');
    if (exists(hooksJsonPath)) {
      let hj;
      try { hj = readJson(hooksJsonPath); }
      catch (e) { fail(`${entry.name}/hooks/hooks.json: ${e.message}`); }
      const events = hj.hooks ?? {};
      for (const [eventName, handlers] of Object.entries(events)) {
        if (!Array.isArray(handlers)) continue;
        for (const h of handlers) {
          const type = h.type ?? 'command';
          // Pick a script reference for the source link (prefer bash, then powershell)
          const script = h.bash || h.powershell || h.command || '';
          const cleaned = script.replace(/^\.\//, '');
          const scriptPath = cleaned ? join(dir, cleaned) : null;
          const timeout = h.timeoutSec ? ` (timeout ${h.timeoutSec}s)` : '';

          let descriptor, lead;
          if (type === 'http') {
            descriptor = h.url || 'http';
            lead = `On \`${eventName}\` POSTs to \`${h.url || '(no url)'}\`${timeout}.`;
          } else if (type === 'prompt') {
            const text = (h.prompt || '').replace(/\s+/g, ' ').trim();
            const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
            descriptor = 'prompt';
            lead = `On \`${eventName}\` auto-submits a prompt${short ? `: "${short}"` : ''}.`;
          } else {
            descriptor = cleaned || 'command';
            lead = `On \`${eventName}\` runs \`${cleaned || 'inline command'}\`${timeout}.`;
          }

          plugin.hooks.push({
            type: 'hook',
            name: `${eventName}: ${descriptor}`,
            plugin: entry.name,
            lead,
            triggers: [],
            sourceRel: type === 'command' && scriptPath && exists(scriptPath)
              ? relative(repoRoot, scriptPath).replace(/\\/g, '/')
              : relative(repoRoot, hooksJsonPath).replace(/\\/g, '/'),
            userInvocable: true,
            hasScripts: false,
            hasReferences: false,
          });
        }
      }
    }
  }

  plugins.push(plugin);
}

// ── 2. Aggregate flat lists ─────────────────────────────────────────────────
const allAgents = plugins.flatMap(p => p.agents).sort((a, b) => a.name.localeCompare(b.name));
const allSkills = plugins.flatMap(p => p.skills).sort((a, b) => a.name.localeCompare(b.name));
const allHooks  = plugins.flatMap(p => p.hooks).sort((a, b) =>
  a.plugin.localeCompare(b.plugin) || a.name.localeCompare(b.name)
);
const flatAll = [...allAgents, ...allSkills, ...allHooks]
  .sort((a, b) => a.name.localeCompare(b.name));

// ── 3. Render markdown ──────────────────────────────────────────────────────
function tableHeader(cols) {
  return `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |`;
}

function rowEntity(e, opts = {}) {
  const includeType = opts.includeType !== false;
  const includePlugin = opts.includePlugin !== false;
  const includeTriggers = !!opts.includeTriggers;
  const nameCell = `[\`${tdEscape(e.name)}\`](${e.sourceRel})`;
  const flags = badge(e);
  const nameWithFlags = flags ? `${nameCell} ${flags}` : nameCell;
  const cols = [nameWithFlags];
  if (includeType) cols.push(e.type);
  if (includePlugin) cols.push(`\`${tdEscape(e.plugin)}\``);
  cols.push(tdEscape(shortLead(e.lead)));
  if (includeTriggers) {
    cols.push(e.triggers.length ? tdEscape(e.triggers.join(', ')) : '—');
  }
  return `| ${cols.join(' | ')} |`;
}

function renderQuickIndex() {
  const header = tableHeader(['Name', 'Type', 'Plugin', 'Description']);
  const rows = flatAll.map(e => rowEntity(e, { includePlugin: true }));
  return `## Quick index\n\nFlat alphabetical lookup. Click a name to jump to its source file.\n\n${header}\n${rows.join('\n')}`;
}

function renderByPlugin() {
  const sections = [];
  for (const p of plugins) {
    const subBlock = (label, list) => {
      if (!list.length) return null;
      const header = tableHeader(['Name', 'Description', 'Triggers / Keywords']);
      const rows = list.map(e => rowEntity(e, {
        includeType: false,
        includePlugin: false,
        includeTriggers: true,
      }));
      return `**${label}**\n\n${header}\n${rows.join('\n')}`;
    };
    const blocks = ['Agents', 'Skills', 'Hooks']
      .map(label => subBlock(label, p[label.toLowerCase()]))
      .filter(b => b !== null);
    const parts = [
      `### \`${p.name}\``,
      '',
      p.description,
      '',
      `_Source: [\`${p.sourceRel}/\`](${p.sourceRel}/)_`,
      '',
      blocks.join('\n\n'),
    ];
    sections.push(parts.join('\n'));
  }
  return `## By plugin\n\n${sections.join('\n\n')}`;
}

function renderByType() {
  const block = (label, list) => {
    if (!list.length) return `### ${label}\n\n_None._\n`;
    const header = tableHeader(['Name', 'Plugin', 'Description', 'Triggers / Keywords']);
    const rows = list.map(e => rowEntity(e, {
      includeType: false,
      includePlugin: true,
      includeTriggers: true,
    }));
    return `### ${label}\n\n${header}\n${rows.join('\n')}`;
  };
  return [
    '## By type',
    '',
    block('Agents', allAgents),
    '',
    block('Skills', allSkills),
    '',
    block('Hooks', allHooks),
  ].join('\n');
}

function renderCatalog() {
  const stats =
    `**${plugins.length}** plugins · ` +
    `**${allAgents.length}** agents · ` +
    `**${allSkills.length}** skills · ` +
    `**${allHooks.length}** hooks`;

  const legend =
    '> **Legend.** 📜 = ships scripts · 📚 = ships references · 🔒 = `user-invocable: false`';

  return [
    '<!-- GENERATED FILE — do not edit by hand. Run `node scripts/catalog.mjs` to regenerate. -->',
    '',
    '# Catalog',
    '',
    `${stats}`,
    '',
    'A single index of every agent, skill, and hook across all plugins in this marketplace. ' +
      'Source files (`SKILL.md`, `*.agent.md`, `hooks.json`) remain the only source of truth — ' +
      'this catalog is regenerated from their frontmatter by `scripts/catalog.mjs`.',
    '',
    legend,
    '',
    renderQuickIndex(),
    '',
    renderByPlugin(),
    '',
    renderByType(),
    '',
  ].join('\n');
}

function renderReadmeBlock() {
  const stats =
    `**${plugins.length}** plugins · ` +
    `**${allAgents.length}** agents · ` +
    `**${allSkills.length}** skills · ` +
    `**${allHooks.length}** hooks`;
  const lines = [
    README_START,
    '<!-- generated by scripts/catalog.mjs — do not edit by hand -->',
    '',
    `### 📇 Catalog at a glance — ${stats}`,
    '',
    'See [**`CATALOG.md`**](./CATALOG.md) for the full index (by-plugin, by-type, and flat alphabetical views).',
    '',
    '<details><summary>Quick alphabetical index</summary>',
    '',
    tableHeader(['Name', 'Type', 'Plugin', 'Description']),
    ...flatAll.map(e => rowEntity(e, { includePlugin: true })),
    '',
    '</details>',
    '',
    README_END,
  ];
  return lines.join('\n');
}

// ── 4. Inject README block ──────────────────────────────────────────────────
function applyReadmeBlock(readmeText, block) {
  const startIdx = readmeText.indexOf(README_START);
  const endIdx = readmeText.indexOf(README_END);
  // Guard: refuse to write if exactly one marker is present, or they're
  // out of order. A partial human edit shouldn't silently duplicate the
  // block or destroy README content between mismatched markers.
  if ((startIdx < 0) !== (endIdx < 0)) {
    fail('README.md has exactly one catalog marker; either add the missing one or delete both, then re-run.');
  }
  if (startIdx >= 0 && endIdx <= startIdx) {
    fail('README.md catalog markers are inverted (end appears before start); fix manually before re-running.');
  }
  if (startIdx >= 0 && endIdx > startIdx) {
    return readmeText.slice(0, startIdx) + block + readmeText.slice(endIdx + README_END.length);
  }
  // Markers absent — insert just after the "## Plugins" section's table.
  // The section ends at the next "## " heading.
  const pluginsHeadingIdx = readmeText.indexOf('\n## Plugins\n');
  if (pluginsHeadingIdx < 0) {
    console.warn('⚠ README.md has no "## Plugins" heading — appending catalog block at end of file.');
    return readmeText.replace(/\n*$/, '\n\n') + block + '\n';
  }
  const after = readmeText.indexOf('\n## ', pluginsHeadingIdx + 1);
  const insertAt = after < 0 ? readmeText.length : after;
  const pad = readmeText[insertAt - 1] === '\n' ? '' : '\n';
  return readmeText.slice(0, insertAt) + pad + '\n' + block + '\n' + readmeText.slice(insertAt);
}

// ── 5. Drive the chosen mode ────────────────────────────────────────────────
const catalogPath = resolve(repoRoot, 'CATALOG.md');
const readmePath = resolve(repoRoot, 'README.md');

const newCatalog = renderCatalog();
const newReadmeBlock = renderReadmeBlock();

if (STDOUT) {
  process.stdout.write(newCatalog);
  process.exit(0);
}

const oldCatalog = exists(catalogPath) ? readFileSync(catalogPath, 'utf8') : '';
const oldReadme = exists(readmePath) ? readFileSync(readmePath, 'utf8') : '';
const newReadme = applyReadmeBlock(oldReadme, newReadmeBlock);

if (CHECK) {
  const issues = [];
  if (oldCatalog !== newCatalog) issues.push('CATALOG.md is stale');
  if (oldReadme !== newReadme) issues.push('README.md catalog block is stale or missing');
  if (issues.length) {
    for (const i of issues) console.error(`✗ ${i}`);
    console.error('\nRun `node scripts/catalog.mjs` to regenerate.');
    process.exit(1);
  }
  console.log(`✅ catalog.mjs: catalog is fresh (${plugins.length} plugins, ${allAgents.length} agents, ${allSkills.length} skills, ${allHooks.length} hooks)`);
  process.exit(0);
}

writeFileSync(catalogPath, newCatalog);
writeFileSync(readmePath, newReadme);
console.log(`✅ catalog.mjs: wrote CATALOG.md and updated README.md (${plugins.length} plugins, ${allAgents.length} agents, ${allSkills.length} skills, ${allHooks.length} hooks)`);
