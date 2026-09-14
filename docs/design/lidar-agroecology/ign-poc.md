# IGN-backed POC for local drone-raster analysis

2026-09-14 · Study `canopi-4eb0` · **Proposed experiment and acceptance criteria; not implemented.**

Follow the [revised recommendation](delivery-strategy.md). The target user imports their own drone-derived TIFFs. IGN supplies a controlled initial fixture to test numeric processing, efficient display and persistence. Preserve the [library requirements](../lidar-library.md) and [scientific limitations](report.md).

## 1. What the POC must establish

Import rasters through a generic path, accept coverage, run enabled analyses locally and automatically, show real outputs on the canvas, then reopen without reimport or unnecessary recomputation. Accepted input changes must invalidate and regenerate the appropriate results.

An externally prepared PNG or IGN-specific download demo does not prove this workflow. The existing gallery remains a UI prototype; the next POC needs real native data and computation. Keep experimental composition isolated and reuse application seams rather than adding temporary responsibilities to production controllers.

## 2. Initial data acquisition

The supplied trio is `LHD_FXX_0446_6807_{MNT,MNS,MNH}_O_0M50_LAMB93_IGN69`. Each covers 1 km² at 0.5 m. They share a grid; MNH equals MNS−MNT exactly for this sample. [Measured evidence](input-evidence.json).

| Input | Proposed acquisition | Purpose |
| --- | --- | --- |
| Existing central MNT/MNS/MNH | Reuse unchanged | Import, terrain, height and numerical comparison |
| Surrounding MNT | Start with eight neighbors in a 3 × 3 grid | Cross-tile processing and initial upstream context |
| Additional upstream MNT | Expand when domain diagnostics require it | Establish usable analysis coverage |
| Surrounding MNS/MNH | Only if a selected height/obstruction experiment needs it | Not required for bare-ground routing |

The 3 × 3 grid spans X tile indices **0445–0447** and Y indices **6806–6808**, including the existing centre. Discover actual files and inspect metadata: these indices are an acquisition target, not verified availability. At the sample's encoding, nine MNT tiles total approximately **144 MB**, with **128 MB** additional. Compression can change transfer size; prepared assets, masks and working arrays add storage.

**Three kilometres is not a catchment guarantee.** Compute over the larger domain and evaluate the fixed central study area. Compare one-tile and expanded results to expose boundary sensitivity. If relevant upstream paths reach an uncertain boundary or internal void, expand accordingly. A 5 × 5 MNT window would contain about 400 MB of source payload; it is not a prescribed stopping point. Set a resource ceiling before acquisition and return an incomplete result if necessary rather than expanding indefinitely.

Use project geometry as the study area when defined; otherwise the central tile is a provisional test extent. Neither viewport nor tile boundary defines the scientific domain. Agreement between two window sizes alone does not prove completeness. GRASS documents underestimated accumulation and expansion to include the catchment. [r.watershed](https://grass.osgeo.org/grass-stable/manuals/r.watershed.html).

Prefer original numeric tiles with metadata; retain source URL, dates and hashes. Numeric WMS exports require recorded requests and verified pixel registration/units. The existing export's CRS defect remains an explicit admission case. The previous study's discovery request returned HTTP 403 in this environment, so actual acquisition must first be verified through a supported public route. A development download script/manual fixture acquisition is sufficient; a production in-app downloader is not a POC prerequisite.

Keep rasters outside Git and `.canopi`; track small manifests and expected measurements. Fixture preparation must not create an IGN-only production importer: valid arbitrary filenames and non-IGN metadata must work.

## 3. Small, useful analysis set

| Output | Input | POC claim |
| --- | --- | --- |
| Terrain background and slope | MNT | Correct placement, physical units and local derivative |
| Height above ground | Imported MNH; compatible MNS−MNT comparison | Geometry above terrain, including non-vegetation objects |
| Potential flow concentration / contributing area | Admitted and conditioned MNT over the analysis domain | Topographic routing with boundary/void quality; not storm discharge |
| Wetness-indicator experiment | Terrain/routing dependencies | Compare methods/scales; no measured moisture or validated agronomic classes |

Evaluate resolutions such as 0.5, 1, 2 and 5 m for terrain/routing; select defaults from evidence. Retain native values and record aggregation/conditioning. Numerical resolution is independent of zoom. Preserve real depressions and record conditioning separately from original terrain.

Use a pinned reference implementation—GRASS is a candidate—behind the native engine seam. Do not write a new hydrology engine for this experiment. Prove execution/cancellation on the development OS and assess packaging for other supported Desktop platforms; a Linux success does not establish cross-platform support. Retain small analytic fixtures as an independent numerical check rather than only comparing an engine with itself.

Defer SoilGrids, shade simulation, tree/species recognition, automatic earthworks placement, point-cloud classification, hosted processing and public dataset distribution. They do not resolve the immediate uncertainty about imported TIFFs and local analysis.

## 4. Drone-specific qualification

IGN proves only the first stage. Before claiming the target workflow works, exercise:

| Condition | Required behavior/evidence |
| --- | --- |
| Ground DTM versus surface DSM | Do not treat canopy/building elevations as ground for routing |
| Arbitrary names/custom numeric meanings | Capabilities derive from admitted semantics/units; no required IGN name or sidecar |
| Irregular flight footprint, holes, islands | Honor exact masks in review, derivatives and quality propagation |
| Different resolution, origin, CRS or rotation | Verified, recorded normalization, or explicit unsupported outcome |
| Unknown/local vertical reference | No silent join to IGN69 or cross-survey height subtraction |
| Very fine grids / large dimensions | Estimate resources, bound processing and choose an intentional analysis scale |
| Repeated survey / partial replacement | Explicit overlap approval, immutable history and downstream invalidation |
| Missing/misleading metadata | Request necessary interpretation or return an explicit import outcome |

A 1 km² Float32 grid at 5 cm contains **400 million cells and 1.6 GB of numeric values**, 100 times the cells of the 0.5 m sample. Upsampling IGN can stress resource handling but adds no detail and cannot validate centimetre-scale science.

Create clearly labeled synthetic variants for arbitrary names, masks, NoData, alternate encodings and deliberate reference/alignment faults. They test software, not independent drone observations. Obtain at least one genuine drone-derived DTM and export/survey metadata, ideally a matching DSM and independent check observations, before a user-facing drone qualification claim. Do not assume vendor, resolution or accuracy until that sample exists.

LiDAR processing may use local elevation systems and control points; retain conversion provenance. [DJI accuracy/control documentation](https://repair.dji.com/help/content?customId=01700005125&lang=en&paperDocType=ARTICLE&re=US&spaceId=17). USGS also records the geoid used in ellipsoidal-to-orthometric conversion; this supports tracking references, not imposing US datums on French inputs. [USGS processing requirements](https://www.usgs.gov/ngp-standards-and-specifications/lidar-base-specification-data-processing-and-handling-requirements).

For the first georeferenced POC, admit verified projected coordinates and declared elevation units/reference. An arbitrary local survey frame is a separate capability: a map pin cannot establish scale, rotation and datum alignment. Do not add an unplanned manual alignment editor.

## 5. Observable acceptance

| Area | Required demonstration |
| --- | --- |
| Import | Original extensionless files and generic-named fixtures use one admission path |
| Automatic analysis | Accept a batch once; enabled supported analyses enqueue once, show progress and cancel |
| Persistence | Managed sources survive moving the download folder; restart/new Design reuse existing data/results |
| Correctness | Known height comparison, analytic slopes and routing fixtures, and reference checks pass |
| Coverage | Cross-tile and irregular masks produce no invented terrain; boundary-dependent results remain qualified |
| Replacement | Approved changes regenerate affected neighborhoods/downstream domains; rejected overlap stays; uncovered additions are independent |
| Canvas | Zoom changes reads/rendering, not answers; camera is preserved; grid/plants/zones remain above analysis |
| Resources | Responsive panning during processing; bounded RAM/temp disk/threads; cancellation and interrupted-publication recovery |
| Interpretation | Correct units/legends; no unsupported moisture, vegetation classification or storm-flow claims |

Record import/analysis times by domain and resolution, peak memory, temporary/final disk, cached first-view latency and camera responsiveness. One-tile timings or a CLI run alone are insufficient. A map that looks plausible is not numerical validation.

A successful IGN POC supports proceeding to drone validation; it does not establish agronomic accuracy. Wet-weather observations and other field evidence remain necessary for assessing real pathways and wetness tendencies.

No implementation or surrounding-data download was performed in this recommendation update. Native packaging, actual neighboring availability and scientific performance remain unverified until the experiment is run.
