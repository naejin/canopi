# Canvas PDF

Canvas PDF exports are derived files. The Design Session and canvas retain ownership of authored content, history, dirty state, and save acknowledgement. See [ADR 0024](../adr/0024-shared-canvas-pdf-export.md) for product scope.

## Shared pipeline

- `CanvasQuerySurface.capturePrintSnapshot()` returns an owned renderer-neutral projection from settled Scene state, or `null` while an edit owns the Scene. It must never settle an edit, flush maintenance, or request the persistence role. Symbol recipes and resolved authored colors are captured inside the runtime; maps, viewport decorations, and selection state never enter the projection.
- `app/canvas-pdf/live.ts` composes capture, selected-language name resolution, the worker, and the edition delivery adapter. Its owned observation invalidates stale output and schedules an automatic rebuild on Scene, canvas attachment, Design name, or locale changes while the workspace is open. A Design Session identity change instead cancels the operation, closes the workspace and discards its setup. Catalog failure or a 30-second lookup deadline retains full canonical names. Closing/replacing the preview immediately releases the wait without disposing the shared catalog reader.
- `app/canvas-pdf/workflow.ts` owns temporary setup, cancellation, current-result admission, and delivery status. Its owned 100 ms refresh timer leaves the reactive observer before capturing, coalesces source revisions, and is cleared on rebuild, close, replacement and disposal. A busy Scene is retried when the settled-source observation changes; no polling loop is installed. Layer selections override print inclusion without changing Scene visibility. Closing releases results and the current job while retaining choices for the current Design. Reopening captures current content; missing Layer selections block preparation until explicitly reviewed. Replacing the Design discards setup. Export never calls Design persistence or marks a Design saved.
- `layout.ts` composes a page plan in PDF points (72 points/inch); the field placement modules calculate collision geometry in physical millimetres. `text.ts` uses Fontkit shaping and embedded Noto font metrics for both preview outlines and PDF text. `encode.ts` replays the same plan through PDFKit; no screenshot, browser print stylesheet, native renderer, or system font participates.
- A lazily imported inline Vite worker owns each shaping/encoding job. Termination releases its fonts, caches, and in-flight fetches on cancellation, timeout, completion, or error. Main-thread preview data contains only required glyph outlines and prepared PDF bytes.
- `components/canvas-pdf/PdfPagePreview.tsx` supplies shared SVG artwork to the plain preview, visible thumbnails and page editor. Do not replace the outline preview with browser text metrics; actual PDF text remains selectable.

## Assets and delivery

- Runtime dependencies are pinned to PDFKit 0.20.2 and Fontkit 2.0.4 after the [encoder evaluation](../canvas-pdf-evaluation.md). The browser-specific declarations describe only the used pinned surface; the legacy Node typings do not describe its named browser export accurately.
- `font-assets.json` pins Noto Sans 2.008 Latin regular/semibold and Noto Sans CJK 2.004 SC/JP/KR files by upstream URL and SHA-256. `npm run prepare:pdf-fonts` materializes ignored `public/pdf-fonts/` assets and licenses. Dev, builds, and the full test command run this prerequisite. Cached valid files work without upstream access; build packaging includes all five fonts (about 50 MB total). Runtime loads only required fonts from its own edition base URL and verifies their bytes.
- `#canvas-pdf-platform` is a compile-time edition alias. Browser delivery clicks a prepared PDF Blob URL during the initiating gesture and reports a download request, then releases the URL. Native delivery uses the dialog and executor-backed `save_canvas_pdf` command; the service validates the payload and writes the exact bytes through operation-owned temporary-file replacement. This path has no `.canopi` backup or persistence acknowledgement. `save_canvas_pdf` is the only PDF delivery command; native snapshot-PDF rendering and platform PDF stubs are retired.
- Tauri CSP permits same-app font fetches and blob workers. Keep browser and native assets on the same shared pipeline. `npm run build:web` still enforces the browser boundary and per-asset hosting limits.

## Verification

Run TypeScript, focused `canvas-pdf-*` and `canvas-print-snapshot` tests, runtime settled-read coverage, and both builds. Shell or shared runtime changes require the full frontend suite. Native delivery changes require Rust formatting, Clippy, workspace check/tests and the native command policy guard. Real font tests need `npm run prepare:pdf-fonts` first when invoking Vitest directly.

The [native foundation evidence](../canvas-pdf-native-verification.md) covers the isolated chosen encoder in desktop WebViews. The [production validation report](../canvas-pdf-validation.md) and compact data record the current worker, browser delivery and native-host evidence. Packaged Tauri delivery and physical paper readability are separate checks; do not describe encoder fixtures or screen inspection as printer testing. The validation record distinguishes the approved field proposal, its production checks and dated native evidence from physical printer testing.

## Field layout and coverage

`PdfPrintArea` is the sole detail coverage model: a named temporary rectangle with a
session ID and ground bounds, independent of Zones. At 100% its exact ground extent
is fitted into a centred physical frame, without adding ground outside the rectangle.
`coverage.ts` owns fit, zoom and displacement. Automatic orientation maximizes the
usable scale; exact squares use portrait. Each area produces one detail map followed
by its automatic key/notes pages. No preset scales, forced tiling or Zone-based page
creation participates.

`PdfSetup.views` stores temporary zoom, ground-centre displacement in metres and
orientation by stable ID (`overview`, `area:<id>`, `<source>:legend:<index>`), never by
final page number. Zoom is finite, 1–1000%, default 100. Manual zoom or displacement
can crop; `fitPage()` restores full coverage and centring. Orientation overrides refit
at the retained zoom/displacement. Key pages inherit source orientation unless
individually overridden. Removing an area removes its associated page choices.

`field-layout.ts` owns the drawing pass. `field-rows.ts` infers straight neighbouring
runs, splitting at species, appearance, spacing or direction changes; arbitrary
layouts remain individual. `field-placement.ts` places transparent identities with
actual Fontkit ink bounds and routes leaders around printed labels and plant marks.
Crossing leaders have gaps in their own stroke, never opaque erasers. Compact
numeric references repeat along long rows. A full common name is added once per
Species where it fits; full names always remain in the key.

`field-dimensions.ts` positions aligned dimensions from complete authored Measurement
Guides, retaining actual endpoint distance. Cropped or unplaceable dimensions use an
M reference and full value in the key. When another detail contains the full guide,
a vector arrow names and links that final detail page. Authored numerical spacing
Annotations print their original value beside an N reference. Other Annotations use
N anchors with their complete text in the key. Coincident mixed Species use a P
location reference and complete membership instead of overlapping individual leaders.
If an anchor cannot accept a readable leader, its key entry retains ground x/y and a
digital link to the location. Placement metadata distinguishes that fallback by
zero-sized label bounds; it must not be reported as a readable on-map label.

`field-geometry.ts` owns bounded spatial indices, segment clipping/crossings and
flattening the M/L/H/V/C/Z paths emitted by print capture. It does not parse glyph or
plant-symbol paths. `canvas/plant-spacing.ts` remains the shared nearest-position
utility; PDF layout does not import interactive renderers or runtime state.

The navigation overview shows authored geometry and numbered exact detail frames.
It does not duplicate detail labels or keys. Notes and guides outside all selected
details are retained in an overview appendix, with coordinates and digital location
links. An overview used alone receives field identities and its own complete key.
Selected layers and explicit manual cropping determine inclusion. Annotation anchors,
not their interactive text-box width or rotation, determine printed coverage.

Detail sheets have 8 mm side/top margins, 10 mm bottom clearance and only their source
page number above the drawing. They have no minimap, running title, footer or grid.
The overview carries the title and a physically 50 mm calibration bar. Canvas symbols
are capped at 1 mm radius and by nearby spacing (0.35 mm minimum); below 0.8 mm radius
they become solid position dots. Key samples retain 3 mm diameter. Plant and Zone artwork retain authored colours, symbol recipes, layer opacity and
positions. Derived references and text use the readable print ink palette. PDF glyph selection
uses compact recipes below a 12 pt diameter and detailed recipes above it, independently
of the interactive viewport. Nonzero winding preserves enclosed symbol cutouts.

`field-key.ts` paginates complete common/canonical names, reserved Design letter codes,
counts, every authored appearance and full notes at fixed physical sizes. It uses two
columns in portrait and three in landscape. Common names are 10 pt, canonical names
8 pt, numeric references 9.5 pt semibold, notes 9.5 pt and dimension values 9 pt
semibold. Entry fragments reflow to each continuation's orientation without dropping
text or samples. Spare key-page space provides ruled field observations. Numeric
paper references are allocated once from the whole Design in reserved-code order;
framing, selected Layers and locale do not renumber them. They never change the
Design's existing letter codes or saved presentation.

`layout.ts` finalizes page numbers after all keys paginate. Overview frames, dimension
continuations, source/key navigation and individual entries link through stable named
destinations. `encode.ts` writes one PDFKit document; do not concatenate separately
encoded PDFs and lose their destinations. No legend overflow or crowded-text consent
state remains. Empty content, missing selected Layers, unsupported input and resource
failures still have explicit recovery. Engineering bounds remain 200 total pages,
120 seconds per job, 30 seconds per font/name wait and 64 MiB native delivery.

`setPageView()` validates changes and rebuilds through the cancellable workflow. The
workspace keeps its last displayed plan during rebuilding to keep controls stable,
but marks it busy, disables pointer/keyboard framing and immediately clears exportable
bytes. Zoom/orientation remain usable; each effective edit cancels the older job.
Closing releases the cached plan. Temporary inspection is separate from print zoom.
Print choices never dirty the Design; a blank Design can acquire printable coverage
through an explicitly drawn area.

## Print workspace

`CanvasPdfDialog.tsx` mounts the shared full-window workspace in both editions. It owns page selection, Add page and inspection modes, focus restoration/trapping, and the compact paper/Layer controls. Nested controls handle Escape locally. `PdfPageToolbar` edits the selected page through workflow commands; it never writes Scene state. `PdfPageRail` renders source pages and their linked continuations, preserving page cards while a plan rebuilds. Thumbnails use owned IntersectionObservers so only visible cards materialize their glyph SVGs; observers disconnect on unmount.

`PdfPlan.pickerPage` is a separate fitted drawing surface for Add page, computed from printable content and existing detail coverage. It does not enter `pages` or the exported page count and is never replayed by the encoder. It preserves the user's printed overview zoom and displacement. Add page focuses the drawing surface; Cancel or Escape returns to the previous page. The page rail remains available for navigation. Zone geometry is ordinary artwork on selected print Layers, with no extra hit targets, hover selection or search list. Clicking without dragging creates nothing; dragging over any artwork creates the requested Print Area. Zone edits refresh the artwork without changing Print Area identity or bounds.

The printed overview's interactive coverage targets derive from finalized detail-page ground bounds and stable IDs. Hovering/focusing a thumbnail highlights its source coverage; clicking an outline opens the matching detail. Overlay colours, selection rectangles, pointer state and magnification stay outside the physical page plan.

## Production sample runner

`npm run build:pdf-validation` typechecks and builds `scripts/pdf-validation/` against production modules. Serve `dist-pdf-validation/` on loopback, then run `run-browser.py` with Playwright Python 1.58.0 in an isolated tool environment. Its fixture names count source canvas pages; automatic key pages add to the final total. It writes PDFs, reports, and preview images to a fresh output directory; generated artifacts remain outside Git. `verify.py` uses Poppler plus PDF stream lengths to check geometry, complete text and embedded Unicode fonts, and Pillow to compare actual SVG previews with independently rendered PDF pages. A one-pixel neighborhood allows antialiasing differences; do not replace this with a raw whole-image average that obscures the source of a rendering mismatch. `run-web-edition.py` exercises the built app’s import, preview choices and actual repeated downloads. Never parse binary stream boundaries by stripping arbitrary CR/LF bytes. The native runner accepts this host through its explicit `--fixture` and `--script` arguments; historical encoder evaluation defaults remain unchanged.

Native hosts admit one to three preview images. Production verification requires every image for the first `min(3, page count)` pages; the historical encoder verifier still requires its three fixed reference pages. Keep page-count expectations in each fixture's verifier rather than hard-coding three pages in transport. Run `python3 -m unittest discover -s desktop/web/scripts/pdf-validation -p 'test_*.py'` from the repository root when changing preview verification. Browser stress samples may omit preview images intentionally; native samples may not.

The validation host also accepts `pdfValidation.run(name, { input, setup, labels })`
for private captured Designs through the same production job. Pass `--input <preparation.json>` to the browser runner to exercise this path and capture every page preview. Keep private input and
output outside Git. The independent verifier checks the overview-only 50 mm bar,
source page numbers, embedded Unicode fonts, vector geometry and complete link targets.
