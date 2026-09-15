//! `lidar-library.sqlite` catalogue: definitions, spatial index, generations,
//! decisions, jobs and dependencies.
//!
//! Transactions are short; raster computation never happens while a catalogue
//! connection is held. All SQL uses prepared statements with placeholders.

use rusqlite::{Connection, OptionalExtension};

pub const CATALOGUE_VERSION: i32 = 1;

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
    if version < CATALOGUE_VERSION {
        connection
            .execute_batch(SCHEMA_V1)
            .map_err(|e| format!("Failed to apply LiDAR catalogue schema v1: {e}"))?;
        connection
            .execute(
                "INSERT INTO lidar_catalogue_meta(key, value) VALUES('schema_version', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [CATALOGUE_VERSION.to_string()],
            )
            .map_err(|e| format!("Failed to record catalogue version: {e}"))?;
    }
    Ok(())
}

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
            "SELECT id, layer_id, state, review_json, message
             FROM lidar_import_jobs WHERE id = ?1",
            [job_id],
            |row| {
                Ok(ImportJobRow {
                    id: row.get(0)?,
                    layer_id: row.get(1)?,
                    state: row.get(2)?,
                    review_json: row.get(3)?,
                    message: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
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
