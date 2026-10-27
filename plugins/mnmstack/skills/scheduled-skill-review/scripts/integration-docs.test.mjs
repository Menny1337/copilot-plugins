import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { MAX_PLAN_BYTES } from '../../../../../scripts/version-contract.mjs';

// Set this to an authorized artifact directory. No implicit system-temp fallback:
// self-audit probes must remain inside the approved session artifact scope.
const artifactDir = process.env.VERSION_TEST_ARTIFACT_DIR ?? process.env.SKILL_REVIEW_TEST_ARTIFACT_DIR;
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, '../../../../..');
const source = readFileSync(join(scriptsDir, 'run-batch-review.sh'), 'utf8');
const options = { skip: process.platform === 'win32' ? 'Requires POSIX Bash' : false };
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const sequence = [
  'scripts/catalog.mjs',
  'scripts/plugin-readme.mjs',
  'scripts/validate.mjs',
  'scripts/catalog.mjs --check',
  'scripts/plugin-readme.mjs --check',
];

// Execute the actual function bodies without sourcing the orchestrator's top-level
// startup. That startup accesses private state, git remotes and the live scheduler.
function functionSource(name) {
  const match = source.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `Missing top-level shell function ${name}`);
  return match[0];
}

function runNode(root, args) {
  return spawnSync(process.execPath, args, { cwd: root, env: gitEnvironment(root), encoding: 'utf8' });
}

function gitEnvironment(root) {
  const env = {
    ...process.env, HOME: root, GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
  };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) {
    delete env[key];
  }
  return env;
}

function fixture(t) {
  assert.ok(artifactDir && isAbsolute(artifactDir),
    'Set VERSION_TEST_ARTIFACT_DIR or SKILL_REVIEW_TEST_ARTIFACT_DIR to an authorized absolute artifact directory');
  const base = resolve(artifactDir);
  assert.ok(base !== repoRoot && !base.startsWith(`${repoRoot}${sep}`),
    'Fixtures must not write inside the source checkout');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'integration-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skill = join(root, 'plugins/example/skills/example/SKILL.md');
  const pluginReadme = join(root, 'plugins/example/README.md');
  mkdirSync(dirname(skill), { recursive: true });
  mkdirSync(join(root, '.github/plugin'), { recursive: true });
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'logs'));
  mkdirSync(join(root, 'run/results'), { recursive: true });
  // These inspected generators resolve their root from their own script location.
  // Only the synthetic manifest's relative plugin path and synthetic docs are used.
  for (const script of ['catalog.mjs', 'plugin-readme.mjs', 'validate.mjs', 'version.mjs', 'version-contract.mjs']) {
    copyFileSync(join(repoRoot, 'scripts', script), join(root, 'scripts', script));
  }
  writeFileSync(join(root, '.github/plugin/marketplace.json'), JSON.stringify({
    name: 'example-marketplace', owner: { name: 'Fixture' },
    metadata: { version: '1.0.0' },
    plugins: [{
      name: 'example', version: '1.0.0', description: 'Fixture plugin',
      source: 'plugins/example',
    }],
  }));
  writeFileSync(join(root, 'plugins/example/plugin.json'), JSON.stringify({
    name: 'example', version: '1.0.0', description: 'Fixture plugin',
  }));
  writeFileSync(join(root, 'README.md'), '# Fixture\n\nAuthored root text.\n\n## Plugins\n\n');
  writeFileSync(pluginReadme, '# Example\n\nAuthored plugin text.\n\n');
  writeFileSync(skill, '---\nname: example\ndescription: "Original description"\n---\n\nFixture procedure.\n');
  for (const script of sequence.slice(0, 2)) {
    const result = runNode(root, [script]);
    assert.equal(result.status, 0, result.stderr);
  }
  writeFileSync(skill, readFileSync(skill, 'utf8').replace('Original description', 'Changed description'));
  for (const script of ['catalog.mjs', 'plugin-readme.mjs']) {
    assert.equal(runNode(root, [`scripts/${script}`, '--check']).status, 1,
      `Description edit must make ${script} output stale`);
  }
  return { root, pluginReadme, calls: join(root, 'calls.log') };
}

function failStage(f, stage) {
  if (stage === 0) {
    // Real catalog marker validation rejects a partial generated block.
    writeFileSync(join(f.root, 'README.md'), '<!-- mnm:catalog:start -->\n');
  } else if (stage === 1) {
    // Real plugin README marker validation rejects a partial generated block.
    writeFileSync(f.pluginReadme, '<!-- mnm:plugin-readme:start -->\n');
  } else if (stage === 2) {
    const manifest = join(f.root, 'plugins/example/plugin.json');
    const data = JSON.parse(readFileSync(manifest, 'utf8'));
    data.version = '2.0.0';
    writeFileSync(manifest, JSON.stringify(data)); // Real validator rejects mismatch.
  }
  // Stages 3/4 use a controlled post-command mutation in the node wrapper below.
}

const recoveryFunctions = [
  'checkout_is_clean', 'default_checkout_is_clean', 'readme_authored_regions_are_unchanged',
  'generated_changes_are_scoped',
  'restore_generated_docs', 'return_to_default', 'recover_pr_checkout',
  'recover_integration_checkout', 'generate_and_check_docs',
].map(functionSource).join('\n');

function runPath(f, path, {
  stage = -1, commitFailure = false, realGit = false,
  failRecovery = false, failDefaultCheckout = false, batch = false, unexpectedEdit = '',
  readmePath = '', readmeEdit = '', readmeStage = 'unstaged',
  failPush = false, failReset = false,
  actualVersions = false, versionEdit = '', versionFailure = '',
  versionPlanEdit = '',
  versionStageFailure = false,
} = {}) {
  if (!realGit) failStage(f, stage);
  const start = source.indexOf('if [ "$DRY_RUN" = "0" ] && [ "$AUTO_DEPLOY" != "false" ]; then\n  # Iterate proposed');
  const end = source.indexOf('# External skills bypass', start);
  assert.ok(start >= 0 && end > start, 'Integration loop boundaries must exist');
  const integrationLoop = source.slice(start, end);
  const shell = `
set -uo pipefail
REPO_DIR=${quote(f.root)}
LOGDIR=${quote(join(f.root, 'logs'))}
RUN_DIR=${quote(join(f.root, 'run'))}
RUN_ID=fixture
DEFAULT_BRANCH=main
REMOTE_NAME=fixture-remote
CALLS=${quote(f.calls)}
TAMPER_STAGE=${stage}
COMMIT_FAILURE=${commitFailure ? 1 : 0}
REAL_GIT=${realGit ? 1 : 0}
FAIL_RECOVERY=${failRecovery ? 1 : 0}
FAIL_DEFAULT_CHECKOUT=${failDefaultCheckout ? 1 : 0}
FAIL_PUSH=${failPush ? 1 : 0}
FAIL_RESET=${failReset ? 1 : 0}
UNEXPECTED_EDIT=${quote(unexpectedEdit)}
README_PATH=${quote(readmePath)}
README_EDIT=${quote(readmeEdit)}
README_STAGE=${quote(readmeStage)}
README_TRIGGER=${quote(stage === 1 ? 'scripts/plugin-readme.mjs' : 'scripts/plugin-readme.mjs --check')}
VERSION_EDIT=${quote(versionEdit)}
VERSION_FAILURE=${quote(versionFailure)}
VERSION_PLAN_EDIT=${quote(versionPlanEdit)}
VERSION_STAGE_FAILURE=${versionStageFailure ? 1 : 0}
BASE_HEAD=${quote(f.defaultHead ?? 'fixture-head')}
TEST_BRANCH=main
DIR="$REPO_DIR/scripts"
DRY_RUN=0
AUTO_DEPLOY=true
MARKETPLACE_NAME=fixture
prs=0
deploy_failed=0
applied=0
reverted=0
log() { printf 'log %s\\n' "$*" >>"$CALLS"; }
bump_versions() { printf 'bump_versions %s\\n' "$*" >>"$CALLS"; }
# Network operations stay stubbed. Real git and version tooling run only in
# explicitly initialized local fixtures inside the authorized artifact directory.
git() {
  printf 'git %s\\n' "$*" >>"$CALLS"
  if [ "$1" = push ]; then [ "$FAIL_PUSH" = 0 ]; return $?; fi
  if [ "$1" = fetch ]; then return 0; fi
  if [ "$1" = add ] && [ "$VERSION_STAGE_FAILURE" = 1 ]; then return 1; fi
  if [ "$1" = reset ] && [ "$FAIL_RESET" = 1 ]; then return 1; fi
  if [ "$1" = commit ] && [ "$COMMIT_FAILURE" = 1 ]; then return 1; fi
  if [ "$1" = restore ] && [ "$FAIL_RECOVERY" = 1 ]; then return 1; fi
  if [ "$1" = checkout ] && [ "\${2:-}" = main ] && [ "$FAIL_DEFAULT_CHECKOUT" = 1 ]; then return 1; fi
  if [ "$REAL_GIT" = 1 ]; then command git "$@"; return $?; fi
  if [ "$*" = 'diff --quiet' ]; then return 1; fi
  if [ "$1" = checkout ]; then TEST_BRANCH="$2"; fi
  if [ "$1" = symbolic-ref ]; then printf '%s\\n' "$TEST_BRANCH"; fi
  if [ "$1" = rev-parse ]; then printf 'fixture-head\\n'; fi
  return 0
}
gh() {
  printf 'gh %s\\n' "$*" >>"$CALLS"
  case "$*" in
    'pr create '*) printf 'https://example.invalid/pull/1\\n' ;;
    *'--json number'*) printf '1\\n' ;;
    *) printf 'https://example.invalid/pull/1\\n' ;;
  esac
}
node() {
  printf 'node %s\\n' "$*" >>"$CALLS"
  if [ "$1" = scripts/version.mjs ]; then
    if [ "$2" = plan ]; then
      [ "$VERSION_FAILURE" != plan ] || return 1
      ${quote(process.execPath)} "$@" >logs/version-plan.json || return $?
      if [ "$VERSION_FAILURE" = override ]; then
        ${quote(process.execPath)} "$@" --set example=major >logs/version-plan.json || return $?
      fi
      ${quote(process.execPath)} -e '
        const fs = require("node:fs"), fault = process.argv[1], path = "logs/version-plan.json";
        const plan = JSON.parse(fs.readFileSync(path, "utf8"));
        if (fault === "schema") plan.schema = "version-plan/2";
        if (fault === "head") plan.head = plan.base;
        if (fault === "base") plan.base = plan.head;
        if (fault === "path") plan.outputs[0].path = "README.md";
        if (fault === "before") plan.outputs[0].before += "tampered";
        if (fault === "content") plan.outputs[0].after += "tampered";
        if (fault === "empty") plan.outputs = [];
        fs.writeFileSync(path, fault === "payload-cap" ? " ".repeat(${MAX_PLAN_BYTES} + 1)
          : fault === "malformed" ? "{broken" : JSON.stringify(plan));
      ' "$VERSION_FAILURE" || return $?
      if [ -n "$VERSION_PLAN_EDIT" ]; then
        ${quote(process.execPath)} -e '
          const fs = require("node:fs"), { execFileSync } = require("node:child_process");
          const edit = process.argv[1], path = edit.endsWith("root-readme") ? "README.md" : "plugins/example/README.md";
          const original = fs.readFileSync(path);
          fs.appendFileSync(path, "\\nConcurrent plan-time authored text.\\n");
          if (edit.startsWith("index-")) {
            execFileSync("git", ["add", "--", path]); fs.writeFileSync(path, original);
          }
          fs.writeFileSync("logs/version-working.bin", fs.readFileSync(path));
          fs.writeFileSync("logs/version-index.bin", execFileSync("git", ["diff", "--cached", "--binary", "HEAD"]));
          fs.writeFileSync("logs/version-path.txt", path);
        ' "$VERSION_PLAN_EDIT" || return $?
      fi
      cat logs/version-plan.json
      return 0
    fi
    [ "$VERSION_FAILURE" != apply-before ] || return 1
    ${quote(process.execPath)} "$@" || return $?
    if [ -z "$VERSION_EDIT" ]; then [ "$VERSION_FAILURE" != apply ]; return $?; fi
    ${quote(process.execPath)} -e '
      const fs = require("node:fs"), { execFileSync } = require("node:child_process");
      const edit = process.argv[1], manifestPath = "plugins/example/plugin.json";
      const marketplacePath = ".github/plugin/marketplace.json", changelogPath = "plugins/example/CHANGELOG.md";
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
      let path;
      if (["root-readme", "plugin-readme", "index-root-readme", "index-plugin-readme"].includes(edit)) {
        path = edit.endsWith("root-readme") ? "README.md" : "plugins/example/README.md";
        fs.appendFileSync(path, "\\nConcurrent authored version-time text.\\n");
      } else if (edit === "manifest" || edit === "index-manifest") {
        path = manifestPath; manifest.description = "Concurrent authored manifest text.";
        fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\\n");
      } else if (edit === "marketplace") {
        path = marketplacePath; marketplace.plugins[0].description = "Concurrent authored marketplace text.";
        fs.writeFileSync(path, JSON.stringify(marketplace, null, 2) + "\\n");
      } else if (edit === "changelog" || edit === "index-changelog") {
        path = changelogPath; fs.appendFileSync(path, "\\nConcurrent authored changelog text.\\n");
      } else if (edit === "section") {
        path = changelogPath;
        fs.writeFileSync(path, fs.readFileSync(path, "utf8").replace("Fixture committed proposal", "Concurrent authored section text."));
      } else if (edit === "historical" || edit === "index-historical") {
        path = changelogPath;
        fs.writeFileSync(path, fs.readFileSync(path, "utf8").replace("Authored historical release note.", "Concurrent historical release note."));
      } else if (edit === "tracked" || edit === "staged") {
        path = "unrelated.txt"; fs.writeFileSync(path, "Concurrent version-time work.\\n");
      } else if (edit === "untracked") {
        path = "concurrent.txt"; fs.writeFileSync(path, "Concurrent untracked work.\\n");
      }
      if (edit.startsWith("index-") || edit === "staged") {
        execFileSync("git", ["add", "--", path]);
        if (edit.endsWith("-readme")) { fs.writeFileSync(path, fs.readFileSync(path, "utf8").replace("\\nConcurrent authored version-time text.\\n", "")); }
        else if (edit === "index-manifest") { manifest.description = "Fixture plugin"; fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\\n"); }
        else if (edit === "index-changelog") { fs.writeFileSync(path, fs.readFileSync(path, "utf8").replace("\\nConcurrent authored changelog text.\\n", "")); }
        else if (edit === "index-historical") { fs.writeFileSync(path, fs.readFileSync(path, "utf8").replace("Concurrent historical release note.", "Authored historical release note.")); }
        else fs.writeFileSync(path, "Original unrelated work.\\n");
      }
      if (path) {
        fs.writeFileSync("logs/version-working.bin", fs.readFileSync(path));
        fs.writeFileSync("logs/version-index.bin", execFileSync("git", ["diff", "--cached", "--binary", "HEAD"]));
        fs.writeFileSync("logs/version-path.txt", path);
      }
    ' "$VERSION_EDIT" || return $?
    [ "$VERSION_FAILURE" != apply ] || return 1
    return 0
  fi
  if [ "$1" = "$DIR/lifecycle.mjs" ]; then
    case "\${2:-}" in
      list) printf '[{"id":"first","unit":"example","branch":"fixture-branch","runId":"fixture"},{"id":"second","unit":"second","branch":"second-branch","runId":"fixture"}]\\n' ;;
      policy) printf ${quote(path === 'open_pr' ? 'pr\\n' : 'auto\\n')} ;;
    esac
    return 0
  fi
  local node_status=0
  ${quote(process.execPath)} "$@" || node_status=$?
  if [ "$*" = "$README_TRIGGER" ]; then
    if [ -n "$README_PATH" ]; then
      ${quote(process.execPath)} -e '
        const fs = require("node:fs");
        const { execFileSync } = require("node:child_process");
        const [path, edit, stage] = process.argv.slice(1);
        const original = fs.readFileSync(path, "utf8");
        const prefix = path === "README.md" ? "mnm:catalog" : "mnm:plugin-readme";
        let content;
        if (edit === "before") content = "Concurrent staged authored text.\\n" + original;
        else if (edit === "after") content = original + "\\nConcurrent staged authored text.\\n";
        else if (edit === "missing") content = original.replace("<!-- " + prefix + ":end -->", "");
        else if (edit === "duplicate") content = "<!-- " + prefix + ":start -->\\n" + original;
        else throw new Error("Unknown fixture README edit");
        fs.writeFileSync(path, content);
        if (stage === "staged") {
          execFileSync("git", ["add", "--", path]);
          fs.writeFileSync(path, edit === "before" || edit === "after"
            ? content.replace("Concurrent staged authored text.", "Concurrent working authored text.")
            : original);
        } else if (edit === "before" || edit === "after") {
          fs.writeFileSync(path, content.replace("Concurrent staged authored text.", "Concurrent working authored text."));
        }
        fs.writeFileSync("logs/concurrent-index.bin", execFileSync("git", ["show", ":" + path]));
        fs.writeFileSync("logs/concurrent-working.bin", fs.readFileSync(path));
      ' "$README_PATH" "$README_EDIT" "$README_STAGE"
    fi
  fi
  [ "$node_status" = 0 ] || return "$node_status"
  if [ "$*" = scripts/catalog.mjs ]; then
    case "$UNEXPECTED_EDIT" in
      staged)
        printf 'Concurrent staged work.\\n' >"$REPO_DIR/unrelated.txt"
        command git add -- unrelated.txt
        printf 'Original unrelated work.\\n' >"$REPO_DIR/unrelated.txt"
        ;;
      untracked) printf 'Concurrent untracked work.\\n' >"$REPO_DIR/concurrent.txt" ;;
    esac
  fi
  if [ "$TAMPER_STAGE" = 3 ] && [ "$*" = scripts/validate.mjs ]; then
    printf '\\nFixture stale catalog\\n' >>"$REPO_DIR/CATALOG.md"
  fi
  if [ "$TAMPER_STAGE" = 4 ] && [ "$*" = 'scripts/catalog.mjs --check' ]; then
    # Change generated content: the generator preserves authored text outside it.
    ${quote(process.execPath)} -e 'const fs = require("node:fs"); const p = process.argv[1]; fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("Changed description", "Fixture stale description"));' "$REPO_DIR/plugins/example/README.md"
  fi
  return 0
}
${recoveryFunctions}
${functionSource('sync_repo')}
${actualVersions ? [
  'read_version_outputs', 'verify_version_outputs', 'bump_versions',
].map(functionSource).join('\n') : ''}
# Recipe-only tests use mocked Git. Ownership and recovery checks are exercised
# by the real local-Git fixtures below, not inferred from those mocks.
if [ "$REAL_GIT" = 0 ]; then readme_authored_regions_are_unchanged() { return 0; }; fi
${functionSource('integrate_one')}
${functionSource('open_pr')}
${batch ? integrationLoop : path === 'bump_versions'
  ? 'bump_versions example "$BASE_HEAD"' : `${path} fixture-cycle example fixture-branch patched`}
`;
  return spawnSync('/bin/bash', ['-c', shell], {
    cwd: f.root, encoding: 'utf8', timeout: 30_000,
    env: gitEnvironment(f.root),
  });
}

function calls(f) {
  return readFileSync(f.calls, 'utf8').trim().split('\n');
}

for (const path of ['integrate_one', 'open_pr']) {
  test(`${path} regenerates and checks actual stale outputs before publication`, options, t => {
    const f = fixture(t);
    const result = runPath(f, path);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const trace = calls(f);
    assert.deepEqual(trace.filter(line => /^node scripts\//.test(line)),
      sequence.map(command => `node ${command}`));
    const checked = trace.indexOf('node scripts/plugin-readme.mjs --check');
    const committed = trace.findIndex(line => line.startsWith('git commit '));
    const pushed = trace.findIndex(line => line.startsWith('git push '));
    assert.ok(trace.findIndex(line => line.startsWith('bump_versions ')) <
      trace.indexOf('node scripts/catalog.mjs'));
    assert.ok(committed > checked, 'Documentation commit must follow all checks');
    assert.ok(pushed > committed, 'Push must follow the documentation commit');
    for (const file of ['CATALOG.md', 'README.md', 'plugins/example/README.md']) {
      assert.match(readFileSync(join(f.root, file), 'utf8'), /Changed description/);
    }
    assert.match(readFileSync(join(f.root, 'README.md'), 'utf8'), /Authored root text/);
    assert.match(readFileSync(f.pluginReadme, 'utf8'), /Authored plugin text/);
    for (const script of ['validate.mjs', 'catalog.mjs', 'plugin-readme.mjs']) {
      const checkedResult = runNode(f.root, [`scripts/${script}`, ...(script === 'validate.mjs' ? [] : ['--check'])]);
      assert.equal(checkedResult.status, 0, checkedResult.stderr);
    }
    if (path === 'open_pr') {
      assert.ok(trace.findIndex(line => line.startsWith('gh pr create ')) > pushed);
      assert.equal(readFileSync(join(f.root, 'run/results/example.prurl'), 'utf8'),
        'https://example.invalid/pull/1');
    }
  });

  for (let stage = 0; stage < sequence.length; stage++) {
    test(`${path} stops on actual ${sequence[stage]} failure`, options, t => {
      const f = fixture(t);
      const result = runPath(f, path, { stage });
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      const trace = calls(f);
      assert.deepEqual(trace.filter(line => /^node scripts\//.test(line)),
        sequence.slice(0, stage + 1).map(command => `node ${command}`));
      assert.ok(!trace.some(line => /^git (add|commit|push) /.test(line)),
        'Failed generation/check must not stage, commit or push documentation');
      assert.ok(!trace.some(line => line.startsWith('gh ')), 'Failure must not open a PR');
      if (path === 'integrate_one') {
        assert.ok(trace.includes('git reset --keep fixture-head'));
      } else {
        assert.ok(trace.includes('git checkout main'));
        assert.ok(!existsSync(join(f.root, 'run/results/example.prurl')));
      }
      assert.match(readFileSync(join(f.root, 'logs/daemon.log'), 'utf8'),
        /stale|marker|version|catalog|README/i);
    });
  }

  test(`${path} stops publication when the documentation commit fails`, options, t => {
    const f = fixture(t);
    const result = runPath(f, path, { commitFailure: true });
    assert.equal(result.status, 1);
    const trace = calls(f);
    assert.ok(trace.some(line => line.startsWith('git commit ')));
    assert.ok(!trace.some(line => line.startsWith('git push ') || line.startsWith('gh ')));
    assert.ok(trace.some(line => line.includes('documentation commit failed')));
  });
}

test('reviewer instruction commands execute the same complete fixture validation sequence', options, t => {
  const f = fixture(t);
  const promptLine = source.split('\n').find(line => line.startsWith('  local prompt="'));
  assert.ok(promptLine);
  const commands = [...promptLine.matchAll(/'node (scripts\/(?:catalog|plugin-readme|validate)\.mjs(?: --check)?)'/g)]
    .map(match => match[1]);
  assert.deepEqual(commands, sequence);
  assert.match(promptLine, /Stop on any generator or check failure/);
  assert.match(promptLine, /report action=failed and do not commit/);
  // Execute the advertised commands, not just string-match their names. This
  // verifies the instruction recipe, not a model's adherence or Copilot execution.
  for (const command of commands) {
    const result = runNode(f.root, command.split(' '));
    assert.equal(result.status, 0, result.stderr);
  }
  assert.match(readFileSync(f.pluginReadme, 'utf8'), /Changed description/);
});

function localGit(f, args) {
  const result = spawnSync('git', args, {
    cwd: f.root, encoding: 'utf8', env: gitEnvironment(f.root),
  });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}

function localGitFixture(t, stage = -1, existingChangelog = false, subject = 'Fixture committed proposal') {
  const f = fixture(t);
  const skill = join(f.root, 'plugins/example/skills/example/SKILL.md');
  writeFileSync(skill, readFileSync(skill, 'utf8').replace('Changed description', 'Original description'));
  for (const script of sequence.slice(0, 2)) {
    const result = runNode(f.root, [script]);
    assert.equal(result.status, 0, result.stderr);
  }
  writeFileSync(join(f.root, '.gitignore'), 'logs/\nrun/\ncalls.log\n');
  writeFileSync(join(f.root, 'unrelated.txt'), 'Original unrelated work.\n');
  if (existingChangelog) {
    writeFileSync(join(f.root, 'plugins/example/CHANGELOG.md'),
      '# Changelog\n\nAuthored changelog preamble.\n\n## [1.0.0] - 2026-01-01\n\n- Authored historical release note.\n');
  }
  localGit(f, ['init', '-b', 'main']);
  localGit(f, ['config', 'user.name', 'Fixture']);
  localGit(f, ['config', 'user.email', 'fixture@example.invalid']);
  localGit(f, ['config', 'core.hooksPath', '/dev/null']);
  const commit = message => {
    localGit(f, ['add', '-A']);
    localGit(f, ['commit', '-m', message, '-m',
      'Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>']);
  };
  commit('Fixture baseline');
  f.defaultHead = localGit(f, ['rev-parse', 'HEAD']);
  localGit(f, ['update-ref', 'refs/remotes/fixture-remote/main', f.defaultHead]);
  localGit(f, ['checkout', '-b', 'fixture-branch']);
  writeFileSync(skill, readFileSync(skill, 'utf8').replace('Original description', 'Changed description'));
  if (stage === 0 || stage === 1) {
    const script = join(f.root, 'scripts', stage === 0 ? 'catalog.mjs' : 'plugin-readme.mjs');
    // Fail after real generation has written partial operation outputs, without
    // corrupting the captured README ownership markers in the committed proposal.
    writeFileSync(script, `${readFileSync(script, 'utf8')}\nprocess.exitCode = 1;\n`);
  } else {
    failStage(f, stage);
  }
  commit(subject);
  f.proposalHead = localGit(f, ['rev-parse', 'HEAD']);
  localGit(f, ['checkout', 'main']);
  for (const name of ['example', 'second']) {
    writeFileSync(join(f.root, `run/results/${name}.json`), '{"action":"patched"}');
  }
  return f;
}

function assertRecovered(f) {
  assert.equal(localGit(f, ['symbolic-ref', '--short', 'HEAD']), 'main');
  assert.equal(localGit(f, ['rev-parse', 'HEAD']), f.defaultHead);
  assert.equal(localGit(f, ['status', '--porcelain', '--untracked-files=all']), '');
  assert.equal(localGit(f, ['rev-parse', 'fixture-branch']), f.proposalHead,
    'Recovery must preserve the committed proposal branch');
}

for (const path of ['integrate_one', 'open_pr']) {
  test(`${path} publishes with real scoped documentation commits and a clean checkout`, options, t => {
    const f = localGitFixture(t);
    const result = runPath(f, path, { realGit: true });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(localGit(f, ['symbolic-ref', '--short', 'HEAD']), 'main');
    assert.equal(localGit(f, ['status', '--porcelain', '--untracked-files=all']), '');
    const docsBranch = path === 'open_pr' ? 'fixture-branch' : 'main';
    const updated = localGit(f, ['diff', '--name-only', f.proposalHead, docsBranch]).split('\n');
    assert.deepEqual(updated.sort(), ['CATALOG.md', 'README.md', 'plugins/example/README.md']);
    const trace = calls(f);
    assert.ok(trace.some(line => line.startsWith('git commit --only ')));
    assert.ok(!trace.includes('git add -A'));
    if (path === 'open_pr') {
      assert.equal(localGit(f, ['rev-parse', 'main']), f.defaultHead);
      localGit(f, ['merge-base', '--is-ancestor', f.proposalHead, 'fixture-branch']);
    }
  });

  test(`${path} restores a real clean default checkout after partial generation`, options, t => {
    const f = localGitFixture(t, 1);
    const result = runPath(f, path, { realGit: true, stage: 1 });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.ok(calls(f).includes('node scripts/catalog.mjs'),
      'Catalog generation must run before the plugin README generation fails');
    assertRecovered(f);
    assert.match(readFileSync(f.pluginReadme, 'utf8'), /Original description/);
  });

  test(`${path} restores the real index and worktree after a staged commit failure`, options, t => {
    const f = localGitFixture(t);
    const result = runPath(f, path, { realGit: true, commitFailure: true });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const trace = calls(f);
    assert.ok(trace.includes('git add -u -- CATALOG.md README.md :(glob)plugins/*/README.md'),
      'The fixture must exercise a staged failure confined to tracked generated outputs');
    assert.ok(trace.some(line => line.startsWith('git restore --source=')));
    assertRecovered(f);
    assert.ok(!trace.some(line => line.startsWith('git push ') || line.startsWith('gh ')));
  });

  test(`${path} preserves unrelated staged and unstaged work on entry`, options, t => {
    const f = localGitFixture(t);
    const unrelated = join(f.root, 'unrelated.txt');
    writeFileSync(unrelated, 'User staged work.\n');
    localGit(f, ['add', 'unrelated.txt']);
    writeFileSync(unrelated, 'User unstaged work.\n');
    const status = localGit(f, ['status', '--porcelain']);
    const result = runPath(f, path, { realGit: true });
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    assert.equal(localGit(f, ['status', '--porcelain']), status);
    assert.equal(localGit(f, ['show', ':unrelated.txt']), 'User staged work.');
    assert.equal(readFileSync(unrelated, 'utf8'), 'User unstaged work.\n');
    assert.equal(localGit(f, ['symbolic-ref', '--short', 'HEAD']), 'main');
    assert.ok(!calls(f).some(line => /^(bump_versions|node scripts|git (merge|checkout|add|restore|reset|commit)) /.test(line)));
  });

  test(`${path} stops the actual integration loop when tracked-output recovery fails`, options, t => {
    const f = localGitFixture(t, 1);
    const result = runPath(f, path, {
      realGit: true, stage: 1, failRecovery: true, batch: true,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const trace = calls(f);
    assert.ok(trace.some(line => line.includes('aborting remaining unit integration')));
    assert.ok(!trace.some(line => line.includes('second-branch') || line === 'bump_versions second'));
    assert.notEqual(localGit(f, ['status', '--porcelain']), '',
      'Failed recovery must preserve its diagnostic working changes, not force-clean them');
    assert.ok(!trace.some(line => /^git (add|commit|push) /.test(line)));
    assert.equal(localGit(f, ['rev-parse', 'fixture-branch']), f.proposalHead);
  });

  for (const unexpectedEdit of ['staged', 'untracked']) {
    test(`${path} preserves concurrent ${unexpectedEdit} work and stops remaining units`, options, t => {
      const f = localGitFixture(t, 1);
      const result = runPath(f, path, {
        realGit: true, stage: 1, unexpectedEdit, batch: true,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const trace = calls(f);
      assert.ok(trace.some(line => line.includes('aborting remaining unit integration')));
      assert.ok(!trace.some(line => line.includes('second-branch') || line === 'bump_versions second'));
      assert.ok(!trace.some(line => /^git (restore|reset|add|commit|push) /.test(line)),
        'Unexpected work must stop cleanup and publication before a destructive operation');
      if (unexpectedEdit === 'staged') {
        assert.equal(localGit(f, ['show', ':unrelated.txt']), 'Concurrent staged work.');
        assert.equal(readFileSync(join(f.root, 'unrelated.txt'), 'utf8'), 'Original unrelated work.\n');
      } else {
        assert.equal(readFileSync(join(f.root, 'concurrent.txt'), 'utf8'), 'Concurrent untracked work.\n');
      }
      assert.equal(localGit(f, ['rev-parse', 'fixture-branch']), f.proposalHead);
    });
  }
}

test('open_pr stops the actual integration loop when return checkout fails', options, t => {
  const f = localGitFixture(t, 1);
  const result = runPath(f, 'open_pr', {
    realGit: true, stage: 1, failDefaultCheckout: true, batch: true,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const trace = calls(f);
  assert.ok(trace.some(line => line.includes('aborting remaining unit integration')));
  assert.equal(localGit(f, ['symbolic-ref', '--short', 'HEAD']), 'fixture-branch');
  assert.equal(localGit(f, ['status', '--porcelain']), '',
    'Known generated edits must be restored before the attempted branch switch');
  assert.equal(localGit(f, ['rev-parse', 'fixture-branch']), f.proposalHead);
  assert.ok(!trace.some(line => line.includes('second-branch') || line === 'bump_versions second'));
  assert.ok(!trace.some(line => /^git (add|commit|push) /.test(line)));
});

function assertReadmePreservedAndBatchStopped(f, path) {
  const trace = calls(f);
  assert.ok(trace.some(line => line.includes('aborting remaining unit integration')),
    'Unsafe ownership must propagate status 3 to the actual serialized loop');
  assert.ok(!trace.some(line => line.includes('second-branch') || line === 'bump_versions second'));
  assert.ok(!trace.some(line => /^git (restore|reset|add|commit|push) /.test(line)),
    'Authored or ambiguous content must not be staged, restored, committed or pushed');
  assert.ok(!trace.some(line => line.startsWith('gh ')));
  assert.deepEqual(readFileSync(join(f.root, path)),
    readFileSync(join(f.root, 'logs/concurrent-working.bin')),
    'Every working README byte must survive the fail-closed stop');
  const index = spawnSync('git', ['show', `:${path}`], {
    cwd: f.root, env: gitEnvironment(f.root),
  });
  assert.equal(index.status, 0);
  assert.deepEqual(index.stdout, readFileSync(join(f.root, 'logs/concurrent-index.bin')),
    'Every staged README byte must survive the fail-closed stop');
  assert.equal(localGit(f, ['rev-parse', 'fixture-branch']), f.proposalHead);
}

for (const path of ['integrate_one', 'open_pr']) {
  for (const readmePath of ['README.md', 'plugins/example/README.md']) {
    for (const markerState of ['missing', 'unmarked', 'inverted']) {
      test(`${path} preserves a committed ${markerState} ${readmePath} before any generation`,
        options, t => {
          const f = localGitFixture(t);
          localGit(f, ['checkout', 'fixture-branch']);
          const prefix = readmePath === 'README.md' ? 'mnm:catalog' : 'mnm:plugin-readme';
          const start = `<!-- ${prefix}:start -->`;
          const end = `<!-- ${prefix}:end -->`;
          const original = readFileSync(join(f.root, readmePath), 'utf8');
          const changed = markerState === 'missing' ? original.replace(end, '') :
            markerState === 'unmarked' ? original.replace(start, '').replace(end, '') :
              original.replace(start, 'FIXTURE_MARKER').replace(end, start).replace('FIXTURE_MARKER', end);
          writeFileSync(join(f.root, readmePath), changed);
          localGit(f, ['add', '--', readmePath]);
          localGit(f, ['commit', '-m', 'Fixture committed marker ambiguity', '-m',
            'Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>']);
          f.proposalHead = localGit(f, ['rev-parse', 'HEAD']);
          writeFileSync(join(f.root, 'logs/concurrent-working.bin'), changed);
          writeFileSync(join(f.root, 'logs/concurrent-index.bin'), changed);
          localGit(f, ['checkout', 'main']);
          const result = runPath(f, path, { realGit: true, batch: true });
          assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
          assertReadmePreservedAndBatchStopped(f, readmePath);
          assert.ok(!calls(f).some(line => line.startsWith('node scripts/')),
            'Unowned marker structures must stop before a generator can rewrite authored content');
        });
    }
  }

  for (const [readmePath, readmeEdit] of [
    ['README.md', 'before'], ['plugins/example/README.md', 'after'],
  ]) {
    for (const readmeStage of ['unstaged', 'staged']) {
      for (const stage of [-1, 1]) {
        test(`${path} preserves ${readmeStage} authored ${readmePath} bytes after ${stage === 1 ? 'failed' : 'successful'} generation and stops the batch`,
          options, t => {
            const f = localGitFixture(t, stage);
            const result = runPath(f, path, {
              realGit: true, batch: true, stage, readmePath, readmeEdit, readmeStage,
            });
            assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
            assertReadmePreservedAndBatchStopped(f, readmePath);
            assert.match(readFileSync(join(f.root, readmePath), 'utf8'),
              /Concurrent working authored text/);
            const index = localGit(f, ['show', `:${readmePath}`]);
            if (readmeStage === 'staged') {
              assert.match(index, /Concurrent staged authored text/);
              assert.doesNotMatch(index, /Concurrent working authored text/);
            } else {
              assert.doesNotMatch(index, /Concurrent (working|staged) authored text/);
            }
            const log = readFileSync(join(f.root, 'logs/daemon.log'), 'utf8');
            assert.match(log, /Authored README content changed/);
          });
      }
    }
  }

  for (const readmePath of ['README.md', 'plugins/example/README.md']) {
    for (const readmeEdit of ['missing', 'duplicate']) {
      for (const readmeStage of ['unstaged', 'staged']) {
        test(`${path} preserves ${readmeStage} ${readmeEdit} markers in ${readmePath} and stops the batch`,
          options, t => {
            const f = localGitFixture(t);
            const result = runPath(f, path, {
              realGit: true, batch: true, readmePath, readmeEdit, readmeStage,
            });
            assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
            assertReadmePreservedAndBatchStopped(f, readmePath);
            assert.match(readFileSync(join(f.root, 'logs/daemon.log'), 'utf8'),
              /Ambiguous or missing generated markers/);
          });
      }
    }
  }

  test(`${path} recovers safely after a stubbed push failure with real local commits`,
    options, t => {
      const f = localGitFixture(t);
      const result = runPath(f, path, { realGit: true, failPush: true });
      assert.equal(result.status, path === 'integrate_one' ? 2 : 1,
        `${result.stdout}\n${result.stderr}`);
      const trace = calls(f);
      assert.equal(trace.filter(line => line.startsWith('git push ')).length, 1);
      assert.ok(trace.some(line => line.startsWith('git commit --only ')));
      assert.ok(!trace.some(line => line.startsWith('gh ')));
      assert.equal(localGit(f, ['symbolic-ref', '--short', 'HEAD']), 'main');
      assert.equal(localGit(f, ['rev-parse', 'main']), f.defaultHead);
      assert.equal(localGit(f, ['status', '--porcelain', '--untracked-files=all']), '');
      if (path === 'integrate_one') {
        assertRecovered(f);
      } else {
        assert.notEqual(localGit(f, ['rev-parse', 'fixture-branch']), f.proposalHead,
          'PR push failure must preserve the successful local documentation commit');
        localGit(f, ['merge-base', '--is-ancestor', f.proposalHead, 'fixture-branch']);
        assert.match(localGit(f, ['show', 'fixture-branch:plugins/example/README.md']),
          /Changed description/);
      }
    });
}

test('integrate_one stops subsequent units after a reset failure without forcing cleanup',
  options, t => {
    const f = localGitFixture(t, 1);
    const result = runPath(f, 'integrate_one', {
      realGit: true, stage: 1, failReset: true, batch: true,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const trace = calls(f);
    assert.ok(trace.some(line => line.startsWith('git restore --source=')));
    assert.ok(trace.includes(`git reset --keep ${f.defaultHead}`));
    assert.ok(trace.some(line => line.includes('aborting remaining unit integration')));
    assert.ok(!trace.some(line => line.includes('second-branch') || line === 'bump_versions second'));
    assert.ok(!trace.some(line => /^git (add|commit|push) /.test(line)));
    assert.equal(localGit(f, ['symbolic-ref', '--short', 'HEAD']), 'main');
    assert.notEqual(localGit(f, ['rev-parse', 'HEAD']), f.defaultHead,
      'Failed reset must leave the diagnostic merged HEAD rather than pretending to recover');
    assert.equal(localGit(f, ['status', '--porcelain', '--untracked-files=all']), '',
      'Known generated outputs were restored before the failed reset');
    assert.equal(localGit(f, ['rev-parse', 'fixture-branch']), f.proposalHead);
  });

function checkoutSnapshot(f) {
  return {
    head: localGit(f, ['rev-parse', 'HEAD']),
    branch: localGit(f, ['rev-parse', '--abbrev-ref', 'HEAD']),
    status: localGit(f, ['status', '--porcelain', '--untracked-files=all']),
    working: localGit(f, ['diff', '--binary']),
    index: localGit(f, ['diff', '--cached', '--binary']),
  };
}

function runSync(f, {
  fetchFailure = false, mergeFailure = false, fetchEdit = false,
  mergeNoop = false, mergeEdit = false,
} = {}) {
  const shell = `
set -uo pipefail
REPO_DIR=${quote(f.root)}
LOGDIR=${quote(join(f.root, 'logs'))}
DEFAULT_BRANCH=main
REMOTE_NAME=fixture-remote
CALLS=${quote(join(f.root, 'logs/sync-calls.log'))}
log() { printf 'log %s\\n' "$*" >>"$CALLS"; }
git() {
  printf 'git %s\\n' "$*" >>"$CALLS"
  if [ "$1" = fetch ]; then
    ${fetchEdit ? 'printf "Concurrent fetch-time work.\\n" > unrelated.txt' : ':'}
    return ${fetchFailure ? 1 : 0}
  fi
  if [ "$1" = merge ] && [ "$2" = --ff-only ]; then
    ${mergeFailure ? 'return 1' : ':'}
    ${mergeNoop ? 'return 0' : ':'}
    command git "$@" || return $?
    ${mergeEdit ? 'printf "Concurrent merge-time work.\\n" > unrelated.txt' : ':'}
    return 0
  fi
  command git "$@"
}
${['checkout_is_clean', 'default_checkout_is_clean', 'sync_repo'].map(functionSource).join('\n')}
sync_repo
`;
  return spawnSync('/bin/bash', ['-c', shell], {
    cwd: f.root, env: gitEnvironment(f.root), encoding: 'utf8', timeout: 30_000,
  });
}

function assertNextSyncPreserves(f) {
  const before = checkoutSnapshot(f);
  const logPath = join(f.root, 'logs/sync-calls.log');
  const logOffset = existsSync(logPath) ? readFileSync(logPath, 'utf8').length : 0;
  const result = runSync(f);
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(checkoutSnapshot(f), before,
    'A fresh sync invocation must retain the prior status-3 inspection state');
  const trace = readFileSync(logPath, 'utf8').slice(logOffset);
  assert.doesNotMatch(trace, /^git (reset|checkout|merge) /m);
  if (before.status) assert.doesNotMatch(trace, /^git fetch /m,
    'Dirty inspection state must stop before fetching or switching branches');
}

function assertVersionEditPreserved(f) {
  const trace = calls(f);
  assert.ok(trace.some(line => line.includes('aborting remaining unit integration')));
  assert.ok(!trace.some(line => line.includes('second-branch')));
  assert.ok(!trace.some(line => /^git (add|commit|push|restore|reset) /.test(line)));
  assert.ok(!trace.some(line => /^node scripts\/(catalog|plugin-readme)\.mjs/.test(line)));
  assert.ok(!trace.some(line => line.startsWith('gh ')));
  const path = readFileSync(join(f.root, 'logs/version-path.txt'), 'utf8');
  assert.deepEqual(readFileSync(join(f.root, path)),
    readFileSync(join(f.root, 'logs/version-working.bin')));
  const index = spawnSync('git', ['diff', '--cached', '--binary', 'HEAD'], {
    cwd: f.root, env: gitEnvironment(f.root),
  });
  assert.equal(index.status, 0);
  assert.deepEqual(index.stdout, readFileSync(join(f.root, 'logs/version-index.bin')));
  assertNextSyncPreserves(f);
  assert.deepEqual(readFileSync(join(f.root, path)),
    readFileSync(join(f.root, 'logs/version-working.bin')));
}

for (const path of ['integrate_one', 'open_pr']) {
  test(`${path} consumes the real structured plan and commits only planned version outputs`,
    options, t => {
      const f = localGitFixture(t, -1, true);
      const result = runPath(f, path, { realGit: true, actualVersions: true });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${readFileSync(join(f.root, 'logs/daemon.log'), 'utf8')}`);
      const branch = path === 'open_pr' ? 'fixture-branch' : 'main';
      assert.equal(JSON.parse(localGit(f, ['show', `${branch}:plugins/example/plugin.json`])).version, '1.0.1');
      const release = localGit(f, ['log', '--format=%H', '--grep=^chore(release):', branch]);
      assert.ok(release);
      assert.deepEqual(localGit(f, ['diff-tree', '--no-commit-id', '--name-only', '-r', release]).split('\n').sort(),
        ['.github/plugin/marketplace.json', 'plugins/example/CHANGELOG.md', 'plugins/example/plugin.json']);
      assert.ok(!calls(f).includes('git add -A'));
      assert.equal(localGit(f, ['status', '--porcelain', '--untracked-files=all']), '');
      assert.equal(localGit(f, ['symbolic-ref', '--short', 'HEAD']), 'main');
    });

  for (const versionEdit of [
    'root-readme', 'plugin-readme', 'index-root-readme', 'index-plugin-readme',
    'manifest', 'marketplace', 'changelog', 'section',
    'historical', 'index-historical',
    'index-manifest', 'index-changelog', 'tracked', 'staged', 'untracked',
  ]) {
    test(`${path} preserves version-time ${versionEdit} work and a second sync run`,
      options, t => {
        const f = localGitFixture(t, -1, true);
        const result = runPath(f, path, {
          realGit: true, actualVersions: true, versionEdit, batch: true,
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assertVersionEditPreserved(f);
      });
  }

  for (const versionPlanEdit of ['root-readme', 'plugin-readme', 'index-root-readme', 'index-plugin-readme']) {
    test(`${path} captures plan-time ${versionPlanEdit} work before version apply`,
      options, t => {
        const f = localGitFixture(t);
        const result = runPath(f, path, {
          realGit: true, actualVersions: true, versionPlanEdit, batch: true,
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.ok(!calls(f).some(line => line.startsWith('node scripts/version.mjs apply')));
        assertVersionEditPreserved(f);
      });
  }

  for (const versionFailure of [
    'plan', 'apply', 'apply-before', 'stage', 'commit',
    'schema', 'head', 'base', 'path', 'before', 'content', 'empty', 'malformed', 'override', 'payload-cap',
  ]) {
    test(`${path} fails closed on version ${versionFailure} failure across runs`,
      options, t => {
        const f = localGitFixture(t);
        const result = runPath(f, path, {
          realGit: true, actualVersions: true, batch: true,
          versionFailure, commitFailure: versionFailure === 'commit',
          versionStageFailure: versionFailure === 'stage',
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        const trace = calls(f);
        assert.ok(trace.some(line => line.includes('aborting remaining unit integration')));
        assert.ok(!trace.some(line => line.includes('second-branch')));
        assert.ok(!trace.some(line => /^git (push|restore|reset) /.test(line)));
        assert.ok(!trace.some(line => /^node scripts\/(catalog|plugin-readme)\.mjs/.test(line)));
        if (versionFailure === 'commit') {
          assert.ok(trace.some(line => line.startsWith('git commit --only ')));
          assert.notEqual(localGit(f, ['diff', '--cached', '--name-only']), '');
        }
        if (['schema', 'head', 'base', 'path', 'before', 'malformed', 'override', 'payload-cap'].includes(versionFailure)) {
          assert.ok(!trace.some(line => line.startsWith('node scripts/version.mjs apply')));
        }
        if (versionFailure === 'payload-cap') {
          assert.match(readFileSync(join(f.root, 'logs/daemon.log'), 'utf8'),
            new RegExp(`exceeds ${MAX_PLAN_BYTES} byte limit`));
          assert.equal(localGit(f, ['status', '--porcelain']), '');
        }
        if (['content', 'empty'].includes(versionFailure)) {
          assert.ok(trace.some(line => line.startsWith('node scripts/version.mjs apply')));
          assert.equal(localGit(f, ['status', '--porcelain']), '');
          assert.equal(JSON.parse(readFileSync(join(f.root, 'plugins/example/plugin.json'), 'utf8')).version, '1.0.0');
        }
        assertNextSyncPreserves(f);
      });
  }
}

test('actual bump_versions returns failure for a failed scoped version commit', options, t => {
  const f = localGitFixture(t);
  localGit(f, ['checkout', 'fixture-branch']);
  const result = runPath(f, 'bump_versions', {
    realGit: true, actualVersions: true, commitFailure: true,
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.equal(localGit(f, ['rev-parse', 'HEAD']), f.proposalHead);
  assert.notEqual(localGit(f, ['diff', '--cached', '--name-only']), '');
});

test('actual bump_versions verifies a no-op without manufacturing a version commit', options, t => {
  const f = localGitFixture(t);
  // The real no-op producer compares a clean branch with itself.
  localGit(f, ['checkout', 'main']);
  const before = checkoutSnapshot(f);
  const result = runPath(f, 'bump_versions', {
    realGit: true, actualVersions: true,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(checkoutSnapshot(f), before);
  assert.ok(!calls(f).some(line => /^git (add|commit) /.test(line)));
});

test('actual bump_versions accepts a bounded plan with a changelog above 1 MiB', options, t => {
  const f = localGitFixture(t, -1, true);
  localGit(f, ['checkout', 'fixture-branch']);
  const path = join(f.root, 'plugins/example/CHANGELOG.md');
  const historical = readFileSync(path, 'utf8') + '\n' + '- Historical café note.\n'.repeat(60_000);
  assert.ok(Buffer.byteLength(historical) > 1024 * 1024);
  writeFileSync(path, historical);
  localGit(f, ['add', '--', 'plugins/example/CHANGELOG.md']);
  localGit(f, ['commit', '-m', 'docs: historical fixture notes']);
  const result = runPath(f, 'bump_versions', { realGit: true, actualVersions: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const planBytes = readFileSync(join(f.root, 'logs/version-plan.json')).length;
  assert.ok(planBytes <= MAX_PLAN_BYTES);
  t.diagnostic(`changelog=${Buffer.byteLength(historical)} bytes; plan=${planBytes} bytes; cap=${MAX_PLAN_BYTES} bytes`);
  assert.ok(readFileSync(path, 'utf8').endsWith(historical.slice(historical.indexOf('## [1.0.0]'))));
  assert.equal(localGit(f, ['status', '--porcelain']), '');
});

test('actual bump_versions rejects an oversized producer plan without writes or commits', options, t => {
  const f = localGitFixture(t, -1, true);
  localGit(f, ['checkout', 'fixture-branch']);
  const path = join(f.root, 'plugins/example/CHANGELOG.md');
  const historical = readFileSync(path, 'utf8') + '\n' + '- Historical café note.\n'.repeat(180_000);
  const bytes = Buffer.byteLength(historical);
  assert.ok(bytes < MAX_PLAN_BYTES && bytes * 2 > MAX_PLAN_BYTES);
  writeFileSync(path, historical);
  localGit(f, ['add', '--', 'plugins/example/CHANGELOG.md']);
  localGit(f, ['commit', '-m', 'docs: oversized fixture history']);
  const before = checkoutSnapshot(f);
  const result = runPath(f, 'bump_versions', { realGit: true, actualVersions: true });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const log = readFileSync(join(f.root, 'logs/daemon.log'), 'utf8');
  assert.match(log, new RegExp(`Version plan exceeds ${MAX_PLAN_BYTES} byte limit`));
  assert.deepEqual(checkoutSnapshot(f), before);
  assert.equal(readFileSync(path, 'utf8'), historical);
  assert.ok(!calls(f).some(line => /^git (add|commit) /.test(line)));
  assert.ok(!calls(f).some(line => line.startsWith('node scripts/version.mjs apply')));
  const [, rejectedBytes] = log.match(/byte limit: (\d+) bytes/);
  t.diagnostic(`preserved changelog=${bytes} bytes; rejected plan=${rejectedBytes} bytes; producer cap=${MAX_PLAN_BYTES} bytes`);
});

for (const [subject, version] of [['feat: add feature', '1.1.0'], ['fix!: replace interface', '2.0.0']]) {
  test(`actual bump_versions consumes a ${version} release from the root producer`, options, t => {
    const f = localGitFixture(t, -1, true, subject);
    localGit(f, ['checkout', 'fixture-branch']);
    const result = runPath(f, 'bump_versions', { realGit: true, actualVersions: true });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(readFileSync(join(f.root, 'plugins/example/plugin.json'), 'utf8')).version, version);
    assert.equal(localGit(f, ['status', '--porcelain']), '');
    assert.equal(localGit(f, ['rev-parse', 'HEAD^']), f.proposalHead);
    assert.match(readFileSync(join(f.root, 'plugins/example/CHANGELOG.md'), 'utf8'),
      /Authored historical release note\./);
  });
}

for (const scenario of ['new', 'removed', 'already-bumped']) {
  test(`actual root producer and daemon preserve ${scenario} releases`, options, t => {
    const f = localGitFixture(t);
    localGit(f, ['checkout', 'fixture-branch']);
    const marketplacePath = join(f.root, '.github/plugin/marketplace.json');
    const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
    if (scenario === 'new') {
      marketplace.plugins.push({ name: 'added', version: '0.1.0', source: 'plugins/added' });
      mkdirSync(join(f.root, 'plugins/added'));
      writeFileSync(join(f.root, 'plugins/added/plugin.json'), '{"name":"added","version":"0.1.0"}\n');
      writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n');
    } else if (scenario === 'removed') {
      marketplace.plugins = [];
      writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n');
      rmSync(join(f.root, 'plugins/example'), { recursive: true });
    } else {
      const apply = runNode(f.root, ['scripts/version.mjs', 'apply', '--base', f.defaultHead]);
      assert.equal(apply.status, 0, apply.stderr);
    }
    localGit(f, ['add', '-A']);
    localGit(f, ['commit', '-m', 'chore: prepare release fixture']);
    const head = localGit(f, ['rev-parse', 'HEAD']);
    const result = runPath(f, 'bump_versions', { realGit: true, actualVersions: true });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(localGit(f, ['status', '--porcelain']), '');
    if (scenario === 'already-bumped') {
      assert.equal(localGit(f, ['rev-parse', 'HEAD']), head);
      assert.ok(!calls(f).some(line => /^git (add|commit) /.test(line)));
    } else {
      assert.equal(localGit(f, ['rev-parse', 'HEAD^']), head);
      const version = JSON.parse(readFileSync(marketplacePath, 'utf8')).metadata.version;
      assert.equal(version, scenario === 'removed' ? '2.0.0' : '1.0.1');
      if (scenario === 'new') {
        assert.equal(JSON.parse(readFileSync(join(f.root, 'plugins/added/plugin.json'), 'utf8')).version, '0.1.1');
      } else {
        assert.equal(localGit(f, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']),
          '.github/plugin/marketplace.json');
      }
    }
  });
}

for (const staged of [false, true]) {
  test(`actual bump_versions rejects pre-existing ${staged ? 'staged' : 'working'} authored edits before planning`,
    options, t => {
      const f = localGitFixture(t);
      localGit(f, ['checkout', 'fixture-branch']);
      writeFileSync(join(f.root, 'README.md'), 'Pre-version authored content.\n');
      if (staged) localGit(f, ['add', '--', 'README.md']);
      const before = checkoutSnapshot(f);
      const result = runPath(f, 'bump_versions', { realGit: true, actualVersions: true });
      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.deepEqual(checkoutSnapshot(f), before);
      assert.ok(!calls(f).some(line => line.startsWith('node scripts/version.mjs')));
    });
}

for (const state of ['dirty', 'untracked', 'staged', 'proposal', 'detached', 'ahead', 'diverged']) {
  test(`actual sync_repo preserves ${state} checkout state without resets`, options, t => {
    const f = localGitFixture(t);
    if (state === 'dirty' || state === 'staged') {
      writeFileSync(join(f.root, 'unrelated.txt'), 'Sync-time authored content.\n');
      if (state === 'staged') localGit(f, ['add', 'unrelated.txt']);
    } else if (state === 'untracked') {
      writeFileSync(join(f.root, 'concurrent.txt'), 'Sync-time untracked content.\n');
    } else if (state === 'proposal') {
      localGit(f, ['checkout', 'fixture-branch']);
    } else if (state === 'detached') {
      localGit(f, ['checkout', '--detach', f.defaultHead]);
    } else {
      localGit(f, ['merge', '--ff-only', 'fixture-branch']);
      if (state === 'diverged') {
        localGit(f, ['checkout', '-b', 'remote-side', f.defaultHead]);
        writeFileSync(join(f.root, 'unrelated.txt'), 'Remote fixture change.\n');
        localGit(f, ['add', 'unrelated.txt']);
        localGit(f, ['commit', '-m', 'Fixture remote divergence', '-m',
          'Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>']);
        localGit(f, ['update-ref', 'refs/remotes/fixture-remote/main', localGit(f, ['rev-parse', 'HEAD'])]);
        localGit(f, ['checkout', 'main']);
      }
    }
    assertNextSyncPreserves(f);
    if (state === 'proposal' || state === 'detached') {
      assert.doesNotMatch(readFileSync(join(f.root, 'logs/sync-calls.log'), 'utf8'), /^git fetch /m);
    }
  });
}

for (const failure of ['fetch', 'merge', 'fetch-edit', 'missing-remote', 'merge-noop', 'merge-edit']) {
  test(`actual sync_repo reports ${failure} failure without success fallback`, options, t => {
    const f = localGitFixture(t);
    localGit(f, ['update-ref', 'refs/remotes/fixture-remote/main', f.proposalHead]);
    if (failure === 'missing-remote') localGit(f, ['update-ref', '-d', 'refs/remotes/fixture-remote/main']);
    const before = checkoutSnapshot(f);
    const result = runSync(f, {
      fetchFailure: failure === 'fetch', mergeFailure: failure === 'merge',
      fetchEdit: failure === 'fetch-edit',
      mergeNoop: failure === 'merge-noop', mergeEdit: failure === 'merge-edit',
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(localGit(f, ['rev-parse', 'HEAD']), failure === 'merge-edit' ? f.proposalHead : before.head);
    assert.equal(localGit(f, ['rev-parse', '--abbrev-ref', 'HEAD']), before.branch);
    if (failure === 'fetch-edit' || failure === 'merge-edit') {
      assert.equal(readFileSync(join(f.root, 'unrelated.txt'), 'utf8'),
        failure === 'fetch-edit' ? 'Concurrent fetch-time work.\n' : 'Concurrent merge-time work.\n');
      assertNextSyncPreserves(f);
    } else {
      assert.deepEqual(checkoutSnapshot(f), before);
    }
    const trace = readFileSync(join(f.root, 'logs/sync-calls.log'), 'utf8');
    assert.doesNotMatch(trace, /repo synced:|^git (reset|checkout) /m);
    if (failure === 'fetch-edit' || failure === 'fetch') assert.doesNotMatch(trace, /^git merge /m);
  });
}

for (const forward of [false, true]) {
  test(`actual sync_repo verifies a clean ${forward ? 'fast-forward' : 'already-current'} result`, options, t => {
    const f = localGitFixture(t);
    const expected = forward ? f.proposalHead : f.defaultHead;
    localGit(f, ['update-ref', 'refs/remotes/fixture-remote/main', expected]);
    const result = runSync(f);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(localGit(f, ['symbolic-ref', '--short', 'HEAD']), 'main');
    assert.equal(localGit(f, ['rev-parse', 'HEAD']), expected);
    assert.equal(localGit(f, ['status', '--porcelain', '--untracked-files=all']), '');
    assert.doesNotMatch(readFileSync(join(f.root, 'logs/sync-calls.log'), 'utf8'), /^git (reset|checkout) /m);
  });
}
