---
name: plugin-crafting
description: "Builds and troubleshoots Copilot CLI plugins and marketplaces. Use for plugin.json or marketplace.json, packaging agents/skills/hooks/commands/extensions/MCP/LSP servers, install or enable flows, private authentication, and discovery issues."
user-invocable: false
compatibility: "GitHub Copilot CLI plugin and marketplace system."
---

# How to Build Copilot CLI Plugins and Marketplaces

A practical workflow for packaging agents, skills, hooks, commands, and servers into a
Copilot CLI **plugin**, and for publishing plugins through a **marketplace**.

Command surface and manifest fields change often. Verify version-sensitive details against
`../agent-skill-audit/references/cli-feature-baseline.md`, and treat `copilot plugin --help`
as definitive.

## When to Use

- Creating or fixing a `plugin.json` manifest
- Bundling existing agents/skills/hooks/commands/MCP/LSP servers into one installable plugin
- Creating or maintaining a `marketplace.json` (publishing plugins for others to install)
- Debugging why a plugin won't install, load, or enable
- Looking up plugin/marketplace schema, install specs, or file locations

## When to Skip

- Writing the **agent** inside a plugin — use `agent-crafting`
- Writing the **skill** inside a plugin — use `skill-crafting`
- Writing the **hooks** inside a plugin — use `hooks-crafting`
- Auditing an existing agent/skill/hook system for quality — use `agent-skill-audit`

A plugin is just packaging. Author the components with their own skills, then use this skill
to wrap and distribute them.

## What a Plugin Is

A plugin is a directory with a `plugin.json` manifest (commonly at the plugin root — see
[manifest discovery order](#manifest-discovery-order) for alternates) plus any components it
ships. The CLI loads a plugin's agents, skills, hooks, commands, and MCP/LSP servers when the
plugin is installed and enabled. A **marketplace** is a `marketplace.json` that lists one or
more plugins so people can discover and install them with `plugin@marketplace`.

```
my-plugin/
├── plugin.json          # Required — manifest at the plugin root
├── agents/<name>.agent.md
├── skills/<skill>/SKILL.md
├── hooks/hooks.json     # or hooks.json at root
├── commands/            # optional CLI commands
└── .mcp.json            # optional MCP server config
```

## `plugin.json` Schema

### Required field

| Field | Type | Constraint |
|-------|------|------------|
| `name` | string | Kebab-case (letters, numbers, hyphens). Max 64 chars. |

### Optional metadata

| Field | Type | Notes |
|-------|------|-------|
| `description` | string | Max 1024 chars |
| `version` | string | Semantic version, e.g. `1.0.0` |
| `author` | object | `{ name (required), email?, url? }` |
| `homepage` | string | URL |
| `repository` | string | Source repo URL |
| `license` | string | SPDX id, e.g. `MIT` |
| `keywords` | string[] | Search keywords |
| `category` | string | Plugin category |
| `tags` | string[] | Additional tags |

### Component path fields

These tell the CLI where each component type lives. **All optional** — the CLI uses default
conventions when omitted.

| Field | Type | Default | Points to |
|-------|------|---------|-----------|
| `agents` | string \| string[] | `agents/` | Directories of `.agent.md` files |
| `skills` | string \| string[] | `skills/` | Directories of `SKILL.md` files |
| `commands` | string \| string[] | — | Command directories |
| `hooks` | string \| object | — | A hooks config **file** path, or an inline hooks object |
| `extensions` | string \| string[] \| object | — | Extension dirs; `{ paths: [...], exclusive: true }` suppresses built-ins |
| `mcpServers` | string \| object | — | MCP config file (e.g. `.mcp.json`) or inline server defs |
| `lspServers` | string \| object | — | LSP config file or inline server defs |

> **`hooks` must point at the file, not the directory.** Use `"hooks": "hooks/hooks.json"` (or
> `"hooks.json"`). A bare directory is `readFile()`d at load and throws `EISDIR`, so the plugin
> fails to load. Author the hook entries with `hooks-crafting`.

> **Workspace MCP config is separate from plugin MCP config.** Independently of any plugin,
> the CLI auto-loads workspace MCP servers from `.mcp.json` **and `.github/mcp.json`**
> (1.0.61). `.vscode/mcp.json` and devcontainer config are *not* CLI sources. Use a plugin's
> `mcpServers` when the server belongs to the plugin; use the workspace files when it belongs
> to the repository.

### Example `plugin.json`

```json
{
  "name": "my-dev-tools",
  "description": "React development utilities",
  "version": "1.2.0",
  "author": { "name": "Jane Doe", "email": "jane@example.com" },
  "license": "MIT",
  "keywords": ["react", "frontend"],
  "agents": "agents/",
  "skills": ["skills/", "extra-skills/"],
  "hooks": "hooks/hooks.json",
  "mcpServers": ".mcp.json"
}
```

### Bundling MCP and LSP servers

`mcpServers` accepts a config-file path or an inline object. `lspServers` lets a plugin ship
Language Server Protocol servers for language intelligence. Each LSP entry takes one of
`command` / `bash` / `powershell` (plus optional `cwd`, `args`, `env`, `rootUri`,
`initializationOptions`) and a required `fileExtensions` map. Use `${PLUGIN_ROOT}` to
reference files inside the plugin and prefer `bash` + `powershell` for cross-platform parity:

```json
{
  "lspServers": {
    "my-lsp": {
      "bash": "${PLUGIN_ROOT}/scripts/start-lsp.sh",
      "powershell": "${PLUGIN_ROOT}/scripts/start-lsp.ps1",
      "fileExtensions": { ".myext": "mylang" }
    }
  }
}
```

## `marketplace.json` Schema

Publish plugins by creating a `marketplace.json` (commonly at `.github/plugin/marketplace.json`).

### Top-level fields

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `name` | Yes | string | Kebab-case, max 64 chars |
| `owner` | Yes | object | `{ name, email? }` |
| `plugins` | Yes | array | Plugin entry objects (below) |
| `metadata` | No | object | `{ description?, version?, pluginRoot? }` |

### Plugin entry fields

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Kebab-case, max 64 chars |
| `source` | Yes | Where to fetch it — relative path, GitHub, or URL (see below) |
| `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `category`, `tags` | No | Same meaning as in `plugin.json` |
| `commands`, `agents`, `skills`, `hooks`, `mcpServers`, `lspServers` | No | Component path overrides |
| `strict` | No | Default `true` (full validation). `false` relaxes rules for direct/legacy plugins |

Keep `strict: true` unless a verified legacy compatibility issue requires otherwise. Document
the exception and its validation gap when using `strict: false`.

`source` is usually a path relative to the repo root (`"plugins/my-plugin"` — leading `./`
optional). It can also be an object that points at a remote GitHub repository (repo +
subdirectory path) or a Git URL — see the plugin reference for the exact object shape before
relying on it.

### Example `marketplace.json`

```json
{
  "name": "my-marketplace",
  "owner": { "name": "Your Org", "email": "plugins@example.com" },
  "metadata": { "description": "Curated team plugins", "version": "1.0.0" },
  "plugins": [
    { "name": "frontend-design", "description": "GUI helpers", "version": "2.1.0", "source": "plugins/frontend-design" }
  ]
}
```

## Install, Enable, and File Locations

### CLI commands (run in the terminal, not slash commands)

`copilot plugin` and `copilot plugins` **overlap but are not identical**. Both accept
`install`, `list`, `marketplace`, and `update`. `uninstall` is **singular-only**;
`enable`, `disable`, `remove|rm`, and the cross-kind `--plugin`/`--mcp`/`--skill` flags
are **plural-only**. Using the wrong form fails with
`error: too many arguments for 'plugin'`.

```
copilot plugin install SPEC          # SPEC: plugin@marketplace | OWNER/REPO[:PATH] | git-url | ./path
copilot plugin uninstall NAME        # singular only
copilot plugin list
copilot plugin update NAME [--all]
copilot plugins enable NAME          # plural only
copilot plugins disable NAME         # plural only
copilot plugins remove NAME          # plural only (alias: rm)

copilot plugin marketplace add SOURCE      # owner/repo | owner/repo#ref | URL | local dir
copilot plugin marketplace list [--json]
copilot plugin marketplace browse NAME [--json]
copilot plugin marketplace update [NAME]   # omit NAME to update all (no `refresh` alias)
copilot plugin marketplace remove NAME [--force]

copilot plugins install --skill <FILE|URL|DIR> [--scope user|project]
copilot plugins enable|disable|remove NAME --plugin|--mcp|--skill
```

- `--plugin` is the default kind for `enable` / `disable` / `remove`.
- `marketplace remove` is refused while plugins from it are installed; `--force` uninstalls
  them too. The built-in `copilot-plugins` and `awesome-copilot` marketplaces cannot be removed.
- A marketplace registers under its own `name` from `marketplace.json` — there is no local alias.
- MCP servers install from a policy-configured registry, not `copilot plugins install`; use the
  `/plugins` dashboard or `/mcp`.
- `--config-dir` is deprecated — use `COPILOT_HOME`.
- `COPILOT_PLUGIN_DIR_ONLY` disables automatic plugin discovery, giving a deterministic set
  alongside `--plugin-dir`.

### Declarative enable via settings

`enabledPlugins` in `settings.json` is a `Record<string, boolean>` keyed by plugin spec
(`"plugin@marketplace": true`). It exists at user and repository level; the repository value
overrides the user value for the same key. A common failure mode is enabling only one plugin
from a marketplace when a needed skill or hook lives in a **different** plugin — enable every
plugin whose components you depend on.

### Locations (reference)

| Item | Path |
|------|------|
| Installed (marketplace) | `~/.copilot/installed-plugins/<marketplace>/<plugin>/` |
| Installed (direct) | `~/.copilot/installed-plugins/_direct/<source-id>/` |
| Plugin persistent data | `~/.copilot/plugin-data/` |
| Marketplace cache | `~/.cache/copilot/marketplaces/` (Linux), `~/Library/Caches/copilot/marketplaces/` (macOS); override with `COPILOT_CACHE_HOME` |

### Private GitHub marketplace authentication

Copilot CLI 1.0.70+ invokes marketplace Git operations with
`credential.helper=`, `core.askPass=`, `credential.interactive=never`, and
`GIT_TERMINAL_PROMPT=0`. This makes failures fast and non-interactive, but it also
prevents private repositories from using the user's normal GitHub CLI, GCM, or
Keychain credential helper.

When a private marketplace is registered but its cache is missing:

1. Confirm the repository is private and normal system Git can read it:
   `git ls-remote https://github.com/OWNER/REPO.git HEAD`.
2. Repair GitHub/SAML authorization if needed:
   `agency marketplace add --marketplace OWNER/REPO --engine copilot --fix-git-auth`.
3. If `copilot plugin marketplace update NAME` still reports an authentication
   failure, clone or pull the registered repository with normal system Git at the
   platform marketplace-cache path. Do not embed tokens in clone URLs or Git config.
4. Replace the failing remote source with that checkout as a local marketplace.
   Do this through a settings API where available, or atomically update the
   marketplace entry in `settings.json` to
   `{ "source": { "source": "directory", "path": "/ABSOLUTE/PATH/TO/CACHE" } }`.
   Do not run `marketplace remove` against a cache you still need: removal can
   delete that checkout. The manifest keeps the same marketplace name, so existing
   `plugin@marketplace` specs remain valid. Preserve the credential-free remote URL
   outside the cache so an eviction can be re-cloned after the source becomes local.
5. Verify the marketplace manifest and required plugin directories exist before
   launching with `--plugin-dir` or running `copilot plugin update --all`.

Capture and surface marketplace-update stderr. Do not replace a real clone error
with a generic "cache missing" message, and verify the expected cache content
rather than assuming a registration or update command populated it.

### Manifest discovery order

The CLI checks these paths in order and uses the first found:

- **Plugin:** `.plugin/plugin.json` → `plugin.json` → `.github/plugin/plugin.json` → `.claude-plugin/plugin.json`
- **Marketplace:** `marketplace.json` → `.plugin/marketplace.json` → `.github/plugin/marketplace.json` → `.claude-plugin/marketplace.json`

The `.claude-plugin/` paths are cross-tool aliases for Claude Code compatibility. The CLI also
reads a shared subset of `.claude/settings.json` (`enabledPlugins`, `extraKnownMarketplaces`,
`hooks`, `disableAllHooks`, `companyAnnouncements`).

## Step-by-Step: Create a Plugin

1. **Make the directory** and add `plugin.json` with at least `name` (kebab-case).
2. **Add components** — author each with its own skill (`agent-crafting`, `skill-crafting`,
   `hooks-crafting`). Put them under the default `agents/` and `skills/` dirs, or set custom
   paths in the manifest.
3. **Wire hooks/servers** — point `hooks` at the hooks **file**; add `mcpServers`/`lspServers`
   if shipping servers.
4. **Add metadata** — `description`, `version`, `author`, `license`, `keywords` aid discovery.
5. **Test locally** — `copilot plugin install ./my-plugin`, then `copilot plugin list` and
   verify the agents/skills/hooks load (e.g. via `/env`).
6. **Publish (optional)** — add the plugin to a `marketplace.json`, register it with
   `copilot plugin marketplace add`, and install via `plugin@marketplace`.

## Marketplace Governance (optional but recommended)

Marketplaces that host multiple plugins usually add their own rules on top of the schema:
unique component names across plugins, generated catalog/README indexes, and a version policy
that bumps a plugin's `version` (in both `plugin.json` and the matching `marketplace.json`
entry) plus the marketplace `metadata.version` whenever plugin source changes. Follow the host
repo's `AGENTS.md`/CI for the exact workflow; treat any generated index files as outputs.

> **Name uniqueness is governance, not a CLI requirement — for skills.** Since CLI 1.0.66,
> same-named skills from different plugins coexist and are disambiguated by `invocationName`,
> so a collision is a clarity problem rather than a load failure; enforce it as a warning.
> Agent names are different — keep those strictly unique.

### Pinning and reproducibility

- Set `sha` in a plugin's source configuration to pin it to an exact commit (CLI 1.0.70).
  Prefer this over a floating branch for anything unattended.
- `owner/repo#ref` on `marketplace add` pins the marketplace itself to a ref.
- A trusted repository can auto-install plugins, extend `extraKnownMarketplaces`, pin the
  model/effort/context tier, and extend URL/MCP/skill deny lists via
  `.github/copilot/settings.json` (CLI 1.0.70).

### Open Plugin Spec v1 (CLI 1.0.74)

Opt in by setting the canonical Agent Plugins v1.0.0 `$schema` URL in `plugin.json`. It is
additive: opted-in plugins and marketplaces may use dots in names (e.g. `acme.tools`), the
`extensions` field changes meaning, and `mcp.json` configuration is supported. Leave `$schema`
off to keep the existing behaviour.

## Security and Supply-Chain Review

Treat a plugin like installed software, not passive documentation:

- Inspect the manifest and every shipped agent, skill, hook, command, extension, script,
  MCP/LSP configuration, binary, and external URL before installing an untrusted source.
- Confirm each capability matches the plugin's description; unexpected network access,
  broad filesystem operations, dynamic command construction, or opaque binaries are blockers.
- Prefer trusted, versioned sources and immutable refs for automation. Record provenance and
  license; do not silently follow a mutable external dependency.
- Apply least privilege to tools, MCP credentials, hook `allowedEnvVars`, paths, and network
  access. Never embed tokens in URLs, manifests, scripts, or Git configuration.
- Test locally with non-sensitive data before enabling organization-wide or unattended use.
- Re-review dependencies and permissions when updating; a previously trusted source can change.

## Verify

- [ ] `plugin.json` has a kebab-case `name` (≤ 64 chars); JSON parses cleanly
- [ ] Component paths exist; defaults (`agents/`, `skills/`) used or overridden correctly
- [ ] `hooks` points at the hooks **file** (`hooks/hooks.json`), never a bare directory
- [ ] `marketplace.json` (if publishing) has `name`, `owner`, and a `plugins` array; each entry's `source` resolves to a real directory
- [ ] Plugin `name` and `version` match between `plugin.json` and the marketplace entry
- [ ] Plugin installs (`copilot plugin install ./path`) and components appear in `/env`
- [ ] Needed plugins are listed in `enabledPlugins`
- [ ] Third-party code, hooks, extensions, external URLs, and server configs pass supply-chain review
- [ ] Permissions, credentials, paths, and network access are no broader than the plugin requires
- [ ] Host repo's validator / catalog regeneration passes (if the marketplace has one)

## References

- [GitHub Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- [Creating a plugin for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [Creating a plugin marketplace for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace)
- [Copilot CLI 1.0.70 release notes](https://github.com/github/copilot-cli/releases/tag/v1.0.70)
- [Private marketplace authentication issue](https://github.com/github/copilot-cli/issues/1243)
