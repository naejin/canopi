# LiDAR library foundation record

Status: partial; remaining delivery is respecified by the raster rework.
Tracking: `canopi-j571` (rework), `canopi-4kar` (delivered library), `canopi-cldf` (foundation repair).
Current guidance: [LiDAR implementation guide](../agent/lidar.md).

The original foundation implemented local numeric raster storage, import review, persisted slope and independent map presentation. The [raster, Data and Analysis rework](raster-data-analysis-rework.md) supersedes its future delivery plan: simplified import replaces preview/region choices; Data and Analysis become separate workbenches; pixel inspection is included. Current code still uses the review workflow until that replacement lands. Read bd for executable scope; this record does not authorize implementation.

## Retained architecture and invariants

- The dedicated `lidar-library.sqlite` catalogue owns library identities, interpretation, generation heads, jobs, dependencies and recovery. Managed files own immutable originals, exact masks and numeric results. Display caches are reproducible. Neither the plant database nor `.canopi` stores raster pixels.
- Source assets retain hashes, original names and interpretation provenance. Import copies accepted originals so moving Downloads cannot break the library. Byte deduplication must not conflate different interpretations.
- Each named source layer has a stable ID and one immutable measurement definition. Rename does not invalidate results. Separate layers with the same measurement kind remain independent.
- Effective coverage is the union of accepted valid pixels, not source rectangles. Valid zero and negative samples remain data; NoData and non-finite samples cannot erase valid coverage. Spatial envelopes select candidates but do not replace exact masks.
- A short catalogue transaction advances an immutable generation head. Import undo publishes a new generation; authoritative originals and history are not automatically purged.
- An analysis definition identifies input, recipe, parameters and output meaning. Each result records immutable inputs, engine/recipe versions, grid, conditioning and quality masks. Refresh computes outside catalogue locks and publishes only if expected source/definition heads still match.
- Library changes do not dirty a Design. Ordered source/result references and presentation belong to the document layer and mutate through Design Edit. Web preserves unavailable entries; missing sources do not destroy references.
- Source and result visibility are independent. Hiding an input does not invalidate or stop its analysis. Shared workspace navigation changes neither raster geography nor scientific results.
- Numeric resolver, analysis lifecycle and presentation remain separate responsibilities. Display resampling/colour must never become analysis input. Jobs own cancellation and bounded resources; map rendering uses the existing workspace lifecycle.

## Qualified foundation and limits

The delivered foundation admits north-up, aligned, single-band numeric GeoTIFFs with identity scale/offset, declared NoData, compatible metre units and no dataset mask. Input detection supports extensionless TIFFs. Broader masks, rotation and resampling require qualification before admission; the original plan's broader catalogue was not implemented.

The current dense-grid path has source, batch and cell-count caps; the [rework evidence](raster-data-analysis-rework.md#evidence-and-existing-work) records the failing batch and replacement requirements. Increasing constants or splitting filenames alone cannot establish bounded memory for a single large raster.

The [foundation review](lidar-foundation-review.md) records Linux/GDAL qualification: real IGN import, exact validity, shared-scale review previews, atomic publication, decoded display pixels, an independently known slope, restart reuse, replacement, targeted undo, deletion and Design presentation round-trip. It does not establish packaged Windows/macOS support, genuine drone-scale performance or future analyses.

## Scientific evidence and deferred analyses

The [input evidence](lidar-agroecology/input-evidence.json) and [inspection script](lidar-agroecology/inspect-inputs.py) describe the supplied 2000×2000 Float32 MNT/MNS/MNH grids at 0.5 m spacing. MNH equals MNS−MNT at all four million cells for that trio and supplies no independent information.

Those inputs are strip-organized without overviews and carry imperfect embedded CRS WKT. Sidecars identify Lambert-93/IGN69 and acquisition/edition dates. Admission must record the interpretation rather than trusting a filename; pixel spacing is not positional or vertical accuracy.

The [scientific report](lidar-agroecology/report.md) retains future analysis meanings and validation requirements. MNT can support terrain slope; MNS is a surface, and MNH is above-ground height, not automatically canopy. Hydrology needs conditioning, complete upstream domains, nonlocal invalidation and independent reference results. Wetness potential is not measured moisture, contributing area is not discharge, and derived terrain does not establish field-validated drainage. SoilGrids is optional coarse context.

The initial rework retains slope only. Aspect, height, hydrology and canopy require separately accepted capability contracts; their historical inclusion here is not a release requirement.
