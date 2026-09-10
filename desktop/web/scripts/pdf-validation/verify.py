"""Independent Poppler/zlib checks of production PDFs and their recorded plans."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import zlib
from PIL import Image, ImageChops, ImageStat, ImageFilter
from preview_files import preview_files

reports = []
for argument in sys.argv[1:]:
    path = Path(argument)
    report = json.loads(path.with_suffix('.json').read_text())
    data = path.read_bytes()
    info = subprocess.check_output(['pdfinfo', str(path)], text=True)
    text = subprocess.check_output(['pdftotext', '-layout', str(path), '-'], text=True)
    fonts = subprocess.check_output(['pdffonts', str(path)], text=True)
    assert int(re.search(r'^Pages:\s+(\d+)', info, re.M)[1]) == report['pages']
    assert b'/Subtype /Image' not in data, 'Unexpected raster canvas'
    assert '/FontFile' in data.decode('latin1') and '/ToUnicode' in data.decode('latin1')
    assert ' yes yes yes ' in fonts, fonts
    streams = []
    for match in re.finditer(rb'^stream\r?\n', data, re.M):
        header = data[data.rfind(b'endobj', 0, match.start()) + 6:match.start()]
        length = re.search(rb'/Length\s+(\d+)\s*(?:/|>>)', header)
        assert length and b'/FlateDecode' in header, 'Unexpected production stream format'
        # Use the declared byte length: binary data may itself end in CR or LF.
        streams.append(zlib.decompress(data[match.end():match.end() + int(length[1])]).decode('latin1'))
    bars = 0
    for stream in streams:
        points = re.findall(r'([\d.-]+) ([\d.-]+) m\s+([\d.-]+) ([\d.-]+) l', stream)
        bars += sum(abs(float(x2) - float(x1) - 141.732283) < .00001 and abs(float(y1) - float(y2)) < .00001 for x1, y1, x2, y2 in points)
    canvas_pages = sum(page['kind'] != 'legend' for page in report['legends'])
    assert bars == 1, (path, bars)
    assert text.count(report.get('actualSizeLabel', 'Print at actual size')) == 1
    destinations = {f"page:{p['id']}" for p in report['legends']}
    for page in report['legends']:
        destinations.update(d['id'] for d in page.get('destinations', []))
    assert all(link['target'] in destinations for p in report['legends'] for link in p.get('links', [])), 'Broken page/key link'
    extracted_pages = text.split('\f')
    for page in report['legends']:
        number = page['number'] if page['kind'] != 'legend' else next(p['number'] for p in report['legends'] if p['id'] == page['sourceId'])
        assert re.search(rf'(?<!\d){number}(?!\d)', extracted_pages[page['number'] - 1]), page
    if report['fixture'] == 'multilingual':
        for word in ['Érable', 'Яблоня', '庭園', 'ローズマリー', '정원', '포도']:
            assert word in text, word
    if report['fixture'] == 'legends':
        for i in range(100):
            assert re.search(rf'cultivar\s+{i:03}', text), i
    verification = {'file': path.name, 'sha256': hashlib.sha256(data).hexdigest(), 'pages': report['pages'], 'bytes': len(data),
                    'canvasPages': canvas_pages, 'exact50mmBars': bars, 'embeddedUnicodeFonts': True, 'vectorCanvas': True,
                    'textSha256': hashlib.sha256(text.encode()).hexdigest(), 'planSha256': report['planSha256']}
    comparisons = []
    for number, preview in preview_files(path, report['pages']):
        rendered = path.with_name(f'{path.stem}-render-{number}')
        subprocess.run(['pdftoppm', '-f', str(number), '-singlefile', '-r', '108', '-png', str(path), str(rendered)], check=True)
        expected = Image.open(preview).convert('RGB')
        actual = Image.open(str(rendered) + '.png').convert('RGB')
        assert expected.size == actual.size, (preview, expected.size, actual.size)
        difference = sum(ImageStat.Stat(ImageChops.difference(expected, actual)).mean) / 3
        # Compare against each pixel's one-pixel neighborhood to allow different
        # antialiasing. Raw MAE unfairly penalizes text-dense pages (2.49 for the
        # correct legend). This bound still rejects all four original bad
        # previews: 0.445-22.312 versus 0.010-0.078 after the SVG correction.
        residual = ImageChops.add(ImageChops.subtract(actual.filter(ImageFilter.MinFilter(3)), expected),
                                 ImageChops.subtract(expected, actual.filter(ImageFilter.MaxFilter(3))))
        neighborhood_difference = sum(ImageStat.Stat(residual).mean) / 3
        assert neighborhood_difference < .25, (preview, neighborhood_difference)
        comparisons.append({'page': number, 'meanChannelDifference': difference,
                            'neighborhoodDifference': neighborhood_difference, 'maximumAllowed': .25})
    verification['previewComparisons'] = comparisons
    path.with_suffix('.verification.json').write_text(json.dumps(verification, indent=2) + '\n')
    path.with_suffix('.text.txt').write_text(text)
    reports.append(verification)
    print(json.dumps(verification))
if len(reports) > 1 and all(Path(p).name == 'pdfkit.pdf' for p in sys.argv[1:]):
    assert len({r['textSha256'] for r in reports}) == 1, 'Native extracted text differs'
    assert len({r['planSha256'] for r in reports}) == 1, 'Native physical plans differ'
