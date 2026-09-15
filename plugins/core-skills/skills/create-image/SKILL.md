---
name: create-image
description: "Generates and edits raster images with gpt-image-2 on Azure AI Foundry. Use for image generation or gpt-image command and setup help; use nano-banana-cli for Gemini."
argument-hint: "<what to generate> [path to a reference image]"
user-invocable: true
---

> **Path resolution:** all `scripts/...` and `references/...` paths in this file
> are relative to this skill's installation directory (the directory containing
> this `SKILL.md`). The agent should resolve them by combining the skill's
> install path (provided by Copilot CLI when the skill is invoked) with the
> relative path.

# Create Image (gpt-image-2 on Azure AI Foundry)

Generate or edit images using the **gpt-image-2** deployment in the user's Azure
AI Foundry account. There is **no external CLI** for this model, so this skill
ships a zero-dependency Node wrapper, `scripts/gpt-image.mjs` (invoked as
`gpt-image`), that calls the Azure OpenAI **v1 images** REST API and writes the
decoded image files to disk. Prefer running the wrapper over hand-rolling
`curl`/`fetch` calls in prose.

## When to use

Use the image provider selected by the user or invoking workflow. This skill
does not override a request for another provider, a working UI, or editable
vector output.

- User wants to generate an image from a text prompt via gpt-image-2 / Azure / Foundry
- User wants presentation visuals, hero images, illustrations, covers, or marketing art
- User wants transparent-background assets: logos, mascots, icons, stickers, app tiles
- User wants UI/app mockups or promo images
- User wants to edit or restyle an existing image using one or more reference images
- User wants to turn a chart or diagram SVG into a polished infographic or slide (see `references/recipes.md` recipe 9)
- User wants repeatable command-line image generation that can be scripted later

## When to skip

- User explicitly wants **Nano Banana / Gemini** generation — use the `nano-banana-cli` skill instead
- User only wants prompt-writing advice and no generated file — give prompt help directly
- User wants video, vector/SVG **output**, or real-time/streaming image APIs (an SVG works as an *input* reference once rendered to PNG)
- User wants a fully local model with no Azure dependency

---

## Execution Contract

> **⚠️ CRITICAL — invocation:** Run the bundled wrapper. The canonical form is:
>
> `node <skill>/scripts/gpt-image.mjs "<prompt>" [flags]`
>
> (or `gpt-image "<prompt>" [flags]` if the optional global install was done).
> Do **not** invent a hosted UI flow, and do not simulate the wrapper in prose
> when it can be run.

1. Prefer the `gpt-image` wrapper for all image work covered by this skill.
2. If credentials are missing, stop at configuration guidance — do not pretend
   generation succeeded. The wrapper exits non-zero and prints where it looks
   for the key.
3. When the request is underspecified, ask only for parameters that materially
   affect output: prompt, aspect ratio / size, output destination, transparency,
   reference images, and image count.
4. If the user asks for the exact command without execution, return a single
   runnable `node …/gpt-image.mjs …` (or `gpt-image …`) command with every
   requested flag inline.
5. Rate limits depend on your deployment's quota. Do not fire bursts of
   generations; the wrapper already retries `429` with backoff, but space out
   multi-image batches and prefer `-n` over many separate invocations.
6. gpt-image-2 latency is ~60–90s per request. Expect each call to take time;
   the wrapper uses a long timeout — do not abort early.

---

## Canonical Command Forms

Copy these patterns and substitute the prompt, flags, and paths:

| Request Type | Canonical Command Form |
|---|---|
| New image from text | `gpt-image "<prompt>"` |
| Presentation hero with explicit output | `gpt-image "<prompt>" -a 16:9 -q high -o hero -d ./artifacts` |
| Transparent asset (mascot/logo/icon) | `gpt-image "<prompt>" -t -o asset -d ./artifacts` |
| Square avatar / app tile | `gpt-image "<prompt>" -a 1:1 -o avatar` |
| Mobile / portrait visual | `gpt-image "<prompt>" -a 9:16 -o promo` |
| Multiple variations | `gpt-image "<prompt>" -n 3 -o variation -d ./artifacts` |
| Edit one reference image | `gpt-image "<edit prompt>" -r ./input/source.png -o edited` |
| Restyle from an SVG (render first) | `rsvg-convert -w 1920 -b white logo.svg -o logo.png` then `gpt-image "<edit prompt>" -r ./logo.png -o edited` |
| Multi-reference edit / merge | `gpt-image "<merge prompt>" -r ./a.png -r ./b.png -o merged` |
| JPEG/WebP output | `gpt-image "<prompt>" -f jpeg -o photo` |
| Preview the request only | `gpt-image "<prompt>" -a 16:9 -t --dry-run` |

When running from the skill directory, replace `gpt-image` with
`node scripts/gpt-image.mjs`.

---

## Prerequisites

Check these before generation:

```bash
node --version                 # Node 18+ (uses built-in fetch); 20+ recommended
printenv AZURE_OPENAI_IMAGE_KEY
```

The wrapper resolves the **API key** in this order (first hit wins):

1. `AZURE_OPENAI_IMAGE_KEY` environment variable
2. `.env` in the current working directory
3. `~/.gpt-image/.env`
4. macOS Keychain — service `gpt-image`, account = endpoint hostname

The **endpoint** must be set via `AZURE_OPENAI_IMAGE_ENDPOINT` (in the environment, local `.env`, or `~/.gpt-image/.env`) or passed via `--endpoint`. Auth is `Authorization: Bearer <key>`; the v1 API needs **no** `api-version` query parameter.

There is no built-in endpoint. Configure your own deployment before running the wrapper.

To store the key in the Keychain (macOS):

```bash
security add-generic-password -s gpt-image \
  -a <your-resource-name>.services.ai.azure.com -w '<key>'
```

Optional one-time global install so `gpt-image` is on `PATH`:

```bash
ln -sf "$(pwd)/scripts/gpt-image.mjs" /usr/local/bin/gpt-image   # from the skill dir
```

---

## Workflow

### 1. Classify the request

| Request Type | Wrapper Pattern |
|---|---|
| New image from text | `gpt-image "<prompt>"` |
| Edit an existing image | `gpt-image "<edit prompt>" -r <image>` |
| Combine / restyle references | `gpt-image "<merge prompt>" -r <img1> -r <img2>` |
| Transparent asset | `gpt-image "<prompt>" -t` |
| Presentation visual | `gpt-image "<prompt>" -a 16:9 -q high` |
| App / mobile visual | `gpt-image "<prompt>" -a 9:16` or `-a 1:1` |

### 2. Gather only the missing inputs

Ask only for what the user did not provide:

- Main prompt or edit instruction
- One or more reference image paths (for edits)
- Output filename and directory
- Aspect ratio or size
- Whether transparency is required
- Number of images

### 3. Choose defaults pragmatically

| Scenario | Suggested Defaults |
|---|---|
| Quick smoke / connectivity check | `-a 1:1 -q medium` |
| Presentation hero image | `-a 16:9 -q high` |
| Slide illustration / cover | `-a 16:9 -q high` |
| UI/app promo image | `-a 16:9 -q medium` |
| Mobile asset | `-a 9:16 -q medium` |
| Avatar / icon / app tile | `-a 1:1 -q high` |
| Transparent logo or mascot | `-t -q high` (pick `--bg` absent from subject) |
| Crisp small icon | `-t --resize 128x128 -q high` |

### 4. Build the command directly

Flags:

| Need | Flag |
|---|---|
| Output name | `-o <name>` |
| Output directory | `-d <dir>` |
| Size | `-s <named\|N\|WxH\|auto>` (e.g. `1024`, `1536x864`, `wide`, `2k`) |
| Aspect ratio | `-a 1:1\|3:2\|2:3\|4:3\|3:4\|16:9\|9:16\|21:9` (mapped to a supported size) |
| Quality | `-q low\|medium\|high\|auto` |
| Transparent background | `-t` (forces PNG) — see Transparency below |
| Transparency key color | `--bg green\|magenta\|blue\|white\|black\|gray\|#RRGGBB` (default green) |
| Transparency removal method | `--key-method auto\|global\|floodfill` (default auto) |
| Keying tolerance / edge | `--fuzz <pct>` · `--despill <px>` |
| Resize (Lanczos) | `--resize N` (fit longest side) or `WxH` (fit + transparent-pad) |
| Output format | `-f png\|jpeg` (WebP is unsupported on Azure) |
| JPEG compression | `-c <0-100>` (only with `-f jpeg`) |
| Image count | `-n <count>` |
| Reference image (edit) | `-r <path>` (repeatable; PNG/JPG/WebP only — render any SVG to PNG first) |
| Endpoint / deployment override | `--endpoint <url>` / `--deployment <name>` |
| Preview without calling API | `--dry-run` |

`gpt-image-2` supports **arbitrary** sizes — both edges multiples of 16, max edge
≤ 3840, aspect ≤ 3:1, total pixels 655,360–8,294,400 (`>2560×1440` is
experimental). Named shorthands: `square` 1024², `landscape` 1536×1024, `portrait`
1024×1536, `wide` 1536×864 (true 16:9), `tall` 864×1536, `2k` 2560×1440. The `-a`
ratios map onto valid sizes automatically.

---

## Transparency — IMPORTANT (validated)

**`gpt-image-2` has no native transparent/alpha output.** Requesting it makes the
API return HTTP 400 (*"Transparent background is not supported for this model"*).
This was confirmed against the live deployment and in the official docs. Any
transparent asset is therefore produced by **post-processing**: `-t` generates the
subject on a flat key color and removes that color with ImageMagick to yield a
true RGBA PNG (keeps an opaque backup at `<name>-opaque.png`).

**The key color must be ABSENT from the subject — there is no universal color:**

| Subject contains… | Use |
|---|---|
| Whites / light / pastel / metallic (default-safe) | `-t` (default `--bg green`) |
| Green (e.g. a green "running" status icon) | `-t --bg magenta` (or `--bg white`) |
| Saturated *colored* glyphs on white only (no white in subject) | `-t --bg white` (auto floodfill) |
| Magenta/pink subject | `-t --bg green` or `--bg blue` |

- `--key-method global` removes the color everywhere (best when it's truly absent);
  `floodfill` removes only the connected background from the edges (preserves
  interior pixels of that color, but won't clear fully-enclosed background pockets).
  `auto` (default) uses floodfill for white/black backgrounds, global for chroma colors.
- For **crisp small icons**, generate large then downscale: add `--resize 128x128`
  (or `--resize 64`). One high-quality Lanczos step beats asking the model for a tiny image.
- Chroma-key is excellent for **controlled subjects** (icons, logos, mascots, glyphs).
  For arbitrary photos with hair/fur/glass/soft shadows, prefer a dedicated
  background-removal model (e.g. `rembg`, remove.bg) on the opaque output.

---

### 5. Execute and return the artifact path

The wrapper prints the absolute path of each written file on stdout (and a
usage summary on stderr). After generation:

- Confirm the output file path(s)
- Restate the exact command if the user will likely repeat it
- For presentation art, note whether it suits full-bleed, inset, or transparent overlay use
- For app assets, note the likely serving path / asset bucket next step

---

## Prompt Construction Rules

Use two prompt modes:

| Mode | When to Use | Why |
|---|---|---|
| Direct prose | Simple one-shot requests with 1–3 constraints | Shorter, faster, closer to model defaults |
| JSON scene spec | Complex, repeatable, multi-constraint generation/editing | More deterministic, auditable, templatizable |

### Direct prose rules

- Lead with the subject and intended use: `hero illustration for incident review deck`,
  `transparent mascot for product onboarding`, `landing page mockup`
- Specify composition and framing when it matters: `wide composition`,
  `center-weighted`, `room for headline on the left`
- Specify style only when it improves the result: `editorial`, `product render`,
  `clean enterprise UI`, `cinematic`, `flat icon set`
- For presentation visuals, ask for negative space where text will sit
- For app assets, ask for clean silhouettes and legibility at small sizes
- For edits, describe the transformation, not what the reference already shows
- Avoid piling on ten loosely related adjectives — favor a precise brief

### JSON scene spec rules

For complex requests, embed a compact JSON brief whose values are natural-language
descriptions. The JSON is the scaffold, not the art style.

- Use descriptive sentence fragments, not cryptic tag clouds
- Omit fields that do not matter rather than filling placeholders
- Put the most important constraints first: `task`, `goal`, `subject`, `composition`
- Use arrays for hard requirements and forbidden changes
- For edits, separate `preserve` from `change`
- For reference-driven work, state what each reference controls

Decision rule: if the request fits comfortably in one strong sentence, use prose;
if it has multiple visual goals, hard constraints, preserve-vs-change rules, or
will be reused, use JSON.

See `references/recipes.md` for ready-to-run command templates and prompt profiles.

---

## Failure Handling

- **`Missing endpoint`** — configure `AZURE_OPENAI_IMAGE_ENDPOINT` or pass
  `--endpoint`; there is no built-in endpoint. Stop until it is configured.
- **`Missing key`** — enumerate the four lookup locations above and stop
  until the user provides a key. Do not claim success.
- **HTTP 401/403** — the key or endpoint is wrong; re-check `AZURE_OPENAI_IMAGE_KEY`
  and the endpoint host.
- **HTTP 429 (rate limit)** — check your deployment's quota. The wrapper
  retries with backoff; if it still fails, wait and reduce batch size or
  use `-n` on a single call instead of many invocations.
- **Timeout** — generation is slow (~60–90s at `high`, longer under 429 backoff);
  the wrapper already uses a long timeout and retries. Do not abort manually. For
  quick iteration use `-q low` (≈45s).
- **Transparent background rejected (HTTP 400)** — expected: gpt-image-2 has no
  native alpha. Always use `-t` (post-processing), never `background=transparent`.
- **Subject partly erased after `-t`** — the key color was present in the subject.
  Switch `--bg` to a color absent from the subject (green↔magenta), or use
  `--key-method floodfill`. The opaque backup at `<name>-opaque.png` is never lost.
- **Green/color fringe on edges** — raise `--despill` (e.g. `--despill 2`) or lower
  `--fuzz`; for halos from a too-tight key, raise `--fuzz`.
- **Unsupported size** — keep edges multiples of 16, max edge ≤ 3840, aspect ≤ 3:1,
  pixels 655,360–8,294,400; or use a named size / `-a` ratio.
- **Wrong composition** — revise the prompt first before changing size or quality.
- **Reference not found** — verify each `-r` path exists; the wrapper checks and
  errors out before calling the API.
- **SVG reference rejected** — `-r` is raster-only, so the wrapper stops on a
  `.svg` path. Render it to PNG first (`rsvg-convert -w 1920 -b white in.svg -o
  in.png`), check the labels, then pass the PNG. See recipe 9 for renderer options.

---

## Success Criteria

Match completion to the request:

- For command-only or scripting help, return a runnable command with the requested options; do not generate an image.
- For generation or editing, produce the image file at the requested location, inspect it against the brief, and report its path. A command alone is not completion.
- If access, configuration, or generation fails, report the blocker and what remains undone. Setup guidance is not a generated image.
