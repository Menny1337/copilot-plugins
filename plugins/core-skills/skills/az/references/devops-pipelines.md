
# Azure DevOps Pipelines Skill

Manage Azure DevOps pipelines entirely from the CLI — trigger builds, check run status, manage variables and variable groups, work with agent pools, and handle classic releases.

## When to Use

- Creating, listing, or deleting pipelines (YAML or classic)
- Triggering pipeline runs and checking their status
- Managing pipeline variables and variable groups
- Viewing or downloading run artifacts
- Checking agent pool and queue availability
- Managing classic releases
- Organizing pipelines into folders

## When to Skip

- **GitHub Actions** — use `gh` CLI or the `github-mcp-server` actions tools
- **Repos & PRs** — use `devops-repos.md` reference (`az repos`)
- **Work items & boards** — use `devops-boards.md` reference (`az boards`)

## Prerequisites

> Invoke the **Foundations** section in the az skill first if auth or defaults are not configured.

1. **Azure CLI** with the DevOps extension:
   ```bash
   az extension add --name azure-devops
   ```
2. **Login**:
   ```bash
   az devops login          # PAT-based
   az login                 # AAD/browser-based
   ```
3. **Set defaults** (avoids repeating `--org` and `--project` on every call):
   ```bash
   az devops configure --defaults \
     organization=https://dev.azure.com/YOUR_ORG \
     project=YOUR_PROJECT
   ```

## Pipeline CRUD

### List pipelines
```bash
az pipelines list --output table
az pipelines list --name "MyApp" --output table          # filter by name
az pipelines list --folder-path "\Backend" --output table # filter by folder
```

### Show pipeline details
```bash
az pipelines show --name "MyApp-CI"
az pipelines show --id 42 --output json
```

### Create a YAML pipeline
```bash
az pipelines create \
  --name "MyApp-CI" \
  --yaml-path /azure-pipelines.yml \
  --repository MyRepo \
  --repository-type tfsgit \
  --branch main
```

- `--repository-type`: `tfsgit` for ADO repos, `github` for GitHub repos
- `--service-connection` required for GitHub repos
- `--skip-first-run true` to create without triggering

### Delete a pipeline
```bash
az pipelines delete --id 42 --yes
```

## Triggering Runs

### Simple trigger
```bash
az pipelines run --name "MyApp-CI"
```

### Trigger with branch and variables
```bash
az pipelines run \
  --name "MyApp-CI" \
  --branch feature/my-branch \
  --variables "environment=staging" "debug=true"
```

### Trigger by pipeline ID
```bash
az pipelines run --id 42 --branch main
```

### Trigger and wait pattern
```bash
# Trigger and capture the run ID
RUN_ID=$(az pipelines run --name "MyApp-CI" --branch main --query id -o tsv)
echo "Triggered run: $RUN_ID"

# Poll until complete
while true; do
  STATUS=$(az pipelines runs show --id "$RUN_ID" --query status -o tsv)
  RESULT=$(az pipelines runs show --id "$RUN_ID" --query result -o tsv)
  echo "Status: $STATUS  Result: $RESULT"
  if [ "$STATUS" = "completed" ]; then break; fi
  sleep 30
done
```

## Run Management

### List runs for a pipeline
```bash
az pipelines runs list --pipeline-ids 42 --output table
az pipelines runs list --pipeline-ids 42 --status completed --top 5
az pipelines runs list --pipeline-ids 42 --branch main --result succeeded
```

### Show run details
```bash
az pipelines runs show --id 1234
az pipelines runs show --id 1234 --query "{status:status,result:result,startTime:startTime}" -o table
```

### Run artifacts
```bash
# List artifacts for a run
az pipelines runs artifact list --run-id 1234

# Download an artifact
az pipelines runs artifact download --run-id 1234 --artifact-name drop --path ./artifacts
```

### Run tags
```bash
az pipelines runs tag add --run-id 1234 --tags "release-candidate" "v2.1.0"
az pipelines runs tag list --run-id 1234
az pipelines runs tag delete --run-id 1234 --tag "release-candidate"
```

## Variables & Variable Groups

### Pipeline variables

Manage variables scoped to a specific pipeline:

```bash
# List variables for a pipeline
az pipelines variable list --pipeline-name "MyApp-CI" --output table

# Create a variable
az pipelines variable create \
  --pipeline-name "MyApp-CI" \
  --name "DEPLOY_ENV" \
  --value "staging"

# Create a secret variable
az pipelines variable create \
  --pipeline-name "MyApp-CI" \
  --name "API_KEY" \
  --value "secret123" \
  --is-secret true

# Update a variable
az pipelines variable update \
  --pipeline-name "MyApp-CI" \
  --name "DEPLOY_ENV" \
  --new-value "production"

# Delete a variable
az pipelines variable delete \
  --pipeline-name "MyApp-CI" \
  --name "DEPLOY_ENV" \
  --yes
```

### Variable groups

Shared variable collections reusable across pipelines:

```bash
# List all variable groups
az pipelines variable-group list --output table

# Show a specific group
az pipelines variable-group show --group-id 5

# Create a variable group
az pipelines variable-group create \
  --name "AppSettings-Staging" \
  --variables "DB_HOST=staging-db.example.com" "DB_PORT=5432" \
  --authorize true

# Update group name or description
az pipelines variable-group update \
  --group-id 5 \
  --name "AppSettings-Staging-v2"

# Delete a variable group
az pipelines variable-group delete --group-id 5 --yes
```

### Variables within a group

```bash
# List variables in a group
az pipelines variable-group variable list --group-id 5 --output table

# Add a variable to a group
az pipelines variable-group variable create \
  --group-id 5 \
  --name "NEW_VAR" \
  --value "new-value"

# Update a variable in a group
az pipelines variable-group variable update \
  --group-id 5 \
  --name "NEW_VAR" \
  --new-value "updated-value"

# Delete a variable from a group
az pipelines variable-group variable delete \
  --group-id 5 \
  --name "NEW_VAR" \
  --yes
```

## Agent Pools & Queues

### Agent pools
```bash
# List all pools
az pipelines pool list --output table

# Show pool details
az pipelines pool show --pool-id 10

# List agents in a pool
az pipelines agent list --pool-id 10 --output table

# Check agent status (filter for online/offline)
az pipelines agent list --pool-id 10 --query "[?status=='online']" --output table
```

### Agent queues
```bash
# List queues accessible to your project
az pipelines queue list --output table

# Show queue details
az pipelines queue show --id 15
```

## Classic Releases

> Classic releases use a separate command set from YAML pipelines. These manage release definitions and deployments.

```bash
# List release definitions
az pipelines release list --output table

# Show a specific release
az pipelines release show --id 200

# Create a release from a definition
az pipelines release create --definition-id 8

# Create a release with specific artifact version
az pipelines release create --definition-id 8 --artifact-metadata-list "alias=drop,instanceId=1234"
```

> **Note:** Microsoft recommends migrating from classic releases to YAML multi-stage pipelines. Classic release commands may have limited support in newer ADO versions.

## Pipeline Folders

Organize pipelines into a folder hierarchy:

```bash
# List folders
az pipelines folder list --output table

# Create a folder
az pipelines folder create --path "\Backend\Services"

# Delete a folder
az pipelines folder delete --path "\Backend\Services" --yes
```

## Classic Builds

Query classic (non-YAML) build results:

```bash
# List recent builds
az pipelines build list --output table
az pipelines build list --definition-ids 42 --top 10 --status completed

# Show a specific build
az pipelines build show --id 5678
az pipelines build show --id 5678 --query "{status:status,result:result,buildNumber:buildNumber}" -o table
```

## Gotchas

1. **`az pipelines run` triggers both YAML and classic builds** — it works for any pipeline definition type. Use `az pipelines release create` specifically for classic release pipelines.

2. **Variables syntax** — runtime variables are space-separated `key=value` pairs, not JSON:
   ```bash
   # Correct
   az pipelines run --name "CI" --variables "env=prod" "region=eastus"
   # Wrong
   az pipelines run --name "CI" --variables '{"env":"prod"}'
   ```

3. **Multi-stage YAML** — use `--branch` to specify the source branch. Stage-level triggers and approvals are controlled in the YAML definition itself, not via CLI.

4. **Classic releases ≠ YAML pipelines** — they use entirely different command groups:
   - YAML: `az pipelines run`, `az pipelines runs list/show`
   - Classic releases: `az pipelines release create/list/show`

5. **Pipeline IDs vs names** — some commands accept `--name`, others require `--id`. When in doubt, use `az pipelines list -o table` to find the ID first. Run commands (`az pipelines runs show`) always need numeric IDs.

6. **`--authorize true`** on variable groups grants all pipelines access. Omit for restricted access and authorize individually in the ADO UI.

7. **Secret variables** cannot be read back via CLI — `az pipelines variable list` will show `null` for secret values. This is by design.

## Reference

- [az pipelines CLI reference](https://learn.microsoft.com/en-us/cli/azure/pipelines)
- [az pipelines run](https://learn.microsoft.com/en-us/cli/azure/pipelines#az-pipelines-run)
- [az pipelines variable-group](https://learn.microsoft.com/en-us/cli/azure/pipelines/variable-group)
- [az pipelines release](https://learn.microsoft.com/en-us/cli/azure/pipelines/release)
- [Define variables in YAML pipelines](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/variables)
- [Classic release pipelines](https://learn.microsoft.com/en-us/azure/devops/pipelines/release)
- [Agent pools](https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/pools-queues)
