import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const MAX_HTML = 1024 * 1024;
export const GUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,249}\.html$/;
export const SHA = /^[a-f0-9]{64}$/;
export class ManagerError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function fail(status, code, message) { throw new ManagerError(status, code, message); }
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function htmlBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_HTML) fail(413, 'html-size', 'Use 1 byte to 1 MiB of HTML.');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail(400, 'html-encoding', 'HTML must be valid UTF-8.'); }
  if (text.includes('\0') || !/<(?:!doctype\s+html|html)(?:\s|>)/i.test(text)) fail(400, 'html-document', 'Use a UTF-8 HTML document.');
  return bytes;
}
export async function safeDirectory(directory) {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory) fail(500, 'storage-path', 'Absolute normalized storage paths required.');
  let current = path.parse(directory).root;
  for (const component of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(500, 'storage-link', 'Storage and all parent directories must be real directories.');
  }
  return lstat(directory);
}
export async function readRegular(filename, limit = MAX_HTML) {
  await safeDirectory(path.dirname(filename));
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > limit) fail(409, 'unsafe-file', 'Regular, unlinked, bounded files required.');
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = await file.stat();
    if (!after.isFile() || after.nlink !== 1 || after.ino !== before.ino || after.dev !== before.dev) fail(409, 'file-changed', 'File changed during read.');
    const bytes = Buffer.alloc(limit + 1);
    let length = 0, count;
    do { ({ bytesRead: count } = await file.read(bytes, length, bytes.length - length, length)); length += count; } while (count && length < bytes.length);
    const end = await file.stat();
    if (length > limit || end.size !== length || end.mtimeMs !== after.mtimeMs || end.ctimeMs !== after.ctimeMs) fail(409, 'file-changed', 'File changed or exceeded its limit during read.');
    return { bytes: bytes.subarray(0, length), stat: end };
  } finally { await file.close(); }
}
export async function optionalFile(filename, limit) {
  try { return await readRegular(filename, limit); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function syncDirectory(directory) {
  const file = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await file.sync(); } finally { await file.close(); }
}
export async function durableFile(filename, bytes) {
  await safeDirectory(path.dirname(filename));
  const file = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  await syncDirectory(path.dirname(filename));
}
export function exactObject(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) {
    fail(400, 'request-schema', 'Request fields do not match the operation.');
  }
}
