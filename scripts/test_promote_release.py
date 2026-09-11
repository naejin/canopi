"""Exercise promotion through its CLI with a local GitHub boundary."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile


SOURCE = Path(__file__).resolve().parent
SHA = "1" * 40


class PromotionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        shutil.copy2(SOURCE / "promote-release.sh", self.root / "scripts")
        self.state = {
            "run": {"path": ".github/workflows/release-candidate.yml", "status": "completed", "conclusion": "success"},
            "metadata": {"repository": "example/canopi", "ref": SHA, "head_sha": SHA, "release_version": "1.1.1",
                         "db_release_tag": "canopi-core-db", "db_asset_name": "catalog.db", "db_sha256": "2" * 64,
                         "expected_db_schema_version": 13},
            "release": None, "tag_sha": None,
        }
        gh = self.root / "gh"
        gh.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(os.environ["PROMOTION_FIXTURE"])
state = json.loads((root / "state.json").read_text())
args = sys.argv[1:]
with (root / "calls.jsonl").open("a") as f: f.write(json.dumps(args) + "\\n")
if args[:2] == ["release", "view"]:
    if state["release"] is None: sys.exit(1)
    print(json.dumps(state["release"]))
elif args[0] == "release" and args[1] in ["create", "edit", "upload"]:
    pass
elif args[0] == "api":
    endpoint = args[1]
    if endpoint.endswith("/actions/runs/123/artifacts"):
        print(json.dumps({"artifacts": [{"id": i, "name": name, "size_in_bytes": 100, "expired": False}
            for i, name in [(1, "canopi-linux"), (2, "canopi-release-candidate-manifest")]]}))
    elif endpoint.endswith("/actions/runs/123"):
        print(json.dumps(state["run"]))
    elif "/actions/artifacts/" in endpoint:
        sys.stdout.buffer.write((root / (endpoint.split("/")[-2] + ".zip")).read_bytes())
    elif "/git/matching-refs/tags/" in endpoint:
        print(json.dumps([] if state["tag_sha"] is None else [{"ref": "refs/tags/v1.1.1"}]))
    elif "/commits/v1.1.1" in endpoint:
        print(state["tag_sha"])
    else: raise SystemExit("Unexpected API call: " + repr(args))
else: raise SystemExit("Unexpected command: " + repr(args))
''')
        gh.chmod(0o755)

    def promote(self, tag="v1.1.1"):
        (self.root / "state.json").write_text(json.dumps(self.state))
        payload = b"candidate installer bytes"
        with zipfile.ZipFile(self.root / "1.zip", "w") as archive:
            archive.writestr("canopi_1.1.1.deb", payload)
        with zipfile.ZipFile(self.root / "2.zip", "w") as archive:
            archive.writestr("release-metadata.json", json.dumps(self.state["metadata"]))
            archive.writestr("SHA256SUMS.txt", hashlib.sha256(payload).hexdigest() + "  ./canopi-linux/canopi_1.1.1.deb\n")
        return subprocess.run(["bash", str(self.root / "scripts/promote-release.sh"), "--run-id", "123", "--tag", tag,
                               "--title", "Canopi 1.1.1", "--repo", "example/canopi"],
                              env={**os.environ, "PATH": str(self.root) + os.pathsep + os.environ["PATH"],
                                   "PROMOTION_FIXTURE": str(self.root)}, capture_output=True, text=True)

    def mutations(self):
        return [call for call in map(json.loads, (self.root / "calls.jsonl").read_text().splitlines())
                if call[:1] == ["release"] and call[1] in ["create", "edit", "upload"]]

    def test_new_release_targets_the_commit_that_built_the_candidate(self):
        result = self.promote()
        self.assertEqual(result.returncode, 0, result.stderr)
        create = next(call for call in self.mutations() if call[1] == "create")
        self.assertIn("--target", create)
        self.assertEqual(create[create.index("--target") + 1], SHA)
        self.assertIn("--draft", create)

    def test_tag_must_match_the_candidate_version(self):
        result = self.promote(tag="v1.2.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.mutations(), [])

    def test_only_a_successful_completed_candidate_workflow_can_be_promoted(self):
        for change in [{"conclusion": "failure"}, {"status": "in_progress"}, {"path": ".github/workflows/build.yml"}]:
            with self.subTest(change=change):
                self.state["run"] = {"path": ".github/workflows/release-candidate.yml", "status": "completed", "conclusion": "success", **change}
                result = self.promote()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.mutations(), [])

    def test_published_release_cannot_be_replaced(self):
        self.state["release"] = {"isDraft": False}
        result = self.promote()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.mutations(), [])

    def test_existing_draft_can_be_retried_at_the_same_candidate_commit(self):
        self.state["release"] = {"isDraft": True}
        self.state["tag_sha"] = SHA
        result = self.promote()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([call[1] for call in self.mutations()], ["edit", "upload"])
        edit = self.mutations()[0]
        self.assertEqual(edit[edit.index("--target") + 1], SHA)

    def test_existing_tag_must_resolve_to_the_candidate_commit(self):
        self.state["tag_sha"] = "3" * 40
        result = self.promote()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.mutations(), [])

    def test_candidate_metadata_must_identify_this_repository_and_a_commit(self):
        for change in [{"repository": "other/project"}, {"head_sha": "main"}]:
            with self.subTest(change=change):
                self.state["metadata"].update(repository="example/canopi", head_sha=SHA)
                self.state["metadata"].update(change)
                result = self.promote()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.mutations(), [])


if __name__ == "__main__":
    unittest.main()
