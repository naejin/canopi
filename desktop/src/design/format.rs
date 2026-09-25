use common_types::design::{
    CURRENT_CANOPI_FILE_VERSION, CanopiDesignIngestionErrorKind, CanopiFile,
    DEFAULT_BUDGET_CURRENCY, Layer, MISSING_CANOPI_FILE_VERSION, OBSOLETE_CANOPI_ROOT_KEYS,
    validate_design_geometry,
};
use std::fmt;
use std::path::Path;

use super::new_design_defaults::NEW_DESIGN_LAYER_DEFAULTS;

#[derive(Debug)]
pub(crate) struct CanopiDesignIngestionError {
    kind: CanopiDesignIngestionErrorKind,
    message: String,
}

impl CanopiDesignIngestionError {
    fn new(kind: CanopiDesignIngestionErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl fmt::Display for CanopiDesignIngestionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.kind.as_str(), self.message)
    }
}

/// Largest `.canopi` file this build opens, matching the GeoJSON import limit.
pub(crate) const MAX_CANOPI_FILE_BYTES: u64 = 64 * 1024 * 1024;

/// Why a `.canopi` file could not be opened.
#[derive(Debug)]
pub(crate) enum DesignLoadError {
    Read {
        path: String,
        source: std::io::Error,
    },
    TooLarge {
        path: String,
    },
    InvalidJson {
        path: String,
        source: serde_json::Error,
    },
    Ingestion {
        path: String,
        source: CanopiDesignIngestionError,
    },
}

impl fmt::Display for DesignLoadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read { path, source } => write!(formatter, "Failed to read {path}: {source}"),
            Self::TooLarge { path } => write!(
                formatter,
                "Design file {path} exceeds the {} MiB limit",
                MAX_CANOPI_FILE_BYTES / (1024 * 1024)
            ),
            Self::InvalidJson { path, source } => {
                write!(formatter, "Invalid JSON in {path}: {source}")
            }
            Self::Ingestion { path, source } => {
                write!(formatter, "Failed to parse design from {path}: {source}")
            }
        }
    }
}

impl std::error::Error for DesignLoadError {}

/// Encode a Design as `.canopi` wire bytes: the one encoder for saves and drafts.
pub(crate) fn encode_design(content: &CanopiFile) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(content).map_err(|e| format!("Failed to serialize design: {e}"))
}

/// Result of [`save_to_file`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SaveResult {
    /// Written; the fingerprint of the bytes now on disk.
    Saved { fingerprint: String },
    /// The file no longer has the expected fingerprint; nothing was written.
    Conflict { current_fingerprint: Option<String> },
}

/// Durably save a `CanopiFile` to `path`.
///
/// With `expected_fingerprint`, the write happens only while the file on disk
/// still has that fingerprint (a missing file has none); otherwise nothing is
/// written and the current fingerprint is returned. `None` overwrites
/// unconditionally (Save As, or keeping this copy over an outside change). The
/// check and the write run under one write admission for the target.
pub(crate) fn save_to_file(
    path: &Path,
    content: &CanopiFile,
    expected_fingerprint: Option<&str>,
) -> Result<SaveResult, String> {
    let bytes = encode_design(content)?;
    super::with_write_admission(path, || {
        if let Some(expected) = expected_fingerprint {
            let current = super::fingerprint_file(path)
                .map_err(|e| format!("Failed to check {} before saving: {e}", path.display()))?;
            if current.as_deref() != Some(expected) {
                return Ok(SaveResult::Conflict {
                    current_fingerprint: current,
                });
            }
        }
        super::write_file_durably(path, &bytes, "tmp")
            .map_err(|e| format!("Failed to save {}: {e}", path.display()))?;
        Ok(SaveResult::Saved {
            fingerprint: super::fingerprint(&bytes),
        })
    })
}

/// Write a standalone `.canopi` export (a Saved Object Stamp file).
///
/// An export is derived output, not a Design save: it has no fingerprint check
/// and is not recorded as a Recent Design.
pub fn export_to_file(path: &Path, content: &CanopiFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(content)
        .map_err(|e| format!("Failed to serialize design: {e}"))?;
    super::write_derived_file(path, json.as_bytes())
        .map_err(|e| format!("Failed to export {}: {e}", path.display()))
}

/// Load a `CanopiFile` from disk.
///
/// Refuses files over [`MAX_CANOPI_FILE_BYTES`], parses JSON to a value for
/// strict version and root-key admission, then deserializes `CanopiFile`.
/// Unknown root fields are preserved in `CanopiFile::extra`.
pub(crate) fn load_from_file(path: &Path) -> Result<CanopiFile, DesignLoadError> {
    load_with_fingerprint(path).map(|(file, _)| file)
}

/// [`load_from_file`] plus the [`super::fingerprint`] of the exact bytes read.
pub(crate) fn load_with_fingerprint(path: &Path) -> Result<(CanopiFile, String), DesignLoadError> {
    use std::io::Read;
    let display = || path.display().to_string();
    let file = std::fs::File::open(path).map_err(|source| DesignLoadError::Read {
        path: display(),
        source,
    })?;
    let length = file
        .metadata()
        .map_err(|source| DesignLoadError::Read {
            path: display(),
            source,
        })?
        .len();
    if length > MAX_CANOPI_FILE_BYTES {
        return Err(DesignLoadError::TooLarge { path: display() });
    }
    let mut content = Vec::new();
    // Read one byte past the limit so a file that grows while it is read is
    // still refused without buffering it whole.
    file.take(MAX_CANOPI_FILE_BYTES + 1)
        .read_to_end(&mut content)
        .map_err(|source| DesignLoadError::Read {
            path: display(),
            source,
        })?;
    if content.len() as u64 > MAX_CANOPI_FILE_BYTES {
        return Err(DesignLoadError::TooLarge { path: display() });
    }
    let fingerprint = super::fingerprint(&content);

    let value: serde_json::Value =
        serde_json::from_slice(&content).map_err(|source| DesignLoadError::InvalidJson {
            path: display(),
            source,
        })?;

    let file = decode_design_value(value).map_err(|source| DesignLoadError::Ingestion {
        path: display(),
        source,
    })?;
    Ok((file, fingerprint))
}

#[expect(
    clippy::expect_used,
    reason = "version admission above has already required a JSON object"
)]
fn decode_design_value(
    mut value: serde_json::Value,
) -> Result<CanopiFile, CanopiDesignIngestionError> {
    let version = read_design_version(&value)?;
    if version != CURRENT_CANOPI_FILE_VERSION as u64 {
        return Err(CanopiDesignIngestionError::new(
            CanopiDesignIngestionErrorKind::UnsupportedVersion,
            format!(
                "$.version: unsupported Canopi Design version {version}; current version is {CURRENT_CANOPI_FILE_VERSION}",
            ),
        ));
    }

    let object = value
        .as_object()
        .expect("version admission requires an object");
    // `extra` is the in-memory bag for unknown root fields, never a wire key:
    // the canonical encoder writes unknown fields at the root.
    if object.contains_key("extra") {
        return Err(CanopiDesignIngestionError::new(
            CanopiDesignIngestionErrorKind::InvalidDocument,
            "$.extra: reserved root field; unknown fields are stored at the root",
        ));
    }
    if let Some(key) = OBSOLETE_CANOPI_ROOT_KEYS
        .iter()
        .find(|key| object.contains_key(**key))
    {
        return Err(CanopiDesignIngestionError::new(
            CanopiDesignIngestionErrorKind::InvalidDocument,
            format!("$.{key}: obsolete root field; v7 stores lon/lat on each design object"),
        ));
    }

    value["version"] = serde_json::json!(version);
    let file: CanopiFile = serde_json::from_value(value).map_err(|error| {
        CanopiDesignIngestionError::new(
            CanopiDesignIngestionErrorKind::InvalidDocument,
            format!("$: {error}"),
        )
    })?;
    validate_design_geometry(&file).map_err(|error| {
        CanopiDesignIngestionError::new(CanopiDesignIngestionErrorKind::InvalidDocument, error)
    })?;
    Ok(file)
}

fn read_design_version(value: &serde_json::Value) -> Result<u64, CanopiDesignIngestionError> {
    let Some(object) = value.as_object() else {
        return Err(CanopiDesignIngestionError::new(
            CanopiDesignIngestionErrorKind::InvalidDocument,
            "$: expected a Canopi Design object",
        ));
    };
    let Some(raw_version) = object.get("version") else {
        return Ok(MISSING_CANOPI_FILE_VERSION as u64);
    };
    let version = raw_version.as_u64().or_else(|| {
        raw_version.as_f64().and_then(|version| {
            (version.is_finite() && version.fract() == 0.0 && version >= 1.0)
                .then_some(version as u64)
        })
    });
    let Some(version) = version else {
        return Err(CanopiDesignIngestionError::new(
            CanopiDesignIngestionErrorKind::InvalidVersion,
            "$.version: expected a positive integer",
        ));
    };
    if version == 0 {
        return Err(CanopiDesignIngestionError::new(
            CanopiDesignIngestionErrorKind::InvalidVersion,
            "$.version: expected a positive integer",
        ));
    }
    Ok(version)
}

/// Compose a new Design from caller-owned identity and generated static defaults.
pub(crate) fn create_new_design(
    name: impl Into<String>,
    timestamp: impl Into<String>,
) -> CanopiFile {
    let timestamp = timestamp.into();
    let layers = NEW_DESIGN_LAYER_DEFAULTS
        .iter()
        .map(|layer| Layer {
            name: layer.name.to_owned(),
            visible: layer.visible,
            locked: layer.locked,
            opacity: layer.opacity,
        })
        .collect();

    CanopiFile {
        lidar: None,
        version: CURRENT_CANOPI_FILE_VERSION,
        name: name.into(),
        description: None,
        plant_species_colors: std::collections::HashMap::new(),
        plant_species_symbols: std::collections::HashMap::new(),
        plant_species_codes: std::collections::HashMap::new(),
        layers,
        plants: Vec::new(),
        zones: Vec::new(),
        annotations: Vec::new(),
        measurement_guides: Vec::new(),
        consortiums: Vec::new(),
        groups: Vec::new(),
        timeline: Vec::new(),
        budget: Vec::new(),
        budget_currency: DEFAULT_BUDGET_CURRENCY.to_owned(),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        extra: std::collections::HashMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use common_types::design::PanelTarget;
    use std::path::PathBuf;

    fn create_default() -> CanopiFile {
        create_new_design("Untitled", "2026-07-02T00:00:00Z")
    }

    #[test]
    fn shared_canopi_conformance_corpus_matches_native_ingestion() {
        let corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../../common-types/canopi-design-conformance.json"
        ))
        .expect("shared Canopi conformance corpus should be valid JSON");

        assert_eq!(corpus["contract_version"], serde_json::json!(1));
        assert_eq!(
            corpus["facts"],
            serde_json::json!({
                "current_version": CURRENT_CANOPI_FILE_VERSION,
                "missing_version": MISSING_CANOPI_FILE_VERSION,
                "future_version_policy": common_types::design::FUTURE_CANOPI_FILE_VERSION_POLICY,
                "error_kinds": CanopiDesignIngestionErrorKind::ALL
                    .iter()
                    .map(|kind| kind.as_str())
                    .collect::<Vec<_>>(),
            }),
        );

        for case in corpus["cases"]
            .as_array()
            .expect("conformance cases should be an array")
        {
            let id = case["id"].as_str().expect("case id should be a string");
            let input = case["input"].clone();
            if let Some(expected_name) = case.get("accepted").and_then(|value| value.as_str()) {
                let expected = corpus["accepted_documents"][expected_name].clone();
                let file = decode_design_value(input)
                    .unwrap_or_else(|error| panic!("{id}: ingestion failed: {error}"));
                assert_eq!(conformance_document_value(&file), expected, "{id}");
                let wire = serde_json::to_value(file)
                    .expect("accepted Canopi Design should serialize for round trip");
                let round_tripped = decode_design_value(wire)
                    .unwrap_or_else(|error| panic!("{id}: round trip failed: {error}"));
                assert_eq!(
                    conformance_document_value(&round_tripped),
                    expected,
                    "{id}: round trip",
                );
                continue;
            }
            let expected_kind = case["error_kind"].as_str().expect("error case kind");

            let error = match decode_design_value(input) {
                Ok(_) => panic!("{id}: expected ingestion to fail"),
                Err(error) => error,
            };
            assert_eq!(error.kind.as_str(), expected_kind, "{id}");
        }
    }

    fn conformance_document_value(file: &CanopiFile) -> serde_json::Value {
        let mut wire = serde_json::to_value(file).expect("normalized Design should serialize");
        let object = wire
            .as_object_mut()
            .expect("normalized Design should serialize as an object");
        let known = common_types::design::DESIGN_FILE_FIELDS
            .iter()
            .map(|field| field.key)
            .filter(|key| *key != "extra")
            .collect::<std::collections::HashSet<_>>();
        let mut extra = serde_json::Map::new();
        for key in object
            .keys()
            .filter(|key| !known.contains(key.as_str()))
            .cloned()
            .collect::<Vec<_>>()
        {
            let value = object.remove(&key).expect("collected key should exist");
            extra.insert(key, value);
        }
        object.insert("extra".to_owned(), serde_json::Value::Object(extra));
        wire
    }

    fn owned_sidecars(dir: &Path, role: &str) -> Vec<PathBuf> {
        let suffix = format!(".{role}");
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                    return false;
                };
                name.starts_with(".canopi-") && name.ends_with(&suffix)
            })
            .collect()
    }

    #[test]
    fn test_create_default_has_six_layers() {
        let design = create_default();
        assert_eq!(design.version, CURRENT_CANOPI_FILE_VERSION);
        assert_eq!(design.name, "Untitled");
        assert_eq!(design.layers.len(), 6);
        assert!(design.measurement_guides.is_empty());
    }

    #[test]
    fn new_design_uses_caller_identity_and_fresh_layer_records() {
        let mut first = create_new_design("First Design", "2026-07-02T00:00:00Z");
        let second = create_new_design("Second Design", "2026-07-03T00:00:00Z");

        assert_eq!(first.name, "First Design");
        assert_eq!(first.created_at, "2026-07-02T00:00:00Z");
        assert_eq!(first.updated_at, "2026-07-02T00:00:00Z");
        assert_eq!(second.name, "Second Design");
        assert_eq!(second.created_at, "2026-07-03T00:00:00Z");
        first.layers[0].name = "changed".to_owned();
        assert_eq!(second.layers[0].name, "climate");
    }

    #[test]
    fn test_create_default_layer_visibility() {
        let design = create_default();
        let by_name: std::collections::HashMap<_, _> = design
            .layers
            .iter()
            .map(|l| (l.name.as_str(), l.visible))
            .collect();
        assert_eq!(
            by_name,
            std::collections::HashMap::from([
                ("climate", false),
                ("zones", true),
                ("water", false),
                ("plants", true),
                ("measurement-guides", true),
                ("annotations", true),
            ]),
        );
    }

    #[test]
    fn test_save_and_load_round_trip() {
        let dir = std::env::temp_dir();
        let path: PathBuf = dir.join("canopi_test_round_trip.canopi");

        let original = create_default();
        save_to_file(&path, &original, None).expect("save should succeed");
        assert!(path.exists());

        let loaded = load_from_file(&path).expect("load should succeed");
        assert_eq!(loaded.name, original.name);
        assert_eq!(loaded.version, original.version);
        assert_eq!(loaded.layers.len(), 6);

        // Clean up
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn save_waits_for_existing_target_admission() {
        use std::sync::mpsc;
        use std::time::Duration;

        let dir = std::env::temp_dir().join(format!(
            "canopi_save_admission_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("garden.canopi");
        let initial = create_default();
        std::fs::write(&path, serde_json::to_string_pretty(&initial).unwrap()).unwrap();

        let mut replacement = create_default();
        replacement.name = "Admitted replacement".to_owned();
        let writer_path = path.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        let writer = crate::design::with_write_admission(&path, || {
            let writer = std::thread::spawn(move || {
                started_tx.send(()).unwrap();
                finished_tx
                    .send(save_to_file(&writer_path, &replacement, None))
                    .unwrap();
            });
            started_rx.recv().unwrap();
            assert!(
                finished_rx
                    .recv_timeout(Duration::from_millis(250))
                    .is_err(),
                "save completed while another operation held target admission"
            );
            writer
        });

        finished_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("save should complete after target admission is released")
            .expect("save should succeed");
        writer.join().unwrap();
        assert_eq!(load_from_file(&path).unwrap().name, "Admitted replacement");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_saves_leave_one_complete_design() {
        use std::sync::{Arc, Barrier};

        let dir = std::env::temp_dir().join(format!(
            "canopi_concurrent_saves_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("garden.canopi");
        let mut initial = create_default();
        initial.name = "Initial".to_owned();
        save_to_file(&path, &initial, None).unwrap();

        let writer_count = 8;
        let barrier = Arc::new(Barrier::new(writer_count + 1));
        let mut writers = Vec::new();
        let mut expected_names = std::collections::HashSet::new();
        for index in 0..writer_count {
            let name = format!("Concurrent {index}");
            expected_names.insert(name.clone());
            let mut design = create_default();
            design.name = name;
            let writer_path = path.clone();
            let writer_barrier = Arc::clone(&barrier);
            writers.push(std::thread::spawn(move || {
                writer_barrier.wait();
                save_to_file(&writer_path, &design, None)
            }));
        }
        barrier.wait();
        for writer in writers {
            writer.join().unwrap().unwrap();
        }

        let final_design = load_from_file(&path).unwrap();
        assert!(expected_names.contains(&final_design.name));
        assert!(
            owned_sidecars(&dir, "tmp").is_empty(),
            "concurrent saves must not leak owned temporary sidecars"
        );
        assert!(
            owned_sidecars(&dir, "old").is_empty(),
            "concurrent saves must not leak owned rollback sidecars"
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_atomic_write_creates_tmp_then_final() {
        let dir = std::env::temp_dir().join(format!(
            "canopi_atomic_save_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path: PathBuf = dir.join("garden.canopi");

        let design = create_default();
        save_to_file(&path, &design, None).expect("save should succeed");

        assert!(path.exists(), "final file should exist");
        assert!(
            owned_sidecars(&dir, "tmp").is_empty(),
            "successful save must not leak an owned temporary sidecar"
        );
        assert!(
            owned_sidecars(&dir, "old").is_empty(),
            "successful save must not leak an owned rollback sidecar"
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn save_does_not_claim_an_existing_legacy_temp_sidecar() {
        let dir = std::env::temp_dir().join(format!(
            "canopi_owned_save_temp_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("garden.canopi");
        let legacy_tmp = path.with_extension("canopi.tmp");
        std::fs::write(&legacy_tmp, "another operation owns this").unwrap();

        save_to_file(&path, &create_default(), None).expect("save should succeed");

        assert_eq!(
            std::fs::read_to_string(&legacy_tmp).unwrap(),
            "another operation owns this"
        );
        assert!(load_from_file(&path).is_ok());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_extra_fields_preserved_on_round_trip() {
        use serde_json::json;

        let dir = std::env::temp_dir();
        let path: PathBuf = dir.join("canopi_test_extra.canopi");

        // Build a design with an unknown future field injected at JSON level.
        let mut design = create_default();
        design
            .extra
            .insert("future_field".into(), json!("from_future"));

        save_to_file(&path, &design, None).expect("save");
        let loaded = load_from_file(&path).expect("load");

        assert_eq!(
            loaded.extra.get("future_field").and_then(|v| v.as_str()),
            Some("from_future"),
            "unknown fields should survive round-trip"
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn geolocated_objects_panel_sections_and_unknown_fields_round_trip() {
        use serde_json::json;

        let dir = std::env::temp_dir();
        let path: PathBuf = dir.join("canopi_test_v7_round_trip.canopi");

        let mut value = serde_json::to_value(create_default()).expect("default design serializes");
        value["plants"] = json!([{
            "id": "plant-1",
            "canonical_name": "Quercus robur",
            "position": { "lon": 2.352_212_345_6, "lat": 48.856_612_345_6 }
        }]);
        value["zones"] = json!([{
            "name": "North bed",
            "zone_type": "rect",
            "points": [
                { "lon": 2.3522, "lat": 48.8567 },
                { "lon": 2.3523, "lat": 48.8566 }
            ],
            "rotation": 30.0
        }]);
        value["measurement_guides"] = json!([{
            "id": "guide-1",
            "start": { "lon": -180.0, "lat": -85.0511287798066 },
            "end": { "lon": 180.0, "lat": 85.0511287798066 }
        }]);
        value["future_panel_field"] = json!({ "preserve": true });
        value["consortiums"] = json!([
            {
                "target": { "kind": "species", "canonical_name": "Quercus robur" },
                "stratum": "high",
                "start_phase": 0,
                "end_phase": 3
            }
        ]);
        value["timeline"] = json!([
            {
                "id": "task-1",
                "action_type": "planting",
                "description": "Plant oak",
                "start_date": "2026-04-01",
                "end_date": "2026-04-02",
                "recurrence": null,
                "targets": [
                    { "kind": "species", "canonical_name": "Quercus robur" },
                    { "kind": "zone", "zone_name": "North bed" }
                ],
                "depends_on": null,
                "completed": false,
                "order": 0
            }
        ]);
        value["budget"] = json!([
            {
                "target": { "kind": "species", "canonical_name": "Quercus robur" },
                "category": "plants",
                "description": "English oak",
                "quantity": 1,
                "unit_cost": 25,
                "currency": "EUR"
            }
        ]);

        std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap())
            .expect("write v7 file");
        let loaded = load_from_file(&path).expect("v7 file should load");
        save_to_file(&path, &loaded, None).expect("v7 file should save");
        let reloaded = load_from_file(&path).expect("saved v7 file should reload");

        assert_eq!(reloaded.version, CURRENT_CANOPI_FILE_VERSION);
        let reloaded_value = serde_json::to_value(&reloaded).expect("reloaded design serializes");
        assert_eq!(
            reloaded_value["plants"][0]["position"],
            value["plants"][0]["position"]
        );
        assert_eq!(
            reloaded_value["zones"][0]["points"],
            value["zones"][0]["points"]
        );
        assert_eq!(reloaded_value["zones"][0]["rotation"], json!(30.0));
        assert_eq!(
            reloaded_value["measurement_guides"][0]["start"],
            value["measurement_guides"][0]["start"]
        );
        assert_eq!(
            reloaded_value["measurement_guides"][0]["end"],
            value["measurement_guides"][0]["end"]
        );
        assert!(reloaded_value.get("spatial_frame").is_none());
        assert_eq!(reloaded.consortiums.len(), 1);
        assert_eq!(reloaded.timeline.len(), 1);
        assert_eq!(reloaded.timeline[0].targets.len(), 2);
        assert!(matches!(
            reloaded.timeline[0].targets[0],
            PanelTarget::Species { .. }
        ));
        assert_eq!(reloaded.budget.len(), 1);
        assert!(matches!(
            reloaded.budget[0].target,
            PanelTarget::Species { .. }
        ));
        assert_eq!(
            reloaded
                .extra
                .get("future_panel_field")
                .and_then(|field| field.get("preserve"))
                .and_then(|preserve| preserve.as_bool()),
            Some(true),
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_budget_currency_is_a_named_defaulted_field() {
        use serde_json::json;

        let mut value = serde_json::to_value(create_default()).expect("serialize");
        value["budget_currency"] = json!("USD");

        let loaded: CanopiFile = serde_json::from_value(value).expect("deserialize");
        assert_eq!(loaded.budget_currency, "USD");
        assert!(!loaded.extra.contains_key("budget_currency"));

        let mut without_currency = serde_json::to_value(create_default()).expect("serialize");
        without_currency
            .as_object_mut()
            .expect("default design serializes to object")
            .remove("budget_currency");

        let defaulted: CanopiFile =
            serde_json::from_value(without_currency).expect("budget_currency is optional");
        assert_eq!(defaulted.budget_currency, DEFAULT_BUDGET_CURRENCY);
    }

    fn unique_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "canopi_format_{label}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_root_extra_key_is_refused_not_flattened() {
        let mut value = serde_json::to_value(create_default()).expect("serialize");
        value["extra"] = serde_json::json!({ "future_field": true });

        let error = decode_design_value(value).expect_err("root extra must be refused");

        assert_eq!(error.kind, CanopiDesignIngestionErrorKind::InvalidDocument);
        assert!(error.message.starts_with("$.extra:"), "{error}");
    }

    #[test]
    fn opening_a_design_over_the_size_limit_is_refused() {
        let dir = unique_dir("too_large");
        let path = dir.join("huge.canopi");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_CANOPI_FILE_BYTES + 1).unwrap();
        drop(file);

        let error = load_from_file(&path).expect_err("oversized Design must be refused");

        assert!(matches!(error, DesignLoadError::TooLarge { .. }), "{error}");
        assert!(error.to_string().contains("64 MiB"), "{error}");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn export_writes_a_loadable_design_without_leaving_a_temporary() {
        let dir = unique_dir("export");
        let path = dir.join("stamp.canopi");
        std::fs::write(&path, "an earlier export").unwrap();

        export_to_file(&path, &create_default()).expect("export should succeed");

        assert_eq!(load_from_file(&path).unwrap().name, "Untitled");
        assert!(owned_sidecars(&dir, "export").is_empty());

        let _ = std::fs::remove_dir_all(dir);
    }

    fn named(name: &str) -> CanopiFile {
        let mut design = create_default();
        design.name = name.to_owned();
        design
    }

    fn saved_fingerprint(result: SaveResult) -> String {
        match result {
            SaveResult::Saved { fingerprint } => fingerprint,
            SaveResult::Conflict { .. } => panic!("expected the save to be written"),
        }
    }

    #[test]
    fn saved_and_loaded_fingerprints_are_the_sha256_of_the_file_bytes() {
        let dir = unique_dir("fingerprint");
        let path = dir.join("garden.canopi");

        let saved = saved_fingerprint(save_to_file(&path, &named("Garden"), None).unwrap());
        let (loaded, loaded_fingerprint) = load_with_fingerprint(&path).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(saved, crate::design::fingerprint(&bytes));
        assert_eq!(loaded_fingerprint, saved);
        assert_eq!(saved.len(), 64);
        assert!(
            saved
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
        );
        assert_eq!(loaded.name, "Garden");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_save_expecting_the_current_fingerprint_writes_and_returns_the_next_one() {
        let dir = unique_dir("fingerprint_match");
        let path = dir.join("garden.canopi");
        let first = saved_fingerprint(save_to_file(&path, &named("First"), None).unwrap());

        let second =
            saved_fingerprint(save_to_file(&path, &named("Second"), Some(&first)).unwrap());

        assert_ne!(second, first);
        assert_eq!(load_from_file(&path).unwrap().name, "Second");
        let third = saved_fingerprint(save_to_file(&path, &named("Third"), Some(&second)).unwrap());
        assert_eq!(load_with_fingerprint(&path).unwrap().1, third);
        let entries = std::fs::read_dir(&dir).unwrap().count();
        assert_eq!(entries, 1, "a save leaves only the Design file, no backup");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_save_after_an_outside_change_is_a_conflict_and_writes_nothing() {
        let dir = unique_dir("fingerprint_conflict");
        let path = dir.join("garden.canopi");
        let opened = saved_fingerprint(save_to_file(&path, &named("Mine"), None).unwrap());
        std::fs::write(&path, "changed by another program").unwrap();

        let result = save_to_file(&path, &named("Mine, edited"), Some(&opened)).unwrap();

        assert_eq!(
            result,
            SaveResult::Conflict {
                current_fingerprint: Some(crate::design::fingerprint(
                    b"changed by another program"
                )),
            }
        );
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "changed by another program"
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_save_expecting_a_deleted_file_is_a_conflict_and_does_not_recreate_it() {
        let dir = unique_dir("fingerprint_deleted");
        let path = dir.join("garden.canopi");
        let opened = saved_fingerprint(save_to_file(&path, &named("Mine"), None).unwrap());
        std::fs::remove_file(&path).unwrap();

        let result = save_to_file(&path, &named("Mine"), Some(&opened)).unwrap();

        assert_eq!(
            result,
            SaveResult::Conflict {
                current_fingerprint: None
            }
        );
        assert!(!path.exists());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_save_without_an_expected_fingerprint_overwrites_an_outside_change() {
        let dir = unique_dir("fingerprint_overwrite");
        let path = dir.join("garden.canopi");
        std::fs::write(&path, "changed by another program").unwrap();

        let fingerprint =
            saved_fingerprint(save_to_file(&path, &named("Keep mine"), None).unwrap());

        let (loaded, loaded_fingerprint) = load_with_fingerprint(&path).unwrap();
        assert_eq!(loaded.name, "Keep mine");
        assert_eq!(loaded_fingerprint, fingerprint);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_save_that_cannot_check_the_target_fails_without_writing() {
        let dir = unique_dir("fingerprint_unreadable");
        // A directory at the target cannot be read as a file.
        let path = dir.join("garden.canopi");
        std::fs::create_dir(&path).unwrap();

        let result = save_to_file(&path, &named("Mine"), Some("0"));

        assert!(result.is_err(), "{result:?}");
        assert!(path.is_dir());
        assert!(owned_sidecars(&dir, "tmp").is_empty());

        let _ = std::fs::remove_dir_all(dir);
    }
}
