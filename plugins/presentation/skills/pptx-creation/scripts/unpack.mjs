#!/usr/bin/env node

/**
 * unpack.mjs — Unpack and repack .pptx (OOXML ZIP) files for editing.
 *
 * Usage:
 *   node unpack.mjs presentation.pptx ./output-dir    # Unpack
 *   node unpack.mjs --pack ./output-dir result.pptx    # Repack
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const args = process.argv.slice(2);

function usage() {
  console.log(`
unpack.mjs — Unpack and repack PPTX files

Usage:
  Unpack:  node unpack.mjs <input.pptx> <output-dir>
  Repack:  node unpack.mjs --pack <input-dir> <output.pptx>

Examples:
  node unpack.mjs presentation.pptx ./edit-dir
  node unpack.mjs --pack ./edit-dir output.pptx
`);
  process.exit(1);
}

if (args.length < 2) usage();

if (args[0] === '--pack') {
  // Repack mode
  const inputDir = path.resolve(args[1]);
  const outputFile = path.resolve(args[2] || 'output.pptx');

  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    console.error(`❌ Directory not found: ${inputDir}`);
    process.exit(1);
  }

  // Remove existing output
  if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);

  // Zip contents (exclude hidden files)
  execFileSync('zip', ['-r', outputFile, '.', '-x', '.*', '__MACOSX/*', '.DS_Store'], {
    cwd: inputDir,
    stdio: 'inherit',
  });

  console.log(`✅ Packed ${outputFile}`);
} else {
  // Unpack mode
  const inputFile = path.resolve(args[0]);
  const outputDir = path.resolve(args[1]);

  if (!fs.existsSync(inputFile)) {
    console.error(`❌ File not found: ${inputFile}`);
    process.exit(1);
  }

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  // Unzip
  execFileSync('unzip', ['-o', inputFile, '-d', outputDir], { stdio: 'inherit' });

  console.log(`✅ Unpacked to ${outputDir}`);
  console.log(`\nFile structure:`);
  for (const file of listFiles(outputDir).slice(0, 30)) {
    console.log(path.relative(outputDir, file));
  }
}

function listFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(fullPath, files);
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}
