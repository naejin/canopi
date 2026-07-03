import importlib.util
import sqlite3
from pathlib import Path
import unittest


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
                source TEXT
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
                species_id, language, common_name, is_primary, source
            ) VALUES (?, ?, ?, ?, ?)
            """,
            [
                ("malus", "fr", "Pommier", 1, "curated"),
                ("melissa", "fr", "Mélisse", 1, "curated"),
                ("melissa", "fr", "Mélisse officinale", 0, "curated"),
                ("melissa", "en", "Lemon balm", 1, "curated"),
            ],
        )

        prepare_db.build_best_common_names(conn)
        prepare_db.build_search_name_entry_index(conn)

        french_entries = conn.execute(
            """
            SELECT species_id, common_name, normalized_name, is_display_name
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

        self.assertIn(("melissa", "Mélisse", "melisse", 1), french_entries)
        self.assertIn(("melissa", "Mélisse officinale", "melisse officinale", 0), french_entries)
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


if __name__ == "__main__":
    unittest.main()
