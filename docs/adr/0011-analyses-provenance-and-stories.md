# Analyses, provenance and stories

Status: Accepted (2026-09-26, Canopi v2)

## Context

v2.0 ships one analysis (slope) wired directly into the LiDAR workflow. Planned work adds hydrology and canopy analysis (from the Whitebox tools bundled in the pinned GeoLibre CLI, with Computree as an optional engine) and story maps that are designed and presented inside Canopi. Without shared seams each would add its own dialog, result bookkeeping and file fields.

## Decision

- **Analysis registry.** An analysis is an entry in an authored JSON contract (`common-types/analysis-registry.json`, generated into Rust and TypeScript): id, recipe version, input item types, parameters (typed, with defaults and units in metres, m² and degrees), output item types and a lane. Executors stay handwritten in Rust. Lanes: the pinned GeoLibre CLI sidecar, windowed (slope, hillshade) or global (contours, hydrology, canopy, bounded by an extent cap), and later an optional user-installed Computree. The Analyze dialog is generated from the registry for the selected source; slope, hillshade and contours are entries. Unavailable entries say why (already in Layers, needs Desktop, needs a point cloud).
- **Typed library items.** Library and site-data items carry a kind: raster (elevation, height, slope, flow…), point cloud, or vector result (streams, watersheds, detected trees, crowns). Layers, legends and value readouts dispatch on kind; nothing assumes an elevation raster.
- **Provenance.** Every derived item records its input items and generations, analysis id and recipe version, parameters and tool version. Refresh re-runs a result in place (every Design that uses it sees the new result; the run stays in the processing history); stale results are flagged with their reason (input, recipe or tool changed); refresh is always explicit, never automatic.
- **Saved views.** A Design can hold named views: camera (lon, lat, zoom, bearing), visible layers, highlighted species or objects, and optional title and text. Views are Design data (Design Edit authority), stored in lon/lat like everything else.
- **Stories.** A story is an ordered list of saved views with rich text and optional images, authored in a Story panel beside the live map and presented full-window inside Canopi (keyboard and click navigation, reduced-motion jumps). Export to a self-contained web page and PDF comes from the same model. Canopi does not depend on ArcGIS StoryMaps.

## Consequences

- The LiDAR slope path is refactored into the registry before new analyses land; the library catalogue gains kind and provenance fields (no migration: older catalogues are deleted per ADR 0003).
- `.canopi` gains `views` and `stories`; the format version bumps and older files are refused.
- Hydrology (canopi-5ys2.1) and canopy analysis (canopi-5ys2.2: tree tops, crowns and gaps from above-ground height through GeoLibre, then point clouds; Computree only as an optional integration) and story maps (canopi-5ys2.3) build on these seams only.
