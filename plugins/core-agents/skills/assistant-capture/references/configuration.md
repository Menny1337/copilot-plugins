# Select the assistant configuration

Use one configuration file for personal task routing, query commands, session-sync
hooks, authentication helpers and their subprocesses. Notes and reminders do not
need this file. Local tasks work without setup.

## Path selection

Use this precedence; empty environment variables count as unset:

1. `--config <path>` for `ado-query`, `github-query` and `github-state-transition`, when supplied.
2. `COPILOT_PLUGIN_ASSISTANT_CONFIG`.
3. `COPILOT_PLUGIN_ADO_CONFIG`, the supported legacy alias.
4. `~/.copilot/assistant/config.json`.

The config flag affects that command only. To use the same file in skills and
hooks, set `COPILOT_PLUGIN_ASSISTANT_CONFIG` in the environment that starts the session:

```bash
export COPILOT_PLUGIN_ASSISTANT_CONFIG="$HOME/.config/my-assistant/config.json"
```

```powershell
$env:COPILOT_PLUGIN_ASSISTANT_CONFIG = Join-Path $HOME '.config/my-assistant/config.json'
```

Quote paths with spaces. Helpers expand a leading `~` followed by a separator,
and resolve relative paths against the calling directory. Prefer an absolute
path for sessions that change directories. Hooks export the resolved absolute
path as `COPILOT_PLUGIN_ASSISTANT_CONFIG` before dispatch or launch. Sync children also
receive `COPILOT_PLUGIN_SYNC_CONFIG` and must use that same file, including for auth,
query commands and fallback-inbox reads. An invocation-level query override
must not change the target of a later write.

The bundled helpers live in this plugin's `shared/` directory. Resolve
`<plugin-dir>` from the loaded skill's location, not an authoring checkout or
another plugin. Bash consumers source `shared/assistant-config.sh` and call
`plugins_config_path`, then `plugins_config_backend "$CONFIG"`. PowerShell consumers
dot-source `shared/assistant-config.ps1`, then call `Get-MnmAssistantConfigPath`,
`Read-MnmAssistantConfig` and `Get-MnmAssistantBackend`. Node consumers import
`readAssistantConfig` and `selectedBackend` from `shared/assistant-config.mjs`.
These helpers do not create or modify settings.

## Defaults and errors

An absent default file or absent `taskBackend` selects `markdown`. An explicit
`"markdown"` does the same. An override pointing to a missing file is an error,
not permission to use the default file. Malformed JSON, a non-object document,
an unknown selector or an incomplete selected remote target stops personal
task operations without reading or writing another store.

The shared preflight requires `ado.org` and `ado.project` for ADO. GitHub requires
`github.owner`, `github.repo` and a positive integer `github.projectNumber`.
`github.ownerType` defaults to `user`; its only other supported value is `org`.
Apply the backend reference's additional write prerequisites and identity,
permissions and approval checks before any remote change.

The optional `teamBoard` remains a separate read-only ADO target. Validate it
independently, even when the personal backend is unavailable. Direct query
commands validate their requested board, not an unrelated personal selector.
Notes, reminders and independent briefing sections remain available on errors.

Hooks report invalid configuration on stderr and exit without blocking the
session or starting a sync child. Enable flags override only the opt-in setting,
not the backend or target checks. `COPILOT_PLUGIN_TASK_SESSION_SYNC=0` disables either
backend. Backend-specific disable flags also win over enable flags. A value of
`1` permits sync only for a valid selected remote backend.

## Set up only the features you need

For local tasks, omit the file or use:

```json
{
  "taskBackend": "markdown"
}
```

For remote tasks, use the placeholder examples in
[ADO configuration](ado-configuration.md) or
[GitHub configuration](github-configuration.md). Keep local settings outside
the source checkout and plugin caches. Merge fields into an existing file
without losing unknown keys; review a redacted preview and get approval before
changing the user's settings. Never overwrite a configuration during setup.

Sync is off by default. Configure and confirm the personal board first, then
enable `adoSessionSync.enabled` for ADO or `taskSessionSync.enabled` for GitHub
only with approval. Both use a 10-minute debounce, an unrestricted repository
list when `syncRepos` is absent or empty, and the existing session-state
relocation default. Set `sessionStateDir` to an empty string to disable
relocation. The selected backend's block supplies `logLevel` and `retentionDays`.

Keep credentials in the existing environment or credential store. Config
selection does not change token precedence, log/store locations, tenant-cache
location or PAT-file defaults. Relative `ado.patFile` values still resolve under
`~/.copilot/assistant`, not beside an alternate config. Migration's `--config`
file has its own schema and is not the assistant config.
