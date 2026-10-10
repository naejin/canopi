# Geolocated map canvas

Status: Accepted (2026-09-25, Canopi v2)

Amended by [ADR 0015](0015-rotating-map-and-canvas-controls.md) and [ADR 0016](0016-one-view-transform.md) (2026-09-29): bearing is a view property and the view can rotate. Amended 2026-10-04: reopening a Design restores the view it was saved with (U28). Amended 2026-10-06 (Q14, canopi-f47t.26): a saved longitude is clamped to ±180, the range the decoder admits, so a Design dragged past the antimeridian reopens.

## Context

Canopi v1 drew Designs in local metres on a canvas and attached them to the Earth through one Design-level anchor (longitude, latitude, north bearing, placement status, altitude). Users had to place a Design explicitly in a separate Location surface before the map, satellite and LiDAR made sense, and every map feature had to be re-projected through the anchor. The map already hosted the scene as a MapLibre custom layer, so the separate "local canvas" no longer paid for itself.

## Decision

- **The map is the canvas.** Basemap, satellite, LiDAR and terrain are the background of the design surface. There is no Design location, no placement workflow and no separate Location surface or primary navigation entry.
- **Files store lon/lat.** The `.canopi` format (v7 at acceptance, v9 now) stores every design object position (plants, zone points, annotations, measurement guide endpoints, group members) as `GeoPoint { lon, lat }` in WGS84 degrees. Zone rotation is degrees clockwise from true north. The Design-level anchor and its fields are removed.
- **Runtime works in metres through a session plane.** The codec builds a local Mercator tangent plane at the centre of the objects' bounds (empty Design: the view centre). Tools, snapping, measurements, hit testing and PDF layout use metres in that plane. When the view centre moves more than 10 km from the origin, the plane is rebuilt at the view centre and objects are re-projected from their stored lon/lat.
- **Canonical write-back.** Positions are written rounded to 1e-9 degree, latitude clamped to ±85.051128779, longitude clamped to ±180 on save only (re-origin keeps it unclamped). Rounding is idempotent through the session plane, so an unedited position never drifts; one with more decimals is rounded once. (Amended 2026-10-06, U33: the geo ledger that wrote loaded lon/lat verbatim is gone.)
- **View is not placement.** Pan, zoom, rotation, fit and place search move only the camera. Bearing is a view property: the session plane stays north-aligned (x east, y south) at any bearing, and stored angles stay clockwise from true north. Relocating objects is a normal edit (cut and paste).
- **Navigation.** Place search (name or coordinates) is the title-bar place field, Ctrl K ([ADR 0010](0010-map-first-interface.md) replaced the pin button first decided here); confirm flies the camera. A new Design opens at the last view in settings, else at lat 23.0, lon 13.0, zoom 4, and asks "Where is your site?". Opening a Design restores the view it was saved with (`map_view`, [ADR 0015](0015-rotating-map-and-canvas-controls.md), 2026-10-04); a Design saved without one fits to its objects at the live bearing (U33); a new or empty Design opens north-up.
- **Map layers.**
  - The default basemap is the OpenFreeMap Liberty vector style (Positron, Bright, Dark selectable) with OpenFreeMap/OpenMapTiles/OpenStreetMap attribution.
  - Satellite is its own Site references row under Basemap and hides the Basemap when on; Google is the only satellite imagery.
  - Without a key, Google uses its public tiles (`https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}`), as GeoLibre's basemap control does; entering the user's own Google Maps API key in the Satellite row switches to the official Map Tiles API.
  - The public tile endpoint is not a published Google API and Google's terms do not cover using it directly; the user accepted that risk for its resolution (2026-09-25).
  - EOX Sentinel-2 cloudless, the licensed keyless alternative, was removed at the user's request (2026-09-25), so there is no provider choice.
  - Esri World Imagery was not adopted: its Master License Agreement does not clearly allow keyless display in a free third-party app.
  - OSM raster tiles and MapTiler are removed.
- **Geocoding** uses one provider registry in both editions (see [ADR 0005](0005-web-edition-scope.md)).

## Consequences

- Designs have no site metadata to confirm or undo; the map is always meaningful.
- Stored lon/lat is the only authority, so re-origin and save are lossless and precise to about 0.1 mm.
- Metre-based features keep working unchanged inside the session plane.
- Files older than the current format are refused (see [ADR 0021](0021-canopi-2-breaks-stored-data.md)).
- Saved object stamps stay relative metre arrangements; templates are current-format `.canopi` files placed relative to the view.
- Altitude is no longer Design metadata; terrain comes from LiDAR data.
