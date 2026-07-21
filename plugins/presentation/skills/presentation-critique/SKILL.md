---
name: presentation-critique
description: "Structured evaluation procedure for PowerPoint presentations against professional standards. Scores narrative structure, writing quality, content density, visual design, speaker notes, and overall professionalism. Use when reviewing, scoring, or critiquing a presentation for quality. Triggers: critique presentation, review slides, presentation feedback, deck review, slide quality."
user-invocable: false
---

# Presentation Critique

Systematic evaluation of presentations against professional standards. Produces actionable feedback with severity-scored findings, not vague opinions.

## When to Use

- User asks to review, critique, or give feedback on a presentation
- User wants to check if a deck is ready for a specific audience (executives, customers, team)
- After `presentation-designer` generates a deck (adversarial review before delivery)
- User provides a `.pptx` file or slide outline and wants quality assessment
- User asks "is this presentation good?" or "what should I improve?"

## When to Skip

- User wants to CREATE a presentation — use `pptx-creation` skill instead
- User wants visual/CSS design critique of HTML — use `ui-critique` instead
- User just wants text proofreading without presentation context — a general editor is better
- The presentation is a rough draft and the user explicitly says they only want structural feedback (do a partial review, not the full rubric)

---

## Evaluation Procedure

### Step 0: Obtain the Presentation Content

Before evaluating, extract the presentation content:

**If given a `.pptx` file:**
```bash
python -m markitdown presentation.pptx
```

Or unpack for full analysis (images, layouts, notes):
```bash
node ../pptx-creation/scripts/unpack.mjs presentation.pptx ./review-dir
# (Path is relative to this skill's directory; pptx-creation is a sibling skill in the presentation plugin.)
```

Then read slide XML for speaker notes:
```bash
cat review-dir/ppt/notesSlides/notesSlide*.xml 2>/dev/null
```

**If given an outline, markdown, or text:** Work with the content as-is.

**If reviewing slides the designer just generated:** Read the generation script and HTML/PptxGenJS source to evaluate content.

### Step 1: Identify Context

Before scoring, establish:

| Question | Why It Matters |
|----------|---------------|
| Who is the audience? | Executives need different tone than engineers |
| What is the goal? | Inform vs. persuade vs. decide shapes what "good" means |
| How many slides? | A 5-slide update has different rules than a 30-slide keynote |
| Will it be presented live or sent as a read-ahead? | Read-aheads need more text; live decks need less |

If context is missing, **ask the user** before scoring. Without audience and goal, the critique will be generic and less useful.

### Step 2: Evaluate Against Rubric

Score each checkpoint as:
- **✅ Pass** — Meets professional standard
- **⚠️ Flag** — Technically acceptable but could be better; note the improvement
- **❌ Fail** — Does not meet standard; must fix before presenting

---

## Rubric: 6 Dimensions, 35 Checkpoints

### Dimension 1: Narrative & Structure (8 checkpoints)

The presentation must tell a coherent story, not just display information.

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| N1 | **Clear narrative spine** | Presentation follows one identifiable spine (Teaching, Persuasion, Report, Status, Proposal) |
| N2 | **Logical flow** | Slides progress logically — no A→B→A topic jumps |
| N3 | **Strong opening** | First 3 slides: Title → Hook → Agenda/Objectives (hook creates curiosity) |
| N4 | **Hook before objectives** | Slide 2 is a provocative question, surprising stat, or "what if" — NOT a bullet list of objectives |
| N5 | **Section pacing** | Section dividers appear every 3–5 content slides (for decks > 8 slides) |
| N6 | **Strong closing** | Final 2–3 slides: Summary → CTA → Thank you/Q&A |
| N7 | **Every slide earns its place** | No redundant slides; no slides that could be deleted without losing meaning |
| N8 | **Transitions make sense** | Moving from one slide to the next feels natural, not jarring |

### Dimension 2: Writing Quality (7 checkpoints)

Text must be concise, professional, and audience-appropriate.

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| W1 | **Titles are conclusions** | Slide titles state the takeaway, not the topic ("Revenue Grew 23%" not "Q3 Revenue") |
| W2 | **Concise language** | Active voice, no filler words ("leverage", "utilize", "in order to") |
| W3 | **No jargon without context** | Technical terms are explained or the audience is expected to know them |
| W4 | **Consistent terminology** | Same concept uses the same term throughout (not "users" on slide 3 and "customers" on slide 7 for the same group) |
| W5 | **Error-free text** | No spelling, grammar, or punctuation errors |
| W6 | **Audience-appropriate tone** | Executive decks are strategic, not tactical. Engineering decks can be technical. Customer decks avoid internal jargon. |
| W7 | **Approachable, not condescending** | Language invites rather than intimidates. "By the end of this session" not "What you'll master" |

### Dimension 3: Content Density (6 checkpoints)

Each slide must be focused and digestible.

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| C1 | **One idea per slide** | Each slide makes exactly one point. If it makes two, it should be split. |
| C2 | **≤5 bullet points** | No slide has more than 5 bullets (tables are preferred for 5+) |
| C3 | **≤25 words per bullet** | Each bullet is a short, scannable phrase — not a paragraph |
| C4 | **≤75 words body text** | Total body text (excluding title) stays under 75 words per slide |
| C5 | **Data has sources** | Charts, tables, and statistics cite their source (even briefly: "Source: Finance, FY24") |
| C6 | **No invented facts** | All metrics, stats, and claims trace back to provided source material. If a number looks fabricated, flag it. |

### Dimension 4: Visual Design (6 checkpoints)

The deck must look professional and consistent.

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| V1 | **Typography ≥ 14pt** | No text on any slide is smaller than 14pt. Titles ≥ 32pt, body ≥ 20pt. |
| V2 | **Consistent color palette** | Deck uses ≤6 colors consistently. No random colors on individual slides. |
| V3 | **Adequate white space** | Approximately 50% of each slide is empty/background. No slides feel "cramped." |
| V4 | **High contrast** | Text is easily readable: dark on light or light on dark. No medium-on-medium. |
| V5 | **Layout consistency** | Title position, margin widths, and content alignment are the same across slides. |
| V6 | **Visual variety** | Not all slides are the same type. Mix of text, charts, images, comparisons, quotes. |

### Dimension 5: Speaker Notes (4 checkpoints)

Notes must make the deck usable by any presenter.

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| S1 | **Present on every slide** | Every single slide has speaker notes. No exceptions. |
| S2 | **Add value beyond slide text** | Notes provide context, talking points, or transitions — not just restating what's on the slide |
| S3 | **Include transitions** | Notes hint at how to move to the next slide ("This leads us to..." or "Now let's look at...") |
| S4 | **Usable by someone else** | A presenter who didn't create the deck could present it using just the notes |

### Dimension 6: Professionalism (4 checkpoints)

Would you be confident presenting this to the stated audience?

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| P1 | **Brand consistency** | Same fonts, colors, spacing, and recurring visual elements throughout |
| P2 | **No placeholder content** | No "Lorem ipsum", "TBD", "[INSERT]", or clearly auto-generated filler |
| P3 | **Appropriate scope** | Content matches the stated goal. A "status update" doesn't drift into a sales pitch. A "proposal" doesn't read like a history lesson. |
| P4 | **Presentation stands alone** | The deck makes sense without the presenter — a reader can follow the story |

---

## Step 3: Score and Summarize

### Per-Dimension Scoring

For each dimension, calculate:

| Dimension | Total Checks | ✅ Pass | ⚠️ Flag | ❌ Fail | Score |
|-----------|-------------|---------|---------|---------|-------|
| Narrative & Structure | 8 | ? | ? | ? | ?/8 |
| Writing Quality | 7 | ? | ? | ? | ?/7 |
| Content Density | 6 | ? | ? | ? | ?/6 |
| Visual Design | 6 | ? | ? | ? | ?/6 |
| Speaker Notes | 4 | ? | ? | ? | ?/4 |
| Professionalism | 4 | ? | ? | ? | ?/4 |
| **Total** | **35** | | | | **?/35** |

### Overall Grade

| Grade | Score | Meaning |
|-------|-------|---------|
| **A** | 31–35 | Ready to present. Minor polish at most. |
| **B** | 25–30 | Good foundation. Fix the flags and it's ready. |
| **C** | 18–24 | Needs significant revision. Multiple structural or content issues. |
| **D** | 11–17 | Major rework needed. Story, content, or design fundamentally off. |
| **F** | 0–10 | Start over with a clear outline and narrative spine. |

### Stopping Criteria

**Stop and report immediately** (do not continue to other dimensions) if:
- Zero speaker notes on any slide (S1 ❌)
- No identifiable narrative spine (N1 ❌)
- Invented facts or unattributed statistics (C6 ❌)

These are foundational — there's no point evaluating polish if the structure is missing.

## Step 4: Generate Findings Report

For each ❌ Fail and ⚠️ Flag, produce a finding:

```
### [Checkpoint ID]: [Checkpoint Name] — [❌ Fail / ⚠️ Flag]

**Slide(s):** [Which slides are affected]
**Issue:** [What's wrong — be specific]
**Fix:** [Concrete action to resolve it]
**Example:**
  Before: "[Current text or description]"
  After:  "[Suggested improvement]"
```

**Rules for findings:**
- Be specific — "Slide 7 title is a topic, not a conclusion" not "titles could be better"
- Be actionable — every finding includes a concrete fix
- Be honest — if it's bad, say so directly. Don't soften with "perhaps consider..."
- Prioritize — list ❌ Fails first, then ⚠️ Flags
- Include before/after examples for writing issues (W1–W7)
- Reference specific slide numbers

## Step 5: Deliver the Critique

Output format:

```
## Presentation Critique: [Title]

**Audience:** [Who]  |  **Goal:** [What]  |  **Slides:** [Count]

### Scores

[Per-dimension table from Step 3]

**Overall: [Grade] ([Score]/35)**

### Critical Issues (Must Fix)

[❌ Fail findings — fix these before presenting]

### Improvements (Should Fix)

[⚠️ Flag findings — fix these for a stronger deck]

### What Works Well

[List 2–3 specific things the presentation does right. Even weak decks have strengths. Name them.]

### Recommended Next Steps

1. [Highest-priority fix]
2. [Second-priority fix]
3. [Third-priority fix]
```

Always end with **What Works Well** — critique must be balanced. If you only point out flaws, the feedback feels destructive rather than constructive.

---

## Partial Reviews

If the user only wants feedback on a specific aspect:

| User Says | Evaluate Only |
|-----------|--------------|
| "Is the story clear?" | Dimension 1: Narrative & Structure |
| "Is the writing good?" | Dimension 2: Writing Quality |
| "Is it too text-heavy?" | Dimension 3: Content Density |
| "Does it look professional?" | Dimensions 4 + 6: Visual Design + Professionalism |
| "Are the speaker notes useful?" | Dimension 5: Speaker Notes |
| "Is this ready for execs?" | Full rubric with executive audience context |

For partial reviews, still produce the findings report format — just scoped to the relevant dimension(s).

---

## Calibration Notes

### Executive Audiences
- Executives scan, they don't read. Content density rules are stricter.
- Every slide must answer "so what?" — conclusions in titles are mandatory, not optional.
- Data without context is noise. Charts need one-line insight annotations.
- 10–15 slides max for a 30-minute slot (including Q&A buffer).

### Technical Audiences
- More text is acceptable (but still ≤75 words per slide).
- Code snippets, architecture diagrams, and terminal output are fine.
- Jargon is acceptable when the audience shares it.
- Deeper data tables are OK — but still need clear titles and source citations.

### Customer / External Audiences
- Zero internal jargon. Zero.
- Benefit-focused language: what does this do for THEM, not what YOU built.
- Visual polish matters more — this represents your brand.
- More conservative color choices. Fewer "creative" layouts.

### Read-Ahead / Async Decks
- More text is acceptable since there's no presenter.
- Speaker notes become even more critical — they're the narration.
- Every chart needs a clear text annotation explaining the takeaway.
- Self-contained is mandatory (P4 is heavily weighted).
