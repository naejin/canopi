//! Library-side presentation snapshots for IPC consumers.
//!
//! The snapshot reports every item with its role, type, status and current
//! generation; derived items add provenance, their latest run and whether they
//! are out of date, and every item lists the analyses it can feed. The map
//! draws each generation through its display descriptor. Document-side
//! visibility, opacity and order live in `.canopi` via the Design Edit seam;
//! the library never reads documents.

use super::analyses::{self, FreshnessCheck, ItemFacts};
use super::catalogue;
use super::engine::GdalEngine;
use super::geolibre::GeolibreTool;
use common_types::library::{
    AnalysisRunStatus, Freshness, LibraryEngines, LibraryItemRole, LibraryItemSummary,
    LibraryItemType, LibrarySnapshot, Provenance,
};
use common_types::lidar::{LidarEngineStatus, LidarResultState};
use rusqlite::Connection;

pub fn library_snapshot(
    connection: &Connection,
    engine: &GdalEngine,
    geolibre: &Result<GeolibreTool, String>,
) -> Result<LibrarySnapshot, String> {
    let mut items = Vec::new();
    for layer in catalogue::list_layers(connection)? {
        let head = catalogue::head_generation(connection, &layer.id)?;
        let (coverage_cells, display_range, resolution_m, bounds, value_range) = match &head {
            Some(head) => {
                let manifest = super::import::read_generation_manifest(&head.manifest_json).ok();
                (
                    head.coverage_cells.map(|cells| cells.max(0) as u64),
                    display_range_of(head),
                    manifest
                        .as_ref()
                        .map(|manifest| manifest.grid.pixel_size().0),
                    wgs84_bounds(&head.bounds_3857),
                    value_range(head.min_value, head.max_value),
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
        let item_type = LibraryItemType::Raster {
            quantity: analyses::parse_quantity(&layer.quantity)?,
        };
        let facts = ItemFacts {
            item_type,
            units: layer.units.clone(),
            head: head
                .as_ref()
                .map(|head| (head.id.clone(), head.crs_class.clone())),
        };
        items.push(LibraryItemSummary {
            id: layer.id.clone(),
            name: Some(layer.name),
            role: LibraryItemRole::Source,
            item_type,
            units: layer.units,
            state,
            generation_id: head.as_ref().map(|head| head.id.clone()),
            bounds,
            value_range,
            display_range,
            resolution_m,
            coverage_cells,
            import_job,
            provenance: None,
            freshness: Freshness::Current,
            run: None,
            offers: analyses::offers(&facts, geolibre),
            dependents: dependents(connection, &layer.id)?,
        });
    }

    let mut freshness = FreshnessCheck::new(connection, geolibre);
    for item in catalogue::list_derived_items(connection)? {
        let head = catalogue::derived_head(connection, &item.id)?;
        let latest = catalogue::latest_analysis_job(connection, &item.definition_id)?;
        let definition = catalogue::get_definition(connection, &item.definition_id)?
            .ok_or_else(|| format!("derived item {} has no definition", item.id))?;
        // A published result stays Ready while a refresh runs; the run says
        // so. Without a result the item is its operation: preparing while its
        // job runs, failed otherwise.
        let state = match (&head, latest.as_ref().map(|job| job.state.as_str())) {
            (Some(_), _) => LidarResultState::Ready,
            (None, Some("preparing")) => LidarResultState::Preparing,
            (None, _) => LidarResultState::Failed,
        };
        // Provenance describes the run that produced the current result, or
        // the latest run before there is one.
        let produced_by = match &head {
            Some(head) => catalogue::get_analysis_job(connection, &head.job_id)?,
            None => latest.clone(),
        };
        let provenance = match produced_by {
            Some(job) => Some(Provenance {
                definition_id: definition.id.clone(),
                analysis_id: definition.analysis_id.clone(),
                recipe_version: u32::try_from(job.recipe_version).unwrap_or(0),
                output_key: item.output_key.clone(),
                inputs: analyses::parse_pinned_inputs(&job.input_generations_json)?,
                parameters: analyses::parse_parameters(&definition.parameters_json)?,
                tool: analyses::parse_tool(job.tool_provenance.as_deref()),
                job_id: job.id,
                created_at: job.created_at,
            }),
            None => None,
        };
        let item_type = LibraryItemType::Raster {
            quantity: analyses::parse_quantity(&item.quantity)?,
        };
        let facts = ItemFacts {
            item_type,
            units: item.units.clone(),
            head: head
                .as_ref()
                .map(|head| (head.id.clone(), head.crs_class.clone())),
        };
        let range = head
            .as_ref()
            .and_then(|head| value_range(head.min_value, head.max_value));
        items.push(LibraryItemSummary {
            id: item.id.clone(),
            name: item.name.clone(),
            role: LibraryItemRole::Derived,
            item_type,
            units: item.units.clone(),
            state,
            generation_id: head.as_ref().map(|head| head.id.clone()),
            bounds: head
                .as_ref()
                .and_then(|head| wgs84_bounds(&head.bounds_3857)),
            value_range: range,
            display_range: range.map(|[min, max]| common_types::lidar::LidarDisplayRange {
                min,
                max,
                basis: common_types::lidar::LidarDisplayRangeBasis::Exact,
            }),
            resolution_m: head
                .as_ref()
                .and_then(|head| analyses::read_derived_manifest(&head.manifest_json).ok())
                .map(|manifest| manifest.grid.pixel_size().0),
            coverage_cells: head
                .as_ref()
                .and_then(|head| head.coverage_cells)
                .map(|cells| cells.max(0) as u64),
            import_job: None,
            provenance,
            freshness: freshness.of(&item.id)?,
            run: latest.map(|job| AnalysisRunStatus {
                state: analyses::parse_job_state(&job.state),
                message: job.message,
                job_id: job.id,
            }),
            offers: analyses::offers(&facts, geolibre),
            dependents: dependents(connection, &item.id)?,
        });
    }

    Ok(LibrarySnapshot {
        items,
        engines: LibraryEngines {
            gdal: match engine.discover() {
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
            },
            geolibre: match geolibre {
                Ok(tool) => LidarEngineStatus {
                    available: true,
                    version: Some(analyses::tool_label(&tool.provenance(Vec::new()))),
                    detail: None,
                },
                Err(error) => LidarEngineStatus {
                    available: false,
                    version: None,
                    detail: Some(error.clone()),
                },
            },
        },
    })
}

fn dependents(connection: &Connection, item_id: &str) -> Result<u32, String> {
    Ok(u32::try_from(catalogue::dependent_items(connection, item_id)?.len()).unwrap_or(u32::MAX))
}

fn wgs84_bounds(bounds_3857: &str) -> Option<[f64; 4]> {
    serde_json::from_str::<Vec<f64>>(bounds_3857)
        .ok()
        .and_then(|v| <[f64; 4]>::try_from(v).ok())
        .map(bounds_3857_to_wgs84)
}

fn value_range(min: Option<f64>, max: Option<f64>) -> Option<[f64; 2]> {
    match (min, max) {
        (Some(min), Some(max)) => Some([min, max]),
        _ => None,
    }
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
