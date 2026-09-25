//! Library-side presentation snapshots for IPC consumers.
//!
//! The snapshot reports catalogue identity, status and current generations;
//! the map draws each generation through its display descriptor. Document-side visibility/opacity/order live in `.canopi` via the
//! Design Edit seam; the library never reads documents.

use super::catalogue;
use super::engine::GdalEngine;
use common_types::lidar::{
    LidarAnalysisKind, LidarAnalysisMethod, LidarAnalysisSummary, LidarEngineStatus,
    LidarLayerSummary, LidarLibrarySnapshot, LidarResultState,
};
use rusqlite::Connection;

pub fn library_snapshot(
    connection: &Connection,
    engine: &GdalEngine,
    slope_engine: LidarEngineStatus,
) -> Result<LidarLibrarySnapshot, String> {
    let layers = catalogue::list_layers(connection)?;
    let definitions = catalogue::list_definitions(connection)?;
    let mut layer_summaries = Vec::new();
    for layer in layers {
        let head = catalogue::head_generation(connection, &layer.id)?;
        let analysis_count =
            catalogue::list_definitions_for_layer(connection, &layer.id)?.len() as u32;
        let (coverage_cells, display_range, resolution_m, bounds, value_range) = match &head {
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
                (
                    head.coverage_cells.map(|cells| cells.max(0) as u64),
                    display_range_of(head),
                    manifest
                        .as_ref()
                        .map(|manifest| manifest.grid.pixel_size().0),
                    bounds,
                    range,
                )
            }
            None => (Some(0), None, None, None, None),
        };
        let import_job = latest_import_job(connection, &layer.id)?;
        // A published item is Ready and stays fixed. An unpublished item is
        // its import operation: preparing while it runs, failed otherwise, and
        // never presented as a ready empty dataset.
        let state = if head.is_some() {
            LidarResultState::Ready
        } else {
            match import_job.as_ref().map(|job| job.state) {
                Some(
                    common_types::lidar::LidarImportJobState::Staging
                    | common_types::lidar::LidarImportJobState::Applying,
                ) => LidarResultState::Preparing,
                _ => LidarResultState::Failed,
            }
        };
        layer_summaries.push(LidarLayerSummary {
            id: layer.id.clone(),
            generation_id: head.as_ref().map(|head| head.id.clone()),
            name: layer.name.clone(),
            measurement_kind: parse_measurement_kind(&layer.measurement_kind),
            units: layer.units.clone(),
            state,
            resolution_m,
            coverage_cells,
            bounds,
            value_range,
            display_range,
            analysis_count,
            import_job,
        });
    }

    let mut analysis_summaries = Vec::new();
    for definition in definitions {
        let head_result = catalogue::head_analysis_generation(connection, &definition.id)?;
        let latest_job = catalogue::latest_analysis_job_state(connection, &definition.id)?;
        // A published result is a fixed library item: it describes the input
        // generation it was calculated from, whatever happened to that source
        // afterwards, and nothing refreshes it. Without a result the item is
        // its operation: preparing while the job runs, failed otherwise.
        let (state, detail) = match (&head_result, latest_job.as_deref()) {
            (Some(result), _) => (parse_result_state(&result.state), None),
            (None, Some("preparing")) => (LidarResultState::Preparing, None),
            (None, Some("cancelled")) => (LidarResultState::Failed, Some("cancelled".to_string())),
            (None, Some(_)) => (LidarResultState::Failed, Some(String::new())),
            (None, None) => (LidarResultState::Preparing, None),
        };
        // This build wrote every definition row; unreadable parameters are a
        // damaged catalogue, reported rather than shown with an invented unit.
        let parameters = serde_json::from_str::<super::analysis::AnalysisParameters>(
            &definition.parameters_json,
        )
        .map_err(|error| {
            format!(
                "LiDAR analysis {} has unreadable parameters: {error}",
                definition.id
            )
        })?;
        // A published result carries its own name (none for an unnamed one,
        // and the UI then shows the kind). An operation without a result
        // shows the name its author gave the calculation.
        let result_name = match &head_result {
            Some(result) => result.name.clone(),
            None => parameters
                .name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string),
        };
        // The unit belongs to the definition's own parameters, so a percent
        // slope is never labelled with the input layer's elevation unit.
        let slope_unit = parameters.slope_unit;
        let (bounds, value_range) = match &head_result {
            Some(result) => {
                let bounds = serde_json::from_str::<Vec<f64>>(&result.bounds_3857)
                    .ok()
                    .and_then(|v| <[f64; 4]>::try_from(v).ok())
                    .map(bounds_3857_to_wgs84);
                let range = match (result.min_value, result.max_value) {
                    (Some(min), Some(max)) => Some([min, max]),
                    _ => None,
                };
                (bounds, range)
            }
            None => (None, None),
        };
        // A result describes the input it was calculated from; an operation
        // without one describes the input its latest job was pinned to, which
        // is what Retry reruns.
        let input_generation_id = match &head_result {
            Some(result) => Some(result.source_generation_id.clone()),
            None => catalogue::latest_analysis_job_input(connection, &definition.id)?,
        };
        let method = super::analysis::SlopeRecipe::from_version(definition.version)
            .ok()
            .map(|recipe| match recipe {
                super::analysis::SlopeRecipe::GeolibreProjected => {
                    LidarAnalysisMethod::GeolibreProjectedSlopeV1
                }
            });
        let engine_version = head_result.as_ref().and_then(|result| {
            serde_json::from_str::<super::analysis::ResultManifest>(&result.manifest_json)
                .ok()
                .map(|manifest| manifest.engine_version)
                .filter(|version| !version.is_empty())
        });
        analysis_summaries.push(LidarAnalysisSummary {
            id: definition.id.clone(),
            generation_id: head_result.as_ref().map(|result| result.id.clone()),
            input_generation_id,
            source_layer_id: definition.layer_id.clone(),
            kind: parse_analysis_kind(&definition.kind)?,
            name: result_name,
            state,
            detail,
            bounds,
            value_range,
            slope_unit,
            method,
            engine_version,
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
        slope_engine,
    })
}

/// The latest import operation recorded for one item.
fn latest_import_job(
    connection: &Connection,
    layer_id: &str,
) -> Result<Option<common_types::lidar::LidarImportJob>, String> {
    use rusqlite::OptionalExtension as _;
    let job_id: Option<String> = connection
        .query_row(
            "SELECT id FROM lidar_import_jobs WHERE layer_id = ?1
             ORDER BY created_at DESC, rowid DESC LIMIT 1",
            [layer_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read the item's import: {e}"))?;
    match job_id {
        Some(job_id) => super::import_job_summary(connection, &job_id),
        None => Ok(None),
    }
}

/// The display range of a source generation.
///
/// The stored display columns are authoritative. A generation written before
/// they existed falls back to its exact range, which is what it was always
/// displayed with, and a generation with neither reports none rather than a
/// guess: styling then uses its own constant-domain handling.
fn display_range_of(
    head: &catalogue::GenerationRow,
) -> Option<common_types::lidar::LidarDisplayRange> {
    match (head.display_min_value, head.display_max_value) {
        (Some(min), Some(max)) => Some(common_types::lidar::LidarDisplayRange {
            min,
            max,
            basis: super::display_range_basis(head.display_basis.as_deref()),
        }),
        _ => match (head.min_value, head.max_value) {
            (Some(min), Some(max)) => Some(common_types::lidar::LidarDisplayRange {
                min,
                max,
                basis: common_types::lidar::LidarDisplayRangeBasis::Exact,
            }),
            _ => None,
        },
    }
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
        "failed" => LidarResultState::Failed,
        _ => LidarResultState::Ready,
    }
}
