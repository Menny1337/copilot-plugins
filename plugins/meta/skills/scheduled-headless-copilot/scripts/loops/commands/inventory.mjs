import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { exactPayload, requireStringArray } from "../lib/control-payload.mjs";

const execFileAsync = promisify(execFile);

function issue(message, code, filePath = null, extra = {}) {
  return { message, code, path: filePath, ...extra };
}

function copilotHome(env = process.env) {
  if (env.COPILOT_HOME) return path.resolve(env.COPILOT_HOME);
  return path.join(env.HOME ? path.resolve(env.HOME) : os.homedir(), ".copilot");
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

async function parseFrontmatter(filePath) {
  const content = await fsp.readFile(filePath, "utf8");
  const lines = content.split("\n");
  const result = {};
  let inFrontmatter = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      }
      break;
    }
    if (!inFrontmatter) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function toBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value !== "string") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function upsert(map, item) {
  const existing = map.get(item.name);
  if (!existing) {
    map.set(item.name, { ...item });
    return;
  }
  map.set(item.name, {
    ...item,
    ...existing,
    enabled: existing.enabled || item.enabled,
    description: existing.description ?? item.description,
    plugin: existing.plugin ?? item.plugin,
    source: existing.source ?? item.source,
    path: existing.path ?? item.path,
    version: existing.version ?? item.version,
    scope: existing.scope ?? item.scope,
    userInvocable: existing.userInvocable ?? item.userInvocable,
  });
}

async function scanAgentsDir(dir, source, pluginName, enabled, agentMap, errors) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      errors.push(issue(`Failed to scan agents in ${dir}: ${error.message}`, "agents_scan_failed", dir));
    }
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".agent.md")) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const frontmatter = await parseFrontmatter(filePath);
      upsert(agentMap, {
        name: frontmatter.name || entry.name.replace(/\.agent\.md$/, ""),
        enabled,
        plugin: pluginName,
        description: frontmatter.description,
        source,
        path: filePath,
      });
    } catch (error) {
      errors.push(issue(`Failed to parse agent frontmatter in ${filePath}: ${error.message}`, "agent_parse_failed", filePath));
    }
  }
}

async function scanSkillsDir(dir, source, pluginName, enabled, skillMap, errors) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      errors.push(issue(`Failed to scan skills in ${dir}: ${error.message}`, "skills_scan_failed", dir));
    }
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(dir, entry.name, "SKILL.md");
    try {
      const frontmatter = await parseFrontmatter(filePath);
      upsert(skillMap, {
        name: frontmatter.name || entry.name,
        enabled,
        plugin: pluginName,
        description: frontmatter.description,
        userInvocable: toBoolean(frontmatter["user-invocable"]),
        source,
        path: filePath,
      });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      errors.push(issue(`Failed to parse skill frontmatter in ${filePath}: ${error.message}`, "skill_parse_failed", filePath));
    }
  }
}

async function registerPluginDirectory(
  pluginDir,
  source,
  enabled,
  pluginMap,
  skillMap,
  agentMap,
  errors,
  { requireManifest = true } = {},
) {
  let pluginName = path.basename(pluginDir);
  const plugin = {
    name: pluginName,
    enabled,
    source,
  };
  const manifestCandidates = [
    path.join(pluginDir, "plugin.json"),
    ...(requireManifest ? [] : [path.join(pluginDir, ".claude-plugin", "plugin.json")]),
  ];
  let manifestFound = false;
  for (const manifestPath of manifestCandidates) {
    try {
      const pluginJson = await readJson(manifestPath);
      manifestFound = true;
      if (typeof pluginJson.name === "string" && pluginJson.name.length > 0) {
        pluginName = pluginJson.name;
        plugin.name = pluginJson.name;
      }
      if (typeof pluginJson.version === "string") plugin.version = pluginJson.version;
      if (typeof pluginJson.description === "string") plugin.description = pluginJson.description;
      break;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      errors.push(issue(`Failed to read ${manifestPath}: ${error.message}`, "plugin_parse_failed", manifestPath));
      break;
    }
  }
  if (!manifestFound && requireManifest) {
    const manifestPath = path.join(pluginDir, "plugin.json");
    errors.push(issue(`Local plugin directory is missing plugin.json: ${pluginDir}`, "plugin_manifest_missing", manifestPath));
  }
  upsert(pluginMap, plugin);
  await scanSkillsDir(path.join(pluginDir, "skills"), source, pluginName, enabled, skillMap, errors);
  await scanAgentsDir(path.join(pluginDir, "agents"), source, pluginName, enabled, agentMap, errors);
}

async function scanInstalledPlugins(installedDir, pluginEnabledMap, pluginMap, skillMap, agentMap, errors) {
  let marketplaces = [];
  try {
    marketplaces = await fsp.readdir(installedDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      errors.push(issue(`Failed to scan installed plugins in ${installedDir}: ${error.message}`, "installed_plugins_scan_failed", installedDir));
    }
    return;
  }

  for (const entry of marketplaces) {
    if (!entry.isDirectory()) continue;
    const marketplaceName = entry.name;
    const marketplaceDir = path.join(installedDir, marketplaceName);
    let plugins = [];
    try {
      plugins = await fsp.readdir(marketplaceDir, { withFileTypes: true });
    } catch (error) {
      errors.push(issue(`Failed to scan installed plugins in ${marketplaceDir}: ${error.message}`, "installed_plugins_scan_failed", marketplaceDir));
      continue;
    }
    for (const pluginEntry of plugins) {
      if (!pluginEntry.isDirectory()) continue;
      const pluginDir = path.join(marketplaceDir, pluginEntry.name);
      const source = marketplaceName === "_direct" ? "direct" : `marketplace:${marketplaceName}`;
      const enabled = pluginEnabledMap.has(pluginEntry.name) ? pluginEnabledMap.get(pluginEntry.name) : true;
      await registerPluginDirectory(
        pluginDir,
        source,
        enabled,
        pluginMap,
        skillMap,
        agentMap,
        errors,
        { requireManifest: false },
      );
    }
  }
}

function sortedValues(map) {
  return [...map.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function validatePayload(payload) {
  const body = exactPayload(payload ?? {}, { required: [], optional: ["localPluginDirectories"] });
  return {
    localPluginDirectories: body.localPluginDirectories === undefined
      ? []
      : requireStringArray(body.localPluginDirectories, "payload.localPluginDirectories", { absolute: true, unique: true }),
  };
}

export async function getInventory(payload = {}, execFn = execFileAsync, options = {}) {
  const env = options.env ?? process.env;
  const input = validatePayload(payload);
  const inventory = {
    schemaVersion: 1,
    healthy: true,
    plugins: [],
    skills: [],
    agents: [],
    errors: [],
  };
  const pluginMap = new Map();
  const skillMap = new Map();
  const agentMap = new Map();
  const pluginEnabledMap = new Map();
  const execOpts = {
    timeout: 15000,
    maxBuffer: 5 * 1024 * 1024,
    env,
  };

  try {
    const { stdout } = await execFn("copilot", ["plugins", "list", "--json"], execOpts);
    const parsed = JSON.parse(stdout);
    const plugins = Array.isArray(parsed?.plugins) ? parsed.plugins : Array.isArray(parsed) ? parsed : [];
    for (const plugin of plugins) {
      if (plugin.kind !== undefined && plugin.kind !== "plugin") continue;
      const item = {
        name: plugin.name,
        enabled: plugin.enabled === true,
        version: typeof plugin.version === "string" ? plugin.version : undefined,
        description: typeof plugin.description === "string" ? plugin.description : undefined,
        source: typeof plugin.source === "string" ? plugin.source : undefined,
        scope: typeof plugin.scope === "string" ? plugin.scope : undefined,
      };
      pluginEnabledMap.set(plugin.name, item.enabled);
      upsert(pluginMap, item);
    }
  } catch (error) {
    inventory.errors.push(issue(
      `Failed to query 'copilot plugins list --json': ${error.message}`,
      "plugins_list_failed",
      null,
      { remedy: "Run 'copilot plugins list --json' manually" },
    ));
  }

  try {
    const { stdout } = await execFn("copilot", ["skill", "list", "--json"], execOpts);
    const parsed = JSON.parse(stdout);
    const skills = Array.isArray(parsed?.skills) ? parsed.skills : Array.isArray(parsed) ? parsed : [];
    for (const skill of skills) {
      upsert(skillMap, {
        name: skill.name,
        enabled: skill.enabled === true,
        plugin: typeof skill.plugin === "string" ? skill.plugin : undefined,
        description: typeof skill.description === "string" ? skill.description : undefined,
        userInvocable: typeof skill.userInvocable === "boolean" ? skill.userInvocable : undefined,
        source: typeof skill.source === "string" ? skill.source : undefined,
        path: typeof skill.path === "string" ? skill.path : undefined,
      });
    }
  } catch (error) {
    inventory.errors.push(issue(
      `Failed to query 'copilot skill list --json': ${error.message}`,
      "skills_list_failed",
      null,
      { remedy: "Run 'copilot skill list --json' manually" },
    ));
  }

  const home = copilotHome(env);
  await scanSkillsDir(path.join(home, "skills"), "user", undefined, true, skillMap, inventory.errors);
  await scanAgentsDir(path.join(home, "agents"), "user", undefined, true, agentMap, inventory.errors);
  await scanInstalledPlugins(path.join(home, "installed-plugins"), pluginEnabledMap, pluginMap, skillMap, agentMap, inventory.errors);

  for (const pluginDir of input.localPluginDirectories) {
    try {
      const stats = await fsp.stat(pluginDir);
      if (!stats.isDirectory()) {
        inventory.errors.push(issue(`Local plugin directory is not a directory: ${pluginDir}`, "plugin_directory_invalid", pluginDir));
        continue;
      }
    } catch (error) {
      inventory.errors.push(issue(`Local plugin directory does not exist: ${pluginDir}`, "plugin_directory_missing", pluginDir));
      continue;
    }
    await registerPluginDirectory(pluginDir, "local", true, pluginMap, skillMap, agentMap, inventory.errors);
  }

  inventory.plugins = sortedValues(pluginMap);
  inventory.skills = sortedValues(skillMap);
  inventory.agents = sortedValues(agentMap);
  inventory.healthy = inventory.errors.length === 0;
  return inventory;
}
