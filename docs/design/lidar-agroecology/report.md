# LiDAR-derived information for agroecological design

2026-09-14 · Study `canopi-bdxh` · **Proposals for review, not accepted implementation scope.**

This extends the [LiDAR library study](../lidar-library.md). The library remains a prototype; production import, persistence and analysis are not implemented. This report inspects the supplied files and evaluates methods. It does not claim to have calculated or validated flow, wetness, shade or vegetation classification on the site.

**Product focus clarified:** the primary user imports their own drone-derived TIFFs and runs analysis locally. Follow the [revised delivery recommendation](delivery-strategy.md) and [IGN-backed POC](ign-poc.md) for sequencing; the scientific distinctions below still apply. IGN is initial test data and optional context, not a hosted-baseline prerequisite.

## 1. Recommendation

Build a **site analysis capability** on the numeric raster library, beginning with terrain and existing height structure, then potential water pathways. Add soil information as optional context. Introduce actual soil-water or rainfall-event simulation only after suitable inputs and field validation exist.

The useful product question is “What does this evidence help me decide or investigate?” A large catalogue of GIS indices, or a single unexplained suitability score, would be a weaker outcome.

Separate three meanings throughout the interface and stored results:

| Meaning | Example | Appropriate claim |
| --- | --- | --- |
| Source-derived geometry | Slope; height above ground | Geometry represented by a dated survey, with measurement/interpolation limitations |
| Environmental indicator | Flow convergence; topographic wetness index | A tendency under stated assumptions |
| Scenario or calibrated estimate | Moisture through a season; runoff during a storm | A model requiring additional inputs and validation |

## 2. What the new MNH actually contains

Inspected all three extensionless GeoTIFFs and their JSON sidecars in Downloads. Full hashes, metadata, masks and comparison are in [input-evidence.json](input-evidence.json); [inspect-inputs.py](inspect-inputs.py) reproduces the inspection.

| Property | Measured result |
| --- | --- |
| Shared footprint | 1,000 × 1,000 m, 100 ha; identical grids and WKT |
| Each raster | 2,000 × 2,000; one Float32 band; 0.5 m spacing; 4,000,000 valid cells |
| Storage | 16,000,513 bytes each; strip layout; no overviews |
| MNT range | 141.50–181.05 m; approximately 39.54 m relief |
| MNS range | 141.50–199.86 m |
| MNH range | −0.329–34.695 m |
| MNH versus MNS − MNT | **Exact numerical equality at all 4,000,000 cells**, comparing Float64-promoted values |
| MNH above 2 m | 13.598 ha, 13.598% of the tile; this is elevated-surface area, not established tree cover |
| MNH above 10 m | 6.970 ha; again, no object classification |
| Negative MNH | 4,141 cells; preserve original values, do not silently clamp scientific inputs |
| Sidecar provenance | Acquisition 2025-02-15; edition 2025-07-23; mission `24LHDGF2`; LAMB93 / IGN69 |

**Interpretation:** MNH already gives height above ground. Importing it is valuable when the matching MNT/MNS are absent, but this particular file adds no independent numerical information to the matching pair. Equality is established for this sample, not assumed for arbitrary future inputs. IGN defines MNH as MNS minus MNT and builds MNS from selected surface points including vegetation and buildings. [IGN product specification, §§3–3.2.3](https://data.geopf.fr/annexes/ressources/documentation/DC_LiDAR_HD_1-0.pdf).

The February date matters when interpreting vegetation and seasonal shade. Do not infer a summer canopy envelope, leaf density, species, health, age or biomass from this single height grid. Heights include interpolation; 0.5 m spacing is not 0.5 m accuracy. The export also shares the imperfect CRS WKT already documented in the library study: matching strings prove alignment of this trio, not independent CRS correctness. Admission still needs the validated Lambert-93 interpretation.

## 3. Useful outputs, ranked by practical value

These priorities are recommendations, not a commitment to implement every row.

| Priority | Output and design use | Inputs | Main weakness |
| --- | --- | --- | --- |
| First | **Slope, aspect and terrain profiles:** compare planting/access areas and understand relief | MNT | Fine-scale noise; aspect undefined on flat ground; slope alone does not establish machinery safety |
| First | **Height structure:** locate tall features, low gaps and existing vertical structure worth retaining | MNH, or compatible MNS + MNT | Buildings are included; classification needs more evidence |
| Next | **Potential flow paths and contributing area:** identify likely incoming water and concentration corridors | MNT covering upstream terrain | Roads, culverts, real depressions, drainage and missing upstream land can change routing |
| Next | **Depression and spill-point candidates:** identify places to inspect for ponding or restoration | MNT and explicit terrain conditioning | Geometric storage is not actual retained water or infiltration capacity |
| After validation | **Topographic wetness potential:** compare convergence-prone and divergent positions | Conditioned MNT + chosen routing/scale | Static terrain proxy, not moisture percentage or groundwater depth |
| Later | **Seasonal sun/shade potential:** assess light around existing structures and proposed planting | Ground receiving surface, MNS obstruction heights, location/date | Canopy permeability/seasonality and clouds require assumptions |
| Later | **Hedge continuity / vegetation structure candidates:** focus retention and field verification | MNH + orthophoto, land-cover or classified points | Height alone cannot distinguish a hedge from a wall or provide an accurate tree inventory |
| Later | **Erosion susceptibility:** identify concentrated-flow and steep exposed areas | Terrain + cover, soil and rainfall evidence | A terrain index alone is not annual soil loss |

Terrain and obstruction horizons can support solar models; GRASS exposes solar radiation and shadow calculations. My proposed feature should initially describe geometric sunlight potential, with receiver height and obstruction geometry separated: running a surface radiation model on treetops does not give light at the ground below them. [GRASS r.sun](https://grass.osgeo.org/grass-stable/manuals/r.sun.html).

I would defer automatic swale/pond placement, definitive drainage recommendations, precise flood depths, automatic species selection from a “wetness” score, biomass/carbon estimates and full wind simulation. Their missing inputs would dominate their apparent precision.

## 4. Water analysis: the important design decisions

### Analyse the catchment, then crop the result

A Design boundary, TIFF boundary and viewport are different from a hydrological boundary. Resolve accepted terrain across the relevant upstream area before computing routes. Expanding by a fixed margin helps local derivatives but cannot guarantee a complete catchment. GRASS explicitly identifies potentially underestimated accumulation and recommends expanding the domain to include the relevant catchment. Its NoData holes can also disrupt routing. [GRASS r.watershed](https://grass.osgeo.org/grass-stable/manuals/r.watershed.html).

Proposed behavior: automatically use available accepted MNT upstream of the study area; record the actual analysis domain. Where completeness cannot be established, carry an affected-area quality mask and qualify or withhold dependent summaries. Do not fill missing coverage with zero, invent elevations across large gaps, or assume the tile edge drains freely. Coarser external terrain may supply context later, but must be an explicit, recorded input with seam validation.

### Keep terrain conditioning separate from source data

Maintain immutable measured terrain and a derived analysis surface. Record filled/breached cells and any surveyed culvert, ditch or barrier corrections. Do not flatten every depression: some are ecologically useful storage areas. Equally, retaining every tiny pit can trap all modeled flow in noise. Real sinks, processing artifacts and unknown areas need distinct treatment.

For dispersed hillslope flow, evaluate multiple-flow-direction routing first; compare single-flow-direction routing for discrete path/outlet use cases. GRASS supports both and optional known depressions. Its least-cost method does not require blanket sink filling. [GRASS routing options](https://grass.osgeo.org/grass-stable/manuals/r.watershed.html).

Report contributing area in m²/ha, with algorithm semantics recorded. Cell counts are resolution dependent; they are not litres per second. Rainfall intensity, infiltration, antecedent moisture, roughness and drainage become necessary for event runoff. Subsurface drainage and preferential flow cannot be recovered from the MNT alone.

### Choose scientific scale independently of zoom

Preserve native values, but evaluate several analysis resolutions. A sensible **experiment**, not a selected default, is 0.5/1/2/5 m for terrain and routing, with broader scales such as 10/20 m for wetness indicators. Validate aggregation methods against ditch preservation and noise. Zoom changes presentation detail only.

TWI is commonly expressed as `ln(a / tan(β))`, with specific upslope contributing area `a` and local slope `β`. It needs documented handling of flats and flow distribution. [GRASS r.topidx](https://grass.osgeo.org/grass-stable/manuals/r.topidx.html).

Finer pixels are not automatically more useful. A field study in a boreal catchment found its TWI performed best at 16 m and poorly at resolutions finer than 4 m. That does **not** prescribe 16 m for French farmland; it demonstrates why local resolution validation matters. The study also found depth-to-water and elevation-above-stream indices more stable across resolutions. Evaluate those alternatives before selecting TWI as the default; their names must not imply measured groundwater depth or flood depth. [Larson et al., 2022](https://hess.copernicus.org/articles/26/4837/2022/).

Call the feature **Topographic wetness potential**, not “Soil moisture.” Avoid universal wet/dry thresholds. If using relative classes, disclose their reference area and keep it fixed when panning. Do not produce percentage confidence without a calibrated uncertainty model.

## 5. SoilGrids: useful context, optional dependency

SoilGrids supplies modeled soil properties at approximately 250 m, including texture, organic carbon, bulk density and pH. At that resolution, one nominal cell occupies 6.25 ha and corresponds in area to **250,000** of the 0.5 m LiDAR pixels. Resampling it cannot create parcel-scale soil observations. [ISRIC SoilGrids overview](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs.html).

Its depth intervals extend from 0–5 cm through 100–200 cm. Water-retention layers describe water content at specified suction pressures; they do not measure current field moisture. Keep depth, units/scaling and prediction quantiles attached to the data. These can inform an approximate available-water-capacity calculation only with explicit field-capacity/wilting-point conventions, effective soil/rooting depth and compatible volumetric definitions. Do not treat differences between marginal quantiles as calibrated uncertainty for the derived difference. [ISRIC layer definitions](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_01.html).

Recommended order of evidence: relevant field observations and local surveys first, then regional soil sources assessed for scale, then SoilGrids as a fallback. Regional is not automatically parcel-accurate: France's RRP soil maps are at 1:250,000. [GIS Sol RRP description](https://gissol.hub.inrae.fr/programmes/igcs/donnees-igcs/carte-sols-dominants-cartes.gouv.fr).

As checked for this report, ISRIC's documentation says the REST API is temporarily paused without a restoration date. Prefer a provider adapter that can obtain bounded numeric subsets through documented alternative access, cache them locally with provenance, and work offline afterward. Verify endpoint availability during implementation; do not make core LiDAR analysis depend on that API. [ISRIC access and service status](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_02.html).

**Decision:** no SoilGrids requirement for slope, heights, geometric routing or TWI. Add a separate Soil context capability later. A time-varying soil-water model would additionally require meteorology, vegetation/rooting, drainage and calibration; combining TWI with clay percentage is not sufficient.

## 6. UX proposals

Extend the accepted Layers inspector with an **Analysis** drill-in, keeping Library focused on source management. Start with task names: Terrain, Height above ground, Water pathways; add Wetness potential and Sun/shade when validated. Put algorithms and detailed parameters behind Method details.

The study area can come from existing Design geometry or an explicit analysis extent. It remains fixed while the camera moves. It can have arbitrary outlines, holes and disconnected parts; upstream processing may extend beyond it. No Fit control, automatic recentering or per-file coverage chooser is needed.

Each result should give a short interpretation, units, source acquisition period, analysis scale and usable-coverage information. For example: “Potential flow concentration · terrain-based · 2 m analysis · upstream coverage incomplete.” This is descriptive result metadata, not a global app warning. Use readable legends and a distinct unknown-data treatment; transparent unknown cells must not look like confidently dry ground.

Retain **basemap → LiDAR and derived analysis backgrounds → grid + all Design objects and interaction overlays**. Flow lines and contours belonging to an analysis remain in that background band. Start with one active scalar background; consider one optional line overlay later, avoiding several opaque competing heatmaps. Preserve camera, opacity and per-result style settings.

The accepted silent failure behavior remains for passive LiDAR loading. **New recommendation requiring review:** an explicitly requested analysis should return a local failure/incomplete result when required inputs are unusable. It must not silently present success, zero flow or an old result as current. This does not reintroduce the rejected reopening, relinking or library-change notices. No previously rejected point-inspection feature is implied.

## 7. Architecture: extend the library without turning rendering into modeling

Keep the accepted dedicated SQLite catalogue, immutable numeric rasters, exact acceptance masks and bounded display cache. Add a cohesive analysis service; do not place algorithms in UI components, the renderer or SQL pixel rows.

| Boundary | Responsibility |
| --- | --- |
| Library resolver | Accepted coverage, original meaning/units, masks and immutable generation snapshot |
| Analysis service | Capability checks, domain/grid selection, input consistency, recipe identity, jobs, dependencies and result publication |
| Engine adapter | Versioned scientific operations and bounded raster/vector input/output; no Design state |
| Presentation adapter | Result tiles/lines, legends and quality metadata through the existing map-surface lifecycle |

**Immutable analysis result identity:** recipe/version + engine version + source interpretation/generation hashes + accepted masks + output and processing domains + CRS/grid/resampling + parameters + correction/scenario inputs. Record acquisition dates separately from processing time. Custom type names alone never grant analysis capabilities; require measurement semantics and units. Treat imported MNH as above-ground height, distinct from vegetation-only canopy height and arbitrary intensity.

**Cross-type consistency is a new requirement.** Replacing MNT alone must not silently recompute an apparently same-survey MNH against old MNS. Resolve compatible survey families and masks for paired products; otherwise exclude incompatible areas or offer an explicitly named cross-date comparison in a later feature. Existing imported MNH remains a dated source, not something overwritten by an implicit formula. Matching dates alone are insufficient without reference/grid/processing compatibility. A declared custom above-ground-height type should work without an IGN filename.

**Automatic coverage remains automatic.** Raw products follow accepted library heads as already agreed. Demand-driven local derivatives can follow them too. Expensive analyses use an internal immutable snapshot and automatically schedule affected active results after publication, with debouncing and resource limits. Atomically switch to a complete replacement; never mix generations in one analysis. Retain old output only as explicitly dated/stale within the analysis surface. No user coverage-refresh step or per-Design survey pin is introduced.

**Invalidation is algorithm dependent.** Height subtraction is local; slope needs a neighborhood halo; upstream changes can alter routing throughout a downstream basin; obstruction changes affect a directional shadow footprint. Start by recomputing the affected analysis domain for hydrology. Independently solving each display tile and stitching routes is invalid. A scalable distributed routing algorithm would need its own cross-boundary correctness proof.

**Persistence:** catalogue analysis jobs/manifests/dependencies in the LiDAR subsystem, with numeric result rasters and typed vector artifacts in managed storage. Reuse standard tiled outputs for display. Ordinary derived artifacts can be quota-managed and recreated; named reports/scenarios must retain a reproducible manifest and a clear retention/export policy. `.canopi` stores the analysis selection/recipe through Design Edit, not raw pixels or absolute paths. This is a proposed document-contract extension, not present in the base plan.

**Execution:** all heavy operations go through the Native Operation Executor and a bounded analysis scheduler. Current Local capacity is only two running operations; long catchment jobs could starve interactive reads if admitted indiscriminately. Reserve interactive capacity, limit engine threads/memory/temp disk, own cancellation and clean up child processes. Crash recovery must distinguish resumable publication from a computation that must restart. Never hold the SQLite lock while computing.

Use GDAL for raster I/O/preparation and evaluate a pinned GRASS engine for hydrology/solar operations against a narrowly scoped native alternative. GRASS is a credible scientific reference, not yet a packaged dependency decision. Validate distribution/license obligations, startup cost and supported-OS delivery before selection. Avoid implementing a general GIS engine or maintaining several production engines; retain a narrow adapter and independent numerical reference tests.

## 8. Weaknesses and evidence needed before trusting results

| Weakness | Required response |
| --- | --- |
| Only one complete rectangular sample tile | Add adjacent and irregular coverage fixtures, holes, islands and missing upstream terrain; no scalability/completeness claim from this trio |
| Terrain contains interpolation and survey joins | Inspect seams and conditioned cells; preserve source-quality metadata; reject false dams caused by mismatched references |
| No observed drainage or soil moisture supplied | Validate predicted routes/wetness with site visits, wet-weather observations and measurements before agronomic conclusions |
| Fine resolution can amplify noise | Compare resolutions/conditioning against field evidence; publish method and sensitivity rather than a universal default |
| MNH mixes object classes | Require vegetation evidence before reporting canopy cover or hedge metrics; never create plant objects automatically |
| Acquisition is dated and seasonal | State dates; do not claim current vegetation or change from incompatible acquisitions |
| Soil data are coarse and modeled | Preserve scale/depth/uncertainty; no smooth high-resolution soil certainty created by display interpolation |
| Hydrology is expensive and nonlocal | Benchmark domain size, memory and cancellation; do not reuse the viewport tile algorithm as a hydrology solver |
| Shared imports can change old conclusions | Reproducible result manifests and atomic refresh; visible result provenance without passive app-wide notices |

Validation should include known synthetic slopes, converging/diverging terrain, flats, real sinks, culverts, NoData and cross-tile catchments; compare with a pinned reference engine. Check contributing-area accounting, resolution invariance of units, conditioned-cell records and downstream invalidation after an upstream replacement. Benchmark 1, 25 and 100 km² domains: at 0.5 m these contain 4 million, 100 million and 400 million cells, respectively; one Float32 grid alone uses 16 MB, 400 MB and 1.6 GB before masks and working arrays.

For moisture-related claims, use spatially independent field validation and observations spanning wet/dry conditions. For this report, only file integrity/metadata and numerical height comparison were verified; no timing or accuracy claim is made for an analysis engine.

## 9. Decisions proposed for review

| ID | Recommendation | Position |
| --- | --- | --- |
| A1 | Terrain + height structure first; water pathways next; wetness only after method validation | Keep |
| A2 | Distinguish terrain wetness potential from measured/time-varying soil moisture | Essential |
| A3 | Automatically analyse available upstream coverage, with fixed domain and affected-area quality | Essential |
| A4 | SoilGrids as optional cached soil context, never a core prerequisite | Keep |
| A5 | Internal reproducible analysis snapshots; automatic atomic refresh after accepted imports | Keep |
| A6 | Capability-based custom types and cross-product survey compatibility checks | Essential |
| A7 | Clear local outcomes for explicit analysis requests, while passive LiDAR failures stay silent | Review this UX extension |
| A8 | Field observations linked to analysis: culverts, wet spots, soil tests, dated photos | High-value next capability; define lifecycle separately |
| A9 | Seasonal shade and verified hedge continuity after terrain/water foundations | Keep for later |
| A10 | Scenario comparisons of proposed interventions, isolated from measured terrain | Long-term direction; requires explicit intervention geometry and validated models |
| A11 | Automatic ponds/swales, precise flood/soil-moisture predictions or a single suitability score from LiDAR alone | Defer/reject at current evidence level |

My strongest additional idea is **using analysis to guide observation**: highlight where checking a culvert, soil depth or wet-season condition would most change a design decision. This supplies missing evidence and makes later modeling more useful than adding more unvalidated indices. Scenario comparison can follow, but planting a canopy symbol must never implicitly modify ground elevation or water routing.

Study reproduction: `/usr/bin/python3 docs/design/lidar-agroecology/inspect-inputs.py /home/daylon/Downloads`. Requires GDAL/NumPy available on the study machine. No application dependency was added. Production tests were skipped because no production code changed; the inspection script was executed against all three originals. No agent operating-doc update is needed: all architecture here remains proposed.
