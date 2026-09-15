//! Library-side presentation snapshots for IPC consumers.
//!
//! The snapshot joins catalogue identity/status with registered display
//! tilesets. Document-side visibility/opacity/order live in `.canopi` via the
//! Design Edit seam; the library never reads documents.

use super::catalogue;
use super::engine::GdalEngine;
use common_types::lidar::{
    LidarAnalysisKind, LidarAnalysisSummary, LidarEngineStatus, LidarLayerSummary,
    LidarLibrarySnapshot, LidarResultState, LidarTileset,
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
                (
                    head.coverage_cells as u64,
                    super::import::read_generation_manifest(&head.manifest_json)
                        .ok()
                        .map(|manifest| manifest.grid.pixel_size().0),
                    bounds,
                    range,
                    tilesets_for(display_connection, "source", &layer.id, head.id.clone()),
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
        let (state, detail) = match (latest_job.as_deref(), &head_result) {
            (Some("preparing"), _) => (LidarResultState::Preparing, None),
            (Some("refreshing"), _) => (LidarResultState::Refreshing, None),
            (Some("failed"), Some(_result)) => (
                LidarResultState::Ready,
                Some("last refresh failed; showing the previous complete result".to_string()),
            ),
            (Some("failed"), None) => (LidarResultState::Failed, Some(String::new())),
            (Some("cancelled"), Some(_result)) => (LidarResultState::Ready, None),
            (Some("cancelled"), None) => (LidarResultState::Failed, Some("cancelled".to_string())),
            (_, Some(result)) => (parse_result_state(&result.state), None),
            (_, None) => (LidarResultState::Preparing, None),
        };
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
                (
                    bounds,
                    range,
                    tilesets_for(
                        display_connection,
                        "analysis",
                        &definition.id,
                        result.id.clone(),
                    ),
                )
            }
            None => (None, None, Vec::new()),
        };
        analysis_summaries.push(LidarAnalysisSummary {
            id: definition.id.clone(),
            source_layer_id: definition.layer_id.clone(),
            kind: parse_analysis_kind(&definition.kind)?,
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
                path_template: template,
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
