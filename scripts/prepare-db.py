#!/usr/bin/env python3
"""
Generate canopi-core.db from canopi-data export.

Reads column definitions, indexes, and translations from schema-contract.json.
Validates the export schema version, selects contracted columns (warning on
missing, ignoring unknown), copies supporting tables, creates FTS5 indexes,
and outputs an optimized read-only database.

Usage:
    python3 scripts/prepare-db.py [--export-path PATH] [--output-path PATH]
"""

import argparse
import json
import sqlite3
import sys
import time
import uuid
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent


def load_contract() -> dict:
    """Load and validate the schema contract."""
    contract_path = SCRIPT_DIR / "schema-contract.json"
    if not contract_path.exists():
        print(f"ERROR: Schema contract not found: {contract_path}", file=sys.stderr)
        sys.exit(1)

    with open(contract_path) as f:
        contract = json.load(f)

    required_keys = ["schema_version", "columns", "indexes", "translations"]
    for key in required_keys:
        if key not in contract:
            print(f"ERROR: Schema contract missing required key: {key}", file=sys.stderr)
            sys.exit(1)

    return contract


def get_export_columns(dst: sqlite3.Connection) -> set[str]:
    """Get the set of column names available in the export species table."""
    rows = dst.execute("PRAGMA export_db.table_info(species)").fetchall()
    return {row[1] for row in rows}


def validate_export_version(dst: sqlite3.Connection, min_version: int) -> int | None:
    """Check the export's schema version from its _metadata table. Returns the version or None."""
    exists = dst.execute(
        "SELECT COUNT(*) FROM export_db.sqlite_master WHERE type='table' AND name='_metadata'"
    ).fetchone()[0]
    if not exists:
        print("  WARN: Export has no _metadata table — cannot verify schema version")
        return None

    row = dst.execute(
        "SELECT value FROM export_db._metadata WHERE key = 'schema_version'"
    ).fetchone()
    if not row:
        print("  WARN: Export _metadata has no schema_version entry")
        return None

    version = int(row[0])
    if version < min_version:
        print(
            f"ERROR: Export schema version {version} is below minimum {min_version}. "
            f"Update canopi-data and re-export.",
            file=sys.stderr,
        )
        sys.exit(1)

    return version


def find_latest_export(exports_dir: Path) -> Path:
    """Find the most recent .db export file."""
    db_files = sorted(exports_dir.glob("canopi-export-*.db"), reverse=True)
    if not db_files:
        print(f"ERROR: No canopi-export-*.db files found in {exports_dir}", file=sys.stderr)
        sys.exit(1)
    return db_files[0]


def create_core_species_table(
    dst: sqlite3.Connection,
    contract_columns: list[dict],
    export_columns: set[str],
) -> list[str]:
    """Copy contracted columns from export species table. Returns list of selected column names."""
    selected = []
    missing = []

    for col_def in contract_columns:
        name = col_def["name"]
        if name in export_columns:
            selected.append(name)
        else:
            missing.append(name)
            if col_def.get("required"):
                print(f"ERROR: Required column '{name}' missing from export", file=sys.stderr)
                sys.exit(1)

    if missing:
        print(f"  WARN: {len(missing)} contracted columns missing from export: {', '.join(missing)}")
        print("         These columns will be NULL in the output DB.")

    # Build SELECT with NULL placeholders for missing columns
    select_parts = []
    for col_def in contract_columns:
        name = col_def["name"]
        if name in export_columns:
            select_parts.append(name)
        else:
            select_parts.append(f"NULL AS {name}")

    select_str = ", ".join(select_parts)
    dst.execute(f"CREATE TABLE species AS SELECT {select_str} FROM export_db.species")

    count = dst.execute("SELECT COUNT(*) FROM species").fetchone()[0]
    print(f"  -> {count:,} species rows ({len(selected)}/{len(contract_columns)} columns present)")

    return selected


def copy_supporting_tables(dst: sqlite3.Connection, tables: list[str]):
    """Copy supporting tables verbatim from export."""
    for table in tables:
        exists = dst.execute(
            "SELECT COUNT(*) FROM export_db.sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()[0]
        if not exists:
            print(f"  SKIP: {table} (not in export)")
            continue

        create_sql = dst.execute(
            "SELECT sql FROM export_db.sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()[0]
        dst.execute(create_sql)
        dst.execute(f"INSERT INTO {table} SELECT * FROM export_db.{table}")
        tcount = dst.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  -> {table}: {tcount:,} rows")

    # Ensure all language columns exist on translated_values
    cols = {c[1] for c in dst.execute("PRAGMA table_info(translated_values)").fetchall()}
    for lang_col in ["value_zh", "value_de", "value_ja", "value_ko", "value_nl", "value_ru"]:
        if lang_col not in cols:
            dst.execute(f"ALTER TABLE translated_values ADD COLUMN {lang_col} TEXT")
            print(f"  -> Added {lang_col} column to translated_values")


def build_search_index(dst: sqlite3.Connection):
    """Build unified FTS5 search index."""
    # Step 1: Pre-aggregate common names per species
    dst.execute("""
        CREATE TEMP TABLE _cn_agg AS
        SELECT species_id, GROUP_CONCAT(common_name, ' ') AS all_names
        FROM species_common_names
        GROUP BY species_id
    """)
    print("  -> Common names aggregated")

    # Step 2: Build search text table
    dst.execute("""
        CREATE TABLE species_search_text (
            species_rowid INTEGER PRIMARY KEY,
            all_text TEXT NOT NULL
        )
    """)
    dst.execute("""
        INSERT INTO species_search_text (species_rowid, all_text)
        SELECT s.rowid,
            COALESCE(s.canonical_name, '') || ' ' ||
            COALESCE(s.common_name, '') || ' ' ||
            COALESCE(s.family, '') || ' ' ||
            COALESCE(s.genus, '') || ' ' ||
            COALESCE(s.edible_uses, '') || ' ' ||
            COALESCE(s.medicinal_uses, '') || ' ' ||
            COALESCE(s.other_uses, '') || ' ' ||
            COALESCE(s.conservation_status, '') || ' ' ||
            COALESCE(s.habitats, '') || ' ' ||
            COALESCE(s.physical_characteristics, '') || ' ' ||
            COALESCE(s.special_uses, '') || ' ' ||
            COALESCE(ca.all_names, '')
        FROM species s
        LEFT JOIN _cn_agg ca ON ca.species_id = s.id
    """)
    dst.execute("DROP TABLE _cn_agg")
    sst_count = dst.execute("SELECT COUNT(*) FROM species_search_text").fetchone()[0]
    print(f"  -> {sst_count:,} species search text rows")

    # Step 3: Build FTS5 on the search text
    dst.execute("""
        CREATE VIRTUAL TABLE species_search_fts USING fts5(
            all_text,
            content='species_search_text',
            content_rowid='species_rowid',
            tokenize='unicode61 remove_diacritics 2'
        )
    """)
    dst.execute("INSERT INTO species_search_fts(species_search_fts) VALUES('rebuild')")

    test = dst.execute(
        "SELECT COUNT(*) FROM species_search_fts WHERE species_search_fts MATCH 'pommier'"
    ).fetchone()[0]
    print(f"  -> Unified FTS5 built, 'pommier' matches: {test}")
    dst.commit()


def build_best_common_names(dst: sqlite3.Connection):
    """Build best_common_names lookup table."""
    dst.execute("""
        CREATE TABLE best_common_names (
            species_id TEXT NOT NULL,
            language TEXT NOT NULL,
            common_name TEXT NOT NULL,
            PRIMARY KEY (species_id, language)
        )
    """)
    dst.execute("""
        INSERT INTO best_common_names (species_id, language, common_name)
        SELECT scn.species_id, scn.language,
               MIN(CASE WHEN scn.common_name != s.canonical_name THEN scn.common_name END)
        FROM species_common_names scn
        JOIN species s ON s.id = scn.species_id
        GROUP BY scn.species_id, scn.language
        HAVING MIN(CASE WHEN scn.common_name != s.canonical_name THEN scn.common_name END) IS NOT NULL
    """)
    bcn_count = dst.execute("SELECT COUNT(*) FROM best_common_names").fetchone()[0]
    print(f"  -> {bcn_count:,} best common names across all languages")
    dst.commit()


def filter_orphaned_relationships(dst: sqlite3.Connection):
    """Remove relationships referencing species not in our DB."""
    before = dst.execute("SELECT COUNT(*) FROM species_relationships").fetchone()[0]
    dst.execute("""
        DELETE FROM species_relationships
        WHERE related_species_slug NOT IN (SELECT slug FROM species)
    """)
    after = dst.execute("SELECT COUNT(*) FROM species_relationships").fetchone()[0]
    removed = before - after
    if removed > 0:
        print(f"  -> Removed {removed:,} orphaned relationships ({after:,} remaining)")


def populate_translations(dst: sqlite3.Connection, translations: dict):
    """Populate non-English translations for categorical values from contract."""
    updated = 0
    for field_name, values in translations.items():
        for value_en, lang_map in values.items():
            # Check if row exists
            row = dst.execute(
                "SELECT id FROM translated_values WHERE field_name = ? AND value_en = ?",
                (field_name, value_en),
            ).fetchone()

            if row:
                for lang, translated in lang_map.items():
                    col = f"value_{lang}"
                    dst.execute(
                        f"UPDATE translated_values SET {col} = ? WHERE field_name = ? AND value_en = ?",
                        (translated, field_name, value_en),
                    )
                    updated += 1
            else:
                row_id = str(uuid.uuid4())
                dst.execute(
                    """INSERT INTO translated_values
                       (id, field_name, value_en, value_fr, value_es, value_pt, value_it, value_zh,
                        value_de, value_ja, value_ko, value_nl, value_ru)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        row_id,
                        field_name,
                        value_en,
                        lang_map.get("fr"),
                        lang_map.get("es"),
                        lang_map.get("pt"),
                        lang_map.get("it"),
                        lang_map.get("zh"),
                        lang_map.get("de"),
                        lang_map.get("ja"),
                        lang_map.get("ko"),
                        lang_map.get("nl"),
                        lang_map.get("ru"),
                    ),
                )
                updated += len(lang_map)

    print(f"  -> Updated/inserted {updated} translations")


def create_btree_indexes(dst: sqlite3.Connection, index_defs: dict):
    """Create B-tree indexes from contract definitions."""
    created = 0
    for _table, indexes in index_defs.items():
        for idx in indexes:
            try:
                dst.execute(f"CREATE INDEX {idx['name']} ON {_table}({idx['columns']})")
                created += 1
            except sqlite3.OperationalError as e:
                if "already exists" not in str(e):
                    print(f"  WARN: Index {idx['name']}: {e}")

    print(f"  -> Created {created} B-tree indexes")


def main():
    parser = argparse.ArgumentParser(description="Generate canopi-core.db from export")
    parser.add_argument(
        "--export-path",
        type=Path,
        help="Path to export .db file (default: latest in canopi-data/data/exports/)",
    )
    parser.add_argument(
        "--output-path",
        type=Path,
        default=Path("desktop/resources/canopi-core.db"),
        help="Output path for core DB",
    )
    args = parser.parse_args()

    # Load schema contract
    contract = load_contract()
    print(f"Schema contract: version {contract['schema_version']}, "
          f"{len(contract['columns'])} columns defined")

    # Find export DB
    if args.export_path:
        export_path = args.export_path
    else:
        exports_dir = Path.home() / "projects" / "canopi-data" / "data" / "exports"
        export_path = find_latest_export(exports_dir)

    if not export_path.exists():
        print(f"ERROR: Export DB not found: {export_path}", file=sys.stderr)
        sys.exit(1)

    output_path = args.output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if output_path.exists():
        output_path.unlink()

    print(f"Source: {export_path}")
    print(f"Output: {output_path}")
    print()

    start = time.time()

    # Create output DB — attach source for cross-DB queries
    dst = sqlite3.connect(str(output_path))
    dst.execute("PRAGMA journal_mode=WAL")
    dst.execute("PRAGMA synchronous=OFF")
    dst.execute(f"ATTACH DATABASE 'file:{export_path}?mode=ro' AS export_db")

    # Validate export schema version
    min_version = contract.get("min_export_schema_version", 0)
    if min_version > 0:
        print("[0/9] Validating export schema version...")
        export_version = validate_export_version(dst, min_version)
        if export_version is not None:
            print(f"  -> Export schema version: {export_version}")

    # Discover available export columns
    export_columns = get_export_columns(dst)
    print(f"  -> Export has {len(export_columns)} columns in species table")

    print("[1/9] Creating core species table...")
    create_core_species_table(dst, contract["columns"], export_columns)

    print("[2/9] Copying supporting tables...")
    copy_supporting_tables(dst, contract.get("supporting_tables", []))

    # Detach export DB — no longer needed
    dst.commit()
    dst.execute("DETACH DATABASE export_db")

    print("[3/9] Building unified search index...")
    build_search_index(dst)

    print("[4/9] Building best_common_names lookup table...")
    build_best_common_names(dst)

    print("[5/9] Filtering orphaned relationships...")
    filter_orphaned_relationships(dst)

    print("[6/9] Populating translations...")
    populate_translations(dst, contract.get("translations", {}))
    dst.commit()

    print("[7/9] Creating B-tree indexes...")
    create_btree_indexes(dst, contract.get("indexes", {}))
    dst.commit()

    print("[8/9] Optimizing (ANALYZE + VACUUM)...")
    dst.execute("ANALYZE")
    dst.execute("VACUUM")

    print("[9/9] Finalizing...")
    # Set schema version so Rust backend can detect DB format
    dst.execute(f"PRAGMA user_version = {contract['schema_version']}")
    # Switch to DELETE journal mode — read-only at runtime
    dst.execute("PRAGMA journal_mode=DELETE")
    dst.close()

    elapsed = time.time() - start
    size_mb = output_path.stat().st_size / (1024 * 1024)
    print()
    print(f"Done in {elapsed:.1f}s")
    print(f"Output: {output_path} ({size_mb:.1f} MB)")
    print(f"Schema version: {contract['schema_version']} (PRAGMA user_version)")


if __name__ == "__main__":
    main()
