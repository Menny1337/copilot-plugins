
# Azure AI & Cognitive Services

## When to Use

- Provisioning Azure AI / Cognitive Services accounts (OpenAI, Vision, Speech, Language, etc.)
- Deploying and managing Azure OpenAI models (GPT-4, GPT-3.5-turbo, DALL-E, Whisper, embeddings)
- Retrieving access keys, checking quota/usage, managing commitment tiers
- Listing available models and regional capacity

## When to Skip

- **Calling AI APIs directly** (REST/SDK calls to chat completions, image generation, etc.) — this skill covers _resource management_, not API consumption
- **Azure Machine Learning / ML Studio** — separate service, use `az ml` commands
- **Non-Azure AI services** (OpenAI API directly, HuggingFace, etc.)

## Prerequisites

- **Foundations** section in the az skill — login, subscription selection, resource group basics
- `az extension add --name cognitiveservices` if commands are missing (usually built-in)
- Appropriate role: **Cognitive Services Contributor** for resource management, **Cognitive Services OpenAI Contributor** for deployments

## Accounts

Create and manage Cognitive Services accounts. The `--kind` parameter determines the service type.

```bash
# Create an Azure OpenAI account
az cognitiveservices account create \
  --name my-openai \
  --resource-group my-rg \
  --location eastus \
  --kind OpenAI \
  --sku S0 \
  --custom-domain my-openai

# List all cognitive services accounts in a resource group
az cognitiveservices account list --resource-group my-rg -o table

# Show details of a specific account
az cognitiveservices account show --name my-openai --resource-group my-rg

# Update (e.g., add network rules, tags)
az cognitiveservices account update \
  --name my-openai \
  --resource-group my-rg \
  --tags env=dev team=infra

# Delete
az cognitiveservices account delete --name my-openai --resource-group my-rg
```

> `--custom-domain` is required for Azure OpenAI — it sets the endpoint hostname.

## Keys

```bash
# List access keys
az cognitiveservices account keys list \
  --name my-openai --resource-group my-rg

# Regenerate a key (key1 or key2)
az cognitiveservices account keys regenerate \
  --name my-openai --resource-group my-rg --key-name key1
```

Use keys for REST calls or SDK auth. For production, prefer **Managed Identity** + RBAC over keys.

## Model Deployments (OpenAI)

The most common workflow — deploying models to an Azure OpenAI account.

```bash
# Deploy GPT-4o
az cognitiveservices account deployment create \
  --name my-openai \
  --resource-group my-rg \
  --deployment-name gpt4o-deploy \
  --model-name gpt-4o \
  --model-version "2024-08-06" \
  --model-format OpenAI \
  --sku-capacity 10 \
  --sku-name Standard

# Deploy GPT-3.5-turbo
az cognitiveservices account deployment create \
  --name my-openai \
  --resource-group my-rg \
  --deployment-name gpt35-deploy \
  --model-name gpt-35-turbo \
  --model-version "0125" \
  --model-format OpenAI \
  --sku-capacity 10 \
  --sku-name Standard

# Deploy an embeddings model
az cognitiveservices account deployment create \
  --name my-openai \
  --resource-group my-rg \
  --deployment-name embeddings-deploy \
  --model-name text-embedding-ada-002 \
  --model-version "2" \
  --model-format OpenAI \
  --sku-capacity 10 \
  --sku-name Standard

# List deployments
az cognitiveservices account deployment list \
  --name my-openai --resource-group my-rg -o table

# Show a specific deployment
az cognitiveservices account deployment show \
  --name my-openai --resource-group my-rg --deployment-name gpt4o-deploy

# Delete a deployment
az cognitiveservices account deployment delete \
  --name my-openai --resource-group my-rg --deployment-name gpt4o-deploy
```

> `--sku-capacity` is in thousands of tokens per minute (TPM). Value of 10 = 10K TPM.

## Models & Capacity

```bash
# List available models for a location
az cognitiveservices model list --location eastus -o table

# Filter to OpenAI models only
az cognitiveservices model list --location eastus \
  --query "[?kind=='OpenAI']" -o table

# Check usage/quota for a subscription in a region
az cognitiveservices usage list --location eastus -o table

# List commitment tier options (for provisioned throughput)
az cognitiveservices commitment-tier list --location eastus -o table
```

## Service Kinds

| Kind               | Service                  | Common SKU | Notes                              |
|--------------------|--------------------------|------------|------------------------------------|
| `OpenAI`           | Azure OpenAI             | `S0`       | GPT, DALL-E, Whisper, embeddings   |
| `ComputerVision`   | Computer Vision          | `S1`       | Image analysis, OCR                |
| `SpeechServices`   | Speech                   | `S0`       | STT, TTS, translation              |
| `TextAnalytics`    | Language (Text Analytics)| `S`        | Sentiment, NER, key phrases        |
| `TextTranslation`  | Translator               | `S1`       | Text translation (100+ languages)  |
| `ContentSafety`    | Content Safety           | `S0`       | Text/image moderation              |
| `FormRecognizer`   | Document Intelligence    | `S0`       | Document extraction, custom models |

> Use `az cognitiveservices account list-kinds` to see all available kinds.

## Gotchas

1. **Regional availability varies significantly** — GPT-4o may be in `eastus` and `swedencentral` but not `westus2`. Always check `az cognitiveservices model list --location <region>` before creating accounts.
2. **Quota limits per subscription/region** — Each subscription has TPM limits per model per region. Request increases via Azure Portal support.
3. **`--kind` vs `--sku`** — `kind` is the service type (OpenAI, ComputerVision), `sku` is the pricing tier (S0, S1). Don't confuse them.
4. **Deployment names are user-defined** — The `--deployment-name` you choose is what you use in API calls, not the model name. Keep them descriptive.
5. **`--custom-domain` is required for OpenAI** — Without it, you won't get a usable endpoint. Set it at account creation time.
6. **Model version matters** — Specify `--model-version` explicitly. Omitting it may default to an older version.
7. **Provisioned vs Standard** — `Standard` SKU is pay-per-token; `ProvisionedManaged` is reserved capacity (commitment tiers). Start with Standard.

## Reference

- [Azure OpenAI CLI docs](https://learn.microsoft.com/cli/azure/cognitiveservices)
- [Azure OpenAI models](https://learn.microsoft.com/azure/ai-services/openai/concepts/models)
- [Regional model availability](https://learn.microsoft.com/azure/ai-services/openai/concepts/models#model-summary-table-and-region-availability)
- [Quota and limits](https://learn.microsoft.com/azure/ai-services/openai/quotas-limits)
- [az cognitiveservices reference](https://learn.microsoft.com/cli/azure/cognitiveservices)
