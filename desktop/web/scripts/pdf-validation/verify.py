"""Independent Poppler/zlib checks of production PDFs and their recorded plans."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import zlib

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
    assert bars == canvas_pages, (path, bars, canvas_pages)
    assert text.count('Print at actual size') == canvas_pages
    for page in report['legends']:
        assert f'Page {page["number"]} / {report["pages"]}' in text
    if report['fixture'] == 'multilingual':
        for word in ['Érable', 'Яблоня', '庭園', 'ローズマリー', '정원', '포도']:
            assert word in text, word
    if report['fixture'] == 'legends':
        for i in range(100):
            assert re.search(rf'cultivar\s+{i:03}', text), i
    verification = {'file': path.name, 'sha256': hashlib.sha256(data).hexdigest(), 'pages': report['pages'], 'bytes': len(data),
                    'canvasPages': canvas_pages, 'exact50mmBars': bars, 'embeddedUnicodeFonts': True, 'vectorCanvas': True,
                    'textSha256': hashlib.sha256(text.encode()).hexdigest(), 'planSha256': report['planSha256']}
    path.with_suffix('.verification.json').write_text(json.dumps(verification, indent=2) + '\n')
    path.with_suffix('.text.txt').write_text(text)
    reports.append(verification)
    print(json.dumps(verification))
if len(reports) > 1 and all(Path(p).name == 'pdfkit.pdf' for p in sys.argv[1:]):
    assert len({r['textSha256'] for r in reports}) == 1, 'Native extracted text differs'
    assert len({r['planSha256'] for r in reports}) == 1, 'Native physical plans differ'
