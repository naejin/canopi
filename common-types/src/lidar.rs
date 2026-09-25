//! Cross-language contracts for the local LiDAR raster library.
//!
//! These types cross the Tauri IPC boundary and the `.canopi` document
//! presentation section. Library contents live in `lidar-library.sqlite` and
//! managed app data; documents only ever hold ordered presentation entries
//! that reference library identities.

use serde::{Deserialize, Serialize};
use specta::Type;

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

/// State of a library item: its operation while it runs, then a fixed result.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarResultState {
    Preparing,
    Ready,
    Failed,
}

/// Import job states.
///
/// `Staging` is preparation, `Applying` is publication, and the terminal states
/// report the outcome.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarImportJobState {
    Staging,
    Applying,
    Complete,
    Cancelled,
    Failed,
}

/// Backend-owned phases for determinate import publication progress.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarImportProgressPhase {
    ComposingLayer,
    PreparingRaster,
    RenderingMap,
    Finalizing,
}

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct LidarImportProgress {
    pub phase: LidarImportProgressPhase,
    pub percent: u8,
}

/// Detected external raster engine used behind the narrow LiDAR adapter.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct LidarEngineStatus {
    pub available: bool,
    pub version: Option<String>,
    pub detail: Option<String>,
}

/// Library-side summary of a source layer.
/// How an "other continuous" dataset's values are labelled.
///
/// A continuous dataset that is neither an elevation nor a height has no
/// inherent unit, so the unit is a decision only its author can make. This makes
/// three states distinguishable rather than two:
///
/// - a real label, such as `mg/kg`;
/// - an explicit unknown, stored as the sentinel below, for an author who does
///   not know the unit yet but wants the data usable;
/// - undeclared, which is a *different* thing and is refused at creation.
///
/// Folding the middle case into a label like `unitless` would claim the values
/// are dimensionless, which is a measurement claim nobody made.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarUnitDeclaration {
    /// The author supplied a unit label.
    Known,
    /// The author stated the unit is not known.
    Unknown,
}

pub const LIDAR_UNITS_UNKNOWN: &str = "unknown";

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarLayerSummary {
    pub id: String,
    /// Current immutable head generation, when the item has been published.
    #[serde(default)]
    pub generation_id: Option<String>,
    pub name: String,
    pub measurement_kind: LidarMeasurementKind,
    pub units: String,
    pub state: LidarResultState,
    /// Native source-grid resolution in metres for accepted coverage.
    pub resolution_m: Option<f64>,
    /// Exact valid cells in the accepted composition.
    ///
    /// `None` when the exact count is not known. Publishing membership does not
    /// require reading the composed pixels, so a generation that was published
    /// without that scan reports unknown coverage rather than zero: zero means
    /// "measured, and there is nothing there".
    pub coverage_cells: Option<u64>,
    pub bounds: Option<[f64; 4]>,
    /// Exact composed value range, when it is known.
    pub value_range: Option<[f64; 2]>,
    /// The range styling and legends use, labelled by how it was derived.
    pub display_range: Option<LidarDisplayRange>,
    pub analysis_count: u32,
    /// The latest import operation of this item: progress while it runs, and
    /// the reason and Retry while an unpublished item's import failed.
    #[serde(default)]
    pub import_job: Option<LidarImportJob>,
}

/// Where a display range came from.
///
/// The distinction is the point: a source envelope may include values that no
/// composed pixel actually holds, so it is a stable colour domain rather than a
/// scientific statistic.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarDisplayRangeBasis {
    /// Measured from the composed value itself.
    Exact,
    /// The union of the stored member ranges, which may include occluded
    /// extremes.
    SourceEnvelope,
}

/// The range a generation is displayed with, and what it is based on.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarDisplayRange {
    pub min: f64,
    pub max: f64,
    pub basis: LidarDisplayRangeBasis,
}

/// Library-side summary of an analysis definition and its current result.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarAnalysisSummary {
    pub id: String,
    /// Current published result generation, when one exists.
    #[serde(default)]
    pub generation_id: Option<String>,
    /// The source generation this result was calculated from. A published
    /// result keeps describing that input even if the source moved on.
    #[serde(default)]
    pub input_generation_id: Option<String>,
    pub source_layer_id: String,
    pub kind: LidarAnalysisKind,
    /// The name its author gave this result.
    ///
    /// `None` for a result published before names existed and for one whose
    /// author left the field empty; the UI then shows its kind, so an unnamed
    /// result is never presented with an invented name.
    pub name: Option<String>,
    pub state: LidarResultState,
    pub detail: Option<String>,
    pub bounds: Option<[f64; 4]>,
    pub value_range: Option<[f64; 2]>,
    /// The unit this result was actually computed in.
    ///
    /// Read from the definition's own parameters rather than from the input
    /// layer, so a slope in percent is never labelled with an elevation unit or
    /// with the other slope unit.
    pub slope_unit: LidarSlopeUnit,
    /// How this definition is computed, from its stored recipe version.
    /// `None` for a version this build does not know.
    #[serde(default)]
    pub method: Option<LidarAnalysisMethod>,
    /// The engine build that produced the current result, as recorded at
    /// publication; `None` without a result.
    #[serde(default)]
    pub engine_version: Option<String>,
}

/// A qualified analysis method, identified by its recipe.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarAnalysisMethod {
    /// Recipe 2: the pinned GeoLibre projected slope, 5×5 Florinsky stencil.
    GeolibreProjectedSlopeV1,
}

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarLibrarySnapshot {
    pub layers: Vec<LidarLayerSummary>,
    pub analyses: Vec<LidarAnalysisSummary>,
    pub engine: LidarEngineStatus,
    /// Whether new slope results can be calculated: the GeoLibre engine they
    /// need. Saved results stay readable whatever this reports.
    #[serde(default)]
    pub slope_engine: LidarEngineStatus,
}

/// One source file in a Data Layer's priority list, topmost first, with its
/// own measured coverage.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarLayerSource {
    pub member_id: String,
    /// Original name of the imported source file.
    pub filename: String,
    pub interpretation_id: String,
    pub width: u32,
    pub height: u32,
    pub pixel_size_m: f64,
    pub coverage_cells: u64,
    pub value_range: [f64; 2],
}

/// The ordered source files of one fixed library item.
///
/// `sources` is the item's priority list exactly as the UI shows it: index 0
/// is the topmost source and its valid samples cover every source below it.
/// `head_generation_id` is the immutable snapshot the list describes.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarLayerCollection {
    pub layer_id: String,
    /// Immutable snapshot this page describes.
    pub head_generation_id: Option<String>,
    /// Occurrences in the whole current composition, not only this page.
    pub member_count: u32,
    /// One bounded page of the top-first priority list.
    pub sources: Vec<LidarLayerSource>,
    /// Cursor for the next member page, when the composition has more.
    pub next_member_cursor: Option<String>,
}

/// Largest source-list page a caller may request.
pub const LAYER_MEMBER_PAGE: i64 = 200;
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
    pub message: Option<String>,
    pub progress: Option<LidarImportProgress>,
}

/// Receipt for one submitted import operation: the fixed library item it
/// publishes and the job that prepares it.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarImportReceipt {
    pub layer_id: String,
    pub job_id: String,
}

/// Receipt returned when an analysis definition is created and its first
/// job is enqueued.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarAnalysisReceipt {
    pub definition_id: String,
    pub job_id: String,
}

/// Analysis parameters. Slope output unit is selected in the definition per
/// the plan (§5); other parameters arrive with later slices.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarAnalysisParameters {
    /// The slope output unit. Always chosen by the user; there is no default.
    pub slope_unit: LidarSlopeUnit,
    /// The name to publish this result under.
    ///
    /// Optional and defaulted, so an existing caller that sends only a slope
    /// unit keeps working and simply publishes an unnamed result. The name
    /// travels with the definition's parameters, so a refresh publishes the
    /// same name rather than silently renaming the user's result.
    pub name: Option<String>,
}

// Numeric pixel inspection: one read-only lookup of the physical value at one
// WGS84 point on one source or result generation. The expected generation is
// part of the request so a head that changed since the user aimed is refused
// rather than answered from different bytes.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarSampleEntityKind {
    /// A source Data Layer.
    Source,
    /// An analysis result.
    Analysis,
}

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarSampleRequest {
    pub kind: LidarSampleEntityKind,
    /// Layer id or analysis definition id, matching `kind`.
    pub entity_id: String,
    /// The immutable generation the caller believes is current.
    pub expected_generation_id: String,
    /// Opaque identity of this lookup, chosen by the caller.
    ///
    /// Inspection shares the bounded display read admission with raster tiles,
    /// so a superseded or abandoned lookup has to be cancellable by the owner
    /// that started it. The name is scoped per surface by the command, so one
    /// caller can never signal another's read. It must not be empty.
    pub request_id: String,
    /// WGS84 longitude in degrees of the point to sample.
    ///
    /// The caller derives this from the scene point with the canvas's own
    /// `worldToGeo`, which is the projection the canvas actually drew with, so
    /// the sampled point is the displayed point. Nothing here re-derives or
    /// approximates the placement: the native side only transforms this WGS84
    /// point into the generation's own CRS.
    pub longitude: f64,
    /// WGS84 latitude in degrees of the point to sample.
    pub latitude: f64,
}

/// Why a sample could not produce a physical value.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarSampleUnavailableReason {
    /// The entity or generation no longer exists.
    MissingGeneration,
    /// The head moved after the request was aimed; re-aim and try again.
    StaleGeneration,
    /// The point does not transform into the generation's grid.
    TransformFailed,
    /// The generation's interpretation cannot be sampled numerically.
    UnsupportedInput,
}

/// The outcome of one numeric inspection lookup.
///
/// `Value` carries the generation that was actually read, so a caller can prove
/// the answer belongs to the head it asked about. The containing pixel is read
/// at native resolution; no display interpolation is involved.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub enum LidarSampleOutcome {
    Value {
        generation_id: String,
        value: f64,
        units: String,
    },
    /// Inside the generation, but the containing pixel declares no data.
    NoData { generation_id: String },
    Unavailable {
        reason: LidarSampleUnavailableReason,
    },
}

// Display derivatives: regenerable tiled COGs with overviews that the upstream
// WASM renderer reads through the scoped asset protocol. They are never source
// members, heads or results; numeric inspection and analysis keep reading the
// exact numeric generation.

/// Whether an entity's display derivative can be drawn now.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarDisplayState {
    /// Derivatives for the current generation are being prepared.
    Preparing,
    /// Every derivative exists; `assets` can be rendered.
    Ready,
    /// Nothing can be drawn: the entity, its generation or its data is gone.
    Unavailable,
    /// Preparation failed; a later request with `retry` starts it again.
    Failed,
    /// The entity's current generation is not the one the caller expected.
    Stale,
}

/// One display derivative file, in the entity's source-priority order.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarDisplayAsset {
    /// Absolute path of an immutable display COG inside the scoped display
    /// directory; the frontend converts it to an asset URL and never stores it.
    pub path: String,
    /// WGS84 footprint `[west, south, east, north]`.
    pub bounds: [f64; 4],
}

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarDisplayRequest {
    pub kind: LidarSampleEntityKind,
    /// Layer id or analysis definition id, matching `kind`.
    pub entity_id: String,
    /// The immutable generation the caller is about to draw, when known.
    pub expected_generation_id: Option<String>,
    /// Restart a failed preparation instead of reporting the failure again.
    #[serde(default)]
    pub retry: bool,
}

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarDisplayDescriptor {
    pub kind: LidarSampleEntityKind,
    pub entity_id: String,
    /// The generation these derivatives describe, when the entity has one.
    pub generation_id: Option<String>,
    /// Versioned display profile; part of every derivative's identity.
    pub profile: String,
    pub state: LidarDisplayState,
    pub message: Option<String>,
    /// Top-first: the first listed asset wins where assets overlap.
    pub assets: Vec<LidarDisplayAsset>,
    /// Derivatives already prepared out of `total_assets`.
    pub prepared_assets: u32,
    pub total_assets: u32,
}

// `.canopi` presentation section: ordered references to library layers and
// analysis results with per-entry display settings. Reference identities
// survive library renames; unavailable references persist without rendering.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarPresentationSection {
    pub schema_version: u32,
    pub entries: Vec<LidarPresentationEntry>,
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
}

pub const LIDAR_PRESENTATION_SCHEMA_VERSION: u32 = 1;
