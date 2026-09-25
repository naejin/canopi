from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.check_docs import anchors, check_document, check_placement


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

    def test_docs_outside_the_v2_layout_are_refused(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("docs/README.md", "docs/guides/frontend.md", "docs/adr/0001-x.md", "docs/release-notes/v2.0.0.md", "docs/design/plan.md", "docs/evidence.md"):
                (root / name).parent.mkdir(parents=True, exist_ok=True)
                (root / name).write_text("# Doc\n", encoding="utf-8")
            errors = check_placement(root)
            self.assertEqual(len(errors), 2)
            self.assertIn("docs/design/plan.md", errors[0])
            self.assertIn("docs/evidence.md", errors[1])

    def test_line_budgets(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            guide = root / "docs/guides/editions.md"
            guide.parent.mkdir(parents=True)
            guide.write_text("# Editions\n" + "line\n" * 150, encoding="utf-8")
            self.assertIn("docs/guides/editions.md: 151 lines exceeds its 150-line budget", check_document(guide, root))
            guide.write_text("# Editions\n", encoding="utf-8")
            self.assertEqual(check_document(guide, root), [])

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
