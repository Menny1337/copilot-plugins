---
name: ui-critique
description: "Review and evaluate UI components against design principles. Use when reviewing, scoring, or critiquing React/TypeScript UI code for quality, accessibility, hierarchy, and design system compliance."
---

# UI Critique Procedure

A structured evaluation methodology for assessing UI code against systematic design criteria. Produces actionable, severity-classified feedback with specific fixes.

> "The critic's job is not to find fault — it's to find the gap between what IS and what COULD BE."

## When to Use

- Evaluating generated UI code before presenting to the user
- Reviewing pull requests that include UI component changes
- Auditing existing components for design system compliance
- Running as part of a generate→critique→refine loop
- Self-review step at the end of a generation workflow

## When to Skip

- Generating new UI from scratch — use `ui-generation` instead
- Looking up design constraints or tokens — use `ui-design-system` instead
- Reviewing backend or non-visual code
- The component is intentionally breaking design rules (e.g., branded override)

---

## Evaluation Procedure

### Step 1: Load Design System Context

Before critiquing, load the constraints from the **`ui-design-system`** skill. The evaluation is always relative to the project's design system — not personal preference.

Check for project-specific tokens (`.ui-tokens.json`) that override defaults.

### Step 2: Read the Code Thoroughly

Read the complete component code. Understand:
- What is the component's purpose?
- What hierarchy does it establish?
- What states does it handle?
- What interactions does it provide?

### Step 3: Evaluate Each Category

Evaluate the code against ALL 7 categories below. For each checkpoint, rate:

| Rating | Symbol | Meaning |
|--------|--------|---------|
| **Pass** | ✅ | Fully compliant — no action needed |
| **Warn** | ⚠️ | Minor deviation — should fix but not blocking |
| **Fail** | ❌ | Significant violation — must fix before shipping |

---

## Evaluation Categories

### Category 1: Spacing & Layout

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| 1.1 | 8px grid compliance | All spacing values are from the scale: 0, 4, 8, 12, 16, 24, 32, 48, 64, 96. No arbitrary values like 7px, 13px, 15px. |
| 1.2 | Section spacing | ≥48px gap between unrelated sections |
| 1.3 | Element grouping | Related items 8–16px apart, visually grouped |
| 1.4 | Touch targets | All interactive elements ≥44×44px |
| 1.5 | Responsive breakpoints | Mobile (320px), tablet (768px), desktop (1024px) handled |
| 1.6 | Content width | Prose content ≤65ch; page content ≤1440px |
| 1.7 | Consistent rhythm | Spacing feels regular — no "one-off" gaps |

### Category 2: Typography Hierarchy

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| 2.1 | Type scale | Sizes follow modular scale (1.25 ratio): 12, 14, 16, 20, 25, 31, 39, 49 |
| 2.2 | Hierarchy levels | Clear primary (largest/boldest), secondary, tertiary text levels |
| 2.3 | Font families | Maximum 2 families (1 sans, 1 mono) |
| 2.4 | Font weights | Maximum 3 weights (400, 500, 700) |
| 2.5 | Minimum body size | Body text ≥14px, captions ≥12px |
| 2.6 | Line heights | Body: 1.5, headings: 1.1–1.3 |
| 2.7 | Heading order | h1→h2→h3 sequential, no skipped levels |

### Category 3: Visual Hierarchy

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| 3.1 | Primary focal point | ONE clearly dominant element per section/screen |
| 3.2 | No equal emphasis | Not all elements have the same size/weight/color |
| 3.3 | Action hierarchy | Primary action visually stronger than secondary/tertiary |
| 3.4 | Proximity grouping | Related items closer together, unrelated items farther apart |
| 3.5 | Whitespace usage | Whitespace used intentionally — not just leftover |
| 3.6 | Visual weight balance | Layout feels balanced, not lopsided or cramped |

### Category 4: Color & Contrast

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| 4.1 | Text contrast | All text ≥4.5:1 contrast ratio against background |
| 4.2 | UI contrast | UI elements (borders, icons, controls) ≥3:1 contrast |
| 4.3 | No pure black | Text uses dark neutral (e.g., slate-900), not #000000 |
| 4.4 | Semantic colors | Colors used consistently: red=error, green=success, amber=warning |
| 4.5 | Brand color restraint | Maximum 3 brand colors + neutrals |
| 4.6 | Color independence | Information not conveyed by color alone (icons/text alongside) |
| 4.7 | Token usage | Colors reference semantic tokens, not raw hex values |

### Category 5: Micro-Interactions

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| 5.1 | Hover states | All interactive elements have hover feedback |
| 5.2 | Focus indicators | Visible `focus-visible` ring (2px) on all focusable elements |
| 5.3 | Active/press states | Buttons have active press feedback (scale, color, etc.) |
| 5.4 | Disabled states | Disabled elements: reduced opacity, `cursor-not-allowed`, no interactions |
| 5.5 | Loading states | Loading indicated: skeletons for content, spinners for actions |
| 5.6 | Transition timing | All transitions 150–300ms with appropriate easing |
| 5.7 | Reduced motion | `prefers-reduced-motion` respected (no animations when enabled) |

### Category 6: Accessibility

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| 6.1 | Keyboard navigation | All interactive elements reachable via Tab in logical order |
| 6.2 | ARIA labels | Icons have `aria-label` or `aria-hidden`; images have `alt` |
| 6.3 | Form labels | Every input has an associated `<label>` (visible or `aria-label`) |
| 6.4 | Error identification | Errors use text + icon, not just color; `role="alert"` on messages |
| 6.5 | Semantic HTML | Uses `section`, `article`, `nav`, `main`, `header`, `footer` appropriately |
| 6.6 | Landmark regions | Page has `<main>`, navigation has `<nav>` with `aria-label` |
| 6.7 | Dynamic content | Live regions (`aria-live`) for content that updates dynamically |
| 6.8 | Skip links | "Skip to main content" link on pages with navigation |

### Category 7: Code Quality

| # | Checkpoint | Pass Criteria |
|---|-----------|---------------|
| 7.1 | TypeScript types | All props typed with interfaces; no `any` types |
| 7.2 | Component decomposition | No component >100 lines; repeated patterns extracted |
| 7.3 | Props design | Clean interface with defaults; discriminated unions for variants |
| 7.4 | Naming | Components: PascalCase; props: camelCase; files: kebab-case |
| 7.5 | No inline styles | All styling via Tailwind utilities or token-mapped classes |
| 7.6 | State handling | All states from requirements handled (loading, empty, error, success) |
| 7.7 | Composition | `cn()` utility for conditional classes; `forwardRef` for wrapper components |

---

## Step 4: Classify Findings by Severity

Every finding must be classified:

| Severity | Definition | Action Required |
|----------|-----------|----------------|
| **🔴 Critical** | Accessibility violation, broken functionality, security issue | Must fix — blocks shipping |
| **🟠 Major** | Missing states, hierarchy failure, design system violation | Should fix — degrades user experience |
| **🟡 Minor** | Polish items, slightly off values, optimization opportunities | Nice to fix — improves quality |

## Step 5: Generate Structured Feedback

For each finding, output a structured report:

```json
{
  "findings": [
    {
      "category": "Spacing & Layout",
      "checkpoint": "1.1",
      "rating": "fail",
      "severity": "major",
      "issue": "Card uses p-[15px] — arbitrary value not on 8px grid",
      "location": "Line 42: className=\"p-[15px]\"",
      "fix": "Change p-[15px] to p-4 (16px) to align with spacing scale",
      "impact": "Visual inconsistency with other cards using grid-aligned spacing"
    }
  ]
}
```

**Rules for feedback:**
- Be specific — cite the exact line, class, or prop
- Be actionable — every finding includes a concrete fix
- Be objective — evaluate against the design system, not personal taste
- Prioritize — critical and major first, minor last
- Don't sugarcoat — if it fails, say it fails. The goal is quality.

## Step 6: Score the Component

Calculate scores per category and overall:

### Category Scoring

For each category, calculate: `(pass_count / total_checkpoints) × 100`

| Category | Checkpoints | Weight |
|----------|------------|--------|
| Spacing & Layout | 7 | 15% |
| Typography Hierarchy | 7 | 10% |
| Visual Hierarchy | 6 | 20% |
| Color & Contrast | 7 | 10% |
| Micro-Interactions | 7 | 15% |
| Accessibility | 8 | 20% |
| Code Quality | 7 | 10% |

**Overall score** = weighted average of all categories.

### Quality Thresholds

| Score | Rating | Verdict |
|-------|--------|---------|
| ≥90% | ⭐ Excellent | Ship it — production-ready |
| 75–89% | ✅ Good | Minor polish needed — acceptable with noted improvements |
| 60–74% | ⚠️ Needs Work | Significant issues — another refine iteration required |
| <60% | ❌ Poor | Major rework needed — do not ship |

---

## Step 7: Iteration Protocol

### When to Request Another Iteration

Request refinement when:
- Any **critical** findings exist
- Overall score < 75%
- Accessibility score < 80% (non-negotiable)
- Visual hierarchy score < 70%

### Feedback Format for Refinement

When requesting changes, structure feedback as:

```
## Critique Round [N] — Score: [X]%

### 🔴 Critical (must fix)
1. [Finding with specific fix]

### 🟠 Major (should fix)
1. [Finding with specific fix]

### 🟡 Minor (nice to fix)
1. [Finding with specific fix]

### ✅ What's Working Well
- [Acknowledge good patterns to preserve]
```

Always include what's working well — this prevents the refiner from breaking validated aspects.

### DeCRIM Evaluation (Decompose, Critique, Refine, Iterate, Merge)

For complex multi-constraint components, evaluate each constraint independently:

1. **Decompose** — List all constraints the component must satisfy
2. **Critique each independently** — Don't let one failure color judgment of others
3. **Refine only failures** — Don't touch passing aspects
4. **Iterate** — Re-evaluate only the changed aspects after refinement
5. **Merge** — Combine passing original + refined fixes

This prevents the "fix one thing, break another" cycle.

---

## Stopping Criteria

Stop the critique-refine loop when ANY of these conditions are met:

| Criterion | Threshold | Rationale |
|-----------|-----------|-----------|
| **Quality threshold** | Overall ≥90%, Accessibility ≥90% | Production-ready quality |
| **Convergence** | 2 consecutive iterations with <3% score change | No more meaningful improvement |
| **Diminishing returns** | Improvement <5% per iteration | Cost outweighs benefit |
| **Budget limit** | Maximum 5 critique-refine rounds | Prevent infinite loops |
| **Human approval** | User explicitly accepts the output | User override |

When stopping with score <90%, note remaining issues as "known limitations" in the output.

---

## Output Format

### Full Critique Report

```markdown
# UI Critique Report

**Component:** [Name]
**Date:** [ISO date]
**Overall Score:** [X]% — [Rating]

## Category Scores

| Category | Score | Rating |
|----------|-------|--------|
| Spacing & Layout | X% | ✅/⚠️/❌ |
| Typography | X% | ✅/⚠️/❌ |
| Visual Hierarchy | X% | ✅/⚠️/❌ |
| Color & Contrast | X% | ✅/⚠️/❌ |
| Micro-Interactions | X% | ✅/⚠️/❌ |
| Accessibility | X% | ✅/⚠️/❌ |
| Code Quality | X% | ✅/⚠️/❌ |

## Findings

[Structured findings by severity]

## Verdict

[Ship / Polish needed / Another iteration required / Major rework]
```

## References

- [Nielsen Norman Group: Heuristic Evaluation](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [Axe Accessibility Rules](https://dequeuniversity.com/rules/axe/)
- [Design Critique Best Practices](https://www.interaction-design.org/literature/article/design-critiques)
