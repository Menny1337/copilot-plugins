#!/usr/bin/env node
// sync-ui.mjs — static HTML dashboard for the ado-session-sync observability trail.
//
// Reads ~/.copilot/logs/ado-session-sync/runs.jsonl, renders a self-contained
// HTML file (no server, fully offline), and opens it in the default browser.
// Read-only and fail-soft: never touches the board or the logs.
//
// Usage:
//   node sync-ui.mjs                 # generate + open the dashboard
//   node sync-ui.mjs --no-open       # generate only, print the file path
//   node sync-ui.mjs --out <path>    # write the HTML to a specific path
//
// Env:
//   COPILOT_PLUGIN_ADO_SYNC_LOGDIR   override the log directory
//   BROWSER               override the open command

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const noOpen = args.includes('--no-open');
const outIdx = args.indexOf('--out');
const logDir = process.env.COPILOT_PLUGIN_ADO_SYNC_LOGDIR || join(homedir(), '.copilot', 'logs', 'ado-session-sync');
const jsonl = join(logDir, 'runs.jsonl');
const configPath = join(homedir(), '.copilot', 'assistant', 'config.json');
const outFile = outIdx !== -1 && args[outIdx + 1]
  ? args[outIdx + 1]
  : join(tmpdir(), 'ado-session-sync-dashboard.html');

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const rows = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch { /* skip malformed line */ }
  }
  return rows;
}

function normalizeEvent(e) {
  return {
    ...e,
    ts: e.ts || e.timestamp || '',
    parent: e.parent || e.parentSession || '',
    child: e.child || e.syncSession || '',
  };
}

let org = '', project = '';
try {
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  org = (cfg.ado && cfg.ado.org) || '';
  project = (cfg.ado && cfg.ado.project) || '';
} catch { /* config optional */ }

const events = readJsonl(jsonl).map(normalizeEvent);
const payload = {
  generatedAt: new Date().toISOString(),
  logDir,
  jsonl,
  org,
  project,
  events,
};

const html = renderHtml(payload);
writeFileSync(outFile, html, 'utf8');

if (noOpen) {
  console.log(outFile);
} else {
  openInBrowser(outFile);
  console.log(`ado-session-sync dashboard → ${outFile}`);
}

function openInBrowser(file) {
  const browser = process.env.BROWSER;
  let cmd, cmdArgs;
  if (browser) { cmd = browser; cmdArgs = [file]; }
  else if (process.platform === 'darwin') { cmd = 'open'; cmdArgs = [file]; }
  else if (process.platform === 'win32') { cmd = 'cmd'; cmdArgs = ['/c', 'start', '', file]; }
  else { cmd = 'xdg-open'; cmdArgs = [file]; }
  try {
    spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    console.log(`Could not auto-open; open this file manually:\n${file}`);
  }
}

function renderHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ado-session-sync · dashboard</title>
<style>
  :root {
    --bg:#0d1117; --panel:#161b22; --border:#30363d; --fg:#e6edf3; --muted:#8b949e;
    --accent:#58a6ff; --green:#3fb950; --yellow:#d29922; --red:#f85149; --chip:#21262d;
  }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
         background:var(--bg); color:var(--fg); }
  header { padding:18px 24px; border-bottom:1px solid var(--border); background:var(--panel); }
  h1 { margin:0 0 4px; font-size:18px; }
  .meta { color:var(--muted); font-size:12px; word-break:break-all; }
  .wrap { padding:20px 24px; max-width:1200px; margin:0 auto; }
  .cards { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:20px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:12px 16px; min-width:120px; }
  .card .n { font-size:24px; font-weight:600; }
  .card .l { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  .card.green .n{color:var(--green)} .card.yellow .n{color:var(--yellow)} .card.red .n{color:var(--red)}
  .controls { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:14px; }
  input,select { background:var(--chip); color:var(--fg); border:1px solid var(--border);
                 border-radius:6px; padding:6px 10px; font-size:13px; }
  input::placeholder { color:var(--muted); }
  table { width:100%; border-collapse:collapse; background:var(--panel);
          border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  th,td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--border); vertical-align:top; }
  th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; cursor:pointer; user-select:none; }
  tr:last-child td { border-bottom:none; }
  tr.evrow { cursor:pointer; }
  tr.evrow:hover { background:#1c2230; }
  .chip { display:inline-block; padding:1px 8px; border-radius:999px; font-size:12px; font-weight:600; }
  .ev-launch{background:#1f2937;color:#9cc4ff}
  .ev-result{background:#0f2e1a;color:var(--green)}
  .ev-skip{background:#2e2710;color:var(--yellow)}
  .ev-result.skipped{background:#2e2710;color:var(--yellow)}
  .ev-child-exit{background:#1f2937;color:var(--muted)}
  .ev-child-exit.bad{background:#3a1416;color:var(--red)}
  .ev-error{background:#3a1416;color:var(--red)}
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  a { color:var(--accent); text-decoration:none; } a:hover{text-decoration:underline;}
  .detail { background:#0b1018; }
  .detail td { padding:14px 18px; }
  .detail .note { white-space:pre-wrap; }
  .kv { color:var(--muted); }
  .kv b { color:var(--fg); font-weight:600; }
  .empty { color:var(--muted); padding:30px; text-align:center; }
  .hidden { display:none; }
</style>
</head>
<body>
<header>
  <h1>ado-session-sync · dashboard</h1>
  <div class="meta" id="meta"></div>
</header>
<div class="wrap">
  <div class="cards" id="cards"></div>
  <div class="controls">
    <input id="q" type="text" placeholder="Search session / note / item…" size="28">
    <select id="evfilter"></select>
    <input id="since" type="date" title="On/after this date">
    <select id="sessfilter"></select>
    <label class="kv"><input type="checkbox" id="erronly"> errors only</label>
  </div>
  <table>
    <thead><tr>
      <th data-k="ts">Time</th>
      <th data-k="event">Event</th>
      <th data-k="parent">Session</th>
      <th data-k="item">Item</th>
      <th data-k="action">Action</th>
      <th>Detail</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="empty hidden" id="empty">No events match the current filters.</div>
</div>
<script>
const DATA = ${json};
const { events, org, project, logDir, jsonl, generatedAt } = DATA;
const $ = s => document.querySelector(s);

document.getElementById('meta').innerHTML =
  'Log: <span class="mono">' + esc(jsonl) + '</span> · ' + events.length +
  ' events · generated ' + new Date(generatedAt).toLocaleString();

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function short(s){ return s ? String(s).slice(0,8) : ''; }
function adoUrl(item){ return (org && project && item!=null) ? org.replace(/\\/$/,'') + '/' + encodeURIComponent(project) + '/_workitems/edit/' + item : null; }
function childLogUrl(parent){ return parent ? 'file://' + logDir.replace(/\\/$/,'') + '/' + parent + '.log' : null; }
function isBad(e){ return e.event==='error' || (e.event==='result'&&(e.action==='blocked'||String(e.reason||'').startsWith('write-block'))) || (e.event==='child-exit'&&e.exit!==0); }
function evClass(e){
  let c = 'chip ev-' + e.event;
  if (e.event==='result' && e.action==='skipped') c += ' skipped';
  if (e.event==='child-exit' && e.exit!==0) c += ' bad';
  return c;
}

// ---- summary cards ----
const counts = {
  launch: events.filter(e=>e.event==='launch').length,
  updated: events.filter(e=>e.event==='result'&&e.action!=='skipped').length,
  skipped: events.filter(e=>e.event==='result'&&e.action==='skipped').length,
  gateSkip: events.filter(e=>e.event==='skip').length,
  errors: events.filter(e=>e.event==='error').length,
  badExit: events.filter(e=>e.event==='child-exit'&&e.exit!==0).length,
};
$('#cards').innerHTML = [
  ['Launches', counts.launch, ''],
  ['Updated', counts.updated, 'green'],
  ['Skipped', counts.skipped + counts.gateSkip, 'yellow'],
  ['Errors', counts.errors + counts.badExit, counts.errors+counts.badExit ? 'red' : ''],
].map(([l,n,cls])=>'<div class="card '+cls+'"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join('');

// ---- filter controls ----
const evTypes = [...new Set(events.map(e=>e.event))].sort();
$('#evfilter').innerHTML = '<option value="">all events</option>' + evTypes.map(t=>'<option>'+esc(t)+'</option>').join('');
const sessions = [...new Set(events.map(e=>e.parent).filter(Boolean))];
$('#sessfilter').innerHTML = '<option value="">all sessions</option>' + sessions.map(s=>'<option value="'+esc(s)+'">'+esc(short(s))+'… ('+esc(s)+')</option>').join('');

let sortKey='ts', sortDir=-1;
document.querySelectorAll('th[data-k]').forEach(th=>{
  th.onclick = ()=>{ const k=th.dataset.k; if(sortKey===k) sortDir*=-1; else {sortKey=k; sortDir=1;} render(); };
});
['#q','#evfilter','#since','#sessfilter','#erronly'].forEach(s=>$(s).addEventListener('input', render));

function detailRow(e){
  const url = adoUrl(e.item), clog = childLogUrl(e.parent);
  const bits = [];
  bits.push('<div class="kv">session: <b class="mono">'+esc(e.parent||'—')+'</b></div>');
  if (e.child) bits.push('<div class="kv">sync run: <b class="mono">'+esc(e.child)+'</b></div>');
  if (e.item!=null) bits.push('<div class="kv">work item: <b>#'+esc(e.item)+'</b>'+(url?' · <a href="'+esc(url)+'" target="_blank">open in ADO ↗</a>':'')+'</div>');
  if (e.action) bits.push('<div class="kv">action: <b>'+esc(e.action)+'</b></div>');
  if (e.reason) bits.push('<div class="kv">reason: <b>'+esc(e.reason)+'</b></div>');
  if (e.stage) bits.push('<div class="kv">stage: <b>'+esc(e.stage)+'</b></div>');
  if (e.event==='child-exit') bits.push('<div class="kv">exit: <b>'+esc(e.exit)+'</b> · duration: <b>'+esc(e.durationSec||0)+'s</b></div>');
  if (e.cwd) bits.push('<div class="kv">cwd: <b class="mono">'+esc(e.cwd)+'</b></div>');
  if (clog) bits.push('<div class="kv">run log: <a href="'+esc(clog)+'" target="_blank">'+esc(e.parent)+'.log ↗</a></div>');
  if (e.note) bits.push('<div class="note" style="margin-top:8px">'+esc(e.note)+'</div>');
  if (e.detail) bits.push('<div class="note" style="margin-top:8px;color:var(--red)">'+esc(e.detail)+'</div>');
  return '<tr class="detail hidden"><td colspan="6">'+bits.join('')+'</td></tr>';
}

function render(){
  const q = $('#q').value.toLowerCase().trim();
  const ev = $('#evfilter').value;
  const since = $('#since').value;
  const sess = $('#sessfilter').value;
  const errOnly = $('#erronly').checked;

  let rows = events.filter(e=>{
    if (ev && e.event!==ev) return false;
    if (sess && e.parent!==sess) return false;
    if (since && (e.ts||'') < since) return false;
    if (errOnly && !isBad(e)) return false;
    if (q){
      const hay = [e.parent,e.child,e.note,e.detail,e.action,e.reason,e.item].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  rows.sort((a,b)=>{
    const av=a[sortKey]==null?'':a[sortKey], bv=b[sortKey]==null?'':b[sortKey];
    return (av>bv?1:av<bv?-1:0)*sortDir;
  });

  const tb = $('#rows');
  tb.innerHTML='';
  $('#empty').classList.toggle('hidden', rows.length>0);
  for (const e of rows){
    const tr = document.createElement('tr');
    tr.className='evrow';
    const noteShort = (e.note||e.detail||'') ? esc((e.note||e.detail).slice(0,70)) + ((e.note||e.detail).length>70?'…':'') : '';
    tr.innerHTML =
      '<td class="mono">'+esc((e.ts||'').replace('T',' ').replace('Z',''))+'</td>'+
      '<td><span class="'+evClass(e)+'">'+esc(e.event)+'</span></td>'+
      '<td class="mono" title="'+esc(e.parent||'')+'">'+esc(short(e.parent))+'</td>'+
      '<td>'+(e.item!=null?'#'+esc(e.item):'')+'</td>'+
      '<td>'+esc(e.action||e.reason||'')+'</td>'+
      '<td>'+noteShort+'</td>';
    const det = document.createElement('template');
    det.innerHTML = detailRow(e);
    const detEl = det.content.firstChild;
    tr.onclick = ()=> detEl.classList.toggle('hidden');
    tb.appendChild(tr);
    tb.appendChild(detEl);
  }
}
render();
</script>
</body>
</html>`;
}
