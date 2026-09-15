# Related context and stale items

Use [note search](notes.md) for local notes. Before searching or scanning tasks,
follow the root's config selection and read only the selected task-query
reference. In ADO/GitHub mode, use its task queries instead of `tasks.md`.

## 6. Context Surfacing

When the user mentions a topic, project, or person, proactively surface related context:

### Trigger Detection

Listen for mentions of:
- Project names (`+ExampleProject`, `+ExampleApp`)
- People names (check against MEMORY.md contacts)
- Technical topics that match note titles or tags

### Surface Process

1. Search notes for the mentioned term
2. Search tasks for the term
3. Search decisions for the term
4. Present a brief context summary:

```
💡 Related context for "ExampleProject":

📝 Recent notes: Design Review (Apr 14), Auth Decision (Apr 10)
📋 Open tasks: 2 (Review example PR #1001, Fix auth redirect)
🏗️ Decisions: Chose JWT over sessions (Apr 10)
```

Only surface context when it adds value — don't interrupt the flow for marginal matches.

---

## 7. Stale Item Detection

Flag items that may need attention:

### Criteria

- **Stale tasks**: Active tasks created > 7 days ago with no updates
- **Abandoned ideas**: Ideas in `raw` status for > 14 days
- **Open action items**: Unchecked items in meeting notes > 3 days old

### Scan Command

```bash
# Find notes older than 7 days
find ~/.copilot/assistant/notes/ -name "*.md" -mtime +7 2>/dev/null
```

Surface stale items during daily briefing or weekly review, not on every interaction.

---
