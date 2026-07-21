
# Azure Resource Management

Manage Azure resource groups, generic resources, tags, locks, resource providers, VMs, and scale sets via the Azure CLI.

## When to Use

- Creating, listing, deleting, or exporting resource groups
- Tagging resources for cost tracking, environment labeling, or governance
- Applying locks (CanNotDelete, ReadOnly) to protect critical resources
- Registering resource providers when encountering "not registered" errors
- Moving resources between resource groups
- Creating and managing VMs or VM scale sets
- Performing generic resource CRUD operations by resource ID

## When to Skip

- **Storage accounts** — use the storage-specific skill (`az storage`)
- **Networking** (VNets, NSGs, load balancers) — use networking skill (`az network`)
- **AKS / Kubernetes** — use AKS skill
- **App Service / Functions** — use respective skills
- **Databases** (SQL, Cosmos, etc.) — use database-specific skills
- **Identity / RBAC** — use identity skill (`az role`, `az ad`)

If a resource type has its own dedicated skill, prefer that skill for type-specific commands. Use this skill for cross-cutting concerns (tagging, locking, moving, provider registration) that apply to any resource.

## Prerequisites

Requires Foundations section in the az skill knowledge — login, subscription selection, output formatting, and query basics should already be familiar.

```bash
# Confirm logged in and correct subscription
az account show --query "{sub:name, id:id}" -o table
```

## Resource Groups

Resource groups are the fundamental container for Azure resources.

```bash
# Create a resource group
az group create --name myRG --location eastus

# Create with tags
az group create --name myRG --location eastus --tags "env=prod" "team=platform"

# List all resource groups
az group list -o table

# List filtered by tag
az group list --tag env=prod -o table

# Show details of a specific group
az group show --name myRG

# Check if a group exists (returns true/false)
az group exists --name myRG

# Export resource group as ARM template (captures current state)
az group export --name myRG > myRG-template.json

# Delete a resource group (all resources inside are deleted)
az group delete --name myRG --yes --no-wait

# Resource group-level locks
az group lock create --name noDelete --resource-group myRG --lock-type CanNotDelete
az group lock list --resource-group myRG -o table
az group lock show --name noDelete --resource-group myRG
az group lock delete --name noDelete --resource-group myRG
```

## Generic Resources

Work with any Azure resource by ID or type, regardless of resource-specific CLI modules.

```bash
# List all resources in a resource group
az resource list --resource-group myRG -o table

# List resources filtered by type
az resource list --resource-group myRG --resource-type Microsoft.Compute/virtualMachines -o table

# Show a resource by its full ID
az resource show --ids /subscriptions/<sub>/resourceGroups/myRG/providers/Microsoft.Compute/virtualMachines/myVM

# Show by name and type
az resource show --name myVM --resource-group myRG --resource-type Microsoft.Compute/virtualMachines

# Create a generic resource (useful for resource types without dedicated CLI commands)
az resource create \
  --resource-group myRG \
  --resource-type Microsoft.SomeProvider/someType \
  --name myResource \
  --properties '{"key": "value"}'

# Update a resource property
az resource update --ids <resource-id> --set properties.someKey=newValue

# Delete a resource by ID
az resource delete --ids <resource-id>

# Move resources to a different resource group
az resource move \
  --ids <resource-id-1> <resource-id-2> \
  --destination-group targetRG

# Tag a resource by ID
az resource tag --ids <resource-id> --tags "env=prod" "owner=team-infra"

# Invoke an action on a resource (e.g., restart, list keys)
az resource invoke-action \
  --ids <resource-id> \
  --action listKeys
```

## Tags

Tags are key-value pairs for organizing, filtering, and cost tracking.

```bash
# Apply tags to a resource (replaces all existing tags)
az tag create --resource-id <resource-id> --tags "k1=v1" "k2=v2"

# List tags on a resource
az tag list --resource-id <resource-id>

# Merge tags (add without removing existing)
az tag update --resource-id <resource-id> --operation merge --tags "newKey=newVal"

# Replace all tags
az tag update --resource-id <resource-id> --operation replace --tags "k1=v1"

# Delete specific tags
az tag update --resource-id <resource-id> --operation delete --tags "oldKey"

# Delete all tags from a resource
az tag delete --resource-id <resource-id> --yes

# List all tag names in a subscription
az tag list -o table
```

## Locks

Locks prevent accidental deletion or modification of critical resources.

```bash
# Create a CanNotDelete lock (prevents deletion but allows modification)
az lock create \
  --name noDelete \
  --resource-group myRG \
  --lock-type CanNotDelete \
  --notes "Protected production resource"

# Create a ReadOnly lock (prevents any modification or deletion)
az lock create \
  --name readOnly \
  --resource-group myRG \
  --lock-type ReadOnly

# Lock a specific resource
az lock create \
  --name noDelete \
  --resource-group myRG \
  --resource-name myVM \
  --resource-type Microsoft.Compute/virtualMachines \
  --lock-type CanNotDelete

# List all locks in a resource group
az lock list --resource-group myRG -o table

# Show a specific lock
az lock show --name noDelete --resource-group myRG

# Update a lock
az lock update --name noDelete --resource-group myRG --notes "Updated reason"

# Delete a lock (required before deleting a locked resource)
az lock delete --name noDelete --resource-group myRG
```

## Providers

Resource providers must be registered before you can use their resource types.

```bash
# List all registered providers
az provider list --query "[?registrationState=='Registered']" -o table

# Show a specific provider and its resource types
az provider show --namespace Microsoft.Compute -o table

# Register a provider (needed when you get "not registered" errors)
az provider register --namespace Microsoft.ContainerService

# Wait for registration to complete
az provider register --namespace Microsoft.ContainerService --wait

# List resource types for a provider
az provider show --namespace Microsoft.Compute --query "resourceTypes[].resourceType" -o tsv
```

## VMs

Practical virtual machine management with the most commonly used commands.

```bash
# Create a VM (Linux, with defaults)
az vm create \
  --resource-group myRG \
  --name myVM \
  --image Ubuntu2204 \
  --admin-username azureuser \
  --generate-ssh-keys

# Create a Windows VM
az vm create \
  --resource-group myRG \
  --name myWinVM \
  --image Win2022Datacenter \
  --admin-username azureuser \
  --admin-password '<password>'

# Create with specific size and custom options
az vm create \
  --resource-group myRG \
  --name myVM \
  --image Ubuntu2204 \
  --size Standard_D2s_v3 \
  --vnet-name myVNet \
  --subnet mySubnet \
  --nsg myNSG \
  --public-ip-address "" \
  --tags "env=dev"

# List VMs
az vm list -o table
az vm list --resource-group myRG -o table

# Show VM details
az vm show --resource-group myRG --name myVM
az vm show --resource-group myRG --name myVM --show-details  # includes IP, power state

# Power management
az vm start --resource-group myRG --name myVM
az vm stop --resource-group myRG --name myVM          # stops but keeps allocation (still billed)
az vm deallocate --resource-group myRG --name myVM    # deallocates (no compute charges)
az vm restart --resource-group myRG --name myVM

# Resize a VM
az vm resize --resource-group myRG --name myVM --size Standard_D4s_v3

# List available sizes for a VM
az vm list-sizes --location eastus -o table
az vm list-vm-resize-options --resource-group myRG --name myVM -o table

# Run a command inside a VM
az vm run-command invoke \
  --resource-group myRG \
  --name myVM \
  --command-id RunShellScript \
  --scripts "hostname && uname -a"

# Open a port
az vm open-port --resource-group myRG --name myVM --port 80

# Get IP addresses
az vm list-ip-addresses --resource-group myRG --name myVM -o table

# List available images
az vm image list --output table                          # common images
az vm image list --all --publisher Canonical -o table     # all from a publisher
az vm image list-skus --location eastus --publisher Canonical --offer 0001-com-ubuntu-server-jammy -o table

# Managed identity
az vm identity assign --resource-group myRG --name myVM
az vm identity show --resource-group myRG --name myVM

# Extensions
az vm extension list --resource-group myRG --vm-name myVM -o table
az vm extension set \
  --resource-group myRG \
  --vm-name myVM \
  --name customScript \
  --publisher Microsoft.Azure.Extensions \
  --settings '{"commandToExecute": "echo hello"}'

# Boot diagnostics
az vm boot-diagnostics enable --resource-group myRG --name myVM
az vm boot-diagnostics get-boot-log --resource-group myRG --name myVM

# Delete a VM
az vm delete --resource-group myRG --name myVM --yes
```

## VMSS

VM Scale Sets manage groups of identical VMs with autoscaling.

```bash
# Create a scale set
az vmss create \
  --resource-group myRG \
  --name myScaleSet \
  --image Ubuntu2204 \
  --upgrade-policy-mode automatic \
  --admin-username azureuser \
  --generate-ssh-keys \
  --instance-count 2

# List scale sets
az vmss list --resource-group myRG -o table

# Show details
az vmss show --resource-group myRG --name myScaleSet

# Scale manually
az vmss scale --resource-group myRG --name myScaleSet --new-capacity 5

# List instances
az vmss list-instances --resource-group myRG --name myScaleSet -o table

# Update all instances after config change
az vmss update-instances --resource-group myRG --name myScaleSet --instance-ids "*"

# Delete
az vmss delete --resource-group myRG --name myScaleSet --yes
```

## Gotchas

- **`az group delete --yes --no-wait`** — Always use `--no-wait` to avoid blocking your terminal; group deletion can take minutes. Use `--yes` to skip the confirmation prompt.
- **Locks prevent deletion even by owners** — A `CanNotDelete` lock must be explicitly removed before the resource or group can be deleted. `ReadOnly` locks prevent any changes at all, including tag updates.
- **Provider registration is per-subscription** — If you switch subscriptions, you may need to register providers again. Registration can take a few minutes.
- **`az group export` captures current state** — The exported ARM template reflects what's deployed now, not the original deployment template. It may need cleanup before reuse.
- **`az vm stop` vs `az vm deallocate`** — `stop` keeps the VM allocated (you're still billed for compute). Use `deallocate` to stop billing.
- **Resource moves have limitations** — Not all resource types support moves between groups. Check `az resource move` docs for type-specific constraints.
- **Tags have limits** — Max 50 tags per resource, key max 512 chars, value max 256 chars.

## Reference

- [Resource groups](https://learn.microsoft.com/en-us/cli/azure/group)
- [Generic resources](https://learn.microsoft.com/en-us/cli/azure/resource)
- [Tags](https://learn.microsoft.com/en-us/cli/azure/tag)
- [Locks](https://learn.microsoft.com/en-us/cli/azure/lock)
- [Resource providers](https://learn.microsoft.com/en-us/cli/azure/provider)
- [Virtual machines](https://learn.microsoft.com/en-us/cli/azure/vm)
- [VM scale sets](https://learn.microsoft.com/en-us/cli/azure/vmss)
- [Move resources](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-resource-group-and-subscription)
