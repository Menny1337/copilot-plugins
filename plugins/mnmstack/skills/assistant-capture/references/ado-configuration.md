# ADO task configuration

Read for the selected ADO personal backend or to resolve a separately configured
team board. Personal task writes follow [ADO tasks](ado-tasks.md); queries follow
[ADO task queries](../../assistant-query/references/ado-tasks.md).

### 3.5.0 Read the config

Resolve and validate the [selected assistant config](configuration.md) at the
start of any task operation. Propagate its absolute path through
`COPILOT_PLUGIN_ASSISTANT_CONFIG` to query commands and subprocesses.

If `backend == "github"`, follow [GitHub configuration (§3.6.0)](github-configuration.md) instead.
If `backend == "markdown"` or the config file/selector is absent, follow
[§3 markdown behavior](markdown-tasks.md). An explicit unrecognized selector is a
configuration error: report it and stop the task operation, without substituting
markdown. For `backend == "ado"`, validate the required board settings before any
task operation, then extract:
- From the **default board** (the nested `ado` object): `org`, `project`, `team`, `workItemType`, `subtaskType`, `assignedTo`, `defaultAreaPath`, `defaultIteration`, `boardUrl`, `fieldMap`, plus top-level `fallbackInbox`.
- Optionally, from a separate **`teamBoard`** object (the read-only team/sprint board surfaced by [team queries (§8)](../../assistant-query/references/ado-queries.md) and [team layout (§4b)](../../assistant-query/references/team-board-layout.md)): `teamBoard.org`, `teamBoard.project`, `teamBoard.team`, `teamBoard.areaPath`.

> **Default board vs `teamBoard` (two distinct boards):**
> - The **default board** keys (`org`, `project`, `team`, `assignedTo`, …) drive all [task CRUD (§3.5)](ado-tasks.md) and the personal-board briefing section ([queries (§8a)](../../assistant-query/references/ado-tasks.md) / [layout (§4a)](../../assistant-query/references/personal-board-layout.md)). This is the board you create and manage tasks on.
> - The optional **`teamBoard`** object describes a *separate, read-only* team/sprint board that `assistant-query` surfaces in the daily/weekly briefing ([§8 "Team Sprint"](../../assistant-query/references/ado-queries.md) / [§4b](../../assistant-query/references/team-board-layout.md)). Omit it entirely if you only use one board.
>
> **Inside `teamBoard`, `team` vs `areaPath` are NOT interchangeable:** `teamBoard.team` is the **team name** for iteration context (`@CurrentIteration('[<teamBoard.project>]\<teamBoard.team>')`); `teamBoard.areaPath` is the **area-path subtree under the project**, used to scope `[System.AreaPath] UNDER '<teamBoard.project>\<teamBoard.areaPath>'`. They coincide only when the team's area node sits directly under the project; they differ when it is nested — e.g. team `Platform` but area subtree `Infra\Backend\Platform` (then `team = "Platform"`, `areaPath = "Infra\Backend\Platform"`). If the team uses no area-path scoping, set `areaPath` equal to `team`.

**Sample `~/.copilot/assistant/config.json`** (copy and replace the placeholder values with your own — these specifics live only in your local config, never in the repo). The default-board keys are shown nested under an `ado` object (the supported command schema); the separate `teamBoard` object is optional:

```json
{
  "taskBackend": "ado",
  "ado": {
    "org": "https://dev.azure.com/your-org",
    "project": "YourProject",
    "team": "Your Team Name",
    "workItemType": "User Story",
    "subtaskType": "Task",
    "assignedTo": "you@example.com",
    "defaultAreaPath": "YourProject\\Your Team Name",
    "defaultIteration": "YourProject\\Sprint 1",
    "boardUrl": "https://dev.azure.com/your-org/YourProject/_boards/board/t/Your%20Team%20Name/Stories",
    "fieldMap": {
      "priority": "Microsoft.VSTS.Common.Priority",
      "tags": "System.Tags",
      "dueDate": "Microsoft.VSTS.Scheduling.DueDate",
      "description": "System.Description",
      "assignedTo": "System.AssignedTo"
    }
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

The assistant maps the `<config.org>`, `<config.project>`, `<config.team>`, `<config.assignedTo>`, etc. placeholders used in this skill and `assistant-query` to the **default-board** keys above. The `<config.teamBoard.*>` placeholders read the separate `teamBoard` object, which only [team queries (§8)](../../assistant-query/references/ado-queries.md) / [team layout (§4b)](../../assistant-query/references/team-board-layout.md) uses; omit that object if you use a single board.

To stay on the local-markdown backend instead, set `"taskBackend": "markdown"` (or omit the file entirely); the ADO keys are then ignored. To use the GitHub backend instead, see [GitHub configuration](github-configuration.md) (`"taskBackend": "github"` plus a `github` block). Other features layer their own keys onto this same file (e.g. `adoSessionSync.enabled` / `taskSessionSync.enabled` — see the `ado-session-sync` / `github-session-sync` skills).
