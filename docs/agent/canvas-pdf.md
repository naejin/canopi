# Canvas PDF

Canvas PDF exports are derived files. The Design Session and canvas retain ownership of authored content, history, dirty state, and save acknowledgement. See [ADR 0024](../adr/0024-shared-canvas-pdf-export.md) for product scope.

## Shared pipeline

- `CanvasQuerySurface.capturePrintSnapshot()` returns an owned renderer-neutral projection from settled Scene state, or `null` while an edit owns the Scene. It must never settle an edit, flush maintenance, or request the persistence role. Symbol recipes and resolved authored colors are captured inside the runtime; maps, viewport decorations, and selection state never enter the projection.
- `app/canvas-pdf/live.ts` composes capture, selected-language name resolution, the worker, and the edition delivery adapter. Its owned observation invalidates stale output on Scene, attachment, name, locale, or Design Session identity changes. Catalog failure or a 30-second lookup deadline retains full canonical names. Closing/replacing the preview immediately releases the wait without disposing the shared catalog reader.
- `app/canvas-pdf/workflow.ts` owns temporary setup, cancellation, current-result admission, and delivery status. Layer selections override print inclusion without changing Scene visibility. Closing releases results and the current job while retaining choices for the current Design. Reopening captures current content; missing selections block preparation until explicitly reviewed. Replacing the Design discards setup. Export never calls Design persistence or marks a Design saved.
- `layout.ts` makes a page plan in PDF points (72 points/inch). `text.ts` uses Fontkit shaping and embedded Noto font metrics for both preview outlines and PDF text. `encode.ts` replays the same plan through PDFKit; no screenshot, browser print stylesheet, native renderer, or system font participates.
- A lazily imported inline Vite worker owns each shaping/encoding job. Termination releases its fonts, caches, and in-flight fetches on cancellation, timeout, completion, or error. Main-thread preview data contains only required glyph outlines and prepared PDF bytes.
- `components/canvas-pdf/` renders that plan as SVG in the preview. Do not replace the outline preview with browser text metrics; actual PDF text remains selectable.

## Assets and delivery

- Runtime dependencies are pinned to PDFKit 0.20.2 and Fontkit 2.0.4 after the [encoder evaluation](../canvas-pdf-evaluation.md). The browser-specific declarations describe only the used pinned surface; the legacy Node typings do not describe its named browser export accurately.
- `font-assets.json` pins Noto Sans 2.008 Latin and Noto Sans CJK 2.004 SC/JP/KR files by upstream URL and SHA-256. `npm run prepare:pdf-fonts` materializes ignored `public/pdf-fonts/` assets and licenses. Dev, builds, and the full test command run this prerequisite. Cached valid files work without upstream access; build packaging includes all four fonts (about 50 MB total). Runtime loads only required fonts from its own edition base URL and verifies their bytes.
- `#canvas-pdf-platform` is a compile-time edition alias. Browser delivery clicks a prepared PDF Blob URL during the initiating gesture and reports a download request, then releases the URL. Native delivery uses the dialog and executor-backed `save_canvas_pdf` command; the service validates the payload and writes the exact bytes through operation-owned temporary-file replacement. This path has no `.canopi` backup or persistence acknowledgement.
- Tauri CSP permits same-app font fetches and blob workers. Keep browser and native assets on the same shared pipeline. `npm run build:web` still enforces the browser boundary and per-asset hosting limits.

## Verification

Run TypeScript, focused `canvas-pdf-*` and `canvas-print-snapshot` tests, runtime settled-read coverage, and both builds. Shell or shared runtime changes require the full frontend suite. Native delivery changes require Rust formatting, Clippy, workspace check/tests and the native command policy guard. Real font tests need `npm run prepare:pdf-fonts` first when invoking Vitest directly.

The [native foundation evidence](../canvas-pdf-native-verification.md) covers the isolated chosen encoder in desktop WebViews. Production app delivery and physical paper readability are separate checks; do not describe encoder fixtures or screen inspection as printer testing. Physical layout defaults remain provisional until the tracked print review is performed.

## Detail coverage

Zone selections use their current exact names as identity. Their latest geometry is read on rebuild, even if the Zones print layer is excluded; renaming/removing a selected Zone requires explicit selection review. Each selected Zone is covered by rectangular sheets at the common real-world scale, including nearby printable content and overlap. `coverage.ts` tiles ground coordinates without fitting or stretching the physical drawing frame. Automatic orientation minimizes total canvas and accepted legend continuation pages per selected area; overview orientation prefers a fitting legend and fewer continuation pages before maximizing fitted coverage.

Detail pages have page-specific species legends. The overview becomes a navigation sheet with all printable content and every detail sheet's complete ground coverage, without a duplicated species legend. Page numbering, neighbor references, and overview outlines are assembled from page identities after page planning. Numbering happens after explicit legend continuation insertion.

Provisional detail defaults are 1:100, 10 mm physical overlap, and 5 mm physical Zone context padding at the chosen scale. Both paper sizes retain the 42 mm legend column, 10 mm margins, 10 pt legend text, 3 mm nominal plant symbols and 0.25 mm geometry strokes. A setup is currently limited to 200 total pages including the overview; reject excessive coverage before allocating sheets. Resource/default validation remains tracked separately from implementing the coverage rules.

Print Areas are named temporary rectangles in the PDF workflow, with an optional per-area scale override shared by all of that area’s sheets. They never create Zones. The preview owns pointer capture and cancels interrupted drawings; pointer coordinates account for SVG fit whitespace and convert through the exact overview transform. Blank Designs get an unexportable overview for drawing; explicit Print Areas provide printable scaled coverage. Geometry layers and scale choices remain session-only, and replacement resets generated area names and identities.

## Legend pagination

`legend.ts` lays out full selected-language names (canonical fallback) and every authored appearance at the shared readable size. The source sheet keeps an ordered prefix in its narrow column. Overflow blocks output until the user explicitly allows continuation pages or changes setup. Accepted continuations use two columns, retain complete entries where they fit, and can continue an exceptionally long entry without shrinking it. Source and continuation links resolve final page identities. Ambiguity always considers the complete source legend, including entries on continuations, and never changes authored presentation.

## Production sample runner

`npm run build:pdf-validation` typechecks and builds `scripts/pdf-validation/` against production modules. Serve `dist-pdf-validation/` on loopback, then run `run-browser.py` with Playwright Python 1.58.0 in an isolated tool environment. It writes PDFs, reports, and preview images to a fresh output directory; generated artifacts remain outside Git. `verify.py` uses Poppler plus PDF stream lengths to check geometry, complete text and embedded Unicode fonts. Never parse binary stream boundaries by stripping arbitrary CR/LF bytes. The native runner accepts this host through its explicit `--fixture` and `--script` arguments; historical encoder evaluation defaults remain unchanged.
