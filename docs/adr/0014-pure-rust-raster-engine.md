# A pure-Rust raster engine, no GDAL

Status: Accepted (2026-09-28, Canopi v2; decision canopi-yr93, bead canopi-paxo)

## Context

The Data library read, converted and placed rasters by shelling out to the GDAL command-line tools (`gdalinfo`, `gdal_translate`, `gdaltransform`). GDAL was not bundled: Import and inspection said "unavailable" on every machine without a system install, and the installers could not ship it without adding a large native dependency tree (PROJ, its database, GEOS, libtiff, ...) per platform. Every raster operation ran as a child process with its own memory, cache and deadline rules.

## Decision

- **One in-process engine.** `desktop/src/services/lidar/rust_engine/` implements the `RasterEngine` seam (`engine.rs`) on the `whitebox_next_gen` crates: `wbgeotiff` (the `opengeos/whitebox-wasm` fork already pinned, patched over crates.io so `wbraster` shares it) for TIFF directories, codecs and predictors; `wbraster` for the other formats; `wbprojection` for the EPSG registry, WKT and datum transforms. Nothing is discovered at run time and the engine's version names the crates.
- **The engine owns its outputs and its CRS handling.** It writes the numeric and display COG profiles with its own tiled writer (directories first, 256-pixel Float32 tiles, nodata-aware averaged overviews halving while a side exceeds a tile, the `GDAL_NODATA` tag), decodes TIFF strips and tiles itself, reads GeoTIFF keys including the conic false-origin keys the crate ignores, and carries its own Swiss Oblique Mercator (EPSG:2056, 21781) and ellipsoidal LAEA (EPSG:3035), because the crate's definitions of those are hundreds of metres to kilometres off.
- **Memory is bounded by the existing capacity limit, not by the raster.** A GeoTIFF converts through the one writer in row windows of whole tiles holding at most `import::MAX_RAW_EXTRACTION_CELLS` cells, at any size the admission bounds allow (2 GiB per file, 400 M cells per import checked before a source converts, free space). Each overview level is averaged from the level before it, read back from the file being written, so the output is byte-identical to a whole conversion. Cancellation is checked between windows, chunks and levels. (Amended 2026-10-03, canopi-dfc0.)
- **What cannot stream loads whole under that limit.** Uncompressed strips are read by byte range and every other chunk is decoded whole, so a GeoTIFF whose compressed chunk decodes above 64 MiB, and every other format (`wbraster` has no window API), is loaded whole after the limit, with the same named reason as any other whole-raster read. Display parts are composed at most 4×4 chunks at a time.
- **GDAL stays only as a test oracle.** `gdal_engine.rs` is compiled for tests, found on `PATH` alone, and used by the ignored comparison lane `rust_engine::comparison`, which skips cleanly without GDAL. No environment variable, CI install, guide or release note mentions GDAL as a requirement.
- **Vocabulary is unchanged.** Probes keep GDAL's driver, band type, mask flag and compression names, which the catalogue and admission rules were written against; `crs_class` still reads WKT.

## Rejected alternatives

- **Bundling GDAL** (canopi-fxil.20): 100+ MB of native libraries and data per platform, three packaging pipelines, and a child-process contract for every read.
- **`georust/proj` and the `gdal` crate bindings**: both link the C libraries, so they bundle the same tree and need it at build time on every CI runner and contributor machine.
- **`proj4rs`**: projections without a registry, datum shifts or GeoTIFF key handling; it would still need a raster stack beside it.

## Consequences and caveats

- Import, display, inspection and coverage work on every machine the installers target; only Slope still needs the GeoLibre CLI.
- The crates are young. The engine already corrects three of their gaps (Swiss grids, LAEA, false-origin keys) and the comparison lane is the standing proof. Measured on 2026-09-28 against GDAL 3.8.4: on GDAL-authored Float32, striped, Int16 LZW predictor 2, Byte, big-endian UInt32 and Float64, PackBits and user-defined Lambert GeoTIFFs, an Esri ASCII grid, an XYZ grid and the IGN LiDAR HD tile, samples, controlled COGs and finite overview cells are identical and WGS84 extents agree within 3.4e-8 deg.
- Statistics agree within 1e-13 relative; transforms inside each CRS's area of use within 9.4e-4 m and 1e-8 deg for Lambert-93, UTM 32N/33N, Web Mercator, LV95 and LAEA Europe. Outside a UTM zone the transverse Mercator series diverges from PROJ (4.7 cm at 9°, 1.7 m at 15° from the central meridian).
- GeoTIFF sources import at any admitted size, as they did with GDAL. A large source in another format, or a GeoTIFF stored as one huge compressed strip, is still refused by name above 25 M cells; the fix is to rewrite it as a tiled GeoTIFF.
- GDAL counted `±inf` samples as values; Canopi's validity rule (finite and not NoData) now applies to statistics and overviews alike.
- A bump of any of the three crates re-runs the comparison lane before it merges (advice).
