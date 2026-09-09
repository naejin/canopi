# Canvas PDF evaluation tooling

`scripts/pdf-evaluation/` is an isolated technical fixture for `canopi-4nzq`, not production export code. Its package and lockfile contain only evaluation dependencies. Do not import this historical fixture from `desktop/web` or change it to track production behavior. The app owns its selected font manifest, assets and encoder under the [Canvas PDF guide](canvas-pdf.md). The selected foundation is recorded in `canopi-orpp` and ADR 0024; the [evidence brief](../canvas-pdf-evaluation.md) records the recommendation. The [native verification record](../canvas-pdf-native-verification.md) tracks the pre-UI platform gate `canopi-cd7x.1`.

Run from `scripts/pdf-evaluation/`:

```bash
npm ci --ignore-scripts
npm run fonts
npm run build
npm run serve
```

The font command fetches pinned public upstream bytes and licenses into ignored `public/fonts/`, checks SHA-256, and fails on network or integrity errors. `dist/`, `node_modules/`, `output/` and Python caches stay local. This isolated package retains the two compared encoders and their font engines for reproducibility. Its dependency graph is separate from the selected production pipeline.

Open the printed localhost URL in a browser. Generate each candidate and use Download sample PDF. For the accompanying JSON, call `window.evaluation.downloadReport()` in DevTools after generation. Place the downloaded `pdfkit.pdf`, `pdfkit.json`, `pdf-lib.pdf`, and `pdf-lib.json` under `output/`, then run:

```bash
npm run measure
npm run inspect
```

Inspection requires Poppler's `pdfinfo`, `pdffonts`, and `pdftotext` on PATH. It verifies downloaded byte hashes, identical candidate page plans, A4 page boxes, actual 50 mm vector segments, all fixture names/scripts, embedded fonts and independently extracted Japanese text widths. It rejects PDFKit font diagnostics or a shaped-preview width disagreement. pdf-lib's reader diagnostics are recorded as a failed candidate result; a zero script exit does not declare both candidates suitable. `measure-assets.mjs` traverses the Vite manifest to count each required module once and checks the pinned font bytes/licenses.

To inspect the checked-in historical samples without acquiring fonts or npm packages, create `output/` and copy the four candidate PDF/JSON files from `docs/assets/canvas-pdf/`, then run `python3 verify_pdf.py`. Do not regenerate historical timings during a docs-only edit. Output JSON is evidence, not a task tracker; work status belongs in `bd`.

The optional full-font control uses `await window.evaluation.run('pdf-lib-full')` in DevTools, followed by the same download button/report method. It performs one generation and produces a large local PDF; keep that PDF out of Git. The main comparison performs four generations per candidate, separately recording initial and subsequent runs. Browser heap samples are not peak-memory measurements or cross-process comparisons.

For independent rendering, use `pdftoppm -f 2 -singlefile -r 96 -png output/pdfkit.pdf output/pdfkit-detail`. The recorded no-system-font check supplied `FONTCONFIG_FILE` with a Fontconfig configuration whose only font directory was empty. PDFKit's rendered PNG hash was identical to the normal render; pdf-lib lost CJK text. Keep reader stderr, since successful text extraction or process exit alone can conceal substituted fonts.

The browser fixture owns its preview fonts, temporary anchors and object URLs. It deliberately does not import Design/session state or persistence. `fixture.mjs` supplies a synthetic physical page plan; Fontkit shapes its text; `pdfkit.mjs` and `pdf-lib.mjs` encode it. Preview glyph outlines and PDF text share lines, metrics and font bytes. This fixture does not supply the production runtime projection, pagination, Layer/Zone setup UI, cancellation, or edition adapters.

For production work, read the [Canvas PDF](canvas-pdf.md), [canvas runtime](canvas-runtime.md), [document lifecycle](document-lifecycle.md), [frontend](frontend-patterns.md), and [build/release](build-release.md) guides. Keep font loading and binary delivery under explicit lifetime owners, preserve save-acknowledgement boundaries, and follow the accepted decision rather than copying private library internals. Every change to encoder versions, font assets, shaping features or preview rendering requires repeating independent PDF/font checks.

## Native engine verification

After building the fixture, run from the repository root:

```bash
python3 scripts/pdf-evaluation/run_native.py scripts/pdf-evaluation/output/local-native
python3 scripts/pdf-evaluation/verify_native.py scripts/pdf-evaluation/output/local-native
```

The output directory must be new. Linux needs the system Python with PyGObject, GTK 3 and WebKitGTK 4.1; use `/usr/bin/python3` if a virtual environment hides GI. A display is required; CI uses `xvfb-run -a`. macOS needs the Xcode Swift tools and a graphical session. Windows needs .NET 8 and the WebView2 runtime; the isolated probe pins its WebView2 SDK in `native/windows/Probe.csproj`. Those dependencies belong only to this evaluation. Windows build outputs and the temporary WebView profile are ignored and excluded from evidence uploads.

`run_native.py` owns a loopback HTTP server and a native subprocess. The host runs the same `native/run-fixture.js`, which generates PDFKit output and captures three shaped-preview canvases. The native bridge writes only fixed filenames in the test-owned output directory, then removes handlers/timers and exits. Hosts have a 120-second deadline; the launcher also bounds subprocess execution and closes its server. These are small native engine hosts, not the Canopi Tauri application. They do not exercise Tauri asset routing/CSP, its save dialog, overwrite/cancel behavior or document-session integration.

The [native probe workflow](../../.github/workflows/pdf-native-probe.yml) runs Linux, Apple Silicon macOS, Intel macOS and Windows, then independently inspects the downloaded native artifacts on Linux with Poppler. Dispatch it manually to repeat this historical comparison; current production regression coverage uses the separate [production workflow](../../.github/workflows/pdf-production-probe.yml) on `main` and relevant pull requests. Runner labels follow the [official runner image catalog](https://github.com/actions/runner-images). Record actual OS and engine versions because runner images and Evergreen WebView2 change.

`verify_native.py` checks the saved PDF hash against the deterministic Chromium reference, the exact fixture, A4 boxes, 50 mm segments, embedded fonts, text extraction, shared-shaping metrics and preview dimensions. Byte equality is a useful stronger check for this fixed fixture, not a production export requirement. Review preview PNGs visually as well: dimensions alone cannot establish readability, and different engines may rasterize identical outlines differently. Retain compact verified evidence in docs; leave duplicate PDFs, full profiles and font assets outside Git. Physical-print review and final integrated edition tests remain downstream gates.
