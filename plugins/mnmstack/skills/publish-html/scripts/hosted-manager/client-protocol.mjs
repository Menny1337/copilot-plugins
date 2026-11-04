export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MAX_PNG_BYTES = 256 * 1024;
const GUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
export function sameThumbnail(left, right) {
  if (!left || !right) return (left ?? null) === (right ?? null);
  return ['htmlSha256', 'sha256', 'size', 'width', 'height'].every(key => left[key] === right[key]);
}
export function thumbnailUrl(version) {
  const image = version?.thumbnail;
  if (image === null || image === undefined) return null;
  const match = /^\/_manager\/api\/thumbnail\/([a-f0-9-]{36})\/(before|after)\/([a-f0-9]{64})\.png$/.exec(image.url ?? '');
  if (!match || !GUID.test(match[1]) || image.htmlSha256 !== version.sha256 || !SHA.test(image.htmlSha256 ?? '') ||
      image.sha256 !== match[3] || !Number.isInteger(image.size) || image.size < 57 || image.size > MAX_PNG_BYTES ||
      !Number.isInteger(image.width) || image.width < 1 || image.width > 1600 ||
      !Number.isInteger(image.height) || image.height < 1 || image.height > 1200) throw new Error('Invalid version-linked thumbnail metadata.');
  return image.url;
}
const REMEDIATION = Object.freeze({
  'version-conflict': 'No report change was made by this request. Refresh inventory and review the current destination version.',
  'name-collision': 'No report change was made by this request. Select a filename without a case collision.',
  'backup-conflict': 'No report change was made by this request. Refresh inventory and select a verified backup.',
  'backup-expired': 'No report change was made by this request. The selected backup is outside the restore window.',
  'content-quota': 'No report change was made by this request. Ask the host owner to review the content quota.',
  'state-quota': 'No report change was made by this request. Ask the host owner to review evidence retention and storage quota.',
  'writer-locked': 'No report change was made by this request. Another writer or interrupted operation owns the lock; ask the host owner to inspect it. Never steal the lock.',
  'mutations-disabled': 'No report change was made by this request. Publishing is paused until approved activation.',
  'own-api-disabled': 'No report change was made by this request. Own-API publishing is not activated.',
  'obo-consent-or-policy': 'No report change was made by this request. Ask the host owner to review OBO consent, claims challenges and tenant policy; do not fall back to Kudu.',
});
const INPUT = ['request-schema', 'mutation-fields', 'html-payload', 'html-size', 'html-encoding', 'html-document', 'thumbnail-png', 'thumbnail-fields', 'thumbnail-binding', 'thumbnail-conflict', 'request-json', 'request-size', 'manager-origin', 'manager-request', 'method-route'];
const AUTH = ['principal', 'principal-claims', 'principal-binding', 'principal-user', 'tenant', 'manager', 'bearer', 'native-credentials', 'native-binding', 'jwt-format', 'jwt-algorithm', 'jwt-signature', 'jwt-claims', 'jwt-keys', 'graph-token', 'graph-binding', 'graph-response', 'reader', 'graph-unavailable', 'keys-unavailable', 'mi-config', 'identity-unavailable', 'mi-response', 'obo-unavailable', 'obo-response', 'auth-response'];
const STATE = ['journal-quota', 'journal-entry', 'journal-torn', 'journal-sequence', 'journal-link', 'transaction-pending', 'inventory-quota', 'inventory-names', 'backup-corrupt', 'thumbnail-corrupt', 'unsafe-file', 'file-changed', 'storage-path', 'storage-link'];
export class ClientError extends Error {
  constructor(code, message, outcome, transactionId = null) {
    super(message); this.code = code; this.outcome = outcome; this.transactionId = transactionId;
  }
}
export function uncertainFailure(transactionId = null) {
  const id = typeof transactionId === 'string' && GUID.test(transactionId) ? transactionId : null;
  return new ClientError('outcome-uncertain',
    `Mutation outcome is uncertain.${id ? ` Transaction ${id}.` : ''} Do not retry blindly. Inspect inventory and have the host owner review the private transaction evidence.`,
    'uncertain', id);
}
export function transportFailure(mutation) {
  return mutation ? uncertainFailure() : new ClientError('inventory-unavailable', 'Inventory could not be verified. No mutation was sent by this request. Check connectivity and sign-in, then refresh.', 'not-sent');
}
export function responseFailure(status, data, mutation) {
  const code = typeof data?.code === 'string' ? data.code : '';
  if (code === 'outcome-uncertain' && status === 503 && mutation) return uncertainFailure(data.transactionId);
  const remediation = (Object.hasOwn(REMEDIATION, code) ? REMEDIATION[code] : null) ??
    (INPUT.includes(code) ? 'No report change was made by this request. Correct the request and refresh the reviewed selection.' :
      AUTH.includes(code) ? 'No report change was made by this request. Resolve sign-in or host authorization configuration before retrying; no fallback is permitted.' :
        STATE.includes(code) ? 'No report change was made by this request. Ask the host owner to inspect storage or existing transaction evidence before continuing.' : null);
  if (remediation && status >= 400 && status <= 599) return new ClientError(code, `Manager refused the request (${code}, HTTP ${status}). ${remediation}`, 'denied');
  return transportFailure(mutation);
}
export async function readResponse(response, maxBytes = MAX_RESPONSE_BYTES) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Response limit exceeded.');
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
