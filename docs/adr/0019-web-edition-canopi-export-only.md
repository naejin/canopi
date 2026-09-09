---
status: superseded
superseded_by: 0024-shared-canvas-pdf-export.md
---

# Web Edition exports `.canopi` only in v1

Historical decision, superseded by [ADR 0024](0024-shared-canvas-pdf-export.md), which adds Canvas PDF export and carries forward the unrelated Web export exclusions.

The Web Edition v1 supports explicit `.canopi` download/export as its only export format. It should not expose PNG, SVG, PDF, CSV, report, diagnostic bundle, or native-style file export flows.

This keeps the Web Edition focused on portable Design ownership rather than recreating desktop export features through browser-only approximations. Browser-local drafts and autosave remain convenience state; a downloaded `.canopi` file is the durable portable artifact for Web v1.

Additional browser export formats can be reconsidered later only as separate product decisions with explicit scope, rendering fidelity, attribution, and static-hosting constraints.
