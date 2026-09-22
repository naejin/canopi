#!/usr/bin/env python3
"""Generate the representative 400-million-cell analytical plane for C1.

The completion contract (``docs/design/raster-rework/completion-design.md``)
requires a separate, disposable 20,000x20,000 Float32 GeoTIFF with
independently known slope, explicit NoData and holes that cross processing-block
boundaries, larger than 1 GiB and written uncompressed. It is *synthetic*: it is
never described as a real survey, and it is never produced by resampling a
user's data.

Geometry and expected values are fixed by the contract:

    z = 0.25 * x + 0.5 * y - 100      (local metres at pixel centres)

so the analytic ground truth is a constant plane whose Horn 3x3 derivative is
exactly (0.25, 0.5). The oracle tolerances are the contract's:

    slope_deg = atan(sqrt(0.25**2 + 0.5**2)) * 180 / pi
    slope_pct = 100 * sqrt(0.25**2 + 0.5**2)

The plane is written as bounded horizontal strips (never one whole-grid array)
and mosaicked through a VRT. Only the GDAL CLI and its Python bindings are used.

Usage:
    python3 scripts/generate_capacity_plane.py --out /path/to/capacity-plane.tif
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from osgeo import gdal

SIZE = 20_000
PIXEL = 0.5
ORIGIN_X = 700_000.0
ORIGIN_Y = 6_600_000.0
NODATA = -9999.0
STRIP_ROWS = 2_000
BLOCK_SIZE = 512
MIN_BYTES = 1024 * 1024 * 1024

# Half-open rectangles `(y0, y1, x0, x1)` in pixel coordinates declared NoData.
# No edge is aligned to a 512-cell processing block or to the 2,000-row strip
# boundary used to write the file: holes 0 and 2 straddle a strip boundary
# (y = 6,000 and y = 16,000) and holes 1 and 3 additionally straddle a block
# boundary (x = 512 and x = 1,536). That is what makes them block-crossing
# holes rather than tidy rectangles that a block-at-a-time reader could treat
# as wholly inside or wholly outside one block.
HOLES = (
    (5_100, 6_900, 590, 1_090),
    (9_500, 10_400, 480, 1_560),
    (15_300, 16_500, 17_890, 18_610),
    (2_170, 2_430, 1_505, 2_600),
)


def slope_degrees() -> float:
    return math.degrees(math.atan(math.sqrt(0.25**2 + 0.5**2)))


def slope_percent() -> float:
    return 100.0 * math.sqrt(0.25**2 + 0.5**2)


def expected_value(x_index: np.ndarray, y_index: np.ndarray) -> np.ndarray:
    """Physical z in metres at pixel centres ``(x_index, y_index)``."""
    x = ORIGIN_X + (x_index + 0.5) * PIXEL
    y = ORIGIN_Y - (y_index + 0.5) * PIXEL
    return 0.25 * x + 0.5 * y - 100.0


def hole_mask(x_index: np.ndarray, y_index: np.ndarray) -> np.ndarray:
    mask = np.zeros((y_index.size, x_index.size), dtype=bool)
    for y0, y1, x0, x1 in HOLES:
        rows = (y_index >= y0) & (y_index < y1)
        cols = (x_index >= x0) & (x_index < x1)
        if rows.any() and cols.any():
            mask[np.ix_(rows, cols)] = True
    return mask


def strip_path(out: Path, row_offset: int) -> Path:
    return out.with_name(f"{out.stem}.strip{row_offset:05d}.tif")


def write_strip(out: Path, row_offset: int, rows: int) -> None:
    path = strip_path(out, row_offset)
    driver = gdal.GetDriverByName("GTiff")
    dataset = driver.Create(
        str(path),
        SIZE,
        rows,
        1,
        gdal.GDT_Float32,
        options=[
            "COMPRESS=NONE",
            "TILED=YES",
            f"BLOCKXSIZE={BLOCK_SIZE}",
            f"BLOCKYSIZE={BLOCK_SIZE}",
        ],
    )
    if dataset is None:
        raise SystemExit(f"could not create {path}")
    dataset.SetGeoTransform(
        (ORIGIN_X, PIXEL, 0.0, ORIGIN_Y - row_offset * PIXEL, 0.0, -PIXEL)
    )
    band = dataset.GetRasterBand(1)
    band.SetNoDataValue(NODATA)

    y_index = np.arange(row_offset, row_offset + rows, dtype=np.float64)
    # Written in bounded column blocks as well, so no single array is larger
    # than BLOCK_SIZE rows of the plane.
    for x_start in range(0, SIZE, BLOCK_SIZE):
        cols = min(BLOCK_SIZE, SIZE - x_start)
        x_index = np.arange(x_start, x_start + cols, dtype=np.float64)
        values = expected_value(x_index[None, :], y_index[:, None]).astype(np.float32)
        values[hole_mask(x_index, y_index)] = np.float32(NODATA)
        band.WriteArray(values, x_start, 0)
    band.FlushCache()
    dataset = None  # noqa: F841 - closes the dataset and flushes the file


def generate(out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    strips = []
    for row_offset in range(0, SIZE, STRIP_ROWS):
        rows = min(STRIP_ROWS, SIZE - row_offset)
        path = strip_path(out, row_offset)
        if not path.exists():
            print(f"  strip y={row_offset} rows={rows}", flush=True)
            write_strip(out, row_offset, rows)
        strips.append(path)

    vrt = out.with_suffix(".vrt")
    subprocess.run(
        ["gdalbuildvrt", "-q", "-overwrite", str(vrt), *map(str, strips)], check=True
    )
    subprocess.run(
        [
            "gdal_translate",
            "-q",
            "-of",
            "GTiff",
            "-co",
            "COMPRESS=NONE",
            "-co",
            "TILED=YES",
            "-co",
            f"BLOCKXSIZE={BLOCK_SIZE}",
            "-co",
            f"BLOCKYSIZE={BLOCK_SIZE}",
            "-co",
            "BIGTIFF=YES",
            str(vrt),
            str(out),
        ],
        check=True,
    )
    for path in strips:
        path.unlink()
    vrt.unlink()


def verify(out: Path) -> None:
    info = subprocess.run(
        ["gdalinfo", "-json", str(out)], capture_output=True, text=True, check=True
    )
    document = json.loads(info.stdout)
    size = document["size"]
    band = document["bands"][0]
    actual = out.stat().st_size
    structure = document.get("metadata", {}).get("IMAGE_STRUCTURE", {})
    print(f"  size        : {size[0]}x{size[1]} ({size[0] * size[1]:,} cells)")
    print(f"  band        : {band['type']} nodata={band.get('noDataValue')}")
    print(f"  compression : {structure.get('COMPRESSION', '(none)')}")
    print(f"  bytes       : {actual:,} (need > {MIN_BYTES:,})")
    print(f"  slope oracle: {slope_degrees():.6f} deg / {slope_percent():.6f} %")
    problems = []
    if size != [SIZE, SIZE]:
        problems.append(f"size {size}")
    if band["type"] != "Float32":
        problems.append(f"type {band['type']}")
    if band.get("noDataValue") != NODATA:
        problems.append(f"nodata {band.get('noDataValue')}")
    if structure.get("COMPRESSION"):
        problems.append(f"compressed {structure['COMPRESSION']}")
    if actual <= MIN_BYTES:
        problems.append(f"only {actual} bytes")
    if problems:
        raise SystemExit("capacity plane verification failed: " + "; ".join(problems))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument(
        "--verify-only", action="store_true", help="verify an existing file only"
    )
    args = parser.parse_args()
    if not args.verify_only:
        print(f"generating {args.out}")
        generate(args.out)
    verify(args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
