"""Regression coverage for native preview admission and optional browser samples."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from preview_files import preview_files


class PreviewFilesTests(unittest.TestCase):
    def test_native_samples_require_each_preview_up_to_three_pages(self):
        for pages in [1, 2, 3, 50]:
            with self.subTest(pages=pages), TemporaryDirectory() as directory:
                pdf = Path(directory) / 'pdfkit.pdf'
                expected = [(i, pdf.parent / f'preview-{i}.png') for i in range(1, min(3, pages) + 1)]
                for _, path in expected:
                    path.touch()
                self.assertEqual(preview_files(pdf, pages), expected)
                for _, path in expected:
                    path.unlink()
                    with self.assertRaisesRegex(AssertionError, 'Missing native preview'):
                        preview_files(pdf, pages)
                    path.touch()

    def test_browser_stress_samples_may_omit_preview_images(self):
        with TemporaryDirectory() as directory:
            pdf = Path(directory) / 'fifty-pages.pdf'
            self.assertEqual(preview_files(pdf, 50), [])

    def test_browser_preview_matches_the_page_selected_by_the_runner(self):
        for pages in [1, 2, 50]:
            with self.subTest(pages=pages), TemporaryDirectory() as directory:
                pdf = Path(directory) / 'sample.pdf'
                image = pdf.with_name('sample-preview.png')
                image.touch()
                self.assertEqual(preview_files(pdf, pages), [(min(2, pages), image)])

    def test_private_samples_require_every_page_preview(self):
        with TemporaryDirectory() as directory:
            pdf = Path(directory) / 'private.pdf'
            expected = [(i, pdf.with_name(f'private-preview-{i}.png')) for i in range(1, 5)]
            for _, path in expected:
                path.touch()
            self.assertEqual(preview_files(pdf, 4), expected)
            expected[-1][1].unlink()
            with self.assertRaisesRegex(AssertionError, 'Missing private preview'):
                preview_files(pdf, 4)


if __name__ == '__main__':
    unittest.main()
