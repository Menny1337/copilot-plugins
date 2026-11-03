import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { pngInfo, MAX_PNG, thumbnailInput, crc32 } from '../png.mjs';
import { thumbnailUrl, sameThumbnail } from '../client-protocol.mjs';
import { png, pngChunk, html, thumbnail, fixture } from './test-support.mjs';
import { digest } from '../common.mjs';
import { parseRenderArgs, renderThumbnail } from '../render-thumbnail.mjs';

test('PNG parser validates signature, CRC, bounded dimensions, IDAT inflate/filter and terminal IEND', () => {
  const image = png();
  assert.deepEqual(pngInfo(image), { sha256: digest(image), size: image.length, width: 32, height: 20 });
  const badCrc = Buffer.from(image); badCrc[badCrc.length - 1] ^= 1;
  const nonAsciiType = Buffer.from(image); nonAsciiType[12] |= 0x80;
  nonAsciiType.writeUInt32BE(crc32(nonAsciiType.subarray(12, 29)), 29);
  const alteredHeader = change => {
    const header = Buffer.from(image.subarray(16, 29)); change(header);
    return Buffer.concat([image.subarray(0, 8), pngChunk('IHDR', header), image.subarray(33)]);
  };
  const invalid = [Buffer.from('not PNG'), image.subarray(0, 25), badCrc, nonAsciiType, Buffer.concat([image, Buffer.from('trailing')]),
    Buffer.alloc(MAX_PNG + 1), png(40, 1601, 1), png(40, 1, 1201), alteredHeader(header => { header[12] = 1; }),
    alteredHeader(header => { header[9] = 3; }), alteredHeader(header => { header[8] = 16; }),
    Buffer.concat([image.subarray(0, 33), pngChunk('acTL', Buffer.alloc(8)), image.subarray(33)]),
    Buffer.concat([image.subarray(0, 33), pngChunk('IDAT', deflateSync(Buffer.alloc(10))), pngChunk('IEND', Buffer.alloc(0))]),
    Buffer.concat([image.subarray(0, 33), pngChunk('IDAT', deflateSync(Buffer.alloc(100000))), pngChunk('IEND', Buffer.alloc(0))]),
    Buffer.concat([image.subarray(0, 33), pngChunk('IDAT', deflateSync(Buffer.alloc((32 * 3 + 1) * 20, 9))), pngChunk('IEND', Buffer.alloc(0))]),
  ];
  for (const value of invalid) assert.throws(() => pngInfo(value), { code: 'thumbnail-png' });
  const body = thumbnail(html('actual'));
  assert.equal(thumbnailInput(body, digest(html('actual'))).metadata.htmlSha256, digest(html('actual')));
  assert.throws(() => thumbnailInput(body, digest(html('other'))), { code: 'thumbnail-binding' });
  assert.throws(() => thumbnailInput({ ...body, pngBase64: body.pngBase64 + '\n' }, body.htmlSha256), { code: 'thumbnail-fields' });
});
test('client permits only authenticated manager PNG route and exact version/hash metadata', () => {
  const image = { ...pngInfo(png()), htmlSha256: digest(html('x')) };
  const version = { sha256: image.htmlSha256, thumbnail: { ...image,
    url: `/_manager/api/thumbnail/99999999-9999-4999-8999-999999999999/after/${image.sha256}.png` } };
  assert.equal(thumbnailUrl(version), version.thumbnail.url);
  assert.equal(sameThumbnail(image, version.thumbnail), true);
  assert.equal(sameThumbnail(null, undefined), true);
  for (const change of [{ htmlSha256: 'a'.repeat(64) }, { sha256: 'b'.repeat(64) }, { size: MAX_PNG + 1 }, { width: 1601 },
    { url: 'https://other.test/report.png' }, { url: '/report.html' }, { url: '/_manager/api/thumbnail/../x.png' }]) {
    assert.throws(() => thumbnailUrl({ ...version, thumbnail: { ...version.thumbnail, ...change } }));
  }
});
test('optional local capture uses snapshot, no scripts/credentials, blocks other requests, verifies PNG and refuses overwrite', async t => {
  const { root } = await fixture(t);
  const file = path.join(root, 'report.html'), output = path.join(root, 'preview.png');
  await writeFile(file, html('actual'));
  const options = parseRenderArgs(['--file', file, '--output', output]);
  assert.throws(() => parseRenderArgs(['--file', file, '--output', output, '--allow-scripts']));
  await assert.rejects(renderThumbnail(options, { loadBrowser: async () => { throw new Error('module missing'); } }), /Playwright is unavailable/);
  let closed = false, routed, contextOptions, fulfilled;
  const mainFrame = {};
  const page = { mainFrame: () => mainFrame, goto: async url => {
    await routed({ request: () => ({ url: () => url, isNavigationRequest: () => true, frame: () => mainFrame }), fulfill: async value => { fulfilled = value; } });
    await writeFile(file, html('changed-after-snapshot'));
  }, url: () => 'https://publisher-thumbnail.invalid/report.html', screenshot: async () => png() };
  const deps = { loadBrowser: async () => ({ chromium: { launch: async () => ({
    newContext: async options => { contextOptions = options; return { newPage: async () => page, route: async (glob, work) => { routed = work; } }; },
    close: async () => { closed = true; },
  }) } }) };
  const result = await renderThumbnail(options, deps);
  assert.equal(result.htmlSha256, digest(html('actual')));
  assert.equal(result.reviewRequired, true); assert.equal(contextOptions.javaScriptEnabled, false);
  assert.equal(contextOptions.serviceWorkers, 'block'); assert.equal(closed, true);
  assert.equal(fulfilled.body.toString(), html('actual').toString());
  assert.match(fulfilled.headers['Content-Security-Policy'], /default-src 'none'/);
  let blocked = false;
  await routed({ request: () => ({ url: () => 'https://other.test/secret' }), abort: async () => { blocked = true; } });
  assert.equal(blocked, true);
  await assert.rejects(renderThumbnail(options, deps), /already exists/);
  assert.deepEqual(await readFile(output), png());
});
