# HTML to PowerPoint Slide Guide

Design slides as HTML with full CSS control, then convert to PPTX via Playwright screenshots.

## Slide Dimensions

Every HTML slide must set fixed body dimensions matching the presentation aspect ratio:

| Aspect | Body Width | Body Height | Use Case |
|--------|-----------|------------|----------|
| **16:9** (default) | `1280px` | `720px` | Standard widescreen |
| **4:3** | `1024px` | `768px` | Legacy/print |
| **16:10** | `1280px` | `800px` | Tablet-friendly |

## HTML Template

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 1280px;
    height: 720px;
    overflow: hidden;
    font-family: Arial, Helvetica, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  body {
    display: flex;
    /* Layout varies per slide type */
  }
</style>
</head>
<body>
  <!-- Content -->
</body>
</html>
```

## Critical Rules

### Text Rules

- **Use web-safe fonts ONLY**: Arial, Helvetica, Georgia, Verdana, Tahoma, Trebuchet MS, Courier New
- ❌ Wrong: `'Segoe UI'`, `'SF Pro'`, `'Roboto'`, `'Inter'` — may not render on other systems
- Font sizes in CSS pixels map approximately to PowerPoint points at 1280×720 viewport
- Use `-webkit-font-smoothing: antialiased` for crisp text rendering in screenshots

### Background Rules

- **Solid colors**: Use CSS `background-color` directly — works fine
- **Gradient backgrounds**: Must be pre-rendered as PNG images (see Rasterization section below)
- **Image backgrounds**: Use absolute paths: `background: url('/absolute/path/bg.png') no-repeat center/cover`
- **Never use `linear-gradient()` or `radial-gradient()`** in CSS — they render in the browser but produce artifacts when screenshotted at certain DPIs

### Layout Rules

- Use `display: flex` on body — prevents margin collapse issues
- Use `overflow: hidden` — catches content overflow before it becomes a problem
- All content MUST fit within the body dimensions — no scrolling
- Use `padding` on body for margins (60–80px recommended)
- Use CSS Grid or Flexbox for slide layouts — they render precisely

### Image Rules

- All image `src` attributes must use **absolute paths** or **data URIs**
- Relative paths break when Playwright opens the file
- Pre-process images to fit the slide — don't rely on CSS scaling for large images
- For icons: rasterize SVGs to PNG before embedding (see Rasterization section)

## Slide Type Templates

### Title Slide

```html
<style>
  body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: #1a1a2e;
    color: #ffffff;
    padding: 80px;
    text-align: center;
  }
  h1 {
    font-size: 56px;
    font-weight: 700;
    letter-spacing: -0.5px;
    margin-bottom: 24px;
    line-height: 1.1;
  }
  .subtitle {
    font-size: 24px;
    color: rgba(255,255,255,0.6);
    font-weight: 400;
  }
  .accent-line {
    width: 80px;
    height: 4px;
    background: #e94560;
    margin: 32px auto;
    border-radius: 2px;
  }
</style>
<body>
  <h1>Presentation Title</h1>
  <div class="accent-line"></div>
  <p class="subtitle">Subtitle — Date or Context</p>
</body>
```

### Section Divider

```html
<style>
  body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: #0f3460;
    color: #ffffff;
    padding: 80px;
  }
  .section-number {
    font-size: 18px;
    letter-spacing: 4px;
    text-transform: uppercase;
    color: rgba(255,255,255,0.4);
    margin-bottom: 16px;
  }
  h2 {
    font-size: 48px;
    font-weight: 700;
    text-align: center;
  }
  .divider {
    width: 60px;
    height: 3px;
    background: #e94560;
    margin-top: 32px;
    border-radius: 2px;
  }
</style>
<body>
  <span class="section-number">Section 01</span>
  <h2>Key Findings</h2>
  <div class="divider"></div>
</body>
```

### Content Slide (Text + Visual)

```html
<style>
  body {
    display: flex;
    flex-direction: column;
    background: #ffffff;
    padding: 48px 80px;
  }
  h3 {
    font-size: 36px;
    font-weight: 700;
    color: #1a1a2e;
    margin-bottom: 32px;
  }
  .content {
    display: flex;
    gap: 48px;
    flex: 1;
  }
  .text-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .visual-col {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .bullet {
    display: flex;
    align-items: flex-start;
    margin-bottom: 20px;
  }
  .bullet-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #4472C4;
    margin-top: 8px;
    margin-right: 16px;
    flex-shrink: 0;
  }
  .bullet-text {
    font-size: 22px;
    color: #333333;
    line-height: 1.4;
  }
  .visual-placeholder {
    width: 100%;
    height: 360px;
    background: #f0f4f8;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #999;
    font-size: 18px;
  }
</style>
<body>
  <h3>Key Finding Title as Conclusion</h3>
  <div class="content">
    <div class="text-col">
      <div class="bullet"><div class="bullet-dot"></div><div class="bullet-text">First important point with brief explanation</div></div>
      <div class="bullet"><div class="bullet-dot"></div><div class="bullet-text">Second point highlighting key metric</div></div>
      <div class="bullet"><div class="bullet-dot"></div><div class="bullet-text">Third point with supporting evidence</div></div>
    </div>
    <div class="visual-col">
      <div class="visual-placeholder">Chart / Image / Diagram</div>
    </div>
  </div>
</body>
```

### Two-Column Comparison

```html
<style>
  body {
    display: flex;
    flex-direction: column;
    background: #ffffff;
    padding: 48px 80px;
  }
  h3 { font-size: 36px; font-weight: 700; color: #1a1a2e; margin-bottom: 32px; }
  .columns {
    display: flex;
    gap: 32px;
    flex: 1;
  }
  .column {
    flex: 1;
    border-radius: 16px;
    padding: 32px;
    display: flex;
    flex-direction: column;
  }
  .col-before { background: #fff5f5; border: 2px solid #fed7d7; }
  .col-after { background: #f0fff4; border: 2px solid #c6f6d5; }
  .col-label {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 20px;
    text-align: center;
  }
  .col-before .col-label { color: #c53030; }
  .col-after .col-label { color: #276749; }
  .col-item {
    font-size: 20px;
    color: #555;
    padding: 8px 0;
    border-bottom: 1px solid rgba(0,0,0,0.05);
  }
</style>
<body>
  <h3>Before vs. After Implementation</h3>
  <div class="columns">
    <div class="column col-before">
      <div class="col-label">Before</div>
      <div class="col-item">Manual 3-day process</div>
      <div class="col-item">15% error rate</div>
      <div class="col-item">No audit trail</div>
    </div>
    <div class="column col-after">
      <div class="col-label">After</div>
      <div class="col-item">Automated in &lt;1 hour</div>
      <div class="col-item">0.5% error rate</div>
      <div class="col-item">Full audit logging</div>
    </div>
  </div>
</body>
```

### Quote Slide

```html
<style>
  body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: #f8f9fa;
    padding: 80px 120px;
    text-align: center;
  }
  .quote-mark {
    font-size: 120px;
    color: #4472C4;
    font-family: Georgia, serif;
    line-height: 0.8;
    margin-bottom: 16px;
  }
  .quote-text {
    font-size: 32px;
    font-family: Georgia, serif;
    color: #2c3e50;
    line-height: 1.4;
    font-style: italic;
    max-width: 900px;
  }
  .attribution {
    margin-top: 32px;
    font-size: 18px;
    color: #888888;
    font-family: Arial, sans-serif;
  }
</style>
<body>
  <div class="quote-mark">"</div>
  <div class="quote-text">The best way to predict the future is to invent it.</div>
  <div class="attribution">— Alan Kay</div>
</body>
```

### Full-Bleed Image with Text Overlay

```html
<style>
  body {
    display: flex;
    align-items: flex-end;
    background: url('/absolute/path/to/image.jpg') no-repeat center/cover;
    padding: 0;
  }
  .overlay {
    width: 100%;
    padding: 48px 80px;
    background: linear-gradient(transparent, rgba(0,0,0,0.85));
  }
  h3 {
    font-size: 40px;
    font-weight: 700;
    color: #ffffff;
    margin-bottom: 8px;
  }
  p {
    font-size: 20px;
    color: rgba(255,255,255,0.7);
  }
</style>
<body>
  <div class="overlay">
    <h3>Big Visual Statement</h3>
    <p>Supporting context or caption</p>
  </div>
</body>
```

**Note:** The `linear-gradient` in the overlay div is acceptable here because it renders as part of the screenshot — it's not being extracted as a native PPTX element. This technique only fails when you try to parse HTML into native PowerPoint shapes.

### Metrics / KPI Dashboard

```html
<style>
  body {
    display: flex;
    flex-direction: column;
    background: #ffffff;
    padding: 48px 80px;
  }
  h3 { font-size: 32px; font-weight: 700; color: #1a1a2e; margin-bottom: 32px; }
  .metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 24px;
    flex: 1;
  }
  .metric-card {
    background: #f8f9fa;
    border-radius: 16px;
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .metric-value {
    font-size: 48px;
    font-weight: 700;
    color: #1a1a2e;
  }
  .metric-label {
    font-size: 16px;
    color: #888;
    margin-top: 8px;
  }
  .metric-change {
    font-size: 16px;
    font-weight: 600;
    margin-top: 12px;
    padding: 4px 12px;
    border-radius: 20px;
  }
  .positive { color: #27ae60; background: #e8f5e9; }
  .negative { color: #c0392b; background: #fde8e8; }
</style>
<body>
  <h3>All KPIs Trending Up This Quarter</h3>
  <div class="metrics">
    <div class="metric-card">
      <div class="metric-value">$7.1M</div>
      <div class="metric-label">Revenue</div>
      <div class="metric-change positive">+23%</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">125K</div>
      <div class="metric-label">Users</div>
      <div class="metric-change positive">+22%</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">94%</div>
      <div class="metric-label">Retention</div>
      <div class="metric-change positive">+5pp</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">72</div>
      <div class="metric-label">NPS</div>
      <div class="metric-change positive">+5</div>
    </div>
  </div>
</body>
```

## Rasterization Recipes

### Gradient Backgrounds

```javascript
import sharp from 'sharp';

async function createGradient(color1, color2, filename, opts = {}) {
  const { w = 1280, h = 720, angle = 135 } = opts;
  // Calculate gradient direction from angle
  const rad = (angle * Math.PI) / 180;
  const x2 = Math.round(50 + 50 * Math.cos(rad));
  const y2 = Math.round(50 + 50 * Math.sin(rad));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="${x2}%" y2="${y2}%">
        <stop offset="0%" style="stop-color:${color1}"/>
        <stop offset="100%" style="stop-color:${color2}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filename);
  return filename;
}

// Radial gradient
async function createRadialGradient(innerColor, outerColor, filename, opts = {}) {
  const { w = 1280, h = 720 } = opts;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <radialGradient id="g" cx="50%" cy="50%" r="70%">
        <stop offset="0%" style="stop-color:${innerColor}"/>
        <stop offset="100%" style="stop-color:${outerColor}"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filename);
  return filename;
}
```

### Icon Rasterization

```javascript
import sharp from 'sharp';

async function rasterizeIcon(svgString, size, filename) {
  await sharp(Buffer.from(svgString))
    .resize(size, size)
    .png()
    .toFile(filename);
  return filename;
}

// Simple shape icons via SVG
function circleIcon(color, size = 64) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="${color}"/>
  </svg>`;
}

function checkmarkIcon(color, size = 64) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="${color}"/>
  </svg>`;
}
```

## Overflow Validation

Before converting, check that content fits:

```javascript
const bodyDims = await page.evaluate(() => {
  const body = document.body;
  return {
    width: body.offsetWidth,
    height: body.offsetHeight,
    scrollWidth: body.scrollWidth,
    scrollHeight: body.scrollHeight
  };
});

if (bodyDims.scrollWidth > bodyDims.width || bodyDims.scrollHeight > bodyDims.height) {
  console.error(`⚠️ Content overflows: ${bodyDims.scrollWidth}×${bodyDims.scrollHeight} > ${bodyDims.width}×${bodyDims.height}`);
  // Fix the HTML before proceeding
}
```

## Performance Tips

- **Screenshot format**: PNG for text-heavy slides (sharp), JPEG for photo-heavy (smaller file)
- **Image resolution**: 1280×720 is sufficient — 2x (2560×1440) only if the deck will be displayed on 4K
- **Reuse browser instance**: Open Playwright once, reuse the page for all slides
- **Batch processing**: Generate all HTML files first, then screenshot them all in sequence
- **Cleanup**: Delete temporary PNG files after packaging into PPTX
