#!/usr/bin/env python3
"""End-to-end tests for the normal qualification CLI.

These drive the real commands — ``measure.py gate-assemble`` then
``measure.py gate`` — against small raw reports in a fresh temporary root. No
assembler or gate is mocked, so the exit status and the emitted explanation are
the behaviour actually being proved.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

MEASURE = HARNESS / "measure.py"

import test_qualification_gate as fixtures  # noqa: E402

gate = fixtures.gate


class CliIntegration(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory(prefix="qual-cli-")
        self.root = Path(self._temp.name)
        self.reports_dir = self.root / "reports"
        self.reports_dir.mkdir()

    def tearDown(self) -> None:
        self._temp.cleanup()

    def write_reports(self) -> dict[str, Path]:
        reports = fixtures.passing_reports(self.reports_dir)
        # The CLI discovers reports by filename; mirror that layout.
        renamed: dict[str, Path] = {}
        mapping = {
            "q1": "q1-artifacts.json", "q2": "q2-numeric.json",
            "q3prepare": "q3-prepare.json", "q3members": "q3-members.json",
            "q4slope": "q4-slope.json", "q4crs": "q4-crs.json",
            "q5lifecycle": "q5-lifecycle.json", "q6resources": "q6-resources.json",
            "trace": "q6-trace.json",
        }
        for role, name in mapping.items():
            source = reports[role]
            target = self.reports_dir / name
            if source != target:
                target.write_text(source.read_text())
            renamed[role] = target
        return renamed

    def write_manifest(self) -> Path:
        path = self.root / "fixture-manifest.json"
        path.write_text(json.dumps({
            "declared": [{"name": "derived_cog", "sha256": "a" * 64}],
            "requiredFixtures": {},
            "subsetAllowed": {},
        }))
        return path

    def run_cli(self, *args: str) -> subprocess.CompletedProcess:
        environment = dict(os.environ)
        environment["PYTHONPATH"] = str(HARNESS)
        return subprocess.run([sys.executable, str(MEASURE), *args],
                              capture_output=True, text=True, env=environment, timeout=300)

    def evaluate(self, manifest: Path | None) -> tuple[subprocess.CompletedProcess, dict]:
        bundle = self.root / "bundle.json"
        decision = self.root / "decision.json"
        args = ["gate-assemble", "--reports", str(self.reports_dir),
                "--host", "chromium", "--out", str(bundle)]
        if manifest is not None:
            args += ["--fixture-manifest", str(manifest)]
        assemble = self.run_cli(*args)
        self.assertEqual(assemble.returncode, 0,
                         f"gate-assemble failed: {assemble.stderr}")
        verdict = self.run_cli("gate", "--bundle", str(bundle),
                               "--out", str(decision))
        payload = json.loads(decision.read_text())
        return verdict, payload

    def test_manifest_is_loaded_and_recorded(self) -> None:
        self.write_reports()
        manifest = self.write_manifest()
        assemble = self.run_cli(
            "gate-assemble", "--reports", str(self.reports_dir),
            "--host", "chromium", "--fixture-manifest", str(manifest),
            "--out", str(self.root / "bundle.json"))
        self.assertEqual(assemble.returncode, 0, assemble.stderr)
        summary = json.loads(assemble.stdout)
        self.assertEqual(summary["fixtureManifest"], str(manifest))
        self.assertIsNone(summary["fixtureManifestProblem"])

    def test_missing_manifest_is_reported_and_never_passes(self) -> None:
        """Supplying no manifest cannot establish fixture correspondence."""
        self.write_reports()
        _, payload = self.evaluate(None)
        self.assertNotEqual(payload["result"], "pass")
        local = next(r for r in payload["requirements"]
                     if r["requirementId"] == "Q-LOCAL-1")
        self.assertEqual(local["verdict"], "inconclusive")
        self.assertIn("manifest", " ".join(local["reasons"]).lower())

    def test_unexpected_fixture_fails_with_a_nonzero_exit(self) -> None:
        reports = self.write_reports()
        payload = json.loads(reports["q2"].read_text())
        payload["identity"]["fixtures"] = [{"name": "unexpected_fixture",
                                            "sha256": "f" * 64}]
        payload["fixturesTested"] = 1
        reports["q2"].write_text(json.dumps(payload))
        verdict, decision = self.evaluate(self.write_manifest())
        self.assertNotEqual(verdict.returncode, 0)
        local = next(r for r in decision["requirements"]
                     if r["requirementId"] == "Q-LOCAL-1")
        self.assertEqual(local["verdict"], "fail")
        self.assertIn("unexpected_fixture", " ".join(local["reasons"]))

    def test_emitted_explanation_names_the_blocking_requirements(self) -> None:
        self.write_reports()
        verdict, payload = self.evaluate(self.write_manifest())
        self.assertNotEqual(verdict.returncode, 0)
        self.assertTrue(payload["blockingRequirementIds"])
        # The CLI prints the decision, so the explanation reaches an operator.
        self.assertIn("requirements", verdict.stdout)

    def test_synthetic_bundles_cannot_reach_a_qualification_pass(self) -> None:
        """A bundle marked synthetic must never publish a production pass."""
        self.write_reports()
        manifest = self.write_manifest()
        bundle = self.root / "bundle.json"
        self.run_cli("gate-assemble", "--reports", str(self.reports_dir),
                     "--host", "chromium", "--fixture-manifest", str(manifest),
                     "--out", str(bundle))
        payload = json.loads(bundle.read_text())
        # The marker name the evaluator defines, not a lookalike.
        payload[gate.SYNTHETIC_MARKER] = True
        bundle.write_text(json.dumps(payload))
        verdict = self.run_cli("gate", "--bundle", str(bundle),
                               "--out", str(self.root / "d.json"))
        decision = json.loads((self.root / "d.json").read_text())
        self.assertTrue(decision["synthetic"])
        self.assertNotEqual(decision["result"], "pass")


class CliDeclarationValidation(unittest.TestCase):
    """The CLI must reject a defective declaration, not just note it.

    R5-01 requires one validated declaration path. These drive the real command,
    so they prove the CLI cannot be weaker than the programmatic assembler: a
    declaration the assembler rejects must stop the CLI with a diagnostic and a
    nonzero result rather than being downgraded to a printed note.
    """

    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory(prefix="qual-cli-decl-")
        self.root = Path(self._temp.name)
        self.reports_dir = self.root / "reports"
        self.reports_dir.mkdir()
        writer = CliIntegration(methodName="runTest")
        writer.root = self.root
        writer.reports_dir = self.reports_dir
        writer.write_reports()

    def tearDown(self) -> None:
        self._temp.cleanup()

    def run_cli(self, *args: str) -> subprocess.CompletedProcess:
        environment = dict(os.environ)
        environment["PYTHONPATH"] = str(HARNESS)
        return subprocess.run([sys.executable, str(MEASURE), *args],
                              capture_output=True, text=True, env=environment,
                              timeout=300)

    def assemble_with(self, manifest_text: str) -> subprocess.CompletedProcess:
        manifest = self.root / "fixture-manifest.json"
        manifest.write_text(manifest_text)
        return self.run_cli(
            "gate-assemble", "--reports", str(self.reports_dir),
            "--host", "chromium", "--fixture-manifest", str(manifest),
            "--out", str(self.root / "bundle.json"))

    def test_duplicate_json_key_is_rejected_with_a_nonzero_result(self) -> None:
        """A repeated key is hidden by normal decoding, so it must be read first."""
        text = ('{"declared": [{"name": "derived_cog", "sha256": "' + "a" * 64 + '"}],'
                ' "requiredFixtures": {}, "declared": '
                '[{"name": "other_cog", "sha256": "' + "b" * 64 + '"}]}')
        assemble = self.assemble_with(text)
        self.assertNotEqual(
            assemble.returncode, 0,
            f"a repeated declaration key was accepted: {assemble.stdout}")
        diagnostic = assemble.stdout + assemble.stderr
        self.assertIn("declared", diagnostic)
        # An evaluator-input failure, not an unhandled traceback.
        self.assertNotIn("Traceback", diagnostic)

    def test_malformed_member_type_is_rejected_with_a_nonzero_result(self) -> None:
        assemble = self.assemble_with(json.dumps({
            "declared": ["derived_cog"], "requiredFixtures": {}}))
        self.assertNotEqual(assemble.returncode, 0, assemble.stdout)
        diagnostic = assemble.stdout + assemble.stderr
        self.assertIn("not an object", diagnostic.lower())
        self.assertNotIn("Traceback", diagnostic)

    def test_required_reference_to_an_undeclared_fixture_is_rejected(self) -> None:
        assemble = self.assemble_with(json.dumps({
            "declared": [{"name": "derived_cog", "sha256": "a" * 64}],
            "requiredFixtures": {"q2": ["ghost"]}}))
        self.assertNotEqual(assemble.returncode, 0, assemble.stdout)
        diagnostic = assemble.stdout + assemble.stderr
        self.assertIn("ghost", diagnostic)
        self.assertNotIn("Traceback", diagnostic)

    def test_rejected_declaration_is_recorded_in_a_diagnostic_artifact(self) -> None:
        """The refusal must be auditable after the fact, not only on stderr."""
        self.assemble_with(json.dumps({
            "declared": [{"name": "derived_cog", "sha256": "a" * 64},
                         {"name": "derived_cog", "sha256": "a" * 64}],
            "requiredFixtures": {}}))
        bundle = self.root / "bundle.json"
        self.assertTrue(bundle.is_file(), "no diagnostic artifact was written")
        payload = json.loads(bundle.read_text())
        declared = payload["declarations"]["fixtureManifest"]
        self.assertEqual(declared["verdict"], "fail")
        self.assertIn("derived_cog", " ".join(declared["problems"]))
        # The declaration is rejected, so it must not be published as usable.
        self.assertFalse(declared["usable"])

    def test_usable_declaration_still_assembles(self) -> None:
        """Control: the same command with a valid declaration succeeds."""
        assemble = self.assemble_with(json.dumps({
            "declared": [{"name": "derived_cog", "sha256": "a" * 64}],
            "requiredFixtures": {}}))
        self.assertEqual(assemble.returncode, 0, assemble.stderr)

    def test_declared_member_without_a_hash_is_a_gap_not_a_pass(self) -> None:
        """The acceptance table's first R5-01 row: removing a hash is a gap."""
        assemble = self.assemble_with(json.dumps({
            "declared": [{"name": "derived_cog"}], "requiredFixtures": {}}))
        self.assertEqual(assemble.returncode, 0, assemble.stderr)
        payload = json.loads((self.root / "bundle.json").read_text())
        declared = payload["declarations"]["fixtureManifest"]
        self.assertEqual(declared["verdict"], "inconclusive")
        self.assertIn("hash", " ".join(declared["problems"]).lower())
        # A gap is not usable, but it is also not an evaluator-input failure.
        self.assertFalse(declared["usable"])

    def test_duplicate_pin_key_is_rejected_rather_than_last_write_winning(self) -> None:
        """The same bypass as a duplicate fixture: a dict keeps the last entry."""
        candidates = self.root / "candidates.json"
        candidates.write_text(
            '{"pinnedSourceCommits": {"whitebox-wasm": "aaaaaaa",'
            ' "whitebox-wasm": "bbbbbbb"}}')
        assemble = self.run_cli(
            "gate-assemble", "--reports", str(self.reports_dir),
            "--host", "chromium", "--candidates", str(candidates),
            "--fixture-manifest", str(self.write_valid_manifest()),
            "--out", str(self.root / "bundle.json"))
        self.assertNotEqual(assemble.returncode, 0, assemble.stdout)
        diagnostic = assemble.stdout + assemble.stderr
        self.assertIn("whitebox-wasm", diagnostic)
        self.assertNotIn("Traceback", diagnostic)

    def write_valid_manifest(self) -> str:
        manifest = self.root / "fixture-manifest.json"
        manifest.write_text(json.dumps({
            "declared": [{"name": "derived_cog", "sha256": "a" * 64}],
            "requiredFixtures": {}}))
        return str(manifest)


if __name__ == "__main__":
    unittest.main(verbosity=2)
