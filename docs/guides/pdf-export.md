# PDF export

Canvas PDF is a derived, printable view of a Design. It is identical on Linux, macOS, Windows and Web. The scope decision is [ADR 0008](../adr/0008-canvas-pdf-export.md): no map backgrounds in v2.0 and no network requests during export. Code lives in `desktop/web/src/app/canvas-pdf/` and `desktop/web/src/components/canvas-pdf/`.

## Acceptance behaviour

| Surface | Behaviour to preserve |
| --- | --- |
| Entry and delivery | File → Export to PDF (`file.exportCanvasPdf`) opens the full-window page workspace. Desktop saves through a dialog. Web downloads. Save is enabled only for the current complete document. |
| Print layers | Initially follow the visible printable Design layers. Overrides affect export only. Maps (basemap, satellite, LiDAR, terrain), Timeline, Budget and Consortium are never printed. |
| Printable content | Plants, pinned plant names, zones, annotations and persistent measurement guides. Group members print once. Interaction decorations are excluded. |
| Field sheets | Only explicitly drawn Print Areas or Whole design create detail pages. Clicking a zone never creates a page, and print setup never changes Design zones. |
| Area picker | Fits printable content and existing coverage independently of the printed overview framing. Clicking without dragging creates nothing. Cancel or Escape returns to the previous page unchanged. |
| Navigation | Thumbnails and the numbered overview coverage open the matching detail. Removing a detail removes its key pages. |
| Framing | Drag or keyboard displacement and zoom (1–1000 %, default 100 %) can crop. Fit restores full coverage and centring. Per-page orientation keeps framing. Screen inspection never changes print scale. |
| Readability | Authored plant appearance and positions are kept. Ambiguity resolves with print-only enclosures and Species Codes. Names, quantities and crowded notes continue in keys. The Design is never recoloured. |
| Zones and measurements | Zone interiors print transparent (a print-only rule). Stored guides keep their true distances. No spacing guides are synthesized. |
| Annotations | The overview prints only notes that fit. Other notes need a chosen detail covering them. Notes never create sheets or move into unrelated keys. |
| Splitting | Previews adjacent readable sheets and the page count. Apply commits, Cancel keeps the setup. The full requested rectangle is covered, including empty ground. |
| Lifecycle | Print setup is temporary Design Session state. It survives closing the preview and editing, rebuilds on reopen and is discarded on Design replacement. Missing selected layers require review. Export never dirties, saves or changes Design content, history or settings. |
| Physical scale | Pages are A4 or US Letter in a white print style independent of the app theme. The overview carries a labelled 50 mm calibration bar. Ground scale, zoom and screen inspection are separate quantities. |

Map export is deferred, not rejected. When it returns, it must settle provider-compatible acquisition, alignment and printed attribution, and a failed map export must offer Retry or Export without map. Re-evaluate GeoLibre map capture and print layout then (see [architecture](../architecture.md#geolibre-reuse-boundary)).

## Pipeline

- **Capture.** `CanvasQuerySurface.capturePrintSnapshot()` returns an owned, renderer-neutral projection of settled Scene state, or `null` while an edit owns the Scene. It never settles an edit or touches persistence. It captures symbol recipes, resolved colours and native zone primitives (polygon or rectangle corners, ellipse centre, radii and rotation) in session-plane metres. Maps, viewport decorations and selection never enter it.
- **Live composition.** `live.ts` composes capture, selected-language name resolution, the worker and the edition delivery adapter. It invalidates stale output and rebuilds on Scene, attachment, Design name or locale changes. A Design Session identity change cancels, closes and discards the setup. A catalog failure or the 30 s name lookup deadline falls back to canonical names.
- **Workflow.** `workflow.ts` owns temporary setup, cancellation, admission of current results and delivery status. A 100 ms refresh timer coalesces revisions and is cleared on rebuild, close, replacement and disposal. A busy Scene is retried when the settled source changes, with no polling loop. Layer selections override print inclusion without changing Scene visibility.
- **Layout.** `layout.ts` composes one page plan in PDF points. Field modules compute collision geometry in physical millimetres. `text.ts` shapes text with Fontkit and embedded Noto metrics, used for both the preview outlines and the PDF text. `encode.ts` replays the same plan through PDFKit into one document with named destinations. Never concatenate documents. No screenshot, print stylesheet, native renderer or system font takes part.
- **Worker.** A lazily imported inline Vite worker (`worker.ts`, `job.ts`) runs each shaping and encoding job. Progress messages carry preview-only plans, never exportable bytes. Cancellation, timeout, completion or error terminates the worker and releases fonts and caches. There is no persistent worker. `PdfLayoutCache` keeps only the current setup's unnumbered map and key pages. Its signatures cover content, names, measurement homes, geometry, key orientation and labels.
- **Preview.** `components/canvas-pdf/PdfPagePreview.tsx` renders shared SVG artwork from glyph outlines for the plain preview, thumbnails and page editor. Never replace it with browser text metrics. PDF text stays selectable.
- **Limits.** 200 pages per document, 120 s per job, 30 s per font or name wait, 64 MiB for native delivery.

## Layout model

- `PdfPrintArea` is a named temporary rectangle with a session id and ground bounds, independent of zones. At 100 % its exact ground extent fits a physical frame. `coverage.ts` owns fit, zoom and displacement. Automatic orientation maximizes usable scale, and exact squares use portrait. `addWholeDesign()` uses the fitted picker extent.
- `PdfSetup.views` stores zoom, ground-centre displacement (metres) and orientation by stable id (`overview`, `area:<id>`, `<source>:legend:<index>`), never by page number. Key pages inherit their source's orientation unless overridden.
- `split-sheets.ts` partitions a requested sheet along its longest ground axis, aiming for at most about 120 positions per part (2–32 parts). `splitPreview` is separate from committed `setup`. Export is unavailable while a proposal is under review.
- Each detail map gets a complete local key on the same sheet when it fits (`integrated-key.ts`). Otherwise automatic key and notes pages follow. The map may shift across spare paper, but its scale and coverage never change.
- `field-layout.ts` composes drawing, identification, annotations and dimensions. `field-identity.ts` chooses plain, circle, square or diamond enclosures only for local symbol and colour collisions. Occasional members and excess conflicts use the existing Species Code. Unique appearances stay plain. A code that cannot fit keeps coordinates in its key entry. P references are reserved for coincident placements. Positions closer than the 0.7 mm mark diameter keep coordinates.
- `field-placement.ts` reserves actual Fontkit ink and mark bounds. Its clear-path association checks are never printed as connectors. `field-annotations.ts` places 8.5–12 pt whole-word notes near the anchor, keeping rotation. Only notes that do not fit use an N reference.
- `field-dimensions.ts` draws dimensions from stored measurement guide endpoints and keeps the full distance when cropped. `zone-measurements.ts` derives sizes from real edges and diameters, never bounding boxes, and only native rectangles use the rectangle shortcut. `zone-ink.ts` interrupts zone outlines around text and never paints opaque erasers.
- The overview (`overview.ts`, `overview-guides.ts`, `overview-measurements.ts`) keeps every selected guide, groups repeated values per zone in a table, and paginates long dimension indexes into continuations. Overview annotations print only as complete text that fits with 2 mm clearance in at most two lines. There are no N markers or annotation lists on the overview.
- Sheet furniture (`page-furniture.ts`): 8 mm side margin, 26 mm header band plus zone summaries, 20 mm bottom clearance, Design title, detail number, counts, an actual-size reminder and a 1/2/5 ground scale. Plant marks keep colour, opacity and compact symbol recipes. Radii are capped at 0.8 mm (detail) and 1 mm (overview). Zones draw first in quiet neutral ink with no fill.
- Keys (`field-key.ts`) are compact. Compact keys use 8 pt semibold codes, 9.5 pt common names, 7.5 pt botanical names and 9 pt notes. Standalone keys use 10/8/9.5 pt. The code sits left of one enclosed sample. Keys have up to three columns and ruled observation space. Every appearance and count is represented.
- `layout.ts` assigns physical page numbers only after all continuations exist. `detailNumber` counts detail maps only.
- `field-geometry.ts` owns spatial indices, clipping and flattening of captured paths. PDF layout imports neither renderers nor runtime state.

## Print workspace

- `CanvasPdfDialog.tsx` mounts the shared full-window workspace in both editions, registered by `WorkspaceComposition`. It owns page selection, the Add field sheet and inspection modes, focus trapping and restoration, and the paper and layer controls.
- `PdfPageToolbar` edits the selected page through workflow commands only. `PdfPageRail` shows source pages and their continuations. Thumbnails materialize glyph SVGs only while visible (owned `IntersectionObserver`s, disconnected on unmount).
- `PdfPlan.pickerPage` is a separate fitted drawing surface for Add field sheet. It is never exported or counted.
- While a plan rebuilds, the workspace keeps the last displayed plan, marks it busy, disables framing input and clears exportable bytes. Each effective edit cancels the older job.

## Assets and delivery

- PDFKit 0.20.2 and Fontkit 2.0.4 are pinned in `desktop/web/package.json`. `app/canvas-pdf/font-assets.json` pins Noto Sans 2.008 (regular and semibold) and Noto Sans CJK 2.004 SC/JP/KR by URL and SHA-256.
- `npm run prepare:pdf-fonts` downloads or verifies the fonts and licences into ignored `desktop/web/public/pdf-fonts/`. It runs before dev, builds and tests. Valid cached files need no network. Both builds ship all five fonts (about 50 MB). The runtime loads only the fonts it needs from its own base URL and verifies their bytes.
- `#canvas-pdf-platform` selects delivery. Web clicks a Blob URL during the initiating gesture, then revokes it. Desktop uses the dialog and the executor-backed `save_canvas_pdf` command, which validates the payload (`%PDF-` … `%%EOF`, 64 MiB at most) and writes through operation-owned temporary-file replacement in the `Local` class. `save_canvas_pdf` is the only PDF command. PNG snapshot export is separate.
- The Tauri CSP allows same-app font fetches and blob workers (`worker-src 'self' blob:`).

## Verification

- `npx tsc --noEmit`, the focused `canvas-pdf-*` and `canvas-print-snapshot` tests and both builds. Shell or shared runtime changes need `npm test`. Changes to native delivery need the Rust gates and `native_command_policy::tests`. Run `npm run prepare:pdf-fonts` first when invoking Vitest directly.
- Production sample runner: `npm run build:pdf-validation` builds `desktop/web/scripts/pdf-validation/` against production modules into ignored `dist-pdf-validation/`. Serve it on loopback, then run `run-browser.py` (Playwright Python 1.58.0) and `verify.py` (Poppler and Pillow comparison of SVG previews with rendered PDF pages). Keep generated artifacts and any private `--input` Designs outside Git. Preview verifier tests: `python3 -m unittest discover -s desktop/web/scripts/pdf-validation -p 'test_*.py'`.
- `.github/workflows/pdf-production-probe.yml` runs that host in the desktop WebView engines through `scripts/pdf-native-webview/run.py` with explicit `--fixture` and `--script`. It covers the worker, CSP and fixed-path delivery, not the Tauri save dialog. Keep its push and pull-request path filters aligned.
- Encoder fixtures and screen checks are not printer tests. Physical readability and the 50 mm bar need paper evidence.
