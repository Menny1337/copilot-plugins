#!/usr/bin/env node
/**
 * ado-query.mjs — deterministic WIQL builder + `az boards query` runner for the
 * assistant-query skill (§8 Team board, §8a Personal board).
 *
 * WHY THIS EXISTS
 *   §8/§8a of SKILL.md used to inline ~20 near-identical `az boards query`
 *   blocks (one per briefing lane), differing only in a WHERE clause. That is
 *   deterministic mechanics the agent had to re-read and re-type every turn.
 *   This script owns the mechanics; SKILL.md keeps only the judgment (which
 *   lane, hide-empty/WIP rules, how to render). The skill calls a named lane;
 *   the script reads config, builds the exact WIQL, and runs `az`.
 *
 * CONFIG (read at runtime — never hardcoded)
 *   Source order: --config <path>  >  $COPILOT_PLUGIN_ASSISTANT_CONFIG  >
 *                 $COPILOT_PLUGIN_ADO_CONFIG (legacy) > ~/.copilot/assistant/config.json
 *   Personal board  -> config.ado        { org, project }
 *   Team board      -> config.teamBoard   { org, project, team, areaPath }
 *   A leading "~" in --config is expanded to the home directory.
 *
 * USAGE
 *   ado-query <lane> [options]               run a named lane (installed command)
 *   ado-query --list                         list lanes grouped by board
 *   ado-query details --id 12345             show one work item
 *   ado-query <lane> --print-wiql            print WIQL + az command, run nothing
 *   # portable form, no install needed:  node ado-query.mjs <lane> [options]
 *
 * OPTIONS
 *   --board personal|team     override the lane's default board
 *   --priority N              add/replace  [..Priority] = N
 *   --tag TAG                 add/replace  [System.Tags] CONTAINS 'TAG'
 *   --assignee EMAIL          query for EMAIL instead of @Me
 *   --changed-since-days N    add/replace  [System.ChangedDate] >= @Today - N
 *   --area                    add  [System.AreaPath] UNDER '<project>\<areaPath>'
 *   --where "CLAUSE"          append a raw WIQL WHERE clause (repeatable escape hatch)
 *   --output table|json|tsv   az output format (default: table)
 *   --print-wiql / --dry-run  print the WIQL + resolved az command; do not execute
 *   --config PATH             config file (see CONFIG above)
 *   --id ID                   work-item id (with the `details` lane)
 *   --list / --help
 *
 * EXIT CODES: 0 ok · 1 usage/arg error · 2 config missing/invalid ·
 *             3 board not configured (e.g. no teamBoard) · >0 az passthrough
 *
 * INSTALL (for the bare `ado-query` command): handled automatically. The
 *   core-agents plugin ships a sessionStart hook (hooks/link-commands.sh /
 *   .ps1) that idempotently links this skill script into ~/.local/bin on the
 *   first session after install — no manual step, no duplicate copy. To wire it
 *   up by hand instead:
 *     chmod +x "<this file>" && ln -sf "<this file>" ~/.local/bin/ado-query
 *   (the `#!/usr/bin/env node` shebang runs it; ~/.local/bin must be on PATH).
 *
 * Pure Node, zero deps — mirrors the repo's other *.mjs scripts.
 */

import { readAssistantConfig, validateBoard } from '../../../shared/assistant-config.mjs';
import { spawnSync } from 'node:child_process';

// --- WIQL fragments shared across lanes -----------------------------------
const NOT_DONE = "[System.State] NOT IN ('Closed', 'Resolved', 'Removed', 'Done')";
const OPEN = "[System.State] NOT IN ('Resolved', 'Closed')";
const NOT_CLOSED = "[System.State] <> 'Closed'";

// --- Lane catalog (faithful to SKILL.md §8 / §8a) --------------------------
// Each lane: { board, desc, select[], where[], order[] }. WHERE/SELECT/ORDER
// strings may contain tokens resolved per board/options:
//   __ME__       assignee clause           __CURITER__  current-iteration macro
//   __PRIO__     --priority value (def 1)   __TAG__      --tag value
//   __SINCE__    --changed-since-days (def 14)
const LANES = {
  // ---- §8a Personal board -------------------------------------------------
  'all-open': {
    board: 'personal', desc: 'All open personal items (every non-done lane).',
    select: ['[System.Id]', '[System.WorkItemType]', '[System.Title]', '[System.State]', '[Microsoft.VSTS.Common.Priority]', '[System.Tags]', '[Microsoft.VSTS.Scheduling.DueDate]', '[System.BoardColumn]', '[System.Parent]', '[System.ChangedDate]'],
    where: ['__ME__', NOT_DONE],
    order: ['[Microsoft.VSTS.Common.Priority] ASC', '[Microsoft.VSTS.Scheduling.DueDate] ASC'],
  },
  'by-priority': {
    board: 'personal', desc: 'Open items at a given priority (--priority, default 1).',
    select: ['[System.Id]', '[System.Title]', '[System.State]', '[System.Tags]'],
    where: ['__ME__', OPEN, '[Microsoft.VSTS.Common.Priority] = __PRIO__'],
    order: ['[System.ChangedDate] DESC'],
  },
  overdue: {
    board: 'personal', desc: 'Open items past their due date.',
    select: ['[System.Id]', '[System.Title]', '[Microsoft.VSTS.Scheduling.DueDate]'],
    where: ['__ME__', OPEN, '[Microsoft.VSTS.Scheduling.DueDate] < @Today'],
    order: ['[Microsoft.VSTS.Scheduling.DueDate] ASC'],
  },
  'due-today': {
    board: 'personal', desc: 'Open items due today.',
    select: ['[System.Id]', '[System.Title]'],
    where: ['__ME__', OPEN, '[Microsoft.VSTS.Scheduling.DueDate] = @Today'],
    order: [],
  },
  'due-week': {
    board: 'personal', desc: 'Open items due in the next 7 days.',
    select: ['[System.Id]', '[System.Title]', '[Microsoft.VSTS.Scheduling.DueDate]'],
    where: ['__ME__', OPEN, '[Microsoft.VSTS.Scheduling.DueDate] <= @Today + 7', '[Microsoft.VSTS.Scheduling.DueDate] >= @Today'],
    order: ['[Microsoft.VSTS.Scheduling.DueDate] ASC'],
  },
  'by-tag': {
    board: 'personal', desc: 'Open items carrying a tag (--tag required).',
    select: ['[System.Id]', '[System.Title]', '[System.Tags]'],
    where: ['__ME__', OPEN, "[System.Tags] CONTAINS '__TAG__'"],
    order: [],
  },
  blocked: {
    board: 'personal', desc: 'Board column = Blocked (WIP target 3).',
    select: ['[System.Id]', '[System.Title]', '[System.Parent]', '[System.State]', '[System.BoardColumn]'],
    where: ['__ME__', "[System.BoardColumn] = 'Blocked'", NOT_CLOSED],
    order: [],
  },
  'needs-me': {
    board: 'personal', desc: 'Board column = Needs Me — your attention queue (WIP target 5).',
    select: ['[System.Id]', '[System.Title]', '[System.Parent]', '[System.State]', '[System.BoardColumn]', '[System.ChangedDate]'],
    where: ['__ME__', "[System.BoardColumn] = 'Needs Me'", NOT_CLOSED],
    order: ['[System.ChangedDate] DESC'],
  },
  'up-next': {
    board: 'personal', desc: 'Board column = Up Next — queued short-list (WIP target 5).',
    select: ['[System.Id]', '[System.Title]', '[System.Parent]', '[Microsoft.VSTS.Common.Priority]', '[Microsoft.VSTS.Scheduling.DueDate]', '[System.BoardColumn]'],
    where: ['__ME__', "[System.BoardColumn] = 'Up Next'", NOT_CLOSED],
    order: ['[Microsoft.VSTS.Common.Priority] ASC', '[Microsoft.VSTS.Scheduling.DueDate] ASC'],
  },
  active: {
    board: 'personal', desc: 'Board column = Active — in-flight (WIP target 3).',
    select: ['[System.Id]', '[System.Title]', '[System.Parent]', '[Microsoft.VSTS.Common.Priority]', '[Microsoft.VSTS.Scheduling.DueDate]', '[System.BoardColumn]', '[System.ChangedDate]'],
    where: ['__ME__', "[System.BoardColumn] = 'Active'", NOT_CLOSED],
    order: ['[Microsoft.VSTS.Common.Priority] ASC', '[Microsoft.VSTS.Scheduling.DueDate] ASC'],
  },
  backlog: {
    board: 'personal', desc: 'Board column = New — backlog (not yet promoted).',
    select: ['[System.Id]', '[System.Title]', '[System.Parent]', '[Microsoft.VSTS.Common.Priority]', '[Microsoft.VSTS.Scheduling.DueDate]', '[System.BoardColumn]', '[System.CreatedDate]'],
    where: ['__ME__', "[System.BoardColumn] = 'New'", NOT_CLOSED],
    order: ['[Microsoft.VSTS.Common.Priority] ASC', '[System.CreatedDate] ASC'],
  },
  'done-24h': {
    board: 'personal', desc: 'Resolved in the last 24h (daily momentum recap).',
    select: ['[System.Id]', '[System.Title]', '[System.Parent]', '[System.ChangedDate]', '[Microsoft.VSTS.Common.Priority]'],
    where: ['__ME__', "[System.State] = 'Resolved'", '[System.ChangedDate] >= @Today - 1'],
    order: ['[System.ChangedDate] DESC'],
  },
  'done-recent': {
    board: 'personal', desc: 'Resolved recently (--changed-since-days, default 14; weekly uses 7).',
    select: ['[System.Id]', '[System.Title]', '[System.Parent]', '[System.ChangedDate]', '[Microsoft.VSTS.Common.Priority]'],
    where: ['__ME__', "[System.State] = 'Resolved'", '[System.ChangedDate] >= @Today - __SINCE__'],
    order: ['[System.ChangedDate] DESC'],
  },
  archive: {
    board: 'personal', desc: 'State = Closed (archive — opt-in only, never in briefings).',
    select: ['[System.Id]', '[System.Title]', '[System.ChangedDate]', '[System.Tags]'],
    where: ['__ME__', "[System.State] = 'Closed'"],
    order: ['[System.ChangedDate] DESC'],
  },
  stale: {
    board: 'personal', desc: 'Open but untouched for 7+ days.',
    select: ['[System.Id]', '[System.Title]', '[System.ChangedDate]', '[System.State]'],
    where: ['__ME__', OPEN, '[System.ChangedDate] < @Today - 7'],
    order: ['[System.ChangedDate] ASC'],
  },
  'recently-changed': {
    board: 'personal', desc: 'Changed in the last 7 days (any state).',
    select: ['[System.Id]', '[System.Title]', '[System.ChangedDate]', '[System.State]'],
    where: ['__ME__', '[System.ChangedDate] >= @Today - 7'],
    order: ['[System.ChangedDate] DESC'],
  },
  // ---- §8 generic / sprint ------------------------------------------------
  'my-open': {
    board: 'personal', desc: 'My open work items (board-agnostic quick scan; works with --board team).',
    select: ['[System.Id]', '[System.WorkItemType]', '[System.Title]', '[System.State]', '[Microsoft.VSTS.Common.Priority]'],
    where: ['__ME__', NOT_DONE],
    order: ['[Microsoft.VSTS.Common.Priority] ASC', '[System.WorkItemType] ASC'],
  },
  'my-sprint': {
    board: 'personal', desc: 'My items in the current iteration (board-agnostic; --board team for the team sprint).',
    select: ['[System.Id]', '[System.WorkItemType]', '[System.Title]', '[System.State]', '[Microsoft.VSTS.Common.Priority]'],
    where: ['__ME__', '[System.IterationPath] = __CURITER__', NOT_CLOSED],
    order: ['[Microsoft.VSTS.Common.Priority] ASC'],
  },
  // ---- §8 Team board sprint lanes ----------------------------------------
  'team-started': {
    board: 'team', desc: 'Team sprint — Started/Active lane (🚀).',
    select: ['[System.Id]', '[System.Title]', '[System.State]', '[Microsoft.VSTS.Common.Priority]', '[System.ChangedDate]'],
    where: ['__ME__', '[System.IterationPath] UNDER __CURITER__', "[System.State] IN ('Started', 'Active')"],
    order: ['[Microsoft.VSTS.Common.Priority] ASC', '[System.ChangedDate] DESC'],
  },
  'team-committed': {
    board: 'team', desc: 'Team sprint — Committed lane (🎯).',
    select: ['[System.Id]', '[System.Title]', '[System.State]', '[Microsoft.VSTS.Common.Priority]', '[System.ChangedDate]'],
    where: ['__ME__', '[System.IterationPath] UNDER __CURITER__', "[System.State] = 'Committed'"],
    order: ['[Microsoft.VSTS.Common.Priority] ASC', '[System.ChangedDate] DESC'],
  },
  'team-proposed': {
    board: 'team', desc: 'Team sprint — Proposed lane (⏭️).',
    select: ['[System.Id]', '[System.Title]', '[System.State]', '[Microsoft.VSTS.Common.Priority]', '[System.ChangedDate]'],
    where: ['__ME__', '[System.IterationPath] UNDER __CURITER__', "[System.State] = 'Proposed'"],
    order: ['[Microsoft.VSTS.Common.Priority] ASC', '[System.ChangedDate] DESC'],
  },
};

const DETAILS_FIELDS = 'System.Title,System.State,System.AssignedTo,Microsoft.VSTS.Common.Priority,System.IterationPath';

// --- Tiny arg parser --------------------------------------------------------
function die(code, msg) {
  process.stderr.write(`ado-query: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const o = { _: [], output: 'table', where: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) die(1, `${a} requires a value`);
      return v;
    };
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '--list': o.list = true; break;
      case '--print-wiql': case '--dry-run': o.print = true; break;
      case '--board': o.board = next(); break;
      case '--priority': o.priority = next(); break;
      case '--tag': o.tag = next(); break;
      case '--assignee': o.assignee = next(); break;
      case '--changed-since-days': o.since = next(); break;
      case '--area': o.area = true; break;
      case '--where': o.where.push(next()); break;
      case '--output': case '-o': o.output = next(); break;
      case '--config': o.config = next(); break;
      case '--id': o.id = next(); break;
      default:
        if (a.startsWith('-')) die(1, `unknown option: ${a}`);
        o._.push(a);
    }
  }
  return o;
}

function loadConfig(explicit) {
  try {
    return readAssistantConfig(explicit);
  } catch (e) {
    return die(2, e.message);
  }
}

// Resolve { org, project, team?, areaPath? } for the chosen board.
function resolveBoard(cfg, board) {
  try { validateBoard(cfg, board === 'team' ? 'teamBoard' : 'ado'); }
  catch (e) { die(3, e.message); }
  if (board === 'team') {
    const t = cfg.teamBoard;
    return { org: t.org, project: t.project, team: t.team, areaPath: t.areaPath };
  }
  const a = cfg.ado;
  return { org: a.org, project: a.project, team: a.team, areaPath: a.defaultAreaPath };
}

function currentIterationMacro(board, ctx) {
  return board === 'team'
    ? `@CurrentIteration('[${ctx.project}]\\${ctx.team}')`
    : '@CurrentIteration';
}

// Substitute lane tokens with resolved values.
function resolveTokens(str, { board, ctx, priority, tag, since, assignee }) {
  const me = assignee ? `[System.AssignedTo] = '${assignee}'` : '[System.AssignedTo] = @Me';
  return str
    .replaceAll('__ME__', me)
    .replaceAll('__CURITER__', currentIterationMacro(board, ctx))
    .replaceAll('__PRIO__', String(priority))
    .replaceAll('__TAG__', tag ?? '')
    .replaceAll('__SINCE__', String(since));
}

function buildWiql(lane, opts, board, ctx) {
  const priority = opts.priority ?? 1;
  const since = opts.since ?? 14;
  const ti = { board, ctx, priority, tag: opts.tag, since, assignee: opts.assignee };

  const select = lane.select.map((s) => resolveTokens(s, ti));
  const where = lane.where.map((w) => resolveTokens(w, ti));
  const order = lane.order.map((s) => resolveTokens(s, ti));

  const hasToken = (tok) => lane.where.some((w) => w.includes(tok));
  // Modifiers append only when the lane didn't already bake the dimension in.
  if (opts.priority !== undefined && !hasToken('__PRIO__')) {
    where.push(`[Microsoft.VSTS.Common.Priority] = ${opts.priority}`);
  }
  if (opts.tag !== undefined && !hasToken('__TAG__')) {
    where.push(`[System.Tags] CONTAINS '${opts.tag}'`);
  }
  if (opts.since !== undefined && !hasToken('__SINCE__')) {
    where.push(`[System.ChangedDate] >= @Today - ${opts.since}`);
  }
  if (opts.area) {
    if (!ctx.areaPath) die(1, '--area requested but the chosen board has no areaPath in config.');
    where.push(`[System.AreaPath] UNDER '${ctx.project}\\${ctx.areaPath}'`);
  }
  for (const raw of opts.where) where.push(raw);

  let wiql = `SELECT ${select.join(', ')}\nFROM WorkItems\nWHERE ${where.join('\n  AND ')}`;
  if (order.length) wiql += `\nORDER BY ${order.join(', ')}`;
  return wiql;
}

function quoteForDisplay(args) {
  return args.map((a) => (/[\s'"\\[\]@]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a)).join(' ');
}

function runAz(args, print) {
  if (print) {
    process.stdout.write(`az ${quoteForDisplay(args)}\n`);
    return 0;
  }
  const r = spawnSync('az', args, { stdio: 'inherit' });
  if (r.error) {
    if (r.error.code === 'ENOENT') die(2, 'the `az` CLI was not found on PATH.');
    die(1, `failed to run az: ${r.error.message}`);
  }
  return r.status ?? 0;
}

function printHelp() {
  // The leading JSDoc block is the canonical help; echo a compact version.
  process.stdout.write([
    'ado-query — WIQL builder + `az boards query` runner (assistant-query §8/§8a)',
    '',
    'Usage:',
    '  ado-query <lane> [options]            run a named lane',
    '  ado-query --list                      list lanes grouped by board',
    '  ado-query details --id <ID>           show one work item',
    '  (portable, no install: node ado-query.mjs <lane> [options])',
    '',
    'Common options: --board personal|team  --priority N  --tag T  --assignee EMAIL',
    '  --changed-since-days N  --area  --where "CLAUSE"  --output table|json|tsv',
    '  --print-wiql  --config PATH',
    '',
    'Run `ado-query --list` for the lane catalog.',
    '',
  ].join('\n'));
}

function printList() {
  const byBoard = { personal: [], team: [] };
  for (const [name, l] of Object.entries(LANES)) byBoard[l.board].push([name, l.desc]);
  const fmt = (rows) => rows.map(([n, d]) => `  ${n.padEnd(18)} ${d}`).join('\n');
  process.stdout.write(
    `Personal board lanes (config.ado):\n${fmt(byBoard.personal)}\n\n` +
    `Team board lanes (config.teamBoard):\n${fmt(byBoard.team)}\n\n` +
    `Special:\n  details            show one work item (needs --id)\n`,
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (opts._.length === 0 && !opts.list)) { printHelp(); return; }
  if (opts.list) { printList(); return; }
  if (opts.board && !['personal', 'team'].includes(opts.board)) die(1, '--board must be personal or team');

  const laneName = opts._[0];

  // `details` is a direct work-item show, not a WIQL query.
  if (laneName === 'details') {
    if (!opts.id) die(1, 'details requires --id <ID>');
    const { cfg } = loadConfig(opts.config);
    const ctx = resolveBoard(cfg, opts.board || 'personal');
    const args = ['boards', 'work-item', 'show', '--id', String(opts.id),
      '--fields', DETAILS_FIELDS, '--org', ctx.org, '--project', ctx.project];
    process.exit(runAz(args, opts.print));
  }

  const lane = LANES[laneName];
  if (!lane) die(1, `unknown lane: ${laneName}\n  run \`ado-query --list\` for choices.`);
  if (laneName === 'by-tag' && opts.tag === undefined) die(1, 'by-tag requires --tag <tag>');

  const board = opts.board || lane.board;
  const { cfg } = loadConfig(opts.config);
  const ctx = resolveBoard(cfg, board);
  const wiql = buildWiql(lane, opts, board, ctx);

  if (opts.print) {
    process.stdout.write(`# lane: ${laneName}  board: ${board}  (${ctx.org} / ${ctx.project})\n`);
    process.stdout.write(`${wiql}\n\n`);
  }
  const args = ['boards', 'query', '--org', ctx.org, '--project', ctx.project, '--wiql', wiql, '-o', opts.output];
  process.exit(runAz(args, opts.print));
}

main();
