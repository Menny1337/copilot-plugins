
# Azure Databases Skill

Manage Azure database services (SQL, Cosmos DB, MySQL, PostgreSQL, Redis) via `az` CLI.

## When to Use

- Creating, configuring, or managing Azure SQL servers and databases
- Working with Cosmos DB accounts and containers across APIs (SQL, MongoDB, Cassandra, Gremlin)
- Provisioning and managing MySQL or PostgreSQL flexible servers
- Setting up Azure Redis Cache instances
- Configuring firewall rules, keys, failover groups, and elastic pools
- Importing/exporting data or connecting directly to database instances

## When to Skip

- **Storage tables** — Use `az-storage` skill for Azure Table Storage
- **Application-level ORM** — This skill covers infrastructure, not application data-access layers
- **Data Lake** — Use `az-storage` skill for Azure Data Lake Storage

## Prerequisites

Requires Azure CLI authenticated and configured. See the **Foundations** section in the az skill for:
- `az login` and subscription selection
- Resource group conventions
- Tagging and naming standards
- Output formatting (`--output table/json/tsv`)

## Azure SQL

### Servers

```bash
# Create a SQL server
az sql server create --name <server> --resource-group <rg> --location <loc> \
  --admin-user <user> --admin-password <pass>

# List / show / update / delete
az sql server list --resource-group <rg>
az sql server show --name <server> --resource-group <rg>
az sql server update --name <server> --resource-group <rg> --admin-password <new-pass>
az sql server delete --name <server> --resource-group <rg> --yes
```

### Firewall Rules

```bash
# Allow an IP range
az sql server firewall-rule create --server <server> --resource-group <rg> \
  --name <rule-name> --start-ip-address <start> --end-ip-address <end>

# Allow Azure services
az sql server firewall-rule create --server <server> --resource-group <rg> \
  --name AllowAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0

# List / show / update / delete
az sql server firewall-rule list --server <server> --resource-group <rg>
az sql server firewall-rule show --server <server> --resource-group <rg> --name <rule>
az sql server firewall-rule update --server <server> --resource-group <rg> --name <rule> \
  --start-ip-address <start> --end-ip-address <end>
az sql server firewall-rule delete --server <server> --resource-group <rg> --name <rule>
```

### Databases

```bash
# Create a database
az sql db create --server <server> --resource-group <rg> --name <db> \
  --service-objective S0  # Pricing tier

# List / show / update / delete
az sql db list --server <server> --resource-group <rg>
az sql db show --server <server> --resource-group <rg> --name <db>
az sql db update --server <server> --resource-group <rg> --name <db> \
  --service-objective S1
az sql db delete --server <server> --resource-group <rg> --name <db> --yes

# Copy a database
az sql db copy --server <server> --resource-group <rg> --name <db> \
  --dest-name <new-db>

# Rename a database
az sql db rename --server <server> --resource-group <rg> --name <db> \
  --new-name <new-name>

# Restore a deleted or point-in-time database
az sql db restore --server <server> --resource-group <rg> --name <db> \
  --dest-name <restored-db> --time "2024-01-15T10:00:00Z"
```

### Auditing

```bash
# Enable auditing to a storage account
az sql db audit-policy update --server <server> --resource-group <rg> --name <db> \
  --state Enabled --storage-account <storage> --storage-key <key>
```

### Elastic Pools

```bash
az sql elastic-pool create --server <server> --resource-group <rg> --name <pool> \
  --edition Standard --dtu 100
az sql elastic-pool list --server <server> --resource-group <rg>
az sql elastic-pool show --server <server> --resource-group <rg> --name <pool>
az sql elastic-pool update --server <server> --resource-group <rg> --name <pool> --dtu 200
az sql elastic-pool delete --server <server> --resource-group <rg> --name <pool>

# Add a database to a pool
az sql db update --server <server> --resource-group <rg> --name <db> \
  --elastic-pool <pool>
```

### Managed Instances

```bash
az sql mi create --name <mi> --resource-group <rg> --location <loc> \
  --admin-user <user> --admin-password <pass> --subnet <subnet-id> \
  --vcore 4 --edition GeneralPurpose --family Gen5
az sql mi list --resource-group <rg>
az sql mi show --name <mi> --resource-group <rg>
az sql mi update --name <mi> --resource-group <rg> --vcore 8
az sql mi delete --name <mi> --resource-group <rg> --yes
```

### Failover Groups

```bash
az sql failover-group create --server <server> --resource-group <rg> \
  --name <fg> --partner-server <partner> --add-db <db>
az sql failover-group list --server <server> --resource-group <rg>
az sql failover-group show --server <server> --resource-group <rg> --name <fg>
az sql failover-group update --server <server> --resource-group <rg> --name <fg> \
  --failover-policy Automatic --grace-period 60
az sql failover-group set-primary --server <partner> --resource-group <rg> --name <fg>
az sql failover-group delete --server <server> --resource-group <rg> --name <fg>
```

### Data Warehouses (Synapse SQL Pools)

```bash
az sql dw create --server <server> --resource-group <rg> --name <dw> \
  --service-objective DW100c
az sql dw show --server <server> --resource-group <rg> --name <dw>
az sql dw pause --server <server> --resource-group <rg> --name <dw>
az sql dw resume --server <server> --resource-group <rg> --name <dw>
az sql dw delete --server <server> --resource-group <rg> --name <dw> --yes
```

## Cosmos DB

### Account Management

```bash
# Create a Cosmos DB account (SQL API default)
az cosmosdb create --name <account> --resource-group <rg> --locations \
  regionName=eastus failoverPriority=0 isZoneRedundant=false

# List / show / update / delete
az cosmosdb list --resource-group <rg>
az cosmosdb show --name <account> --resource-group <rg>
az cosmosdb update --name <account> --resource-group <rg> \
  --default-consistency-level Session
az cosmosdb delete --name <account> --resource-group <rg> --yes
```

### Keys

```bash
# List keys (connection strings)
az cosmosdb keys list --name <account> --resource-group <rg>
az cosmosdb keys list --name <account> --resource-group <rg> --type connection-strings

# Regenerate a key
az cosmosdb keys regenerate --name <account> --resource-group <rg> --key-kind primary
```

### SQL API

```bash
# Databases
az cosmosdb sql database create --account-name <account> --resource-group <rg> \
  --name <db> --throughput 400
az cosmosdb sql database list --account-name <account> --resource-group <rg>
az cosmosdb sql database show --account-name <account> --resource-group <rg> --name <db>
az cosmosdb sql database delete --account-name <account> --resource-group <rg> --name <db> --yes

# Containers
az cosmosdb sql container create --account-name <account> --resource-group <rg> \
  --database-name <db> --name <container> --partition-key-path "/partitionKey"
az cosmosdb sql container list --account-name <account> --resource-group <rg> \
  --database-name <db>
az cosmosdb sql container show --account-name <account> --resource-group <rg> \
  --database-name <db> --name <container>
az cosmosdb sql container update --account-name <account> --resource-group <rg> \
  --database-name <db> --name <container> --throughput 800
az cosmosdb sql container delete --account-name <account> --resource-group <rg> \
  --database-name <db> --name <container> --yes
```

### MongoDB API

```bash
# Databases
az cosmosdb mongodb database create --account-name <account> --resource-group <rg> \
  --name <db> --throughput 400
az cosmosdb mongodb database list --account-name <account> --resource-group <rg>
az cosmosdb mongodb database delete --account-name <account> --resource-group <rg> \
  --name <db> --yes

# Collections
az cosmosdb mongodb collection create --account-name <account> --resource-group <rg> \
  --database-name <db> --name <collection> --shard "myShardKey"
az cosmosdb mongodb collection list --account-name <account> --resource-group <rg> \
  --database-name <db>
az cosmosdb mongodb collection delete --account-name <account> --resource-group <rg> \
  --database-name <db> --name <collection> --yes
```

### Other APIs

```bash
# Cassandra — keyspaces and tables
az cosmosdb cassandra keyspace create --account-name <account> --resource-group <rg> --name <ks>
az cosmosdb cassandra table create --account-name <account> --resource-group <rg> \
  --keyspace-name <ks> --name <table> --schema @schema.json

# Gremlin — databases and graphs
az cosmosdb gremlin database create --account-name <account> --resource-group <rg> --name <db>
az cosmosdb gremlin graph create --account-name <account> --resource-group <rg> \
  --database-name <db> --name <graph> --partition-key-path "/pk"

# Table API
az cosmosdb table create --account-name <account> --resource-group <rg> --name <table>
```

### Network Rules

```bash
# Add a virtual network rule
az cosmosdb network-rule add --name <account> --resource-group <rg> \
  --subnet <subnet-id>

# List network rules
az cosmosdb network-rule list --name <account> --resource-group <rg>

# Remove a virtual network rule
az cosmosdb network-rule remove --name <account> --resource-group <rg> \
  --subnet <subnet-id>
```

## MySQL

### Flexible Server

```bash
# Create a MySQL flexible server
az mysql flexible-server create --name <server> --resource-group <rg> \
  --location <loc> --admin-user <user> --admin-password <pass> \
  --sku-name Standard_B1ms --tier Burstable --storage-size 32

# List / show / update / delete
az mysql flexible-server list --resource-group <rg>
az mysql flexible-server show --name <server> --resource-group <rg>
az mysql flexible-server update --name <server> --resource-group <rg> \
  --sku-name Standard_D2s_v3 --tier GeneralPurpose
az mysql flexible-server delete --name <server> --resource-group <rg> --yes
```

### Databases

```bash
az mysql flexible-server db create --server-name <server> --resource-group <rg> \
  --database-name <db>
az mysql flexible-server db list --server-name <server> --resource-group <rg>
az mysql flexible-server db show --server-name <server> --resource-group <rg> \
  --database-name <db>
az mysql flexible-server db delete --server-name <server> --resource-group <rg> \
  --database-name <db> --yes
```

### Firewall Rules

```bash
az mysql flexible-server firewall-rule create --name <server> --resource-group <rg> \
  --rule-name <rule> --start-ip-address <start> --end-ip-address <end>
az mysql flexible-server firewall-rule list --name <server> --resource-group <rg>
az mysql flexible-server firewall-rule show --name <server> --resource-group <rg> \
  --rule-name <rule>
az mysql flexible-server firewall-rule update --name <server> --resource-group <rg> \
  --rule-name <rule> --start-ip-address <start> --end-ip-address <end>
az mysql flexible-server firewall-rule delete --name <server> --resource-group <rg> \
  --rule-name <rule> --yes
```

### Direct Connect / Execute

```bash
# Interactive connection
az mysql flexible-server connect --name <server> --admin-user <user> \
  --admin-password <pass> --database-name <db>

# Execute a query
az mysql flexible-server execute --name <server> --admin-user <user> \
  --admin-password <pass> --database-name <db> \
  --querytext "SELECT * FROM users LIMIT 10;"

# Execute from file
az mysql flexible-server execute --name <server> --admin-user <user> \
  --admin-password <pass> --database-name <db> --file-path ./query.sql
```

## PostgreSQL

### Flexible Server

```bash
# Create a PostgreSQL flexible server
az postgres flexible-server create --name <server> --resource-group <rg> \
  --location <loc> --admin-user <user> --admin-password <pass> \
  --sku-name Standard_B1ms --tier Burstable --storage-size 32 --version 15

# List / show / update / delete
az postgres flexible-server list --resource-group <rg>
az postgres flexible-server show --name <server> --resource-group <rg>
az postgres flexible-server update --name <server> --resource-group <rg> \
  --sku-name Standard_D2s_v3 --tier GeneralPurpose
az postgres flexible-server delete --name <server> --resource-group <rg> --yes
```

### Databases

```bash
az postgres flexible-server db create --server-name <server> --resource-group <rg> \
  --database-name <db>
az postgres flexible-server db list --server-name <server> --resource-group <rg>
az postgres flexible-server db show --server-name <server> --resource-group <rg> \
  --database-name <db>
az postgres flexible-server db delete --server-name <server> --resource-group <rg> \
  --database-name <db> --yes
```

### Firewall Rules

```bash
az postgres flexible-server firewall-rule create --name <server> --resource-group <rg> \
  --rule-name <rule> --start-ip-address <start> --end-ip-address <end>
az postgres flexible-server firewall-rule list --name <server> --resource-group <rg>
az postgres flexible-server firewall-rule show --name <server> --resource-group <rg> \
  --rule-name <rule>
az postgres flexible-server firewall-rule update --name <server> --resource-group <rg> \
  --rule-name <rule> --start-ip-address <start> --end-ip-address <end>
az postgres flexible-server firewall-rule delete --name <server> --resource-group <rg> \
  --rule-name <rule> --yes
```

### Direct Connect / Execute

```bash
# Interactive connection
az postgres flexible-server connect --name <server> --admin-user <user> \
  --admin-password <pass> --database-name <db>

# Execute a query
az postgres flexible-server execute --name <server> --admin-user <user> \
  --admin-password <pass> --database-name <db> \
  --querytext "SELECT * FROM users LIMIT 10;"

# Execute from file
az postgres flexible-server execute --name <server> --admin-user <user> \
  --admin-password <pass> --database-name <db> --file-path ./query.sql
```

## Redis

### Cache Management

```bash
# Create a Redis cache
az redis create --name <cache> --resource-group <rg> --location <loc> \
  --sku Basic --vm-size c0

# List / show / update / delete
az redis list --resource-group <rg>
az redis show --name <cache> --resource-group <rg>
az redis update --name <cache> --resource-group <rg> --sku Standard --vm-size c1
az redis delete --name <cache> --resource-group <rg> --yes
```

### Keys

```bash
az redis list-keys --name <cache> --resource-group <rg>
az redis regenerate-keys --name <cache> --resource-group <rg> --key-type Primary
```

### Firewall Rules

```bash
az redis firewall-rules create --name <cache> --resource-group <rg> \
  --rule-name <rule> --start-ip <start> --end-ip <end>
az redis firewall-rules list --name <cache> --resource-group <rg>
az redis firewall-rules show --name <cache> --resource-group <rg> --rule-name <rule>
az redis firewall-rules delete --name <cache> --resource-group <rg> --rule-name <rule>
```

### Import / Export

```bash
# Import data from blob storage
az redis import --name <cache> --resource-group <rg> \
  --files "https://<storage>.blob.core.windows.net/<container>/dump.rdb" \
  --file-format RDB

# Export data to blob storage
az redis export --name <cache> --resource-group <rg> \
  --prefix <export-prefix> \
  --container "https://<storage>.blob.core.windows.net/<container>" \
  --file-format RDB
```

### Maintenance Operations

```bash
# Force reboot
az redis force-reboot --name <cache> --resource-group <rg> --reboot-type AllNodes

# Flush all data (Premium tier only)
az redis flush --name <cache> --resource-group <rg> --yes

# Patch schedule
az redis patch-schedule create --name <cache> --resource-group <rg> \
  --schedule-entries "[{\"dayOfWeek\":\"Monday\",\"startHourUtc\":2}]"
az redis patch-schedule show --name <cache> --resource-group <rg>
az redis patch-schedule delete --name <cache> --resource-group <rg>
```

## Gotchas

1. **Firewall rules required before connecting** — New SQL/MySQL/PostgreSQL servers block all external access by default. Add a firewall rule or use `--start-ip-address 0.0.0.0 --end-ip-address 255.255.255.255` for dev (never in production).

2. **Flexible server vs single server** — Always prefer `flexible-server` for MySQL and PostgreSQL. Single server is on the deprecation path. The CLI subcommands differ (`az mysql flexible-server` vs `az mysql server`).

3. **Cosmos DB partition keys are immutable** — Choose your partition key carefully at container creation time. Changing it later requires creating a new container and migrating data.

4. **Redis cache tiers affect available features** — `flush` requires Premium tier. Clustering, geo-replication, and data persistence are only available on Premium. Import/export requires Premium. Plan your tier based on feature requirements.

5. **Cosmos DB consistency levels** — Set at account level (`az cosmosdb update --default-consistency-level`). Can be relaxed per-request but never strengthened. Options: Strong > BoundedStaleness > Session > ConsistentPrefix > Eventual.

6. **SQL elastic pool DTU/vCore sharing** — Databases in a pool share resources. Monitor with `az sql elastic-pool show` and check `dtu_consumption_percent`.

7. **MySQL/PostgreSQL flexible-server create is interactive** — If run without all parameters, it prompts for values. Always supply `--admin-user`, `--admin-password`, `--location`, and `--yes` for scripted usage.

## Reference

- [Azure SQL CLI docs](https://learn.microsoft.com/en-us/cli/azure/sql)
- [Cosmos DB CLI docs](https://learn.microsoft.com/en-us/cli/azure/cosmosdb)
- [MySQL flexible-server CLI docs](https://learn.microsoft.com/en-us/cli/azure/mysql/flexible-server)
- [PostgreSQL flexible-server CLI docs](https://learn.microsoft.com/en-us/cli/azure/postgres/flexible-server)
- [Redis Cache CLI docs](https://learn.microsoft.com/en-us/cli/azure/redis)
