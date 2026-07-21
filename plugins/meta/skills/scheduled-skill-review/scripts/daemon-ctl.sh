#!/usr/bin/env bash
# daemon-ctl.sh — control + status surface for the scheduled-skill-review daemon.
# Used by the native menu-bar app and from the shell. Mutates config.json
# and reads state.json / cycles.json under the workspace.
#
# Usage:
#   daemon-ctl.sh status              JSON status (enabled, lastRun, in-flight, due)
#   daemon-ctl.sh pause | resume      toggle config.enabled (soft pause)
#   daemon-ctl.sh run-now             run a review cycle immediately (foreground)
#   daemon-ctl.sh review-unit <name>  force a one-off review of <name> now
#   daemon-ctl.sh include <name>      add <name> to the include allowlist
#   daemon-ctl.sh exclude <name>      add <name> to the exclude list
#   daemon-ctl.sh unset <name>        remove <name> from include/exclude/pr/auto lists
#   daemon-ctl.sh auto-merge <name>   force <name> to auto-merge (autonomous deploy)
#   daemon-ctl.sh review-pr <name>    force <name> to open a PR for human review
#   daemon-ctl.sh deploy-default <auto|pr>  set the default policy for unlisted units
#   daemon-ctl.sh config-get          print the full effective config JSON (defaults merged)
#   daemon-ctl.sh config-set          read a JSON patch on stdin, validate, merge into config.json
#   daemon-ctl.sh open-digest         print path to the latest digest
#   daemon-ctl.sh open-config         print path to config.json
#   daemon-ctl.sh reconcile           reconcile PR-status cycles vs GitHub now
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS="$HOME/.copilot/agent-architect/skill-reviews"
CONFIG="$WS/config.json"
STATE="$WS/state.json"
CYCLES="$WS/cycles.json"
LOCK="$WS/lock"
mkdir -p "$WS"

# Mutate config.json with a node one-liner. $1 = JS body operating on `c`.
cfg_edit() {
  node --input-type=module -e "
    import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
    const p = process.env.CONFIG;
    let c = {};
    try { c = JSON.parse(readFileSync(p,'utf8')); } catch {}
    $1
    mkdirSync(process.env.WS,{recursive:true});
    writeFileSync(p, JSON.stringify(c,null,2)+'\n');
    console.log('ok');
  "
}

# Mirror config.json's schedule into the launchd plist (the real trigger) and
# reload launchd, so the Settings editor and the daemon never drift. Soft-fails
# (the config is already saved); only an already-installed plist is modified —
# never synthesized — to preserve its ProgramArguments/PATH. All diagnostics go
# to stderr so the config-set stdout echo stays clean.
apply_schedule_to_plist() {
  CONFIG="$CONFIG" SCHED_LIB="$DIR/schedule.mjs" node --input-type=module -e '
    import { execSync } from "node:child_process";
    import { readFileSync } from "node:fs";
    import { pathToFileURL } from "node:url";
    const s = await import(pathToFileURL(process.env.SCHED_LIB).href);
    const plist = s.findDaemonPlist();
    if (!plist) { console.error("config-set: no daemon launchd plist found; schedule saved to config only"); process.exit(0); }
    let cfg = {};
    try { cfg = JSON.parse(readFileSync(process.env.CONFIG, "utf8")); } catch {}
    const j = s.readPlist(plist);
    if (!j) { console.error("config-set: could not read " + plist + "; schedule saved to config only"); process.exit(0); }
    j.StartCalendarInterval = s.sciFromSchedule(cfg.schedule || {});
    const tmp = plist + ".tmp." + process.pid;
    try {
      execSync("plutil -convert xml1 -o " + JSON.stringify(tmp) + " -", { input: JSON.stringify(j) });
      execSync("mv " + JSON.stringify(tmp) + " " + JSON.stringify(plist));
    } catch (e) { console.error("config-set: failed to write plist: " + e.message); process.exit(0); }
    try { execSync("launchctl unload " + JSON.stringify(plist), { stdio: "ignore" }); } catch {}
    try { execSync("launchctl load " + JSON.stringify(plist), { stdio: "ignore" });
          console.error("config-set: schedule applied to launchd and reloaded (" + plist + ")"); }
    catch { console.error("config-set: schedule written to plist but launchctl reload failed; run launchctl load manually"); }
  ' || true
}

cmd="${1:-status}"
case "$cmd" in
  pause)   CONFIG="$CONFIG" WS="$WS" cfg_edit "c.enabled=false;" >/dev/null; echo "paused" ;;
  resume)  CONFIG="$CONFIG" WS="$WS" cfg_edit "c.enabled=true;"  >/dev/null; echo "resumed" ;;
  include)
    [ $# -ge 2 ] || { echo "include: need <name>" >&2; exit 2; }
    n="$2" CONFIG="$CONFIG" WS="$WS" cfg_edit "c.include=[...new Set([...(c.include||[]),process.env.n])];" >/dev/null
    echo "include += $2" ;;
  exclude)
    [ $# -ge 2 ] || { echo "exclude: need <name>" >&2; exit 2; }
    n="$2" CONFIG="$CONFIG" WS="$WS" cfg_edit "c.exclude=[...new Set([...(c.exclude||[]),process.env.n])];" >/dev/null
    echo "exclude += $2" ;;
  unset)
    [ $# -ge 2 ] || { echo "unset: need <name>" >&2; exit 2; }
    n="$2" CONFIG="$CONFIG" WS="$WS" cfg_edit "c.include=(c.include||[]).filter(x=>x!==process.env.n);c.exclude=(c.exclude||[]).filter(x=>x!==process.env.n);c.prUnits=(c.prUnits||[]).filter(x=>x!==process.env.n);c.autoMergeUnits=(c.autoMergeUnits||[]).filter(x=>x!==process.env.n);" >/dev/null
    echo "unset $2" ;;
  auto-merge)
    [ $# -ge 2 ] || { echo "auto-merge: need <name>" >&2; exit 2; }
    n="$2" CONFIG="$CONFIG" WS="$WS" cfg_edit "c.autoMergeUnits=[...new Set([...(c.autoMergeUnits||[]),process.env.n])];c.prUnits=(c.prUnits||[]).filter(x=>x!==process.env.n);" >/dev/null
    echo "auto-merge += $2" ;;
  review-pr)
    [ $# -ge 2 ] || { echo "review-pr: need <name>" >&2; exit 2; }
    n="$2" CONFIG="$CONFIG" WS="$WS" cfg_edit "c.prUnits=[...new Set([...(c.prUnits||[]),process.env.n])];c.autoMergeUnits=(c.autoMergeUnits||[]).filter(x=>x!==process.env.n);" >/dev/null
    echo "review-pr += $2" ;;
  deploy-default)
    [ $# -ge 2 ] || { echo "deploy-default: need <auto|pr>" >&2; exit 2; }
    case "$2" in auto|pr) ;; *) echo "deploy-default: must be 'auto' or 'pr'" >&2; exit 2 ;; esac
    n="$2" CONFIG="$CONFIG" WS="$WS" cfg_edit "c.deployMode=process.env.n;" >/dev/null
    echo "deploy-default = $2" ;;
  run-now)
    exec "$DIR/run-batch-review.sh" ;;
  review-unit)
    [ $# -ge 2 ] || { echo "review-unit: need <name>" >&2; exit 2; }
    exec "$DIR/run-batch-review.sh" --only "$2" ;;
  open-digest)
    echo "$WS/latest-digest.md" ;;
  open-config)
    echo "$CONFIG" ;;
  config-get)
    # Full effective config (defaults merged) for the native settings window.
    LIB="$DIR/lib.mjs" node --input-type=module -e "
      import { pathToFileURL } from 'node:url';
      const { loadConfig } = await import(pathToFileURL(process.env.LIB).href);
      process.stdout.write(JSON.stringify(loadConfig(), null, 2) + '\n');
    " ;;
  config-set)
    # Read a JSON patch object from stdin, validate/coerce each known key, then
    # merge into config.json (schedule deep-merged; unknown/unmanaged keys are
    # preserved). Echoes the resulting effective config. Backs the settings
    # window's autosave.
    payload="$(cat)"
    PATCH="$payload" LIB="$DIR/lib.mjs" node --input-type=module -e "
      import { pathToFileURL } from 'node:url';
      const lib = await import(pathToFileURL(process.env.LIB).href);
      let patch;
      try { patch = JSON.parse(process.env.PATCH || '{}'); }
      catch (e) { console.error('config-set: invalid JSON: ' + e.message); process.exit(2); }
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        console.error('config-set: patch must be a JSON object'); process.exit(2);
      }
      const errs = [];
      const out = {};
      const asInt = (v) => (typeof v === 'number' && Number.isFinite(v)) ? Math.trunc(v)
        : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : NaN);
      const intIn = (k, v, lo, hi) => { const n = asInt(v); if (Number.isNaN(n) || n < lo || n > hi) { errs.push(k + ' must be an integer in [' + lo + ',' + hi + ']'); return; } out[k] = n; };
      const boolKey = (k, v) => { if (typeof v !== 'boolean') { errs.push(k + ' must be boolean'); return; } out[k] = v; };
      const enumKey = (k, v, allowed) => { if (!allowed.includes(v)) { errs.push(k + ' must be one of ' + allowed.join('|')); return; } out[k] = v; };
      const strKey = (k, v) => { if (typeof v !== 'string') { errs.push(k + ' must be a string'); return; } out[k] = v; };
      const strArr = (k, v) => { if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) { errs.push(k + ' must be an array of strings'); return; } out[k] = [...new Set(v.map(s => s.trim()).filter(Boolean))]; };
      for (const [k, v] of Object.entries(patch)) {
        switch (k) {
          case 'enabled': case 'autoDeploy': case 'autoRevert': boolKey(k, v); break;
          case 'concurrency': intIn(k, v, 1, 16); break;
          case 'signalThreshold': intIn(k, v, 1, 100); break;
          case 'observationWindowDays': intIn(k, v, 0, 365); break;
          case 'firstRunLookbackDays': intIn(k, v, 0, 365); break;
          case 'maxFirstRunSessions': intIn(k, v, 1, 100000); break;
          case 'deployMode': enumKey(k, v, ['auto', 'pr']); break;
          case 'revertDeployMode': enumKey(k, v, ['auto', 'pr', 'unit']); break;
          case 'notify': enumKey(k, v, ['auto', 'none']); break;
          case 'repoDir': case 'marketplaceName': case 'ghAccount': strKey(k, v); break;
          case 'include': case 'exclude': case 'autoMergeUnits': case 'prUnits': strArr(k, v); break;
          case 'schedule': {
            if (v === null || typeof v !== 'object' || Array.isArray(v)) { errs.push('schedule must be an object'); break; }
            const s = {};
            if ('hour' in v) { const n = asInt(v.hour); if (Number.isNaN(n) || n < 0 || n > 23) errs.push('schedule.hour must be in [0,23]'); else s.hour = n; }
            if ('minute' in v) { const n = asInt(v.minute); if (Number.isNaN(n) || n < 0 || n > 59) errs.push('schedule.minute must be in [0,59]'); else s.minute = n; }
            if ('weekdays' in v) {
              if (!Array.isArray(v.weekdays)) errs.push('schedule.weekdays must be an array');
              else {
                const days = [];
                let bad = false;
                for (const d of v.weekdays) { const n = asInt(d); if (Number.isNaN(n) || n < 0 || n > 6) { bad = true; break; } days.push(n); }
                if (bad) errs.push('schedule.weekdays entries must be integers in [0,6]');
                else s.weekdays = [...new Set(days)].sort((a, b) => a - b);
              }
            }
            out.schedule = s;
            break;
          }
          default: break; // ignore unknown keys
        }
      }
      if (errs.length) { console.error('config-set: ' + errs.join('; ')); process.exit(2); }
      const cfg = lib.readJson(lib.PATHS.config, {}) || {};
      for (const [k, v] of Object.entries(out)) {
        if (k === 'schedule') cfg.schedule = { ...(cfg.schedule || {}), ...v };
        else cfg[k] = v;
      }
      // Keep per-unit policy lists mutually exclusive (prUnits wins), matching
      // the auto-merge/review-pr subcommands.
      if (Array.isArray(cfg.autoMergeUnits) && Array.isArray(cfg.prUnits)) {
        cfg.autoMergeUnits = cfg.autoMergeUnits.filter(x => !cfg.prUnits.includes(x));
      }
      lib.writeJson(lib.PATHS.config, cfg);
      // Echo the resulting effective config (defaults merged) so the settings
      // window can reflect any normalization (deduped/mutually-exclusive lists).
      process.stdout.write(JSON.stringify(lib.loadConfig(), null, 2) + '\n');
    " || exit $?
    # If the patch touched the schedule, mirror it into the launchd plist (the
    # real trigger) and reload, so the menu bar and the daemon never drift.
    if PATCH="$payload" node -e 'let p;try{p=JSON.parse(process.env.PATCH||"{}")}catch{process.exit(1)};process.exit(p&&typeof p==="object"&&!Array.isArray(p)&&Object.prototype.hasOwnProperty.call(p,"schedule")?0:1)' 2>/dev/null; then
      apply_schedule_to_plist
    fi
    ;;
  reconcile)
    # Foreground reconcile of PR-status cycles against GitHub (manual/debug).
    bash "$DIR/reconcile-prs.sh" || true
    echo "reconciled" ;;
  status)
    # Self-heal stale PR indicators: if any cycle is awaiting a human merge, kick
    # off a DETACHED reconcile (it self-locks, so rapid menu refreshes can't pile
    # up) and emit current state immediately — the menu bar heals on next refresh.
    if CYCLES="$CYCLES" node -e 'let c=[];try{c=JSON.parse(require("fs").readFileSync(process.env.CYCLES,"utf8"))}catch{};process.exit(c.some(x=>x.status==="pr")?0:1)' 2>/dev/null; then
      ( nohup bash "$DIR/reconcile-prs.sh" >/dev/null 2>&1 & ) 2>/dev/null || true
    fi
    STATE="$STATE" CYCLES="$CYCLES" CONFIG="$CONFIG" LOCK="$LOCK" SCHED_LIB="$DIR/schedule.mjs" node --input-type=module -e "
      import { readFileSync, existsSync } from 'node:fs';
      import { pathToFileURL } from 'node:url';
      const sched = await import(pathToFileURL(process.env.SCHED_LIB).href);
      const rd=(p,f)=>{try{return JSON.parse(readFileSync(p,'utf8'))}catch{return f}};
      const cfg=rd(process.env.CONFIG,{});
      const st=rd(process.env.STATE,{});
      const cy=rd(process.env.CYCLES,[]);
      const now=Date.now();
      const open=cy.filter(c=>['candidate','proposed','integrated','deployed','observing','pr'].includes(c.status));
      const due=cy.filter(c=>['deployed','observing'].includes(c.status)&&c.reviewDueAt&&Date.parse(c.reviewDueAt)<=now);
      const openPRs=cy.filter(c=>c.status==='pr');
      // Next scheduled run: read the launchd plist (the real trigger) so the menu
      // bar shows the SAME schedule the daemon fires on; fall back to config.schedule
      // only when the plist isn't installed. Single source of truth — see schedule.mjs.
      const nr=sched.resolveNextRun(cfg.schedule||{}, new Date(now));
      const nextRun=nr.iso;
      console.log(JSON.stringify({
        enabled: cfg.enabled!==false,
        running: existsSync(process.env.LOCK),
        schedule: cfg.schedule||null,
        nextRun,
        scheduleSource: nr.source,
        deployMode: cfg.deployMode||'auto',
        autoMergeUnits: cfg.autoMergeUnits||[],
        prUnits: cfg.prUnits||[],
        include: cfg.include||[],
        exclude: cfg.exclude||[],
        lastRun: st.lastRun||null,
        openCycles: open.length,
        openPRs: openPRs.length,
        prUrls: openPRs.map(c=>c.prUrl).filter(Boolean),
        dueReReviews: due.length,
      },null,2));
    " ;;
  *)
    echo "unknown command: $cmd" >&2
    echo "usage: status|pause|resume|run-now|review-unit <n>|include <n>|exclude <n>|unset <n>|auto-merge <n>|review-pr <n>|deploy-default <auto|pr>|config-get|config-set|open-digest|open-config|reconcile" >&2
    exit 2 ;;
esac
