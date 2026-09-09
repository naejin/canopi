# Canvas PDF native WebView verification

2026-09-09 · `canopi-cd7x.1` · prerequisite of `canopi-orpp`.

The user approved checking the recommended PDFKit foundation in actual desktop WebViews before investing in export UI. This gate extends the [encoder evaluation](canvas-pdf-evaluation.md); it supplies compatibility evidence for the subsequent foundation choice; physical defaults still require paper review. [ADR 0024](adr/0024-shared-canvas-pdf-export.md) remains the accepted scope.

## Verified evidence

[CI run 34339546058](https://github.com/naejin/canopi/actions/runs/34339546058) passed all four native jobs and the independent inspection job at fixture commit `2b8eb100`. The downloaded artifacts were independently reinspected locally with identical inspection results.

| Host | Actual OS / engine | Result |
| --- | --- | --- |
| Linux GTK 3 / WebKitGTK 4.1 | Ubuntu 24.04, WebKitGTK 2.52.6 | Pass |
| Apple Silicon macOS / WKWebView | macOS 14.8.9, WebKit framework 19618.3.11.11.5 | Pass |
| Intel macOS / WKWebView | macOS 15.7.9, WebKit framework 20621.3.11.11.3 | Pass |
| Windows / WebView2 | Windows Server 2025, WebView2 151.0.4129.101, SDK 1.0.2903.40 | Pass |

Every host produced three 794 × 1123 shaped-preview canvases and natively saved the **same 187,658-byte PDF** as the Chromium reference. Poppler 24.02 independently verified A4 page boxes, three 50 mm vector calibration segments, four embedded font subsets without reader diagnostics, complete multilingual text extraction and Japanese text widths. Preview/PDF shaped-width differences remain below 0.000000000001 pt. No raster image objects appear in the PDF.

The [machine evidence](assets/canvas-pdf/native/verification.json) records each runtime, user agent, PDF and preview hashes, independent inspection and timing samples. [Linux](assets/canvas-pdf/native/linux-detail.png), [Apple Silicon Mac](assets/canvas-pdf/native/macos-arm64-detail.png), [Intel Mac](assets/canvas-pdf/native/macos-intel-detail.png) and [Windows](assets/canvas-pdf/native/windows-detail.png) detail previews were visually reviewed: plan text and full multilingual legend entries are present, with the same layout. Platform rasterization can differ; PNG equality is not required. The [reference PDF](assets/canvas-pdf/pdfkit.pdf) is retained once because all native PDF hashes match it. Full native reports, three previews per host and duplicate PDFs remain in the CI artifacts for their 14-day retention.

Local Linux WebKitGTK 2.52.6 also passed generation and independent inspection. A deliberate missing Japanese font propagated HTTP 404 and exited nonzero in 1.8 seconds without publishing a PDF or report; the test restored the font afterwards. The original PDFKit/pdf-lib comparison inspector still passes, including its expected rejection of pdf-lib's invalid embedded CJK fonts.

The same production-built isolated fixture loads pinned font bytes, draws its shaped preview, generates the three-page PDF and passes bytes through each host's native message bridge to a fixed test path. Production app dependencies and native commands are unchanged. Node 22.23.2 and npm 10.9.8 built the fixture on every CI platform. Windows targeted .NET 8 using the runner's selected .NET SDK 10.0.400; its evaluation-only SDK emitted a `WindowsBase` conflict warning through its WPF reference, while the WinForms host built and ran successfully. That warning and existing Vite chunk-size/Actions runtime notices were not suppressed and do not concern Canopi runtime dependencies.

Byte equality is useful evidence for this deterministic fixture. Product parity still means equivalent content and geometry rather than universally identical serialization. Timing samples span different machines and are not an OS performance ranking or a production resource budget.

## Scope and remaining checks

The native probes serve the fixture over loopback HTTP in real WebView engines. They establish encoder, font shaping, Canvas2D preview and native byte-write compatibility in the recorded environments. They do not establish behavior inside the final Canopi Tauri shell, its asset routing/CSP, save dialogs, cancellation/overwrite/error handling or document-session lifecycle. Those checks stay in the overview and release slices. Web Edition Firefox/Safari delivery, minimum supported runtime versions, resource limits, large Designs and physical printer scaling also remain unverified. Windows CI uses a Windows Server runner, so consumer Windows coverage remains part of integrated release validation.

Reproduction, dependencies and lifecycle ownership are documented in the [agent guide](agent/canvas-pdf-evaluation.md). The [workflow](../.github/workflows/pdf-native-probe.yml) retains raw native PDFs, reports and preview PNGs for independent verification. The native engine gate is complete. The subsequent `canopi-orpp` decision adopts the reviewed foundation and preview rules under the user’s instruction to complete the feature. The subsequent feature approval and production evidence are recorded in [production validation](canvas-pdf-validation.md).
