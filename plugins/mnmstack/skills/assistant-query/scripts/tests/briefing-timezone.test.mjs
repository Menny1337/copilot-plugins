import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const references = fileURLToPath(new URL('../../references/', import.meta.url));
const epoch = Date.parse('2026-01-05T01:00:00Z') / 1000;
const realDate = spawnSync('sh', ['-c', 'command -v date'], { encoding: 'utf8' }).stdout.trim();

function blocks(name) {
  return [...readFileSync(join(references, name), 'utf8').matchAll(/^```bash\n([\s\S]*?)^```/gm)]
    .map(match => match[1]);
}

function sandbox(t, timezone) {
  const root = mkdtempSync(join(tmpdir(), 'assistant-timezone-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(join(home, '.copilot', 'assistant'), { recursive: true });
  mkdirSync(bin);
  // Freeze the clock while retaining the platform date command's TZ/-u behavior.
  const clock = process.platform === 'darwin' ? '-r "$FIXED_EPOCH"' : '-d "@$FIXED_EPOCH"';
  writeFileSync(join(bin, 'date'), `#!/bin/sh\nexec "$REAL_DATE" ${clock} "$@"\n`, { mode: 0o755 });
  const env = {
    HOME: home, PATH: `${bin}:${process.env.PATH}`, TZ: timezone, LC_ALL: 'C',
    REAL_DATE: realDate, FIXED_EPOCH: String(epoch),
  };
  const run = script => {
    assert.equal(typeof script, 'string', 'expected an actual reference snippet');
    const result = spawnSync('bash', ['-c', script], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  return { home, run };
}

for (const [timezone, today, day, dom, dow, iso] of [
  ['America/Los_Angeles', '2026-01-04', 'Sunday', '04', '7', '2026-W01'],
  ['Etc/UTC', '2026-01-05', 'Monday', '05', '1', '2026-W02'],
]) {
  test(`briefing filenames and recurring reminders share the resolved ${timezone} date`, t => {
    const { home, run } = sandbox(t, timezone);
    const daily = blocks('daily-briefing.md').find(block => block.includes('daily/${today}-daily.md'));
    const weekly = blocks('weekly-briefing.md').find(block => block.includes('weekly/${iso}-weekly.md'));
    const reminder = blocks('reminders.md').find(block => block.includes('today_day='));
    assert.equal(run(`${daily}\nprintf '%s' "$file"`), join(home, '.copilot', 'assistant', 'briefings', 'daily', `${today}-daily.md`));
    assert.equal(run(`${weekly}\nprintf '%s' "$file"`), join(home, '.copilot', 'assistant', 'briefings', 'weekly', `${iso}-weekly.md`));
    assert.equal(run(`${reminder}\nprintf '%s|%s|%s' "$today_day" "$today_dom" "$today_dow"`), `${day}|${dom}|${dow}`);
  });
}

test('Markdown due and overdue snippets do not advance to the UTC date near midnight', t => {
  const { home, run } = sandbox(t, 'America/Los_Angeles');
  writeFileSync(join(home, '.copilot', 'assistant', 'tasks.md'), [
    '# Tasks', '## Active',
    '- [ ] **(P1)** Synthetic overdue task \u2014 due 2026-01-03',
    '- [ ] **(P2)** Synthetic due-today task \u2014 due 2026-01-04',
    '- [ ] **(P3)** Synthetic tomorrow task \u2014 due 2026-01-05',
  ].join('\n') + '\n');
  const snippets = blocks('markdown-tasks.md');
  const overdue = run(snippets.find(block => block.includes('OVERDUE:')));
  const due = run(snippets.find(block => block.includes('grep "due $today"')));
  assert.match(overdue, /Synthetic overdue task/);
  assert.doesNotMatch(overdue, /due-today|tomorrow/);
  assert.match(due, /Synthetic due-today task/);
  assert.doesNotMatch(due, /overdue|tomorrow/);
});
