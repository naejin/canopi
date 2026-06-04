use serde::{Deserialize, Serialize};
use specta::Type;

pub const DEFAULT_BUDGET_CURRENCY: &str = "EUR";

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

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CanopiFile {
    pub version: u32,
    pub name: String,
    pub description: Option<String>,
    pub location: Option<Location>,
    pub north_bearing_deg: Option<f64>,
    pub plant_species_colors: std::collections::HashMap<String, String>,
    pub layers: Vec<Layer>,
    pub plants: Vec<PlacedPlant>,
    pub zones: Vec<Zone>,
    #[serde(default)]
    pub annotations: Vec<Annotation>,
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

#[derive(Debug, Clone, Serialize, Type)]
pub struct ObjectGroup {
    pub id: String,
    pub locked: bool,
    pub name: Option<String>,
    pub layer: String,
    pub position: Position,
    pub rotation: Option<f64>,
    pub member_ids: Vec<String>,
}

#[derive(Deserialize)]
struct ObjectGroupInput {
    id: String,
    #[serde(default)]
    locked: bool,
    name: Option<String>,
    layer: String,
    position: Position,
    rotation: Option<f64>,
    member_ids: Vec<String>,
}

impl<'de> Deserialize<'de> for ObjectGroup {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let input = ObjectGroupInput::deserialize(deserializer)?;
        Ok(Self {
            id: input.id,
            locked: input.locked,
            name: input.name,
            layer: input.layer,
            position: input.position,
            rotation: input.rotation,
            member_ids: input.member_ids,
        })
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

        let value = serde_json::to_value(&file).expect("canopi file should serialize");
        assert_eq!(value["plants"][0]["locked"], json!(false));
        assert_eq!(value["zones"][0]["locked"], json!(false));
        assert_eq!(value["annotations"][0]["locked"], json!(false));
        assert_eq!(value["groups"][0]["locked"], json!(false));
    }
}
