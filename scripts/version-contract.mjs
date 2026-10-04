import { closeSync, openSync, readSync } from 'node:fs';

// Limits include JSON transport whitespace and apply to each Git output stream.
export const MAX_PLAN_BYTES = 8 * 1024 * 1024;
export const MAX_GIT_BYTES = MAX_PLAN_BYTES;

export function readBoundedText(pathOrFd) {
  const fd = typeof pathOrFd === 'number' ? pathOrFd : openSync(pathOrFd, 'r');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_PLAN_BYTES + 1 - size));
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      size += count;
      if (size > MAX_PLAN_BYTES) throw new Error(`Version data exceeds ${MAX_PLAN_BYTES} byte limit.`);
      chunks.push(chunk.subarray(0, count));
    }
    const bytes = Buffer.concat(chunks, size);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes)) throw new Error('Version data is not UTF-8.');
    return text;
  } finally {
    if (typeof pathOrFd !== 'number') closeSync(fd);
  }
}

export function serializePlan(plan) {
  const text = JSON.stringify(plan) + '\n';
  const size = Buffer.byteLength(text);
  if (size > MAX_PLAN_BYTES) {
    throw new Error(`Version plan exceeds ${MAX_PLAN_BYTES} byte limit: ${size} bytes.`);
  }
  return text;
}
