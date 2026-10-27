
# Azure Infrastructure as Code — ARM/Bicep Deployments

## When to Use

- Deploying infrastructure via ARM or Bicep templates at any scope (resource group, subscription, management group, tenant)
- Compiling, linting, formatting, or publishing Bicep files
- Previewing deployment changes with what-if
- Managing template specs
- Troubleshooting failed deployments via deployment operations

## When to Skip

- **Imperative resource creation** — Use domain-specific skills (`az-compute`, `az-networking`, etc.) for one-off `az resource create` commands
- **Terraform** — Not covered by this skill; Terraform has its own CLI and workflow

## Prerequisites

- Authenticated Azure CLI session (see Foundations section in the az skill)
- Bicep CLI installed: `az bicep install` (auto-installs on first use in modern CLI versions)
- Appropriate RBAC permissions for the target scope (Contributor or Owner at the deployment scope)

## Deployments

Azure deployments target four scopes. Each scope has `create`, `list`, `show`, `delete`, `validate`, and `what-if` sub-commands.

### Resource Group Scope

```bash
# Create / update a deployment
az deployment group create \
  --resource-group <rg> \
  --template-file <file.bicep> \
  --parameters <params.json> \
  --name <deployment-name>

# List deployments
az deployment group list --resource-group <rg> -o table

# Show a specific deployment
az deployment group show --resource-group <rg> --name <deployment-name>

# Delete a deployment record (does NOT delete resources)
az deployment group delete --resource-group <rg> --name <deployment-name>

# Validate without deploying
az deployment group validate \
  --resource-group <rg> \
  --template-file <file.bicep> \
  --parameters <params.json>

# What-if preview
az deployment group what-if \
  --resource-group <rg> \
  --template-file <file.bicep> \
  --parameters <params.json>
```

### Subscription Scope

```bash
az deployment sub create \
  --template-file <file.bicep> \
  --location <location> \
  --parameters <params.json> \
  --name <deployment-name>

az deployment sub list -o table
az deployment sub show --name <deployment-name>
az deployment sub validate --template-file <file.bicep> --location <location>
az deployment sub what-if --template-file <file.bicep> --location <location>
```

### Management Group Scope

```bash
az deployment mg create \
  --template-file <file.bicep> \
  --location <location> \
  --management-group-id <mg-id> \
  --name <deployment-name>

az deployment mg list --management-group-id <mg-id> -o table
az deployment mg show --management-group-id <mg-id> --name <deployment-name>
az deployment mg validate --template-file <file.bicep> --location <location> --management-group-id <mg-id>
az deployment mg what-if --template-file <file.bicep> --location <location> --management-group-id <mg-id>
```

### Tenant Scope

```bash
az deployment tenant create \
  --template-file <file.bicep> \
  --location <location> \
  --name <deployment-name>

az deployment tenant list -o table
az deployment tenant show --name <deployment-name>
az deployment tenant validate --template-file <file.bicep> --location <location>
az deployment tenant what-if --template-file <file.bicep> --location <location>
```

### Deployment Operations

Inspect individual resource operations within a deployment for troubleshooting:

```bash
# List all operations in a deployment
az deployment operation group list \
  --resource-group <rg> \
  --name <deployment-name> \
  -o table

# Show details of a specific operation
az deployment operation group show \
  --resource-group <rg> \
  --name <deployment-name> \
  --operation-ids <operation-id>
```

Equivalent sub-commands exist for `sub`, `mg`, and `tenant` scopes.

## What-If

Preview what changes a deployment would make **before** actually deploying:

```bash
az deployment group what-if \
  --resource-group <rg> \
  --template-file main.bicep \
  --parameters params.json
```

Output shows resources that would be **Created**, **Modified**, **Deleted**, or **NoChange**. Use `--result-format FullResourcePayloads` for detailed property diffs.

Always run what-if before deploying with `--mode Complete` to verify no unintended deletions.

## Bicep CLI

```bash
# Install / manage Bicep CLI
az bicep install
az bicep upgrade
az bicep uninstall
az bicep version

# Compile Bicep → ARM JSON
az bicep build --file main.bicep                    # outputs main.json
az bicep build --file main.bicep --outfile out.json  # custom output path

# Decompile ARM JSON → Bicep
az bicep decompile --file azuredeploy.json          # outputs azuredeploy.bicep

# Lint a Bicep file (uses bicepconfig.json rules)
az bicep lint --file main.bicep

# Format a Bicep file
az bicep format --file main.bicep
az bicep format --file main.bicep --insert-final-newline

# Publish a Bicep module to an ACR
az bicep publish \
  --file module.bicep \
  --target br:myregistry.azurecr.io/bicep/modules/storage:v1.0

# Restore external modules referenced in a Bicep file
az bicep restore --file main.bicep

# Generate a parameter file from a Bicep file
az bicep generate-params --file main.bicep           # outputs main.bicepparam
az bicep generate-params --file main.bicep --output-format json  # JSON params
```

## Template Specs

Template specs store ARM/Bicep templates as Azure resources for versioned reuse:

```bash
# Create a template spec (with a version)
az ts create \
  --name <spec-name> \
  --resource-group <rg> \
  --version <version> \
  --template-file main.bicep

# List template specs
az ts list --resource-group <rg> -o table

# Show a specific version
az ts show \
  --name <spec-name> \
  --resource-group <rg> \
  --version <version>

# Update a template spec version
az ts update \
  --name <spec-name> \
  --resource-group <rg> \
  --version <version> \
  --template-file main.bicep

# Delete a template spec
az ts delete --name <spec-name> --resource-group <rg>

# Export a template spec version to a local file
az ts export \
  --name <spec-name> \
  --resource-group <rg> \
  --version <version> \
  --output-folder ./exported
```

Deploy from a template spec:

```bash
az deployment group create \
  --resource-group <rg> \
  --template-spec "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.Resources/templateSpecs/<name>/versions/<ver>"
```

## Common Workflows

### Deploy with Parameters

```bash
# Inline parameters
az deployment group create \
  --resource-group myRg \
  --template-file main.bicep \
  --parameters storageName=mystorage location=eastus

# Parameter file (JSON)
az deployment group create \
  --resource-group myRg \
  --template-file main.bicep \
  --parameters @params.json

# Bicep parameter file (.bicepparam)
az deployment group create \
  --resource-group myRg \
  --template-file main.bicep \
  --parameters params.bicepparam

# Mix: file + inline overrides
az deployment group create \
  --resource-group myRg \
  --template-file main.bicep \
  --parameters @params.json storageName=override
```

### What-If Preview Before Deploy

```bash
# 1. Validate
az deployment group validate \
  --resource-group myRg \
  --template-file main.bicep \
  --parameters @params.json

# 2. What-if
az deployment group what-if \
  --resource-group myRg \
  --template-file main.bicep \
  --parameters @params.json

# 3. Deploy (after reviewing what-if output)
az deployment group create \
  --resource-group myRg \
  --template-file main.bicep \
  --parameters @params.json
```

### Compile and Lint Bicep

```bash
# Lint first (catches errors and warnings)
az bicep lint --file main.bicep

# Then compile
az bicep build --file main.bicep

# Format for consistency
az bicep format --file main.bicep
```

## Gotchas

| Gotcha | Details |
|--------|---------|
| **Deployment mode: Complete vs Incremental** | Default is `Incremental` (adds/updates resources). `--mode Complete` **DELETES** any resource in the resource group that is **not** in the template. Always run `what-if` before using Complete mode. |
| **Parameter files vs inline** | Inline parameters override file parameters. Use `@` prefix for file references: `--parameters @params.json`. |
| **Bicep modules require restore** | If your Bicep file references external modules (ACR, template specs), run `az bicep restore --file main.bicep` before `az bicep build`. |
| **Deployment name auto-generation** | If `--name` is omitted, the CLI uses the template filename. Reusing names overwrites deployment history. Use unique names for audit trails. |
| **Deployment record ≠ resources** | `az deployment group delete` only removes the deployment metadata, not the deployed resources. |
| **Subscription/MG/Tenant scopes require `--location`** | The location specifies where deployment metadata is stored, not where resources are created. |
| **Template spec versioning** | Always specify `--version` when creating. Template specs without versions cannot be deployed directly. |

## Reference

- [ARM template deployment overview](https://learn.microsoft.com/azure/azure-resource-manager/templates/overview)
- [Bicep documentation](https://learn.microsoft.com/azure/azure-resource-manager/bicep/overview)
- [az deployment group](https://learn.microsoft.com/cli/azure/deployment/group)
- [az deployment sub](https://learn.microsoft.com/cli/azure/deployment/sub)
- [az deployment mg](https://learn.microsoft.com/cli/azure/deployment/mg)
- [az deployment tenant](https://learn.microsoft.com/cli/azure/deployment/tenant)
- [az bicep](https://learn.microsoft.com/cli/azure/bicep)
- [az ts (template specs)](https://learn.microsoft.com/cli/azure/ts)
- [What-if deployment](https://learn.microsoft.com/azure/azure-resource-manager/templates/deploy-what-if)
