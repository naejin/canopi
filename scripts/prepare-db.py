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
import os
import sqlite3
import stat
import sys
import tempfile
import time
import uuid
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import species_catalog_contract as storage_contract
from scripts.species_search_normalization import (
    common_name_tokens,
    normalize_search_name,
    normalize_search_token,
)


def get_export_columns(dst: sqlite3.Connection) -> set[str]:
    """Get the set of column names available in the export species table."""
    rows = dst.execute("PRAGMA export_db.table_info(species)").fetchall()
    return {row[1] for row in rows}


def find_latest_export(exports_dir: Path) -> Path:
    """Find the most recent .db export file."""
    db_files = sorted(exports_dir.glob("canopi-export-*.db"), reverse=True)
    if not db_files:
        print(f"ERROR: No canopi-export-*.db files found in {exports_dir}", file=sys.stderr)
        sys.exit(1)
    return db_files[0]


def paths_refer_to_same_file(source_path: Path, output_path: Path) -> bool:
    """Return whether two path spellings identify the same filesystem entry."""
    if source_path.resolve() == output_path.resolve():
        return True
    try:
        return source_path.samefile(output_path)
    except OSError:
        return False


def create_core_species_table(
    dst: sqlite3.Connection,
    contract_columns: tuple[storage_contract.StorageColumn, ...],
    export_columns: set[str],
) -> list[str]:
    """Copy contracted columns from export species table. Returns list of selected column names."""
    selected = []
    missing = []

    for col_def in contract_columns:
        name = col_def.name
        if name in export_columns:
            selected.append(name)
        else:
            missing.append(name)
            if col_def.required:
                print(f"ERROR: Required column '{name}' missing from export", file=sys.stderr)
                sys.exit(1)

    if missing:
        print(f"  WARN: {len(missing)} contracted columns missing from export: {', '.join(missing)}")
        print("         These columns will be NULL in the output DB.")

    # Build SELECT with NULL placeholders for missing columns
    select_parts = []
    for col_def in contract_columns:
        name = col_def.name
        if name in export_columns:
            select_parts.append(name)
        else:
            select_parts.append(
                f"CAST(NULL AS {col_def.declared_type}) AS {name}"
            )

    select_str = ", ".join(select_parts)
    dst.execute(f"CREATE TABLE species AS SELECT {select_str} FROM export_db.species")

    count = dst.execute("SELECT COUNT(*) FROM species").fetchone()[0]
    print(f"  -> {count:,} species rows ({len(selected)}/{len(contract_columns)} columns present)")

    return selected


def copy_supporting_tables(
    dst: sqlite3.Connection,
    tables: tuple[storage_contract.StorageTable, ...],
):
    """Copy supporting tables verbatim from export."""
    for table_contract in tables:
        table = table_contract.name
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

    translated_values = next(
        (table for table in tables if table.name == "translated_values"),
        None,
    )
    if translated_values is None:
        return
    columns = {
        row[1] for row in dst.execute("PRAGMA table_info(translated_values)")
    }
    for column in translated_values.columns:
        if column.name in columns:
            continue
        if column.required:
            raise RuntimeError(
                f"Required translated_values column '{column.name}' was not copied"
            )
        dst.execute(
            f"ALTER TABLE translated_values ADD COLUMN "
            f"{column.name} {column.declared_type}"
        )
        print(f"  -> Added {column.name} column to translated_values")


def build_search_index(dst: sqlite3.Connection):
    """Build weighted FTS5 search index with 5 columns for BM25 ranking."""
    dst.create_function(
        "canopi_normalize_species_search",
        1,
        normalize_search_name,
        deterministic=True,
    )
    # Step 1: Pre-aggregate common names per species
    dst.execute("""
        CREATE TEMP TABLE _cn_agg AS
        SELECT species_id, GROUP_CONCAT(common_name, ' ') AS all_names
        FROM species_common_names
        GROUP BY species_id
    """)
    print("  -> Common names aggregated")

    dst.execute("""
        CREATE TEMP TABLE _uses_agg AS
        SELECT species_id, GROUP_CONCAT(use_category || ' ' || COALESCE(use_description, ''), ' ') AS all_uses
        FROM species_uses
        GROUP BY species_id
    """)
    print("  -> Uses aggregated")

    # Step 2: Build search text table with separate weighted columns
    dst.execute("""
        CREATE TABLE species_search_text (
            species_rowid INTEGER PRIMARY KEY,
            canonical_name TEXT NOT NULL DEFAULT '',
            common_names TEXT NOT NULL DEFAULT '',
            family_genus TEXT NOT NULL DEFAULT '',
            uses_text TEXT NOT NULL DEFAULT '',
            other_text TEXT NOT NULL DEFAULT ''
        )
    """)
    dst.execute("""
        INSERT INTO species_search_text (
            species_rowid, canonical_name, common_names, family_genus, uses_text, other_text
        )
        SELECT s.rowid,
            canopi_normalize_species_search(COALESCE(s.canonical_name, '')),
            canopi_normalize_species_search(
                TRIM(COALESCE(s.common_name, '') || ' ' || COALESCE(ca.all_names, ''))
            ),
            canopi_normalize_species_search(
                TRIM(COALESCE(s.family, '') || ' ' || COALESCE(s.genus, ''))
            ),
            canopi_normalize_species_search(COALESCE(ua.all_uses, '')),
            canopi_normalize_species_search(COALESCE(s.conservation_status, ''))
        FROM species s
        LEFT JOIN _cn_agg ca ON ca.species_id = s.id
        LEFT JOIN _uses_agg ua ON ua.species_id = s.id
    """)
    dst.execute("DROP TABLE _cn_agg")
    dst.execute("DROP TABLE _uses_agg")
    sst_count = dst.execute("SELECT COUNT(*) FROM species_search_text").fetchone()[0]
    print(f"  -> {sst_count:,} species search text rows")

    # Step 3: Build FTS5 with weighted columns for BM25 ranking
    # Column order: canonical_name, common_names, family_genus, uses_text, other_text
    # BM25 weights applied at query time: (10, 8, 5, 1, 1)
    dst.execute("""
        CREATE VIRTUAL TABLE species_search_fts USING fts5(
            canonical_name,
            common_names,
            family_genus,
            uses_text,
            other_text,
            content='species_search_text',
            content_rowid='species_rowid',
            tokenize="unicode61 remove_diacritics 2 tokenchars '_'"
        )
    """)
    dst.execute("INSERT INTO species_search_fts(species_search_fts) VALUES('rebuild')")

    test = dst.execute(
        "SELECT COUNT(*) FROM species_search_fts WHERE species_search_fts MATCH 'pommier'"
    ).fetchone()[0]
    print(f"  -> Weighted FTS5 built (5 columns), 'pommier' matches: {test}")
    dst.commit()


def write_species_search_identity(
    dst: sqlite3.Connection,
    contract: storage_contract.PrepareDbProjection,
) -> None:
    """Bind prepared search storage to the exact authored storage semantics."""
    dst.execute(
        """
        CREATE TABLE species_search_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    dst.executemany(
        "INSERT INTO species_search_metadata (key, value) VALUES (?, ?)",
        (
            ("schema_version", str(contract.prepared_schema_version)),
            ("storage_contract_fingerprint", contract.fingerprint),
            (
                "normalization_version",
                str(contract.species_search_normalization_version),
            ),
            (
                "normalization_fingerprint",
                contract.species_search_normalization_fingerprint,
            ),
        ),
    )


def build_best_common_names(dst: sqlite3.Connection):
    """Build best_common_names lookup table.

    Prefers the export-provided display order, falling back to primary and shortest
    non-canonical names only as deterministic tie-breakers.
    """
    dst.execute("""
        CREATE TABLE best_common_names (
            species_id TEXT NOT NULL,
            language TEXT NOT NULL,
            common_name TEXT NOT NULL,
            PRIMARY KEY (species_id, language)
        )
    """)
    # Pick the top export-ranked name that isn't the canonical name.
    dst.execute("""
        INSERT INTO best_common_names (species_id, language, common_name)
        SELECT species_id, language, common_name FROM (
            SELECT scn.species_id, scn.language, scn.common_name,
                   ROW_NUMBER() OVER (
                       PARTITION BY scn.species_id, scn.language
                       ORDER BY scn.display_order ASC,
                                scn.is_primary DESC,
                                LENGTH(scn.common_name) ASC,
                                scn.common_name ASC
                   ) AS rn
            FROM species_common_names scn
            JOIN species s ON s.id = scn.species_id
            WHERE scn.common_name != s.canonical_name
        )
        WHERE rn = 1
    """)
    bcn_count = dst.execute("SELECT COUNT(*) FROM best_common_names").fetchone()[0]
    print(f"  -> {bcn_count:,} best common names across all languages")
    dst.commit()


def build_common_name_token_index(dst: sqlite3.Connection):
    """Build indexed active-locale Common Name tokens for relevance ranking."""
    dst.execute("""
        CREATE TABLE species_search_common_name_tokens (
            species_id TEXT NOT NULL,
            language TEXT NOT NULL,
            token TEXT NOT NULL,
            first_token_position INTEGER NOT NULL,
            PRIMARY KEY (species_id, language, token)
        )
    """)

    token_positions: dict[tuple[str, str, str], int] = {}
    rows = dst.execute("""
        SELECT scn.species_id, scn.language, scn.common_name
        FROM species_common_names scn
        JOIN species s ON s.id = scn.species_id
        WHERE scn.common_name != s.canonical_name
    """)
    for species_id, language, common_name in rows:
        for token, position in common_name_tokens(common_name or ""):
            key = (species_id, language, token)
            previous_position = token_positions.get(key)
            if previous_position is None or position < previous_position:
                token_positions[key] = position

    dst.executemany(
        """
        INSERT INTO species_search_common_name_tokens (
            species_id, language, token, first_token_position
        ) VALUES (?, ?, ?, ?)
        """,
        (
            (species_id, language, token, position)
            for (species_id, language, token), position in token_positions.items()
        ),
    )
    print(f"  -> {len(token_positions):,} common name token rows")
    dst.commit()


def build_search_name_entry_index(dst: sqlite3.Connection):
    """Build pre-ranked name entries for candidate-first active search."""
    dst.execute("""
        CREATE TABLE species_search_name_entries (
            entry_id INTEGER PRIMARY KEY,
            species_id TEXT NOT NULL,
            language TEXT NOT NULL,
            entry_kind TEXT NOT NULL,
            common_name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            is_display_name INTEGER NOT NULL DEFAULT 0,
            is_primary INTEGER NOT NULL DEFAULT 0,
            display_order INTEGER NOT NULL DEFAULT 0,
            name_length INTEGER NOT NULL,
            UNIQUE (species_id, language, entry_kind, common_name)
        )
    """)
    dst.execute("""
        CREATE TABLE species_search_name_entry_tokens (
            entry_id INTEGER NOT NULL,
            species_id TEXT NOT NULL,
            language TEXT NOT NULL,
            token TEXT NOT NULL,
            first_token_position INTEGER NOT NULL,
            PRIMARY KEY (entry_id, token)
        )
    """)

    display_names = {
        (species_id, language, common_name)
        for species_id, language, common_name in dst.execute("""
            SELECT species_id, language, common_name
            FROM best_common_names
        """)
    }
    display_name_keys = {
        (species_id, language) for species_id, language, _common_name in display_names
    }

    entries: dict[tuple[str, str, str, str], dict[str, int | str]] = {}

    def add_entry(
        species_id: str,
        language: str,
        entry_kind: str,
        common_name: str,
        is_display_name: int,
        is_primary: int,
        display_order: int,
    ) -> None:
        normalized_name = normalize_search_name(common_name or "")
        if not normalized_name:
            return

        key = (species_id, language, entry_kind, common_name)
        existing = entries.get(key)
        if existing is None:
            entries[key] = {
                "normalized_name": normalized_name,
                "is_display_name": is_display_name,
                "is_primary": is_primary,
                "display_order": display_order,
                "name_length": len(common_name),
            }
            return

        existing["is_display_name"] = max(int(existing["is_display_name"]), is_display_name)
        existing["is_primary"] = max(int(existing["is_primary"]), is_primary)
        existing["display_order"] = min(int(existing["display_order"]), display_order)

    rows = dst.execute("""
        SELECT scn.species_id,
               scn.language,
               scn.common_name,
               scn.is_primary,
               scn.display_order
        FROM species_common_names scn
        JOIN species s ON s.id = scn.species_id
        WHERE scn.common_name != s.canonical_name
    """)
    for species_id, language, common_name, is_primary, display_order in rows:
        add_entry(
            species_id,
            language,
            "common_name",
            common_name,
            1 if (species_id, language, common_name) in display_names else 0,
            int(is_primary or 0),
            int(display_order or 0),
        )

    rows = dst.execute("""
        SELECT s.id, s.common_name
        FROM species s
        WHERE s.common_name IS NOT NULL
          AND s.common_name != ''
          AND s.common_name != s.canonical_name
    """)
    for species_id, common_name in rows:
        add_entry(
            species_id,
            "en",
            "common_name",
            common_name,
            0 if (species_id, "en") in display_name_keys else 1,
            0,
            0 if (species_id, "en") not in display_name_keys else 1_000_000,
        )

    rows = dst.execute("""
        SELECT id, canonical_name, family, genus
        FROM species
    """)
    for species_id, canonical_name, family, genus in rows:
        add_entry(
            species_id,
            "__canonical__",
            "canonical",
            canonical_name,
            0,
            0,
            0,
        )
        if family:
            add_entry(species_id, "__taxonomy__", "taxonomy", family, 0, 0, 0)
        if genus and genus != family:
            add_entry(species_id, "__taxonomy__", "taxonomy", genus, 0, 0, 0)

    entry_rows = [
        (
            species_id,
            language,
            entry_kind,
            common_name,
            str(entry["normalized_name"]),
            int(entry["is_display_name"]),
            int(entry["is_primary"]),
            int(entry["display_order"]),
            int(entry["name_length"]),
        )
        for (species_id, language, entry_kind, common_name), entry in sorted(entries.items())
    ]
    dst.executemany(
        """
        INSERT INTO species_search_name_entries (
            species_id, language, entry_kind, common_name, normalized_name,
            is_display_name, is_primary, display_order, name_length
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        entry_rows,
    )

    token_rows: list[tuple[int, str, str, str, int]] = []
    rows = dst.execute("""
        SELECT entry_id, species_id, language, common_name
        FROM species_search_name_entries
    """)
    for entry_id, species_id, language, common_name in rows:
        positions: dict[str, int] = {}
        for token, position in common_name_tokens(common_name or ""):
            previous_position = positions.get(token)
            if previous_position is None or position < previous_position:
                positions[token] = position
        for token, position in sorted(positions.items()):
            token_rows.append((entry_id, species_id, language, token, position))

    dst.executemany(
        """
        INSERT INTO species_search_name_entry_tokens (
            entry_id, species_id, language, token, first_token_position
        ) VALUES (?, ?, ?, ?, ?)
        """,
        token_rows,
    )
    print(f"  -> {len(entry_rows):,} search name entries, {len(token_rows):,} entry token rows")
    dst.commit()

def populate_translations(
    dst: sqlite3.Connection,
    translations: tuple[storage_contract.TranslationEntry, ...],
    translated_values: storage_contract.StorageTable | None,
):
    """Populate non-English translations for categorical values from contract."""
    if translated_values is None:
        if translations:
            raise RuntimeError("translated_values storage contract is missing")
        print("  -> Updated/inserted 0 translations")
        return
    localized_columns = tuple(
        (column.name.removeprefix("value_"), column.name)
        for column in translated_values.columns
        if column.name.startswith("value_") and column.name != "value_en"
    )
    localized_column_by_locale = dict(localized_columns)
    updated = 0
    for entry in translations:
        lang_map = dict(entry.localized_values)
        row = dst.execute(
            "SELECT id FROM translated_values WHERE field_name = ? AND value_en = ?",
            (entry.field_name, entry.value_en),
        ).fetchone()

        if row:
            for lang, translated in entry.localized_values:
                col = localized_column_by_locale[lang]
                dst.execute(
                    f"UPDATE translated_values SET {col} = ? WHERE field_name = ? AND value_en = ?",
                    (translated, entry.field_name, entry.value_en),
                )
                updated += 1
        else:
            row_id = str(uuid.uuid4())
            insert_columns = (
                "id",
                "field_name",
                "value_en",
                *(column for _locale, column in localized_columns),
            )
            placeholders = ", ".join("?" for _column in insert_columns)
            dst.execute(
                f"INSERT INTO translated_values ({', '.join(insert_columns)}) "
                f"VALUES ({placeholders})",
                (
                    row_id,
                    entry.field_name,
                    entry.value_en,
                    *(lang_map.get(locale) for locale, _column in localized_columns),
                ),
            )
            updated += len(lang_map)

    print(f"  -> Updated/inserted {updated} translations")


def create_btree_indexes(
    dst: sqlite3.Connection,
    index_defs: tuple[storage_contract.StorageIndex, ...],
):
    """Create B-tree indexes from contract definitions."""
    created = 0
    for index in index_defs:
        try:
            columns = ", ".join(index.columns)
            dst.execute(f"CREATE INDEX {index.name} ON {index.table}({columns})")
            created += 1
        except sqlite3.OperationalError as error:
            if "already exists" not in str(error):
                print(f"  WARN: Index {index.name}: {error}")

    print(f"  -> Created {created} B-tree indexes")


def create_staging_database_path(output_path: Path) -> tuple[Path, int]:
    """Reserve a sibling path for a database that is not ready to publish."""
    existing_mode = (
        stat.S_IMODE(output_path.stat().st_mode)
        if output_path.is_file()
        else None
    )
    with tempfile.NamedTemporaryFile(
        dir=output_path.parent,
        prefix=".canopi-prepare-",
        suffix=".db",
        delete=False,
    ) as handle:
        staging_path = Path(handle.name)
    if existing_mode is None:
        current_umask = os.umask(0)
        os.umask(current_umask)
        existing_mode = 0o666 & ~current_umask
    staging_path.chmod(existing_mode | 0o600)
    return staging_path, existing_mode


def cleanup_staging_database(staging_path: Path) -> None:
    """Remove a staged database and any SQLite sidecars left by a failed build."""
    for path in (
        staging_path,
        Path(f"{staging_path}-wal"),
        Path(f"{staging_path}-shm"),
        Path(f"{staging_path}-journal"),
    ):
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def build_prepared_database(
    staging_path: Path,
    export_path: Path,
    contract: storage_contract.PrepareDbProjection,
    export_receipt: storage_contract.VerificationReceipt,
) -> None:
    """Build a complete prepared database at an unpublished staging path."""
    dst = sqlite3.connect(str(staging_path))
    try:
        dst.execute("PRAGMA journal_mode=WAL")
        dst.execute("PRAGMA synchronous=OFF")
        export_uri = f"{export_path.resolve().as_uri()}?mode=ro"
        dst.execute("ATTACH DATABASE ? AS export_db", (export_uri,))

        print("[0/10] Validated export storage contract")
        print(f"  -> Export schema version: {export_receipt.observed_schema_version}")

        # Discover available export columns
        export_columns = get_export_columns(dst)
        print(f"  -> Export has {len(export_columns)} columns in species table")

        print("[1/10] Creating core species table...")
        create_core_species_table(dst, contract.species_columns, export_columns)

        print("[2/10] Copying supporting tables...")
        copy_supporting_tables(dst, contract.supporting_tables)

        # Detach export DB — no longer needed
        dst.commit()
        dst.execute("DETACH DATABASE export_db")

        print("[3/10] Building unified search index...")
        build_search_index(dst)

        print("[4/10] Building best_common_names lookup table...")
        build_best_common_names(dst)

        print("[5/10] Building common name token index...")
        build_common_name_token_index(dst)

        print("[6/10] Building search name entry index...")
        build_search_name_entry_index(dst)

        print("[7/10] Populating translations...")
        write_species_search_identity(dst, contract)
        translated_values = next(
            (
                table
                for table in contract.supporting_tables
                if table.name == "translated_values"
            ),
            None,
        )
        populate_translations(dst, contract.translations, translated_values)
        dst.commit()

        print("[8/10] Creating B-tree indexes...")
        create_btree_indexes(dst, contract.indexes)
        dst.commit()

        print("[9/10] Optimizing (ANALYZE + VACUUM)...")
        dst.execute("ANALYZE")
        dst.execute("VACUUM")

        print("[10/10] Finalizing...")
        # Set schema version so Rust backend can detect DB format
        dst.execute(f"PRAGMA user_version = {contract.prepared_schema_version}")
        # Switch to DELETE journal mode — read-only at runtime
        dst.execute("PRAGMA journal_mode=DELETE")
    finally:
        dst.close()


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
    contract = storage_contract.project(storage_contract.ProjectionTarget.PREPARE_DB)
    assert isinstance(contract, storage_contract.PrepareDbProjection)
    print(
        f"Schema contract: version {contract.prepared_schema_version}, "
        f"{len(contract.species_columns)} columns defined"
    )

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
    if paths_refer_to_same_file(export_path, output_path):
        parser.error("--export-path and --output-path must refer to different files")

    export_receipt = storage_contract.verify_database(
        storage_contract.DatabaseProfile.EXPORT,
        export_path,
    )
    for warning in export_receipt.warnings:
        print(f"  WARN: {warning}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Source: {export_path}")
    print(f"Output: {output_path}")
    print()

    start = time.time()
    staging_path, publication_mode = create_staging_database_path(output_path)
    try:
        build_prepared_database(staging_path, export_path, contract, export_receipt)
        prepared_receipt = storage_contract.verify_database(
            storage_contract.DatabaseProfile.PREPARED,
            staging_path,
        )
        for warning in prepared_receipt.warnings:
            print(f"  WARN: {warning}")
        staging_path.chmod(publication_mode)
        staging_path.replace(output_path)
    finally:
        cleanup_staging_database(staging_path)

    elapsed = time.time() - start
    size_mb = output_path.stat().st_size / (1024 * 1024)
    print()
    print(f"Done in {elapsed:.1f}s")
    print(f"Output: {output_path} ({size_mb:.1f} MB)")
    print(
        f"Schema version: {contract.prepared_schema_version} (PRAGMA user_version)"
    )


if __name__ == "__main__":
    try:
        main()
    except storage_contract.SpeciesCatalogContractError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from error
