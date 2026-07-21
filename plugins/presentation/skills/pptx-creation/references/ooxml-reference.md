# Office Open XML (OOXML) Reference for PowerPoint

Technical reference for reading and editing `.pptx` files at the XML level.

A `.pptx` file is a ZIP archive containing XML files following the Office Open XML (OOXML) standard.

## File Structure

```
presentation.pptx (ZIP archive)
├── [Content_Types].xml           # Declares all parts and their MIME types
├── _rels/
│   └── .rels                     # Top-level relationships
├── ppt/
│   ├── presentation.xml          # Slide order, layout, masters
│   ├── _rels/
│   │   └── presentation.xml.rels # Links slides, masters, themes
│   ├── slides/
│   │   ├── slide1.xml            # Slide 1 content
│   │   ├── slide2.xml            # Slide 2 content
│   │   └── _rels/
│   │       ├── slide1.xml.rels   # Slide 1 relationships (images, layout)
│   │       └── slide2.xml.rels
│   ├── slideMasters/
│   │   └── slideMaster1.xml      # Master slide template
│   ├── slideLayouts/
│   │   ├── slideLayout1.xml      # Title Slide layout
│   │   ├── slideLayout2.xml      # Title and Content layout
│   │   └── ...                   # More layouts
│   ├── theme/
│   │   └── theme1.xml            # Theme colors, fonts, effects
│   ├── media/
│   │   ├── image1.png            # Embedded images
│   │   └── image2.jpg
│   └── notesSlides/
│       ├── notesSlide1.xml       # Speaker notes for slide 1
│       └── ...
├── docProps/
│   ├── app.xml                   # Slide count, statistics
│   └── core.xml                  # Author, title, dates
```

## Key XML Namespaces

```xml
xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
```

## Slide Structure

### Basic Slide

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr/>
      <!-- Shapes, text boxes, images go here -->
    </p:spTree>
  </p:cSld>
</p:sld>
```

### Text Box / Shape with Text

```xml
<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="2" name="Title"/>
    <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
    <p:nvPr><p:ph type="ctrTitle"/></p:nvPr>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="838200" y="365125"/>     <!-- Position in EMU -->
      <a:ext cx="7772400" cy="1470025"/> <!-- Size in EMU -->
    </a:xfrm>
  </p:spPr>
  <p:txBody>
    <a:bodyPr/>      <!-- MUST come first -->
    <a:lstStyle/>    <!-- MUST come second -->
    <a:p>            <!-- Paragraphs come last -->
      <a:r>
        <a:rPr lang="en-US" sz="2400" b="1" dirty="0"/>
        <a:t>Slide Title</a:t>
      </a:r>
    </a:p>
  </p:txBody>
</p:sp>
```

**⚠️ Element order in `<p:txBody>` is mandatory**: `<a:bodyPr>` → `<a:lstStyle>` → `<a:p>`. Wrong order = corrupt file.

### Units: EMU (English Metric Units)

All positions and sizes in OOXML use EMU:

| Unit | EMU Value |
|------|-----------|
| 1 inch | 914400 |
| 1 cm | 360000 |
| 1 point | 12700 |
| 1 pixel (96 DPI) | 9525 |

Font sizes use hundredths of a point: `sz="2400"` = 24pt.

## Text Formatting

```xml
<!-- Bold -->
<a:r><a:rPr b="1"/><a:t>Bold</a:t></a:r>

<!-- Italic -->
<a:r><a:rPr i="1"/><a:t>Italic</a:t></a:r>

<!-- Underline -->
<a:r><a:rPr u="sng"/><a:t>Underlined</a:t></a:r>

<!-- Font, size, color -->
<a:r>
  <a:rPr lang="en-US" sz="2400" dirty="0">
    <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
    <a:latin typeface="Arial"/>
  </a:rPr>
  <a:t>Red Arial 24pt</a:t>
</a:r>

<!-- Highlight -->
<a:r>
  <a:rPr>
    <a:highlight><a:srgbClr val="FFFF00"/></a:highlight>
  </a:rPr>
  <a:t>Highlighted</a:t>
</a:r>
```

**Note:** Add `dirty="0"` to `<a:rPr>` and `<a:endParaRPr>` to indicate clean state.

### Whitespace

Add `xml:space="preserve"` to `<a:t>` elements with leading/trailing spaces:

```xml
<a:t xml:space="preserve"> text with spaces </a:t>
```

## Lists

```xml
<!-- Bullet list -->
<a:p>
  <a:pPr lvl="0"><a:buChar char="•"/></a:pPr>
  <a:r><a:t>First bullet</a:t></a:r>
</a:p>

<!-- Numbered list -->
<a:p>
  <a:pPr lvl="0"><a:buAutoNum type="arabicPeriod"/></a:pPr>
  <a:r><a:t>First item</a:t></a:r>
</a:p>

<!-- Nested (level 1) -->
<a:p>
  <a:pPr lvl="1"><a:buChar char="•"/></a:pPr>
  <a:r><a:t>Sub-bullet</a:t></a:r>
</a:p>
```

## Shapes

```xml
<!-- Rectangle with fill and border -->
<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="3" name="Rectangle"/>
    <p:cNvSpPr/><p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="1000000" y="1000000"/>
      <a:ext cx="3000000" cy="2000000"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
    <a:ln w="25400">
      <a:solidFill><a:srgbClr val="2E5090"/></a:solidFill>
    </a:ln>
  </p:spPr>
</p:sp>
```

Common preset geometry values (`prst`): `rect`, `roundRect`, `ellipse`, `triangle`, `line`, `plus`, `star5`, `star6`, `cloud`, `heart`.

## Images

```xml
<p:pic>
  <p:nvPicPr>
    <p:cNvPr id="4" name="Picture"/>
    <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
    <p:nvPr/>
  </p:nvPicPr>
  <p:blipFill>
    <a:blip r:embed="rId2"/>  <!-- References image in _rels file -->
    <a:stretch><a:fillRect/></a:stretch>
  </p:blipFill>
  <p:spPr>
    <a:xfrm>
      <a:off x="500000" y="500000"/>
      <a:ext cx="5000000" cy="3000000"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
  </p:spPr>
</p:pic>
```

Image must be referenced in the slide's relationship file (`_rels/slideN.xml.rels`):

```xml
<Relationship Id="rId2"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
  Target="../media/image1.png"/>
```

## Tables

```xml
<p:graphicFrame>
  <p:nvGraphicFramePr>
    <p:cNvPr id="5" name="Table"/>
    <p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>
    <p:nvPr/>
  </p:nvGraphicFramePr>
  <p:xfrm>
    <a:off x="1000000" y="1000000"/>
    <a:ext cx="6000000" cy="2000000"/>
  </p:xfrm>
  <a:graphic>
    <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
      <a:tbl>
        <a:tblGrid>
          <a:gridCol w="3000000"/>
          <a:gridCol w="3000000"/>
        </a:tblGrid>
        <a:tr h="500000">
          <a:tc>
            <a:txBody>
              <a:bodyPr/><a:lstStyle/>
              <a:p><a:r><a:t>Cell 1</a:t></a:r></a:p>
            </a:txBody>
          </a:tc>
          <a:tc>
            <a:txBody>
              <a:bodyPr/><a:lstStyle/>
              <a:p><a:r><a:t>Cell 2</a:t></a:r></a:p>
            </a:txBody>
          </a:tc>
        </a:tr>
      </a:tbl>
    </a:graphicData>
  </a:graphic>
</p:graphicFrame>
```

## Speaker Notes

Speaker notes live in `ppt/notesSlides/notesSlide1.xml`:

```xml
<p:notes>
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>...</p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Notes Placeholder"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          <a:p><a:r><a:t>Speaker notes text here.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>
```

Reference from slide's `_rels` file:

```xml
<Relationship Id="rId3"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"
  Target="../notesSlides/notesSlide1.xml"/>
```

## File Updates Checklist

When modifying a PPTX, update these files as needed:

| File | When to Update |
|------|---------------|
| `[Content_Types].xml` | Adding/removing slides, images, media |
| `ppt/_rels/presentation.xml.rels` | Adding/removing slides |
| `ppt/presentation.xml` | Changing slide order, adding/removing slides |
| `ppt/slides/_rels/slideN.xml.rels` | Adding images or notes to a slide |
| `docProps/app.xml` | Changing slide count |

## Common Errors

- **Wrong element order** in `<p:txBody>`: Must be `<a:bodyPr>` → `<a:lstStyle>` → `<a:p>`
- **Missing relationship**: Image referenced in slide XML but not in `_rels` file
- **Missing Content_Type**: New slide added but not declared in `[Content_Types].xml`
- **Invalid hex in colors**: Must be 6-digit hex without `#`: `val="FF0000"` not `val="#FF0000"`
- **Unicode characters**: Escape in ASCII content: `"` → `&#8220;`, `"` → `&#8221;`
- **Hidden files in ZIP**: `.DS_Store` or `__MACOSX/` folders corrupt the PPTX — exclude when zipping
- **Font embed references**: If not embedding fonts, remove `<a:font>` embed relationships
- **Duplicate note references**: After duplicating slides, multiple slides may reference the same notes file

## Validation

After editing, validate the PPTX:

1. Try opening in PowerPoint — it will report errors
2. Check `[Content_Types].xml` declares all parts that exist
3. Check all `_rels` files reference existing targets
4. Verify slide count in `ppt/presentation.xml` matches actual slide files
5. Ensure no orphaned media files in `ppt/media/`
