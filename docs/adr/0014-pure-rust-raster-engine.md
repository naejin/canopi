# A pure-Rust raster engine, no GDAL

Status: Accepted (2026-09-28, Canopi v2; decision canopi-yr93, bead canopi-paxo). Amended 2026-10-05 (U27, U31, canopi-ji73): one CRS authority on proj4rs, display tiles in Web Mercator.

## Context

The Data library read, converted and placed rasters by shelling out to the GDAL command-line tools (`gdalinfo`, `gdal_translate`, `gdaltransform`). GDAL was not bundled: Import and inspection said "unavailable" on every machine without a system install, and the installers could not ship it without adding a large native dependency tree (PROJ, its database, GEOS, libtiff, ...) per platform. Every raster operation ran as a child process with its own memory, cache and deadline rules.

The first engine placed rasters through `wbprojection`, and the display re-read each file's GeoKeys in the browser through proj4js. Measured on 2026-10-04, `wbprojection` put Dutch, Belgian, British, Austrian, Greek and Luxembourg grids 30 to 390 m off and Krovak about 1,260 km off; proj4js on GeoLibre's key table carries no datum shift and put the Delft AHN tile 110 m off. Two engines had to agree to the millimetre, and every review round found another disagreement at that seam (U27).

## Decision

- **One in-process engine.** `desktop/src/services/lidar/rust_engine/` implements the `RasterEngine` seam (`engine.rs`) on `wbgeotiff` (the `opengeos/whitebox-wasm` fork already pinned, patched over crates.io so `wbraster` shares it) for TIFF directories, codecs and predictors, and `wbraster` for the other formats. Nothing is discovered at run time and the engine's version names the crates.
- **The engine owns its outputs.** It writes the numeric and display COG profiles with its own tiled writer (directories first, 256-pixel tiles, nodata-aware averaged overviews halving while a side exceeds a tile, the `GDAL_NODATA` tag), decodes TIFF strips and tiles itself and reads GeoTIFF keys, including the conic false-origin keys the crate ignores.
- **One CRS authority** (U31). `rust_engine/crs.rs` over the rows of `crs_table.rs`, on `proj4rs` pinned `=0.2.0`, is the only code that names a projection crate (`only_the_crs_authority_names_a_projection_crate`). Placement, item extents, "Covers your site", View coverage, hover and the display warp all transform through it.
  - Every transform runs source → WGS84 longitude and latitude → target, because the Web Mercator row carries no datum and a direct step would skip the source's Helmert shift.
  - The table holds about 160 codes, each written in a form proj4rs reads correctly (the shift spelled out, no `+pm`, no datum on 3857) and checked against PROJ's `cs2cs` on a reference grid: within 1 cm of PROJ for the same shift, within its stated accuracy of PROJ's own operation (1 cm; Krovak 3.1 m), inverses within 3e-8 deg (`every_row_matches_proj_on_its_reference_grid`).
  - A GeoTIFF names its system by code or spells a row out key by key; compound 7415, 5698 and 5699 read as 28992 and 2154. Every other system, feet units and non-GeoTIFF sources are refused before the item exists, with one message naming the code and the supported systems. Stored references are canonical `EPSG:n` in `crs_ref`; written files carry code keys only; `crs_class` comes from the row.
- **Display tiles are written in Web Mercator.** `rust_engine/warp.rs` writes every display derivative in EPSG:3857 on one global lattice (the Web Mercator origin, a zoom-ladder rung chosen once per item), by nearest neighbour in bounded windows, so values and NoData stay exact and adjacent parts leave no gap or double cover. The renderer takes cog-tiler's affine path and refuses any other mode; it does no coordinate work. At a pixel centre the drawn value is the native cell hover reads (`a_pixel_centre_shows_the_value_hover_reads_there`).
- **Memory is bounded by the existing capacity limit, not by the raster.** A GeoTIFF converts through the one writer in row windows of whole tiles holding at most `import::MAX_RAW_EXTRACTION_CELLS` cells, at any size the admission bounds allow (2 GiB per file, 400 M cells per import checked before a source converts, free space). Each overview level is averaged from the level before it, read back from the file being written, so the output is byte-identical to a whole conversion. Cancellation is checked between windows, chunks and levels. (Amended 2026-10-03, canopi-dfc0.)
- **What cannot stream loads whole under that limit.** Uncompressed strips are read by byte range and every other chunk is decoded whole, so a GeoTIFF whose compressed chunk decodes above 64 MiB, and every other format (`wbraster` has no window API), is loaded whole after the limit, with the same named reason as any other whole-raster read. Display parts are composed at most 4×4 chunks at a time.
- **GDAL stays only as a test oracle.** `gdal_engine.rs` is compiled for tests, found through `CANOPI_LIDAR_GDAL_BIN` or `PATH`, and used by the ignored comparison lane `rust_engine::comparison`, which skips cleanly without GDAL. Its display oracle is `gdalwarp -t_srs EPSG:3857 -r near` on the same lattice, so the warp has an independent check (A6). No environment variable, CI install, guide or release note mentions GDAL as a requirement.
- **Roadmap rule** (A12). Whitebox tools (`wbtools_oss`, `wblidar`, `wbvector`, which carry their own `wbprojection`) read and write native coordinates only; every longitude/latitude step goes through `crs.rs`; the GeoLibre CLI's WGS84 GeoJSON is never trusted for placement. Analysis runs in the native CRS.
- **Vocabulary is unchanged.** Probes keep GDAL's driver, band type, mask flag and compression names, which the catalogue and admission rules were written against.

## Where Canopi differs from GeoLibre

GeoLibre places rasters with proj4js on `geotiff-geokeys-to-proj4` in the browser, inspects through epsg.io and places point clouds from their WKT. Canopi follows its one placement path, native analysis and refusing what that path cannot read, and differs where following it would misplace users' data:

- **(a)** Definitions come from Canopi's table with Helmert shifts, not from the geokeys table, whose national grids carry none (the Delft tile 110 m off).
- **(b)** Rust warps display tiles to 3857 when it prepares them; a browser warp would re-derive the CRS from the keys and become a second reader.
- **(c)** One authority serves display, hover, extents and the import check; GeoLibre has three.
- **(d)** The point-cloud WKT path is not copied: it throws on compound 7415, the code of every AHN LAZ, and is up to 578 km off.
- **(e)** `wbprojection` places nothing; it stays in the build only under `wbraster`.

## Rejected alternatives

- **Bundling GDAL** (canopi-fxil.20): 100+ MB of native libraries and data per platform, three packaging pipelines, and a child-process contract for every read.
- **`georust/proj` and the `gdal` crate bindings**: both link the C libraries, so they bundle the same tree and need it at build time on every CI runner and contributor machine.
- **`wbprojection` as the registry**: 30 m to 1,262 km off on the grids above and no 5698. Canopi's own Swiss and LAEA formulas, which corrected it, went with it.
- **Every code PROJ knows** (U24, `crs-definitions`): about 1,300 more codes with no reference grid each; a short measured table and a named refusal serve the users (U31).

## Consequences and caveats

- Import, display, inspection and coverage work on every machine the installers target; only Slope still needs the GeoLibre CLI.
- Placement is about 1–2 m absolute (Helmert shifts, no grid files) and Krovak within 3.1 m of PROJ; NTF Lambert data moved about 17 km, Lambert-93, Swiss and LAEA data did not move.
- Adding a code is one row, a run of `scripts/gen_crs_reference_points.sh` and its line in `display_cog.rs`'s `ROW_DIGESTS`; an edited row or a `proj4rs` bump changes the display profile digest, so derivatives regenerate (profile `display-cog-3857-v2`).
- The comparison lane is the standing proof against GDAL. Measured on 2026-09-28 against GDAL 3.8.4: on GDAL-authored Float32, striped, Int16 LZW predictor 2, Byte, big-endian UInt32 and Float64, PackBits and user-defined Lambert GeoTIFFs, an Esri ASCII grid, an XYZ grid and the IGN LiDAR HD tile, samples, controlled COGs and finite overview cells are identical, and statistics agree within 1e-13 relative. Point transforms over every row agree with GDAL given the row's definition within 1e-3 m and 1e-7 deg.
- GeoTIFF sources import at any admitted size, as they did with GDAL. A large source in another format, or a GeoTIFF stored as one huge compressed strip, is still refused by name above 25 M cells; the fix is to rewrite it as a tiled GeoTIFF.
- GDAL counted `±inf` samples as values; Canopi's validity rule (finite and not NoData) now applies to statistics and overviews alike.
- A bump of `wbgeotiff`, `wbraster` or `proj4rs` re-runs the comparison lane before it merges (advice).
