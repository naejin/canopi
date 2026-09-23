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
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarEngineStatus {
    pub available: bool,
    pub version: Option<String>,
    pub detail: Option<String>,
}

/// Where one tileset's pixels come from.
///
/// The distinction is explicit so a generation stored as sparse resolved
/// chunks never has to invent a filesystem path it does not own: the desktop
/// either resolves a preserved legacy pyramid's asset directory, or renders
/// the immutable generation on demand behind the raster protocol.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind")]
pub enum LidarTileSource {
    /// Preserved display pyramid: an absolute filesystem tile path template
    /// ending in `{z}_{x}_{y}.png`, resolved to a local asset URL.
    #[serde(rename = "legacy-asset")]
    LegacyAsset { path_template: String },
    /// Immutable generation rendered by the library on demand.
    #[serde(rename = "native-generation")]
    NativeGeneration { generation_id: String },
}

/// Display tile metadata for one generation and style.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarTileset {
    pub style: String,
    pub source: LidarTileSource,
    pub min_zoom: u32,
    pub max_zoom: u32,
    pub tile_size: u32,
    /// Geographic bounds as `[west, south, east, north]` WGS84 degrees for
    /// direct use by MapLibre. Prepared catalogue rows remain EPSG:3857.
    pub bounds: [f64; 4],
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
    pub tilesets: Vec<LidarTileset>,
    pub analysis_count: u32,
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
    /// with the other slope unit. `None` for a definition written before the
    /// unit was recorded, which the UI shows as degrees — the default the
    /// analysis path itself applies.
    #[serde(default)]
    pub slope_unit: Option<LidarSlopeUnit>,
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

/// Decision-specific comparison rendered from the same staged import that
/// will be applied. Both images use one value scale.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarImportDecisionPreview {
    pub add_uncovered: bool,
    pub replace_overlap: bool,
    pub before_preview_path: Option<String>,
    pub after_preview_path: String,
}

/// Immutable published generation of a source layer, for layer history.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarGenerationHistoryEntry {
    pub id: String,
    pub created_at: String,
    /// Exact valid cells, or `None` when that count is not known.
    pub coverage_cells: Option<u64>,
    pub display_range: Option<LidarDisplayRange>,
    /// Position of this version in the layer's publication order, counting from
    /// the oldest. Unique within the layer, so it is the identity cue History
    /// shows instead of numbering that makes consecutive imports read alike.
    pub sequence: u32,
    /// User operation this version recorded (`import`, `reorder`, `remove`,
    /// `undo`, `restore`). Absent for a version migrated from a catalogue that
    /// did not record one; the UI names those neutrally rather than guessing.
    pub operation: Option<String>,
    /// Occurrences in this version's ordered composition.
    pub source_count: u32,
    pub is_head: bool,
    /// Whether this version can be restored as the new head.
    pub restorable: bool,
}

/// One occurrence in a Data Layer's priority list, topmost first.
///
/// `kind` is `source` for an ordinary independently prepared COG and
/// `previous-composition` for the single indivisible member that exposes a
/// preserved pre-transition head. A source member carries its own measured
/// coverage; a previous-composition member reports the preserved generation's.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarLayerSource {
    pub member_id: String,
    pub kind: String,
    /// Display name of the source file, when this member has one.
    pub filename: Option<String>,
    pub interpretation_id: Option<String>,
    /// Preserved generation this member replays, for a previous composition.
    pub base_generation_id: Option<String>,
    pub width: u32,
    pub height: u32,
    pub pixel_size_m: f64,
    pub coverage_cells: u64,
    pub value_range: [f64; 2],
}

/// The ordered composition and published versions of one Data Layer.
///
/// `sources` is the layer's priority list exactly as the UI must show it:
/// index 0 is the topmost source and its valid samples cover every source below
/// it. `head_generation_id` is the immutable snapshot the list describes, which
/// every edit echoes back so a stale edit fails by name instead of applying to
/// a newer order.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarLayerCollection {
    pub layer_id: String,
    /// Immutable snapshot this page describes. Every edit echoes it back, so a
    /// request prepared against a superseded head fails by name.
    pub head_generation_id: Option<String>,
    /// Occurrences in the whole current composition, not only this page.
    pub member_count: u32,
    /// Whether Undo is offered from this head at all. An available Undo with no
    /// target restores the empty composition; an unavailable one is exhausted.
    pub undo_available: bool,
    /// Snapshot Undo restores; absent means the empty composition.
    pub undo_target: Option<String>,
    /// One bounded page of the top-first priority list.
    pub sources: Vec<LidarLayerSource>,
    /// Cursor for the next member page, when the composition has more.
    pub next_member_cursor: Option<String>,
}

/// Largest source-list page a caller may request.
pub const LAYER_MEMBER_PAGE: i64 = 200;
/// Largest history page a caller may request.
pub const LAYER_HISTORY_PAGE: i64 = 100;

/// What one awaited ordered-layer edit did.
///
/// `changed` distinguishes a published snapshot from a request that was
/// legitimately a no-op, and `head_generation_id` is the authoritative head
/// after settlement, so the caller never has to infer whether its edit landed.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarLayerEditOutcome {
    pub head_generation_id: Option<String>,
    pub changed: bool,
    pub message: Option<String>,
}

/// One bounded page of a Data Layer's publication history, newest first.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LidarLayerHistoryPage {
    pub layer_id: String,
    pub head_generation_id: Option<String>,
    pub versions: Vec<LidarGenerationHistoryEntry>,
    /// Cursor for the next page, when older versions exist.
    pub next_cursor: Option<String>,
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
    pub progress: Option<LidarImportProgress>,
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
    /// caller can never signal another's read. Empty means "not cancellable",
    /// which keeps an older caller working without claiming a slot it cannot
    /// release.
    #[serde(default)]
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend reads these exact keys: a tagged tile source carries the
    /// variant in `kind` and keeps snake_case payload fields, like every other
    /// tagged contract in this crate.
    #[test]
    fn tile_source_wire_shape_is_tagged_and_stable() {
        let legacy = LidarTileset {
            style: "elevation".to_string(),
            source: LidarTileSource::LegacyAsset {
                path_template: "/data/{z}_{x}_{y}.png".to_string(),
            },
            min_zoom: 13,
            max_zoom: 17,
            tile_size: 256,
            bounds: [-1.0, 48.0, 0.0, 49.0],
        };
        let json = serde_json::to_string(&legacy).unwrap();
        assert!(json.contains(r#""kind":"legacy-asset""#), "{json}");
        assert!(json.contains(r#""path_template""#), "{json}");
        assert!(!json.contains("path-template"), "{json}");

        let native = LidarTileSource::NativeGeneration {
            generation_id: "gen-1".to_string(),
        };
        let json = serde_json::to_string(&native).unwrap();
        assert_eq!(
            json,
            r#"{"kind":"native-generation","generation_id":"gen-1"}"#
        );
    }
}
