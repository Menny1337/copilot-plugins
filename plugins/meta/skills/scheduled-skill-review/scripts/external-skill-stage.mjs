#!/usr/bin/env node
/**
 * Safely stages and applies an in-place review of an external SKILL.md.
 *
 * The reviewer works on a private copy so a failed run never touches the source.
 * Apply succeeds only when the original SKILL.md is unchanged and the reviewer
 * modified no staged files other than SKILL.md.
 */
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, renameSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { isValidSkillName, readSkillName } from './lib.mjs';

const args = process.argv.slice(2);
const command = args.shift() || '';

function fail(message, code = 2) {
  console.error(`external-skill-stage: ${message}`);
  process.exit(code);
}

function flag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredFlag(name) {
  const value = flag(name);
  if (!value) fail(`${name} is required`);
  return resolve(value);
}

function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function validateSkill(path) {
  if (basename(path) !== 'SKILL.md') fail(`expected a SKILL.md file: ${path}`);
  let stat;
  try { stat = lstatSync(path); } catch { fail(`file not found: ${path}`); }
  if (stat.isSymbolicLink()) fail(`SKILL.md must not be a symbolic link: ${path}`);
  if (!stat.isFile()) fail(`not a file: ${path}`);
  const name = readSkillName(path);
  if (!name) fail(`missing scalar name frontmatter: ${path}`);
  if (!isValidSkillName(name)) fail(`invalid skill name frontmatter: ${name}`);
  return { name, stat };
}

const resultFilePattern = /^\.review-result(?:\.json|\.json\.tmp)$/;

function snapshot(root) {
  const files = {};

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (resultFilePattern.test(entry.name)) continue;
      const absolute = join(directory, entry.name);
      const relativePath = relative(root, absolute).split(sep).join('/');
      if (entry.isSymbolicLink()) {
        files[relativePath] = `symlink:${readlinkSync(absolute)}`;
      } else if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        files[relativePath] = fileHash(absolute);
      }
    }
  }

  walk(root);
  return files;
}

function changedPaths(before, after, allowed = new Set()) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths]
    .filter((path) => !allowed.has(path) && before[path] !== after[path])
    .sort();
}

function stage() {
  const source = requiredFlag('--source');
  const destination = requiredFlag('--destination');
  const manifest = requiredFlag('--manifest');
  const { name, stat } = validateSkill(source);
  if (existsSync(destination)) fail(`destination already exists: ${destination}`);

  mkdirSync(dirname(destination), { recursive: true });
  mkdirSync(destination);
  const stagedSkill = join(destination, 'SKILL.md');
  writeFileSync(stagedSkill, readFileSync(source), {
    flag: 'wx',
    mode: stat.mode,
  });
  validateSkill(stagedSkill);
  const payload = {
    schema: 'external-skill-stage/1',
    name,
    source,
    sourceRealPath: realpathSync(source),
    sourceHash: fileHash(source),
    files: snapshot(destination),
  };
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ name, stagedSkill, sourceHash: payload.sourceHash })}\n`);
}

function apply() {
  const stagedSkill = requiredFlag('--staged-skill');
  const source = requiredFlag('--source');
  const manifestPath = requiredFlag('--manifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const staged = validateSkill(stagedSkill);
  const current = validateSkill(source);

  if (manifest.schema !== 'external-skill-stage/1' || manifest.source !== source) {
    fail('stage manifest does not match the selected source');
  }
  if (manifest.sourceRealPath !== realpathSync(source)) {
    fail('the selected SKILL.md now resolves to a different file');
  }
  if (staged.name !== current.name || staged.name !== manifest.name) {
    fail('skill name changed during review');
  }
  if (fileHash(source) !== manifest.sourceHash) {
    fail('the original SKILL.md changed while the review was running');
  }

  const unexpected = changedPaths(
    manifest.files || {},
    snapshot(dirname(stagedSkill)),
    new Set(['SKILL.md'])
  );
  if (unexpected.length) {
    fail(`review changed unsupported files: ${unexpected.join(', ')}`);
  }

  const stagedHash = fileHash(stagedSkill);
  if (stagedHash === manifest.sourceHash) {
    process.stdout.write(`${JSON.stringify({ changed: false, name: staged.name })}\n`);
    return;
  }

  const temporary = join(dirname(source), `.SKILL.md.review-${process.pid}.tmp`);
  writeFileSync(temporary, readFileSync(stagedSkill), { mode: current.stat.mode });
  renameSync(temporary, source);
  process.stdout.write(`${JSON.stringify({
    changed: true,
    name: staged.name,
    before: manifest.sourceHash,
    after: stagedHash,
  })}\n`);
}

switch (command) {
  case 'stage':
    stage();
    break;
  case 'apply':
    apply();
    break;
  default:
    fail('usage: stage|apply');
}
