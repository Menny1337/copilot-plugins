
# Azure DevOps Administration Skill

Comprehensive guide for administering Azure DevOps organizations, projects, teams, users, service connections, extensions, security, and artifacts via the `az devops` CLI.


## When to Use

- Managing ADO **organization** settings (banners, defaults)
- **Project** lifecycle: create, configure, list, delete
- **Team** CRUD and membership management
- **User** provisioning: add, remove, update access levels
- **Service endpoints** (connections): Azure RM, GitHub, and custom
- **Marketplace extensions**: install, enable, disable, search
- **Security groups & permissions**: group membership, namespace/token/bit permissions
- **Artifacts**: publishing and downloading Universal Packages
- Any raw ADO REST API call via `az devops invoke`

## When to Skip

These areas have **dedicated skills** — use them instead:

| Area | Use Instead |
|---|---|
| Work items, boards, queries, sprints | `devops-boards.md` reference |
| Repos, PRs, branch policies | `devops-repos.md` reference |
| Pipelines, builds, releases | `devops-pipelines.md` reference |
| Wiki pages | `devops-wiki.md` reference |


## Prerequisites

- **Foundations (in az skill)** — ensure Azure CLI is installed and authenticated (`az login`)
- **Azure DevOps extension** — install if missing:
  ```bash
  az extension add --name azure-devops
  ```
- **Permissions** — many admin operations require **Project Collection Administrator** role. User management and security operations are especially sensitive.
- **PAT (Personal Access Token)** — some operations require a PAT instead of AAD auth:
  ```bash
  az devops login
  # Pastes PAT when prompted (or pipe: echo $PAT | az devops login)
  ```


## Organization & Project Management

### Set Defaults (Do This First)

Avoid repeating `--org` and `--project` on every command:

```bash
az devops configure --defaults \
  organization=https://dev.azure.com/<org> \
  project=<project-name>
```

Verify defaults:

```bash
az devops configure --list
```

### Login with PAT

```bash
# Interactive — prompts for token
az devops login --organization https://dev.azure.com/<org>

# Non-interactive — pipe token
echo "$ADO_PAT" | az devops login --organization https://dev.azure.com/<org>
```

### Project Operations

```bash
# List all projects in the org
az devops project list --output table

# Show details of a specific project
az devops project show --project <name-or-id>

# Create a new project
az devops project create \
  --name "MyProject" \
  --description "Project description" \
  --source-control git \
  --visibility private \
  --process Agile   # Agile | Scrum | Basic | CMMI

# Delete a project (requires confirmation)
az devops project delete --id <project-id> --yes
```


## Team Management

```bash
# List all teams in a project
az devops team list --output table

# Show team details
az devops team show --team "My Team"

# Create a team
az devops team create --name "Platform Team" --description "Platform engineering"

# Update a team
az devops team update --team "Platform Team" --name "Infra Team" --description "Updated desc"

# Delete a team
az devops team delete --id <team-id> --yes

# List members of a team
az devops team list-member --team "My Team" --output table
```


## User Management

Manage users and their access levels within the organization.

```bash
# List all users in the org
az devops user list --output table

# Show a specific user
az devops user show --user <user-email-or-id>

# Add a user to the org
az devops user add \
  --email-id user@example.com \
  --license-type express   # express | stakeholder | advanced | earlyAdopter | professional
  --send-email-invite true

# Update a user's access level
az devops user update \
  --user <user-id> \
  --license-type stakeholder

# Remove a user from the org
az devops user remove --user <user-id> --yes
```

**Access level types:**
- `stakeholder` — Free, limited access (view work items, dashboards)
- `express` / `basic` — Standard access
- `advanced` / `professional` — Full access including Test Plans


## Service Endpoints (Connections)

Service endpoints connect ADO to external services (Azure subscriptions, GitHub, Docker, etc.).

### List & Inspect

```bash
# List all service endpoints in a project
az devops service-endpoint list --output table

# Show details of a specific endpoint
az devops service-endpoint show --id <endpoint-id>
```

### Create Azure RM Service Connection

```bash
az devops service-endpoint azurerm create \
  --name "Azure-Production" \
  --azure-rm-service-principal-id <sp-app-id> \
  --azure-rm-subscription-id <sub-id> \
  --azure-rm-subscription-name "Production Sub" \
  --azure-rm-tenant-id <tenant-id>
# Prompts for service principal password/secret
```

### Create GitHub Service Connection

```bash
az devops service-endpoint github create \
  --name "GitHub-Connection" \
  --github-url https://github.com
# Prompts for GitHub PAT
```

### Update & Delete

```bash
# Update an endpoint (e.g., enable for all pipelines)
az devops service-endpoint update \
  --id <endpoint-id> \
  --enable-for-all true

# Delete an endpoint
az devops service-endpoint delete --id <endpoint-id> --yes
```


## Extensions

Manage marketplace extensions for the organization.

```bash
# Search for extensions in the marketplace
az devops extension search --search-query "code coverage"

# List installed extensions
az devops extension list --output table

# Show extension details
az devops extension show \
  --publisher-id <publisher> \
  --extension-id <extension>

# Install an extension
az devops extension install \
  --publisher-id <publisher> \
  --extension-id <extension>

# Enable a disabled extension
az devops extension enable \
  --publisher-id <publisher> \
  --extension-id <extension>

# Disable an extension
az devops extension disable \
  --publisher-id <publisher> \
  --extension-id <extension>

# Uninstall an extension
az devops extension uninstall \
  --publisher-id <publisher> \
  --extension-id <extension> --yes
```


## Security Groups & Permissions

### Security Groups

```bash
# List security groups in a project
az devops security group list --output table

# Show a specific group
az devops security group show --id <group-descriptor>

# Create a security group
az devops security group create \
  --name "Release Approvers" \
  --description "Team that approves production releases"

# Update a group
az devops security group update \
  --id <group-descriptor> \
  --name "Prod Release Approvers"

# Delete a group
az devops security group delete --id <group-descriptor> --yes
```

### Group Membership

```bash
# List members of a security group
az devops security group membership list --id <group-descriptor> --output table

# Add a member to a group
az devops security group membership add \
  --group-id <group-descriptor> \
  --member-id <member-descriptor>

# Remove a member from a group
az devops security group membership remove \
  --group-id <group-descriptor> \
  --member-id <member-descriptor> --yes
```

### Permissions

Permissions in ADO use a **namespace/token/bit** system:
- **Namespace** — permission domain (e.g., Git Repositories, Build, Project)
- **Token** — specific resource within the namespace
- **Bit** — integer representing a specific permission action

```bash
# List permission namespaces
az devops security permission namespace list --output table

# Show details of a namespace (lists available permission bits)
az devops security permission namespace show --id <namespace-id>

# List permissions for a group/user on a token
az devops security permission list \
  --id <namespace-id> \
  --subject <group-or-user-descriptor> \
  --token <token>

# Show effective permissions
az devops security permission show \
  --id <namespace-id> \
  --subject <group-or-user-descriptor> \
  --token <token>

# Grant a permission (set allow bit)
az devops security permission update \
  --id <namespace-id> \
  --subject <group-or-user-descriptor> \
  --token <token> \
  --allow-bit <bit-value> \
  --merge true

# Reset a permission to inherited/not-set
az devops security permission reset \
  --id <namespace-id> \
  --subject <group-or-user-descriptor> \
  --token <token> \
  --permission-bit <bit-value>

# Reset ALL permissions on a token for a subject
az devops security permission reset-all \
  --id <namespace-id> \
  --subject <group-or-user-descriptor> \
  --token <token> --yes
```


## Org Banners

Display announcement banners across the organization.

```bash
# Add a banner
az devops admin banner add \
  --message "Scheduled maintenance tonight 10pm-2am" \
  --type warning   # info | warning | error
  --id "maint-banner-01"

# List all banners
az devops admin banner list --output table

# Show a specific banner
az devops admin banner show --id "maint-banner-01"

# Update a banner
az devops admin banner update \
  --id "maint-banner-01" \
  --message "Maintenance postponed to tomorrow"

# Remove a banner
az devops admin banner remove --id "maint-banner-01"
```


## Artifacts

The `az artifacts` CLI supports **Universal Packages only**. For NuGet, npm, Maven, and Python packages, use their native CLIs configured with ADO feed URLs.

### Universal Packages

```bash
# Publish a Universal Package
az artifacts universal publish \
  --feed <feed-name> \
  --name <package-name> \
  --version <semver> \
  --path <local-directory> \
  --description "Package description"

# Download a Universal Package
az artifacts universal download \
  --feed <feed-name> \
  --name <package-name> \
  --version <semver> \
  --path <local-directory>
```

### Other Package Types

For NuGet, npm, Maven, Python — configure the native CLI to use the ADO feed URL:

```bash
# npm example — set registry to ADO feed
npm config set registry https://pkgs.dev.azure.com/<org>/<project>/_packaging/<feed>/npm/registry/

# NuGet example — add ADO source
nuget sources add -Name "ADOFeed" \
  -Source "https://pkgs.dev.azure.com/<org>/<project>/_packaging/<feed>/nuget/v3/index.json"
```


## `az devops invoke` Escape Hatch

For any ADO REST API not covered by a dedicated CLI command, use `az devops invoke` to make raw API calls.

```bash
# Syntax
az devops invoke \
  --area <api-area> \
  --resource <api-resource> \
  [--route-parameters key=value ...] \
  [--query-parameters key=value ...] \
  [--http-method GET|POST|PUT|PATCH|DELETE] \
  [--in-file <request-body.json>] \
  [--api-version <version>]

# Example: list process templates
az devops invoke \
  --area processes \
  --resource processes \
  --http-method GET

# Example: get project properties
az devops invoke \
  --area core \
  --resource projects \
  --route-parameters project=MyProject \
  --http-method GET

# Discover available areas and resources
az devops invoke --query "[].{area:area, resource:resourceName}" --output table
```


## Gotchas

1. **Two org URL formats** — Azure DevOps supports both:
   - `https://dev.azure.com/<org>` (modern, preferred)
   - `https://<org>.visualstudio.com` (legacy)
   Always use the modern format. Some older orgs may only work with the legacy format.

2. **Always set defaults** — Run `az devops configure --defaults org=... project=...` first to avoid repeating `--org` and `--project` on every command.

3. **`az devops invoke` is your escape hatch** — Any ADO REST API not covered by a dedicated CLI command can be called via `az devops invoke`. Check the [ADO REST API docs](https://learn.microsoft.com/en-us/rest/api/azure/devops/) for area/resource names.

4. **Artifacts CLI is limited to Universal Packages only** — NuGet, npm, Maven, and Python packages must use their native CLIs pointed at ADO feed URLs.

5. **Permissions are complex** — The namespace/token/bit system is non-obvious:
   - Use `security permission namespace list` to discover namespaces
   - Use `security permission namespace show` to see available bits
   - Tokens are resource-specific strings (often include project IDs, repo GUIDs, etc.)
   - Test in a non-production project first

6. **PAT vs AAD auth** — Some operations (especially `az devops login`) require a Personal Access Token. Ensure PAT scopes match the operations you need.

7. **Output formats** — Use `--output table` for human-readable output, `--output json` for scripting, `--query` (JMESPath) for filtering.


## Reference

- [az devops CLI reference](https://learn.microsoft.com/en-us/cli/azure/devops)
- [az devops project](https://learn.microsoft.com/en-us/cli/azure/devops/project)
- [az devops team](https://learn.microsoft.com/en-us/cli/azure/devops/team)
- [az devops user](https://learn.microsoft.com/en-us/cli/azure/devops/user)
- [az devops service-endpoint](https://learn.microsoft.com/en-us/cli/azure/devops/service-endpoint)
- [az devops extension](https://learn.microsoft.com/en-us/cli/azure/devops/extension)
- [az devops security group](https://learn.microsoft.com/en-us/cli/azure/devops/security/group)
- [az devops security permission](https://learn.microsoft.com/en-us/cli/azure/devops/security/permission)
- [az devops admin banner](https://learn.microsoft.com/en-us/cli/azure/devops/admin/banner)
- [az artifacts universal](https://learn.microsoft.com/en-us/cli/azure/artifacts/universal)
- [az devops invoke](https://learn.microsoft.com/en-us/cli/azure/devops#az-devops-invoke)
- [Azure DevOps REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops/)
- [Azure DevOps Security Namespaces](https://learn.microsoft.com/en-us/azure/devops/organizations/security/namespace-reference)
