<!-- validate:allow-user-paths -->

# Copilot CLI feature baseline

Verified facts about the GitHub Copilot CLI, and the procedure for re-verifying
them. Shared by `skill-crafting`, `agent-crafting`, `hooks-crafting`,
`plugin-crafting`, and `scheduled-headless-copilot`.

**Baseline version: Copilot CLI 1.0.75.** Everything below was confirmed against
that release. Re-run [the verification procedure](#re-verification-procedure)
before relying on this file against a newer CLI.

## Contents

- [Why this file exists](#why-this-file-exists)
- [Re-verification procedure](#re-verification-procedure)
- [Skill frontmatter](#skill-frontmatter)
- [Skill discovery locations](#skill-discovery-locations)
- [Skill management commands](#skill-management-commands)
- [Skill retrieval and invocation behavior](#skill-retrieval-and-invocation-behavior)
- [Agent frontmatter](#agent-frontmatter)
- [Subagent settings](#subagent-settings)
- [Hook semantics that changed](#hook-semantics-that-changed)
- [Plugin and marketplace commands](#plugin-and-marketplace-commands)
- [Plugin manifest surface](#plugin-manifest-surface)
- [Headless flags and environment](#headless-flags-and-environment)
- [OS sandbox](#os-sandbox)
- [Version index](#version-index)

## Why this file exists

Authoring guidance drifts silently. The CLI ships roughly weekly, and a skill
that teaches last quarter's syntax still *looks* correct — it just produces
dated or wrong work. Keeping the verified surface in one versioned file makes
the next refresh a diff instead of a fresh investigation, and gives every
authoring skill one place to cite.

Prefer this file over recollection. Prefer the CLI over this file.

## Re-verification procedure

The CLI ships its own authoritative metadata. Use it rather than searching the web.

**1. Locate the active install.** The path layout is
`~/.copilot/pkg/<platform>/<version>/`:

```bash
copilot --version
ls -1 ~/.copilot/pkg/*/ | sort -V | tail -5
```

Several versions are usually cached side by side. Only the one matching
`copilot --version` is authoritative.

**2. Diff the changelog since this baseline.** `changelog.json` ships inside the
package, is keyed by version (newest first), and holds typed
`added` / `fixed` / `improved` entries:

```bash
export PKG="$HOME/.copilot/pkg/$(uname -s | tr 'A-Z' 'a-z')-arm64/$(copilot --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
node -e '
const cl = require(process.env.PKG + "/changelog.json");
const versions = Object.keys(cl).filter(v => v !== "$schema" && v !== "unpublished" && !v.includes("-"));
const since = "1.0.75";                       // this baseline
const re = /skill|agent|hook|plugin|marketplace|extension|canvas|frontmatter|subagent|instruction/i;
for (const v of versions) {
  if (v === since) break;                     // newest-first; stop at the baseline
  const items = (cl[v] || []).filter(e => re.test(e.description || ""));
  if (!items.length) continue;
  console.log("\n## " + v);
  for (const e of items) console.log(" - [" + e.type + "] " + e.description);
}'
```

**3. Confirm typed shapes.** `sdk/index.d.ts` carries documented TypeScript
interfaces — `Skill`, `SkillBase`, `SkillSource`, `SkillDiscoveryScope`,
`CustomAgentsUpdatedAgent`. This is the most reliable source for field names,
optionality, and defaults:

```bash
grep -n "interface SkillBase" -A 25 "$PKG/sdk/index.d.ts"
grep -n "declare type SkillSource" "$PKG/sdk/index.d.ts"
```

**4. Confirm the command surface.** `--help` is generated from the live command
tree, so it never drifts:

```bash
copilot --help
copilot skill --help && copilot plugin --help && copilot plugins --help
copilot help config      # settings keys
copilot help permissions # tool/URL/path permission patterns
copilot help environment # COPILOT_* variables
```

**5. Cross-check anything user-visible against docs.github.com** before writing it
into a skill. The CLI bundle is authoritative for behavior; the docs are
authoritative for supported, portable syntax.

> **Do not scrape the minified bundle for schema constants.** As of 1.0.75 the
> skill name/description limits live in `prebuilds/<platform>/runtime.node` and
> their messages are assembled from fragments, so the literal strings older
> tooling matched on no longer exist. See `scripts/validate.mjs --check-cli-schema`.

## Skill frontmatter

Confirmed from `sdk/index.d.ts` (`SkillBase`) and GitHub docs. These are real
Copilot CLI fields — not Claude Code-only extensions.

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | — | **Required.** Lowercase, hyphens for spaces; normally matches the directory name. |
| `description` | string | — | **Required.** What it does and when to use it. Max 1024 chars. |
| `allowed-tools` | space-separated string | — | Tools auto-approved while the skill is active. Not a YAML array. |
| `user-invocable` | boolean | `true` | `false` hides it from slash-command invocation; model-only. |
| `disable-model-invocation` | boolean | `false` | `true` prevents the model auto-invoking it; the user must call it. Fully honored since 1.0.74. |
| `argument-hint` | string | — | Freeform hint describing expected arguments; shown for slash-command completion. Added 1.0.64. |
| `license` | string | — | License applying to the skill. |

Runtime-derived, not authored: `invocationName` (assigned when two plugins ship
same-named skills), `pluginName`, `pluginVersion`, `isCommand`.

> **`allowed-tools` is a security decision.** GitHub's documentation warns
> explicitly against pre-approving `shell` or `bash`: it removes the confirmation
> step for terminal commands, so an attacker-controlled skill or a prompt
> injection can execute arbitrary commands. Omit them unless you have reviewed
> the skill and every script it references and fully trust the source.

> **Scalar-only in this marketplace.** This repository's generators accept only
> single-line top-level scalar values. YAML block scalars (`|`, `>`), arrays, and
> nested maps break `catalog.mjs` / `plugin-readme.mjs`.

## Skill discovery locations

| Scope | Paths |
|---|---|
| Project | `.github/skills/`, `.claude/skills/`, `.agents/skills/` |
| Personal | `~/.copilot/skills/`, `~/.agents/skills/` |
| Plugin | `skills/` inside an installed, enabled plugin |
| Custom | Any directory registered with `copilot skill add <directory>` |
| Built-in | Ships with the CLI |

`SkillSource` values: `project`, `inherited`, `personal-copilot`,
`personal-agents`, `plugin`, `custom`, `builtin`.

## Skill management commands

Manual folder-copying still works, but it is no longer the documented path.

**Terminal:**

```bash
copilot skill add <FILE | URL | DIRECTORY>   # add a skill
copilot skill list [--json]                  # list, with source and enabled state
copilot skill remove <NAME | DIRECTORY>      # remove a skill or custom source

copilot plugins install --skill <FILE | URL | DIRECTORY>
copilot plugins install --skill --scope project <FILE | URL>
copilot plugins enable  <NAME> --skill
copilot plugins disable <NAME> --skill
copilot plugins remove  <NAME> --skill
```

`--scope` accepts `user` (default) or `project`; `project` installs into the
repository's `.github/skills/`, and applies only to file or URL installs.
Installing a **directory** registers it as a custom skill source rather than
copying it; installing a **file or URL** copies the content.

**Interactive:** `/skills` (alias `/skill`) with `list`, `info`, `add`,
`remove`, and `reload`. `/skills reload` picks up a skill added mid-session
without restarting the CLI. `/skills info` reports which plugin a skill came
from — plugin skills must be managed through their plugin.

**Discovery:** `gh skill` in the GitHub CLI searches, installs, updates, and
publishes agent skills. <https://awesome-copilot.github.com/skills/> is the
public directory. GitHub code search still works for finding skills in the wild
(`path:SKILL.md`, `path:.github/skills`, `topic:copilot-skills`).

## Skill retrieval and invocation behavior

- **Embeddings-based retrieval.** `dynamicRetrieval` (persisted setting) and
  `--dynamic-retrieval skills=<on|off>` control whether skills are retrieved via
  embeddings rather than name/description matching alone (1.0.66). Descriptions
  still carry routing, so keep writing them for trigger accuracy — but semantic
  proximity of the body matters when it is enabled.
- **Same-name coexistence.** Skills with the same `name` from different plugins
  can coexist (1.0.66); the runtime disambiguates via `invocationName`. A
  marketplace may still choose to enforce unique names for human clarity — that
  is a governance decision, not a CLI constraint.
- **Resolution order across locations.** When one name exists in several
  locations the winner is `project` > `plugin-dir` > personal (`~/.copilot`,
  `~/.agents`) > `custom` (1.0.55, which moved `--plugin-dir` above personal).
  This is distinct from same-name coexistence above: coexistence applies across
  *plugins*, precedence applies across *location tiers*.
- **Frontmatter is stripped.** Skill content injected into the model excludes the
  YAML frontmatter (1.0.48), so do not rely on the model reading frontmatter.
- **Multiple skills per message.** Slash commands can appear mid-input, and
  several skills can be invoked in one message (1.0.44).
- **Draft skills.** The CLI can propose draft skills when it detects a repeated
  workflow; review them with `/chronicle skills review` and accept, reject, or
  defer each (1.0.66, 1.0.70).

## Agent frontmatter

Documented fields (GitHub docs, "Custom agents configuration"):

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | filename | Display name. |
| `description` | string | — | **Required.** |
| `tools` | string[] \| string | all (`["*"]`) | Array or comma-separated string. |
| `model` | string | inherits | Model used when this agent executes. |
| `target` | string | both | `vscode` or `github-copilot`. |
| `disable-model-invocation` | boolean | `false` | Replaces the retired `infer: false`; wins if both are set. |
| `user-invocable` | boolean | `true` | `false` = programmatic invocation only. |
| `mcp-servers` | object | — | Not used by VS Code/IDE agents. |
| `metadata` | object | — | `name`/`value` string pair. Not used by VS Code/IDE agents. |
| `infer` | boolean | — | **Retired.** Use the two fields above. |

CLI-only additions confirmed from the changelog:

| Field / behavior | Version | Notes |
|---|---|---|
| `deferred-tool-loading` | 1.0.52 | Opt-in; enables tool-search discovery for agents with large tool lists. Respected even with a `tools: ["*"]` wildcard since 1.0.64. |
| `skills` | 1.0.22 | String **array** of skill names whose content is eagerly loaded into the agent's context at startup. A bare string is rejected (`skills: Expected array, received string`) and the agent fails to load entirely. Unknown skill names are silently ignored. |
| Reasoning effort in the agent definition | 1.0.66 | Per-agent effort without going through `/subagents`. Frontmatter key `reasoning-effort`. |

The authoritative agent frontmatter key set, extracted from the schema in
`prebuilds/<platform>/runtime.node`: `infer`, `disable-model-invocation`,
`user-invocable`, `reasoning-effort`, `skills`, `deferred-tool-loading` — alongside
the documented `name`, `description`, `tools`, `model`, `target`, `mcp-servers`,
and `metadata`.

> **`skills` is eager, and that is the whole trade-off.** It spends context on
> every run of the agent whether the skill is needed or not, whereas normal
> description-based retrieval spends nothing until the skill is actually chosen.
> Reserve it for a procedure the agent needs on essentially every invocation.
> Note that it pulls against `deferred-tool-loading`, which exists to *save*
> startup context.

`argument-hint` and `handoffs` are **VS Code-only** on agents — GitHub.com and the
CLI ignore them. Note the asymmetry: `argument-hint` *is* supported on skills.
Unrecognized `tools` entries are silently ignored, which is what makes
product-specific tool names safe to list in a portable agent.

Body limit: 30,000 characters.

## Subagent settings

| Setting | Notes |
|---|---|
| `subagents.maxDepth` | Default lowered **6 to 4** in 1.0.71 to curb runaway recursive delegation. Usage-based billing users may raise it up to 128. |
| `subagents.agents.<name>` | Per-subagent `model`, `effortLevel`, and `contextTier`. Each accepts `"inherit"`. Configure via `/subagents` (alias `/agents`). |
| `builtInAgents.rubberDuck` | Enable/disable the rubber duck agent (1.0.56). |
| `builtInAgents.rubberDuckAutoInvoke` | Automatic invocation; disabled by default (1.0.60). |

Built-in agents can be excluded from selection and restricted for tasks and
subagents (1.0.66, 1.0.71). Custom agents keep their tool filters in nested
subagents (1.0.68) and inherit parent tool restrictions (1.0.67).

**Plan mode** hard-blocks built-in tool calls that would modify the workspace
(1.0.71). Built-in mutators — including opening a pull request — are blocked;
MCP and external tools are still allowed. Since 1.0.74 the block is scoped:
planning artifacts written inside the session folder are permitted, while clear
file mutations outside it stay blocked. `/model plan` (or `/model --plan`) picks
a plan-mode-only model, `off` clears it (1.0.74).

## Hook semantics that changed

Corrections to older guidance. See `hooks-crafting` for the full system.

| Behavior | Version | Detail |
|---|---|---|
| `agentStop` runaway cap | 1.0.72 | An `agentStop` hook that always blocks no longer loops forever. The CLI ends the turn after 8 consecutive blocks and warns. The payload carries `stop_hook_active` so a hook can detect a forced continuation and self-limit. |
| `preToolUse` exit code 2 | 1.0.70 | Now **denies** the tool call. Previously only `permissionRequest` treated exit 2 as deny. |
| `preToolUse` errors | 1.0.57 | A hook error now denies the tool call instead of silently allowing it. |
| Hook timeouts | 1.0.67 | Tool calls continue when a hook times out. |
| `userPromptSubmitted` can answer directly | 1.0.44 | The hook can handle a request and return a response without a model call. |
| `userPromptSubmitted` `additionalContext` | 1.0.65 | Included in the model-facing prompt. |
| `postToolUse` `additionalContext` | 1.0.51 | Can be injected into **successful** tool results. |
| `postToolUse` matchers | 1.0.63 | Matchers such as `Edit\|Write` are honored rather than silently dropped. |
| Hook progress streaming | 1.0.55 | Command hooks can emit `{"type":"progress","message":"…","temporary":true}` lines before their decision. |
| Session directory | 1.0.72 | Lifecycle and subagent hook commands run in the current session directory after `/cd`. |
| Malformed entries | 1.0.71 | One malformed hook entry no longer discards the valid hooks in the same file. |
| Claude-format hooks | 1.0.62, 1.0.66 | PascalCase `PreToolUse` / `permissionRequest` fire for matchers like `Bash`, `Read`, `*`, and payloads carry Claude tool names. Nested Claude-style hook groups are handled in inline settings. |

**Fail-open is no longer a blanket rule.** Most command-hook failures still let
the run continue, but `preToolUse` failures and exit-code-2 exits now deny. State
the behavior per event rather than generalizing.

### Canonical event enum (15)

Extracted verbatim from the contiguous event-name cluster in
`prebuilds/<platform>/runtime.node` at 1.0.75 — this is the authoritative list:

```text
sessionStart  sessionEnd  userPromptSubmitted  userPromptTransformed
preToolUse    preMcpToolCall  postToolUse  postToolUseFailure
errorOccurred agentStop   subagentStart  subagentStop
preCompact    permissionRequest  notification
```

`userPromptTransformed` (fires after prompt transformation; can replace it via
`modifiedTransformedPrompt`) and `preMcpToolCall` (MCP-specific pre-call gate)
are frequently missed by older docs and validators.

**Claude/VS Code aliases are not mechanical re-casing.** `userPromptSubmitted` →
`UserPromptSubmit` and `agentStop` → `Stop`. `UserPromptSubmitted`, `AgentStop`,
and `UserPromptTransformed` are **not** recognised — a hook using them silently
never fires. `userPromptTransformed` and `preMcpToolCall` have no alias.

## Plugin and marketplace commands

`copilot plugin` and `copilot plugins` **overlap but are not identical** (verified
against `--help` and by probing at 1.0.75). Shared: `install`, `list`,
`marketplace`, `update`. Singular-only: `uninstall`. Plural-only: `enable`,
`disable`, `remove|rm`, and the cross-kind `--plugin`/`--mcp`/`--skill` flags.
`copilot plugin enable foo` fails with `error: too many arguments for 'plugin'`.

```bash
copilot plugin install <SPEC>          # plugin@marketplace | OWNER/REPO[:PATH] | git-url | ./path
copilot plugin uninstall <NAME>        # singular only
copilot plugin list
copilot plugin update <NAME> [--all]
copilot plugins enable  <NAME>         # plural only
copilot plugins disable <NAME>         # plural only
copilot plugins remove  <NAME>         # plural only (alias: rm)

copilot plugin marketplace add    <SOURCE>        # owner/repo | owner/repo#ref | URL | local path
copilot plugin marketplace list   [--json]
copilot plugin marketplace browse <NAME> [--json]
copilot plugin marketplace update [NAME]          # omit NAME for all; there is NO `refresh` alias
copilot plugin marketplace remove <NAME> [--force]

copilot plugins install --skill <FILE|URL|DIR> [--scope user|project]
copilot plugins enable|disable|remove <NAME> --plugin|--mcp|--skill
copilot plugins list [--json]
```

Notes:

- `--plugin` is the default kind for `enable` / `disable` / `remove`.
- `marketplace remove` is refused while plugins from it are installed; `--force`
  uninstalls them too.
- A marketplace's registration key is its own `name` from `marketplace.json` —
  there is no custom local alias.
- MCP servers install from a policy-configured registry, not
  `copilot plugins install`. Use the `/plugins` dashboard (Online mode) or `/mcp`.
- `--config-dir` is **deprecated**; use `COPILOT_HOME`.
- Built-in default marketplaces (`copilot-plugins`, `awesome-copilot`) cannot be
  removed.
- `COPILOT_PLUGIN_DIR_ONLY` disables automatic plugin discovery, giving a
  deterministic plugin set alongside `--plugin-dir` (1.0.49).

## Plugin manifest surface

Beyond the base schema:

- **`sha` pinning** (1.0.70) — pin a plugin to an exact commit in its source
  configuration, for reproducible automation.
- **Open Plugin Spec v1** (1.0.74) — set the canonical Agent Plugins v1.0.0
  `$schema` URL in `plugin.json` to opt in, additively. Opted-in plugins and
  marketplaces may use dots in names (e.g. `acme.tools`), the `extensions` field
  changes meaning, and `mcp.json` configuration is supported.
- **LSP servers** — `lsp-config/servers.json` by convention, or the `lspServers`
  field. Entries need one of `command` / `bash` / `powershell` plus a required
  `fileExtensions` map; optional `cwd`, `args`, `env`, `rootUri`,
  `initializationOptions`. `${PLUGIN_ROOT}` expands inside the plugin (1.0.60).
- **Extensions** (1.0.62) — plugins can ship extensions, making them installable
  through a marketplace. Session-scoped extensions and canvases also exist.
- **Canvases** (1.0.71) — extension-driven interactive UI surfaces. Open canvases
  are restored across restarts and reconnects (1.0.64, 1.0.65).
- **Repo settings** — `.github/copilot/settings.json` can auto-install plugins,
  extend `extraKnownMarketplaces`, and (for a trusted repository) pin the model,
  effort level, and context tier, plus extend URL/MCP/skill deny lists (1.0.70).

## Headless flags and environment

The subset that matters for unattended `copilot -p` runs. Full list:
`copilot --help`.

| Flag | Use |
|---|---|
| `-p, --prompt <text>` | Non-interactive run, exits on completion. |
| `--allow-all-tools` | Required unattended; otherwise the run blocks. |
| `--allow-all` / `--yolo` | Tools + paths + URLs. |
| `--no-ask-user` | Disable the `ask_user` tool so the agent never waits. |
| `--mode <interactive\|plan\|autopilot>` | Initial agent mode. |
| `--autopilot` / `--plan` | Shorthands for the corresponding mode. |
| `--max-autopilot-continues <n>` | Continuation cap in autopilot (default 5). |
| `--effort, --reasoning-effort <level>` | `none` through `max`. |
| `--context <default\|long_context>` | Context window tier. |
| `--attachment <path>` | Attach an image or native document; non-interactive only. |
| `--max-ai-credits <n>` | Soft credit cap for the session (minimum 30). |
| `--resume[=id]` / `--continue` | Resume by id, prefix, name, or most recent. |
| `--connect[=id]` | Attach directly to a remote session or task. |
| `--session-id <id>` | Set a new session's UUID, or resume one. |
| `--output-format <text\|json>` | `json` emits JSONL, one object per line. |
| `--stream <on\|off>` | Streaming mode. |
| `--available-tools` / `--excluded-tools` | Filter which tools the model can see. |
| `--allow-tool` / `--deny-tool` | Permission patterns; deny always wins. |
| `--secret-env-vars <vars…>` | Strip values from shell/MCP envs and redact from output. |
| `--disable-builtin-mcps` / `--disable-mcp-server <name>` | Trim MCP surface. |
| `--no-auto-update` | Prevent a mid-run CLI upgrade. Auto-disabled in CI. |
| `--share[=path]` / `--share-gist` | Persist a transcript after completion. |
| `--no-remote` / `--no-remote-export` | Keep the session off GitHub web and mobile. |

| Variable | Purpose |
|---|---|
| `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` | Auth, in that precedence order; beats stored login. |
| `COPILOT_ALLOW_ALL` | Equivalent to `--allow-all-tools`. |
| `COPILOT_HOME` | Config/state/credentials dir. Replaces the deprecated `--config-dir`. |
| `COPILOT_MODEL` | Default model; `--model` wins. |
| `COPILOT_AUTO_UPDATE` | `false` disables auto-update. |
| `COPILOT_TASK_WAIT_TIMEOUT_SECONDS` | Bounds the wait when a background shell or agent outlives a `-p` turn. Predates 1.0.71 for plain `-p`; 1.0.71 extended `--autopilot` to honor it too. |
| `COPILOT_PLUGIN_DIR_ONLY` | Disable automatic plugin discovery (1.0.49). |
| `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` | Extra custom-instruction directories. |
| `GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS` | `true` is required for project extensions and extension-management tools to load in `-p` mode (1.0.41). User extensions load by default. |
| `COPILOT_GH_HOST` / `GH_HOST` | GitHub Enterprise host. |
| `COPILOT_CACHE_HOME` | Overrides the CLI cache root (downloaded packages, marketplace cache). |
| `COPILOT_HOOK_ALLOW_LOCALHOST` | `1` permits `http://localhost` HTTP hooks. Sibling: `COPILOT_HOOK_ALLOW_HTTP_AUTH_HOOKS=1`. |
| `COPILOT_OFFLINE`, `COPILOT_PROVIDER_*` | Bring-your-own-model / offline provider. |
| `COPILOT_OTEL_*` | OpenTelemetry monitoring. |

### OS sandbox

Copilot CLI can run shell work inside an OS-level sandbox, and it can be **on by
default** (1.0.74 added a first-run opt-in splash). Its policy governs filesystem
reads/writes, network egress, and locally-spawned MCP servers, which show as
`connected (sandboxed)` in `/mcp list` (1.0.70).

- `--sandbox` / `--no-sandbox` set it **for one run only** without changing the
  saved setting (1.0.70). Both are hidden from `--help` — their absence there is
  not evidence they don't exist. If the host doesn't support the sandbox the flags
  are ignored with a warning (1.0.71).
- `/sandbox` toggles it in-session; toggling restarts only *local* MCP servers and
  leaves remote ones connected (1.0.72).
- macOS keychain access inside the sandbox defaults **off** (1.0.72); git/`gh`
  authentication inside the sandbox is opt-in (1.0.72).

For unattended runs, pin the flag explicitly. A job that inherits a changed saved
setting can start failing on file reads, shell commands, or network access with no
other change.

## Version index

Quick lookup for "when did this land", newest first.

| Version | Change |
|---|---|
| 1.0.74 | Open Plugin Spec v1 manifests + `mcp.json`; skill `disable-model-invocation` fully honored |
| 1.0.72 | `plugins` kind flags + `install --skill`; `agentStop` `stop_hook_active` + 8-block cap; hooks respect `/cd` |
| 1.0.71 | Canvases; `plugins marketplace` subcommands; `subagents.maxDepth` 6 to 4; plan mode blocks mutating tools |
| 1.0.70 | Plugin `sha` pinning; trusted-repo settings pinning; `preToolUse` exit 2 denies; draft skills |
| 1.0.69 | `/plugins` dashboard; `/mcp list` |
| 1.0.66 | Same-name plugin skills coexist; `dynamicRetrieval`; per-agent reasoning effort; `/chronicle skills review` |
| 1.0.65 | `copilot skill` subcommand and `/skill` alias; `userPromptSubmitted` `additionalContext` |
| 1.0.64 | Skill `argument-hint`; plugin MCP discovery; `deferTools` respected |
| 1.0.63 | `postToolUse` matchers honored |
| 1.0.62 | Plugins can ship extensions; session-scoped extensions and canvases |
| 1.0.60 | LSP `bash`/`powershell`/`cwd` and `PLUGIN_ROOT` |
| 1.0.57 | `preToolUse` hook errors deny |
| 1.0.55 | Hook progress streaming |
| 1.0.52 | Agent `deferred-tool-loading` |
| 1.0.51 | `postToolUse` `additionalContext` on success |
| 1.0.49 | `plugin update --all`; `COPILOT_PLUGIN_DIR_ONLY` |
| 1.0.48 | Skill frontmatter stripped from injected content |
| 1.0.44 | `userPromptSubmitted` can answer without a model call |
| 1.0.22 | Agent `skills` frontmatter field (eager skill loading) |

## References

- [GitHub Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- [Adding agent skills for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)
- [Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
- [Comparing GitHub Copilot CLI customization features](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features)
