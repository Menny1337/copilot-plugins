---
name: pptx-creation
description: "Create and rebuild professional PowerPoint presentations (.pptx) from content, outlines, or approved slide plans. Uses PptxGenJS + Playwright for HTML-designed slides, native charts/tables, and speaker notes. Use for new deck generation or full rebuilds. For existing PPTX maintenance, SharePoint editing, template surgery, or OOXML-only fixes, prefer the external Clawpilot `pptx` skill if available."
user-invocable: false
---

> **Path resolution:** all `scripts/...` and `references/...` paths in this file are relative to this skill's installation directory (the directory containing this `SKILL.md`). The agent should resolve them by combining the skill's install path (provided by Copilot CLI when the skill is invoked) with the relative path.

# PowerPoint Presentation Creation, Editing & Analysis

Create beautiful, professional `.pptx` presentations programmatically using Node.js. Read and edit existing presentations via OOXML manipulation. Two creation pipelines for different use cases.

## When to Use

- User asks to create a PowerPoint, presentation, slide deck, or `.pptx` file
- User provides content (text, data, outline) and wants it turned into slides
- User wants a professional-looking presentation generated automatically
- User wants charts, tables, or data visualizations in PowerPoint format
- User wants to read, analyze, or extract content from an existing `.pptx`
- User wants to edit, rearrange, or update slides in an existing `.pptx`

## When to Skip

- User wants Google Slides or Keynote output — this skill produces `.pptx` only
- User wants a PDF presentation without PowerPoint — use Marp or LaTeX
- User just wants a markdown slide deck — use Marp directly
- User wants live collaborative editing — suggest PowerPoint Online

---

## Quality Contract

These rules override any other guidance in this skill. If there is any conflict, these rules win.

### 1. No Invented Facts

- **No metrics, stats, pricing, or adoption numbers** unless they appear verbatim in source material provided by the user
- If you need a number for illustration, mark it explicitly: `"(placeholder)"` in speaker notes
- **If unsure whether a fact is in the source: omit it**

### 2. One Narrative Spine

Pick ONE spine and follow it throughout. No A→B→A jumps.

| Spine | Flow |
|-------|------|
| **Teaching** | Problem → Concept → Mechanism → Examples → Pitfalls → Summary |
| **Persuasion** | Hook → Problem → Solution → Evidence → CTA |
| **Report** | Executive Summary → Key Findings → Details → Recommendations |
| **Status** | Highlights → Metrics → Risks → Next Steps |
| **Proposal** | Context → Opportunity → Approach → Timeline → Ask |

Every slide must map to exactly one spine step. If a slide doesn't fit: remove it or split into appropriate steps.

### 3. Titles as Conclusions

Write slide titles that state the takeaway, not the topic:
- ❌ "Q3 Revenue" (topic — tells the audience nothing)
- ✅ "Q3 Revenue Grew 23% YoY" (conclusion — they know the point immediately)

### 4. One Idea Per Slide

If a slide makes 2 points, split it. If content doesn't fit, add more slides — never shrink text below typography minimums.

### 5. Lead with Hook, Not Objectives

The first content slide must create curiosity:
1. Title slide (compelling value proposition)
2. Hook slide (provocative question, surprising stat, or "what if")
3. Then learning objectives or agenda

### 6. Speaker Notes on Every Slide

Every slide MUST have speaker notes. They make the deck usable by other presenters and serve as the script.

### 7. Verification Before Delivery

Before delivering the final `.pptx`, verify:
- [ ] Every slide follows the chosen narrative spine
- [ ] Every slide has ONE clear takeaway matching the title
- [ ] No invented facts, metrics, or claims
- [ ] All text meets typography minimums (≥14pt)
- [ ] Speaker notes present on every slide
- [ ] Charts/tables render correctly
- [ ] Images load (no broken references)

---

## Reading & Analyzing Existing PPTX

### Text Extraction

For quick text content extraction, use markitdown:

```bash
python -m markitdown presentation.pptx
```

Or with Node.js, unpack and read:

```bash
node scripts/unpack.mjs presentation.pptx ./unpacked
```

### Raw XML Access

You need raw XML access for: comments, speaker notes, slide layouts, animations, design elements, and complex formatting.

Read the full OOXML reference:
```
references/ooxml-reference.md
```

#### Unpacking a PPTX

A `.pptx` file is a ZIP archive containing XML files:

```bash
# Quick unpack with standard tools
mkdir -p unpacked && cd unpacked && unzip ../presentation.pptx
```

Or use the included script:

```bash
node scripts/unpack.mjs presentation.pptx ./unpacked
```

#### Key Files in Unpacked PPTX

| Path | Purpose |
|------|---------|
| `[Content_Types].xml` | Declares all parts and their types |
| `ppt/presentation.xml` | Slide order, sizes, slide master references |
| `ppt/slides/slide1.xml` | Individual slide content |
| `ppt/slides/_rels/slide1.xml.rels` | Slide relationships (images, layouts) |
| `ppt/slideMasters/` | Master slide templates |
| `ppt/slideLayouts/` | Layout definitions |
| `ppt/media/` | Embedded images and media |
| `ppt/notesSlides/` | Speaker notes per slide |
| `ppt/theme/theme1.xml` | Theme colors, fonts, effects |
| `docProps/app.xml` | Slide count and statistics |

#### Repacking After Edits

```bash
node scripts/unpack.mjs --pack ./unpacked output.pptx
```

Or manually:

```bash
cd unpacked && zip -r ../output.pptx . -x ".*"
```

### Slide Inventory

To understand what's in an existing presentation before editing:

1. Unpack the PPTX
2. Count slides: `ls ppt/slides/slide*.xml | wc -l`
3. List media: `ls ppt/media/`
4. Read slide content: `cat ppt/slides/slide1.xml | xmllint --format -`

---

## Creating Presentations

### Prerequisites

Install the helper's pinned local dependencies once:

```bash
cd scripts
npm install
```

The local `scripts/node_modules/` directory is ignored by the marketplace export
and must not be committed. On macOS, the renderer uses the installed Chrome
channel. On other platforms, install the Playwright Chromium runtime if needed:
`npx playwright install chromium`.

### Choose Your Method

| Method | Best For | Visual Quality | Native Text? |
|--------|----------|---------------|-------------|
| **HTML → PPTX** (Method A) | Beautiful designed slides, visual storytelling | ⭐⭐⭐⭐⭐ | Screenshot-based |
| **PptxGenJS Direct** (Method B) | Data-driven decks, charts, tables, automation | ⭐⭐⭐⭐ | Yes (editable) |
| **Hybrid** (Recommended) | Mix of visual + data slides | ⭐⭐⭐⭐⭐ | Best of both |

**Recommendation:** Use Method A for hero slides (title, section dividers, key visuals) and Method B for data slides (charts, tables, text-heavy content). Mix both in one presentation.

---

### Method A: HTML → PPTX Pipeline

Design slides as HTML with full CSS control, render with Playwright, package into PPTX.

Read the detailed HTML slide rules:
```
references/html-to-pptx.md
```

#### A.1 — Create HTML Slide Files

One HTML file per slide. Fixed 16:9 dimensions:

```html
<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 1280px;
    height: 720px;
    overflow: hidden;
    font-family: Arial, Helvetica, sans-serif;
  }
  body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: #1a1a2e;
    color: #ffffff;
    padding: 60px 80px;
  }
  h1 { font-size: 48px; font-weight: 700; margin-bottom: 24px; text-align: center; }
  p { font-size: 24px; opacity: 0.8; text-align: center; }
</style>
</head>
<body>
  <h1>Presentation Title</h1>
  <p>Subtitle — Date or Context</p>
</body>
</html>
```

**Critical Rules:**
- Body MUST be `1280px × 720px` (16:9)
- No scrolling — all content must fit within the body
- Web-safe fonts only: Arial, Helvetica, Georgia, Verdana, Tahoma, Trebuchet MS
- No CSS gradients in direct elements — pre-render as PNG (see A.2)
- All image paths must be absolute or data URIs
- Use `display: flex` on body to prevent margin collapse
- Use `overflow: hidden` to catch overflow issues early

#### A.2 — Pre-render Gradients & Icons as PNG

CSS gradients don't transfer to PPTX. Rasterize with Sharp:

```javascript
import sharp from 'sharp';

async function createGradient(color1, color2, filename, w = 1280, h = 720, angle = '135') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${color1}"/>
        <stop offset="100%" style="stop-color:${color2}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filename);
  return filename;
}

async function rasterizeIcon(svgString, size, filename) {
  await sharp(Buffer.from(svgString))
    .resize(size, size)
    .png()
    .toFile(filename);
  return filename;
}
```

Reference in HTML: `<body style="background: url('/absolute/path/gradient.png') no-repeat center/cover;">`

#### A.3 — Render & Build with html2pptx Script

Use the included conversion script:

```bash
node scripts/html2pptx.mjs \
  --slides slides/title.html slides/overview.html slides/data.html \
  --notes "Welcome everyone..." "Here's what we'll cover" "Key metrics" \
  --output presentation.pptx \
  --title "Q3 Business Review" \
  --author "Author Name"
```

Or call programmatically:

```javascript
import { buildPresentation } from 'scripts/html2pptx.mjs';

await buildPresentation({
  slides: [
    { html: 'slides/title.html', notes: 'Welcome everyone...' },
    { html: 'slides/overview.html', notes: 'Here is our agenda...' },
    { html: 'slides/chart.html', notes: 'Revenue grew 23%...' }
  ],
  output: 'presentation.pptx',
  title: 'Q3 Business Review',
  author: 'Author Name'
});
```

#### A.4 — Inline HTML Generation (No Files)

For simple slides, generate HTML inline without writing to files:

```javascript
import { chromium } from 'playwright';
import PptxGenJS from 'pptxgenjs';

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 720 });

const slideHtml = `<!DOCTYPE html><html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1280px; height: 720px; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center;
         background: #0f3460; color: white; font-family: Arial; }
  h1 { font-size: 56px; font-weight: 700; }
</style></head><body><h1>Big Bold Statement</h1></body></html>`;

await page.setContent(slideHtml, { waitUntil: 'networkidle' });
const screenshot = await page.screenshot();

const slide = pptx.addSlide();
slide.background = { data: `data:image/png;base64,${screenshot.toString('base64')}` };
slide.addNotes('This is the key message of the presentation.');

await browser.close();
await pptx.writeFile({ fileName: 'output.pptx' });
```

#### A.5 — Preview Before Packaging

Screenshot slides for user review before final packaging:

```javascript
// Save preview images
await page.screenshot({ path: `preview-slide-${i + 1}.png` });
// Show to user for approval before proceeding
```

---

### Method B: PptxGenJS Direct Pipeline

For data-heavy, programmatic, or text-rich slides with native editable elements.

Read the full API reference:
```
references/pptxgenjs-api.md
```

#### B.1 — Presentation Setup

```javascript
import PptxGenJS from 'pptxgenjs';
const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9';  // 10" × 5.625"
pptx.author = 'Author Name';
pptx.title = 'Presentation Title';
```

#### B.2 — Slide Masters (Reusable Templates)

Define masters for consistent branding:

```javascript
pptx.defineSlideMaster({
  title: 'BRANDED_LIGHT',
  background: { color: 'FFFFFF' },
  objects: [
    { rect: { x: 0, y: 5.35, w: '100%', h: 0.275, fill: { color: '4472C4' } } },
    { text: { text: '{slideNumber}', options: { x: 9, y: 5.35, w: 0.8, h: 0.275, fontSize: 10, color: 'FFFFFF', align: 'center', valign: 'middle' } } }
  ]
});

pptx.defineSlideMaster({
  title: 'BRANDED_DARK',
  background: { color: '1a1a2e' },
  objects: [
    { rect: { x: 0, y: 5.35, w: '100%', h: 0.275, fill: { color: '0f3460' } } },
    { text: { text: '{slideNumber}', options: { x: 9, y: 5.35, w: 0.8, h: 0.275, fontSize: 10, color: 'AAAAAA', align: 'center', valign: 'middle' } } }
  ]
});
```

#### B.3 — Common Slide Patterns

**Title Slide:**
```javascript
const s = pptx.addSlide({ masterName: 'BRANDED_DARK' });
s.addText('Presentation Title', {
  x: 0.75, y: 1.8, w: 8.5, h: 1.4,
  fontSize: 44, color: 'FFFFFF', fontFace: 'Arial',
  bold: true, align: 'center'
});
s.addText('Subtitle — Date', {
  x: 0.75, y: 3.3, w: 8.5, h: 0.6,
  fontSize: 22, color: 'AAAAAA', fontFace: 'Arial', align: 'center'
});
s.addNotes('Welcome and introduce the topic.');
```

**Section Divider:**
```javascript
const s = pptx.addSlide();
s.background = { color: '0f3460' };
s.addText('Section Title', {
  x: 0.75, y: 2.2, w: 8.5, h: 1,
  fontSize: 40, color: 'FFFFFF', fontFace: 'Arial', bold: true, align: 'center'
});
s.addShape(pptx.ShapeType.rect, {
  x: 4, y: 3.4, w: 2, h: 0.04, fill: { color: 'e94560' }
});
s.addNotes('Transition to next section.');
```

**Content with Bullets:**
```javascript
const s = pptx.addSlide({ masterName: 'BRANDED_LIGHT' });
s.addText('Key Findings Show Strong Growth', {
  x: 0.5, y: 0.3, w: 9, h: 0.8,
  fontSize: 32, color: '1a1a2e', fontFace: 'Arial', bold: true
});
s.addText([
  { text: 'Revenue increased 23% year-over-year\n', options: { bullet: true, fontSize: 20 } },
  { text: 'Customer retention improved to 94%\n', options: { bullet: true, fontSize: 20 } },
  { text: 'NPS score rose from 67 to 72\n', options: { bullet: true, fontSize: 20 } },
  { text: 'Three new enterprise accounts closed', options: { bullet: true, fontSize: 20 } }
], { x: 0.8, y: 1.5, w: 8.4, h: 3.5, color: '333333', fontFace: 'Arial', valign: 'top' });
s.addNotes('Walk through each metric. Emphasize the retention improvement.');
```

**Two-Column Comparison:**
```javascript
const s = pptx.addSlide({ masterName: 'BRANDED_LIGHT' });
s.addText('Before vs. After', {
  x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 32, color: '1a1a2e', bold: true
});
// Left column
s.addShape(pptx.ShapeType.roundRect, {
  x: 0.5, y: 1.4, w: 4.2, h: 3.6, fill: { color: 'FFF3F3' }, rectRadius: 0.15
});
s.addText('Before', { x: 0.5, y: 1.5, w: 4.2, h: 0.5, fontSize: 22, color: 'C0392B', bold: true, align: 'center' });
s.addText([
  { text: 'Manual process\n', options: { bullet: true, fontSize: 18 } },
  { text: '3-day turnaround\n', options: { bullet: true, fontSize: 18 } },
  { text: '15% error rate', options: { bullet: true, fontSize: 18 } }
], { x: 0.8, y: 2.2, w: 3.6, h: 2.5, color: '555555' });
// Right column
s.addShape(pptx.ShapeType.roundRect, {
  x: 5.3, y: 1.4, w: 4.2, h: 3.6, fill: { color: 'F0FFF0' }, rectRadius: 0.15
});
s.addText('After', { x: 5.3, y: 1.5, w: 4.2, h: 0.5, fontSize: 22, color: '27AE60', bold: true, align: 'center' });
s.addText([
  { text: 'Fully automated\n', options: { bullet: true, fontSize: 18 } },
  { text: '< 1 hour\n', options: { bullet: true, fontSize: 18 } },
  { text: '0.5% error rate', options: { bullet: true, fontSize: 18 } }
], { x: 5.6, y: 2.2, w: 3.6, h: 2.5, color: '555555' });
s.addNotes('Contrast the before and after. Emphasize the time savings.');
```

**Chart Slide:**
```javascript
const s = pptx.addSlide({ masterName: 'BRANDED_LIGHT' });
s.addText('Revenue Grew 23% Year-over-Year', {
  x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 32, color: '1a1a2e', bold: true
});
s.addChart(pptx.charts.BAR, [{
  name: 'Revenue ($M)',
  labels: ['Q1', 'Q2', 'Q3', 'Q4'],
  values: [4.5, 5.5, 6.2, 7.1]
}], {
  x: 0.5, y: 1.3, w: 9, h: 3.8,
  showValue: true, valueFontSize: 11,
  chartColors: ['4472C4'],
  catAxisLabelFontSize: 12,
  barDir: 'col',
  showLegend: false
});
s.addText('Source: Finance team, FY24 actuals', {
  x: 0.5, y: 5.1, w: 9, h: 0.3, fontSize: 10, color: '999999', italic: true
});
s.addNotes('Revenue data from finance. Q4 includes the enterprise deal.');
```

**Table Slide:**
```javascript
const s = pptx.addSlide({ masterName: 'BRANDED_LIGHT' });
s.addText('KPI Dashboard — All Metrics Trending Up', {
  x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, color: '1a1a2e', bold: true
});
const headerOpts = { fill: { color: '4472C4' }, color: 'FFFFFF', bold: true, fontSize: 14 };
s.addTable([
  [
    { text: 'Metric', options: headerOpts },
    { text: 'Current', options: headerOpts },
    { text: 'Previous', options: headerOpts },
    { text: 'Change', options: headerOpts }
  ],
  ['Revenue', '$7.1M', '$5.8M', { text: '+23%', options: { color: '27AE60', bold: true } }],
  [{ text: 'Users', options: { fill: { color: 'F2F2F2' } } }, { text: '125K', options: { fill: { color: 'F2F2F2' } } }, { text: '102K', options: { fill: { color: 'F2F2F2' } } }, { text: '+22%', options: { fill: { color: 'F2F2F2' }, color: '27AE60', bold: true } }],
  ['Retention', '94%', '89%', { text: '+5pp', options: { color: '27AE60', bold: true } }],
  [{ text: 'NPS', options: { fill: { color: 'F2F2F2' } } }, { text: '72', options: { fill: { color: 'F2F2F2' } } }, { text: '67', options: { fill: { color: 'F2F2F2' } } }, { text: '+5', options: { fill: { color: 'F2F2F2' }, color: '27AE60', bold: true } }]
], {
  x: 0.75, y: 1.4, w: 8.5,
  border: { pt: 1, color: 'E0E0E0' },
  colW: [2.5, 2, 2, 2],
  rowH: [0.5, 0.45, 0.45, 0.45, 0.45],
  fontSize: 14, align: 'center', valign: 'middle'
});
s.addNotes('Walk through each KPI. Highlight retention improvement.');
```

**Quote Slide:**
```javascript
const s = pptx.addSlide();
s.background = { color: 'F8F9FA' };
s.addText('"', { x: 0.8, y: 1, w: 1, h: 1, fontSize: 120, color: '4472C4', fontFace: 'Georgia', bold: true });
s.addText('The best way to predict the future is to invent it.', {
  x: 1.5, y: 1.8, w: 7, h: 1.5, fontSize: 28, color: '2C3E50', fontFace: 'Georgia', italic: true, align: 'left'
});
s.addText('— Alan Kay', {
  x: 1.5, y: 3.5, w: 7, h: 0.5, fontSize: 18, color: '888888', fontFace: 'Arial'
});
s.addNotes('Use this quote to transition into the innovation section.');
```

**Closing/CTA Slide:**
```javascript
const s = pptx.addSlide();
s.background = { color: '1a1a2e' };
s.addText('Next Steps', {
  x: 0.75, y: 1.5, w: 8.5, h: 0.8, fontSize: 40, color: 'FFFFFF', bold: true, align: 'center'
});
s.addText([
  { text: '1. Review the proposal by Friday\n', options: { fontSize: 22, color: 'DDDDDD' } },
  { text: '2. Schedule follow-up with stakeholders\n', options: { fontSize: 22, color: 'DDDDDD' } },
  { text: '3. Begin Phase 1 implementation', options: { fontSize: 22, color: 'DDDDDD' } }
], { x: 1.5, y: 2.8, w: 7, h: 2, align: 'left' });
s.addText('Questions? → name@company.com', {
  x: 0.75, y: 4.8, w: 8.5, h: 0.5, fontSize: 16, color: '888888', align: 'center'
});
s.addNotes('Thank the audience. Open for questions.');
```

---

### Hybrid: Combining Methods A + B

A typical professional presentation mixes both methods:

> **Deck author metadata:** `pptx.author` below reads the optional `PPTX_AUTHOR` environment variable (falling back to an empty string). Export `PPTX_AUTHOR="Your Name"` before running to brand the file's author metadata, or leave it unset to omit it. Set it the same way for any of the generation scripts in this skill.

```javascript
import PptxGenJS from 'pptxgenjs';
import { chromium } from 'playwright';
import path from 'path';

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9';
pptx.author = process.env.PPTX_AUTHOR || '';
pptx.title = 'Q3 Business Review';

// --- Method A slides (HTML-designed) ---
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 720 });

// Title slide from HTML
await page.goto(`file://${path.resolve('slides/title.html')}`, { waitUntil: 'networkidle' });
const titlePng = await page.screenshot();
const s1 = pptx.addSlide();
s1.background = { data: `data:image/png;base64,${titlePng.toString('base64')}` };
s1.addNotes('Welcome everyone. Today we review Q3 performance.');

// Section divider from HTML
await page.goto(`file://${path.resolve('slides/section-metrics.html')}`, { waitUntil: 'networkidle' });
const sectionPng = await page.screenshot();
const s2 = pptx.addSlide();
s2.background = { data: `data:image/png;base64,${sectionPng.toString('base64')}` };
s2.addNotes('Now let us dive into the numbers.');

await browser.close();

// --- Method B slides (PptxGenJS native) ---
// Chart slide with native editable chart
const s3 = pptx.addSlide();
s3.addText('Revenue Grew 23% Year-over-Year', {
  x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 32, bold: true, color: '1a1a2e'
});
s3.addChart(pptx.charts.LINE, [{
  name: 'Revenue ($M)',
  labels: ['Q1', 'Q2', 'Q3', 'Q4'],
  values: [4.5, 5.5, 6.2, 7.1]
}], {
  x: 0.5, y: 1.3, w: 9, h: 4, chartColors: ['4472C4'], showValue: true
});
s3.addNotes('Revenue data from finance. Q4 spike due to enterprise deal.');

await pptx.writeFile({ fileName: 'Q3-Review.pptx' });
console.log('✅ Created Q3-Review.pptx');
```

---

## Editing Existing Presentations

### Simple Text Replacement

For find-and-replace in existing PPTX:

```bash
# Unpack
node scripts/unpack.mjs input.pptx ./edit-dir

# Find and replace text across all slides
cd edit-dir
grep -rl 'OLD_TEXT' ppt/slides/ | xargs sed -i '' 's/OLD_TEXT/NEW_TEXT/g'

# Repack
node scripts/unpack.mjs --pack ./edit-dir output.pptx
```

### Rearranging Slides

Slide order is controlled by `ppt/presentation.xml` — reorder `<p:sldId>` elements:

```xml
<!-- Original order -->
<p:sldIdLst>
  <p:sldId id="256" r:id="rId2"/>
  <p:sldId id="257" r:id="rId3"/>
  <p:sldId id="258" r:id="rId4"/>
</p:sldIdLst>

<!-- Move slide 3 to position 2 -->
<p:sldIdLst>
  <p:sldId id="256" r:id="rId2"/>
  <p:sldId id="258" r:id="rId4"/>
  <p:sldId id="257" r:id="rId3"/>
</p:sldIdLst>
```

### Deleting a Slide

1. Remove the `<p:sldId>` entry from `ppt/presentation.xml`
2. Remove the relationship from `ppt/_rels/presentation.xml.rels`
3. Remove the Override from `[Content_Types].xml`
4. Delete `ppt/slides/slideN.xml` and `ppt/slides/_rels/slideN.xml.rels`
5. Update `docProps/app.xml` slide count (if present)
6. Clean up orphaned media from `ppt/media/`

### Adding a Slide to Existing PPTX

1. Create `ppt/slides/slideN.xml` with content
2. Add Override to `[Content_Types].xml`
3. Add relationship to `ppt/_rels/presentation.xml.rels`
4. Add `<p:sldId>` to `ppt/presentation.xml`
5. Create `ppt/slides/_rels/slideN.xml.rels` linking to slide layout
6. Update `docProps/app.xml` slide count

Read the full OOXML reference for XML schemas:
```
references/ooxml-reference.md
```

---

## Generating Thumbnails / PDF

Convert PPTX to images or PDF for preview:

```bash
# PPTX → PDF (requires LibreOffice)
soffice --headless --convert-to pdf presentation.pptx

# PDF → slide images (requires poppler-utils)
pdftoppm -jpeg -r 150 presentation.pdf slide
# Creates slide-1.jpg, slide-2.jpg, etc.
```

---

## Design Quick Reference

Full design guide:
```
references/design-principles.md
```

### Typography Minimums

| Element | Size | Weight |
|---------|------|--------|
| Cover title | 40–48pt | Bold |
| Slide title | 32–36pt | Bold |
| Subtitle | 20–24pt | Regular |
| Body / bullets | 20–24pt | Regular |
| Captions | 14–16pt | Regular |
| Data labels | 10–12pt | Regular |
| **Hard minimum** | **14pt** | — |

### Color Palette

Pick ONE palette and use consistently:

| Palette | Colors (no `#` prefix) |
|---------|----------------------|
| **Corporate Blue** | `4472C4`, `2E5090`, `ED7D31`, `A5A5A5`, `FFC000` |
| **Dark Modern** | `1a1a2e`, `16213e`, `0f3460`, `e94560`, `f5f5f5` |
| **Ocean** | `16A085`, `2C3E50`, `2980B9`, `8E44AD`, `F39C12` |
| **Minimal** | `2D3436`, `636E72`, `B2BEC3`, `DFE6E9`, `0984E3` |
| **Warm** | `2C3E50`, `E67E22`, `27AE60`, `8E44AD`, `C0392B` |

### Layout Rules

- Margins ≥ 0.5" on all sides (0.75" preferred)
- 1 idea per slide
- Max 5 bullet points per slide
- Max 75 words body text per slide
- ~50% white space per slide
- Left-align body text (center only titles/quotes)
- Consistent x-positions across slides

---

## Dependencies

| Package | Purpose | Install |
|---------|---------|---------|
| `pptxgenjs` | PPTX generation (slides, charts, tables) | `npm install -g pptxgenjs` |
| `playwright` | HTML rendering for screenshot-based slides | `npm install -g playwright` |
| `sharp` | SVG/gradient rasterization to PNG | `npm install -g sharp` |
| `markitdown[pptx]` | Text extraction from existing PPTX | `pip install "markitdown[pptx]"` |
| LibreOffice | PDF/image export (optional) | `brew install --cask libreoffice` |

**Install on failure only** — assume packages are available. Only install if `require()`/`import` fails.

---

## Gotchas

- **PptxGenJS colors: NO `#` prefix** — `'4472C4'` not `'#4472C4'`. The `#` corrupts the file.
- **Positions are in inches** — x, y, w, h are all inches from top-left corner.
- **HTML viewport must be 1280×720** for 16:9 — mismatched dimensions produce distorted slides.
- **CSS gradients don't transfer** to PPTX — pre-render as PNG with Sharp.
- **Custom fonts won't travel** — recipients may not have them. Stick to web-safe fonts.
- **File paths must be absolute** in PptxGenJS `path:` — always use `path.resolve()`.
- **Large images bloat the file** — resize to 1280×720 or smaller before embedding.
- **`writeFile()` is async** — always `await pptx.writeFile(...)`.
- **Chart data arrays must match** — labels and values arrays need the same length.
- **Speaker notes are plain text** — no formatting, no markdown.
- **Slide numbers use `{slideNumber}`** not an actual number — PptxGenJS substitutes at render.
- **OOXML element order matters** — `<a:bodyPr>` before `<a:lstStyle>` before `<a:p>` in `<p:txBody>`.
- **When repacking PPTX** — don't include hidden files (`.DS_Store`, etc.) in the ZIP.
- **macOS Playwright** — use `{ channel: 'chrome' }` if Chromium has issues; Chrome is more reliable on macOS.

---

## Output Formats

The generated `.pptx` opens in:
- Microsoft PowerPoint (Windows/Mac)
- LibreOffice Impress
- Google Slides (import)
- Apple Keynote (import)
- PowerPoint Online (upload)
