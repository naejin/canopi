#!/usr/bin/env python3
"""Deterministic synthetic GeoTIFF fixture generation for raster qualification (Q).

Generates the small analytical planes, a moderate grid, a many-tile collection and
the large capacity plane defined by
``docs/design/raster-data-analysis-rework.md``.

Design rules:

* Everything is written in bounded row blocks, so peak process memory does not
  scale with the raster size.
* Every fixture is analytic: the expected elevation and slope are known in closed
  form, so the qualification oracles do not depend on the engine under test.
* ``--manifest`` writes a portable record (parameters plus SHA-256) that is safe
  to commit. The GeoTIFF payloads are large generated artifacts and stay outside
  Git.

Usage::

    python3 scripts/raster-qualification/generate_fixtures.py --help
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
from osgeo import gdal, osr

gdal.UseExceptions()

# Plane definition shared by every planar fixture.
#
# CRITICAL UNITS NOTE: ``a`` and ``b`` are metres of elevation per *pixel*, while
# the slope recipe divides the 3x3 derivative by the pixel size in metres. The
# surface gradient in metres per metre is therefore ``a / pixel`` and
# ``b / pixel``. With the 0.5 m pixel used everywhere here, ``a = b = 0.5`` is a
# 45 degree slope. Defining the coefficients per pixel keeps the fixtures a
# genuine closed-form ground truth for the metre-based recipe.
PLANE_A = 0.1
PLANE_B = 0.2
PLANE_C = -100.0
PIXEL_METRES = 0.5
NODATA = -9999.0

# NoData rectangles in the large capacity plane, as (row0, row1, col0, col1).
# Declared here so the generator and the qualification oracle share one source.
LARGE_HOLE_A = (4096, 4608, 4096, 4608)
LARGE_HOLE_B = (12288, 12544, 8192, 8704)


def plane_slope_degrees() -> float:
    return float(np.degrees(np.arctan(np.hypot(PLANE_A, PLANE_B) / PIXEL_METRES)))


def plane_slope_percent() -> float:
    return float(100.0 * np.hypot(PLANE_A, PLANE_B) / PIXEL_METRES)


def _srs_epsg(epsg: int) -> osr.SpatialReference:
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(epsg)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return srs


def _create(path: Path, width: int, height: int, *, tiled: bool, compress: str,
            blocksize: int, epsg: int, origin: tuple[float, float], pixel: float,
            overviews: int, bigtiff: bool) -> gdal.Dataset:
    options = ["BIGTIFF=YES" if bigtiff else "BIGTIFF=IF_NEEDED"]
    if tiled:
        options += ["TILED=YES", f"BLOCKSIZE={blocksize}"]
    else:
        # A large strip keeps the uncompressed capacity plane addressable in
        # bounded row ranges without decoding an entire block per row.
        options += ["TILED=NO"]
    options.append(f"COMPRESS={compress}")
    driver = gdal.GetDriverByName("GTiff")
    dataset = driver.Create(str(path), width, height, 1, gdal.GDT_Float32, options=options)
    if dataset is None:
        raise RuntimeError(f"could not create {path}")
    dataset.SetGeoTransform([origin[0], pixel, 0.0, origin[1], 0.0, -pixel])
    dataset.SetProjection(_srs_epsg(epsg).ExportToWkt())
    band = dataset.GetRasterBand(1)
    band.SetNoDataValue(NODATA)
    if overviews:
        dataset.BuildOverviews("NEAREST", [2 ** (i + 1) for i in range(overviews)])
    return dataset


def _write_blocks(dataset: gdal.Dataset, width: int, height: int,
                  evaluate, block_rows: int = 256) -> None:
    """Write rows in bounded blocks; ``evaluate`` maps (x, y) grids to values."""
    band = dataset.GetRasterBand(1)
    xs = np.arange(width, dtype=np.float64)
    for row0 in range(0, height, block_rows):
        rows = min(block_rows, height - row0)
        ys = np.arange(row0, row0 + rows, dtype=np.float64)[:, None]
        values = evaluate(xs[None, :], ys).astype(np.float32)
        band.WriteArray(values, 0, row0)
        if (row0 // block_rows) % 16 == 0:
            print(f"    rows {row0}/{height}", file=sys.stderr, flush=True)


def _punch_holes(values: np.ndarray, row0: int, hole_rows: list[tuple[int, int]],
                 hole_cols: tuple[int, int]) -> None:
    for start, end in hole_rows:
        lo = max(start - row0, 0)
        hi = min(end - row0, values.shape[0])
        if lo < hi:
            values[lo:hi, hole_cols[0]:hole_cols[1]] = NODATA


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_plane(root: Path, name: str, size: int, *, blocksize: int = 256,
                holes: list[tuple[int, int, int, int]] | None = None,
                tiled: bool = True, compress: str = "DEFLATE",
                overviews: int = 2, block_rows: int = 256,
                bigtiff: bool = False) -> Path:
    path = root / f"{name}.tif"
    dataset = _create(path, size, size, tiled=tiled, compress=compress,
                      blocksize=blocksize, epsg=2154,
                      origin=(444999.75, 6806000.25), pixel=PIXEL_METRES,
                      overviews=overviews, bigtiff=bigtiff)

    if holes:
        band = dataset.GetRasterBand(1)
        xs = np.arange(size, dtype=np.float64)
        for row0 in range(0, size, block_rows):
            rows = min(block_rows, size - row0)
            ys = np.arange(row0, row0 + rows, dtype=np.float64)[:, None]
            values = (PLANE_A * xs[None, :] + PLANE_B * ys + PLANE_C).astype(np.float32)
            for (hx0, hy0, hx1, hy1) in holes:
                lo, hi = max(hy0 - row0, 0), min(hy1 - row0, rows)
                if lo < hi:
                    values[lo:hi, hx0:hx1] = NODATA
            band.WriteArray(values, 0, row0)
    else:
        _write_blocks(dataset, size, size,
                      lambda x, y: PLANE_A * x + PLANE_B * y + PLANE_C,
                      block_rows=block_rows)

    dataset.FlushCache()
    dataset = None
    return path


def build_steep_plane(root: Path, name: str, size: int = 64) -> Path:
    """A plane rising exactly one metre per horizontal metre: a 45 degree slope.

    The recipe forms ``atan(hypot(dzdx, dzdy))``. A 45 degree result needs a
    gradient magnitude of 1 m/m, so each axis carries ``1/sqrt(2)``; at 0.5 m
    pixels the per-pixel coefficients are ``0.5/sqrt(2)``.
    """
    path = root / f"{name}.tif"
    dataset = _create(path, size, size, tiled=True, compress="DEFLATE", blocksize=64,
                      epsg=2154, origin=(444999.75, 6806000.25), pixel=PIXEL_METRES,
                      overviews=0, bigtiff=False)
    coefficient = PIXEL_METRES / math.sqrt(2.0)
    _write_blocks(dataset, size, size,
                  lambda x, y: coefficient * x + coefficient * y + 10.0)
    dataset.FlushCache()
    dataset = None
    return path


def build_curved_surface(root: Path, name: str, size: int = 256,
                         amplitude: float = 40.0, wavelength: float = 90.0) -> Path:
    """A smooth non-planar DEM used as the independent engine-comparison surface."""
    path = root / f"{name}.tif"
    dataset = _create(path, size, size, tiled=True, compress="DEFLATE", blocksize=64,
                      epsg=2154, origin=(444999.75, 6806000.25), pixel=PIXEL_METRES,
                      overviews=1, bigtiff=False)

    def evaluate(x, y):
        return (amplitude * np.sin(2.0 * np.pi * x / wavelength)
                + 0.4 * amplitude * np.cos(2.0 * np.pi * y / (wavelength * 0.6))
                + PLANE_C)

    _write_blocks(dataset, size, size, evaluate)
    dataset.FlushCache()
    dataset = None
    return path


def build_tile_collection(root: Path, name: str, *, count: int = 24, size: int = 2000,
                          gap_tiles: int = 1) -> list[Path]:
    """Many members on an aligned lattice, optionally leaving a tile-sized gap.

    Tiles are aligned to a shared 0.5 m lattice so the collection is a valid
    multi-member generation with a non-rectangular occupied footprint.
    """
    directory = root / name
    directory.mkdir(parents=True, exist_ok=True)
    columns = 6
    written: list[Path] = []
    index = 0
    for row in range(count // columns + 1):
        for column in range(columns):
            if index >= count:
                break
            # Leave an unoccupied lattice slot to prove block allocation follows
            # occupied coverage rather than the bounding rectangle.
            if gap_tiles and row == 1 and column == 2:
                continue
            origin_x = 444999.75 + column * size * PIXEL_METRES
            origin_y = 6806000.25 - row * size * PIXEL_METRES
            path = directory / f"tile_{row:02d}_{column:02d}.tif"
            dataset = _create(path, size, size, tiled=True, compress="DEFLATE",
                              blocksize=256, epsg=2154,
                              origin=(origin_x, origin_y), pixel=PIXEL_METRES,
                              overviews=1, bigtiff=False)

            def evaluate(x, y, ox=column * size, oy=row * size):
                # Continuous across tile boundaries: plane evaluated in global pixels.
                return PLANE_A * (x + ox) + PLANE_B * (y + oy) + PLANE_C

            _write_blocks(dataset, size, size, evaluate)
            dataset.FlushCache()
            dataset = None
            written.append(path)
            index += 1
    return written


def build_large_plane(root: Path, name: str, size: int = 20000) -> Path:
    """Capacity input: 400 million Float32 cells, uncompressed, tiny strip height.

    ``BLOCKYSIZE=1`` is deliberately unusual: it makes the exact byte range of any
    row range directly computable (offset = header + row * width * 4), which is how
    the bounded native window probe addresses the file without decoding it whole.
    """
    path = root / f"{name}.tif"
    options = ["TILED=NO", "COMPRESS=NONE", "BIGTIFF=YES", "BLOCKYSIZE=1"]
    driver = gdal.GetDriverByName("GTiff")
    dataset = driver.Create(str(path), size, size, 1, gdal.GDT_Float32, options=options)
    dataset.SetGeoTransform([444999.75, PIXEL_METRES, 0.0, 6806000.25, 0.0, -PIXEL_METRES])
    dataset.SetProjection(_srs_epsg(2154).ExportToWkt())
    band = dataset.GetRasterBand(1)
    band.SetNoDataValue(NODATA)
    xs = np.arange(size, dtype=np.float64)
    # Deterministic holes that cross processing-block boundaries. Both are
    # written for their full row range so the declared rectangles exist exactly.
    for row in range(size):
        values = (PLANE_A * xs + PLANE_B * row + PLANE_C).astype(np.float32)
        if LARGE_HOLE_A[0] <= row < LARGE_HOLE_A[1]:
            values[LARGE_HOLE_A[2]:LARGE_HOLE_A[3]] = NODATA
        if LARGE_HOLE_B[0] <= row < LARGE_HOLE_B[1]:
            values[LARGE_HOLE_B[2]:LARGE_HOLE_B[3]] = NODATA
        band.WriteArray(values[None, :], 0, row)
        if row % 2000 == 0:
            print(f"    row {row}/{size}", file=sys.stderr, flush=True)
    dataset.FlushCache()
    dataset = None
    return path


BUILDERS = {
    "plane256": lambda root: build_plane(
        root, "plane256", 256, blocksize=64, holes=[(10, 10, 20, 20), (200, 200, 210, 210)]),
    "plane2000": lambda root: build_plane(root, "plane2000", 2000, blocksize=256),
    "steep45": lambda root: build_steep_plane(root, "steep45"),
    "curved256": lambda root: build_curved_surface(root, "curved256"),
    "tiles24": lambda root: build_tile_collection(root, "tiles24"),
    "largeplane": lambda root: build_large_plane(root, "largeplane"),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", required=True, type=Path,
                        help="output directory for generated fixtures")
    parser.add_argument("--fixture", action="append", choices=sorted(BUILDERS),
                        help="fixture to build; repeatable. Default: all except largeplane")
    parser.add_argument("--manifest", type=Path,
                        help="write a portable JSON manifest of generated fixtures")
    args = parser.parse_args()

    selected = args.fixture or [name for name in BUILDERS if name != "largeplane"]
    args.root.mkdir(parents=True, exist_ok=True)

    records = []
    for name in selected:
        print(f"  building {name}", file=sys.stderr, flush=True)
        result = BUILDERS[name](args.root)
        paths = result if isinstance(result, list) else [result]
        for path in paths:
            records.append({
                "fixture": name,
                "path": str(path.relative_to(args.root)),
                "bytes": path.stat().st_size,
                "sha256": _sha256(path),
                "epsg": 2154,
                "pixel_metres": PIXEL_METRES,
                "dtype": "Float32",
                "nodata": NODATA,
            })
            print(f"    {path.name}: {path.stat().st_size} bytes", file=sys.stderr, flush=True)

    summary = {
        "generator": "scripts/raster-qualification/generate_fixtures.py",
        "pixel_metres": PIXEL_METRES,
        "plane": {"a_metres_per_pixel": PLANE_A, "b_metres_per_pixel": PLANE_B,
                  "c": PLANE_C,
                  "gradient_metres_per_metre": [PLANE_A / PIXEL_METRES, PLANE_B / PIXEL_METRES],
                  "expected_slope_degrees": plane_slope_degrees(),
                  "expected_slope_percent": plane_slope_percent()},
        "fixtures": records,
    }
    if args.manifest:
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
        print(f"  manifest: {args.manifest}", file=sys.stderr)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
