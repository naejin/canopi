# Canopi Plant DB Schema Contract

This document describes the schema contract between canopi-data exports and the canopi-core.db consumed by the desktop app.

## Versioning

| Parameter                  | Value | Location                          |
|----------------------------|-------|-----------------------------------|
| `PRAGMA user_version`      | 5     | Set by `prepare-db.py` at build   |
| `min_export_schema_version`| 8     | Validated against canopi-data `_metadata.schema_version` |

The contract is defined in `scripts/schema-contract.json`.

The Rust backend checks `PRAGMA user_version` at startup:
- **Older than expected**: warns and continues (queries may fail on missing columns).
- **Newer than expected**: warns and continues (unknown columns are ignored; `Option<T>` fields return `None`).

## Tables

### Primary

| Table | Description |
|-------|-------------|
| `species` | Main species table (176 contracted columns). One row per species. |
| `species_search_fts` | FTS5 virtual table for full-text search over species names and text fields. |

### Supporting

| Table | Description |
|-------|-------------|
| `best_common_names` | One best common name per species per language (selected by `is_primary` flag, fallback to shortest). |
| `species_common_names` | All common names per species per language. Has `is_primary` and `source` columns. |
| `species_uses` | Use descriptions per species (edible, medicinal, etc.). Descriptions are translatable via `translated_values`. |
| `species_images` | Image URLs per species. |
| `species_external_links` | External reference links (Wikipedia, PFAF, etc.) per species. |
| `species_relationships` | Companion/antagonist relationships between species. |
| `translated_values` | Wide-format translations table. 22 language columns (`value_en` through `value_hu`). Keyed by `field_name` + English source value. |
| `species_text_translations` | Text-level translations from canopi-data export. |
| `synonym_lookup` | Maps synonym names to canonical species IDs. |

## Regenerating the DB

```bash
python3 scripts/prepare-db.py --export-path ~/projects/canopi-data/data/exports/<latest>.db
```

Omit `--export-path` to auto-discover the latest dated export file. Output is written to `desktop/resources/canopi-core.db`.

**Note:** The Tauri app must not be running during regeneration -- `PRAGMA journal_mode=DELETE` at finalization will fail if the DB file is locked.

## Compatibility Rules

- **Adding new columns is safe.** The app ignores columns not present in its query SELECTs. `Option<T>` fields gracefully handle NULL values from unknown columns.
- **Removing contracted columns will break queries.** Any column listed in `schema-contract.json` `columns` array is referenced by the Rust query builder and must remain present.
- **Adding new tables is safe.** The app only queries tables it knows about.
- **Removing contracted tables will break queries.** Tables listed in `supporting_tables` are referenced by IPC commands.

When canopi-data changes column names, update `schema-contract.json` -- not the Rust code directly. Then bump `schema_version` and rebuild with `prepare-db.py`.
