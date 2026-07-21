---
name: research-methodology
description: "Structured 8-step research methodology for conducting rigorous, cited, evidence-based research. Use this skill for any research task, literature review, technology comparison, or investigation requiring web search, source evaluation, citation verification, scope limiting, and adversarial review. Invoke for research papers, reports, deep-dives, and analyses."
---

# Research Methodology

A reusable procedure for conducting structured, cited, neutral research. Any agent with web access can invoke this skill.

## When to Use

- Evaluating technology choices, tools, libraries, or frameworks
- Comparing architecture patterns, design approaches, or strategies
- Investigating best practices for a new domain or discipline
- Writing research papers, reports, literature reviews, or analyses
- Any decision or document that benefits from cited evidence

## When to Skip

- **Quick lookups** — Version numbers, API syntax, config values, definitions. One `web_search`, verify if needed, return inline. No report file, no comparison table.
- Questions answerable entirely from the codebase or local context
- Opinions or preferences that don't benefit from external evidence

## Search Rules

These apply to **every** search, whether inside the full methodology or a quick lookup:

1. **Start BROAD, then narrow** — e.g., `"whisper.cpp GPU acceleration 2025"` → `"whisper.cpp Metal CoreML benchmark"`. Agents default to overly specific queries that return few results.
2. **Never start with a 10+ word query** — Long initial queries over-constrain results. Begin with 3–6 words.
3. **Triangulate** — Require 3+ sources before stating something as fact. If only 1 source, flag it explicitly.
4. **Seek dissent** — After finding supporting evidence, search for counter-arguments or known issues. Don't just confirm your initial hypothesis.
5. **No fabricated URLs** — Only cite URLs received from `web_search` or `web_fetch` responses. Never construct a URL from memory.

## Methodology — 8 Steps

Every research task follows this structure:

### Step 1: Clarify the Question

Restate what's being asked in your own words. If the question is ambiguous or has multiple interpretations, **ask for clarification before researching** — don't waste search budget on the wrong question.

Determine:
- **Topic** — The specific research question or thesis
- **Audience** — Academic, professional, executive, or general reader
- **Format** — Research paper, industry report, literature review, comparison
- **Depth** — Quick overview, standard report, or deep dive
- **Constraints** — Excluded areas, time period, geographic scope

### Step 2: Read the Context

Understand existing context before searching externally. If researching within a project, scan the codebase. If researching a topic, check what you already know with high confidence. This ensures research is targeted, not generic.

### Step 3: Classify Query Type and Formulate Sub-Queries

Before formulating queries, classify the research question:

| Type | Description | Sub-Query Strategy | Example |
|------|-------------|-------------------|---------|
| **Breadth-first** | Breaks into distinct, independent sub-questions | 1 query per sub-topic, run in parallel | "Compare 3 wake word engines" → 1 per engine + 1 comparison |
| **Depth-first** | Multiple perspectives on a single issue | 1 query per perspective/methodology | "Why does X fail on Windows?" → tooling, format, process |
| **Straightforward** | Focused, well-defined, single investigation | 1–2 queries, minimal overhead | "latest release version of X" |

**Effort scaling** — match sub-query count to complexity:
- **Straightforward**: 1–2 sub-queries
- **Standard**: 3–4 sub-queries
- **Complex**: 5 sub-queries (max)

Decompose into **2–5** concrete, searchable queries. Each query should target a specific aspect. More than 5 sub-queries is a sign the question needs narrowing — go back to Step 1.

### Step 4: Execute Search Queries

Use `web_search` for each sub-query. Run independent queries **in parallel** for efficiency.

**Search strategy — start wide, then narrow:**
1. Begin with short, broad queries to survey the landscape
2. Evaluate what's available from initial results
3. Then progressively narrow focus with specific queries

For deep-dives, use `web_fetch` to read full pages — abstracts, methodology sections, data tables, and detailed arguments that search snippets truncate.

- Aim for **3+ diverse sources** per finding
- Cover: official docs, peer-reviewed journals, practitioner blogs, changelogs, institutional reports
- Never rely on a single source for a factual claim

### Step 4b: Evaluate and Refine

After each batch of search results, assess before moving on:

- **Did I find what I needed?** If not, reformulate the query with different terms or angle.
- **Did I discover a new relevant angle?** Add one targeted follow-up query (but respect the 5-query cap).
- **Are results converging?** If 3+ sources agree on a finding, stop searching that aspect and begin synthesizing.
- **Am I hitting diverse source types?** Deliberately target different categories per sub-query: official docs, academic papers, practitioner blogs, institutional reports, code repositories. If all results come from one category, add a query targeting a missing type.
- **Have I already searched this?** Before issuing a query, mentally check whether a prior query already covered it. Don't re-search aspects you've already found sufficient evidence for.

Research is iterative — don't treat the steps as a strict linear sequence.

### Step 4c: Reflect (Metacognition Checkpoint)

After completing your first round of searches (Steps 4 + 4b), pause and explicitly reflect before continuing. This is the most important quality lever — it's what separates systematic research from reactive searching.

Ask yourself these questions and write the answers in your working context:

1. **What worked?** Which queries returned the most useful results? What made them effective?
2. **What failed?** Which queries returned noise, irrelevant results, or nothing? Why?
3. **What's missing?** Compare findings so far against the original research questions. What aspects have no evidence yet?
4. **Should the plan change?** Based on what you've learned, does the original decomposition still make sense? If a sub-topic turned out to be irrelevant, drop it. If a new critical angle emerged, add it (within the 5-query cap).
5. **What's my confidence map?** For each aspect of the research, rate: High (3+ sources) / Medium (1-2 sources) / Low (0 or conflicting).

**Act on the reflection:**
- Reformulate failed queries using different terms or angles
- Drop sub-queries that turned out to be irrelevant
- Add sub-queries for newly discovered critical angles
- Revise the research plan if intermediate findings change the picture

This is not a one-time step — repeat this reflection after every major search batch, especially for deep dives.

### Step 5: Evaluate Sources

Rate credibility using this hierarchy:

```
Official docs/specs > Peer-reviewed journals > Government/institutional reports > Practitioner blogs > Forums > AI-generated
```

Four-dimension evaluation:
- **Authority** — Author credentials, publication reputation, institutional backing
- **Currency** — Publication date relative to the field's pace of change
- **Accuracy** — Peer-reviewed, cross-referenced, evidence-based
- **Purpose** — Informational vs. advocacy vs. commercial

Additional checks:
- Note publication dates — fields evolve rapidly
- Flag if all sources represent a single perspective or stakeholder
- Discard sources that are outdated, uncited, or clearly promotional
- **Watch for SEO content bias** — Prefer authoritative sources (official docs, academic papers, known practitioners) over SEO-optimized content farms and AI-generated listicles, even if the latter rank higher in search results

### Step 6: Cross-Reference

- If two sources disagree, **note the conflict and cite both**
- Actively search for **counter-arguments** to avoid confirmation bias
- If you only find supporting evidence, explicitly search for "[topic] problems" or "[topic] criticism"
- Present all credible perspectives — don't filter for a preferred narrative

### Step 7: Adversarial Review (Critical Decisions and Deep Dives)

For **high-stakes research** (architecture changes, security decisions, technology migrations, academic papers), add an adversarial step after Step 6:

1. **Steel-man the weakest option** — Find the strongest possible argument for the option you're least confident about
2. **Attack the strongest option** — Search specifically for problems, failures, and criticisms of the leading option
3. **Document the debate** — Add a "Devil's Advocate" section showing the strongest counter-argument for each position

**When to use adversarial review:**
- Academic papers and scholarly analysis
- Architecture or technology decisions with high switching cost
- Security-critical choices
- Controversial or politically sensitive topics
- Any research where bias could undermine credibility

**When to skip:** Quick lookups, routine comparisons, minor stylistic decisions.

### Step 7b: Verify Citations

Before finalizing any report:

- For each cited URL, confirm it came from a `web_search` or `web_fetch` response in this session
- If you cannot trace a URL to a tool response, **remove it** and note the gap explicitly
- For critical claims (security, breaking changes, statistics), re-fetch the source URL to confirm it still says what you cited
- Never assume a URL is valid from memory — verify or remove

**Semantic claim verification** — For key findings, go beyond URL provenance. For each critical claim backed by a citation, assess whether the source actually supports the claim:

| Rating | Meaning | Action |
|--------|---------|--------|
| **Supported** | Source directly states or strongly implies the claim | Keep as-is |
| **Partially Supported** | Source covers the topic but doesn't fully confirm the specific claim | Soften the language (e.g., "suggests" instead of "shows") |
| **Unsupported** | Source exists but doesn't actually support this claim | Remove the citation; find a better source or note the gap |
| **Uncertain** | Can't determine from the snippet; would need full-text review | Flag with a note: "based on abstract/snippet — full text not verified" |

You don't need to do this for every citation — focus on: statistics, strong causal claims, security/safety assertions, and any claim that drives a recommendation.

### Step 7c: Self-Evaluate (Pre-Delivery Quality Check)

Before moving to Step 8, assess your own research quality. This catches gaps that are easy to miss when deep in the material.

Run through this checklist:

- [ ] **Coverage** — Does the research address all the original questions from Step 1? List any unanswered aspects and note them as gaps in the deliverable.
- [ ] **Balance** — Are multiple perspectives represented? If the research only found supporting evidence, did you search for counter-arguments (Step 6)?
- [ ] **Confidence distribution** — For each major section/finding, what's the confidence level? Flag any section where confidence is Low.
- [ ] **Source diversity** — Are findings backed by diverse source types (not all from the same blog or vendor)?
- [ ] **Recency** — Are sources current enough for the topic's pace of change? Flag stale sources.
- [ ] **Counter-arguments** — For deep dives, is there a Devil's Advocate perspective? For standard research, are known limitations acknowledged?
- [ ] **Gaps acknowledged** — Are areas where evidence is thin or missing explicitly called out?

If any check fails, loop back to the relevant step (e.g., missing balance → Step 6, low confidence → Step 4) before proceeding to delivery.

### Step 8: Format and Deliver

Produce the final deliverable in the appropriate format. Save as a file — the file is the deliverable, not the chat message. Provide a brief summary in chat pointing to the file.

#### Writing Structure

Adapt format to the deliverable type:

**Research Paper:**
1. Abstract (150–300 words) — Thesis, methodology, key findings
2. Introduction — Context, significance, research questions, scope
3. Literature Review — Synthesis of existing knowledge and prior research
4. Methodology — Research approach, source selection criteria, limitations
5. Findings / Analysis — Organized sections with clear headers and evidence
6. Discussion — Interpretation, implications, limitations, future research
7. Conclusion — Summary of key findings and their significance
8. References — Complete formatted bibliography

**Report / Industry Analysis:**
1. Executive Summary — Key findings and takeaways (1 page max)
2. Background — Context, motivation, scope
3. Analysis — Organized sections with supporting evidence
4. Comparison (if applicable) — Tables comparing options with cited data
5. Conclusions — Evidence-based takeaways
6. Sources — All cited URLs with access dates

**Literature Review:**
1. Introduction — Topic, scope, review methodology
2. Thematic Sections — Grouped by theme, not chronology
3. Critical Analysis — Gaps, contradictions, trends in the literature
4. Conclusion — State of the field and directions for future research
5. References — Complete bibliography

**Technology Comparison:**
1. Question — What's being compared and why
2. Options — Each option with pros, cons, source, confidence level
3. Comparison Table — Side-by-side criteria matrix
4. Devil's Advocate — Strongest counter-argument per option
5. Recommendation Context — Tradeoffs (not decisions — you present, the reader decides)
6. Sources — All cited URLs with access dates

#### Output Quality

- Professional formatting with clear headings and consistent styling
- Title, date, and attribution at the top
- Tables and figures with captions and source citations
- References section must be complete and independently verifiable
- For papers exceeding ~3,000 words, outline structure first and confirm with the user

#### Research Folder Structure

Research output lives under `research/<topic-slug>/` **relative to the current working directory**:

```
<cwd>/research/<topic-slug>/
├── <topic-slug>.md          # Final report (the deliverable)
├── findings/                # Intermediate findings (audit trail)
│   ├── findings-phase1.md
│   ├── findings-phase2.md
│   └── ...
├── images/                  # Screenshots, diagrams, figures (optional)
└── files/                   # Attachments, data files, assets (optional)
```

**Rules:**
- Final report is always `<topic-slug>.md` at the root of the topic folder
- Intermediate findings go in `findings/` — one file per research phase
- Create `images/` and `files/` subfolders only when needed
- Each findings file includes: sub-questions investigated, sources found, key findings, confidence levels, and open questions
- At task start, resolve the research root using the current working directory — never hardcode paths

#### Confidence Annotations

For each major section or finding, indicate confidence level:

| Level | Badge | Meaning |
|-------|-------|---------|
| **High** | `[High confidence]` | 3+ credible, agreeing sources |
| **Medium** | `[Medium confidence]` | 1–2 credible sources, or partial agreement |
| **Low** | `[Low confidence]` | Sparse or conflicting evidence — flagged explicitly |

Use inline annotations rather than disrupting document flow. For research papers, integrate naturally ("Multiple studies confirm…" vs. "One preliminary study suggests…"). For reports, a confidence column in comparison tables works well.

After saving the file, provide a **3–5 sentence summary** in chat. The file is the deliverable.

## Scope Limiting (Anti-Rabbit-Hole)

Research must be bounded. Apply these guardrails:

- **Max 5 sub-queries** per research task. If the question needs more, narrow the scope first.
- **Stop when sufficient** — If 3+ credible sources agree on a finding, **stop searching that aspect and begin synthesizing**. Do not continue spawning queries for confirmation you already have. The most common waste pattern is continuing to search after adequate evidence exists.
- **Present what you have** — If after searching you have partial findings, present them with explicit confidence gaps rather than expanding indefinitely. "Here's what I found with medium confidence; these aspects need deeper investigation" is a valid and honest output.
- **Diminishing returns** — If the 4th and 5th sources repeat what the first 3 said, stop searching and synthesize.

**Confidence-based depth scaling:**

| Confidence Level | Evidence | Action |
|-----------------|----------|--------|
| **High** | 3+ agreeing credible sources | Stop searching this aspect. Synthesize. |
| **Medium** | 1–2 credible sources | Add 1 targeted follow-up query. |
| **Low** | 0 sources or conflicting evidence | Reformulate approach — try different search terms or angle. |

## Citation Rules

- **Consistent format** — Default to APA 7th edition unless specified otherwise. Maintain consistent style throughout the deliverable.
- **Only cite URLs** received from `web_search` or `web_fetch` — never fabricate a URL (enforced by Step 7b)
- **In-text citations** for ALL claims, statistics, quotes, and paraphrases — no uncited factual assertions
- **Complete reference entries** with all required elements (author, date, title, source, URL, access date)
- **Date your findings** — note when sources were published and when you accessed them
- **Credibility rating** — include per-source credibility note when relevant
- **Triangulate** — require 3+ sources before stating something as fact; if only 1 source, flag it explicitly
- **DOI preferred** — include DOI numbers for academic sources when available
- **Distinguish quotes from paraphrases** — direct quotes in quotation marks with page/section references; paraphrases clearly attributed
- **Footnotes** for additional context or methodological notes that would disrupt main text flow
- **Report staleness** — include date and note when findings may become outdated in rapidly changing fields
- **Never fabricate** a URL, DOI, author, or publication — if you can't verify it, say so explicitly

## Context Management

As research progresses, context grows. Actively manage it:

- Summarize completed research phases before starting new ones
- For complex research (5+ sub-queries), write intermediate findings to files before final synthesis
- Drop raw tool outputs from working memory once synthesized

### Progressive Summarization

1. **After each search batch** — Summarize key findings in a few sentences. Drop raw search results from working context once synthesized.
2. **After completing a sub-topic** — Write a paragraph-level summary. This becomes your reference for the final report.
3. **Before starting a new sub-topic** — Review your summaries, not the raw data. Only go back to raw sources to verify specific details.

### Search Deduplication

- Before issuing a query, recall whether a prior search already covered the same ground
- If parallel sub-agents already searched an aspect, use their findings — don't re-search
- Track what you've searched to avoid redundant queries

## Edge Cases

| Situation | Handling |
|-----------|----------|
| Conflicting sources | Present perspectives fairly, explain the disagreement, cite all viewpoints |
| Limited sources | Acknowledge gaps, use best available, note limitations explicitly |
| Sensitive / controversial topics | Multiple credible perspectives, neutral language, no advocacy |
| Rapidly evolving fields | Note pace of change, prefer peer-reviewed over speculation, date all claims |
| Outdated information | Prioritize recent research, acknowledge foundational works, flag staleness |
| Proprietary / restricted data | Use publicly available alternatives, note when data is inaccessible |
| Topic too broad | Ask user to narrow before beginning — don't waste search budget |
| Only supporting evidence found | Explicitly search "[topic] problems/criticism" before concluding |

## Parallel Execution Strategy

Maximize throughput by running independent operations simultaneously:

### Batching Tool Calls

Always batch independent tool calls in a single turn:

```
┌─ web_search("query 1")     ─┐
├─ web_search("query 2")     ─┤  All in one response
├─ web_search("query 3")     ─┤
└─ explore agent("context")  ─┘
```

**Never** issue one `web_search` per turn for independent queries — this wastes turns. Batch 3–5 searches when sub-queries are independent.

### Background Sub-Agents for Complex Research

For breadth-first research with 3+ independent sub-topics, use the `task` tool with `mode: "background"` to launch parallel research agents:

1. **Decompose** — Split the research into independent sub-topics (one per sub-agent)
2. **Launch** — Start each sub-agent with `task` → `general-purpose`, `mode: "background"`, providing:
   - Clear scope: "Research [sub-topic]. Write findings to `findings/findings-[sub-topic].md`"
   - Search rules: "Start broad (3-6 words), triangulate with 3+ sources, cite all URLs"
   - Output format: "Include sources found, key findings, confidence levels, open questions"
3. **Continue** — While sub-agents run, handle orchestration tasks (outline, other searches)
4. **Collect** — When notified of completion, read each sub-agent's findings file
5. **Synthesize** — Cross-reference findings across sub-agents, resolve conflicts, produce final report

**When to use sub-agents:** Breadth-first with 3+ independent sub-topics, research + codebase scan needed simultaneously
**When NOT to use sub-agents:** Depth-first (single topic, multiple angles), straightforward lookups, when queries depend on prior results
