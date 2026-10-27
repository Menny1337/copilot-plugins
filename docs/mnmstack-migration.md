# Switch to mnmstack

`mnmstack` replaces `core-skills`, `core-agents`, and `meta` with one plugin.
There are no compatibility agents or automatic configuration migrations.

## Change your installation explicitly

1. Review `copilot plugin list` and your profiles, aliases, repository settings,
   and scheduled command definitions for the three old plugin names.
2. Use `copilot plugin uninstall <installed-name>` with the names reported by
   your CLI to remove the old plugins. A marketplace update may retain old
   installations; it is not an uninstall or a migration.
3. Add the marketplace if needed, or update its registration, then install:

   ```bash
   copilot plugin marketplace update menny1337-plugins
   copilot plugin install mnmstack@menny1337-plugins
   ```

   For a new registration, first run
   `copilot plugin marketplace add Menny1337/copilot-plugins`.
4. Manually replace the old plugin specs in `enabledPlugins` with
   `mnmstack@menny1337-plugins`, and update explicit paths from
   `plugins/core-skills`, `plugins/core-agents`, or `plugins/meta` to
   `plugins/mnmstack`. Installed marketplace paths likewise end in
   `menny1337-plugins/mnmstack/`. Review scheduled commands before their next run;
   this migration does not rewrite, enable, or run them.
5. Replace old explicit `--agent` selections in commands and configurations with
   task requests using the skills below.
6. Before restarting, inspect the known generated command links in
   `~/.local/bin`. The new hook deliberately treats old `core-agents` targets
   as foreign, even when dangling, and will not replace them automatically:

   ```bash
   for name in assistant-store github-state-transition ado-query github-query sync-status sync-ui ado-auth; do
     ls -ld "$HOME/.local/bin/$name"
     if [ -L "$HOME/.local/bin/$name" ]; then
       readlink "$HOME/.local/bin/$name"
     fi
   done
   ```

   Inspect each target individually. Remove only a symlink verified to point
   into the removed `core-agents` installed-plugin or marketplace-cache source,
   with the corresponding script path listed in
   [the command-link hook](../plugins/mnmstack/hooks/link-commands.sh).
   For example, **only if each link was verified**, unlink the selected names:

   ```bash
   unlink "$HOME/.local/bin/ado-query"
   unlink "$HOME/.local/bin/github-query"
   ```

   These are examples, not a bulk cleanup command. Never unlink a regular file,
   an unrelated symlink, or an uncertain target; do not use wildcards or recursive
   deletion. Unlinking a verified generated symlink removes only that link,
   not its target or any assistant data.
7. Restart or open a new session with `mnmstack` loaded. Its command-link hook
   recreates missing command links when their bundled scripts exist and the
   destination is writable; existing foreign files/links remain untouched.
   Check the resulting links and loaded skills. Ensure `~/.local/bin` is on
   `PATH` when using these commands directly.

## Use skills for the task

| Task | Skill |
| --- | --- |
| Capture notes, tasks, reminders, or initialize the assistant workspace | [assistant-capture](../plugins/mnmstack/skills/assistant-capture/SKILL.md) |
| Find saved context, reconcile pending captures, or produce a briefing | [assistant-query](../plugins/mnmstack/skills/assistant-query/SKILL.md) |
| Teams messages, channels, presence, or people lookup | [m365-messaging](../plugins/mnmstack/skills/m365-messaging/SKILL.md) |
| Update GitHub issues or Azure DevOps tickets | [issue-updates](../plugins/mnmstack/skills/issue-updates/SKILL.md) |
| Azure CLI and Azure DevOps operations | [az](../plugins/mnmstack/skills/az/SKILL.md) |
| Externally sourced research and reports | [research-methodology](../plugins/mnmstack/skills/research-methodology/SKILL.md) |
| Cross-component customization design and routing | [agent-system-design](../plugins/mnmstack/skills/agent-system-design/SKILL.md) |

These replace the workflows of the four removed bundled agents (`assistant`,
`azure-ops`, `researcher`, and `agent-architect`), not agents as a platform feature.
User-defined agents elsewhere and other domain plugins' agents remain supported.
Appropriate delegation is still available when authorized. A skill supplies
procedure, not an isolated context, tool allowlist, or extra permissions; retain
any required controls in the invoking host or workflow.

The proposed `assistant-workflows` wrapper is retired before release; it is not
shipped as a compatibility alias. Use capture, query, and messaging skills
directly. Email and calendar requests use the host's available tools rather than
a bundled assistant coordinator. `issue-updates` covers ticket maintenance,
not personal startup routines or general assistant orchestration.

## Keep local configuration and opt-ins

Your assistant state remains at `~/.copilot/assistant/`; do not move or overwrite
notes, memory, tasks, reminders, templates, briefings, or configuration as part of
this switch. Notes, reminders, and local Markdown tasks work without remote setup.
The [configuration contract](../plugins/mnmstack/skills/assistant-capture/references/configuration.md)
retains `~/.copilot/assistant/config.json`, `COPILOT_PLUGIN_ASSISTANT_CONFIG`,
the supported `COPILOT_PLUGIN_ADO_CONFIG` alias, and command-level `--config`.
The personal `taskBackend` still selects Markdown, ADO, or GitHub; the optional
ADO `teamBoard` remains separate and read-only unless a write is requested.

Azure operations require an authenticated Azure CLI; GitHub-backed tasks require
authenticated `gh`. Teams and M365 workflows need their connected MCP servers.
Configure only the features you use, following the owning skill's prerequisites.

Session-start tool detection, query-command linking, and memory/sync advisories
retain their existing conditions. Automatic `agentStop` session sync is not
registered by default. Invoke [ado-session-sync](../plugins/mnmstack/skills/ado-session-sync/SKILL.md)
or [github-session-sync](../plugins/mnmstack/skills/github-session-sync/SKILL.md)
explicitly for the selected backend after its existing opt-in and target checks.
Enable flags do not authorize a sync; disable flags still win. Shared sync logs
remain at `~/.copilot/logs/ado-session-sync/`. Installing `mnmstack` does not enable
auto-sync, an assistant startup routine, or an OS schedule.

Authorized architect artifacts remain at `~/.copilot/agent-architect/`, including
`MEMORY.md`; shared memory remains at `~/.copilot/memory/`. The package rename
does not authorize reading or modifying these locations.

Operational requirements are unchanged: `scheduled-headless-copilot` uses the
host OS scheduler; its optional Copilot Loops app requires macOS 13+, launchd,
Node.js 18+, and Swift 5.9+ to build. `scheduled-skill-review` remains macOS-specific
and uses launchd, Swift/SwiftBar, GitHub CLI, and Agency. Review setup through the
[scheduling](../plugins/mnmstack/skills/scheduled-headless-copilot/SKILL.md) and
[scheduled-review](../plugins/mnmstack/skills/scheduled-skill-review/SKILL.md)
skills when needed; no private state or running schedule is changed by these docs.
