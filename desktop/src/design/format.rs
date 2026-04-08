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

    // Log the version for diagnostics.
    if let Some(v) = value.get("version").and_then(|v| v.as_u64())
        && v > 2
    {
        tracing::info!(
            "Loading design version {} from {}; current app supports version 2",
            v,
            path.display()
        );
    }

    migrate_design_value(&mut value);

    // Deserialize — unknown fields survive in `extra`.
    let file: CanopiFile = serde_json::from_value(value)
        .map_err(|e| format!("Failed to parse design from {}: {e}", path.display()))?;

    Ok(file)
}

fn migrate_design_value(value: &mut serde_json::Value) {
    let version = value.get("version").and_then(|v| v.as_u64()).unwrap_or(1);
    if version <= 1 {
        migrate_v1_to_v2(value);
    }
}

fn migrate_v1_to_v2(value: &mut serde_json::Value) {
    migrate_legacy_timeline_targets(value);
    migrate_legacy_budget_targets(value);
    migrate_legacy_consortiums(value);
    value["version"] = serde_json::json!(2);
}

fn species_target(canonical_name: &str) -> serde_json::Value {
    serde_json::json!({ "kind": "species", "canonical_name": canonical_name })
}

fn manual_target() -> serde_json::Value {
    serde_json::json!({ "kind": "manual" })
}

fn migrate_legacy_timeline_targets(value: &mut serde_json::Value) {
    let plant_ids: std::collections::HashSet<String> = value
        .get("plants")
        .and_then(|plants| plants.as_array())
        .into_iter()
        .flatten()
        .filter_map(|plant| plant.get("id").and_then(|id| id.as_str()))
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .collect();

    let Some(timeline) = value
        .get_mut("timeline")
        .and_then(|timeline| timeline.as_array_mut())
    else {
        return;
    };

    for action in timeline {
        if action.get("targets").and_then(|targets| targets.as_array()).is_some() {
            continue;
        }

        let mut targets = Vec::<serde_json::Value>::new();
        if let Some(plants) = action.get("plants").and_then(|plants| plants.as_array()) {
            for plant_ref in plants {
                let Some(raw_ref) = plant_ref.as_str().map(str::trim).filter(|raw_ref| !raw_ref.is_empty()) else {
                    continue;
                };
                if plant_ids.contains(raw_ref) {
                    targets.push(serde_json::json!({ "kind": "placed_plant", "plant_id": raw_ref }));
                } else {
                    targets.push(species_target(raw_ref));
                }
            }
        }

        if let Some(zone) = action
            .get("zone")
            .and_then(|zone| zone.as_str())
            .map(str::trim)
            .filter(|zone| !zone.is_empty())
        {
            targets.push(serde_json::json!({ "kind": "zone", "zone_name": zone }));
        }

        if targets.is_empty() {
            targets.push(manual_target());
        }
        action["targets"] = serde_json::Value::Array(targets);
    }
}

fn migrate_legacy_budget_targets(value: &mut serde_json::Value) {
    let Some(budget) = value
        .get_mut("budget")
        .and_then(|budget| budget.as_array_mut())
    else {
        return;
    };

    for item in budget {
        if item.get("target").is_some() {
            continue;
        }
        let category = item.get("category").and_then(|category| category.as_str());
        let description = item
            .get("description")
            .and_then(|description| description.as_str())
            .map(str::trim)
            .unwrap_or_default();
        item["target"] = if category == Some("plants") && !description.is_empty() {
            species_target(description)
        } else {
            manual_target()
        };
    }
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
            let mut next = entry.clone();
            if next.get("target").is_none()
                && let Some(canonical) = next
                    .get("canonical_name")
                    .and_then(|canonical| canonical.as_str())
                    .map(str::trim)
            {
                next["target"] = species_target(canonical);
            }
            migrated.push(next);
            continue;
        }

        if entry.get("target").is_some() {
            if let Some(canonical) = entry
                .get("target")
                .and_then(|target| target.get("canonical_name"))
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
                "target": species_target(canonical),
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
        version: 2,
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
    use common_types::design::PanelTarget;
    use std::path::PathBuf;

    #[test]
    fn test_create_default_has_seven_layers() {
        let design = create_default();
        assert_eq!(design.version, 2);
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
        value["version"] = json!(1);
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
            .map(|entry| entry.target.canonical_name.as_str())
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

    #[test]
    fn test_load_migrates_legacy_timeline_and_budget_targets() {
        use serde_json::json;

        let dir = std::env::temp_dir();
        let path: PathBuf = dir.join("canopi_test_panel_targets.canopi");

        let mut value = serde_json::to_value(create_default()).expect("default design serializes");
        value["version"] = json!(1);
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
            }
        ]);
        value["timeline"] = json!([
            {
                "id": "task-1",
                "action_type": "planting",
                "description": "Plant oak",
                "start_date": "2026-04-01",
                "end_date": null,
                "recurrence": null,
                "plants": ["plant-1", "Malus domestica"],
                "zone": "North bed",
                "depends_on": null,
                "completed": false,
                "order": 0
            }
        ]);
        value["budget"] = json!([
            {
                "category": "plants",
                "description": "Quercus robur",
                "quantity": 1,
                "unit_cost": 25,
                "currency": "EUR"
            }
        ]);

        std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap())
            .expect("write legacy file");
        let loaded = load_from_file(&path).expect("legacy panel targets should migrate");

        assert_eq!(loaded.version, 2);
        assert_eq!(loaded.timeline[0].targets.len(), 3);
        assert!(matches!(loaded.timeline[0].targets[0], PanelTarget::PlacedPlant { .. }));
        assert!(matches!(loaded.timeline[0].targets[1], PanelTarget::Species { .. }));
        assert!(matches!(loaded.timeline[0].targets[2], PanelTarget::Zone { .. }));
        assert!(matches!(loaded.budget[0].target, PanelTarget::Species { .. }));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_v2_panel_sections_and_unknown_fields_round_trip() {
        use serde_json::json;

        let dir = std::env::temp_dir();
        let path: PathBuf = dir.join("canopi_test_v2_panel_round_trip.canopi");

        let mut value = serde_json::to_value(create_default()).expect("default design serializes");
        value["location"] = json!({ "lat": 48.8566, "lon": 2.3522, "altitude_m": 35 });
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

        std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap()).expect("write v2 file");
        let loaded = load_from_file(&path).expect("v2 file should load");
        save_to_file(&path, &loaded).expect("v2 file should save");
        let reloaded = load_from_file(&path).expect("saved v2 file should reload");

        assert_eq!(reloaded.version, 2);
        assert_eq!(reloaded.location.as_ref().map(|location| location.lat), Some(48.8566));
        assert_eq!(reloaded.consortiums.len(), 1);
        assert_eq!(reloaded.timeline[0].targets.len(), 2);
        assert!(matches!(reloaded.timeline[0].targets[0], PanelTarget::Species { .. }));
        assert!(matches!(reloaded.budget[0].target, PanelTarget::Species { .. }));
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
}
