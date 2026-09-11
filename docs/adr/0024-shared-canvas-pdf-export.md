---
status: accepted
---

# Shared Canvas PDF export on desktop and Web

Canvas PDF is a derived, printable view of a Design, available on Linux, macOS,
Windows and Web Edition. One browser-compatible layout and encoder serve every
edition; only saving or downloading varies. This avoids platform-dependent names,
geometry and rendering, while keeping `.canopi` as the editable source of truth.
The foundation was approved on 2026-09-10. The field-print revision was approved
on 2026-09-11 under `canopi-8d38` and polished under `canopi-46aj`; `canopi-kg34` restores explicit-only detail coverage, superseding the earlier bracket and separate-key defaults. See the [validation record](../canvas-pdf-validation.md).

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

Zone interiors are transparent throughout the PDF and its preview/picker, regardless
of authored fill. Outline strokes draw beneath plants, guides and annotations;
overlapping Zones cannot obscure each other with fill. Stored Design fills and
native geometry remain unchanged.

The overview provides navigation, stronger compact plant marks, quiet Zone outlines,
an aligned dimension/spacing index and a physical 50 mm calibration bar. Every
selected stored Measurement Guide remains represented. Repeated values group by
Zone; suitable existing connected chains can use a separate band. Long indexes may
continue on additional pages. Overview annotations are complete contextual text only
where readable; no annotation index or N markers are generated there. Unreadable
notes outside all chosen details are omitted. Export never creates detail coverage
for annotations or relocates an uncovered note into another detail's key. This also
applies when no detail has been chosen: only dimension/spacing overflow may add
pages to the overview. Remote notes do not shrink the overview's planting plan.
The picker stays an authored-artwork surface so users can add coverage explicitly.
An overview-only export needs no Species name lookup, even with annotations.

Each detail retains exact planting geometry and gains a title, counts, consecutive
identity starting at 1 and a ground scale. A complete compact key shares the sheet
when it fits without reducing map scale; otherwise the complete key follows. Only
Species sharing a symbol/colour combination within that detail need disambiguation.
Plain/circle/square/diamond choices favour locally frequent plants and work in grayscale;
occasional ambiguous plants and remaining conflicts use the reserved Species Code. Codes sit left of key samples;
botanical names never repeat the symbol. Every appearance, full name and count remains.
There are no plant-connection networks, duplicate quick keys or density consent gates.
Authored custom plant colours, symbols and positions are not rewritten by export.

Annotations retain their rotation and print directly at a readable physical size
when they fit; only unresolved notes use N references. Stored Measurement Guides
retain actual endpoint distances and full values when cropped, with a link to a
complete detail when available. Zone dimensions derive from true edges/diameters,
not bounding boxes. Full sizes remain above cropped details; extra dimension strokes
are drawn only where clear. Text can interrupt Zone outlines without erasing artwork.
Coincident plants retain P entries with complete membership. Unplaceable Species
Codes retain coordinates within their existing key entry, without introducing P identities. No failed placement is silently reported as a readable identity.

Keys and indexes paginate at fixed physical type sizes. Physical page indices and
consecutive detail identities are distinct, and links resolve after pagination.
An explicit split action still previews smaller frames before replacing a Print Area;
export never automatically divides a requested area. Screen inspection and PDF
generation never modify the Design. The [implementation guide](../agent/canvas-pdf.md)
records module ownership and physical bounds; physical printer validation is separate.

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
