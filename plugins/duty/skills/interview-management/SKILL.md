---
name: interview-management
description: "Manage structured engineering interviews for Senior Frontend Engineer, Frontend Engineer, and Fullstack Engineer loops. Use when the user needs a question bank, STAR follow-up prompts, live interviewer sidekick cues, persistent interview history files, evidence-based scorecards, or post-interview debriefs. Keywords: interviewer, frontend interview, fullstack interview, hiring loop, question bank, interview history, scorecard, rubric, debrief."
user-invocable: false
---

# Interview Management

Manage one engineering interview from prep through debrief with clear questions, concise note-taking, STAR-style probing, and evidence-based scoring.

## When to Use

- The user has an interview today or soon and needs a practical structure fast
- They need a time-boxed agenda, question set, question bank, or decision bar
- They want live interviewer support: next question, follow-up prompts, notes, or time checks
- They need an evaluation rubric, scorecard, or post-interview summary
- They are interviewing for Senior Frontend Engineer, Frontend Engineer, or Fullstack Engineer roles

## When to Skip

- Broad recruiting-process design, interviewer training programs, or hiring policy work — this skill is for a single interview session
- Deep company, market, or technical research with citations — use `research-methodology`
- Candidate coaching, answer rehearsal, or job-search advice — use a separate candidate-focused workflow instead of this interviewer skill
- Standalone coding or system-design coaching with no immediate interview session — use a role-specific practice workflow instead of this session-management skill

## Execution Rules

- If the user says "manage this interview" and does not specify their role, default to interviewer mode.
- If the role is not specified, tailor the workflow to frontend/fullstack engineering interviews based on the available context.
- If the interview is already live or starts soon, keep outputs short and operational.
- Every real interview must create or update one persistent file under `~/.copilot/interview-manager/interviews/`.
- The interview file is the source of truth for what was asked, what happened, evidence captured, scorecard updates, and the final debrief.
- Shared memory stores distilled patterns only, not full interview histories.
- Separate three layers in every response: raw notes, interpreted evidence, and final judgment.
- Do not invent evidence. Use `Not assessed` when signal is missing.
- Prefer compact tables and bullets over long prose.
- Use STAR-style probing to turn vague stories into assessable evidence.

## Interview Workspace

Use `~/.copilot/interview-manager/` for persistent interview records.

```
~/.copilot/interview-manager/
├── MEMORY.md
└── interviews/
    └── YYYY-MM-DD-HHMM-<slug>.md
```

- Create `interviews/` if it does not exist.
- Use one file per interview.
- Choose `<slug>` from the strongest available identifier: company + role, role + stage, or role lens alone.

### Interview File Template

Each interview file should contain YAML frontmatter plus a structured markdown body:

```yaml
---
id: "INT-YYYYMMDD-HHMM-<slug>"
created: "YYYY-MM-DDTHH:MM:SSZ"
updated: "YYYY-MM-DDTHH:MM:SSZ"
status: prep | live | completed | cancelled
role_target: "Senior Frontend Engineer"
company: ""
stage: ""
interview_type: "behavioral"
duration_minutes: 45
tags: [frontend, behavioral]
---
```

```markdown
# Interview: <title>

## Context

## Objective

## Agenda

## Question Bank

## Live Timeline

## Scorecard

## Debrief

## Follow-Ups
```

### Live Timeline Entry Format

Append timestamped bullets while the interview is running:

```markdown
- **HH:MM** — Asked: "<question>"
  - What happened: <candidate response or observed outcome>
  - Evidence: <signal, concern, or missing proof>
  - Next follow-up: <best next probe>
```

## Interview Evidence Scale

Use this 4-point scale plus `Not assessed` for each competency or signal area.

| Score | Meaning | When to Use |
|------:|---------|-------------|
| 4 | Strong evidence | Clear, specific, repeatable signal with low doubt |
| 3 | Clear evidence | Solid signal with minor gaps or limited depth |
| 2 | Mixed evidence | Partial, uneven, or inconsistent signal |
| 1 | Weak or negative evidence | Major gap, weak answer, or concrete concern |
| N/A | Not assessed | No meaningful evidence collected yet |

Only produce an overall recommendation after reviewing all competencies:

- Strong yes
- Yes
- Mixed / needs discussion
- No

## Procedure

### 1. Frame the interview

Capture or infer the minimum workable context:

- mode: interviewer
- interview type: behavioral, coding, system design, architecture, or general
- role, level, team/company, and stage
- duration and any time pressure
- must-evaluate competencies or outcomes
- known risks, priorities, job description, resume, or prep notes if available

If time is tight, ask only the minimum needed to start.

### 2. Create or update the interview record

As soon as the task is clearly about a real interview:

1. Create `~/.copilot/interview-manager/interviews/` if missing.
2. Create the interview file if it does not already exist.
3. Populate frontmatter and section headers.
4. Set `status` to `prep`, `live`, or `completed` based on the current phase.
5. Update the `updated` timestamp on every substantive change.

This file should be updated throughout the interview lifecycle rather than recreated from scratch.

### 3. Choose the role lens

Tailor the question bank and scorecard to the role:

- **Senior Frontend Engineer** — frontend architecture, React/TypeScript depth, accessibility, performance, debugging, cross-functional judgment, mentoring, and technical leadership
- **Frontend Engineer** — implementation quality, UI state management, testing, accessibility basics, debugging, collaboration, and delivery judgment
- **Fullstack Engineer** — frontend/backend tradeoffs, API and data modeling, observability, performance, reliability, security basics, and end-to-end debugging

### 4. Build the interview pack

Produce a compact interview pack with:

1. **Objective** — what this interview needs to prove or learn
2. **Agenda** — time blocks with checkpoints
3. **Primary questions** — 3-6 core prompts
4. **Follow-ups** — depth, tradeoff, ambiguity, ownership, impact, reflection, and STAR probes
5. **Signals to capture** — competencies or behaviors to evaluate
6. **Watch-fors** — likely strengths, red flags, and missing-signal risks
7. **Decision bar** — what good looks like for this round

Bias toward signal extraction over coverage.

When building follow-ups, use these STAR extraction prompts when answers are vague:

- What was the exact situation?
- What was your personal responsibility versus the team's?
- What concrete action did you take?
- What tradeoff did you make and why?
- What measurable result or outcome followed?
- What would you change if you did it again?

Write the prep output into the interview file's `Context`, `Objective`, `Agenda`, and `Question Bank` sections.

### 5. Run live support

Maintain a running note table:

| Time | Topic or question | Evidence heard | Best follow-up | Scale | Notes |
|------|-------------------|----------------|----------------|------:|------|

After each exchange:

- capture evidence, not impressions
- note the strongest missing signal
- suggest the single best next follow-up
- track whether the agenda still fits the remaining time
- append or refresh the `Live Timeline` in the interview file

If time is running short, compress your output to:

- next best question
- missing signal
- provisional scale
- one bullet of notes to save

### 6. Convert notes into a scorecard

After the conversation, regroup evidence by competency. Common buckets:

- communication
- problem solving
- technical depth
- technical judgment
- ownership
- collaboration
- leadership or mentoring, if relevant
- product or customer sense, if relevant

For each competency, provide:

- score using the interview evidence scale
- 2-4 evidence bullets
- confidence: high, medium, or low
- open question if signal is incomplete

Keep strengths and concerns explicitly tied to evidence.
Write the results into the interview file's `Scorecard` section.

### 7. Write the debrief

Produce a short debrief with:

- **Decision summary** — 2-4 sentences
- **Top strengths**
- **Top concerns**
- **Open questions or calibration points**
- **Recommended next step**

Write the summary into the `Debrief` and `Follow-Ups` sections, then set `status: completed` and refresh the `updated` timestamp.

## Automatic Behaviors

Do these automatically without being asked:

1. Create the interview workspace structure if missing
2. Create one file per interview at the start of real interview work
3. Keep prep, live notes, scorecard, and debrief in the same file
4. Append timestamped history as questions are asked and answers are discussed
5. Reserve shared memory for distilled patterns only

## Fast-start Outputs

### Minimal prep pack

Use this when the interview is soon and the user wants speed:

- 1-line objective
- 20-45 minute agenda
- 3 primary questions
- 3 follow-ups, including at least 1 STAR probe
- 4 competency rows with the evidence scale
- 1 red flag to test explicitly

### Minimal live support

Use this when the interview is in progress:

- next question
- missing signal
- scale snapshot
- best STAR follow-up
- bullet notes to paste into a scorecard

### Minimal debrief

Use this when the conversation just ended:

- recommendation
- 3 evidence-backed strengths
- 3 evidence-backed concerns
- 1 sentence on next step
