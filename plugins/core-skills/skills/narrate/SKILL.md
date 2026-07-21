---
name: narrate
description: "Turn documents or text into spoken-audio (MP3) via a two-phase workflow: first rewrite the source as a TTS-friendly narration script (.md), then synthesize audio with Azure OpenAI tts-hd (default backend, pluggable). Use when the user asks to narrate a doc, read a doc out loud, create an audio version, audio summary, audio brief, voiceover, listenable version, or podcast-style version of a report, or produce a 1-minute opener / short brief / summary overview / full narration. Triggers: narrate, narration, audio version, listen to this, read out loud, audio summary, audio brief, voiceover, podcast, tts, text-to-speech, mp3 from doc."
user-invocable: true
---

> **Path resolution:** all `scripts/...` and `references/...` paths in this
> file are relative to this skill's installation directory (the directory
> containing this `SKILL.md`). The agent should resolve them by combining
> the skill's install path (provided by Copilot CLI when the skill is
> invoked) with the relative path.

# Narrate

Turn a document, page, or any text into a clean spoken-audio file plus a
matching narration transcript. This skill owns the proven two-phase
workflow that emerged from real audio production sessions: a doc is first
rewritten as a TTS-friendly script (`.narration.md`), then synthesized as
audio (`.mp3`) by a wrapped Azure OpenAI `tts-hd` deployment with
paragraph-aware chunking and `ffmpeg` concatenation.

## When to use

Invoke this skill when the user asks for any of:

- "Narrate this doc / page / report / one-pager / PRD."
- "Create an audio version / audio summary / audio brief / voiceover."
- "Read this out loud" / "make a listenable version" / "podcast-style."
- "Make a one-minute opener / short brief / summary / full narration."
- Any explicit `.mp3` from a `.md`, `.txt`, blog post, PRD, or report.

## When to skip

- The user wants speech-to-text / transcription / dictation (this is
  the opposite direction).
- The user wants real-time voice or a streaming audio API.
- The user wants speaker notes for slides, or narration that lives inside
  the deck — use the presentation tooling instead. This skill is only for
  producing standalone `.mp3` audio files from finalized text.
- The user explicitly names `.pptx`, deck, slides, or speaker notes as the
  primary artifact and does not also ask for an MP3.
- The user wants music, sound effects, or non-speech audio.
- The user wants a different output container (e.g. wav, flac, m4a) or
  studio-grade voice cloning.

---

## Quality Contract

These rules override any other guidance in this skill. If there is any
conflict, these rules win.

### 1. Two phases, in order, every time

`Doc/text → .narration.md → .mp3`. Never synthesize from an unsaved
script. The transcript file is part of the deliverable.

### 2. The narration script is spoken prose, not written prose

Banned in the narration script body: headings, bullet/numbered lists,
tables, code fences, inline `code`, links, footnotes, raw URLs, emoji.
Full rules and before/after examples live in
`references/script-style-guide.md`.

### 3. Acronyms are spaced; numbers and dates are words

`PHS` → `P H S`. `May 14, 2026` → `May fourteenth, twenty twenty-six`.
`0–100` → `zero to one hundred`. Apply consistently — the engine reads
what you wrote.

### 4. One idea per paragraph, ≤ 25 words per sentence

Paragraphs are the only pause control (TTS reads a blank line as a
short breath). Long sentences become breathy and lose the listener.

### 5. No invented facts

The narration mirrors the source. Choosing a shorter length variant
means *compressing* the source, never *augmenting* it.

### 6. Choose one length variant per run

Variants are not mixable — pick `full`, `summary_overview`,
`short_brief`, or `opener_1min` and stay in it.

**Filename convention:** variant IDs use underscores (`summary_overview`);
artifact filenames use hyphens (`<doc>.summary-overview.narration.md` and
`<doc>.summary-overview.mp3`). The `full` variant drops the suffix:
`<doc>.narration.md` / `<doc>.mp3`.

### 7. Default output lives alongside the source — but never inside a tracked git repo

`<source>.narration.md` and `<source>.mp3` next to `<source>.md`. The
synthesizer refuses to write `.mp3` inside a git worktree unless the
user passes `--allow-tracked` (and adds `.mp3` to `.gitignore`).
Override with `--output <path>` to write elsewhere.

---

## Two-phase workflow

### Phase 1 — Doc → narration script (`.narration.md`)

The agent (you) authors the script. This is a writing task, not a CLI
call. Read `references/script-style-guide.md` first; it is the
authoritative source on spoken-prose rules and includes one before/after
example per rule.

- Pick the length variant from the table below before writing.
- Save the script at `<source-without-ext>.narration.md` (or, if a
  non-`full` variant, `<source>.<variant>.narration.md` — e.g.
  `one-pager.opener-1min.narration.md`).
- Run the self-check at the end of `references/script-style-guide.md`
  (read aloud once; confirm word count for the variant; confirm zero
  markdown structure remains).

#### Modes

- **`script-only`** — produce the `.narration.md` and stop. Useful for
  drafting speaker notes, reviewing tone before spending Azure tokens,
  or producing a script to pass to a human narrator.
- **`audio`** (default) — produce both the `.narration.md` and the
  `.mp3` by continuing to Phase 2.

### Phase 2 — Script → audio (`.mp3`)

Synthesize via `scripts/synthesize_tts.py`. The script handles
chunking, auth, retries, and `ffmpeg` concatenation. See
`references/recipes.md` for the canonical per-variant commands.

---

## Length variants

| Variant | Word target | Approx duration | When to use |
|---|---|---|---|
| `full` | matches source (no cap) | source-length | Faithful, section-by-section narration. **Warn** before running for sources longer than ~6,000 words. |
| `summary_overview` | 800 – 1,100 | 5 – 7 min | Long reports — structure preserved, every detail not. |
| `short_brief` | 350 – 500 | 2 – 3 min | Stakeholder summary — context, main thread, ask. |
| `opener_1min` | 120 – 160 | ≤ 1 min | Meeting opener / deck lead — hook + one-sentence thesis + three takeaways. |

For sources longer than ~6,000 words, *recommend* `summary_overview`
first. `full` for long sources is sometimes correct but is expensive and
listeners rarely sit through more than ten minutes.

---

## Execution Contract

> **⚠️ CRITICAL — Do not invoke any other TTS tool.** All audio synthesis
> in this skill goes through `scripts/synthesize_tts.py`. Do not call the
> Azure REST endpoint directly, do not invoke macOS `say`, do not
> simulate the script in prose.

1. **Always run `--dry-run` first** when synthesizing from a new script,
   in a new environment, or after changing env vars. `--dry-run` exercises
   chunking, output-path safety, and env-var presence without hitting
   Azure or spending tokens.
2. **One-time setup.** On a fresh machine (no config yet), run:
   ```bash
   python3 scripts/synthesize_tts.py setup
   ```
   This interactively writes `~/.config/narrate/config.toml` (XDG-aware,
   `chmod 600`) with endpoint, deployment, api_version, voice, speed, and
   `auth_mode`. After setup, no env vars are required. Inspect with
   `synthesize_tts.py config show` (shows per-key source: cli / env /
   config / default).

   **Auth modes:**
   - `bearer` *(default, recommended)* — uses `az account get-access-token`
     against Cognitive Services. Requires `az login`.
   - `api-key` — reads key from `NARRATE_AZURE_OPENAI_API_KEY` env var,
     else from macOS Keychain (service `narrate-azure-openai-api-key`,
     account = endpoint hostname). `setup` can store the key for you.

   **Env-var overrides** (any value in config can be overridden per session
   without editing the file): `AZURE_OPENAI_ENDPOINT`, `NARRATE_TTS_DEPLOYMENT`,
   `NARRATE_TTS_API_VERSION`, `NARRATE_TTS_VOICE`, `NARRATE_TTS_SPEED`,
   `NARRATE_AUTH_MODE`, `NARRATE_AZURE_OPENAI_API_KEY`, `NARRATE_CONFIG_PATH`.

   **Precedence:** CLI flags > env vars > config file > built-in defaults.

   If the endpoint cannot be resolved, `ffmpeg` is missing, `az` is missing
   in bearer mode, or the API key is missing in api-key mode, the script
   stops at setup guidance — never fabricate audio.
3. **Backend selection.** Default backend is `azure-openai`. Select
   alternatives with `--backend <name>`. The supported backends live in
   the `BACKENDS` dict at the top of `scripts/synthesize_tts.py`.
4. **Output safety.** Refuse to overwrite existing non-empty `.mp3`s
   without `--force`. Refuse to write into a tracked git worktree
   without `--allow-tracked`. Otherwise, default output is alongside the
   source doc.
5. **Per-chunk logging.** The script prints char counts per chunk, total
   chunks, and the final byte size. Surface this in your reply so the
   user can confirm the synthesis matches their expectations.

---

## References

- `references/script-style-guide.md` — full spoken-prose rule set with
  one before/after example per rule, anti-patterns from real misfires,
  and a self-check to run before handing the script to TTS.
- `references/recipes.md` — canonical commands for the four length
  variants, common option overrides, and a failure-mode quick reference
  table.
- `scripts/synthesize_tts.py` — the TTS engine wrapper (Azure OpenAI
  `tts-hd` backend, `--dry-run`, retries, ffmpeg concat). Run
  `python3 scripts/synthesize_tts.py --help` for the full CLI surface.
