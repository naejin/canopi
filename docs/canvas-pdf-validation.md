# Canvas PDF approval and validation

The user reviewed and approved the completed feature on **2026-09-10**, accepting
the current layout, defaults and resource bounds, and requested closure of the PDF
beads. `canopi-h0q3` records that decision; `canopi-1zbj` records the final audit and
cleanup; `canopi-cd7x` is the parent epic. Approval applies to the completed compact
legend at `936d4f01` and its preceding accepted changes. Housekeeping does not change
PDF appearance or settings.

Approval is a user decision. No printer model, driver settings, numerical paper
measurements or additional packaged-app results were supplied with it. The evidence
below retains its actual scope and baseline; missing measurements are not reported
as automated passes.

## Current implementation and checks

The [user guide](canvas-pdf.md) describes the workflow, [ADR 0024](adr/0024-shared-canvas-pdf-export.md)
records scope and trade-offs, and the [agent guide](agent/canvas-pdf.md) owns current
module boundaries, physical dimensions, resource bounds and reproduction commands.

The accepted setup uses A4 by default, also supports Letter, and fits drawn Print
Areas automatically with independent zoom/framing/orientation. Legends retain a
42 mm column, 10 pt names with 13 pt leading, nominal 3 mm symbols and complete
names/appearances. Compact rows use 2 pt entry gaps, inline samples where they fit,
a 1 mm name gutter and 0.8 mm sample spacing. Canvas marks adapt to physical spacing.
The 200-page guard, 120-second job deadline, 30-second font/name waits and 64 MiB
native payload cap are accepted engineering bounds, not performance promises.

At `936d4f01`, TypeScript, all **235 frontend files / 2,192 tests**, both edition
builds, the Web boundary scan and the production validation build passed. Tests
cover complete area fit and drawing-only creation, independent page views, full
localized names and authored appearances, explicit continuation consent, long
mixed-script entries, text retention, cancellation and Design Session isolation.

Chrome **150.0.7871.46** exercised the built Web Edition: repeated downloads,
continuation consent/withdrawal, retained setup, drawn pages, zoom/orientation,
keyboard framing, inspection, overview navigation, compact workspace and removal.
Poppler verified all 90 Species names in both downloads. The private 2,201-plant
orchard exported as two A4 pages; extraction verified all 117 full canonical names,
and source/continuation renders were inspected. The source hash remained unchanged.
Private artifacts stay in ignored `.tmp/compact-legend-production/`.

The housekeeping checkout passes TypeScript, all 2,192 frontend tests, generated-binding checks, both edition builds, Rust formatting, strict Clippy, workspace check and tests (307 passed; two existing manual benchmark/relevance tests ignored), and all 13 native command-policy tests. No shared contract or generated binding changed.

The housekeeping audit removes the unused native snapshot-PDF command, service,
platform method, Cairo PDF renderer/feature and macOS/Windows PDF stubs. The shared
`save_canvas_pdf` byte-delivery path and PNG export remain. The comparison prototype
and Zone page-creation code were already removed. Historical encoder tools remain
isolated: they reproduce the font decision and their native hosts also serve the
production probe. They are not an alternative app exporter.

## Acceptance audit

| PRD criteria | Evidence |
| --- | --- |
| 1: shared output and edition delivery | One physical plan/encoder; native matrix below; browser downloads and native delivery/service tests |
| 2–3: print Layers and overview bounds | Layout, snapshot and workflow tests preserve saved visibility and filter extent |
| 4–6: drawn areas, fitting and page controls | Area, coverage, dialog and editor tests; built Web drawing/framing/navigation flow |
| 7–10: complete legends, names and fidelity | Readability, continuation, encoding and text tests; independent orchard extraction/rendering |
| 11: session and persistence isolation | Workflow, native delivery and Design Session tests; unchanged orchard source |
| 12: no map dependency | Snapshot filtering, Web boundary scan and equal map-excluded fixture plans |
| 13: scripts, recovery and resources | Real Noto shaping, worker/font/delivery error tests; browser/native fixture inspection |
| 14: final review and defaults | Explicit user approval on 2026-09-10; dated measured evidence below, without invented printer results |

## Final native verification

The fresh [production matrix, run 34410345648](https://github.com/naejin/canopi/actions/runs/34410345648),
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

From `desktop/web`, run `npm run build:pdf-validation`. The isolated host imports
production capture, worker, fonts, layout, encoder and SVG preview; it is excluded
from shipped editions. From the repository root, use a fresh output directory:

```bash
python3 -m http.server 4175 --bind 127.0.0.1 --directory desktop/web/dist-pdf-validation
uv run --with playwright==1.58.0 python desktop/web/scripts/pdf-validation/run-browser.py .tmp/pdf-review/chrome --chrome
python3 desktop/web/scripts/pdf-validation/verify.py .tmp/pdf-review/chrome/*.pdf
```

The inspector needs Poppler and Pillow. The browser runner accepts `--browser
firefox` or `--browser webkit`; install the selected Playwright browser and its
runtime libraries. The [production native workflow](../.github/workflows/pdf-production-probe.yml)
runs the current host on all desktop engines and independently verifies output.
Its launcher accepts `--fixture desktop/web/dist-pdf-validation --script
desktop/web/scripts/pdf-validation/run-native.js`.

For actual Web downloads, build Web Edition, serve it with Vite preview, and run
`desktop/web/scripts/pdf-validation/run-web-edition.py` with a fresh output directory
and `--url http://127.0.0.1:4173/app/web.html`. Keep private Designs, generated PDFs,
profiles and screenshots outside Git. When repeating a physical review, print at
actual size and record the printer/settings, measured 50 mm bar, field readability
and plant-identification/navigation outcomes separately from screen checks.
