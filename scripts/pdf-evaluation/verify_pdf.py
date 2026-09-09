"""Independently inspect browser-downloaded samples with Poppler and stdlib."""

import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import subprocess
import unicodedata
import xml.etree.ElementTree as ET
import zlib


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'output'


def command(*args):
    result = subprocess.run(args, capture_output=True, check=True)
    return result.stdout.decode('utf-8'), result.stderr.decode('utf-8')


def normalized(text):
    return ''.join(unicodedata.normalize('NFC', text).split())


def inspect(candidate, output=OUTPUT):
    pdf = output / f'{candidate}.pdf'
    report = json.loads((output / f'{candidate}.json').read_text())
    data = pdf.read_bytes()
    assert hashlib.sha256(data).hexdigest() == report['sha256'], 'Downloaded bytes changed'
    info, info_errors = command('pdfinfo', '-f', '1', '-l', '3', str(pdf))
    assert re.search(r'Pages:\s+3\b', info), 'Unexpected page count'
    sizes = re.findall(r'Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)', info)
    assert len(sizes) == 3
    for width, height in sizes:
        assert math.isclose(float(width), 210 * 72 / 25.4, abs_tol=.001)
        assert math.isclose(float(height), 297 * 72 / 25.4, abs_tol=.001)
    text, text_errors = command('pdftotext', '-raw', str(pdf), '-')
    for name in report['fixture']['names']:
        assert normalized(name['text']) in normalized(text), f"Text extraction lost {name['text']}"
    assert 'AVATAR' in text and 'office' in text and 'é' in text
    fonts, font_errors = command('pdffonts', str(pdf))
    assert fonts.count('Identity-H') == 4, 'Expected four embedded font resources'
    assert not report['missing'], 'Source fonts have missing glyphs'
    assert all(f['rejectsNoncharacter'] for f in report['fontFacts'])

    # Read actual page content streams; each encoder uses a different Y convention.
    streams = []
    for match in re.finditer(rb'stream\r?\n(.*?)\r?\nendstream', data, re.S):
        try:
            streams.append(zlib.decompress(match.group(1)))
        except zlib.error:
            streams.append(match.group(1))
    lines = []
    for stream in streams:
        for match in re.finditer(rb'(-?[\d.]+) (-?[\d.]+) m\s+(-?[\d.]+) (-?[\d.]+) l', stream):
            x1, y1, x2, y2 = map(float, match.groups())
            if math.isclose(x1, 10 * 72 / 25.4, abs_tol=.00001) and math.isclose(y1, y2, abs_tol=.00001):
                if math.isclose(abs(x2 - x1), 50 * 72 / 25.4, abs_tol=.00001):
                    lines.append(abs(x2 - x1) * 25.4 / 72)
    assert len(lines) == 3, 'Each page needs one physically exact 50 mm calibration line'
    assert not any(b'/Subtype /Image' in stream for stream in [data, *streams]), 'Unexpected rasterized output'

    bbox, bbox_errors = command('pdftotext', '-bbox', str(pdf), '-')
    root = ET.fromstring(bbox)
    words = [el for el in root.iter() if el.tag.endswith('word')]
    japanese = [el for el in words if el.text == 'ローズマリー']
    assert len(japanese) == 2
    actual_widths = [float(el.attrib['xMax']) - float(el.attrib['xMin']) for el in japanese]
    expected_width = next(m['pdfWidth'] for m in report['measurements'] if m['text'] == 'ローズマリー')
    assert all(abs(w - expected_width) < .01 for w in actual_widths), 'PDF text width differs from encoder measurement'
    errors = '\n'.join(filter(None, [info_errors, text_errors, font_errors, bbox_errors]))
    (output / f'{candidate}-fonts.txt').write_text(fonts + errors)
    (output / f'{candidate}-text.txt').write_text(text)
    (output / f'{candidate}-bbox.html').write_text(bbox)
    heap_samples = [s[key] for s in report['samples'] for key in ['heapBefore', 'heapAfter'] if s[key] is not None]
    summary = {
        'bytes': len(data), 'pages': len(sizes), 'calibrationMm': lines,
        'extraction': 'pass', 'embeddedFonts': fonts,
        'readerDiagnostics': sorted(set(filter(None, errors.splitlines()))),
        'fontReaderPass': not errors,
        'japaneseTextWidthPt': actual_widths,
        'maxShapedPreviewWidthDeltaPt': max(abs(m['previewWidth'] - m['pdfWidth']) for m in report['measurements']),
        'coldGenerationMs': report['samples'][0]['generationMs'],
        'warmMedianMs': statistics.median(s['generationMs'] for s in report['samples'][1:]) if len(report['samples']) > 1 else None,
        'observedHeapBeforeAfterBytes': [min(heap_samples), max(heap_samples)] if heap_samples else None,
    }
    if candidate == 'pdfkit':
        assert summary['fontReaderPass'], 'Recommended candidate must pass independent font inspection'
        assert summary['maxShapedPreviewWidthDeltaPt'] < .00001, 'Shared shaping must match PDFKit metrics'
    return summary


if __name__ == '__main__':
    summaries = {candidate: inspect(candidate) for candidate in ['pdfkit', 'pdf-lib']}
    first = json.loads((OUTPUT / 'pdfkit.json').read_text())['fixture']
    second = json.loads((OUTPUT / 'pdf-lib.json').read_text())['fixture']
    assert first == second, 'Candidates must use exactly the same page plan'
    (OUTPUT / 'inspection.json').write_text(json.dumps(summaries, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(summaries, ensure_ascii=False, indent=2))
