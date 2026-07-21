---
name: html-presentation
description: "Create beautiful browser-runnable HTML presentations using reveal.js. Single self-contained HTML file with slides, transitions, speaker notes, and responsive design. Use for HTML slides, browser presentations, reveal.js decks, and web-based presentations."
user-invocable: false
---

# HTML Presentation Creation with reveal.js

Create professional, browser-runnable presentations as single self-contained HTML files using reveal.js. No build step — just open in a browser.

## When to Use

- User wants an HTML presentation that runs in any browser
- User asks for reveal.js slides or a web-based presentation
- User wants a presentation they can host online or share as a single file
- User wants live-reload editing (just refresh the browser)
- User prefers HTML/CSS control over PowerPoint limitations

## When to Skip

- User wants `.pptx` output — use `pptx-creation` skill instead
- User wants PDF-only — generate HTML then print to PDF, or use LaTeX
- User wants Google Slides — suggest PPTX import or direct Google Slides API
- User needs offline playback without a browser — use PPTX

---

## Quality Contract

These rules override any other guidance. If there is any conflict, these rules win.

### 1. No Invented Facts

- No metrics, stats, or claims unless from user-provided source material
- Placeholder numbers marked explicitly: `(placeholder)` in speaker notes

### 2. One Narrative Spine

Pick ONE and follow it throughout:

| Spine | Flow |
|-------|------|
| **Teaching** | Problem → Concept → Mechanism → Examples → Pitfalls → Summary |
| **Persuasion** | Hook → Problem → Solution → Evidence → CTA |
| **Report** | Executive Summary → Key Findings → Details → Recommendations |
| **Status** | Highlights → Metrics → Risks → Next Steps |
| **Proposal** | Context → Opportunity → Approach → Timeline → Ask |

### 3. Titles as Conclusions

- ❌ "Q3 Revenue" → ✅ "Q3 Revenue Grew 23% YoY"

### 4. One Idea Per Slide

If a slide makes 2 points, split it.

### 5. Speaker Notes on Every Slide

Every slide MUST have speaker notes in `<aside class="notes">`.

---

## Single-File Template

Generate a self-contained HTML file. All CSS is embedded. reveal.js loads from CDN.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PRESENTATION_TITLE</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/black.css" id="theme">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/highlight/monokai.css">
  <style>
    /* Custom theme overrides */
    :root {
      --r-background-color: #1a1a2e;
      --r-main-color: #f5f5f5;
      --r-heading-color: #f5f5f5;
      --r-link-color: #e94560;
      --r-selection-background-color: #e94560;
      --r-main-font-size: 42px;
    }
    .reveal h1 { font-size: 2.2em; font-weight: 700; }
    .reveal h2 { font-size: 1.6em; font-weight: 600; }
    .reveal h3 { font-size: 1.2em; font-weight: 600; }
    .reveal p, .reveal li { font-size: 0.85em; line-height: 1.5; }
    .reveal .accent { color: #e94560; }
    .reveal .muted { color: #8888aa; font-size: 0.7em; }
    .reveal img { max-height: 60vh; border-radius: 8px; }
    .reveal .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 2em; text-align: left; }
    .reveal blockquote { border-left: 4px solid #e94560; padding-left: 1em; font-style: italic; }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">

      <!-- Title Slide -->
      <section>
        <h1>Presentation Title</h1>
        <p class="muted">Subtitle or author • Date</p>
        <aside class="notes">Speaker notes for the title slide.</aside>
      </section>

      <!-- Content slides go here -->

    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/notes/notes.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/highlight/highlight.js"></script>
  <script>
    Reveal.initialize({
      hash: true,
      slideNumber: true,
      transition: 'slide',
      plugins: [RevealNotes, RevealHighlight]
    });
  </script>
</body>
</html>
```

---

## Slide Types

### Title Slide
```html
<section>
  <h1>Main Title</h1>
  <p class="muted">Subtitle • Author • Date</p>
  <aside class="notes">Opening context.</aside>
</section>
```

### Content Slide (text + bullets)
```html
<section>
  <h2>Slide Title as Conclusion</h2>
  <ul>
    <li>Key point one</li>
    <li>Key point two</li>
    <li>Key point three</li>
  </ul>
  <aside class="notes">Detailed speaker notes.</aside>
</section>
```

### Image Slide
```html
<section>
  <h2>Visual Title</h2>
  <img src="./assets/image-name.png" alt="Description">
  <p class="muted">Caption text</p>
  <aside class="notes">What this image shows and why it matters.</aside>
</section>
```

For nano-banana generated images, reference the local path where the image was saved.

### Two-Column Layout
```html
<section>
  <h2>Comparison Title</h2>
  <div class="two-col">
    <div>
      <h3>Left Column</h3>
      <p>Content here</p>
    </div>
    <div>
      <h3>Right Column</h3>
      <p>Content here</p>
    </div>
  </div>
  <aside class="notes">Notes.</aside>
</section>
```

### Section Divider
```html
<section data-background-color="#0f3460">
  <h1>Section Title</h1>
  <aside class="notes">Transition context.</aside>
</section>
```

### Quote Slide
```html
<section>
  <blockquote>"The quote text goes here."</blockquote>
  <p class="muted">— Attribution</p>
  <aside class="notes">Why this quote matters.</aside>
</section>
```

### Code Slide
```html
<section>
  <h2>Code Example</h2>
  <pre><code class="language-javascript" data-trim>
function hello() {
  return "world";
}
  </code></pre>
  <aside class="notes">Explain the code.</aside>
</section>
```

---

## Color Palettes

Match the PPTX palettes. Apply via CSS custom properties in the `<style>` block:

| Palette | Background | Text | Accent | Usage |
|---------|-----------|------|--------|-------|
| **Dark Modern** (default) | `#1a1a2e` | `#f5f5f5` | `#e94560` | Dark, professional, modern |
| **Corporate Blue** | `#ffffff` | `#333333` | `#4472C4` | Light, corporate, formal |
| **Ocean** | `#2C3E50` | `#ECF0F1` | `#16A085` | Dark, calm, technical |
| **Minimal** | `#ffffff` | `#2D3436` | `#0984E3` | Light, clean, documentation |
| **Warm** | `#2C3E50` | `#ECF0F1` | `#E67E22` | Dark, energetic, startup |

To apply a palette, update the `:root` CSS variables. Example for **Ocean**:
```css
:root {
  --r-background-color: #2C3E50;
  --r-main-color: #ECF0F1;
  --r-heading-color: #ECF0F1;
  --r-link-color: #16A085;
  --r-selection-background-color: #16A085;
}
```

The template above uses **Dark Modern** by default (`#1a1a2e` background, `#e94560` accent).

---

## Typography Rules

- **Titles:** Bold, 2.2em (h1) or 1.6em (h2)
- **Body text:** 0.85em, line-height 1.5
- **Max 5 bullet points per slide**
- **Max 75 words of body text per slide**
- **Use web-safe fonts** — system fonts or Google Fonts via CDN link

---

## Embedding Generated Images

When using nano-banana generated images in slides:

1. Generate images to a local `./assets/` directory
2. Reference them with relative paths: `<img src="./assets/hero.png">`
3. Use `data-background-image` for full-bleed backgrounds:
   ```html
   <section data-background-image="./assets/bg.png" data-background-size="cover">
   ```
4. For transparent overlays: `<img src="./assets/icon.png" style="max-height: 40vh;">`

**Important: Portability tradeoff.** When images use relative paths, the HTML file requires the `./assets/` folder alongside it to display correctly. If sharing the presentation as a single file (email, Slack), either:
- **Zip the HTML + assets folder together**, or
- **Embed small images as Base64 data URIs** (`data:image/png;base64,...`) for true single-file portability (at the cost of larger file size)

---

## Viewing the Presentation

```bash
# Simple: open directly in browser
open presentation.html          # macOS
xdg-open presentation.html     # Linux
start presentation.html         # Windows

# With live reload (if npx available):
npx serve .
# Then open http://localhost:3000/presentation.html
```

### Keyboard Controls
- **→ / Space**: Next slide
- **← / Backspace**: Previous slide
- **S**: Open speaker notes (separate window)
- **O**: Overview mode
- **F**: Fullscreen
- **Esc**: Exit overview/fullscreen

---

## PDF Export

reveal.js supports print-to-PDF via the browser:

1. Open the presentation in Chrome
2. Append `?print-pdf` to the URL: `presentation.html?print-pdf`
3. Print → Save as PDF (set background graphics: on, margins: none)

---

## Verification Before Delivery

- [ ] Every slide follows the chosen narrative spine
- [ ] Every slide has ONE clear takeaway in the title
- [ ] No invented facts, metrics, or claims
- [ ] Speaker notes present on every slide (`<aside class="notes">`)
- [ ] Images load (check relative paths)
- [ ] Presentation renders correctly in browser
- [ ] Color contrast is accessible (test with different displays)
- [ ] Code blocks syntax-highlight correctly (if any)
