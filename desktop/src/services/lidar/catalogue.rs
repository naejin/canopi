//! `lidar-library.sqlite` catalogue: definitions, spatial index, generations,
//! decisions, jobs and dependencies.
//!
//! Transactions are short; raster computation never happens while a catalogue
//! connection is held. All SQL uses prepared statements with placeholders.

use rusqlite::{Connection, OptionalExtension};

pub const CATALOGUE_VERSION: i32 = 6;

pub fn open(path: &std::path::Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|e| format!("Failed to open LiDAR catalogue {}: {e}", path.display()))?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to enable WAL for LiDAR catalogue: {e}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("Failed to enable foreign keys: {e}"))?;
    migrate(&connection)?;
    Ok(connection)
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
            .map_err(|e| format!("Failed to commit LiDAR catalogue migration v{next}: {e}"))?;
        applied = next;
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
    pub mosaic_path: String,
    pub coverage_mask_path: String,
    pub manifest_json: String,
    pub coverage_cells: i64,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub bounds_3857: String,
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
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub bounds_3857: String,
}

#[derive(Debug, Clone)]
pub struct ImportJobRow {
    pub id: String,
    pub layer_id: String,
    pub state: String,
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
                    g.coverage_cells, g.min_value, g.max_value, g.bounds_3857
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
        bounds_3857: row.get(8)?,
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
            "SELECT g.id, g.source_generation_id, g.state, g.min_value, g.max_value, g.bounds_3857
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
}

pub fn get_interpretation(
    connection: &Connection,
    interpretation_id: &str,
) -> Result<Option<InterpretationRow>, String> {
    connection
        .query_row(
            "SELECT geotransform, width, height, interp_hash
             FROM lidar_interpretations WHERE id = ?1",
            [interpretation_id],
            |row| {
                Ok(InterpretationRow {
                    geotransform: row.get(0)?,
                    width: row.get(1)?,
                    height: row.get(2)?,
                    interp_hash: row.get(3)?,
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

/// Interpretation ids whose footprints intersect the given rect; the exact
/// mask decides admission, this only narrows candidates.
pub fn footprint_candidates(
    connection: &Connection,
    bounds: [f64; 4],
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT f.interpretation_id FROM lidar_source_footprints f
             JOIN lidar_footprint_rtree r ON r.id = f.id
             WHERE r.min_x <= ?1 AND r.max_x >= ?2 AND r.min_y <= ?3 AND r.max_y >= ?4",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(
            rusqlite::params![bounds[2], bounds[0], bounds[3], bounds[1]],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Generation history
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct GenerationHistoryEntry {
    pub id: String,
    pub created_at: String,
    pub coverage_cells: i64,
    pub members: Vec<String>,
    pub roles: Vec<String>,
    pub job_ids: Vec<String>,
    pub is_head: bool,
}

pub fn layer_history(
    connection: &Connection,
    layer_id: &str,
) -> Result<Vec<GenerationHistoryEntry>, String> {
    let head_id: Option<String> = connection
        .query_row(
            "SELECT generation_id FROM lidar_layer_heads WHERE layer_id = ?1",
            [layer_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT g.id, g.created_at, g.coverage_cells FROM lidar_layer_generations g
             WHERE g.layer_id = ?1 ORDER BY g.created_at, g.id",
        )
        .map_err(|e| e.to_string())?;
    let mut entries = statement
        .query_map([layer_id], |row| {
            Ok(GenerationHistoryEntry {
                id: row.get(0)?,
                created_at: row.get(1)?,
                coverage_cells: row.get(2)?,
                members: Vec::new(),
                roles: Vec::new(),
                job_ids: Vec::new(),
                is_head: false,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(statement);
    let mut member_statement = connection
        .prepare(
            "SELECT m.interpretation_id, m.role FROM lidar_generation_members m
             WHERE m.generation_id = ?1 ORDER BY m.ordinal",
        )
        .map_err(|e| e.to_string())?;
    let mut job_statement = connection
        .prepare(
            "SELECT DISTINCT job_id FROM lidar_acceptance_regions
             WHERE generation_id = ?1 AND job_id IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;
    for entry in &mut entries {
        entry.is_head = head_id.as_deref() == Some(entry.id.as_str());
        let rows = member_statement
            .query_map([&entry.id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (interp, role) = row.map_err(|e| e.to_string())?;
            entry.members.push(interp);
            entry.roles.push(role);
        }
        let jobs = job_statement
            .query_map([&entry.id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for job in jobs {
            entry.job_ids.push(job.map_err(|e| e.to_string())?);
        }
    }
    Ok(entries)
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn rtree_footprints_narrow_candidates_to_intersecting_cells() {
        let dir = std::env::temp_dir().join(format!("canopi-footprints-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let connection = open(&dir.join("catalogue.sqlite")).expect("catalogue opens");

        connection
            .execute(
                "INSERT INTO lidar_sources(sha256, original_filename, size_bytes, probe_json, imported_at)
                 VALUES('sha-a', 'a.tif', 1, '{}', '0')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_sources(sha256, original_filename, size_bytes, probe_json, imported_at)
                 VALUES('sha-b', 'b.tif', 1, '{}', '0')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_interpretations(
                    id, source_sha256, band_index, measurement_kind, units, scale, offset,
                    crs_wkt, vertical_ref, nodata, geotransform, width, height, interp_hash)
                 VALUES('interp-a', 'sha-a', 1, 'ground-elevation', 'm', 1, 0, 'x', 'u', -9999,
                        '[0,1,0,0,0,-1]', 10, 10, 'hash-a')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_interpretations(
                    id, source_sha256, band_index, measurement_kind, units, scale, offset,
                    crs_wkt, vertical_ref, nodata, geotransform, width, height, interp_hash)
                 VALUES('interp-b', 'sha-b', 1, 'ground-elevation', 'm', 1, 0, 'x', 'u', -9999,
                        '[100,1,0,100,0,-1]', 10, 10, 'hash-b')",
                [],
            )
            .unwrap();

        upsert_footprint(&connection, "interp-a", "lyr-1", [0.0, 0.0, 10.0, 10.0]).unwrap();
        upsert_footprint(
            &connection,
            "interp-b",
            "lyr-1",
            [100.0, 100.0, 110.0, 110.0],
        )
        .unwrap();

        let near_a = footprint_candidates(&connection, [5.0, 5.0, 6.0, 6.0]).unwrap();
        assert_eq!(near_a, vec!["interp-a".to_string()]);
        let near_b = footprint_candidates(&connection, [101.0, 101.0, 102.0, 102.0]).unwrap();
        assert_eq!(near_b, vec!["interp-b".to_string()]);
        let empty = footprint_candidates(&connection, [500.0, 500.0, 501.0, 501.0]).unwrap();
        assert!(empty.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
