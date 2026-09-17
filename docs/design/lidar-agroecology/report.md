# Scientific evidence for LiDAR agroecological analysis

Status: evidence.
Tracking: `canopi-bdxh`.
Current guidance: [LiDAR implementation guide](../../agent/lidar.md).

Updated 2026-09-15 · Study `canopi-bdxh` · **Supporting evidence, not implementation authority.**

The authoritative product and coding specification is the [LiDAR implementation plan](../lidar-library.md). This report records measured properties of the supplied files, defensible interpretations and scientific limits. It does not claim that flow, wetness, shade or vegetation classification has been calculated or field-validated on the site.

## Supplied MNT, MNS and MNH

The three extensionless GeoTIFFs and JSON sidecars in Downloads were inspected. Full hashes, metadata and comparisons are in [input-evidence.json](input-evidence.json); [inspect-inputs.py](inspect-inputs.py) reproduces the inspection.

| Property | Measured result |
| --- | --- |
| Shared footprint | 1,000 × 1,000 m, 100 ha; identical grids and WKT |
| Each raster | 2,000 × 2,000; one Float32 band; 0.5 m spacing; 4,000,000 valid cells |
| Storage | 16,000,513 bytes each; strip layout; no overviews |
| MNT range | 141.50–181.05 m |
| MNS range | 141.50–199.86 m |
| MNH range | −0.329–34.695 m |
| MNH versus MNS − MNT | Exact equality at all 4,000,000 cells |
| MNH above 2 m | 13.598 ha; elevated surface, not established vegetation cover |
| MNH above 10 m | 6.970 ha; no object classification implied |
| Negative MNH | 4,141 cells; original values must remain signed |
| Provenance | Acquisition 2025-02-15; edition 2025-07-23; mission `24LHDGF2`; LAMB93 / IGN69 |

The MNH contains no independent numerical information for this matching trio. It remains useful when matching MNT/MNS are unavailable, and equality must not be assumed for unrelated imports. IGN defines MNH as MNS minus MNT and constructs MNS from selected surface points including vegetation and buildings. [IGN product specification](https://data.geopf.fr/annexes/ressources/documentation/DC_LiDAR_HD_1-0.pdf).

The February date matters for seasonal vegetation interpretation. The data do not establish summer canopy envelope, species, health, age or biomass. Height includes buildings and interpolation. A 0.5 m pixel spacing is not a 0.5 m accuracy statement.

The embedded WKT is named EPSG:2154 but lacks a reliable root authority and contains an incomplete datum description. Agreement among these three files establishes their mutual grid alignment, not independent CRS correctness. Import must retain the original WKT and record the validated Lambert-93/IGN69 interpretation from the sidecar and parameters.

## Defensible analysis meanings

Keep three kinds of claim distinct:

| Meaning | Example | Defensible claim |
| --- | --- | --- |
| Source-derived geometry | Slope, aspect, above-ground height | Geometry represented by a dated survey, subject to measurement/interpolation limits |
| Environmental indicator | Flow convergence, topographic wetness | Relative terrain tendency under recorded assumptions |
| Scenario/calibrated estimate | Seasonal soil water or storm runoff | Model requiring additional inputs and validation |

Useful outputs, in recommended order:

| Priority | Output | Input | Principal limitation |
| --- | --- | --- | --- |
| First | Slope, aspect and terrain profiles | Ground elevation | Fine-scale noise; slope is not machinery certification |
| First | Height structure | Above-ground height or compatible MNS/MNT | Buildings included; no vegetation identity |
| Next | Potential flow paths and contributing area | Ground elevation with upstream context | Roads, culverts, drains and missing terrain alter routing |
| Next | Depression and spill-point candidates | Ground elevation plus recorded conditioning | Geometric storage is not actual retained water |
| Experimental | Topographic wetness potential | Conditioned terrain and routing | Static proxy, not soil moisture or groundwater depth |
| Later | Seasonal sun/shade potential | Ground receiver, surface obstructions, date/location | Canopy permeability, phenology and clouds require assumptions |
| Later | Hedge/vegetation structure candidates | Height plus other classification evidence | Height alone cannot distinguish vegetation from walls/buildings |
| Later | Erosion susceptibility | Terrain, cover, soil and rainfall | Terrain alone cannot estimate annual soil loss |

Defer automatic swale/pond placement, definitive drainage recommendations, flood depths, automatic species selection from wetness, biomass/carbon estimates and full wind simulation until their required evidence and validation exist.

## Water analysis limits

A Design, TIFF, valid-data footprint and viewport are not hydrological boundaries. Resolve the accepted ground layer across the relevant upstream domain, then crop/present the result. A fixed margin helps local derivatives but cannot guarantee a complete catchment. GRASS identifies likely underestimated accumulation and recommends expanding the computation domain to include the relevant catchment. Internal NoData holes can also distort routing. [GRASS r.watershed](https://grass.osgeo.org/grass-stable/manuals/r.watershed.html).

The analysis must carry a quality mask when upstream coverage is missing. Unknown terrain must not become zero elevation, free drainage or confidently dry land. A complete IGN square does not prove the catchment is complete; a partial drone flight can have irregular gaps even inside its outer bounds.

Keep measured terrain immutable and record conditioning in the result recipe. Blanket sink filling can destroy real ecological storage, while retaining every tiny artifact can trap modeled flow. Known culverts, ditches, barriers and true depressions need explicit evidence.

Contributing area should be presented in physical area units, not resolution-dependent cell counts. It is not discharge. Rainfall, infiltration, antecedent moisture, surface roughness and drainage are needed for event runoff. Subsurface drains and preferential flow cannot be inferred from the MNT alone.

Scientific resolution is independent of canvas zoom. Compare multiple resolutions before choosing defaults. Finer pixels are not automatically better: a field study found TWI performance strongly dependent on resolution and routing choices, with none of its tested indices performing best at 0.5 m. This does not prescribe its boreal-catchment defaults for French farmland; it establishes the need for local validation. [Larson et al., 2022](https://hess.copernicus.org/articles/26/4837/2022/).

Topographic wetness index is commonly `ln(a / tan(β))`, combining specific upslope area and local slope. Flats, routing method and reference domain need explicit handling. The product label should be **Topographic wetness potential**, not “Soil moisture.” [GRASS r.topidx](https://grass.osgeo.org/grass-stable/manuals/r.topidx.html).

## SoilGrids and other evidence

SoilGrids provides modeled properties around 250 m resolution, including texture, organic carbon, bulk density, pH and water-retention estimates. One nominal 250 m cell covers 6.25 ha, equivalent in area to 250,000 of the supplied 0.5 m cells. Resampling it cannot create parcel-scale soil observations. [SoilGrids overview](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs.html).

Water-retention layers describe modeled water content at specified suction pressures, not current soil moisture. Preserve depth interval, units and prediction quantiles. SoilGrids is optional context and not required for slope, height, routing, contributing area or topographic wetness. Its documented REST API was paused when this evidence was collected, so no production dependency should assume that endpoint is continuously available. [Layer definitions](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_01.html), [access status](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_02.html).

Prefer relevant field observations and local soil surveys, then regional sources assessed for scale, with SoilGrids as fallback context. Wet-season observations, culverts, drains, soil depth and infiltration checks can improve decisions more than additional unvalidated indices.

## Validation requirements

The supplied trio is one complete rectangular sample and cannot validate partial drone coverage or general performance. Scientific qualification needs:

- Analytic slopes, flats, converging/diverging terrain, true sinks, NoData holes and cross-tile catchments.
- Irregular masks, holes, disconnected islands, rotated grids and mismatched references.
- Comparisons across analysis resolutions and against a pinned independent engine.
- A genuine drone-derived ground raster with survey/export metadata and independent check observations.
- Field observations spanning relevant wet/dry conditions before interpreting wetness or flow indicators agronomically.

A 1 km² Float32 raster contains 4 million cells at 0.5 m but 400 million cells at 5 cm. The latter is 1.6 GB for one numeric grid before masks and working arrays. Drone support therefore requires bounded processing and measured memory/time, not simple extrapolation from the IGN sample.

Study reproduction: `/usr/bin/python3 docs/design/lidar-agroecology/inspect-inputs.py /home/daylon/Downloads`. Requires GDAL and NumPy. No production application dependency is implied.
