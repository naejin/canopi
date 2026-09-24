//! `lidar-library.sqlite` catalogue: definitions, spatial index, generations,
//! decisions, jobs and dependencies.
//!
//! Transactions are short; raster computation never happens while a catalogue
//! connection is held. All SQL uses prepared statements with placeholders.

use rusqlite::{Connection, OptionalExtension};

/// v19 (GeoLibre adoption) fixes published items and removes automatic refresh.
/// A binary that only knows v18 must refuse it: it would still mutate sources
/// and dispatch every slope definition as Horn.
pub const CATALOGUE_VERSION: i32 = 19;

pub fn open(path: &std::path::Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|e| format!("Failed to open LiDAR catalogue {}: {e}", path.display()))?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to enable WAL for LiDAR catalogue: {e}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("Failed to enable foreign keys: {e}"))?;
    let backup = backup_before_migration(&connection, path)?;
    migrate(&connection)?;
    if let Some(backup) = backup {
        record_backup(&connection, &backup)?;
    }
    Ok(connection)
}

/// Capture a SQLite-consistent copy of a live catalogue before an upgrade.
///
/// `VACUUM INTO` writes a complete database (WAL content included) to a new
/// file; copying only the main database file would lose committed WAL pages.
/// A fresh or already-current catalogue needs no copy.
fn backup_before_migration(
    connection: &Connection,
    path: &std::path::Path,
) -> Result<Option<std::path::PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }
    // A file that exists but has no meta table yet is a fresh catalogue, not
    // something to preserve.
    let version = schema_version(connection).unwrap_or(0);
    if version == 0 || version >= CATALOGUE_VERSION {
        return Ok(None);
    }
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "lidar-library.sqlite".to_string());
    let stamp = now_iso().replace(':', "-");
    let target = path.with_file_name(format!("{file_name}.backup-v{version}-{stamp}"));
    connection
        .execute("VACUUM INTO ?1", [target.display().to_string()])
        .map_err(|e| format!("Failed to back up LiDAR catalogue before migration: {e}"))?;
    std::fs::File::open(&target)
        .and_then(|file| file.sync_all())
        .map_err(|e| format!("Failed to sync LiDAR catalogue backup: {e}"))?;
    Ok(Some(target))
}

fn schema_version(connection: &Connection) -> Result<i32, String> {
    Ok(connection
        .query_row(
            "SELECT value FROM lidar_catalogue_meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read catalogue version: {e}"))?
        .and_then(|value| value.parse().ok())
        .unwrap_or(0))
}

fn record_backup(connection: &Connection, backup: &std::path::Path) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO lidar_catalogue_meta(key, value) VALUES('last_backup_path', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [backup.display().to_string()],
        )
        .map_err(|e| format!("Failed to record catalogue backup: {e}"))?;
    Ok(())
}

fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS lidar_catalogue_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Failed to create catalogue meta: {e}"))?;
    let version: i32 = connection
        .query_row(
            "SELECT value FROM lidar_catalogue_meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read catalogue version: {e}"))?
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    if version > CATALOGUE_VERSION {
        return Err(format!(
            "LiDAR catalogue schema version {version} is newer than supported {CATALOGUE_VERSION}"
        ));
    }
    let mut applied = version;
    while applied < CATALOGUE_VERSION {
        let next = applied + 1;
        // SQLite cannot relax a NOT NULL constraint in place, so v8 rebuilds
        // `lidar_layer_generations`. Its child tables reference that table with
        // plain foreign keys, which would refuse the DROP while enforcement is
        // on; enforcement is suspended for that single rebuild and the result
        // is verified before the migration is reported as applied.
        let rebuild = matches!(next, 8 | 9 | 18);
        if rebuild {
            connection
                .execute_batch("PRAGMA foreign_keys=OFF")
                .map_err(|e| {
                    format!("Failed to suspend foreign keys for migration v{next}: {e}")
                })?;
        }
        let migrated = apply_migration(connection, next);
        if rebuild {
            connection
                .execute_batch("PRAGMA foreign_keys=ON")
                .map_err(|e| format!("Failed to restore foreign keys after v{next}: {e}"))?;
        }
        migrated?;
        if rebuild {
            verify_foreign_keys(connection)?;
        }
        applied = next;
    }
    Ok(())
}

/// Apply one numbered migration inside its own transaction, recording the new
/// version in that same transaction so an interrupted upgrade stays coherent.
fn apply_migration(connection: &Connection, next: i32) -> Result<(), String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start LiDAR catalogue migration v{next}: {e}"))?;
    let script = match next {
        1 => SCHEMA_V1,
        2 => SCHEMA_V2,
        3 => SCHEMA_V3,
        4 => "",
        5 => SCHEMA_V5,
        6 => "",
        7 => SCHEMA_V7,
        8 => SCHEMA_V8,
        9 => SCHEMA_V9,
        10 => SCHEMA_V10,
        11 => "",
        12 => SCHEMA_V12,
        13 => SCHEMA_V13,
        14 => SCHEMA_V14,
        15 => SCHEMA_V15,
        16 => SCHEMA_V16,
        17 => SCHEMA_V17,
        18 => SCHEMA_V18,
        19 => SCHEMA_V19,
        _ => unreachable!("catalogue migration gap"),
    };
    transaction
        .execute_batch(script)
        .map_err(|e| format!("Failed to apply LiDAR catalogue schema v{next}: {e}"))?;
    if next == 2 && !table_has_column(&transaction, "lidar_acceptance_regions", "job_id")? {
        transaction
            .execute(
                "ALTER TABLE lidar_acceptance_regions ADD COLUMN job_id TEXT",
                [],
            )
            .map_err(|e| format!("Failed to add LiDAR acceptance job identity: {e}"))?;
    }
    if next == 4 && !table_has_column(&transaction, "lidar_generation_members", "job_id")? {
        transaction
            .execute(
                "ALTER TABLE lidar_generation_members ADD COLUMN job_id TEXT",
                [],
            )
            .map_err(|e| format!("Failed to add LiDAR member job identity: {e}"))?;
    }
    // v11 is an additive column, guarded like the other column additions: a
    // catalogue that already has it (or a fixture presenting a newer shape at
    // an older version) still migrates cleanly.
    if next == 11
        && !table_has_column(
            &transaction,
            "lidar_layer_generations",
            "base_generation_id",
        )?
    {
        transaction
            .execute(
                "ALTER TABLE lidar_layer_generations ADD COLUMN base_generation_id TEXT
                 REFERENCES lidar_layer_generations(id)",
                [],
            )
            .map_err(|e| format!("Failed to add the legacy base reference: {e}"))?;
    }
    // v17 is an additive column, guarded like the other column additions: a
    // catalogue that already has it, or a fixture presenting the newer shape at
    // an older version, still migrates cleanly.
    if next == 17 && !table_has_column(&transaction, "lidar_analysis_generations", "name")? {
        transaction
            .execute(
                "ALTER TABLE lidar_analysis_generations ADD COLUMN name TEXT",
                [],
            )
            .map_err(|e| format!("Failed to add the analysis result name: {e}"))?;
    }
    if next == 16 {
        if !table_has_column(&transaction, "lidar_layer_generations", "operation")? {
            transaction
                .execute(
                    "ALTER TABLE lidar_layer_generations ADD COLUMN operation TEXT",
                    [],
                )
                .map_err(|e| format!("Failed to add the snapshot operation: {e}"))?;
        }
        if !table_has_column(&transaction, "lidar_layer_generations", "undo_available")? {
            transaction
                .execute(
                    "ALTER TABLE lidar_layer_generations
                     ADD COLUMN undo_available INTEGER NOT NULL DEFAULT 0",
                    [],
                )
                .map_err(|e| format!("Failed to add the snapshot undo state: {e}"))?;
        }
        // The v15 lineage cannot distinguish a prior Undo from an ordinary
        // change, so it is cleared instead of being presented as a chain of
        // user actions. The current head becomes the new Undo baseline.
        transaction
            .execute(
                "UPDATE lidar_layer_generations SET previous_generation_id = NULL",
                [],
            )
            .map_err(|e| format!("Failed to reset the ambiguous snapshot lineage: {e}"))?;
    }
    // v15 is additive too, and guarded for the same reason: a catalogue that
    // already carries the column (or a fixture presenting a newer shape at an
    // older version) still migrates cleanly.
    if next == 15 {
        if !table_has_column(
            &transaction,
            "lidar_layer_generations",
            "previous_generation_id",
        )? {
            transaction
                .execute(
                    "ALTER TABLE lidar_layer_generations ADD COLUMN previous_generation_id TEXT
                     REFERENCES lidar_layer_generations(id)",
                    [],
                )
                .map_err(|e| format!("Failed to add the snapshot predecessor: {e}"))?;
        }
        if !table_has_column(&transaction, "lidar_collection_members", "job_id")? {
            transaction
                .execute(
                    "ALTER TABLE lidar_collection_members ADD COLUMN job_id TEXT",
                    [],
                )
                .map_err(|e| format!("Failed to add the collection member job: {e}"))?;
        }
    }
    if next == 19 {
        for (table, column, definition) in [
            // The saved selection of one import, in its priority order, so
            // Retry resubmits exactly what the user chose.
            ("lidar_import_jobs", "request_json", "TEXT"),
            // Provenance of newly published results; legacy rows stay null and
            // are read as the definition's recipe version describes them.
            ("lidar_analysis_generations", "method_id", "TEXT"),
            ("lidar_analysis_generations", "recipe_version", "INTEGER"),
        ] {
            if !table_has_column(&transaction, table, column)? {
                transaction
                    .execute(
                        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
                        [],
                    )
                    .map_err(|e| format!("Failed to add {table}.{column}: {e}"))?;
            }
        }
        // Automatic refresh is retired. An attempt that never replaced a
        // complete result stays a saved result, without an in-place Retry.
        transaction
            .execute(
                "UPDATE lidar_analysis_jobs
                 SET state = 'retired',
                     message = 'automatic refresh retired; the saved result is kept'
                 WHERE state IN ('preparing', 'refreshing', 'failed', 'cancelled')
                   AND definition_id IN (SELECT definition_id FROM lidar_analysis_heads)",
                [],
            )
            .map_err(|e| format!("Failed to retire automatic refresh attempts: {e}"))?;
    }
    if next == 6 {
        if !table_has_column(&transaction, "lidar_import_jobs", "progress_phase")? {
            transaction
                .execute(
                    "ALTER TABLE lidar_import_jobs ADD COLUMN progress_phase TEXT",
                    [],
                )
                .map_err(|e| format!("Failed to add LiDAR import progress phase: {e}"))?;
        }
        if !table_has_column(&transaction, "lidar_import_jobs", "progress_percent")? {
            transaction
                .execute(
                    "ALTER TABLE lidar_import_jobs ADD COLUMN progress_percent INTEGER
                     CHECK(progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100)",
                    [],
                )
                .map_err(|e| format!("Failed to add LiDAR import progress percent: {e}"))?;
        }
    }
    transaction
        .execute(
            "INSERT INTO lidar_catalogue_meta(key, value) VALUES('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [next.to_string()],
        )
        .map_err(|e| format!("Failed to record catalogue version: {e}"))?;
    transaction
        .commit()
        .map_err(|e| format!("Failed to commit LiDAR catalogue migration v{next}: {e}"))
}

/// Fail the migration instead of leaving a catalogue whose rows no longer join.
fn verify_foreign_keys(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(|e| format!("Failed to verify catalogue foreign keys: {e}"))?;
    let mut rows = statement
        .query([])
        .map_err(|e| format!("Failed to verify catalogue foreign keys: {e}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|e| format!("Failed to verify catalogue foreign keys: {e}"))?
    {
        let table: String = row.get(0).unwrap_or_else(|_| "unknown".to_string());
        return Err(format!(
            "LiDAR catalogue migration left a foreign key violation in {table}"
        ));
    }
    Ok(())
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(names.iter().any(|name| name == column))
}

/// v19: fixed library items. Column additions and the retirement of automatic
/// refresh attempts are applied in `apply_migration`, guarded per column.
const SCHEMA_V19: &str = "";

/// Durable-library additions: exact footprint spatial index and the
/// import-job link on acceptance decisions.
const SCHEMA_V2: &str = r#"
CREATE TABLE IF NOT EXISTS lidar_source_footprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interpretation_id TEXT NOT NULL REFERENCES lidar_interpretations(id),
    layer_id TEXT NOT NULL,
    min_x REAL NOT NULL,
    max_x REAL NOT NULL,
    min_y REAL NOT NULL,
    max_y REAL NOT NULL,
    UNIQUE(layer_id, interpretation_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS lidar_footprint_rtree USING rtree(
    id, min_x, max_x, min_y, max_y
);

"#;

/// Re-importing the same interpretation is a distinct accepted operation.
/// Ordinal, rather than interpretation identity, owns generation ordering.
const SCHEMA_V3: &str = r#"
CREATE TABLE lidar_generation_members_v3 (
    generation_id TEXT NOT NULL REFERENCES lidar_layer_generations(id),
    interpretation_id TEXT NOT NULL REFERENCES lidar_interpretations(id),
    role TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    PRIMARY KEY (generation_id, ordinal)
);
INSERT INTO lidar_generation_members_v3(generation_id, interpretation_id, role, ordinal)
SELECT generation_id, interpretation_id, role, ordinal
FROM lidar_generation_members
ORDER BY generation_id, ordinal;
DROP TABLE lidar_generation_members;
ALTER TABLE lidar_generation_members_v3 RENAME TO lidar_generation_members;
"#;

/// Early v2 catalogues made an interpretation globally unique, which prevents
/// the same source from participating in more than one user-owned layer. Keep
/// footprint ids stable while replacing that constraint so the R-tree remains
/// valid throughout the transactional migration.
/// v7: sparse standard-COG assets plus paged index references.
///
/// Pixel data never lives in SQLite: these tables reference immutable
/// content-addressed COG files by digest, keep entry coordinates as signed
/// integers (a layer lattice extends left/up), and page per-chunk aggregates
/// so generation statistics never require visiting absent coordinates.
const SCHEMA_V7: &str = r#"
CREATE TABLE IF NOT EXISTS lidar_raster_assets (
    sha256 TEXT PRIMARY KEY,
    rel_path TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    profile TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    geotransform TEXT NOT NULL,
    crs_wkt TEXT NOT NULL,
    nodata REAL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lidar_interpretation_cogs (
    interpretation_id TEXT PRIMARY KEY REFERENCES lidar_interpretations(id) ON DELETE CASCADE,
    asset_sha256 TEXT NOT NULL REFERENCES lidar_raster_assets(sha256),
    nodata REAL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lidar_generation_chunks (
    generation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    chunk_x INTEGER NOT NULL,
    chunk_y INTEGER NOT NULL,
    asset_sha256 TEXT NOT NULL REFERENCES lidar_raster_assets(sha256),
    valid_cells INTEGER NOT NULL,
    min_value REAL,
    max_value REAL,
    sum_value REAL,
    state TEXT NOT NULL DEFAULT 'unpublished',
    PRIMARY KEY (generation_id, role, chunk_x, chunk_y)
);
CREATE INDEX IF NOT EXISTS lidar_generation_chunks_asset_idx
    ON lidar_generation_chunks(asset_sha256);
CREATE TABLE IF NOT EXISTS lidar_interpretation_regions (
    interpretation_id TEXT NOT NULL REFERENCES lidar_interpretations(id) ON DELETE CASCADE,
    block_x INTEGER NOT NULL,
    block_y INTEGER NOT NULL,
    valid_cells INTEGER NOT NULL,
    min_value REAL,
    max_value REAL,
    sum_value REAL,
    PRIMARY KEY (interpretation_id, block_x, block_y)
);
"#;

/// v13: an index matching the paged occupied-region read order.
///
/// A sparse review walks each source's occupied regions as an ordered stream,
/// so the index carries `(block_y, block_x)` after the interpretation key.
/// Additive only: no data changes.
const SCHEMA_V13: &str = r#"
CREATE INDEX IF NOT EXISTS lidar_interpretation_regions_order_idx
    ON lidar_interpretation_regions(interpretation_id, block_y, block_x);
"#;

/// v14: ordered source collections as first-class immutable snapshots.
///
/// A Data Layer is an ordered collection of independently prepared source
/// COGs; its numeric value is the highest-priority valid sample at each
/// location. `lidar_generation_members` stays the ordered-occurrence record of
/// the superseded merge model (roles `add`/`replace`/`replace-overlap`), which
/// is still how a preserved generation is read. Ordered snapshots record their
/// own members here instead, so neither representation has to be reinterpreted
/// as the other.
///
/// `member_id` is the stable occurrence identity a user edit names: repeated
/// imports of the same bytes are distinct occurrences even though the
/// interpretation (and therefore the retained COG) is deduplicated. `position`
/// is the priority order, lowest first, and is exactly the list order the UI
/// shows (topmost first). `kind` is `source` for an ordinary occurrence and
/// `previous-composition` for the single indivisible member that exposes a
/// preserved legacy head; the latter carries `base_generation_id` and no
/// interpretation, and its internals are never reordered.
///
/// Additive only: existing generations keep no collection rows and continue to
/// read through their own format.
const SCHEMA_V14: &str = r#"
CREATE TABLE IF NOT EXISTS lidar_collection_members (
    generation_id TEXT NOT NULL REFERENCES lidar_layer_generations(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('source', 'previous-composition')),
    interpretation_id TEXT REFERENCES lidar_interpretations(id),
    base_generation_id TEXT REFERENCES lidar_layer_generations(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (generation_id, member_id),
    CHECK (
        (kind = 'source' AND interpretation_id IS NOT NULL AND base_generation_id IS NULL)
        OR (kind = 'previous-composition' AND interpretation_id IS NULL
            AND base_generation_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS lidar_collection_members_order_idx
    ON lidar_collection_members(generation_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS lidar_collection_members_position_idx
    ON lidar_collection_members(generation_id, position);
"#;

/// v15: undo/restore lineage for a layer's published snapshots.
///
/// `previous_generation_id` records which snapshot was the head when this one
/// was published. Undo therefore restores the predecessor of the *user change*
/// it is undoing, so repeated Undo walks backwards through prior changes
/// instead of toggling between a restoration and the snapshot it replaced. An
/// explicit "Restore this version" records the current head as its predecessor,
/// which is what makes it a new user change that can itself be undone.
///
/// Additive only: existing generations keep no predecessor and a layer with no
/// recorded lineage simply has nothing to undo.
const SCHEMA_V15: &str = "";

/// v16: the operation each snapshot recorded and explicit Undo availability.
///
/// v15 could say which snapshot a change replaced, but not whether that
/// snapshot itself had anything left to undo, and it inferred the operation
/// from member identities. Both are recorded here instead:
///
/// * `operation` is the user action that published the snapshot (`import`,
///   `reorder`, `remove`, `undo`, `restore`), so History reports what happened
///   rather than guessing from interpretation lists;
/// * `undo_available` says whether Undo is offered from this head at all, and
///   `previous_generation_id` remains its target. The two are independent: an
///   available Undo with no target means "restore the empty initial
///   composition", while an unavailable one means the walk is exhausted.
///
/// Migration is metadata-only and never rewrites a composition. v15 could not
/// distinguish a prior Undo from an ordinary change, so the ambiguous lineage
/// is cleared rather than fabricated into a chain of user actions: the current
/// head becomes the new Undo baseline, every existing version keeps its values,
/// its assets and its explicit Restore capability, and entries without a
/// recorded operation display a neutral "Previous version" label.
const SCHEMA_V16: &str = "";

/// v18: a source generation may not know its exact composed coverage, and its
/// display range becomes metadata of its own.
///
/// The ordered route publishes membership without reading the composed pixels,
/// so exact `coverage_cells` and the exact `min_value`/`max_value` range are not
/// always derivable. The display range is what styling and legends consume: it
/// is a stable colour domain for an immutable generation, explicitly labelled
/// by the basis it came from, and never a claim about composed statistics.
///
/// Every existing row keeps the exact values it already had and is labelled
/// `exact`, so an upgraded library renders and reads exactly as before.
const SCHEMA_V18: &str = r#"
CREATE TABLE lidar_layer_generations_v18 (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL REFERENCES lidar_source_layers(id),
    created_at TEXT NOT NULL,
    mosaic_path TEXT,
    coverage_mask_path TEXT,
    manifest_json TEXT NOT NULL,
    coverage_cells INTEGER,
    min_value REAL,
    max_value REAL,
    display_min_value REAL,
    display_max_value REAL,
    display_basis TEXT,
    bounds_3857 TEXT NOT NULL,
    base_generation_id TEXT REFERENCES lidar_layer_generations(id),
    previous_generation_id TEXT REFERENCES lidar_layer_generations(id),
    undo_available INTEGER NOT NULL DEFAULT 0,
    operation TEXT,
    CHECK ((mosaic_path IS NULL) = (coverage_mask_path IS NULL)),
    CHECK ((display_min_value IS NULL) = (display_max_value IS NULL)),
    CHECK (display_min_value IS NULL OR display_min_value <= display_max_value)
);
INSERT INTO lidar_layer_generations_v18(
    id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
    coverage_cells, min_value, max_value,
    display_min_value, display_max_value, display_basis,
    bounds_3857, base_generation_id, previous_generation_id, undo_available, operation
)
SELECT id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
       coverage_cells, min_value, max_value,
       min_value, max_value,
       CASE WHEN min_value IS NULL OR max_value IS NULL THEN NULL ELSE 'exact' END,
       bounds_3857, base_generation_id, previous_generation_id, undo_available, operation
FROM lidar_layer_generations;
DROP TABLE lidar_layer_generations;
ALTER TABLE lidar_layer_generations_v18 RENAME TO lidar_layer_generations;
CREATE INDEX IF NOT EXISTS idx_layer_generations_layer
    ON lidar_layer_generations(layer_id);
"#;

/// v17: an analysis result may carry the name its author gave it.
///
/// The name belongs to the *generation*, not the definition: a definition is one
/// layer/kind pair that persists for the life of the library, while each run
/// publishes a new generation that the user named. Nullable, so every existing
/// generation keeps its row and reports no name rather than a fabricated one.
///
/// The column is added by the guarded step in `apply_migration` rather than by
/// this script, because a fixture can present the newer shape at an older
/// version and would otherwise fail on a duplicate column.
const SCHEMA_V17: &str = "";

/// v12: an index matching the paged chunk read order.
///
/// A generation-scoped reader walks published chunk records in stable
/// `(chunk_y, chunk_x)` order with a keyset cursor and a spatial filter, so the
/// index carries exactly that key order. Additive only: no data changes and
/// existing catalogues keep every row.
const SCHEMA_V12: &str = r#"
CREATE INDEX IF NOT EXISTS lidar_generation_chunks_role_order_idx
    ON lidar_generation_chunks(generation_id, role, chunk_y, chunk_x);
"#;

/// v11: a generation may sit on an opaque legacy base.
///
/// A head whose member history was never recorded cannot be replayed; instead
/// of fabricating members, a new generation records the immutable legacy head
/// it overlays. Additive only: existing generations keep no base.
/// v10: a layer records the one lattice every generation shares.
///
/// The anchor is chosen by the layer's first accepted source and never moves,
/// so extending the layer left or up cannot shift the chunk coordinates of
/// data that has not changed. Only additions are needed: existing layers keep
/// their published generations and gain their lattice on the next publication.
const SCHEMA_V10: &str = r#"
CREATE TABLE IF NOT EXISTS lidar_layer_lattices (
    layer_id TEXT PRIMARY KEY REFERENCES lidar_source_layers(id) ON DELETE CASCADE,
    origin_x REAL NOT NULL,
    origin_y REAL NOT NULL,
    pixel_x REAL NOT NULL,
    pixel_y REAL NOT NULL,
    crs_wkt TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"#;

/// v9: an analysis result may likewise be stored as sparse resolved chunks, so
/// `result_path` becomes nullable while a dense quality mask still requires a
/// dense result.
const SCHEMA_V9: &str = r#"
CREATE TABLE lidar_analysis_generations_v9 (
    id TEXT PRIMARY KEY,
    definition_id TEXT NOT NULL REFERENCES lidar_analysis_definitions(id),
    source_generation_id TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    state TEXT NOT NULL,
    result_path TEXT,
    quality_mask_path TEXT,
    manifest_json TEXT NOT NULL,
    coverage_cells INTEGER NOT NULL,
    min_value REAL,
    max_value REAL,
    bounds_3857 TEXT NOT NULL,
    published_at TEXT NOT NULL,
    CHECK (result_path IS NOT NULL OR quality_mask_path IS NULL)
);
INSERT INTO lidar_analysis_generations_v9(
    id, definition_id, source_generation_id, engine_version, state, result_path,
    quality_mask_path, manifest_json, coverage_cells, min_value, max_value,
    bounds_3857, published_at
)
SELECT id, definition_id, source_generation_id, engine_version, state, result_path,
       quality_mask_path, manifest_json, coverage_cells, min_value, max_value,
       bounds_3857, published_at
FROM lidar_analysis_generations;
DROP TABLE lidar_analysis_generations;
ALTER TABLE lidar_analysis_generations_v9 RENAME TO lidar_analysis_generations;
CREATE INDEX IF NOT EXISTS idx_analysis_generations_definition
    ON lidar_analysis_generations(definition_id);
"#;

/// v8: a generation may be stored as sparse resolved chunks instead of one
/// dense mosaic, so the legacy mosaic/coverage columns become nullable.
///
/// Every existing row is copied unchanged and keeps both paths, which is what
/// preserves preserved legacy generations. The paired-nullability check keeps
/// the two columns meaningful for both storage formats: a generation either
/// owns a dense pair or owns no dense file at all.
const SCHEMA_V8: &str = r#"
CREATE TABLE lidar_layer_generations_v8 (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL REFERENCES lidar_source_layers(id),
    created_at TEXT NOT NULL,
    mosaic_path TEXT,
    coverage_mask_path TEXT,
    manifest_json TEXT NOT NULL,
    coverage_cells INTEGER NOT NULL,
    min_value REAL,
    max_value REAL,
    bounds_3857 TEXT NOT NULL,
    CHECK ((mosaic_path IS NULL) = (coverage_mask_path IS NULL))
);
INSERT INTO lidar_layer_generations_v8(
    id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
    coverage_cells, min_value, max_value, bounds_3857
)
SELECT id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
       coverage_cells, min_value, max_value, bounds_3857
FROM lidar_layer_generations;
DROP TABLE lidar_layer_generations;
ALTER TABLE lidar_layer_generations_v8 RENAME TO lidar_layer_generations;
CREATE INDEX IF NOT EXISTS idx_layer_generations_layer
    ON lidar_layer_generations(layer_id);
"#;

const SCHEMA_V5: &str = r#"
CREATE TABLE lidar_source_footprints_v5 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interpretation_id TEXT NOT NULL REFERENCES lidar_interpretations(id),
    layer_id TEXT NOT NULL,
    min_x REAL NOT NULL,
    max_x REAL NOT NULL,
    min_y REAL NOT NULL,
    max_y REAL NOT NULL,
    UNIQUE(layer_id, interpretation_id)
);
INSERT INTO lidar_source_footprints_v5(
    id, interpretation_id, layer_id, min_x, max_x, min_y, max_y
)
SELECT id, interpretation_id, layer_id, min_x, max_x, min_y, max_y
FROM lidar_source_footprints;
DROP TABLE lidar_source_footprints;
ALTER TABLE lidar_source_footprints_v5 RENAME TO lidar_source_footprints;
"#;

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS lidar_sources (
    sha256 TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    probe_json TEXT NOT NULL,
    imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lidar_interpretations (
    id TEXT PRIMARY KEY,
    source_sha256 TEXT NOT NULL REFERENCES lidar_sources(sha256),
    band_index INTEGER NOT NULL,
    measurement_kind TEXT NOT NULL,
    units TEXT NOT NULL,
    scale REAL NOT NULL,
    offset REAL NOT NULL,
    crs_wkt TEXT NOT NULL,
    vertical_ref TEXT NOT NULL,
    nodata REAL,
    geotransform TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    interp_hash TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS lidar_source_layers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    measurement_kind TEXT NOT NULL,
    units TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lidar_layer_generations (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL REFERENCES lidar_source_layers(id),
    created_at TEXT NOT NULL,
    mosaic_path TEXT NOT NULL,
    coverage_mask_path TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    coverage_cells INTEGER NOT NULL,
    min_value REAL,
    max_value REAL,
    bounds_3857 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_layer_generations_layer
    ON lidar_layer_generations(layer_id);

CREATE TABLE IF NOT EXISTS lidar_generation_members (
    generation_id TEXT NOT NULL REFERENCES lidar_layer_generations(id),
    interpretation_id TEXT NOT NULL REFERENCES lidar_interpretations(id),
    role TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    PRIMARY KEY (generation_id, interpretation_id)
);

CREATE TABLE IF NOT EXISTS lidar_acceptance_regions (
    id TEXT PRIMARY KEY,
    generation_id TEXT NOT NULL REFERENCES lidar_layer_generations(id),
    interpretation_id TEXT NOT NULL REFERENCES lidar_interpretations(id),
    decision TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lidar_layer_heads (
    layer_id TEXT PRIMARY KEY REFERENCES lidar_source_layers(id),
    generation_id TEXT NOT NULL REFERENCES lidar_layer_generations(id)
);

CREATE TABLE IF NOT EXISTS lidar_import_jobs (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL REFERENCES lidar_source_layers(id),
    state TEXT NOT NULL,
    source_sha256 TEXT,
    review_json TEXT,
    message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lidar_analysis_definitions (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL REFERENCES lidar_source_layers(id),
    kind TEXT NOT NULL,
    version INTEGER NOT NULL,
    parameters_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analysis_definitions_layer
    ON lidar_analysis_definitions(layer_id);

CREATE TABLE IF NOT EXISTS lidar_analysis_generations (
    id TEXT PRIMARY KEY,
    definition_id TEXT NOT NULL REFERENCES lidar_analysis_definitions(id),
    source_generation_id TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    state TEXT NOT NULL,
    result_path TEXT NOT NULL,
    quality_mask_path TEXT,
    manifest_json TEXT NOT NULL,
    coverage_cells INTEGER NOT NULL,
    min_value REAL,
    max_value REAL,
    bounds_3857 TEXT NOT NULL,
    published_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analysis_generations_definition
    ON lidar_analysis_generations(definition_id);

CREATE TABLE IF NOT EXISTS lidar_analysis_heads (
    definition_id TEXT PRIMARY KEY REFERENCES lidar_analysis_definitions(id),
    generation_id TEXT NOT NULL REFERENCES lidar_analysis_generations(id)
);

CREATE TABLE IF NOT EXISTS lidar_analysis_jobs (
    id TEXT PRIMARY KEY,
    definition_id TEXT NOT NULL REFERENCES lidar_analysis_definitions(id),
    source_generation_id TEXT NOT NULL,
    state TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lidar_dependencies (
    definition_id TEXT NOT NULL REFERENCES lidar_analysis_definitions(id),
    layer_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    PRIMARY KEY (definition_id, layer_id)
);
"#;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct LayerRow {
    pub id: String,
    pub name: String,
    pub measurement_kind: String,
    pub units: String,
}

#[derive(Debug, Clone)]
pub struct GenerationRow {
    pub id: String,
    /// Dense mosaic/coverage of a `legacy-dense-v1` generation. A generation
    /// stored as sparse resolved chunks has neither, so both columns are null
    /// together; readers must select their path from the manifest format
    /// instead of falling back to a dense read.
    pub mosaic_path: Option<String>,
    pub coverage_mask_path: Option<String>,
    pub manifest_json: String,
    /// Exact valid cells, or `None` when the count is not known. A generation
    /// published without reading the composed pixels reports unknown rather
    /// than zero.
    pub coverage_cells: Option<i64>,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    /// The range styling and legends use, with the basis it came from.
    pub display_min_value: Option<f64>,
    pub display_max_value: Option<f64>,
    pub display_basis: Option<String>,
    pub bounds_3857: String,
    /// Immutable opaque legacy head this generation overlays, when its own
    /// member history was never recorded.
    ///
    /// Retained so a preserved generation's recorded compatibility ancestor
    /// stays readable to migration and diagnostic callers. Publication no
    /// longer writes or follows it: a new ordered snapshot wraps the actual
    /// accepted head, so replaying an older ancestor can never replace the
    /// values a user accepted.
    #[allow(dead_code)]
    pub base_generation_id: Option<String>,
    /// Snapshot Undo restores from this head. Absent with `undo_available`
    /// means Undo restores the empty initial composition.
    pub previous_generation_id: Option<String>,
    /// Whether Undo is offered from this head at all. An unavailable Undo is
    /// exhausted rather than pointed at the empty composition.
    pub undo_available: bool,
}

#[derive(Debug, Clone)]
pub struct AnalysisDefinitionRow {
    pub id: String,
    pub layer_id: String,
    pub kind: String,
    pub parameters_json: String,
}

#[derive(Debug, Clone)]
pub struct AnalysisGenerationRow {
    pub id: String,
    pub source_generation_id: String,
    pub state: String,
    /// The name its author gave this result; `None` for pre-v17 generations.
    pub name: Option<String>,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub bounds_3857: String,
    /// Storage format and lattice of the published result.
    pub manifest_json: String,
}

#[derive(Debug, Clone)]
pub struct ImportJobRow {
    pub id: String,
    pub layer_id: String,
    pub state: String,
    /// Stored review payload of the superseded review route.
    ///
    /// Retained in the schema so an upgraded catalogue keeps its history, and
    /// deliberately unread: nothing produces a review any more.
    #[allow(dead_code)]
    pub review_json: Option<String>,
    pub message: Option<String>,
    pub progress_phase: Option<String>,
    pub progress_percent: Option<i64>,
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

pub fn list_layers(connection: &Connection) -> Result<Vec<LayerRow>, String> {
    let mut statement = connection
        .prepare("SELECT id, name, measurement_kind, units FROM lidar_source_layers ORDER BY created_at, id")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(LayerRow {
                id: row.get(0)?,
                name: row.get(1)?,
                measurement_kind: row.get(2)?,
                units: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn get_layer(connection: &Connection, layer_id: &str) -> Result<Option<LayerRow>, String> {
    connection
        .query_row(
            "SELECT id, name, measurement_kind, units FROM lidar_source_layers WHERE id = ?1",
            [layer_id],
            |row| {
                Ok(LayerRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    measurement_kind: row.get(2)?,
                    units: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
}

pub fn head_generation(
    connection: &Connection,
    layer_id: &str,
) -> Result<Option<GenerationRow>, String> {
    connection
        .query_row(
            "SELECT g.id, g.layer_id, g.mosaic_path, g.coverage_mask_path, g.manifest_json,
                    g.coverage_cells, g.min_value, g.max_value,
                    g.display_min_value, g.display_max_value, g.display_basis,
                    g.bounds_3857,
                    g.base_generation_id, g.previous_generation_id, g.undo_available
             FROM lidar_layer_heads h
             JOIN lidar_layer_generations g ON g.id = h.generation_id
             WHERE h.layer_id = ?1",
            [layer_id],
            map_generation_row,
        )
        .optional()
        .map_err(|e| e.to_string())
}

fn map_generation_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GenerationRow> {
    Ok(GenerationRow {
        id: row.get(0)?,
        mosaic_path: row.get(2)?,
        coverage_mask_path: row.get(3)?,
        manifest_json: row.get(4)?,
        coverage_cells: row.get(5)?,
        min_value: row.get(6)?,
        max_value: row.get(7)?,
        display_min_value: row.get(8)?,
        display_max_value: row.get(9)?,
        display_basis: row.get(10)?,
        bounds_3857: row.get(11)?,
        base_generation_id: row.get(12)?,
        previous_generation_id: row.get(13)?,
        undo_available: row.get::<_, i64>(14)? != 0,
    })
}

pub fn list_definitions(connection: &Connection) -> Result<Vec<AnalysisDefinitionRow>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, layer_id, kind, parameters_json
             FROM lidar_analysis_definitions ORDER BY created_at, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(AnalysisDefinitionRow {
                id: row.get(0)?,
                layer_id: row.get(1)?,
                kind: row.get(2)?,
                parameters_json: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn list_definitions_for_layer(
    connection: &Connection,
    layer_id: &str,
) -> Result<Vec<AnalysisDefinitionRow>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, layer_id, kind, parameters_json
             FROM lidar_analysis_definitions WHERE layer_id = ?1 ORDER BY created_at, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([layer_id], |row| {
            Ok(AnalysisDefinitionRow {
                id: row.get(0)?,
                layer_id: row.get(1)?,
                kind: row.get(2)?,
                parameters_json: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn head_analysis_generation(
    connection: &Connection,
    definition_id: &str,
) -> Result<Option<AnalysisGenerationRow>, String> {
    connection
        .query_row(
            "SELECT g.id, g.source_generation_id, g.state, g.min_value, g.max_value,
                    g.bounds_3857, g.manifest_json, g.name
             FROM lidar_analysis_heads h
             JOIN lidar_analysis_generations g ON g.id = h.generation_id
             WHERE h.definition_id = ?1",
            [definition_id],
            |row| {
                Ok(AnalysisGenerationRow {
                    id: row.get(0)?,
                    source_generation_id: row.get(1)?,
                    state: row.get(2)?,
                    min_value: row.get(3)?,
                    max_value: row.get(4)?,
                    bounds_3857: row.get(5)?,
                    manifest_json: row.get(6)?,
                    name: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
}

pub fn latest_analysis_job_state(
    connection: &Connection,
    definition_id: &str,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT state FROM lidar_analysis_jobs WHERE definition_id = ?1
             ORDER BY created_at DESC, id DESC LIMIT 1",
            [definition_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
}

pub fn get_import_job(
    connection: &Connection,
    job_id: &str,
) -> Result<Option<ImportJobRow>, String> {
    connection
        .query_row(
            "SELECT id, layer_id, state, review_json, message, progress_phase, progress_percent
             FROM lidar_import_jobs WHERE id = ?1",
            [job_id],
            |row| {
                Ok(ImportJobRow {
                    id: row.get(0)?,
                    layer_id: row.get(1)?,
                    state: row.get(2)?,
                    review_json: row.get(3)?,
                    message: row.get(4)?,
                    progress_phase: row.get(5)?,
                    progress_percent: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
}

pub fn update_import_progress(
    connection: &Connection,
    job_id: &str,
    phase: &str,
    percent: u8,
) -> Result<bool, String> {
    connection
        .execute(
            "UPDATE lidar_import_jobs
             SET progress_phase = ?2, progress_percent = ?3, updated_at = ?4
             WHERE id = ?1 AND state = 'applying'
               AND COALESCE(progress_percent, -1) < ?3",
            rusqlite::params![job_id, phase, percent, now_iso()],
        )
        .map(|changed| changed > 0)
        .map_err(|e| format!("Failed to record LiDAR import progress: {e}"))
}

#[derive(Debug, Clone)]
pub struct InterpretationRow {
    pub geotransform: String,
    pub width: i64,
    pub height: i64,
    pub interp_hash: String,
    /// Declared NoData of this interpretation. It is the effective validity
    /// rule for lossless-validity sources and must never be replaced by
    /// another member's sentinel.
    pub nodata: Option<f64>,
}

pub fn get_interpretation(
    connection: &Connection,
    interpretation_id: &str,
) -> Result<Option<InterpretationRow>, String> {
    connection
        .query_row(
            "SELECT geotransform, width, height, interp_hash, nodata
             FROM lidar_interpretations WHERE id = ?1",
            [interpretation_id],
            |row| {
                Ok(InterpretationRow {
                    geotransform: row.get(0)?,
                    width: row.get(1)?,
                    height: row.get(2)?,
                    interp_hash: row.get(3)?,
                    nodata: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
}

/// Ordered accepted members of a generation with their acceptance roles and
/// originating import jobs. Legacy members may not have job identity.
pub fn generation_members(
    connection: &Connection,
    generation_id: &str,
) -> Result<Vec<(String, String, Option<String>)>, String> {
    let mut statement = connection
        .prepare(
            "SELECT interpretation_id, role, job_id FROM lidar_generation_members
             WHERE generation_id = ?1 ORDER BY ordinal",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([generation_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Ordered source collections
// ---------------------------------------------------------------------------

/// One occurrence of an ordered collection snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollectionMemberRow {
    /// Stable occurrence identity, never reused within a snapshot.
    pub member_id: String,
    /// Priority order, lowest first: position 0 is the topmost source.
    pub position: i64,
    /// `source` or `previous-composition`.
    pub kind: String,
    pub interpretation_id: Option<String>,
    pub base_generation_id: Option<String>,
    /// Import job that added this occurrence, when one did.
    pub job_id: Option<String>,
}

/// Measured coverage of one interpretation: valid cells and value range.
///
/// The occupied-region index already stores exact per-block sums and extrema, so
/// a source list costs one aggregate query rather than a raster read. A block
/// that holds no valid cell contributes neither coverage nor an extremum: a
/// stored sentinel in such a block is not one of the source's values, so it must
/// not widen the reported range.
pub fn interpretation_coverage(
    connection: &Connection,
    interpretation_id: &str,
) -> Result<(i64, Option<f64>, Option<f64>), String> {
    connection
        .query_row(
            "SELECT COALESCE(SUM(valid_cells), 0),
                    MIN(CASE WHEN valid_cells > 0 THEN min_value END),
                    MAX(CASE WHEN valid_cells > 0 THEN max_value END)
             FROM lidar_interpretation_regions WHERE interpretation_id = ?1",
            [interpretation_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<f64>>(1)?,
                    row.get::<_, Option<f64>>(2)?,
                ))
            },
        )
        .map_err(|e| format!("Failed to read interpretation coverage: {e}"))
}

/// Origin filename of the source an interpretation was derived from.
///
/// The identity is the interpretation's own source relation, never a name
/// match, so the same bytes imported twice report the same original name.
pub fn interpretation_filename(
    connection: &Connection,
    interpretation_id: &str,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT s.original_filename
             FROM lidar_interpretations i
             JOIN lidar_sources s ON s.sha256 = i.source_sha256
             WHERE i.id = ?1",
            [interpretation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read the source filename: {e}"))
}

/// Largest member page a caller may request.
///
/// Bounded like the other catalogue pages so a source refresh can never expand
/// a layer's whole lifetime membership into one response.
pub const MEMBER_PAGE_MAX: i64 = 200;

/// One bounded page of a snapshot's ordered members, top-first.
///
/// The cursor is the last `position` the caller saw; positions are unique within
/// a snapshot, so the page boundary is exact and stable. The caller passes the
/// snapshot it is paging, which is what makes a late page of a superseded head
/// a rejected request rather than a silently mixed list.
pub fn collection_members_page(
    connection: &Connection,
    generation_id: &str,
    after_position: Option<i64>,
    limit: i64,
) -> Result<Vec<CollectionMemberRow>, String> {
    let limit = limit.clamp(1, MEMBER_PAGE_MAX);
    let mut statement = connection
        .prepare(
            "SELECT member_id, position, kind, interpretation_id, base_generation_id, job_id
             FROM lidar_collection_members
             WHERE generation_id = ?1 AND position > ?2
             ORDER BY position LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(
            rusqlite::params![generation_id, after_position.unwrap_or(-1), limit],
            |row| {
                Ok(CollectionMemberRow {
                    member_id: row.get(0)?,
                    position: row.get(1)?,
                    kind: row.get(2)?,
                    interpretation_id: row.get(3)?,
                    base_generation_id: row.get(4)?,
                    job_id: row.get(5)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// How many occurrences one snapshot's composition holds.
pub fn collection_member_count(
    connection: &Connection,
    generation_id: &str,
) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM lidar_collection_members WHERE generation_id = ?1",
            [generation_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to count collection members: {e}"))
}

/// Signed chunk extent of a generation's published records of one role.
///
/// A sparse generation's `manifest_json` grid describes the lattice its chunks
/// are addressed in, not how far the published records actually reach, so a
/// compatibility read that trusted the rectangle would drop real coverage.
/// Published chunk coordinates of one generation and role, row-major.
///
/// Coordinates only: display planning groups occupied chunks without opening
/// any raster, so distant sparse coverage never implies the empty space between.
pub fn published_chunk_coordinates(
    connection: &Connection,
    generation_id: &str,
    role: &str,
) -> Result<Vec<(i64, i64)>, String> {
    let mut statement = connection
        .prepare(
            "SELECT chunk_x, chunk_y FROM lidar_generation_chunks
             WHERE generation_id = ?1 AND role = ?2 AND state = 'published'
             ORDER BY chunk_y, chunk_x",
        )
        .map_err(|e| format!("Failed to list generation chunks: {e}"))?;
    statement
        .query_map(rusqlite::params![generation_id, role], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| format!("Failed to list generation chunks: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to list generation chunks: {e}"))
}

pub fn generation_chunk_extent(
    connection: &Connection,
    generation_id: &str,
    role: &str,
) -> Result<Option<(i64, i64, i64, i64)>, String> {
    connection
        .query_row(
            "SELECT MIN(chunk_x), MIN(chunk_y), MAX(chunk_x), MAX(chunk_y)
             FROM lidar_generation_chunks
             WHERE generation_id = ?1 AND role = ?2 AND state = 'published'",
            rusqlite::params![generation_id, role],
            |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            },
        )
        .map(|extent| match extent {
            (Some(x0), Some(y0), Some(x1), Some(y1)) => Some((x0, y0, x1, y1)),
            _ => None,
        })
        .map_err(|e| format!("Failed to read the generation extent: {e}"))
}

/// Cells actually occupied by one generation's published chunks.
///
/// This is the footprint an ordered member contributes to the admission
/// budget: the sum over stored chunks, not the rectangle those chunks happen to
/// span. Two chunks 8,000 cells apart cost two chunks, so the empty space
/// between separated sources is not charged. Only `result` chunks are counted;
/// a quality chunk describes the same cells rather than adding new ones, which
/// is the result/quality role deduplication the admission policy requires.
pub fn published_chunk_footprint(
    connection: &Connection,
    generation_id: &str,
    role: &str,
) -> Result<u64, String> {
    let cells: i64 = connection
        .query_row(
            "SELECT COALESCE(SUM(?3 * ?3), 0)
             FROM lidar_generation_chunks
             WHERE generation_id = ?1 AND role = ?2 AND state = 'published'",
            rusqlite::params![generation_id, role, super::generation::CHUNK_SIDE],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to read the published chunk footprint: {e}"))?;
    Ok(cells.max(0) as u64)
}

/// Ordered members of a collection snapshot, topmost first.
pub fn collection_members(
    connection: &Connection,
    generation_id: &str,
) -> Result<Vec<CollectionMemberRow>, String> {
    let mut statement = connection
        .prepare(
            "SELECT member_id, position, kind, interpretation_id, base_generation_id, job_id
             FROM lidar_collection_members WHERE generation_id = ?1 ORDER BY position",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([generation_id], |row| {
            Ok(CollectionMemberRow {
                member_id: row.get(0)?,
                position: row.get(1)?,
                kind: row.get(2)?,
                interpretation_id: row.get(3)?,
                base_generation_id: row.get(4)?,
                job_id: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Write one snapshot's ordered members, replacing any rows already recorded.
///
/// Only ever called inside the publication transaction that creates the
/// generation, so the rows and their head become visible together or not at
/// all.
pub fn replace_collection_members(
    connection: &Connection,
    generation_id: &str,
    members: &[CollectionMemberRow],
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM lidar_collection_members WHERE generation_id = ?1",
            [generation_id],
        )
        .map_err(|e| format!("Failed to clear collection members: {e}"))?;
    for member in members {
        connection
            .execute(
                "INSERT INTO lidar_collection_members(
                     generation_id, member_id, position, kind, interpretation_id,
                     base_generation_id, job_id, created_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    generation_id,
                    member.member_id,
                    member.position,
                    member.kind,
                    member.interpretation_id,
                    member.base_generation_id,
                    member.job_id,
                    now_iso(),
                ],
            )
            .map_err(|e| format!("Failed to record collection member: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Footprints (R-tree indexed candidate lookup)
// ---------------------------------------------------------------------------

pub fn upsert_footprint(
    connection: &Connection,
    interpretation_id: &str,
    layer_id: &str,
    bounds: [f64; 4],
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO lidar_source_footprints(interpretation_id, layer_id, min_x, max_x, min_y, max_y)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(layer_id, interpretation_id) DO UPDATE SET
                min_x = excluded.min_x, max_x = excluded.max_x,
                min_y = excluded.min_y, max_y = excluded.max_y",
            rusqlite::params![
                interpretation_id,
                layer_id,
                bounds[0],
                bounds[2],
                bounds[1],
                bounds[3]
            ],
        )
        .map_err(|e| format!("Failed to record footprint: {e}"))?;
    let rowid: i64 = connection
        .query_row(
            "SELECT id FROM lidar_source_footprints WHERE layer_id = ?1 AND interpretation_id = ?2",
            rusqlite::params![layer_id, interpretation_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?;
    // R-tree virtual tables do not support UPSERT; replace the shadow row.
    connection
        .execute("DELETE FROM lidar_footprint_rtree WHERE id = ?1", [rowid])
        .map_err(|e| format!("Failed to reindex footprint: {e}"))?;
    connection
        .execute(
            "INSERT INTO lidar_footprint_rtree(id, min_x, max_x, min_y, max_y)
             VALUES(?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![rowid, bounds[0], bounds[2], bounds[1], bounds[3]],
        )
        .map(|_| ())
        .map_err(|e| format!("Failed to index footprint: {e}"))
}

pub fn now_iso() -> String {
    // Unix milliseconds; identity fields are UUIDs, timestamps are ordering
    // hints only, so wall-clock precision is sufficient.
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{millis}")
}

static ID_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn new_id(prefix: &str) -> String {
    use std::sync::atomic::Ordering;
    let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    format!("{prefix}-{nanos:016x}{counter:04x}")
}

/// Replace one interpretation's paged occupied-region rows.
///
/// A re-scan replaces the previous page set atomically; individual pixels are
/// never stored here, only per-block aggregates. Consumed by the B2
/// publication caller tracked in `canopi-jv8a.4`; the allowance goes with it.
#[allow(dead_code)]
pub fn replace_interpretation_regions(
    connection: &Connection,
    interpretation_id: &str,
    regions: &[(i64, i64, i64, f64, f64, f64)],
) -> Result<(), String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start region replacement: {e}"))?;
    transaction
        .execute(
            "DELETE FROM lidar_interpretation_regions WHERE interpretation_id = ?1",
            [interpretation_id],
        )
        .map_err(|e| format!("Failed to clear interpretation regions: {e}"))?;
    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO lidar_interpretation_regions(
                    interpretation_id, block_x, block_y, valid_cells, min_value, max_value, sum_value)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| format!("Failed to prepare region insert: {e}"))?;
        for (block_x, block_y, valid_cells, min_value, max_value, sum_value) in regions {
            statement
                .execute(rusqlite::params![
                    interpretation_id,
                    block_x,
                    block_y,
                    valid_cells,
                    min_value,
                    max_value,
                    sum_value,
                ])
                .map_err(|e| format!("Failed to insert interpretation region: {e}"))?;
        }
    }
    transaction
        .commit()
        .map_err(|e| format!("Failed to commit interpretation regions: {e}"))
}

/// One ordered page of occupied-region rows.
#[allow(dead_code)]
/// One bounded page of a source's occupied regions, in `(block_y, block_x)`
/// order starting strictly after `after`.
///
/// The review walks occupied regions as an ordered stream, so it pages with a
/// keyset cursor: a page never re-reads or skips a row, and the index carries
/// the order.
/// Whether any committed catalogue row references one asset digest.
///
/// Promotion cleanup asks this before removing a file: a digest referenced as a
/// source payload *or* as a published generation/result chunk belongs to
/// accepted history and is never deleted, even when the promoting job's journal
/// still lists it. Ownership that cannot be established fails closed.
pub fn asset_reference_exists(connection: &Connection, sha256: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT 1 FROM lidar_interpretation_cogs WHERE asset_sha256 = ?1
             UNION ALL
             SELECT 1 FROM lidar_generation_chunks WHERE asset_sha256 = ?1
             LIMIT 1",
            [sha256],
            |_| Ok(()),
        )
        .optional()
        .map(|row| row.is_some())
        .map_err(|e| format!("Failed to read asset references: {e}"))
}

/// One stored region row, for tests that read the region index directly.
#[cfg(test)]
pub type InterpretationRegionRow = (i64, i64, i64, f64, f64, f64);

#[cfg(test)]
pub fn interpretation_region_page(
    connection: &Connection,
    interpretation_id: &str,
    offset: i64,
    limit: i64,
) -> Result<Vec<InterpretationRegionRow>, String> {
    let mut statement = connection
        .prepare(
            "SELECT block_x, block_y, valid_cells, min_value, max_value, sum_value
             FROM lidar_interpretation_regions
             WHERE interpretation_id = ?1
             ORDER BY block_x, block_y
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(|e| format!("Failed to prepare region page: {e}"))?;
    statement
        .query_map(rusqlite::params![interpretation_id, limit, offset], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, f64>(5)?,
            ))
        })
        .map_err(|e| format!("Failed to read region page: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read region page: {e}"))
}

/// One generation row by identity.
pub fn generation_row(
    connection: &Connection,
    generation_id: &str,
) -> Result<Option<GenerationRow>, String> {
    connection
        .query_row(
            "SELECT g.id, g.layer_id, g.mosaic_path, g.coverage_mask_path, g.manifest_json,
                    g.coverage_cells, g.min_value, g.max_value,
                    g.display_min_value, g.display_max_value, g.display_basis,
                    g.bounds_3857,
                    g.base_generation_id, g.previous_generation_id, g.undo_available
             FROM lidar_layer_generations g WHERE g.id = ?1",
            [generation_id],
            map_generation_row,
        )
        .optional()
        .map_err(|e| format!("Failed to read generation {generation_id}: {e}"))
}

/// The manifest of one sparse generation, checked against its owner.
///
/// A tile request names an entity and a generation; the join is what makes
/// "this generation belongs to this entity" a catalogue fact rather than a
/// caller's assumption.
pub fn chunked_generation_manifest(
    connection: &Connection,
    entity_kind: &str,
    entity_id: &str,
    generation_id: &str,
) -> Result<Option<String>, String> {
    let (table, owner_column) = match entity_kind {
        "source" => ("lidar_layer_generations", "layer_id"),
        "analysis" => ("lidar_analysis_generations", "definition_id"),
        other => return Err(format!("unknown raster entity kind {other}")),
    };
    // The table and column names come from this closed match, never from a
    // caller, and every bound value still travels as a placeholder.
    let sql = format!("SELECT manifest_json FROM {table} WHERE id = ?1 AND {owner_column} = ?2");
    connection
        .query_row(&sql, rusqlite::params![generation_id, entity_id], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|e| format!("Failed to read generation manifest: {e}"))
}

/// One published resolved-chunk reference.
#[derive(Debug, Clone, PartialEq)]
pub struct GenerationChunkRow {
    pub role: String,
    pub chunk_x: i64,
    pub chunk_y: i64,
    pub asset_sha256: String,
    pub valid_cells: i64,
    pub min_value: f64,
    pub max_value: f64,
    pub sum_value: f64,
}

/// Metadata of one immutable content-addressed raster asset.
///
/// `rel_path` stays relative to the library root so a catalogue stays valid
/// when the library is moved. Chunk rows reference the digest, so the asset
/// row must exist before any chunk row names it.
#[derive(Debug, Clone, PartialEq)]
pub struct RasterAssetRow {
    pub sha256: String,
    pub rel_path: String,
    pub bytes: i64,
    pub profile: String,
    pub width: i64,
    pub height: i64,
    pub geotransform: String,
    pub crs_wkt: String,
    pub nodata: Option<f64>,
}

/// The layer lattice every generation of that layer shares.
#[derive(Debug, Clone, PartialEq)]
pub struct LayerLatticeRow {
    pub origin_x: f64,
    pub origin_y: f64,
    pub pixel_x: f64,
    pub pixel_y: f64,
    pub crs_wkt: String,
}

/// Record a layer's lattice the first time it is known, and never move it.
///
/// An existing row always wins: a later import that extends the layer left or
/// up must not re-anchor it, or unchanged data would change chunk coordinates.
pub fn record_layer_lattice(
    connection: &Connection,
    layer_id: &str,
    lattice: &LayerLatticeRow,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO lidar_layer_lattices(
                layer_id, origin_x, origin_y, pixel_x, pixel_y, crs_wkt, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(layer_id) DO NOTHING",
            rusqlite::params![
                layer_id,
                lattice.origin_x,
                lattice.origin_y,
                lattice.pixel_x,
                lattice.pixel_y,
                lattice.crs_wkt,
                now_iso(),
            ],
        )
        .map_err(|e| format!("Failed to record layer lattice: {e}"))?;
    Ok(())
}

/// The layer's fixed lattice, when it has published anything yet.
pub fn layer_lattice(
    connection: &Connection,
    layer_id: &str,
) -> Result<Option<LayerLatticeRow>, String> {
    connection
        .query_row(
            "SELECT origin_x, origin_y, pixel_x, pixel_y, crs_wkt
             FROM lidar_layer_lattices WHERE layer_id = ?1",
            [layer_id],
            |row| {
                Ok(LayerLatticeRow {
                    origin_x: row.get(0)?,
                    origin_y: row.get(1)?,
                    pixel_x: row.get(2)?,
                    pixel_y: row.get(3)?,
                    crs_wkt: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to read layer lattice: {e}"))
}

/// One published chunk joined with the asset a reader must open.
#[derive(Debug, Clone, PartialEq)]
pub struct ChunkAssetRow {
    pub role: String,
    pub chunk_x: i64,
    pub chunk_y: i64,
    pub asset: RasterAssetRow,
    /// Stored valid count and exact f64 sum, so a minifying reader can use the
    /// chunk's mean without opening its file.
    pub aggregate_valid_cells: i64,
    pub aggregate_sum_value: f64,
}

/// Record asset metadata. Published assets are immutable, so an existing row
/// with the same digest is left untouched and never rewritten.
pub fn insert_raster_asset(connection: &Connection, asset: &RasterAssetRow) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO lidar_raster_assets(
                sha256, rel_path, bytes, profile, width, height, geotransform,
                crs_wkt, nodata, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(sha256) DO NOTHING",
            rusqlite::params![
                asset.sha256,
                asset.rel_path,
                asset.bytes,
                asset.profile,
                asset.width,
                asset.height,
                asset.geotransform,
                asset.crs_wkt,
                asset.nodata,
                now_iso(),
            ],
        )
        .map_err(|e| format!("Failed to record raster asset {}: {e}", asset.sha256))?;
    Ok(())
}

/// The retained standard COG of one prepared interpretation, when it has one,
/// together with the interpretation's own effective NoData rule.
pub fn interpretation_cog(
    connection: &Connection,
    interpretation_id: &str,
) -> Result<Option<(RasterAssetRow, Option<f64>)>, String> {
    connection
        .query_row(
            "SELECT a.sha256, a.rel_path, a.bytes, a.profile, a.width, a.height,
                    a.geotransform, a.crs_wkt, a.nodata, c.nodata
             FROM lidar_interpretation_cogs c
             JOIN lidar_raster_assets a ON a.sha256 = c.asset_sha256
             WHERE c.interpretation_id = ?1",
            [interpretation_id],
            |row| Ok((map_asset_row(row, 0)?, row.get(9)?)),
        )
        .optional()
        .map_err(|e| format!("Failed to read interpretation COG: {e}"))
}

fn map_asset_row(row: &rusqlite::Row<'_>, offset: usize) -> rusqlite::Result<RasterAssetRow> {
    Ok(RasterAssetRow {
        sha256: row.get(offset)?,
        rel_path: row.get(offset + 1)?,
        bytes: row.get(offset + 2)?,
        profile: row.get(offset + 3)?,
        width: row.get(offset + 4)?,
        height: row.get(offset + 5)?,
        geotransform: row.get(offset + 6)?,
        crs_wkt: row.get(offset + 7)?,
        nodata: row.get(offset + 8)?,
    })
}

/// Half-open lattice-cell bounds a paged chunk read must intersect.
///
/// The bounds are exact signed integers; a caller computes them with checked
/// arithmetic so an unrepresentable window is refused rather than truncated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChunkWindow {
    pub min_x: i64,
    pub max_x: i64,
    pub min_y: i64,
    pub max_y: i64,
}

impl ChunkWindow {
    /// Inclusive chunk-coordinate bounds covering a half-open cell window.
    ///
    /// Chunk side is `chunk_side` cells, so a chunk `c` covers
    /// `[c * side, c * side + side)`. It intersects `[start, end)` exactly when
    /// `c * side < end` and `c * side + side > start`, which is the inclusive
    /// range below. The conversion is exact for negative coordinates too.
    pub fn for_cells(
        start_x: i64,
        end_x: i64,
        start_y: i64,
        end_y: i64,
        chunk_side: i64,
    ) -> Result<Self, String> {
        if chunk_side <= 0 || end_x <= start_x || end_y <= start_y {
            return Err("chunk window has an empty or negative extent".to_string());
        }
        let last = |end: i64| -> Result<i64, String> {
            end.checked_sub(1)
                .map(|value| value.div_euclid(chunk_side))
                .ok_or_else(|| "chunk window bounds overflow".to_string())
        };
        Ok(Self {
            min_x: start_x.div_euclid(chunk_side),
            max_x: last(end_x)?,
            min_y: start_y.div_euclid(chunk_side),
            max_y: last(end_y)?,
        })
    }

    fn contains_columns(self) -> (i64, i64) {
        (self.min_x, self.max_x)
    }

    fn contains_rows(self) -> (i64, i64) {
        (self.min_y, self.max_y)
    }
}

/// Chunk-record projection shared by the paged, keyed and listed readers.
const CHUNK_ASSET_COLUMNS: &str = "SELECT g.role, g.chunk_x, g.chunk_y,
            a.sha256, a.rel_path, a.bytes, a.profile, a.width, a.height,
            a.geotransform, a.crs_wkt, a.nodata, g.valid_cells, g.sum_value
     FROM lidar_generation_chunks g
     JOIN lidar_raster_assets a ON a.sha256 = g.asset_sha256";

fn map_chunk_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChunkAssetRow> {
    Ok(ChunkAssetRow {
        role: row.get(0)?,
        chunk_x: row.get(1)?,
        chunk_y: row.get(2)?,
        asset: map_asset_row(row, 3)?,
        aggregate_valid_cells: row.get(12)?,
        aggregate_sum_value: row.get(13)?,
    })
}

/// One bounded page of published chunk references.
///
/// The page is ordered by `(chunk_y, chunk_x)` and starts strictly after
/// `after`, so a caller pages with a keyset cursor instead of an offset and
/// never re-reads or skips a row. When `window` is given, the spatial filter
/// runs in SQL before any row is loaded, so no absent coordinate is visited.
pub fn generation_chunk_page(
    connection: &Connection,
    generation_id: &str,
    role: &str,
    window: Option<ChunkWindow>,
    after: Option<(i64, i64)>,
    limit: usize,
) -> Result<Vec<ChunkAssetRow>, String> {
    let sql = format!(
        "{CHUNK_ASSET_COLUMNS}
     WHERE g.generation_id = ?1 AND g.role = ?2 AND g.state = 'published'
       AND (?3 IS NULL OR (g.chunk_x BETWEEN ?3 AND ?4 AND g.chunk_y BETWEEN ?5 AND ?6))
       AND (?7 IS NULL OR g.chunk_y > ?7 OR (g.chunk_y = ?7 AND g.chunk_x > ?8))
     ORDER BY g.chunk_y, g.chunk_x
     LIMIT ?9"
    );
    let (min_x, max_x, min_y, max_y) = match window {
        Some(window) => {
            let (min_x, max_x) = window.contains_columns();
            let (min_y, max_y) = window.contains_rows();
            (Some(min_x), Some(max_x), Some(min_y), Some(max_y))
        }
        None => (None, None, None, None),
    };
    let (after_y, after_x) = match after {
        Some((chunk_y, chunk_x)) => (Some(chunk_y), Some(chunk_x)),
        None => (None, None),
    };
    let mut statement = connection
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare chunk page query: {e}"))?;
    let rows = statement
        .query_map(
            rusqlite::params![
                generation_id,
                role,
                min_x,
                max_x,
                min_y,
                max_y,
                after_y,
                after_x,
                i64::try_from(limit).unwrap_or(i64::MAX),
            ],
            map_chunk_row,
        )
        .map_err(|e| format!("Failed to read chunk page: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read chunk page: {e}"))?;
    Ok(rows)
}

/// One published chunk reference by exact coordinate, when it exists.
pub fn generation_chunk_at(
    connection: &Connection,
    generation_id: &str,
    role: &str,
    chunk_x: i64,
    chunk_y: i64,
) -> Result<Option<ChunkAssetRow>, String> {
    let sql = format!(
        "{CHUNK_ASSET_COLUMNS}
     WHERE g.generation_id = ?1 AND g.role = ?2 AND g.chunk_x = ?3 AND g.chunk_y = ?4
       AND g.state = 'published'"
    );
    connection
        .query_row(
            &sql,
            rusqlite::params![generation_id, role, chunk_x, chunk_y],
            map_chunk_row,
        )
        .optional()
        .map_err(|e| format!("Failed to read chunk reference: {e}"))
}

/// Published chunk references of one generation and role, ordered by position.
///
/// Only `published` rows are selected: an unpublished row belongs to a job
/// that has not committed, so it must never be readable.
///
/// Test oracle only: production readers page through
/// [`generation_chunk_page`] and never load a generation's whole record set.
#[cfg(test)]
pub fn generation_chunk_assets(
    connection: &Connection,
    generation_id: &str,
    role: &str,
) -> Result<Vec<ChunkAssetRow>, String> {
    let sql = format!(
        "{CHUNK_ASSET_COLUMNS}
     WHERE g.generation_id = ?1 AND g.role = ?2 AND g.state = 'published'
     ORDER BY g.chunk_y, g.chunk_x"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare chunk asset query: {e}"))?;
    statement
        .query_map(rusqlite::params![generation_id, role], map_chunk_row)
        .map_err(|e| format!("Failed to read chunk assets: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read chunk assets: {e}"))
}

/// Drop chunk rows a job left behind before it committed a generation.
///
/// Unpublished rows are never readable, so removing them cannot revoke an
/// accepted generation. Only physical assets are left to reclamation.
pub fn discard_unpublished_chunks(connection: &Connection) -> Result<usize, String> {
    connection
        .execute(
            "DELETE FROM lidar_generation_chunks WHERE state != 'published'",
            [],
        )
        .map_err(|e| format!("Failed to discard unpublished chunk rows: {e}"))
}

/// Drop the unpublished chunk rows of one failed publication attempt.
pub fn discard_unpublished_generation_chunks(
    connection: &Connection,
    generation_id: &str,
) -> Result<usize, String> {
    connection
        .execute(
            "DELETE FROM lidar_generation_chunks WHERE generation_id = ?1 AND state != 'published'",
            [generation_id],
        )
        .map_err(|e| format!("Failed to discard unpublished chunk rows: {e}"))
}

/// Insert chunk references as unpublished rows beside their asset metadata.
///
/// Readers cannot select these rows until the generation's short publish
/// transaction flips them, so a crashed or cancelled job leaves no readable
/// index.
pub fn insert_unpublished_chunks(
    connection: &Connection,
    generation_id: &str,
    chunks: &[GenerationChunkRow],
) -> Result<(), String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start chunk insert: {e}"))?;
    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO lidar_generation_chunks(
                    generation_id, role, chunk_x, chunk_y, asset_sha256,
                    valid_cells, min_value, max_value, sum_value, state)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'unpublished')
                 ON CONFLICT(generation_id, role, chunk_x, chunk_y) DO UPDATE SET
                    asset_sha256 = excluded.asset_sha256,
                    valid_cells = excluded.valid_cells,
                    min_value = excluded.min_value,
                    max_value = excluded.max_value,
                    sum_value = excluded.sum_value,
                    state = 'unpublished'",
            )
            .map_err(|e| format!("Failed to prepare chunk insert: {e}"))?;
        for chunk in chunks {
            statement
                .execute(rusqlite::params![
                    generation_id,
                    chunk.role,
                    chunk.chunk_x,
                    chunk.chunk_y,
                    chunk.asset_sha256,
                    chunk.valid_cells,
                    chunk.min_value,
                    chunk.max_value,
                    chunk.sum_value,
                ])
                .map_err(|e| format!("Failed to insert chunk row: {e}"))?;
        }
    }
    transaction
        .commit()
        .map_err(|e| format!("Failed to commit chunk rows: {e}"))
}

/// Publish every chunk row of one generation inside the caller's transaction.
pub fn publish_generation_chunks(
    connection: &Connection,
    generation_id: &str,
) -> Result<usize, String> {
    connection
        .execute(
            "UPDATE lidar_generation_chunks SET state = 'published' WHERE generation_id = ?1",
            [generation_id],
        )
        .map_err(|e| format!("Failed to publish generation chunks: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rewrite a current catalogue into the v17 shape, for an upgrade test.
    ///
    /// SQLite cannot drop a column a CHECK constraint mentions, so the downgrade
    /// rebuilds the table the way v17 had it rather than editing it in place.
    #[cfg(test)]
    fn downgrade_generations_to_v17(connection: &rusqlite::Connection) {
        connection
            .execute_batch(
                "PRAGMA foreign_keys=OFF;
             CREATE TABLE lidar_layer_generations_v17 (
                 id TEXT PRIMARY KEY,
                 layer_id TEXT NOT NULL REFERENCES lidar_source_layers(id),
                 created_at TEXT NOT NULL,
                 mosaic_path TEXT,
                 coverage_mask_path TEXT,
                 manifest_json TEXT NOT NULL,
                 coverage_cells INTEGER NOT NULL,
                 min_value REAL,
                 max_value REAL,
                 bounds_3857 TEXT NOT NULL,
                 base_generation_id TEXT REFERENCES lidar_layer_generations(id),
                 previous_generation_id TEXT REFERENCES lidar_layer_generations(id),
                 undo_available INTEGER NOT NULL DEFAULT 0,
                 operation TEXT,
                 CHECK ((mosaic_path IS NULL) = (coverage_mask_path IS NULL))
             );
             INSERT INTO lidar_layer_generations_v17(
                 id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                 coverage_cells, min_value, max_value, bounds_3857,
                 base_generation_id, previous_generation_id, undo_available, operation)
             SELECT id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                    coverage_cells, min_value, max_value, bounds_3857,
                    base_generation_id, previous_generation_id, undo_available, operation
             FROM lidar_layer_generations;
             DROP TABLE lidar_layer_generations;
             ALTER TABLE lidar_layer_generations_v17 RENAME TO lidar_layer_generations;
             CREATE INDEX IF NOT EXISTS idx_layer_generations_layer
                 ON lidar_layer_generations(layer_id);
             UPDATE lidar_catalogue_meta SET value = '17' WHERE key = 'schema_version';
             PRAGMA foreign_keys=ON;",
            )
            .unwrap();
    }

    #[test]
    fn import_progress_is_monotonic_and_stops_with_the_job() {
        let dir = std::env::temp_dir().join(new_id("canopi-import-progress-test"));
        std::fs::create_dir_all(&dir).unwrap();
        let connection = open(&dir.join("catalogue.sqlite")).unwrap();
        connection
            .execute_batch(
                "INSERT INTO lidar_source_layers
                    (id, name, measurement_kind, units, created_at)
                 VALUES ('layer', 'Ground', 'ground-elevation', 'm', '0');
                 INSERT INTO lidar_import_jobs
                    (id, layer_id, state, created_at, updated_at,
                     progress_phase, progress_percent)
                 VALUES ('job', 'layer', 'applying', '0', '0',
                         'composing_layer', 0);",
            )
            .unwrap();

        assert!(update_import_progress(&connection, "job", "composing_layer", 10).unwrap());
        assert!(!update_import_progress(&connection, "job", "composing_layer", 9).unwrap());
        assert!(update_import_progress(&connection, "job", "rendering_map", 72).unwrap());
        let row = get_import_job(&connection, "job").unwrap().unwrap();
        assert_eq!(row.progress_phase.as_deref(), Some("rendering_map"));
        assert_eq!(row.progress_percent, Some(72));

        connection
            .execute(
                "UPDATE lidar_import_jobs SET state = 'complete', progress_percent = 100
                 WHERE id = 'job'",
                [],
            )
            .unwrap();
        assert!(!update_import_progress(&connection, "job", "rendering_map", 80).unwrap());
        assert_eq!(
            get_import_job(&connection, "job")
                .unwrap()
                .unwrap()
                .progress_percent,
            Some(100)
        );

        drop(connection);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn migration_repairs_legacy_footprint_uniqueness_and_is_idempotent() {
        let dir = std::env::temp_dir().join(new_id("canopi-footprint-migration-test"));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("catalogue.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE lidar_catalogue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            )
            .unwrap();
        connection.execute_batch(SCHEMA_V1).unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE lidar_source_footprints (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    interpretation_id TEXT NOT NULL UNIQUE REFERENCES lidar_interpretations(id),
                    layer_id TEXT NOT NULL,
                    min_x REAL NOT NULL,
                    max_x REAL NOT NULL,
                    min_y REAL NOT NULL,
                    max_y REAL NOT NULL
                );
                CREATE VIRTUAL TABLE lidar_footprint_rtree USING rtree(
                    id, min_x, max_x, min_y, max_y
                );
                ALTER TABLE lidar_acceptance_regions ADD COLUMN job_id TEXT;
                "#,
            )
            .unwrap();
        connection.execute_batch(SCHEMA_V3).unwrap();
        connection
            .execute(
                "ALTER TABLE lidar_generation_members ADD COLUMN job_id TEXT",
                [],
            )
            .unwrap();
        connection
            .execute_batch(
                "INSERT INTO lidar_sources
                    (sha256, original_filename, size_bytes, probe_json, imported_at)
                 VALUES ('sha', 'source', 1, '{}', '0');
                 INSERT INTO lidar_interpretations
                    (id, source_sha256, band_index, measurement_kind, units, scale, offset,
                     crs_wkt, vertical_ref, nodata, geotransform, width, height, interp_hash)
                 VALUES ('interp', 'sha', 1, 'ground-elevation', 'm', 1, 0,
                         'test', 'unknown', -9999, '[0,1,0,1,0,-1]', 1, 1, 'hash');
                 INSERT INTO lidar_source_footprints
                    (id, interpretation_id, layer_id, min_x, max_x, min_y, max_y)
                 VALUES (41, 'interp', 'layer-a', 0, 10, 0, 10);
                 INSERT INTO lidar_footprint_rtree(id, min_x, max_x, min_y, max_y)
                 VALUES (41, 0, 10, 0, 10);
                 INSERT INTO lidar_catalogue_meta(key, value)
                 VALUES ('schema_version', '4');",
            )
            .unwrap();

        let error =
            upsert_footprint(&connection, "interp", "layer-a", [1.0, 1.0, 9.0, 9.0]).unwrap_err();
        assert!(error.contains("ON CONFLICT clause"));
        drop(connection);

        let migrated = open(&path).unwrap();
        upsert_footprint(&migrated, "interp", "layer-a", [1.0, 1.0, 9.0, 9.0]).unwrap();
        upsert_footprint(&migrated, "interp", "layer-b", [20.0, 20.0, 30.0, 30.0]).unwrap();
        assert_eq!(
            migrated
                .query_row("SELECT COUNT(*) FROM lidar_source_footprints", [], |row| {
                    row.get::<_, i64>(0)
                },)
                .unwrap(),
            2
        );
        assert_eq!(
            migrated
                .query_row(
                    "SELECT id FROM lidar_source_footprints
                     WHERE layer_id = 'layer-a' AND interpretation_id = 'interp'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            41
        );
        assert_eq!(
            migrated
                .query_row("SELECT COUNT(*) FROM lidar_footprint_rtree", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            2
        );
        drop(migrated);

        let reopened = open(&path).unwrap();
        let version: String = reopened
            .query_row(
                "SELECT value FROM lidar_catalogue_meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, CATALOGUE_VERSION.to_string());
        assert_eq!(
            reopened
                .query_row("SELECT COUNT(*) FROM lidar_source_footprints", [], |row| {
                    row.get::<_, i64>(0)
                },)
                .unwrap(),
            2
        );
        drop(reopened);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn migration_recovers_an_unversioned_v2_column_and_commits_followups_atomically() {
        let dir = std::env::temp_dir().join(new_id("canopi-migration-test"));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("catalogue.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE lidar_catalogue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            )
            .unwrap();
        connection.execute_batch(SCHEMA_V1).unwrap();
        connection
            .execute(
                "INSERT INTO lidar_catalogue_meta(key, value) VALUES('schema_version', '1')",
                [],
            )
            .unwrap();
        // Simulate the old migration failing after its ALTER but before it
        // advanced the version marker.
        connection
            .execute(
                "ALTER TABLE lidar_acceptance_regions ADD COLUMN job_id TEXT",
                [],
            )
            .unwrap();
        drop(connection);

        let reopened = open(&path).unwrap();
        let version: String = reopened
            .query_row(
                "SELECT value FROM lidar_catalogue_meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, CATALOGUE_VERSION.to_string());
        assert!(table_has_column(&reopened, "lidar_acceptance_regions", "job_id",).unwrap());
        assert!(table_has_column(&reopened, "lidar_generation_members", "job_id",).unwrap());
        assert!(table_has_column(&reopened, "lidar_import_jobs", "progress_phase").unwrap());
        assert!(table_has_column(&reopened, "lidar_import_jobs", "progress_percent").unwrap());
        drop(reopened);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn generation_order_allows_the_same_interpretation_to_be_reimported() {
        let dir = std::env::temp_dir().join(new_id("canopi-reimport-test"));
        std::fs::create_dir_all(&dir).unwrap();
        let connection = open(&dir.join("catalogue.sqlite")).unwrap();
        connection
            .execute_batch(
                "INSERT INTO lidar_sources
             (sha256, original_filename, size_bytes, probe_json, imported_at)
             VALUES ('sha', 'source', 1, '{}', '0');
             INSERT INTO lidar_interpretations
             (id, source_sha256, band_index, measurement_kind, units, scale, offset,
              crs_wkt, vertical_ref, nodata, geotransform, width, height, interp_hash)
             VALUES ('interp', 'sha', 1, 'ground-elevation', 'm', 1, 0,
                     'test', 'unknown', -9999, '[0,1,0,1,0,-1]', 1, 1, 'hash');
             INSERT INTO lidar_source_layers
             (id, name, measurement_kind, units, created_at)
             VALUES ('layer', 'Layer', 'ground-elevation', 'm', '0');
             INSERT INTO lidar_layer_generations
             (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
              coverage_cells, min_value, max_value, bounds_3857)
             VALUES ('generation', 'layer', '0', '', '', '{}', 1, 0, 1, '[0,0,1,1]');
             INSERT INTO lidar_generation_members
             (generation_id, interpretation_id, role, ordinal)
             VALUES ('generation', 'interp', 'add', 0);
             INSERT INTO lidar_generation_members
             (generation_id, interpretation_id, role, ordinal)
             VALUES ('generation', 'interp', 'replace', 1);",
            )
            .unwrap();

        assert_eq!(
            generation_members(&connection, "generation").unwrap(),
            vec![
                ("interp".to_string(), "add".to_string(), None),
                ("interp".to_string(), "replace".to_string(), None),
            ]
        );
        drop(connection);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn v6_catalogue_is_backed_up_and_migrated_to_current() {
        let root = std::env::temp_dir().join(new_id("canopi-catalogue-v7"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("lidar-library.sqlite");
        {
            let connection = open(&path).expect("fresh catalogue opens");
            let version: String = connection
                .query_row(
                    "SELECT value FROM lidar_catalogue_meta WHERE key = 'schema_version'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(version, CATALOGUE_VERSION.to_string());
        }
        // Present the same file as a v6 catalogue without its v7 tables.
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "DROP TABLE lidar_generation_chunks;
                     DROP TABLE lidar_interpretation_regions;
                     DROP TABLE lidar_interpretation_cogs;
                     DROP TABLE lidar_raster_assets;
                     UPDATE lidar_catalogue_meta SET value = '6' WHERE key = 'schema_version';",
                )
                .unwrap();
        }
        let connection = open(&path).expect("v6 catalogue migrates");
        assert_eq!(schema_version(&connection).unwrap(), CATALOGUE_VERSION);
        for table in [
            "lidar_raster_assets",
            "lidar_interpretation_cogs",
            "lidar_generation_chunks",
            "lidar_interpretation_regions",
        ] {
            let found: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(found, 1, "{table} exists after migration");
        }
        let backup: String = connection
            .query_row(
                "SELECT value FROM lidar_catalogue_meta WHERE key = 'last_backup_path'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let backup_path = std::path::Path::new(&backup);
        assert!(backup_path.exists(), "backup {backup} exists");
        // The backup is itself a complete readable catalogue at the old version.
        let backed_up = Connection::open(backup_path).unwrap();
        assert_eq!(schema_version(&backed_up).unwrap(), 6);
        drop(backed_up);
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn v7_catalogue_gains_nullable_dense_paths_without_losing_rows() {
        let root = std::env::temp_dir().join(new_id("canopi-catalogue-v8"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("lidar-library.sqlite");
        {
            let connection = open(&path).expect("fresh catalogue opens");
            connection
                .execute_batch(
                    "INSERT INTO lidar_sources
                        (sha256, original_filename, size_bytes, probe_json, imported_at)
                     VALUES ('sha', 'source.tif', 4, '{}', '0');
                     INSERT INTO lidar_interpretations
                        (id, source_sha256, band_index, measurement_kind, units, scale, offset,
                         crs_wkt, vertical_ref, nodata, geotransform, width, height, interp_hash)
                     VALUES ('interp', 'sha', 1, 'ground-elevation', 'm', 1, 0,
                             'EPSG:3857', 'unknown', -9999, '[0,1,0,45,0,-1]', 60, 45, 'hash');
                     INSERT INTO lidar_source_layers
                        (id, name, measurement_kind, units, created_at)
                     VALUES ('layer', 'Layer', 'ground-elevation', 'm', '0');
                     INSERT INTO lidar_layer_generations
                        (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                         coverage_cells, min_value, max_value, bounds_3857)
                     VALUES ('generation', 'layer', '0', '/library/gen-1/mosaic.tif',
                             '/library/gen-1/coverage.bin', '{\"format\":\"legacy-dense-v1\"}',
                             12, -1, 9, '[0,0,1,1]');
                     INSERT INTO lidar_generation_members
                        (generation_id, interpretation_id, role, ordinal, job_id)
                     VALUES ('generation', 'interp', 'add', 0, 'job');
                     INSERT INTO lidar_layer_heads(layer_id, generation_id)
                     VALUES ('layer', 'generation');",
                )
                .unwrap();
        }
        // Present the same file as a v7 catalogue with the old NOT NULL paths.
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "PRAGMA foreign_keys=OFF;
                     ALTER TABLE lidar_layer_generations RENAME TO lidar_layer_generations_v8;
                     CREATE TABLE lidar_layer_generations (
                        id TEXT PRIMARY KEY,
                        layer_id TEXT NOT NULL REFERENCES lidar_source_layers(id),
                        created_at TEXT NOT NULL,
                        mosaic_path TEXT NOT NULL,
                        coverage_mask_path TEXT NOT NULL,
                        manifest_json TEXT NOT NULL,
                        coverage_cells INTEGER NOT NULL,
                        min_value REAL,
                        max_value REAL,
                        bounds_3857 TEXT NOT NULL
                     );
                     INSERT INTO lidar_layer_generations(
                        id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                        coverage_cells, min_value, max_value, bounds_3857)
                     SELECT id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                            coverage_cells, min_value, max_value, bounds_3857
                     FROM lidar_layer_generations_v8;
                     DROP TABLE lidar_layer_generations_v8;
                     CREATE INDEX IF NOT EXISTS idx_layer_generations_layer
                        ON lidar_layer_generations(layer_id);
                     UPDATE lidar_catalogue_meta SET value = '7' WHERE key = 'schema_version';",
                )
                .unwrap();
        }

        let connection = open(&path).expect("v7 catalogue migrates");
        assert_eq!(schema_version(&connection).unwrap(), CATALOGUE_VERSION);
        // The preserved generation keeps its identity, paths and history.
        let (mosaic, coverage, cells): (Option<String>, Option<String>, i64) = connection
            .query_row(
                "SELECT mosaic_path, coverage_mask_path, coverage_cells
                 FROM lidar_layer_generations WHERE id = 'generation'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(mosaic.as_deref(), Some("/library/gen-1/mosaic.tif"));
        assert_eq!(coverage.as_deref(), Some("/library/gen-1/coverage.bin"));
        assert_eq!(cells, 12);
        assert_eq!(
            generation_members(&connection, "generation").unwrap(),
            vec![(
                "interp".to_string(),
                "add".to_string(),
                Some("job".to_string())
            )]
        );
        assert_eq!(
            head_generation(&connection, "layer")
                .unwrap()
                .expect("head survives")
                .id,
            "generation"
        );
        // A sparse generation may now own no dense file at all.
        connection
            .execute(
                "INSERT INTO lidar_layer_generations
                    (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                     coverage_cells, min_value, max_value, bounds_3857)
                 VALUES ('sparse', 'layer', '1', NULL, NULL, '{}', 0, 0, 0, '[0,0,1,1]')",
                [],
            )
            .unwrap();
        // ... but never half a pair.
        let half = connection.execute(
            "INSERT INTO lidar_layer_generations
                (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                 coverage_cells, min_value, max_value, bounds_3857)
             VALUES ('half', 'layer', '2', '/only/mosaic.tif', NULL, '{}', 0, 0, 0, '[0,0,1,1]')",
            [],
        );
        assert!(half.is_err(), "a lone dense path is rejected");

        let backup: String = connection
            .query_row(
                "SELECT value FROM lidar_catalogue_meta WHERE key = 'last_backup_path'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let backup_path = std::path::Path::new(&backup);
        assert!(backup_path.exists(), "backup {backup} exists");
        let backed_up = Connection::open(backup_path).unwrap();
        assert_eq!(schema_version(&backed_up).unwrap(), 7);
        drop(backed_up);
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn v8_catalogue_gains_nullable_analysis_result_paths() {
        let root = std::env::temp_dir().join(new_id("canopi-catalogue-v9"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("lidar-library.sqlite");
        {
            let connection = open(&path).expect("fresh catalogue opens");
            connection
                .execute_batch(
                    "INSERT INTO lidar_source_layers
                        (id, name, measurement_kind, units, created_at)
                     VALUES ('layer', 'Layer', 'ground-elevation', 'm', '0');
                     INSERT INTO lidar_analysis_definitions
                        (id, layer_id, kind, version, parameters_json, created_at)
                     VALUES ('definition', 'layer', 'slope', 1, '{}', '0');
                     INSERT INTO lidar_analysis_generations
                        (id, definition_id, source_generation_id, engine_version, state,
                         result_path, quality_mask_path, manifest_json, coverage_cells,
                         min_value, max_value, bounds_3857, published_at)
                     VALUES ('analysis-generation', 'definition', 'source-generation', '3.8',
                             'ready', '/library/agen-1/result.tif',
                             '/library/agen-1/quality.bin',
                             '{\"format\":\"legacy-dense-v1\"}', 12, -1, 9, '[0,0,1,1]', '0');
                     INSERT INTO lidar_analysis_heads(definition_id, generation_id)
                     VALUES ('definition', 'analysis-generation');",
                )
                .unwrap();
        }
        // Present the same file as a v8 catalogue with the old NOT NULL column.
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "PRAGMA foreign_keys=OFF;
                     ALTER TABLE lidar_analysis_generations
                        RENAME TO lidar_analysis_generations_v9;
                     CREATE TABLE lidar_analysis_generations (
                        id TEXT PRIMARY KEY,
                        definition_id TEXT NOT NULL REFERENCES lidar_analysis_definitions(id),
                        source_generation_id TEXT NOT NULL,
                        engine_version TEXT NOT NULL,
                        state TEXT NOT NULL,
                        result_path TEXT NOT NULL,
                        quality_mask_path TEXT,
                        manifest_json TEXT NOT NULL,
                        coverage_cells INTEGER NOT NULL,
                        min_value REAL,
                        max_value REAL,
                        bounds_3857 TEXT NOT NULL,
                        published_at TEXT NOT NULL
                     );
                     INSERT INTO lidar_analysis_generations(
                        id, definition_id, source_generation_id, engine_version, state,
                        result_path, quality_mask_path, manifest_json, coverage_cells,
                        min_value, max_value, bounds_3857, published_at)
                     SELECT id, definition_id, source_generation_id, engine_version, state,
                            result_path, quality_mask_path, manifest_json, coverage_cells,
                            min_value, max_value, bounds_3857, published_at
                     FROM lidar_analysis_generations_v9;
                     DROP TABLE lidar_analysis_generations_v9;
                     CREATE INDEX IF NOT EXISTS idx_analysis_generations_definition
                        ON lidar_analysis_generations(definition_id);
                     UPDATE lidar_catalogue_meta SET value = '8' WHERE key = 'schema_version';",
                )
                .unwrap();
        }

        let connection = open(&path).expect("v8 catalogue migrates");
        assert_eq!(schema_version(&connection).unwrap(), CATALOGUE_VERSION);
        let (result, quality, cells): (Option<String>, Option<String>, i64) = connection
            .query_row(
                "SELECT result_path, quality_mask_path, coverage_cells
                 FROM lidar_analysis_generations WHERE id = 'analysis-generation'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(result.as_deref(), Some("/library/agen-1/result.tif"));
        assert_eq!(quality.as_deref(), Some("/library/agen-1/quality.bin"));
        assert_eq!(cells, 12);
        assert_eq!(
            connection
                .query_row(
                    "SELECT generation_id FROM lidar_analysis_heads WHERE definition_id = 'definition'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "analysis-generation"
        );
        // A sparse result owns neither path...
        connection
            .execute(
                "INSERT INTO lidar_analysis_generations
                    (id, definition_id, source_generation_id, engine_version, state,
                     result_path, quality_mask_path, manifest_json, coverage_cells,
                     min_value, max_value, bounds_3857, published_at)
                 VALUES ('sparse', 'definition', 'source-generation', '3.8', 'ready',
                         NULL, NULL, '{}', 0, 0, 0, '[0,0,1,1]', '1')",
                [],
            )
            .unwrap();
        // ... but never a dense quality mask without a dense result.
        let half = connection.execute(
            "INSERT INTO lidar_analysis_generations
                (id, definition_id, source_generation_id, engine_version, state,
                 result_path, quality_mask_path, manifest_json, coverage_cells,
                 min_value, max_value, bounds_3857, published_at)
             VALUES ('half', 'definition', 'source-generation', '3.8', 'ready',
                     NULL, '/only/quality.bin', '{}', 0, 0, 0, '[0,0,1,1]', '2')",
            [],
        );
        assert!(half.is_err(), "quality without a dense result is rejected");

        let backup: String = connection
            .query_row(
                "SELECT value FROM lidar_catalogue_meta WHERE key = 'last_backup_path'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let backed_up = Connection::open(std::path::Path::new(&backup)).unwrap();
        assert_eq!(schema_version(&backed_up).unwrap(), 8);
        drop(backed_up);
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn v9_catalogue_gains_the_layer_lattice_and_never_moves_it() {
        let root = std::env::temp_dir().join(new_id("canopi-catalogue-v10"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("lidar-library.sqlite");
        {
            let connection = open(&path).expect("fresh catalogue opens");
            connection
                .execute_batch(
                    "INSERT INTO lidar_source_layers
                        (id, name, measurement_kind, units, created_at)
                     VALUES ('layer', 'Layer', 'ground-elevation', 'm', '0');
                     DROP TABLE lidar_layer_lattices;
                     UPDATE lidar_catalogue_meta SET value = '9' WHERE key = 'schema_version';",
                )
                .unwrap();
        }

        let connection = open(&path).expect("v9 catalogue migrates");
        assert_eq!(schema_version(&connection).unwrap(), CATALOGUE_VERSION);
        let first = LayerLatticeRow {
            origin_x: 0.0,
            origin_y: 1000.0,
            pixel_x: 1.0,
            pixel_y: -1.0,
            crs_wkt: "EPSG:3857".to_string(),
        };
        record_layer_lattice(&connection, "layer", &first).unwrap();
        assert_eq!(
            layer_lattice(&connection, "layer").unwrap(),
            Some(first.clone())
        );
        // A later import that extends the layer left or up records nothing:
        // the anchor is fixed for the layer's whole history.
        let moved = LayerLatticeRow {
            origin_x: -500.0,
            ..first.clone()
        };
        record_layer_lattice(&connection, "layer", &moved).unwrap();
        assert_eq!(
            layer_lattice(&connection, "layer").unwrap(),
            Some(first),
            "an existing lattice is never replaced"
        );
        // Deleting the layer takes its lattice with it.
        connection
            .execute("DELETE FROM lidar_source_layers WHERE id = 'layer'", [])
            .unwrap();
        assert_eq!(layer_lattice(&connection, "layer").unwrap(), None);
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }

    /// v16: Undo state and the recorded operation, and the migration boundary.
    ///
    /// v15 recorded which snapshot a change replaced but not whether that
    /// snapshot had anything left to undo, and it inferred the operation from
    /// member identities. A migrated library therefore keeps every version and
    /// its explicit Restore, gets a neutral operation label, and takes its
    /// current head as the new Undo baseline instead of a fabricated chain.
    /// A v17 catalogue moves to v18 without losing a row or a value.
    ///
    /// The upgrade relaxes exact coverage to nullable and adds the display
    /// range. An existing generation already has exact facts, so it keeps them
    /// and is labelled `exact`; the display range starts equal to them, which is
    /// what makes the upgraded library render exactly as it did before.
    #[test]
    fn v18_catalogue_keeps_exact_facts_and_labels_the_display_range() {
        let root = std::env::temp_dir().join(new_id("canopi-catalogue-v18"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("lidar-library.sqlite");
        {
            let connection = open(&path).expect("fresh catalogue opens");
            connection
                .execute_batch(
                    "INSERT INTO lidar_source_layers
                        (id, name, measurement_kind, units, created_at)
                     VALUES ('layer', 'Layer', 'ground-elevation', 'm', '0');
                     INSERT INTO lidar_layer_generations
                        (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                         coverage_cells, min_value, max_value, bounds_3857)
                     VALUES ('with-range', 'layer', '0', '/library/a/mosaic.tif',
                             '/library/a/coverage.bin', '{}', 12, -3.5, 11.25, '[0,0,1,1]');
                     INSERT INTO lidar_layer_generations
                        (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                         coverage_cells, min_value, max_value, bounds_3857)
                     VALUES ('no-range', 'layer', '1', '/library/b/mosaic.tif',
                             '/library/b/coverage.bin', '{}', 4, NULL, NULL, '[0,0,1,1]');
                     INSERT INTO lidar_layer_heads(layer_id, generation_id)
                     VALUES ('layer', 'with-range');",
                )
                .unwrap();
            downgrade_generations_to_v17(&connection);
        }

        let connection = open(&path).expect("v17 catalogue migrates");
        assert_eq!(schema_version(&connection).unwrap(), CATALOGUE_VERSION);
        let with_range = generation_row(&connection, "with-range")
            .unwrap()
            .expect("the measured generation survives");
        assert_eq!(with_range.coverage_cells, Some(12));
        assert_eq!(with_range.min_value, Some(-3.5));
        assert_eq!(with_range.max_value, Some(11.25));
        let (display_min, display_max, basis) = connection
            .query_row(
                "SELECT display_min_value, display_max_value, display_basis
                 FROM lidar_layer_generations WHERE id = 'with-range'",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<f64>>(0)?,
                        row.get::<_, Option<f64>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(display_min, Some(-3.5));
        assert_eq!(display_max, Some(11.25));
        assert_eq!(basis.as_deref(), Some("exact"));

        // A generation that never had a range keeps none: the migration must not
        // invent a display domain it cannot justify.
        let (display_min, display_max, basis) = connection
            .query_row(
                "SELECT display_min_value, display_max_value, display_basis
                 FROM lidar_layer_generations WHERE id = 'no-range'",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<f64>>(0)?,
                        row.get::<_, Option<f64>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(display_min, None);
        assert_eq!(display_max, None);
        assert_eq!(basis, None);
        assert_eq!(
            generation_row(&connection, "no-range")
                .unwrap()
                .expect("the unmeasured generation survives")
                .coverage_cells,
            Some(4)
        );
        // The head still names the generation it named before the rebuild.
        assert_eq!(
            head_generation(&connection, "layer")
                .unwrap()
                .map(|row| row.id),
            Some("with-range".to_string())
        );
        drop(connection);

        // Re-running the upgrade on an already-current catalogue is a no-op.
        let reopened = open(&path).expect("a current catalogue reopens");
        assert_eq!(schema_version(&reopened).unwrap(), CATALOGUE_VERSION);
        assert_eq!(
            generation_row(&reopened, "with-range")
                .unwrap()
                .expect("the generation is still there")
                .coverage_cells,
            Some(12)
        );
    }

    /// The v19 upgrade (fixed library items) keeps every identity, parameter
    /// and saved result, backs the old catalogue up first, and retires only
    /// automatic refresh attempts that never replaced a saved result. A
    /// failed first calculation keeps its explicit Retry.
    #[test]
    fn v19_upgrade_keeps_results_and_retires_only_refresh_attempts() {
        let root = std::env::temp_dir().join(new_id("canopi-catalogue-v19"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("lidar-library.sqlite");
        {
            let connection = open(&path).expect("fresh catalogue opens");
            connection
                .execute_batch(
                    "INSERT INTO lidar_source_layers
                        (id, name, measurement_kind, units, created_at)
                     VALUES ('layer', 'Layer', 'ground-elevation', 'm', '0');
                     INSERT INTO lidar_layer_generations
                        (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                         coverage_cells, min_value, max_value, bounds_3857)
                     VALUES ('gen-a', 'layer', '0', NULL, NULL, '{}', 1, 0, 1, '[0,0,1,1]');
                     INSERT INTO lidar_layer_heads(layer_id, generation_id) VALUES ('layer', 'gen-a');
                     INSERT INTO lidar_analysis_definitions
                        (id, layer_id, kind, version, parameters_json, created_at)
                     VALUES ('adef-saved', 'layer', 'slope', 1, '{\"slope_unit\":\"Percent\"}', '0'),
                            ('adef-first', 'layer', 'slope', 1, '{}', '0');
                     INSERT INTO lidar_analysis_generations
                        (id, definition_id, source_generation_id, engine_version, state, result_path,
                         quality_mask_path, manifest_json, coverage_cells, min_value, max_value,
                         bounds_3857, published_at)
                     VALUES ('agen-saved', 'adef-saved', 'gen-a', 'GDAL 3.8', 'complete', '', NULL,
                             '{}', 1, 0, 1, '[0,0,1,1]', '0');
                     INSERT INTO lidar_analysis_heads(definition_id, generation_id)
                     VALUES ('adef-saved', 'agen-saved');
                     INSERT INTO lidar_analysis_jobs
                        (id, definition_id, source_generation_id, state, message, created_at, updated_at)
                     VALUES ('job-refresh', 'adef-saved', 'gen-a', 'failed', 'refresh failed', '1', '1'),
                            ('job-first', 'adef-first', 'gen-a', 'failed', 'first failed', '1', '1');
                     INSERT INTO lidar_import_jobs(id, layer_id, state, created_at, updated_at)
                     VALUES ('imp-a', 'layer', 'complete', '0', '0');
                     ALTER TABLE lidar_import_jobs DROP COLUMN request_json;
                     ALTER TABLE lidar_analysis_generations DROP COLUMN method_id;
                     ALTER TABLE lidar_analysis_generations DROP COLUMN recipe_version;
                     UPDATE lidar_catalogue_meta SET value = '18' WHERE key = 'schema_version';",
                )
                .unwrap();
        }

        let connection = open(&path).expect("the v18 catalogue migrates");
        assert_eq!(schema_version(&connection).unwrap(), 19);
        let backup: String = connection
            .query_row(
                "SELECT value FROM lidar_catalogue_meta WHERE key = 'last_backup_path'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(backup.contains(".backup-v18-"), "{backup}");
        let backed_up = Connection::open(&backup).unwrap();
        assert_eq!(
            schema_version(&backed_up).unwrap(),
            18,
            "the backup keeps the old shape"
        );

        let job = |id: &str| -> (String, Option<String>) {
            connection
                .query_row(
                    "SELECT state, message FROM lidar_analysis_jobs WHERE id = ?1",
                    [id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap()
        };
        assert_eq!(job("job-refresh").0, "retired");
        assert_eq!(
            job("job-first"),
            ("failed".to_string(), Some("first failed".to_string()))
        );
        let definitions: Vec<(String, i64, String)> = {
            let mut statement = connection
                .prepare("SELECT id, version, parameters_json FROM lidar_analysis_definitions ORDER BY id")
                .unwrap();
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(
            definitions,
            [
                ("adef-first".to_string(), 1, "{}".to_string()),
                (
                    "adef-saved".to_string(),
                    1,
                    "{\"slope_unit\":\"Percent\"}".to_string()
                ),
            ],
            "existing definitions stay recipe version 1 with their parameters"
        );
        assert_eq!(
            head_analysis_generation(&connection, "adef-saved")
                .unwrap()
                .map(|row| row.id),
            Some("agen-saved".to_string())
        );
        for (table, column) in [
            ("lidar_import_jobs", "request_json"),
            ("lidar_analysis_generations", "method_id"),
            ("lidar_analysis_generations", "recipe_version"),
        ] {
            assert!(
                table_has_column(&connection, table, column).unwrap(),
                "{table}.{column}"
            );
        }
        // An older binary refuses any schema above its own through the same
        // guard the `newer than supported` test exercises, so recording 19
        // is what stops a v18 build from mutating fixed sources.
        drop(connection);
        drop(backed_up);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A failed v18 upgrade leaves the v17 catalogue exactly as it was.
    ///
    /// The rebuild drops and recreates the generation table, so a failure part
    /// way through would be the worst kind of damage if the version and the rows
    /// did not travel in the same transaction. The obstacle below makes the new
    /// table's creation fail; the version must stay at 17 and every row must
    /// still be readable.
    #[test]
    fn an_interrupted_v18_upgrade_rolls_back_and_keeps_the_old_catalogue() {
        let root = std::env::temp_dir().join(new_id("canopi-catalogue-v18-rollback"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("lidar-library.sqlite");
        {
            let connection = open(&path).expect("fresh catalogue opens");
            connection
                .execute_batch(
                    "INSERT INTO lidar_source_layers
                        (id, name, measurement_kind, units, created_at)
                     VALUES ('layer', 'Layer', 'ground-elevation', 'm', '0');
                     INSERT INTO lidar_layer_generations
                        (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                         coverage_cells, min_value, max_value, bounds_3857)
                     VALUES ('kept', 'layer', '0', '/library/a/mosaic.tif',
                             '/library/a/coverage.bin', '{}', 7, 1.5, 9.5, '[0,0,1,1]');
                     INSERT INTO lidar_layer_heads(layer_id, generation_id)
                     VALUES ('layer', 'kept');",
                )
                .unwrap();
            downgrade_generations_to_v17(&connection);
            connection
                .execute_batch("CREATE TABLE lidar_layer_generations_v18 (id TEXT PRIMARY KEY);")
                .unwrap();
        }

        assert!(
            open(&path).is_err(),
            "a migration that cannot build the new table must fail loudly"
        );

        {
            // The schema is still v17, so the row is read through that shape:
            // the point is that the rebuild left the catalogue intact, not that
            // a newer reader can open an older file.
            let connection = rusqlite::Connection::open(&path).unwrap();
            assert_eq!(
                schema_version(&connection).unwrap(),
                17,
                "the version must not advance past a failed upgrade"
            );
            let (cells, min, max) = connection
                .query_row(
                    "SELECT coverage_cells, min_value, max_value
                     FROM lidar_layer_generations WHERE id = 'kept'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, f64>(1)?,
                            row.get::<_, f64>(2)?,
                        ))
                    },
                )
                .expect("the row survives the rolled-back rebuild");
            assert_eq!(cells, 7);
            assert_eq!(min, 1.5);
            assert_eq!(max, 9.5);
            let head: String = connection
                .query_row(
                    "SELECT h.generation_id FROM lidar_layer_heads h WHERE h.layer_id = 'layer'",
                    [],
                    |row| row.get(0),
                )
                .expect("the head survives too");
            assert_eq!(head, "kept");
        }

        // And the catalogue is still migratable once the obstacle is gone.
        {
            let connection = rusqlite::Connection::open(&path).unwrap();
            connection
                .execute_batch("DROP TABLE lidar_layer_generations_v18;")
                .unwrap();
        }
        let reopened = open(&path).expect("the obstacle is gone and the upgrade can retry");
        assert_eq!(schema_version(&reopened).unwrap(), CATALOGUE_VERSION);
        let kept = generation_row(&reopened, "kept")
            .unwrap()
            .expect("the row survives the retried upgrade");
        assert_eq!(kept.coverage_cells, Some(7));
        assert_eq!(kept.display_basis.as_deref(), Some("exact"));
    }

    #[test]
    fn v15_catalogue_migrates_to_an_explicit_undo_baseline() {
        let root = std::env::temp_dir().join(new_id("canopi-catalogue-v16"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("lidar-library.sqlite");
        {
            let connection = open(&path).expect("fresh catalogue opens");
            connection
                .execute_batch(
                    "INSERT INTO lidar_source_layers
                        (id, name, measurement_kind, units, created_at)
                     VALUES ('layer', 'Layer', 'ground-elevation', 'm', '0');
                     INSERT INTO lidar_layer_generations
                        (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                         coverage_cells, min_value, max_value, bounds_3857)
                     VALUES ('older', 'layer', '0', '/library/older/mosaic.tif',
                             '/library/older/coverage.bin', '{}', 1, 0, 1, '[0,0,1,1]');
                     INSERT INTO lidar_layer_generations
                        (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                         coverage_cells, min_value, max_value, bounds_3857, previous_generation_id)
                     VALUES ('newer', 'layer', '1', '/library/newer/mosaic.tif',
                             '/library/newer/coverage.bin', '{}', 1, 0, 1, '[0,0,1,1]', 'older');
                     INSERT INTO lidar_layer_heads(layer_id, generation_id)
                     VALUES ('layer', 'newer');
                     ALTER TABLE lidar_layer_generations DROP COLUMN operation;
                     ALTER TABLE lidar_layer_generations DROP COLUMN undo_available;
                     UPDATE lidar_catalogue_meta SET value = '15' WHERE key = 'schema_version';",
                )
                .unwrap();
        }

        let connection = open(&path).expect("v15 catalogue migrates");
        assert_eq!(schema_version(&connection).unwrap(), CATALOGUE_VERSION);
        // Every version survives with its values and its Restore capability.
        let older = generation_row(&connection, "older")
            .unwrap()
            .expect("the older version survives");
        let newer = generation_row(&connection, "newer")
            .unwrap()
            .expect("the newer version survives");
        assert_eq!(
            older.mosaic_path.as_deref(),
            Some("/library/older/mosaic.tif")
        );
        assert_eq!(
            newer.mosaic_path.as_deref(),
            Some("/library/newer/mosaic.tif")
        );
        assert_eq!(
            head_generation(&connection, "layer")
                .unwrap()
                .expect("the head survives")
                .id,
            "newer"
        );
        // The ambiguous lineage is cleared rather than presented as a chain of
        // user actions, and Undo starts exhausted so the existing head is the
        // new baseline.
        assert_eq!(newer.previous_generation_id, None);
        assert!(!newer.undo_available);
        assert!(!older.undo_available);
        // A new change on the migrated head records the head as its target, so
        // Undo works from there exactly as on a fresh library.
        connection
            .execute(
                "INSERT INTO lidar_layer_generations
                    (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                     coverage_cells, min_value, max_value, bounds_3857,
                     previous_generation_id, undo_available, operation)
                 VALUES ('after', 'layer', '2', '/library/after/mosaic.tif',
                         '/library/after/coverage.bin', '{}', 1, 0, 1, '[0,0,1,1]',
                         'newer', 1, 'import')",
                [],
            )
            .unwrap();
        let after = generation_row(&connection, "after")
            .unwrap()
            .expect("the new change is recorded");
        assert!(after.undo_available);
        assert_eq!(after.previous_generation_id.as_deref(), Some("newer"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn v10_catalogue_gains_the_legacy_base_reference() {
        let root = std::env::temp_dir().join(new_id("canopi-catalogue-v11"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("lidar-library.sqlite");
        {
            let connection = open(&path).expect("fresh catalogue opens");
            connection
                .execute_batch(
                    "INSERT INTO lidar_source_layers
                        (id, name, measurement_kind, units, created_at)
                     VALUES ('layer', 'Layer', 'ground-elevation', 'm', '0');
                     INSERT INTO lidar_layer_generations
                        (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                         coverage_cells, min_value, max_value, bounds_3857)
                     VALUES ('legacy', 'layer', '0', '/library/legacy/mosaic.tif',
                             '/library/legacy/coverage.bin', '{}', 1, 0, 1, '[0,0,1,1]');
                     INSERT INTO lidar_layer_heads(layer_id, generation_id)
                     VALUES ('layer', 'legacy');
                     ALTER TABLE lidar_layer_generations DROP COLUMN base_generation_id;
                     UPDATE lidar_catalogue_meta SET value = '10' WHERE key = 'schema_version';",
                )
                .unwrap();
        }

        let connection = open(&path).expect("v10 catalogue migrates");
        assert_eq!(schema_version(&connection).unwrap(), CATALOGUE_VERSION);
        let legacy = generation_row(&connection, "legacy")
            .unwrap()
            .expect("preserved generation survives");
        assert_eq!(legacy.base_generation_id, None);
        assert_eq!(
            legacy.mosaic_path.as_deref(),
            Some("/library/legacy/mosaic.tif")
        );
        // A generation may now reference the opaque base it overlays, and the
        // reference is a foreign key: an unknown base is refused.
        connection
            .execute(
                "INSERT INTO lidar_layer_generations
                    (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                     coverage_cells, min_value, max_value, bounds_3857, base_generation_id)
                 VALUES ('overlay', 'layer', '1', NULL, NULL, '{}', 1, 0, 1, '[0,0,1,1]', 'legacy')",
                [],
            )
            .unwrap();
        assert_eq!(
            generation_row(&connection, "overlay")
                .unwrap()
                .expect("overlay row")
                .base_generation_id
                .as_deref(),
            Some("legacy")
        );
        let dangling = connection.execute(
            "INSERT INTO lidar_layer_generations
                (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                 coverage_cells, min_value, max_value, bounds_3857, base_generation_id)
             VALUES ('dangling', 'layer', '2', NULL, NULL, '{}', 1, 0, 1, '[0,0,1,1]', 'missing')",
            [],
        );
        assert!(dangling.is_err(), "an unknown base is refused");
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn newer_catalogue_version_is_refused_before_writes() {
        let root = std::env::temp_dir().join(new_id("canopi-catalogue-future"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("lidar-library.sqlite");
        {
            let connection = open(&path).unwrap();
            connection
                .execute(
                    "UPDATE lidar_catalogue_meta SET value = '99' WHERE key = 'schema_version'",
                    [],
                )
                .unwrap();
        }
        let error = open(&path).expect_err("a newer schema must be refused");
        assert!(error.contains("newer than supported"), "{error}");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn interpretation_regions_are_replaced_and_paged() {
        let root = std::env::temp_dir().join(new_id("canopi-regions"));
        std::fs::create_dir_all(&root).unwrap();
        let connection = open(&root.join("lidar-library.sqlite")).unwrap();
        connection
            .execute(
                "INSERT INTO lidar_sources(sha256, original_filename, size_bytes, probe_json, imported_at)
                 VALUES('sha-region', 'region.tif', 4, '{}', '2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_interpretations(
                    id, source_sha256, band_index, measurement_kind, units, scale, offset,
                    crs_wkt, vertical_ref, nodata, geotransform, width, height, interp_hash)
                 VALUES('interp-region', 'sha-region', 1, 'ground-elevation', 'm', 1, 0,
                    'EPSG:3857', 'unspecified', -9999, '[0,1,0,0,0,-1]', 4, 4, 'hash-region')",
                [],
            )
            .unwrap();

        let regions: Vec<(i64, i64, i64, f64, f64, f64)> = (0..5)
            .map(|index| (index - 2, index, 10 + index, -1.5, 9.5, 42.0))
            .collect();
        replace_interpretation_regions(&connection, "interp-region", &regions).unwrap();
        let first = interpretation_region_page(&connection, "interp-region", 0, 2).unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].0, -2);
        assert_eq!(first[1].1, 1);
        let second = interpretation_region_page(&connection, "interp-region", 4, 10).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].0, 2);

        // Replacing a scan swaps the page set instead of accumulating rows.
        replace_interpretation_regions(&connection, "interp-region", &[(-7, 3, 4, 0.0, 1.0, 2.0)])
            .unwrap();
        let replaced = interpretation_region_page(&connection, "interp-region", 0, 10).unwrap();
        assert_eq!(replaced, vec![(-7, 3, 4, 0.0, 1.0, 2.0)]);
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn unpublished_chunk_rows_are_invisible_until_the_generation_publishes() {
        let root = std::env::temp_dir().join(new_id("canopi-chunks"));
        std::fs::create_dir_all(&root).unwrap();
        let connection = open(&root.join("lidar-library.sqlite")).unwrap();
        connection
            .execute(
                "INSERT INTO lidar_raster_assets(
                    sha256, rel_path, bytes, profile, width, height, geotransform, crs_wkt, nodata, created_at)
                 VALUES('sha-chunk', 'assets/sha-chunk/cog.tif', 8, 'cog-f32-t256-raw-v1',
                    1024, 1024, '[0,1,0,0,0,-1]', 'EPSG:3857', NULL, '2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        let rows = vec![GenerationChunkRow {
            role: "resolved".to_string(),
            chunk_x: 0,
            chunk_y: 0,
            asset_sha256: "sha-chunk".to_string(),
            valid_cells: 12,
            min_value: 1.0,
            max_value: 3.0,
            sum_value: 24.0,
        }];
        insert_unpublished_chunks(&connection, "gen-1", &rows).unwrap();
        assert!(
            generation_chunk_page(&connection, "gen-1", "resolved", None, None, 10)
                .unwrap()
                .is_empty(),
            "an unpublished generation exposes no chunk rows"
        );
        let published = publish_generation_chunks(&connection, "gen-1").unwrap();
        assert_eq!(published, 1);
        let page = generation_chunk_page(&connection, "gen-1", "resolved", None, None, 10).unwrap();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].asset.sha256, "sha-chunk");
        assert_eq!(page[0].aggregate_sum_value, 24.0);
        // A result role keeps its own rows.
        assert!(
            generation_chunk_page(&connection, "gen-1", "quality", None, None, 10)
                .unwrap()
                .is_empty()
        );
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn chunk_pages_order_by_position_and_filter_spatially_in_sql() {
        let root = std::env::temp_dir().join(new_id("canopi-chunk-pages"));
        std::fs::create_dir_all(&root).unwrap();
        let connection = open(&root.join("catalogue.sqlite")).unwrap();
        connection
            .execute(
                "INSERT INTO lidar_raster_assets(
                    sha256, rel_path, bytes, profile, width, height, geotransform, crs_wkt, nodata, created_at)
                 VALUES('sha-page', 'assets/sha-page/cog.tif', 8, 'cog-f32-t256-raw-v1',
                    1024, 1024, '[0,1,0,0,0,-1]', 'EPSG:3857', NULL, '2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        // Four records: two rows of two columns, plus a distant record that no
        // small window may return.
        let rows: Vec<GenerationChunkRow> = [(0, 0), (1, 0), (0, 1), (1, 1), (7, 2)]
            .into_iter()
            .map(|(chunk_x, chunk_y)| GenerationChunkRow {
                role: "resolved".to_string(),
                chunk_x,
                chunk_y,
                asset_sha256: "sha-page".to_string(),
                valid_cells: 1,
                min_value: 1.0,
                max_value: 1.0,
                sum_value: 1.0,
            })
            .collect();
        insert_unpublished_chunks(&connection, "gen-1", &rows).unwrap();
        publish_generation_chunks(&connection, "gen-1").unwrap();

        // Keyset pages of two: stable position order, no repeat and no gap.
        let first = generation_chunk_page(&connection, "gen-1", "resolved", None, None, 2).unwrap();
        let cursor = first
            .last()
            .map(|row| (row.chunk_y, row.chunk_x))
            .expect("first page has rows");
        assert_eq!(
            first
                .iter()
                .map(|row| (row.chunk_y, row.chunk_x))
                .collect::<Vec<_>>(),
            vec![(0, 0), (0, 1)]
        );
        let second =
            generation_chunk_page(&connection, "gen-1", "resolved", None, Some(cursor), 2).unwrap();
        assert_eq!(
            second
                .iter()
                .map(|row| (row.chunk_y, row.chunk_x))
                .collect::<Vec<_>>(),
            vec![(1, 0), (1, 1)]
        );
        let third = generation_chunk_page(
            &connection,
            "gen-1",
            "resolved",
            None,
            second.last().map(|row| (row.chunk_y, row.chunk_x)),
            2,
        )
        .unwrap();
        assert_eq!(
            third
                .iter()
                .map(|row| (row.chunk_y, row.chunk_x))
                .collect::<Vec<_>>(),
            vec![(2, 7)]
        );

        // A window filter runs before rows load: chunk 0 covers cells 0..1024.
        let window = ChunkWindow::for_cells(0, 1024, 0, 2048, 1024).unwrap();
        assert_eq!(
            (window.min_x, window.max_x, window.min_y, window.max_y),
            (0, 0, 0, 1)
        );
        let filtered =
            generation_chunk_page(&connection, "gen-1", "resolved", Some(window), None, 10)
                .unwrap();
        assert_eq!(
            filtered
                .iter()
                .map(|row| (row.chunk_y, row.chunk_x))
                .collect::<Vec<_>>(),
            vec![(0, 0), (1, 0)],
            "only intersecting records load"
        );
        // Negative coordinates stay exact: cells -1..0 touch chunk -1 only.
        let negative = ChunkWindow::for_cells(-1, 0, 0, 1, 1024).unwrap();
        assert_eq!(
            (
                negative.min_x,
                negative.max_x,
                negative.min_y,
                negative.max_y
            ),
            (-1, -1, 0, 0)
        );
        assert!(
            generation_chunk_page(&connection, "gen-1", "resolved", Some(negative), None, 10)
                .unwrap()
                .is_empty()
        );
        // An exact coordinate lookup is bounded to one record.
        let one = generation_chunk_at(&connection, "gen-1", "resolved", 1, 1)
            .unwrap()
            .expect("the record exists");
        assert_eq!((one.chunk_x, one.chunk_y), (1, 1));
        assert!(
            generation_chunk_at(&connection, "gen-1", "resolved", 4, 4)
                .unwrap()
                .is_none()
        );
        // The index carries the read order, so paging needs no sort step.
        let plan: String = connection
            .query_row(
                "EXPLAIN QUERY PLAN SELECT g.chunk_x, g.chunk_y
                 FROM lidar_generation_chunks g
                 WHERE g.generation_id = 'gen-1' AND g.role = 'resolved'
                   AND g.state = 'published'
                 ORDER BY g.chunk_y, g.chunk_x LIMIT 2",
                [],
                |row| row.get(3),
            )
            .unwrap();
        assert!(
            !plan.contains("TEMP B-TREE"),
            "the paged read order must come from the index: {plan}"
        );
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
    }
}
