# Canvas PDF behavior checks

Use this as a compact acceptance reference when changing the export UI. The [implementation guide](agent/canvas-pdf.md) owns module boundaries, physical layout constants and regression commands; [ADR 0008](adr/0008-canvas-pdf-export.md) owns accepted scope. Measured output and physical-print limitations belong in the [validation record](canvas-pdf-validation.md).

| Surface | Behavior to preserve |
| --- | --- |
| Entry and delivery | File → Export to PDF opens the page workspace. Desktop uses a save dialog; Web downloads. Save is enabled only for the current complete document. |
| Print Layers | Initially follow visible printable Design Layers; overrides affect export only. Maps, Timeline, Budget and Consortium are excluded. |
| Field sheets | Explicitly drawn Print Areas or Whole design create fitted detail pages. Never create pages by clicking Zones, or mutate Design Zones from print setup. |
| Area picker | Fit printable content and existing coverage independently of printed-overview framing. Cancel/Escape restores the previous page unchanged. |
| Page navigation | Thumbnails and numbered overview coverage open the matching detail. Removing a detail removes its associated key pages. |
| Framing | Drag/keyboard displacement and canvas zoom can crop content. Fit resets displacement and zoom. Per-page orientation retains framing; screen text inspection never changes print scale. |
| Readability | Retain authored plant appearance and positions. Resolve ambiguity with print-only enclosures/codes; complete names, quantities and crowded notes continue in keys. Never recolour the Design. |
| Zones and measurements | Transparent Zone interiors are a print-only rule. Stored guides retain true distances; dimension/spacing overflow can continue. Do not synthesize spacing guides. |
| Annotation coverage | Overview prints only notes that fit. Other notes require an explicitly chosen detail covering them; do not create detail sheets or move notes into unrelated keys automatically. |
| Splitting | Preview adjacent readable sheets and full page count; Apply commits print setup, Cancel preserves it. Cover the full requested rectangle, including empty ground. |
| Lifecycle | Prepare selected sheet first and reuse unchanged layouts. Back to design retains session setup; source edits refresh it. Design replacement discards setup. Missing selected Layers require review. Export neither dirties nor saves the Design. |
| Physical scale | Actual-size printing preserves the labelled 50 mm calibration bar. Ground scale, canvas zoom and screen inspection are separate quantities. Physical readability requires paper evidence. |
