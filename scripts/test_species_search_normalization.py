import importlib.util
import json
from pathlib import Path
import unittest

from scripts import species_search_normalization as normalization


SCRIPT_DIR = Path(__file__).parent
CONTRACT_PATH = SCRIPT_DIR.parent / "common-types/species-search-normalization.json"


def load_script(filename: str, module_name: str):
    module_path = SCRIPT_DIR / filename
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prepare_db = load_script("prepare-db.py", "prepare_db_normalization_test")
generate_web_catalog = load_script(
    "generate-web-catalog.py",
    "generate_web_catalog_normalization_test",
)


class SpeciesSearchNormalizationTests(unittest.TestCase):
    def test_both_python_builders_match_the_authored_corpus(self):
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

        for case in contract["corpus"]:
            with self.subTest(case=case["name"]):
                for builder in (prepare_db, generate_web_catalog):
                    self.assertEqual(
                        builder.normalize_search_name(case["input"]),
                        case["normalized_text"],
                    )
                    self.assertEqual(
                        [
                            token
                            for token, _position in builder.common_name_tokens(
                                case["input"]
                            )
                        ],
                        case["tokens"],
                    )

    def test_python_builders_share_one_normalization_implementation(self):
        self.assertIs(
            prepare_db.normalize_search_name,
            generate_web_catalog.normalize_search_name,
        )
        self.assertIs(
            prepare_db.common_name_tokens,
            generate_web_catalog.common_name_tokens,
        )

    def test_python_admission_matches_the_authored_corpus(self):
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

        for case in contract["corpus"]:
            with self.subTest(case=case["name"]):
                self.assertEqual(
                    normalization.species_search_admission(case["input"]).value,
                    case["admission"],
                )

        self.assertEqual(
            normalization.CONTRACT.version,
            contract["normalization_version"],
        )
        self.assertRegex(normalization.CONTRACT.fingerprint, r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
