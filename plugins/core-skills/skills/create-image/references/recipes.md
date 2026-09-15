# Create Image — Reference Recipes

Portable, copy-paste command templates and prompt profiles for the `gpt-image`
wrapper (gpt-image-2 on Azure AI Foundry). From the skill directory, replace
`gpt-image` with `node scripts/gpt-image.mjs`.

All commands require a configured endpoint and a resolvable API key
(see `SKILL.md` → Prerequisites). Quotas depend on your deployment; space out
batches according to its rate limits.

---

## gpt-image-2 quick reference

| Parameter | Values & notes |
|---|---|
| `size` (`-s`/`-a`) | **Arbitrary**: edges multiples of 16, max edge ≤ 3840, aspect ≤ 3:1, pixels 655,360–8,294,400. Square is fastest. `>2560×1440` is experimental. |
| `quality` (`-q`) | `low` (drafts/avatars/textures, ~45s) · `medium` · `high` (text-in-image, hero, dense UI) · `auto`. |
| Transparency (`-t`) | **No native alpha** — generate on a flat key color, remove it. Pick `--bg` absent from the subject. |
| `output_format` (`-f`) | `png` (default, required for alpha) · `jpeg` (faster, `-c` compression). **No WebP on Azure.** |
| `n` | 1–10 variants in one call — gentler on the rate limit than many calls. |
| Edits (`-r`) | gpt-image-2 always processes references at high fidelity (no `input_fidelity` knob). Accepts PNG/JPG/WebP only; render any SVG to PNG first (see recipe 9). |
| Latency | Complex/high-quality prompts up to ~2 min; base64 only (no URL); 429 under load → wrapper retries. |

**In-image text:** use `-q high`, put literal text in quotes/ALL CAPS, and spell
tricky brand names letter-by-letter. **Small assets:** ask for "bold, simple
shapes, strong silhouette readable at NNpx," generate at 2–3× target, then
`--resize`. **UI mockups:** describe the product *as if it already ships* (no
concept-art language, realistic sample content, not lorem ipsum).

---

## 1. Presentation cover / hero

```bash
gpt-image "hero illustration for an incident-review deck, wide cinematic composition, \
calm enterprise mood, generous negative space on the left for a headline, \
editorial flat style, cool blue palette" \
  -a 16:9 -q high -o incident-hero -d ./artifacts
```

Use for full-bleed title slides. Ask for negative space where text will sit.

---

## 2. Transparent mascot / logo / icon

```bash
# Default: subject generated on flat green, keyed out to true RGBA PNG.
gpt-image "friendly robot mascot waving, flat vector style, clean silhouette, \
bold simple shapes, centered" \
  -t -q high -o mascot -d ./artifacts
```

`-t` works around the fact that **gpt-image-2 has no native transparency** (the API
rejects `background=transparent`): it generates on a flat key color and removes it
with ImageMagick, keeping an opaque backup at `<name>-opaque.png`.

**Pick a `--bg` color absent from the subject:**

```bash
# Green subject (e.g. a green status icon) — green key would erase it. Use magenta:
gpt-image "a green circular sync icon with a checkmark" -t --bg magenta -o running -d ./artifacts

# Colored glyph on white, no white in the subject — white floodfill preserves interior colors:
gpt-image "a coral clipboard glyph, flat, bold" -t --bg white -o glyph -d ./artifacts

# Crisp small icon: generate large, then one Lanczos downscale:
gpt-image "minimal blue cloud upload icon, flat, app-icon style" \
  -t --resize 128x128 -q high -o icon-upload -d ./artifacts
```

Tuning: `--key-method auto|global|floodfill`, `--fuzz <pct>`, `--despill <px>`.
For arbitrary photos (hair, fur, glass, soft shadows) prefer a dedicated
background-removal model (rembg, remove.bg) run on the `-opaque.png` backup.

---

## 3. Square avatar / app tile

```bash
gpt-image "minimal app icon of a paper plane, rounded square, flat design, \
single accent color, legible at small sizes" \
  -a 1:1 -q high -o app-icon -d ./artifacts
```

---

## 4. Mobile / portrait promo

```bash
gpt-image "portrait promo image for a productivity app, person at a tidy desk, \
soft daylight, room for a caption at the top, modern editorial style" \
  -a 9:16 -q medium -o mobile-promo -d ./artifacts
```

---

## 5. UI / app mockup

```bash
gpt-image "clean enterprise dashboard mockup, light theme, card-based layout, \
charts and a sidebar, realistic but uncluttered, 16:9" \
  -a 16:9 -q high -o dashboard-mockup -d ./artifacts
```

---

## 6. Multiple variations in one call

```bash
gpt-image "flat icon of a lightbulb idea, several distinct styles" \
  -n 3 -q medium -o idea-icon -d ./artifacts
```

Prefer a single `-n` call over many separate invocations — it is gentler on the
rate limit. Files are written as `idea-icon-1.png`, `idea-icon-2.png`, etc.

---

## 7. Edit a single reference image

```bash
gpt-image "change the background to a soft gradient and add a subtle drop shadow, \
keep the subject and its colors unchanged" \
  -r ./input/product.png -o product-edited -d ./artifacts
```

Reference paths route the request to the `images/edits` endpoint. Describe the
transformation, not what the reference already shows.

**Vector source?** Render the SVG to PNG before you pass it. `-r` takes raster
only. `rsvg-convert` keeps text crisp; ImageMagick alone drops fonts on SVG text.

```bash
rsvg-convert -w 1920 -b white ./input/logo.svg -o ./input/logo.png
gpt-image "turn this flat logo into a glossy 3D enamel pin on a neutral backdrop" \
  -r ./input/logo.png -o logo-pin -d ./artifacts
```

---

## 8. Multi-reference merge / style transfer

```bash
gpt-image "place the character from the first image into the scene and lighting \
of the second image, preserve the character's outfit and proportions" \
  -r ./input/character.png -r ./input/scene.png -o composited -d ./artifacts
```

---

## 9. SVG scaffold → polished infographic / chart / slide

Draw the chart or diagram as an SVG with exact bars, labels, and positions. Render
it to PNG, confirm every label, then pass the PNG as the structural reference. The
scaffold fixes the layout. gpt-image-2 adds polish and depth.

**Prepare the SVG.** Render it to a flat PNG and open the result. Read every label
and value before you send it.

```bash
rsvg-convert -w 1920 -b white ./input/chart.svg -o ./input/chart.png
open ./input/chart.png   # confirm axes, labels, and values are legible
```

- Resolution: `-w 1920` suits a normal slide. Use `2560` for dense charts with small type.
- Background: `-b white` for charts. Drop it for logos that need transparency.
- ImageMagick alone is unreliable for SVG text. Without an rsvg/cairo delegate it substitutes fonts or fails with `unable to read font`. Install librsvg (`brew install librsvg`) for `rsvg-convert`. Other renderers that work: inkscape, resvg, cairosvg, or a headless Chromium screenshot.

**Beautify the PNG.**

```bash
gpt-image "Use the attached reference as the exact structural base. Keep every \
number, axis label, and legend entry in place. Restyle only: modern flat \
infographic, clean sans-serif type, professional palette, high contrast. 16:9 \
slide with a title band on top." \
  -r ./input/chart.png -a 16:9 -q high -n 3 -o infographic -d ./artifacts
```

Match the model to how exact your data must be:

| Data must be | Do this |
|---|---|
| Exact (finance, science, reporting) | Ship the rendered PNG. Skip the model, or restyle then check every label. |
| Polished, approximate is fine | Run the recipe above. Keep the best of `-n 3`. |
| Exact and polished | Generate the styled version, then rebuild the labels in vector tooling. |

> **Check the numbers before you ship.** gpt-image-2 holds reference structure
> and text at high fidelity, yet it stays generative: it can shift a value or
> garble a small label. Dense charts and outputs above ~2K raise the risk.

Split "keep" from "restyle" in the prompt, raise `-q high`, and request `-n 3` to
choose from.

---

## 10. JPEG output

```bash
gpt-image "wide landscape photo of mountains at dawn, photographic, natural light" \
  -a 16:9 -q high -f jpeg -c 85 -o mountains -d ./artifacts
```

Use `-f jpeg` (optionally `-c 0-100`) for smaller files when transparency is not
needed. **WebP is not supported on Azure OpenAI** — only `png` and `jpeg`.

---

## 11. Preview the request without spending a call

```bash
gpt-image "any prompt" -a 16:9 -t --dry-run
```

Prints the resolved mode, URL, size, quality, and key source as JSON. Useful for
confirming flag parsing and size mapping before a real (slow, rate-limited) call.

---

## Prompt profiles

Reusable JSON scene-spec briefs. Pass the JSON as the prompt argument (quote it),
or adapt the fields inline. The JSON is a scaffold for the model — values are
natural-language descriptions, not tag clouds.

### presentation_hero

```json
{
  "task": "presentation_hero",
  "goal": "Title-slide hero with room for a headline.",
  "subject": "Abstract representation of the deck's theme",
  "composition": { "framing": "wide", "safe_zones": "left third kept clear for text" },
  "style": { "visual_language": "editorial flat", "color_direction": "cool, calm palette" },
  "constraints": ["no embedded text", "generous negative space"]
}
```

### transparent_asset

```json
{
  "task": "transparent_asset",
  "goal": "Reusable mascot/icon on a transparent background.",
  "subject": "Single centered character or object",
  "style": { "visual_language": "flat vector", "surface_finish": "clean bold shapes" },
  "constraints": ["transparent background", "clean silhouette", "legible when small"]
}
```

### ui_mockup

```json
{
  "task": "ui_mockup",
  "goal": "Believable product UI for a slide or promo.",
  "subject": "App screen or dashboard",
  "composition": { "framing": "16:9", "camera": "head-on, slight perspective optional" },
  "style": { "visual_language": "clean enterprise UI", "color_direction": "light theme" },
  "constraints": ["uncluttered", "no lorem-ipsum walls of text"]
}
```

### image_edit

```json
{
  "task": "image_edit",
  "goal": "Targeted change to a reference image.",
  "edit": { "change": ["what to modify"], "preserve": ["what must stay identical"] },
  "constraints": ["do not alter the locked elements"]
}
```

For the decision between prose and JSON, and the full field guidance, see
`SKILL.md` → Prompt Construction Rules.

---

## UI & app asset recipes (web + desktop)

Research-backed templates for common UI assets. Replace `[BRACKETED]` slots.
For any asset that needs transparency, add `-t` and a `--bg` color absent from the
subject (default green is safe for white/light subjects; use `--bg magenta` for
green subjects, `--bg white` for saturated colored glyphs with no white). Generate
at 2–3× and `--resize` down for crisp small sizes.

### 1. macOS app icon (HIG rounded-rect)

```bash
gpt-image "A macOS app icon for \"[APP]\", a [CATEGORY] app. A single centered icon on a \
pure white flat background with generous padding. Apple macOS conventions: rounded-rect with \
standard corner radius, [STYLE: soft 3D with subtle depth and specular highlight | flat minimalist]. \
Motif: [MOTIF]. Palette: [COLORS]. Bold simple shapes readable at 16px. No drop shadow outside the \
icon, no text, no watermark." -a 1:1 -q high -o macos-icon -d ./artifacts
```
Let macOS apply its own mask — generate the full square. Add `-n 4` for variants.

### 2. Windows 11 Fluent app icon

```bash
gpt-image "A Windows 11 app icon for \"[APP]\", a [CATEGORY] app. Microsoft Fluent design: clean \
geometric shapes, subtle depth/soft shadow, smooth gradients allowed, [STYLE]. Motif: [MOTIF]. \
Fluent accent colors: [COLORS]. Strong silhouette readable at 44px. Plain white flat background, \
no text, no watermark." -a 1:1 -q high -o win-icon -d ./artifacts
```

### 3. Toolbar / menu icon set (sprite row)

```bash
gpt-image "A set of [N] toolbar icons for a [CATEGORY] app, in a single row on plain white with \
equal spacing. Icons left-to-right: [LIST]. Flat monochrome [COLOR e.g. #333 on white], 2px stroke, \
consistent optical size, rounded terminals, no gradients, no labels. Clean grid." \
  -s 1536x1024 -q medium -o toolbar-set -d ./artifacts
```
Then slice the row; or generate one at a time with the same style anchor phrase.

### 4. Favicon / pinned-tab mark

```bash
gpt-image "A favicon for \"[BRAND]\". One bold ultra-simple symbol or lettermark on a [BG_COLOR] \
square. Instantly recognizable at 16px: single strong shape or initial, no fine detail, no gradients, \
max 2 colors. [MOTIF]. Centered, balanced padding, no extra text." \
  -a 1:1 -q medium --resize 64 -o favicon -d ./artifacts
```

### 5. Empty-state illustration

```bash
gpt-image "A friendly minimal flat illustration for an empty-state screen in a [CATEGORY] app. \
Scene: [SCENE]. Soft flat style, rounded shapes, [PALETTE] on white, no harsh outlines, generous \
white space, lightweight supporting art. No text, no watermark, centered." \
  -a 1:1 -q medium -o empty-state -d ./artifacts
```

### 6. Onboarding illustration

```bash
gpt-image "A clean flat illustration for an onboarding screen of a [CATEGORY] app. Theme: [THEME]. \
Modern flat, smooth fills, no harsh outlines, [PALETTE]. Landscape, central subject with empty space \
on the left for overlay text. No in-image text, no logos, no watermark." \
  -a 16:9 -q medium -o onboarding -d ./artifacts
```

### 7. Hero / banner image

```bash
gpt-image "A hero banner for \"[APP]\", a [CATEGORY] app. [SCENE]. Photorealistic, warm and inviting, \
mood [MOOD]. Landscape, subject on the [LEFT/RIGHT] with clear negative space opposite for a text \
overlay. [COLOR_DIRECTION]. No in-image text, no logos, no watermark." \
  -a 16:9 -q high -o hero -d ./artifacts
```

### 8. Avatar / profile placeholder

```bash
gpt-image "A default user avatar for a [CATEGORY] app. [STYLE: abstract person silhouette | geometric \
initials '[INITIALS]']. [PALETTE]. Circular-safe: key content within the center 80%. Flat, minimal, no \
photorealistic face. Plain [COLOR] background." -a 1:1 -q low -o avatar -d ./artifacts
```

### 9. Spot illustration (inline)

```bash
gpt-image "A small spot illustration for a [CATEGORY] app next to a feature about [FEATURE]. Shows \
[MOTIF]. Flat, minimal, friendly, single accent [COLOR] on white. Compact square, generous padding, \
vector-art feel, no text." -t --bg white -a 1:1 -q medium -o spot -d ./artifacts
```

### 10. Achievement / notification badge

```bash
gpt-image "An achievement badge for a [CATEGORY] app representing [ACHIEVEMENT]. [STYLE: circular \
metallic-gold badge, sunburst, laurel wreath, central star]. Text on badge: \"[LABEL]\" in bold \
sans-serif, clearly legible. Feels like a physical pin. White flat background, no outside shadow, no \
extra text." -a 1:1 -q high -o badge -d ./artifacts
```
Text accuracy needs `-q high`; spell tricky labels letter-by-letter.

### 11. Loading / splash art

```bash
gpt-image "A splash screen for \"[APP]\", a [CATEGORY] app. [SCENE: centered glowing geometric mark \
with subtle radial energy lines]. Modern, polished, mood [MOOD]. Centered, [BG_COLOR] flat background. \
No text but the mark. High impact full-screen, no watermark." -a 9:16 -q medium -o splash -d ./artifacts
```

### 12. Seamless background texture

```bash
gpt-image "A seamless subtle [STYLE e.g. fine dot-grid] background texture for a [CATEGORY] app. \
[DESCRIPTION e.g. very light gray dots on white, ~16px apart]. Extremely subtle, no directional \
lighting, no shadows, flat and uniform. [COLORS]. Tiles correctly if repeated, no watermark." \
  -a 1:1 -q low -o texture -d ./artifacts
```
Verify tiling manually — seams are not guaranteed.

### 13. Marketing app screenshot / mockup

```bash
gpt-image "A realistic mobile app UI mockup for \"[APP]\", a [CATEGORY] app. Show [SCREEN: header, list \
of recent items with thumbnails and labels, bottom tab bar with 4 icons]. [STYLE: white card-based \
layout, subtle card shadows, clear sans-serif type, minimal decoration]. Looks like a real shipped \
app screen. In an [iPhone 15 Pro | Pixel] device frame. Realistic sample content, not lorem ipsum, \
no watermark." -a 9:16 -q high -o app-screenshot -d ./artifacts
```

### 14. CTA button / badge graphic

```bash
gpt-image "A single call-to-action button graphic. Shape: [SHAPE e.g. pill, wide]. Background: \
[COLOR e.g. coral-red gradient L→R]. Text: \"[TEXT]\" in bold white sans-serif, centered, legible. \
[Optional ICON]. Flat, subtle inner glow, no harsh shadow. Pure white flat background outside the \
button, no other elements." -t -a 16:9 -q medium -o cta-button -d ./artifacts
```

### 15. Consistent icon set in one call

```bash
gpt-image "Design [N] icons for a [CATEGORY] app, all in the same style. Icons: [LIST]. Style: \
[STYLE e.g. flat duotone, dark-navy fill with coral accent, rounded corners, 2px stroke]. All icons \
share identical stroke weight, corner radius, padding, optical balance. Single row on pure white with \
equal spacing, ~48px each with 8px padding. No labels, no watermark." \
  -s 1536x1024 -q medium -n 4 -o icon-set -d ./artifacts
```
`-n 4` gives four style variants of the whole row — pick the best, then slice.

> **Why these defaults:** generate icons/badges/logos on a flat solid background and
> remove it with `-t` (gpt-image-2 has no native alpha); use bold simple shapes for
> small-size legibility; anchor every icon-set call with explicit style invariants;
> use `-q low` for avatars/textures/drafts and `-q high` for any in-image text.
