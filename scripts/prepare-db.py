#!/usr/bin/env python3
"""
Generate canopi-core.db from canopi-data export.

Selects ~45 essential columns, copies supporting tables,
creates FTS5 indexes, B-tree indexes, populates translations,
and outputs an optimized read-only database.

Usage:
    python3 scripts/prepare-db.py [--export-path PATH] [--output-path PATH]
"""

import argparse
import sqlite3
import sys
import time
from pathlib import Path

# --- Column Selection ---

CORE_COLUMNS = [
    # Identity
    "id", "slug", "canonical_name", "common_name", "family", "genus",
    # Dimensions
    "height_min_m", "height_max_m", "width_max_m",
    # Climate
    "hardiness_zone_min", "hardiness_zone_max", "soil_ph_min", "soil_ph_max",
    "drought_tolerance", "frost_tender",
    # Growth
    "growth_rate", "life_cycle", "lifespan", "habit", "deciduous_evergreen",
    "active_growth_period", "bloom_period", "flower_color",
    # Tolerances
    "tolerates_full_sun", "tolerates_semi_shade", "tolerates_full_shade",
    "well_drained", "heavy_clay",
    "tolerates_acid", "tolerates_alkaline", "tolerates_saline",
    "tolerates_wind", "tolerates_pollution", "tolerates_nutritionally_poor",
    # Nitrogen & ecology
    "nitrogen_fixation", "stratum", "succession_stage",
    "stratum_confidence", "succession_confidence",
    # Ratings
    "edibility_rating", "medicinal_rating", "other_uses_rating",
    # Text fields (needed for FTS5 and detail view)
    "edible_uses", "medicinal_uses", "other_uses",
    "summary", "cultivation_notes", "propagation_notes", "known_hazards",
    "carbon_farming",
    # Misc useful fields
    "native_range", "toxicity", "attracts_wildlife", "scented",
    "data_quality_tier",
]

# --- Translation Data ---
# Hardcoded translations for the most user-facing categorical values.
# Covers growth_rate, life_cycle, nitrogen_fixation, deciduous_evergreen,
# drought_tolerance, and a few more.

TRANSLATIONS = {
    # growth_rate
    ("growth_rate", "Fast"): {"fr": "Rapide", "es": "Rapido", "pt": "Rapido", "it": "Rapido"},
    ("growth_rate", "Medium"): {"fr": "Moyen", "es": "Medio", "pt": "Medio", "it": "Medio"},
    ("growth_rate", "Slow"): {"fr": "Lent", "es": "Lento", "pt": "Lento", "it": "Lento"},
    # life_cycle
    ("life_cycle", "Annual"): {"fr": "Annuelle", "es": "Anual", "pt": "Anual", "it": "Annuale"},
    ("life_cycle", "Biennial"): {"fr": "Bisannuelle", "es": "Bienal", "pt": "Bienal", "it": "Biennale"},
    ("life_cycle", "Perennial"): {"fr": "Vivace", "es": "Perenne", "pt": "Perene", "it": "Perenne"},
    # nitrogen_fixation
    ("nitrogen_fixation", "Yes"): {"fr": "Oui", "es": "Si", "pt": "Sim", "it": "Si"},
    ("nitrogen_fixation", "No"): {"fr": "Non", "es": "No", "pt": "Nao", "it": "No"},
    ("nitrogen_fixation", "None"): {"fr": "Aucune", "es": "Ninguna", "pt": "Nenhuma", "it": "Nessuna"},
    ("nitrogen_fixation", "High"): {"fr": "Elevee", "es": "Alta", "pt": "Alta", "it": "Alta"},
    ("nitrogen_fixation", "Medium"): {"fr": "Moyenne", "es": "Media", "pt": "Media", "it": "Media"},
    ("nitrogen_fixation", "Low"): {"fr": "Faible", "es": "Baja", "pt": "Baixa", "it": "Bassa"},
    # deciduous_evergreen
    ("deciduous_evergreen", "Deciduous"): {"fr": "Caduc", "es": "Caducifolio", "pt": "Caduco", "it": "Deciduo"},
    ("deciduous_evergreen", "Evergreen"): {"fr": "Persistant", "es": "Perenne", "pt": "Perene", "it": "Sempreverde"},
    ("deciduous_evergreen", "Semi-evergreen"): {"fr": "Semi-persistant", "es": "Semi-perenne", "pt": "Semi-perene", "it": "Semi-sempreverde"},
    # drought_tolerance
    ("drought_tolerance", "High"): {"fr": "Elevee", "es": "Alta", "pt": "Alta", "it": "Alta"},
    ("drought_tolerance", "Medium"): {"fr": "Moyenne", "es": "Media", "pt": "Media", "it": "Media"},
    ("drought_tolerance", "Low"): {"fr": "Faible", "es": "Baja", "pt": "Baixa", "it": "Bassa"},
    ("drought_tolerance", "None"): {"fr": "Aucune", "es": "Ninguna", "pt": "Nenhuma", "it": "Nessuna"},
    # stratum
    ("stratum", "emergent"): {"fr": "Emergent", "es": "Emergente", "pt": "Emergente", "it": "Emergente"},
    ("stratum", "high"): {"fr": "Haut", "es": "Alto", "pt": "Alto", "it": "Alto"},
    ("stratum", "medium"): {"fr": "Moyen", "es": "Medio", "pt": "Medio", "it": "Medio"},
    ("stratum", "low"): {"fr": "Bas", "es": "Bajo", "pt": "Baixo", "it": "Basso"},
    # succession_stage
    ("succession_stage", "pioneer"): {"fr": "Pionnier", "es": "Pionera", "pt": "Pioneira", "it": "Pioniera"},
    ("succession_stage", "secondary"): {"fr": "Secondaire", "es": "Secundaria", "pt": "Secundaria", "it": "Secondaria"},
    ("succession_stage", "climax"): {"fr": "Climax", "es": "Climax", "pt": "Climax", "it": "Climax"},
}


def find_latest_export(exports_dir: Path) -> Path:
    """Find the most recent .db export file."""
    db_files = sorted(exports_dir.glob("canopi-export-*.db"), reverse=True)
    if not db_files:
        print(f"ERROR: No canopi-export-*.db files found in {exports_dir}", file=sys.stderr)
        sys.exit(1)
    return db_files[0]


def create_core_species_table(src: sqlite3.Connection, dst: sqlite3.Connection):
    """Copy selected columns from species to core DB."""
    cols_str = ", ".join(CORE_COLUMNS)
    print(f"  Selecting {len(CORE_COLUMNS)} columns from species...")

    dst.execute(f"""
        CREATE TABLE species AS
        SELECT {cols_str} FROM species
    """)

    # Verify
    count = dst.execute("SELECT COUNT(*) FROM species").fetchone()[0]
    print(f"  -> {count:,} species rows copied")


def copy_supporting_tables(src: sqlite3.Connection, dst: sqlite3.Connection):
    """Copy supporting tables verbatim."""
    tables = [
        "species_common_names",
        "species_relationships",
        "species_uses",
        "species_soil_types",
        "synonym_lookup",
        "translated_values",
    ]

    for table in tables:
        # Check if table exists in source
        exists = src.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
            (table,)
        ).fetchone()[0]

        if not exists:
            print(f"  SKIP: {table} (not found in export)")
            continue

        # Get CREATE TABLE statement
        create_sql = src.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
            (table,)
        ).fetchone()[0]

        dst.execute(create_sql)

        # Copy data
        count = src.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        dst.execute(f"INSERT INTO {table} SELECT * FROM {table}")
        print(f"  -> {table}: {count:,} rows")

    # Add value_zh column to translated_values if it doesn't exist
    cols = [c[1] for c in dst.execute("PRAGMA table_info(translated_values)").fetchall()]
    if "value_zh" not in cols:
        dst.execute("ALTER TABLE translated_values ADD COLUMN value_zh TEXT")
        print("  -> Added value_zh column to translated_values")


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


def create_btree_indexes(dst: sqlite3.Connection):
    """Create B-tree indexes on filter columns and foreign keys."""
    indexes = [
        # Species filter columns
        ("idx_species_canonical", "species", "canonical_name"),
        ("idx_species_slug", "species", "slug"),
        ("idx_species_family", "species", "family"),
        ("idx_species_genus", "species", "genus"),
        ("idx_species_hardiness_min", "species", "hardiness_zone_min"),
        ("idx_species_hardiness_max", "species", "hardiness_zone_max"),
        ("idx_species_height_max", "species", "height_max_m"),
        ("idx_species_growth_rate", "species", "growth_rate"),
        ("idx_species_life_cycle", "species", "life_cycle"),
        ("idx_species_nitrogen", "species", "nitrogen_fixation"),
        ("idx_species_stratum", "species", "stratum"),
        ("idx_species_edibility", "species", "edibility_rating"),
        ("idx_species_habit", "species", "habit"),
        ("idx_species_sun", "species", "tolerates_full_sun"),
        # Common names foreign keys
        ("idx_cn_species_lang", "species_common_names", "species_id, language"),
        ("idx_cn_primary", "species_common_names", "species_id, language, is_primary"),
        # Relationships
        ("idx_rel_species", "species_relationships", "species_id"),
        ("idx_rel_related", "species_relationships", "related_species_slug"),
        # Uses
        ("idx_uses_species", "species_uses", "species_id"),
        # Soil types
        ("idx_soil_species", "species_soil_types", "species_id"),
        # Synonyms
        ("idx_synonym_canonical", "synonym_lookup", "canonical_id"),
        # Best common names (precomputed)
        ("idx_bcn_species_lang", "best_common_names", "species_id, language"),
    ]

    created = 0
    for name, table, columns in indexes:
        try:
            dst.execute(f"CREATE INDEX {name} ON {table}({columns})")
            created += 1
        except sqlite3.OperationalError as e:
            if "already exists" not in str(e):
                print(f"  WARN: Index {name}: {e}")

    print(f"  -> Created {created} B-tree indexes")


def populate_translations(dst: sqlite3.Connection):
    """Populate non-English translations for categorical values."""
    updated = 0
    for (field, value_en), translations in TRANSLATIONS.items():
        # Check if row exists
        row = dst.execute(
            "SELECT id FROM translated_values WHERE field_name = ? AND value_en = ?",
            (field, value_en)
        ).fetchone()

        if row:
            # Update existing row
            for lang, translated in translations.items():
                col = f"value_{lang}"
                dst.execute(
                    f"UPDATE translated_values SET {col} = ? WHERE field_name = ? AND value_en = ?",
                    (translated, field, value_en)
                )
                updated += 1
        else:
            # Insert new row with translations
            import uuid
            row_id = str(uuid.uuid4())
            dst.execute(
                """INSERT INTO translated_values (id, field_name, value_en, value_fr, value_es, value_pt, value_it)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (row_id, field, value_en,
                 translations.get("fr"), translations.get("es"),
                 translations.get("pt"), translations.get("it"))
            )
            updated += len(translations)

    print(f"  -> Updated/inserted {updated} translations")


def optimize_db(dst: sqlite3.Connection):
    """Run ANALYZE and VACUUM for optimal query performance."""
    print("  Running ANALYZE...")
    dst.execute("ANALYZE")
    print("  Running VACUUM...")
    dst.execute("VACUUM")


def main():
    parser = argparse.ArgumentParser(description="Generate canopi-core.db from export")
    parser.add_argument(
        "--export-path",
        type=Path,
        help="Path to export .db file (default: latest in canopi-data/data/exports/)"
    )
    parser.add_argument(
        "--output-path",
        type=Path,
        default=Path("desktop/resources/canopi-core.db"),
        help="Output path for core DB"
    )
    args = parser.parse_args()

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

    # Remove existing output
    if output_path.exists():
        output_path.unlink()

    print(f"Source: {export_path}")
    print(f"Output: {output_path}")
    print()

    start = time.time()

    # Create output DB — attach source for cross-DB queries
    dst = sqlite3.connect(str(output_path))
    dst.execute("PRAGMA journal_mode=WAL")  # WAL during build for speed
    dst.execute("PRAGMA synchronous=OFF")   # Safe: we rebuild on failure
    dst.execute(f"ATTACH DATABASE 'file:{export_path}?mode=ro' AS export_db")

    print("[1/8] Creating core species table...")
    # Use attached DB for direct SQL copy
    cols_str = ", ".join(CORE_COLUMNS)
    dst.execute(f"CREATE TABLE species AS SELECT {cols_str} FROM export_db.species")
    count = dst.execute("SELECT COUNT(*) FROM species").fetchone()[0]
    print(f"  -> {count:,} species rows ({len(CORE_COLUMNS)} columns)")

    print("[2/8] Copying supporting tables...")
    # Copy each supporting table from attached DB
    support_tables = [
        "species_common_names",
        "species_relationships",
        "species_uses",
        "species_soil_types",
        "synonym_lookup",
        "translated_values",
    ]
    for table in support_tables:
        exists = dst.execute(
            "SELECT COUNT(*) FROM export_db.sqlite_master WHERE type='table' AND name=?",
            (table,)
        ).fetchone()[0]
        if not exists:
            print(f"  SKIP: {table} (not in export)")
            continue

        create_sql = dst.execute(
            "SELECT sql FROM export_db.sqlite_master WHERE type='table' AND name=?",
            (table,)
        ).fetchone()[0]
        dst.execute(create_sql)
        dst.execute(f"INSERT INTO {table} SELECT * FROM export_db.{table}")
        tcount = dst.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  -> {table}: {tcount:,} rows")

    # Add value_zh column
    cols = [c[1] for c in dst.execute("PRAGMA table_info(translated_values)").fetchall()]
    if "value_zh" not in cols:
        dst.execute("ALTER TABLE translated_values ADD COLUMN value_zh TEXT")
        print("  -> Added value_zh column to translated_values")

    # Detach export DB — no longer needed
    dst.commit()
    dst.execute("DETACH DATABASE export_db")

    print("[3/8] Building unified search index...")
    # Step 1: Pre-aggregate common names per species (fast GROUP BY, no correlated subquery)
    dst.execute("""
        CREATE TEMP TABLE _cn_agg AS
        SELECT species_id, GROUP_CONCAT(common_name, ' ') AS all_names
        FROM species_common_names
        GROUP BY species_id
    """)
    print("  -> Common names aggregated")

    # Step 2: Build search text table — one row per species with ALL searchable text
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

    # Verify
    test = dst.execute(
        "SELECT COUNT(*) FROM species_search_fts WHERE species_search_fts MATCH 'pommier'"
    ).fetchone()[0]
    print(f"  -> Unified FTS5 built, 'pommier' matches: {test}")
    dst.commit()

    print("[4/8] Building best_common_names lookup table...")
    dst.execute("""
        CREATE TABLE best_common_names (
            species_id TEXT NOT NULL,
            language TEXT NOT NULL,
            common_name TEXT NOT NULL,
            PRIMARY KEY (species_id, language)
        )
    """)
    # For each (species_id, language), pick the best common name:
    # prefer names that differ from the canonical name, then shortest.
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

    print("[5/8] Filtering orphaned relationships...")
    filter_orphaned_relationships(dst)

    print("[6/8] Populating translations...")
    populate_translations(dst)
    dst.commit()

    print("[7/8] Creating B-tree indexes...")
    create_btree_indexes(dst)
    dst.commit()

    print("[8/8] Optimizing (ANALYZE + VACUUM)...")
    optimize_db(dst)
    # Switch to DELETE journal mode — the DB is read-only at runtime
    # and WAL creates -shm/-wal files that trigger Tauri's file watcher
    dst.execute("PRAGMA journal_mode=DELETE")
    dst.close()

    elapsed = time.time() - start
    size_mb = output_path.stat().st_size / (1024 * 1024)
    print()
    print(f"Done in {elapsed:.1f}s")
    print(f"Output: {output_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
