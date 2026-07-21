---
name: nano-banana-cli
description: "Run the `nano-banana` CLI (command: `nano-banana`) for Gemini image generation/editing, transparent assets, presentation visuals, UI mockups, and reference-image edits. Use when constructing nano-banana commands, checking configuration, or generating images. nano-banana uses unique short flags (-a, -s, -o, -d, -r, -t) that differ from standard CLI conventions — always invoke this skill for correct syntax. Triggers: nano banana, generate image, edit image, transparent, hero image, mascot, sprite, mockup, Gemini, illustration."
user-invocable: false
---

> **Path resolution:** all `scripts/...` and `references/...` paths in this file (and in `references/recipes.md`) are relative to this skill's installation directory. The agent should resolve them by combining the skill's install path (provided by Copilot CLI when the skill is invoked) with the relative path.

# Nano Banana CLI

Use the `nano-banana` CLI as the execution engine for image generation and editing tasks. This skill wraps the external tool instead of re-implementing its behavior in prompt prose.

## When to Use

- User explicitly mentions Nano Banana
- User wants image generation via a local CLI rather than a hosted UI
- User wants to generate presentation visuals, hero images, mockups, illustrations, sprites, or marketing assets
- User wants to edit or restyle an existing image using one or more reference images
- User wants transparent-background assets such as logos, mascots, icons, stickers, or game/app art
- User wants repeatable command-line image generation that can later be integrated into an application workflow

## When to Skip

- User only wants prompt-writing advice and does not want images generated; give prompt help directly instead of invoking the CLI workflow
- User wants a fully local model with no Gemini API dependency
- User wants video generation rather than still images; use a video-oriented workflow instead
- User needs vector graphics or editable SVG output instead of raster images; use a vector design workflow instead

---

## Execution Contract

> **⚠️ CRITICAL — Flag Syntax:** The `nano-banana` CLI uses short POSIX flags only. Models frequently hallucinate long-form flags. Never invent flags — use only the flags documented in this skill.
>
> **Correct:** `nano-banana "<prompt>" -a 16:9 -s 2K -o hero -d ./artifacts`
> **Wrong:** `nano-banana generate --aspect-ratio 16:9 --size 2048x1152 --output hero.png`
> **Wrong:** `nano-banana create --name hero --format png --preset presentation`

1. Prefer the `nano-banana` CLI for all image work covered by this skill.
2. Do not simulate the CLI in prose if the command can be run.
3. If the CLI is missing, verify that first and then offer installation or perform it if the user asked for setup.
4. If the CLI exists but no API key is configured, stop at configuration guidance instead of pretending generation succeeded.
5. When the request is underspecified, ask only for the missing parameters that materially affect the output: prompt, aspect ratio, output destination, reference images, transparency, and size.
6. If the user asks for the exact command without execution, return a single executable `nano-banana ...` command and include every requested flag inline instead of describing the command in prose.
7. If the user asks where credentials are loaded from, explicitly name `GEMINI_API_KEY` and enumerate the three supported lookup locations before stopping:
   - `.env` in the current working directory
   - `.env` in the Nano Banana repo root
   - `~/.nano-banana/.env`
8. The executable name is exactly `nano-banana`; do not invent `nano-banana-cli`, `generate`, `create`, or unsupported long-form flags such as `--aspect`, `--aspect-ratio`, `--width`, `--height`, `--format`, `--quality`, `--name`, `--preset`, or `--output`.

---

## Canonical Command Forms

Copy these patterns directly instead of translating them into invented subcommands or long-form options:

| Request Type | Canonical Command Form |
|---|---|
| New image from text | `nano-banana "<prompt>"` |
| Presentation hero with explicit output | `nano-banana "<prompt>" -a 16:9 -s 2K -o hero-name -d ./artifacts` |
| Edit one reference image | `nano-banana "<edit prompt>" -r ./input/source.png` |
| Multi-reference style transfer | `nano-banana "<merge prompt>" -r ./input/a.png -r ./input/b.png` |
| Transparent asset | `nano-banana "<prompt>" -t -o asset-name` |

If the user asks for a command, prefer copying one of these forms and then substituting the prompt, flags, and paths they asked for.

---

## Prerequisites

Check these before generation:

```bash
command -v nano-banana
printenv GEMINI_API_KEY
```

Fallback locations the CLI may also use for the API key:

- `.env` in the current working directory
- `.env` in the Nano Banana repo root
- `~/.nano-banana/.env`

Treat this list as authoritative for this skill. Do not invent alternate config files, keychain lookups, or different environment variable names unless the user has already verified them locally.

If the user asks to set up the tool and it is not installed, the canonical upstream repo is:

`https://github.com/kingbootoshi/nano-banana-2-skill`

Typical install flow:

```bash
git clone https://github.com/kingbootoshi/nano-banana-2-skill ~/tools/nano-banana-2
cd ~/tools/nano-banana-2
bun install
bun link
mkdir -p ~/.nano-banana
printf 'GEMINI_API_KEY=your_key_here\n' > ~/.nano-banana/.env
```

Transparent mode also needs:

```bash
brew install ffmpeg imagemagick
```

---

## Workflow

### 1. Classify the request

Map the request into one of these buckets:

| Request Type | CLI Pattern |
|---|---|
| New image from text | `nano-banana "<prompt>"` |
| Edit an existing image | `nano-banana "<edit prompt>" -r <image>` |
| Style transfer / combine references | `nano-banana "<merge prompt>" -r <image1> -r <image2>` |
| Transparent asset | `nano-banana "<prompt>" -t` |
| Presentation visual | `nano-banana "<prompt>" -a 16:9 -s 2K` |
| App / mobile visual | `nano-banana "<prompt>" -a 9:16` or `-a 1:1` |

### 2. Gather only the missing inputs

Ask for these only if the user did not already provide them:

- Main prompt or edit instruction
- One or more reference image paths
- Output filename and directory
- Aspect ratio
- Size: `512`, `1K`, `2K`, or `4K`
- Whether transparency is required

### 3. Choose defaults pragmatically

Use these defaults when the user did not specify them:

| Scenario | Suggested Defaults |
|---|---|
| Low-cost smoke / billing verification | `-a 1:1 -s 512` |
| Presentation hero image | `-a 16:9 -s 2K` |
| Slide illustration / cover | `-a 4:3 -s 2K` |
| UI/app promo image | `-a 16:9 -s 1K` |
| Mobile asset | `-a 9:16 -s 1K` |
| Avatar / icon / app tile | `-a 1:1 -s 1K` |
| Transparent logo or mascot | `-t -s 1K` |

Use `--model pro` only when the user explicitly wants maximum quality or the composition is complex enough to justify higher cost.

If you are validating a new machine, API key, or billing setup, start with a no-reference Flash run at `512` before moving to reference-heavy or transparent workflows. After the run, inspect `nano-banana --costs` so the observed spend matches expectations.

### 4. Build the command directly

Common flags:

| Need | Flag |
|---|---|
| Output name | `-o <name>` |
| Output directory | `-d <dir>` |
| Size | `-s 512|1K|2K|4K` |
| Aspect ratio | `-a 1:1|16:9|9:16|4:3|3:4|21:9|...` |
| Reference image | `-r <path>` |
| Transparent background | `-t` |
| Higher quality model | `--model pro` |
| Cost summary | `--costs` |

Only use the executable and flags documented here unless the user has already verified a newer CLI surface locally.

Syntax guardrail — models frequently hallucinate these wrong patterns:

| ❌ Wrong (hallucinated) | ✅ Correct (actual) |
|---|---|
| `nano-banana generate "<prompt>"` | `nano-banana "<prompt>"` |
| `nano-banana create --name hero` | `nano-banana "<prompt>" -o hero` |
| `--aspect-ratio 16:9` or `--aspect 16:9` | `-a 16:9` |
| `--size 2048x1152` or `--width 2048` | `-s 2K` |
| `--output ./artifacts/hero.png` | `-o hero -d ./artifacts` |
| `--format png` or `--quality high` | *(not real flags)* |
| `--transparent` or `--no-background` | `-t` |
| `--reference ./img.png` | `-r ./img.png` |

If you find yourself writing a long-form flag, stop — it is almost certainly wrong. Use only the short flags from the table above.

Treat `-s` as a generation tier rather than a guaranteed final pixel dimension. Verify the produced asset dimensions before wiring it into a pipeline that expects exact pixels, especially after transparent-mode trimming.

### 5. Execute and return the artifact path

After generation:

- Confirm the output file path
- State the exact command used if the user will likely want to repeat it
- If the image is for a presentation, mention whether it is suitable as full-bleed, inset, or transparent overlay art
- If the image is for app integration, mention the most likely serving path or asset bucket next step

---

## Prompt Construction Rules

Research summary that drives this skill:

- Official Gemini image docs recommend descriptive scene prompts over disconnected keyword lists.
- Gemini prompting docs recommend clear structure, explicit constraints, and consistent formatting.
- Public Nano Banana skill packs sometimes use JSON as a reasoning scaffold for complex transformations.

Use two prompt modes:

| Mode | When to Use | Why |
|---|---|---|
| Direct prose | Simple one-shot requests with 1-3 constraints | Shorter, faster, closer to official Gemini examples |
| JSON scene spec | Complex, repeatable, or multi-constraint generation/editing | More deterministic, easier to audit, easier to templatize |

### Direct prose rules

When writing plain prompts for the CLI:

- Lead with the subject and intended use: `hero illustration for incident review deck`, `transparent mascot for product onboarding`, `landing page mockup`
- Specify composition and framing when it matters: `wide composition`, `center-weighted`, `room for headline on the left`
- Specify style only if it materially improves the result: `editorial`, `product-render`, `clean enterprise UI`, `cinematic`, `flat icon set`
- For presentation visuals, ask for negative space where text will sit
- For app assets, ask for clean silhouettes and legibility at smaller sizes
- For edits, describe the transformation, not the source file contents the model can already inspect through references

Avoid overloading the prompt with ten loosely related stylistic adjectives. Favor a precise brief over decorative prompt spam.

### JSON scene spec rules

For complex requests, prefer a compact JSON prompt whose values are still natural-language descriptions. The JSON is the scaffold, not the art style.

Core rules:

- Use descriptive sentence fragments in values, not cryptic tag clouds
- Omit fields that do not matter rather than filling them with placeholders
- Put the most important constraints near the top: `task`, `subject`, `goal`, `composition`, `constraints`
- Use arrays for hard requirements and forbidden changes
- For edits, separate `preserve` from `change`
- For reference-driven work, explicitly state what each reference controls

Recommended schema:

```json
{
	"task": "presentation_hero | ui_mockup | transparent_asset | image_edit | style_transfer | restoration",
	"goal": "What the final image is for and what success looks like.",
	"subject": {
		"primary": "Main subject or artifact",
		"details": "Important visual identity details"
	},
	"scene": {
		"environment": "Setting or background",
		"lighting": "Lighting direction and mood",
		"time_or_mood": "Optional atmosphere"
	},
	"composition": {
		"framing": "wide | close-up | centered | asymmetrical",
		"camera": "Optional camera or render language",
		"safe_zones": "Where text or empty space should exist"
	},
	"style": {
		"visual_language": "editorial | product render | clean enterprise UI | sticker | cinematic",
		"surface_finish": "Optional material treatment",
		"color_direction": "Palette guidance"
	},
	"text": {
		"render": "Exact text if text should appear in-image",
		"font_feel": "Descriptive typography direction"
	},
	"references": [
		{
			"path": "./input/example.png",
			"role": "pose | style | composition | logo | character | source_image",
			"preserve": "What must remain unchanged"
		}
	],
	"edit": {
		"change": ["Requested modifications"],
		"preserve": ["Locked elements"]
	},
	"constraints": [
		"Hard requirements",
		"Things to avoid described positively where possible"
	]
}
```

Decision rule:

- If the request could fit comfortably in one strong sentence, use prose.
- If the request has multiple visual goals, hard constraints, preserve-vs-change rules, or will likely be reused, use JSON.

---

## Reference Recipes

For portable, cross-project command templates, read:

`references/recipes.md`

Use that file for presentation covers, transparent assets, UI mockups, reference-image editing, and multi-image style transfer.

For the current SampleProject-specific overlays/examples, read:

`references/sample-project-overlays.md`

For reusable generic JSON scene specs and prompt profiles, use:

```bash
node scripts/build-prompt.mjs <profile-name>
node scripts/build-prompt.mjs <profile-name> '{"goal":"override text"}'
```

Available built-in generic profiles are documented in the recipes file and stored in:

`references/prompt-profiles.json`

---

## Failure Handling

- If `nano-banana` is not found, say that the skill requires the CLI and offer setup.
- If the command fails because of missing API credentials, explain where the CLI looks for `GEMINI_API_KEY`.
- For missing-credential guidance, enumerate the concrete lookup locations:
  - `.env` in the current working directory
  - `.env` in the Nano Banana repo root
  - `~/.nano-banana/.env`
- If transparency output has green fringes or fails outright, check whether `ffmpeg` and `imagemagick` are installed.
- If the output is compositionally wrong, revise the prompt first before escalating size or model tier.
- If the task needs batch generation or app integration, prefer generating repeatable shell commands over ad hoc prose.

---

## Success Criteria

This skill is successful when it produces one of the following:

- A working `nano-banana` command the agent can execute immediately
- A generated or edited image file saved to the requested location
- A clear installation or configuration path when the CLI is unavailable
- A repeatable command pattern that can be reused inside a build script, app backend, or presentation asset workflow
