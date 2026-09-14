"""Small reproducible feasibility experiments, not production tests or benchmarks.
Run with /usr/bin/python3; uses system GDAL + NumPy and disposable storage only.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
import json
import sqlite3
import numpy as np
from osgeo import gdal, osr

gdal.UseExceptions()
report = {'gdal': gdal.VersionInfo('--version')}
with TemporaryDirectory(prefix='canopi-lidar-mosaic-study-') as directory:
    root = Path(directory)
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(2154)
    paths = []
    for name, x, value in [('old', 446000, 10), ('east', 446004, 20), ('new', 446002, 30)]:
        path = root / f'{name}.tif'
        ds = gdal.GetDriverByName('GTiff').Create(str(path), 4, 4, 1, gdal.GDT_Float32)
        ds.SetGeoTransform([x, 1, 0, 6807000, 0, -1])
        ds.SetProjection(srs.ExportToWkt())
        band = ds.GetRasterBand(1)
        band.SetNoDataValue(-9999)
        values = np.full((4, 4), value, dtype=np.float32)
        if name == 'new': values[1, 1] = -9999
        band.WriteArray(values)
        ds = None
        paths.append(str(path))
    old = gdal.BuildVRT('', paths[:2]).ReadAsArray()
    updated = gdal.BuildVRT('', paths).ReadAsArray()
    assert old.shape == (4, 8)
    assert updated[0].tolist() == [10, 10, 30, 30, 30, 30, 20, 20]
    assert updated[1, 3] == 10  # Older valid coverage fills newer NoData.
    assert gdal.Open(paths[0]).ReadAsArray()[0, 2] == 10  # No overwrite.
    report['mosaic'] = {'shape': list(updated.shape), 'updated_first_row': updated[0].tolist(), 'nodata_fallback_value': float(updated[1, 3]), 'original_unchanged': True}

connection = sqlite3.connect(':memory:')
connection.execute('CREATE VIRTUAL TABLE footprints USING rtree(id,minx,maxx,miny,maxy)')
connection.executemany('INSERT INTO footprints VALUES (?,?,?,?,?)', ((i, i % 1000, i % 1000 + 1, i // 1000, i // 1000 + 1) for i in range(100_000)))
query = 'SELECT id FROM footprints WHERE minx <= ? AND maxx >= ? AND miny <= ? AND maxy >= ?'
parameters = (104.8, 100.2, 54.8, 50.2)
start = perf_counter()
for _ in range(1000):
    rows = connection.execute(query, parameters).fetchall()
elapsed = perf_counter() - start
assert len(rows) == 25
report['rtree'] = {'entries': 100_000, 'candidates': len(rows), 'warm_repetitions': 1000, 'mean_ms': round(elapsed, 3), 'query_plan': connection.execute('EXPLAIN QUERY PLAN ' + query, parameters).fetchall()}
report['limits'] = 'Synthetic equal-resolution rasters; simple VRT priority/NoData only. Warm in-memory index; no packaged engine, persistent DB, rotated warp, metatile, RSS or cold-disk benchmark.'
path = Path(__file__).with_name('mosaic-evidence.json')
path.write_text(json.dumps(report, indent=2) + '\n')
print(path.read_text())
