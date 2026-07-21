---
name: ui-design-system
description: "Review and apply design system constraints and tokens for beautiful UI generation. Use when creating, styling, or reviewing React/TypeScript UI components. Provides spacing, typography, color, layout, animation rules, anti-patterns, and project token override protocol."
---

# UI Design System

Comprehensive design system constraints and tokens that produce beautiful, intentional, professional UI. This is the shared constitution — every UI component must comply with these rules.

> "Beautiful UI is not the absence of constraints — it's the presence of intentional ones."

## When to Use

- Generating any React/TypeScript UI component or layout
- Styling existing components to meet professional standards
- Reviewing UI code for design system compliance
- Setting up design tokens for a new project
- Evaluating whether UI output meets quality standards

## When to Skip

- Backend/API code with no UI surface — no design system needed
- Modifying existing components where the project has its own design system that conflicts — defer to the project's system
- Pure logic/state management changes with no visual impact

## Project Token Override Protocol

Before applying the default tokens below, check for project-specific overrides:

### Step 1: Check for Project Tokens

```bash
# Check repo root for token override file
ls .ui-tokens.json 2>/dev/null
# Also check common locations
ls src/tokens.json design-tokens.json .design/tokens.json 2>/dev/null
```

### Step 2: Merge Strategy

- If `.ui-tokens.json` (or equivalent) exists → use project tokens, fall back to defaults for any missing values
- If no project tokens exist → use the full default set below
- Always mention which token set is being used in output: "Using project tokens from `.ui-tokens.json`" or "Using default design system tokens"

### Step 3: Token File Format

Project token files should follow this structure (partial overrides are fine):

```json
{
  "brand": { "primary": "#0066ff", "secondary": "#00c896" },
  "typography": { "families": { "body": "Geist, system-ui, sans-serif" } },
  "overrides": { "note": "Only include values that differ from defaults" }
}
```

---

## Design Tokens (Three-Layer Architecture)

### Layer 1: Primitive Tokens (Raw Values)

These are the atomic values. Never use primitives directly in components — always reference through semantic or component tokens.

```json
{
  "spacing": {
    "0": "0px",
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "6": "24px",
    "8": "32px",
    "12": "48px",
    "16": "64px",
    "24": "96px"
  },
  "color": {
    "blue-500": "#0066ff",
    "blue-600": "#0052cc",
    "green-500": "#00c896",
    "green-600": "#10b981",
    "red-500": "#ef4444",
    "amber-500": "#f59e0b",
    "slate-50": "#f8fafc",
    "slate-100": "#f1f5f9",
    "slate-200": "#e2e8f0",
    "slate-300": "#cbd5e1",
    "slate-400": "#94a3b8",
    "slate-500": "#64748b",
    "slate-600": "#475569",
    "slate-700": "#334155",
    "slate-800": "#1e293b",
    "slate-900": "#0f172a",
    "white": "#ffffff"
  },
  "fontSize": {
    "xs": "12px",
    "sm": "14px",
    "base": "16px",
    "lg": "20px",
    "xl": "25px",
    "2xl": "31px",
    "3xl": "39px",
    "4xl": "49px"
  },
  "fontWeight": {
    "regular": 400,
    "medium": 500,
    "bold": 700
  },
  "radius": {
    "sm": "6px",
    "md": "8px",
    "lg": "12px",
    "xl": "16px",
    "full": "9999px"
  },
  "shadow": {
    "sm": "0 1px 2px rgba(0,0,0,0.05)",
    "md": "0 4px 6px rgba(0,0,0,0.07)",
    "lg": "0 10px 15px rgba(0,0,0,0.1)",
    "xl": "0 20px 25px rgba(0,0,0,0.1)"
  }
}
```

### Layer 2: Semantic Tokens (Purpose-Driven)

Map primitives to their meaning. These are what components should reference.

```json
{
  "color": {
    "brand-primary": "{blue-500}",
    "brand-primary-hover": "{blue-600}",
    "brand-secondary": "{green-500}",
    "background-page": "{slate-50}",
    "background-surface": "{white}",
    "background-surface-raised": "{white}",
    "background-muted": "{slate-100}",
    "text-primary": "{slate-900}",
    "text-secondary": "{slate-500}",
    "text-tertiary": "{slate-400}",
    "text-on-brand": "{white}",
    "border-default": "{slate-200}",
    "border-subtle": "{slate-100}",
    "border-strong": "{slate-300}",
    "success": "{green-600}",
    "warning": "{amber-500}",
    "error": "{red-500}",
    "focus-ring": "{blue-500}"
  },
  "spacing": {
    "inline-xs": "{spacing.1}",
    "inline-sm": "{spacing.2}",
    "inline-md": "{spacing.4}",
    "inline-lg": "{spacing.6}",
    "stack-xs": "{spacing.1}",
    "stack-sm": "{spacing.2}",
    "stack-md": "{spacing.4}",
    "stack-lg": "{spacing.6}",
    "section-tight": "{spacing.6}",
    "section-normal": "{spacing.12}",
    "section-loose": "{spacing.24}",
    "component-gap": "{spacing.4}",
    "card-padding": "{spacing.6}"
  },
  "typography": {
    "heading-1": { "size": "{4xl}", "weight": "{bold}", "lineHeight": 1.1 },
    "heading-2": { "size": "{3xl}", "weight": "{bold}", "lineHeight": 1.2 },
    "heading-3": { "size": "{2xl}", "weight": "{bold}", "lineHeight": 1.2 },
    "heading-4": { "size": "{xl}", "weight": "{medium}", "lineHeight": 1.3 },
    "body-lg": { "size": "{lg}", "weight": "{regular}", "lineHeight": 1.5 },
    "body": { "size": "{base}", "weight": "{regular}", "lineHeight": 1.5 },
    "body-sm": { "size": "{sm}", "weight": "{regular}", "lineHeight": 1.5 },
    "caption": { "size": "{xs}", "weight": "{medium}", "lineHeight": 1.5 },
    "label": { "size": "{sm}", "weight": "{medium}", "lineHeight": 1.5 }
  }
}
```

### Layer 3: Component Tokens (Specific Components)

```json
{
  "button": {
    "primary-bg": "{brand-primary}",
    "primary-bg-hover": "{brand-primary-hover}",
    "primary-text": "{text-on-brand}",
    "secondary-bg": "transparent",
    "secondary-border": "{border-default}",
    "secondary-text": "{text-primary}",
    "ghost-text": "{text-secondary}",
    "padding-x": "{spacing.4}",
    "padding-y": "{spacing.2}",
    "radius": "{radius.md}",
    "min-height": "44px",
    "font": "{label}"
  },
  "card": {
    "bg": "{background-surface}",
    "border": "{border-subtle}",
    "radius": "{radius.lg}",
    "padding": "{spacing.6}",
    "shadow": "{shadow.sm}",
    "shadow-hover": "{shadow.md}"
  },
  "input": {
    "bg": "{background-surface}",
    "border": "{border-default}",
    "border-focus": "{brand-primary}",
    "border-error": "{error}",
    "radius": "{radius.md}",
    "padding-x": "{spacing.3}",
    "padding-y": "{spacing.2}",
    "min-height": "44px",
    "font": "{body}",
    "placeholder-color": "{text-tertiary}"
  },
  "badge": {
    "padding-x": "{spacing.2}",
    "padding-y": "{spacing.1}",
    "radius": "{radius.full}",
    "font": "{caption}"
  }
}
```

---

## Constraint Rules

### 1. Spacing (8px Grid)

All spacing MUST use values from the spacing scale. No arbitrary values.

| Context | Allowed Values | Tailwind |
|---------|---------------|----------|
| Related element gaps | 4, 8, 12, 16px | `gap-1`, `gap-2`, `gap-3`, `gap-4` |
| Component internal padding | 8, 12, 16, 24px | `p-2`, `p-3`, `p-4`, `p-6` |
| Section separations | 24, 48, 96px | `gap-6`, `gap-12`, `gap-24` |
| Touch targets | ≥44px height/width | `min-h-11`, `min-w-11` |
| Page margins | 16, 24, 32px | `px-4`, `px-6`, `px-8` |

**Rules:**
- Grid base: 8px. All spacing is a multiple of 4px.
- Related items: 8–16px apart
- Unrelated sections: ≥48px apart
- Never use arbitrary values like 7px, 13px, 19px, 15px
- Minimum touch target for interactive elements: 44×44px

### 2. Typography (1.25 Modular Scale)

| Level | Size | Weight | Line Height | Use For |
|-------|------|--------|-------------|---------|
| Display | 49px | 700 | 1.1 | Hero headlines only |
| H1 | 39px | 700 | 1.2 | Page titles |
| H2 | 31px | 700 | 1.2 | Section headers |
| H3 | 25px | 600 | 1.3 | Subsections |
| H4 | 20px | 500 | 1.3 | Card titles, labels |
| Body Large | 20px | 400 | 1.5 | Lead paragraphs |
| Body | 16px | 400 | 1.5 | Default text |
| Body Small | 14px | 400 | 1.5 | Secondary text, captions |
| Caption | 12px | 500 | 1.5 | Metadata, timestamps |

**Rules:**
- Maximum 2 font families total (1 sans-serif, 1 monospace)
- Default: `Inter, system-ui, sans-serif` (body) + `JetBrains Mono, monospace` (code)
- Maximum 3 font weights: 400 (regular), 500 (medium), 700 (bold)
- Minimum body text: 14px. Never smaller for readable content.
- Line height: 1.5× for body, 1.2× for headings
- Letter spacing: -0.02em for headings ≥25px, normal for body

### 3. Color & Contrast

**Rules:**
- Maximum 3 brand colors + full neutral scale
- Text contrast minimum: 4.5:1 (WCAG AA)
- UI element contrast minimum: 3:1
- NEVER use pure black (`#000000`) for text — use `slate-900` (#0f172a) or similar
- NEVER use pure white (`#ffffff`) for page backgrounds — use `slate-50` (#f8fafc) for pages, white for surfaces/cards
- Use semantic color tokens, not raw hex codes
- Every color choice must have a purpose — decorative color without meaning is noise

**Semantic Color Usage:**
| Purpose | Token | Tailwind Example |
|---------|-------|------------------|
| Primary action | `brand-primary` | `bg-blue-500 text-white` |
| Page background | `background-page` | `bg-slate-50` |
| Card/surface | `background-surface` | `bg-white` |
| Primary text | `text-primary` | `text-slate-900` |
| Secondary text | `text-secondary` | `text-slate-500` |
| Subtle borders | `border-subtle` | `border-slate-100` |
| Success state | `success` | `text-green-600` |
| Error state | `error` | `text-red-500` |
| Warning state | `warning` | `text-amber-500` |

### 4. Layout

**Rules:**
- 12-column grid system
- Maximum content width: 1440px (`max-w-7xl`)
- Reading width for prose: 65ch (`max-w-prose`)
- Mobile-first responsive breakpoints:
  - Mobile: 320px+ (default)
  - Tablet: 768px+ (`md:`)
  - Desktop: 1024px+ (`lg:`)
  - Wide: 1440px+ (`xl:`)
- Every layout must work at mobile width — no desktop-only designs
- Use CSS Grid or Flexbox, never floats or absolute positioning for layout

### 5. Visual Hierarchy (MANDATORY)

Every component and every screen MUST establish clear hierarchy levels:

| Level | Purpose | Technique |
|-------|---------|-----------|
| **Primary** | The single most important element | Largest, boldest, highest contrast, prominent position |
| **Secondary** | Supporting content | Medium size/weight, standard contrast |
| **Tertiary** | Metadata, supplementary | Smallest, lightest weight, muted color |

**Rules:**
- NEVER give all elements equal emphasis — that is the #1 sign of generic AI UI
- Every screen has exactly ONE primary focal point
- Hierarchy established through: size + weight + color + position + whitespace
- Group related items with proximity (8–16px); separate unrelated with distance (≥48px)
- Use whitespace as a design element — it creates hierarchy through breathing room

### 6. Micro-Interactions (MANDATORY)

Every interactive element MUST have state feedback:

| Element | State | Specification | Tailwind |
|---------|-------|--------------|----------|
| Buttons | Hover | `scale(1.02)`, 150ms ease-out | `hover:scale-[1.02] transition-transform duration-150` |
| Buttons | Active/Press | `scale(0.98)`, 100ms | `active:scale-[0.98]` |
| Buttons | Disabled | 50% opacity, no pointer | `disabled:opacity-50 disabled:cursor-not-allowed` |
| Buttons | Loading | Spinner icon, disabled state | Custom spinner + `disabled` |
| Cards | Hover | Shadow elevation + subtle translate | `hover:shadow-md hover:-translate-y-0.5 transition-all duration-200` |
| Links | Hover | Color shift + underline | `hover:text-blue-600 hover:underline` |
| Inputs | Focus | Brand color ring | `focus:ring-2 focus:ring-blue-500 focus:border-blue-500` |
| Inputs | Error | Red border + shake | `border-red-500 animate-shake` |
| Inputs | Valid | Green border/icon | `border-green-500` |
| All transitions | Default | 200ms ease-in-out | `transition-all duration-200 ease-in-out` |
| Page transitions | Enter/exit | 200–300ms ease-in-out | Framer Motion `animate` |
| Loading | Skeleton | Pulse animation, min 300ms display | `animate-pulse` skeleton |
| Loading | Spinner | For actions, min 200ms display | Custom or library spinner |

**Rules:**
- EVERY interactive element needs hover + focus + active states
- All transitions: 150–300ms (fast enough to feel responsive, slow enough to perceive)
- Always respect `prefers-reduced-motion` — wrap animations in media query
- Loading: use skeleton screens for content, spinners for actions
- Show skeletons for minimum 300ms to avoid flash

### 7. Shadows & Elevation

| Level | Use | Token | Tailwind |
|-------|-----|-------|----------|
| Flat | In-page content | none | — |
| Low | Cards, surfaces | `shadow-sm` | `shadow-sm` |
| Medium | Dropdowns, popovers | `shadow-md` | `shadow-md` |
| High | Modals, dialogs | `shadow-lg` | `shadow-lg` |
| Highest | Toasts, notifications | `shadow-xl` | `shadow-xl` |

**Rule:** Elevation implies importance and interactivity. Higher = more important/interactive.

### 8. Border Radius

| Context | Token | Tailwind |
|---------|-------|----------|
| Buttons, inputs | `radius-md` (8px) | `rounded-lg` |
| Cards, containers | `radius-lg` (12px) | `rounded-xl` |
| Modal/dialog | `radius-xl` (16px) | `rounded-2xl` |
| Badges, chips | `radius-full` | `rounded-full` |
| Small elements | `radius-sm` (6px) | `rounded-md` |

**Rule:** Be consistent — don't mix different radii on the same elevation level.

---

## Anti-Patterns — NEVER DO THESE

| # | Anti-Pattern | Symptom | Correct Approach |
|---|-------------|---------|-----------------|
| 1 | **Arbitrary spacing** | `p-[7px]`, `gap-[13px]`, `mt-[19px]` | Use scale values only: `p-2`, `gap-3`, `mt-5` |
| 2 | **Equal emphasis** | Every element same size, weight, and color | Establish 3 hierarchy levels minimum |
| 3 | **Missing states** | Buttons with no hover, inputs with no focus | Every interactive element: hover + focus + active + disabled |
| 4 | **No loading feedback** | Empty space while data loads | Skeleton screens for content, spinners for actions |
| 5 | **No error feedback** | Silent failures, no validation display | Inline errors after 300ms debounce, error boundaries |
| 6 | **Font overload** | 3+ font families, 4+ weights | Maximum 2 families, 3 weights |
| 7 | **Low contrast** | Light gray text on white | Minimum 4.5:1 for text, 3:1 for UI |
| 8 | **Pure black text** | `#000000` on white | Use `slate-900` (#0f172a) — softer, more professional |
| 9 | **Desktop-only** | No responsive behavior | Mobile-first with all breakpoints |
| 10 | **Cramped layout** | Elements touching, no breathing room | Minimum 8px between elements, 48px between sections |
| 11 | **Template sterility** | Default gray palette, generic card grid | Use provided brand tokens, create visual personality |
| 12 | **Inline styles** | `style={{ color: 'red' }}` | Tailwind utilities or token-mapped classes |
| 13 | **Missing empty states** | Blank page when no data | "No results" illustration + message + action CTA |
| 14 | **No focus indicators** | Tab navigation invisible | Visible focus ring on all interactive elements |
| 15 | **Ignoring reduced motion** | Animations regardless of preference | Wrap in `prefers-reduced-motion` media query |

---

## Accessibility Requirements (WCAG 2.1 AA)

These are not optional — they are mandatory for every component:

| Requirement | Specification |
|-------------|--------------|
| Color contrast (text) | ≥4.5:1 against background |
| Color contrast (UI) | ≥3:1 for borders, icons, controls |
| Color independence | Never convey information by color alone — use icons/text too |
| Keyboard navigation | All interactive elements reachable and operable via keyboard |
| Focus indicators | Visible `focus-visible` ring (2px, brand color) on all interactive elements |
| ARIA labels | All icons, images, and non-text content have `aria-label` or `aria-hidden="true"` |
| Form labels | Every `<input>` has an associated `<label>` element |
| Error identification | Errors identified by text, not just color |
| Touch targets | Minimum 44×44px for all interactive elements |
| Skip links | "Skip to main content" link for keyboard users on pages with navigation |
| Reduced motion | Respect `prefers-reduced-motion: reduce` — disable or simplify animations |
| Screen reader | Meaningful heading hierarchy (h1→h2→h3, no skipping), landmark regions |

---

## Tech Stack Specification

When generating UI, declare and follow this stack:

```
- React 18+ with TypeScript (strict mode)
- Tailwind CSS v3+ (utility-first, no custom CSS unless absolutely necessary)
- shadcn/ui (accessible component primitives — Radix UI based)
- Lucide React (consistent icon set)
- Framer Motion (complex animations only — simple ones use Tailwind transitions)
- clsx or cn() utility for conditional classes
```

**Component structure:**
- Functional components with TypeScript interfaces for all props
- Named exports (not default exports)
- Props interface defined above component
- Destructured props with sensible defaults
- `forwardRef` for components that wrap native elements
- `cn()` utility for merging Tailwind classes

---

## Quick Reference — Tailwind Class Map

For rapid generation, here are the most common token-to-Tailwind mappings:

```
// Spacing
gap-1 (4px) | gap-2 (8px) | gap-3 (12px) | gap-4 (16px) | gap-6 (24px) | gap-8 (32px)
p-2 (8px) | p-3 (12px) | p-4 (16px) | p-6 (24px) | p-8 (32px)

// Typography
text-xs (12px) | text-sm (14px) | text-base (16px) | text-lg (20px) | text-xl (25px)
font-normal (400) | font-medium (500) | font-bold (700)

// Colors
bg-slate-50 (page) | bg-white (surface) | bg-blue-500 (brand)
text-slate-900 (primary) | text-slate-500 (secondary) | text-slate-400 (tertiary)
border-slate-200 (default) | border-slate-100 (subtle)

// Layout
max-w-7xl (1440px) | max-w-prose (65ch)
grid grid-cols-12 | flex flex-col | flex items-center justify-between

// Interactive
hover:scale-[1.02] | active:scale-[0.98] | transition-all duration-200
focus:ring-2 focus:ring-blue-500 focus:outline-none
disabled:opacity-50 disabled:cursor-not-allowed
```

## References

- [Design Tokens Overview — Material Design 3](https://m3.material.io/foundations/design-tokens/overview)
- [Design Token Architecture — Martin Fowler](https://martinfowler.com/articles/design-token-based-ui-architecture.html)
- [Atlassian Design Tokens](https://atlassian.design/foundations/tokens/design-tokens/)
- [shadcn/ui Documentation](https://ui.shadcn.com/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [WCAG 2.1 AA Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
