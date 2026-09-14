"""Reproduce the bounded, read-only inspection of the supplied IGN raster trio.

Run with system Python (GDAL and NumPy), passing the Downloads directory.
Writes JSON to stdout; does not alter or prepare the source rasters.
This study script deliberately loads the small sample grids in memory.
"""

import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from osgeo import gdal

gdal.UseExceptions()
root = Path(sys.argv[1])
arrays, masks, grids, sources = {}, {}, {}, {}
for kind in ("MNT", "MNS", "MNH"):
    stem = f"LHD_FXX_0446_6807_{kind}_O_0M50_LAMB93_IGN69"
    path = root / stem / stem
    ds = gdal.Open(str(path))
    band = ds.GetRasterBand(1)
    values = band.ReadAsArray().astype(np.float64)
    nodata = band.GetNoDataValue()
    mask = np.isfinite(values) & (band.GetMaskBand().ReadAsArray() != 0)
    if nodata is not None:
        mask &= values != nodata
    sidecar = json.loads(path.with_suffix(".json").read_text())
    metadata = sidecar["metadata"]
    if isinstance(metadata, str):
        metadata = json.loads(metadata)
    transform = ds.GetGeoTransform()
    arrays[kind], masks[kind] = values, mask
    grids[kind] = (values.shape, transform, ds.GetProjection())
    sources[kind] = {
        "filename": stem,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "bytes": path.stat().st_size,
        "size": [ds.RasterXSize, ds.RasterYSize],
        "bands": ds.RasterCount,
        "type": gdal.GetDataTypeName(band.DataType),
        "transform": transform,
        "wkt": ds.GetProjection(),
        "nodata": nodata,
        "valid_cells": int(mask.sum()),
        "block_size": band.GetBlockSize(),
        "overviews": band.GetOverviewCount(),
        "range_m": [float(values[mask].min()), float(values[mask].max())],
        "percentiles_m": dict(zip(
            ["2", "50", "90", "98"],
            np.percentile(values[mask], [2, 50, 90, 98]).tolist(),
        )),
        "metadata": metadata,
        "download_url": sidecar["url"],
    }

same_grid = all(grid == grids["MNT"] for grid in grids.values())
if not same_grid:
    raise ValueError("Grid/CRS mismatch: pixel-wise comparison is not admissible")
common = masks["MNT"] & masks["MNS"] & masks["MNH"]
height = arrays["MNH"][common]
difference = (arrays["MNS"] - arrays["MNT"])[common]
residual = height - difference
cell_area = abs(grids["MNT"][1][1] * grids["MNT"][1][5]
                - grids["MNT"][1][2] * grids["MNT"][1][4])
evidence = {
    "scope": "Supplied 0446-6807 trio only; numerical inspection, not field validation",
    "gdal_version": gdal.VersionInfo("RELEASE_NAME"),
    "numpy_version": np.__version__,
    "sources": sources,
    "same_grid_and_wkt": same_grid,
    "common_valid_cells": int(common.sum()),
    "common_area_ha": float(common.sum() * cell_area / 10000),
    "mnh_minus_mns_minus_mnt": {
        "max_absolute_error_m": float(np.abs(residual).max()),
        "mean_absolute_error_m": float(np.abs(residual).mean()),
        "nonzero_residual_cells": int(np.count_nonzero(residual)),
    },
    "negative_mnh_cells": int(np.sum(height < 0)),
    "height_thresholds": {
        str(threshold): {
            "fraction_above": float(np.mean(height > threshold)),
            "area_above_ha": float(np.sum(height > threshold) * cell_area / 10000),
        } for threshold in (0, 0.5, 1, 2, 5, 10, 20)
    },
}
print(json.dumps(evidence, indent=2, ensure_ascii=False, allow_nan=False))
