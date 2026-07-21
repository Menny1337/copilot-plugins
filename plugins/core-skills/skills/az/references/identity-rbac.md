
# Azure Identity & RBAC Skill

Manage Azure identity resources and role-based access control via `az` CLI.

## When to Use

- Creating or managing **app registrations** and **service principals** in Microsoft Entra ID (Azure AD)
- Assigning or auditing **RBAC roles** (Owner, Contributor, Reader, custom) at any scope
- Managing **users and groups** in Entra ID
- Setting up **managed identities** (system-assigned or user-assigned)
- Configuring **workload identity federation** (e.g., for GitHub Actions OIDC)
- Rotating or managing **credentials** on apps and service principals

## When to Skip

- **Azure DevOps permissions** (org/project/repo-level access) → use `devops-admin.md` reference
- **Key Vault access policies or RBAC** → use `az-keyvault`
- **General Azure resource provisioning** unrelated to identity → use the appropriate resource skill

## Prerequisites

Requires `az` CLI authenticated with sufficient privileges. See Foundations section (az skill) for login, subscription selection, and output formatting conventions.

```bash
az login
az account set --subscription <subscription-id>
```

The signed-in principal needs **User Access Administrator** or **Owner** to create role assignments, and **Application Administrator** or **Global Administrator** for Entra ID app/SP operations.


## Entra ID App Registrations

App registrations define the identity of an application in Entra ID.

```bash
# List all app registrations (filtered)
az ad app list --display-name "my-app" --output table

# Show a specific app by Application (client) ID
az ad app show --id <app-id>

# Create an app registration
az ad app create --display-name "my-app"

# Update an app registration
az ad app update --id <app-id> --set displayName="my-app-v2"

# Delete an app registration
az ad app delete --id <app-id>
```

### App Credentials

```bash
# List credentials for an app
az ad app credential list --id <app-id>

# Reset (rotate) a client secret — returns the new secret value (show once!)
az ad app credential reset --id <app-id> --display-name "ci-secret" --years 1

# Delete a specific credential by key ID
az ad app credential delete --id <app-id> --key-id <key-id>
```

> **Tip:** `--id` accepts either the Application (client) ID or the Object ID.


## Service Principals

A service principal is the local representation of an app registration in a tenant, used for authentication and RBAC.

```bash
# List service principals
az ad sp list --display-name "my-app" --output table

# Show a service principal by app ID or object ID
az ad sp show --id <app-or-object-id>

# Create an SP from an existing app registration
az ad sp create --id <app-id>

# Delete a service principal
az ad sp delete --id <object-id>
```

### SP Credentials

```bash
# List SP credentials
az ad sp credential list --id <sp-object-id>

# Reset SP credentials
az ad sp credential reset --id <sp-object-id> --display-name "deploy-key" --years 1

# Delete a specific SP credential
az ad sp credential delete --id <sp-object-id> --key-id <key-id>
```

### One-Liner: Create SP with RBAC

The most common pattern — creates an app registration, service principal, and role assignment in one command:

```bash
az ad sp create-for-rbac \
  --name "my-deploy-sp" \
  --role Contributor \
  --scopes /subscriptions/<subscription-id>
```

This outputs `appId`, `password` (client secret), and `tenant`. The secret is shown **once** — capture it immediately.

Scope down to a resource group:

```bash
az ad sp create-for-rbac \
  --name "my-rg-sp" \
  --role Contributor \
  --scopes /subscriptions/<sub-id>/resourceGroups/<rg-name>
```


## Users & Groups

### Users

```bash
# List users (supports --filter OData expressions)
az ad user list --output table
az ad user list --filter "startswith(displayName,'the user')"

# Show a specific user
az ad user show --id <user-principal-name-or-object-id>

# Show the currently signed-in user
az ad signed-in-user show

# Create a user
az ad user create \
  --display-name "Jane Doe" \
  --user-principal-name jane@contoso.com \
  --password <initial-password>

# Update a user
az ad user update --id <user-id> --set jobTitle="Engineer"

# Delete a user
az ad user delete --id <user-id>
```

### Groups

```bash
# List groups
az ad group list --display-name "SRE Team" --output table

# Show a group
az ad group show --group "SRE Team"

# Create a security group
az ad group create --display-name "SRE Team" --mail-nickname "sre-team"

# Delete a group
az ad group delete --group <group-object-id>
```

### Group Membership

```bash
# Add a member (user, SP, or managed identity) to a group
az ad group member add --group <group-id> --member-id <member-object-id>

# List members
az ad group member list --group <group-id> --output table

# Remove a member
az ad group member remove --group <group-id> --member-id <member-object-id>

# Check membership
az ad group member check --group <group-id> --member-id <member-object-id>
```


## RBAC Role Assignments

Role assignments bind a **principal** (user, group, SP, managed identity) to a **role** at a **scope**.

### Common Built-in Roles

| Role                        | Description                                      |
|-----------------------------|--------------------------------------------------|
| **Owner**                   | Full access + can assign roles to others         |
| **Contributor**             | Full access except role assignment               |
| **Reader**                  | Read-only access                                 |
| **User Access Administrator** | Manage role assignments only                   |

### Scope Hierarchy

Assignments inherit downward:

```
Management Group
  └── Subscription:  /subscriptions/<sub-id>
        └── Resource Group:  /subscriptions/<sub-id>/resourceGroups/<rg>
              └── Resource:  /subscriptions/<sub-id>/resourceGroups/<rg>/providers/<provider>/<type>/<name>
```

### Commands

```bash
# List role assignments at a scope
az role assignment list --scope /subscriptions/<sub-id> --output table
az role assignment list --assignee <principal-id> --output table

# Create a role assignment
az role assignment create \
  --assignee <principal-id> \
  --role "Contributor" \
  --scope /subscriptions/<sub-id>/resourceGroups/<rg-name>

# Assign by principal name (UPN or SP app ID)
az role assignment create \
  --assignee "jane@contoso.com" \
  --role "Reader" \
  --scope /subscriptions/<sub-id>

# Delete a role assignment
az role assignment delete \
  --assignee <principal-id> \
  --role "Contributor" \
  --scope /subscriptions/<sub-id>/resourceGroups/<rg-name>
```


## Custom Roles

Define roles with fine-grained permissions when built-in roles don't fit.

```bash
# List custom role definitions
az role definition list --custom-role-only true --output table

# Show a specific role definition
az role definition list --name "My Custom Role"

# Create a custom role from JSON
az role definition create --role-definition '{
  "Name": "VM Restart Operator",
  "Description": "Can restart VMs but nothing else",
  "Actions": [
    "Microsoft.Compute/virtualMachines/restart/action",
    "Microsoft.Compute/virtualMachines/read"
  ],
  "NotActions": [],
  "AssignableScopes": ["/subscriptions/<sub-id>"]
}'

# Update a custom role
az role definition update --role-definition @updated-role.json

# Delete a custom role
az role definition delete --name "VM Restart Operator"
```


## Managed Identities

Managed identities eliminate the need for credentials in code. Azure manages the lifecycle.

### User-Assigned Managed Identity

```bash
# Create a user-assigned managed identity
az identity create \
  --name "my-app-identity" \
  --resource-group <rg-name>

# List managed identities in a resource group
az identity list --resource-group <rg-name> --output table

# Show a managed identity (get principal ID and client ID)
az identity show \
  --name "my-app-identity" \
  --resource-group <rg-name>
```

### Federated Credentials (Workload Identity Federation)

Used for keyless authentication from external identity providers (GitHub Actions, Kubernetes, etc.).

```bash
# Create a federated credential for GitHub Actions
az identity federated-credential create \
  --name "github-deploy" \
  --identity-name "my-app-identity" \
  --resource-group <rg-name> \
  --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:my-org/my-repo:ref:refs/heads/main" \
  --audiences "api://AzureADTokenExchange"

# List federated credentials
az identity federated-credential list \
  --identity-name "my-app-identity" \
  --resource-group <rg-name>

# Show a specific federated credential
az identity federated-credential show \
  --name "github-deploy" \
  --identity-name "my-app-identity" \
  --resource-group <rg-name>

# Delete a federated credential
az identity federated-credential delete \
  --name "github-deploy" \
  --identity-name "my-app-identity" \
  --resource-group <rg-name>
```


## Common Workflows

### 1. Create App Registration + SP with Scoped RBAC

```bash
# One command does it all
az ad sp create-for-rbac \
  --name "ci-deploy-sp" \
  --role Contributor \
  --scopes /subscriptions/<sub-id>/resourceGroups/my-rg

# Capture the output — appId, password, tenant
```

### 2. Assign Role to a Managed Identity

```bash
# Get the principal ID of the managed identity
PRINCIPAL_ID=$(az identity show \
  --name "my-app-identity" \
  --resource-group my-rg \
  --query principalId -o tsv)

# Assign a role
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Storage Blob Data Contributor" \
  --scope /subscriptions/<sub-id>/resourceGroups/my-rg
```

### 3. Federated Credentials for GitHub Actions (Keyless)

```bash
# Step 1: Create a user-assigned managed identity
az identity create --name "github-ci" --resource-group my-rg

# Step 2: Add federated credential for the repo + branch
az identity federated-credential create \
  --name "main-branch" \
  --identity-name "github-ci" \
  --resource-group my-rg \
  --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:my-org/my-repo:ref:refs/heads/main" \
  --audiences "api://AzureADTokenExchange"

# Step 3: Grant RBAC to the identity
PRINCIPAL_ID=$(az identity show --name "github-ci" --resource-group my-rg --query principalId -o tsv)
CLIENT_ID=$(az identity show --name "github-ci" --resource-group my-rg --query clientId -o tsv)

az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role Contributor \
  --scope /subscriptions/<sub-id>/resourceGroups/my-rg

# Step 4: In GitHub Actions workflow, use:
#   azure/login@v2 with:
#     client-id: $CLIENT_ID
#     tenant-id: <tenant-id>
#     subscription-id: <sub-id>
```


## Gotchas

1. **App ID vs Object ID** — App registrations and service principals each have their own Object ID. The Application (client) ID is shared. Most `az ad app` commands accept either; most `az role assignment` commands need the SP's Object ID (principal ID).

2. **`az ad sp create-for-rbac` auto-creates an app** — It creates both the app registration and the service principal. You don't need to run `az ad app create` first.

3. **Role assignment propagation delay** — After `az role assignment create`, it can take **up to 5 minutes** for the assignment to propagate. If a subsequent operation gets a 403, wait and retry.

4. **Scope format matters** — Scopes must be exact resource IDs. A common mistake is forgetting the `/subscriptions/` prefix or misspelling `resourceGroups` (capital G).

5. **Deleting an app deletes its SP** — `az ad app delete` removes the app registration and its associated service principal. Use `az ad sp delete` to remove only the SP.

6. **Managed identity principal ID vs client ID** — `principalId` is used for RBAC assignments; `clientId` is used for application authentication (e.g., in GitHub Actions federated login).


## Reference

- [App registrations](https://learn.microsoft.com/en-us/cli/azure/ad/app)
- [Service principals](https://learn.microsoft.com/en-us/cli/azure/ad/sp)
- [RBAC role assignments](https://learn.microsoft.com/en-us/cli/azure/role/assignment)
- [Custom role definitions](https://learn.microsoft.com/en-us/cli/azure/role/definition)
- [Managed identities](https://learn.microsoft.com/en-us/cli/azure/identity)
- [Federated credentials](https://learn.microsoft.com/en-us/cli/azure/identity/federated-credential)
- [Workload identity federation for GitHub Actions](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust)
- [Azure built-in roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles)
