# Hydrology in Canopi: implementation plan

Status: agreed (2026-09-26); not started. The registry it needs shipped (canopi-h90p.9.1). Technical detail: `analysis-registry-and-hydrology.md` in this folder.
Beads: canopi-h90p.9.1 registry (prerequisite, parked), .9.3 contours + global lane, canopi-5ys2.1.1 water flow, .1.2 catchments.
Mockups: design canvas boards AnalyzeWater, WaterFlow, ResultDetails.

## 1. What users get

From a terrain layer (IGN or any metre-based elevation GeoTIFF), Analyze › Water offers:
- **Water flow:** where water runs and collects — upslope area (m², shown on a log colour scale), streams as lines with their order (wider downstream), wetness index (where soil stays wet), ponding depth (where water sits in hollows). Choose which results to add; streams start from an upslope area you set in hectares.
- **Catchments:** click one or more outlet points on the map; Canopi draws the land draining to each, with its area.
Results nest under their terrain in Layers, read out on hover ("Stream, order 3 · upslope area 4.8 ha · wetness 11.2"), keep a record of how they were made, and can be refreshed.

Design uses: swales and keylines along contours, pond and wetland placement, water-loving species in wet zones, avoiding planting in flow paths or frost pockets.

## 2. How it runs

- **Engine:** the Whitebox hydrology tools already compiled into the pinned GeoLibre CLI that Canopi ships (geolibre-cli 1.5.3, geolibre-rust aac2b743). Chain: breach (or fill) depressions → D8 flow direction → flow accumulation → extract streams → Strahler order → streams to lines; wetness index from specific catchment area and slope; depth in sink; snap pour points → watershed → polygons. Every tool id and parameter was checked against the pinned binary and run end to end on a test surface.
- **Not WASM:** the browser build of the same tools is memory-limited and would put a raster engine in the frontend; the native sidecar runs offline anyway. The Web edition has no terrain library, so hydrology is Desktop-only.
- **Whole-raster lane:** hydrology needs the entire terrain at once (today's slope works in 1024² windows). The plan adds a bounded "global" lane: write the terrain into one scratch GeoTIFF window by window (never a whole-raster buffer in Canopi's memory), run the tool chain, read results back into the existing chunk store. A cap of 25 million cells (e.g. 2.5 × 2.5 km at 0.5 m) keeps peak memory near 1.3 GB; larger terrain is refused by name with the size, before starting.
- **Vectors:** streams and catchments come out as lon/lat GeoJSON, canonicalised (whitelisted properties, rounded coordinates, size cap) and stored as library vector items, drawn by a new MapLibre vector-results layer.
- **Provenance and refresh:** each result records its terrain, settings and tool version; refresh re-runs in place; stale results say why.

## 3. Order

1. Registry, typed items and provenance with slope only (h90p.9.1 — the parked branch; its design already includes the global lane and vector kinds, and will absorb any lane the ONF plan needs).
2. Contours (h90p.9.3): proves the global lane and vector items with one tool.
3. Water flow (5ys2.1.1): recipes and styles only.
4. Catchments (5ys2.1.2): map point picking.

## 4. Before starting: fix and follow-ups

- **Licence notice (canopi-vy33, do now):** the GeoLibre CLI links an AGPL-3.0-or-later crate (`wbspatialstats`); our notice says MIT. Canopi is AGPL-3.0-only, so this is compatible, but the notice must say so and releases must offer the sidecar's source.
- **Threads:** hydrology tools use all cores regardless of `RAYON_NUM_THREADS`; run one heavy job at a time (already the rule) at below-normal priority, and ask upstream for a thread option (canopi-2d1b, only with your go-ahead).
- **Edge effects:** accumulation and catchments are truncated at the terrain's edge; the result details say so.

## 5. Decisions (2026-09-26: the user adopted the recommendations)

- **H1** Extent cap 25 M cells (recommended) or another limit.
- **H2** Refresh updates results in place and keeps the run in history (recommended) vs a new copy each time.
- **H3** Ship hydrology in v2.0 or after (recommended: after, once the registry and contours have landed).
