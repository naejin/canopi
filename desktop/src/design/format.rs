use common_types::design::{
    Annotation, BudgetItem, CanopiFile, Consortium, Layer, PlacedPlant, TimelineAction, Zone,
};
use std::path::Path;

/// Save a `CanopiFile` to disk atomically.
///
/// Steps:
/// 1. If the target file already exists, copy it to `{path}.prev` as a backup.
/// 2. Serialize and write to `{path}.tmp`.
/// 3. Rename `{path}.tmp` → `{path}`.
///
/// On any write/rename error the `.tmp` file is removed before returning.
pub fn save_to_file(path: &Path, content: &CanopiFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(content)
        .map_err(|e| format!("Failed to serialize design: {e}"))?;

    // Backup the existing file, ignoring errors (e.g. first save).
    if path.exists() {
        let backup = path.with_extension("canopi.prev");
        if let Err(e) = std::fs::copy(path, &backup) {
            tracing::warn!("Could not create backup at {}: {e}", backup.display());
        }
    }

    let tmp_path = path.with_extension("canopi.tmp");

    // Write to .tmp first.
    if let Err(e) = std::fs::write(&tmp_path, &json) {
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
/// Reads the file, deserializes as `serde_json::Value` first (allowing
/// future migration hooks), then deserializes into `CanopiFile`.
/// Unknown fields are preserved in `CanopiFile::extra` via `#[serde(flatten)]`.
pub fn load_from_file(path: &Path) -> Result<CanopiFile, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;

    // Parse to Value so we can inspect the version before full deserialization.
    let mut value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON in {}: {e}", path.display()))?;

    // Log the version for diagnostics; migration hooks go here in the future.
    if let Some(v) = value.get("version").and_then(|v| v.as_u64())
        && v > 1
    {
        tracing::info!(
            "Loading design version {} from {}; current app supports version 1",
            v,
            path.display()
        );
    }

    migrate_legacy_consortiums(&mut value);

    // Deserialize — unknown fields survive in `extra`.
    let file: CanopiFile = serde_json::from_value(value)
        .map_err(|e| format!("Failed to parse design from {}: {e}", path.display()))?;

    Ok(file)
}

fn migrate_legacy_consortiums(value: &mut serde_json::Value) {
    let mut plant_lookup = std::collections::HashMap::<String, String>::new();
    if let Some(plants) = value.get("plants").and_then(|plants| plants.as_array()) {
        for plant in plants {
            let Some(canonical) = plant.get("canonical_name").and_then(|name| name.as_str()) else {
                continue;
            };
            if let Some(id) = plant.get("id").and_then(|id| id.as_str())
                && !id.is_empty()
            {
                plant_lookup.insert(id.to_string(), canonical.to_string());
            }
            plant_lookup.insert(canonical.to_string(), canonical.to_string());
        }
    }

    let Some(consortiums) = value
        .get_mut("consortiums")
        .and_then(|consortiums| consortiums.as_array_mut())
    else {
        return;
    };

    let mut migrated = Vec::with_capacity(consortiums.len());
    let mut seen_species = std::collections::HashSet::<String>::new();
    for entry in consortiums.iter() {
        if entry.get("canonical_name").is_some() {
            if let Some(canonical) = entry
                .get("canonical_name")
                .and_then(|canonical| canonical.as_str())
            {
                seen_species.insert(canonical.trim().to_string());
            }
            migrated.push(entry.clone());
            continue;
        }

        let species_refs = entry
            .get("plant_ids")
            .or_else(|| entry.get("plants"))
            .and_then(|refs| refs.as_array());
        let Some(species_refs) = species_refs else {
            continue;
        };

        for raw_ref in species_refs {
            let Some(raw_ref) = raw_ref.as_str() else {
                continue;
            };
            let canonical = plant_lookup
                .get(raw_ref)
                .map(String::as_str)
                .unwrap_or(raw_ref)
                .trim();
            if canonical.is_empty() || !seen_species.insert(canonical.to_string()) {
                continue;
            }
            migrated.push(serde_json::json!({
                "canonical_name": canonical,
                "stratum": "unassigned",
                "start_phase": 0,
                "end_phase": 2,
            }));
        }
    }

    *consortiums = migrated;
}

/// ISO 8601 timestamp for the current UTC moment using only `std`.
fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    crate::design::unix_to_iso8601(secs)
}

/// Create a new empty design with 7 default layers and sensible defaults.
pub fn create_default() -> CanopiFile {
    let now = now_iso8601();

    let layers = vec![
        Layer {
            name: "base".into(),
            visible: true,
            locked: false,
            opacity: 1.0,
        },
        Layer {
            name: "contours".into(),
            visible: false,
            locked: false,
            opacity: 1.0,
        },
        Layer {
            name: "climate".into(),
            visible: false,
            locked: false,
            opacity: 1.0,
        },
        Layer {
            name: "zones".into(),
            visible: true,
            locked: false,
            opacity: 1.0,
        },
        Layer {
            name: "water".into(),
            visible: false,
            locked: false,
            opacity: 1.0,
        },
        Layer {
            name: "plants".into(),
            visible: true,
            locked: false,
            opacity: 1.0,
        },
        Layer {
            name: "annotations".into(),
            visible: true,
            locked: false,
            opacity: 1.0,
        },
    ];

    CanopiFile {
        version: 1,
        name: "Untitled".into(),
        description: None,
        location: None,
        north_bearing_deg: None,
        plant_species_colors: std::collections::HashMap::new(),
        layers,
        plants: Vec::<PlacedPlant>::new(),
        zones: Vec::<Zone>::new(),
        annotations: Vec::<Annotation>::new(),
        consortiums: Vec::<Consortium>::new(),
        groups: Vec::new(),
        timeline: Vec::<TimelineAction>::new(),
        budget: Vec::<BudgetItem>::new(),
        created_at: now.clone(),
        updated_at: now,
        extra: std::collections::HashMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_create_default_has_seven_layers() {
        let design = create_default();
        assert_eq!(design.version, 1);
        assert_eq!(design.name, "Untitled");
        assert_eq!(design.layers.len(), 7);
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
                ("base", true),
                ("contours", false),
                ("climate", false),
                ("zones", true),
                ("water", false),
                ("plants", true),
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
        assert_eq!(loaded.layers.len(), 7);

        // Clean up
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("canopi.prev"));
    }

    #[test]
    fn test_atomic_write_creates_tmp_then_final() {
        let dir = std::env::temp_dir();
        let path: PathBuf = dir.join("canopi_test_atomic.canopi");
        let tmp_path = path.with_extension("canopi.tmp");

        // Ensure clean state
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&tmp_path);

        let design = create_default();
        save_to_file(&path, &design).expect("save should succeed");

        assert!(path.exists(), "final file should exist");
        assert!(!tmp_path.exists(), "tmp file should have been renamed away");

        let _ = std::fs::remove_file(&path);
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
    fn test_load_migrates_legacy_consortiums() {
        use serde_json::json;

        let dir = std::env::temp_dir();
        let path: PathBuf = dir.join("canopi_test_legacy_consortiums.canopi");

        let mut value = serde_json::to_value(create_default()).expect("default design serializes");
        value["plants"] = json!([
            {
                "id": "plant-1",
                "canonical_name": "Quercus robur",
                "common_name": "English oak",
                "position": { "x": 0.0, "y": 0.0 },
                "rotation": null,
                "scale": null,
                "notes": null,
                "planted_date": null,
                "quantity": null
            },
            {
                "id": "plant-2",
                "canonical_name": "Acer campestre",
                "common_name": "Field maple",
                "position": { "x": 1.0, "y": 1.0 },
                "rotation": null,
                "scale": null,
                "notes": null,
                "planted_date": null,
                "quantity": null
            }
        ]);
        value["consortiums"] = json!([
            {
                "id": "legacy",
                "name": "Old group",
                "plant_ids": ["plant-1", "Acer campestre", "plant-1"],
                "notes": null
            }
        ]);

        std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap())
            .expect("write legacy file");
        let loaded = load_from_file(&path).expect("legacy consortiums should migrate");
        let names: std::collections::HashSet<_> = loaded
            .consortiums
            .iter()
            .map(|entry| entry.canonical_name.as_str())
            .collect();

        assert_eq!(loaded.consortiums.len(), 2);
        assert_eq!(
            names,
            std::collections::HashSet::from(["Quercus robur", "Acer campestre"]),
        );
        assert!(
            loaded
                .consortiums
                .iter()
                .all(|entry| entry.stratum == "unassigned"
                    && entry.start_phase == 0
                    && entry.end_phase == 2),
        );

        let _ = std::fs::remove_file(&path);
    }
}
