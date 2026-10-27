
# Azure Key Vault Management

## When to Use

- Managing secrets, keys, or certificates in Azure Key Vault
- Rotating or auditing secrets and encryption keys
- Setting up access policies or RBAC for vault resources
- Configuring network restrictions on vaults
- Importing or exporting certificates and keys

## When to Skip

- **App configuration values** — use Azure App Configuration (`az appconfig`) instead
- **Environment variables only** — if secrets never leave the deployment environment and no vault is needed
- **Managed identity token access** — handled automatically by Azure SDK, no vault CLI needed

## Prerequisites

Requires the Foundations section in the az skill context (login, subscription selection, resource group conventions).

```bash
az login
az account set --subscription <sub>
```

## Vault Lifecycle

```bash
# Create a vault (soft-delete is enabled by default)
az keyvault create \
  --name <vault-name> \
  --resource-group <rg> \
  --location <region> \
  --sku standard \
  --enable-purge-protection true

# List vaults in a resource group
az keyvault list --resource-group <rg> -o table

# Show vault details
az keyvault show --name <vault-name>

# Delete a vault (soft-deleted, recoverable)
az keyvault delete --name <vault-name> --resource-group <rg>

# List soft-deleted vaults
az keyvault list-deleted -o table

# Recover a soft-deleted vault
az keyvault recover --name <vault-name>

# Purge a soft-deleted vault (permanent — requires purge protection to be off or retention expired)
az keyvault purge --name <vault-name>
```

**Soft-delete behavior:** Since 2021, soft-delete is mandatory on all new vaults with a default retention of 90 days. Deleted vaults occupy the name for the retention period — you cannot reuse the name until purged or recovered.

## Secrets

```bash
# Set a secret
az keyvault secret set --vault-name <vault> --name <secret-name> --value "<value>"

# Set from file
az keyvault secret set --vault-name <vault> --name <secret-name> --file <path> --encoding utf-8

# List secrets
az keyvault secret list --vault-name <vault> -o table

# Show current version
az keyvault secret show --vault-name <vault> --name <secret-name>

# Show specific version
az keyvault secret show --vault-name <vault> --name <secret-name> --version <version-id>

# List all versions of a secret
az keyvault secret list-versions --vault-name <vault> --name <secret-name> -o table

# Download secret to file
az keyvault secret download --vault-name <vault> --name <secret-name> --file <path>

# Delete a secret (soft-delete)
az keyvault secret delete --vault-name <vault> --name <secret-name>

# Recover a deleted secret
az keyvault secret recover --vault-name <vault> --name <secret-name>

# Purge a deleted secret (permanent)
az keyvault secret purge --vault-name <vault> --name <secret-name>

# Set expiry and content type
az keyvault secret set --vault-name <vault> --name <secret-name> --value "<value>" \
  --expires "2025-12-31T23:59:59Z" \
  --content-type "application/json"
```

## Keys

```bash
# Create a key (RSA 2048 by default)
az keyvault key create --vault-name <vault> --name <key-name> --kty RSA --size 2048

# Create an EC key
az keyvault key create --vault-name <vault> --name <key-name> --kty EC --curve P-256

# List keys
az keyvault key list --vault-name <vault> -o table

# Show key details
az keyvault key show --vault-name <vault> --name <key-name>

# Import a key from PEM
az keyvault key import --vault-name <vault> --name <key-name> --pem-file <path>

# Delete a key
az keyvault key delete --vault-name <vault> --name <key-name>

# Backup a key to file
az keyvault key backup --vault-name <vault> --name <key-name> --file <backup-path>

# Restore a key from backup
az keyvault key restore --vault-name <vault> --file <backup-path>
```

### Cryptographic Operations

```bash
# Encrypt data (base64-encoded plaintext)
az keyvault key encrypt \
  --vault-name <vault> --name <key-name> \
  --algorithm RSA-OAEP \
  --value <base64-plaintext>

# Decrypt data
az keyvault key decrypt \
  --vault-name <vault> --name <key-name> \
  --algorithm RSA-OAEP \
  --value <base64-ciphertext>

# Sign a digest
az keyvault key sign \
  --vault-name <vault> --name <key-name> \
  --algorithm RS256 \
  --digest <base64-digest>

# Verify a signature
az keyvault key verify \
  --vault-name <vault> --name <key-name> \
  --algorithm RS256 \
  --digest <base64-digest> \
  --signature <base64-signature>

# Wrap a key
az keyvault key wrap \
  --vault-name <vault> --name <key-name> \
  --algorithm RSA-OAEP \
  --value <base64-key-to-wrap>

# Unwrap a key
az keyvault key unwrap \
  --vault-name <vault> --name <key-name> \
  --algorithm RSA-OAEP \
  --value <base64-wrapped-key>
```

## Certificates

```bash
# Create a self-signed certificate
az keyvault certificate create \
  --vault-name <vault> --name <cert-name> \
  --policy "$(az keyvault certificate get-default-policy)"

# Create with custom policy (JSON file)
az keyvault certificate create \
  --vault-name <vault> --name <cert-name> \
  --policy @cert-policy.json

# List certificates
az keyvault certificate list --vault-name <vault> -o table

# Show certificate details
az keyvault certificate show --vault-name <vault> --name <cert-name>

# Import a PFX certificate
az keyvault certificate import \
  --vault-name <vault> --name <cert-name> \
  --file <path.pfx> --password <pfx-password>

# Import a PEM certificate
az keyvault certificate import \
  --vault-name <vault> --name <cert-name> \
  --file <path.pem>

# Download certificate (PEM format)
az keyvault certificate download \
  --vault-name <vault> --name <cert-name> \
  --file <output.pem> --encoding PEM

# Delete a certificate
az keyvault certificate delete --vault-name <vault> --name <cert-name>
```

### Certificate Issuers

```bash
# Create an issuer (e.g., DigiCert)
az keyvault certificate issuer create \
  --vault-name <vault> --issuer-name DigiCert \
  --provider-name DigiCert \
  --account-id <account> --password <api-key>

# List issuers
az keyvault certificate issuer list --vault-name <vault> -o table

# Show issuer details
az keyvault certificate issuer show --vault-name <vault> --issuer-name DigiCert

# Update issuer
az keyvault certificate issuer update \
  --vault-name <vault> --issuer-name DigiCert \
  --account-id <new-account>

# Delete issuer
az keyvault certificate issuer delete --vault-name <vault> --issuer-name DigiCert
```

## Access Models

Azure Key Vault supports two mutually exclusive access models. **You cannot mix them on the same vault.**

### Access Policy (Legacy)

The original model — policies are set directly on the vault resource.

```bash
# Grant secret read access to a service principal
az keyvault set-policy \
  --name <vault> \
  --object-id <sp-object-id> \
  --secret-permissions get list

# Grant key and certificate permissions
az keyvault set-policy \
  --name <vault> \
  --object-id <sp-object-id> \
  --key-permissions get list encrypt decrypt \
  --certificate-permissions get list create

# Remove a policy
az keyvault delete-policy --name <vault> --object-id <sp-object-id>

# List current policies
az keyvault show --name <vault> --query "properties.accessPolicies"
```

### RBAC (Recommended)

Uses Azure RBAC role assignments — preferred for consistency with other Azure resources.

```bash
# Enable RBAC on vault creation
az keyvault create \
  --name <vault> --resource-group <rg> --location <region> \
  --enable-rbac-authorization true

# Switch existing vault to RBAC
az keyvault update --name <vault> --enable-rbac-authorization true

# Assign Key Vault Secrets User role
az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee <principal-id> \
  --scope "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<vault>"

# Assign Key Vault Crypto User role
az role assignment create \
  --role "Key Vault Crypto User" \
  --assignee <principal-id> \
  --scope "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<vault>"

# Assign Key Vault Certificates Officer role
az role assignment create \
  --role "Key Vault Certificates Officer" \
  --assignee <principal-id> \
  --scope "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<vault>"
```

**Common Key Vault RBAC roles:**

| Role | Scope |
|------|-------|
| Key Vault Administrator | Full management of all vault objects |
| Key Vault Secrets Officer | Full management of secrets |
| Key Vault Secrets User | Read secrets |
| Key Vault Crypto Officer | Full management of keys |
| Key Vault Crypto User | Crypto operations with keys |
| Key Vault Certificates Officer | Full management of certificates |
| Key Vault Reader | Read vault metadata (not secret values) |

## Network ACLs

```bash
# Set default action to deny
az keyvault update --name <vault> --default-action Deny

# Allow a virtual network subnet
az keyvault network-rule add \
  --name <vault> \
  --subnet "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Network/virtualNetworks/<vnet>/subnets/<subnet>"

# Allow a specific IP
az keyvault network-rule add --name <vault> --ip-address <ip>/32

# List network rules
az keyvault network-rule list --name <vault>

# Remove a rule
az keyvault network-rule remove --name <vault> --ip-address <ip>/32

# Allow trusted Azure services to bypass
az keyvault update --name <vault> --bypass AzureServices
```

## HSM Operations

For backup and restore of entire vaults (requires Managed HSM or premium features):

```bash
# Start a full vault backup (to storage account)
az keyvault backup start \
  --hsm-name <managed-hsm> \
  --storage-account-name <storage> \
  --blob-container-name <container> \
  --storage-container-SAS-token "<sas-token>"

# Restore from backup
az keyvault restore start \
  --hsm-name <managed-hsm> \
  --storage-account-name <storage> \
  --blob-container-name <container> \
  --storage-container-SAS-token "<sas-token>" \
  --backup-folder <folder-name>
```

## Gotchas

1. **Soft-delete is mandatory** — All vaults created since Feb 2025 have soft-delete enabled with a 7–90 day retention (default 90). You cannot immediately reuse a deleted vault's name.
2. **Purge protection prevents permanent deletion** — Once enabled, it cannot be disabled. Secrets/keys/certs cannot be permanently deleted until the retention period expires.
3. **Access policy and RBAC are mutually exclusive** — Enabling RBAC on a vault disables all access policies. Plan your model before creating the vault.
4. **Secret versions are immutable** — Setting a secret creates a new version. Old versions remain accessible by version ID until explicitly disabled or the secret is deleted.
5. **Name uniqueness is global** — Vault names must be globally unique across all of Azure (they become `<name>.vault.azure.net`).
6. **Network ACL lockout** — Setting default action to `Deny` without adding your IP can lock you out. Always add your IP or use `--bypass AzureServices` first.
7. **Certificate private keys are stored as secrets** — When you import a cert, the private key is accessible via `az keyvault secret show` using the same name.

## Reference

- [Key Vault CLI reference](https://learn.microsoft.com/en-us/cli/azure/keyvault)
- [Key Vault best practices](https://learn.microsoft.com/en-us/azure/key-vault/general/best-practices)
- [RBAC for Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide)
- [Soft-delete overview](https://learn.microsoft.com/en-us/azure/key-vault/general/soft-delete-overview)
- [Network security](https://learn.microsoft.com/en-us/azure/key-vault/general/network-security)
- [Certificate management](https://learn.microsoft.com/en-us/azure/key-vault/certificates/overview)
