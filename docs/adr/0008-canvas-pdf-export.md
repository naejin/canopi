# Canvas PDF export without maps in v2.0

Status: Accepted (2026-09-25, Canopi v2)

## Context

Users print Designs for field work. Earlier report and native-snapshot PDF paths duplicated document and canvas concerns and rendered differently per platform. v2 puts every Design on a map, but printing map tiles needs its own provider, resolution and attribution work.

## Decision

- Canvas PDF is a derived, printable view of a Design on Linux, macOS, Windows and Web. One browser-compatible layout and encoder serve every edition; only saving (Desktop, through the Native Operation Executor) or downloading (Web) differs.
- PDFKit generates vectors with embedded Noto fonts; fontkit shaping produces one physical page plan for both the SVG preview and the PDF. System fonts and screenshots never determine layout.
- Users choose printable layers independently of saved visibility. Printable content: plants, pinned plant names, zones, annotations and persistent measurement guides; group members appear once. Interaction decorations are excluded.
- Layout runs in the session plane's metres ([ADR 0001](0001-geolocated-map-canvas.md)). An overview plus numbered detail pages cover user-drawn Print Areas at exact ground scale on A4 or US Letter, in a white print style independent of the app theme. Zone interiors print transparent; plant keys, species codes, dimension indexes and a 50 mm calibration bar keep sheets readable in grayscale.
- Print setup is temporary Design Session state. Export never changes Design content, undo history, dirty state or settings.
- **No map backgrounds in v2.0.** Basemap, satellite, LiDAR and terrain are not printed and export makes no network request. Map export is deferred, not rejected: it must resolve provider-compatible acquisition, alignment and printed attribution, and a failed map export must offer Retry or Export without map.
- Timeline, Budget and Consortium sections, persistent print setup, and the retired Design Report and `printpdf` renderer are out of scope.

## Consequences

- Identical PDFs across editions and platforms.
- Printed sheets lack site imagery until map export is designed.
- Module ownership, limits and validation commands live in the Canvas PDF guide.
