---
name: memory
description: "Read, write, and search persistent cross-session memory for Copilot agents. Use when retrieving context, recording facts or preferences, or recalling project knowledge from `~/.copilot/memory/`."
user-invocable: false
---

# Memory

Persistent memory for Copilot CLI agents. Memory lives in `~/.copilot/memory/`.

Markdown files are the source of truth — human-readable, LLM-native, git-versionable. Agents read and write them directly via `view` and `edit` tools.

## When to Use

- **Session start** — Load shared memory and relevant project/topic files
- **Learned something new** — A fact, decision, pattern, or preference worth remembering across sessions
- **Need historical context** — What was done before, what patterns were learned, what decisions were made
- **Completing significant work** — Record an episode for future reference
- **Working in a specific project** — Load project-specific memory for conventions and past work

## When to Skip

- Temporary task state — use the per-session `sql` tool instead (todos, scratch tables)
- Raw conversation logs — the session store already captures these
- Sensitive credentials or secrets — never persist these
- Unverified information — confirm before persisting
- Agent-operational data that only one agent needs — use that agent's workspace instead (e.g., `~/.copilot/oncall/` for shift data, `~/.copilot/agent-architect/` for agent inventory)

## Directory Structure

```
~/.copilot/memory/
├── MEMORY.md              # Cross-agent shared knowledge (read this first)
├── user.md                # Personal profile and durable preferences
├── projects/              # Per-project memory
│   └── {repo-name}.md
├── conventions/           # Optional — standing rules / how-to-act (procedural memory)
│   └── {rule}.md
├── topics/                # Optional — cross-project knowledge, create on first use
│   └── {topic}.md
└── episodes/              # Optional — significant event history, create on first use
    └── YYYY-MM-DD-{slug}.md
```

`conventions/`, `topics/`, and `episodes/` are optional paths. Create them when you first
need them rather than assuming they already exist.

### Memory tiers (what each location is for)

This layout maps onto the standard agent-memory tiers (CoALA). Use it to route a write to
the right place — pick the tier first, then the file:

| Tier | Stores | Lives in |
|------|--------|----------|
| **Semantic** (facts) | durable facts, preferences, decisions, patterns | `MEMORY.md`, `user.md`, `projects/`, `topics/` |
| **Procedural** (rules) | standing "always do X" rules / conventions | `conventions/` |
| **Episodic** (events) | significant completed work, what happened when | `episodes/` |

(Working memory — the live task — is *not* persisted here; use the per-session `sql` tool.)

## Procedure

> **Memory operations use semantic file tools, not shell shortcuts.** Tool names vary by
> host: read with `view`/`read`, search with `rg`/`grep`/`glob`, and write with
> `apply_patch`/`edit`/`create`. Do not substitute `cat`, `head`, `tail`, `sed`, shell
> `grep`/`find`/`ls`, or heredoc appends when a semantic file tool can perform the operation.
> Shell is appropriate only for unsupported filesystem operations such as creating a parent
> directory. This preserves section targeting, prior inspection, and the `Last Updated`
> discipline below.

### 1. READ — Load Relevant Memory at Session Start

Establish memory context once per agent context. Read the shared memory index first if it
is not already present in the current context:

```
view ~/.copilot/memory/MEMORY.md
```

Then search by the task's project, topic, people, or decision terms and read only the
matching files or sections. If working in a specific project, check its project memory:

```
view ~/.copilot/memory/projects/{repo-name}.md
```

If working on a specific topic and a topic file already exists, read it. Topic memory is
optional and created on demand.

Do not re-read a full memory file that is already in the current context. For follow-up
lookups, use `rg`/`grep` and targeted `view` ranges. A delegated agent has its own context,
but should still prefer task-scoped search over loading broad profile or workspace memory
that the delegated task does not need.

**Quick-load pattern:** For agents that also have their own workspace memory
(agent-architect, oncall), use the shared index for cross-agent context, then search the
agent-specific memory for operational details relevant to the task. Read that workspace's
full `MEMORY.md` only when the task needs broad operational context.

### 2. WRITE — Store New Knowledge

When you learn something worth remembering across sessions, decide the scope and update the right file.

**Scope decision:**

| What you learned | Where to write | Example |
|------------------|----------------|---------|
| User preference or convention | `MEMORY.md` → Learned Patterns or Conventions | "the user prefers Geist font over Inter" |
| Project-specific fact | `projects/{repo}.md` | "SampleProject uses React Query for state" |
| Cross-project domain knowledge | `topics/{topic}.md` | "React error boundaries belong at route level" |
| Standing rule / "always do X" (procedural) | `conventions/{rule}.md` | "ADO work-item comments must be HTML, not Markdown" |
| Key architectural decision | `MEMORY.md` → Key Decisions | "Chose hybrid MD+SQLite for memory" |
| Significant completed work | `episodes/YYYY-MM-DD-{slug}.md` | "Designed agentic memory system" |

**How to write:**

1. Choose the correct target file/tier from the scope decision table above.
2. If the parent directory does not exist yet (most commonly `conventions/`, `topics/`, or `episodes/`), create it first.
3. **Search before you write.** This is the most important step — it prevents the #1 memory failure mode (silently contradicting a fact that is already stored). grep the target file (and `MEMORY.md`) for the subject first, then:
   - **No existing entry** → add a new entry in the right section.
   - **Existing entry still true** → stop. Do not write a duplicate.
   - **Existing entry now wrong/outdated** → update it *in place* and mark it superseded (below). Never append a second, contradictory bullet next to the old one.
4. If the file doesn't exist yet, use `create` to make it with a standard header:

```markdown
# Topic Memory: {Topic Name}

**Last Updated:** YYYY-MM-DD

## Patterns That Work

## Anti-Patterns Discovered

## Sources
```

5. Always update the `**Last Updated:**` date when modifying a file.

**Entry format** — every fact follows one shape so it stays datable, auditable, and de-duplicatable:

```markdown
- _(YYYY-MM-DD)_ <one specific, operational fact>. — src: <session / PR / file / why>
```

- The leading `_(YYYY-MM-DD)_` stamp is **required** — without per-entry dates, staleness is invisible (a file-level `Last Updated` can't tell you which bullet is stale).
- `src:` is **required** — provenance is what lets a future agent audit or safely delete the fact.
- If *you inferred* a fact rather than the user stating it, say so: `… — src: agent-inferred from <X>`. If you are not sure, tag it `(tentative)` instead of asserting it.

**Updating / superseding a fact** (conflict resolution) — never let two contradictory bullets coexist. Edit the old entry in place (or replace it) and record what it supersedes:

```markdown
- _(2026-05-30, supersedes 2026-01-10)_ Zustand replaced React Query for local UI state. — src: PR #123, user-confirmed
```

The newest dated fact wins.

**Trust boundary** (whose facts may overwrite whose):

- **User-stated / confirmed** facts are high-trust — only supersede them on explicit user instruction or a clearly stronger source.
- **Agent-inferred** facts are low-trust — later evidence may freely update them.
- An agent-inferred write must **never** silently overwrite a user-stated fact.

**Writing standards:**

- Be specific and operational: "Build fails if Node > 20.x (pin to 20.11.1)" not "Node version matters"
- One fact per bullet — don't bury multiple learnings in one paragraph
- Prefer tables for structured data (decisions, comparisons, inventories)

### 3. SEARCH — Find Relevant Memories

**For keyword search across memory files**, use the `grep` tool scoped to memory:

- `pattern`: your search term, `paths`: `~/.copilot/memory/`, `glob`: `*.md`
- default `output_mode` (`files_with_matches`) lists matching files; use
  `output_mode: "content"` with `-C 2` for matching lines plus surrounding context.

(If the `grep` tool is unavailable, fall back to `grep -r "search term" ~/.copilot/memory/ --include="*.md"`.)

**For searching past sessions** (what was done before):

```sql
-- Via the sql tool (database: session_store)
SELECT content, session_id, source_type
FROM search_index
WHERE search_index MATCH 'your search terms'
ORDER BY rank LIMIT 10;
```

**For finding which sessions touched a file:**

```sql
-- Via the sql tool (database: session_store)
SELECT s.id, s.summary, sf.file_path
FROM session_files sf JOIN sessions s ON sf.session_id = s.id
WHERE sf.file_path LIKE '%search-term%'
ORDER BY s.created_at DESC LIMIT 10;
```

### 4. DISTILL — Compress Old Memories

When a memory file grows large (> 200 lines), distill it. The key insight from research: **distill, don't summarize.** Summarization loses operational specifics.

**Distillation process:**

1. For each old entry, separate into:
   - **Narrative** (one line): "Debugged redirect middleware, fixed image asset URLs"
   - **Facts** (operational specifics): "Build gets env vars from SAM scripts, not Vercel"
2. Keep the facts. Abstract the narratives.
3. Archive the full original in `episodes/` if historically significant, creating that directory on first use if needed.
4. Update the file with the distilled version.

**When to distill:**
- A file exceeds 200 lines
- Right after recording a major episode — consolidate the raw events into the durable facts worth keeping (reflection: turn episodic detail into semantic facts)
- Entries older than 30 days that haven't been accessed
- Before a major reorganization of memory content

### 5. MAINTAIN — Keep Memory Clean

**Start with the linter.** Memory rules only hold if they're enforced, so run the bundled
structural linter first to get a worklist. From this skill's directory:

```
node scripts/lint-memory.mjs
```

> **Runs automatically too.** When `core-skills` is installed, a `sessionStart` hook
> (`hooks/lint-memory-advisory.sh`) runs this linter in advisory mode at the start of every
> session — scanning the shared `~/.copilot/memory/` tree **and** each agent-workspace
> `MEMORY.md` (see "Workspace coverage" below) — surfacing any drift via context, staying
> silent when memory is clean, and never blocking startup. The manual run below is still the
> way to get the full report and fix items.

**Responding to the sessionStart advisory.** The auto-injected advisory is *non-blocking
background awareness*, not a task. When you receive it:
- **Do not** interrupt, derail, or re-scope the user's current request to fix memory, and do
  not announce the drift unprompted.
- **Do** act when memory work is already in scope, when the user asks about memory health, or
  at a natural stopping point — then fix items here (errors first), newest run wins.
- It is silent when memory is clean, so its presence always means there is something to fix
  *eventually* — not necessarily *now*.

It scans `~/.copilot/memory/` (override with `MEMORY_DIR=/path` or a positional arg) and reports:
- ❌ **errors** — future-dated stamps (a real bug); exits non-zero.
- ⚠️ **warnings** — missing/`non-bold` `**Last Updated:**`, files over 200 lines (distill), duplicate project files (merge).
- ℹ️ **info** — files outside the documented locations (review/move; never auto-deleted).

Add `--strict` to fail on warnings too, or `--json` for machine output. The linter only
*reports* — it never edits or deletes. If the script isn't available in this context, fall
back to the manual checklist below.

**Workspace coverage (`--workspace`).** Agent-workspace dirs (e.g. `~/.copilot/agent-architect/`,
`~/.copilot/oncall/`) keep a living `MEMORY.md` plus freeform notes, but they don't use the
shared tree's `projects/topics/episodes/conventions` layout. Run them with `--workspace` to apply
only the layout-agnostic checks:

```
node scripts/lint-memory.mjs --workspace ~/.copilot/agent-architect
```

In this mode the linter checks future-dated stamps (all files) and applies the `**Last Updated:**`
freshness and >200-line distill checks **only to `MEMORY.md`** (so intentionally-long handoffs,
audits, and research dumps aren't flagged), and it **skips** the orphan/location and
duplicate-project checks. The sessionStart hook lints every `~/.copilot/*/MEMORY.md` this way in
addition to the shared tree.

**Then, periodically (every ~10 sessions or when the linter/your judgement flags drift):**

- Fix anything the linter reported (future dates, format, duplicates, oversized files)
- Remove facts that are no longer true
- Consolidate duplicate entries
- Move project-specific knowledge from `MEMORY.md` to `projects/`
- Move domain knowledge from project files to `topics/` (creating that directory if needed)
- Update `**Last Updated:**` dates

## Memory Types Reference

| Type | When to Store | Example |
|------|---------------|---------|
| `fact` | Confirmed, durable knowledge | "SampleProject uses React 19" |
| `preference` | User or project convention | "Prefer arrow functions over function declarations" |
| `decision` | Choice made with rationale | "Chose JWT over session auth because..." |
| `pattern` | Recurring approach that works | "Error boundaries at route level, not component level" |
| `convention` | Standing rule for how to act (procedural) | "ADO comments must be HTML — store in `conventions/`" |
| `episode` | Significant event | "Migrated auth system on 2026-02-15" |

## Episode File Template

For `episodes/YYYY-MM-DD-{slug}.md`:

```markdown
# Episode: {Title}

**Date:** YYYY-MM-DD
**Agents Involved:** {agent1, agent2}
**Session:** {session-id if known}

## What Happened

{Brief narrative — 2-3 sentences}

## Key Facts

- {Operational specific 1}
- {Operational specific 2}

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| ... | ... |

## Artifacts

- {File paths, PR numbers, links}
```
