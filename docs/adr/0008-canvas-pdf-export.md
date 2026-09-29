# Canvas PDF export without maps

Status: Accepted (2026-09-25, Canopi v2)

Amended by [ADR 0015](0015-rotating-map-and-canvas-controls.md) (2026-09-29): map orientation and rotated Print Areas.

## Context

Users print Designs for field work. Earlier report and native-snapshot PDF paths duplicated document and canvas concerns and rendered differently per platform. v2 puts every Design on a map, but printing map tiles needs its own provider, resolution and attribution work.

## Decision

- Canvas PDF is a derived, printable view of a Design on Linux, macOS, Windows and Web. One browser-compatible layout and encoder serve every edition; only saving (Desktop, through the Native Operation Executor) or downloading (Web) differs.
- PDFKit generates vectors with embedded Noto fonts; fontkit shaping produces one physical page plan for both the SVG preview and the PDF. System fonts and screenshots never determine layout.
- Users choose printable layers independently of saved visibility. Printable content: plants, pinned plant names, zones, annotations and persistent measurement guides; group members appear once. Interaction decorations are excluded.
- Layout runs in the session plane's metres ([ADR 0001](0001-geolocated-map-canvas.md)). An overview plus numbered detail pages cover user-drawn Print Areas at exact ground scale on A4 or US Letter, in a white print style independent of the app theme. Zone interiors print transparent; plant keys, species codes, dimension indexes and a 50 mm calibration bar keep sheets readable in grayscale.
- **Map orientation** ([ADR 0015](0015-rotating-map-and-canvas-controls.md)): North up (default) or As on screen. The overview uses the bearing captured when the PDF workspace opens, and each Print Area page its own angle (a Print Area drawn on a rotated page is level with it and stores that angle). North-up pages print the north-aligned box around a turned area. The north arrow always points to true north.
- **One page frame.** A turned page does not thread an angle through the layout: one module turns the print snapshot by −angle about the page's ground centre, and the existing axis-aligned layout runs on the result, so text stays level on paper and a North up page is unchanged. Page-editor moves and new Print Areas turn back by +angle. Rejected: an angle in every layout module (about ten modules, each a place to get the sign wrong).
- Print setup is temporary Design Session state. Export never changes Design content, undo history, dirty state or settings.
- **No map backgrounds.** Basemap, satellite, LiDAR and terrain are never printed on planting plans, and export makes no network request. The user decided on 2026-09-27 that plans stay on white paper (previously this was deferred, not rejected).
- Timeline, Budget and Consortium sections, persistent print setup, and the retired Design Report and `printpdf` renderer are out of scope.

## Consequences

- Identical PDFs across editions and platforms.
- Printed sheets lack site imagery until map export is designed.
- Module ownership, limits and validation commands live in the Canvas PDF guide.
