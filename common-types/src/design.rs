use serde::{Deserialize, Serialize};
use specta::Type;

pub const DEFAULT_BUDGET_CURRENCY: &str = "EUR";
pub const DEFAULT_PLANT_SYMBOL_ID: &str = "round";
pub const PLANT_SYMBOL_IDS: &[&str] = &[
    "round",
    "square",
    "triangle",
    "cross",
    "tree",
    "shrub",
    "herbaceous",
    "climber",
    "groundcover",
    "wave",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesignFileFieldOwner {
    Document,
    Scene,
    Shared,
}

impl DesignFileFieldOwner {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Scene => "scene",
            Self::Shared => "shared",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesignFileField {
    pub key: &'static str,
    pub owner: DesignFileFieldOwner,
}

pub const DESIGN_FILE_FIELDS: &[DesignFileField] = &[
    DesignFileField {
        key: "version",
        owner: DesignFileFieldOwner::Scene,
    },
    DesignFileField {
        key: "name",
        owner: DesignFileFieldOwner::Document,
    },
    DesignFileField {
        key: "description",
        owner: DesignFileFieldOwner::Document,
    },
    DesignFileField {
        key: "location",
        owner: DesignFileFieldOwner::Document,
    },
    DesignFileField {
        key: "north_bearing_deg",
        owner: DesignFileFieldOwner::Document,
    },
    DesignFileField {
        key: "plant_species_colors",
        owner: DesignFileFieldOwner::Scene,
    },
    DesignFileField {
        key: "plant_species_symbols",
        owner: DesignFileFieldOwner::Scene,
    },
    DesignFileField {
        key: "layers",
        owner: DesignFileFieldOwner::Scene,
    },
    DesignFileField {
        key: "plants",
        owner: DesignFileFieldOwner::Scene,
    },
    DesignFileField {
        key: "zones",
        owner: DesignFileFieldOwner::Scene,
    },
    DesignFileField {
        key: "annotations",
        owner: DesignFileFieldOwner::Scene,
    },
    DesignFileField {
        key: "measurement_guides",
        owner: DesignFileFieldOwner::Scene,
    },
    DesignFileField {
        key: "consortiums",
        owner: DesignFileFieldOwner::Document,
    },
    DesignFileField {
        key: "groups",
        owner: DesignFileFieldOwner::Scene,
    },
    DesignFileField {
        key: "timeline",
        owner: DesignFileFieldOwner::Document,
    },
    DesignFileField {
        key: "budget",
        owner: DesignFileFieldOwner::Document,
    },
    DesignFileField {
        key: "budget_currency",
        owner: DesignFileFieldOwner::Document,
    },
    DesignFileField {
        key: "created_at",
        owner: DesignFileFieldOwner::Document,
    },
    DesignFileField {
        key: "updated_at",
        owner: DesignFileFieldOwner::Scene,
    },
    DesignFileField {
        key: "extra",
        owner: DesignFileFieldOwner::Shared,
    },
];

#[derive(Debug, Clone, Serialize, Type)]
pub struct CanopiFile {
    pub version: u32,
    pub name: String,
    pub description: Option<String>,
    pub location: Option<Location>,
    pub north_bearing_deg: Option<f64>,
    pub plant_species_colors: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub plant_species_symbols: std::collections::HashMap<String, String>,
    pub layers: Vec<Layer>,
    pub plants: Vec<PlacedPlant>,
    pub zones: Vec<Zone>,
    #[serde(default)]
    pub annotations: Vec<Annotation>,
    #[serde(default)]
    pub measurement_guides: Vec<MeasurementGuide>,
    #[serde(default)]
    pub consortiums: Vec<Consortium>,
    #[serde(default)]
    pub groups: Vec<ObjectGroup>,
    #[serde(default)]
    pub timeline: Vec<TimelineAction>,
    #[serde(default)]
    pub budget: Vec<BudgetItem>,
    #[serde(default = "default_budget_currency")]
    pub budget_currency: String,
    pub created_at: String,
    pub updated_at: String,
    /// Preserves unknown fields for forward compatibility — round-trips fields
    /// from newer file versions that this build doesn't know about yet.
    #[serde(flatten)]
    #[specta(skip)]
    pub extra: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
struct CanopiFileInput {
    version: u32,
    name: String,
    description: Option<String>,
    location: Option<Location>,
    north_bearing_deg: Option<f64>,
    plant_species_colors: std::collections::HashMap<String, String>,
    #[serde(default)]
    plant_species_symbols: std::collections::HashMap<String, String>,
    layers: Vec<Layer>,
    plants: Vec<PlacedPlant>,
    zones: Vec<Zone>,
    #[serde(default)]
    annotations: Vec<Annotation>,
    #[serde(default)]
    measurement_guides: Vec<MeasurementGuideInput>,
    #[serde(default)]
    consortiums: Vec<Consortium>,
    #[serde(default)]
    groups: Vec<ObjectGroupInput>,
    #[serde(default)]
    timeline: Vec<TimelineAction>,
    #[serde(default)]
    budget: Vec<BudgetItem>,
    #[serde(default = "default_budget_currency")]
    budget_currency: String,
    created_at: String,
    updated_at: String,
    #[serde(flatten)]
    extra: std::collections::HashMap<String, serde_json::Value>,
}

impl<'de> Deserialize<'de> for CanopiFile {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let input = CanopiFileInput::deserialize(deserializer)?;
        let groups = migrate_object_groups(
            input.groups,
            &input.plants,
            &input.zones,
            &input.annotations,
        );
        Ok(Self {
            version: input.version,
            name: input.name,
            description: input.description,
            location: input.location,
            north_bearing_deg: input.north_bearing_deg,
            plant_species_colors: input.plant_species_colors,
            plant_species_symbols: input.plant_species_symbols,
            layers: input.layers,
            plants: input.plants,
            zones: input.zones,
            annotations: input.annotations,
            measurement_guides: input
                .measurement_guides
                .into_iter()
                .map(MeasurementGuide::from)
                .collect(),
            consortiums: input.consortiums,
            groups,
            timeline: input.timeline,
            budget: input.budget,
            budget_currency: input.budget_currency,
            created_at: input.created_at,
            updated_at: input.updated_at,
            extra: input.extra,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Location {
    pub lat: f64,
    pub lon: f64,
    pub altitude_m: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Layer {
    pub name: String,
    pub visible: bool,
    pub locked: bool,
    pub opacity: f32,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct PlacedPlant {
    #[serde(default)]
    pub id: String,
    pub locked: bool,
    pub canonical_name: String,
    pub common_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    #[serde(default)]
    pub pinned_name: bool,
    pub position: Position,
    pub rotation: Option<f64>,
    pub scale: Option<f64>,
    pub notes: Option<String>,
    pub planted_date: Option<String>,
    pub quantity: Option<u32>,
}

#[derive(Deserialize)]
struct PlacedPlantInput {
    #[serde(default)]
    id: String,
    #[serde(default)]
    locked: bool,
    canonical_name: String,
    common_name: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    symbol: Option<String>,
    #[serde(default)]
    pinned_name: bool,
    position: Position,
    rotation: Option<f64>,
    scale: Option<f64>,
    notes: Option<String>,
    planted_date: Option<String>,
    quantity: Option<u32>,
}

impl<'de> Deserialize<'de> for PlacedPlant {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let input = PlacedPlantInput::deserialize(deserializer)?;
        Ok(Self {
            id: input.id,
            locked: input.locked,
            canonical_name: input.canonical_name,
            common_name: input.common_name,
            color: input.color,
            symbol: input.symbol,
            pinned_name: input.pinned_name,
            position: input.position,
            rotation: input.rotation,
            scale: input.scale,
            notes: input.notes,
            planted_date: input.planted_date,
            quantity: input.quantity,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct Zone {
    pub name: String,
    pub locked: bool,
    pub zone_type: String,
    pub points: Vec<Position>,
    pub rotation: f64,
    pub fill_color: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
struct ZoneInput {
    name: String,
    #[serde(default)]
    locked: bool,
    zone_type: String,
    points: Vec<Position>,
    #[serde(default)]
    rotation: f64,
    fill_color: Option<String>,
    notes: Option<String>,
}

impl<'de> Deserialize<'de> for Zone {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let input = ZoneInput::deserialize(deserializer)?;
        Ok(Self {
            name: input.name,
            locked: input.locked,
            zone_type: input.zone_type,
            points: input.points,
            rotation: input.rotation,
            fill_color: input.fill_color,
            notes: input.notes,
        })
    }
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct Annotation {
    pub id: String,
    pub locked: bool,
    pub annotation_type: String,
    pub position: Position,
    pub text: String,
    pub font_size: f64,
    pub rotation: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct MeasurementGuide {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub locked: bool,
    pub start: Position,
    pub end: Position,
}

#[derive(Deserialize)]
struct MeasurementGuideInput {
    #[serde(default)]
    id: String,
    #[serde(default)]
    locked: bool,
    start: Position,
    end: Position,
}

impl From<MeasurementGuideInput> for MeasurementGuide {
    fn from(input: MeasurementGuideInput) -> Self {
        Self {
            id: input.id,
            locked: input.locked,
            start: input.start,
            end: input.end,
        }
    }
}

#[derive(Deserialize)]
struct AnnotationInput {
    id: String,
    #[serde(default)]
    locked: bool,
    annotation_type: String,
    position: Position,
    text: String,
    font_size: f64,
    rotation: Option<f64>,
}

impl<'de> Deserialize<'de> for Annotation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let input = AnnotationInput::deserialize(deserializer)?;
        Ok(Self {
            id: input.id,
            locked: input.locked,
            annotation_type: input.annotation_type,
            position: input.position,
            text: input.text,
            font_size: input.font_size,
            rotation: input.rotation,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Consortium {
    pub target: SpeciesPanelTarget,
    pub stratum: String,
    pub start_phase: u32,
    pub end_phase: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(tag = "kind")]
pub enum PanelTarget {
    #[serde(rename = "placed_plant")]
    PlacedPlant { plant_id: String },
    #[serde(rename = "species")]
    Species { canonical_name: String },
    #[serde(rename = "zone")]
    Zone { zone_name: String },
    #[default]
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeciesPanelTarget {
    pub kind: SpeciesPanelTargetKind,
    pub canonical_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum SpeciesPanelTargetKind {
    #[serde(rename = "species")]
    Species,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TimelineAction {
    pub id: String,
    pub action_type: String,
    pub description: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub recurrence: Option<String>,
    #[serde(default = "default_manual_targets")]
    pub targets: Vec<PanelTarget>,
    pub depends_on: Option<Vec<String>>,
    pub completed: bool,
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BudgetItem {
    #[serde(default = "default_manual_target")]
    pub target: PanelTarget,
    pub category: String,
    pub description: String,
    pub quantity: f64,
    pub unit_cost: f64,
    pub currency: String,
}

fn default_manual_target() -> PanelTarget {
    PanelTarget::Manual
}

fn default_manual_targets() -> Vec<PanelTarget> {
    vec![PanelTarget::Manual]
}

pub fn default_budget_currency() -> String {
    DEFAULT_BUDGET_CURRENCY.to_owned()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind")]
pub enum ObjectGroupMember {
    #[serde(rename = "plant")]
    Plant { id: String },
    #[serde(rename = "zone")]
    Zone { id: String },
    #[serde(rename = "annotation")]
    Annotation { id: String },
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct ObjectGroup {
    pub id: String,
    pub locked: bool,
    pub name: Option<String>,
    pub members: Vec<ObjectGroupMember>,
}

#[derive(Deserialize)]
struct ObjectGroupInput {
    id: String,
    #[serde(default)]
    locked: bool,
    name: Option<String>,
    #[serde(default)]
    members: Option<Vec<ObjectGroupMember>>,
    #[serde(default)]
    member_ids: Option<Vec<String>>,
}

fn migrate_object_groups(
    groups: Vec<ObjectGroupInput>,
    plants: &[PlacedPlant],
    zones: &[Zone],
    annotations: &[Annotation],
) -> Vec<ObjectGroup> {
    groups
        .into_iter()
        .filter_map(|group| {
            if let Some(members) = group.members {
                return Some(ObjectGroup {
                    id: group.id,
                    locked: group.locked,
                    name: group.name,
                    members: dedupe_object_group_members(members),
                });
            }

            let members = group
                .member_ids
                .unwrap_or_default()
                .into_iter()
                .filter_map(|id| resolve_legacy_group_member(&id, plants, zones, annotations))
                .fold(Vec::new(), |mut resolved, member| {
                    push_unique_object_group_member(&mut resolved, member);
                    resolved
                });
            if members.len() < 2 {
                return None;
            }
            Some(ObjectGroup {
                id: group.id,
                locked: group.locked,
                name: group.name,
                members,
            })
        })
        .collect()
}

fn resolve_legacy_group_member(
    id: &str,
    plants: &[PlacedPlant],
    zones: &[Zone],
    annotations: &[Annotation],
) -> Option<ObjectGroupMember> {
    let mut resolved = Vec::new();
    if plants.iter().any(|plant| plant.id == id) {
        resolved.push(ObjectGroupMember::Plant { id: id.to_owned() });
    }
    if zones.iter().any(|zone| zone.name == id) {
        resolved.push(ObjectGroupMember::Zone { id: id.to_owned() });
    }
    if annotations.iter().any(|annotation| annotation.id == id) {
        resolved.push(ObjectGroupMember::Annotation { id: id.to_owned() });
    }
    if resolved.len() == 1 {
        resolved.pop()
    } else {
        None
    }
}

fn dedupe_object_group_members(members: Vec<ObjectGroupMember>) -> Vec<ObjectGroupMember> {
    members.into_iter().fold(Vec::new(), |mut deduped, member| {
        push_unique_object_group_member(&mut deduped, member);
        deduped
    })
}

fn push_unique_object_group_member(
    members: &mut Vec<ObjectGroupMember>,
    member: ObjectGroupMember,
) {
    if !members.contains(&member) {
        members.push(member);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DesignSummary {
    pub path: String,
    pub name: String,
    pub updated_at: String,
    pub plant_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AutosaveEntry {
    pub path: String,
    pub name: String,
    pub saved_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn design_objects_missing_lock_state_load_unlocked_and_serialize_explicitly() {
        let file: CanopiFile = serde_json::from_value(json!({
            "version": 1,
            "name": "Legacy locks",
            "description": null,
            "location": null,
            "north_bearing_deg": 0.0,
            "plant_species_colors": {},
            "layers": [
                { "name": "plants", "visible": true, "locked": false, "opacity": 1.0 }
            ],
            "plants": [
                {
                    "id": "plant-1",
                    "canonical_name": "Malus domestica",
                    "common_name": "Apple",
                    "position": { "x": 1.0, "y": 2.0 },
                    "rotation": null,
                    "scale": null,
                    "notes": null,
                    "planted_date": null,
                    "quantity": 1
                }
            ],
            "zones": [
                {
                    "name": "zone-1",
                    "zone_type": "rect",
                    "points": [
                        { "x": 0.0, "y": 0.0 },
                        { "x": 1.0, "y": 0.0 },
                        { "x": 1.0, "y": 1.0 }
                    ],
                    "fill_color": null,
                    "notes": null
                }
            ],
            "annotations": [
                {
                    "id": "annotation-1",
                    "annotation_type": "text",
                    "position": { "x": 2.0, "y": 3.0 },
                    "text": "Note",
                    "font_size": 16.0,
                    "rotation": null
                }
            ],
            "consortiums": [],
            "groups": [
                {
                    "id": "group-1",
                    "name": null,
                    "layer": "plants",
                    "position": { "x": 0.0, "y": 0.0 },
                    "rotation": null,
                    "member_ids": ["plant-1", "zone-1"]
                }
            ],
            "timeline": [],
            "budget": [],
            "budget_currency": "EUR",
            "created_at": "2026-04-02T00:00:00.000Z",
            "updated_at": "2026-04-02T00:00:00.000Z"
        }))
        .expect("legacy design objects without locked fields should load");

        assert!(!file.plants[0].locked);
        assert!(!file.zones[0].locked);
        assert!(!file.annotations[0].locked);
        assert!(!file.groups[0].locked);
        assert_eq!(file.zones[0].rotation, 0.0);

        let value = serde_json::to_value(&file).expect("canopi file should serialize");
        assert_eq!(value["plants"][0]["locked"], json!(false));
        assert_eq!(value["zones"][0]["locked"], json!(false));
        assert_eq!(value["zones"][0]["rotation"], json!(0.0));
        assert_eq!(value["annotations"][0]["locked"], json!(false));
        assert_eq!(value["groups"][0]["locked"], json!(false));
    }

    #[test]
    fn legacy_object_groups_migrate_to_typed_concrete_members() {
        let file: CanopiFile = serde_json::from_value(json!({
            "version": 3,
            "name": "Legacy groups",
            "description": null,
            "location": null,
            "north_bearing_deg": 0.0,
            "plant_species_colors": {},
            "layers": [
                { "name": "plants", "visible": true, "locked": false, "opacity": 1.0 },
                { "name": "zones", "visible": true, "locked": false, "opacity": 1.0 },
                { "name": "annotations", "visible": true, "locked": false, "opacity": 1.0 }
            ],
            "plants": [
                {
                    "id": "plant-1",
                    "canonical_name": "Malus domestica",
                    "common_name": "Apple",
                    "position": { "x": 1.0, "y": 2.0 },
                    "rotation": null,
                    "scale": null,
                    "notes": null,
                    "planted_date": null,
                    "quantity": 1
                },
                {
                    "id": "shared-id",
                    "canonical_name": "Pyrus communis",
                    "common_name": "Pear",
                    "position": { "x": 3.0, "y": 4.0 },
                    "rotation": null,
                    "scale": null,
                    "notes": null,
                    "planted_date": null,
                    "quantity": 1
                }
            ],
            "zones": [
                {
                    "name": "zone-1",
                    "zone_type": "rect",
                    "points": [
                        { "x": 0.0, "y": 0.0 },
                        { "x": 1.0, "y": 0.0 },
                        { "x": 1.0, "y": 1.0 }
                    ],
                    "fill_color": null,
                    "notes": null
                },
                {
                    "name": "shared-id",
                    "zone_type": "line",
                    "points": [
                        { "x": 0.0, "y": 0.0 },
                        { "x": 2.0, "y": 0.0 }
                    ],
                    "fill_color": null,
                    "notes": null
                }
            ],
            "annotations": [
                {
                    "id": "annotation-1",
                    "annotation_type": "text",
                    "position": { "x": 2.0, "y": 3.0 },
                    "text": "Note",
                    "font_size": 16.0,
                    "rotation": null
                }
            ],
            "consortiums": [],
            "groups": [
                {
                    "id": "group-1",
                    "name": "Guild",
                    "layer": "plants",
                    "position": { "x": 0.0, "y": 0.0 },
                    "rotation": null,
                    "member_ids": ["plant-1", "zone-1", "annotation-1", "shared-id", "missing-id"]
                },
                {
                    "id": "dropped-group",
                    "name": null,
                    "layer": "plants",
                    "position": { "x": 0.0, "y": 0.0 },
                    "rotation": null,
                    "member_ids": ["shared-id", "missing-id"]
                }
            ],
            "timeline": [],
            "budget": [],
            "budget_currency": "EUR",
            "created_at": "2026-04-02T00:00:00.000Z",
            "updated_at": "2026-04-02T00:00:00.000Z"
        }))
        .expect("legacy object groups should migrate");

        assert_eq!(file.groups.len(), 1);
        assert_eq!(file.groups[0].id, "group-1");
        assert_eq!(
            file.groups[0].members,
            vec![
                ObjectGroupMember::Plant {
                    id: "plant-1".to_string()
                },
                ObjectGroupMember::Zone {
                    id: "zone-1".to_string()
                },
                ObjectGroupMember::Annotation {
                    id: "annotation-1".to_string()
                },
            ],
        );

        let value = serde_json::to_value(&file).expect("canopi file should serialize");
        assert!(value["groups"][0].get("members").is_some());
        assert!(value["groups"][0].get("member_ids").is_none());
        assert!(value["groups"][0].get("layer").is_none());
        assert!(value["groups"][0].get("position").is_none());
        assert!(value["groups"][0].get("rotation").is_none());
    }
}
