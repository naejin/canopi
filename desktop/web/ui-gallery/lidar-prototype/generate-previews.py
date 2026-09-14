"""Throwaway scientific raster previews. Read Downloads; write only beside this script.
Run: /usr/bin/python3 desktop/web/ui-gallery/lidar-prototype/generate-previews.py
Requires this machine's GDAL Python bindings + NumPy; no app dependency.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from osgeo import gdal

gdal.UseExceptions()
out = Path(__file__).parent / 'assets'
out.mkdir(exist_ok=True)
legend = gdal.GetDriverByName('MEM').Create('', 256, 1, 3, gdal.GDT_Byte)
for band, (low, high) in enumerate(zip([245, 236, 213], [117, 79, 39]), 1):
    legend.GetRasterBand(band).WriteArray(np.linspace(low, high, 256).astype('uint8')[None, :])
gdal.Translate(str(out / 'elevation-legend.png'), legend, format='PNG')
report = {}
for kind in ('MNT', 'MNS'):
    paths = list((Path.home() / 'Downloads').glob(f'LHD*_{kind}_*/*'))
    source = next(p for p in paths if not p.suffix)
    ds = gdal.Open(str(source))
    a = ds.ReadAsArray()
    valid = np.isfinite(a) & (a != ds.GetRasterBand(1).GetNoDataValue())
    values = a[valid]
    # Dataset-wide range: comparison keeps the same elevation scale across both products.
    t = np.clip((a - 140) / 60, 0, 1)
    low, high = np.array([245, 236, 213]), np.array([117, 79, 39])
    elevation = low + t[..., None] * (high - low)
    shade = gdal.DEMProcessing('', ds, 'hillshade', format='MEM', computeEdges=True).ReadAsArray()
    hillshade = np.repeat(shade[..., None], 3, axis=2)
    for mode, rgb in [('elevation', elevation), ('hillshade', hillshade)]:
        mem = gdal.GetDriverByName('MEM').Create('', ds.RasterXSize, ds.RasterYSize, 4, gdal.GDT_Byte)
        for band in range(3):
            mem.GetRasterBand(band + 1).WriteArray(np.clip(rgb[..., band], 0, 255).astype('uint8'))
        mem.GetRasterBand(4).WriteArray(valid.astype('uint8') * 255)
        mem.GetRasterBand(4).SetColorInterpretation(gdal.GCI_AlphaBand)
        for level in range(7):
            size = max(1, round(2000 / 2**level))
            gdal.Translate(str(out / f'{kind.lower()}-{mode}-{level}.png'), mem, format='PNG', width=size, height=size, resampleAlg='average')
    report[kind] = dict(filename=source.name, bytes=source.stat().st_size, sha256=hashlib.sha256(source.read_bytes()).hexdigest(), size=[ds.RasterXSize, ds.RasterYSize], transform=ds.GetGeoTransform(), nodata=-9999, valid=int(valid.sum()), min=float(values.min()), max=float(values.max()), percentiles=np.percentile(values,[2,50,98]).tolist(), overview_count=ds.GetRasterBand(1).GetOverviewCount(), wkt=ds.GetProjection())
(out.parent / 'input-evidence.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k:{f:v for f,v in row.items() if f not in ('wkt','transform')} for k,row in report.items()},indent=2))
