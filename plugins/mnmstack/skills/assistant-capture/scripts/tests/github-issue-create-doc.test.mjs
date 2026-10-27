#!/usr/bin/env node
// github-issue-create-doc.test.mjs — regression coverage for the "Add a Task"
// `gh issue create` invocation documented in references/github-tasks.md §3.6.2
// (finding 3). Extracts the ACTUAL fenced bash step from that reference (not a
// reimplementation), fills its `<placeholder>` tokens with concrete test
// values, and executes it against a fake `gh` that rejects any invocation
// carrying `--query`/`-o` (flags `gh issue create` does not support) — the
// same way the real CLI would reject them. This proves:
//   1. `gh issue create` is invoked exactly once (never a `||` fallback that
//      would silently create a second issue with a truncated, marker-less
//      body — the finding's core bug).
//   2. The single retained invocation still carries the full, marker-bearing
//      body (the `clientCaptureId` idempotency comment survives).
//   3. The documented retry guidance re-runs the dedupe search rather than
//      blindly re-issuing the raw create (so a transient-failure retry can
//      never duplicate an issue that actually succeeded server-side).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TASK_REFERENCE = join(HERE, '..', '..', 'references', 'github-tasks.md');

/** Pull the ```bash fenced block that contains the `gh issue create` step, within the
 * "### 3.6.2 Add a Task" section (that section has an earlier dedupe-search bash block first). */
function extractAddTaskSnippet() {
  const text = readFileSync(TASK_REFERENCE, 'utf8');
  const heading = '### 3.6.2 Add a Task';
  const idx = text.indexOf(heading);
  assert.ok(idx !== -1, 'expected to find "### 3.6.2 Add a Task" in github-tasks.md');
  const after = text.slice(idx);
  const createIdx = after.indexOf('gh issue create');
  assert.ok(createIdx !== -1, 'expected a gh issue create invocation in this section');
  const fenceStart = after.lastIndexOf('```bash', createIdx);
  assert.ok(fenceStart !== -1, 'expected a ```bash fence preceding the gh issue create invocation');
  const bodyStart = after.indexOf('\n', fenceStart) + 1;
  const fenceEnd = after.indexOf('```', bodyStart);
  assert.ok(fenceEnd !== -1, 'expected a closing ``` fence');
  return { fullText: text, snippet: after.slice(bodyStart, fenceEnd) };
}

/** Isolate step 1 (the create invocation + its explanatory comment block). */
function step1Of(snippet) {
  const marker = '# 2. Add it to the Project';
  const idx = snippet.indexOf(marker);
  assert.ok(idx !== -1, 'expected a "# 2. Add it to the Project" step boundary');
  return snippet.slice(0, idx);
}

/** Fill the doc's illustrative <placeholder> tokens with concrete literal values. */
function fillPlaceholders(step1) {
  return step1
    .replace(/<config\.github\.owner>\/<config\.github\.repo>/g, 'acme/personal-work')
    .replace(/--title "[^"]*"/, '--title "Test issue title"')
    .replace(/--body "[^"]*"/, '--body "Body text <!-- clientCaptureId:test-capture-123 -->"')
    .replace(/--label "[^"]*"/, '--label "kind:story,priority:P2"');
}

function makeFakeGh(bin, counterFile) {
  const p = join(bin, 'gh');
  writeFileSync(p, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${counterFile}"
if [ "$1" = "issue" ] && [ "$2" = "create" ]; then
  for arg in "$@"; do
    case "$arg" in
      --query|-o) echo "gh: unknown flag: $arg" >&2; exit 1 ;;
    esac
  done
  echo "https://github.com/acme/personal-work/issues/999"
  exit 0
fi
exit 0
`);
  chmodSync(p, 0o755);
}

describe('assistant-capture github-tasks.md §3.6.2 "Add a Task" — gh issue create (finding 3 regression)', () => {
  const { fullText, snippet } = extractAddTaskSnippet();
  const step1Raw = step1Of(snippet);
  // Strip full-line `#` comments before checking real command content — the
  // explanatory comment block intentionally mentions "gh issue create" and
  // "--query"/"-o json" in prose (explaining what NOT to do), which would
  // otherwise false-positive these code-content assertions.
  const step1Code = step1Raw.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

  test('the documented step contains exactly one `gh issue create` invocation (no `||` fallback)', () => {
    const matches = step1Code.match(/gh issue create/g) || [];
    assert.equal(matches.length, 1, 'expected exactly one gh issue create invocation; a `||` fallback reintroduces the duplicate-create/dropped-marker bug');
  });

  test('the documented step never passes --query or -o json (unsupported by gh issue create)', () => {
    assert.doesNotMatch(step1Code, /--query/, 'gh issue create has no --query flag');
    assert.doesNotMatch(step1Code, /-o json/, 'gh issue create has no -o/--output flag');
  });

  test('the retained body still carries the clientCaptureId idempotency marker instruction', () => {
    assert.match(step1Code, /clientCaptureId/, 'the single retained invocation must keep the marker-bearing body, not a truncated placeholder');
  });

  test('retry guidance re-runs the dedupe search rather than blindly re-issuing the raw create', () => {
    assert.match(step1Raw, /re-run the §3\.6\.2 dedupe search/i, 'expected explicit guidance to re-check for a server-side success before retrying create');
  });

  test('EXECUTABLE: filling placeholders and running the step against a flag-enforcing fake gh invokes gh issue create exactly once and preserves the marker', () => {
    const root = mkdtempSync(join(tmpdir(), 'issue-create-doc-'));
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    const counterFile = join(root, 'gh-invocations.log');
    writeFileSync(counterFile, '');
    makeFakeGh(bin, counterFile);

    const filled = fillPlaceholders(step1Code);
    assert.doesNotMatch(filled, /<[a-zA-Z][^>]*>/, `expected all placeholders to be filled before execution, still found one in:\n${filled}`);

    const script = `${filled}\necho "ISSUE_URL=$ISSUE_URL"\n`;
    const r = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: root },
      timeout: 5000,
    });
    assert.equal(r.status, 0, `step 1 must execute cleanly against a real-shaped gh: ${r.stderr}`);
    assert.match(r.stdout, /ISSUE_URL=https:\/\/github\.com\/acme\/personal-work\/issues\/999/);

    const invocations = readFileSync(counterFile, 'utf8').trim().split('\n').filter(Boolean);
    const createCalls = invocations.filter((l) => l.startsWith('issue create'));
    assert.equal(createCalls.length, 1, `expected exactly one "gh issue create" call, got ${createCalls.length}: ${JSON.stringify(invocations)}`);
    assert.match(createCalls[0], /clientCaptureId/, 'the single gh issue create call must carry the marker-bearing body');

    rmSync(root, { recursive: true, force: true });
  });

  test('sanity: fullText still documents the "Do not create per-status labels" workflow-state rule near this section (no unrelated regression)', () => {
    assert.match(fullText, /Do not create per-status labels/);
  });
});
