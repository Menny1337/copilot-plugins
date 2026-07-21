#!/usr/bin/env node
/**
 * plugin-readme.mjs — generate a README.md for every plugin from its
 * frontmatter, mirroring catalog.mjs.
 *
 * Each plugin README has two parts:
 *   • a HAND-WRITTEN area (title, intro, Prerequisites) — authored by humans and
 *     preserved verbatim across regenerations;
 *   • a GENERATED block between
 *       <!-- mnm:plugin-readme:start --> / <!-- mnm:plugin-readme:end -->
 *     holding the install command and the contents table (agents/skills/hooks).
 *     This block is derived from SKILL.md / *.agent.md / hooks.json frontmatter —
 *     never hand-edit it.
 *
 * Plugin VERSION is intentionally omitted from the generated block so that a
 * version bump never makes a README stale (which would otherwise loop:
 * bump → README stale → edit → bump …).
 *
 * Modes:
 *   node scripts/plugin-readme.mjs            write/refresh every plugin README
 *   node scripts/plugin-readme.mjs --check    diff-only; exit 1 if any is stale
 *
 * Pure Node, zero deps — mirrors validate.mjs / catalog.mjs.
 */

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');

const BLOCK_START = '<!-- mnm:plugin-readme:start -->';
const BLOCK_END = '<!-- mnm:plugin-readme:end -->';

// ── helpers (shared shape with catalog.mjs) ──────────────────────────────────
function exists(p) { try { statSync(p); return true; } catch { return false; } }
function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function fail(msg) { console.error(`✗ plugin-readme.mjs: ${msg}`); process.exit(1); }

function readFrontmatter(path) {
  const raw = readFileSync(path, 'utf8');
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return null;
  const end = raw.indexOf('\n---', 4);
  if (end < 0) return null;
  const body = raw.slice(4, end);
  const out = {};
  const rel = relative(repoRoot, path);
  for (const line of body.split(/\r?\n/)) {
    if (!line || /^\s/.test(line)) continue;
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (/^[|>][+-]?\s*$/.test(val)) {
      fail(`${rel}: key "${m[1]}" uses a YAML block scalar (|/>); only single-line scalars are supported.`);
    }
    if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
        (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

function splitTriggers(desc) {
  if (!desc) return { lead: '', triggers: [] };
  const m = desc.match(/^(.*[.!?])\s+(?:Triggers|Keywords)\s*:\s*(.+?)\.?\s*$/is);
  if (!m) return { lead: desc.trim(), triggers: [] };
  const triggers = m[2].split(',').map(s => s.trim()).filter(Boolean);
  return { lead: m[1].trim(), triggers };
}

function shortLead(lead, max = 200) {
  const oneLine = lead.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  const cut = oneLine.slice(0, max);
  const lastDot = cut.lastIndexOf('. ');
  return (lastDot > max * 0.5 ? cut.slice(0, lastDot + 1) : cut.replace(/\s+\S*$/, '') + '…');
}

function tdEscape(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function badge(e) {
  const bits = [];
  if (e.hasScripts) bits.push('📜');
  if (e.hasReferences) bits.push('📚');
  if (e.userInvocable === false) bits.push('🔒');
  return bits.join(' ');
}

function tableHeader(cols) {
  return `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |`;
}

// ── collect one plugin's entities (paths relative to the plugin dir) ─────────
function collectPlugin(entry) {
  const dir = resolve(repoRoot, entry.source);
  if (!isDir(dir)) fail(`${entry.name}: source dir not found: ${entry.source}`);
  const relTo = (abs) => relative(dir, abs).replace(/\\/g, '/');

  const skills = [];
  const skillsDir = join(dir, 'skills');
  if (isDir(skillsDir)) {
    for (const skillName of readdirSync(skillsDir).sort()) {
      const skillDir = join(skillsDir, skillName);
      if (!isDir(skillDir)) continue;
      const skillMd = join(skillDir, 'SKILL.md');
      if (!exists(skillMd)) continue;
      const fm = readFrontmatter(skillMd);
      if (!fm || !fm.description) fail(`${entry.name}/skills/${skillName}/SKILL.md: bad/missing frontmatter`);
      const { lead, triggers } = splitTriggers(fm.description);
      skills.push({
        name: fm.name ?? skillName,
        lead, triggers,
        src: relTo(skillMd),
        userInvocable: fm['user-invocable'] === 'false' ? false : true,
        hasScripts: isDir(join(skillDir, 'scripts')),
        hasReferences: isDir(join(skillDir, 'references')),
      });
    }
  }

  const agents = [];
  const agentsDir = join(dir, 'agents');
  if (isDir(agentsDir)) {
    for (const f of readdirSync(agentsDir).sort()) {
      if (!f.endsWith('.agent.md')) continue;
      const agentMd = join(agentsDir, f);
      const fm = readFrontmatter(agentMd);
      if (!fm || !fm.description) fail(`${entry.name}/agents/${f}: bad/missing frontmatter`);
      const { lead, triggers } = splitTriggers(fm.description);
      agents.push({
        name: fm.name ?? f.replace(/\.agent\.md$/, ''),
        lead, triggers,
        src: relTo(agentMd),
        userInvocable: true, hasScripts: false, hasReferences: false,
      });
    }
  }

  const hooks = [];
  const pluginJson = readJson(join(dir, 'plugin.json'));
  if (pluginJson.hooks) {
    let hooksJsonPath = join(dir, pluginJson.hooks);
    if (isDir(hooksJsonPath)) hooksJsonPath = join(hooksJsonPath, 'hooks.json');
    if (exists(hooksJsonPath)) {
      const hj = readJson(hooksJsonPath);
      for (const [eventName, handlers] of Object.entries(hj.hooks ?? {})) {
        if (!Array.isArray(handlers)) continue;
        for (const h of handlers) {
          const type = h.type ?? 'command';
          const script = (h.bash || h.powershell || h.command || '').replace(/^\.\//, '');
          const timeout = h.timeoutSec ? ` (timeout ${h.timeoutSec}s)` : '';
          let descriptor, lead;
          if (type === 'http') {
            descriptor = h.url || 'http';
            lead = `On \`${eventName}\` POSTs to \`${h.url || '(no url)'}\`${timeout}.`;
          } else if (type === 'prompt') {
            const text = (h.prompt || '').replace(/\s+/g, ' ').trim();
            descriptor = 'prompt';
            lead = `On \`${eventName}\` auto-submits a prompt${text ? `: "${text.length > 60 ? text.slice(0, 57) + '…' : text}"` : ''}.`;
          } else {
            descriptor = script || 'command';
            lead = `On \`${eventName}\` runs \`${script || 'inline command'}\`${timeout}.`;
          }
          const scriptAbs = script ? join(dir, script) : null;
          hooks.push({
            name: `${eventName}: ${descriptor}`,
            lead, triggers: [],
            src: type === 'command' && scriptAbs && exists(scriptAbs) ? relTo(scriptAbs) : relTo(hooksJsonPath),
            userInvocable: true, hasScripts: false, hasReferences: false,
          });
        }
      }
    }
  }

  return { name: entry.name, description: entry.description ?? '', skills, agents, hooks };
}

// ── render the generated block ───────────────────────────────────────────────
function entityRows(list, { triggers = false } = {}) {
  const cols = triggers ? ['Name', 'Description', 'Triggers / Keywords'] : ['Name', 'Description'];
  const rows = list.map(e => {
    const flags = badge(e);
    const nameCell = `[\`${tdEscape(e.name)}\`](${e.src})${flags ? ' ' + flags : ''}`;
    const base = [nameCell, tdEscape(shortLead(e.lead))];
    if (triggers) base.push(e.triggers.length ? tdEscape(e.triggers.join(', ')) : '—');
    return `| ${base.join(' | ')} |`;
  });
  return `${tableHeader(cols)}\n${rows.join('\n')}`;
}

function renderBlock(p) {
  const stats = [
    p.agents.length ? `**${p.agents.length}** agent${p.agents.length > 1 ? 's' : ''}` : null,
    p.skills.length ? `**${p.skills.length}** skill${p.skills.length > 1 ? 's' : ''}` : null,
    p.hooks.length ? `**${p.hooks.length}** hook${p.hooks.length > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ') || '_no agents, skills, or hooks_';

  const lines = [
    BLOCK_START,
    '<!-- generated by scripts/plugin-readme.mjs — do not edit by hand -->',
    '',
    `## Contents — ${stats}`,
    '',
    '> **Legend.** 📜 ships scripts · 📚 ships references · 🔒 `user-invocable: false`',
  ];

  if (p.agents.length) {
    lines.push('', '### Agents', '', entityRows(p.agents, { triggers: true }));
  }
  if (p.skills.length) {
    lines.push('', '### Skills', '', entityRows(p.skills, { triggers: true }));
  }
  if (p.hooks.length) {
    lines.push('', '### Hooks', '', entityRows(p.hooks));
  }

  lines.push(
    '',
    '## Install',
    '',
    'Add the marketplace once, then install this plugin:',
    '',
    '```bash',
    'copilot plugin marketplace add Menny1337/copilot-plugins',
    `copilot plugin install ${p.name}@menny1337-plugins`,
    '```',
    '',
    `Update later with \`copilot plugin update ${p.name}@menny1337-plugins\` (or \`plugins-update\` to refresh everything). ` +
      'See the [repository README](../../README.md) for per-session Agency profiles, aliases, and global-install options.',
    '',
    BLOCK_END,
  );
  return lines.join('\n');
}

// ── scaffold the hand-written part for a brand-new README ────────────────────
function scaffold(p, block) {
  const { lead } = splitTriggers(p.description);
  return [
    `# \`${p.name}\``,
    '',
    lead || p.description || `The \`${p.name}\` plugin.`,
    '',
    '## Prerequisites',
    '',
    '- The [GitHub Copilot CLI](https://github.com/github/copilot-cli) (or Agency).',
    '- This marketplace added to your CLI (see **Install** below).',
    '',
    'No other external tools or credentials are required.',
    '',
    block,
    '',
  ].join('\n');
}

// ── inject the block into an existing README, preserving hand-written text ────
function injectBlock(text, block, pluginName) {
  const s = text.indexOf(BLOCK_START);
  const e = text.indexOf(BLOCK_END);
  if ((s < 0) !== (e < 0)) {
    fail(`${pluginName}/README.md has exactly one generated marker; fix it (add the missing one or remove both) and re-run.`);
  }
  if (s >= 0 && e <= s) {
    fail(`${pluginName}/README.md generated markers are inverted; fix manually.`);
  }
  if (s >= 0 && e > s) {
    return text.slice(0, s) + block + text.slice(e + BLOCK_END.length);
  }
  // Markers absent — append the block at the end, preserving existing prose.
  return text.replace(/\n*$/, '\n\n') + block + '\n';
}

// ── drive ────────────────────────────────────────────────────────────────────
const marketplace = readJson(resolve(repoRoot, '.github/plugin/marketplace.json'));
if (!Array.isArray(marketplace.plugins)) fail('marketplace.json missing "plugins" array');

const stale = [];
let written = 0;

for (const entry of marketplace.plugins) {
  const p = collectPlugin(entry);
  const block = renderBlock(p);
  const readmePath = resolve(repoRoot, entry.source, 'README.md');
  const old = exists(readmePath) ? readFileSync(readmePath, 'utf8') : null;
  const next = old == null ? scaffold(p, block) : injectBlock(old, block, p.name);

  if (CHECK) {
    if (old == null) stale.push(`${entry.name}/README.md is missing`);
    else if (old !== next) stale.push(`${entry.name}/README.md generated block is stale`);
  } else if (old !== next) {
    writeFileSync(readmePath, next);
    written++;
  }
}

if (CHECK) {
  if (stale.length) {
    for (const s of stale) console.error(`✗ ${s}`);
    console.error('\nRun `node scripts/plugin-readme.mjs` to regenerate.');
    process.exit(1);
  }
  console.log(`✅ plugin-readme.mjs: all ${marketplace.plugins.length} plugin READMEs are fresh`);
  process.exit(0);
}

console.log(`✅ plugin-readme.mjs: ${written} README(s) written/updated (${marketplace.plugins.length} plugins)`);
