
# Azure Messaging & Event Services

## When to Use

- Provisioning or managing Service Bus, Event Hubs, or Event Grid resources
- Setting up message queues, topics, subscriptions, or event-driven architectures
- Managing auth rules and connection keys for messaging services

## When to Skip

- **Storage queues** — use `az-storage` skill instead
- **Application-level message handling** — sending/receiving messages in code is outside CLI scope

## Prerequisites

- Invoke Foundations section (az skill) for login, subscription, and resource group setup
- Relevant provider registered (`Microsoft.ServiceBus`, `Microsoft.EventHub`, `Microsoft.EventGrid`)

## Service Bus

### Namespaces

```bash
az servicebus namespace create -g <rg> -n <ns> --sku Standard --location <loc>
az servicebus namespace list -g <rg> -o table
az servicebus namespace show -g <rg> -n <ns>
az servicebus namespace update -g <rg> -n <ns> --sku Premium
az servicebus namespace delete -g <rg> -n <ns>
```

### Authorization Rules & Keys

```bash
az servicebus namespace authorization-rule create -g <rg> --namespace-name <ns> -n <rule> --rights Listen Send
az servicebus namespace authorization-rule list -g <rg> --namespace-name <ns> -o table
az servicebus namespace authorization-rule keys list -g <rg> --namespace-name <ns> -n <rule>
```

### Queues

```bash
az servicebus queue create -g <rg> --namespace-name <ns> -n <queue> --max-size 1024
az servicebus queue list -g <rg> --namespace-name <ns> -o table
az servicebus queue show -g <rg> --namespace-name <ns> -n <queue>
az servicebus queue update -g <rg> --namespace-name <ns> -n <queue> --default-message-time-to-live P14D
az servicebus queue delete -g <rg> --namespace-name <ns> -n <queue>
```

### Topics

```bash
az servicebus topic create -g <rg> --namespace-name <ns> -n <topic>
az servicebus topic list -g <rg> --namespace-name <ns> -o table
az servicebus topic show -g <rg> --namespace-name <ns> -n <topic>
az servicebus topic update -g <rg> --namespace-name <ns> -n <topic> --max-size 2048
az servicebus topic delete -g <rg> --namespace-name <ns> -n <topic>
```

### Topic Subscriptions

```bash
az servicebus topic subscription create -g <rg> --namespace-name <ns> --topic-name <topic> -n <sub>
az servicebus topic subscription list -g <rg> --namespace-name <ns> --topic-name <topic> -o table
az servicebus topic subscription show -g <rg> --namespace-name <ns> --topic-name <topic> -n <sub>
az servicebus topic subscription update -g <rg> --namespace-name <ns> --topic-name <topic> -n <sub> --max-delivery-count 10
az servicebus topic subscription delete -g <rg> --namespace-name <ns> --topic-name <topic> -n <sub>
```

## Event Hubs

### Namespaces

```bash
az eventhubs namespace create -g <rg> -n <ns> --sku Standard --location <loc>
az eventhubs namespace list -g <rg> -o table
az eventhubs namespace show -g <rg> -n <ns>
az eventhubs namespace delete -g <rg> -n <ns>
```

### Event Hubs

```bash
az eventhubs eventhub create -g <rg> --namespace-name <ns> -n <hub> --partition-count 4 --message-retention 7
az eventhubs eventhub list -g <rg> --namespace-name <ns> -o table
az eventhubs eventhub show -g <rg> --namespace-name <ns> -n <hub>
az eventhubs eventhub update -g <rg> --namespace-name <ns> -n <hub> --message-retention 3
az eventhubs eventhub delete -g <rg> --namespace-name <ns> -n <hub>
```

### Consumer Groups

```bash
az eventhubs eventhub consumer-group create -g <rg> --namespace-name <ns> --eventhub-name <hub> -n <cg>
az eventhubs eventhub consumer-group list -g <rg> --namespace-name <ns> --eventhub-name <hub> -o table
az eventhubs eventhub consumer-group delete -g <rg> --namespace-name <ns> --eventhub-name <hub> -n <cg>
```

### Authorization Rules & Keys

```bash
az eventhubs namespace authorization-rule create -g <rg> --namespace-name <ns> -n <rule> --rights Listen Send
az eventhubs namespace authorization-rule keys list -g <rg> --namespace-name <ns> -n <rule>
```

## Event Grid

### Custom Topics

```bash
az eventgrid topic create -g <rg> -n <topic> --location <loc>
az eventgrid topic list -g <rg> -o table
az eventgrid topic show -g <rg> -n <topic>
az eventgrid topic update -g <rg> -n <topic> --tags env=prod
az eventgrid topic delete -g <rg> -n <topic>
az eventgrid topic key list -g <rg> -n <topic>
```

### Event Subscriptions

```bash
# Webhook endpoint
az eventgrid event-subscription create -n <sub> --source-resource-id <topic-id> --endpoint https://example.com/api/events

# Azure Function / Storage Queue / Service Bus endpoint
az eventgrid event-subscription create -n <sub> --source-resource-id <topic-id> --endpoint-type servicebusqueue --endpoint <queue-id>

az eventgrid event-subscription list --source-resource-id <topic-id> -o table
az eventgrid event-subscription show -n <sub> --source-resource-id <topic-id>
az eventgrid event-subscription update -n <sub> --source-resource-id <topic-id> --included-event-types Microsoft.Storage.BlobCreated
az eventgrid event-subscription delete -n <sub> --source-resource-id <topic-id>
```

### System Topics

```bash
az eventgrid system-topic create -g <rg> -n <sys-topic> --topic-type Microsoft.Storage.StorageAccounts --source <storage-id> --location <loc>
az eventgrid system-topic list -g <rg> -o table
az eventgrid system-topic event-subscription create -g <rg> --system-topic-name <sys-topic> -n <sub> --endpoint <url>
```

### Domains

```bash
az eventgrid domain create -g <rg> -n <domain> --location <loc>
az eventgrid domain topic list -g <rg> --domain-name <domain> -o table
```

## Choosing Between Services

| Criteria | Service Bus | Event Hubs | Event Grid |
|---|---|---|---|
| **Pattern** | Enterprise messaging (request/reply, ordered delivery) | High-throughput streaming & telemetry | Reactive event routing |
| **Use when** | You need queues, topics, sessions, transactions, dead-lettering | Ingesting millions of events/sec, log/telemetry pipelines | Reacting to Azure resource events or custom pub/sub |
| **Ordering** | FIFO (with sessions) | Per-partition | Not guaranteed |
| **Retention** | Until consumed (or TTL) | Time-based (1–90 days) | 24h retry, then dead-letter |

## Gotchas

- **Namespace names are globally unique** across all of Azure — use a naming convention with org prefix
- **Service Bus vs Storage queues** — SB has richer features (sessions, dead-letter, topics); Storage queues are simpler and cheaper for basic scenarios
- **Event Grid webhook validation** — endpoints must handle the `SubscriptionValidation` handshake event or use the manual validation link
- **Event Hubs partitions are immutable** — you cannot change partition count after creation (except increasing on dedicated tier)
- **Premium vs Standard** — Service Bus Premium is required for VNET integration and large messages (>256 KB)

## Reference

- [Service Bus CLI docs](https://learn.microsoft.com/cli/azure/servicebus)
- [Event Hubs CLI docs](https://learn.microsoft.com/cli/azure/eventhubs)
- [Event Grid CLI docs](https://learn.microsoft.com/cli/azure/eventgrid)
- [Choose between messaging services](https://learn.microsoft.com/azure/event-grid/compare-messaging-services)
