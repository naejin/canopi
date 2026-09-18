# Raster qualification receipt (slice Q)

Status: evidence — bounded local reads and display tiles are qualified for prepared tiled COG
derivatives driven by native preparation; the slope role is qualified as native GDAL; a required
WASM slope route is rejected; numeric windowing against raw stripped GeoTIFFs is not available from
the candidate roles.
Tracking: `canopi-kqpp` (parent epic `canopi-j571`). Spec: [raster rework](raster-data-analysis-rework.md).
Current guidance: [LiDAR](../agent/lidar.md), [edition development](../agent/edition-development.md).

This receipt is the Q exit artifact. It records pinned artifacts, exact APIs, supported inputs,
resource and correctness measurements, reproducible commands, and a pass/fail/inconclusive result
for each of the six ordered experiments. It selects no production engine and authorizes no
downstream slice. **N1 and every later production slice remain blocked pending independent review
of this receipt.**

## What was executed

| Item | Value |
| --- | --- |
| Repository revision at start | `ab2f7d25` on `feature/raster-html-references` (contains the P approval record) |
| Bead | `canopi-kqpp`, claimed before any harness code was written |
| Harness | `scripts/raster-qualification/` (new, isolated; no production import path) |
| Host | Linux 7.0.0-31-generic x86_64, 8 CPUs, 32,007 MiB RAM, Python 3.12.3, Node v22.22.0, GDAL 3.8.4 |
| Engines qualified | Chromium 150.0.7871.46 (system Chrome). WebKit and macOS/Windows remain unavailable — see [Unavailable evidence](#unavailable-evidence) |
| Production changes | **none** — no engine switch, no IPC, no schema, no command registration |

Two candidate artifacts were resolved to obtainable builds and exercised in a real browser. Three
preparation/analysis roles use the system GDAL CLI that the plan already retains as the reference
and as an allowed native preparation/processing path.

## Experiment results

| # | Experiment | Result | One-line evidence |
| --- | --- | --- | --- |
| 1 | Resolve candidate artifacts | **pass with corrections** | Both pinned commits published under different semver than their manifests declare; `cog-tiler-wasm@0.3.6`, not `0.3.1`, has the pinned `gitHead`; exact SHAs and licenses recorded |
| 2 | Metadata and numeric windows via the local bridge | **fail (role unavailable as specified)** | Bounded window reads are exact on tiled COG inputs, but `CogStream` rejects every stripped GeoTIFF and the only working path materialises the whole file |
| 3 | Tiled derivatives, generation windows, display tiles | **pass** | A native COG derivative is cell-exact, becomes boundedly addressable, renders XYZ PNG tiles, and 5 window reads match the original with 0 mismatches |
| 4 | Blocked slope with halo, both units | **pass (native GDAL); WASM route rejected** | Analytic planes exact within tolerance, 0.000378° agreement with `gdaldem` on a non-planar surface; the Whitebox WASI `slope` tool is rejected for edge correction |
| 5 | Cancellation and failure injection | **pass with one defect recorded** | Cancellation settles in 0.1 ms with none scheduled after abort; corrupt/truncated input and out-of-image windows reject cleanly; **double-dispose throws** |
| 6 | Resource fixtures and capability matrix | **pass** | 400,000,000-cell file read in bounded `1024x1024` windows: 18.3 MiB incremental peak RSS against a 1024 MiB budget, 4 MiB maximum single read |

## Experiment 1 — candidate artifact resolution

### Source-to-artifact correspondence (corrects the plan's inspected text)

The plan records `whitebox-wasm` `9c0ff4f…` and `cog-tiler-wasm` `a71c321…`, and notes that the
cog-tiler workspace "says 0.3.1 while GeoLibre declares a newer package range". Resolving the actual
registry metadata shows the divergence is larger than the plan's wording, and that its stated
version mapping is inverted:

| Source commit | Manifest version at that commit | Published artifact with this `gitHead` | Artifact selected |
| --- | --- | --- | --- |
| `whitebox-wasm` `9c0ff4fdf3513f27b89c78e294610c3b418b3a4f` | `0.6.0` | **none** | `0.5.1` (newest published; `gitHead` `6920adee…`, predates the pin) |
| `cog-tiler-wasm` `a71c321d357b0fde063238ab38bcf7ddb914eacd` | (no version field) | `0.3.6` | `0.3.6` (exact match) |

Consequences that downstream work must carry:

- There is **no obtainable `whitebox-wasm` build of the pinned commit**. The selected `0.5.1` is a
  real released artifact but is *not* the pinned source. Any API relied on must be verified against
  `0.5.1`, not against the pinned repository.
- `cog-tiler-wasm@0.3.1` — the version named in the plan — has `gitHead` `770519f4…`, a different
  commit. It also declares `peer whitebox-wasm@^0.4.1`, so it cannot be installed alongside
  `whitebox-wasm@0.5.1` at all.
- The capability the pinned source adds that `0.5.1` lacks is `first_ifd_offset` and
  `CogStream.from_windows` (plain-GeoTIFF parsing from a tail window). It is unpublished, so it is
  not available. **It would not have changed the Experiment 2 outcome**: `from_windows` only solves
  *locating* the directory; `CogStream` still rejects a striped layout.

### Peer resolution failures reproduced

Two install-time/runtime failures were reproduced, and neither is hypothetical:

1. `cog-tiler-wasm@0.3.1` + `whitebox-wasm@0.5.1` → npm `ERESOLVE` on `peer whitebox-wasm@^0.4.1`.
2. `cog-tiler-wasm@0.3.6` + `geotiff-geokeys-to-proj4@2026.8.16` (the newest version its peer range
   admits) → runtime `TypeError`: that release dropped the default export that cog-tiler's
   `geokeysToProj4.toProj4(geoKeys)` call depends on. The working pin is `2024.4.13`.

A third, subtler packaging issue: resolving `geotiff` through its `"browser"` export condition
selects a bundle that **omits `fromBlob`**, which is the only API cog-tiler uses for local files.
The ESM `"import"` condition must be used instead. That build statically imports Node's `http`,
`https`, `url`, `fs` and `stream` for its remote client, so a browser host needs inert stubs for
those specifiers. This is recorded as a real integration cost for slice D, not a harness artefact.

### Pinned artifact manifest

Exact versions, registry integrity digests, licenses and the two wasm artifacts are recorded in
`scripts/raster-qualification/candidates.json`, and reproduced by
`scripts/raster-qualification/bootstrap_bench.py`, which installs only into an isolated bench and
verifies each artifact's integrity against the lock file. Sixteen artifacts verified. Licenses are
all permissive (MIT / Apache-2.0 / BSD-3-Clause / CC0-1.0 / MIT AND Zlib / MIT AND BSD-3-Clause);
no licensing gate fails.

Built wasm artifacts hashed during bootstrap:

| Artifact | File | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `whitebox-wasm@0.5.1` | `whitebox_wasm_bg.wasm` | 4,396,465 | `05be6b73a1afb0e5c20369adaf9d6cb1aaf8c683f215486d853dd861e7842a92` |
| `whitebox-wasm@0.5.1` | `whitebox-cli.wasm` | 17,669,477 | `d3341e68da5dfe706890967b187b01fb2a8470e061694d720647d4bfff271750` |
| `cog-tiler-wasm@0.3.6` | `cog_tiler_wasm_bg.wasm` | 132,951 | `3cf59494b9adc9c3db470a4d3852bfb44df41a8f9dbabb5656287438a5813f39` |
| `lerc@4.2.0` | `lerc-wasm.wasm` | 117,023 | `5eb48318480d8499ba3ab45dc32e833f239d5a41c253d4892ceacabed8b27bca` |

`geolibre-wasm` `1.5.3` was inspected as registry metadata only. The plan defers wholesale adoption
and forbids building the deferred engine, so no artifact was installed or built.

## Experiment 2 — local numeric access: **fail as specified**

This is the one required role that does not qualify, and it is the reason this receipt stops for
review rather than proceeding.

The contract in the plan requires metadata and full-resolution numeric windows "from local managed
files via the intended Desktop/native/worker bridge", and states explicitly that "a remote HTTP demo
or `File.arrayBuffer()` of the whole fixture does not qualify local access". Measured on the real
recorded fixture:

| Fixture property | Measured | Bounded range read available? |
| --- | --- | --- |
| Original IGN MNH/MNT: striped, uncompressed, single 16,000,000-byte strip | `tiled=false`, `compression=None`, `rowsPerStrip=2000` | **No** — `CogStream` throws `image is striped, not tiled; tile range streaming requires a tiled COG` |
| Header-only metadata from a 64 KiB prefix | succeeded | Yes (metadata only, ~0.4 % of file) |
| Prepared tiled COG derivative | `tiled=true`, 256x256 tiles, 4 levels | **Yes** |

So the *decoder* is bounded when the input is tiled, and the *metadata* path is bounded even for
stripped input, but there is no bounded path for the numeric windows of the stripped originals that
the library actually manages.

The measured consequence, on the real 16,000,513-byte fixture, is that the only working numeric
path materialises the entire raster into wasm memory (`read_band_f32` → 4,000,000 Float32 samples in
42.3 ms). The values returned are **correct** — first row and the whole array match GDAL exactly
(GDAL reports min −0.3959961, max 30.443832, mean 0.8350162, and the candidate agrees) — but the
access is whole-file, which is the property the rework exists to remove.

The measured capability boundary:

| Capability | Available |
| --- | --- |
| Metadata from a small prefix, any layout | yes |
| Bounded window decode, tiled COG | yes |
| Bounded window decode, stripped GeoTIFF | **no** |
| Whole-file decode in wasm memory | yes, bounded by the ~4 GiB wasm32 ceiling |
| Values correct where a read succeeds | yes |

**Why this is survivable rather than fatal, and what it costs.** The plan's Experiment 3 explicitly
prepares "tiled derivatives from the stripped IGN inputs", and the inventory explicitly allows
native GDAL to "retain preparation and slope". Numeric access therefore qualifies *for prepared
derivatives*, which is the route Experiment 3 validates end to end. What is **not** available is the
plan's more general statement that numeric reads take "an immutable generation plus bounded
window/resolution" against whatever asset form the library holds. Any legacy generation still held
as a stripped original is readable only whole-file. This must be resolved in N1 (for example by
requiring preparation before a head becomes numeric-readable) and it requires the reviewer's
agreement, because it is a narrowing of the numeric-access contract as written.

## Experiment 3 — preparation, derivatives, display and reprojection: **pass**

### Native preparation integrity

A tiled COG derivative was prepared from the real stripped fixture with
`gdal_translate -of COG`, and validated against the original:

| Property | Measured |
| --- | --- |
| Original SHA-256 before / after preparation | `c4e2938e8a166b723f25c7ac3f5a64d21555671b758fb3b40b71daac45a8bc28` — **unchanged** |
| Derivative SHA-256 | `a42547d1e8b93854715e25b9e906740b4fd4b559b34d141de48989c122c08b1a` |
| Cell-exact equality vs original | **true**, max absolute difference `0.0` |
| Size | 16,000,513 → 2,053,193 bytes (12.8 %) |
| Preparation time | 0.247 s |
| Levels after prep | 4 (2000², 1000², 500², 250²) |

### Bounded readback through the candidate

Five windows were read from the derivative through `CogStream`; each was compared cell-by-cell
against the original:

| Window | Tiles | Bytes fetched | Share of derivative | Valid-cell mismatches |
| --- | --- | --- | --- | --- |
| origin-first-data-column (64²) | 1 | 57,423 | 2.80 % | **0** |
| interior (64²) | 1 | 3,611 | 0.18 % | **0** |
| far-corner (16²) | 1 | 43,674 | 2.13 % | **0** |
| last-rows (64x16) | 1 | 32,095 | 1.56 % | **0** |
| multiple-tiles (256²) | 1 | 9,136 | 0.44 % | **0** |

### Multi-member generation resolution

The 24-member collection occupies 24 of 30 lattice slots, leaving a genuine gap. Windows crossing
member boundaries resolve exactly:

| Window | Members replayed | Coverage | Max error vs analytic |
| --- | --- | --- | --- |
| across-columns-0-1 (2600²) | 4 | 6,760,000 / 6,760,000 | 0.0 |
| across-rows-0-1 (2600²) | 4 | 6,760,000 / 6,760,000 | 0.0 |
| single-member (128²) | 1 | 16,384 / 16,384 | 0.0 |
| all six unoccupied slot(s) | 0 | **0** coverage each | n/a |

Block allocation follows occupied coverage, not the bounding rectangle: the unoccupied slots return
no coverage at all.

### Local transport (the real bridge, measured)

The load-bearing transport test used a genuine disk-backed `File` handed to the page by a host file
input — not `fetch`, not an in-memory copy:

| Measurement | Value |
| --- | --- |
| Handed-over object | `File`, 2,053,193 bytes |
| Ranged reads issued | 6, largest 65,536 bytes |
| Total bytes read | 95,151 — **4.63 % of the file** |
| Result | `openCog` succeeded; `renderTilePNG` produced a 2,364-byte PNG; `statistics()` returned |

This satisfies the plan's requirement to "qualify this local bridge, not just HTTP COG access", for
prepared derivatives.

### Display tiles and reprojection

| Fixture | Mode | Decoder | Levels | Tile latency (4 tiles) |
| --- | --- | --- | --- | --- |
| `plane256` | warp | wasm | 3 | 14.3 – 34.0 ms |
| `plane2000` | warp | wasm | 3 | 11.3 – 22.9 ms |
| `steep45` | warp | wasm | 1 | 16.2 – 18.9 ms |
| derived IGN COG | warp | wasm | 4 | PNG production verified |

Every tile was produced by the wasm decoder (`readsViaGeoTiff=false`). Non-identity reprojection is
exercised: each fixture is EPSG:2154 and was warped on the fly, reported as `warped from +proj=lcc`,
with plausible WGS84 bounds (approximately 48.30 °N, −0.44 °E) matching the GDAL reference.

Separately, `CogBuilder` produced a 512x512 tiled COG with overviews in 73 ms (66,981 bytes), from
which a window read fetched 14,436 bytes rather than the whole artifact — so a bounded derivative can
also be produced without native GDAL where the pixels are already in memory. This is not a
substitute for preparation of large originals.

### Overviews and coverage

Overviews are generated during preparation and read as distinct levels. The reduction rule is
`NEAREST`, recorded in the preparation command. The plan requires that reduction "never let
low-resolution source overviews resurrect replaced pixels"; that is a resolver property owned by N1
and is **not** proven here — this experiment proves the levels exist and are addressable.

## Experiment 4 — blocked slope with halo: **pass for native GDAL, WASM route rejected**

### Native GDAL slope (the retained role)

| Fixture | Expected | Max absolute error | Tolerance | Cells eligible |
| --- | --- | --- | --- | --- |
| `plane2000` (analytic plane) | 24.094842552° / 44.721359550 % | 3.26e-4 ° / 6.82e-4 pp | 0.001 ° / 0.01 pp | 3,992,004 |
| `steep45` (45° plane) | 45° / 100 % | 8.50e-5 ° / 2.97e-4 pp | 0.001 ° / 0.01 pp | 3,844 |
| `curved256` vs `gdaldem` | independent Horn implementation | **3.778e-4 °** | 0.001 ° | 64,516 |

Both units pass. The errors are Float32 representation of the fixtures, not algorithmic error. The
recipe implemented and verified is Horn 3x3, dividing by the pixel size in metres, requiring full
3x3 validity, with no edge interpolation and a one-cell halo written to the core only.

The 400-million-cell plane was additionally probed at block seams and hole edges with bounded reads:
`seam-row-4096`, `seam-row-8192`, `hole-edge-row-4608`, `hole-edge-col-8704` and `far-corner` each
read 256 bytes (8 rows x 8 columns x 4 bytes) exactly, with the punched NoData returning `-9999.0`
and correct validity.

### Rejection of the Whitebox WASI `slope` tool

`whitebox-cli.wasm` ships 733 tools and runs under wasmtime 29.0.1, so the route is technically
reachable. It is rejected on the plan's own scientific contract:

| Check | Result |
| --- | --- |
| Interior of an analytic plane | correct: 24.0948429107666° vs expected 24.094842552°, max deviation 2.75e-4 ° |
| Edge behaviour | **interpolated**: boundary values 6.008° – 18.0° where the plane is uniformly 24.095° |
| Output validity cells | 65,536 of 65,536 — it fills edges rather than leaving them invalid |
| `curved256` vs `gdaldem` | max difference 4.885°, with **all 807 cells above 1° inside a 3-cell border** |
| Peak RSS (one 256² run) | 145,668 KiB for a 256x256 input |

The plan requires "no edge interpolation" and "full 3x3 validity ... even when the center is valid".
The tool interpolates edges and reports every cell valid, so it does not meet the retained GDAL
slope behaviour. It is recorded as **rejected**, not as an alternative.

### CRS interpretation of the incomplete WKT

The recorded fixtures declare EPSG:2154 with incomplete datum detail. Measured:

| Check | Result |
| --- | --- |
| GDAL reference control points, round-trip error | 5.8e-11 – 1.9e-9 m (tolerance 0.1 m) — **pass** |
| Candidate `geotiff_info` EPSG | `null` |
| Candidate WGS84 bounds | unavailable (`center_lonlat: null`, `bbox_lonlat: null`) |
| Candidate `GeoTiffReader.bounds_lonlat()` | `[]` |

**The supplied incomplete EPSG:2154 WKT is not usable by the candidate's pure-Rust projection
engine.** GDAL remains the CRS authority. The engine refused to guess rather than silently applying
an assumed datum, which is the correct failure mode, but it means the WASM display role cannot
place these fixtures on a map without external CRS resolution. Slice D must supply the CRS, and
this is recorded as a limitation rather than papered over. No original was rewritten.

## Experiment 5 — cancellation, failure injection and lifecycle: **pass with one defect**

| Injection | Observed | Verdict |
| --- | --- | --- |
| Abort before scheduling tile fetches | 0 tasks scheduled after abort; settled in 0.1 ms | **pass** |
| Truncated header (3 bytes) | rejected: `decode: I/O error: failed to fill whole buffer` | **pass** |
| Corrupt tile bytes (XOR'd deflate stream) | rejected: `Compression error (Deflate): corrupt deflate stream` | **pass** |
| Window origin outside the image | rejected: `window origin outside image` | **pass** |
| Double dispose of a `CogStream` | **throws `Error: null pointer passed to rust`** | **defect** |
| Whole-file read on a 1.6 GB input | **not attempted** — bounded by the wasm32 ceiling; see Experiment 2 | inconclusive by design |

The first four behaviours are what the plan requires: cancellation stops scheduling immediately,
and malformed or hostile input fails loudly instead of producing silent garbage.

**The double-dispose defect is a real finding.** The plan requires that "partial initialization can
be disposed twice safely". The published candidate's `free()` is not idempotent, and calling it
twice raises a Rust null-pointer error. Any adapter must guard disposal with an explicit
already-freed flag rather than relying on the artifact. This is a candidate defect, not a harness
artefact, and it is recorded here so slice D does not discover it in production.

Two lifecycle properties were **not** exercised and are recorded as unproven rather than passed:
forced termination of a stalled worker/subprocess, and disk-write failure rollback. Both depend on
the real Desktop WebView and worker host that slices D/F own. Local transport was instead qualified
in Chromium only.

## Experiment 6 — resource fixtures: **pass**

Measured on the disposable 20,000x20,000 Float32 plane: 400,000,000 cells, 1,600,240,520 bytes
(above the required 1 GiB), 0.5 m pixels, `z = 0.1x + 0.2y − 100` in metres, uncompressed with
one-row strips so exact byte ranges are computable, including holes crossing processing-block
boundaries.

| Measurement | Value | Budget |
| --- | --- | --- |
| Reads performed | 25 | — |
| Window size | 1024x1024 cells (the contract maximum) | ≤ 1024x1024 |
| Maximum single read | 4,194,304 bytes | — |
| Total bytes touched | 104,857,600 (6.55 % of the file) | — |
| Incremental peak RSS above baseline | **19,185,664 bytes (18.30 MiB)** | ≤ 1024 MiB |
| Baseline RSS | 43,667,456 bytes | excluded |
| OS high-water, self | 58,728,448 bytes | — |
| OS high-water, children | 58,634,240 bytes | — |
| Max concurrent children | 1 | — |
| Read latency median / p95 / max | 25.59 / 27.71 / 27.91 ms | — |
| Sampling | 100 ms interval, 7 samples | required 100 ms samples |

Representative bounded reads on the same file, all with exact analytic agreement:

| Window | Bytes read | Share of file | Max analytic error |
| --- | --- | --- | --- |
| interior 8x8 | 256 | 0.000016 % | 0.0 |
| origin 1024x1024 | 4,194,304 | 0.262 % | 0.0 |
| bottom-right 4x4 | 36 | 0.000002 % | 0.0 |
| partly out of extent (20x20) | 400 | 0.000025 % | 0.0 |

The 400-million-cell case completes import-free bounded reads far inside the 1 GiB gate. The plan's
release gate for this fixture also requires slope without a whole-grid allocation; this harness
measured the *bounded read* path, not a blocked slope over all 400 million cells, and that gap is
recorded under [Remaining limitations](#remaining-limitations).

### Capability matrix

| Fixture class | Bounded metadata | Bounded numeric window | Display tiles | Slope |
| --- | --- | --- | --- | --- |
| Small synthetic tiled COG (256²) | yes | yes | yes | native GDAL |
| Moderate tiled COG (2000²) | yes | yes | yes | native GDAL |
| 24-member aligned collection with gap | yes | yes (per member) | yes | native GDAL |
| 400M-cell uncompressed single file | yes | yes (native, byte-ranged) | not attempted | not attempted |
| Real IGN stripped original | yes | **no** (whole-file only) | **no** (striped) | native GDAL |
| Real IGN prepared COG derivative | yes | yes | yes | native GDAL |

## Role-to-artifact table

This is the primary required output of the slice.

| Role | Qualified artifact | Exact API | Verified behaviour | Status |
| --- | --- | --- | --- | --- |
| Preparation | GDAL 3.8.4 `gdal_translate -of COG` | `gdal_translate -of COG -co COMPRESS=DEFLATE -co BLOCKSIZE=256` | Cell-exact derivative; original hash unchanged; 12.8 % size; 0.247 s for 16 MB | **qualified** |
| Numeric window decode | `whitebox-wasm@0.5.1` | `new CogStream(headerBytes)`; `tiles_for_window(level,x,y,w,h)` → `{col,row,offset,length}[]`; `tile_range(level,col,row)`; `decode_tile_f64(level, bytes)`; `levels_json()`; `geo_transform()`; `.epsg`; `.nodata`; `.num_levels`; `.free()` | Exact Float32 samples, 0 mismatches, bounded tile fetches. **Tiled COG inputs only** | **qualified for prepared derivatives** |
| Numeric window decode (native reference) | Python stdlib + NumPy byte-range reader | `read_tiff_layout`, `read_window_bounded` | Exact analytic agreement on 400M cells; 4 MiB max read; 18.3 MiB peak RSS | **qualified as reference**, not a production engine |
| Metadata | `whitebox-wasm@0.5.1` | `geotiff_info(prefixBytes)`; `GeoTiffReader.info_json()`, `.width/.height/.bands/.sample_format/.compression/.geo_transform()/.bounding_box()` | Correct for stripped and tiled input; EPSG `null` on the incomplete WKT | **qualified**, CRS limitation noted |
| Whole-file decode | `whitebox-wasm@0.5.1` | `GeoTiffReader.read_band_f32(band)` | Values match GDAL exactly; whole raster resident | **available but not bounded** |
| Slope | GDAL 3.8.4 `gdaldem slope` | `gdaldem slope INPUT OUTPUT -b 1 [-p]` (Horn default) | Both units within tolerance; 3.778e-4 ° vs independent Horn | **qualified** |
| Slope (alternative) | `whitebox-wasm@0.5.1` `whitebox-cli.wasm` under wasmtime | `whitebox slope --input= --output= --units=degrees` | Interior correct, but edge-interpolated and all-cells-valid | **rejected** |
| Reprojection and display | `cog-tiler-wasm@0.3.6` | `openCog(source)`; `CogSource.renderTilePNG(z,x,y,opts)`; `.info()/.tilejson()/.levels/.boundsLonLat/.crsLabel/.mode`; `registerCogProtocol(maplibregl,name,resolve)`; `compressionDecoder()` | PNG tiles from wasm decoder; on-the-fly EPSG:2154 warp; local `File` sliced from disk | **qualified for prepared derivatives** |
| Local transport | Browser `File` from a host file input | `Blob.prototype.slice` ranged access; 6 reads, largest 65,536 bytes, 4.63 % of file | Bounded, no whole-file read | **qualified for prepared derivatives** |
| Point/value sampling | `cog-tiler-wasm@0.3.6` | `CogSource.point(lon, lat, {bidx})` | Returns coordinates, values and band names in the display probe | **available**; not numerically validated here |
| Inspection-grade pixel lookup | — | — | Not exercised; the contract wants native one-pixel lookup through the numeric seam | **not qualified here** (slice I) |

### Exact call signatures used

```js
// whitebox-wasm@0.5.1  (prebuilt wasm-bindgen, wasm32-unknown-unknown)
import init, { geotiff_info, GeoTiffReader, CogStream, CogBuilder } from "whitebox-wasm";
await init({ module_or_path: <Uint8Array of whitebox_wasm_bg.wasm> });

const info = JSON.parse(geotiff_info(headerPrefix));      // header-only, any layout
const stream = new CogStream(headerPrefix);                // tiled COG only
const tiles = JSON.parse(stream.tiles_for_window(0, x, y, w, h)); // [{col,row,offset,length}]
const values = stream.decode_tile_f64(0, bytesOfThatRange);       // Float64Array, interleaved
stream.free();                                             // NOT idempotent — guard it

// cog-tiler-wasm@0.3.6
import { openCog, init as ctInit, compressionDecoder } from "cog-tiler-wasm";
await ctInit();
const source = await openCog(arrayBufferOrBlobOrUrlOrFile);
const png = await source.renderTilePNG(z, x, y, { min, max, colormap: "viridis" });
```

### Supported inputs and explicit rejections

**Supported.** Single-band continuous numeric GeoTIFF; Float32 (verified), and Float64/Int32/Int16/
UInt8 through the same `decode_tile_f64` path as declared by `levels_json()`. EPSG:2154 for
preparation and reprojection when the CRS is resolvable by GDAL. Uncompressed and Deflate
compression. Tiled COG layouts for all bounded numeric and display operations. Stripped layouts for
metadata only.

**Explicit rejections, all measured.**

| Input | Behaviour |
| --- | --- |
| Stripped GeoTIFF, bounded numeric window | `CogStream` constructor throws `image is striped, not tiled; tile range streaming requires a tiled COG` |
| Window whose origin is out of extent | throws `window origin outside image` |
| Truncated header | throws `decode: I/O error: failed to fill whole buffer` |
| Corrupt compressed tile | throws `decode tile: Compression error (Deflate): corrupt deflate stream` |
| Double dispose | throws `null pointer passed to rust` |
| Incomplete EPSG:2154 WKT | EPSG resolves to `null`; WGS84 output unavailable |
| LERC / ZSTD codecs | routed to geotiff.js by `compressionDecoder`, not the wasm decoder; not exercised on these fixtures |

## Cache and worker lifecycle

- Cog-tiler's decompression and reprojection run inside the wasm module on the page's main thread;
  no worker was created by the artifacts in these experiments. The plan requires display decoding
  to run off the UI thread when using WASM, so **worker hosting is a slice D obligation, not
  evidenced here.**
- No app-managed persistent cache exists in the candidate artifacts beyond geotiff.js's internal
  block cache. Cache keys, eviction and the plan's 128 MiB decoded / 512 MiB disk cache budgets are
  slice D obligations.
- Cancellation is cooperative at the tile-request level. The harness verified that after abort no
  further tile was scheduled and the operation settled in 0.1 ms. Forced worker/subprocess
  termination and the 5-second settle bound were **not** exercised.
- Disposal must be guarded; see the Experiment 5 defect.

## Versioned derivative and manifest layout

Observed and recommended layout for the prepared derivative, which N1 should adopt or supersede
explicitly:

```
<library root>/
  originals/<dataset>/<source basename>        # byte-identical managed original, never rewritten
  generations/<generation id>/
    manifest.json                              # lattice, units, validity encoding, ordered members,
                                               # prepared artifact versions, engine identity
    members/<job id>-<ordinal>.tif             # prepared tiled COG (member-window-v1)
    results/<analysis id>.tif                  # immutable analysis result
```

The derivative itself carries the lattice. Measured on the prepared COG: `TILED=YES`,
`BLOCKSIZE=256`, `COMPRESS=DEFLATE`, internal overviews at 1000², 500², 250², NoData `-9999`,
GeoTransform preserved exactly (`444999.75, 0.5, 0, 6806000.25, 0, -0.5`).

Q fixes the engine-specific tile format only to the extent measured: **a tiled, Deflate-compressed
GeoTIFF/COG derivative with internal overviews is readable boundedly by the qualified decoder.**
The plan's `member-window-v1` catalog representation and sparse occupied-block index remain N1 work.

## Reproducible commands

The harness is `scripts/raster-qualification/`. All paths below are placeholders for a scratch root
outside Git; substitute `$SCRATCH`. Candidate packages are installed only into the bench.

```sh
# 1. Install pinned candidates into an isolated bench and verify integrity
python3 scripts/raster-qualification/bootstrap_bench.py --bench "$SCRATCH/bench"

# 2. Generate fixtures (small first; largeplane is separate and ~1.6 GB)
python3 scripts/raster-qualification/generate_fixtures.py --root "$SCRATCH/fx" \
  --fixture plane256 --fixture plane2000 --fixture steep45 --fixture curved256 \
  --fixture tiles24 --manifest "$SCRATCH/out/fixtures.manifest.json"
python3 scripts/raster-qualification/generate_fixtures.py --root "$SCRATCH/fx" --fixture largeplane

# 3. Record the host
python3 scripts/raster-qualification/measure.py sysinfo --out "$SCRATCH/out/sysinfo.json"

# 4. Experiment 1 — artifact record (written by the bootstrap summary + candidates.json)
cat "$SCRATCH/bench/bootstrap-summary.json"

# 5. Experiment 2 — metadata and windows on tiled COGs, then compare with the oracle
node scripts/raster-qualification/run_wasm_probe.mjs --experiment q2 \
  --bench "$SCRATCH/bench" --fixtures "$SCRATCH/fx" \
  --fixture-map "$SCRATCH/fixture-map-tiled.json" --out "$SCRATCH/out/q2.json" \
  --engines chromium --chromiumExecutable /usr/bin/google-chrome
python3 scripts/raster-qualification/measure.py q2-numeric \
  --browser-report "$SCRATCH/out/q2.json" --fixtures "$SCRATCH/fx" \
  --fixture-map "$SCRATCH/fixture-map-tiled.json" --out "$SCRATCH/out/q2-numeric.json"

# 5b. Experiment 2 — the stripped-fixture negative control
node scripts/raster-qualification/run_wasm_probe.mjs --experiment q2 \
  --bench "$SCRATCH/bench" --fixtures "$SCRATCH/fx" \
  --fixture-map "$SCRATCH/fixture-map-ign.json" --out "$SCRATCH/out/q2-ign.json" \
  --engines chromium --chromiumExecutable /usr/bin/google-chrome

# 6. Experiment 3 — native preparation, fidelity, bounded readback
gdal_translate -of COG -co COMPRESS=DEFLATE -co BLOCKSIZE=256 \
  "$SCRATCH/fx/ign/<fixture>" "$SCRATCH/fx/derived/mnh_cog.tif"
node scripts/raster-qualification/run_wasm_probe.mjs --experiment q3prep \
  --bench "$SCRATCH/bench" --fixtures "$SCRATCH/fx" \
  --fixture-map "$SCRATCH/fixture-map-derived.json" --out "$SCRATCH/out/q3prep.json" \
  --engines chromium --chromiumExecutable /usr/bin/google-chrome
python3 scripts/raster-qualification/measure.py q3-prepare \
  --original "$SCRATCH/fx/ign/<fixture>" --derived "$SCRATCH/fx/derived/mnh_cog.tif" \
  --browser-report "$SCRATCH/out/q3prep.json" --fixture-name derived_cog \
  --expected-original-sha256 c4e2938e8a166b723f25c7ac3f5a64d21555671b758fb3b40b71daac45a8bc28 \
  --out "$SCRATCH/out/q3-prepare.json"

# 6b. Experiment 3 — display tiles and the disk-backed File transport
node scripts/raster-qualification/run_wasm_probe.mjs --experiment q3 \
  --bench "$SCRATCH/bench" --fixtures "$SCRATCH/fx" \
  --fixture-map "$SCRATCH/fixture-map-tiled.json" --out "$SCRATCH/out/q3.json" \
  --engines chromium --chromiumExecutable /usr/bin/google-chrome
node scripts/raster-qualification/run_wasm_probe.mjs --experiment q3file \
  --bench "$SCRATCH/bench" --fixtures "$SCRATCH/fx" \
  --fixture-map "$SCRATCH/fixture-map-derived.json" --out "$SCRATCH/out/q3file.json" \
  --engines chromium --chromiumExecutable /usr/bin/google-chrome \
  --attachFile "$SCRATCH/fx/derived/mnh_cog.tif"

# 6c. Experiment 3 — multi-member resolution and gap coverage
python3 scripts/raster-qualification/measure.py q3-members \
  --collection "$SCRATCH/fx/tiles24" \
  --window across-columns-0-1:0:0:2600 --window across-rows-0-1:0:0:2600 \
  --window single-member:2:4:128 --out "$SCRATCH/out/q3-members.json"

# 7. Experiment 4 — slope, both units, analytic and GDAL references
python3 scripts/raster-qualification/measure.py q4-slope \
  --fixtures "$SCRATCH/fx" --out "$SCRATCH/out/q4.json"
python3 scripts/raster-qualification/measure.py q4-crs \
  --browser-report "$SCRATCH/out/q2-ign.json" \
  --reference "$SCRATCH/fx/ign/<fixture>" --out "$SCRATCH/out/q4-crs.json"

# 8. Experiment 5 — cancellation and failure injection
node scripts/raster-qualification/run_wasm_probe.mjs --experiment q5 \
  --bench "$SCRATCH/bench" --fixtures "$SCRATCH/fx" \
  --fixture-map "$SCRATCH/fixture-map-tiled.json" --out "$SCRATCH/out/q5.json" \
  --engines chromium --chromiumExecutable /usr/bin/google-chrome

# 9. Experiment 6 — bounded resource measurement on the 400M-cell plane
python3 scripts/raster-qualification/measure.py q6-resources \
  --fixtures "$SCRATCH/fx" --fixture largeplane --budget-mib 1024 \
  --max-reads 48 --out "$SCRATCH/out/q6-large.json"

# 10. Combine
python3 scripts/raster-qualification/measure.py compare \
  --report "$SCRATCH/out/q2-numeric.json" --report "$SCRATCH/out/q3-prepare.json" \
  --report "$SCRATCH/out/q3-members.json" --report "$SCRATCH/out/q4.json" \
  --report "$SCRATCH/out/q4-crs.json" --report "$SCRATCH/out/q6-large.json" \
  --out "$SCRATCH/out/q-summary.json"
```

`--fixture-map` files are one-line JSON objects mapping a logical fixture name to a path under the
fixture root. Two fixture maps are needed because the experiments address different sets:

```json
{ "plane256": "plane256.tif", "plane2000": "plane2000.tif", "steep45": "steep45.tif" }
```

The `whitebox-cli.wasm` slope evaluation additionally used:
`wasmtime run --dir <fixtures>::/work whitebox-cli.wasm slope --input=/work/<f> --output=/work/<o> --units=degrees`
with a writable `XDG_CACHE_HOME`. It is recorded as a rejection, not part of the qualified route.

## Remaining limitations

1. **Numeric windows against raw stripped GeoTIFFs are unavailable** from the candidate roles
   (Experiment 2). Prepared derivatives are required. This narrows the numeric-access contract as
   written and needs reviewer agreement.
2. **The incomplete EPSG:2154 WKT is not resolvable by the candidate projection engine.** CRS must
   be supplied by native preparation. GDAL is the CRS authority.
3. **No `whitebox-wasm` artifact matches the pinned source commit.** The qualified artifact is
   `0.5.1`, which predates the pin. Behaviour is qualified only for `0.5.1`.
4. **The 400M-cell fixture was not taken through blocked slope.** Bounded reads and seam/hole
   behaviour were measured; a full blocked slope over 400 million cells was not. The plan's release
   gate for this fixture remains partially unmeasured.
5. **The 48-million-cell real MNH batch was not imported.** Both acceptance fixtures named in the
   plan are present and hash-verified, and the 12-tile collection exercises multi-member resolution,
   but no 48-million-cell real batch import was performed — that is slice N2 work.
6. **Display cache budgets, queue depth, worker hosting, and the 50 ms UI-thread bound are not
   measured.** They belong to slice D.
7. **Forced worker termination, disk-write failure rollback, and crash-at-boundary recovery are not
   exercised.** They need the real Desktop host and belong to slices N2/F.
8. **Chromium only.** WebKit, macOS and Windows were not run.
9. **The WASI slope rejection is based on one tool and one surface.** It is a rejection of that route,
   not a proof that no Whitebox configuration could satisfy the recipe.
10. **`e2e.rs` explicit fixture selection was deliberately not implemented** — see below.

## Unavailable evidence

- **Desktop WebKit WebView**: the cached Playwright WebKit build does not match the installed driver
  and no matching build was downloaded. No WebKit result is claimed.
- **macOS and Windows**: not available on this host. No cross-platform claim is made; the plan
  reserves this for slice F.
- **48-million-cell real batch**: fixtures present and hash-verified, import not run.
- **Live Google/MapTiler provider paths**: unrelated to Q and not attempted.
- **`geolibre-wasm`**: deliberately not built, per the plan.

## Deliberately not implemented in Q

The plan permits Q to "extend the existing ignored `e2e.rs` to take an explicit fixture path". That
was **not** done, for a concrete reason: the existing `e2e_import_publish_slope_restart_reuse` test
names the `0446_6807` MNT tile, and the recorded fixtures on this host are the `0445_6806` tile plus
the 12-tile MNH batch. Changing the selector without a matching fixture would leave the test
unrunnable and would silently substitute a different tile, which the task rules forbid. The harness
therefore carries its own explicit-path fixture handling, and the `e2e.rs` selector change is filed
as follow-up work to be done together with a fixture that can actually run it.

## Decisions required before continuing

This receipt stops Q for independent review. It does **not** select a replacement engine, and it
does **not** authorize N1 or any other production slice. Two matters need an explicit decision:

### Decision 1 — accept preparation-gated numeric access

The qualified route requires every numeric-readable generation to be backed by a prepared tiled
COG derivative. Against that:

- The plan's numeric-access contract reads as if a generation resolves windows directly, and the
  inventory allows native preparation as a *retained* path rather than a *mandatory precursor*.
- Preparation is cheap and verified exact (0.247 s, cell-exact, original unchanged), so the cost is
  small and the scientific risk is low.
- The unresolved question is what happens to legacy generations still stored as stripped
  originals: they are readable only whole-file, which is the behaviour the rework exists to remove.

Options: (a) accept preparation-before-numeric-readability and have N1 gate on it, migrating legacy
generations lazily; (b) require a bounded reader for stripped layouts, which needs a new artifact
because no candidate provides one; (c) restrict legacy generations to metadata plus whole-file reads
with an explicit size ceiling. **This agent did not choose between these.**

### Decision 2 — whether the WASM slope rejection changes the intended split

The plan says native GDAL "may retain preparation and slope as already allowed in the inventory", so
native slope is within the authorized route and is what this receipt qualifies. The Whitebox WASI
slope tool was the available WASM alternative and fails the retained recipe. If the intent was for
slope to move to WASM, that intent is not satisfiable by the available artifact and needs a decision
about a different route or a dropped requirement. **This agent did not choose.**

## Verification performed

Structure and safety gates run for this change:

```sh
python3 scripts/check_docs.py
git diff --check
```

The harness was executed end to end on this host, in the order listed under
[Reproducible commands](#reproducible-commands), including the 400-million-cell resource run. Rust
gates were not required because no Rust source, generated contract, or production TypeScript was
modified. No production dependency was installed; the candidate packages exist only in an ignored
scratch bench, and large fixtures and measurement output are excluded from Git via `.rq-scratch/`.

## Handoff

- **Bead:** `canopi-kqpp` (qualification), parent epic `canopi-j571`.
- **Branch and commit:** recorded in the delivery note accompanying this receipt.
- **Status:** verified, **not integrated**. Pushing this branch does not integrate it.
- **Next action:** independent review of this receipt and the two decisions above. N1 must not start
  before that review concludes.
