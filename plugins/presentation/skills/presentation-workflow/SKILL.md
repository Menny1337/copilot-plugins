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

**Critique must happen in fresh context — the sub-agent that built the deck cannot judge it.**

Follow the `multi-model-review` skill (invoke it by name) for the panel mechanics: model
selection, parallel launch, the shared finding shape, synthesis, and the generic stop
conditions. This step supplies only the presentation-specific parameters.

### Panel Size by Scope

| Scope | Panel |
| --- | --- |
| Quick (~5 slides) | 1 critic — faster and cheaper, appropriate for simple decks |
| Standard (~10 slides) | 3 critics |
| Deep (~20+ slides) | 3 critics |

### Critique Brief

Launch each critic as a background `general-purpose` task with this brief:

```
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
Return findings in this EXACT structure — it supersedes the output format in the
`presentation-critique` skill, including its "always end with What Works Well" rule.
Argue against the deck rather than validating it; a critique that agrees with everything
has cost a model call and bought nothing.

### Scores
| Category | Score (1-5) |
|-----------|------------|
| Narrative & Structure | X |
| Writing Quality | X |
| Content Density | X |
| Visual Design | X |
| Speaker Notes | X |
| Professionalism | X |

Score each category 1–5 by mapping the `presentation-critique` checkpoint marks it covers:
5 = all ✅; 4 = one ⚠️, no ❌; 3 = two or more ⚠️, no ❌; 2 = one ❌; 1 = two or more ❌.
Apply the full 35-checkpoint rubric even if early checkpoints fail — do not stop early, because
a downstream category cannot be scored from an unexamined deck.

### Findings
For each issue:
- **id:** [prefix]/F1 — use the prefix assigned in this brief (`A/`, `B/`, `C/`)
- **Slide:** [number]
- **Category:** [narrative/writing/density/design/notes/professionalism]
- **Dimension:** [correctness/gaps/risks/contradictions/falsification]
- **Type:** [mechanical/factual/narrative/design/style]
- **Class:** [objective/structural/subjective]
- **Severity:** [critical/major/minor]
- **Claim:** [the issue in one sentence]
- **Evidence:** [what on the slide shows it]
- **Fix:** [concrete suggestion]

Class definitions: `objective` = verifiable against the deck (broken image link, missing
notes, fabricated metric); `structural` = reasoned but contestable (narrative, layout);
`subjective` = taste (tone, density).

### Overall Verdict
VERDICT: [ship / hold / needs-rework] — with a 1-sentence rationale
```

## Step 8: Consolidate & Decide

### Quick scope (1 critic)

Read the findings directly. With one critic there is nothing to corroborate — rank by severity,
label every finding UNCORROBORATED, and treat class as an annotation. If all six categories
score ≥ 4 with no critical or major findings, deliver. Otherwise fix and re-run.

### Standard and deep scope (3 critics)

Synthesize per `multi-model-review` Step 5, which owns panel verification, clustering,
agreement labelling, and ranking. Critics emit `critical / major / minor`; read `critical` as
that skill's `blocker`. The buckets below are named for the *action* they imply, not for a
severity — a `minor` objective nit lands in Must Fix because it is cheap and certain, not
because it blocks the release. Delivery is gated by the stop conditions, never by a bucket
being non-empty.

### Presentation Issue Types → Finding Classes

| Issue type | Class | Examples |
| --- | --- | --- |
| **Mechanical** | objective | Broken image link, missing speaker notes, text overflow |
| **Factual** | objective | Fabricated metric, unsupported claim |
| **Narrative** | structural | Weak opening, no narrative spine, disjointed flow |
| **Design** | structural | Inconsistent palette, cramped layout |
| **Style** | subjective | "Too many bullets", "slide feels heavy" |

Every credible finding is reported regardless of how many critics raised it; the agreement
label records corroboration and drives ordering, per `multi-model-review` Step 5.

When clustering, group findings into the canonical categories: narrative, writing, density,
design, notes, professionalism.

### Presentation-Specific Stop Conditions

Evaluate these **before** the generic table in `multi-model-review` Step 7 — first match wins
across both lists, deck-specific rows first:

- **Round 3 reached with any category < 4, or any critical or major finding open** → **escalate
  to the user**. The round cap outranks every deck-specific row; check it first so no rule below
  can schedule a fourth round.
- **Any category scores < 4** → fix and re-run. A weak category blocks delivery even when no
  single finding is critical or major.
- **All six categories ≥ 4 and no critical or major findings** → **ship**, listing any remaining
  minor or style items as notes. Minor objective items in Must Fix are cheap corrections to
  apply on the way out; they do not hold delivery.

Then fall through to the generic table for open blockers and escalation.

### Consolidation Format

```markdown
## Consolidated Critique (Round N)

### Must Fix
[Objective-class findings, and structural findings at critical severity]
- Slide X: [description] — Class: [objective/structural] · [CONSENSUS / LONE-DISSENT / UNCORROBORATED] (raised by: [vendors])

### Should Fix
[Remaining structural findings]
- Slide X: [description] — Class: [class] · [CONSENSUS / LONE-DISSENT / UNCORROBORATED] (raised by: [vendors])

### Notes
[Subjective findings]
- Slide X: [description] — Class: [class] · [label] (raised by: [vendor])

### Scores
| Category | Critic A | Critic B | Critic C | Avg |
|-----------|----------|----------|----------|-----|
| Narrative | X/5 | X/5 | X/5 | X.X |
| Writing | X/5 | X/5 | X/5 | X.X |
| Density | X/5 | X/5 | X/5 | X.X |
| Design | X/5 | X/5 | X/5 | X.X |
| Notes | X/5 | X/5 | X/5 | X.X |
| Professional | X/5 | X/5 | X/5 | X.X |

### Verdict: [ship / hold / escalate]
```

## Step 9: Fix & Rebuild

If critique findings require changes:

1. Plan specific fixes — classify each by rebuild size (a different axis from the Step 8
   finding classes):
   - **Cosmetic** (text tweak, color fix) — minor edit
   - **Content** (rewrite a slide, add notes) — targeted rebuild
   - **Deck-wide** (reorder slides, change narrative) — full rebuild
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
