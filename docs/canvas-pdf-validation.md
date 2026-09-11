# Canvas PDF approval and validation

The field layout proposal was approved on **2026-09-10** and integrated under
`canopi-jqyz`. The subsequent revisions were tracked by `canopi-n820` and `canopi-v36o`.
The 2026-09-11 field-print revisions supersede their bracket, separate-key and
overview-index defaults. The explicit-coverage correction below removes automatic
annotation sheets introduced during that polish. Readability consent remains retired. The [user guide](canvas-pdf.md),
[ADR 0024](adr/0024-shared-canvas-pdf-export.md) and [agent guide](agent/canvas-pdf.md)
describe the current behaviour.

## Release review (`canopi-bw80`, 2026-09-11)

The release review preserves the approved field-print behaviour and removes the
obsolete bracket/routing implementation. A new failing trapezoid regression exposed
an omitted polygon edge: only native rectangles now use rectangular dimensions.
Each field drawing derives its Zone measurements once. The overview index accepts
guide-value strings directly, with distance-only admission, instead of fabricated
Canvas annotations.

All **2,319 frontend tests in 251 files**, TypeScript, both edition builds, the Web
boundary scan, generated-binding checks, Rust formatting/Clippy/check/tests, 108
catalog tests and four PDF verifier tests pass. The full frontend run used two
workers to limit local memory pressure. All nine public production fixtures pass,
including 10,000 plants across 99 pages, with worker cleanup verified.

The private overview remains one page and has an identical physical plan to the
transparent-Zone revision. The complete orchard packet remains 14 pages with
unchanged coverage, identities, names and guide metadata. Corrected polygon
dimensions change ink on three detail pages; those pages and the overview were
visually inspected. All 15 private SVG/Poppler comparisons pass (maximum residual
0.099, unchanged limit 0.25), along with fonts, vector geometry, links and calibration.
The source Design and previous review files remain unchanged. Packaged release smoke
tests are tracked separately under `canopi-ru64`.

The final 1.1.1 dependency integration (`canopi-ps1b`, `canopi-ru64`) passes
**2,321 frontend tests in 253 files**, both edition builds and the same public and
private PDF checks. The overview and 14-page packet retain identical physical plans
and coverage metadata after the dependency refresh; all 15 private comparisons
remain below 0.099. Generated bindings pass after rebuilding the local tool in the
main checkout; see the Cargo worktree-cache rule in the [build guide](agent/build-release.md).

## Current transparent Zone interiors (`canopi-d2ly`, 2026-09-11)

Zone interiors now remain transparent on overview, detail and picker pages. Both
PDF renderers omit authored fills and the former pale fill for closed unfilled
Zones. Zone stroke protection no longer retains a fill when it opens a gap around
text. Native geometry, neutral outlines, references, dimensions and authored Design
fills are preserved. Existing draw order keeps Zone outlines beneath plants,
Measurement Guides and annotations.

A regression at `buildPdfPlan` failed on the old pale fill, then passed after the
correction. It covers overlapping rectangles, polygons and ellipses with null,
coloured and white authored fills on all three surfaces, verifies transparent ink
and draw order, and checks that the input is unchanged. All 135 focused PDF/snapshot
tests in 21 files pass. The prior explicit-coverage rule remains in force.

TypeScript, both edition builds, the Web boundary scan and the production validation
build pass. The production overview remains one page and the full orchard packet
14 pages. Their coverage, plant identities, names, guide metadata, links and scales
match the preceding explicit-coverage output exactly. All 15 SVG/Poppler comparisons
pass (maximum residual 0.099 against the unchanged 0.25 limit), alongside embedded
Unicode fonts, vector artwork, calibration and worker cleanup. The overview's top
ellipse now reveals the overlapping bed outline. The overview and first detail were
visually inspected, including a grayscale overview. The source Design is unchanged.
Counts and hashes are under `transparentZoneRevision` in the validation data. This
confined rendering change used focused coverage; the previous full frontend-suite
results below were not rerun. No physical printer or fresh packaged-native tests
were performed. User and agent guides and ADR 0024 reflect transparent Zone ink.

## Explicit detail coverage (`canopi-kg34`, 2026-09-11)

The user clarified that notes which cannot fit on the overview and fall outside
chosen detail coverage must be omitted. The previous annotation-coverage loop violated
that rule: a fresh overview-only orchard setup generated **35 pages**, including
33 automatic details and one key continuation. The identical input without annotations
produced one page; a single long note reproduced the failure without plants, Zones,
Measurement Guides, saved views or chosen details. This isolates coverage expansion
from legitimate dimension-table pagination and retained setup.

The loop, remote-note relocation, derived page types/controls, their locale strings
and annotation-triggered Species lookups are removed. The real layout repro now
produces **one overview page** with its Zone dimensions and guide values. Only explicit
Print Areas create detail pages. Their crowded notes retain N/full-key fallback;
notes outside those views never generate or relocate content. The picker still lets
users explicitly frame any authored annotation. Overview dimension and guide overflow
continues independently at readable physical sizes.

A failing regression was recorded before the fix at `buildPdfPlan`; a separate workflow
regression caught the unnecessary catalog lookup. All 64 focused tests pass, including
the real preview workflow, chosen-detail fallback, dense overview-only coverage and
a 90-Zone index retaining all 90 guide values without adding annotation pages.

The production worker generates 1 page for overview-only, 5 pages with three chosen
areas, and 14 pages with all nine original areas. Every export retains all 134 stored
guides on the overview; the full packet contains all 2,201 plants exactly once across
its nine detail maps with no unresolved identities. It prints 104 of 106 annotations;
the two uncovered notes are intentionally omitted under the corrected rule.
The overview-only PDF and the affected key page were visually inspected.

All 20 private SVG/Poppler comparisons pass the unchanged 0.25 tolerance (maximum
residual 0.096), together with Unicode font embedding, vector artwork, links and the
physical 50 mm calibration bar. Every run releases its workers. TypeScript, all
**2,317 frontend tests in 250 files**, both edition builds, the Web boundary scan and
the production validation build pass. Compact counts and hashes are under
`explicitCoverageRevision` in the [validation data](canvas-pdf-field-validation-data.json).
No new physical printer or packaged-native tests were performed; public-fixture
results below belong to the earlier run. User/agent guides, domain vocabulary, ADR
0024 and all 11 locales reflect the corrected scope. The source Design is unchanged.

## Earlier field-print polish (`canopi-46aj`, 2026-09-11)

The following evidence records the preceding revision. Its supplementary note coverage
was subsequently rejected and replaced by `canopi-kg34` above.

This revision follows `canopi-8d38` and implements the comparison with the approved
zone-dimension proposal. The overview has contextual text only, without annotation
indexes or N markers. Local appearance frequency selects simple enclosures or direct
Species Codes; bounded enclosure exchanges resolve codes blocked by measurement ink.
Ordinary P fallback identities are removed. P remains reserved for coincident groups.
Keys reserve usable drawing space before label placement and retain complete names,
counts and one sample per appearance. Zone-table rules clear multiline text; overview
zone references are unboxed, navigation numbers boxed, and the ground scale is separate
from the physical 50 mm calibration bar.

Uncovered spatial annotations receive supplementary coverage, with smaller frames
when planting context is dense. Each supplementary sheet prints its assigned deferred
notes only. Free-standing notes outside the artwork reuse an existing detail's notes
section instead of creating an empty map. Chosen Print Areas, authored geometry,
custom colours and the editable Design remain unchanged.

The final orchard review has **15 pages**: an overview, nine chosen details, four
key continuations and one supplementary detail. Detail numbering is consecutive
from 1 to 10. All 2,201 plants occur exactly once across the nine chosen details;
the supplementary sheet repeats 34 context plants. All 106 annotations and all
134 stored Measurement Guides are represented, including all guides on the
overview. There are no unresolved plant identities or ordinary P references.
The 24 native zones and the source Design are unchanged. Every review page was
visually inspected, with an additional grayscale review of the first detail.

A separate three-area coverage stress case contains 28 pages, including 23 smaller
supplementary details for notes outside the chosen views. It also retains every
annotation and guide with no unresolved plant identities. This demonstrates the
paper cost of sparse manual coverage; the nine-area review is the compact complete
orchard packet. Supplementary pages remain visible in the export preview.

Both private exports pass every SVG/Poppler page comparison: 43 comparisons, maximum
residual 0.097 against the unchanged 0.25 limit. Embedded Unicode fonts, vector
artwork, named links and the exact 50 mm overview calibration bar pass. Generation
took 4.11 seconds for the full review and 3.49 seconds for the partial-selection
coverage case; these are local observations, not device guarantees. All nine public
fixtures pass, including 10,000 plants across 99 pages in 2.54 seconds. All runs
release their workers. Hashes and detailed counts are recorded under
`fieldPrintRevision` in the [validation data](canvas-pdf-field-validation-data.json).

TypeScript, all **2,316 frontend tests in 250 files**, the final 48 focused tests
(including 36 field-proposal regressions), four Python verifier tests, both edition
builds, the Web boundary scan and the production validation build pass. User and
agent documentation, ADR 0024, domain vocabulary and all 11 locales agree with the
implementation. No runtime dependencies, Rust code or shared contracts changed.
Physical printer tests and a fresh packaged-native matrix remain separate from browser
worker, SVG-preview, grayscale screen review and edition-build checks.

## Earlier continuous brackets (`canopi-v36o`)

The approved continuous proposal is now implemented in the shared production layout.
Repeated appearance groups use external brackets with orthogonal stems, membership
dots, crossing gaps and readable references at both ends. Shallow horizontal sheets
can use spare paper for a complete quick key and a metre ruler. Authored ground
geometry is never divided or rearranged; unsuitable fields retain the established
local layout. Pinned names, coincident memberships, authored appearances and complete
paginated keys remain intact. Pale connector ink is darkened independently of marks.

All nine original orchard rectangles retain their exact coverage. The 19-page Chrome
export contains all 2,201 plants exactly once across the detailed views, with no
unplaced identities. Page 16 identifies 189 plants through 11 shared brackets and
three singletons. Its compact key includes all 14 Species and the complete note.
All 19 SVG/Poppler comparisons pass the unchanged 0.25 tolerance (maximum 0.106).
Embedded Unicode fonts, vector artwork, named links, page numbering and the physical
50 mm overview bar pass. The job took 6.94 seconds during local build activity and
released every worker after clearing; this is not an isolated timing benchmark.

TypeScript, all 2,239 frontend tests in 244 files, both edition builds, the Web
boundary scan and the production probe build pass. New regressions cover both
orientations, tilted strips, complete membership, appearance/pinned/coincident
exclusions, atomic fallback, bounded routing, crossing semantics, pale ink and the
complete quick key. No runtime dependencies or shared contracts were added. No
physical printer test or fresh packaged-native matrix was performed. The compact
data records this evidence under `sharedBracketRevision`. All nine public fixtures
also pass, including multilingual text and a 10,000-plant, 99-page export in 12.11
seconds. Every fixture releases its worker; the overview-only fixture stays a single
lightweight page.

## Earlier narrow-strip correction (`canopi-dcxj`)

The newer 19-page orchard export exposed a direction bias on page 16: a shallow
horizontal bed with 189 plants had 68 identity groups labelled inside its crowded
planting strip and four without placed labels. Rotating the same plants preserved
inferred row groups while removing missing labels, isolating placement direction
and target order as the cause.

That correction made narrow-sheet labels search outward along the short axis, remain clear of the
planting frame and are allocated in order along the long axis. The reproduction then had
166 nonempty identity groups covering all 189 plants, with none inside the strip.
The other 18 page plans are identical to baseline `8fe09a71`; exact coverage, scale,
all nine map/key pairs and the lightweight overview are preserved. The source PDF
and Design were not modified.

The production Chrome worker and PDF encoder generated all 19 pages. Poppler checks
passed embedded Unicode fonts, vector artwork, page/key links and the 50 mm bar.
All 19 SVG/PDF comparisons pass; the maximum residual is 0.106 against the unchanged
0.25 limit. Worker cleanup leaves zero workers. Generation took 12.5 seconds while
the full suite and builds ran concurrently; this is not an isolated performance
benchmark. The compact data file records this run under `narrowStripRevision`.

Four synthetic regressions cover horizontal, vertical and slightly tilted mixed
strips, complete identities, unchanged coverage, non-overlapping ink and transparent
labels. TypeScript, 92 focused PDF/snapshot tests, all 2,231 frontend tests across
243 files, both edition builds, the Web boundary scan and the production probe
build pass. No Rust or shared transport contract changed. Physical printing and a
fresh packaged-native matrix were not performed.

## Earlier four-area field layout evidence

The private orchard contains 2,201 plants and 117 Species. Production validation uses
the four exact rectangles from its supplied export: 371/410/323/263 plant placements
and 39/42/39/23 Species respectively. All placements retain their positions and authored
appearances, and every detail plant has a nonempty readable label allocation. The
eight detail/key SVG preview images are pixel-identical to the prior approved
production output; only the overview and its removed appendix change. The
selected 55 unique Annotations (57 occurrences) have visible anchors and full text in
the companion keys. The 67 unique complete Measurement Guides remain represented;
three cropped guides on the second detail link to their complete view on page 6.
The resulting PDF has nine pages: one overview plus four map/key pairs. No consent is
required for density or key pagination. All overview notes and measurements remain
in their authored positions, with text scaled to the artwork and no appendix. Source
files are unchanged. The overview-only export is one page rather than the reproduced
25-page failure (24 generated key pages).

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

The built Web Edition is tested through normal file import, explicit whole-design sheets,
split preview/cancel/apply, automatic local key pagination,
repeated actual downloads, retained session setup, drawing pages, zoom/orientation,
keyboard framing, inspection, overview navigation, compact workspace and page removal.
Frontend coverage includes exact coverage, complete identity and text retention,
transparent labels, leader clearance, aligned/cropped guides, final navigation,
long mixed-script keys, sample reflow across orientations, ink/row clearance, worker
cancellation and Design Session isolation. TypeScript, the full frontend suite, both
edition builds, the Web boundary scan and the production validation build are required.
The gates passed: 242 frontend files / 2,227 tests, 86 focused PDF tests and
four Python verifier tests, TypeScript, both edition builds and the production probe
build. Focused UI/area tests and TypeScript were rerun after correcting split-preview
fit and read-only navigation. No Rust or shared transport contract changed.

The real overview worker completed in 629 ms (60,637 bytes), and the four-field-sheet
worker in 2,939 ms (469,060 bytes), including font loading and encoding. A separate
warm Node layout-only experiment measured 2,305 ms for four sheets, 580 ms after
changing one sheet and 103 ms with all sheets reused. These are local observations,
not cross-device guarantees. The public 10,000-plant / 50-source-page fixture completed
in 14.4 seconds with 99 total pages. The private nine-page SVG/Poppler comparisons
remain below 0.113 against the unchanged 0.25 maximum. Current evidence and the prior
field-layout baseline are distinguished in the compact data file.

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
