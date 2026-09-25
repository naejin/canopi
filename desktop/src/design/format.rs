use common_types::design::{
    CURRENT_CANOPI_FILE_VERSION, CanopiDesignIngestionErrorKind, CanopiFile,
    DEFAULT_BUDGET_CURRENCY, Layer, MISSING_CANOPI_FILE_VERSION, OBSOLETE_CANOPI_ROOT_KEYS,
    validate_design_geometry,
};
use std::fmt;
use std::path::Path;

use super::new_design_defaults::NEW_DESIGN_LAYER_DEFAULTS;

#[derive(Debug)]
struct CanopiDesignIngestionError {
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

/// Save a `CanopiFile` to disk atomically.
///
/// Steps:
/// 1. If the target file already exists, copy it to `{path}.prev` as a backup.
/// 2. Serialize and write to an operation-owned temporary sidecar.
/// 3. Rename the temporary sidecar to `{path}`.
///
/// On any write/rename error the operation's sidecar is removed before returning.
pub fn save_to_file(path: &Path, content: &CanopiFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(content)
        .map_err(|e| format!("Failed to serialize design: {e}"))?;
    let backup = path.with_extension("canopi.prev");
    super::with_write_admissions(&[path, backup.as_path()], || {
        save_to_file_admitted(path, &backup, &json)
    })
}

fn save_to_file_admitted(path: &Path, backup: &Path, json: &str) -> Result<(), String> {
    // Backup the existing file, ignoring errors (e.g. first save).
    if path.exists()
        && let Err(e) = std::fs::copy(path, backup)
    {
        tracing::warn!("Could not create backup at {}: {e}", backup.display());
    }

    let tmp_path = super::operation_sidecar_path(path, "tmp");

    // Write to the operation's sidecar first.
    if let Err(e) = std::fs::write(&tmp_path, json) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("Failed to write {}: {e}", tmp_path.display()));
    }

    // Atomic replace .tmp → final path (cross-platform safe).
    if let Err(e) = super::atomic_replace(&tmp_path, path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!(
            "Failed to finalise save at {}: {e}",
            path.display()
        ));
    }

    Ok(())
}

/// Load a `CanopiFile` from disk.
///
/// Reads the file, deserializes as `serde_json::Value` first for strict
/// version admission, then deserializes into `CanopiFile`.
/// Unknown fields are preserved in `CanopiFile::extra` via `#[serde(flatten)]`.
pub fn load_from_file(path: &Path) -> Result<CanopiFile, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;

    // Parse to Value so we can inspect the version before full deserialization.
    let value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON in {}: {e}", path.display()))?;

    decode_design_value(value)
        .map_err(|error| format!("Failed to parse design from {}: {error}", path.display()))
}

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
    let mut file: CanopiFile = serde_json::from_value(value).map_err(|error| {
        CanopiDesignIngestionError::new(
            CanopiDesignIngestionErrorKind::InvalidDocument,
            format!("$: {error}"),
        )
    })?;
    validate_design_geometry(&file).map_err(|error| {
        CanopiDesignIngestionError::new(CanopiDesignIngestionErrorKind::InvalidDocument, error)
    })?;
    normalize_loaded_extra(&mut file);
    Ok(file)
}

fn normalize_loaded_extra(file: &mut CanopiFile) {
    let Some(serde_json::Value::Object(nested)) = file.extra.remove("extra") else {
        return;
    };
    for (key, value) in nested {
        if is_known_canopi_key(&key) {
            continue;
        }
        file.extra.entry(key).or_insert(value);
    }
}

fn is_known_canopi_key(key: &str) -> bool {
    common_types::design::DESIGN_FILE_FIELDS
        .iter()
        .any(|field| field.key == key)
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
    use common_types::design::{MIN_SUPPORTED_CANOPI_FILE_VERSION, PanelTarget};
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
                "minimum_supported_version": MIN_SUPPORTED_CANOPI_FILE_VERSION,
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
            if key == "extra" {
                if let Some(entries) = value.as_object() {
                    extra.extend(entries.clone());
                }
            } else {
                extra.insert(key, value);
            }
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
        save_to_file(&path, &original).expect("save should succeed");
        assert!(path.exists());

        let loaded = load_from_file(&path).expect("load should succeed");
        assert_eq!(loaded.name, original.name);
        assert_eq!(loaded.version, original.version);
        assert_eq!(loaded.layers.len(), 6);

        // Clean up
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("canopi.prev"));
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
                    .send(save_to_file(&writer_path, &replacement))
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
    fn primary_save_waits_for_admitted_stable_backup_target() {
        use std::sync::mpsc;
        use std::time::Duration;

        let dir = std::env::temp_dir().join(format!(
            "canopi_save_family_admission_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let primary_path = dir.join("garden.canopi");
        let backup_path = primary_path.with_extension("canopi.prev");
        let mut design = create_default();
        design.name = "Overlapping backup target".to_owned();
        let writer_path = primary_path.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();

        let writer = crate::design::with_write_admission(&backup_path, || {
            let writer = std::thread::spawn(move || {
                started_tx.send(()).unwrap();
                finished_tx
                    .send(save_to_file(&writer_path, &design))
                    .unwrap();
            });
            started_rx.recv().unwrap();
            assert!(
                finished_rx
                    .recv_timeout(Duration::from_millis(250))
                    .is_err(),
                "a primary save entered while its stable backup target was admitted"
            );
            writer
        });

        finished_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("primary save should continue after backup admission releases")
            .expect("primary save should succeed");
        writer.join().unwrap();
        assert_eq!(
            load_from_file(&primary_path).unwrap().name,
            "Overlapping backup target"
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_saves_preserve_final_and_previous_designs() {
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
        save_to_file(&path, &initial).unwrap();

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
                save_to_file(&writer_path, &design)
            }));
        }
        barrier.wait();
        for writer in writers {
            writer.join().unwrap().unwrap();
        }

        let final_design = load_from_file(&path).unwrap();
        let previous_design = load_from_file(&path.with_extension("canopi.prev")).unwrap();
        assert!(expected_names.contains(&final_design.name));
        assert!(expected_names.contains(&previous_design.name));
        assert_ne!(final_design.name, previous_design.name);
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
        save_to_file(&path, &design).expect("save should succeed");

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

        save_to_file(&path, &create_default()).expect("save should succeed");

        assert_eq!(
            std::fs::read_to_string(&legacy_tmp).unwrap(),
            "another operation owns this"
        );
        assert!(load_from_file(&path).is_ok());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_backup_created_on_overwrite() {
        let dir = std::env::temp_dir();
        let path: PathBuf = dir.join("canopi_test_backup.canopi");
        let prev_path = path.with_extension("canopi.prev");

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&prev_path);

        let design = create_default();
        // First save — no backup yet.
        save_to_file(&path, &design).expect("first save");
        assert!(
            !prev_path.exists(),
            ".prev should not exist after first save"
        );

        // Second save — should create .prev.
        save_to_file(&path, &design).expect("second save");
        assert!(prev_path.exists(), ".prev should exist after second save");

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&prev_path);
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

        save_to_file(&path, &design).expect("save");
        let loaded = load_from_file(&path).expect("load");

        assert_eq!(
            loaded.extra.get("future_field").and_then(|v| v.as_str()),
            Some("from_future"),
            "unknown fields should survive round-trip"
        );

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("canopi.prev"));
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
        save_to_file(&path, &loaded).expect("v7 file should save");
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
        let _ = std::fs::remove_file(path.with_extension("canopi.prev"));
    }

    #[test]
    fn test_budget_currency_is_a_named_defaulted_field() {
        use serde_json::json;

        let mut value = serde_json::to_value(create_default()).expect("serialize");
        value["budget_currency"] = json!("USD");

        let loaded: CanopiFile = serde_json::from_value(value).expect("deserialize");
        assert_eq!(loaded.budget_currency, "USD");
        assert!(!loaded.extra.contains_key("budget_currency"));

        let mut legacy_value = serde_json::to_value(create_default()).expect("serialize");
        legacy_value
            .as_object_mut()
            .expect("default design serializes to object")
            .remove("budget_currency");

        let legacy: CanopiFile = serde_json::from_value(legacy_value).expect("deserialize legacy");
        assert_eq!(legacy.budget_currency, DEFAULT_BUDGET_CURRENCY);
    }
}
