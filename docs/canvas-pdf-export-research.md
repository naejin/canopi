# Canvas PDF export: research brief

Research date: 2026-09-09. Local baseline: `466c577d`. Research bead: `canopi-u7r3`. Subsequent PRD: `canopi-cd7x`.

The agreed product scope follows [ADR 0024](adr/0024-shared-canvas-pdf-export.md): Canvas PDF on Linux, macOS, Windows, and Web; user-selected Design Layers and detail coverage; physical scales; readable page-specific legends; and preserved Design content. All map backgrounds and Timeline, Budget, and Consortium sections are deferred. This brief supplies recommendations and validation gates, not new accepted architecture decisions. No PDF implementation, library installation, provider account, map capture, or physical print test was performed.

Scope revision, 2026-09-09: retain print-layer selection but remove map export from v1. Provider research below is preserved for later work; provider selection, map acquisition/alignment, and map-failure handling no longer gate the first release. Interactive Web maps remain a separate plan.

## Research Questions

| Question | Downstream decision |
| --- | --- |
| Which existing boundaries can supply consistent export input without changing the Design? | Architecture and first slice |
| Which browser-compatible PDF engines merit evaluation? | Dependency choice and technical validation |
| How can text remain consistent across languages and operating systems? | Font assets and acceptance criteria |
| How should physical scale and paper readability be validated? | Defaults and testing |
| Which street-map findings should be retained for later work? | Deferred scope only; no v1 dependency |
| What establishes parity across desktop and Web, including failures? | Lifecycle, resources, and release validation |

## Evidence

### Shared input and physical layout

**Local facts.** [CanvasQuerySurface](../desktop/web/src/canvas/runtime/runtime.ts) exposes scene snapshots, revision, placed Plants, and localized Common Names. The [persistence seam](../desktop/web/src/app/document-session/persistence.ts) demonstrates consistent capture and session-transition checks, but also owns save acknowledgements. The existing [native export service](../desktop/src/services/export.rs) accepts a PNG snapshot and native layout; it is not the shared PDF architecture. [Browser `.canopi` download](../desktop/web/src/web/browser-design-session.ts) participates in persistence, so only its lower-level download mechanics are relevant to PDF delivery.

[Plant presentation](../desktop/web/src/canvas/runtime/plant-presentation.ts), [Annotation layout](../desktop/web/src/canvas/runtime/annotation-layout.ts), and [text visibility](../desktop/web/src/canvas/runtime/text-visibility.ts) contain screen-scale behavior. [Canvas bounds](../desktop/web/src/canvas/runtime/camera.ts) also depend on presentation scale. Copying a viewport or merely increasing its bitmap resolution would preserve inappropriate fading and screen-dependent footprints.

**Recommendation.** Capture one immutable export input through the existing authority seams: settled scene content, required Design metadata, resolved plant appearances and localized names, print options, and a session/revision identity. Location and map state are not v1 rendering inputs. Keep save acknowledgement outside export. Derive one page plan containing physical frames, transforms, Species entries, continuation pages, and final page references; use it for preview and PDF. Resolve fonts before measuring legends and finalizing pagination. This is derived output, not another editable Design model.

Prefer vector text, symbols, Zone geometry, and navigation on the agreed white background. Reuse geometry and appearance rules through appropriate runtime seams; do not import renderer internals into app code. Start with a bounded encoder evaluation before choosing how much rendering logic needs extraction. No map surface or image-acquisition pipeline is needed for v1.

### PDF engine comparison

No PDF-generation package is currently declared in [the frontend manifest](../desktop/web/package.json).

| Candidate | Source-backed capability | Implication for Canopi |
| --- | --- | --- |
| PDFKit | Current documentation describes a browser ESM build, memory-loaded assets, and chunk collection. The release list identifies `0.20.2`; the `0.20` changes remove Node-specific browser dependencies. [`toBlob`/`toBytes` remain experimental](https://pdfkit.org/docs/getting_started.html). [Release evidence](https://github.com/foliojs/pdfkit/releases). | First evaluation candidate. Test the exact pinned release in Vite and supported WebViews; use a small byte-output adapter rather than exposing experimental helpers throughout the app. |
| pdf-lib + `@pdf-lib/fontkit` | Pure JavaScript/TypeScript, browser support, vector drawing, PNG/JPEG embedding, custom fonts and text measurement. [Official API examples](https://pdf-lib.js.org/). The release list still identifies [`1.17.1`](https://github.com/Hopding/pdf-lib/releases). | Credible lower-level alternative if PDFKit integration fails. Canopi would own more text layout. Review maintenance and font edge cases; release cadence alone does not establish reliability. |
| jsPDF | Browser builds, custom TTF fonts, and an advanced drawing mode with transformation matrices. [Official repository](https://github.com/parallax/jsPDF). | Reserve alternative. No demonstrated advantage yet warrants evaluating a third complete integration. |

**Recommendation, not selection:** compare PDFKit and pdf-lib with the same small multilingual, multi-page fixture. Measure actual lazy-loaded bundle/font bytes, generation time, memory, text extraction, and output fidelity. PDFKit's recent browser changes make old advice that it necessarily requires Browserify/Node polyfills stale; they also warrant regression checks. No package-size or performance benchmark was run here.

### Fonts and naming

**Local facts.** [The 11 UI languages](../desktop/web/src/i18n/index.ts) include Chinese, Japanese, Korean, and Russian. [CSS](../desktop/web/src/styles/global.css) uses platform font fallbacks, and the tracked repository contains no TTF/OTF/WOFF font assets. System fallback cannot establish identical PDF metrics across platforms.

[PDFKit supports embedded font formats and OpenType features](https://pdfkit.org/docs/text.html); pdf-lib's custom-font path likewise requires explicit font bytes. [Noto CJK](https://github.com/notofonts/noto-cjk) provides regional families, with [SIL OFL licensing](https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE). These establish feasible ingredients, not verified Canopi glyph coverage.

**Recommendation.** Package versioned, licensed font assets with the static app, load the required families on demand, and subset embedded PDF fonts where supported. Font coverage must follow actual text as well as UI locale: an English Design can contain Japanese Annotations. Validate mixed scripts, accents, multiplication signs, long names, line breaking, and language-appropriate CJK glyphs. Use the same font bytes and metrics for preview and PDF. A missing glyph or failed font load needs a visible error or verified fallback, never a silent missing-name box. Keep the accepted local Common Name/full Canonical Name fallback and Species identity rules.

**Existing dependency:** open bead `canopi-qj4w` tracks a cross-locale Common Name fallback in the [Web Species Catalog adapter](../desktop/web/src/web/duckdb-wasm-catalog.ts). Resolve or explicitly isolate that source before claiming PDF naming parity. The prior audit established the issue by source inspection; this research did not reproduce it at runtime.

### Physical scale, raster density, and print controls

For scale `1:N`, one Design metre occupies `1000/N` millimetres, or `72000/(25.4*N)` PDF points. Physical size is independent of screen zoom, device pixel ratio, and raster sampling density.

Calculated examples, not print-test results:

| Detail scale | Paper spacing for Plants 0.5 m apart | Ground width in a 145 mm canvas column |
| --- | ---: | ---: |
| 1:20 | 25 mm | 2.9 m |
| 1:50 | 10 mm | 7.25 m |
| 1:100 | 5 mm | 14.5 m |
| 1:200 | 2.5 mm | 29 m |
| 1:500 | 1 mm | 72.5 m |
| 1:1000 | 0.5 mm | 145 m |

The illustrative 145 mm column comes from A4 portrait with 10 mm margins, a 40 mm legend, and a 5 mm gutter. Allowing another 20 mm vertically for page information leaves 257 mm of canvas height. These dimensions are experiment inputs, not defaults. The calculation supports the six presets but cannot establish a universally readable default.

[Adobe distinguishes Actual size from Fit](https://helpx.adobe.com/uk/acrobat/desktop/print-documents/set-up-and-print-pdfs/page-size.html): Fit changes the printed scale. Recommend a concise actual-size instruction and a measurable calibration segment in the validation samples. A browser bitmap's [96-dpi metadata](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob) must not determine PDF placement.

At 300 pixels/inch, a full A4 raster requires approximately 2481 × 3508 pixels when rounded upward: about 33 MiB for one uncompressed RGBA buffer, before temporary copies and PDF encoding. If the encoder evaluation uses rasterized Design content, this calculation supports page-at-a-time handling, not a claim of constant total memory.

### Deferred street-map export research

These findings are retained from the original research for a later release. They create no v1 implementation tasks or acceptance gates. Revalidate provider terms and capabilities when map export resumes.

**Local facts.** [The street source](../desktop/web/src/maplibre/config.ts) is `tile.openstreetmap.org`. [Projection](../desktop/web/src/canvas/projection.ts) is local Mercator with a saved Location origin; [camera conversion](../desktop/web/src/canvas/maplibre-camera.ts) includes north bearing and a 512-pixel world-tile convention. The local frame warns above a 10 km radial extent. Printing accurate Design coordinates does not turn this into surveyed ground accuracy.

| Source/approach | Evidence | Planning consequence |
| --- | --- | --- |
| Existing OSM public raster tiles | The [tile policy](https://operations.osmfoundation.org/policies/tiles/) requires attribution, identification/referrer and caching, and prohibits bulk/prefetch fetching and headless pan/zoom harvesting. It does not state that every PDF is prohibited. | Do not assume automated detail-sheet capture is permitted just because interactive maps work. Validate the exact request pattern or use an explicitly compatible export service. |
| MapTiler Static Maps | The [API](https://docs.maptiler.com/cloud/api/static-maps/) requires a paid plan and documents 2048-pixel base dimensions plus `@2x`. [The area guide](https://docs.maptiler.com/guides/maps-apis/static-maps/static-map-area/) says bearing/pitch are unsupported. [Terms](https://www.maptiler.com/terms/cloud/) limit standard printed use to internal purposes, A4 at 300 DPI and subscription circulation limits; export outside the service is listed under uses requiring written agreement. | A working API does not settle shareable field-PDF rights, US Letter coverage, or multi-sheet use. Nonzero Design bearing also needs extra rotation/cropping work. Do not select it without a compatible agreement. |
| Geoapify Static Maps | The [product FAQ](https://www.geoapify.com/static-maps-api/) explicitly permits caching and commercial printed maps without additional print charges. [API documentation](https://apidocs.geoapify.com/docs/maps/static/) supports bearing, fractional zoom, language and density parameters. [Terms](https://www.geoapify.com/terms-and-conditions/) retain plan limits and attribution requirements. | Strongest candidate from this comparison for a direct browser-compatible basemap image. Confirm app/end-user usage, public-key restrictions, quotas, costs, attribution, and PDF-sharing rights for the chosen plan before adoption. |

**Recommendation for later map work.** Evaluate a direct static-image request per page, containing only map frame/style parameters; compose the Design locally. This can avoid a separate WebGL capture surface. It need not change the interactive basemap provider. Validate projection against control points at several latitudes and nonzero bearings; matching a geographic bounding box alone does not guarantee matching aspect ratio, padding, zoom conventions, or scale.

If static images cannot meet alignment/readability needs, evaluate an isolated MapLibre export surface using an approved source. The installed MapLibre 5.21.1 sources expose explicit pixel ratio and readiness APIs, but readiness must be combined with error/timeout tracking. Preserve the agreed Retry/Export without map choice and page geometry. Both approaches need real browser CORS checks: [cross-origin canvas capture can fail even when an image displays](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image).

**Uncertainty:** Geoapify's FAQ describes a 4096 × 4096 maximum, while its API schema describes base dimensions up to 4096 with a separate density multiplier. Verify returned dimensions and plan limits; do not promise 8192-pixel output from documentation alone. [MapTiler key guidance](https://docs.maptiler.com/guides/maps-apis/maps-platform/how-to-protect-your-map-key/) also illustrates why browser origins and desktop headers must be tested separately. No Canopi backend proxy or secret embedded in the static bundle is proposed.

Later map validation should compare 150/200/300 pixels/inch, alignment at nonzero bearings, readable map labels and attribution, CORS, denied requests, rate limits, and timeouts. Increasing image density alone does not establish label readability. Map frame requests disclose the requested location/extent even when Plant and Annotation content stays local; this does not imply offline map support.

### Cross-platform parity

[Tauri uses WebView2 on Windows and WebKit through WKWebView/WebKitGTK on macOS/Linux](https://v2.tauri.app/reference/webview-versions/). A Chromium browser pass is therefore insufficient evidence of desktop parity.

**Recommendation.** Define parity as identical page geometry, content, names, and usable save/download behavior for the same frozen input. Do not require byte-identical PDFs, which may contain timestamps or different compression. Own export jobs, workers, font requests, and object URLs explicitly. Cancel or discard stale work on Design replacement; retain print setup across preview closure as agreed. Keep the browser preview independent of an assumed built-in PDF viewer and independent of interactive map readiness.

## Implications for PRD

Retain ADR 0024's revised scope. Keep a print selector for exportable Design Layers, initially matching their canvas visibility, with overrides confined to export setup. Specify observable results for layer-filtered overview bounds, chosen detail scales, complete legends and explicit continuations, final page references, authored presentation, and session-only setup. Clarify that the ruler measures Design metres at actual-size printing. Multilingual output remains a first-release requirement. Explicitly exclude map options, map acquisition, and provider-dependent export behavior from v1.

### Proposed print-validation plan

Use deterministic synthetic Designs. The existing [zoom-calibration fixtures](../desktop/web/src/__tests__/support/zoom-calibration-scenes.ts) are reusable starting points, but their dense scene uses 1.5 m spacing and distinct synthetic Species for every Plant. Add deliberate 0.5 m spacing and realistic repeated Species in future print fixtures; do not treat screen-calibration images as paper evidence.

| Sample | Variations | Evidence required |
| --- | --- | --- |
| Dense planting bed | 1:20/50/100; 0.5 m spacing; pinned names; overlapping symbols | Readers identify actual Plants and read retained text; collisions are recorded, with no automatic remapping. |
| Mixed garden | 1:100/200; rotated Zone; context Plants/paths; excluded distant objects; Print Area without Zones | Correct extent, context, physical distances, layer filtering, and sheet-to-overview navigation. |
| Large sparse site | 1:500/1000; multiple areas and scale overrides; adjoining-sheet overlap | Complete coverage, stable scale across tiles, usable edge references and final page numbers. |
| Legend stress | Long local names; Canonical fallback; duplicate Common Names; appearance variants; overflow and continuation refusal | No Species lost or merged incorrectly; complete names; overflow blocks as agreed; ambiguity stays non-blocking. |
| Language stress | Mixed Latin/Cyrillic/CJK text; all 11 locale naming paths | Correct glyphs and name fallback; equivalent preview/PDF content. |
| Map exclusion | With/without saved Location; map/terrain visible on the interactive canvas; unavailable map provider | White PDF background, no map options, no map requests initiated by export, and identical Design output independent of map readiness. |

Compare A4 and US Letter, both orientations, at actual size. Start with legend text at 10/11/12 pt, columns at 35/40/45 mm, 10/12 mm margins, and 5/10 mm overlap. Hold other variables fixed when comparing. These are sample settings only; avoid an exhaustive Cartesian product.

Print the critical samples on an ordinary colour inkjet and monochrome laser printer. Review in normal indoor and outdoor light with at least two intended field users. Ask them to identify Plants, find the correct neighbouring sheet, read the longest legend entry, and measure a known distance. Record errors, task time, printer settings, and comments. Grayscale assessment must not trigger automatic colour/symbol substitutions.

Proposed geometry checks: a 100 mm calibration segment within 0.1 mm in PDF coordinates and within 1 mm on a correctly configured physical print; investigate printer scaling separately. Reject missing glyphs, clipped text, incomplete legends, or lost printable objects. Select readability defaults from the physical review, not from these proposed tolerances. Marker footprints, strokes, and authored Annotation font sizes also need an explicit physical-unit policy.

Automate page dimensions, all six scales, coverage/overlap, Layer selection, Species identity and final references. Render generated PDFs with an independent PDF renderer and compare content to the preview plan. Run representative output in Linux WebKitGTK, macOS WKWebView, Windows WebView2, and Web Chrome/Edge/Firefox/Safari. Record actual runtime versions. Test cancellation, Design replacement, missing/failed font loads, interrupted downloads, repeated exports, and map independence. Use bounded 1/10/50-page stress fixtures to measure memory/time before setting production limits.

## Implications for Issue Breakdown

The following delivery breakdown is proposed for PRD `canopi-cd7x` and awaits user review; child beads have not been created. Feature slices include UI, shared layout, preview, PDF delivery, and behavior tests. AFK means agent execution after dependencies close; HITL requires human judgment or physical validation. All proposed slices are P2.

| Order | Proposed slice | Type / mode | Blocked by | PRD stories |
| --- | --- | --- | --- | --- |
| 1 | Evaluate multilingual PDF output with the candidate encoders and font assets | task / AFK | None | 1, 9, 10, 14, 15, 18 |
| 2 | Choose the PDF foundation and settle preview edge-case rules | decision / HITL | 1 | 1, 3, 9, 13, 15, 16 |
| 3 | Preview and export an overview with authored presentation and readable localized legends | feature / AFK | 2, `canopi-qj4w` | 1, 2, 6, 9, 10, 12, 14, 15, 16, 17 |
| 4 | Select print Layers and retain setup while editing the Design | feature / AFK | 3 | 3, 13 |
| 5 | Export selected Zones as scaled detail sheets with overlap and navigation | feature / AFK | 4 | 2, 4, 6, 7, 8, 9 |
| 6 | Draw Print Areas and override individual area scales | feature / AFK | 5 | 5, 7, 8, 13 |
| 7 | Export complete legends with explicit continuation pages and final references | feature / AFK | 5 | 9, 11, 12 |
| 8 | Validate export recovery, resources, and representative output | task / AFK | 6, 7 | 1, 10, 11, 13, 15, 16, 17, 18 |
| 9 | Validate field prints and actual platform evidence, then choose release defaults | decision / HITL | 8 | 1, 6, 7, 9, 14, 15, 18 |
| 10 | Apply validated defaults and complete combined PDF release checks | task / AFK | 9 | All |

Slice 3 already includes session guards, cancellation/error outcomes, map exclusion, and blocking unresolved legend overflow. Later validation extends coverage and measures resource behavior; it does not defer those invariants. Slice 7 adds the explicit continuation option. Physical dimensions remain evaluation parameters until the paper review; early slices are delivery increments and do not reduce the full v1 release contract.

Keep module ownership explicit when implementation is later sliced. New dependencies and any new binary-save IPC need their own justification and repository gates. Do not revive the retired Rust report renderer. Defer map export beyond v1; provider, map-capture, and map-failure work must not become v1 dependencies. Interactive Web maps remain separate work.

The requested work order is PRD, reviewed delivery beads, `canopi-qj4w`, `canopi-90wm`, then PDF implementation. Represent `canopi-qj4w` as the actual dependency of the overview slice that consumes the affected catalog projection. The colour-chrome fix is a scheduling preference, not a technical PDF dependency. Do not duplicate either existing bug.

## Updated Assumptions

- Shared browser-compatible generation remains feasible from documented capabilities, but has not been prototyped in this repository.
- Existing scene logic is reusable input; screen snapshots and CSS font fallbacks are insufficient export contracts. Geographic projection and map acquisition are outside v1.
- PDFKit is a stronger browser candidate than older packaging advice suggests. Library choice remains provisional.
- Retaining Design Layer selection adds no map-provider dependency. The export overrides remain separate from saved canvas visibility.
- Provider comparisons remain evidence for deferred map work only. No provider or spend is needed or approved for v1 by this brief.

## Open Questions

1. Which encoder/font combination passes actual WebView and multilingual tests, at what bundle and memory cost?
2. Which default detail scale, paper default, font sizes, marker/stroke sizes, column width, margins, overlap, and Zone padding survive paper review?
3. Which production page/object/resource limits follow from measured performance? The stress-fixture sizes above are not user-facing limits.
4. The PRD should settle small remaining interaction cases: empty printable extent, removed/renamed Zones or Layers in a retained setup, and how one Species with multiple authored appearances is represented in its legend. None justifies reopening the overall scope.

Deferred map questions: provider plan, retained/shared PDF rights, attribution, quotas, public credentials, actual image dimensions, CORS, and projection remain unverified. They are not v1 blockers.

## Recommended Next Skill

The **to-prd** step is recorded as epic `canopi-cd7x`. Continue **to-issues** by reviewing the proposed breakdown above before creating child beads. Preserve the encoder, font, interaction, and readability choices as explicit validation gates; keep map-provider work deferred. Return to grill-with-docs only if validation requires another scope change.
