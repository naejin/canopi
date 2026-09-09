# Canvas PDF production validation

Recorded 2026-09-09, beginning with `canopi-urxb` and extended for the revisions below. The user-approved implementation is integrated on `main`, including automatic area fitting and the page workspace. Physical-default approval and outstanding packaged-app checks remain open in `canopi-h0q3`, followed by the release audit in `canopi-1zbj`. Software approval does not establish printer or outdoor field-user evidence.

## Mainline verification

The [production native matrix](https://github.com/naejin/canopi/actions/runs/34376541459) passes at `b307a454` on Linux WebKitGTK, Apple Silicon and Intel WKWebView, and Windows WebView2. All four outputs have the same two-page mixed sample, physical plan and extracted text. Independent Poppler checks pass vector content, embedded Unicode fonts, both 50 mm calibration bars and all eight required preview comparisons. Image residuals are 0.0039–0.0136 against the unchanged 0.25 bound. Exact runtime versions and measurements are in the `nativePipeline` section of the [workspace evidence](canvas-pdf-workspace-validation-data.json).

`canopi-g0bc` corrects the native probe's obsolete three-preview assumption after automatic fitting reduced this sample to two pages. Hosts now admit one to three images, and production verification fails if any expected preview is missing. The historical encoder verifier retains its three-page reference checks. Local WebKitGTK runs additionally pass one-page multilingual and three-page legend samples. Three focused verifier tests cover required native images and intentionally optional browser stress previews; a missing image from a real native result also fails verification.

The integrated checkout passes TypeScript, all 2,154 frontend tests, both edition builds, the Web boundary scan, generated-binding checks, Rust formatting, strict Clippy, workspace check/tests and the native command policy guard. Housekeeping updates documentation, tracker handoffs and CI ownership; the production export behavior remains the approved workspace. The native matrix tests the production pipeline in owned WebView hosts, not the packaged Tauri save dialog or physical printing. Those checks remain in `canopi-h0q3`.

## Print workspace update

`canopi-cd7x.2` replaces the modal controls with the full-window page workspace: visible page thumbnails, one Add page flow, print-only dragging and keyboard framing, per-page zoom/Fit/orientation, temporary text inspection, automatic refresh and explicit legend-page actions. The PRD, ADR 0024 and current user/agent guides describe this behavior. Historical sections below retain the measurements for their own revisions.

The built Web Edition passes file import, explicit legend consent, two real downloads, retained setup, drawn-page creation, decimal zoom followed immediately by an orientation click, keyboard focus/framing, temporary inspection, overview navigation, page removal and the 860 × 700 workspace in Chrome 150.0.7871.46, Firefox 146.0.1 and Playwright WebKit 26.0 on Linux. Independent text/font inspection of all six downloads confirms identical complete text for 90 Species and embedded Unicode fonts. Additional Chrome interaction checks cover selecting a wide Zone, square fitting, dragging, and thumbnail rendering.

The production harness now includes nine samples. Its new framing sample applies independent overview/detail zoom and displacement plus a portrait override. Poppler verifies all nine PDFs for vector output, complete text, embedded fonts, page counts and one exact 50 mm calibration bar per canvas page. All six preview comparisons pass: residuals are 0.0108–0.0781 against the unchanged 0.25 bound. The manually framed detail measures 0.0108. Map-excluded and mixed plans remain identical, and all fixture workers are released.

The 50-page / 10,000-Plant sample generated in 1.86 seconds in the recorded Chrome run, with aggregate renderer RSS peaking at about 574 MiB. Its serialized plan includes the additional fitted area-picker surface. This is an observed run on this machine, not a resource-limit or performance promise. Visible-only thumbnail rendering bounds workspace SVG materialization independently of the page-plan size.

TypeScript, both edition builds, the Web boundary scan, the production harness build and the full frontend suite (230 files / 2,154 tests) pass. Focused coverage also checks cancelled/foreign-pointer gestures, full-area Fit after movement, Zone click versus drag, open Line Zone hit targets, automatic-refresh cancellation, retained missing selections, continuation reflow navigation, and focus restoration. SVG focus uses native lowercase `tabindex`.

[Compact workspace evidence](canvas-pdf-workspace-validation-data.json) records browser outcomes, sample measurements and independent PDF/image checks. Temporary files are under ignored `.tmp/pdf-workspace-review/`. No runtime dependency, Rust code, or cross-language contract changed in the workspace revision. Its initial verification covered browsers; the later mainline verification above also covers the current production pipeline in desktop WebViews. Packaged-app and physical paper review remain tracked in `canopi-h0q3`; none of these browser or PDF checks supplies printer measurements.

## Automatic page fitting update

`canopi-c4vf` replaces the original preset scales and forced tiling with full-area fit, numeric canvas zoom and independent page orientation. The original measurements below remain historical; their page counts, scale defaults and print pack do not describe this revised layout.

For that revision, the production harness generated all eight samples in Chrome on Linux: dense nursery 2 pages, mixed orchard 2, complete legends 3, multilingual 1, map-excluded 2, and the 1/10/50-page stress fixtures. Independent Poppler inspection passed complete text, embedded Unicode fonts, vector output, final numbering and one exact 50 mm calibration bar per canvas page. The five preview comparisons passed with mean neighbourhood residuals of 0.0112–0.0781 against the unchanged 0.25 bound. Mixed and map-excluded plans remain identical. Artifacts are in ignored `.tmp/pdf-fit-review/chrome/`.

A real built-Web-Edition flow in Chrome 150 verified automatic landscape for a wide Zone, portrait for a square Zone, independent 125.5% zoom and portrait override, retained settings after closing/reopening, and automatic 100% fit after drawing a Print Area. A real four-page PDF download has the expected three portrait pages and one landscape page. Layout/UI regressions also cover both paper sizes, complete selected-area containment, decimal zoom, explicit cropping, invalid inputs, stable page identity and complete legends across individually oriented continuation pages.

TypeScript, the full frontend suite (230 files / 2,148 tests), both edition builds and the production validation build pass. No Rust code or cross-language contracts changed. The native matrix recorded below was not rerun for this layout revision; packaged-app and physical paper review remain tracked in `canopi-h0q3`.

## Reproduce the samples

From `desktop/web`, run `npm run build:pdf-validation`, then serve `dist-pdf-validation/` on loopback. The harness imports the production Scene capture, worker, font loader, page planner, PDF encoder and SVG preview. It is an isolated validation entry point, not part of either shipped edition.

```bash
# Project root; use an unused port and a fresh output directory.
python3 -m http.server 4175 --bind 127.0.0.1 --directory desktop/web/dist-pdf-validation
uv run --with playwright==1.58.0 python desktop/web/scripts/pdf-validation/run-browser.py .tmp/pdf-review/chrome --chrome
python3 desktop/web/scripts/pdf-validation/verify.py .tmp/pdf-review/chrome/*.pdf
```

The Python inspector requires Poppler utilities and Pillow. The browser runner requires an installed Chrome or the selected Playwright browser. `--browser firefox` and `--browser webkit` select the other test engines. Local WebKit 26.0 needed Ubuntu's `libavif16`, `libgav1-1` and `libyuv0`; these were extracted into the owned test-browser cache rather than installed system-wide. Playwright WebKit runs on Linux despite its Safari-like user-agent string; this does not establish testing in the Safari application.

The native runner accepts `--fixture desktop/web/dist-pdf-validation --script desktop/web/scripts/pdf-validation/run-native.js`. Its original encoder-evaluation defaults remain unchanged. The [production workflow](../.github/workflows/pdf-production-probe.yml) builds and runs the current production modules on each desktop OS and independently inspects the resulting PDFs and preview images.

For the built Web Edition, serve `dist-web/` with the Web Vite preview command, then run `run-web-edition.py` against `http://127.0.0.1:4173/app/web.html`. It imports a portable Design, confirms that overflowing legends block export until explicitly accepted, requests two real PDF downloads, closes and reopens the preview, and confirms retained setup and renewed blocking when continuations are declined. It then creates a Print Area and exercises page framing, orientation, inspection, overview navigation and removal in the compact workspace.

Local review artifacts are in ignored `.tmp/canopi-pdf-review/`. `chrome-final/` contains corrected preview images and the original paper samples, which predate automatic page fitting. PDFs from the earlier `chrome/` run are also valid: the subsequent SVG preview correction did not change PDF contents or physical defaults. Generated PDF metadata contains creation time; fixtures, physical page-plan hashes and extracted text are deterministic.

## Representative output before automatic page fitting

| Sample | Plants | Pages | PDF bytes | Purpose |
| --- | ---: | ---: | ---: | --- |
| Dense nursery | 320 | 2 | 21,265 | Repeated species at deliberately dense nursery spacing; 1:20 detail |
| Mixed orchard | 120 | 4 | 20,168 | Zones, access path, pinned names, overlap, exact 1:100 and neighbor references |
| Complete legends | 100 | 3 | 17,865 | Long botanical/cultivar names and two explicitly accepted continuation pages |
| Multilingual | 120 | 1 | 102,049 | Latin, Cyrillic, Chinese, Japanese and Korean in one document |
| Map excluded | 120 | 4 | 20,168 | Identical plan and extracted text to mixed orchard with extra visible map-layer state |
| One-page fixture | 100 | 1 | 12,923 | Small export baseline |
| Ten-page fixture | 900 | 10 | 56,821 | Repeated scaled Print Areas |
| Fifty-page fixture | 10,000 | 50 | 485,285 | Large site with 49 selected detail areas |

All eight fixtures have identical physical-plan hashes and extracted PDF text in Chrome, Firefox and Playwright WebKit. Independent inspection confirms the expected page counts, full multilingual text and every cultivar identity, embedded Unicode fonts, vector drawing, and one exact 50 mm bar per canvas page. The 50-page sample contains all 50 calibration bars. The real Web Edition's repeated 90-species downloads contain every species exactly once and identical extracted text.

Image comparisons exposed a Preact-specific bug that ordinary page-plan tests could not catch: camelCase SVG stroke/clipping attributes were ineffective. Native SVG spellings now preserve stroke widths and clipping. The regression has a focused rendered-SVG test and an independent Poppler-versus-preview image gate. Comparisons allow one pixel for renderer antialiasing; corrected samples measure 0.010–0.078 mean residual per colour channel, against a 0.25 limit. All four faulty original previews fail that gate (0.445–22.312). Raw image differences are also recorded; raw averages alone penalized dense but correct text.

## Runtime evidence for the original layout

The first production matrix, [run 34353834513](https://github.com/naejin/canopi/actions/runs/34353834513), passed generation, native fixed-path byte delivery, page-plan equality and independent PDF checks on all four hosts. The corrected-preview [run 34355476818](https://github.com/naejin/canopi/actions/runs/34355476818) passed all four hosts and the independent image/PDF verification job. Three preview pages per native host match the corresponding Poppler-rendered pages within the recorded antialiasing allowance.

| Runtime | Actual version | Coverage |
| --- | --- | --- |
| Linux WebKitGTK | 2.52.6; local Linux 7.0.0-31 and CI Linux 6.17.0-1022 | Production inline worker, same-origin fonts under CSP, four-page orchard, native fixed-path delivery |
| macOS ARM64 WKWebView | macOS 14.8.9, engine 19618.3.11.11.5 | Same production native probe |
| macOS Intel WKWebView | macOS 15.7.9, engine 20621.3.11.11.3 | Same production native probe |
| Windows WebView2 | Windows NT 10.0.26100.0, engine 151.0.4129.101, SDK 1.0.2903.40 | Same production native probe |
| Chrome on Linux | 150.0.7871.46 | All samples, resource measurements, built Web Edition import/consent/repeated download/retention |
| Firefox on Linux | 146.0.1 | All samples and built Web Edition flow |
| Playwright WebKit on Linux | 26.0 | All samples and built Web Edition flow |

The native probe uses real OS WebViews in small owned windows served over loopback with a restrictive CSP. It exercises the production modules and a fixed-path native bridge. It does **not** launch the packaged Canopi Tauri application, its asset custom scheme, or its native save dialog. Manual packaged-app checks for destination choice, cancel, overwrite, and error/retry remain part of the human gate, as do actual Safari/Edge app checks where required. The earlier [native foundation evidence](canvas-pdf-native-verification.md) separately covers embedded mixed-script fonts in the chosen encoder on all desktop engines.

## Resource measurements and recovery for the original layout

The corrected-preview Chrome run measured these generation times and aggregate renderer RSS, sampled every 25 ms on Linux. Renderer RSS includes worker threads, shared memory, the loaded test page and prior runtime allocations; it is not a retained-heap or leak measurement. Browser validation and builds shared the machine, so these are observed runs, not performance promises.

| Pages | Plants | Generation | Serialized plan | Renderer RSS before / peak |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 100 | 0.37 s | 88,121 B | 350 / 358 MiB |
| 10 | 900 | 0.57 s | 1,328,556 B | 354 / 366 MiB |
| 50 | 10,000 | 2.05 s | 14,365,296 B | 355 / 552 MiB |

An earlier run measured 1.81 s for 50 pages in Chrome, 2.51 s in Firefox and 7.34 s in Playwright WebKit. The 1/10/50 sizes are fixtures, not product limits. The provisional 200-page coverage guard, 120-second worker deadline, 30-second font/name waits and native 64 MiB payload admission remain explicit engineering bounds pending final release-policy review. These measurements do not establish that every 200-page or 64 MiB document is appropriate on every device.

Both edition packages include four pinned Noto assets totalling 49,907,420 bytes plus licenses. Latin/Cyrillic-only samples request only the 569,208-byte Noto Sans font; the mixed-script sample requests all four. Fonts are fetched from the app's own base URL and SHA-256 verified. No fixture initiated a map/provider request. Runtime name lookup can use the existing catalog reader; failed or stalled lookup falls back to complete botanical names.

Every browser fixture reports zero remaining export workers after teardown. Focused tests cover failed/missing/corrupt fonts, stalled font and name requests, encoding and delivery errors with retry, worker deadlines and cancellation, repeated downloads and Blob URL cleanup, cancelled native dialogs, stale completion and Design replacement. A pre-cancelled native operation no longer opens a dialog. Export setup and delivery remain outside Design persistence and save acknowledgement.

## Paper review still required

The user has been given the nursery, orchard and complete-legend PDFs for review. Print them at 100% / actual size on ordinary colour and monochrome printers. Record printer model, paper, driver/viewer settings, measured 50 mm bar length, indoor/outdoor readability, identification of nearby plants using the page's legend, continuation use and navigation between selected detail areas. Regenerate the samples from the current layout before reviewing; the original pack predates automatic page fitting. The dense sample represents nursery spacing; the large overview deliberately shows why detailed coverage is needed.

Current physical values are provisional: A4; automatic full-area fit with independent canvas zoom and page orientation; 10 pt legend text with 13 pt line spacing; 3 mm nominal plant symbols; 0.25 mm geometry strokes; 42 mm legend column; 10 mm margins; and 3 mm Zone context. Fixed detail-scale defaults and overlapping-sheet pagination were replaced in `canopi-c4vf`. The final decision must preserve complete names, authored symbols/colours and honest physical scales. No printer settings, measurements or field-user approval should be inferred from these screen or PDF checks.

The pending decision and resulting default application remain in `canopi-h0q3` and `canopi-1zbj`. The epic stays open until those requirements and its completion audit are satisfied.

## Completion evidence for the original implementation

The combined checkout includes both prerequisite fixes and all six PDF implementation/validation beads. `canopi-urxb` records the technical completion. [Compact measured data](canvas-pdf-validation-data.json) preserves browser timings, resource samples, file/plan/text hashes, image comparisons, actual runtime versions and native CI results beyond temporary artifact retention.

Quality gates pass: 230 frontend test files / 2,140 tests; TypeScript; desktop and Web builds; Web boundary scan; Rust formatting, Clippy with warnings denied, workspace check and workspace tests; and all 13 native command-policy tests. Two pre-existing manual Species Search benchmark/relevance harnesses remain ignored in the ordinary Rust suite. Docs-only follow-up edits used link/diff checks and did not repeat code tests.
