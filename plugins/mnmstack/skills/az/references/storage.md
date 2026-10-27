
# az-storage

Azure Storage management through the Azure CLI.

## When to Use

Use this skill when managing Azure Storage resources:

- **Blob storage** — upload, download, list, copy, batch operations
- **Storage accounts** — create, configure, manage keys, generate SAS tokens
- **File shares** — Azure Files for SMB/NFS access
- **Table storage** — NoSQL key-value store with entities
- **Queue storage** — message queuing between components
- **Data Lake Gen2** — hierarchical namespace filesystems

## When to Skip

- **Database storage** (Cosmos DB, SQL, PostgreSQL, MySQL) → use `az-databases` skill
- **Key Vault secrets** → use `az-keyvault` skill

## Prerequisites

Requires Azure CLI foundations. See the Foundations section in the az skill for login, subscription selection, and resource group conventions.

```bash
az login
az account set --subscription <sub>
```

## Storage Accounts

```bash
# Create a storage account
az storage account create \
  --name <account-name> \
  --resource-group <rg> \
  --location <region> \
  --sku Standard_LRS \
  --kind StorageV2

# List storage accounts
az storage account list --resource-group <rg> --output table

# Show details
az storage account show --name <account-name> --resource-group <rg>

# Update (e.g., enable HTTPS-only)
az storage account update --name <account-name> --https-only true

# Delete
az storage account delete --name <account-name> --resource-group <rg> --yes

# List access keys
az storage account keys list --account-name <account-name> --resource-group <rg>

# Renew a key
az storage account keys renew --account-name <account-name> --resource-group <rg> --key primary

# Generate account-level SAS token
az storage account generate-sas \
  --account-name <account-name> \
  --permissions rwdlacup \
  --services bfqt \
  --resource-types sco \
  --expiry "$(date -u -d '+1 hour' +%Y-%m-%dT%H:%MZ)" \
  --output tsv
```

## Auth Patterns

Every `az storage` command requires authentication. There is no global default — you must supply one of these four patterns on every call.

### Key-Based

```bash
az storage blob list \
  --account-name <account-name> \
  --account-key <account-key> \
  --container-name <container>
```

### Connection String

```bash
az storage blob list \
  --connection-string "DefaultEndpointsProtocol=https;AccountName=<n>;AccountKey=<k>;EndpointSuffix=core.windows.net" \
  --container-name <container>
```

### SAS Token

```bash
az storage blob list \
  --account-name <account-name> \
  --sas-token "<token>" \
  --container-name <container>
```

> **Important:** Always quote the SAS token — it contains `&` characters that the shell will interpret.

### Entra ID (RBAC)

```bash
az storage blob list \
  --account-name <account-name> \
  --auth-mode login \
  --container-name <container>
```

Requires the **Storage Blob Data Contributor** role (or equivalent) assigned to the signed-in identity.

## Blobs

```bash
# Upload a single blob
az storage blob upload \
  --account-name <account-name> --account-key <key> \
  --container-name <container> \
  --name <blob-name> \
  --file <local-path> \
  --overwrite

# Download a blob
az storage blob download \
  --account-name <account-name> --account-key <key> \
  --container-name <container> \
  --name <blob-name> \
  --file <local-path>

# List blobs
az storage blob list \
  --account-name <account-name> --account-key <key> \
  --container-name <container> \
  --output table

# Show blob properties
az storage blob show \
  --account-name <account-name> --account-key <key> \
  --container-name <container> \
  --name <blob-name>

# Delete a blob
az storage blob delete \
  --account-name <account-name> --account-key <key> \
  --container-name <container> \
  --name <blob-name>

# Copy a blob (server-side)
az storage blob copy start \
  --account-name <dest-account> --account-key <dest-key> \
  --destination-container <dest-container> \
  --destination-blob <dest-name> \
  --source-uri <source-blob-url>

# Batch upload (entire directory)
az storage blob upload-batch \
  --account-name <account-name> --account-key <key> \
  --destination <container> \
  --source <local-dir> \
  --pattern "*.csv" \
  --overwrite

# Batch download
az storage blob download-batch \
  --account-name <account-name> --account-key <key> \
  --source <container> \
  --destination <local-dir> \
  --pattern "logs/*"

# Generate blob-level SAS token
az storage blob generate-sas \
  --account-name <account-name> --account-key <key> \
  --container-name <container> \
  --name <blob-name> \
  --permissions r \
  --expiry "$(date -u -d '+1 hour' +%Y-%m-%dT%H:%MZ)" \
  --full-uri \
  --output tsv
```

## Containers

```bash
# Create a container
az storage container create \
  --account-name <account-name> --account-key <key> \
  --name <container>

# List containers
az storage container list \
  --account-name <account-name> --account-key <key> \
  --output table

# Show container properties
az storage container show \
  --account-name <account-name> --account-key <key> \
  --name <container>

# Delete a container
az storage container delete \
  --account-name <account-name> --account-key <key> \
  --name <container>

# Stored access policies
az storage container policy create \
  --account-name <account-name> --account-key <key> \
  --container-name <container> \
  --name <policy-name> \
  --permissions rl \
  --expiry "2025-12-31T00:00Z"

az storage container policy list \
  --account-name <account-name> --account-key <key> \
  --container-name <container>

az storage container policy show \
  --account-name <account-name> --account-key <key> \
  --container-name <container> \
  --name <policy-name>

az storage container policy delete \
  --account-name <account-name> --account-key <key> \
  --container-name <container> \
  --name <policy-name>
```

## File Shares

```bash
# Create a file share
az storage share create \
  --account-name <account-name> --account-key <key> \
  --name <share-name> \
  --quota 100

# List file shares
az storage share list \
  --account-name <account-name> --account-key <key> \
  --output table

# Show share properties
az storage share show \
  --account-name <account-name> --account-key <key> \
  --name <share-name>

# Update quota
az storage share update \
  --account-name <account-name> --account-key <key> \
  --name <share-name> \
  --quota 200

# Delete a share
az storage share delete \
  --account-name <account-name> --account-key <key> \
  --name <share-name>

# Upload a file
az storage file upload \
  --account-name <account-name> --account-key <key> \
  --share-name <share-name> \
  --source <local-path> \
  --path <remote-path>

# Download a file
az storage file download \
  --account-name <account-name> --account-key <key> \
  --share-name <share-name> \
  --path <remote-path> \
  --dest <local-path>

# List files
az storage file list \
  --account-name <account-name> --account-key <key> \
  --share-name <share-name> \
  --output table

# Delete a file
az storage file delete \
  --account-name <account-name> --account-key <key> \
  --share-name <share-name> \
  --path <remote-path>
```

## Table Storage

```bash
# Create a table
az storage table create \
  --account-name <account-name> --account-key <key> \
  --name <table-name>

# List tables
az storage table list \
  --account-name <account-name> --account-key <key> \
  --output table

# Delete a table
az storage table delete \
  --account-name <account-name> --account-key <key> \
  --name <table-name>

# Insert an entity
az storage entity insert \
  --account-name <account-name> --account-key <key> \
  --table-name <table-name> \
  --entity PartitionKey=<pk> RowKey=<rk> Name=<value> Status=<value>

# Show an entity
az storage entity show \
  --account-name <account-name> --account-key <key> \
  --table-name <table-name> \
  --partition-key <pk> \
  --row-key <rk>

# Query entities
az storage entity query \
  --account-name <account-name> --account-key <key> \
  --table-name <table-name> \
  --filter "PartitionKey eq '<pk>'" \
  --output table

# Replace an entity (full replace)
az storage entity replace \
  --account-name <account-name> --account-key <key> \
  --table-name <table-name> \
  --entity PartitionKey=<pk> RowKey=<rk> Name=<new-value> Status=<new-value>

# Merge an entity (partial update)
az storage entity merge \
  --account-name <account-name> --account-key <key> \
  --table-name <table-name> \
  --entity PartitionKey=<pk> RowKey=<rk> Status=<new-value>

# Delete an entity
az storage entity delete \
  --account-name <account-name> --account-key <key> \
  --table-name <table-name> \
  --partition-key <pk> \
  --row-key <rk>
```

## Queue Storage

```bash
# Create a queue
az storage queue create \
  --account-name <account-name> --account-key <key> \
  --name <queue-name>

# List queues
az storage queue list \
  --account-name <account-name> --account-key <key> \
  --output table

# Delete a queue
az storage queue delete \
  --account-name <account-name> --account-key <key> \
  --name <queue-name>

# Put a message
az storage message put \
  --account-name <account-name> --account-key <key> \
  --queue-name <queue-name> \
  --content "Hello, world!"

# Get messages (dequeues and makes invisible)
az storage message get \
  --account-name <account-name> --account-key <key> \
  --queue-name <queue-name>

# Peek messages (read without dequeuing)
az storage message peek \
  --account-name <account-name> --account-key <key> \
  --queue-name <queue-name> \
  --num-messages 5

# Update a message
az storage message update \
  --account-name <account-name> --account-key <key> \
  --queue-name <queue-name> \
  --id <message-id> \
  --pop-receipt <pop-receipt> \
  --content "Updated content" \
  --visibility-timeout 30

# Delete a message
az storage message delete \
  --account-name <account-name> --account-key <key> \
  --queue-name <queue-name> \
  --id <message-id> \
  --pop-receipt <pop-receipt>

# Clear all messages
az storage message clear \
  --account-name <account-name> --account-key <key> \
  --queue-name <queue-name>
```

## Data Lake Gen2

Requires a storage account with hierarchical namespace enabled.

```bash
# Create a filesystem
az storage fs create \
  --account-name <account-name> --account-key <key> \
  --name <filesystem-name>

# List filesystems
az storage fs list \
  --account-name <account-name> --account-key <key> \
  --output table

# Show filesystem properties
az storage fs show \
  --account-name <account-name> --account-key <key> \
  --name <filesystem-name>

# Delete a filesystem
az storage fs delete \
  --account-name <account-name> --account-key <key> \
  --name <filesystem-name> \
  --yes
```

## Utilities

### AzCopy Wrapper

```bash
# Copy between storage accounts or local ↔ remote
az storage copy \
  --source <source-url-or-path> \
  --destination <dest-url-or-path> \
  --recursive

# Remove blobs
az storage remove \
  --account-name <account-name> --account-key <key> \
  --container-name <container> \
  --name <blob-name>
```

### CORS Rules

```bash
# Add a CORS rule
az storage cors add \
  --account-name <account-name> --account-key <key> \
  --services b \
  --methods GET PUT \
  --origins "https://example.com" \
  --allowed-headers "*" \
  --exposed-headers "*" \
  --max-age 3600

# List CORS rules
az storage cors list \
  --account-name <account-name> --account-key <key> \
  --services b

# Clear all CORS rules
az storage cors clear \
  --account-name <account-name> --account-key <key> \
  --services b
```

## Gotchas

1. **Auth is required on every command** — There is no global default for storage auth. Every `az storage` call needs one of the four auth patterns (key, connection string, SAS, Entra ID).
2. **SAS tokens must be quoted** — SAS tokens contain `&` characters. Always wrap in quotes: `--sas-token "<token>"`. Unquoted tokens cause silent parameter truncation.
3. **Batch operations need `--pattern` for filtering** — Without `--pattern`, `upload-batch` and `download-batch` process all files. Use glob patterns like `"*.csv"` or `"logs/*"` to limit scope.
4. **`--auth-mode login` requires RBAC** — The signed-in identity needs the **Storage Blob Data Contributor** role (or equivalent). The generic Contributor role is not sufficient for data-plane operations.

## Reference

- [az storage account](https://learn.microsoft.com/cli/azure/storage/account)
- [az storage blob](https://learn.microsoft.com/cli/azure/storage/blob)
- [az storage container](https://learn.microsoft.com/cli/azure/storage/container)
- [az storage share / file](https://learn.microsoft.com/cli/azure/storage/share)
- [az storage table / entity](https://learn.microsoft.com/cli/azure/storage/table)
- [az storage queue / message](https://learn.microsoft.com/cli/azure/storage/queue)
- [az storage fs (Data Lake)](https://learn.microsoft.com/cli/azure/storage/fs)
- [az storage copy](https://learn.microsoft.com/cli/azure/storage#az-storage-copy)
- [az storage cors](https://learn.microsoft.com/cli/azure/storage/cors)
- [Authorize access with Azure CLI](https://learn.microsoft.com/azure/storage/blobs/authorize-data-operations-cli)
