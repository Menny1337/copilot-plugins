---
name: ui-generation
description: "Generate beautiful React/TypeScript UI components through a step-by-step workflow. Use when building new components, layouts, pages, or UI features. Includes phased generation, prompt techniques, and curated component examples."
argument-hint: "<component, page, or layout to build>"
---

# UI Generation Workflow

A structured 7-step process for generating production-quality React/TypeScript UI. Each step builds on the previous — never skip steps, never jump to code before planning.

> The difference between generic and beautiful UI is not talent — it's process. Follow the steps.

## When to Use

- Building a new React component, page, or layout from scratch
- Redesigning or restyling an existing component
- Creating a set of related components (e.g., form system, card variants)
- Generating UI from a design brief, wireframe, or description

## When to Skip

- Evaluating or critiquing existing UI — use `ui-critique` instead
- Looking up design token values or constraint rules — use `ui-design-system` instead
- Pure logic/state changes with no visual impact
- Backend or API work

---

## Phase 0: Pre-Flight

Before generating anything, complete these checks:

### 0a. Gather Context

- What is the component's purpose? (display data, collect input, navigate, etc.)
- Who is the target user? (internal tool, consumer app, developer tool, etc.)
- What is the surrounding context? (standalone page, embedded in dashboard, modal, etc.)
- Are there existing components to stay consistent with?
- What data will the component receive? (types, volume, edge cases)

### 0b. Load Design System

Invoke the **`ui-design-system`** skill to load constraints and tokens. Check for project-specific token overrides per the protocol in that skill.

### 0c. Choose Style Reference

Anchor the generation with a style reference. This activates domain-specific aesthetic knowledge:

| Style Reference | Aesthetic | Best For |
|----------------|-----------|----------|
| **Linear** | Minimal, spacious, monochrome with subtle accents | Developer tools, project management |
| **Vercel** | Clean, high-contrast, bold typography | Marketing, documentation, dashboards |
| **Stripe** | Polished, gradient-accent, information-dense | Financial, payment, data-heavy |
| **Notion** | Content-first, calm, typography-driven | Content tools, wikis, note-taking |
| **Raycast** | Dark-mode, command-palette, keyboard-first | Power user tools, search interfaces |
| **Apple** | Rounded, soft shadows, restrained color | Consumer apps, settings, media |

If no reference specified, default to **Linear aesthetic** (minimal, spacious, clean).

---

## Phase 1: Requirements Analysis

### Step 1.1: Define Component Contract

```typescript
// Before writing ANY JSX, define the TypeScript interface
interface ComponentProps {
  // Required props (what the component NEEDS)
  // Optional props with defaults (what the component CAN customize)
  // Callback props (what the component EMITS)
  // Children/composition props (what the component WRAPS)
}
```

**Rules:**
- Every prop has a TypeScript type
- Optional props have sensible defaults
- No `any` types — if the type is complex, define it
- Use discriminated unions for variant props (not string enums)

### Step 1.2: Identify Component States

List ALL states before coding. Generic AI misses states — this is where you win:

| State Category | States to Handle |
|----------------|-----------------|
| **Data** | Loading, Empty, Error, Success, Partial |
| **Interaction** | Default, Hover, Focus, Active, Disabled |
| **Responsive** | Mobile, Tablet, Desktop, Wide |
| **Content** | Minimal data, Typical data, Overflow/truncation |
| **Authentication** | Authenticated, Unauthenticated, Pending |

### Step 1.3: Plan Hierarchy

Before writing markup, decide:
- What is the **primary** element? (ONE thing that draws the eye first)
- What are **secondary** elements? (supporting content)
- What are **tertiary** elements? (metadata, timestamps, supplementary)

Sketch the hierarchy in a comment:

```
// Hierarchy:
// PRIMARY: [main action / key metric / title]
// SECONDARY: [description / supporting data / navigation]
// TERTIARY: [metadata / timestamps / secondary actions]
```

---

## Phase 2: Structure Pass

Generate the component skeleton — structure only, no styling.

### Step 2.1: Component Tree

```tsx
// Component tree (structure only)
export function ComponentName({ ...props }: ComponentProps) {
  return (
    <section>          {/* container with semantic HTML */}
      <header>         {/* primary content zone */}
        <h2>           {/* hierarchy: primary */}
        <p>            {/* hierarchy: secondary */}
      </header>
      <div>            {/* content zone */}
        {/* main content area */}
      </div>
      <footer>         {/* action zone */}
        <button>       {/* primary action */}
        <button>       {/* secondary action */}
      </footer>
    </section>
  );
}
```

**Rules:**
- Use semantic HTML (`section`, `article`, `nav`, `header`, `footer`, `main`)
- Component decomposition: extract sub-components for any repeated pattern or block >30 lines
- Data mapping: use `.map()` with proper `key` props
- Conditional rendering: handle all states from Step 1.2

### Step 2.2: State Management

- Use `useState` for local UI state
- Use `useReducer` for complex multi-field state
- Derive what you can — don't store computed values in state
- Memoize expensive computations with `useMemo`, callbacks with `useCallback`

---

## Phase 3: Style Pass

Apply design tokens and Tailwind utilities. This is where the design system is enforced.

### Step 3.1: Apply Spacing

Work outside-in:
1. **Page/section margins** → `px-4 md:px-6 lg:px-8`
2. **Container max-width** → `max-w-7xl mx-auto`
3. **Section gaps** → `space-y-12` or `gap-12`
4. **Component gaps** → `gap-4` or `gap-6`
5. **Internal padding** → `p-4` or `p-6`
6. **Element gaps** → `gap-2` or `gap-3`

### Step 3.2: Apply Typography

Work top-down:
1. **Headings** → size, weight, color, letter-spacing
2. **Body text** → size, weight, line-height, color
3. **Captions/labels** → size, weight, color (muted)
4. **Interactive text** → links, buttons (size, weight)

Verify the typography hierarchy creates clear visual levels.

### Step 3.3: Apply Color

Follow the semantic token map:
1. **Backgrounds** → `bg-slate-50` (page), `bg-white` (surface)
2. **Text** → `text-slate-900` (primary), `text-slate-500` (secondary)
3. **Borders** → `border-slate-200` (default), `border-slate-100` (subtle)
4. **Brand accents** → Sparingly, for primary actions and key indicators
5. **Semantic colors** → Error (red), success (green), warning (amber) — only for states

### Step 3.4: Apply Layout

```tsx
// Responsive grid example
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  {items.map(item => <Card key={item.id} {...item} />)}
</div>

// Sidebar layout example
<div className="flex flex-col lg:flex-row gap-6">
  <aside className="w-full lg:w-64 shrink-0">...</aside>
  <main className="flex-1 min-w-0">...</main>
</div>
```

---

## Phase 4: Polish Pass

This phase separates professional UI from generic output. Do NOT skip.

### Step 4.1: Micro-Interactions

Add to every interactive element:

```tsx
// Button with full interaction states
<button
  className={cn(
    "inline-flex items-center justify-center gap-2",
    "px-4 py-2 min-h-[44px] rounded-lg",
    "text-sm font-medium",
    "bg-blue-500 text-white",
    "hover:bg-blue-600 hover:scale-[1.02]",
    "active:scale-[0.98]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
    "transition-all duration-150 ease-out"
  )}
>
```

### Step 4.2: Loading States

```tsx
// Skeleton loader for content
function CardSkeleton() {
  return (
    <div className="animate-pulse space-y-3 p-6 rounded-xl border border-slate-100">
      <div className="h-4 w-2/3 bg-slate-200 rounded" />
      <div className="h-3 w-full bg-slate-100 rounded" />
      <div className="h-3 w-4/5 bg-slate-100 rounded" />
    </div>
  );
}

// Spinner for actions
function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin h-4 w-4", className)} viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
```

### Step 4.3: Empty States

Every list/grid/table needs an empty state:

```tsx
function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-slate-100 p-4 mb-4">
        <Icon className="h-8 w-8 text-slate-400" />
      </div>
      <h3 className="text-lg font-medium text-slate-900 mb-1">{title}</h3>
      <p className="text-sm text-slate-500 mb-6 max-w-sm">{description}</p>
      {action && <Button variant="primary">{action}</Button>}
    </div>
  );
}
```

### Step 4.4: Error States

```tsx
// Inline field error
<div className="space-y-1">
  <label className="text-sm font-medium text-slate-700">{label}</label>
  <input className={cn(
    "w-full px-3 py-2 rounded-lg border transition-colors",
    error ? "border-red-500 focus:ring-red-500" : "border-slate-200 focus:ring-blue-500",
    "focus:ring-2 focus:outline-none"
  )} />
  {error && (
    <p className="text-sm text-red-500 flex items-center gap-1">
      <AlertCircle className="h-3.5 w-3.5" />
      {error}
    </p>
  )}
</div>
```

### Step 4.5: Transitions

```tsx
// Framer Motion for complex transitions
import { motion, AnimatePresence } from "framer-motion";

<AnimatePresence mode="wait">
  {isVisible && (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {content}
    </motion.div>
  )}
</AnimatePresence>
```

---

## Phase 5: Accessibility Pass

Non-negotiable. Run through this checklist for every component:

### Step 5.1: Keyboard Navigation

- [ ] All interactive elements reachable via Tab
- [ ] Tab order follows visual layout (no `tabIndex` >0)
- [ ] Escape closes modals/dropdowns
- [ ] Enter/Space activates buttons and links
- [ ] Arrow keys navigate within groups (tabs, menus, radio groups)

### Step 5.2: Screen Reader Support

- [ ] Meaningful heading hierarchy (h1 → h2 → h3, no skipping)
- [ ] All images: `alt` text or `aria-hidden="true"` if decorative
- [ ] All icons: `aria-label` on the button/link, or `aria-hidden="true"` on the icon
- [ ] Form inputs: `<label htmlFor>` or `aria-label`
- [ ] Dynamic content: `aria-live="polite"` for updates, `aria-live="assertive"` for errors
- [ ] Landmark regions: `<main>`, `<nav>`, `<aside>`, `<header>`, `<footer>`

### Step 5.3: Reduced Motion

```tsx
// Respect prefers-reduced-motion
<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{
    duration: prefersReducedMotion ? 0 : 0.2,
    ease: "easeOut"
  }}
>
```

Or in Tailwind: `motion-safe:animate-pulse`, `motion-reduce:transition-none`

---

## Phase 6: Self-Review

Before presenting output or handing to a critic, self-check:

### Quick Constraint Scan

| Category | Check | Pass? |
|----------|-------|-------|
| Spacing | All values from the 4/8px scale? No arbitrary values? | |
| Typography | ≤2 families, ≤3 weights, ≥14px body? Clear hierarchy? | |
| Color | Semantic tokens used? Contrast ≥4.5:1? No pure black? | |
| Hierarchy | Primary/secondary/tertiary clearly established? | |
| States | Loading, empty, error all handled? | |
| Interactions | Hover + focus + active on all interactive elements? | |
| Accessibility | Labels, keyboard nav, contrast, reduced motion? | |
| Responsive | Works at 320px? Breakpoints defined? | |

If any check fails, fix it before proceeding.

---

## Prompt Engineering Techniques

### Role Anchoring

Always establish the generation context with a role anchor:

```
"You are a senior UI designer who creates interfaces like [Linear/Vercel/Stripe].
Your work is known for: generous whitespace, clear hierarchy, subtle micro-interactions,
and a restrained color palette with purposeful accents."
```

### Specificity Over Vagueness

| ❌ Vague | ✅ Specific |
|----------|-----------|
| "Create a dashboard" | "Create a metrics dashboard with sidebar nav, 3 KPI cards at top, line chart below, activity feed on right. 8px grid, slate palette, shadow-sm cards" |
| "Add a form" | "Create a 2-column settings form with labeled inputs, inline validation, save/cancel footer bar, 16px gap between fields" |
| "Make it look good" | "Apply Linear aesthetic: generous whitespace (48px section gaps), subtle shadows, muted borders, clear typography hierarchy" |

### Tech Stack Declaration

Always include in the generation context:

```
React 18+ / TypeScript strict / Tailwind CSS / shadcn/ui primitives / Lucide icons
```

This prevents mixing incompatible patterns (Bootstrap classes in a Tailwind project, etc.).

---

## Curated Component Examples

See the `references/` directory for production-quality examples of common components. Each example demonstrates all design system constraints in working code:

- `references/button.tsx` — Full button system with variants, sizes, loading, icons
- `references/card.tsx` — Content card with hierarchy, hover, responsive behavior
- `references/form.tsx` — Form with validation, error states, accessibility
- `references/data-table.tsx` — Table with sort, pagination, empty state, responsive
- `references/dashboard-layout.tsx` — Full layout with sidebar, header, content areas

Use these as few-shot context. Include 1-2 relevant examples when generating similar components.

## References

- [v0.dev UI Generation Patterns](https://v0.dev/)
- [shadcn/ui Component Reference](https://ui.shadcn.com/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Framer Motion API](https://www.framer.com/motion/)
- [Radix UI Primitives](https://www.radix-ui.com/)
