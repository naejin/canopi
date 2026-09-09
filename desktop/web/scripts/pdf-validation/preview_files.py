"""Locate preview images emitted by the browser and native sample runners."""
from pathlib import Path


def preview_files(pdf: Path, pages: int) -> list[tuple[int, Path]]:
    if pdf.name == 'pdfkit.pdf':
        candidates = [(i, pdf.parent / f'preview-{i}.png') for i in range(1, min(3, pages) + 1)]
        for _, path in candidates:
            assert path.is_file(), f'Missing native preview: {path}'
        return candidates
    else:
        candidates = [(min(2, pages), pdf.with_name(pdf.stem + '-preview.png'))]
    return [(number, path) for number, path in candidates if path.is_file()]
