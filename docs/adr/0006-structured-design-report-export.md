---
status: superseded
superseded_by: 0011-remove-design-report-export-and-display-modes.md
---

# Structured Design Report export

The retired Design Report decision called for structured report data and print-specific layouts. A fitted, white-background canvas image would respect visible Design and map layers; metadata, Timeline, Budget, Consortium, legends, and tables would use structured pagination and text wrapping. This separated report layout from app screenshots and native canvas snapshots to support readable output across desktop platforms.

Renderer strategy was decided separately in [0007 Design Report PDF Renderer](0007-design-report-pdf-renderer.md), which is also superseded by ADR 0011. The newly planned Canvas PDF export follows [ADR 0024](0024-shared-canvas-pdf-export.md); it does not reinstate this full-report scope.
