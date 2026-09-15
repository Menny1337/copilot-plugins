import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function configSelection(explicit, env = process.env, home = homedir()) {
  const override = explicit ?? (env.COPILOT_PLUGIN_ASSISTANT_CONFIG || env.COPILOT_PLUGIN_ADO_CONFIG || undefined);
  let path = override ?? join(home, '.copilot', 'assistant', 'config.json');
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('assistant config: provide a non-empty config path');
  }
  if (path === '~') path = home;
  else if (/^~[/\\]/.test(path)) path = join(home, path.slice(2));
  return { path: resolve(path), explicit: override !== undefined };
}

export function readAssistantConfig(explicit, { optional = false, env, home } = {}) {
  const selection = configSelection(explicit, env, home);
  let raw;
  try {
    raw = readFileSync(selection.path, 'utf8');
  } catch (error) {
    if (optional && !selection.explicit && error.code === 'ENOENT') {
      return { ...selection, cfg: {} };
    }
    throw new Error('assistant config not found or unreadable: check --config, COPILOT_PLUGIN_ASSISTANT_CONFIG, COPILOT_PLUGIN_ADO_CONFIG or ~/.copilot/assistant/config.json');
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    throw new Error('assistant config is not valid JSON; correct the selected file');
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error('assistant config must be a JSON object');
  }
  return { ...selection, cfg };
}

export function validateBoard(cfg, backend) {
  const board = cfg[backend];
  const text = value => typeof value === 'string' && value.trim().length > 0;
  if (backend === 'github') {
    if (!board || !text(board.owner) || !text(board.repo)) {
      throw new Error('configure github.owner, github.repo and github.projectNumber in the selected config');
    }
    if (!['string', 'number'].includes(typeof board.projectNumber)
        || !Number.isSafeInteger(Number(board.projectNumber)) || Number(board.projectNumber) <= 0) {
      throw new Error('config.github.projectNumber must be a positive integer');
    }
    if (board.ownerType !== undefined && !['user', 'org'].includes(board.ownerType)) {
      throw new Error('config.github.ownerType must be "user" or "org"');
    }
  } else if (!board || !text(board.org) || !text(board.project)) {
    throw new Error(`configure ${backend}.org and ${backend}.project in the selected config`);
  }
  return board;
}

export function selectedBackend(cfg) {
  const backend = Object.hasOwn(cfg, 'taskBackend') ? cfg.taskBackend : 'markdown';
  if (!['markdown', 'ado', 'github'].includes(backend)) {
    throw new Error('assistant config.taskBackend must be "markdown", "ado" or "github"');
  }
  if (backend !== 'markdown') validateBoard(cfg, backend);
  return backend;
}
