
# Azure DevOps Boards — Work Item Management

## 1. When to Use

- Creating, querying, updating, or deleting ADO work items (Bugs, Tasks, User Stories, Epics, Features)
- Running WIQL queries against boards to find or filter work items
- Managing area paths and iteration paths (sprints)
- Linking work items (parent/child, related, duplicate)
- Adding comments or discussion to work items
- Sprint planning and backlog grooming via CLI

## 2. When to Skip

- **GitHub Issues** — use `gh issue` commands instead
- **Repos & PRs** — use `az repos` / `az repos pr` (see devops-repos.md)
- **Pipelines** — use `az pipelines` (see devops-pipelines.md)
- **Artifacts / Feeds** — use `az artifacts` (see devops-admin.md)
- **Dashboard or Wiki** — no CLI support; use the web portal

## 3. Prerequisites

Ensure the `azure-devops` extension is installed and defaults are configured. See the **Foundations (in az skill)** for full auth setup.

```bash
# Install the extension (idempotent)
az extension add --name azure-devops

# Set org and project defaults (avoids --org/--project on every command)
az devops configure --defaults \
  organization=https://dev.azure.com/<org> \
  project=<project>

# Verify defaults
az devops configure --list
```

> **Tip:** If you work across multiple orgs/projects, pass `--org` and `--project` explicitly per command instead of relying on defaults.

## 4. Work Item CRUD

### 4.1 Create a Work Item

```bash
# Basic creation
az boards work-item create \
  --type "Bug" \
  --title "Login page throws 500 on expired token" \
  --assigned-to "user@microsoft.com" \
  --area "MyProject\\TeamA\\Frontend" \
  --iteration "MyProject\\Sprint 42" \
  --discussion "Repro: navigate to /login with an expired cookie"

# With custom fields
az boards work-item create \
  --type "User Story" \
  --title "As a user I can reset my password" \
  --fields \
    "Microsoft.VSTS.Common.Priority=2" \
    "Microsoft.VSTS.Common.AcceptanceCriteria=<p>Email link works within 24h</p>" \
    "System.Tags=auth;security"

# Create a Task under a parent (link after creation — see §7)
az boards work-item create \
  --type "Task" \
  --title "Implement password reset API" \
  --assigned-to "@Me" \
  --iteration "MyProject\\Sprint 42"
```

### 4.2 Show a Work Item

```bash
# Full details
az boards work-item show --id 12345

# Specific fields only (faster, less noise)
az boards work-item show --id 12345 \
  --fields "System.Title,System.State,System.AssignedTo"

# Extract a single value with JMESPath
az boards work-item show --id 12345 \
  --query "fields.\"System.State\"" -o tsv
```

### 4.3 Update a Work Item

```bash
# Change state and add a comment
az boards work-item update --id 12345 \
  --state "Active" \
  --discussion "Starting work on this now"

# Reassign and reprioritize
az boards work-item update --id 12345 \
  --assigned-to "other@microsoft.com" \
  --fields "Microsoft.VSTS.Common.Priority=1"

# Move to a different iteration (sprint)
az boards work-item update --id 12345 \
  --iteration "MyProject\\Sprint 43"

# Move to a different area path
az boards work-item update --id 12345 \
  --area "MyProject\\TeamB\\Backend"
```

### 4.4 Delete a Work Item

```bash
# Soft delete (moves to recycle bin)
az boards work-item delete --id 12345 --yes

# Permanent delete (no recovery)
az boards work-item delete --id 12345 --yes --destroy
```

> **Warning:** `--destroy` is irreversible. Prefer soft delete unless cleaning up test data.

## 5. WIQL Queries

WIQL (Work Item Query Language) is SQL-like syntax for querying ADO boards. Use `az boards query --wiql` for ad-hoc queries or `--id` for saved queries.

### 5.1 Query Syntax

```bash
az boards query --wiql "<WIQL_STRING>" -o table
```

### 5.2 Common Query Examples

**Active bugs assigned to me:**
```bash
az boards query --wiql "
  SELECT [System.Id], [System.Title], [System.State], [Microsoft.VSTS.Common.Priority]
  FROM WorkItems
  WHERE [System.WorkItemType] = 'Bug'
    AND [System.AssignedTo] = @Me
    AND [System.State] = 'Active'
  ORDER BY [Microsoft.VSTS.Common.Priority] ASC
" -o table
```

**Items in the current iteration (sprint):**
```bash
az boards query --wiql "
  SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State]
  FROM WorkItems
  WHERE [System.IterationPath] = @CurrentIteration
    AND [System.State] <> 'Closed'
  ORDER BY [System.WorkItemType] ASC
" -o table
```

**User stories by priority:**
```bash
az boards query --wiql "
  SELECT [System.Id], [System.Title], [Microsoft.VSTS.Common.Priority], [System.State]
  FROM WorkItems
  WHERE [System.WorkItemType] = 'User Story'
    AND [System.State] IN ('New', 'Active')
  ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.CreatedDate] DESC
" -o table
```

**Items modified in the last 7 days:**
```bash
az boards query --wiql "
  SELECT [System.Id], [System.Title], [System.ChangedDate], [System.ChangedBy]
  FROM WorkItems
  WHERE [System.ChangedDate] >= @Today - 7
    AND [System.TeamProject] = @Project
  ORDER BY [System.ChangedDate] DESC
" -o table
```

**Filter by area path (with subtree):**
```bash
az boards query --wiql "
  SELECT [System.Id], [System.Title], [System.AreaPath]
  FROM WorkItems
  WHERE [System.AreaPath] UNDER 'MyProject\\TeamA'
    AND [System.State] <> 'Removed'
  ORDER BY [System.Id] ASC
" -o table
```

**My open items across all types:**
```bash
az boards query --wiql "
  SELECT [System.Id], [System.WorkItemType], [System.Title], [System.State]
  FROM WorkItems
  WHERE [System.AssignedTo] = @Me
    AND [System.State] NOT IN ('Closed', 'Resolved', 'Removed', 'Done')
  ORDER BY [System.WorkItemType] ASC, [Microsoft.VSTS.Common.Priority] ASC
" -o table
```

### 5.3 Saved Queries

```bash
# Run a saved query by its ID (find IDs in the ADO web portal under Queries)
az boards query --id "a1b2c3d4-e5f6-7890-abcd-ef1234567890" -o table
```

### 5.4 Post-Processing with JMESPath

```bash
# Get just the IDs from a query result
az boards query --wiql "
  SELECT [System.Id] FROM WorkItems
  WHERE [System.AssignedTo] = @Me AND [System.State] = 'Active'
" --query "[].id" -o tsv

# Pipe IDs into a loop for bulk operations
for id in $(az boards query --wiql "
  SELECT [System.Id] FROM WorkItems
  WHERE [System.AssignedTo] = @Me
    AND [System.WorkItemType] = 'Task'
    AND [System.State] = 'New'
" --query "[].id" -o tsv); do
  az boards work-item update --id "$id" --state "Active"
done
```

## 6. Area & Iteration Paths

### 6.1 Area Paths

```bash
# List area paths for the project
az boards area project list -o table

# Create an area path
az boards area project create --name "Frontend" --path "\\MyProject\\TeamA"

# Delete an area path
az boards area project delete --path "\\MyProject\\TeamA\\OldArea" --yes

# List area paths for a specific team
az boards area team list --team "TeamA" -o table

# Add an area path to a team
az boards area team add --path "\\MyProject\\TeamA\\Frontend" --team "TeamA"

# Remove an area path from a team
az boards area team remove --path "\\MyProject\\TeamA\\OldArea" --team "TeamA"
```

### 6.2 Iteration Paths (Sprints)

```bash
# List iteration paths for the project
az boards iteration project list -o table

# Create an iteration (sprint)
az boards iteration project create \
  --name "Sprint 43" \
  --path "\\MyProject" \
  --start-date "2025-01-13" \
  --finish-date "2025-01-24"

# Delete an iteration
az boards iteration project delete --path "\\MyProject\\Sprint 40" --yes

# List iterations for a specific team
az boards iteration team list --team "TeamA" -o table

# Add iteration to a team's sprint schedule
az boards iteration team add --id <iteration-id> --team "TeamA"

# Set the team's default iteration (backlog iteration)
az boards iteration team set-default-iteration --team "TeamA" --id <iteration-id>

# Show current team iterations with dates
az boards iteration team list --team "TeamA" -o table \
  --query "[].{Name:name, Start:attributes.startDate, Finish:attributes.finishDate}"
```

## 7. Work Item Relations

### 7.1 Add Relations

```bash
# Add a parent-child relationship (make 12345 a child of 12300)
az boards work-item relation add \
  --id 12345 \
  --relation-type "parent" \
  --target-id 12300

# Add a child (make 12346 a child of 12345)
az boards work-item relation add \
  --id 12345 \
  --relation-type "child" \
  --target-id 12346

# Link as related
az boards work-item relation add \
  --id 12345 \
  --relation-type "related" \
  --target-id 12350

# Mark as duplicate
az boards work-item relation add \
  --id 12345 \
  --relation-type "duplicate-of" \
  --target-id 12300
```

### 7.2 View Relations

```bash
# Show all relations for a work item
az boards work-item relation show --id 12345

# Extract just relation targets with JMESPath
az boards work-item relation show --id 12345 \
  --query "relations[].{Type:rel, Target:url}" -o table
```

### 7.3 Remove Relations

```bash
# Remove a specific relation by its index (from relation show output)
az boards work-item relation remove --id 12345 --relation-type "related" --target-id 12350 --yes
```

### 7.4 Common Relation Types

| Relation Type  | CLI Value        | Description                    |
|----------------|------------------|--------------------------------|
| Parent         | `parent`         | Parent of this work item       |
| Child          | `child`          | Child of this work item        |
| Related        | `related`        | General relationship           |
| Duplicate Of   | `duplicate-of`   | This item duplicates target    |
| Duplicate      | `duplicate`      | Target is a duplicate of this  |
| Predecessor    | `predecessor`    | Must be done before this item  |
| Successor      | `successor`      | Must be done after this item   |

## 8. Common Field References

| Field Name                                    | Short Alias       | Values / Notes                                      |
|-----------------------------------------------|--------------------|-----------------------------------------------------|
| `System.Title`                                | `--title`          | String                                              |
| `System.State`                                | `--state`          | New, Active, Resolved, Closed (varies by type)      |
| `System.AssignedTo`                           | `--assigned-to`    | Email or display name                               |
| `System.WorkItemType`                         | `--type`           | Bug, Task, User Story, Epic, Feature                |
| `System.IterationPath`                        | `--iteration`      | `Project\\Sprint 42`                                |
| `System.AreaPath`                             | `--area`           | `Project\\Team\\Area`                               |
| `System.Tags`                                 | via `--fields`     | Semicolon-separated: `"tag1;tag2"`                  |
| `System.Description`                          | `--description`    | HTML string                                         |
| `Microsoft.VSTS.Common.Priority`              | via `--fields`     | 1 (highest) to 4 (lowest)                           |
| `Microsoft.VSTS.Common.Severity`              | via `--fields`     | 1 - Critical, 2 - High, 3 - Medium, 4 - Low        |
| `Microsoft.VSTS.Common.AcceptanceCriteria`    | via `--fields`     | HTML string (User Stories)                          |
| `Microsoft.VSTS.Scheduling.RemainingWork`     | via `--fields`     | Numeric (hours)                                     |
| `Microsoft.VSTS.Scheduling.OriginalEstimate`  | via `--fields`     | Numeric (hours)                                     |
| `System.CreatedDate`                          | read-only          | DateTime (for WIQL queries)                         |
| `System.ChangedDate`                          | read-only          | DateTime (for WIQL queries)                         |

Use `--fields` for any field not covered by a dedicated flag:
```bash
az boards work-item update --id 12345 \
  --fields "Microsoft.VSTS.Common.Priority=1" "System.Tags=urgent;production"
```

## 9. Gotchas

> **CRITICAL: Read before scripting against ADO boards.**

1. **Work item types vary by process template.** Agile uses "User Story", Scrum uses "Product Backlog Item", CMMI uses "Requirement". Check your project's process: `az boards work-item type list -o table`.

2. **`--discussion` adds comments.** There is no separate `az boards comment` command. Use `--discussion "your comment"` on `create` or `update` to add discussion entries.

3. **WIQL macros:**
   - `@Me` — current authenticated user
   - `@Today` — current date (supports arithmetic: `@Today - 7`)
   - `@CurrentIteration` — the team's active sprint
   - `@Project` — current project name
   - These are **case-sensitive** in some contexts.

4. **Area paths use backslash separators** and require double-escaping in most shells:
   ```bash
   --area "MyProject\\TeamA\\Frontend"
   # In WIQL strings, also double-escape:
   --wiql "... [System.AreaPath] UNDER 'MyProject\\TeamA' ..."
   ```

5. **`--fields` syntax** for non-standard fields uses `Key=Value` pairs:
   ```bash
   --fields "Microsoft.VSTS.Common.Priority=1" "System.Tags=p0;hotfix"
   ```

6. **Always set org/project defaults** to avoid repeating `--org` and `--project` on every command. Or export them:
   ```bash
   export AZURE_DEVOPS_EXT_ORGANIZATION=https://dev.azure.com/myorg
   export AZURE_DEVOPS_EXT_PROJECT=MyProject
   ```

7. **State transitions have rules.** You can't jump from "New" to "Closed" on some work item types. Check allowed transitions: update to intermediate states if needed (New → Active → Resolved → Closed).

8. **WIQL `UNDER` operator** matches a path and all its children. Use `=` for exact match only:
   ```sql
   -- All items under TeamA (including TeamA\Frontend, TeamA\Backend, etc.)
   WHERE [System.AreaPath] UNDER 'MyProject\\TeamA'
   -- Only items directly in TeamA
   WHERE [System.AreaPath] = 'MyProject\\TeamA'
   ```

9. **Query output defaults to JSON.** Always add `-o table` for readable output or `-o tsv` for scripting. Use `--query` (JMESPath) to extract specific fields.

10. **HTML fields** (`Description`, `AcceptanceCriteria`, `ReproSteps`) expect HTML content, not plain text. Wrap in `<p>` tags for proper rendering in the web portal.

11. **Large projects time out on broad queries.** On massive projects like Microsoft's `OS` project, `CONTAINS` searches scoped only to iteration consistently time out. Always scope by area path (see §10 for the full fallback strategy).

## 10. Large-Project Query Strategy

> **When querying very large ADO projects (e.g., Microsoft's `OS` project), standard WIQL patterns can time out.** Use this ordered fallback strategy:

### 10.1 Preferred: Direct ID Lookup

If you have a work item ID, always use direct lookup — fastest and most reliable:

```bash
az boards work-item show --id <ID> -o table
```

### 10.2 First Attempt: Scope to @Me

Start with `@Me`-scoped queries. These are fast because ADO indexes the assigned-to field:

```bash
az boards query --wiql "
  SELECT [System.Id], [System.Title], [System.State]
  FROM WorkItems
  WHERE [System.AssignedTo] = @Me
    AND [System.State] NOT IN ('Closed', 'Resolved', 'Removed', 'Done')
  ORDER BY [Microsoft.VSTS.Common.Priority] ASC
" -o table
```

### 10.3 Fallback: Scope by Team Area Path

If `@Me` doesn't find the item (e.g., assigned to a teammate), scope by **team area path** instead of iteration. Area paths are narrower and won't time out:

```bash
az boards query --wiql "
  SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo]
  FROM WorkItems
  WHERE [System.AreaPath] UNDER 'OS\\WDATP\\Windows Cyber Defense\\Front End Infra'
    AND [System.State] NOT IN ('Closed', 'Resolved', 'Removed', 'Done')
  ORDER BY [System.ChangedDate] DESC
" -o table
```

> **Why area path?** On massive projects, the area path tree is much narrower than iteration-scoped queries. The `OS` project has thousands of teams — iteration-scoped `CONTAINS` searches scan too many items and consistently time out.

### 10.4 Never: Broad CONTAINS on Iteration-Only Scope

**Do NOT** run broad text searches (`CONTAINS`) scoped only to iteration on large projects. These time out consistently:

```sql
-- ❌ WILL TIME OUT on large projects like OS
WHERE [System.IterationPath] = @CurrentIteration
  AND [System.Title] CONTAINS 'search term'
```

Instead, combine `CONTAINS` with an area path constraint:

```sql
-- ✅ Narrowed by area path — fast enough
WHERE [System.AreaPath] UNDER 'OS\\WDATP\\Windows Cyber Defense\\Front End Infra'
  AND [System.Title] CONTAINS 'search term'
```

## 11. Reference

- [az boards CLI reference](https://learn.microsoft.com/en-us/cli/azure/boards)
- [az boards work-item](https://learn.microsoft.com/en-us/cli/azure/boards/work-item)
- [WIQL syntax reference](https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax)
- [WIQL field reference](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/guidance/work-item-field)
- [Work item relation types](https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference)
- [Process templates (Agile vs Scrum vs CMMI)](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/guidance/choose-process)
