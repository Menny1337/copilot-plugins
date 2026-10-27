# GitHub task configuration and authentication

Read for the selected GitHub backend. Apply the write prerequisites below before
[GitHub capture](github-tasks.md) or pending inbox reconciliation.

### 3.6.0 Read the config

Resolve and validate the [selected assistant config](configuration.md) before
any personal task operation. Propagate its absolute path through
`COPILOT_PLUGIN_ASSISTANT_CONFIG` to query commands and subprocesses.

If `backend == "ado"`, follow [ADO configuration (§3.5.0)](ado-configuration.md).
If `backend == "markdown"` or the config file/selector is absent, follow
[markdown tasks (§3)](markdown-tasks.md). An explicit unrecognized selector is a
configuration error: report it and stop the task operation, without substituting
markdown. For `backend == "github"`, validate the required settings below before
any task operation, then extract the `github` block:

```json
{
  "taskBackend": "github",
  "github": {
    "owner": "your-managed-account",
    "ownerType": "user",
    "repo": "personal-work",
    "projectNumber": 1,
    "projectId": "PVT_kwxxxxxxxxxxxxxxxxx",
    "fields": {
      "lane": "Lane",
      "priority": "Priority",
      "kind": "Kind",
      "dueDate": "Due date",
      "adoId": "ADO ID",
      "workstream": "Workstream",
      "mode": "Mode"
    },
    "boardUrl": "https://github.com/users/your-managed-account/projects/1"
  },
  "teamBoard": {
    "org": "https://dev.azure.com/your-team-org",
    "project": "TeamProject",
    "team": "Your Team",
    "areaPath": "Area\\Subtree\\Your Team"
  },
  "fallbackInbox": "~/.copilot/assistant/inbox.md"
}
```

- `owner`, `repo` and `projectNumber` are required; `ownerType` defaults to `user` and also accepts `org`; `projectId` (the GraphQL node id, `PVT_...`) is optional but recommended — resolve it once with `gh project view <projectNumber> --owner <owner> --format json --jq .id` and cache it in config so writes never have to re-look it up.
- `fields` maps the shared lane-catalog concepts to this project's actual Projects v2 field names; every key has the default shown above — only override a renamed field.
- `teamBoard` is unchanged from [ADO configuration (§3.5.0)](ado-configuration.md): a separate, read-only board that [team queries (§8)](../../assistant-query/references/ado-queries.md) / [team layout (§4b)](../../assistant-query/references/team-board-layout.md) reads via `ado-query` regardless of which personal backend (`ado` or `github`) is active. Read the ADO configuration's team/area-path distinction only when querying that board.
- `fallbackInbox` is unchanged from [ADO configuration (§3.5.0)](ado-configuration.md).

**Prerequisite:** `gh` must be installed and authenticated as an identity permitted to write to `github.owner`/`github.repo`/the Project — the exact check depends on `ownerType`:

- **`ownerType: "user"` (the common case — a personal managed account):** the
  authenticated identity must be **exactly** `github.owner`
  (`gh api user --jq .login`) — never proceed as a different user, even one
  with access, so a personal board never gets written by the wrong account.
- **`ownerType: "org"`:** `github.owner` is an organization name, not a user —
  no identity ever "is" the org, so an exact-login check would reject
  **every** legitimately authorized user. Instead confirm the authenticated
  identity has write access to `github.repo` and to the Project itself:
  `gh api repos/<owner>/<repo> --jq .permissions.push` must be `true`, and a
  Project write probe (e.g. `gh project field-list <projectNumber> --owner
  <owner>` succeeding, or an explicit collaborator/team-write check) must
  succeed. A write-permission failure is reported and stopped exactly like an
  identity mismatch in the user-owned case — never silently retried as a
  different identity.

Either way: confirm required scopes with `gh auth status --show-token=false`
(needs at minimum `repo` and `project`); if a write fails with a scope error,
do not attempt to silently re-auth — report it and stop ([§3.6.9 fallback](github-tasks.md#369-capture-time-fallback-inboxmd)
still applies).
