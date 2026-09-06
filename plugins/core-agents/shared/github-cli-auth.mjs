import { spawnSync } from 'node:child_process';

function githubLogin(env) {
  const result = spawnSync('gh', ['api', 'user', '--jq', '.login'], {
    encoding: 'utf8',
    env,
  });
  if (result.error && result.error.code === 'ENOENT') {
    return { login: '', error: 'the `gh` CLI was not found on PATH.' };
  }
  if (result.error) {
    return { login: '', error: `failed to run gh: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return {
      login: '',
      error: `gh api user failed (exit ${result.status}): ${(result.stderr || '').trim().slice(0, 500)}`,
    };
  }
  return { login: result.stdout.trim(), error: null };
}

/**
 * For a user-owned board, select only an identity that exactly matches the
 * configured owner. A matching keyring account may override a mismatched
 * ambient token; otherwise fail closed before the caller performs any API work.
 */
function selectGithubCliEnv({ owner, ownerType }, env = process.env) {
  if (ownerType !== 'user') return env;

  const hasAmbientToken = !!(env.GH_TOKEN || env.GITHUB_TOKEN);
  const ambient = githubLogin(env);
  const ambientLogin = ambient.login;
  if (ambientLogin === owner) return env;

  let keyringLogin = ambientLogin;
  let keyringEnv = env;
  let keyringError = ambient.error;
  if (hasAmbientToken) {
    keyringEnv = { ...env };
    delete keyringEnv.GH_TOKEN;
    delete keyringEnv.GITHUB_TOKEN;
    const keyring = githubLogin(keyringEnv);
    keyringLogin = keyring.login;
    keyringError = keyring.error;
    if (keyringLogin === owner) return keyringEnv;
  }

  const probeError = ambient.error || keyringError;
  if (!ambientLogin && !keyringLogin && probeError) throw new Error(probeError);

  const observed = [ambientLogin, hasAmbientToken ? keyringLogin : null]
    .filter((login, index, all) => login && all.indexOf(login) === index);
  const detail = observed.length > 0
    ? `found ${observed.map((login) => JSON.stringify(login)).join(' and ')}`
    : 'no authenticated GitHub CLI login was available';
  throw new Error(`GitHub CLI identity mismatch for user-owned board: configured owner is ${JSON.stringify(owner)}, but ${detail}. Authenticate as the configured owner or provide a matching GH_TOKEN/GITHUB_TOKEN.`);
}

export { selectGithubCliEnv };
