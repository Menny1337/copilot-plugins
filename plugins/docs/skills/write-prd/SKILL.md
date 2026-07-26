---
name: write-prd
description: 'Create product requirements documents through structured discovery and interview. Use when creating a PRD, planning a feature, writing a spec, or designing a solution before implementation.'
argument-hint: "<feature or product idea>"
---

# Write a PRD

Author a Product Requirements Document through structured discovery, user interview, and codebase exploration. Produces a PRD published as a GitHub Issue or ADO work item.

## When to Use

- Planning a new feature, enhancement, or significant refactor
- Translating a vague idea into a structured, actionable specification
- Need a shared artifact that developers, reviewers, and PMs can reference
- Before decomposing work into individual tasks or work items
- When requirements are unclear and need systematic discovery

## When to Skip

- **Bug fixes** with clear reproduction steps — file an issue directly
- **Trivial changes** — typos, config tweaks, dependency bumps. Just do them.
- **Spikes / research** — use a research methodology instead; PRDs are for known-enough problems
- **Work item already exists** with clear requirements — jump to `prd-to-work-items` to decompose it
- **Mid-implementation** — if you're already building, a PRD won't help. Capture decisions in commit messages or docs.

## Procedure

### Step 1: Gather the Problem

Ask the user for a detailed description of:

- **The problem** they want to solve — what's painful, missing, or broken?
- **Who is affected** — end users, developers, other teams?
- **Any solution ideas** they already have — don't discard these, but don't anchor on them
- **Context** — is this for a specific repo? Which team/product area? Any prior art or related features?

Let the user talk. Capture everything before narrowing.

### Step 2: Explore the Codebase

If a repository is identified, explore it to validate the user's assertions and build context:

- Identify the relevant modules, components, and integration layers
- Check for existing patterns that the feature should follow
- Look for prior art — has something similar been built before?
- Note technical constraints (frameworks, APIs, data models) that will shape the solution

Share your findings with the user. Correct any misconceptions about the current state.

### Step 3: Interview — Functional Requirements

Interview the user relentlessly about every functional aspect. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

Cover:
- **User stories** — Who does what, and why? Be exhaustive.
- **Workflows** — What are the step-by-step user flows?
- **Edge cases** — What happens when things go wrong? Empty states? Concurrent access?
- **Data** — What data is created, read, updated, deleted? What's the shape?
- **Integration points** — What other systems, APIs, or services does this touch?
- **Scope boundaries** — What is explicitly OUT of scope?

Do not move on until you and the user have a shared understanding of the functional requirements.

### Step 4: Interview — Non-Functional Requirements

Systematically cover each NFR category. Ask about each one explicitly — users often forget these until review time.

**Security:**
- Authentication / authorization requirements
- Data sensitivity classification
- Input validation and sanitization needs
- Audit logging requirements

**Privacy:**
- PII handling — what personal data is involved?
- Data retention and deletion requirements
- Consent and disclosure needs
- Cross-boundary data transfer considerations

**Accessibility:**
- WCAG compliance level required
- Keyboard navigation requirements
- Screen reader considerations
- Color contrast and visual requirements

**Performance:**
- Expected load / concurrent users
- Latency requirements (p50, p99)
- Data volume expectations
- Caching strategy needs

For each category, it's valid for the user to say "not applicable" or "standard defaults" — just capture that decision.

### Step 5: Design Modules

Sketch out the major modules that need to be built or modified. Actively look for opportunities to extract **deep modules** — modules that encapsulate significant functionality behind a simple, testable interface that rarely changes.

> A deep module (as opposed to a shallow module) is one which encapsulates a lot of functionality in a simple, testable interface which rarely changes. — *A Philosophy of Software Design*

For each module, identify:
- Its responsibility (single sentence)
- Its interface (what goes in, what comes out)
- Its dependencies (what it needs from other modules)
- Whether it's new or a modification of something existing

Present the module breakdown to the user. Ask:
- Do these modules match your mental model?
- Are any modules missing?
- Which modules need tests? What kind of tests?

### Step 6: Generate the PRD

Using everything gathered, write the PRD using the template below. The PRD should be comprehensive but not repetitive — each section has a distinct purpose.

<prd-template>

## Problem Statement

The problem from the user's perspective. What's painful, missing, or broken? Who is affected and how?

## Solution

The proposed solution at a high level. Describe the end state — what will be true when this is done?

## User Stories

A comprehensive, numbered list of user stories covering all functional requirements.

1. As a `<actor>`, I want `<capability>`, so that `<benefit>`

This list should be exhaustive — cover the happy path, edge cases, error states, and administrative scenarios.

## Implementation Decisions

Key technical decisions that shape the implementation. Include:

- Modules to be built or modified and their responsibilities
- Interface contracts between modules
- Architectural decisions with rationale
- Schema changes or data model updates
- API contracts (endpoints, payloads, responses)
- Specific interaction patterns

Do NOT include file paths or code snippets — they become outdated quickly.

## Non-Functional Requirements

### Security
- [ ] `<Security requirement or "No specific requirements beyond standard practices">`

### Privacy
- [ ] `<Privacy requirement or "No PII handling involved">`

### Accessibility
- [ ] `<Accessibility requirement or "Standard WCAG 2.1 AA compliance">`

### Performance
- [ ] `<Performance requirement or "No specific performance targets">`

## Testing Decisions

- What makes a good test for this feature (test external behavior, not implementation details)
- Which modules will be tested and how
- Prior art — similar tests in the codebase to follow as patterns
- Integration test needs

## Out of Scope

Explicitly list what this PRD does NOT cover, including:
- Features deferred to future iterations
- NFR areas marked as not applicable and why
- Adjacent features that might seem related but are separate

## Open Questions

Any unresolved questions that need answers before or during implementation.

</prd-template>

### Step 7: Publish

Ask the user where to publish the PRD:

**Option A — GitHub Issue:**
```bash
gh issue create --title "<Feature Name> — PRD" --body "<prd-content>" --label "prd"
```

**Option B — ADO Work Item:**
```bash
az boards work-item create \
  --type "Feature" \
  --title "<Feature Name> — PRD" \
  --description "<prd-content>" \
  --org "https://dev.azure.com/<org>" \
  --project "<project>"
```

**Option C — Markdown File:**
Save as a `.md` file in the repo or session workspace if the user prefers not to use a tracker.

After publishing, print the link/ID so the user can reference it in `prd-to-work-items`.

## Tips

- **Don't rush the interview** — a thorough PRD saves more time than it costs
- **Challenge assumptions** — if the user says "obviously X", ask why. Obvious things often aren't.
- **Capture decisions, not just requirements** — "We chose X over Y because Z" is more valuable than just "X"
- **NFRs are first-class** — reviewers (human or automated) will ask about security, privacy, accessibility, and performance. Addressing them upfront prevents late-stage rework.
- **No file paths in the PRD** — implementation details change; the PRD should describe WHAT and WHY, not WHERE
