# PptxGenJS API Quick Reference

Quick reference for the PptxGenJS library. Full docs: https://gitbrent.github.io/PptxGenJS/

## Presentation Setup

```javascript
const PptxGenJS = require('pptxgenjs');
const pptx = new PptxGenJS();

pptx.layout = 'LAYOUT_16x9';    // 10" × 5.625"
// Other layouts: 'LAYOUT_4x3' (10" × 7.5"), 'LAYOUT_16x10' (10" × 6.25"), 'LAYOUT_WIDE' (13.33" × 7.5")

// Metadata
pptx.author = 'Author Name';
pptx.title = 'Presentation Title';
pptx.subject = 'Subject';
pptx.company = 'Company';

// Custom layout
pptx.defineLayout({ name: 'CUSTOM', width: 12, height: 7 });
pptx.layout = 'CUSTOM';
```

## Slide Masters

Define reusable slide templates:

```javascript
pptx.defineSlideMaster({
  title: 'BRANDED',
  background: { color: 'FFFFFF' },
  objects: [
    // Bottom bar
    { rect: { x: 0, y: 6.9, w: '100%', h: 0.4, fill: { color: '4472C4' } } },
    // Logo
    { image: { x: 0.3, y: 0.2, w: 1.2, h: 0.4, path: '/path/to/logo.png' } },
    // Slide number
    { text: { text: 'Slide {slideNumber}', options: { x: 8.5, y: 6.95, w: 1.5, fontSize: 10, color: 'FFFFFF' } } }
  ]
});

// Use master
const slide = pptx.addSlide({ masterName: 'BRANDED' });
```

## Adding Slides

```javascript
const slide = pptx.addSlide();
const slide = pptx.addSlide({ masterName: 'MASTER_NAME' });

// Slide background
slide.background = { color: '1a1a2e' };
slide.background = { path: '/absolute/path/image.png' };
slide.background = { data: 'data:image/png;base64,...' };
```

## Text

```javascript
// Simple text
slide.addText('Hello World', {
  x: 1, y: 1, w: 8, h: 1,
  fontSize: 24,
  color: '333333',
  fontFace: 'Arial',
  bold: true,
  italic: false,
  underline: false,
  align: 'left',      // 'left' | 'center' | 'right' | 'justify'
  valign: 'top',      // 'top' | 'middle' | 'bottom'
  lineSpacing: 28,    // in points
  paraSpaceAfter: 6,  // points after paragraph
  rotate: 0           // degrees
});

// Rich text (multiple formats in one box)
slide.addText([
  { text: 'Bold text ', options: { bold: true, fontSize: 24 } },
  { text: 'and normal text', options: { fontSize: 24 } },
  { text: '\nNew line with color', options: { color: 'FF0000', fontSize: 20 } }
], { x: 1, y: 1, w: 8, h: 2 });

// Bullet list
slide.addText([
  { text: 'First point\n', options: { bullet: true, fontSize: 20 } },
  { text: 'Second point\n', options: { bullet: true, fontSize: 20 } },
  { text: 'Sub-point\n', options: { bullet: true, indentLevel: 1, fontSize: 18 } },
  { text: 'Third point', options: { bullet: true, fontSize: 20 } }
], { x: 0.8, y: 1.5, w: 8.4, h: 4, color: '333333' });

// Numbered list
slide.addText([
  { text: 'Step one\n', options: { bullet: { type: 'number' }, fontSize: 20 } },
  { text: 'Step two\n', options: { bullet: { type: 'number' }, fontSize: 20 } },
  { text: 'Step three', options: { bullet: { type: 'number' }, fontSize: 20 } }
], { x: 0.8, y: 1.5, w: 8.4, h: 3 });

// Hyperlink
slide.addText([
  { text: 'Click here', options: { hyperlink: { url: 'https://example.com' }, color: '0563C1', underline: true } }
], { x: 1, y: 1, w: 4, h: 0.5 });
```

## Shapes

```javascript
// Rectangle
slide.addShape(pptx.ShapeType.rect, {
  x: 1, y: 1, w: 4, h: 2,
  fill: { color: '4472C4' },
  line: { color: '2E5090', width: 2 },
  rectRadius: 0.2  // rounded corners (inches)
});

// Line
slide.addShape(pptx.ShapeType.line, {
  x: 1, y: 1, w: 4, h: 0,
  line: { color: 'CCCCCC', width: 1, dashType: 'dash' }
});

// Common shapes: rect, ellipse, triangle, line, roundRect, plus, star5, star6, cloud, heart
```

## Images

```javascript
// From file (absolute path)
slide.addImage({ path: '/absolute/path/to/image.png', x: 1, y: 1, w: 4, h: 3 });

// From base64
slide.addImage({ data: 'data:image/png;base64,iVBOR...', x: 1, y: 1, w: 4, h: 3 });

// From URL (requires network access)
slide.addImage({ path: 'https://example.com/image.png', x: 1, y: 1, w: 4, h: 3 });

// Sizing options
slide.addImage({ path: img, x: 1, y: 1, w: 4, h: 3, sizing: { type: 'contain', w: 4, h: 3 } });
// sizing.type: 'contain' | 'cover' | 'crop'
```

## Charts

**⚠️ Colors use hex WITHOUT `#` prefix — `'4472C4'` not `'#4472C4'`**

### Bar / Column

```javascript
slide.addChart(pptx.charts.BAR, [{
  name: 'Series 1',
  labels: ['Cat A', 'Cat B', 'Cat C', 'Cat D'],
  values: [4500, 5500, 6200, 7100]
}], {
  x: 0.5, y: 1, w: 9, h: 4.5,
  showValue: true,
  valueFontSize: 10,
  catAxisLabelFontSize: 12,
  valAxisLabelFontSize: 10,
  chartColors: ['4472C4'],
  showLegend: false,
  barDir: 'col',        // 'bar' (horizontal) or 'col' (vertical, default)
  barGrouping: 'clustered'  // 'clustered' | 'stacked' | 'percentStacked'
});
```

### Line

```javascript
slide.addChart(pptx.charts.LINE, [
  { name: 'Product A', labels: ['Q1','Q2','Q3','Q4'], values: [10, 20, 30, 40] },
  { name: 'Product B', labels: ['Q1','Q2','Q3','Q4'], values: [15, 25, 20, 35] }
], {
  x: 0.5, y: 1, w: 9, h: 4.5,
  chartColors: ['4472C4', 'ED7D31'],
  showLegend: true,
  legendPos: 'b',
  lineDataSymbol: 'circle',
  lineDataSymbolSize: 8
});
```

### Pie / Doughnut

```javascript
slide.addChart(pptx.charts.PIE, [{
  name: 'Market Share',
  labels: ['Product A', 'Product B', 'Other'],
  values: [45, 35, 20]
}], {
  x: 2, y: 1, w: 6, h: 4.5,
  showPercent: true,
  showLegend: true,
  legendPos: 'r',
  chartColors: ['4472C4', 'ED7D31', 'A5A5A5']
});
// For doughnut: pptx.charts.DOUGHNUT (same API)
```

### Area

```javascript
slide.addChart(pptx.charts.AREA, [{
  name: 'Growth',
  labels: ['Jan','Feb','Mar','Apr','May','Jun'],
  values: [10, 15, 22, 28, 35, 42]
}], {
  x: 0.5, y: 1, w: 9, h: 4.5,
  chartColors: ['4472C4'],
  opacity: 50  // 0-100
});
```

### Chart Axis Options

```javascript
{
  showCatAxisTitle: true,
  catAxisTitle: 'Quarter',
  showValAxisTitle: true,
  valAxisTitle: 'Revenue ($M)',
  catAxisLabelFontSize: 11,
  valAxisLabelFontSize: 11,
  valAxisMinVal: 0,
  valAxisMaxVal: 100,
  showGridlines: true,
  catGridLine: { style: 'none' }
}
```

## Tables

```javascript
// Simple table
slide.addTable([
  ['Header 1', 'Header 2', 'Header 3'],
  ['Data 1', 'Data 2', 'Data 3'],
  ['Data 4', 'Data 5', 'Data 6']
], {
  x: 0.5, y: 1.5, w: 9,
  border: { pt: 1, color: 'CCCCCC' },
  colW: [3, 3, 3],
  fontSize: 14,
  align: 'center',
  valign: 'middle'
});

// Styled table with custom header
slide.addTable([
  [
    { text: 'Metric', options: { fill: { color: '4472C4' }, color: 'FFFFFF', bold: true, fontSize: 14 } },
    { text: 'Value', options: { fill: { color: '4472C4' }, color: 'FFFFFF', bold: true, fontSize: 14 } },
    { text: 'Change', options: { fill: { color: '4472C4' }, color: 'FFFFFF', bold: true, fontSize: 14 } }
  ],
  [
    { text: 'Revenue', options: { fill: { color: 'F2F2F2' } } },
    { text: '$5.2M', options: { fill: { color: 'F2F2F2' } } },
    { text: '+15%', options: { fill: { color: 'F2F2F2' }, color: '2E7D32' } }
  ],
  ['Users', '125K', '+22%'],
  [
    { text: 'NPS', options: { fill: { color: 'F2F2F2' } } },
    { text: '72', options: { fill: { color: 'F2F2F2' } } },
    { text: '+5', options: { fill: { color: 'F2F2F2' }, color: '2E7D32' } }
  ]
], {
  x: 1, y: 1.5, w: 8,
  border: { pt: 1, color: 'E0E0E0' },
  colW: [3, 2.5, 2.5],
  rowH: [0.5, 0.45, 0.45, 0.45],
  fontSize: 13
});

// Merged cells
[{ text: 'Spanning Header', options: { colspan: 3, fill: { color: '4472C4' }, color: 'FFFFFF' } }]
```

## Table Options

| Option | Type | Description |
|--------|------|-------------|
| `x, y, w, h` | number | Position and size (inches) |
| `colW` | number[] | Column widths |
| `rowH` | number[] | Row heights |
| `border` | object | `{ pt: number, color: string }` |
| `fill` | object | `{ color: string }` (cell level) |
| `align` | string | `'left'`, `'center'`, `'right'` |
| `valign` | string | `'top'`, `'middle'`, `'bottom'` |
| `fontSize` | number | Text size |
| `fontFace` | string | Font name |
| `autoPage` | boolean | Auto-create new slides if overflow |

## Speaker Notes

```javascript
slide.addNotes('Speaker notes for this slide.\nSupports newlines.');
```

## Slide Numbers

```javascript
slide.slideNumber = { x: 9.2, y: 6.9, fontSize: 10, color: '999999' };
```

## Writing Output

```javascript
// Write to file
await pptx.writeFile({ fileName: 'output.pptx' });

// Write to specific path
await pptx.writeFile({ fileName: '/path/to/output.pptx' });

// Get as buffer (Node.js)
const buffer = await pptx.write({ outputType: 'nodebuffer' });
```

## Color Palettes

Professional palettes ready to use (no `#` prefix):

**Corporate Blue:**
`4472C4`, `2E5090`, `ED7D31`, `A5A5A5`, `FFC000`, `5B9BD5`

**Dark Modern:**
`1a1a2e`, `16213e`, `0f3460`, `e94560`, `f5f5f5`, `333333`

**Ocean:**
`16A085`, `2C3E50`, `2980B9`, `8E44AD`, `F39C12`, `E74C3C`

**Minimal:**
`2D3436`, `636E72`, `B2BEC3`, `DFE6E9`, `0984E3`, `00B894`

**Warm Professional:**
`2C3E50`, `E67E22`, `27AE60`, `8E44AD`, `C0392B`, `F39C12`
