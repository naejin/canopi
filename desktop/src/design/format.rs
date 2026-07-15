use common_types::design::{
    CURRENT_CANOPI_FILE_VERSION, CanopiFile, DEFAULT_BUDGET_CURRENCY, Layer,
};
use std::path::Path;

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
        && v > CURRENT_CANOPI_FILE_VERSION as u64
    {
        tracing::info!(
            "Loading design version {} from {}; current app supports version {}",
            v,
            path.display(),
            CURRENT_CANOPI_FILE_VERSION,
        );
    }

    migrate_design_value(&mut value);
    report_legacy_object_group_migration_issues(path, &value);

    // Deserialize — unknown fields survive in `extra`.
    let file: CanopiFile = serde_json::from_value(value)
        .map_err(|e| format!("Failed to parse design from {}: {e}", path.display()))?;

    Ok(file)
}

fn migrate_design_value(value: &mut serde_json::Value) {
    loop {
        let version = value.get("version").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
        if version >= CURRENT_CANOPI_FILE_VERSION {
            break;
        }
        match version {
            1 => migrate_v1_to_v2(value),
            2 => migrate_v2_to_v3(value),
            3 => migrate_v3_to_v4(value),
            4 => migrate_v4_to_v5(value),
            _ => {
                tracing::warn!("Unknown file version {version} during migration, stopping");
                break;
            }
        }
    }
}

fn migrate_v1_to_v2(value: &mut serde_json::Value) {
    migrate_legacy_timeline_targets(value);
    migrate_legacy_budget_targets(value);
    migrate_legacy_consortiums(value);
    value["version"] = serde_json::json!(2);
}

fn migrate_v2_to_v3(value: &mut serde_json::Value) {
    if value.get("plant_species_symbols").is_none() {
        value["plant_species_symbols"] = serde_json::json!({});
    }
    value["version"] = serde_json::json!(3);
}

fn migrate_v3_to_v4(value: &mut serde_json::Value) {
    if let Some(plants) = value
        .get_mut("plants")
        .and_then(|plants| plants.as_array_mut())
    {
        for plant in plants {
            if plant.get("pinned_name").is_none() {
                plant["pinned_name"] = serde_json::json!(false);
            }
        }
    }
    value["version"] = serde_json::json!(4);
}

fn migrate_v4_to_v5(value: &mut serde_json::Value) {
    if value.get("measurement_guides").is_none() {
        value["measurement_guides"] = serde_json::json!([]);
    }
    ensure_measurement_guides_layer(value);
    value["version"] = serde_json::json!(5);
}

fn ensure_measurement_guides_layer(value: &mut serde_json::Value) {
    let Some(layers) = value
        .get_mut("layers")
        .and_then(|layers| layers.as_array_mut())
    else {
        return;
    };
    if layers
        .iter()
        .any(|layer| layer.get("name").and_then(|name| name.as_str()) == Some("measurement-guides"))
    {
        return;
    }

    let insert_index = layers
        .iter()
        .position(|layer| layer.get("name").and_then(|name| name.as_str()) == Some("annotations"))
        .unwrap_or(layers.len());
    layers.insert(
        insert_index,
        serde_json::json!({
            "name": "measurement-guides",
            "visible": true,
            "locked": false,
            "opacity": 1.0,
        }),
    );
}

#[derive(Debug, Default, PartialEq, Eq)]
struct LegacyObjectGroupMigrationReport {
    ambiguous_members: Vec<String>,
    missing_members: Vec<String>,
    dropped_groups: Vec<String>,
}

fn report_legacy_object_group_migration_issues(path: &Path, value: &serde_json::Value) {
    let report = collect_legacy_object_group_migration_report(value);
    if report == LegacyObjectGroupMigrationReport::default() {
        return;
    }

    tracing::warn!(
        "Migrated legacy Object Groups while loading {}: ambiguous members [{}], missing members [{}], dropped groups [{}]",
        path.display(),
        report.ambiguous_members.join(", "),
        report.missing_members.join(", "),
        report.dropped_groups.join(", "),
    );
}

fn collect_legacy_object_group_migration_report(
    value: &serde_json::Value,
) -> LegacyObjectGroupMigrationReport {
    let plant_ids = collect_string_field_set(value, "plants", "id");
    let zone_names = collect_string_field_set(value, "zones", "name");
    let annotation_ids = collect_string_field_set(value, "annotations", "id");
    let mut report = LegacyObjectGroupMigrationReport::default();

    let Some(groups) = value.get("groups").and_then(|groups| groups.as_array()) else {
        return report;
    };

    for group in groups {
        if group.get("members").is_some() {
            continue;
        }
        let group_id = group
            .get("id")
            .and_then(|id| id.as_str())
            .unwrap_or("<missing group id>");
        let Some(member_ids) = group
            .get("member_ids")
            .and_then(|member_ids| member_ids.as_array())
        else {
            continue;
        };

        let mut resolved = std::collections::HashSet::<String>::new();
        for member_id in member_ids {
            let Some(member_id) = member_id.as_str() else {
                continue;
            };
            let matches = [
                plant_ids.contains(member_id),
                zone_names.contains(member_id),
                annotation_ids.contains(member_id),
            ]
            .into_iter()
            .filter(|matched| *matched)
            .count();
            match matches {
                0 => report
                    .missing_members
                    .push(format!("{group_id}:{member_id}")),
                1 => {
                    let kind = if plant_ids.contains(member_id) {
                        "plant"
                    } else if zone_names.contains(member_id) {
                        "zone"
                    } else {
                        "annotation"
                    };
                    resolved.insert(format!("{kind}:{member_id}"));
                }
                _ => report
                    .ambiguous_members
                    .push(format!("{group_id}:{member_id}")),
            }
        }

        if resolved.len() < 2 {
            report.dropped_groups.push(group_id.to_owned());
        }
    }

    report
}

fn collect_string_field_set(
    value: &serde_json::Value,
    collection_key: &str,
    field_key: &str,
) -> std::collections::HashSet<String> {
    value
        .get(collection_key)
        .and_then(|entries| entries.as_array())
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get(field_key).and_then(|field| field.as_str()))
        .map(str::to_owned)
        .collect()
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
        if action
            .get("targets")
            .and_then(|targets| targets.as_array())
            .is_some()
        {
            continue;
        }

        let mut targets = Vec::<serde_json::Value>::new();
        if let Some(plants) = action.get("plants").and_then(|plants| plants.as_array()) {
            for plant_ref in plants {
                let Some(raw_ref) = plant_ref
                    .as_str()
                    .map(str::trim)
                    .filter(|raw_ref| !raw_ref.is_empty())
                else {
                    continue;
                };
                if plant_ids.contains(raw_ref) {
                    targets
                        .push(serde_json::json!({ "kind": "placed_plant", "plant_id": raw_ref }));
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
            name: "measurement-guides".into(),
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
        version: CURRENT_CANOPI_FILE_VERSION,
        name: "Untitled".into(),
        description: None,
        location: None,
        north_bearing_deg: None,
        plant_species_colors: std::collections::HashMap::new(),
        plant_species_symbols: std::collections::HashMap::new(),
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
    fn test_create_default_has_eight_layers() {
        let design = create_default();
        assert_eq!(design.version, 5);
        assert_eq!(design.name, "Untitled");
        assert_eq!(design.layers.len(), 8);
        assert!(design.measurement_guides.is_empty());
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
        assert_eq!(loaded.layers.len(), 8);

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
    fn legacy_object_group_migration_report_identifies_dropped_members_and_groups() {
        use serde_json::json;

        let value = json!({
            "plants": [
                { "id": "plant-1" },
                { "id": "shared-id" }
            ],
            "zones": [
                { "name": "zone-1" },
                { "name": "shared-id" }
            ],
            "annotations": [
                { "id": "annotation-1" }
            ],
            "groups": [
                {
                    "id": "group-1",
                    "member_ids": ["plant-1", "zone-1", "annotation-1", "shared-id", "missing-id"]
                },
                {
                    "id": "dropped-group",
                    "member_ids": ["shared-id", "missing-id"]
                }
            ]
        });

        let report = collect_legacy_object_group_migration_report(&value);

        assert_eq!(
            report,
            LegacyObjectGroupMigrationReport {
                ambiguous_members: vec![
                    "group-1:shared-id".to_owned(),
                    "dropped-group:shared-id".to_owned(),
                ],
                missing_members: vec![
                    "group-1:missing-id".to_owned(),
                    "dropped-group:missing-id".to_owned(),
                ],
                dropped_groups: vec!["dropped-group".to_owned()],
            },
        );
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

        assert_eq!(loaded.version, 5);
        assert_eq!(loaded.timeline[0].targets.len(), 3);
        assert!(matches!(
            loaded.timeline[0].targets[0],
            PanelTarget::PlacedPlant { .. }
        ));
        assert!(matches!(
            loaded.timeline[0].targets[1],
            PanelTarget::Species { .. }
        ));
        assert!(matches!(
            loaded.timeline[0].targets[2],
            PanelTarget::Zone { .. }
        ));
        assert!(matches!(
            loaded.budget[0].target,
            PanelTarget::Species { .. }
        ));

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

        std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap())
            .expect("write v2 file");
        let loaded = load_from_file(&path).expect("v2 file should load");
        save_to_file(&path, &loaded).expect("v2 file should save");
        let reloaded = load_from_file(&path).expect("saved v2 file should reload");

        assert_eq!(reloaded.version, 5);
        assert_eq!(reloaded.location.as_ref().map(|l| l.lat), Some(48.8566));
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
    fn test_v2_files_migrate_to_current_with_empty_plant_symbol_defaults() {
        use serde_json::json;

        let dir = std::env::temp_dir();
        let path: PathBuf = dir.join("canopi_test_v3_plant_symbols.canopi");

        let mut value = serde_json::to_value(create_default()).expect("default design serializes");
        value["version"] = json!(2);
        value
            .as_object_mut()
            .expect("default design serializes to object")
            .remove("plant_species_symbols");

        std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap())
            .expect("write v2 file");
        let loaded = load_from_file(&path).expect("v2 file should load");

        assert_eq!(loaded.version, 5);
        assert!(loaded.plant_species_symbols.is_empty());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_v3_files_migrate_to_v4_with_unpinned_plant_names() {
        use serde_json::json;

        let dir = std::env::temp_dir();
        let path: PathBuf = dir.join("canopi_test_v4_pinned_names.canopi");

        let mut value = serde_json::to_value(create_default()).expect("default design serializes");
        value["version"] = json!(3);
        value["plants"] = json!([
            {
                "id": "plant-1",
                "locked": false,
                "canonical_name": "Malus domestica",
                "common_name": "Apple",
                "position": { "x": 0.0, "y": 0.0 },
                "rotation": null,
                "scale": null,
                "notes": null,
                "planted_date": null,
                "quantity": 1
            },
            {
                "id": "plant-2",
                "locked": false,
                "canonical_name": "Pyrus communis",
                "common_name": "Pear",
                "pinned_name": true,
                "position": { "x": 1.0, "y": 0.0 },
                "rotation": null,
                "scale": null,
                "notes": null,
                "planted_date": null,
                "quantity": 1
            }
        ]);

        std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap())
            .expect("write v3 file");
        let loaded = load_from_file(&path).expect("v3 file should load");

        assert_eq!(loaded.version, 5);
        assert!(!loaded.plants[0].pinned_name);
        assert!(loaded.plants[1].pinned_name);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_v4_files_migrate_to_v5_with_measurement_guides_layer() {
        use serde_json::json;

        let dir = std::env::temp_dir();
        let path: PathBuf = dir.join("canopi_test_v5_measurement_guides.canopi");

        let mut value = serde_json::to_value(create_default()).expect("default design serializes");
        value["version"] = json!(4);
        value
            .as_object_mut()
            .expect("default design serializes to object")
            .remove("measurement_guides");
        value["layers"] = json!([
            { "name": "base", "visible": true, "locked": false, "opacity": 1.0 },
            { "name": "zones", "visible": true, "locked": false, "opacity": 1.0 },
            { "name": "plants", "visible": true, "locked": false, "opacity": 1.0 },
            { "name": "annotations", "visible": true, "locked": false, "opacity": 1.0 }
        ]);

        std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap())
            .expect("write v4 file");
        let loaded = load_from_file(&path).expect("v4 file should load");

        assert_eq!(loaded.version, 5);
        assert!(loaded.measurement_guides.is_empty());
        assert!(
            loaded.layers.iter().any(|layer| {
                layer.name == "measurement-guides"
                    && layer.visible
                    && !layer.locked
                    && (layer.opacity - 1.0).abs() < f32::EPSILON
            }),
            "migration should add a visible unlocked Measurement Guides layer",
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

        let mut legacy_value = serde_json::to_value(create_default()).expect("serialize");
        legacy_value
            .as_object_mut()
            .expect("default design serializes to object")
            .remove("budget_currency");

        let legacy: CanopiFile = serde_json::from_value(legacy_value).expect("deserialize legacy");
        assert_eq!(legacy.budget_currency, DEFAULT_BUDGET_CURRENCY);
    }

    #[test]
    fn test_migrate_stops_on_unknown_version() {
        let mut value = serde_json::json!({ "version": 0, "name": "test" });
        migrate_design_value(&mut value);
        assert_eq!(value["version"], 0, "version 0 has no migration path");
    }
}
