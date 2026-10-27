
# az-monitor

Azure Monitor and diagnostics operations via `az monitor`.

## When to Use

- Setting up monitoring and alerting for Azure resources
- Querying metrics and activity logs
- Configuring diagnostic settings to route logs and metrics
- Creating and managing Log Analytics workspaces and running KQL queries
- Setting up autoscale rules for compute resources
- Managing action groups for alert notifications (email, SMS, webhook)

## When to Skip

- **Application-level logging** — use the app framework's logging (e.g., Application Insights SDK, `console.log`, structured logging libraries)
- **ADO pipeline logs** — use `devops-pipelines.md` reference instead
- **Azure Portal GUI dashboards** — this skill focuses on CLI operations

## Prerequisites

Requires Azure CLI authenticated and configured. See the Foundations section in the az skill for login, subscription selection, and output formatting conventions.

```bash
az account show  # verify logged in
```

## Metrics

List available metrics and retrieve metric data for a resource.

```bash
# List available metric definitions for a resource
az monitor metrics list-definitions --resource <resource-id>

# Get metric values (last 1 hour, 5-minute grain)
az monitor metrics list \
  --resource <resource-id> \
  --metric "Percentage CPU" \
  --interval PT5M \
  --start-time "$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Filter with JMESPath — extract just timestamps and averages
az monitor metrics list \
  --resource <resource-id> \
  --metric "Percentage CPU" \
  --query "value[0].timeseries[0].data[].{time: timeStamp, avg: average}" \
  -o table

# Multiple metrics at once
az monitor metrics list \
  --resource <resource-id> \
  --metrics "Percentage CPU" "Available Memory Bytes" \
  --query "value[].{metric: name.value, avg: timeseries[0].data[-1].average}" \
  -o table
```

## Metric Alerts

Create and manage metric-based alert rules.

```bash
# Create a metric alert (CPU > 80% for 5 minutes)
az monitor metrics alert create \
  --name "high-cpu-alert" \
  --resource-group <rg> \
  --scopes <resource-id> \
  --condition "avg Percentage CPU > 80" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --action <action-group-id> \
  --description "CPU exceeds 80% threshold" \
  --severity 2

# List metric alerts in a resource group
az monitor metrics alert list --resource-group <rg> -o table

# Show details of a specific alert
az monitor metrics alert show --name "high-cpu-alert" --resource-group <rg>

# Update an alert (change threshold)
az monitor metrics alert update \
  --name "high-cpu-alert" \
  --resource-group <rg> \
  --condition "avg Percentage CPU > 90"

# Disable an alert
az monitor metrics alert update \
  --name "high-cpu-alert" \
  --resource-group <rg> \
  --enabled false

# Delete an alert
az monitor metrics alert delete --name "high-cpu-alert" --resource-group <rg>
```

## Activity Log

Query the Azure Activity Log and set up activity log alerts.

```bash
# List recent activity log events (last 24 hours)
az monitor activity-log list \
  --start-time "$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)" \
  --query "[].{time: eventTimestamp, op: operationName.value, status: status.value, caller: caller}" \
  -o table

# Filter by resource group
az monitor activity-log list \
  --resource-group <rg> \
  --query "[?status.value=='Failed'].{time: eventTimestamp, op: operationName.value, caller: caller}" \
  -o table

# Create an activity log alert (triggers on resource deletion)
az monitor activity-log alert create \
  --name "resource-deleted-alert" \
  --resource-group <rg> \
  --condition category=Administrative and operationName=Microsoft.Resources/subscriptions/resourceGroups/delete/action \
  --action-group <action-group-id> \
  --description "Alert when resources are deleted"

# List activity log alerts
az monitor activity-log alert list --resource-group <rg> -o table

# Show a specific alert
az monitor activity-log alert show --name "resource-deleted-alert" --resource-group <rg>

# Update an activity log alert
az monitor activity-log alert update \
  --name "resource-deleted-alert" \
  --resource-group <rg> \
  --enabled false

# Delete an activity log alert
az monitor activity-log alert delete --name "resource-deleted-alert" --resource-group <rg>
```

## Action Groups

Manage notification and action receivers for alerts.

```bash
# Create an action group with email and webhook receivers
az monitor action-group create \
  --name "ops-team-ag" \
  --resource-group <rg> \
  --short-name "OpsTeam" \
  --action email ops-email ops-team@contoso.com \
  --action webhook ops-hook "https://hooks.contoso.com/monitor"

# Add SMS receiver
az monitor action-group update \
  --name "ops-team-ag" \
  --resource-group <rg> \
  --add-action sms ops-sms 1 5551234567

# List action groups
az monitor action-group list --resource-group <rg> -o table

# Show action group details
az monitor action-group show --name "ops-team-ag" --resource-group <rg>

# Test an action group (send test notifications)
az monitor action-group test-notifications create \
  --resource-group <rg> \
  --action-group-name "ops-team-ag" \
  --alert-type metricstaticthreshold \
  --add-action email ops-email ops-team@contoso.com

# Delete an action group
az monitor action-group delete --name "ops-team-ag" --resource-group <rg>
```

## Diagnostic Settings

Route platform logs and metrics to Log Analytics, Storage, or Event Hubs.

```bash
# Create diagnostic settings — send to Log Analytics workspace
az monitor diagnostic-settings create \
  --name "send-to-law" \
  --resource <resource-id> \
  --workspace <log-analytics-workspace-id> \
  --logs '[{"categoryGroup": "allLogs", "enabled": true}]' \
  --metrics '[{"category": "AllMetrics", "enabled": true}]'

# List diagnostic settings for a resource
az monitor diagnostic-settings list --resource <resource-id> -o table

# Show a specific diagnostic setting
az monitor diagnostic-settings show --name "send-to-law" --resource <resource-id>

# Update — add storage account destination
az monitor diagnostic-settings update \
  --name "send-to-law" \
  --resource <resource-id> \
  --storage-account <storage-account-id>

# Delete diagnostic settings
az monitor diagnostic-settings delete --name "send-to-law" --resource <resource-id>

# List available log categories for a resource type
az monitor diagnostic-settings categories list --resource <resource-id> -o table
```

## Log Analytics

Manage Log Analytics workspaces and run KQL queries from the CLI.

```bash
# Create a Log Analytics workspace
az monitor log-analytics workspace create \
  --workspace-name "my-law" \
  --resource-group <rg> \
  --location eastus \
  --retention-time 90

# List workspaces
az monitor log-analytics workspace list --resource-group <rg> -o table

# Show workspace details (get workspace ID for queries)
az monitor log-analytics workspace show \
  --workspace-name "my-law" \
  --resource-group <rg> \
  --query "{id: customerId, name: name, sku: sku.name}"

# Update workspace retention
az monitor log-analytics workspace update \
  --workspace-name "my-law" \
  --resource-group <rg> \
  --retention-time 180

# Delete a workspace
az monitor log-analytics workspace delete \
  --workspace-name "my-law" \
  --resource-group <rg> \
  --yes

# --- Running KQL Queries ---

# Basic query — recent heartbeats
az monitor log-analytics query \
  --workspace <workspace-id> \
  --analytics-query "Heartbeat | summarize count() by Computer | top 10 by count_" \
  -o table

# Query with time range
az monitor log-analytics query \
  --workspace <workspace-id> \
  --analytics-query "AzureActivity | where TimeGenerated > ago(24h) | summarize count() by OperationNameValue" \
  --timespan "PT24H" \
  -o table

# Error analysis query
az monitor log-analytics query \
  --workspace <workspace-id> \
  --analytics-query "AzureDiagnostics | where Level == 'Error' | summarize count() by ResourceType, bin(TimeGenerated, 1h) | order by TimeGenerated desc" \
  -o table

# Query with single quotes in KQL (use double-quoting strategy)
az monitor log-analytics query \
  --workspace <workspace-id> \
  --analytics-query 'Syslog | where SeverityLevel == "err" | project TimeGenerated, Computer, SyslogMessage | take 50' \
  -o table
```

## Autoscale

Configure autoscale rules for compute resources (VM Scale Sets, App Service Plans, etc.).

```bash
# Create an autoscale setting
az monitor autoscale create \
  --name "vmss-autoscale" \
  --resource-group <rg> \
  --resource <vmss-resource-id> \
  --min-count 2 \
  --max-count 10 \
  --count 3

# Add a scale-out rule (CPU > 75% for 10 min → add 1 instance)
az monitor autoscale rule create \
  --autoscale-name "vmss-autoscale" \
  --resource-group <rg> \
  --condition "Percentage CPU > 75 avg 10m" \
  --scale out 1

# Add a scale-in rule (CPU < 25% for 10 min → remove 1 instance)
az monitor autoscale rule create \
  --autoscale-name "vmss-autoscale" \
  --resource-group <rg> \
  --condition "Percentage CPU < 25 avg 10m" \
  --scale in 1

# List autoscale rules
az monitor autoscale rule list \
  --autoscale-name "vmss-autoscale" \
  --resource-group <rg> \
  -o table

# Show autoscale settings
az monitor autoscale show --name "vmss-autoscale" --resource-group <rg>

# Update autoscale instance limits
az monitor autoscale update \
  --name "vmss-autoscale" \
  --resource-group <rg> \
  --max-count 20

# Delete a specific rule (by index)
az monitor autoscale rule delete \
  --autoscale-name "vmss-autoscale" \
  --resource-group <rg> \
  --index 0

# Delete the autoscale setting
az monitor autoscale delete --name "vmss-autoscale" --resource-group <rg>
```

## Gotchas

- **Resource IDs required** — Most `az monitor` commands need full resource IDs, not just names. Use `az resource show --name <name> --resource-group <rg> --resource-type <type> --query id -o tsv` to resolve.
- **KQL string escaping** — When passing KQL via `--analytics-query`, use single quotes around the query to avoid shell interpretation of `|`, `>`, and `$`. For KQL strings containing single quotes, use the `'...'` outer quoting with `'\''` escape or heredoc.
- **Metric namespaces vary by resource type** — Each Azure resource type exposes different metrics under different namespaces. Use `az monitor metrics list-definitions --resource <id>` to discover available metrics.
- **Alert evaluation frequency** — Metric alerts have an evaluation frequency (default 1 min) and a window size. Window size must be ≥ evaluation frequency. Shorter frequencies cost more.
- **Diagnostic settings are per-resource** — Each resource needs its own diagnostic settings configured. Use scripts to apply across multiple resources.
- **Log Analytics query limits** — CLI queries return max 10,000 rows by default. Use `| take N` in KQL or paginate for large datasets.
- **Workspace ID vs Resource ID** — `az monitor log-analytics query` uses the workspace's `customerId` (GUID), not the ARM resource ID. Get it with `az monitor log-analytics workspace show --query customerId -o tsv`.

## Reference

- [az monitor documentation](https://learn.microsoft.com/cli/azure/monitor)
- [az monitor metrics](https://learn.microsoft.com/cli/azure/monitor/metrics)
- [az monitor metrics alert](https://learn.microsoft.com/cli/azure/monitor/metrics/alert)
- [az monitor activity-log](https://learn.microsoft.com/cli/azure/monitor/activity-log)
- [az monitor action-group](https://learn.microsoft.com/cli/azure/monitor/action-group)
- [az monitor diagnostic-settings](https://learn.microsoft.com/cli/azure/monitor/diagnostic-settings)
- [az monitor log-analytics](https://learn.microsoft.com/cli/azure/monitor/log-analytics)
- [az monitor autoscale](https://learn.microsoft.com/cli/azure/monitor/autoscale)
- [KQL quick reference](https://learn.microsoft.com/azure/data-explorer/kql-quick-reference)
- [Azure Monitor overview](https://learn.microsoft.com/azure/azure-monitor/overview)
