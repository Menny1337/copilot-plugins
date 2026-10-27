## 1. Search Notes

### By Keyword

Search across all note files for a term:

```bash
grep -rl "search term" ~/.copilot/assistant/notes/ --include="*.md" 2>/dev/null
```

For content with context:

```bash
grep -r "search term" ~/.copilot/assistant/notes/ --include="*.md" -B 2 -A 2 2>/dev/null
```

### By Date Range

Find notes from a specific date:

```bash
ls ~/.copilot/assistant/notes/*/YYYY-MM-DD-*.md 2>/dev/null
```

Find notes from a date range (e.g., this week):

```bash
find ~/.copilot/assistant/notes/ -name "*.md" -newer /tmp/start_marker ! -newer /tmp/end_marker 2>/dev/null
```

Or use filename prefix matching for a month:

```bash
ls ~/.copilot/assistant/notes/*/2026-04-*.md 2>/dev/null
```

### By Type

List all notes of a specific type:

```bash
ls ~/.copilot/assistant/notes/meetings/ 2>/dev/null
ls ~/.copilot/assistant/notes/decisions/ 2>/dev/null
ls ~/.copilot/assistant/notes/ideas/ 2>/dev/null
ls ~/.copilot/assistant/notes/scratch/ 2>/dev/null
```

### Present Results

When presenting search results:

1. Show matching files with their titles (extracted from `# heading`)
2. Sort by date (most recent first)
3. Show a brief snippet of relevant content
4. Include the file path for reference
5. Offer to show full content of any result

Format:

```
📝 Found 3 notes matching "auth":

1. **Decision: Chose JWT over sessions** (2026-04-10)
   → ~/.copilot/assistant/notes/decisions/2026-04-10-chose-jwt.md

2. **Meeting: Design Review** (2026-04-14)
   → ~/.copilot/assistant/notes/meetings/2026-04-14-design-review.md
   "...discussed auth flow changes for the new..."

3. **Idea: Unified auth middleware** (2026-04-12)
   → ~/.copilot/assistant/notes/ideas/2026-04-12-unified-auth-middleware.md
```

---
