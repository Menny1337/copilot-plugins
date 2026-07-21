
# Azure Web Apps & Functions Skill

CLI patterns for Azure App Service hosting: web apps, function apps, static web apps, logic apps, and app service plans.

## When to Use

- Deploying web apps, functions, or static sites on Azure App Service
- Managing app service plans, deployment slots, app settings, SSL, logs, and scaling
- Automating zero-downtime deployments with slot swaps
- Configuring managed identity, VNet integration, CORS, or traffic routing

## When to Skip

- **Container Apps** — Use `az-containerapp` skill instead
- **AKS / Kubernetes** — Use `az-aks` skill instead
- **Virtual Machines** — Not covered by this skill

## Prerequisites

See **Foundations** section in the az skill for login, subscription selection, resource group basics, and output formatting conventions.

```bash
az login
az account set --subscription <sub>
```

## App Service Plans

App service plans define the compute resources for your hosted apps.

```bash
# Create a plan
az appservice plan create -g <rg> -n <plan> --sku B1 --is-linux

# List plans
az appservice plan list -g <rg> -o table

# Show details
az appservice plan show -g <rg> -n <plan>

# Update (scale up)
az appservice plan update -g <rg> -n <plan> --sku S1

# Delete
az appservice plan delete -g <rg> -n <plan> --yes

# List available locations
az appservice list-locations --sku S1
```

Common SKUs: `F1` (Free), `B1/B2/B3` (Basic), `S1/S2/S3` (Standard), `P1V2/P2V2/P3V2` (Premium v2), `P1V3/P2V3/P3V3` (Premium v3).

## Web Apps

### Lifecycle

```bash
# Create a web app
az webapp create -g <rg> -p <plan> -n <app> --runtime "NODE:18-lts"

# List web apps
az webapp list -g <rg> -o table

# Show details
az webapp show -g <rg> -n <app>

# Delete
az webapp delete -g <rg> -n <app>

# Start / Stop / Restart
az webapp start -g <rg> -n <app>
az webapp stop -g <rg> -n <app>
az webapp restart -g <rg> -n <app>
```

### Quick Deploy with `az webapp up`

One-command create-and-deploy. Detects runtime, creates resource group, plan, and app if they don't exist.

```bash
# From your project directory
az webapp up -n <app> --runtime "NODE:18-lts" --sku B1

# Specify resource group and location
az webapp up -n <app> -g <rg> -l eastus --runtime "PYTHON:3.11"
```

### Deployment

```bash
# Zip deploy
az webapp deploy -g <rg> -n <app> --src-path app.zip --type zip

# Deploy from external URL
az webapp deploy -g <rg> -n <app> --src-url <url> --type zip

# Configure deployment source (GitHub)
az webapp deployment source config -g <rg> -n <app> \
  --repo-url <github-url> --branch main --manual-integration
```

### Deployment Slots

```bash
# Create a slot
az webapp deployment slot create -g <rg> -n <app> -s staging

# List slots
az webapp deployment slot list -g <rg> -n <app> -o table

# Deploy to a slot
az webapp deploy -g <rg> -n <app> -s staging --src-path app.zip --type zip

# Swap slots (zero-downtime)
az webapp deployment slot swap -g <rg> -n <app> -s staging --target-slot production

# Delete a slot
az webapp deployment slot delete -g <rg> -n <app> -s staging
```

### App Settings & Connection Strings

```bash
# Set app settings
az webapp config appsettings set -g <rg> -n <app> \
  --settings KEY1=value1 KEY2=value2

# List app settings
az webapp config appsettings list -g <rg> -n <app> -o table

# Delete an app setting
az webapp config appsettings delete -g <rg> -n <app> --setting-names KEY1

# Set connection strings
az webapp config connection-string set -g <rg> -n <app> \
  --connection-string-type SQLAzure \
  --settings "MyDb=Server=tcp:myserver.database.windows.net;Database=mydb;"

# List connection strings
az webapp config connection-string list -g <rg> -n <app>
```

### Runtime Configuration

```bash
# List available runtimes
az webapp list-runtimes

# Set runtime stack
az webapp config set -g <rg> -n <app> --linux-fx-version "NODE|18-lts"

# Set startup command
az webapp config set -g <rg> -n <app> --startup-file "node server.js"

# Configure general settings
az webapp config set -g <rg> -n <app> \
  --always-on true \
  --min-tls-version 1.2 \
  --http20-enabled true
```

### SSL / Custom Domains

```bash
# Add a custom domain
az webapp config hostname add -g <rg> --webapp-name <app> --hostname <domain>

# Upload SSL certificate
az webapp config ssl upload -g <rg> -n <app> \
  --certificate-file <pfx-file> --certificate-password <pwd>

# Bind SSL certificate
az webapp config ssl bind -g <rg> -n <app> \
  --certificate-thumbprint <thumbprint> --ssl-type SNI

# Create managed certificate
az webapp config ssl create -g <rg> -n <app> --hostname <domain>
```

### Logs

```bash
# Enable application logging
az webapp log config -g <rg> -n <app> \
  --application-logging filesystem --level information

# Tail live logs
az webapp log tail -g <rg> -n <app>

# Download log files
az webapp log download -g <rg> -n <app> --log-file logs.zip
```

### CORS

```bash
# Set allowed origins
az webapp cors add -g <rg> -n <app> --allowed-origins https://example.com

# Show CORS settings
az webapp cors show -g <rg> -n <app>

# Remove an origin
az webapp cors remove -g <rg> -n <app> --allowed-origins https://example.com
```

### Managed Identity

```bash
# Enable system-assigned identity
az webapp identity assign -g <rg> -n <app>

# Assign a user-assigned identity
az webapp identity assign -g <rg> -n <app> --identities <identity-resource-id>

# Show identity
az webapp identity show -g <rg> -n <app>
```

### VNet Integration

```bash
# Integrate with a VNet
az webapp vnet-integration add -g <rg> -n <app> \
  --vnet <vnet> --subnet <subnet>

# List VNet integrations
az webapp vnet-integration list -g <rg> -n <app>

# Remove VNet integration
az webapp vnet-integration remove -g <rg> -n <app>
```

### Traffic Routing

```bash
# Route percentage of traffic to a slot
az webapp traffic-routing set -g <rg> -n <app> \
  --distribution staging=20

# Clear traffic routing
az webapp traffic-routing clear -g <rg> -n <app>

# Show traffic routing
az webapp traffic-routing show -g <rg> -n <app>
```

### SSH

```bash
# Open SSH session to the app container
az webapp ssh -g <rg> -n <app>

# SSH to a specific slot
az webapp ssh -g <rg> -n <app> -s staging
```

## Function Apps

Function apps follow similar patterns to web apps with additional function-specific commands.

### Lifecycle

```bash
# Create on consumption plan (serverless)
az functionapp create -g <rg> -n <func> \
  --storage-account <storage> \
  --consumption-plan-location eastus \
  --runtime node --runtime-version 18 \
  --functions-version 4

# Create on dedicated plan
az functionapp create -g <rg> -n <func> \
  --storage-account <storage> \
  --plan <plan> \
  --runtime python --runtime-version 3.11 \
  --functions-version 4

# List / Show / Delete
az functionapp list -g <rg> -o table
az functionapp show -g <rg> -n <func>
az functionapp delete -g <rg> -n <func>

# Start / Stop / Restart
az functionapp start -g <rg> -n <func>
az functionapp stop -g <rg> -n <func>
az functionapp restart -g <rg> -n <func>
```

### Function Management

```bash
# List functions in an app
az functionapp function list -g <rg> -n <func> -o table

# Show a specific function
az functionapp function show -g <rg> -n <func> --function-name <fn>

# Delete a function
az functionapp function delete -g <rg> -n <func> --function-name <fn>

# Get function keys
az functionapp function keys list -g <rg> -n <func> --function-name <fn>
```

### App-level Keys

```bash
# List host keys
az functionapp keys list -g <rg> -n <func>

# Set a host key
az functionapp keys set -g <rg> -n <func> --key-name <name> --key-type functionKeys

# Delete a host key
az functionapp keys delete -g <rg> -n <func> --key-name <name> --key-type functionKeys
```

### Function App Plans

```bash
# Create a premium plan for functions
az functionapp plan create -g <rg> -n <plan> --sku EP1 --is-linux

# List / Show / Update / Delete
az functionapp plan list -g <rg> -o table
az functionapp plan show -g <rg> -n <plan>
az functionapp plan update -g <rg> -n <plan> --sku EP2
az functionapp plan delete -g <rg> -n <plan> --yes
```

### Deployment

```bash
# Zip deploy
az functionapp deploy -g <rg> -n <func> --src-path func.zip --type zip

# App settings
az functionapp config appsettings set -g <rg> -n <func> \
  --settings KEY=value

# Deployment slots (same pattern as webapp)
az functionapp deployment slot create -g <rg> -n <func> -s staging
az functionapp deployment slot swap -g <rg> -n <func> -s staging
```

## Static Web Apps

### Lifecycle

```bash
# Create linked to a GitHub repo
az staticwebapp create -g <rg> -n <swa> \
  --source <repo-url> --branch main \
  --app-location "/" --output-location "dist" \
  --login-with-github

# Create standalone (no repo link)
az staticwebapp create -g <rg> -n <swa> -l eastus2

# List / Show / Delete
az staticwebapp list -g <rg> -o table
az staticwebapp show -g <rg> -n <swa>
az staticwebapp delete -g <rg> -n <swa> --yes
```

### App Settings

```bash
# Set settings
az staticwebapp appsettings set -n <swa> --setting-names KEY1=value1

# List settings
az staticwebapp appsettings list -n <swa>

# Delete settings
az staticwebapp appsettings delete -n <swa> --setting-names KEY1
```

### Environments

```bash
# List environments (preview branches)
az staticwebapp environment list -n <swa> -o table

# Show a specific environment
az staticwebapp environment show -n <swa> --environment-name <env>

# Delete an environment
az staticwebapp environment delete -n <swa> --environment-name <env> --yes
```

### Users

```bash
# List users
az staticwebapp users list -n <swa> -o table

# Invite a user
az staticwebapp users invite -n <swa> \
  --authentication-provider GitHub \
  --user-details <github-username> \
  --role contributor \
  --invitation-expiration-in-hours 168
```

### Custom Domains

```bash
# Set a custom domain
az staticwebapp hostname set -n <swa> --hostname <domain>

# List custom domains
az staticwebapp hostname list -n <swa> -o table

# Delete a custom domain
az staticwebapp hostname delete -n <swa> --hostname <domain> --yes
```

### Backend Linking

```bash
# Link an API backend (Function App, API Management, etc.)
az staticwebapp backends link -n <swa> -g <rg> \
  --backend-resource-id <resource-id> --backend-region <region>

# Unlink backend
az staticwebapp backends unlink -n <swa> -g <rg>

# Show linked backend
az staticwebapp backends show -n <swa> -g <rg>
```

## Logic Apps

### Lifecycle

```bash
# Create (Standard / single-tenant)
az logicapp create -g <rg> -n <logic> \
  --storage-account <storage> \
  --plan <plan>

# List / Show / Delete
az logicapp list -g <rg> -o table
az logicapp show -g <rg> -n <logic>
az logicapp delete -g <rg> -n <logic> --yes

# Start / Stop / Restart
az logicapp start -g <rg> -n <logic>
az logicapp stop -g <rg> -n <logic>
az logicapp restart -g <rg> -n <logic>
```

### Deployment

```bash
# Zip deploy
az logicapp deploy -g <rg> -n <logic> --src-path logic.zip --type zip
```

## Common Workflows

### Quick Deploy with `az webapp up`

```bash
cd my-node-app/
az webapp up -n myapp-prod --runtime "NODE:18-lts" --sku B1 -l eastus
# Creates RG, plan, app, and deploys in one command
```

### Slot Swap for Zero-Downtime Deployment

```bash
# Deploy to staging
az webapp deploy -g <rg> -n <app> -s staging --src-path app.zip --type zip

# Warm up staging, then swap
az webapp deployment slot swap -g <rg> -n <app> -s staging --target-slot production
```

### Configure Custom Domain + SSL

```bash
# Add domain
az webapp config hostname add -g <rg> --webapp-name <app> --hostname www.example.com

# Create and bind managed SSL certificate
az webapp config ssl create -g <rg> -n <app> --hostname www.example.com
az webapp config ssl bind -g <rg> -n <app> \
  --certificate-thumbprint <thumbprint> --ssl-type SNI
```

## Gotchas

| Gotcha | Detail |
|--------|--------|
| `az webapp up` auto-creates resources | If the RG, plan, or app don't exist, `az webapp up` creates them. This can surprise you with unintended resources. Use `--resource-group` and `--plan` explicitly to control. |
| Slot swap vs slot deploy | `slot swap` exchanges production and staging in-place (zero-downtime). Deploying directly to production causes downtime. Always deploy to a slot first, then swap. |
| Linux vs Windows runtime flags | Linux uses `--is-linux` on plan and `--runtime` on app. Windows uses `--os-type Windows`. Runtime string formats differ between platforms — check `az webapp list-runtimes --os linux` vs `--os windows`. |
| Consumption vs Premium function plans | Consumption plan (`--consumption-plan-location`) is serverless with cold starts. Premium (`EP1/EP2/EP3`) avoids cold starts but costs more. You cannot mix plan types after creation. |
| Sticky slot settings | App settings and connection strings marked as "slot settings" stick to the slot during swap. Use `--slot-setting` flag or configure in portal to control which settings travel with the code vs stay with the slot. |
| Function app requires storage | Every function app needs `--storage-account`. Create one beforehand or let `az functionapp create` fail with a clear error. |

## Reference

- [App Service CLI docs](https://learn.microsoft.com/cli/azure/appservice)
- [Web Apps CLI docs](https://learn.microsoft.com/cli/azure/webapp)
- [Function Apps CLI docs](https://learn.microsoft.com/cli/azure/functionapp)
- [Static Web Apps CLI docs](https://learn.microsoft.com/cli/azure/staticwebapp)
- [Logic Apps CLI docs](https://learn.microsoft.com/cli/azure/logicapp)
- [App Service Plans](https://learn.microsoft.com/azure/app-service/overview-hosting-plans)
- [Deployment slots](https://learn.microsoft.com/azure/app-service/deploy-staging-slots)
- [az webapp up reference](https://learn.microsoft.com/cli/azure/webapp#az-webapp-up)
