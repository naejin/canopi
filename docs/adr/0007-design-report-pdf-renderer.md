---
status: superseded
superseded_by: 0011-remove-design-report-export-and-display-modes.md
---

# Design Report PDF Renderer

The retired Design Report selected one shared Rust renderer using `printpdf`, with structured report data and a white-background canvas image. A shared writer avoided separate Cairo, PDFKit/Core Graphics, and DirectWrite/XPS report layouts; the lower-level `pdf-writer` alternative would have left too much PDF object machinery in application code. Canopi would own pagination, wrapping, tables, and legends, and bundle fonts for its supported scripts, accepting package-size cost for consistent text across desktop platforms.

[ADR 0011](0011-remove-design-report-export-and-display-modes.md) retired this renderer and report scope. [ADR 0024](0024-shared-canvas-pdf-export.md) defines the planned Canvas PDF direction and leaves its PDF library open. Native snapshot export never served as the structured report renderer.

This historical record retains its original `0007` number; the accepted [Design Notebook ADR](0007-design-notebook-user-db-library.md) independently uses the same number.
