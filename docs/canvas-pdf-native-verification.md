# Canvas PDF native WebView verification

2026-09-09 · `canopi-cd7x.1` · prerequisite of `canopi-orpp`.

The user approved checking the recommended PDFKit foundation in actual desktop WebViews before investing in export UI. This gate extends the [encoder evaluation](canvas-pdf-evaluation.md); it does not select the production library, physical defaults or pending preview rules. [ADR 0024](adr/0024-shared-canvas-pdf-export.md) remains the accepted scope.

## Current evidence

| Host | Runtime | Result |
| --- | --- | --- |
| Local Linux GTK 3 / WebKitGTK 4.1 | WebKitGTK 2.52.6 | Pass: three previews, native file write, byte-identical reference PDF, independent font/text/geometry checks |
| CI Linux | Pending | Pending |
| CI macOS Apple Silicon / WKWebView | Pending | Pending |
| CI macOS Intel / WKWebView | Pending | Pending |
| CI Windows / WebView2 | Pending | Pending |

The same production-built isolated fixture loads pinned font bytes, draws its shaped preview, generates the three-page PDF and passes bytes through each host's native message bridge to a fixed test path. No production app dependency or native command changes. The local Linux detail preview was visually inspected; complete multilingual legend entries and plan text are present.

Independent inspection verifies the actual saved file against the deterministic [reference PDF](assets/canvas-pdf/pdfkit.pdf), its SHA-256, A4 page boxes, 50 mm vector segments, four embedded font subsets, multilingual extraction and shared text widths. Preview PNG dimensions are checked separately. This fixed fixture permits byte equality; product parity still means equivalent content and geometry rather than universally identical serialization.

## Scope and remaining checks

The native probes serve the fixture over loopback HTTP in real WebView engines. They establish encoder, font shaping, Canvas2D preview and native byte-write compatibility in the recorded environments. They do not establish behavior inside the final Canopi Tauri shell, its asset routing/CSP, save dialogs, cancellation/overwrite/error handling or document-session lifecycle. Those checks stay in the overview and release slices. Web Edition Firefox/Safari delivery, minimum supported runtime versions, resource limits, large Designs and physical printer scaling also remain unverified. Windows CI uses a Windows Server runner, so consumer Windows coverage remains part of integrated release validation.

Reproduction, dependencies and lifecycle ownership are documented in the [agent guide](agent/canvas-pdf-evaluation.md). The [workflow](../.github/workflows/pdf-native-probe.yml) retains raw native PDFs, reports and preview PNGs for independent verification. This gate stays open until all three desktop engines have actual passing evidence.
