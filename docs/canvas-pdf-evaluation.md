# Canvas PDF encoder evaluation

2026-09-09 · `canopi-4nzq` · foundation selected in `canopi-orpp` following the user’s instruction to complete the feature.

**Selected foundation:** use PDFKit 0.20.2 with Fontkit 2.0.4, embedded Noto fonts, vector PDF text/geometry, and a preview driven by the same shaping and physical page plan. This evidence supports the selected foundation; the export feature is being implemented. [ADR 0024](adr/0024-shared-canvas-pdf-export.md) remains the scope authority.

## Inspectable samples

- [PDFKit PDF](assets/canvas-pdf/pdfkit.pdf): overview and two detail sheets, with complete page legends and selectable multilingual text.
- [pdf-lib PDF](assets/canvas-pdf/pdf-lib.pdf): the identical fixture, including the observed font defects. This is a rejected comparison sample, not an export template.
- [PDFKit detail rendered without system fonts](assets/canvas-pdf/pdfkit-no-system-fonts.png), [pdf-lib detail without system fonts](assets/canvas-pdf/pdf-lib-no-system-fonts.png), and [shared-shaping preview](assets/canvas-pdf/preview-2.png).
- Machine evidence: [independent inspection](assets/canvas-pdf/inspection.json), [bundle and font assets](assets/canvas-pdf/assets.json), [PDFKit run](assets/canvas-pdf/pdfkit.json), [pdf-lib run](assets/canvas-pdf/pdf-lib.json), [full-font control](assets/canvas-pdf/pdf-lib-full.json), and [browser checks](assets/canvas-pdf/browser-checks.json).

The synthetic garden uses the existing zoom-calibration corpus's 6 × 6 grid and 4 m spacing. This isolated fixture uses simple circle, square and triangle markers; it does not claim to exercise every production Plant Symbol or the Canvas Runtime. Both encoders receive exactly the same derived page plan. It includes Latin accents, Cyrillic, Simplified Chinese, Japanese, Korean, a long Canonical Name, mixed scripts, combining accents, ligatures, multiplication signs and square metres. No real user Design is used.

All geometry is **provisional**: A4 portrait; 10 mm margins; a 145 mm detail canvas, 40 mm legend and 5 mm gutter; 10 pt legend text; 2.6 mm markers; 0.25 mm strokes; 1:100 detail scale; 1 m ground overlap. A 50 mm calibration line appears on every sheet. These inputs do not select the final paper, scale, typography, overlap or resource limits. Letter, landscape, dense/large Designs and physical paper review remain downstream work.

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

Recommendation: keep font assets in the static edition package, acquire only the families needed by actual text, cache them for the export lifetime, and retain their licenses. Latin-only output should not fetch CJK files. Locale helps choose regional Han forms; Kana/Hangul and mixed-script Annotations also matter. Further source sharding/WOFF evaluation and memory limits belong to the already planned resource work in `canopi-urxb`, with final asset choices recorded at the decision gate. No system-font fallback should silently alter names or metrics.

The source-font glyph guard initially rejected generated left/right arrow characters absent from the Latin reference font. The fixture now uses plain Next/Previous navigation text. All final fixture code points pass; U+10FFFF is correctly rejected by every reference font. A simulated missing Japanese font returned an explicit HTTP 404 error, kept download disabled, published no report, and removed all loaded preview fonts and object URLs. This is a bounded fixture check; production must apply its own explicit unsupported-text/error policy.

PDFKit, both Fontkit packages, pdf-lib and Vite report MIT licenses in the pinned packages. The font sources carry SIL OFL 1.1; the fetcher retains the upstream license text. [PDFKit's browser API](https://pdfkit.org/docs/getting_started.html), [pdf-lib custom font API](https://pdf-lib.js.org/docs/api/classes/pdfdocument#embedfont), [Noto CJK formats](https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/README.md) and the [pinned font license](https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/LICENSE) support the evaluated integration paths.

## Delivery and remaining platform evidence

Both candidates produced `application/pdf` Blobs and downloaded through a local browser anchor. SHA-256 checks prove the downloaded bytes match the generated bytes. Temporary anchors were removed and object URLs revoked; no URL remained after the cleanup delay. The evaluation never imports Design persistence, storage or save-acknowledgement code.

At the evaluation baseline, the native PDF export command accepted a PNG snapshot and a native layout; it could not deliver shared PDF bytes unchanged. The integrated feature now has compile-time edition delivery adapters: a native save dialog with executor-backed binary write, and a browser Blob download. Cancellation and I/O errors remain separate from Design save state. This isolated evaluation added no native command; current delivery ownership is described in the [implementation guide](agent/canvas-pdf.md).

The initial encoder comparison did **not** exercise desktop WebViews. The subsequent [native WebView gate](canvas-pdf-native-verification.md), tracked by `canopi-cd7x.1`, passed Linux WebKitGTK, both macOS architectures and Windows WebView2 before the foundation decision. The later [production validation report](canvas-pdf-validation.md) records integrated browser/native-host, text, resource and failure-path evidence, including the revised workspace. This fixture's limited line breaking and delivery checks remain historical. Physical prints, packaged Tauri save-dialog behavior and the report's remaining platform checks belong to `canopi-h0q3`, followed by `canopi-1zbj`; this evaluation does not close those release gates.

## Resolved choices in canopi-orpp

The user delegated completion of the feature after reviewing the native evidence. The implementation adopts these reviewed choices; physical defaults remain provisional until paper review:

| Choice | Resolution |
| --- | --- |
| Foundation | PDFKit 0.20.2 + Fontkit 2.0.4; the pinned Noto reference families, acquired by text coverage; vector PDF output and a shared shaped preview. Keep physical defaults provisional. |
| Empty output | Show a clear empty-preview explanation and disable export when there is neither printable content nor valid selected detail coverage. An intentionally selected blank Print Area may still print with its scale/navigation; an overview-only blank page may not. |
| Changed retained setup | Preserve valid choices and temporary Print Areas. Flag removed/unresolvable Zones or Layers and require review before export; do not silently reset or substitute them. Recompute geometry/names for resolvable current objects. Layers use names and Zones currently have no immutable IDs, so a rename must not be guessed from list position. |
| Exportable Design content | Plants and pinned names, Zone geometry and authored fills, Annotation text, and persistent Measurement Guides with distances, through their selected Design Layers. Group members render once. Screen grid, rulers, axis guides, selections, handles, lock cues, hover, and all maps remain absent. Selection-only derived Zone measurements need a separate explicit rule if ever requested. |
| One Species, several authored appearances | One Species heading/name with every distinct symbol/colour sample used on that page, wrapping samples or continuing the entry as needed. Preserve every authored appearance and full naming/overflow rules. Never choose a representative appearance that hides the others. |

The accepted default of visible exportable Layers, full Canonical Name fallback, unchanged Design presentation, complete legends and no map export applies throughout. The current source model and runtime query surfaces informed these choices; implementation is tracked in the delivery beads.

Reproduction and operating boundaries are in the [agent evaluation guide](agent/canvas-pdf-evaluation.md).
