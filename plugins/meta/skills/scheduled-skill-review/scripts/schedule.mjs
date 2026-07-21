// schedule.mjs — single source of truth for the daemon's schedule.
//
// The launchd plist's StartCalendarInterval is what actually fires the daemon;
// config.json.schedule is only an editable mirror. This module reads the plist
// (via plutil) and computes the next fire time so the menu bar shows the SAME
// schedule the daemon runs on, and rewrites the plist when the schedule is
// edited — so the two never drift. Used by daemon-ctl.sh `status` (read) and
// `config-set` (write).
//
// Weekday convention: config.schedule.weekdays use JS getDay (0=Sun..6=Sat),
// which maps 1:1 onto launchd's Weekday field (launchd also treats 0 and 7 as
// Sunday). No translation is needed for 0..6.

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LAUNCH_AGENTS = join(process.env.HOME || '', 'Library', 'LaunchAgents');
const CANONICAL = 'com.copilotplugins.skill-review.plist';
const DAEMON_SCRIPT = 'run-batch-review.sh';

// Locate the daemon LaunchAgent plist: the one whose ProgramArguments invoke
// run-batch-review.sh. Prefer the canonical filename, else scan the directory.
// Returns an absolute path, or null when not installed / not on macOS.
export function findDaemonPlist() {
  try {
    const canon = join(LAUNCH_AGENTS, CANONICAL);
    if (existsSync(canon) && readFileSync(canon, 'utf8').includes(DAEMON_SCRIPT)) return canon;
    for (const f of readdirSync(LAUNCH_AGENTS)) {
      if (!f.endsWith('.plist')) continue;
      const p = join(LAUNCH_AGENTS, f);
      try { if (readFileSync(p, 'utf8').includes(DAEMON_SCRIPT)) return p; } catch { /* unreadable, skip */ }
    }
  } catch { /* no LaunchAgents dir, etc. */ }
  return null;
}

// Read a plist file into a JS object via plutil (macOS). Returns null on failure.
export function readPlist(path) {
  try {
    return JSON.parse(execSync('plutil -convert json -o - ' + JSON.stringify(path), { encoding: 'utf8' }));
  } catch { return null; }
}

// Normalize a StartCalendarInterval (dict | array of dicts) into an array of dicts.
function sciEntries(sci) {
  if (!sci) return [];
  if (Array.isArray(sci)) return sci.filter((e) => e && typeof e === 'object');
  return typeof sci === 'object' ? [sci] : [];
}

// Compute the next fire time from a StartCalendarInterval, honoring launchd
// semantics: each entry may constrain Minute/Hour/Day(of month)/Weekday/Month;
// a missing field is a wildcard; multiple entries are OR'd (soonest wins).
// Weekday 0 or 7 = Sunday. Scans forward day-by-day up to a year.
// Returns a future Date, or null if nothing matches within 366 days.
export function nextFireFromSCI(sci, from = new Date()) {
  const entries = sciEntries(sci);
  if (!entries.length) return null;
  const fromMs = from.getTime();
  const start = new Date(fromMs);
  start.setHours(0, 0, 0, 0);
  for (let dayOff = 0; dayOff <= 366; dayOff++) {
    const day = new Date(start.getTime());
    day.setDate(day.getDate() + dayOff);
    let best = null;
    for (const e of entries) {
      if (Number.isInteger(e.Month) && (day.getMonth() + 1) !== e.Month) continue;
      if (Number.isInteger(e.Day) && day.getDate() !== e.Day) continue;
      if (Number.isInteger(e.Weekday) && day.getDay() !== (((e.Weekday % 7) + 7) % 7)) continue;
      const hour = Number.isInteger(e.Hour) ? e.Hour : 0;
      const minute = Number.isInteger(e.Minute) ? e.Minute : 0;
      const cand = new Date(day.getTime());
      cand.setHours(hour, minute, 0, 0);
      if (cand.getTime() > fromMs && (!best || cand.getTime() < best.getTime())) best = cand;
    }
    if (best) return best; // earliest matching day yields the earliest fire
  }
  return null;
}

// Build a StartCalendarInterval from a config schedule {hour, minute, weekdays}.
// Empty/missing weekdays -> a single dict (fires every day). Returns array|dict.
export function sciFromSchedule(schedule = {}) {
  const hour = Number.isFinite(schedule.hour) ? Math.trunc(schedule.hour) : 0;
  const minute = Number.isFinite(schedule.minute) ? Math.trunc(schedule.minute) : 0;
  const days = Array.isArray(schedule.weekdays)
    ? [...new Set(schedule.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  return days.length
    ? days.map((d) => ({ Weekday: d, Hour: hour, Minute: minute }))
    : { Hour: hour, Minute: minute };
}

// Fallback next-run from a config schedule (when no launchd plist is installed).
// Returns a future Date, or null when the schedule has no usable hour.
export function nextRunFromConfig(schedule = {}, from = new Date()) {
  if (!Number.isFinite(schedule.hour)) return null;
  return nextFireFromSCI(sciFromSchedule(schedule), from);
}

// Resolve the next run: prefer the launchd plist (the real trigger), else fall
// back to the config schedule. Returns { iso, source, plist } where source is
// 'launchd' | 'config' | null and iso is null when nothing can be computed.
export function resolveNextRun(configSchedule = {}, from = new Date()) {
  const plist = findDaemonPlist();
  if (plist) {
    const parsed = readPlist(plist);
    const fire = nextFireFromSCI(parsed && parsed.StartCalendarInterval, from);
    if (fire) return { iso: fire.toISOString(), source: 'launchd', plist };
  }
  const fallback = nextRunFromConfig(configSchedule, from);
  return { iso: fallback ? fallback.toISOString() : null, source: fallback ? 'config' : null, plist: plist || null };
}
