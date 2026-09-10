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

A4 and US Letter use a white print style independent of app theme. Each drawn Print
Area fits its exact ground rectangle on one detail sheet at 100%, without widening
coverage to the paper aspect ratio. Automatic orientation maximizes drawing scale;
exact squares use portrait. Independent zoom/framing can crop; Fit restores complete
coverage. Adding an area uses its own fitted overview, independent of printed framing.
An explicitly drawn blank area is printable; an otherwise empty overview is not.

The approved field layout assigns explicit roles to the pages, independent of Design size. The overview shows
the whole layout, final numbered detail outlines and a 50 mm calibration bar. It renders authored artwork directly, including scaled notes, with no generated key, appendix, name lookup or field-label processing. Whole-design field coverage is an explicit action, never an automatic size threshold. Detail
maps devote the sheet to planting positions, transparent identities and aligned
measurements, with only a large source page number. Full-width keys and notes follow
each detail automatically. There are no minimaps, running detail headers/footers,
narrow legend sidebars, or consent gates for crowded text and overflowing legends.

Whole-Design numeric print references distinguish Species sharing an appearance.
The existing Design letter code remains in the key and is never reassigned. Straight
neighbouring planting runs may share brackets and counts; irregular placements stay
individual, and long runs repeat references. Full common names appear on the map where
they fit; complete common/canonical names, counts and all authored appearances remain
in the key. Authored colours, symbols, opacity and plant positions are unchanged.

Measurement Guides preserve actual endpoint distance and alignment. Cropped guides
retain full values in M entries and link to a complete detail when available. Numerical
spacing notes stay by their anchor; other Annotation text moves to linked N entries.
Coincident mixed placements use P location entries with complete membership. If a
note leader cannot be placed, coordinates and a digital location link retain that note.
Failed plant-label placement does not generate per-position coordinate entries: local
keys retain complete Species identities and counts. An explicit split action previews
smaller frames and the actual PDF page count before replacing the original Print Area.
This trades additional map space for readable positions instead of growing an index
that cannot practically be used in the field. No density warning blocks export.

Keys paginate at fixed readable type sizes with complete entry fragments across
orientation overrides. Page numbers and named destinations resolve only after all
pages exist. Screen inspection and PDF generation never modify the Design. The
[implementation guide](../agent/canvas-pdf.md) records physical dimensions, spatial
placement and engineering bounds; physical printer validation remains separate.

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
