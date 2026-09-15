import { readFileSync } from 'node:fs';

const GENERIC = [
  { name: 'corporate email', re: /\b[A-Z0-9._%+-]+@[a-z0-9.-]*microsoft\.com/i },
  {
    name: 'absolute macOS user path',
    re: /\/Users\/(?!(?:<[^>]+>|USERNAME|user|you|your-managed-account)(?:\/|\s|["'`]|$))[^/\s"'`<>]+/i,
  },
  {
    name: 'absolute Linux user path',
    re: /\/home\/(?!(?:<[^>]+>|USERNAME|user|you)(?:\/|\s|["'`]|$)|site\/wwwroot(?:\/|\s|["'`]|$))[^/\s"'`<>]+/i,
  },
  {
    name: 'absolute Windows user path',
    re: /\b[A-Z]:\\+Users\\+(?!(?:<[^>]+>|USERNAME|user|you)(?:\\|\s|["'`]|$))[^\\/\s"'`<>]+/i,
  },
  { name: 'private key', re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/ },
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { name: 'AWS access key', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'internal package feed', re: /ms-feed-[a-z0-9-]+\.pkgs\.visualstudio\.com/i },
];

const BRANDING = [
  { name: ' branding', re: /\bmnm-[a-z]/ },
  { name: 'plugins_ branding', re: /\bmnm_[a-z]/ },
  { name: 'COPILOT_PLUGIN_ branding', re: /\bMNM_/ },
];

const MARKERS = /<!-- mnm:(?:catalog|plugin-readme):(?:start|end) -->/g;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parsePrivatePolicy(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.rules) || !value.rules.length) {
    throw new Error('Privacy policy must have version 1 and a nonempty rules array.');
  }
  const ids = new Set();
  return value.rules.map((rule) => {
    if (!rule || typeof rule.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(rule.id) || ids.has(rule.id)
      || typeof rule.value !== 'string' || !rule.value.length
      || rule.value.length > 1024 || /[\r\n\0]/.test(rule.value)
      || (rule.boundary !== undefined && typeof rule.boundary !== 'boolean')
      || (rule.caseSensitive !== undefined && typeof rule.caseSensitive !== 'boolean')
      || (rule.replacement !== undefined && typeof rule.replacement !== 'string')) {
      throw new Error('Invalid privacy policy rule; use unique IDs and literal, single-line values.');
    }
    ids.add(rule.id);
    const literal = escapeRegex(rule.value);
    const pattern = rule.boundary ? `(?<![\\w-])${literal}(?![\\w-])` : literal;
    return { name: `private:${rule.id}`, re: new RegExp(pattern, rule.caseSensitive ? '' : 'i'), replacement: rule.replacement };
  });
}

export function loadPrivatePolicy(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Cannot read privacy policy as JSON. Its contents have not been printed.');
  }
  return parsePrivatePolicy(value);
}

export function residualGuardNames(text, { policy = [], branding = true } = {}) {
  const probe = text.replace(MARKERS, '');
  return [...GENERIC, ...(branding ? BRANDING : []), ...policy]
    .filter(({ re }) => re.test(probe)).map(({ name }) => name);
}

export function redactPrivateDetails(text, policy = []) {
  let result = text;
  for (const { re } of [...GENERIC, ...policy]) {
    result = result.replace(new RegExp(re.source, `${re.flags}g`), '[redacted]');
  }
  return result;
}

export function applyPrivateReplacements(text, policy) {
  let result = text;
  for (const { re, replacement } of policy) {
    if (replacement !== undefined) {
      result = result.replace(new RegExp(re.source, `${re.flags}g`), () => replacement);
    }
  }
  return result;
}
