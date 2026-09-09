"""Check native-saved PDFs and previews against the existing browser reference."""
import hashlib
import json
from pathlib import Path
import struct
import sys

from verify_pdf import inspect

root = Path(__file__).resolve().parents[2]
reference = json.loads((root / 'docs/assets/canvas-pdf/pdfkit.json').read_text())
outputs = [Path(path) for path in sys.argv[1:]]
assert outputs, 'Pass at least one native output directory'
for output in outputs:
    report = json.loads((output / 'pdfkit.json').read_text())
    runtime = json.loads((output / 'runtime.json').read_text())
    assert report['fixture'] == reference['fixture'], 'Native layout differs from reference'
    assert report['sha256'] == reference['sha256'], 'Native PDF differs from reference bytes'
    previews = []
    for index in range(1, 4):
        data = (output / f'preview-{index}.png').read_bytes()
        assert data[:8] == b'\x89PNG\r\n\x1a\n'
        width, height = struct.unpack('>II', data[16:24])
        assert (width, height) == (794, 1123), (width, height)
        assert len(data) > 10_000, 'Suspiciously empty preview'
        previews.append({'page': index, 'width': width, 'height': height, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    result = {'runtime': runtime, 'userAgent': report['runtime'], 'pdfMatchesReference': True,
              'inspection': inspect('pdfkit', output), 'previews': previews}
    (output / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'output': str(output), 'runtime': runtime, 'pdfMatchesReference': True, 'previewPages': len(previews)}))
