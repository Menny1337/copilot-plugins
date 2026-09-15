# Extract meeting action items

Read the root's config selection rule before any task lookup or write. Extraction
is backend-independent; persistence is not. For accepted items, use exactly the
selected backend: [markdown tasks](markdown-tasks.md), [ADO tasks](ado-tasks.md),
or [GitHub tasks](github-tasks.md), with its configuration and dedupe rules.

## 5. Action Item Extraction

When meeting notes contain action items (checkboxes with owners and dates):

1. Scan the `## Action Items` section for unchecked items: `- [ ] ...`
2. For each item, parse: task title, owner (@name), due date
3. Filter to items owned by the user (or unassigned)
4. Offer to add each as a task in the configured personal backend.
5. If accepted and the backend is `markdown`, add them as a single atomic batch (one lock, one commit) rather than one
   `task add` call per item:
   ```bash
   assistant-store import <<'EOF'
   [
     {"title": "Follow up with vendor", "due": "2026-04-20", "context": "@work", "source": "notes/meetings/2026-04-15-standup.md"},
     {"title": "Draft the migration doc", "priority": "P1"}
   ]
   EOF
   ```
   Each JSON item accepts `title` (required), and optionally `due`, `context`, `project`,
   `priority`, and `source`. The result reports a per-item outcome — an item whose title
   already exists among active tasks is reported as `duplicate: true` and skipped, not
   duplicated; everything else that failed validation is reported with its own `error`.
   Review `result.results` and tell the user what was actually added.
6. If accepted and the backend is `ado` or `github`, use that backend's create/dedupe
   procedure for each item instead of `assistant-store import`. Preserve owners,
   dates and source provenance, and report each actual result or inbox fallback.

---
