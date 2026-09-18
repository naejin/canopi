#!/usr/bin/env python3
"""Build independently configured CRS reference points for the qualification probe.

The reference is computed from an explicitly configured EPSG code, never from the
fixture's own (incomplete) WKT. That is the whole point: the candidate is compared
against a reference that does not inherit the fixture's ambiguity.

Emits the JSON the browser CRS probe consumes:

* ``projDef`` — a proj4 definition of the same CRS, so the candidate's own
  projection engine can be compared with the reference for identical input;
* ``projectionChecks`` — WGS84 coordinates with the reference's projected result;
* ``pixelRequests`` — the WGS84 coordinate of each requested pixel centre, with
  the reference's projected coordinate.

Usage::

    python3 scripts/raster-qualification/build_crs_reference.py \
        --reference <geotiff> --reference-epsg 2154 --out <json>
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from osgeo import gdal, osr

gdal.UseExceptions()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--reference-epsg", type=int, default=2154)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    dataset = gdal.Open(str(args.reference))
    if dataset is None:
        raise SystemExit(f"ERROR: cannot open {args.reference}")
    gt = dataset.GetGeoTransform()
    width, height = dataset.RasterXSize, dataset.RasterYSize

    srs = osr.SpatialReference()
    srs.ImportFromEPSG(args.reference_epsg)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    forward = osr.CoordinateTransformation(srs, srs.CloneGeogCS())

    # A spread of pixel centres, including all four corners and both mid-edges.
    pixels = [
        (0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1),
        (width // 2, height // 2), (width // 4, height // 4),
        (3 * width // 4, 3 * height // 4), (width // 3, 2 * height // 3),
    ]

    pixel_requests = []
    projection_checks = []
    for (column, row) in pixels:
        east = gt[0] + (column + 0.5) * gt[1] + (row + 0.5) * gt[2]
        north = gt[3] + (column + 0.5) * gt[4] + (row + 0.5) * gt[5]
        lon, lat, _ = forward.TransformPoint(east, north)
        label = f"px({column},{row})"
        pixel_requests.append({"x": column, "y": row, "lon": lon, "lat": lat,
                               "referenceProjected": [east, north], "label": label})
        projection_checks.append({"label": label, "lon": lon, "lat": lat,
                                  "reference": [east, north]})

    payload = {
        "reference": args.reference.name,
        "referenceEpsg": args.reference_epsg,
        "referenceEpsgSource": "explicitly configured, not read from the fixture WKT",
        "geoTransform": list(gt),
        "size": [width, height],
        "projDef": srs.ExportToProj4().strip(),
        "pixelRequests": pixel_requests,
        "projectionChecks": projection_checks,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"out": str(args.out), "points": len(pixel_requests),
                      "referenceEpsg": args.reference_epsg,
                      "projDef": payload["projDef"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
