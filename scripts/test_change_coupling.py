import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts import change_coupling as cc


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


def commit(repo: Path, files: dict[str, str], message: str) -> None:
    for name, text in files.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        git(repo, "add", name)
    git(repo, "commit", "-q", "-m", message)


class AreaTest(unittest.TestCase):
    def test_areas_name_the_owning_folder(self) -> None:
        self.assertEqual(cc.area("desktop/web/src/app/lidar/profile.ts"), "web/app/lidar")
        self.assertEqual(cc.area("desktop/web/src/canvas/runtime/tools/tool-host.ts"), "web/canvas/runtime")
        self.assertEqual(cc.area("desktop/web/src/maplibre/site-overlay.ts"), "web/maplibre")
        self.assertEqual(cc.area("desktop/src/services/lidar/mod.rs"), "desktop/services/lidar")
        self.assertEqual(cc.area("desktop/src/lib.rs"), "desktop")
        self.assertEqual(cc.area("common-types/src/lidar.rs"), "common-types")

    def test_docs_tests_locales_and_generated_files_are_not_counted(self) -> None:
        for path in (
            "docs/plans/canvas-v2-plan.md",
            ".beads/issues.jsonl",
            "desktop/web/src/i18n/locales/fr.json",
            "desktop/web/src/__tests__/unused-code-snapshot.json",
            "desktop/web/src/app/lidar/profile.test.ts",
            "desktop/web/src/generated/contracts.ts",
            "desktop/src/services/lidar/fixed_library_tests.rs",
            "desktop/web/e2e/gallery/profile.spec.ts",
        ):
            self.assertFalse(cc.counted(path), path)
        self.assertTrue(cc.counted("desktop/web/src/app/lidar/profile.ts"))


class CouplingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.email", "t@example.com")
        git(self.repo, "config", "user.name", "t")
        a, b = "desktop/web/src/app/lidar/a.ts", "desktop/web/src/maplibre/b.ts"
        c = "desktop/web/src/app/lidar/c.ts"
        for i in range(3):
            commit(self.repo, {a: f"a{i}\n", b: f"b{i}\n"}, f"together {i}")
        commit(self.repo, {a: "a-alone\n"}, "a alone")
        commit(self.repo, {c: "c\n", "docs/x.md": "d\n"}, "c with docs")
        commit(self.repo, {f"desktop/web/src/app/x/f{i}.ts": "x\n" for i in range(5)}, "mass edit")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_files_changed_together_across_areas_are_reported_with_their_degree(self) -> None:
        report = cc.analyse(self.repo, since=None, max_files=4)
        pair = report.pairs[0]
        self.assertEqual((pair.a, pair.b), ("desktop/web/src/app/lidar/a.ts", "desktop/web/src/maplibre/b.ts"))
        self.assertEqual(pair.shared, 3)
        self.assertAlmostEqual(pair.degree, 1.0)  # b never changed without a
        self.assertEqual(report.area_pairs[("web/app/lidar", "web/maplibre")], 3)

    def test_mass_edits_are_skipped_and_counted(self) -> None:
        report = cc.analyse(self.repo, since=None, max_files=4)
        self.assertEqual(report.skipped, 1)
        self.assertFalse(any("app/x/" in p.a or "app/x/" in p.b for p in report.pairs))

    def test_hotspots_rank_changes_times_size(self) -> None:
        report = cc.analyse(self.repo, since=None, max_files=4)
        self.assertEqual(report.hotspots[0][0], "desktop/web/src/app/lidar/a.ts")
        self.assertEqual(report.hotspots[0][1], 4)

    def test_the_report_is_markdown_with_its_three_tables(self) -> None:
        text = cc.render(cc.analyse(self.repo, since=None, max_files=4), top=10)
        for heading in ("## Files that change together across areas", "## Areas that change together", "## Hotspots"):
            self.assertIn(heading, text)


if __name__ == "__main__":
    unittest.main()
