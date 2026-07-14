import json
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest

from scripts import web_catalog_artifact_contract as contract


REPO_ROOT = Path(__file__).resolve().parent.parent


class WebCatalogArtifactContractTests(unittest.TestCase):
    def test_compiles_the_species_row_projection_for_generation(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)

        self.assertEqual(
            plan.field_names(contract.ArtifactTable.SPECIES),
            (
                "id",
                "slug",
                "canonical_name",
                "common_name",
                "climate_zones",
                "habit",
                "growth_form",
                "life_cycles",
            ),
        )

    def test_compiles_the_required_common_name_locales(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)

        self.assertEqual(
            plan.locales,
            ("en", "fr", "es", "pt", "it", "zh", "de", "ja", "ko", "nl", "ru"),
        )

    def test_compiles_supported_filter_predicates(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)

        self.assertEqual(
            tuple(
                (item.key, item.options_key, item.predicate_kind, item.columns)
                for item in plan.supported_filters
            ),
            (
                ("climate_zones", "climate_zones", "json_array_any", ("climate_zones",)),
                ("habit", "habits", "text_any", ("habit", "growth_form")),
                ("life_cycle", "life_cycles", "json_array_any", ("life_cycles",)),
            ),
        )

    def test_builds_a_complete_manifest_from_dynamic_artifact_metadata(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)

        manifest = plan.build_manifest(
            source=valid_source(),
            assets=valid_assets(plan),
            max_asset_bytes=25 * 1024 * 1024,
        )

        self.assertEqual(manifest["generated_by"], "canopi-web-catalog-v1")
        self.assertEqual(manifest["version"], 1)
        self.assertEqual(manifest["artifact_contract_fingerprint"], plan.fingerprint)
        self.assertEqual(
            manifest["schema"]["species_fields"],
            [
                {"name": "id", "logical_type": "required_text"},
                {"name": "slug", "logical_type": "required_text"},
                {"name": "canonical_name", "logical_type": "required_text"},
                {"name": "common_name", "logical_type": "nullable_text"},
                {"name": "climate_zones", "logical_type": "json_text_array"},
                {"name": "habit", "logical_type": "nullable_text"},
                {"name": "growth_form", "logical_type": "nullable_text"},
                {"name": "life_cycles", "logical_type": "json_text_array"},
            ],
        )
        self.assertEqual(
            manifest["duckdb"]["tables"],
            {
                "web_species": ["species/species-0000.parquet"],
                "web_species_names": [
                    f"names/names-{locale}.parquet" for locale in plan.locales
                ],
                "web_species_images": ["images/images-0000.parquet"],
            },
        )
        self.assertEqual(
            [item["key"] for item in manifest["supported_filters"]],
            ["climate_zones", "habit", "life_cycle"],
        )

    def test_table_plan_admits_exact_logically_typed_rows(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)
        species = next(
            table
            for table in plan.tables
            if table.table is contract.ArtifactTable.SPECIES
        )
        row = {
            "id": "species-1",
            "slug": "species-1",
            "canonical_name": "Species one",
            "common_name": None,
            "climate_zones": ["Temperate"],
            "habit": "Tree",
            "growth_form": None,
            "life_cycles": ["Perennial"],
        }

        self.assertIs(species.admit_row(row, path="species[0]"), row)
        invalid = {**row, "climate_zones": "Temperate", "unexpected": True}
        invalid.pop("id")
        with self.assertRaises(contract.ArtifactRowError) as raised:
            species.admit_row(invalid, path="species[1]")

        self.assertEqual(
            raised.exception.violations,
            (
                "species[1].id: required field is missing",
                "species[1].unexpected: unknown field",
                "species[1].climate_zones: expected an array of strings",
            ),
        )
        with self.assertRaisesRegex(
            contract.ArtifactRowError,
            r"species\[2\]\.id.*expected nonempty text",
        ):
            species.admit_row({**row, "id": "   "}, path="species[2]")

    def test_rejects_duplicate_locales_with_a_stable_contract_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = json.loads(
                (REPO_ROOT / "common-types/web-species-catalog-artifact.json").read_text(
                    encoding="utf-8"
                )
            )
            raw["locales"][1] = "en"
            write_contract(root, raw)

            with self.assertRaisesRegex(Exception, r"locales\[1\].*duplicate locale 'en'"):
                contract.compile_web_catalog_artifact(root=root)

    def test_rejects_filter_columns_missing_from_the_species_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = json.loads(
                (REPO_ROOT / "common-types/web-species-catalog-artifact.json").read_text(
                    encoding="utf-8"
                )
            )
            raw["supported_filters"][0]["predicate"]["columns"] = ["missing_field"]
            write_contract(root, raw)

            with self.assertRaisesRegex(
                Exception,
                r"supported_filters\[0\].predicate.columns\[0\].*missing_field.*Species schema",
            ):
                contract.compile_web_catalog_artifact(root=root)

    def test_manifest_builder_rejects_unsafe_asset_paths(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)
        assets = valid_assets(plan)
        unsafe_species = replace(
            assets.species[0],
            path="species/%2e%2e/outside.parquet",
        )

        with self.assertRaisesRegex(
            Exception,
            r"assets.species\[0\].path.*safe portable relative path",
        ):
            plan.build_manifest(
                source=valid_source(),
                assets=replace(assets, species=(unsafe_species,)),
                max_asset_bytes=25 * 1024 * 1024,
            )

    def test_manifest_builder_requires_one_name_asset_per_locale(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)
        assets = valid_assets(plan)

        with self.assertRaisesRegex(
            Exception,
            r"assets.names.*missing locale 'fr'",
        ):
            plan.build_manifest(
                source=valid_source(),
                assets=replace(
                    assets,
                    names=tuple(
                        item for item in assets.names if item[0] != "fr"
                    ),
                ),
                max_asset_bytes=25 * 1024 * 1024,
            )

    def test_manifest_builder_rejects_invalid_asset_integrity_metadata(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)
        assets = valid_assets(plan)

        with self.assertRaisesRegex(
            Exception,
            r"assets.images\[0\].sha256.*64 lowercase hexadecimal",
        ):
            plan.build_manifest(
                source=valid_source(),
                assets=replace(
                    assets,
                    images=(replace(assets.images[0], sha256="not-a-digest"),),
                ),
                max_asset_bytes=25 * 1024 * 1024,
            )

    def test_manifest_builder_rejects_duplicate_paths_across_asset_groups(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)
        assets = valid_assets(plan)
        names = tuple(
            (
                locale,
                replace(asset, path=assets.species[0].path)
                if locale == "en"
                else asset,
            )
            for locale, asset in assets.names
        )

        with self.assertRaisesRegex(
            Exception,
            r"assets.names\[0\].path.*duplicate asset path",
        ):
            plan.build_manifest(
                source=valid_source(),
                assets=replace(assets, names=names),
                max_asset_bytes=25 * 1024 * 1024,
            )

    def test_manifest_builder_enforces_each_asset_group_layout(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)
        assets = valid_assets(plan)

        with self.assertRaisesRegex(
            Exception,
            r"assets.species\[0\].path.*contracted species asset layout",
        ):
            plan.build_manifest(
                source=valid_source(),
                assets=replace(
                    assets,
                    species=(
                        replace(assets.species[0], path="species/not-a-shard.parquet"),
                    ),
                ),
                max_asset_bytes=25 * 1024 * 1024,
            )

    def test_manifest_builder_rejects_limits_above_the_deployment_contract(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)

        with self.assertRaisesRegex(
            Exception,
            r"cloudflare_pages.max_asset_bytes.*26214400",
        ):
            plan.build_manifest(
                source=valid_source(),
                assets=valid_assets(plan),
                max_asset_bytes=plan.maximum_asset_bytes + 1,
            )

    def test_manifest_builder_rejects_assets_above_the_declared_limit(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)
        assets = valid_assets(plan)

        with self.assertRaisesRegex(
            contract.ManifestBuildError,
            r"assets\.species\[0\]\.bytes.*declared asset limit 10",
        ):
            plan.build_manifest(
                source=valid_source(),
                assets=assets,
                max_asset_bytes=10,
            )

    def test_manifest_builder_requires_well_formed_source_provenance(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)

        with self.assertRaisesRegex(
            Exception,
            r"source.storage_contract_fingerprint.*64 lowercase hexadecimal",
        ):
            plan.build_manifest(
                source=replace(valid_source(), storage_contract_fingerprint="stale"),
                assets=valid_assets(plan),
                max_asset_bytes=plan.maximum_asset_bytes,
            )

    def test_manifest_builder_aggregates_wrong_dynamic_value_types(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)
        assets = valid_assets(plan)

        with self.assertRaises(contract.ManifestBuildError) as raised:
            plan.build_manifest(
                source=contract.ArtifactSource(
                    export_file=7,  # type: ignore[arg-type]
                    export_schema_version=True,
                    storage_contract_fingerprint=None,  # type: ignore[arg-type]
                ),
                assets=replace(
                    assets,
                    species=(
                        contract.ArtifactAsset(
                            path=None,  # type: ignore[arg-type]
                            bytes=True,
                            sha256=None,  # type: ignore[arg-type]
                        ),
                    ),
                ),
                max_asset_bytes=True,
            )

        self.assertRegex(
            "\n".join(raised.exception.violations),
            r"(?s)source\.export_file.*source\.export_schema_version.*"
            r"source\.storage_contract_fingerprint.*cloudflare_pages\.max_asset_bytes.*"
            r"assets\.species\[0\]\.path.*assets\.species\[0\]\.bytes.*"
            r"assets\.species\[0\]\.sha256",
        )

    def test_manifest_builder_requires_nonempty_species_and_image_groups(self):
        plan = contract.compile_web_catalog_artifact(root=REPO_ROOT)
        assets = valid_assets(plan)

        with self.assertRaisesRegex(Exception, r"assets.images.*at least one asset"):
            plan.build_manifest(
                source=valid_source(),
                assets=replace(assets, images=()),
                max_asset_bytes=plan.maximum_asset_bytes,
            )

    def test_aggregates_authored_contract_invariant_violations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = json.loads(
                (REPO_ROOT / "common-types/web-species-catalog-artifact.json").read_text(
                    encoding="utf-8"
                )
            )
            raw["contract_format_version"] = 2
            raw["tables"]["species"]["fields"].append(
                {"name": "id", "logical_type": "binary"}
            )
            raw["supported_filters"][0]["predicate"]["kind"] = "unknown"
            write_contract(root, raw)

            with self.assertRaises(contract.ContractInvariantError) as raised:
                contract.compile_web_catalog_artifact(root=root)

            self.assertEqual(
                raised.exception.violations,
                (
                    "contract_format_version: unsupported version 2",
                    "tables.species.fields[8].name: duplicate field 'id'",
                    "tables.species.fields[8].logical_type: unsupported logical type 'binary'",
                    "supported_filters[0].predicate.kind: unsupported predicate kind 'unknown'",
                ),
            )

    def test_rejects_unsafe_or_ambiguous_authored_layout_facts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = json.loads(
                (REPO_ROOT / "common-types/web-species-catalog-artifact.json").read_text(
                    encoding="utf-8"
                )
            )
            raw["tables"]["species"]["directory"] = "../species"
            raw["tables"]["names"]["duckdb_table"] = "web_species"
            raw["supported_filters"][1]["options_key"] = "climate_zones"
            raw["excluded_detail_fields"][0] = "bad/path"
            write_contract(root, raw)

            with self.assertRaises(contract.ContractInvariantError) as raised:
                contract.compile_web_catalog_artifact(root=root)

            details = "\n".join(raised.exception.violations)
            self.assertRegex(details, r"tables\.species\.directory.*safe path segment")
            self.assertRegex(details, r"tables\.names\.duckdb_table.*duplicate")
            self.assertRegex(details, r"supported_filters\[1\]\.options_key.*duplicate")
            self.assertRegex(details, r"excluded_detail_fields\[0\].*safe field group")

    def test_generated_check_reports_both_missing_shared_admission_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = json.loads(
                (REPO_ROOT / "common-types/web-species-catalog-artifact.json").read_text(
                    encoding="utf-8"
                )
            )
            write_contract(root, raw)

            with self.assertRaisesRegex(
                Exception,
                r"web-catalog-artifact\.mjs.*web-catalog-artifact\.d\.mts",
            ):
                contract.sync_generated(contract.SyncMode.CHECK, root=root)

            self.assertFalse((root / "desktop/web/src/generated").exists())

    def test_generated_write_refreshes_both_files_deterministically(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = json.loads(
                (REPO_ROOT / "common-types/web-species-catalog-artifact.json").read_text(
                    encoding="utf-8"
                )
            )
            write_contract(root, raw)

            paths = contract.sync_generated(contract.SyncMode.WRITE, root=root)
            first = tuple(path.read_text(encoding="utf-8") for path in paths)
            checked_paths = contract.sync_generated(contract.SyncMode.CHECK, root=root)

            self.assertEqual(paths, checked_paths)
            self.assertEqual(
                first,
                tuple(path.read_text(encoding="utf-8") for path in paths),
            )
            self.assertIn("admitWebCatalogManifest", first[0])
            self.assertIn("AdmittedWebCatalog", first[1])
            self.assertIn(
                'export type WebCatalogFilterKey = "climate_zones" | "habit" | "life_cycle";',
                first[1],
            )


def write_contract(root: Path, raw: object) -> None:
    path = root / "common-types/web-species-catalog-artifact.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(raw), encoding="utf-8")


def valid_source() -> contract.ArtifactSource:
    return contract.ArtifactSource(
        export_file="canopi-export-v14.db",
        export_schema_version=14,
        storage_contract_fingerprint="a" * 64,
    )


def valid_assets(
    plan: contract.WebCatalogArtifactPlan,
) -> contract.ArtifactAssets:
    return contract.ArtifactAssets(
        species=(
            contract.ArtifactAsset(
                path="species/species-0000.parquet",
                bytes=20,
                sha256="c" * 64,
            ),
        ),
        names=tuple(
            (
                locale,
                contract.ArtifactAsset(
                    path=f"names/names-{locale}.parquet",
                    bytes=10,
                    sha256="b" * 64,
                ),
            )
            for locale in plan.locales
        ),
        images=(
            contract.ArtifactAsset(
                path="images/images-0000.parquet",
                bytes=30,
                sha256="d" * 64,
            ),
        ),
    )


if __name__ == "__main__":
    unittest.main()
