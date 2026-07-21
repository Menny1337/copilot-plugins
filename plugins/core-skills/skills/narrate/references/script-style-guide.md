# Narration Script Style Guide

Spoken prose is not written prose. A doc that scans well on the page can be
unlistenable when read aloud. This guide codifies the rules that made past
narration scripts (`dppfi-one-pager-script.md`, `alerts-deep-dive-script.md`,
`page-performance-investigator-script.md`) sound clean.

> **Use this guide for the first phase only** (doc → `.narration.md`). The
> second phase (`.narration.md` → `.mp3`) is mechanical — the TTS engine
> reads exactly what you wrote.

---

## Hard rules

These never bend. If the source doc forces a violation, rewrite or omit.

1. **No markdown structure that a voice cannot speak.** Banned in the
   narration script body:
   - Headings (`#`, `##`)
   - Bullet or numbered lists
   - Tables
   - Code fences and inline `code`
   - Links and footnotes
   - Raw URLs
   - Emoji
2. **Acronyms get spelled out the first time, then spaced on every use.**
   `PHS` → `P H S`, `RBAC` → `R B A C`, `AI-native` → `A.I.-native`.
   Period-separation (`A.I.`) is acceptable for two-letter abbreviations the
   TTS engine reliably reads correctly.
3. **Dates and numbers are words.** `May 14, 2026` → `May fourteenth, twenty
   twenty-six`. `0–100` → `zero to one hundred`. `~150 words` → `about one
   hundred and fifty words`. Decimals: `1.0` → `one point zero`.
4. **Short paragraphs are the only pause control.** One idea per paragraph;
   blank lines between paragraphs. The TTS engine reads two blank lines as a
   short pause. No HTML comments, no SSML — the engine will read them.
5. **No invented facts.** Every fact in the narration must appear in the
   source. Omit anything you'd have to source elsewhere. If a number is
   missing, drop the sentence — do not estimate.
6. **Sentences stay short.** Aim for ≤ 25 words per sentence. Long sentences
   become breathy and lose the listener. Break with periods, not with em-
   dashes or semicolons.
7. **One narrator voice.** Past sessions used `nova`. Do not switch voices
   mid-script.

---

## Before / after — one example per rule

Each example takes a fragment from a real source doc and shows the spoken-
prose rewrite.

### Heading → spoken paragraph

**Before** (markdown):
```
## Risks and mitigations
```

**After** (narration):
```
Risks.
```

A heading becomes either a single labelled sentence (`Risks.`) or is woven
into the prose (`Now, the risks.`). Never read the `##` markers.

### Bullet list → numbered prose

**Before** (markdown):
```
Phase 1 deliverables:
- Deep-dive agent
- Owner-detective agent
- PHS dashboard v0
```

**After** (narration):
```
Phase one ships three things. The deep-dive agent. The owner-detective
agent. And version zero of the P H S dashboard.
```

Lead with the count ("ships three things"), then enumerate as short
sentences. Never read `-` or `*`.

### Table row → natural sentence

**Before** (markdown):
```
| Phase | Window | Exit |
|---|---|---|
| 1 — Learn | May 3 – May 31 | PHS v0 locked, ranked issues with owners |
```

**After** (narration):
```
Phase one, Learn. May third through May thirty-first. Exit: P H S version
zero locked, a ranked list of issues with owners named.
```

Tables get unrolled into one sentence per row, with the column labels
implicit (`Phase`, `Window`, `Exit` become structural in the sentence).

### Acronym

**Before** (markdown):
```
The PHS metric guides every phase-exit decision.
```

**After** (narration):
```
The Page Health Score — we call it P H S — guides every phase-exit
decision.
```

Spell out the acronym on first use, then `P H S` every time.

### Date and number

**Before** (markdown):
```
Last updated May 14, 2026. Score range 0–100. Cap of 1.0 speed.
```

**After** (narration):
```
Last updated, May fourteenth, twenty twenty-six. Score range, zero to one
hundred. Speed cap of one point zero.
```

### Code or API content

**Before** (markdown):
````
The dashboard calls `GET /api/phs?page=alerts` and renders the score.
````

**After** (narration):
```
The dashboard asks the score service for the Alerts page score and renders
the result.
```

Translate the API call into what it *does*. Never read code or URLs aloud.

### URL or link

**Before** (markdown):
```
See the [Page Health Score spec](docs/02-measurement/phs-spec.md) for the
formula.
```

**After** (narration):
```
The formula lives in the Page Health Score spec.
```

Drop the URL. The script is spoken, not navigated.

### Already a script

If the source doc is already in spoken-script form (e.g. a previous
narration), apply only **light cleanup**:

- Verify acronym spacing is consistent.
- Verify numbers/dates are words.
- Verify sentence length.
- Do not rewrite tone or restructure.

### Things to strip from the source

These never belong in the narration script — remove silently before any
other rewriting:

- YAML frontmatter blocks (the `---` … `---` at the top of a doc).
- Tables of contents (`- [Section](#section)`-style link lists).
- Citation markers like `[1]`, `[Smith 2024]`, footnote backreferences.
- HTML comments (`<!-- ... -->`) and editorial markers (`TODO`, `FIXME`).
- Anchor IDs (`{#section-id}`) and badge images.
- Verbatim "see also / further reading / references" sections, unless
  the user explicitly asked for them.

---

## Length variants — word and time targets

Pick exactly one variant per run. Each variant produces a separate
`.narration.md` and a separate `.mp3`.

| Variant | Word count | Approx duration | When to use |
|---|---|---|---|
| `full` | matches source (no cap) | source-length | Faithful, section-by-section narration. Warn the user on cost / duration if the source exceeds ~6,000 words. |
| `summary_overview` | 800 – 1,100 | 5 – 7 min | Long reports where structure matters but every detail does not. |
| `short_brief` | 350 – 500 | 2 – 3 min | Stakeholder-facing summary — context + main thread + call to action. |
| `opener_1min` | 120 – 160 | ≤ 1 min | Meeting opener: hook + one-sentence thesis + the three takeaways the listener should leave with. |

**Long-source rule:** if the source is longer than about six thousand
words, *recommend* `summary_overview` before running `full`. `full` for a
long source is correct sometimes, but it's expensive and listeners rarely
sit through more than ten minutes — confirm intent explicitly.

---

## Anti-patterns from real misfires

These have all happened in past sessions; the failure mode is in
parentheses.

- **Acronym salad.** `PHS, SLO, RBAC, AAD, MFA, IAM` (the listener loses
  track by item three — define the few that matter, drop the rest).
- **List as prose.** `Three things: one — the dashboard; two — the agent;
  three — the gate.` (em-dashes and semicolons read as choppy pauses —
  use periods).
- **Spoken URL.** `…see slash docs slash zero one dash plan slash one
  dash pager dot md…` (omit the URL; refer to the document by name).
- **Hidden code.** `…the function returns Promise dot all settled…`
  (translate intent: "…the function waits for every request to finish…").
- **Numeric pile-up.** `…ninety-eight point seven five percent at p
  ninety-nine point nine over a fourteen-day window…` (round, then
  speak: "…about ninety-nine percent at the p ninety-nine point nine,
  measured over two weeks…").
- **Restating the heading word-for-word.** `Risks and Mitigations. The
  risks and mitigations are as follows.` (the heading becomes the prose;
  do not echo).
- **Mid-sentence variant switch.** Mixing `opener_1min`-style hooks into
  a `full` narration. Pick the variant first; do not blend.

---

## Self-check before handing the `.narration.md` to TTS

Read the script aloud once. If any of the following are true, edit and
re-read:

- A sentence runs out of breath.
- An acronym appears unspaced.
- A number, date, or URL appears in digits or symbols.
- A bullet, list marker, table pipe, or heading character is present.
- The narrative jumps without a connective phrase ("Now, the plan…",
  "Next, the risks…").
- The word count for the chosen variant is out of range.

When all checks pass, save the script as `<source>.narration.md` and pass
it to `scripts/synthesize_tts.py`.
