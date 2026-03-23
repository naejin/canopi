use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CanopiFile {
    pub version: u32,
    pub name: String,
    pub description: Option<String>,
    pub location: Option<Location>,
    pub north_bearing_deg: Option<f64>,
    pub layers: Vec<Layer>,
    pub plants: Vec<PlacedPlant>,
    pub zones: Vec<Zone>,
    pub consortiums: Vec<Consortium>,
    pub timeline: Vec<TimelineAction>,
    pub budget: Vec<BudgetItem>,
    pub created_at: String,
    pub updated_at: String,
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
    pub canonical_name: String,
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
pub struct Consortium {
    pub name: String,
    pub plants: Vec<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TimelineAction {
    pub id: String,
    pub action_type: String,
    pub description: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub recurrence: Option<String>,
    pub plants: Option<Vec<String>>,
    pub zone: Option<String>,
    pub depends_on: Option<Vec<String>>,
    pub completed: bool,
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BudgetItem {
    pub category: String,
    pub description: String,
    pub quantity: f64,
    pub unit_cost: f64,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DesignSummary {
    pub path: String,
    pub name: String,
    pub updated_at: String,
    pub plant_count: u32,
}
