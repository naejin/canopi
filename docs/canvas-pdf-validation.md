# Canvas PDF production validation

Recorded 2026-09-09 for `canopi-urxb`. The implementation is available on the stacked PDF branches. Release-default approval remains open in `canopi-h0q3`, followed by `canopi-1zbj`. No actual printer or outdoor field-user review has been performed by the agent.

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

For the built Web Edition, serve `dist-web/` with the Web Vite preview command, then run `run-web-edition.py` against `http://127.0.0.1:4173/app/web.html`. It imports a portable Design, confirms that overflowing legends block export until explicitly accepted, requests two real PDF downloads, closes and reopens the preview, and confirms retained setup and renewed blocking when continuations are declined.

Local review artifacts are in ignored `.tmp/canopi-pdf-review/`. `chrome-final/` contains corrected preview images and the current paper samples. PDFs from the earlier `chrome/` run are also valid: the subsequent SVG preview correction did not change PDF contents or physical defaults. Generated PDF metadata contains creation time; fixtures, physical page-plan hashes and extracted text are deterministic.

## Representative output

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

## Runtime evidence

The first production matrix, [run 34353834513](https://github.com/naejin/canopi/actions/runs/34353834513), passed generation, native fixed-path byte delivery, page-plan equality and independent PDF checks on all four hosts. The corrected-preview matrix adds image verification; its final result is recorded with the completion evidence below.

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

## Resource measurements and recovery

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

The user has been given the nursery, orchard and complete-legend PDFs for review. Print them at 100% / actual size on ordinary colour and monochrome printers. Record printer model, paper, driver/viewer settings, measured 50 mm bar length, indoor/outdoor readability, identification of nearby plants using the page's legend, continuation use and navigation across adjoining sheets. The dense sample represents nursery spacing; the large overview deliberately shows why detailed coverage is needed.

Current physical values are provisional: A4; common detail scale 1:100; 10 pt legend text with 13 pt line spacing; 3 mm nominal plant symbols; 0.25 mm geometry strokes; 42 mm legend column; 10 mm margins and overlap; 5 mm Zone context at the chosen scale. The final decision must preserve complete names, authored symbols/colours and honest physical scales. No printer settings, measurements or field-user approval should be inferred from these screen or PDF checks.

The pending decision and resulting default application remain in `canopi-h0q3` and `canopi-1zbj`. The epic stays open until those requirements and its completion audit are satisfied.
