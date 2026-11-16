import { createInterface, emitKeypressEvents } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';
import path from 'node:path';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { safePath, protect, readPrivate, hash } from './onboarding/state.mjs';

export const label = value => stripVTControlCharacters(String(value)).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
export class SavedExit extends Error {}
const saved = () => new SavedExit('Your confirmed answers are saved. Run htmlpub setup to continue.');
const segments = new Intl.Segmenter('en', { granularity: 'grapheme' });
function cells(text) {
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text)) return 2;
  const c = text.codePointAt(0);
  if (/^\p{Mark}/u.test(text)) return 0;
  return c >= 0x1100 && (c <= 0x115f || c === 0x2329 || c === 0x232a ||
    (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe10 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x20000 && c <= 0x3fffd)) ? 2 : 1;
}
export function wrap(text, width) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '', used = 0;
    for (const { segment } of segments.segment(label(paragraph))) {
      const size = cells(segment);
      if (used + size > width && line) {
        const space = line.lastIndexOf(' ');
        if (space > 0) {
          lines.push(line.slice(0, space)); line = line.slice(space + 1);
          used = [...segments.segment(line)].reduce((sum, item) => sum + cells(item.segment), 0);
        } else { lines.push(line); line = ''; used = 0; }
      }
      line += segment; used += size;
    }
    lines.push(line);
  }
  return lines;
}
function clipped(text, width) {
  const lines = wrap(text, Math.max(1, width - 3));
  return lines.length > 1 ? `${lines[0]}...` : label(text);
}
export function terminal({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  let cancelActive, closed = false;
  const ui = {
    interactive: input.isTTY === true && output.isTTY === true,
    color: env.TERM !== 'dumb' && !Object.hasOwn(env, 'NO_COLOR'),
    paint(text, tone) {
      const codes = { prompt: 36, done: 32, warning: 33, error: 31, muted: 2 };
      return this.interactive && this.color && codes[tone] ? `\x1b[${codes[tone]}m${text}\x1b[0m` : text;
    },
    line(value, tone) {
      const text = String(value).split('\n').map(label).join('\n');
      const lines = text.split('\n').flatMap(paragraph => {
        const selectedTone = tone ?? (/^\[done\]/.test(paragraph) ? 'done' : /^\[(?:blocked|pending|warning)\]/.test(paragraph) ? 'warning' :
          /^\[error\]/.test(paragraph) ? 'error' : /^\[running\]/.test(paragraph) || /^htmlpub:/.test(paragraph) ? 'prompt' : undefined);
        return (this.interactive ? wrap(paragraph, Math.max(1, (output.columns || 80) - 1)) : [paragraph])
          .map(line => this.paint(line, selectedTone));
      });
      output.write(lines.join('\n') + '\n');
    },
    error(message) { this.line(`[error] ${label(message)}`, 'error'); },
    async ask(prompt, fallback) {
      requireInput();
      return new Promise((resolve, reject) => {
        const wasRaw = input.isRaw === true, wasPaused = input.isPaused();
        const editing = env.TERM !== 'dumb' && typeof input.setRawMode === 'function';
        const reader = createInterface({ input, output, terminal: editing, escapeCodeTimeout: 100 });
        let settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true; cancelActive = null;
          input.removeListener('keypress', escape);
          reader.close();
          if (typeof input.setRawMode === 'function') input.setRawMode(wasRaw);
          if (wasPaused || !wasRaw) input.pause();
          if (error) reject(error); else resolve(value);
        };
        const escape = (_text, key) => { if (key?.name === 'escape') finish(saved()); };
        cancelActive = () => finish(saved());
        reader.once('SIGINT', cancelActive);
        reader.once('close', () => finish(saved()));
        if (editing) input.on('keypress', escape);
        reader.question(this.paint(`${label(prompt)}${fallback === undefined ? '' : ` [${label(fallback)}]`}: `, 'prompt'), answer => {
          if ([':save', ':exit'].includes(answer.trim())) finish(saved());
          else finish(null, answer.trim() || fallback || '');
        });
      });
    },
    async select(prompt, items, selected = 0) {
      return menu(prompt, items, { selected, multiple: false });
    },
    async multiselect(prompt, items, { selected = [], min = 1, max = 20 } = {}) {
      return menu(prompt, items, { selected, multiple: true, min, max });
    },
    close() { cancelActive?.(); closed = true; },
  };
  function requireInput() {
    if (!ui.interactive) throw new Error('Input is redirected. Pass all required arguments or run this command in a terminal.');
    if (closed || input.readableEnded || input.destroyed) throw saved();
  }
  async function menu(prompt, items, { selected, multiple, min = 1, max = 20 }) {
    requireInput();
    if (!items.length) throw new Error('There are no choices here. Enter a known ID or ask the host owner for access.');
    if (!multiple && (!Number.isInteger(selected) || selected < 0 || selected >= items.length)) throw new Error('The saved selection is outside this menu.');
    if (multiple && (!Array.isArray(selected) || selected.some(index => !Number.isInteger(index) || !items[index]) ||
        !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || selected.length > max)) throw new Error('The saved selections are outside this menu.');
    if (env.TERM === 'dumb' || typeof input.setRawMode !== 'function') {
      ui.line(`${prompt}\nPlain terminal: enter ${multiple ? 'numbers separated by commas' : 'a number'}, or :save to exit.`);
      items.forEach((item, index) => ui.line(`  ${index + 1}. ${label(item.label)}`));
      const answer = await ui.ask(multiple ? 'Choice numbers' : 'Choice number', multiple ? undefined : String(selected + 1));
      const indices = answer.split(',').map(value => value.trim());
      if (indices.some(value => !/^[1-9][0-9]*$/.test(value) || !items[Number(value) - 1]) ||
          new Set(indices).size !== indices.length || (!multiple && indices.length !== 1) ||
          (multiple && (indices.length < min || indices.length > max))) throw new Error('Choose from the listed numbers. We have kept your earlier answers.');
      const values = indices.map(value => items[Number(value) - 1].value);
      return multiple ? values : values[0];
    }
    return new Promise((resolve, reject) => {
      const wasRaw = input.isRaw === true, wasPaused = input.isPaused();
      let active = multiple ? selected[0] ?? 0 : selected, rendered = 0, hidden = false, settled = false, warning = '';
      const checked = new Set(multiple ? selected : []);
      const clear = () => {
        if (rendered) output.write(`\x1b[${rendered}A\r\x1b[0J`);
        rendered = 0;
      };
      const draw = () => {
        const width = Math.max(1, (output.columns || 80) - 1), height = output.rows || 24;
        const redraw = width >= 32 && height >= 12;
        const hint = multiple ? 'Up/Down: move. Space: toggle. Enter: keep. Esc: save and exit.' :
          'Up/Down: move. Enter: choose. Esc: save and exit.';
        clear();
        if (redraw && !hidden) { output.write('\x1b[?25l'); hidden = true; }
        if (!redraw && hidden) { output.write('\x1b[?25h'); hidden = false; }
        const rows = [...wrap(prompt, width).map(line => ui.paint(line, 'prompt')),
          ...wrap(hint, width).map(line => ui.paint(line, 'muted'))];
        if (redraw) {
          const count = Math.min(5, items.length, Math.max(1, height - rows.length - 6));
          const start = Math.max(0, Math.min(active - Math.floor(count / 2), items.length - count));
          for (let index = start; index < start + count; index++) {
            const marker = `${index === active ? '>' : ' '} ${multiple ? checked.has(index) ? '[x] ' : '[ ] ' : ''}`;
            const text = marker + clipped(items[index].label, Math.max(1, width - marker.length));
            rows.push(ui.paint(text, index === active ? 'prompt' : undefined));
          }
          const detail = wrap(`Current: ${label(items[active].label)}`, width);
          const room = Math.max(1, height - rows.length - 3);
          rows.push(...detail.slice(0, room));
          if (detail.length > room) rows.push(ui.paint('(full value after Enter)', 'muted'));
        } else {
          rows.push(...wrap(`> ${multiple ? checked.has(active) ? '[x] ' : '[ ] ' : ''}${label(items[active].label)}`, width));
        }
        const footer = warning || `${active + 1} of ${items.length}${multiple ? `; ${checked.size} selected (choose ${min}-${max})` : ''}`;
        rows.push(...wrap(footer, width).map(line => ui.paint(line, warning ? 'warning' : 'muted')));
        output.write(rows.join('\n') + '\n');
        rendered = redraw ? rows.length : 0;
      };
      const finish = (error, result) => {
        if (settled) return;
        settled = true; cancelActive = null;
        input.removeListener('keypress', keypress); input.removeListener('end', ended); input.removeListener('close', ended);
        output.removeListener('resize', resize);
        try {
          try { clear(); if (hidden) output.write('\x1b[?25h'); }
          finally {
            try { input.setRawMode(wasRaw); }
            finally { if (wasPaused || !wasRaw) input.pause(); }
          }
        } catch (cleanupError) {
          error = error ? new AggregateError([error, cleanupError], 'Could not finish restoring the terminal.') : cleanupError;
        }
        if (error) reject(error);
        else {
          ui.line(`${label(prompt)}: ${multiple ? [...checked].sort((a, b) => a - b).map(index => label(items[index].label)).join(', ') : label(items[active].label)}`);
          resolve(result);
        }
      };
      const ended = () => finish(saved());
      const resize = () => {
        // A terminal can reflow old rows on resize. Start a new frame instead of moving into them.
        output.write('\n'); rendered = 0; redraw();
      };
      const redraw = () => { try { draw(); } catch (error) { finish(error); } };
      const keypress = (_text, key) => {
        if (!key) return;
        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { finish(saved()); return; }
        if (key.name === 'up' || key.name === 'down') {
          active = (active + (key.name === 'up' ? -1 : 1) + items.length) % items.length; warning = ''; redraw();
        } else if (multiple && key.name === 'space') {
          warning = '';
          if (checked.has(active)) checked.delete(active);
          else if (checked.size < max) checked.add(active);
          else warning = `Choose at most ${max}. Deselect one first.`;
          redraw();
        } else if (key.name === 'return' || key.name === 'enter') {
          if (multiple && checked.size < min) { warning = `Choose at least ${min}. Press Space to select.`; redraw(); return; }
          finish(null, multiple ? [...checked].sort((a, b) => a - b).map(index => items[index].value) : items[active].value);
        }
      };
      cancelActive = ended;
      try {
        emitKeypressEvents(input);
        input.on('keypress', keypress); input.once('end', ended); input.once('close', ended); output.on('resize', resize);
        input.setRawMode(true); input.resume(); redraw();
      } catch (error) { finish(error); }
    });
  }
  return ui;
}
export async function choose(ui, prompt, items, selected = 0) {
  if (!items.length) throw new Error(`No choices available for ${prompt}. Enter a known ID or ask the host owner for access.`);
  if (ui.select) return ui.select(prompt, items, selected);
  ui.line(prompt);
  items.forEach((item, index) => ui.line(`  ${index + 1}. ${label(item.label)}`));
  const answer = await ui.ask('Select number', String(selected + 1));
  const index = Number(answer) - 1;
  if (!/^[1-9][0-9]*$/.test(answer) || !items[index]) throw new Error('Choose one of the listed numbers. Your earlier answers are saved.');
  return items[index].value;
}
export async function chooseMany(ui, prompt, items, options) {
  if (!items.length) throw new Error(`No choices available for ${prompt}. Enter a known ID or ask the host owner for access.`);
  return ui.multiselect ? ui.multiselect(prompt, items, options) : [await choose(ui, prompt, items)];
}
export async function confirm(ui, phrase) {
  const answer = await ui.ask(`Type ${phrase} to approve, or :save to stop`);
  if (answer !== phrase) throw new SavedExit('Nothing was approved. Your earlier answers are saved.');
}
export function fields(ui, value, prefix = '') {
  for (const [key, item] of Object.entries(value ?? {})) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object') fields(ui, item, name);
    else ui.line(`  ${label(name)}: ${label(item)}`);
  }
}
export async function optionalPrivate(filename) {
  try { return await readPrivate(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
// Drafts and publication journals use the same path/ACL boundary as the inventory.
export async function savePrivate(filename, value, previous = null) {
  await safePath(filename);
  const parent = path.dirname(filename);
  try { await mkdir(parent, { mode: 0o700 }); await protect(parent, true); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await protect(parent); }
  const lockname = `${filename}.lock`;
  let lock;
  try { lock = await open(lockname, 'wx', 0o600); await protect(lockname, true); }
  catch (error) {
    if (lock) { await lock.close(); await unlink(lockname); }
    throw new Error('The private CLI state is locked. Keep the lock and check whether another setup or publishing process is still running.');
  }
  const temporary = `${filename}.${randomUUID()}.new`;
  let created = false;
  try {
    const current = await optionalPrivate(filename);
    if (hash(current) !== hash(previous)) throw new Error('Another process changed the private CLI state. Stop and resume from the saved version.');
    const file = await open(temporary, 'wx', 0o600); created = true;
    try { await protect(temporary, true); await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
    finally { await file.close(); }
    if (current) {
      const backup = `${filename}.previous`;
      await safePath(backup);
      const previousFile = await open(backup, 'w', 0o600);
      try { await protect(backup, true); await previousFile.writeFile(JSON.stringify(current, null, 2) + '\n'); await previousFile.sync(); }
      finally { await previousFile.close(); }
    }
    await rename(temporary, filename); created = false;
    if (process.platform !== 'win32') {
      const directory = await open(parent, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    if (created) await unlink(temporary);
    await lock.close(); await unlink(lockname);
  }
}
