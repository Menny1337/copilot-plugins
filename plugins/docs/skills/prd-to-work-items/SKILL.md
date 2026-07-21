---
name: prd-to-work-items
description: 'Decompose and create vertical-slice work items from a PRD with dependency tracking. Use when breaking down a PRD, feature spec, or requirements document into trackable GitHub issues or ADO work items using tracer bullet methodology.'
---

# PRD to Work Items

Break a PRD into independently-grabbable work items using vertical slices (tracer bullets). Each work item is a thin end-to-end slice through all integration layers, not a horizontal layer-by-layer breakdown.

## When to Use

- A PRD or feature spec exists and needs to be decomposed into implementable work items
- Breaking down a large feature into parallelizable tasks
- Creating a sprint backlog from a requirements document
- Need dependency-tracked work items with acceptance criteria

## When to Skip

- **No PRD exists yet** — use `write-prd` first to create one
- **Single-task feature** — if it's one work item, just create it directly
- **Already decomposed** — if the PRD was written with individual tasks, just create them
- **Spike / investigation** — research tasks don't decompose into vertical slices

## Concepts

### Vertical Slices (Tracer Bullets)

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every integration layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- The first slice should be the simplest possible end-to-end path (the "hello world" tracer bullet)
- Later slices add breadth: edge cases, additional user stories, polish
- NFR slices (performance, accessibility hardening) come after functional slices
</vertical-slice-rules>

### T-Shirt Sizing

| Size | Meaning |
|------|---------|
| **S** | A few hours — isolated change, clear path, minimal risk |
| **M** | A day or two — crosses a couple layers, some decisions needed |
| **L** | Multiple days — significant complexity, cross-cutting, or unknowns |

If a slice is **XL**, it should be split further.

## Procedure

### Step 1: Locate the PRD

Ask the user for the PRD source:

**GitHub Issue:**
```bash
gh issue view <number> --json title,body,comments
```

**ADO Work Item:**
```bash
az boards work-item show --id <id> --org "https://dev.azure.com/<org>" --project "<project>"
```

**Markdown File:**
Read the file directly.

Internalize the full PRD content including any comments or discussion threads.

### Step 2: Explore the Codebase

Read the key modules and integration layers referenced in the PRD. Identify:

- **Integration layers** the feature touches (e.g., database/schema, API/backend, UI/frontend, tests, config, infrastructure)
- **Existing patterns** for similar features — how were comparable features built?
- **Natural seams** where work can be parallelized without merge conflicts
- **Shared dependencies** that multiple slices will need (these become the first slice)

### Step 3: Draft Vertical Slices

Break the PRD into tracer bullet work items. For each slice, determine:

- **Title** — short descriptive name
- **What to build** — the end-to-end behavior (not layer-by-layer tasks)
- **Layers touched** — which integration layers this slice cuts through
- **Blocked by** — which other slices (if any) must complete first
- **User stories covered** — which user stories from the PRD this addresses
- **Size** — S, M, or L
- **NFR impact** — does this slice address any non-functional requirements?

**Ordering guidelines:**
1. **Foundation slice first** — shared infrastructure, schema, or scaffolding that other slices depend on
2. **Simplest end-to-end path second** — the "hello world" tracer bullet
3. **Core functionality next** — the main user stories in order of value
4. **Edge cases and error handling** — after the happy paths work
5. **NFR hardening last** — performance optimization, accessibility polish, security hardening

### Step 4: Quiz the User

Present the proposed breakdown as a numbered list. For each slice show:

```
1. **<Title>** [Size: M]
   Layers: Schema → API → UI → Tests
   Blocked by: None
   User stories: 1, 2, 5
   NFR: Sets up auth foundation (Security)
```

Ask the user:
- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Is the ordering right for the first tracer bullet?
- Are there any slices missing?
- Do the size estimates feel right?

Iterate until the user approves the breakdown.

### Step 5: Choose Target Tracker

Ask the user where to create work items:

**Option A — GitHub Issues:**
- Repository to create issues in
- Labels to apply (e.g., `feature`, `prd-decomposition`)
- Milestone (optional)
- Project board (optional)

**Option B — ADO Work Items:**
- Organization URL
- Project name
- Work item type (Task, User Story, Product Backlog Item)
- Area path (optional)
- Iteration path (optional)
- Tags (optional)

**Option C — Markdown Output:**
Generate the work items as a markdown document instead of creating them in a tracker.

### Step 6: Create Work Items

Create work items in **dependency order** (blockers first) so real issue/work-item numbers can be referenced in "Blocked by" fields.

**GitHub Issue template:**
```bash
gh issue create \
  --title "<slice-title>" \
  --body "<work-item-body>" \
  --label "<labels>" \
  --milestone "<milestone>"
```

**ADO Work Item template:**
```bash
az boards work-item create \
  --type "<type>" \
  --title "<slice-title>" \
  --description "<work-item-body>" \
  --org "<org-url>" \
  --project "<project>"
```

For ADO, after creation add relations for blocked-by dependencies:
```bash
az boards work-item relation add \
  --id <new-item-id> \
  --relation-type "System.LinkTypes.Dependency-Reverse" \
  --target-id <blocker-item-id> \
  --org "<org-url>"
```

<work-item-body-template>

## Parent PRD

#{prd-reference} (or link to ADO work item / markdown file)

## What to Build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation. Reference specific sections of the parent PRD rather than duplicating content.

## Layers Touched

- [ ] Schema / Data model
- [ ] API / Backend
- [ ] UI / Frontend
- [ ] Tests
- [ ] Config / Infrastructure

(Check only the layers this slice actually touches)

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked By

- Blocked by #<issue-or-work-item-number> (if any)

Or "None — can start immediately" if no blockers.

## User Stories Addressed

From the parent PRD:
- User story 3
- User story 7

## Size

**M** — Brief rationale for the size estimate.

</work-item-body-template>

### Step 7: Print Summary

After creating all work items, print a summary table:

```
| # | Title | Size | Blocked by | Status |
|---|-------|------|-----------|--------|
| 42 | Foundation: schema + base API | S | None | Ready |
| 43 | Basic widget creation flow | M | #42 | Blocked |
| 44 | Widget listing and search | M | #42 | Blocked |
| 45 | Error handling and validation | S | #43 | Blocked |
| 46 | Accessibility hardening | S | #43, #44 | Blocked |
```

Include:
- Total count of work items created
- Count by size (e.g., "2S + 3M + 1L")
- Critical path — the longest dependency chain
- Items that can be parallelized immediately

Do NOT close or modify the parent PRD issue/work item.

## Tips

- **Thin slices > thick slices** — if a slice takes more than a few days, it's probably too thick
- **Every slice is demoable** — if you can't show it working end-to-end, it's a horizontal slice in disguise
- **Foundation first** — shared schema, types, or scaffolding should be slice #1 if multiple slices depend on it
- **NFRs are slices too** — don't bolt security/accessibility onto other slices; give them their own focused work items
- **Size XL = split** — any XL slice should be decomposed further before creating the work item
- **Dependency chains should be short** — if slice 5 depends on 4 depends on 3 depends on 2 depends on 1, find ways to parallelize
