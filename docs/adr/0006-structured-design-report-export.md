# Structured Design Report export

Status: Superseded by [0011 Remove Design Report PDF export and plant display modes](0011-remove-design-report-export-and-display-modes.md).

Canopi Design Reports are generated from structured report data with print-specific layouts instead of screenshotting the app or reusing the current canvas-snapshot PDF path. The canvas contributes a fitted image with the page/background forced white while respecting visible design and map layers, and metadata, Timeline, Budget, Consortium, legends, and tables are rendered as structured paginated PDF content so long text can wrap cleanly and the export can behave consistently across supported desktop platforms.

Renderer strategy is decided separately in [0007 Design Report PDF Renderer](0007-design-report-pdf-renderer.md).
