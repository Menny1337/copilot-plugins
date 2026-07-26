---
name: az
description: "Generate and explain Azure CLI (`az`) commands for managing Azure and Azure DevOps. Use when the user asks for Azure CLI commands or wants to manage Azure or Azure DevOps from the `az` CLI: `az login`, `az devops`, resource groups, Key Vault, Bicep, App Service, AKS, storage, networking, monitoring, databases, and `az acr`. Do not invoke when the prompt explicitly names another tool such as Docker, `kubectl`, Terraform, GitHub CLI (`gh`), AWS CLI, or PowerShell Az."
argument-hint: "<what to do in Azure or Azure DevOps>"
---

> **Path resolution:** `references/...` paths in this file are relative to this skill's installation directory. The agent should resolve them by combining the skill's install path (provided by Copilot CLI when the skill is invoked) with the relative path.

# Azure CLI

Comprehensive Azure CLI skill. Routes tasks to domain-specific reference files and provides shared foundations (auth, output, JMESPath).

## When to Use

- Any task involving the `az` CLI — user explicitly mentions Azure CLI, `az` commands, or wants Azure management from the command line without naming a different CLI
- Azure DevOps CLI operations (`az devops`, `az boards`, `az repos`, `az pipelines`)
- Azure authentication (`az login`), subscription management, output formatting
- Generating `az` CLI commands for any Azure service

## When to Skip

- **Any prompt that explicitly names another CLI or shell surface** — if the user says Docker, `kubectl`, Terraform, GitHub CLI (`gh`), AWS CLI, or PowerShell Az cmdlets, do not route through this skill even if Azure resources are mentioned
- **GitHub CLI** (`gh`) — completely separate tool, not Azure
- **AWS CLI** (`aws`) or **Google Cloud CLI** (`gcloud`) — different cloud providers
- **PowerShell Az module** (`Connect-AzAccount`, `Get-AzResource`, `New-AzResourceGroup`) — this skill is for the `az` bash CLI only, not PowerShell cmdlets
- **Terraform** or **Pulumi** — infrastructure-as-code tools that wrap Azure APIs but aren't `az` CLI
- **kubectl** commands directly — use the `az aks` commands to manage AKS clusters, but pure Kubernetes operations are out of scope
- **Docker CLI** (`docker build`, `docker push`) — if the prompt explicitly asks for Docker commands, skip this skill even when Azure Container Registry is mentioned; only use this skill for `az acr`
- **Azure Portal UI** tasks — this skill is CLI-only
- **Azure MCP tools** are already available in your environment for direct resource queries — this skill is for generating `az` CLI commands and scripts, not for querying resources interactively

---

## Workflow

1. **Check for explicit competing tools first** — if the prompt explicitly names Docker, `kubectl`, Terraform, GitHub CLI, AWS CLI, or PowerShell Az cmdlets, skip this skill
2. **Identify the domain** using the routing tables below
3. **For simple, well-known commands** (e.g., `az group create`, `az account list`) — execute directly without reading reference files
4. **For complex or unfamiliar domains** — read the reference file: `view references/{domain}.md`
5. **Use Foundations** (Section 2 below) for auth, output, and JMESPath patterns
6. **Execute** the commands, using `2>&1` to capture errors for debugging

---

## 1. Routing

### Command Group → Domain

| `az` Command Group | Reference File |
|---|---|
| `az login`, `az account`, `az config`, `az rest`, `az extension`, `az version` | *(Foundations below — no file needed)* |
| `az boards`, `az boards work-item`, `az boards query` | `devops-boards.md` |
| `az repos`, `az repos pr`, `az repos policy` | `devops-repos.md` |
| `az pipelines`, `az pipelines run`, `az pipelines variable` | `devops-pipelines.md` |
| `az devops wiki` | `devops-wiki.md` |
| `az devops project`, `az devops team`, `az devops user`, `az devops service-endpoint`, `az devops security`, `az artifacts` | `devops-admin.md` |
| `az ad`, `az role`, `az identity` | `identity-rbac.md` |
| `az containerapp` | `containerapp.md` |
| `az keyvault` | `keyvault.md` |
| `az monitor` | `monitor.md` |
| `az storage` | `storage.md` |
| `az network` | `networking.md` |
| `az sql`, `az cosmosdb`, `az mysql`, `az postgres`, `az redis` | `databases.md` |
| `az deployment`, `az bicep`, `az ts` | `deployment-iac.md` |
| `az webapp`, `az functionapp`, `az staticwebapp`, `az logicapp`, `az appservice` | `webapp-functions.md` |
| `az aks`, `az acr` | `aks.md` |
| `az security`, `az policy` | `security-policy.md` |
| `az servicebus`, `az eventhubs`, `az eventgrid` | `messaging.md` |
| `az cognitiveservices` | `ai-services.md` |
| `az group`, `az resource`, `az lock`, `az tag`, `az provider`, `az vm`, `az vmss` | `resource-mgmt.md` |

### Keyword → Domain

| User Intent / Keywords | Reference File |
|---|---|
| work item, bug, task, user story, sprint, WIQL, backlog | `devops-boards.md` |
| pull request, PR, code review, merge, branch policy | `devops-repos.md` |
| pipeline, build, release, CI/CD, variable group | `devops-pipelines.md` |
| wiki, documentation page | `devops-wiki.md` |
| project, team, service connection, permissions, security group | `devops-admin.md` |
| app registration, service principal, RBAC, role, managed identity | `identity-rbac.md` |
| container app, revision, ingress, Dapr | `containerapp.md` |
| secret, key, certificate, vault | `keyvault.md` |
| metrics, alert, log analytics, KQL, diagnostic | `monitor.md` |
| blob, file share, storage account, SAS token, queue | `storage.md` |
| VNet, NSG, DNS, private endpoint, load balancer, VPN | `networking.md` |
| SQL, Cosmos, MySQL, PostgreSQL, Redis, database | `databases.md` |
| Bicep, ARM template, deployment, infrastructure as code | `deployment-iac.md` |
| web app, function app, static web app, app service | `webapp-functions.md` |
| Kubernetes, AKS, container registry, ACR, kubectl | `aks.md` |
| security alert, policy, compliance, Defender | `security-policy.md` |
| Service Bus, Event Hub, Event Grid | `messaging.md` |
| OpenAI, cognitive services, AI model, GPT | `ai-services.md` |
| resource group, tagging, locks, provider, VM | `resource-mgmt.md` |
| login, auth, subscription, output format, JMESPath | *(Foundations below)* |

### Multi-Domain Composition

| Scenario | Reference Files |
|---|---|
| Deploy container app with secrets | `containerapp.md` + `keyvault.md` |
| Pipeline with service connection | `devops-pipelines.md` + `devops-admin.md` |
| Monitoring for a web app | `webapp-functions.md` + `monitor.md` |
| Work items from a PR | `devops-boards.md` + `devops-repos.md` |
| Bicep with managed identity | `deployment-iac.md` + `identity-rbac.md` |
| AKS with private networking | `aks.md` + `networking.md` |

### Decision Tree for Ambiguous Terms

**"deploy"** → Pipeline run? (`devops-pipelines.md`) · ARM/Bicep? (`deployment-iac.md`) · Web app? (`webapp-functions.md`) · Container app? (`containerapp.md`) · AKS? (`aks.md`)

**"security"** → ADO permissions? (`devops-admin.md`) · Azure Policy/Defender? (`security-policy.md`) · RBAC/identity? (`identity-rbac.md`) · Key Vault? (`keyvault.md`) · NSG? (`networking.md`)

**"monitor/logs"** → Azure Monitor? (`monitor.md`) · Pipeline logs? (`devops-pipelines.md`) · Container app logs? (`containerapp.md`) · App Service logs? (`webapp-functions.md`)

---

## 2. Foundations

Core patterns shared by all Azure CLI operations.

### Authentication

```bash
# Interactive (opens browser)
az login
az login --tenant <tenant-id>

# Service principal
az login --service-principal --username <app-id> --password <secret> --tenant <tenant-id>

# Managed identity
az login --identity
az login --identity --username <client-id>   # user-assigned

# Device code (headless/SSH)
az login --use-device-code

# Azure DevOps (separate from az login)
export AZURE_DEVOPS_EXT_PAT=<your-pat>
ADO_ORG="https://dev.azure.com/<org>"
ADO_PROJECT="<project>"

# Scope commands explicitly in shared or multi-project environments.
# Check `az <group> <command> --help` before adding --project: some commands,
# including `az boards work-item show` and `update`, accept --org but not --project.
az boards work-item show --id <work-item-id> --org "$ADO_ORG"
az boards query --wiql "<WIQL>" --org "$ADO_ORG" --project "$ADO_PROJECT"

# Persistent defaults are suitable only for a dedicated single-org/project shell:
# az devops configure --defaults organization="$ADO_ORG" project="$ADO_PROJECT"

# Get access token (control plane / ARM)
az account get-access-token --resource https://management.azure.com

# Token for an AAD-protected DATA-PLANE endpoint (not just ARM).
# `--resource` takes the audience of ANY Azure-AD-protected service — e.g. a
# Kusto/ADX cluster, Log Analytics, Microsoft Graph, Cosmos DB, or a custom API —
# so you can query services that have no dedicated `az` subcommand.
TOKEN=$(az account get-access-token --resource https://<cluster>.kusto.windows.net --query accessToken -o tsv)

# Call the data-plane API with that token — prefer `az rest` (no extra tooling):
az rest --method POST \
  --uri "https://<cluster>.kusto.windows.net/v1/rest/query" \
  --headers "Authorization=Bearer $TOKEN" "Content-Type=application/json" \
  --body '{"db": "<database>", "csl": "MyTable | take 10"}'

# Fallback only if the API needs handling `az rest` can't do (custom verbs, streaming):
#   curl -sS -H "Authorization: Bearer $TOKEN" "https://<cluster>.kusto.windows.net/v1/rest/query" ...
```

> **Examples (Log Analytics, Graph, etc.) share this shape** — swap the `--resource`
> audience and the data-plane URI. **Do not echo, log, or commit access tokens**; keep
> them in short-lived shell variables only.

### Subscription Management

```bash
az account list --output table
az account show --output table
az account set --subscription "<name-or-id>"
```

### Output Formats

| Format | Flag | Best For |
|--------|------|----------|
| JSON | `--output json` | Default. Parsing, piping to `jq`. |
| Table | `--output table` | Human reading. |
| TSV | `--output tsv` | Shell scripting. |
| YAML | `--output yaml` | Config files. |
| None | `--output none` | Suppress output. |

```bash
az config set core.output=table   # set default
```

### JMESPath Queries (`--query`)

```bash
# Single field
az account show --query "name" --output tsv

# Object projection
az account show --query "{Name:name, Sub:id}" --output table

# Filter array
az vm list --query "[?location=='eastus']" --output table

# Filter + project
az vm list --query "[?powerState=='VM running'].{Name:name, RG:resourceGroup}" --output table

# Contains
az vm list --query "[?contains(name, 'prod')]" --output table

# Count
az vm list --query "length(@)"
```

**Gotchas:** Strings in JMESPath use **single quotes** (`[?name=='foo']`). Use `--output tsv` with `--query` for clean values.

### Raw REST API (`az rest`)

```bash
az rest --method GET --uri "<url>"
az rest --method POST --uri "<url>" --body '{"key": "value"}'
az rest --method PUT --uri "<url>" --body @payload.json
```

### Configuration & Defaults

```bash
az config set defaults.group=myResourceGroup
az config set defaults.location=eastus
az config get
```

### Extensions

```bash
az extension list --output table
az extension add --name <extension-name>
az extension update --name <extension-name>
```

### Common Flags

| Flag | Purpose |
|------|---------|
| `--output` / `-o` | Output format |
| `--query` | JMESPath filter |
| `--subscription` | Target subscription |
| `--resource-group` / `-g` | Resource group |
| `--name` / `-n` | Resource name |
| `--location` / `-l` | Azure region |
| `--tags` | Space-separated `key=value` pairs |
| `--no-wait` | Don't wait for long operations |
| `--yes` / `-y` | Skip confirmation prompts |
| `--debug` | HTTP-level traces |
