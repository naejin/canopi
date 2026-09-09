# Canvas PDF encoder evaluation

Historical encoder comparison. Its candidate dimensions and downstream work describe the evaluation baseline, not current release status. See the [approved feature and validation record](canvas-pdf-validation.md) and [implementation guide](agent/canvas-pdf.md) for current behavior.

2026-09-09 · `canopi-4nzq` · foundation selected in `canopi-orpp` following the user’s instruction to complete the feature.

**Selected foundation:** use PDFKit 0.20.2 with Fontkit 2.0.4, embedded Noto fonts, vector PDF text/geometry, and a preview driven by the same shaping and physical page plan. This historical evidence supports the foundation used by the completed export feature. [ADR 0024](adr/0024-shared-canvas-pdf-export.md) remains the scope authority.

## Inspectable samples

- [PDFKit PDF](assets/canvas-pdf/pdfkit.pdf): overview and two detail sheets, with complete page legends and selectable multilingual text.
- [pdf-lib PDF](assets/canvas-pdf/pdf-lib.pdf): the identical fixture, including the observed font defects. This is a rejected comparison sample, not an export template.
- [PDFKit detail rendered without system fonts](assets/canvas-pdf/pdfkit-no-system-fonts.png), [pdf-lib detail without system fonts](assets/canvas-pdf/pdf-lib-no-system-fonts.png), and [shared-shaping preview](assets/canvas-pdf/preview-2.png).
- Machine evidence: [independent inspection](assets/canvas-pdf/inspection.json), [bundle and font assets](assets/canvas-pdf/assets.json), [PDFKit run](assets/canvas-pdf/pdfkit.json), [pdf-lib run](assets/canvas-pdf/pdf-lib.json), [full-font control](assets/canvas-pdf/pdf-lib-full.json), and [browser checks](assets/canvas-pdf/browser-checks.json).

The synthetic garden uses the existing zoom-calibration corpus's 6 × 6 grid and 4 m spacing. This isolated fixture uses simple circle, square and triangle markers; it does not claim to exercise every production Plant Symbol or the Canvas Runtime. Both encoders receive exactly the same derived page plan. It includes Latin accents, Cyrillic, Simplified Chinese, Japanese, Korean, a long Canonical Name, mixed scripts, combining accents, ligatures, multiplication signs and square metres. No real user Design is used.

The historical fixture geometry is: A4 portrait; 10 mm margins; a 145 mm detail canvas, 40 mm legend and 5 mm gutter; 10 pt legend text; 2.6 mm markers; 0.25 mm strokes; 1:100 detail scale; 1 m ground overlap. A 50 mm calibration line appears on every sheet. These inputs do not select the final paper, scale, typography, overlap or resource limits. Current paper sizes, fitting and approved defaults are documented in the implementation guide.

## Results

Linux headless Chromium 150.0.0.0 generated and downloaded the PDFs from a production Vite 6.4.1 build, using Node 22.22.0 for tooling. Poppler 24.02.0 independently inspected and rendered the downloads.

| Observation | PDFKit 0.20.2 | pdf-lib 1.17.1 + @pdf-lib/fontkit 1.1.1 |
| --- | --- | --- |
| Three-page PDF | 187,658 bytes | 181,990 bytes |
| Independent text extraction | All tested names/scripts preserved | All tested names/scripts preserved |
| Embedded fonts | Four embedded subsets, Unicode maps, no reader diagnostics | Reader reports invalid embedded font files; CJK rendering depends on system substitution |
| Rendering with no system font directories | Identical PNG bytes to normal PDFKit render | CJK text disappears |
| Maximum width difference from shared shaping | Less than 0.000000000001 pt | 2.90 pt |
| Cold generation; median of next three runs | 352 ms; 299 ms | 519 ms; 398 ms |
| Encoder + shared preview font code, minified / gzip | 537,959 / 216,593 bytes | 1,513,750 / 660,268 bytes |

pdf-lib's encoder alone is 1,150,551 bytes minified / 509,700 gzip; its older Fontkit fork is separate from the shared Fontkit 2 preview. The table includes each candidate's required module graph, deduplicated, but excludes the fixture harness and font files. Gzip totals sum separately compressed files; actual delivery depends on server compression and cache state. Neither candidate needed Node browser polyfills in the tested Vite build. The ordinary large-chunk build warning remains visible.

These are four sequential generations per candidate, with the first treated as cold and the next three as warm. They exclude font acquisition, layout/preview preparation and lazy encoder import. Font acquisition from the local server took about one second, which is not a public-network benchmark. Repeated page reloads shared a browser process, and garbage collection was uncontrolled. Observed JS heap readings ranged from approximately 97–159 MB around PDFKit's runs and 178–383 MB around pdf-lib's runs; these are sampled before/after values, not isolated peaks, total browser memory, leak evidence or production budgets.

Disabling pdf-lib font subsetting was also tested once. The resulting PDF was **41,868,652 bytes** and took about **5.35 seconds** to generate. Poppler still reported a mismatch between font type and embedded font file. That control does not justify carrying full fonts inside every exported document. Its metrics are retained; the 42 MB control PDF is not checked into the repository.

The pdf-lib finding applies to these exact pinned libraries and font files. It is enough to reject this combination for the first implementation; it does not establish that every pdf-lib font or PDF fails. Repairing its font embedding or substituting another font format would be separate investigation.

## Why preview must share shaping

An initial Canvas2D `measureText()` preview differed from PDFKit by 0.50 pt for the Japanese name ローズマリー, despite using the same font bytes. pdf-lib differed by up to 2.90 pt in the kerning/ligature probe. Same font files alone do not guarantee the same shaping.

The final evaluation shapes text with Fontkit 2, measures its advances, and draws its glyph outlines in the preview. PDFKit uses the same Fontkit version with explicit features and the same lines, font sizes and positions. Every measured line now matches PDFKit to floating-point precision. Poppler independently reports the Japanese word at 59.50 pt in the actual PDF, agreeing with the preview and encoder. The PDF still contains embedded, selectable text; only the Canvas2D preview paints glyph outlines.

Both PDFs contain three independently verified A4 page boxes and three 50 mm vector calibration segments. No image XObjects are present. This validates encoded geometry, not printer-driver scaling. Users still need actual-size printing; a real ruler/print check belongs to `canopi-h0q3`.

## Font assets and coverage

The exact upstream revisions and SHA-256 values are pinned in [fonts.json](../scripts/pdf-evaluation/fonts.json). The evaluation downloads the original files and their licenses; it does not add them to the app bundle.

| Font | Embedded version | Source bytes |
| --- | --- | --- |
| Noto Sans Regular, static TTF | 2.008 | 569,208 |
| Noto Sans CJK SC Regular, OTF | 2.004 | 16,437,364 |
| Noto Sans CJK JP Regular, OTF | 2.004 | 16,467,736 |
| Noto Sans CJK KR Regular, OTF | 2.004 | 16,433,112 |

All four files total **49,907,420 bytes** before transport compression. PDF subsetting reduces document size, not these source download costs. The Latin file is a deliberately pinned static reference from the archived Noto distribution, not a claim that it is the latest Noto Sans release. Any font upgrade or source-subsetting step must repeat the same checks. The regional CJK files preserve a route to language-appropriate glyphs; this fixture is not native-speaker verification of every regional form.

Recommendation: keep font assets in the static edition package, acquire only the families needed by actual text, cache them for the export lifetime, and retain their licenses. Latin-only output should not fetch CJK files. Locale helps choose regional Han forms; Kana/Hangul and mixed-script Annotations also matter. The production asset and resource policy is recorded in the implementation guide; this comparison did not evaluate source sharding/WOFF. No system-font fallback should silently alter names or metrics.

The source-font glyph guard initially rejected generated left/right arrow characters absent from the Latin reference font. The fixture now uses plain Next/Previous navigation text. All final fixture code points pass; U+10FFFF is correctly rejected by every reference font. A simulated missing Japanese font returned an explicit HTTP 404 error, kept download disabled, published no report, and removed all loaded preview fonts and object URLs. This is a bounded fixture check; production must apply its own explicit unsupported-text/error policy.

PDFKit, both Fontkit packages, pdf-lib and Vite report MIT licenses in the pinned packages. The font sources carry SIL OFL 1.1; the fetcher retains the upstream license text. [PDFKit's browser API](https://pdfkit.org/docs/getting_started.html), [pdf-lib custom font API](https://pdf-lib.js.org/docs/api/classes/pdfdocument#embedfont), [Noto CJK formats](https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/README.md) and the [pinned font license](https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/LICENSE) support the evaluated integration paths.

## Delivery and subsequent adoption

Both candidates produced PDF Blobs whose downloaded hashes matched the generated
bytes. The fixture cleaned up temporary anchors, URLs and preview fonts. These
checks evaluated the encoders, not Design Session or native save behavior.

Decision `canopi-orpp` adopted PDFKit and shared Fontkit shaping after the
[native foundation probe](canvas-pdf-native-verification.md) passed on Linux,
both macOS architectures and Windows. The current feature, approved defaults and
production evidence live in [ADR 0024](adr/0024-shared-canvas-pdf-export.md), the
[implementation guide](agent/canvas-pdf.md) and [validation record](canvas-pdf-validation.md).
The former native snapshot-PDF command is retired; production delivery saves shared
PDF bytes without re-rendering. This historical fixture remains isolated and does
not define current layout, resource limits or release work.

Reproduce this fixed comparison using the [agent evaluation guide](agent/canvas-pdf-evaluation.md).
