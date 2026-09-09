# Canvas PDF

Canvas PDF exports are derived files. The Design Session and canvas retain ownership of authored content, history, dirty state, and save acknowledgement. See [ADR 0024](../adr/0024-shared-canvas-pdf-export.md) for product scope.

## Shared pipeline

- `CanvasQuerySurface.capturePrintSnapshot()` returns an owned renderer-neutral projection from settled Scene state, or `null` while an edit owns the Scene. It must never settle an edit, flush maintenance, or request the persistence role. Symbol recipes and resolved authored colors are captured inside the runtime; maps, viewport decorations, and selection state never enter the projection.
- `app/canvas-pdf/live.ts` composes capture, selected-language name resolution, the worker, and the edition delivery adapter. Its owned observation invalidates stale output on Scene, attachment, name, locale, or Design Session identity changes. Catalog failure retains full canonical names.
- `app/canvas-pdf/workflow.ts` owns temporary setup, cancellation, current-result admission, and delivery status. Closing releases results and the current job. Replacing the Design discards setup. Export never calls Design persistence or marks a Design saved.
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
