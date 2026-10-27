## 2. Note Creation

### General Process

1. Determine note type: `meeting`, `decision`, `idea`, or `scratch`
2. Determine the title, and a date if the user specified one other than today
3. Read the template from `~/.copilot/assistant/templates/<type>.md` and fill it in with
   the provided information (see the per-type field lists below) — this becomes the note's content
4. Run the gateway, piping the filled-in content on stdin:
   ```bash
   assistant-store create-note --type <type> --title "<title>" [--date YYYY-MM-DD] <<'EOF'
   <filled-in template content>
   EOF
   ```
   It generates the `YYYY-MM-DD-<slug>.md` filename (today in UTC unless `--date` is
   given), reserves the name exclusively (a same-title collision on the same date gets a
   deterministic `-2`, `-3`, ... suffix — see §6), and writes the file durably. It returns
   the final `path` in its JSON result.
5. Confirm with: file path, type, and brief summary

### Meeting Notes

**Path:** `~/.copilot/assistant/notes/meetings/YYYY-MM-DD-<slug>.md`

Fill the meeting template with:
- **Title** — Meeting name or topic
- **Date** — Date and time if known
- **Attendees** — Names mentioned by the user
- **Type** — Classify: standup, design-review, 1:1, planning, retro, sync
- **Agenda** — Topics if provided
- **Discussion** — Key points from the user's description
- **Decisions** — Any decisions mentioned (table format)
- **Action Items** — Tasks with owners and due dates as checkboxes

After creating meeting notes, **always offer**: "Want me to add the action items as tasks?"

### Decision Records

**Path:** `~/.copilot/assistant/notes/decisions/YYYY-MM-DD-<slug>.md`

Fill the decision template with:
- **Title** — What was decided
- **Status** — `proposed`, `accepted`, or `superseded`
- **Context** — Why this decision was needed
- **Options** — Alternatives considered (if the user mentions any)
- **Decision** — What was chosen and why
- **Consequences** — What changes as a result

### Idea Notes

**Path:** `~/.copilot/assistant/notes/ideas/YYYY-MM-DD-<slug>.md`

Fill the idea template with:
- **Title** — Brief name for the idea
- **Tags** — Relevant keywords
- **Status** — `raw` (default for new ideas)
- **The Idea** — Description
- **Why It Matters** — Problem/opportunity
- **Next Steps** — How to explore or validate

### Scratch Notes

**Path:** `~/.copilot/assistant/notes/scratch/YYYY-MM-DD-<slug>.md`

The most flexible format. Use when:
- The user says "note" without specifying a type
- Content doesn't fit meeting/decision/idea templates
- Quick capture of a thought, link, snippet, or observation

Fill with:
- **Title** — Brief description
- **Tags** — Keywords if obvious from context
- **Content** — Whatever the user provided, formatted for readability

---

## 6. File Naming Convention

All note files follow this pattern:

```
YYYY-MM-DD-<slug>.md
```

- **Date**: UTC date of creation
- **Slug**: kebab-case, max 50 characters, descriptive
- Generate date: `date -u +%Y-%m-%d`

Examples:
- `2026-04-15-standup.md`
- `2026-04-15-chose-react-query-for-state.md`
- `2026-04-15-agent-testing-framework.md`
- `2026-04-15-quick-thought-on-caching.md`

If a file with the same name already exists, append a sequence number: `2026-04-15-standup-2.md`

---
