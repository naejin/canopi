import importlib.util
import io
import sqlite3
import stat
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

from scripts import species_catalog_contract as contract


def load_prepare_db_module():
    module_path = Path(__file__).with_name("prepare-db.py")
    spec = importlib.util.spec_from_file_location("prepare_db", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prepare_db = load_prepare_db_module()


class PrepareDbSearchEntryIndexTests(unittest.TestCase):
    def test_search_name_entry_index_uses_selected_language_names_only(self):
        conn = sqlite3.connect(":memory:")
        conn.execute("""
            CREATE TABLE species (
                id TEXT PRIMARY KEY,
                canonical_name TEXT NOT NULL,
                common_name TEXT,
                family TEXT,
                genus TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE species_common_names (
                species_id TEXT NOT NULL,
                language TEXT NOT NULL,
                common_name TEXT NOT NULL,
                is_primary INTEGER NOT NULL DEFAULT 0,
                display_order INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.executemany(
            "INSERT INTO species (id, canonical_name, common_name, family, genus) VALUES (?, ?, ?, ?, ?)",
            [
                ("malus", "Malus domestica", "Apple", "Rosaceae", "Malus"),
                ("melissa", "Melissa officinalis", "Lemon balm", "Lamiaceae", "Melissa"),
            ],
        )
        conn.executemany(
            """
            INSERT INTO species_common_names (
                species_id, language, common_name, is_primary, display_order
            ) VALUES (?, ?, ?, ?, ?)
            """,
            [
                ("malus", "fr", "Pommier", 1, 0),
                ("melissa", "fr", "Mélisse", 1, 0),
                ("melissa", "fr", "Mélisse officinale", 0, 1),
                ("melissa", "en", "Lemon balm", 1, 0),
            ],
        )

        prepare_db.build_best_common_names(conn)
        prepare_db.build_search_name_entry_index(conn)

        french_entries = conn.execute(
            """
            SELECT species_id, common_name, normalized_name, is_display_name, display_order
            FROM species_search_name_entries
            WHERE language = 'fr'
            ORDER BY species_id, common_name
            """
        ).fetchall()
        french_tokens = conn.execute(
            """
            SELECT species_id, token, first_token_position
            FROM species_search_name_entry_tokens
            WHERE language = 'fr'
            ORDER BY species_id, token
            """
        ).fetchall()

        self.assertIn(("melissa", "Mélisse", "melisse", 1, 0), french_entries)
        self.assertIn(("melissa", "Mélisse officinale", "melisse officinale", 0, 1), french_entries)
        self.assertIn(("melissa", "melisse", 0), french_tokens)
        self.assertNotIn(("malus", "Apple", "apple", 1), french_entries)

        canonical_tokens = conn.execute(
            """
            SELECT species_id, token, first_token_position
            FROM species_search_name_entry_tokens
            WHERE language = '__canonical__'
            ORDER BY species_id, token
            """
        ).fetchall()
        self.assertIn(("malus", "domestica", 1), canonical_tokens)


class PrepareDbContractProjectionTests(unittest.TestCase):
    def test_missing_optional_species_columns_keep_their_contracted_affinity(self):
        projection = contract.project(contract.ProjectionTarget.PREPARE_DB)
        connection = sqlite3.connect(":memory:")
        try:
            connection.execute("ATTACH DATABASE ':memory:' AS export_db")
            connection.execute(
                """
                CREATE TABLE export_db.species (
                    id TEXT,
                    slug TEXT,
                    canonical_name TEXT
                )
                """
            )
            connection.execute(
                "INSERT INTO export_db.species VALUES ('one', 'one', 'Species one')"
            )

            prepare_db.create_core_species_table(
                connection,
                projection.species_columns,
                {"id", "slug", "canonical_name"},
            )

            affinities = {
                row[1]: contract.sqlite_affinity(row[2]).value
                for row in connection.execute("PRAGMA table_info(species)")
            }
            self.assertEqual(affinities["height_max_m"], "REAL")
            self.assertIsNone(
                connection.execute("SELECT height_max_m FROM species").fetchone()[0]
            )
        finally:
            connection.close()

    def test_translated_value_optional_columns_come_from_projection(self):
        connection = sqlite3.connect(":memory:")
        try:
            connection.execute("ATTACH DATABASE ':memory:' AS export_db")
            connection.execute(
                "CREATE TABLE export_db.translated_values ("
                "id TEXT NOT NULL, field_name TEXT NOT NULL, value_en TEXT NOT NULL)"
            )
            table = contract.StorageTable(
                name="translated_values",
                required=True,
                columns=(
                    contract.StorageColumn(
                        name="id",
                        declared_type="TEXT",
                        affinity=contract.SQLiteAffinity.TEXT,
                        required=True,
                    ),
                    contract.StorageColumn(
                        name="field_name",
                        declared_type="TEXT",
                        affinity=contract.SQLiteAffinity.TEXT,
                        required=True,
                    ),
                    contract.StorageColumn(
                        name="value_en",
                        declared_type="TEXT",
                        affinity=contract.SQLiteAffinity.TEXT,
                        required=True,
                    ),
                    contract.StorageColumn(
                        name="value_custom",
                        declared_type="REAL",
                        affinity=contract.SQLiteAffinity.REAL,
                        required=False,
                    ),
                ),
            )

            prepare_db.copy_supporting_tables(connection, (table,))
            prepare_db.populate_translations(
                connection,
                (
                    contract.TranslationEntry(
                        field_name="habit",
                        value_en="Tree",
                        localized_values=(("custom", "Custom tree"),),
                    ),
                ),
                table,
            )

            column_types = {
                row[1]: row[2]
                for row in connection.execute("PRAGMA table_info(translated_values)")
            }
            self.assertEqual(column_types["value_custom"], "REAL")
            self.assertEqual(
                connection.execute(
                    "SELECT value_custom FROM translated_values "
                    "WHERE field_name = 'habit' AND value_en = 'Tree'"
                ).fetchone()[0],
                "Custom tree",
            )
        finally:
            connection.close()


class PrepareDbPublicationTests(unittest.TestCase):
    def test_build_reads_export_path_with_quote_through_bound_uri(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            export_dir = root / "quote's-directory"
            export_dir.mkdir()
            export_path = export_dir / "export.db"
            with sqlite3.connect(export_path) as export:
                export.execute("CREATE TABLE species (id TEXT NOT NULL)")
                export.execute("INSERT INTO species VALUES ('one')")
            staging_path = root / "staging.db"
            projection = contract.PrepareDbProjection(
                prepared_schema_version=14,
                minimum_export_schema_version=14,
                species_search_normalization_version=1,
                species_search_normalization_fingerprint="normalization-test",
                species_columns=(
                    contract.StorageColumn(
                        name="id",
                        declared_type="TEXT",
                        affinity=contract.SQLiteAffinity.TEXT,
                        required=True,
                    ),
                ),
                supporting_tables=(),
                prepared_tables=(),
                indexes=(),
                translations=(),
                fingerprint="test",
            )
            export_receipt = mock.Mock(warnings=(), observed_schema_version=14)

            with (
                mock.patch.object(prepare_db, "copy_supporting_tables"),
                mock.patch.object(prepare_db, "build_search_index"),
                mock.patch.object(prepare_db, "build_best_common_names"),
                mock.patch.object(prepare_db, "build_common_name_token_index"),
                mock.patch.object(prepare_db, "build_search_name_entry_index"),
            ):
                prepare_db.build_prepared_database(
                    staging_path,
                    export_path,
                    projection,
                    export_receipt,
                )

            with sqlite3.connect(staging_path) as prepared:
                self.assertEqual(
                    prepared.execute("SELECT id FROM species").fetchall(),
                    [("one",)],
                )

    def test_successful_publication_preserves_existing_file_mode(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            export_path = root / "export.db"
            export_path.write_bytes(b"export")
            output_path = root / "prepared.db"
            output_path.write_bytes(b"previous")
            output_path.chmod(0o444)
            expected_mode = stat.S_IMODE(output_path.stat().st_mode)
            projection = contract.PrepareDbProjection(
                prepared_schema_version=14,
                minimum_export_schema_version=14,
                species_search_normalization_version=1,
                species_search_normalization_fingerprint="normalization-test",
                species_columns=(),
                supporting_tables=(),
                prepared_tables=(),
                indexes=(),
                translations=(),
                fingerprint="test",
            )
            receipt = mock.Mock(warnings=(), observed_schema_version=14)

            def build_database(staging_path, *_args):
                staging_path.write_bytes(b"new prepared database")

            with (
                mock.patch.object(
                    prepare_db.storage_contract,
                    "project",
                    return_value=projection,
                ),
                mock.patch.object(
                    prepare_db.storage_contract,
                    "verify_database",
                    return_value=receipt,
                ),
                mock.patch.object(
                    prepare_db,
                    "build_prepared_database",
                    side_effect=build_database,
                ),
                mock.patch.object(
                    sys,
                    "argv",
                    [
                        "prepare-db.py",
                        "--export-path",
                        str(export_path),
                        "--output-path",
                        str(output_path),
                    ],
                ),
            ):
                prepare_db.main()

            self.assertEqual(output_path.read_bytes(), b"new prepared database")
            self.assertEqual(
                stat.S_IMODE(output_path.stat().st_mode),
                expected_mode,
            )

    def test_equivalent_output_path_is_rejected_without_mutating_export(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            nested = root / "nested"
            nested.mkdir()
            export_path = root / "export.db"
            export_bytes = b"source database bytes must survive"
            export_path.write_bytes(export_bytes)
            equivalent_output_path = nested / ".." / export_path.name

            projection = contract.PrepareDbProjection(
                prepared_schema_version=14,
                minimum_export_schema_version=14,
                species_search_normalization_version=1,
                species_search_normalization_fingerprint="normalization-test",
                species_columns=(),
                supporting_tables=(),
                prepared_tables=(),
                indexes=(),
                translations=(),
                fingerprint="test",
            )
            export_receipt = mock.Mock(warnings=(), observed_schema_version=14)
            stderr = io.StringIO()
            with (
                mock.patch.object(
                    prepare_db.storage_contract,
                    "project",
                    return_value=projection,
                ),
                mock.patch.object(
                    prepare_db.storage_contract,
                    "verify_database",
                    return_value=export_receipt,
                ),
                mock.patch.object(
                    sys,
                    "argv",
                    [
                        "prepare-db.py",
                        "--export-path",
                        str(export_path),
                        "--output-path",
                        str(equivalent_output_path),
                    ],
                ),
                mock.patch("sys.stderr", stderr),
                self.assertRaises(SystemExit),
            ):
                prepare_db.main()

            self.assertEqual(export_path.read_bytes(), export_bytes)
            self.assertIn("must refer to different files", stderr.getvalue())

    def test_failed_prepared_verification_preserves_existing_output(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            export_path = root / "export.db"
            with sqlite3.connect(export_path) as export:
                export.execute("CREATE TABLE species (id TEXT NOT NULL)")
                export.execute("INSERT INTO species VALUES ('one')")

            output_path = root / "prepared.db"
            previous_output = b"previous verified database"
            output_path.write_bytes(previous_output)

            projection = contract.PrepareDbProjection(
                prepared_schema_version=14,
                minimum_export_schema_version=14,
                species_search_normalization_version=1,
                species_search_normalization_fingerprint="normalization-test",
                species_columns=(
                    contract.StorageColumn(
                        name="id",
                        declared_type="TEXT",
                        affinity=contract.SQLiteAffinity.TEXT,
                        required=True,
                    ),
                ),
                supporting_tables=(),
                prepared_tables=(),
                indexes=(),
                translations=(),
                fingerprint="test",
            )
            export_receipt = mock.Mock(warnings=(), observed_schema_version=14)

            def verify_database(profile, database):
                if profile is contract.DatabaseProfile.EXPORT:
                    return export_receipt
                for suffix in ("-wal", "-shm", "-journal"):
                    Path(f"{database}{suffix}").write_bytes(b"staged sidecar")
                raise contract.DatabaseContractError(
                    contract.DatabaseProfile.PREPARED,
                    ["late verification failed"],
                )

            with (
                mock.patch.object(
                    prepare_db.storage_contract,
                    "project",
                    return_value=projection,
                ),
                mock.patch.object(
                    prepare_db.storage_contract,
                    "verify_database",
                    side_effect=verify_database,
                ),
                mock.patch.object(prepare_db, "copy_supporting_tables"),
                mock.patch.object(prepare_db, "build_search_index"),
                mock.patch.object(prepare_db, "build_best_common_names"),
                mock.patch.object(prepare_db, "build_common_name_token_index"),
                mock.patch.object(prepare_db, "build_search_name_entry_index"),
                mock.patch.object(
                    sys,
                    "argv",
                    [
                        "prepare-db.py",
                        "--export-path",
                        str(export_path),
                        "--output-path",
                        str(output_path),
                    ],
                ),
                self.assertRaises(contract.DatabaseContractError),
            ):
                prepare_db.main()

            self.assertEqual(output_path.read_bytes(), previous_output)
            self.assertEqual(
                {path.name for path in root.iterdir()},
                {export_path.name, output_path.name},
            )


if __name__ == "__main__":
    unittest.main()
