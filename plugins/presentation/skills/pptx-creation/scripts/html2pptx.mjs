#!/usr/bin/env node

/**
 * html2pptx — Convert HTML slide files into a PowerPoint presentation.
 *
 * Renders each HTML file with Playwright, takes a screenshot, and packages
 * all slides into a .pptx using PptxGenJS.
 *
 * Usage (CLI):
 *   node html2pptx.mjs --slides s1.html s2.html --output deck.pptx
 *   node html2pptx.mjs --slides s1.html s2.html --notes "Note 1" "Note 2" --output deck.pptx
 *   node html2pptx.mjs --slides s1.html --title "My Deck" --author "Name" --output deck.pptx
 *
 * Usage (programmatic):
 *   import { buildPresentation } from './html2pptx.mjs';
 *   await buildPresentation({ slides: [...], output: 'deck.pptx' });
 */

import { chromium } from 'playwright';
import PptxGenJS from 'pptxgenjs';
import path from 'path';
import fs from 'fs';
import { parseArgs } from 'util';

// ─── Core: Build Presentation ────────────────────────────────────────────────

/**
 * Build a PPTX from HTML slide files.
 *
 * @param {Object} options
 * @param {Array<{html: string, notes?: string}>} options.slides - Slide definitions
 * @param {string} options.output - Output .pptx file path
 * @param {string} [options.title] - Presentation title metadata
 * @param {string} [options.author] - Presentation author metadata
 * @param {string} [options.layout='LAYOUT_16x9'] - Slide layout
 * @param {number} [options.width=1280] - Viewport width for rendering
 * @param {number} [options.height=720] - Viewport height for rendering
 * @returns {Promise<string>} - Path to the created PPTX file
 */
export async function buildPresentation(options) {
  const {
    slides,
    output,
    title = '',
    author = '',
    layout = 'LAYOUT_16x9',
    width = 1280,
    height = 720
  } = options;

  if (!slides || slides.length === 0) {
    throw new Error('No slides provided.');
  }
  if (!output) {
    throw new Error('No output path provided.');
  }

  // Initialize PptxGenJS
  const pptx = new PptxGenJS();
  pptx.layout = layout;
  if (title) pptx.title = title;
  if (author) pptx.author = author;

  // Launch browser
  const launchOpts = {};
  if (process.platform === 'darwin') {
    launchOpts.channel = 'chrome'; // More reliable on macOS
  }
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });

  const tmpFiles = [];

  try {
    for (let i = 0; i < slides.length; i++) {
      const slideDef = slides[i];
      const htmlPath = path.resolve(slideDef.html);

      if (!fs.existsSync(htmlPath)) {
        throw new Error(`Slide file not found: ${htmlPath}`);
      }

      // Navigate and wait for content to settle
      await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });

      // Validate no overflow
      const overflow = await page.evaluate(() => {
        const b = document.body;
        return {
          scrollW: b.scrollWidth,
          scrollH: b.scrollHeight,
          w: b.offsetWidth,
          h: b.offsetHeight
        };
      });

      if (overflow.scrollW > overflow.w + 2 || overflow.scrollH > overflow.h + 2) {
        console.warn(
          `⚠️  Slide ${i + 1} (${path.basename(htmlPath)}) overflows: ` +
          `content ${overflow.scrollW}×${overflow.scrollH} > body ${overflow.w}×${overflow.h}`
        );
      }

      // Screenshot
      const pngPath = htmlPath.replace(/\.html?$/i, `.slide${i + 1}.png`);
      await page.screenshot({ path: pngPath });
      tmpFiles.push(pngPath);

      // Add slide
      const slide = pptx.addSlide();
      slide.background = { path: pngPath };

      // Speaker notes
      if (slideDef.notes) {
        slide.addNotes(slideDef.notes);
      }

      console.log(`  ✓ Slide ${i + 1}: ${path.basename(htmlPath)}`);
    }

    // Write PPTX
    const outputPath = path.resolve(output);
    await pptx.writeFile({ fileName: outputPath });
    console.log(`\n✅ Created ${outputPath} (${slides.length} slides)`);

    return outputPath;
  } finally {
    await browser.close();

    // Clean up temporary PNGs
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      slides: { type: 'string', multiple: true, short: 's' },
      notes: { type: 'string', multiple: true, short: 'n' },
      output: { type: 'string', short: 'o' },
      title: { type: 'string', short: 't' },
      author: { type: 'string', short: 'a' },
      width: { type: 'string', default: '1280' },
      height: { type: 'string', default: '720' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false,
    strict: false
  });

  if (values.help || !values.slides || !values.output) {
    console.log(`
html2pptx — Convert HTML slides to PowerPoint

Usage:
  node html2pptx.mjs --slides slide1.html slide2.html --output deck.pptx

Options:
  -s, --slides   HTML files (one per slide, in order)
  -n, --notes    Speaker notes (one per slide, matching order)
  -o, --output   Output .pptx file path
  -t, --title    Presentation title (metadata)
  -a, --author   Presentation author (metadata)
  --width        Viewport width (default: 1280)
  --height       Viewport height (default: 720)
  -h, --help     Show this help
`);
    process.exit(values.help ? 0 : 1);
  }

  const slideFiles = values.slides;
  const notesList = values.notes || [];

  const slides = slideFiles.map((html, i) => ({
    html,
    notes: notesList[i] || undefined
  }));

  await buildPresentation({
    slides,
    output: values.output,
    title: values.title || '',
    author: values.author || '',
    width: parseInt(values.width, 10),
    height: parseInt(values.height, 10)
  });
}

// Run CLI if executed directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch(err => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}
