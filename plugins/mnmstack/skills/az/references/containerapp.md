
# az-containerapp

## When to Use

Use this skill when deploying and managing Azure Container Apps — serverless containerized microservices with built-in scaling, Dapr integration, and revision management.

## When to Skip

- **AKS clusters** — Use `az-aks` for full Kubernetes cluster management.
- **Container Instances** — Use `az container` for simple one-off containers that don't need scaling or revisions.
- **App Service** — Use `az-webapp-functions` for traditional web apps and Azure Functions.

## Prerequisites

- Follow Foundations section (az skill) for login, subscription, and resource group setup.
- Install the Container Apps extension:
  ```bash
  az extension add --name containerapp --upgrade
  ```
- Register the namespace (first time only):
  ```bash
  az provider register --namespace Microsoft.App
  ```

## Environment Management

Container Apps run inside a Container Apps environment (shared boundary for networking and logging).

```bash
# Create an environment
az containerapp env create \
  --name <env-name> \
  --resource-group <rg> \
  --location <location>

# List / show / delete
az containerapp env list --resource-group <rg>
az containerapp env show --name <env-name> --resource-group <rg>
az containerapp env delete --name <env-name> --resource-group <rg> --yes
```

### Dapr Components

```bash
# Set a Dapr component
az containerapp env dapr-component set \
  --name <env-name> \
  --resource-group <rg> \
  --dapr-component-name <component-name> \
  --yaml <component.yaml>

# List / remove
az containerapp env dapr-component list --name <env-name> --resource-group <rg>
az containerapp env dapr-component remove --name <env-name> --resource-group <rg> --dapr-component-name <component-name>
```

## App Lifecycle

```bash
# Create a container app
az containerapp create \
  --name <app-name> \
  --resource-group <rg> \
  --environment <env-name> \
  --image <registry>/<image>:<tag> \
  --target-port 8080 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 10

# Opinionated one-command deploy (builds, pushes, creates env + app)
az containerapp up \
  --name <app-name> \
  --resource-group <rg> \
  --source .

# List / show / delete
az containerapp list --resource-group <rg>
az containerapp show --name <app-name> --resource-group <rg>
az containerapp delete --name <app-name> --resource-group <rg> --yes

# Update image and env vars
az containerapp update \
  --name <app-name> \
  --resource-group <rg> \
  --image <registry>/<image>:<new-tag> \
  --set-env-vars "KEY1=value1" "KEY2=value2"
```

## Revisions

Each update creates a new revision. Use revision management for blue-green and canary deployments.

```bash
az containerapp revision list --name <app-name> --resource-group <rg>
az containerapp revision show --name <app-name> --resource-group <rg> --revision <revision-name>
az containerapp revision activate --name <app-name> --resource-group <rg> --revision <revision-name>
az containerapp revision deactivate --name <app-name> --resource-group <rg> --revision <revision-name>
az containerapp revision restart --name <app-name> --resource-group <rg> --revision <revision-name>
```

## Ingress

Ingress controls external/internal HTTP access to the app.

```bash
# Enable ingress
az containerapp ingress enable \
  --name <app-name> \
  --resource-group <rg> \
  --type external \
  --target-port 8080 \
  --transport auto

# Show / update / disable
az containerapp ingress show --name <app-name> --resource-group <rg>
az containerapp ingress update --name <app-name> --resource-group <rg> --target-port 3000
az containerapp ingress disable --name <app-name> --resource-group <rg>
```

## Secrets & Identity

### Secrets

```bash
az containerapp secret set --name <app-name> --resource-group <rg> --secrets "db-conn=<value>"
az containerapp secret list --name <app-name> --resource-group <rg>
az containerapp secret show --name <app-name> --resource-group <rg> --secret-name db-conn
az containerapp secret remove --name <app-name> --resource-group <rg> --secret-names db-conn
```

Reference secrets in env vars with `secretref:`:
```bash
az containerapp update \
  --name <app-name> \
  --resource-group <rg> \
  --set-env-vars "DB_CONN=secretref:db-conn"
```

### Managed Identity

```bash
# Assign system-assigned identity
az containerapp identity assign --name <app-name> --resource-group <rg> --system-assigned

# Assign user-assigned identity
az containerapp identity assign --name <app-name> --resource-group <rg> --user-assigned <identity-id>

# Show / remove
az containerapp identity show --name <app-name> --resource-group <rg>
az containerapp identity remove --name <app-name> --resource-group <rg> --system-assigned
```

## Logs & Debugging

```bash
# Stream logs (system or console)
az containerapp logs show \
  --name <app-name> \
  --resource-group <rg> \
  --type console \
  --follow

# Exec into a running container
az containerapp exec \
  --name <app-name> \
  --resource-group <rg> \
  --command /bin/sh

# List replicas
az containerapp replica list --name <app-name> --resource-group <rg>
```

## Jobs

Container Apps Jobs run tasks to completion (scheduled, event-driven, or manual).

```bash
# Create a job
az containerapp job create \
  --name <job-name> \
  --resource-group <rg> \
  --environment <env-name> \
  --image <registry>/<image>:<tag> \
  --trigger-type Manual \
  --replica-timeout 600 \
  --replica-retry-limit 1

# List / show / delete
az containerapp job list --resource-group <rg>
az containerapp job show --name <job-name> --resource-group <rg>
az containerapp job delete --name <job-name> --resource-group <rg> --yes

# Start / stop a job execution
az containerapp job start --name <job-name> --resource-group <rg>
az containerapp job stop --name <job-name> --resource-group <rg> --job-execution-name <execution-name>
```

## CI/CD Integration

Wire up GitHub Actions for automatic build-and-deploy on push.

```bash
# Add GitHub Actions workflow
az containerapp github-action add \
  --name <app-name> \
  --resource-group <rg> \
  --repo-url https://github.com/<owner>/<repo> \
  --branch main \
  --registry-url <acr-name>.azurecr.io \
  --service-principal-client-id <client-id> \
  --service-principal-client-secret <client-secret> \
  --service-principal-tenant-id <tenant-id>

# Show / delete
az containerapp github-action show --name <app-name> --resource-group <rg>
az containerapp github-action delete --name <app-name> --resource-group <rg>
```

## Registry & Domains

### Container Registry

```bash
az containerapp registry set --name <app-name> --resource-group <rg> --server <acr-name>.azurecr.io --identity system
az containerapp registry show --name <app-name> --resource-group <rg> --server <acr-name>.azurecr.io
az containerapp registry remove --name <app-name> --resource-group <rg> --server <acr-name>.azurecr.io
```

### Custom Domains

```bash
az containerapp hostname add --name <app-name> --resource-group <rg> --hostname <custom-domain>
az containerapp hostname list --name <app-name> --resource-group <rg>
az containerapp hostname delete --name <app-name> --resource-group <rg> --hostname <custom-domain>
```

## Auth

Configure EasyAuth for built-in authentication providers.

```bash
# Enable/update auth
az containerapp auth update \
  --name <app-name> \
  --resource-group <rg> \
  --enabled true \
  --action AllowAnonymous

# Show current auth config
az containerapp auth show --name <app-name> --resource-group <rg>
```

## Gotchas

- **Revision mode matters**: `single` (default) deactivates old revisions automatically; `multiple` keeps them active for traffic splitting. Set with `--revision-mode`.
- **Ingress is not enabled by default** — you must explicitly set `--ingress external` or `--ingress internal` at create time or enable it afterward.
- **Env vars vs secrets**: Use plain env vars for non-sensitive config. Use secrets + `secretref:` for sensitive values. Secrets are not shown in revision diffs.
- **`az containerapp up`** is opinionated — it creates an environment, ACR, and app in one shot. Great for getting started, but use `create` + `update` for production control.
- **Extension required**: Most commands need `az extension add --name containerapp`. If commands fail with "not recognized", install the extension first.
- **Replica scaling to zero**: When min-replicas is 0, cold starts are expected. Set min-replicas ≥ 1 for latency-sensitive workloads.

## Reference

- [Azure Container Apps overview](https://learn.microsoft.com/en-us/azure/container-apps/overview)
- [az containerapp CLI reference](https://learn.microsoft.com/en-us/cli/azure/containerapp)
- [Container Apps environments](https://learn.microsoft.com/en-us/azure/container-apps/environment)
- [Revisions and traffic splitting](https://learn.microsoft.com/en-us/azure/container-apps/revisions)
- [Container Apps Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs)
- [Dapr integration](https://learn.microsoft.com/en-us/azure/container-apps/dapr-overview)
