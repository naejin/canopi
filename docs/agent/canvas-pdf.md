# Canvas PDF

Canvas PDF exports are derived files. The Design Session and canvas retain ownership of authored content, history, dirty state, and save acknowledgement. See [ADR 0024](../adr/0024-shared-canvas-pdf-export.md) for product scope.

## Shared pipeline

- `CanvasQuerySurface.capturePrintSnapshot()` returns an owned renderer-neutral projection from settled Scene state, or `null` while an edit owns the Scene. It must never settle an edit, flush maintenance, or request the persistence role. Symbol recipes, resolved authored colors, and owned native Zone primitives (world-space polygon/rectangle corners and ellipse centre/radii/rotation) are captured inside the runtime; maps, viewport decorations, and selection state never enter the projection.
- `app/canvas-pdf/live.ts` composes capture, selected-language name resolution, the worker, and the edition delivery adapter. Its owned observation invalidates stale output and schedules an automatic rebuild on Scene, canvas attachment, Design name, or locale changes while the workspace is open. A Design Session identity change instead cancels the operation, closes the workspace and discards its setup. Catalog failure or a 30-second lookup deadline retains full canonical names. Closing/replacing the preview immediately releases the wait without disposing the shared catalog reader.
- `app/canvas-pdf/workflow.ts` owns temporary setup, cancellation, current-result admission, and delivery status. Its owned 100 ms refresh timer leaves the reactive observer before capturing, coalesces source revisions, and is cleared on rebuild, close, replacement and disposal. A busy Scene is retried when the settled-source observation changes; no polling loop is installed. Layer selections override print inclusion without changing Scene visibility. Closing releases results, retained field layouts and the current job while retaining choices for the current Design. Reopening captures current content; missing Layer selections block preparation until explicitly reviewed. Replacing the Design discards setup. Export never calls Design persistence or marks a Design saved.
- `layout.ts` composes a page plan in PDF points (72 points/inch); the field placement modules calculate collision geometry in physical millimetres. `text.ts` uses Fontkit shaping and embedded Noto font metrics for both preview outlines and PDF text. `encode.ts` replays the same plan through PDFKit; no screenshot, browser print stylesheet, native renderer, or system font participates.
- A lazily imported inline Vite worker owns each shaping/encoding job. Progress messages contain preview-only plans, never exportable bytes. The workflow admits them only for the current generation and source. Termination releases its fonts, caches, and in-flight fetches on cancellation, timeout, completion, or error. Main-thread preview data contains required glyph outlines, prepared PDF bytes and serialized field layouts. `PdfLayoutCache` retains only the current setup’s unnumbered map/key pages and their used glyph outlines. Cache signatures cover printable content, references, localized names, relevant measurement homes, geometry, key orientations and labels. `layout.ts` reuses matching sheets, prioritizes the selected source, then finalizes the original document order and links. Cancellation still terminates the worker; no persistent worker or font owner is added.
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

`PdfPrintArea` is the detail coverage model: a named temporary rectangle with a
session ID and ground bounds, independent of Zones. At 100% its exact ground extent
is fitted into a physical frame, without adding ground outside the rectangle. The map may shift across spare paper to accommodate a complete key; its scale and ground coverage remain fixed. Side-key candidates start at 84 mm and grow only when needed, centring the drawing in the remaining region. Shallow horizontal drawings can reserve a key below before placing annotations; chosen map scale stays fixed.
`coverage.ts` owns fit, zoom and displacement. Automatic orientation maximizes the
usable scale; exact squares use portrait. Each area produces one detail map with a complete local key on the same sheet when it fits, otherwise followed by automatic key/notes pages. `addWholeDesign()` explicitly uses the fitted picker extent. `split-sheets.ts` partitions an explicitly requested sheet along its longest ground axis, aiming for at most 120 distinct positions per partition, with at least two and at most 32 proposed rectangles. This is a coverage heuristic, not a guarantee that coincident or unusually dense positions become readable. Full ground coverage is preserved. `splitPreview` owns proposed setup separately from committed `setup`; Apply commits only a current ready preview and Cancel rebuilds the original. Export is unavailable while reviewing a proposal, never because a sheet is crowded.

`PdfSetup.views` stores temporary zoom, ground-centre displacement in metres and
orientation by stable ID (`overview`, `area:<id>`, `<source>:legend:<index>`), never by
final page number. Zoom is finite, 1–1000%, default 100. Manual zoom or displacement
can crop; `fitPage()` restores full coverage and centring. Orientation overrides refit
at the retained zoom/displacement. Key pages inherit source orientation unless
individually overridden. Removing an area removes its associated page choices.

`field-layout.ts` composes physical drawing, identification, annotations and dimensions.
`field-identity.ts` chooses plain/circle/square/diamond enclosures within each detail's
appearance groups. Local frequency takes priority; whole-Design conflict ordering
breaks ties. Only local symbol/colour collisions activate identification. Occasional
members (at most three occurrences and less than one third of the most frequent
member) use the existing Species Code, as do excess enclosure conflicts. Unique
appearances stay plain. No plant membership networks or leader strokes are generated.
Code labels search adjacent space on both axes, including clear gaps within multi-bed
sheets. Their nearest edge must remain associated with the source plant among otherwise
indistinguishable marks and have a clear direct path. Code ink avoids stored guide
segments; dimension labels then fit around it. When at most eight plants remain unresolved, at most eight enclosure exchanges
can resolve failed codes, accepted only when fewer plants remain unplaced. Every
instance and key sample for an appearance changes together. A code that cannot fit retains coordinates in its existing Species
entry, never a second P identity. P references are reserved for coincident placements
with complete membership and counts. Zero-sized placement metadata must never be
reported as a readable map identity. Positions closer than the 0.7 mm mark diameter
bypass futile code/reference placement and retain coordinates.

`field-placement.ts` reserves actual Fontkit ink and enclosed mark bounds in physical
millimetres. Its bounded candidate search uses clear paths to assess association;
these paths are not printed plant connectors. `field-annotations.ts` tries readable
8.5–12 pt, whole-word text near the authored anchor, preserving rotation. Only detail notes
that cannot fit use an N reference and their complete text in the key. Species Code
identification and authored guides take priority over note placement. `zone-ink.ts`
interrupts only Zone outline strokes around text; native geometry remains intact.
PDF Zone interiors are always transparent, including authored filled Zones. Never use opaque erasers over planting artwork.

`field-dimensions.ts` draws dimensions from stored Measurement Guide endpoints,
retaining full physical distance even when cropped. Labels are 8.5 pt on details;
vertical labels align with the guide. Stroke gaps belong to the dimension itself.
A cropped/unplaceable guide keeps its authored segment and a nearby full value or an
M entry. An arrow links to a detail containing the whole guide when available.
`zone-measurements.ts` derives sizes from captured primitives: actual edges for beds
and polygons, actual diameters for ellipses, never axis-aligned bounding-box sizes.
Bent corridor beds retain their exterior segments and distinct end widths. Other
polygons retain individual edges, including four-sided polygons; only native rectangles
use the rectangular size shortcut. Matching authored guides are reused, not duplicated.
Full dimensions remain in `field-summary.ts` above a cropped detail; derived dimension
lines are added only where their real endpoints and physical ink fit.

`overview.ts` preserves all selected stored guide lines and endpoint ticks. Repeated
values are grouped by native Zone in the aligned `overview-measurements.ts` table.
`overview-guides.ts` may place an existing connected horizontal chain in a readable
band below the drawing; it creates no synthetic guide. Crops or tight spacing reject
that band. Other values use physical 7.5 pt placement, with M summaries when needed.
Long dimension indexes paginate into overview continuations. Zone labels connect
the table to paper locations. The index accepts guide-value strings, never Canvas
annotations; `layout.ts` admits only distance entries to this overflow path.
Overview annotations only print as complete contextual
text when their physical ink fits with 2 mm clearance and at most two lines, after
plant marks, guide ink and Zone references. No N markers or annotation lists belong
on the overview. Notes covered by chosen details appear there.

Detail coverage comes only from explicit Print Areas and their current framing.
Annotations that do not fit on the overview and lie outside every chosen detail are
omitted. They never generate a detail, an overview annotation list, or a note relocated
into another detail's key. An overview-only setup may add continuations for Zone
sizes and stored Measurement Guide values, but never for annotations or Species keys.
This is a layout-level invariant, including progressive overview preparation.

Remote notes do not shrink the main planting plan. The separate picker still fits
all authored anchors so users can explicitly choose detail coverage there. Catalog
name resolution is limited to chosen detail coverage; overview annotations do not
trigger Species name lookup. Font preparation includes printable annotations and
pinned plant names without expanding detail coverage.

`field-geometry.ts` owns spatial indices, clipping, rotated ink bounds and flattening
M/L/H/V/C/Z captured geometry. It does not parse plant symbol or glyph paths.
`canvas/plant-spacing.ts` remains the shared nearest-position utility. PDF layout
imports neither interactive renderers nor runtime state.

Detail sheets have an 8 mm side margin, a 26 mm header band plus full Zone summaries,
and 20 mm bottom clearance. `page-furniture.ts` provides Design title, consecutive
detail identity, counts, paper/actual-size reminder and a 1/2/5 ground scale. The
overview carries the same ground scale plus a separately labelled physical 50 mm calibration bar. Plant marks retain
authored positions, custom colours, opacity and compact symbol recipes even at small
sizes; detail radii cap at 0.8 mm and overview radii at 1 mm. Enclosures add clearance
outside the mark. Zone outlines use quiet neutral ink with no fill on overview, detail
and picker pages. Draw them before plants, guides and annotations so overlapping
Zones never mask artwork. Preserve authored fills in the snapshot and Design; this
is a PDF presentation rule. Compact recipes apply below 12 pt diameter, independently of viewport.
Nonzero winding preserves symbol cutouts.

`integrated-key.ts` admits a full key in spare paper only if its complete entries and
notes fit without colliding with drawing ink or reducing map scale. `field-key.ts`
uses a compact heading and aligned quantities, with 8 pt semibold Species Codes and 9.5 pt common names, 7.5 pt botanical names and 9 pt notes in compact keys;
standalone keys use 10/8/9.5 pt respectively. The Species Code is left of a single
enclosed sample, with no repeated symbol beside the botanical name. Every authored
appearance and count remains represented. Keys use up to three columns, reflow complete
entry fragments across independent orientation overrides, and use spare space for
ruled observations. There is no duplicate quick key. Internal whole-Design numeric
IDs name destinations only; the Design's Species Code remains the visible identity.

`layout.ts` finalizes physical page numbers after all continuations exist. The separate
`detailNumber` starts at 1 and increments only for detail maps; overview coverage,
headers, dimension arrows and source-key labels use it. Stable named destinations
connect pages and entries. Overview index continuations appear in the page rail too.
`encode.ts` writes one PDFKit document; never concatenate separate documents and lose
links. Engineering bounds remain 200 total pages, 120 seconds per job, 30 seconds per
font/name wait and 64 MiB native delivery. Final plans retain only glyph outlines used by printed or picker artwork, so cached and fresh layouts agree. Cache signatures include captured geometry,
local identities, names, coverage, measurement homes, key orientation and labels.

`setPageView()` validates changes and rebuilds through the cancellable workflow. The
workspace keeps its last displayed plan during rebuilding to keep controls stable,
but marks it busy, disables pointer/keyboard framing and immediately clears exportable
bytes. Progressive overview/selected-sheet plans can replace the retained artwork; provisional sheets have no final printed page number until the complete plan is finalized. Zoom/orientation remain usable; each effective edit cancels the older job.
Closing releases the cached plan. Temporary inspection is separate from print zoom.
Print choices never dirty the Design; a blank Design can acquire printable coverage
through an explicitly drawn area.

## Print workspace

`CanvasPdfDialog.tsx` mounts the shared full-window workspace in both editions. It owns page selection, Add field sheet and inspection modes, focus restoration/trapping, and the compact paper/Layer controls. Nested controls handle Escape locally. `PdfPageToolbar` edits the selected page through workflow commands; it never writes Scene state. `PdfPageRail` renders source pages and their linked continuations, preserving page cards while a plan rebuilds. Thumbnails use owned IntersectionObservers so only visible cards materialize their glyph SVGs; observers disconnect on unmount.

`PdfPlan.pickerPage` is a separate fitted drawing surface for Add field sheet, computed from printable content and existing detail coverage. It does not enter `pages` or the exported page count and is never replayed by the encoder. It preserves the user's printed overview zoom and displacement. Add field sheet focuses the drawing surface; Cancel or Escape returns to the previous page. The page rail remains available for navigation. Zone geometry is ordinary artwork on selected print Layers, with no extra hit targets, hover selection or search list. Clicking without dragging creates nothing; dragging over any artwork creates the requested Print Area. Zone edits refresh the artwork without changing Print Area identity or bounds.

The printed overview's interactive coverage targets derive from finalized detail-page ground bounds and stable IDs. Hovering/focusing a thumbnail highlights its source coverage; clicking an outline opens the matching detail. Overlay colours, selection rectangles, pointer state and magnification stay outside the physical page plan.

## Production sample runner

`npm run build:pdf-validation` typechecks and builds `scripts/pdf-validation/` against production modules. Serve `dist-pdf-validation/` on loopback, then run `run-browser.py` with Playwright Python 1.58.0 in an isolated tool environment. Its fixture names count source canvas pages; automatic key pages add to the final total. It writes PDFs, reports, and preview images to a fresh output directory; generated artifacts remain outside Git. `verify.py` uses Poppler plus PDF stream lengths to check geometry, complete text and embedded Unicode fonts, and Pillow to compare actual SVG previews with independently rendered PDF pages. A one-pixel neighborhood allows antialiasing differences; do not replace this with a raw whole-image average that obscures the source of a rendering mismatch. `run-web-edition.py` exercises the built app’s import, preview choices and actual repeated downloads. Never parse binary stream boundaries by stripping arbitrary CR/LF bytes. The native runner accepts this host through its explicit `--fixture` and `--script` arguments; historical encoder evaluation defaults remain unchanged.

Native hosts admit one to three preview images. Production verification requires every image for the first `min(3, page count)` pages; the historical encoder verifier still requires its three fixed reference pages. Keep page-count expectations in each fixture's verifier rather than hard-coding three pages in transport. Run `python3 -m unittest discover -s desktop/web/scripts/pdf-validation -p 'test_*.py'` from the repository root when changing preview verification. Browser stress samples may omit preview images intentionally; native samples may not.

The validation host also accepts `pdfValidation.run(name, { input, setup, labels })`
for private captured Designs through the same production job. Pass `--input <preparation.json>` to the browser runner to exercise this path and capture every page preview. Keep private input and
output outside Git. The independent verifier checks the overview-only 50 mm bar,
source page numbers, embedded Unicode fonts, vector geometry and complete link targets.
