#!/usr/bin/env node
/**
 * scan-usage.mjs — read-only scan of Copilot session event logs to find which of
 * OUR plugin skills and agents were used since the last watermark, plus weak
 * candidate signals (user corrections, tool errors).
 *
 * Authoritative source: ~/.copilot/session-state/<id>/events.jsonl
 *   - skill.invoked            data.name              → skill usage (direct)
 *   - subagent.selected/started data.agentName        → agent usage (direct)
 *   - user.message             data.content           → correction candidates
 *   - tool.execution_complete  data.success===false   → tool-error candidates
 *
 * Watermark is EVENT-TIME {timestamp, session_id, line} — not session-created
 * time — because long-lived sessions append events long after they start.
 *
 * Self-exclusion: sessions whose text contains the configured selfMarker are the
 * daemon's own review subprocesses and are skipped (don't review the reviewer).
 *
 * Usage:
 *   node scan-usage.mjs [--out manifest.json] [--repo <dir>] [--since <iso>]
 * Emits the manifest to stdout (and --out if given). Never writes session state.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadConfig, loadState, enumerateUnits, bareAgentName, cmpWatermark,
  expandHome, writeJson, nowIso,
} from './lib.mjs';

const args = process.argv.slice(2);
function arg(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; }

const cfg = loadConfig();
const state = loadState();
const repoDir = arg('--repo') || expandHome(cfg.repoDir);
const outPath = arg('--out');
const sessionDir = expandHome(cfg.sessionStateDir);

if (!repoDir || !existsSync(repoDir)) {
  console.error(`scan-usage: repoDir not found ("${repoDir}"). Set config.repoDir.`);
  process.exit(2);
}
if (!existsSync(sessionDir)) {
  console.error(`scan-usage: session-state dir not found ("${sessionDir}").`);
  process.exit(2);
}

const { skills: ourSkills, agents: ourAgents } = enumerateUnits(repoDir);
const include = new Set(cfg.include || []);
const exclude = new Set(cfg.exclude || []);
const eligible = (unit) => (include.size === 0 || include.has(unit)) && !exclude.has(unit);

// Determine the lower bound. If we have a watermark, resume from it; otherwise
// first-run lookback by time.
const watermark = state.watermark || null;
const firstRunFrom = watermark
  ? null
  : new Date(Date.now() - (cfg.firstRunLookbackDays || 7) * 86400_000).toISOString();
const lowerTs = watermark ? watermark.timestamp : firstRunFrom;

const CORRECTION_RE = /\b(no,|that'?s wrong|that is wrong|you should have|why didn'?t you|don'?t do that|stop,|incorrect|not what i)\b/i;

// Collect candidate session dirs, newest mtime first; cap on first run.
let sessionIds = [];
try { sessionIds = readdirSync(sessionDir); } catch { sessionIds = []; }
const candidates = [];
for (const id of sessionIds) {
  const ev = join(sessionDir, id, 'events.jsonl');
  let st;
  try { st = statSync(ev); } catch { continue; }
  // mtime prefilter: a file whose last write predates the watermark cannot hold
  // newer events (small slack added for clock skew).
  if (lowerTs && st.mtime.toISOString() < lowerTs) {
    // still allow a 2-min slack window
    if (st.mtimeMs < Date.parse(lowerTs) - 120_000) continue;
  }
  candidates.push({ id, ev, mtimeMs: st.mtimeMs });
}
candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
let scanList = candidates;
let truncated = false;
if (!watermark && cfg.maxFirstRunSessions && candidates.length > cfg.maxFirstRunSessions) {
  scanList = candidates.slice(0, cfg.maxFirstRunSessions);
  truncated = true;
}

const units = new Map(); // unit -> { unit, type, sessions:Set, invocations, corrections, toolErrors }
function bump(unit, type, sessionId) {
  if (!eligible(unit)) return;
  let u = units.get(unit);
  if (!u) { u = { unit, type, sessions: new Set(), invocations: 0, corrections: 0, toolErrors: 0 }; units.set(unit, u); }
  u.invocations++;
  u.sessions.add(sessionId);
  return u;
}

let watermarkNext = watermark;
let filesScanned = 0;
let sessionsWithUsage = new Set();
const parseErrors = [];

for (const { id, ev } of scanList) {
  let raw;
  try { raw = readFileSync(ev, 'utf8'); } catch { continue; }
  filesScanned++;
  const lines = raw.split('\n');
  // Pass 1: detect self-marker → skip entire session.
  if (cfg.selfMarker && raw.includes(cfg.selfMarker)) continue;

  // Per-session aggregates for weak signals.
  let sawCorrection = false;
  let toolErrors = 0;
  const sessionUnits = []; // [{unit,type}]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { parseErrors.push({ id, line: i }); continue; }
    const point = { timestamp: o.timestamp || '', session_id: id, line: i };
    // Only process events strictly after the watermark.
    if (watermark && cmpWatermark(point, watermark) <= 0) {
      // still advance watermarkNext below
    } else {
      const d = o.data || {};
      if (o.type === 'skill.invoked' && d.name && ourSkills.has(d.name)) {
        sessionUnits.push({ unit: d.name, type: 'skill' });
      } else if ((o.type === 'subagent.selected' || o.type === 'subagent.started') && d.agentName) {
        const bare = bareAgentName(d.agentName);
        if (ourAgents.has(bare)) sessionUnits.push({ unit: bare, type: 'agent' });
      } else if (o.type === 'user.message' && typeof d.content === 'string' && CORRECTION_RE.test(d.content)) {
        sawCorrection = true;
      } else if (o.type === 'tool.execution_complete' && d.success === false) {
        toolErrors++;
      }
    }
    // Advance the running max watermark over everything we scanned.
    if (o.timestamp && cmpWatermark(point, watermarkNext) > 0) watermarkNext = point;
  }

  // Attribute weak signals to the units used in this session.
  for (const { unit, type } of sessionUnits) {
    const u = bump(unit, type, id);
    if (!u) continue;
    sessionsWithUsage.add(id);
    if (sawCorrection) u.corrections++;
    u.toolErrors += toolErrors;
  }
}

const unitList = [...units.values()].map((u) => ({
  unit: u.unit,
  type: u.type,
  sessions: [...u.sessions],
  sessionCount: u.sessions.size,
  invocations: u.invocations,
  signals: { corrections: u.corrections, toolErrors: u.toolErrors },
})).sort((a, b) => b.sessionCount - a.sessionCount);

const manifest = {
  scannedAt: nowIso(),
  coverage: {
    repoDir,
    sessionStateDir: sessionDir,
    filesScanned,
    sessionsWithUsage: sessionsWithUsage.size,
    watermarkFrom: watermark || (firstRunFrom ? { timestamp: firstRunFrom } : null),
    watermarkTo: watermarkNext,
    truncated,
    parseErrors: parseErrors.length,
    note: truncated
      ? `First run capped at ${cfg.maxFirstRunSessions} most-recent sessions; older history not scanned.`
      : (watermark ? 'Incremental scan since last watermark.' : 'First run (full lookback window).'),
  },
  ourUnits: { skills: [...ourSkills], agents: [...ourAgents] },
  units: unitList,
};

if (outPath) writeJson(outPath, manifest);
process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
