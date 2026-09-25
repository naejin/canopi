# Geolocated map canvas

Status: Accepted (2026-09-25, Canopi v2)

## Context

Canopi v1 drew Designs in local metres on a canvas and attached them to the Earth through one Design-level anchor (longitude, latitude, north bearing, placement status, altitude). Users had to place a Design explicitly in a separate Location surface before the map, satellite and LiDAR made sense, and every map feature had to be re-projected through the anchor. The map already hosted the scene as a MapLibre custom layer, so the separate "local canvas" no longer paid for itself.

## Decision

- **The map is the canvas.** Basemap, satellite, LiDAR and terrain are the background of the design surface. There is no Design location, no placement workflow and no separate Location surface or primary navigation entry.
- **Files store lon/lat.** `.canopi` format v7 stores every design object position (plants, zone points, annotations, measurement guide endpoints, group members) as `GeoPoint { lon, lat }` in WGS84 degrees. Zone rotation is degrees clockwise from true north. The Design-level anchor and its fields are removed.
- **Runtime works in metres through a session plane.** The codec builds a local Mercator tangent plane at the centre of the objects' bounds (empty Design: the view centre). Tools, snapping, measurements, hit testing and PDF layout use metres in that plane. When the view centre moves more than 10 km from the origin, the plane is rebuilt at the view centre and objects are re-projected from their stored lon/lat.
- **Canonical write-back.** Unchanged objects save their loaded lon/lat verbatim; changed objects save lon/lat rounded to 1e-9 degree. Open then save without edits is byte-identical.
- **View is not placement.** Pan, zoom, fit and place search move only the camera. Relocating objects is a normal edit (cut and paste).
- **Navigation.** A pin icon button under the inspection lens (loupe) button opens place search (name or coordinates); confirm flies the camera. A new Design opens at the last view in settings, else at lat 23.0, lon 13.0, zoom 4 with a "Search your site" prompt. Opening a Design fits to its objects.
- **Map layers.** The default basemap is the OpenFreeMap Liberty vector style (Positron, Bright, Dark selectable) with OpenFreeMap/OpenMapTiles/OpenStreetMap attribution. Satellite is its own Site references row under Basemap and hides the Basemap when on; providers are Google (the default) and EOX Sentinel-2 cloudless 2017 (keyless, CC BY 4.0, about 10 m per pixel). Without a key, Google uses its public tiles (`https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}`), as GeoLibre's basemap control does; entering the user's own Google Maps API key in the Satellite row switches to the official Map Tiles API. The public tile endpoint is not a published Google API and Google's terms do not cover using it directly; the user accepted that risk for its resolution (2026-09-25). EOX stays available as the licensed keyless choice. Esri World Imagery was not adopted: its Master License Agreement does not clearly allow keyless display in a free third-party app. OSM raster tiles and MapTiler are removed.
- **Geocoding** uses one provider registry in both editions (see [ADR 0005](0005-web-edition-scope.md)).

## Consequences

- Designs have no site metadata to confirm or undo; the map is always meaningful.
- Stored lon/lat is the only authority, so re-origin and save are lossless and precise to about 0.1 mm.
- Metre-based features keep working unchanged inside the session plane.
- v6 and older files are refused (see [ADR 0003](0003-no-backward-compatibility.md)).
- Saved object stamps stay relative metre arrangements; templates are v7 files placed relative to the view.
- Altitude is no longer Design metadata; terrain comes from LiDAR data.
