# Narration Recipes

Canonical commands for the four length variants. All recipes assume the
two-phase workflow:

1. **Script phase** — the agent rewrites the source doc as a TTS-friendly
   `.narration.md` per `references/script-style-guide.md`.
2. **Audio phase** — `scripts/synthesize_tts.py` synthesizes the `.mp3`.

> **Path convention:** `<doc>` is the path to the source doc (without
> extension). For `docs/01-plan/one-pager.md`, `<doc>` is
> `docs/01-plan/one-pager`. Default artifact paths are alongside the
> source; pass `--output` to redirect.

> **One-time setup (Azure OpenAI tts-hd backend):**
>
> ```bash
> # Interactive — prompts for endpoint, deployment, api_version, voice,
> # speed, auth_mode. Writes ~/.config/narrate/config.toml (chmod 600).
> python3 scripts/synthesize_tts.py setup
>
> # For bearer auth (default), also:
> az login
> ```
>
> After setup, **no env vars are required** in new sessions. Verify with:
>
> ```bash
> python3 scripts/synthesize_tts.py config show
> ```
>
> **Override per-session without rewriting config:** export any of
> `AZURE_OPENAI_ENDPOINT`, `NARRATE_TTS_DEPLOYMENT`, `NARRATE_TTS_API_VERSION`,
> `NARRATE_TTS_VOICE`, `NARRATE_TTS_SPEED`, `NARRATE_AUTH_MODE`,
> `NARRATE_AZURE_OPENAI_API_KEY`. CLI flags (`--voice`, `--speed`) win over
> env vars, which win over config.
>
> **api-key auth** (alternative to bearer): re-run `setup` and choose
> `api-key` when prompted. The script offers to store the key in macOS
> Keychain (service `narrate-azure-openai-api-key`). On Linux/Windows, set
> `NARRATE_AZURE_OPENAI_API_KEY` in your shell instead.

---

## 0. Smoke test — always run this first

A `--dry-run` exercises chunking, output-path safety, and env-var presence
without hitting the network or spending Azure tokens.

```bash
python3 scripts/synthesize_tts.py \
  --dry-run \
  "<doc>.narration.md" \
  "<doc>.mp3"
```

Expected output: chunk count, per-chunk char counts, estimated duration in
minutes, and an environment-check block. Stop and fix anything reported as
`MISSING` before running a real synth.

---

## 1. Full narration

Faithful, section-by-section narration. Matches the structure of the source.

```bash
# Phase 1 — script (agent authoring; not a CLI command)
#   write <doc>.narration.md per references/script-style-guide.md

# Phase 2 — audio
python3 scripts/synthesize_tts.py \
  "<doc>.narration.md" \
  "<doc>.mp3"
```

**Use when** the listener wants every section of the source. **Warn** the
user before running this for source docs longer than ~6,000 words — both
on synth duration and on listener attention.

---

## 2. Summary overview (5 – 7 min)

Compressed walkthrough — structure preserved, every detail not.

```bash
# Phase 1 — script: 800–1,100 words, every section represented in one or
# two sentences. Save as <doc>.summary-overview.narration.md.

python3 scripts/synthesize_tts.py \
  "<doc>.summary-overview.narration.md" \
  "<doc>.summary-overview.mp3"
```

**Use when** the source is long (≥ ~6,000 words) and the listener wants the
shape of the whole document, not the details.

---

## 3. Short brief (2 – 3 min)

Exec-summary level — context, main thread, the ask or call to action.

```bash
# Phase 1 — script: 350–500 words. Save as
# <doc>.short-brief.narration.md.

python3 scripts/synthesize_tts.py \
  "<doc>.short-brief.narration.md" \
  "<doc>.short-brief.mp3"
```

**Use when** the listener is a stakeholder who needs the headline and the
recommendation, not the journey.

---

## 4. One-minute opener

Hook + one-sentence thesis + the three takeaways the listener should
remember.

```bash
# Phase 1 — script: 120–160 words. Save as
# <doc>.opener-1min.narration.md.

python3 scripts/synthesize_tts.py \
  "<doc>.opener-1min.narration.md" \
  "<doc>.opener-1min.mp3"
```

**Use when** opening a meeting, leading a deck, or producing a teaser. The
shortest variant has the highest production value per second — get the
script right before synthesizing.

---

## Common option overrides

```bash
# Different voice
python3 scripts/synthesize_tts.py --voice shimmer "<doc>.narration.md" "<doc>.mp3"

# Slower delivery (0.9 = ~10% slower)
python3 scripts/synthesize_tts.py --speed 0.9 "<doc>.narration.md" "<doc>.mp3"

# Overwrite an existing .mp3
python3 scripts/synthesize_tts.py --force "<doc>.narration.md" "<doc>.mp3"

# Allow writing into a git worktree (default refuses to keep .mp3 out of repos)
python3 scripts/synthesize_tts.py --allow-tracked "<doc>.narration.md" "<doc>.mp3"

# Custom output path outside the repo
python3 scripts/synthesize_tts.py "<doc>.narration.md" ~/Desktop/narration.mp3
```

---

## Failure-mode quick reference

| Symptom | Cause | Fix |
|---|---|---|
| `AZURE_OPENAI_ENDPOINT is not set` | Missing env var | `export AZURE_OPENAI_ENDPOINT=https://<resource>.cognitiveservices.azure.com` |
| `az account get-access-token failed` | Not logged in | `az login` |
| `ffmpeg ... not on PATH` | `ffmpeg` missing | macOS: `brew install ffmpeg` |
| `Refusing to overwrite existing non-empty file` | Output exists | Pass `--force`, or rename the existing file |
| `Output path is inside a git worktree` | Default safety guard | Pick a path outside the repo, or pass `--allow-tracked` and add the artifact to `.gitignore` |
| `Script is empty` | Empty `.narration.md` | Write the script first; `--dry-run` will surface this without spending Azure tokens |
| `TTS call failed after retries: HTTP 429` | Rate-limited | Wait a minute, retry; for repeated 429s reduce request rate or contact your tenant admin |
