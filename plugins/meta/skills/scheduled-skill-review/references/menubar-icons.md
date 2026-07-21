# Menu-bar icons — change & set

The native `SkillReviewMenuBar` app displays one state icon in the macOS menu bar. The source PNGs live in the skill at `scripts/icons/<state>.png`; the build/install flow bundles them into the app at `Contents/Resources/icons/<state>.png`.

## The six states

| Icon | State | When | Rendering |
| --- | --- | --- | --- |
| <img src="../scripts/icons/failed.png" width="22" alt="failed icon"> | `failed` | the last run reported failures | full color |
| <img src="../scripts/icons/paused.png" width="22" alt="paused icon"> | `paused` | daemon paused (`enabled=false`) | full color |
| <img src="../scripts/icons/reviewing.png" width="22" alt="reviewing icon"> | `reviewing` | a review cycle is running right now | full color |
| <img src="../scripts/icons/prs.png" width="22" alt="prs icon"> | `prs` | PRs are awaiting review/merge (`openPRs>0`) | full color |
| <img src="../scripts/icons/running.png" width="22" alt="running icon"> | `running` | re-reviews are due now (`dueReReviews>0`) | full color |
| <img src="../scripts/icons/idle.png" width="22" alt="idle icon"> | `idle` | enabled, nothing due | template image, auto-tinted by macOS |

`idle` is loaded with `isTemplate = true`, so macOS tints it to the menu-bar label color. The other five states keep `isTemplate = false`, preserving their color artwork. The app targets roughly 18 pt icon height in the bar and falls back to emoji only if a bundled PNG is missing: failed ⚠️, paused ⏸️, reviewing ✨, prs 🔬, running 🔄, idle 🧪.

## State precedence

The app reads `daemon-ctl.sh status` and picks the first matching state:

1. `failed` — `lastRun.failed` exists and is not `0`.
2. `paused` — `enabled == false`.
3. `reviewing` — `running == true`.
4. `prs` — `openPRs != 0`.
5. `running` — `dueReReviews != 0`.
6. `idle` — otherwise.

Keep filenames exactly `running.png`, `idle.png`, `paused.png`, `prs.png`, `failed.png`, and `reviewing.png`. Renaming a file breaks that state until the app is rebuilt with the expected resource name.

## Regenerate or replace the icons

To restyle the family, replace the six PNGs in `scripts/icons/` with same-named transparent PNGs, then rebuild/reinstall the app so the new files are copied into `SkillReviewMenuBar.app/Contents/Resources/icons/`.

```sh
ICONS="$REPO/plugins/meta/skills/scheduled-skill-review/scripts/icons"
# ...replace running/idle/paused/prs/failed/reviewing.png in $ICONS...
cd "$REPO/plugins/meta/skills/scheduled-skill-review"
bash scripts/menubar-install.sh
```

Recommended format:

- Transparent square PNGs, preferably 128×128 or larger source art conformed down to 128×128.
- Full-color artwork for `running`, `paused`, `prs`, `failed`, and `reviewing`.
- A clean monochrome alpha shape for `idle`; RGB color is ignored once the app marks it as a template image.
- Keep all glyphs visually balanced at menu-bar size, not just at full resolution.

### ImageMagick conform recipe

This recipe keys out a white background, centers the glyph on a transparent 128×128 canvas, and preserves full color for non-template states:

```sh
# Requires: brew install imagemagick
conform () {   # conform <src-on-white> <dest.png>
  magick "$1" \
    -alpha set -bordercolor white -border 2 \
    -fuzz 22% -fill none -draw "alpha 0,0 floodfill" \
    -shave 2x2 -trim +repage \
    -filter Lanczos -resize 92x92 -gravity center \
    -background none -extent 128x128 \
    "$2"
}

ICONS="$REPO/plugins/meta/skills/scheduled-skill-review/scripts/icons"
conform running-src.png   "$ICONS/running.png"
conform idle-src.png      "$ICONS/idle.png"
conform paused-src.png    "$ICONS/paused.png"
conform prs-src.png       "$ICONS/prs.png"
conform failed-src.png    "$ICONS/failed.png"
conform reviewing-src.png "$ICONS/reviewing.png"
```

If your source is already transparent, simplify to:

```sh
magick src.png -trim +repage -filter Lanczos -resize 92x92 -gravity center \
  -background none -extent 128x128 dest.png
```

For badged states such as `prs` and `failed`, composite badges at a larger working size and do one final Lanczos downscale to 128×128 to avoid smudging.

## Verify and preview

```sh
cd "$ICONS"
identify -format '%f %wx%h %[channels]\n' *.png
# expect 128x128 PNGs with alpha/RGBA channels
```

To preview proportions without installing, build a side-by-side strip in the repo working tree:

```sh
cd "$ICONS"
magick -size 16x128 xc:none gap.png
magick running.png gap.png idle.png gap.png paused.png gap.png prs.png gap.png failed.png gap.png reviewing.png +append icons-preview.png
open icons-preview.png
rm -f gap.png icons-preview.png
```

Install with `scripts/menubar-install.sh` when the preview looks right. The installed copy is inside the app bundle; replacing `scripts/icons/*.png` alone does not update a running installed app.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Emoji appears instead of an icon | PNG missing from `Contents/Resources/icons/` | Re-run `scripts/menubar-install.sh`; inspect the installed bundle resources. |
| `idle` appears in the wrong color in image previews | Preview shows raw pixels, but the app marks it as a template | Judge `idle` in the live menu bar after reinstalling. |
| Active icon is hard to see in light or dark mode | It is full-color and not auto-tinted | Adjust the color artwork and rebuild/reinstall. |
| Icon too large, small, or off-center | Glyph bounds are unbalanced | Re-run the conform recipe with a different `-resize` size, then reinstall. |
| Replaced file has no effect | The app bundle still contains the old PNG | Rebuild/reinstall so files are recopied into `Contents/Resources/icons/`. |
