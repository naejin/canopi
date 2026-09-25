# GeoLibre module reuse, not a fork

Status: Accepted (2026-09-25, Canopi v2)

## Context

GeoLibre (MIT, https://github.com/opengeos/GeoLibre) is an open GIS app with layer management, basemaps, geocoding, raster/COG display, terrain and print helpers. It is a React 19 and Zustand app of about 400k lines. Canopi is a Preact and signals app whose value is its design engine, species catalog and planning tools. Writing generic GIS code in Canopi duplicates maintained upstream work.

## Decision

- Keep Canopi's Preact app, Rust/Tauri backend and design engine. Do not fork GeoLibre and do not import its React components or stores.
- Reuse GeoLibre before writing generic map code:
  - **Depend** on light packages: `maplibre-gl-raster` and `cog-tiler-wasm` for COG display; `wbgeotiff` (from `opengeos/whitebox-wasm`) as the native GeoTIFF/COG reader; the GeoLibre CLI (`opengeos/geolibre-rust`) as the slope sidecar. Each is pinned.
  - **Copy** framework-free modules from GeoLibre at reference commit `e9df9e2`: the geocoding provider registry (`packages/core/src/geocoding.ts`) and OpenFreeMap basemap presets (`packages/core/src/types.ts`). The map layer store follows the store-driven sync pattern of `packages/map/src/layer-sync.ts` without copying its code.
  - Evaluated in V7 and not adopted, because none made Canopi smaller or clearly better: terrain control and COG DEM source, COG imagery helpers, fill patterns, map capture, print layout export, collapsed attribution, map resize and map bounds helpers. Map capture and print layout are re-evaluated when PDF map backgrounds return ([ADR 0008](0008-canvas-pdf-export.md)).
- A copy is justified only when Canopi code gets smaller or clearly better.
- Every copied file keeps an MIT header with its source path and commit and gets an entry in `THIRD_PARTY_NOTICES.md`.
- `@geolibre/map` is not a dependency (it pulls Cesium and a React peer). `@geolibre/core` may be used for types only if it adds no heavy runtime.
- LiDAR data follows the GeoLibre model: one fixed Data Library item per import, display through upstream per-source COG overviews, and GeoLibre slope for analysis. A Data Layer is an ordered collection of source COGs whose value is the highest-priority valid sample; there is no dataset history, library undo or automatic analysis refresh.

## Consequences

- Canopi owns the design domain and its UI; GeoLibre supplies generic GIS behaviour.
- Upstream fixes reach Canopi through dependency bumps or deliberate re-copies at a new commit, recorded in `THIRD_PARTY_NOTICES.md`.
- Copied code is adapted to Canopi's signals and lifecycle rules; it is not a second layer, raster or editor authority.
- [`docs/architecture.md`](../architecture.md) lists the current reuse boundary.
