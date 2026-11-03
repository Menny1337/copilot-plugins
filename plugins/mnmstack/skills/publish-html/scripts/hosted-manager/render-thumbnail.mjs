#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { htmlBytes, readRegular, durableFile, digest } from './common.mjs';
import { pngInfo, MAX_PNG } from './png.mjs';

export function parseRenderArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--file', '--output', '--playwright-module', '--browser-channel'].includes(key) ||
        Object.hasOwn(options, key.slice(2)) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Use --file <report.html> --output <new.png> [--playwright-module <absolute-module-path>] [--browser-channel msedge|chrome].');
    options[key.slice(2)] = args[++index];
  }
  if (!options.file || !options.output || (options['browser-channel'] && !['msedge', 'chrome'].includes(options['browser-channel'])) ||
      (options['playwright-module'] && !path.isAbsolute(options['playwright-module']))) throw new Error('Explicit HTML file/new PNG output and supported local browser/module paths required.');
  return options;
}
export async function renderThumbnail(options, { loadBrowser = specifier => import(specifier) } = {}) {
  const bytes = htmlBytes((await readRegular(path.resolve(options.file))).bytes);
  const output = path.resolve(options.output);
  if (!output.endsWith('.png')) throw new Error('Use a new .png output file. Existing files are never overwritten.');
  let module;
  try { module = await loadBrowser(options['playwright-module'] ? pathToFileURL(options['playwright-module']).href : 'playwright'); }
  catch { throw new Error('Publisher-side Playwright is unavailable. Use an already installed local module via --playwright-module, or supply a reviewed PNG. No tooling was installed and nothing was published.'); }
  let browser;
  try {
    browser = await module.chromium.launch({ headless: true, ...(options['browser-channel'] ? { channel: options['browser-channel'] } : {}) });
    const context = await browser.newContext({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 1,
      javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
    const page = await context.newPage();
    const target = 'https://publisher-thumbnail.invalid/report.html';
    await context.route('**/*', route => {
      if (route.request().url() !== target || !route.request().isNavigationRequest() || route.request().frame() !== page.mainFrame()) return route.abort();
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: bytes,
        headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'",
          'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' } });
    });
    await page.goto(target, { waitUntil: 'load', timeout: 15000 });
    if (page.url() !== target) throw new Error('Report navigation refused during local capture.');
    const png = Buffer.from(await page.screenshot({ type: 'png', fullPage: false, timeout: 15000 }));
    const metadata = { htmlSha256: digest(bytes), ...pngInfo(png) };
    await durableFile(output, png);
    if (digest((await readRegular(output, MAX_PNG)).bytes) !== metadata.sha256) throw new Error('Local PNG readback failed. Do not publish it.');
    return { output, ...metadata, scriptsEnabled: false, externalResources: 'blocked', reviewRequired: true };
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('PNG output already exists. Select a new output path; no file was overwritten.');
    throw new Error('Local thumbnail capture failed. Review the report, local browser availability and PNG limits; nothing was published.');
  } finally { if (browser) await browser.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--help') console.log('Optional publisher-only local capture. --file <report.html> --output <new.png> [--playwright-module <installed-module>] [--browser-channel msedge|chrome]. Scripts and external report resources are disabled; no credentials or user profile is supplied. Review the static viewport PNG and use its htmlSha256 with publish.mjs. Supply a reviewed PNG separately for reports requiring JavaScript. No host renderer, install or publish occurs.');
  else {
    try { console.log(JSON.stringify(await renderThumbnail(parseRenderArgs(process.argv.slice(2))))); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
