import { inflateSync } from 'node:zlib';
import { fail, digest, SHA, exactObject } from './common.mjs';
import { MAX_PNG_BYTES } from './client-protocol.mjs';

export const MAX_PNG = MAX_PNG_BYTES;
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function pngInfo(bytes) {
  const invalid = () => fail(400, 'thumbnail-png', 'Use a valid non-animated, non-interlaced 8-bit grayscale/RGB/RGBA PNG, at most 256 KiB and 1600 by 1200 pixels.');
  if (!Buffer.isBuffer(bytes) || bytes.length < 57 || bytes.length > MAX_PNG || !bytes.subarray(0, 8).equals(SIGNATURE)) invalid();
  let offset = 8, width, height, channels, ended = false, dataEnded = false;
  const data = [], seen = new Set();
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid();
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!bytes.subarray(offset + 4, offset + 8).every(byte => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)) ||
        length > MAX_PNG || offset + length + 12 > bytes.length ||
        crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) invalid();
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (!seen.size && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (seen.has(type) || length !== 13) invalid();
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[chunk[9]];
      if (!width || !height || width > 1600 || height > 1200 || !channels ||
          chunk[8] !== 8 || chunk[10] !== 0 || chunk[11] !== 0 || chunk[12] !== 0) invalid();
    } else if (type === 'IDAT') {
      if (dataEnded || !length) invalid();
      data.push(chunk);
    } else if (type === 'IEND') {
      if (length || !data.length) invalid();
      ended = true;
    } else {
      const ancillary = { sRGB: 1, gAMA: 4, cHRM: 32, pHYs: 9 };
      if (!Object.hasOwn(ancillary, type) || length !== ancillary[type] || seen.has(type) || data.length) invalid();
      if ((type === 'sRGB' && chunk[0] > 3) || (type === 'gAMA' && chunk.readUInt32BE(0) === 0) ||
          (type === 'pHYs' && chunk[8] > 1)) invalid();
    }
    if (type !== 'IDAT' && data.length) dataEnded = true;
    seen.add(type); offset += length + 12;
    if (ended) break;
  }
  if (!ended || offset !== bytes.length) invalid();
  const stride = width * channels + 1, expected = stride * height;
  let raw;
  try { raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected, info: true }); }
  catch { invalid(); }
  if (raw.buffer.length !== expected || raw.engine.bytesWritten !== data.reduce((sum, item) => sum + item.length, 0)) invalid();
  for (let row = 0; row < height; row++) if (raw.buffer[row * stride] > 4) invalid();
  return { sha256: digest(bytes), size: bytes.length, width, height };
}
export function validThumbnail(value, htmlSha256) {
  return value === null || (value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'height,htmlSha256,sha256,size,width' &&
    SHA.test(htmlSha256 ?? '') && value.htmlSha256 === htmlSha256 && SHA.test(value.sha256 ?? '') &&
    Number.isInteger(value.size) && value.size >= 57 && value.size <= MAX_PNG &&
    Number.isInteger(value.width) && value.width > 0 && value.width <= 1600 &&
    Number.isInteger(value.height) && value.height > 0 && value.height <= 1200);
}
export function thumbnailInput(value, htmlSha256) {
  exactObject(value, ['htmlSha256', 'pngBase64']);
  if (!SHA.test(value.htmlSha256 ?? '') || value.htmlSha256 !== htmlSha256) fail(400, 'thumbnail-binding', 'Thumbnail must declare the exact supplied HTML SHA-256.');
  if (typeof value.pngBase64 !== 'string' || value.pngBase64.length > Math.ceil(MAX_PNG / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.pngBase64)) fail(400, 'thumbnail-fields', 'Bounded canonical base64 PNG required.');
  const bytes = Buffer.from(value.pngBase64, 'base64');
  if (bytes.toString('base64') !== value.pngBase64) fail(400, 'thumbnail-fields', 'Canonical base64 PNG required.');
  return { bytes, metadata: { htmlSha256, ...pngInfo(bytes) } };
}
