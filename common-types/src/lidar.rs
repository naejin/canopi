//! Cross-language contracts for the local LiDAR raster library.
//!
//! These types cross the Tauri IPC boundary and the `.canopi` document
//! presentation section. Library contents live in `lidar-library.sqlite` and
//! managed app data; documents only ever hold ordered presentation entries
//! that reference library identities.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;

/// Immutable measurement definition of a source layer.
///
/// Measurement kind, units and reference establish capability; layer names,
/// filenames and providers do not.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarMeasurementKind {
    /// Bare-earth elevation (MNT/DTM).
    GroundElevation,
    /// Top surface including vegetation and buildings (MNS/DSM).
    SurfaceElevation,
    /// Height relative to compatible terrain (MNH).
    AboveGroundHeight,
    /// User-described continuous numeric value; numeric display only.
    OtherContinuous,
}

impl LidarMeasurementKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::GroundElevation => "ground-elevation",
            Self::SurfaceElevation => "surface-elevation",
            Self::AboveGroundHeight => "above-ground-height",
            Self::OtherContinuous => "other-continuous",
        }
    }
}

/// Registered analysis capability. Slice 1 ships slope only; later slices add
/// the remaining ground-elevation and height analyses.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarAnalysisKind {
    /// Terrain slope from a ground-elevation layer.
    Slope,
}

impl LidarAnalysisKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Slope => "slope",
        }
    }
}

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarSlopeUnit {
    Degrees,
    Percent,
}

/// Result states defined by the product plan (§4). `refreshing` keeps the last
/// complete result visible; `incomplete` distinguishes unknown areas from
/// low/zero measured values.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarResultState {
    Preparing,
    Ready,
    Refreshing,
    Incomplete,
    Failed,
}

/// Import job states. `awaiting_review` carries the Before/After plan; only
/// an explicit apply publishes a generation.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarImportJobState {
    Staging,
    AwaitingReview,
    Applying,
    Complete,
    Cancelled,
    Failed,
}

/// Detected external raster engine used behind the narrow LiDAR adapter.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarEngineStatus {
    pub available: bool,
    pub version: Option<String>,
    pub detail: Option<String>,
}

/// Display tile pyramid metadata. `url_template` is a platform-resolved local
/// asset URL with MapLibre `{z}_{x}_{y}` substitution and `.png` extension.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarTileset {
    pub style: String,
    /// Absolute filesystem tile path template ending in `{z}_{x}_{y}.png`;
    /// the frontend resolves it to a local asset URL for MapLibre.
    pub path_template: String,
    pub min_zoom: u32,
    pub max_zoom: u32,
    pub tile_size: u32,
    /// Geographic bounds as `[west, south, east, north]` WGS84 degrees for
    /// direct use by MapLibre. Prepared catalogue rows remain EPSG:3857.
    pub bounds: [f64; 4],
}

/// Library-side summary of a source layer.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarLayerSummary {
    pub id: String,
    pub name: String,
    pub measurement_kind: LidarMeasurementKind,
    pub units: String,
    pub state: LidarResultState,
    /// Native source-grid resolution in metres for accepted coverage.
    pub resolution_m: Option<f64>,
    pub coverage_cells: u64,
    pub bounds: Option<[f64; 4]>,
    pub value_range: Option<[f64; 2]>,
    pub tilesets: Vec<LidarTileset>,
    pub analysis_count: u32,
}

/// Library-side summary of an analysis definition and its current result.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarAnalysisSummary {
    pub id: String,
    pub source_layer_id: String,
    pub kind: LidarAnalysisKind,
    pub state: LidarResultState,
    pub detail: Option<String>,
    pub bounds: Option<[f64; 4]>,
    pub value_range: Option<[f64; 2]>,
    pub tilesets: Vec<LidarTileset>,
}

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarLibrarySnapshot {
    pub layers: Vec<LidarLayerSummary>,
    pub analyses: Vec<LidarAnalysisSummary>,
    pub engine: LidarEngineStatus,
}

/// Admission facts for one staged source file.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarImportSourceFacts {
    pub filename: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub width: u32,
    pub height: u32,
    pub pixel_size_m: f64,
    pub nodata: Option<f32>,
    pub value_range: [f64; 2],
    /// Accepted into this staging; false entries carry `issues`.
    pub compatible: bool,
    pub issues: Vec<String>,
}

/// Review payload for one staged import. Coverage counts are exact valid
/// pixels classified against the destination layer over the union grid.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarImportReview {
    pub job_id: String,
    pub layer_id: String,
    pub sources: Vec<LidarImportSourceFacts>,
    pub uncovered_cells: u64,
    pub overlap_cells: u64,
    pub invalid_cells: u64,
    pub compatible: bool,
    pub issues: Vec<String>,
    /// Filesystem paths of the fixed-style Before/After preview images; the
    /// frontend resolves them to local asset URLs. `before` is absent when
    /// the destination layer has no accepted coverage yet.
    pub before_preview_path: Option<String>,
    pub after_preview_path: Option<String>,
}

/// Immutable published generation of a source layer, for layer history.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarGenerationHistoryEntry {
    pub id: String,
    pub created_at: String,
    pub coverage_cells: u64,
    pub members: Vec<String>,
    pub roles: Vec<String>,
    /// Import jobs whose acceptance produced this generation; each can be
    /// undone by republishing without its interpretation.
    pub job_ids: Vec<String>,
    pub is_head: bool,
}

/// Impact summary shown before a layer deletion is confirmed.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarDeleteImpact {
    pub layer_name: String,
    pub analysis_count: u32,
    pub analysis_ids: Vec<String>,
}

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarImportJob {
    pub job_id: String,
    pub layer_id: String,
    pub state: LidarImportJobState,
    pub review: Option<LidarImportReview>,
    pub message: Option<String>,
}

/// Receipt returned when an analysis definition is created and its first
/// job is enqueued.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarAnalysisReceipt {
    pub definition_id: String,
    pub job_id: String,
}

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarAnalysisJobStatus {
    pub job_id: String,
    pub definition_id: String,
    pub state: LidarResultState,
    pub message: Option<String>,
}

/// Analysis parameters. Slope output unit is selected in the definition per
/// the plan (§5); other parameters arrive with later slices.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarAnalysisParameters {
    pub slope_unit: Option<LidarSlopeUnit>,
}

// `.canopi` presentation section: ordered references to library layers and
// analysis results with per-entry display settings. Reference identities
// survive library renames; unavailable references persist without rendering.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarPresentationSection {
    pub schema_version: u32,
    pub entries: Vec<LidarPresentationEntry>,
    // Preserves unknown presentation fields for forward compatibility.
    #[serde(flatten)]
    #[specta(skip)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarPresentationEntryKind {
    Source,
    Analysis,
}

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarPresentationEntry {
    pub kind: LidarPresentationEntryKind,
    // Stable library identity: source-layer ID or analysis definition ID.
    pub id: String,
    pub visible: bool,
    pub opacity: f32,
    // User-defined order inside the LiDAR band; lower renders further back.
    pub order: u32,
    pub style: Option<String>,
    // Preserves unknown entry fields so newer builds round-trip on Web.
    #[serde(flatten)]
    #[specta(skip)]
    pub extra: HashMap<String, serde_json::Value>,
}

pub const LIDAR_PRESENTATION_SCHEMA_VERSION: u32 = 1;
