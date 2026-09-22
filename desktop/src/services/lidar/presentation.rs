//! Library-side presentation snapshots for IPC consumers.
//!
//! The snapshot joins catalogue identity/status with registered display
//! tilesets. Document-side visibility/opacity/order live in `.canopi` via the
//! Design Edit seam; the library never reads documents.

use super::catalogue;
use super::engine::GdalEngine;
use common_types::lidar::{
    LidarAnalysisKind, LidarAnalysisSummary, LidarEngineStatus, LidarLayerSummary,
    LidarLibrarySnapshot, LidarResultState, LidarTileSource, LidarTileset,
};
use rusqlite::Connection;

pub fn library_snapshot(
    connection: &Connection,
    display_connection: &Connection,
    engine: &GdalEngine,
) -> Result<LidarLibrarySnapshot, String> {
    let layers = catalogue::list_layers(connection)?;
    let definitions = catalogue::list_definitions(connection)?;
    let mut layer_summaries = Vec::new();
    for layer in layers {
        let head = catalogue::head_generation(connection, &layer.id)?;
        let analysis_count =
            catalogue::list_definitions_for_layer(connection, &layer.id)?.len() as u32;
        let (coverage_cells, resolution_m, bounds, value_range, tilesets) = match &head {
            Some(head) => {
                let bounds = serde_json::from_str::<Vec<f64>>(&head.bounds_3857)
                    .ok()
                    .and_then(|v| <[f64; 4]>::try_from(v).ok())
                    .map(bounds_3857_to_wgs84);
                let range = match (head.min_value, head.max_value) {
                    (Some(min), Some(max)) => Some([min, max]),
                    _ => None,
                };
                let manifest = super::import::read_generation_manifest(&head.manifest_json).ok();
                let registered =
                    tilesets_for(display_connection, "source", &layer.id, head.id.clone());
                let tilesets = if registered.is_empty() {
                    native_tilesets("elevation", &head.id, manifest.as_ref(), bounds)
                } else {
                    registered
                };
                (
                    head.coverage_cells as u64,
                    manifest
                        .as_ref()
                        .map(|manifest| manifest.grid.pixel_size().0),
                    bounds,
                    range,
                    tilesets,
                )
            }
            None => (0, None, None, None, Vec::new()),
        };
        layer_summaries.push(LidarLayerSummary {
            id: layer.id.clone(),
            name: layer.name.clone(),
            measurement_kind: parse_measurement_kind(&layer.measurement_kind),
            units: layer.units.clone(),
            state: if head.is_some() {
                LidarResultState::Ready
            } else {
                LidarResultState::Preparing
            },
            resolution_m,
            coverage_cells,
            bounds,
            value_range,
            tilesets,
            analysis_count,
        });
    }

    let mut analysis_summaries = Vec::new();
    for definition in definitions {
        let head_result = catalogue::head_analysis_generation(connection, &definition.id)?;
        let latest_job = catalogue::latest_analysis_job_state(connection, &definition.id)?;
        // Readiness is a fact about identity, not about a job having once
        // succeeded: a result is current only while the source generation it
        // captured is still the layer's head, and only while that composition
        // holds something to analyse. Deriving it here is what keeps a
        // restart, a failed refresh or a cancelled refresh from presenting an
        // old result as the current one.
        let layer_head = catalogue::head_generation(connection, &definition.layer_id)?;
        let composition_ready = match layer_head.as_ref() {
            None => false,
            Some(head) => {
                let manifest = super::import::read_generation_manifest(&head.manifest_json)?;
                if manifest.format.is_ordered_collection() {
                    catalogue::collection_member_count(connection, &head.id)? > 0
                } else {
                    head.coverage_cells > 0
                }
            }
        };
        let current_source = layer_head.as_ref().map(|head| head.id.as_str());
        let result_is_current = head_result
            .as_ref()
            .is_some_and(|result| Some(result.source_generation_id.as_str()) == current_source);
        let (state, detail) = match (latest_job.as_deref(), &head_result) {
            (Some("preparing"), _) => (LidarResultState::Preparing, None),
            (Some("refreshing"), _) => (LidarResultState::Refreshing, None),
            (Some("failed"), Some(_result)) if result_is_current => (
                LidarResultState::Ready,
                Some("last refresh failed; showing the previous complete result".to_string()),
            ),
            (Some("failed"), Some(_result)) => (
                LidarResultState::Incomplete,
                Some(
                    "this result describes an earlier composition; the current one has no \
                     published slope yet"
                        .to_string(),
                ),
            ),
            (Some("failed"), None) => (LidarResultState::Failed, Some(String::new())),
            (Some("cancelled"), Some(_result)) if result_is_current => {
                (LidarResultState::Ready, None)
            }
            (Some("cancelled"), Some(_result)) => (
                LidarResultState::Incomplete,
                Some(
                    "this result describes an earlier composition; the current one has no \
                     published slope yet"
                        .to_string(),
                ),
            ),
            (Some("cancelled"), None) => (LidarResultState::Failed, Some("cancelled".to_string())),
            (_, Some(result)) if !composition_ready => (
                LidarResultState::Incomplete,
                Some("the layer's current composition is empty".to_string()),
            ),
            (_, Some(result)) if !result_is_current => (
                LidarResultState::Incomplete,
                Some(
                    "this result describes an earlier composition; a refresh is pending"
                        .to_string(),
                ),
            ),
            (_, Some(result)) => (parse_result_state(&result.state), None),
            (_, None) => (LidarResultState::Preparing, None),
        };
        // The name belongs to the published result, so an unnamed or pre-v17
        // generation reports none and the UI falls back to the kind.
        let result_name = head_result.as_ref().and_then(|result| result.name.clone());
        let (bounds, value_range, tilesets) = match &head_result {
            Some(result) => {
                let bounds = serde_json::from_str::<Vec<f64>>(&result.bounds_3857)
                    .ok()
                    .and_then(|v| <[f64; 4]>::try_from(v).ok())
                    .map(bounds_3857_to_wgs84);
                let range = match (result.min_value, result.max_value) {
                    (Some(min), Some(max)) => Some([min, max]),
                    _ => None,
                };
                // An analysis generation carries a result manifest, not a
                // source manifest: parse it as what it is.
                let manifest =
                    serde_json::from_str::<super::analysis::ResultManifest>(&result.manifest_json)
                        .ok();
                let registered = tilesets_for(
                    display_connection,
                    "analysis",
                    &definition.id,
                    result.id.clone(),
                );
                // A sparse result owns no pyramid; it is rendered on demand.
                let tilesets = if registered.is_empty() {
                    native_tilesets("slope", &result.id, manifest.as_ref(), bounds)
                } else {
                    registered
                };
                (bounds, range, tilesets)
            }
            None => (None, None, Vec::new()),
        };
        analysis_summaries.push(LidarAnalysisSummary {
            id: definition.id.clone(),
            source_layer_id: definition.layer_id.clone(),
            kind: parse_analysis_kind(&definition.kind)?,
            name: result_name,
            state,
            detail,
            bounds,
            value_range,
            tilesets,
        });
    }

    let engine_status = match engine.discover() {
        Ok(tools) => LidarEngineStatus {
            available: true,
            version: Some(tools.version),
            detail: None,
        },
        Err(error) => LidarEngineStatus {
            available: false,
            version: None,
            detail: Some(error),
        },
    };

    Ok(LidarLibrarySnapshot {
        layers: layer_summaries,
        analyses: analysis_summaries,
        engine: engine_status,
    })
}

/// The parts of either manifest an on-demand tileset needs.
trait NativeTileManifest {
    fn format(&self) -> super::import::GenerationStorageFormat;
    fn grid(&self) -> &super::grid::RasterGrid;
}

impl NativeTileManifest for super::import::GenerationManifest {
    fn format(&self) -> super::import::GenerationStorageFormat {
        self.format
    }

    fn grid(&self) -> &super::grid::RasterGrid {
        &self.grid
    }
}

impl NativeTileManifest for super::analysis::ResultManifest {
    fn format(&self) -> super::import::GenerationStorageFormat {
        self.format
    }

    fn grid(&self) -> &super::grid::RasterGrid {
        &self.grid
    }
}

/// Zoom ceiling shared with the legacy pyramid renderer.
const MAX_ZOOM_CEILING: u32 = 22;
/// Pyramid depth presented for an on-demand generation.
const NATIVE_ZOOM_LEVELS: u32 = 5;
/// Web Mercator world size in metres.
const WEB_MERCATOR_WORLD: f64 = 40_075_016.685_578_49;

/// Build the on-demand tileset of a generation that owns no display pyramid.
///
/// The zoom range mirrors the legacy pyramid rule (native resolution is the
/// deepest level, four coarser levels above it), so switching a layer between
/// storage formats does not change how it is framed on the map.
fn native_tilesets<M: NativeTileManifest>(
    style: &str,
    generation_id: &str,
    manifest: Option<&M>,
    bounds: Option<[f64; 4]>,
) -> Vec<LidarTileset> {
    let Some(manifest) = manifest else {
        return Vec::new();
    };
    // A generation with no stored display pyramid is rendered on demand: a
    // published resolved-chunk generation and an ordered source collection
    // alike. A preserved dense generation keeps its published asset pyramid.
    if !matches!(
        manifest.format(),
        super::import::GenerationStorageFormat::CogChunksV1
            | super::import::GenerationStorageFormat::OrderedMembersV1
    ) {
        return Vec::new();
    }
    let Some(bounds) = bounds else {
        return Vec::new();
    };
    let pixel = manifest.grid().pixel_size().0;
    if !(pixel.is_finite() && pixel > 0.0) {
        return Vec::new();
    }
    let max_zoom = (WEB_MERCATOR_WORLD / 256.0 / pixel)
        .log2()
        .floor()
        .clamp(0.0, f64::from(MAX_ZOOM_CEILING)) as u32;
    vec![LidarTileset {
        style: style.to_string(),
        source: LidarTileSource::NativeGeneration {
            generation_id: generation_id.to_string(),
        },
        min_zoom: max_zoom.saturating_sub(NATIVE_ZOOM_LEVELS - 1),
        max_zoom,
        tile_size: 256,
        bounds,
    }]
}

fn tilesets_for(
    display_connection: &Connection,
    entity_kind: &str,
    entity_id: &str,
    generation_id: String,
) -> Vec<LidarTileset> {
    let mut statement = match display_connection.prepare(
        "SELECT style, path_template, min_zoom, max_zoom, bounds_3857
         FROM tilesets WHERE entity_kind = ?1 AND entity_id = ?2 AND generation_id = ?3
         ORDER BY style",
    ) {
        Ok(statement) => statement,
        Err(_) => return Vec::new(),
    };
    let rows = statement.query_map(
        rusqlite::params![entity_kind, entity_id, generation_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
            ))
        },
    );
    let Ok(rows) = rows else {
        return Vec::new();
    };
    rows.flatten()
        .filter_map(|(style, template, min_zoom, max_zoom, bounds)| {
            let bounds = serde_json::from_str::<Vec<f64>>(&bounds)
                .ok()
                .and_then(|v| <[f64; 4]>::try_from(v).ok())?;
            Some(LidarTileset {
                style,
                source: LidarTileSource::LegacyAsset {
                    path_template: template,
                },
                min_zoom: min_zoom.clamp(0, 30) as u32,
                max_zoom: max_zoom.clamp(0, 30) as u32,
                tile_size: 256,
                bounds: bounds_3857_to_wgs84(bounds),
            })
        })
        .collect()
}

fn bounds_3857_to_wgs84(bounds: [f64; 4]) -> [f64; 4] {
    fn longitude(x: f64) -> f64 {
        (x / 20_037_508.342_789_244 * 180.0).clamp(-180.0, 180.0)
    }
    fn latitude(y: f64) -> f64 {
        let radius = 20_037_508.342_789_244 / std::f64::consts::PI;
        (y / radius)
            .sinh()
            .atan()
            .to_degrees()
            .clamp(-85.051_128_78, 85.051_128_78)
    }
    [
        longitude(bounds[0]),
        latitude(bounds[1]),
        longitude(bounds[2]),
        latitude(bounds[3]),
    ]
}

// Parsing helpers remain grouped below the presentation regression tests.
#[allow(clippy::items_after_test_module)]
#[cfg(test)]
mod tests {
    use super::bounds_3857_to_wgs84;

    #[test]
    fn map_bounds_are_projected_to_longitude_and_latitude() {
        let bounds = bounds_3857_to_wgs84([-47_546.0, 6_157_700.0, -45_981.0, 6_159_269.0]);
        assert!(bounds[0] > -0.5 && bounds[2] < -0.4, "{bounds:?}");
        assert!(bounds[1] > 48.2 && bounds[3] < 48.4, "{bounds:?}");
    }
}

fn parse_measurement_kind(raw: &str) -> common_types::lidar::LidarMeasurementKind {
    match raw {
        "surface-elevation" => common_types::lidar::LidarMeasurementKind::SurfaceElevation,
        "above-ground-height" => common_types::lidar::LidarMeasurementKind::AboveGroundHeight,
        "other-continuous" => common_types::lidar::LidarMeasurementKind::OtherContinuous,
        _ => common_types::lidar::LidarMeasurementKind::GroundElevation,
    }
}

fn parse_analysis_kind(raw: &str) -> Result<LidarAnalysisKind, String> {
    match raw {
        "slope" => Ok(LidarAnalysisKind::Slope),
        other => Err(format!("unknown analysis kind {other}")),
    }
}

fn parse_result_state(raw: &str) -> LidarResultState {
    match raw {
        "incomplete" => LidarResultState::Incomplete,
        "failed" => LidarResultState::Failed,
        _ => LidarResultState::Ready,
    }
}
