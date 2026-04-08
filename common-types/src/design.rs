use serde::{Deserialize, Serialize};
use specta::Type;

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

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PlacedPlant {
    #[serde(default)]
    pub id: String,
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

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Zone {
    pub name: String,
    pub zone_type: String,
    pub points: Vec<Position>,
    pub fill_color: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Annotation {
    pub id: String,
    pub annotation_type: String,
    pub position: Position,
    pub text: String,
    pub font_size: f64,
    pub rotation: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Consortium {
    pub target: SpeciesPanelTarget,
    pub stratum: String,
    pub start_phase: u32,
    pub end_phase: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind")]
pub enum PanelTarget {
    #[serde(rename = "placed_plant")]
    PlacedPlant { plant_id: String },
    #[serde(rename = "species")]
    Species { canonical_name: String },
    #[serde(rename = "zone")]
    Zone { zone_name: String },
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

impl Default for PanelTarget {
    fn default() -> Self {
        Self::Manual
    }
}

fn default_manual_target() -> PanelTarget {
    PanelTarget::Manual
}

fn default_manual_targets() -> Vec<PanelTarget> {
    vec![PanelTarget::Manual]
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ObjectGroup {
    pub id: String,
    pub name: Option<String>,
    pub layer: String,
    pub position: Position,
    pub rotation: Option<f64>,
    pub member_ids: Vec<String>,
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
