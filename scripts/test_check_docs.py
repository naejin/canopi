from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.check_docs import anchors, check_document


class DocumentationChecks(unittest.TestCase):
    def test_local_links_fragments_and_code_examples(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "other.md").write_text("# Valid heading\n# Valid heading\n", encoding="utf-8")
            page = root / "README.md"
            page.write_text('[ok](other.md#valid-heading-1)\n[bad](missing.md)\n[bad heading](other.md#absent)\n[remote](https://example.org)\n`[example](ignored.md)`\n```md\n[example](ignored.md)\n```\n[ref]: other.md#valid-heading\n', encoding="utf-8")
            errors = check_document(page, root)
            self.assertEqual(len(errors), 2)
            self.assertIn("missing target missing.md", errors[0])
            self.assertIn("missing heading other.md#absent", errors[1])

    def test_design_lifecycle_requires_tracking_and_current_guide(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            page = root / "docs/design/plan.md"
            page.parent.mkdir(parents=True)
            page.write_text('# Plan\n\nStatus: completed.\n', encoding="utf-8")
            self.assertEqual(len(check_document(page, root)), 2)
            page.write_text('# Plan\n\nStatus: completed.\nTracking: `canopi-test`.\nCurrent guidance: [self](plan.md).\n', encoding="utf-8")
            self.assertEqual(check_document(page, root), [])

    def test_superseded_adr_requires_existing_replacement(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            page = root / "docs/adr/old.md"
            page.parent.mkdir(parents=True)
            page.write_text('---\nstatus: superseded\nsuperseded_by: missing.md\n---\n', encoding="utf-8")
            self.assertEqual(len(check_document(page, root)), 1)

    def test_heading_code_fences_and_unicode(self):
        self.assertEqual(anchors('# Café `owner`\n~~~\n# ignored\n~~~\n'), {'café-owner'})


if __name__ == "__main__":
    unittest.main()
