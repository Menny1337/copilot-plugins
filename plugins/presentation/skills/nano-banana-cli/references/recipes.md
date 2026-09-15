# Nano Banana CLI Recipes

Use these command patterns as the starting point. For simple requests, a single descriptive sentence is enough. For higher-control workflows, prefer a JSON scene spec passed as one prompt string.

## JSON Prompting Notes

- Keep values descriptive and specific; JSON is structure, not magic
- Prefer JSON for presentation layouts, edits with preserve rules, and reusable app assets
- Use prose for tiny one-off prompts where JSON would just add noise

Shell pattern for multiline JSON prompts:

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "presentation_hero",
	"goal": "...",
	"subject": { "primary": "..." },
	"constraints": ["..."]
}
EOF
)

nano-banana "$PROMPT" -a 16:9 -s 2K -o example
```

Helper script pattern:

```bash
PROMPT=$(node scripts/build-prompt.mjs presentation-hero)
nano-banana "$PROMPT" -a 16:9 -s 2K -o incident-review-hero
```

With overrides:

```bash
PROMPT=$(node scripts/build-prompt.mjs presentation-hero '{"goal":"Create a sharper executive incident-review cover visual with more negative space for title text."}')
nano-banana "$PROMPT" -a 16:9 -s 2K -o incident-review-hero-v2
```

## Optional Project Overlays

For optional, synthetic service-review deck examples, read:

`references/service-review-overlays.md`

## Presentation Assets

### Slide hero image

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "presentation_hero",
	"goal": "Create a full-bleed hero visual for an executive incident review deck.",
	"subject": {
		"primary": "modern enterprise control room",
		"details": "credible operational environment, not sci-fi, premium but realistic"
	},
	"scene": {
		"environment": "security operations center with layered displays and subtle architectural depth",
		"lighting": "cinematic but believable practical lighting",
		"time_or_mood": "calm, high-stakes, executive-ready"
	},
	"composition": {
		"framing": "wide hero composition",
		"camera": "slightly elevated wide-angle shot",
		"safe_zones": "clean negative space on the left for title and subtitle"
	},
	"style": {
		"visual_language": "editorial enterprise illustration",
		"color_direction": "deep neutrals with restrained blue highlights"
	},
	"constraints": [
		"avoid cheesy sci-fi hologram tropes",
		"keep the image presentation-friendly and text-overlay safe"
	]
}
EOF
)

nano-banana "$PROMPT" -a 16:9 -s 2K -o incident-review-hero
```

### Section divider art

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "presentation_divider",
	"goal": "Generate section divider art for a security operations presentation.",
	"subject": {
		"primary": "abstract systems topology",
		"details": "layered network geometry and infrastructure motifs"
	},
	"composition": {
		"framing": "wide and low-clutter",
		"safe_zones": "empty space near the top for a large section headline"
	},
	"style": {
		"visual_language": "premium editorial abstraction",
		"color_direction": "restrained palette with disciplined contrast"
	},
	"constraints": [
		"no tiny illegible details",
		"avoid visual noise behind potential headline text"
	]
}
EOF
)

nano-banana "$PROMPT" -a 16:9 -s 2K -o section-divider-topology
```

### Cover image from an existing screenshot

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "image_edit",
	"goal": "Turn the referenced product screenshot into a polished keynote cover visual.",
	"references": [
		{
			"path": "./input/dashboard.png",
			"role": "source_image",
			"preserve": "core interface identity and recognizable product structure"
		}
	],
	"edit": {
		"change": [
			"extend the background to support 16:9 cover composition",
			"improve overall composition for keynote use",
			"add subtle premium lighting and polish"
		],
		"preserve": [
			"the core interface layout",
			"the product's recognizable visual identity"
		]
	},
	"composition": {
		"framing": "presentation cover",
		"safe_zones": "leave room for title treatment without crowding the UI"
	},
	"constraints": [
		"do not redesign the product",
		"keep the result believable as product-led marketing art"
	]
}
EOF
)

nano-banana "$PROMPT" -r ./input/dashboard.png -a 16:9 -s 2K -o deck-cover-from-ui
```

## App Assets

### Landing-page product mockup

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "ui_mockup",
	"goal": "Create a landing-page hero mockup for an enterprise SaaS product.",
	"subject": {
		"primary": "enterprise analytics dashboard",
		"details": "believable information architecture and product-grade polish"
	},
	"composition": {
		"framing": "website hero composition",
		"safe_zones": "support adjacent marketing copy if cropped"
	},
	"style": {
		"visual_language": "premium product render",
		"color_direction": "dark-on-light contrast with restrained accent colors"
	},
	"constraints": [
		"avoid generic AI slop dashboards",
		"keep charts and layout coherent at first glance"
	]
}
EOF
)

nano-banana "$PROMPT" -a 16:9 -s 2K -o product-mockup
```

### Mobile onboarding illustration

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "app_illustration",
	"goal": "Create a mobile onboarding illustration.",
	"subject": {
		"primary": "friendly productivity concept illustration",
		"details": "simple narrative, readable silhouette, not over-detailed"
	},
	"style": {
		"visual_language": "modern app illustration",
		"color_direction": "optimistic palette with controlled contrast"
	},
	"composition": {
		"framing": "vertical mobile-safe composition",
		"safe_zones": "leave breathing room near top and bottom for onboarding UI"
	},
	"constraints": [
		"minimal background clutter",
		"clear silhouette at mobile size"
	]
}
EOF
)

nano-banana "$PROMPT" -a 9:16 -s 1K -o onboarding-illustration
```

### Square app-store or tile art

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "tile_art",
	"goal": "Create square product art for an app tile or store listing.",
	"subject": {
		"primary": "collaboration software visual motif",
		"details": "single bold central concept"
	},
	"composition": {
		"framing": "square centered composition",
		"safe_zones": "keep key forms away from crop edges"
	},
	"constraints": [
		"minimal background",
		"crisp edges",
		"high legibility at small size"
	]
}
EOF
)

nano-banana "$PROMPT" -a 1:1 -s 1K -o app-tile-art
```

## Transparent Assets

### Logo concept with transparency

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "transparent_asset",
	"goal": "Generate a transparent logo concept for enterprise AI branding.",
	"subject": {
		"primary": "minimal geometric logo mark",
		"details": "strong silhouette, no text"
	},
	"style": {
		"visual_language": "clean enterprise branding asset"
	},
	"constraints": [
		"transparent-ready silhouette",
		"no background elements",
		"avoid overly ornamental detail"
	]
}
EOF
)

nano-banana "$PROMPT" -t -s 1K -o ai-logo-mark
```

### Mascot or sticker asset

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "transparent_asset",
	"goal": "Generate a mascot asset for developer tooling.",
	"subject": {
		"primary": "friendly robot mascot",
		"details": "expressive face, clean outline, polished render"
	},
	"constraints": [
		"transparent background",
		"readable silhouette",
		"no clutter around the character"
	]
}
EOF
)

nano-banana "$PROMPT" -t -s 1K -o devtool-mascot
```

### Game or app icon element

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "transparent_asset",
	"goal": "Generate a transparent shield icon element for a security product.",
	"subject": {
		"primary": "glowing shield icon",
		"details": "centered composition and futuristic product language"
	},
	"constraints": [
		"transparent background",
		"clean edges",
		"strong center-weighted readability"
	]
}
EOF
)

nano-banana "$PROMPT" -t -s 1K -o shield-icon
```

## Reference-Image Editing

### Change background only

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "image_edit",
	"goal": "Refresh the background without changing the foreground subject.",
	"references": [
		{
			"path": "./input/source.png",
			"role": "source_image",
			"preserve": "foreground subject exactly"
		}
	],
	"edit": {
		"change": [
			"replace the background with a soft neutral gradient"
		],
		"preserve": [
			"subject identity",
			"subject pose",
			"subject edges and proportions"
		]
	}
}
EOF
)

nano-banana "$PROMPT" -r ./input/source.png -o background-refresh
```

### Improve a rough image for production use

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "image_edit",
	"goal": "Refine a rough concept image into production-ready visual art.",
	"references": [
		{
			"path": "./input/concept.png",
			"role": "source_image",
			"preserve": "composition and core identity"
		}
	],
	"edit": {
		"change": [
			"improve lighting",
			"sharpen material detail",
			"increase polish for production use"
		],
		"preserve": [
			"original composition",
			"core visual identity"
		]
	},
	"constraints": [
		"do not invent a different concept",
		"keep the result believable as a refined version of the original"
	]
}
EOF
)

nano-banana "$PROMPT" -r ./input/concept.png -a 16:9 -s 2K -o refined-concept
```

### Photo restoration

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "restoration",
	"goal": "Restore a vintage photograph into a sharp, natural, high-detail image.",
	"references": [
		{
			"path": "./input/old-photo.jpg",
			"role": "source_image",
			"preserve": "identity, pose, and composition"
		}
	],
	"edit": {
		"change": [
			"remove blur and degradation",
			"restore natural detail",
			"improve lighting and tonal balance"
		],
		"preserve": [
			"subject identity",
			"pose",
			"composition"
		]
	},
	"constraints": [
		"avoid changing the person's recognizable features",
		"avoid over-stylized restoration"
	]
}
EOF
)

nano-banana "$PROMPT" -r ./input/old-photo.jpg -o restored-photo
```

## Multi-Reference Workflows

### Merge two visual directions

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "style_transfer",
	"goal": "Create a merged visual direction from two references.",
	"references": [
		{
			"path": "./input/style-a.png",
			"role": "style",
			"preserve": "interface language and structural cues"
		},
		{
			"path": "./input/style-b.png",
			"role": "style",
			"preserve": "visual polish and color discipline"
		}
	],
	"constraints": [
		"blend both references into one coherent result",
		"avoid making a side-by-side collage"
	]
}
EOF
)

nano-banana "$PROMPT" -r ./input/style-a.png -r ./input/style-b.png -a 16:9 -s 2K -o merged-style
```

### Match a character style while changing pose

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "character_consistency",
	"goal": "Create a new pose while preserving character identity and style.",
	"references": [
		{
			"path": "./input/character-reference.png",
			"role": "character",
			"preserve": "outfit, materials, proportions, and overall style"
		}
	],
	"edit": {
		"change": [
			"move the character into a new three-quarter pose"
		],
		"preserve": [
			"character identity",
			"costume fidelity",
			"materials",
			"proportions"
		]
	}
}
EOF
)

nano-banana "$PROMPT" -r ./input/character-reference.png -o character-new-pose
```

## Operations

### Low-cost smoke test

Use this first when validating that the CLI, API key, and billing path are all working before you spend money on more complex prompts.

```bash
nano-banana "simple abstract blue geometric illustration, clean composition, white background" -a 1:1 -s 512 -o smoke-basic-512
nano-banana --costs
```

### Low-cost reference-image edit smoke test

Use the output of the first smoke test as the reference image so you can verify reference loading and edit behavior with minimal extra setup.

```bash
nano-banana "restyle this into a cleaner flat poster aesthetic with brighter azure accents, stronger geometry, and keep the centered composition" -r ./smoke-basic-512.png -a 1:1 -s 512 -o smoke-edit-512
```

### Low-cost transparent-mode smoke test

Use this only after the basic smoke succeeds. It verifies the green-screen removal pipeline as well as the Gemini generation step.

```bash
nano-banana "minimal blue shield icon, clean silhouette, centered, transparent background" -t -s 512 -o transparent-shield-512
```

### Use higher-quality model

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "brand_illustration",
	"goal": "Generate a premium brand illustration with complex composition and rich detail.",
	"style": {
		"visual_language": "high-end campaign art"
	},
	"constraints": [
		"complex but coherent composition",
		"rich detail without visual clutter"
	]
}
EOF
)

nano-banana "$PROMPT" --model pro -a 16:9 -s 2K -o premium-illustration
```

### Save into a specific asset folder

```bash
PROMPT=$(cat <<'EOF'
{
	"task": "docs_hero",
	"goal": "Create a clean product illustration for a documentation site hero.",
	"constraints": [
		"clean composition",
		"docs-friendly clarity",
		"suitable for adjacent explanatory copy"
	]
}
EOF
)

nano-banana "$PROMPT" -a 16:9 -s 1K -o docs-hero -d ./public/images
```

### Review spend

```bash
nano-banana --costs
```
