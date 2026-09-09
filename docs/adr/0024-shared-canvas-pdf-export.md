---
status: accepted
---

# Shared Canvas PDF export on desktop and Web

Canvas PDF is a derived, printable view of a Design, available on Linux, macOS,
Windows and Web Edition. One browser-compatible layout and encoder serve every
edition; only saving or downloading varies. This avoids platform-dependent names,
geometry and rendering, while keeping `.canopi` as the editable source of truth.
The completed feature and its current defaults were reviewed and approved by the
user on 2026-09-10. See the [validation record](../canvas-pdf-validation.md).

## Scope and ownership

Users select printable Design Layers independently of saved visibility. A new setup
uses the currently visible printable Layers and an overview only. Printable content
includes Plants, Pinned Plant Names, authored Zones, Annotations and persistent
Measurement Guides; group members appear once. Interactive decorations and map
backgrounds are excluded. Location is not required and export fetches no map assets.

Print setup is temporary Design Session state. It survives preview closure and
editing, rebuilds from current content, and is discarded when the Design closes or
is replaced. Missing selected Layers require explicit review. Source changes cancel
superseded work and invalidate exportable bytes immediately. Export never changes
Design content, undo history, dirty state, save acknowledgement or persistent settings.

## Coverage and readability

A4 and US Letter use a white print style independent of app theme. The overview
fits selected printable content and all detail coverage, independently of interactive
pan/zoom. Detail pages come only from drawn rectangular Print Areas. Each area fits
completely on one page at its default zoom; automatic orientation maximizes the
usable drawing scale beside the legend, with portrait for exact squares. This
replaces fixed scale presets, forced tiling and Zone-based page creation: coverage
should fit naturally and remain independent of changing Zone names or geometry.

Each canvas page has independent numeric zoom and framing; each page, including
legend continuations, has an orientation override. Explicit zoom or movement may
crop. Fit restores full coverage and centring. Adding a Print Area uses its own
fitted overview without changing the printed overview's framing. Screen inspection
never changes printed scale. Canvas pages carry a calibrated scale bar and an
approximate ratio; the overview identifies detail coverage using final page numbers.
An empty overview cannot export, but an explicitly drawn blank area can.

Automatic Detail adapts plant marks to physical planting spacing while preserving
authored colours and symbol recipes. Detail pages retain full text. An overview
may defer Annotation text, Pinned Plant Names and distances only when a detail page
shows that text completely without collisions. Otherwise the user must add detail
coverage or explicitly keep the crowded text. Retention applies to the reviewed
content and placement, and must be reconsidered when either changes.

A narrow, compact legend identifies the Species visible in each canvas page's final
framing. An overview used alone has the same legend; with details it becomes a
navigation sheet. Each Species shows one full name: selected-language Common Name,
otherwise Canonical Name. Canonical Name remains identity when common names coincide.
Every authored appearance is included. Samples sit beside the name when space permits,
otherwise below it; fine separators group wrapped entries without shrinking text or
widening the sidebar. No layout setting or per-Plant species codes are added.

Overflow blocks export until the user adjusts coverage or explicitly adds linked
legend pages. Continuations preserve complete names and samples, inherit source
orientation unless overridden, and participate in final page numbering. Different
Species sharing an appearance trigger a non-blocking notice across the complete
source legend. Canopi never substitutes symbols or colours, even only in the PDF;
users can return to the Design to edit presentation themselves.

## Shared foundation

PDFKit generates vectors and embeds Noto fonts. Fontkit shaping supplies one physical
page plan for SVG preview and PDF encoding; system fonts and screenshot rendering do
not determine layout. The [encoder evaluation](../canvas-pdf-evaluation.md) rejected
the tested pdf-lib/font combination because independent rendering lost CJK text.
[Native foundation evidence](../canvas-pdf-native-verification.md) established the
chosen pipeline in all three desktop WebView engines. Versions, resource limits,
module ownership and regression commands belong in the [implementation guide](../agent/canvas-pdf.md).

The static Web bundle uses [compile-time edition adapters](0021-web-edition-compile-time-adapters.md)
for delivery. Native delivery writes the already prepared PDF bytes through the
Native Operation Executor; it does not render the Design again. The retired native
snapshot-PDF command, Cairo PDF renderer and macOS/Windows PDF stubs are removed.
The structured Design Report and Rust `printpdf` renderer remain retired as well.

## Supersession and deferred work

This decision revises the PDF restriction in [ADR 0011](0011-remove-design-report-export-and-display-modes.md)
and supersedes [ADR 0019](0019-web-edition-canopi-export-only.md), adding Canvas PDF
alongside Web `.canopi` download. ADR 0011's plant-presentation decisions remain in
force. Timeline, Budget and Consortium PDF sections, all map backgrounds, and
persistent print setup remain outside this release. Other Web export formats,
Diagnostic Bundles, native file management and Saved Object Stamp portability still
require their own scope decisions.

Map export is a deferral, not a permanent exclusion. Future work must resolve
provider-compatible acquisition, geographic alignment and printed attribution;
interactive tile access does not establish print suitability. A failed map export
must offer explicit Retry or Export without map while preserving pages, scales and
Design state. Interactive Web maps remain separate under [ADR 0013](0013-web-edition-map-scope.md).
Local PDF generation does not imply an [offline-first Web app](0022-web-edition-not-offline-first.md).
The dated [research brief](../canvas-pdf-export-research.md) preserves candidate
approaches and deferred map research, not current implementation instructions.
