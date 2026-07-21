
# Azure DevOps Wiki Skill

Manage Azure DevOps wiki pages via the `az devops wiki` CLI. Covers CRUD operations on wikis and pages, the critical path-encoding gotchas, eTag-based versioning for updates, and the `az devops invoke` escape hatch for advanced operations.


## When to Use

- Reading, creating, updating, or deleting ADO wiki pages
- Listing wikis or browsing page trees in an Azure DevOps project
- Automating documentation workflows against ADO wikis
- Querying wiki page content or metadata programmatically

## When to Skip

- **GitHub wikis** — use `gh` CLI or the GitHub MCP tools instead
- **Other ADO operations** (boards, pipelines, repos) — use the appropriate reference file
- **Git-based wiki edits** — if you've cloned the wiki repo locally, just use `git` directly


## Prerequisites

- **Foundations (in az skill)** — ensure `az` CLI is installed and authenticated (`az login`)
- **Azure DevOps extension** installed:
  ```bash
  az extension add --name azure-devops
  ```
- **Defaults configured** (avoids passing `--org` and `--project` on every command):
  ```bash
  az devops configure --defaults \
    organization=https://dev.azure.com/<org> \
    project='<project>'
  ```
- Verify with:
  ```bash
  az devops configure --list
  ```


## Wiki CRUD

### List all wikis in the project
```bash
az devops wiki list
```

### Show wiki metadata
```bash
az devops wiki show --wiki '<wiki-name>'
```

### Create a new project wiki
```bash
az devops wiki create --name '<wiki-name>' --type projectWiki
```

### Create a code wiki (backed by a repo)
```bash
az devops wiki create --name '<wiki-name>' --type codeWiki \
  --repository '<repo-id>' --mapped-path '/' --version '<branch>'
```

### Delete a wiki
```bash
az devops wiki delete --wiki '<wiki-name>'
```


## Page Operations

> **This is the core of the skill.** Every page operation requires `--wiki` and `--path`.

### Read a page

```bash
az devops wiki page show \
  --wiki '<wiki-name>' \
  --path '<path>' \
  --include-content
```

> ⚠️ **`--include-content` is REQUIRED** to get actual page content. Without it, the `content` field is empty/null. This is the single most common mistake.

The response includes:
- `content` — the raw Markdown of the page (only if `--include-content` is passed)
- `eTag` — version identifier needed for updates (returned in the response object)
- `gitItemPath` — the file path in the backing git repo
- `path` — the wiki path
- `subPages` — list of child pages (if any)

### Create a page

```bash
az devops wiki page create \
  --wiki '<wiki-name>' \
  --path '<path>' \
  --content '<markdown-content>'
```

- The path defines the page hierarchy: `/Parent/Child/Grandchild`
- Parent pages are created automatically if they don't exist
- Content is raw Markdown

For long content, use file input:
```bash
az devops wiki page create \
  --wiki '<wiki-name>' \
  --path '<path>' \
  --file-path './page-content.md'
```

### Update a page

```bash
az devops wiki page update \
  --wiki '<wiki-name>' \
  --path '<path>' \
  --content '<new-markdown-content>' \
  --version '<eTag>'
```

> ⚠️ **`--version` (the eTag) is REQUIRED.** Updates without the correct eTag will fail. This is optimistic concurrency control — you must read first, then update with the eTag you received.

**The update workflow is always two steps:**
1. `show --include-content` → extract the `eTag`
2. `update --version <eTag>` → apply changes

For long content, use file input:
```bash
az devops wiki page update \
  --wiki '<wiki-name>' \
  --path '<path>' \
  --file-path './updated-content.md' \
  --version '<eTag>'
```

### Delete a page

```bash
az devops wiki page delete \
  --wiki '<wiki-name>' \
  --path '<path>'
```

- Deleting a parent page deletes all its subpages
- This is **not reversible** via CLI (you'd need to restore from git history)


## Common Workflows

### 1. Read a page and its content

```bash
# Get the page with content
PAGE=$(az devops wiki page show \
  --wiki 'MyWiki' \
  --path '/Engineering/Onboarding' \
  --include-content)

# Extract content
echo "$PAGE" | jq -r '.content'

# Extract eTag (needed for updates)
echo "$PAGE" | jq -r '.eTag'
```

### 2. Update a page (get eTag first, then update)

```bash
# Step 1: Get current page and its eTag
ETAG=$(az devops wiki page show \
  --wiki 'MyWiki' \
  --path '/Engineering/Onboarding' \
  --include-content \
  | jq -r '.eTag')

# Step 2: Update with the eTag
az devops wiki page update \
  --wiki 'MyWiki' \
  --path '/Engineering/Onboarding' \
  --content '# Onboarding\n\nUpdated content here.' \
  --version "$ETAG"
```

### 3. Create a new page under a parent

```bash
# Create a child page — parent is created automatically if needed
az devops wiki page create \
  --wiki 'MyWiki' \
  --path '/Engineering/Onboarding/Day One Checklist' \
  --content '# Day One Checklist\n\n- [ ] Set up dev environment\n- [ ] Read team wiki'
```

### 4. List subpages of a parent page

```bash
# Show the parent page — subPages field lists children
az devops wiki page show \
  --wiki 'MyWiki' \
  --path '/Engineering' \
  --include-content \
  | jq '.subPages'
```

> Note: This only returns **direct** children, not the full recursive tree. For recursive listing, use `az devops invoke` (see below).


## `az devops invoke` Escape Hatch

For operations the `az devops wiki page` CLI doesn't support natively, drop down to the REST API via `az devops invoke`.

### Recursive page tree

Get the full page tree (all descendants) for a path:

```bash
az devops invoke \
  --area wiki \
  --resource pages \
  --route-parameters wikiIdentifier='<wiki-id>' \
  --query-parameters path='<path>' recursionLevel=full \
  --api-version 7.1
```

- `<wiki-id>` — the wiki ID (GUID) or name from `az devops wiki list`
- `recursionLevel` — `none` (default), `oneLevel`, or `full`
- The response includes nested `subPages` arrays for the entire tree

### Batch operations

The REST API doesn't have a native batch endpoint for wiki pages, but you can script it:

```bash
# Create multiple pages from a directory of markdown files
for file in ./docs/*.md; do
  PAGE_NAME=$(basename "$file" .md)
  az devops wiki page create \
    --wiki 'MyWiki' \
    --path "/Imported/$PAGE_NAME" \
    --file-path "$file"
done
```

### Get page by ID (instead of path)

```bash
az devops invoke \
  --area wiki \
  --resource pages \
  --route-parameters wikiIdentifier='<wiki-id>' pageId=<page-id> \
  --query-parameters includeContent=true \
  --api-version 7.1
```

### Get page stats (view counts)

```bash
az devops invoke \
  --area wiki \
  --resource pageStats \
  --route-parameters wikiIdentifier='<wiki-id>' \
  --query-parameters pageId=<page-id> \
  --api-version 7.1
```


## ⚠️ Gotchas

> **This is the most important section.** These are real pain points from production use.

### 1. URL Paths Use Hyphens, API Paths Use Spaces

**This is the #1 trap.** When you see a wiki page URL in the browser like:

```
https://dev.azure.com/<org>/<project>/_wiki/wikis/<wiki>/USX-Case-Management/Overview
```

The hyphens in `USX-Case-Management` are **URL-encoded spaces**. The actual API path uses spaces:

```bash
# ❌ WRONG — will 404
az devops wiki page show --wiki 'MyWiki' --path '/USX-Case-Management/Overview' --include-content

# ✅ CORRECT — spaces in the path
az devops wiki page show --wiki 'MyWiki' --path '/USX Case Management/Overview' --include-content
```

**Rule:** Always convert hyphens in URL paths back to spaces for CLI/API calls. If a page title genuinely contains a hyphen, it will be double-encoded in the URL (as `%2D`).

### 2. `--include-content` Is Not Optional

```bash
# ❌ Returns metadata only — content field is empty/null
az devops wiki page show --wiki 'MyWiki' --path '/My Page'

# ✅ Returns actual Markdown content
az devops wiki page show --wiki 'MyWiki' --path '/My Page' --include-content
```

You will **always** want `--include-content`. There is almost no use case for omitting it. Forget this flag once, waste 10 minutes wondering why content is null.

### 3. eTag Is Required for Updates

```bash
# ❌ FAILS — missing --version
az devops wiki page update --wiki 'MyWiki' --path '/My Page' --content 'New content'

# ✅ WORKS — includes eTag from previous show command
az devops wiki page update --wiki 'MyWiki' --path '/My Page' --content 'New content' --version '<eTag>'
```

The eTag changes with every update. You **cannot** cache it — always fetch it fresh immediately before updating. The two-step read-then-update pattern is mandatory.

### 4. Parent Pages Return Subpage Links

When you read a parent page that has subpages, the `content` field often contains auto-generated subpage links (like a table of contents). This is expected behavior — the wiki system injects these. Don't be surprised if the content looks different from what you set.

### 5. Wiki Names with Spaces Need Quoting

```bash
# ❌ Shell splits the argument
az devops wiki page show --wiki My Wiki --path '/Page'

# ✅ Quoted properly
az devops wiki page show --wiki 'My Wiki' --path '/Page'
```

### 6. Page Paths Must Start with `/`

```bash
# ❌ Missing leading slash — may error or behave unexpectedly
az devops wiki page show --wiki 'MyWiki' --path 'Engineering/Onboarding' --include-content

# ✅ Leading slash is required
az devops wiki page show --wiki 'MyWiki' --path '/Engineering/Onboarding' --include-content
```

### 7. Two Organization URL Formats

Azure DevOps supports two URL formats. Make sure your defaults match what your org uses:

```bash
# Modern format
az devops configure --defaults organization=https://dev.azure.com/<org>

# Legacy format (still active for many orgs)
az devops configure --defaults organization=https://<org>.visualstudio.com
```

Both work, but mixing them (e.g., setting one format as default but passing the other inline) can cause auth failures.

### 8. Special Characters in Page Paths

Page paths with special characters (parentheses, ampersands, etc.) need careful quoting:

```bash
# Use single quotes to prevent shell interpretation
az devops wiki page show \
  --wiki 'MyWiki' \
  --path '/FAQ (Frequently Asked Questions)' \
  --include-content
```


## Reference

- [az devops wiki CLI reference](https://learn.microsoft.com/en-us/cli/azure/devops/wiki)
- [az devops wiki page CLI reference](https://learn.microsoft.com/en-us/cli/azure/devops/wiki/page)
- [Azure DevOps Wiki REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wiki)
- [az devops invoke usage](https://learn.microsoft.com/en-us/cli/azure/devops#az-devops-invoke)
