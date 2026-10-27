# Narration script style

Write for listening while preserving what the source says. This guide covers
script preparation; the synthesizer handles audio generation and measurement.
Length variants and defaults live in `SKILL.md`, not in a second table here.

## Preserve meaning

Every factual statement must be supported by the source. Preserve uncertainty,
negation, names, quantities, units, and conclusions. Do not expand an acronym
unless its meaning is supplied by the source or unambiguous in context.

Summaries may omit supporting detail but must retain qualifications that
change the conclusion. Do not round exact measurements or omit inconvenient
numbers to make speech smoother. If the user asks for approximation, make it
explicit in the script.

For a source that is already a narration script, use light cleanup rather
than changing its tone or structure.

## Convert formatting into speech

Remove frontmatter, markup, navigation, and editorial comments. Never speak
code fences, Markdown links, raw URLs, footnote markers, or table pipes.
Keep meaningful source attribution as spoken prose where it matters.

| Source shape | Spoken treatment |
|---|---|
| Heading | Weave it into a transition, such as "Next, the risks." |
| List | Explain the relationship between items in short sentences |
| Table | Explain each relevant comparison with its units |
| Code | Describe its purpose without inventing behavior |
| Link | Refer to the document by name |
| Caveat or footnote | Preserve it if it changes the meaning |

For example:

```text
The dashboard calls GET /api/score and renders the result.
```

becomes:

```text
The dashboard asks the score service for the score and displays the result.
```

Strip purely editorial markers, but do not erase their substantive meaning.
If "TODO: confirm launch date" is the only source for a launch date, the
script must not present that date as confirmed.

## Clarify pronunciation selectively

Keep familiar word-like acronyms in their natural form. Use spaced letters
for initialisms that would otherwise be misread, such as `P H S`. A known
pronunciation exception is more useful than spacing every capital letter.

Write ambiguous numbers, dates, versions, and units as spoken words:
`1.0` becomes "one point zero"; `May 14, 2026` becomes "May fourteenth,
twenty twenty-six". Preserve the source's date interpretation and precision.
Do not turn an ambiguous numeric date into a confident guess.

Preserve the requested language. Do not translate or force English
pronunciation rules onto other languages unless the user asks.

## Shape rhythm and tone

Prefer sentences of about 15 to 25 words and one idea per paragraph.
Paragraph breaks help structure delivery, but they do not guarantee an
exact pause duration.

Use connective phrases when the subject changes. Avoid repeating a heading
and then restating it in the next sentence.

For a calm brief, use straightforward sentences and an even progression.
For a conversational explanation, use natural transitions and concrete
phrasing. Neither style permits invented examples or stronger claims.

Do not put instructions such as "[pause]", SSML, or "speak warmly" into
the spoken script. The current `tts-hd` request has no style-instruction
channel; voice/speed presets cannot guarantee emotional delivery.

## Meet a requested duration

Draft below the word budget for a hard cap to leave room for pauses and
long technical terms. The wrapper estimates with words and speed, then
measures the audio. The estimate is not proof that the file meets the cap.

When measured audio is too long, remove lower-priority detail or tighten
the script. Do not silently cut off the audio, remove a qualification,
or increase playback speed. Save the revised script before rendering again.

## Self-check

Before synthesis, confirm:

- every fact and qualification matches the source
- no speakable markup, raw URL, editorial instruction, or code remains
- acronyms, dates, quantities, and names are unambiguous
- sentences and transitions make sense without the visual document
- the script follows the requested language, coverage, and tone
- the word budget leaves room for a strict time limit
- the saved script is the exact text intended for synthesis
