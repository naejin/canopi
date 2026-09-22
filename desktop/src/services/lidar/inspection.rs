//! One bounded numeric lookup for pixel inspection.
//!
//! Inspection answers "what is the physical value here?" without going through
//! the display path: it transforms the requested WGS84 point into the
//! generation's own grid, picks the containing native pixel, and reads the
//! composed value through the same resolver display and analysis use. It never
//! decodes a colourised tile, never interpolates between pixels, and never
//! returns a value from a generation the caller did not ask for.

use std::sync::atomic::AtomicBool;

use common_types::lidar::{
    LidarSampleEntityKind, LidarSampleOutcome, LidarSampleRequest, LidarSampleUnavailableReason,
};

use super::engine::{GdalEngine, GdalProgram};
use super::grid::RasterGrid;
use super::{LidarLibrary, catalogue, collection, generation, import};

/// One analysis definition's own row, by definition id.
fn analysis_definition_layer(
    connection: &rusqlite::Connection,
    definition_id: &str,
) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension as _;
    let mut statement = connection
        .prepare("SELECT layer_id FROM lidar_analysis_definitions WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    statement
        .query_row([definition_id], |row| row.get::<_, String>(0))
        .optional()
        .map_err(|e| e.to_string())
}

/// The generation a request's entity currently resolves to, with everything a
/// bounded read needs.
struct SampleTarget {
    generation_id: String,
    grid: RasterGrid,
    manifest: import::GenerationManifest,
    units: String,
}

fn resolve_target(
    library: &LidarLibrary,
    request: &LidarSampleRequest,
) -> Result<Option<SampleTarget>, String> {
    let connection = library.catalogue()?;
    // Both head readers expose the same two facts this read needs, so only those
    // are carried forward.
    let (generation_id, manifest_json, layer_id) = match request.kind {
        LidarSampleEntityKind::Source => {
            let Some(row) = catalogue::head_generation(&connection, &request.entity_id)? else {
                return Ok(None);
            };
            (row.id, row.manifest_json, request.entity_id.clone())
        }
        LidarSampleEntityKind::Analysis => {
            let Some(layer_id) = analysis_definition_layer(&connection, &request.entity_id)? else {
                return Ok(None);
            };
            let Some(row) = catalogue::head_analysis_generation(&connection, &request.entity_id)?
            else {
                return Ok(None);
            };
            (row.id, row.manifest_json, layer_id)
        }
    };
    let manifest = import::read_generation_manifest(&manifest_json)?;
    // A result carries the units of the measurement it was derived from, so the
    // answer can state what the number means.
    let units = catalogue::get_layer(&connection, &layer_id)?
        .map(|layer| layer.units)
        .unwrap_or_default();
    Ok(Some(SampleTarget {
        generation_id,
        grid: manifest.grid.clone(),
        manifest,
        units,
    }))
}

/// Transform one WGS84 point into the generation's CRS through GDAL.
///
/// Uses the same bounded stdin/stdout contract as the display path, so the
/// transform shares its timeout, cancellation and output limits.
fn transform_point(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    crs_wkt: &str,
    longitude: f64,
    latitude: f64,
) -> Result<Option<(f64, f64)>, String> {
    if crs_wkt.trim().is_empty() {
        return Ok(None);
    }
    let input = format!("{longitude} {latitude}\n");
    let output = engine.run_with_input(
        GdalProgram::Transform,
        &[
            "-s_srs".to_string(),
            "EPSG:4326".to_string(),
            "-t_srs".to_string(),
            crs_wkt.to_string(),
        ],
        input.as_bytes(),
        Some(cancel),
    )?;
    let Some(line) = output.stdout.lines().next() else {
        return Ok(None);
    };
    let mut parts = line.split_whitespace();
    let (Some(x), Some(y)) = (parts.next(), parts.next()) else {
        return Ok(None);
    };
    let (Ok(x), Ok(y)) = (x.parse::<f64>(), y.parse::<f64>()) else {
        return Err(format!("gdaltransform produced an unreadable row: {line}"));
    };
    if !x.is_finite() || !y.is_finite() {
        return Ok(None);
    }
    Ok(Some((x, y)))
}

/// The containing native pixel of one projected point.
///
/// The grid is north-up and half-open: a point exactly on the right or bottom
/// edge belongs to the neighbouring pixel and is therefore outside this
/// generation, while a point on the top or left edge belongs to the first
/// pixel. `floor` on the fractional cell implements exactly that.
fn containing_pixel(grid: &RasterGrid, x: f64, y: f64) -> Option<(i64, i64)> {
    let gt = grid.geotransform;
    if gt[1] == 0.0 || gt[5] == 0.0 {
        return None;
    }
    let cell_x = (x - gt[0]) / gt[1];
    let cell_y = (y - gt[3]) / gt[5];
    if !cell_x.is_finite() || !cell_y.is_finite() {
        return None;
    }
    let pixel_x = cell_x.floor();
    let pixel_y = cell_y.floor();
    if pixel_x < 0.0
        || pixel_y < 0.0
        || pixel_x >= f64::from(grid.width)
        || pixel_y >= f64::from(grid.height)
    {
        return None;
    }
    Some((pixel_x as i64, pixel_y as i64))
}

/// Sample one physical value for inspection.
///
/// Returns `Unavailable(StaleGeneration)` when the entity's head is not the
/// generation the caller aimed at, so a late answer can never be presented as
/// current. A point outside the generation reads as `NoData`, matching the
/// product rule that out-of-coverage is no data rather than an error.
pub(super) fn sample(
    library: &LidarLibrary,
    engine: &GdalEngine,
    cancel: &AtomicBool,
    request: &LidarSampleRequest,
) -> Result<LidarSampleOutcome, String> {
    if !request.longitude.is_finite() || !request.latitude.is_finite() {
        return Ok(LidarSampleOutcome::Unavailable {
            reason: LidarSampleUnavailableReason::TransformFailed,
        });
    }
    let Some(target) = resolve_target(library, request)? else {
        return Ok(LidarSampleOutcome::Unavailable {
            reason: LidarSampleUnavailableReason::MissingGeneration,
        });
    };
    // Currency is checked against the generation the read will actually use, not
    // against a cached head: a reorder, undo or refresh between aim and answer
    // makes the answer stale rather than wrong.
    if target.generation_id != request.expected_generation_id {
        return Ok(LidarSampleOutcome::Unavailable {
            reason: LidarSampleUnavailableReason::StaleGeneration,
        });
    }
    // A preserved dense generation has no ordered occurrence to resolve through,
    // so inspection reports it as unsupported rather than guessing at its bytes.
    if target.manifest.format == import::GenerationStorageFormat::LegacyDenseV1 {
        return Ok(LidarSampleOutcome::Unavailable {
            reason: LidarSampleUnavailableReason::UnsupportedInput,
        });
    }
    let projected = transform_point(
        engine,
        cancel,
        &target.manifest.crs_wkt,
        request.longitude,
        request.latitude,
    )?;
    let Some((x, y)) = projected else {
        return Ok(LidarSampleOutcome::Unavailable {
            reason: LidarSampleUnavailableReason::TransformFailed,
        });
    };
    // Out of coverage is NoData, not an error: the point simply holds nothing.
    let Some((pixel_x, pixel_y)) = containing_pixel(&target.grid, x, y) else {
        return Ok(LidarSampleOutcome::NoData {
            generation_id: target.generation_id,
        });
    };

    let window = generation::LatticeWindow {
        x: pixel_x,
        y: pixel_y,
        width: 1,
        height: 1,
    };
    let bounds = collection::ReadBounds {
        x0: window.x,
        y0: window.y,
        x1: window.x + 1,
        y1: window.y + 1,
    };
    let Some(reader) = collection::load_reader_within(
        library,
        &target.generation_id,
        &target.manifest,
        Some(bounds),
        cancel,
    )?
    else {
        return Ok(LidarSampleOutcome::Unavailable {
            reason: LidarSampleUnavailableReason::MissingGeneration,
        });
    };
    let resolved = reader.read_window(window, cancel)?;
    if resolved.valid.first().copied().unwrap_or(0) == 0 {
        return Ok(LidarSampleOutcome::NoData {
            generation_id: target.generation_id,
        });
    }
    let value = f64::from(resolved.samples.first().copied().unwrap_or(f32::NAN));
    if !value.is_finite() {
        return Ok(LidarSampleOutcome::NoData {
            generation_id: target.generation_id,
        });
    }
    Ok(LidarSampleOutcome::Value {
        generation_id: target.generation_id,
        value,
        units: target.units,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid() -> RasterGrid {
        RasterGrid {
            width: 10,
            height: 10,
            geotransform: [0.0, 1.0, 0.0, 10.0, 0.0, -1.0],
        }
    }

    #[test]
    fn the_containing_pixel_is_half_open_at_the_far_edges() {
        let grid = grid();
        // The top-left corner belongs to the first pixel.
        assert_eq!(containing_pixel(&grid, 0.0, 10.0), Some((0, 0)));
        // A point inside the first pixel's own span.
        assert_eq!(containing_pixel(&grid, 0.5, 9.5), Some((0, 0)));
        // The last included pixel.
        assert_eq!(containing_pixel(&grid, 9.999, 0.001), Some((9, 9)));
        // The right and bottom edges are excluded, not clamped into the grid.
        assert_eq!(containing_pixel(&grid, 10.0, 5.0), None);
        assert_eq!(containing_pixel(&grid, 5.0, 0.0), None);
        // Outside entirely.
        assert_eq!(containing_pixel(&grid, -0.001, 5.0), None);
        assert_eq!(containing_pixel(&grid, 5.0, 10.001), None);
    }

    #[test]
    fn a_degenerate_grid_has_no_containing_pixel() {
        let mut broken = grid();
        broken.geotransform[1] = 0.0;
        assert_eq!(containing_pixel(&broken, 1.0, 1.0), None);
        let mut broken = grid();
        broken.geotransform[5] = 0.0;
        assert_eq!(containing_pixel(&broken, 1.0, 1.0), None);
    }
}
