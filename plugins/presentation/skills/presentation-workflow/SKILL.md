---
name: presentation-workflow
description: "End-to-end orchestration procedure for creating presentations. Covers intent capture, outline planning, image generation delegation, slide building, multi-model parallel critique, finding consolidation, and iterative polish. Use when orchestrating a full presentation creation workflow."
user-invocable: false
---

# Presentation Orchestration Workflow

Full end-to-end procedure for orchestrating presentation creation. The orchestrating agent follows these steps, delegating heavy work to sub-agents with fresh context windows.

## When to Use

- Creating a new presentation from scratch (any format)
- User asks to "make slides", "create a deck", "build a presentation"
- Orchestrating the full pipeline: plan → images → build → critique → polish → deliver

## When to Skip

- Editing a single slide in an existing presentation — just use the build skill directly
- Only critiquing an existing deck — use `presentation-critique` skill directly
- Only generating images — use `nano-banana-cli` skill directly
- Quick text-only outline without building slides — respond directly

---

## Step 1: Intent Capture

Before any work, understand what the user needs. Use the `ask_user` tool with a structured form. **Only ask what's missing** — infer the obvious from the user's request.

Fields to capture:
- **Topic & key message** — What is this presentation about?
- **Audience** — Executives, team, customers, conference, general?
- **Goal** — Inform, persuade, report, propose, teach?
- **Format** — PPTX (default), HTML (reveal.js), or both?
- **Scope** — Quick (~5 slides), standard (~10), deep (~20)?
- **Visual style** — Dark Modern (default), Corporate Blue, Ocean, Minimal, Warm?
- **Custom images** — Generate AI images for key slides? (yes by default)

**Smart defaults:** PPTX, ~10 slides, Dark Modern, custom images yes. If the user's request is clear enough, skip the form and proceed with defaults — confirm in the outline checkpoint.

## Step 2: Input Validation

Before outlining, validate the inputs are sufficient:

- **Content sufficiency:** Does the user provide enough material to build from? Classify as:
  - **Ready** — enough detail to build slides (proceed)
  - **Outline-only** — enough for structure but thin on content (flag gaps in checkpoint)
  - **Insufficient** — only a topic with no substance. Ask for more detail or warn that content will be generic.
- **Scope check:** If user asks for 30+ slides, confirm this is intended. Large decks risk quality dilution.
- **Fact safety:** If the topic involves numbers, metrics, or claims — confirm source material exists. Flag invented-data risk early.
- **Format feasibility:** If user asks for unsupported formats (Keynote, Google Slides native), explain PPTX/HTML options and that Google Slides can import PPTX.

## Step 3: Outline + Theme

Build the narrative spine and slide plan:

1. Choose the spine: Teaching, Persuasion, Report, Status, or Proposal
2. Write slide titles as conclusions (not topics)
3. Assign a visual type to each slide (text, image, chart, two-column, quote, code, section divider)
4. Select the color palette
5. Note which slides need generated images

## Step 4: Checkpoint

**Present the outline and captured intent to the user for approval.** This is the only manual checkpoint. Show:

- Narrative spine choice
- Slide-by-slide plan (title, visual type, image needs)
- Color palette and format (PPTX/HTML)
- Any content gaps flagged in Step 2

**Approval semantics:**
- **Explicit approve** → proceed with full workflow
- **Approve with edits** → integrate listed changes, then proceed
- **No response / "looks fine"** → treat as approved, proceed

## Step 5: Image Generation

**Skip if user declined custom images in Step 1.**

Delegate to a sub-agent with an explicit contract:

```
task → general-purpose sub-agent

PROMPT TEMPLATE:
You are a visual asset generator for a presentation. Generate images using the nano-banana CLI.

## Context
- Presentation topic: [TOPIC]
- Audience: [AUDIENCE]
- Visual style: [PALETTE NAME] (dark/light, color temperature: [COLORS])
- Slide plan: [LIST OF SLIDES NEEDING IMAGES WITH DESCRIPTIONS]

## Instructions
Read the nano-banana-cli skill (invoke it by name), then generate each image.

## Art Direction
- Hero/title slides: `-a 16:9 -s 2K`
- Section dividers: `-a 16:9`, bold abstract or thematic imagery
- Concept illustrations: Square or 16:9, clear and focused
- Transparent assets (icons, overlays): Use `-t` flag
- All outputs: `-d ./assets -o [descriptive-name]`
- Style must match the [PALETTE] palette

## Output Contract
For each image, report:
- Slide number and title it's for
- nano-banana command used
- Output file path
- Brief description of what was generated
Flag any images that didn't generate correctly.
```

## Step 6: Slide Build

Delegate to a sub-agent with an explicit contract:

```
task → general-purpose sub-agent

PROMPT TEMPLATE:
You are a presentation builder. Create a [FORMAT] presentation from the approved outline.

## Context
- Topic: [TOPIC]
- Audience: [AUDIENCE]
- Goal: [GOAL]
- Format: [PPTX or HTML]
- Palette: [PALETTE with hex colors]
- Narrative spine: [SPINE TYPE]

## Approved Outline
[FULL SLIDE-BY-SLIDE OUTLINE WITH TITLES, CONTENT, AND VISUAL TYPES]

## Image Assets
[LIST OF IMAGE FILE PATHS AND WHICH SLIDES THEY GO ON]

## Instructions
Read the [pptx-creation or html-presentation] skill (invoke it by name), then build the complete presentation.

## Rules
- Follow the outline EXACTLY — do not change slide order, claims, or narrative
- Speaker notes are MANDATORY on every slide
- Use only web-safe/system fonts
- Do NOT invent facts, metrics, or claims not in the outline
- If any content is missing, insert [PLACEHOLDER: description] and flag it

## Output Contract
Deliver:
- The [.pptx or .html] file
- Build log: slide count, image assets used, any unresolved placeholders
- Any warnings about content gaps
```

**Route by format:**
- PPTX → invoke the `pptx-creation` skill by name
- HTML → invoke the `html-presentation` skill by name
- Both → run two build sub-agents in parallel

## Step 7: Multi-Model Critique

**Critical: Critique must happen in fresh context to avoid bias.**

### Scope-Based Critique Routing

- **Quick scope (~5 slides):** Launch 1 critique sub-agent (use the best available model). Faster, cheaper — appropriate for simple decks.
- **Standard scope (~10 slides):** Launch 3 critique sub-agents in parallel (full multi-model).
- **Deep scope (~20+ slides):** Launch 3 critique sub-agents in parallel (full multi-model).

### Critique Delegation Template

For each critique sub-agent:

```
task → general-purpose (model: [MODEL])
  mode: "background"

PROMPT TEMPLATE:
You are an expert presentation critic. Evaluate this presentation against professional standards.

## Instructions
Read the presentation-critique skill (invoke it by name), then apply the full 35-checkpoint rubric to the presentation below.

## Presentation Content
[FULL CONTENT — extracted via markitdown for PPTX, or read directly for HTML]

## Context
- Audience: [AUDIENCE]
- Goal: [GOAL]
- This is Round [N] of critique.

## Required Output Format
Return findings in this EXACT structure:

### Scores
| Dimension | Score (1-5) |
|-----------|------------|
| Narrative & Structure | X |
| Writing Quality | X |
| Content Density | X |
| Visual Design | X |
| Speaker Notes | X |
| Professionalism | X |

### Findings
For each issue found:
- **Category:** [narrative/writing/density/design/notes/professionalism]
- **Slide:** [number]
- **Severity:** [critical/major/minor]
- **Type:** [mechanical/factual/narrative/style]
- **Finding:** [specific description]
- **Fix:** [concrete suggestion]

### Overall Verdict
[PASS / NEEDS WORK — with 1-sentence rationale]
```

Use 3 different frontier models for multi-model critique. Current recommended defaults: `claude-opus-4.6`, `gpt-5.4`, `gemini-3-pro-preview`. Update these as newer frontier models become available.

### Waiting for Results

After launching background critique agents, use `read_agent` with `wait: true` for each agent ID. **Do not proceed to Step 8 until all critique agents have completed.**

## Step 8: Consolidate & Decide

### For Single-Model Critique (Quick scope)

Read the findings directly. If all scores ≥ 4 and no critical/major issues → deliver. Otherwise → fix.

### For Multi-Model Critique (Standard/Deep scope)

Read all 3 critique reports and consolidate using **class-based severity rules**:

#### Severity by Issue Type

| Issue Type | Elevate Threshold | Examples |
|---|---|---|
| **Mechanical** (broken refs, missing notes, overflow) | 1 credible hit | Broken image link, missing speaker notes, text overflow |
| **Factual** (invented data, wrong claims) | 1 credible hit | Fabricated metric, unsupported claim |
| **Narrative** (structure, flow, story) | 2+ models agree | Weak opening, no narrative spine, disjointed flow |
| **Design** (visual consistency, layout) | 2+ models agree | Inconsistent palette, cramped layout |
| **Style** (subjective preferences) | Only if repeated or high-confidence | "Too many bullets", "slide feels heavy" |

#### Deduplication

Group findings into canonical categories: narrative, writing, density, design, notes, professionalism. When multiple models flag the same issue differently, merge into one finding and note agreement count.

#### Stop Conditions

- **All scores ≥ 4, no critical/major issues** → PASS, deliver
- **Only minor/style issues remain** → PASS, deliver with notes
- **Same critical issue persists across 2 rounds** → escalate to user: "I can't resolve this automatically — here's the issue: [X]. How would you like to proceed?"
- **Critique becomes contradictory** (one model says add content, another says reduce) → deliver best version, note the tradeoff
- **Max 3 rounds reached** → deliver best version with remaining issues listed

### Consolidation Format

```markdown
## Consolidated Critique (Round N)

### Critical — Must Fix
[Issues that are mechanical/factual OR flagged by all 3 models]
- Slide X: [description] (flagged by: [models]) — Type: [mechanical/factual/narrative]

### Major — Should Fix
[Issues flagged by 2+ models OR single-model mechanical/factual]
- Slide X: [description] (flagged by: [models]) — Type: [type]

### Minor — Nice to Fix
[Style/preference issues, single-model narrative/design]
- Slide X: [description] (flagged by: [model]) — Type: [style]

### Scores
| Dimension | Model A | Model B | Model C | Avg |
|-----------|---------|---------|---------|-----|
| Narrative | X/5 | X/5 | X/5 | X.X |
| Writing | X/5 | X/5 | X/5 | X.X |
| Density | X/5 | X/5 | X/5 | X.X |
| Design | X/5 | X/5 | X/5 | X.X |
| Notes | X/5 | X/5 | X/5 | X.X |
| Professional | X/5 | X/5 | X/5 | X.X |

### Verdict: [PASS / FIX REQUIRED / ESCALATE TO USER]
```

## Step 9: Fix & Rebuild

If critique findings require changes:

1. Plan specific fixes — classify each as:
   - **Cosmetic** (text tweak, color fix) — minor edit
   - **Content** (rewrite a slide, add notes) — targeted rebuild
   - **Structural** (reorder slides, change narrative) — full rebuild
2. Delegate a rebuild to a fresh sub-agent with: fix instructions + original outline + critique findings
3. Run Step 7 critique again on the rebuilt version
4. Repeat up to **3 total rounds** (see stop conditions in Step 8)

## Step 10: Final Artifact Validation

Before delivering, verify the output file(s):

- [ ] File exists and is not empty
- [ ] File opens/renders correctly (PPTX: check file size is reasonable; HTML: verify structure)
- [ ] Every slide has speaker notes (search for notes markers)
- [ ] No placeholder text remaining (`[PLACEHOLDER`, `TODO`, `lorem ipsum`, `TBD`)
- [ ] No broken image references (check all image paths exist)
- [ ] Fonts are web-safe/system fonts only
- [ ] PDF export instructions match the actual output format

If any check fails, fix before delivering.

## Step 11: Deliver

Present the final deliverables:

- The presentation file(s) (.pptx and/or .html)
- PDF export instructions:
  - PPTX: Print from PowerPoint → Save as PDF
  - HTML: Append `?print-pdf` to URL, then Print → Save as PDF in Chrome
- Brief summary of design choices made
- Critique scores from the final round
- Offer: "Want me to adjust anything?"
