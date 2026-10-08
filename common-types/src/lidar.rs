//! Cross-language contracts for the local LiDAR raster library.
//!
//! These types cross the Tauri IPC boundary and the `.canopi` document
//! presentation section. Library contents live in `lidar-library.sqlite` and
//! managed app data; documents only ever hold ordered presentation entries
//! that reference library identities.

use serde::{Deserialize, Serialize};
use specta::Type;

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
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct LidarEngineStatus {
    pub available: bool,
    pub version: Option<String>,
    pub detail: Option<String>,
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

/// The stored unit of an "other continuous" source whose author stated the
/// unit is not known. A label such as `unitless` would claim the values are
/// dimensionless, which is a measurement claim nobody made; an undeclared unit
/// is refused at import.
pub const LIDAR_UNITS_UNKNOWN: &str = "unknown";

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
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

// Numeric pixel inspection: one read-only lookup of the physical value at one
// WGS84 point on one source or derived generation. The expected generation is
// part of the request so a head that changed since the user aimed is refused
// rather than answered from different bytes.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarSampleRequest {
    pub kind: crate::library::LibraryItemRole,
    /// Library item id, matching `kind`.
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
    /// The caller derives this from the scene point with the session plane's
    /// `toGeo`, which is the projection the canvas actually drew with, so
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

/// The most targets one `lidar_sample_points` request may carry; the
/// frontend splits longer lists into batches of this size.
pub const LIDAR_SAMPLE_MAX_TARGETS: usize = 8;
/// The most points one `lidar_sample_points` request may carry: a profile
/// samples at most this many points along its line.
pub const LIDAR_SAMPLE_MAX_POINTS: usize = 4096;

// One sampler for the Site data row values, the pin and the profile: the
// native cell under each WGS84 point (no interpolation) of each target, read
// through the one CRS authority. A request carries at most
// `LIDAR_SAMPLE_MAX_TARGETS` targets and `LIDAR_SAMPLE_MAX_POINTS` points and
// is refused before any work beyond either.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarSamplePointsRequest {
    pub targets: Vec<LidarSampleTarget>,
    /// WGS84 `[longitude, latitude]` in degrees, in the caller's order.
    pub points: Vec<[f64; 2]>,
}

/// One item to sample, aimed at the generation the caller believes current.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarSampleTarget {
    pub kind: crate::library::LibraryItemRole,
    /// Library item id, matching `kind`.
    pub entity_id: String,
    pub expected_generation_id: String,
}

/// One target's answer, in target order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub enum LidarSampleSeries {
    /// One value per point, in point order; `None` where the cell declares no
    /// data or the point lies outside the generation.
    Values { values: Vec<Option<f64>> },
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
    pub kind: crate::library::LibraryItemRole,
    /// Library item id, matching `kind`.
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
    pub kind: crate::library::LibraryItemRole,
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

// `.canopi` presentation section: ordered references to library sources and
// derived items with per-entry display settings. Reference identities
// survive library renames; unavailable references persist without rendering.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarPresentationSection {
    pub schema_version: u32,
    // The Site data eye in Layers: an entry draws only while both this flag
    // and its own `visible` are on, and each entry keeps its own eye.
    pub visible: bool,
    pub entries: Vec<LidarPresentationEntry>,
}

/// Import › "Covers your site": where the chosen files lie, read before import.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarImportCoverage {
    /// WGS84 `[west, south, east, north]` around every file whose extent was read.
    pub bounds: Option<[f64; 4]>,
    /// Files whose geographic extent could not be read.
    pub unreadable_files: u32,
}

#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LidarPresentationEntry {
    pub kind: crate::library::LibraryItemRole,
    // Stable library identity: source-layer ID or derived item ID.
    pub id: String,
    // The library item's name, written on attach and refreshed from the
    // library while the item exists, so a missing item still reads by name.
    pub name: String,
    pub visible: bool,
    pub opacity: f32,
    // User-defined order inside the LiDAR band; lower renders further back.
    pub order: u32,
    // The colour ramp; `None` is the item kind's default.
    pub ramp: Option<LidarRamp>,
    pub reversed: bool,
    // The value range the ramp spans; `None` is the item kind's default.
    pub range: Option<LidarColourRange>,
}

// A colour ramp by Canopi's own name; the frontend maps each to a renderer
// ramp, so a renderer rename never reaches files. A variant is added only
// when an item kind that offers it ships. A ramp outside the item kind's list
// draws with the kind's default.
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum LidarRamp {
    Terrain,
    Earth,
    Greens,
    YellowRed,
    Magma,
    Gray,
}

// The value range a ramp spans: the data's own range, the data with its
// outliers cut (the cut values are recomputed each session, never stored), or
// the user's pair (finite, `min < max`).
#[cfg_attr(feature = "design-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "mode")]
pub enum LidarColourRange {
    Data,
    CutOutliers,
    Custom { min: f64, max: f64 },
}

pub const LIDAR_PRESENTATION_SCHEMA_VERSION: u32 = 1;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_batched_sample_crosses_ipc_in_target_order() {
        let request: LidarSamplePointsRequest = serde_json::from_value(json!({
            "targets": [
                { "kind": "Source", "entity_id": "ground", "expected_generation_id": "g1" },
                { "kind": "Derived", "entity_id": "slope", "expected_generation_id": "g2" }
            ],
            "points": [[0.0338, 48.2202], [0.0339, 48.2203]]
        }))
        .expect("a sample request decodes");
        assert_eq!(
            request.targets[1].kind,
            crate::library::LibraryItemRole::Derived
        );
        assert_eq!(request.points[1], [0.0339, 48.2203]);

        let series = vec![
            LidarSampleSeries::Values {
                values: vec![Some(142.5), None],
            },
            LidarSampleSeries::Unavailable {
                reason: LidarSampleUnavailableReason::StaleGeneration,
            },
        ];
        assert_eq!(
            serde_json::to_value(series).unwrap(),
            json!([
                { "Values": { "values": [142.5, null] } },
                { "Unavailable": { "reason": "StaleGeneration" } }
            ])
        );
    }
}
