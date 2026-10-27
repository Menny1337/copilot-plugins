
# Azure Security & Policy

## When to Use

Managing Azure security posture and policy compliance:
- Viewing and triaging Microsoft Defender for Cloud alerts and assessments
- Creating, assigning, and managing Azure Policy definitions and initiatives
- Checking compliance state across subscriptions and resource groups
- Creating remediation tasks for non-compliant resources
- Configuring security automations and auto-provisioning

## When to Skip

- **Identity & RBAC** — Role assignments, service principals, managed identities → `az-identity-rbac`
- **Key Vault** — Secrets, keys, certificates management → `az-keyvault`
- **NSG rules** — Network security groups, firewall rules → `az-networking`

## Prerequisites

Requires Foundations section in the az skill conventions (login, subscription selection, output formatting).

```bash
# Ensure security extension is registered
az provider register --namespace Microsoft.Security
az provider register --namespace Microsoft.PolicyInsights
```

## Defender for Cloud

### Alerts

```bash
# List active security alerts
az security alert list --query "[?status=='Active']" -o table

# Show alert details
az security alert show --name <alert-name> --location <location>

# Dismiss or activate an alert
az security alert update --name <alert-name> --location <location> --status Dismissed
```

### Assessments

```bash
# List security assessments
az security assessment list -o table

# Show a specific assessment
az security assessment show --name <assessment-name>
```

### Advanced Threat Protection

```bash
# Show ATP settings for a storage account
az security atp storage show --resource-group <rg> --storage-account <account>

# Enable ATP
az security atp storage update --resource-group <rg> --storage-account <account> --is-enabled true
```

### Auto-Provisioning

```bash
# List auto-provisioning settings
az security auto-provisioning-setting list

# Enable/disable auto-provisioning
az security auto-provisioning-setting update --name default --auto-provision On
```

### Automations

```bash
# List security automations
az security automation list

# Show automation details
az security automation show --name <name> --resource-group <rg>
```

## Policy Definitions

```bash
# List built-in definitions (filtered)
az policy definition list --query "[?policyType=='BuiltIn']" -o table

# Show a specific definition
az policy definition show --name <definition-name>

# Create a custom definition
az policy definition create \
  --name <name> \
  --display-name "<display-name>" \
  --rules @rules.json \
  --params @params.json \
  --mode All

# Update a custom definition
az policy definition update --name <name> --rules @rules-updated.json

# Delete a custom definition
az policy definition delete --name <name>
```

## Policy Initiatives

Initiatives (set-definitions) group multiple policy definitions together.

```bash
# List initiatives
az policy set-definition list -o table

# Show initiative details
az policy set-definition show --name <set-name>

# Create an initiative
az policy set-definition create \
  --name <name> \
  --display-name "<display-name>" \
  --definitions @definitions.json \
  --params @params.json

# Update an initiative
az policy set-definition update --name <name> --definitions @definitions-updated.json

# Delete an initiative
az policy set-definition delete --name <name>
```

## Policy Assignments

```bash
# List assignments for current subscription
az policy assignment list -o table

# List assignments for a resource group
az policy assignment list --resource-group <rg> -o table

# Show assignment details
az policy assignment show --name <assignment-name>

# Assign a policy definition
az policy assignment create \
  --name <assignment-name> \
  --policy <definition-name> \
  --scope "/subscriptions/<sub-id>" \
  --params '{"paramName": {"value": "paramValue"}}'

# Assign an initiative
az policy assignment create \
  --name <assignment-name> \
  --policy-set-definition <initiative-name> \
  --scope "/subscriptions/<sub-id>/resourceGroups/<rg>"

# Delete an assignment
az policy assignment delete --name <assignment-name>
```

## Policy Exemptions

```bash
# List exemptions
az policy exemption list -o table

# Show exemption details
az policy exemption show --name <exemption-name>

# Create a waiver exemption
az policy exemption create \
  --name <name> \
  --policy-assignment <assignment-id> \
  --exemption-category Waiver \
  --expires-on "2025-12-31"

# Create a mitigated exemption
az policy exemption create \
  --name <name> \
  --policy-assignment <assignment-id> \
  --exemption-category Mitigated

# Delete an exemption
az policy exemption delete --name <name>
```

## Compliance

```bash
# List non-compliant resources for current subscription
az policy state list --filter "complianceState eq 'NonCompliant'" -o table

# List compliance for a specific assignment
az policy state list --policy-assignment <assignment-name> -o table

# List compliance for a resource group
az policy state list --resource-group <rg> -o table

# List policy events (audit trail)
az policy event list --filter "timestamp ge 2025-01-01T00:00:00Z" -o table
```

## Remediation

```bash
# Create a remediation task for a policy assignment
az policy remediation create \
  --name <remediation-name> \
  --policy-assignment <assignment-id>

# Create remediation scoped to a resource group
az policy remediation create \
  --name <remediation-name> \
  --policy-assignment <assignment-id> \
  --resource-group <rg>

# List remediation tasks
az policy remediation list -o table

# Show remediation status
az policy remediation show --name <remediation-name>

# Delete a remediation task
az policy remediation delete --name <remediation-name>
```

## Gotchas

- **Policy evaluation delay** — After creating or updating assignments, compliance state can take up to 30 minutes to reflect changes. Use `az policy state trigger-scan` to force evaluation.
- **Exemptions vs exclusions** — Exemptions are temporary waivers on assignments; exclusions are `notScopes` on the assignment itself. Use exemptions for tracked exceptions with expiry dates.
- **Built-in vs custom policies** — Prefer built-in definitions when available; custom definitions require ongoing maintenance. Filter with `--query "[?policyType=='BuiltIn']"`.
- **Initiative = collection of policies** — An initiative (`set-definition`) bundles related policies. Assign initiatives rather than individual policies for manageability.
- **Scope hierarchy** — Assignments inherit down the scope tree (management group → subscription → resource group → resource). Higher-scope assignments cannot be overridden at lower scopes without exemptions.

## Reference

- [Microsoft Defender for Cloud CLI](https://learn.microsoft.com/cli/azure/security)
- [Azure Policy CLI](https://learn.microsoft.com/cli/azure/policy)
- [Azure Policy overview](https://learn.microsoft.com/azure/governance/policy/overview)
- [Policy compliance states](https://learn.microsoft.com/azure/governance/policy/how-to/get-compliance-data)
- [Remediation tasks](https://learn.microsoft.com/azure/governance/policy/how-to/remediate-resources)
