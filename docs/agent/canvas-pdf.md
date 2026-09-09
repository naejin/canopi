# Canvas PDF

Canvas PDF exports are derived files. The Design Session and canvas retain ownership of authored content, history, dirty state, and save acknowledgement. See [ADR 0024](../adr/0024-shared-canvas-pdf-export.md) for product scope.

## Shared pipeline

- `CanvasQuerySurface.capturePrintSnapshot()` returns an owned renderer-neutral projection from settled Scene state, or `null` while an edit owns the Scene. It must never settle an edit, flush maintenance, or request the persistence role. Symbol recipes and resolved authored colors are captured inside the runtime; maps, viewport decorations, and selection state never enter the projection.
- `app/canvas-pdf/live.ts` composes capture, selected-language name resolution, the worker, and the edition delivery adapter. Its owned observation invalidates stale output and schedules an automatic rebuild on Scene, canvas attachment, Design name, or locale changes while the workspace is open. A Design Session identity change instead cancels the operation, closes the workspace and discards its setup. Catalog failure or a 30-second lookup deadline retains full canonical names. Closing/replacing the preview immediately releases the wait without disposing the shared catalog reader.
- `app/canvas-pdf/workflow.ts` owns temporary setup, cancellation, current-result admission, and delivery status. Its owned 100 ms refresh timer leaves the reactive observer before capturing, coalesces source revisions, and is cleared on rebuild, close, replacement and disposal. A busy Scene is retried when the settled-source observation changes; no polling loop is installed. Layer selections override print inclusion without changing Scene visibility. Closing releases results and the current job while retaining choices for the current Design. Reopening captures current content; missing Layer selections block preparation until explicitly reviewed. Replacing the Design discards setup. Export never calls Design persistence or marks a Design saved.
- `layout.ts` makes a page plan in PDF points (72 points/inch). `text.ts` uses Fontkit shaping and embedded Noto font metrics for both preview outlines and PDF text. `encode.ts` replays the same plan through PDFKit; no screenshot, browser print stylesheet, native renderer, or system font participates.
- A lazily imported inline Vite worker owns each shaping/encoding job. Termination releases its fonts, caches, and in-flight fetches on cancellation, timeout, completion, or error. Main-thread preview data contains only required glyph outlines and prepared PDF bytes.
- `components/canvas-pdf/PdfPagePreview.tsx` supplies shared SVG artwork to the plain preview, visible thumbnails and page editor. Do not replace the outline preview with browser text metrics; actual PDF text remains selectable.

## Assets and delivery

- Runtime dependencies are pinned to PDFKit 0.20.2 and Fontkit 2.0.4 after the [encoder evaluation](../canvas-pdf-evaluation.md). The browser-specific declarations describe only the used pinned surface; the legacy Node typings do not describe its named browser export accurately.
- `font-assets.json` pins Noto Sans 2.008 Latin and Noto Sans CJK 2.004 SC/JP/KR files by upstream URL and SHA-256. `npm run prepare:pdf-fonts` materializes ignored `public/pdf-fonts/` assets and licenses. Dev, builds, and the full test command run this prerequisite. Cached valid files work without upstream access; build packaging includes all four fonts (about 50 MB total). Runtime loads only required fonts from its own edition base URL and verifies their bytes.
- `#canvas-pdf-platform` is a compile-time edition alias. Browser delivery clicks a prepared PDF Blob URL during the initiating gesture and reports a download request, then releases the URL. Native delivery uses the dialog and executor-backed `save_canvas_pdf` command; the service validates the payload and writes the exact bytes through operation-owned temporary-file replacement. This path has no `.canopi` backup or persistence acknowledgement.
- Tauri CSP permits same-app font fetches and blob workers. Keep browser and native assets on the same shared pipeline. `npm run build:web` still enforces the browser boundary and per-asset hosting limits.

## Verification

Run TypeScript, focused `canvas-pdf-*` and `canvas-print-snapshot` tests, runtime settled-read coverage, and both builds. Shell or shared runtime changes require the full frontend suite. Native delivery changes require Rust formatting, Clippy, workspace check/tests and the native command policy guard. Real font tests need `npm run prepare:pdf-fonts` first when invoking Vitest directly.

The [native foundation evidence](../canvas-pdf-native-verification.md) covers the isolated chosen encoder in desktop WebViews. The [production validation report](../canvas-pdf-validation.md) and compact data record the current worker, browser delivery and native-host evidence. Packaged Tauri delivery and physical paper readability are separate checks; do not describe encoder fixtures or screen inspection as printer testing. Physical layout defaults remain provisional until the tracked print review is performed.

## Detail coverage

`PdfPrintArea` is a named rectangle with its own session ID and ground bounds. It is the sole detail coverage model; it has no Zone reference or shape discriminator. Each drawn Print Area produces one fitted canvas page. `coverage.ts` centres its full extent in the usable frame without added padding. At 100% before manual displacement, coverage contains the whole area without rounding down. Automatic orientation maximizes the fitted drawing scale beside the legend; exact squares use portrait. Zone selection, Zone-specific context padding, forced tiling, preset scales, overlap and neighbouring-sheet references are retired.

`PdfSetup.views` owns temporary zoom, ground-centre displacement in metres, and orientation by stable page ID (`overview`, `area:<id>`, and `<source>:legend:<index>`), not final page number. Zoom is a finite percentage from 1 to 1000, defaulting to 100 (full fit); values above 100 enlarge the view and lower values show more context. Manual displacement can also crop coverage. Orientation overrides refit the same area at its retained zoom and displacement. `fitPage()` resets zoom and displacement together. The overview also supports independent canvas zoom and includes detail coverage in its initial fit. Actual page scales feed the calibration bar; displayed ratios are approximate. The legend uses only Species visible in the resulting printed coverage.

`setPageView()` validates edits, ignores unchanged values and rebuilds through the existing cancellable workflow. Removing an area removes its page choices and continuation choices; replacement resets all choices. The workspace navigates by page ID, opens newly drawn pages, and retains only its last displayed plan while rebuilding to keep controls stable. That preview is marked busy and cannot be used for pointer or keyboard framing; the workflow clears exportable bytes immediately. Closing the workspace releases the cached plan. Zoom and orientation controls remain usable while preparing so a field blur does not swallow the next control action; each effective change cancels the older job. Temporary text inspection remains separate from printed canvas zoom.

Detail pages have page-specific Species legends. The overview becomes a navigation sheet without a duplicated legend when details exist. Page numbering, coverage outlines and legend links are assembled after continuation insertion. Continuations inherit their source orientation unless individually overridden; `legend.ts` reflows their columns without shrinking or losing names and authored appearances, including an entry spanning different orientations.

Both paper sizes retain the provisional 42 mm legend column, 10 mm margins, 10 pt legend text, 3 mm nominal legend symbols and 0.25 mm geometry strokes. Canvas marks are capped by 42% of nearest distinct planting spacing, with a provisional 0.35 mm radius floor; round marks below 0.8 mm radius are solid, and symbol strokes retain at least 0.12 mm on paper. Authored colours and non-round recipes remain unchanged. A setup is limited to 200 total pages including overview and continuations. Physical paper review and resource/default approval remain tracked separately.

Print Areas are named temporary rectangles in the PDF workflow and never create Zones. `PdfPageEditor` owns pointer capture, caches the SVG bounds at gesture start, previews movement through local SVG CSS variables, and commits one ground-space displacement or Print Area on completion. Escape, lost capture, pointer cancellation, mode/plan change and unmount cancel without changing setup. Pointer identity and release ordering are guarded. Arrow keys provide framing without dragging. Coordinates account for SVG fit whitespace. Blank Designs get an unexportable overview for drawing; explicit Print Areas provide printable fitted coverage. Print choices remain session-only and never dirty the Design.

## Text readability and retention

`canvas-text.ts` creates authored Annotation, Pinned Plant Name and Measurement
Guide text using the same shaped lines that are printed. `text.ts` includes actual
Fontkit glyph ink bounds, including offsets, accents and descenders. Rotated line
bounds receive 0.5 mm reading clearance. A readable text item fits completely inside
the page frame, clears other printed text and plant marks, and (for a distance) has
enough line length. Collision checks are symmetric: later overlapping text cannot
certify an earlier item as readable. These are layout checks, not a physical-print
readability approval.

Detail pages retain full text. The navigation overview defers a text item only when
at least one detail page prints it readably; deferred Annotations leave a quiet
anchor mark. Uncovered overview text remains printed. Crowded or partly clipped
text without a readable detail home yields `text-needs-detail` and no exportable
bytes until the user adds suitable detail coverage or chooses Keep text on overview.
The same review applies to an overview used alone. Explicit manual cropping may
exclude objects entirely; it does not certify partly clipped text as readable.

`PdfSetup.retainedTextKeys` records consent for each reviewed text value and authored
placement, never a blanket bypass. Changes to text, its position/rotation/size,
localized plant names, or measurement endpoints require a new choice when still
crowded. Removing or reframing details recomputes coverage. `retainCrowdedText()`
accepts only current prepared results; stale previews and in-flight rebuilds cannot
grant consent. Retention survives preview closure within the same Design Session
and resets with replacement. Both choices leave Scene state and `.canopi` untouched.

`canvas/plant-spacing.ts` and `canvas/label-collision.ts` are pure shared spatial
utilities. PDF layout does not depend on interactive renderers or runtime state.
`print-style.ts` holds provisional physical dimensions. `plant-marks.ts` controls
canvas mark radius; legend samples retain nominal dimensions. Preview and encoder
replay the same complete page operations after the readability decision.

## Print workspace

`CanvasPdfDialog.tsx` mounts the shared full-window workspace in both editions. It owns page selection, Add page and inspection modes, focus restoration/trapping, and the compact paper/Layer controls. Nested controls handle Escape locally. `PdfPageToolbar` edits the selected page through workflow commands; it never writes Scene state. `PdfPageRail` renders source pages and their linked continuations, preserving page cards while a plan rebuilds. Thumbnails use owned IntersectionObservers so only visible cards materialize their glyph SVGs; observers disconnect on unmount.

`PdfPlan.pickerPage` is a separate fitted drawing surface for Add page, computed from printable content and existing detail coverage. It does not enter `pages` or the exported page count and is never replayed by the encoder. It preserves the user's printed overview zoom and displacement. Add page focuses the drawing surface; Cancel or Escape returns to the previous page. The page rail remains available for navigation. Zone geometry is ordinary artwork on selected print Layers, with no extra hit targets, hover selection or search list. Clicking without dragging creates nothing; dragging over any artwork creates the requested Print Area. Zone edits refresh the artwork without changing Print Area identity or bounds.

The printed overview's interactive coverage targets derive from finalized detail-page ground bounds and stable IDs. Hovering/focusing a thumbnail highlights its source coverage; clicking an outline opens the matching detail. Overlay colours, selection rectangles, pointer state and magnification stay outside the physical page plan.

## Legend pagination

The fixed narrow column uses compact rows in both source sheets and continuations:
10 pt full names with 13 pt leading, 3 mm nominal samples, 0.8 mm between samples,
and a 1 mm sample/name gutter. Samples sit beside the first name line when their
combined width and gutter consume at most one third of the column. Otherwise all
samples wrap beneath the full-width name. Entries have a 2 pt trailing gap with a
fine neutral separator; wrapped names and appearance sets remain grouped.
These dimensions live in `print-style.ts` and remain provisional for field review.
The accepted compact comparison prototype and its development toggle are retired.

`legend.ts` lays out full selected-language names (canonical fallback) and every authored appearance at the shared readable size. The source sheet keeps an ordered prefix in its narrow column. Overflow blocks output until the user explicitly chooses Add legend pages or changes setup. Remove legend pages withdraws the setup-wide continuation consent. The rail groups continuations by source ID, and selection falls back to the source if reflow removes the current continuation. Accepted continuations use two columns, retain complete entries where they fit, and can continue an exceptionally long entry without shrinking it. Source and continuation links resolve final page identities. Ambiguity always considers the complete source legend, including entries on continuations, and never changes authored presentation.

## Production sample runner

`npm run build:pdf-validation` typechecks and builds `scripts/pdf-validation/` against production modules. Serve `dist-pdf-validation/` on loopback, then run `run-browser.py` with Playwright Python 1.58.0 in an isolated tool environment. It writes PDFs, reports, and preview images to a fresh output directory; generated artifacts remain outside Git. `verify.py` uses Poppler plus PDF stream lengths to check geometry, complete text and embedded Unicode fonts, and Pillow to compare actual SVG previews with independently rendered PDF pages. A one-pixel neighborhood allows antialiasing differences; do not replace this with a raw whole-image average that obscures the source of a rendering mismatch. `run-web-edition.py` exercises the built app’s import, preview choices and actual repeated downloads. Never parse binary stream boundaries by stripping arbitrary CR/LF bytes. The native runner accepts this host through its explicit `--fixture` and `--script` arguments; historical encoder evaluation defaults remain unchanged.

Native hosts admit one to three preview images. Production verification requires every image for the first `min(3, page count)` pages; the historical encoder verifier still requires its three fixed reference pages. Keep page-count expectations in each fixture's verifier rather than hard-coding three pages in transport. Run `python3 -m unittest discover -s desktop/web/scripts/pdf-validation -p 'test_*.py'` from the repository root when changing preview verification. Browser stress samples may omit preview images intentionally; native samples may not.
