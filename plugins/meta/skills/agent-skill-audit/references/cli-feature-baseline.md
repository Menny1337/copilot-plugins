<!-- validate:allow-user-paths -->

# Copilot CLI feature baseline

Verified facts about the GitHub Copilot CLI, and the procedure for re-verifying
them. Shared by `skill-crafting`, `agent-crafting`, `hooks-crafting`,
`plugin-crafting`, and `scheduled-headless-copilot`.

**Baseline version: Copilot CLI 1.0.83-5. Coverage: full for the authoring
surfaces below.** The live executable, its matching checksummed release package,
bundled changelog and SDK declarations, live help, and public documentation were
checked. Re-run [the verification procedure](#re-verification-procedure) before
relying on this file against a newer CLI.

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
- [Consuming surfaces](#consuming-surfaces)
- [Version index](#version-index)

## Why this file exists

Authoring guidance drifts silently. The CLI ships roughly weekly, and a skill
that teaches last quarter's syntax still *looks* correct — it just produces
dated or wrong work. Keeping the verified surface in one versioned file makes
the next refresh a diff instead of a fresh investigation, and gives every
authoring skill one place to cite.

Prefer this file over recollection. Prefer the CLI over this file.

## Re-verification procedure

The CLI ships its own authoritative metadata. Use it before secondary commentary.

**1. Locate the active install.** Do not assume the first executable on `PATH`
owns the running package: editor integrations may install a shim that delegates
to Homebrew, npm, or another CLI:

```bash
copilot --version
type -a copilot
```

Follow any shim to the delegated executable and inspect that installation's
package tree. If the active installation exposes no package tree, download the
matching archive from the official `github/copilot-cli` release and verify it
against `SHA256SUMS.txt` before reading its metadata. Do not infer the active
package from cache directory names: those caches can include unrelated Agency
versions as well as inactive Copilot CLI packages.

**2. Diff the changelog since this baseline.** `changelog.json` ships inside the
package, is keyed by version (newest first), and holds typed
`added` / `fixed` / `improved` entries:

```bash
# Set this to the matching package located or extracted in step 1, not an assumed cache.
export PKG="<resolved-package-directory>"
node -e '
const cl = require(process.env.PKG + "/changelog.json");
const versions = Object.keys(cl).filter(v => v !== "$schema" && v !== "unpublished");
const since = "1.0.83-5";                     // this baseline
const re = /skill|agent|hook|plugin|marketplace|extension|canvas|frontmatter|subagent|instruction|sandbox|headless|network|flag/i;
if (!versions.includes(since)) {
  throw new Error("Baseline " + since + " is absent from " + process.env.PKG + "/changelog.json");
}
for (const v of versions) {
  if (v === since) break;                     // newest-first; stop at the baseline
  if (!Array.isArray(cl[v])) continue;
  const items = cl[v].filter(e => re.test(e.description || ""));
  if (!items.length) continue;
  console.log("\n## " + v);
  for (const e of items) console.log(" - [" + e.type + "] " + e.description);
}'
```

**3. Confirm typed shapes.** At 1.0.83-5, `copilot-sdk/types.d.ts` carries the
public `CustomAgentConfig`, hook/session settings, and related SDK types;
`copilot-sdk/generated/session-events.d.ts` exposes resolved skill and custom
agent metadata. Skill frontmatter is not exported as a complete public SDK
authoring interface, so confirm that surface against GitHub Docs, the Agent
Skills specification, and the live CLI:

```bash
grep -n "interface CustomAgentConfig" -A 60 "$PKG/copilot-sdk/types.d.ts"
grep -n "skillDirectories" "$PKG/copilot-sdk/types.d.ts"
grep -n "interface SkillsLoadedSkill" -A 40 \
  "$PKG/copilot-sdk/generated/session-events.d.ts"
```

**4. Confirm the command surface.** `--help` is generated from the live command
tree, so it never drifts:

```bash
copilot --help
copilot skill --help && copilot plugin --help && copilot plugins --help
copilot skill add --help
copilot plugin marketplace --help
copilot help commands
copilot help config      # settings keys
copilot help permissions # tool/URL/path permission patterns
copilot help environment # COPILOT_* variables
copilot help sandbox     # host prerequisites, enforcement, and policy settings
```

**5. Cross-check anything user-visible against docs.github.com** before writing it
into a skill. The CLI bundle is authoritative for behavior; the docs are
authoritative for supported, portable syntax. Record disagreements rather than
silently choosing whichever source matches the old baseline.

> **Known documentation lag at 1.0.83-5.** Public custom-agent docs still show
> `model` as a single string and omit `model-policy`; public plugin docs still
> describe `copilot plugin` / `copilot plugins` as interchangeable and advertise
> a `marketplace refresh` alias. The 1.0.83-5 release notes and live command tree
> disagree. The version-specific sections below state the verified live behavior.

> **Do not scrape the minified bundle for schema constants.** As of 1.0.75 the
> skill name/description limits live in `prebuilds/<platform>/runtime.node` and
> their messages are assembled from fragments, so the literal strings older
> tooling matched on no longer exist. See `scripts/validate.mjs --check-cli-schema`.

## Skill frontmatter

The portable fields come from the Agent Skills specification and GitHub's skill
documentation. Copilot-specific invocation fields are confirmed by bundled
runtime metadata and changelog entries.

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | — | **Required.** Portable specification: 1–64 lowercase alphanumeric characters or hyphens; no leading, trailing, or consecutive hyphen; must match the directory name. This marketplace uses ASCII kebab-case. |
| `description` | string | — | **Required.** 1–1024 chars; what it does and when to use it. |
| `license` | string | — | License name or reference to a bundled license file. |
| `compatibility` | string | — | Optional environment requirements; 1–500 chars when present. |
| `metadata` | map | — | Optional string-to-string metadata map. |
| `allowed-tools` | space-separated string | — | Experimental portable field for tools auto-approved while the skill is active. |
| `user-invocable` | boolean | `true` | `false` hides it from slash-command invocation; model-only. |
| `disable-model-invocation` | boolean | `false` | `true` prevents the model auto-invoking it; the user must call it. Fully honored since 1.0.74. |
| `argument-hint` | string | — | Freeform hint describing expected arguments; shown for slash-command completion. Added 1.0.64. |

Runtime-derived, not authored: `invocationName` (assigned when two plugins ship
same-named skills), `pluginName`, `pluginVersion`, `isCommand`.

> **Portable authoring target, not a universal CLI rejection rule.** Author new
> interoperable skills to the lowercase/hyphenated 1–64-character rule above and
> match the directory name. The repository's probe-backed contract recorded on
> July 25, 2026 for CLI 1.0.75 found that the CLI runtime also tolerated uppercase
> letters, underscores, dots, spaces, and a frontmatter/folder mismatch; the
> broader pattern remains in `scripts/validate.mjs:108-124`. That tolerance was
> not re-probed for 1.0.83-5, so audit third-party runtime compatibility separately
> from portable authoring guidance.

> **Portable syntax vs. CLI tolerance.** The open specification and GitHub's
> authored examples define `allowed-tools` as a space-separated scalar. The
> 1.0.83-5 bundle also contains an internal built-in skill using a YAML array,
> proving the CLI parser accepts that shape in at least that path, but it is not
> the portable authoring contract. Use the scalar form.

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
| Added directory | `.github/skills/` below a trusted root passed with `--add-dir` (1.0.81) |
| Built-in | Ships with the CLI |

`--add-dir` is both a path grant and a customization-discovery root: the CLI
also loads `.github/agents/` below it. Do not point it at an untrusted tree.

`SkillSource` values: `project`, `inherited`, `personal-copilot`,
`personal-agents`, `plugin`, `custom`, `builtin`.

## Skill management commands

Manual folder-copying still works, but it is no longer the documented path.

**Terminal:**

```bash
copilot skill add <FILE | URL | DIRECTORY>   # add a skill
copilot skill add --project <FILE | URL>     # copy into .github/skills/
copilot skill list [--json]                  # list, with source and enabled state
copilot skill remove <NAME | DIRECTORY>      # remove a skill or custom source

copilot plugins install --skill <FILE | URL | DIRECTORY>
copilot plugins install --skill --scope project <FILE | URL>
copilot plugins enable  <NAME> --skill
copilot plugins disable <NAME> --skill
copilot plugins remove  <NAME> --skill
```

For the direct `skill add` command, `--project` selects `.github/skills/`. For
the cross-kind `plugins install --skill` command, `--scope` accepts `user`
(default) or `project`. Both project forms apply only to file or URL installs.
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
| `model` | string \| string[] | inherits | Model used when this agent executes. Since 1.0.83, a list is tried in order until an available model is found. |
| `model-policy` | string | — | CLI-only. `required` prevents later model changes from leaving the agent's configured `model` list. |
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
| Ordered model fallback and `model-policy` | 1.0.83 | `model` may be a string array tried in order; `model-policy: required` constrains model changes to that list. |

The authoritative agent frontmatter key set, extracted from the schema in
`prebuilds/<platform>/runtime.node`: `infer`, `disable-model-invocation`,
`user-invocable`, `reasoning-effort`, `skills`, `deferred-tool-loading`,
`model-policy` — alongside
the documented `name`, `description`, `tools`, `model`, `target`, `mcp-servers`,
and `metadata`.

> **SDK limitation.** The bundled 1.0.83-5 `CustomAgentConfig` TypeScript
> interface still exposes `model?: string` and no `modelPolicy`. The ordered
> model list and `model-policy` are verified CLI frontmatter features, not yet a
> matching public programmatic SDK shape.

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
| Trace context | 1.0.81-13 | Hook inputs can carry W3C `traceparent` and optional `tracestate`; command hooks also receive trace context through environment variables. Preserve and forward these only when the downstream system is trusted. |
| Direct executable hooks | current docs | CLI command hooks may use `exec` plus string-array `args` instead of `bash`/`powershell`/`command`. Do not combine the forms; `exec` bypasses shell parsing. **Local limitation:** this marketplace's unchanged `scripts/validate.mjs` requires `bash`, `powershell`, or `command`, so `exec` + `args` alone is valid CLI syntax but does not pass this repository's validator. |
| `sessionEnd` in piped runs | 1.0.78 | A run whose prompt arrives on **stdin** now matches `-p`: `sessionEnd` fires once per completed agent turn with `reason` `complete` (or `error`), instead of once at shutdown with `user_exit`. A piped run that exits before completing a turn fires **no** `sessionEnd` hook. Unattended pipelines that keyed off `user_exit` must be re-checked. |
| `userPromptSubmitted` output hardening | 1.0.76 | A non-string `modifiedPrompt` / `modifiedTransformedPrompt` / `responseContent` is ignored with a type-only warning instead of corrupting the session; an empty-string replacement is rejected rather than blanking model-facing content; `handled` without usable `responseContent` is diagnosed instead of silently falling through; `null` `additionalContext` is treated as absent, not injected as the literal `null`. |
| Hook output size cap | 1.0.76 | Hook output is bounded at **10 MiB per invocation**, so an unbounded command/HTTP response can no longer exhaust memory or leave an oversized session behind. |
| Hook state across sessions | 1.0.78 | Switching sessions no longer restarts MCP servers or rebuilds hook state, so a turn running in another session is not halted with a stale-hook error. |
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
against the 1.0.83-5 live command tree). Shared: `install`, `list`,
`marketplace`, `update`. Singular-only: `uninstall`. Plural-only: `enable`,
`disable`, `remove|rm`, and the cross-kind `--plugin`/`--mcp`/`--skill` flags.
The public plugin reference currently overstates interchangeability; use live
`--help` for executable command spelling.

```bash
copilot plugin install <SPEC>          # plugin@marketplace | OWNER/REPO[:PATH] | git-url | ./path
copilot plugin uninstall <NAME>        # singular only
copilot plugin list
copilot plugin update <NAME> [--all]
copilot plugins enable  <NAME>         # plural only
copilot plugins disable <NAME>         # plural only
copilot plugins remove  <NAME>         # plural only (alias: rm)

copilot plugin marketplace add    <SOURCE>        # owner/repo | owner/repo#ref | URL | local path
copilot plugin marketplace list
copilot plugin marketplace browse <NAME>
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
  `copilot plugins install`. Use the `/mcp` dashboard's Online view.
- `--config-dir` is **deprecated**; use `COPILOT_HOME`.
- Built-in default marketplaces (`copilot-plugins`, `awesome-copilot`) cannot be
  removed.
- `COPILOT_PLUGIN_DIR_ONLY` disables automatic plugin discovery, giving a
  deterministic plugin set alongside `--plugin-dir` (1.0.49).
- The interactive `/plugins` command was removed in 1.0.81-10. Use `/plugin`
  for plugins and marketplaces, `/mcp` for MCP servers, `/skills` for skills,
  `/subagents` for agents, and `/instructions` for instruction files.
- `copilot plugins list` remains a terminal command. It lists plugins, MCP
  servers, skills, instruction sources, and LSP servers; custom agents and
  session-scoped hooks require a live session.
- Hook and LSP enable/disable toggles disappeared with the old `/plugins`
  dashboard and remain unavailable through `copilot plugins enable|disable`.

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
- **Agent Plugins spec layout** (1.0.80) — portable skills remain in `skills/`
  and portable MCP configuration remains in root `mcp.json`. Copilot-specific
  `commands/`, `agents/`, `rules/`, `hooks/hooks.json`, `lsp.json`, and
  `extensions/` live only below `com.github.copilot/`; root copies are no longer
  loaded. This applies only to manifests that opt into the Agent Plugins v1.0.0
  `$schema`, not this marketplace's legacy Copilot plugin manifests.
- **Marketplace `autoUpdate`** (1.0.79) — set `"autoUpdate": true` on an
  `extraKnownMarketplaces` entry in user settings to auto-update that
  marketplace's plugins at session start. This is documented by the bundled
  1.0.79 changelog entry and the settings documentation for
  `extraKnownMarketplaces`; it is not declared by the reviewed
  `copilot-sdk/types.d.ts`. First-party plugins already auto-update at session
  start (1.0.78) without opting in.
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
| `--add-dir <directory>` | Grants file access and discovers `.github/skills/` and `.github/agents/` below that trusted root (1.0.81). |
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
| `--disable-builtin-mcps` / `--disable-mcp-server <name>` / `--enable-mcp-server <name>` | Trim the MCP surface or temporarily re-enable a server disabled in settings. |
| `--add-github-mcp-toolset <name>` / `--add-github-mcp-tool <name>` / `--enable-all-github-mcp-tools` | Override the default GitHub MCP subset for one run. |
| `--enable-memory` | Enable memory in prompt mode, where it is disabled by default. |
| `--bash-env=<on\|off>` / `--no-bash-env` | Control `BASH_ENV` support. These flags persist the preference; default is off. |
| `--no-auto-update` | Prevent a mid-run CLI upgrade. Auto-disabled in CI. |
| `--share[=path]` / `--share-gist` | Persist a transcript after completion. |
| `--remote` / `--remote-export` / `--no-remote` / `--no-remote-export` | Explicitly enable or disable remote control/export. |
| `--usage-output-file <file>` | Write final usage statistics as JSON, including per-agent usage. |

Relative `--add-dir` and `--plugin-dir` values resolve after `-C` and against the
resumed/worktree session directory regardless of option order (fixed in
1.0.83-1).

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
  not evidence they don't exist. If sandboxing is enabled by a flag, saved
  setting, or policy on an unsupported host, sandboxed shell commands and
  sandboxed MCP/LSP servers fail; Copilot prints a startup warning.
- `/sandbox` is an experimental interactive command for inspecting or changing
  sandbox policy; it is registered only when experimental features are enabled
  or managed policy forces sandboxing on. Toggling restarts only *local* MCP
  servers and leaves remote ones connected (1.0.72).
- macOS keychain access inside the sandbox defaults **off** (1.0.72); git/`gh`
  authentication inside the sandbox is opt-in (1.0.72).
- In 1.0.83-5, macOS and Linux sandboxes block services on the host, including
  localhost servers started by the sandboxed command on macOS, unless
  `sandbox.userPolicy.network.allowLocalNetwork` is enabled.
- Sandboxed commands can receive ecosystem-scoped access to developer-tool paths, including
  credential-bearing files such as `.npmrc`; set
  `sandbox.allowDevToolAccess` to `false` when that access is not acceptable.
  Built-in file edits are not OS-sandboxed; they follow the policy on a best-effort basis.
- Linux requires `bwrap` 0.5.0+ on `PATH`. Every Linux sandbox also uses a
  private network namespace and therefore requires `slirp4netns`, util-linux
  2.35+ (`unshare` with `--map-current-user` and `--keep-caps`, plus `nsenter`),
  `iptables`, `ip6tables`, both restore binaries, and read/write access to
  `/dev/net/tun`. Unprivileged hosts normally need the `nf_tables` iptables
  backend.
- The host-support probe checks only `bwrap` on Linux and `sandbox-exec` on
  macOS. It does not verify the additional Linux namespace prerequisites, so a
  host can pass the probe and then fail while starting every sandboxed command.
- A managed policy that enforces sandboxing overrides local disable attempts.
  If prerequisites are missing, provision the host or contact the administrator;
  do not present blanket sandbox disablement as the recovery path. A
  per-command bypass is available only when policy leaves `allowBypass` enabled.
- Sandboxed `gh` commands now authenticate as the account configured for the
  repository rather than blindly using the Copilot CLI login.

For unattended runs, pin the flag explicitly. A job that inherits a changed saved
setting can start failing on file reads, shell commands, or network access with no
other change.

## Consuming surfaces

Authoring guidance is often written as if the CLI were the only consumer. It is
not. Four surfaces read overlapping subsets of the same artifacts, so a skill
that says "Copilot" without naming a surface is ambiguous.

| Surface | What it is | Reads plugins? | Reads hooks? |
|---|---|---|---|
| **Copilot CLI** | The terminal agent this file documents | Yes — full `copilot plugin` machinery | Yes — policy, user, repo, plugin, and `settings.json` |
| **GitHub Copilot app** | Desktop app (macOS/Windows/Linux), **built on Copilot CLI** | Yes — CLI-installed plugins, skills, and MCP servers are automatically available | Yes, via the CLI engine |
| **Copilot cloud agent** | GitHub.com bot that turns issues into PRs | Declaratively only — `enabledPlugins` in `.github/copilot/settings.json`; no `copilot plugin install` | Only `.github/hooks/*.json`, `bash`-only, in a Linux sandbox |
| **IDE agent mode** | VS Code, Visual Studio, JetBrains, etc. | No | VS Code only, in preview |

**Practical consequence for this marketplace:** the desktop app is a first-class
consumer of everything published here. Plugins need no app-specific packaging,
but any guidance that assumes a terminal-only UI, an interactive TTY, or a
`~/.copilot`-only install path should say so explicitly.

### `.github/github-app.yml`

The desktop app reads a repository-level config that the CLI ignores entirely.
The legacy filename `.github/copilot-desktop.yml` is still accepted.

```yaml
instructions: |
  Repo-specific guidance appended after global app instructions.

scripts:
  - name: Setup
    command: bun install
    triggers: [session.create]      # or session.archive; no triggers = manual
    # legacy aliases workspace.create / workspace.archive still parse

server_ready_pattern: '(?i)Local:\s+(https?://\S+)'   # Rust regex crate syntax
auto_open_in_browser: true          # default true

automation:
  auto_issue_session: true          # default true — auto-start a session from an issue
  remote_control: false             # default false — expose the session to github.com / Mobile
```

Notes that matter when reviewing one:

- **Trust gate.** The app does not apply a repo config until the user reviews and
  accepts it — including after any whitespace or comment change. Configs written
  through the app UI are trusted automatically.
- **Scripts receive GitHub credentials** (`GH_TOKEN`, `GH_HOST`, and
  `COPILOT_GH_ACCOUNT_<HOST>_<LOGIN>`) plus `COPILOT_WORKSPACE_NAME`,
  `COPILOT_WORKSPACE_PATH`, `COPILOT_ROOT_PATH`, `COPILOT_DEFAULT_BRANCH`,
  `COPILOT_PORT`, and `COPILOT_SCRIPT_TRIGGER`. Never log or persist them.
- **`remote_control: true` is not sufficient on its own.** An org-issued seat also
  needs the "Store local sessions in the Cloud" policy set to "View and control",
  and enterprise-managed `remoteControl` settings can still override it.

### Remote control

Remote control exports a local CLI session so it can be monitored — and
optionally steered — from GitHub.com or GitHub Mobile. In the SDK this is the
Mission Control ("MC") path: `RemoteControlConfig` carries `remote`, `steerable`,
`explicit`, and `silent`, and status moves through `off` → `connecting` →
`active` (with `frontendUrl` and `isSteerable`) or `error`. Managed policy is
`remoteControl.mode`, one of `enabled` / `disabled` / `requireSSO`.

This matters for hook and skill authoring: a session may have a second,
non-terminal human driving it, so never assume prompts originate from the local
TTY.

## Version index

Quick lookup for "when did this land", newest first.

| Version | Change |
|---|---|
| 1.0.83 | Ordered model fallback and `model-policy: required` for custom agents; relative `--add-dir`/`--plugin-dir` resolution follows `-C` and resumed/worktree cwd; stricter sandbox network behavior and repository-aware sandboxed `gh` auth |
| 1.0.81-13 | Hook trace context (`traceparent` / `tracestate`) and corrected subagent hook telemetry |
| 1.0.81-10 | `/plugins` interactive command removed; resources split across `/plugin`, `/mcp`, `/skills`, `/subagents`, and `/instructions`; hook/LSP toggles removed |
| 1.0.81 | `--add-dir` discovers skills and custom agents; installed-plugin agents, skills, and MCP servers load in `-p`; local directory-source marketplace plugins load live on restart/new session |
| 1.0.80 | Agent Plugins spec moves Copilot-specific commands, agents, rules, hooks, LSP, and extensions under `com.github.copilot/`; marketplace `update`/`refresh` command |
| 1.0.79 | Agent Plugins spec introduced `com.github.copilot/extensions/`; `autoUpdate` on `extraKnownMarketplaces`; plugin custom agents honor `deferred-tool-loading` |
| 1.0.78 | Piped-stdin runs fire `sessionEnd` per turn like `-p`; first-party plugins auto-update at session start; session switching no longer rebuilds hook state |
| 1.0.76 | `/plugins` enable/disable for plugins, instructions, agents, LSP servers, hooks; `userPromptSubmitted` output hardening + 10 MiB hook-output cap |
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
- [Agent Skills specification](https://agentskills.io/specification)
- [Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
- [Comparing GitHub Copilot CLI customization features](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features)
- [About the GitHub Copilot app](https://docs.github.com/en/copilot/concepts/agents/github-copilot-app)
- [Repository configuration for the GitHub Copilot app](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/repository-configuration)
- [About remote control of Copilot CLI sessions](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-remote-control)
- [Copilot customization cheat sheet](https://docs.github.com/en/copilot/reference/customization-cheat-sheet)
