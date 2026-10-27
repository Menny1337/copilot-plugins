
# az-aks — Azure Kubernetes Service & Container Registry

## When to Use

Managing AKS clusters or Azure Container Registry via the CLI — cluster lifecycle, node pools, scaling, upgrades, addons, service mesh, container image builds, and registry operations.

## When to Skip

- **Container Apps** → use `az-containerapp` skill
- **Container Instances** (simple single-container workloads) → `az container` directly
- **App deployment** (App Service, Functions) → use `az-webapp-functions` skill

## Prerequisites

- See **Foundations** section in the az skill for authentication, subscription, and resource group basics.
- Install kubectl and kubelogin:
  ```bash
  az aks install-cli
  ```

## AKS Cluster Lifecycle

```bash
# Create a cluster
az aks create --name <n> --resource-group <rg> --node-count 3 --generate-ssh-keys

# List / show / delete
az aks list -o table
az aks show --name <n> --resource-group <rg>
az aks delete --name <n> --resource-group <rg> --yes --no-wait

# Start / stop (deallocate to save costs)
az aks start --name <n> --resource-group <rg>
az aks stop  --name <n> --resource-group <rg>

# Get kubeconfig credentials
az aks get-credentials --name <n> --resource-group <rg>
```

## Node Pools

```bash
az aks nodepool add    --cluster-name <c> --resource-group <rg> --name <pool> --node-count 3
az aks nodepool list   --cluster-name <c> --resource-group <rg> -o table
az aks nodepool show   --cluster-name <c> --resource-group <rg> --name <pool>
az aks nodepool update --cluster-name <c> --resource-group <rg> --name <pool> --enable-cluster-autoscaler --min-count 1 --max-count 5
az aks nodepool scale  --cluster-name <c> --resource-group <rg> --name <pool> --node-count 5
az aks nodepool upgrade --cluster-name <c> --resource-group <rg> --name <pool> --kubernetes-version <v>
az aks nodepool delete --cluster-name <c> --resource-group <rg> --name <pool>
```

## Scaling & Upgrades

```bash
# Scale the default node pool
az aks scale --name <n> --resource-group <rg> --node-count 5

# Check available upgrades and versions
az aks get-upgrades --name <n> --resource-group <rg> -o table
az aks get-versions --location <loc> -o table

# Upgrade cluster control plane + node pools
az aks upgrade --name <n> --resource-group <rg> --kubernetes-version <v>
```

## Cluster Operations

```bash
# Addons (monitoring, azure-policy, ingress-appgw, etc.)
az aks enable-addons  --name <n> --resource-group <rg> --addons monitoring
az aks disable-addons --name <n> --resource-group <rg> --addons monitoring

# Open Kubernetes dashboard
az aks browse --name <n> --resource-group <rg>

# Verify ACR integration
az aks check-acr --name <n> --resource-group <rg> --acr <name>

# Run a command on the cluster without local kubectl
az aks command invoke --name <n> --resource-group <rg> --command "kubectl get pods -A"

# Rotate certificates
az aks rotate-certs --name <n> --resource-group <rg>

# Maintenance windows
az aks maintenanceconfiguration add --cluster-name <n> --resource-group <rg> --name default \
  --weekday Monday --start-hour 1

# Service mesh (Istio-based)
az aks mesh enable  --name <n> --resource-group <rg>
az aks mesh disable --name <n> --resource-group <rg>
```

## ACR Lifecycle

```bash
# Create a registry (Basic, Standard, or Premium SKU)
az acr create --name <n> --resource-group <rg> --sku Standard

# List / show / delete / update
az acr list -o table
az acr show --name <n>
az acr delete --name <n> --yes
az acr update --name <n> --admin-enabled true   # enable admin (prefer RBAC)

# Log in to push/pull images
az acr login --name <n>
```

## ACR Build & Images

```bash
# Cloud build (no local Docker required) — Dockerfile must be in context
az acr build --image <repo>:<tag> --registry <n> .

# Import an image from another registry
az acr import --name <n> --source mcr.microsoft.com/azuredocs/aks-helloworld:v1

# Repository management
az acr repository list --name <n> -o table
az acr repository show-manifests --name <n> --repository <repo>
az acr repository show-tags     --name <n> --repository <repo> -o table
az acr repository delete        --name <n> --repository <repo> --yes
```

## ACR Tasks & Operations

```bash
# Automated build tasks (trigger on git commit, base image update, schedule)
az acr task create --name <t> --registry <n> --image <repo>:<tag> \
  --context <git-url> --file Dockerfile --git-access-token <pat>
az acr task list --registry <n> -o table
az acr task run  --name <t> --registry <n>
az acr task show --name <t> --registry <n>
az acr task delete --name <t> --registry <n>

# Credentials
az acr credential show --name <n>
az acr credential renew --name <n> --password-name password

# Geo-replication (Premium SKU)
az acr replication create --registry <n> --location <loc>
az acr replication list   --registry <n> -o table

# Webhooks
az acr webhook create --name <w> --registry <n> --uri <url> --actions push delete
az acr webhook list   --registry <n> -o table

# Health check
az acr check-health --name <n> --yes
```

## Gotchas

- **`get-credentials` merges into `~/.kube/config`** — use `--overwrite-existing` to replace instead of merge, or `--file <path>` to write to a separate file.
- **AKS start/stop saves costs but takes minutes** — the cluster is fully deallocated; plan for startup latency.
- **ACR admin account vs RBAC** — prefer managed identity or service principal over `--admin-enabled true`; admin credentials are shared and less secure.
- **ACR cloud build requires Dockerfile in context** — the build context (`.`) is uploaded to ACR; ensure the Dockerfile and all referenced files are present.

## Reference

- [AKS documentation](https://learn.microsoft.com/en-us/azure/aks/)
- [ACR documentation](https://learn.microsoft.com/en-us/azure/container-registry/)
- [az aks CLI reference](https://learn.microsoft.com/en-us/cli/azure/aks)
- [az acr CLI reference](https://learn.microsoft.com/en-us/cli/azure/acr)
