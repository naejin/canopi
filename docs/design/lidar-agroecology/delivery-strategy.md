# Delivery strategy: local analysis of user-owned drone rasters

Revised 2026-09-14 · Study `canopi-4eb0` · **Current recommendation; implementation remains proposed.**

The target user already has drone-captured LiDAR processed into TIFFs. They import those files and let Canopi analyse them. This supersedes the prepared-regional-results-first recommendation from study `canopi-a7iu`; its comparison and hosting estimates remain in Git history. The [scientific assessment](report.md) and [accepted library requirements](../lidar-library.md) remain relevant. The next experiment is specified in the [IGN-backed POC](ign-poc.md).

## 1. Revised recommendation

**Build a local raster-analysis workflow. Use IGN to prove it, then qualify it with real drone exports.**

The main journey is:

`import TIFFs → validate and accept coverage → automatically prepare enabled analyses → display results → reuse after restart or in another Design`

Custom data are the primary input, not an advanced exception. Import means managing files locally; it does not imply uploading them. No account, hosted atlas or cloud processing service is necessary.

IGN has two bounded roles: reproducible development/test inputs now, and optionally compatible surrounding terrain when a user's survey does not cover the upstream area needed for water analysis. It is neither a mandatory production dependency nor proof of accuracy for a drone survey.

## 2. What changes and what stays

| Prior direction | Revised direction |
| --- | --- |
| Prepared public results are the easiest default | Locally computed results from imported rasters are the default |
| Start with a regional publishing pipeline | Start with a real Desktop import-to-analysis-to-restart vertical slice |
| Custom calculation follows public delivery | Generic ingestion and local calculation are exercised from the first POC |
| Automatic official downloads are central | Obtain a bounded IGN fixture for development; an in-app context downloader can follow |
| Same engine for publisher and local processing | A headless, versioned local engine; batch use supports reference checks |
| Hosting, STAC distribution, PMTiles, national catalogue | Remove from the critical path; revisit only for demonstrated distribution needs |

Keep the dedicated local SQLite catalogue, immutable numeric assets, exact accepted-area masks, internal generations, bounded tiling/cache and cancellation. Keep automatic accepted coverage by type, overlap Before/After confirmation and independent uncovered additions. Keep all LiDAR/analysis below grid and Design objects, above basemap. No Fit, auto-recenter or rejected point-inspection workflow is added.

## 3. Treat inputs by meaning, not aircraft or filename

| Imported content | Appropriate initial capability |
| --- | --- |
| Ground elevation / DTM / MNT | Terrain and potential water routing |
| Surface elevation / DSM / MNS | Surface display; obstruction analysis later |
| Above-ground height / MNH | Height structure; not automatically vegetation classification |
| Compatible ground + surface pair | Derived height with validity and survey-compatibility checks |
| Intensity, RGB orthophoto or unknown band | Supported display only where applicable; no implicit ground/water analysis |

Drone LiDAR processing can include ground classification, DEM generation and selectable output references. Canopi consumes the resulting raster; it should not initially recreate point-cloud processing. [DJI LiDAR processing documentation](https://repair.dji.com/help/content?customId=01700004818&lang=en&paperDocType=ARTICLE&re=US&spaceId=17).

A TIFF extension does not establish elevation content. Drone photogrammetry tools also export TIFF orthophotos, DTMs and DSMs; that is an adjacent import case, not evidence that photogrammetry and LiDAR have equivalent ground accuracy. [OpenDroneMap outputs](https://docs.opendronemap.org/outputs/).

## 4. Local processing without making users operate GIS software

Detect capabilities during import and explain consequential missing information. Once a batch is accepted, enqueue the enabled analysis preset once for the active study area. Show progress/cancel and publish complete results atomically. A supported import should not require another manual coverage refresh or a separate command for every derivative.

Do not run every algorithm across the whole library. Restrict work to the fixed study area and its necessary dependencies, debounce batch updates, and reuse results by input/recipe identity. Panning and zooming affect rendering only. Restart or a new Design using the same inputs/recipe reuses persisted results.

For large or unsupported work, return an explicit analysis outcome instead of freezing the app. Passive background-loading failures retain the accepted silent behavior. Automatically queued analysis still needs an honest local incomplete/failed status; it must not masquerade as successful zero flow.

A small drone footprint is the main hydrological constraint. If upstream context is missing, calculate defensible local geometry and qualify affected routing results. Optional IGN context requires verified horizontal/vertical compatibility, provenance and seam checks. More recent or denser drone data do not automatically authorize replacement or prove superior accuracy. Do not silently shift elevations to make surveys join.

## 5. Architecture and delivery order

Use one provider-neutral raster admission path and one analysis service, with a narrow native engine adapter. Retain originals, scientific values, masks and result manifests. Store pixels in raster assets and metadata in SQLite; keep presentation separate from scientific computation.

The POC must prove native execution and responsive canvas behavior, not just an external script producing images. Its engine can also run headlessly for numerical comparisons. Begin with terrain, potential flow routing and height structure; evaluate wetness indicators before assigning agronomic classes. SoilGrids, seasonal shade and intervention simulation remain later work.

Use IGN-only inputs first to isolate computation and app integration. Follow with generic/irregular test fixtures and at least one real drone-derived ground raster before declaring support for the actual target workflow. Hosting and country-wide processing are outside this sequence.

## 6. Revised review decisions

| ID | Current recommendation |
| --- | --- |
| S1 | Import-to-local-analysis is the primary journey |
| S2 | No complete IGN mirror or national GitHub dataset |
| S3 | Local-first processing replaces hosted-regions-first delivery; IGN is POC data and optional context |
| S4 | One versioned scientific engine with headless verification and Desktop integration |
| S5 | Persist sources/results for reuse and offline analysis; portable export can follow |
| S6 | Preserve private inputs, explicit overlap acceptance and automatic shared coverage |
| S7 | Prove a bounded site/catchment POC before considering larger coverage |
| S8 | No cloud-compute service in current scope |
| S9 | Keep formats interoperable; defer a public package distribution platform |
| S10 | Record versions and atomically regenerate affected analyses after accepted input changes; broader method-update policy remains undecided |

The main risks are native engine packaging, memory/time at drone resolutions, georeferencing and scientific validation. Those are the risks the POC should expose. This update specifies the experiment; it neither builds it nor downloads neighbouring rasters.
