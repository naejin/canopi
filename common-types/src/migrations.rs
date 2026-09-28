//! Forward migrations of `.canopi` Designs (ADR 0013).
//!
//! This module is the one place that knows what older formats looked like.
//! Callers hand it the parsed JSON of a file at a supported older version and
//! receive the same Design in the current format. Each step is pure and
//! idempotent on its input version:
//!
//! - v7 (first Canopi 2 preview, geolocated) → v8: `views` and `stories`
//!   appear, empty.
//! - v8 → v9: a zone's name becomes its `id` and, when the user typed it, its
//!   display `name`; `zone_name` targets become `zone_id`; LiDAR entries of
//!   kind `Analysis` become `Derived`.
//!
//! Formats before v7 held local metres and are refused as `unsupported_version`
//! (user decision of 2026-09-28: support back to v7, refuse older with a
//! message). Nothing here validates the current format: admission runs after
//! the ladder.

use serde_json::{Map, Value, json};

use crate::design::CURRENT_CANOPI_FILE_VERSION;

/// Oldest `.canopi` format the ladder starts from: the first geolocated
/// format, written by the Canopi 2.0 previews.
pub const MINIMUM_SUPPORTED_CANOPI_FILE_VERSION: u32 = 7;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MigrationError {
    /// Older than the minimum or newer than the current format.
    UnsupportedVersion(u32),
    /// The document does not have the shape its version promises; the message
    /// names a JSON path and never a file.
    InvalidDocument(String),
}

impl std::fmt::Display for MigrationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedVersion(version) => write!(
                formatter,
                "$.version: unsupported Canopi Design version {version}; this build opens versions {MINIMUM_SUPPORTED_CANOPI_FILE_VERSION} to {CURRENT_CANOPI_FILE_VERSION}",
            ),
            Self::InvalidDocument(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for MigrationError {}

/// A current-format document. `migrated_from` is `None` when the input
/// already was current.
#[derive(Debug, Clone, PartialEq)]
pub struct Migrated {
    pub value: Value,
    pub migrated_from: Option<u32>,
}

/// Upgrade `value`, a document at format `from`, to the current format.
pub fn migrate_to_current(value: Value, from: u32) -> Result<Migrated, MigrationError> {
    if !(MINIMUM_SUPPORTED_CANOPI_FILE_VERSION..=CURRENT_CANOPI_FILE_VERSION).contains(&from) {
        return Err(MigrationError::UnsupportedVersion(from));
    }
    let Value::Object(mut object) = value else {
        return Err(MigrationError::InvalidDocument(
            "$: expected a Canopi Design object".to_owned(),
        ));
    };
    if from == CURRENT_CANOPI_FILE_VERSION {
        return Ok(Migrated {
            value: Value::Object(object),
            migrated_from: None,
        });
    }
    let mut version = from;
    while version < CURRENT_CANOPI_FILE_VERSION {
        match version {
            7 => step_v7_to_v8(&mut object),
            8 => step_v8_to_v9(&mut object),
            _ => return Err(MigrationError::UnsupportedVersion(version)),
        }
        version += 1;
    }
    Ok(Migrated {
        value: Value::Object(object),
        migrated_from: Some(from),
    })
}

fn for_each_object(
    object: &mut Map<String, Value>,
    key: &str,
    mut visit: impl FnMut(&mut Map<String, Value>),
) {
    if let Some(items) = object.get_mut(key).and_then(Value::as_array_mut) {
        for item in items.iter_mut().filter_map(Value::as_object_mut) {
            visit(item);
        }
    }
}

// ---------------------------------------------------------------------------
// v7 → v8
// ---------------------------------------------------------------------------

fn step_v7_to_v8(object: &mut Map<String, Value>) {
    for key in ["views", "stories"] {
        object.entry(key).or_insert_with(|| json!([]));
    }
    object.insert("version".to_owned(), json!(8));
}

// ---------------------------------------------------------------------------
// v8 → v9
// ---------------------------------------------------------------------------

fn step_v8_to_v9(object: &mut Map<String, Value>) {
    let mut taken = std::collections::HashSet::new();
    for_each_object(object, "zones", |zone| {
        let Some(name) = zone.get("name").and_then(Value::as_str).map(str::to_owned) else {
            return;
        };
        // The old name stays the identity so targets, groups and saved views
        // still resolve; a second zone with the same name gets a numbered id.
        let mut id = name.clone();
        let mut n = 2;
        while !taken.insert(id.clone()) {
            id = format!("{name} ({n})");
            n += 1;
        }
        let display = if is_generated_zone_name(&name) {
            Value::Null
        } else {
            json!(name)
        };
        zone.insert("id".to_owned(), json!(id));
        zone.insert("name".to_owned(), display);
    });
    for_each_object(object, "timeline", |action| {
        if let Some(targets) = action.get_mut("targets").and_then(Value::as_array_mut) {
            targets.iter_mut().for_each(convert_zone_target);
        }
    });
    for_each_object(object, "budget", |item| {
        if let Some(target) = item.get_mut("target") {
            convert_zone_target(target);
        }
    });
    if let Some(lidar) = object.get_mut("lidar").and_then(Value::as_object_mut) {
        for_each_object(lidar, "entries", |entry| {
            if entry.get("kind").and_then(Value::as_str) == Some("Analysis") {
                entry.insert("kind".to_owned(), json!("Derived"));
            }
        });
    }
    object.insert("version".to_owned(), json!(9));
}

fn convert_zone_target(target: &mut Value) {
    let Some(object) = target.as_object_mut() else {
        return;
    };
    if object.get("kind").and_then(Value::as_str) != Some("zone") {
        return;
    }
    if let Some(name) = object.remove("zone_name") {
        object.entry("zone_id").or_insert(name);
    }
}

/// A zone name Canopi generated (`zone-<uuid>`, a bare UUID, or a pasted
/// " copy" / " copy 2" of one) rather than one the user typed.
fn is_generated_zone_name(name: &str) -> bool {
    let mut rest = name.strip_prefix("zone-").unwrap_or(name);
    let Some(after_uuid) = strip_uuid(rest) else {
        return false;
    };
    rest = after_uuid;
    while let Some(after_copy) = rest.strip_prefix(" copy") {
        rest = after_copy;
        if let Some(after_space) = rest.strip_prefix(' ') {
            let digits = after_space.bytes().take_while(u8::is_ascii_digit).count();
            if digits > 0 {
                rest = &after_space[digits..];
            }
        }
    }
    rest.is_empty()
}

fn strip_uuid(text: &str) -> Option<&str> {
    const GROUPS: [usize; 5] = [8, 4, 4, 4, 12];
    let mut rest = text;
    for (index, length) in GROUPS.iter().enumerate() {
        if index > 0 {
            rest = rest.strip_prefix('-')?;
        }
        let group = rest.get(..*length)?;
        if !group.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        rest = &rest[*length..];
    }
    Some(rest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v7() -> Value {
        json!({
            "version": 7,
            "name": "Canopi 2 preview garden",
            "plant_species_colors": {},
            "layers": [
                { "name": "plants", "visible": true, "locked": false, "opacity": 1.0 }
            ],
            "plants": [{
                "id": "plant-1",
                "canonical_name": "Malus domestica",
                "position": { "lon": 2.3522, "lat": 48.8566 },
                "rotation": 45.0
            }],
            "zones": [{
                "name": "Orchard",
                "zone_type": "rect",
                "points": [
                    { "lon": 2.3522, "lat": 48.8566 },
                    { "lon": 2.3525, "lat": 48.8565 }
                ],
                "rotation": 30.0
            }],
            "timeline": [{
                "id": "action-1",
                "action_type": "plant",
                "description": "Plant",
                "targets": [{ "kind": "zone", "zone_name": "Orchard" }],
                "completed": false,
                "order": 0
            }],
            "created_at": "2026-07-15T00:00:00.000Z",
            "updated_at": "2026-07-15T00:00:00.000Z"
        })
    }

    #[test]
    fn versions_outside_the_ladder_are_refused() {
        // v6 (Canopi 1.2 with a spatial frame) is below the floor, whatever its shape.
        assert_eq!(
            migrate_to_current(
                json!({ "version": 6, "spatial_frame": { "placement_status": "confirmed" } }),
                6
            ),
            Err(MigrationError::UnsupportedVersion(6))
        );
        assert_eq!(
            migrate_to_current(json!({ "version": 5 }), 5),
            Err(MigrationError::UnsupportedVersion(5))
        );
        assert_eq!(
            migrate_to_current(json!({ "version": 10 }), 10),
            Err(MigrationError::UnsupportedVersion(10))
        );
        assert!(matches!(
            migrate_to_current(json!([]), 9),
            Err(MigrationError::InvalidDocument(_))
        ));
        let migrated = migrate_to_current(json!({ "version": 9 }), 9).unwrap();
        assert_eq!(migrated.value, json!({ "version": 9 }));
        assert_eq!(migrated.migrated_from, None);
        let message = MigrationError::UnsupportedVersion(6).to_string();
        assert!(
            message.contains("this build opens versions 7 to 9"),
            "{message}"
        );
    }

    #[test]
    fn v7_gains_empty_views_and_stories() {
        let mut object = json!({ "version": 7, "views": [{ "id": "kept" }] })
            .as_object()
            .cloned()
            .unwrap();
        step_v7_to_v8(&mut object);
        assert_eq!(object["version"], json!(8));
        assert_eq!(object["views"], json!([{ "id": "kept" }]));
        assert_eq!(object["stories"], json!([]));
    }

    #[test]
    fn v8_zone_names_become_ids_and_typed_names_stay_visible() {
        let mut object = json!({
            "version": 8,
            "zones": [
                { "name": "North bed", "zone_type": "rect", "points": [] },
                { "name": "zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copy copy 2", "zone_type": "rect", "points": [] },
                { "name": "12df7cef-c856-47a2-a4d0-63a5bfcff9d4", "zone_type": "rect", "points": [] },
                { "name": "North bed", "zone_type": "line", "points": [] }
            ],
            "timeline": [{ "targets": [
                { "kind": "zone", "zone_name": "North bed" },
                { "kind": "species", "canonical_name": "Malus domestica" }
            ] }],
            "budget": [{ "target": { "kind": "zone", "zone_name": "North bed" } }, {}],
            "lidar": { "schema_version": 1, "entries": [
                { "kind": "Analysis", "id": "slope-1" },
                { "kind": "Source", "id": "dem-1" }
            ] }
        })
        .as_object()
        .cloned()
        .unwrap();
        step_v8_to_v9(&mut object);
        assert_eq!(object["version"], json!(9));
        let zones = object["zones"].as_array().unwrap();
        assert_eq!(zones[0]["id"], json!("North bed"));
        assert_eq!(zones[0]["name"], json!("North bed"));
        assert_eq!(
            zones[1]["id"],
            json!("zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copy copy 2")
        );
        assert_eq!(zones[1]["name"], Value::Null);
        assert_eq!(zones[2]["name"], Value::Null);
        assert_eq!(zones[3]["id"], json!("North bed (2)"));
        assert_eq!(zones[3]["name"], json!("North bed"));
        assert_eq!(
            object["timeline"][0]["targets"][0],
            json!({ "kind": "zone", "zone_id": "North bed" })
        );
        assert_eq!(
            object["timeline"][0]["targets"][1],
            json!({ "kind": "species", "canonical_name": "Malus domestica" })
        );
        assert_eq!(
            object["budget"][0]["target"],
            json!({ "kind": "zone", "zone_id": "North bed" })
        );
        assert_eq!(object["lidar"]["entries"][0]["kind"], json!("Derived"));
        assert_eq!(object["lidar"]["entries"][1]["kind"], json!("Source"));
    }

    #[test]
    fn generated_zone_names_are_recognised() {
        for name in [
            "zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4",
            "12df7cef-c856-47a2-a4d0-63a5bfcff9d4",
            "zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copy",
            "zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copy copy copy 4 copy 3 copy",
            "ZONE-12DF7CEF-C856-47A2-A4D0-63A5BFCFF9D4"
                .to_lowercase()
                .as_str(),
        ] {
            assert!(is_generated_zone_name(name), "{name}");
        }
        for name in [
            "Z01",
            "North bed",
            "zone-12df7cef",
            "zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copyx",
            "zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 (2)",
            "",
        ] {
            assert!(!is_generated_zone_name(name), "{name}");
        }
    }

    #[test]
    fn the_whole_ladder_runs_from_v7_to_current() {
        let Migrated {
            value,
            migrated_from,
        } = migrate_to_current(v7(), 7).unwrap();
        assert_eq!(migrated_from, Some(7));
        assert_eq!(value["version"], json!(CURRENT_CANOPI_FILE_VERSION));
        assert_eq!(value["views"], json!([]));
        assert_eq!(value["stories"], json!([]));
        assert_eq!(value["zones"][0]["id"], json!("Orchard"));
        assert_eq!(value["zones"][0]["name"], json!("Orchard"));
        assert_eq!(
            value["timeline"][0]["targets"][0],
            json!({ "kind": "zone", "zone_id": "Orchard" })
        );
        assert_eq!(
            value["plants"][0]["position"],
            json!({ "lon": 2.3522, "lat": 48.8566 })
        );
    }
}
