# Canvas PDF approval and validation

The field layout proposal was approved on **2026-09-10** and integrated under
`canopi-jqyz`. It supersedes the compact sidebar legend and consent-based readability
behaviour accepted earlier that day. The [user guide](canvas-pdf.md),
[ADR 0024](adr/0024-shared-canvas-pdf-export.md) and [agent guide](agent/canvas-pdf.md)
describe the current behaviour.

## Current field layout evidence

The private orchard contains 2,201 plants and 117 Species. Production validation uses
the four exact rectangles from its supplied export: 371/410/323/263 plant placements
and 39/42/39/23 Species respectively. All placements retain their positions and authored
appearances, and every detail plant has a nonempty readable label allocation. The
selected 55 unique Annotations (57 occurrences) have visible anchors and full text in
the companion keys. The 67 unique complete Measurement Guides remain represented;
three cropped guides on the second detail link to their complete view on page 6.
No consent is required for text or key pagination. Notes and measurements outside the
four rectangles remain in an overview appendix. Source files are unchanged.

The production worker, fonts, SVG preview and PDFKit encoder are exercised together
in Chrome 150.0.7871.46. Independent Poppler checks verify embedded Unicode fonts,
vector artwork, final page references, complete named-link targets and the overview's
physical 50 mm bar. Every private PDF page is compared with the actual app SVG preview;
the one-pixel neighbourhood difference must remain below the existing 0.25 threshold.
The compact [field validation data](canvas-pdf-field-validation-data.json) records the
final counts, hashes, generation times and comparisons without private Design content.

Public samples cover dense and irregular plantings, automatic key overflow,
independent framing, mixed scripts, excluded maps and 1/10/50 source canvas pages.
Keys count toward the unchanged 200-page limit. Each run verifies zero workers after
cleanup. Renderer RSS includes shared pages and transient allocations; these samples
are not a device performance guarantee. The 120-second job deadline, 30-second
font/name waits and 64 MiB native delivery bound remain unchanged.

The built Web Edition is tested through normal file import, automatic key pagination,
repeated actual downloads, retained session setup, drawing pages, zoom/orientation,
keyboard framing, inspection, overview navigation, compact workspace and page removal.
Frontend coverage includes exact coverage, complete identity and text retention,
transparent labels, leader clearance, aligned/cropped guides, final navigation,
long mixed-script keys, sample reflow across orientations, ink/row clearance, worker
cancellation and Design Session isolation. TypeScript, the full frontend suite, both
edition builds, the Web boundary scan and the production validation build are required.
The final gates passed: 241 frontend files / 2,219 tests, 80 focused PDF tests and
four Python verifier tests, TypeScript, both edition builds and the production probe
build. No Rust or shared transport contract changed.

These are screen, browser and independent PDF checks. Physical printer measurements,
field use and a fresh packaged-native matrix for the field layout were not performed.
Earlier native evidence below establishes the shared encoder foundation at its stated
baseline, and must not be reported as current field-layout approval on those devices.

## Historical native verification

The previous [production matrix, run 34410345648](https://github.com/naejin/canopi/actions/runs/34410345648),
passed at the approved frontend baseline `936d4f01` on Linux WebKitGTK, both macOS
WKWebView architectures and Windows WebView2. All four hosts produced matching
two-page plans and extracted text. Independent inspection passed both 50 mm bars,
embedded Unicode fonts, vector content and all eight preview comparisons. Exact
runtime versions, hashes and image residuals are retained under `releaseAudit` in
[measured data](canvas-pdf-validation-data.json). The housekeeping changes leave this
frontend output unchanged; Rust removal is separately covered by the local gates.

## Dated platform and resource evidence

[Workspace evidence](canvas-pdf-workspace-validation-data.json) preserves the
post-fitting native matrix at `b307a454`, [run 34376541459](https://github.com/naejin/canopi/actions/runs/34376541459).
Linux WebKitGTK, Apple Silicon/Intel WKWebView and Windows WebView2 produced the same
two-page mixed sample, plan and extracted text. Poppler verified embedded Unicode
fonts, vectors, both 50 mm bars and all eight preview comparisons. Image residuals
were 0.0039–0.0136 against the unchanged 0.25 bound. The later `5d69df17`
[run 34377404800](https://github.com/naejin/canopi/actions/runs/34377404800) also passed.
These baselines precede the compact legend and later readability changes.

[Original measured data](canvas-pdf-validation-data.json) preserves the earlier
Chrome, Firefox 146.0.1 and Playwright WebKit 26.0 fixture matrix, hashes, resource
samples and native versions. Its fixed scales, overlapping sheets and Zone-selection
results are historical. Fifty pages / 10,000 plants took 2.05 seconds in one Chrome
run, with sampled renderer RSS rising from 355 to 552 MiB; this includes shared
memory and prior allocations, not retained heap. Fixtures reported zero export
workers after teardown. The 1/10/50-page samples are tests, not product limits.

The native probes run production modules in owned OS WebViews over loopback with
CSP and fixed-path delivery. They do not test the packaged Tauri asset scheme or
save dialog. Playwright WebKit on Linux is not the Safari application. The separate
[foundation record](canvas-pdf-native-verification.md) and [encoder comparison](canvas-pdf-evaluation.md)
retain the earlier mixed-script font decision and rejected candidate evidence.

## Reproduce output

From `desktop/web`, run `npm run build:pdf-validation`. Serve
`dist-pdf-validation` on loopback, then run the isolated browser probes from the
repository root, writing into fresh ignored or temporary directories:

```bash
python3 -m http.server 4175 --bind 127.0.0.1 --directory desktop/web/dist-pdf-validation
uv run --with playwright==1.58.0 python desktop/web/scripts/pdf-validation/run-browser.py .tmp/pdf-review/chrome --chrome
python3 desktop/web/scripts/pdf-validation/verify.py .tmp/pdf-review/chrome/*.pdf
```

The inspector needs Poppler and Pillow. Pass `--input <preparation.json>` to use a
private `{ input, setup, labels }` production request and capture every page preview.
The host is excluded from shipped editions; no private fixture is committed.
Browser alternatives are `--browser firefox` and `--browser webkit` with installed
Playwright browsers and their runtime libraries. The existing production-native
workflow can run this same host and verifier on desktop WebViews.

For downloads, build Web Edition and serve it with `npx vite preview --mode web`.
Run `desktop/web/scripts/pdf-validation/run-web-edition.py` against its `/app/web.html`
URL. Keep private Designs, PDFs, browser profiles and screenshots outside Git.
A physical review should separately record printer/settings, the measured 50 mm
bar, label readability and plant identification/navigation in the field.
