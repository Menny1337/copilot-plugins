# Nano Banana SampleProject Overlays

Optional, project-tuned prompt packs for the current SampleProject FE weekly service-health / engineering improvement deck workflow.

These overlays are intentionally kept separate from the shared `nano-banana-cli` core so the user-level skill stays portable across repos. Use them when you are explicitly working on the SampleProject deck flow; otherwise prefer the generic recipes and built-in profiles in `recipes.md` and `prompt-profiles.json`.

## Weekly cover hero

```bash
PROMPT=$(cat <<'EOF'
{
  "task": "presentation_hero",
  "goal": "Create a full-bleed cover visual for the weekly SampleProject FE service-health review deck.",
  "subject": {
    "primary": "modern enterprise case management operations environment",
    "details": "calm but high-urgency atmosphere, premium internal enterprise-style presentation visual"
  },
  "scene": {
    "environment": "control room and analyst workspace hybrid, subtle signals of incident response without chaos",
    "lighting": "clean cinematic lighting with credible workplace realism",
    "time_or_mood": "focused, resilient, executive-ready"
  },
  "composition": {
    "framing": "wide hero composition",
    "camera": "slightly elevated wide shot",
    "safe_zones": "large clean center and left zones for title, team name, and date"
  },
  "style": {
    "visual_language": "editorial enterprise illustration",
    "color_direction": "deep blues, slate neutrals, restrained warm highlights"
  },
  "constraints": [
    "avoid sci-fi hologram cliches",
    "avoid clutter that would fight slide typography",
    "keep it suitable for an internal executive deck"
  ]
}
EOF
)

nano-banana "$PROMPT" -a 16:9 -s 2K -o sample-project-livesite-cover
```

## Team appreciation slide visual

```bash
PROMPT=$(cat <<'EOF'
{
  "task": "presentation_support_visual",
  "goal": "Create a warm team-appreciation visual for a thank-you slide after a heavy incident week.",
  "subject": {
    "primary": "small engineering team in a calm post-incident moment",
    "details": "subtle collaboration cues, no staged stock-photo energy"
  },
  "scene": {
    "environment": "modern workspace with screens and notes softened into background texture",
    "lighting": "warm, optimistic, natural light mixed with soft monitor glow"
  },
  "composition": {
    "framing": "presentation-safe supportive background",
    "safe_zones": "ample center space for a large thank-you headline"
  },
  "style": {
    "visual_language": "human, premium, internal culture visual",
    "color_direction": "warmer accent palette than the incident slides"
  },
  "constraints": [
    "no cheesy celebration tropes",
    "keep faces and body language understated and credible",
    "support large overlaid text"
  ]
}
EOF
)

nano-banana "$PROMPT" -a 16:9 -s 2K -o sample-project-team-thanks
```

## Builder mindset section divider

```bash
PROMPT=$(cat <<'EOF'
{
  "task": "presentation_divider",
  "goal": "Create a section visual for the engineering improvement slide that contrasts resilient systems with reactive firefighting.",
  "subject": {
    "primary": "resilient architecture metaphor",
    "details": "systems, paved paths, safeguards, and layered protection rather than literal firefighters"
  },
  "scene": {
    "environment": "abstract enterprise systems landscape",
    "lighting": "disciplined directional light with strong structure definition"
  },
  "composition": {
    "framing": "wide low-clutter divider image",
    "safe_zones": "top and center space for a large section headline and bullets"
  },
  "style": {
    "visual_language": "conceptual editorial graphic",
    "color_direction": "deep infrastructure blues with a focused accent color for builder-path emphasis"
  },
  "constraints": [
    "avoid literal fire imagery",
    "avoid busy data-viz noise",
    "make the metaphor legible at slide distance"
  ]
}
EOF
)

nano-banana "$PROMPT" -a 16:9 -s 2K -o sample-project-builder-mindset
```

## Systemic incident pattern visual

```bash
PROMPT=$(cat <<'EOF'
{
  "task": "presentation_analysis_visual",
  "goal": "Create a background visual for incident slides that reinforces the idea that repeated incidents are symptoms of systemic design flaws.",
  "subject": {
    "primary": "repeating fault lines or weak links across an enterprise system",
    "details": "a subtle visual metaphor for recurring failure patterns and missing guardrails"
  },
  "scene": {
    "environment": "abstract architecture map or service graph",
    "lighting": "high-contrast but controlled, suitable for overlay text"
  },
  "composition": {
    "framing": "wide background plate",
    "safe_zones": "left or center open area for incident summary text"
  },
  "style": {
    "visual_language": "strategic systems analysis graphic",
    "color_direction": "dark neutral foundation with restrained warning accents"
  },
  "constraints": [
    "avoid looking like a dashboard screenshot",
    "no tiny illegible nodes",
    "keep it elegant enough for recurring use across multiple slides"
  ]
}
EOF
)

nano-banana "$PROMPT" -a 16:9 -s 2K -o sample-project-systemic-patterns
```

## Paved paths / resilient architecture closer

```bash
PROMPT=$(cat <<'EOF'
{
  "task": "presentation_closer",
  "goal": "Create a closing visual that represents paved paths, resilient architecture, automation, and fewer future incidents.",
  "subject": {
    "primary": "clear engineered path through a complex system landscape",
    "details": "stability, automation, and proactive design over reactive toil"
  },
  "scene": {
    "environment": "abstract enterprise platform landscape with one clearly optimized route",
    "lighting": "hopeful, crisp, forward-looking"
  },
  "composition": {
    "framing": "wide aspirational slide visual",
    "safe_zones": "room for a closing takeaway and next-steps text"
  },
  "style": {
    "visual_language": "clean executive concept art",
    "color_direction": "dark-to-light progression suggesting system maturity"
  },
  "constraints": [
    "avoid fantasy scenery",
    "avoid motivational-poster cliches",
    "keep it grounded in engineering and platform thinking"
  ]
}
EOF
)

nano-banana "$PROMPT" -a 16:9 -s 2K -o sample-project-paved-paths
```
