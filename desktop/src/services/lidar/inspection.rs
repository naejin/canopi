//! One bounded numeric lookup for pixel inspection.
//!
//! Inspection answers "what is the physical value here?" without going through
//! the display path: it transforms the requested WGS84 point into the
//! generation's own grid, picks the containing native pixel, and reads the
//! composed value through the same resolver display and analysis use. It never
//! decodes a colourised tile, never interpolates between pixels, and never
//! returns a value from a generation the caller did not ask for.
//!
//! Source layers and analysis results are different storage contracts, so they
//! are resolved separately: a source is an ordered collection or a published
//! chunk store described by `import::GenerationManifest`, while a result is
//! described by `analysis::ResultManifest` and always reads through resolved
//! chunks. Units come from whichever contract owns the bytes — a result reports
//! its own degrees/percent choice rather than the source layer's unit string.

use std::sync::atomic::AtomicBool;

use common_types::lidar::{
    LidarSampleEntityKind, LidarSampleOutcome, LidarSampleRequest, LidarSampleUnavailableReason,
    LidarSlopeUnit,
};

use super::analysis;
use super::engine::{GdalEngine, GdalProgram};
use super::grid::RasterGrid;
use super::{LidarLibrary, catalogue, collection, generation, import};

/// The label of a slope result computed in degrees.
const DEGREES_UNIT: &str = "°";
/// The label of a slope result computed in percent.
const PERCENT_UNIT: &str = "%";

/// The unit label a slope result is sampled in.
fn result_units(unit: LidarSlopeUnit) -> &'static str {
    match unit {
        LidarSlopeUnit::Degrees => DEGREES_UNIT,
        LidarSlopeUnit::Percent => PERCENT_UNIT,
    }
}

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

/// Which reader serves a target's numbers.
enum TargetRead {
    /// Published result chunks of an analysis result.
    Chunks,
    /// An ordered source collection, resolved on demand from its members.
    Collection(Box<import::GenerationManifest>),
}

/// The generation a request's entity currently resolves to, with everything a
/// bounded read needs and nothing that opens a raster yet.
struct SampleTarget {
    generation_id: String,
    /// The lattice the target's cells are addressed in.
    grid: RasterGrid,
    crs_wkt: String,
    /// What one returned number means, in the target's own terms.
    units: String,
    read: TargetRead,
}

/// Resolve the requested entity's current head.
///
/// Source and result targets share only the currency rule; their manifests, unit
/// sources and readers differ, so each is resolved on its own contract rather
/// than being forced through one shape.
fn resolve_target(
    library: &LidarLibrary,
    request: &LidarSampleRequest,
) -> Result<Option<SampleTarget>, String> {
    let connection = library.catalogue()?;
    match request.kind {
        LidarSampleEntityKind::Source => {
            let Some(row) = catalogue::head_generation(&connection, &request.entity_id)? else {
                return Ok(None);
            };
            // A source layer's own declared unit is what its numbers mean.
            let units = catalogue::get_layer(&connection, &request.entity_id)?
                .map(|layer| layer.units)
                .unwrap_or_default();
            let manifest = import::read_generation_manifest(&row.manifest_json)?;
            let read = TargetRead::Collection(Box::new(manifest.clone()));
            Ok(Some(SampleTarget {
                generation_id: row.id,
                grid: manifest.grid.clone(),
                crs_wkt: manifest.crs_wkt.clone(),
                units,
                read,
            }))
        }
        LidarSampleEntityKind::Analysis => {
            // The definition owns the result, so a definition that no longer
            // exists has no generation to sample even if a row survived.
            if analysis_definition_layer(&connection, &request.entity_id)?.is_none() {
                return Ok(None);
            }
            let Some(row) = catalogue::head_analysis_generation(&connection, &request.entity_id)?
            else {
                return Ok(None);
            };
            let manifest: analysis::ResultManifest = serde_json::from_str(&row.manifest_json)
                .map_err(|e| format!("Invalid analysis manifest: {e}"))?;
            // A result reports the measurement it was computed in, not the unit
            // string of the layer it was derived from: a slope in percent is not
            // a source elevation in metres.
            let units = result_units(manifest.parameters.slope_unit).to_string();
            Ok(Some(SampleTarget {
                generation_id: row.id,
                grid: manifest.grid.clone(),
                crs_wkt: manifest.crs_wkt.clone(),
                units,
                read: TargetRead::Chunks,
            }))
        }
    }
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

/// The largest lattice index this read will carry into a window.
///
/// Far below `i64::MAX` so a one-cell window's end cannot overflow, and inside
/// the range where `f64` still represents consecutive integers. It is a
/// representability guard, not a coverage rule: the lattice origin is not the
/// composition's extent.
const MAX_LATTICE_INDEX: f64 = 9.0e15;

/// The containing native pixel of one projected point.
///
/// The grid is north-up and half-open: a point exactly on the right or bottom
/// edge belongs to the neighbouring pixel, while a point on the top or left
/// edge belongs to the first pixel. `floor` on the fractional cell implements
/// exactly that.
///
/// The result is a **signed lattice coordinate**. An ordered collection keeps
/// its lattice origin while members added later extend beyond the first
/// source's rectangle, negative cell coordinates included, so clipping to
/// `grid.width`/`grid.height` would report NoData for coverage the display and
/// the readers both serve. Whether the addressed cell holds a valid sample is
/// the reader's answer.
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
    if pixel_x.abs() > MAX_LATTICE_INDEX || pixel_y.abs() > MAX_LATTICE_INDEX {
        return None;
    }
    Some((pixel_x as i64, pixel_y as i64))
}

/// Bind the reader that owns one target's numbers, limited to one cell.
///
/// A source item resolves only the ordered members that can reach the cell; a
/// result reads its published chunks.
fn read_one_cell(
    library: &LidarLibrary,
    target: &SampleTarget,
    pixel: (i64, i64),
    cancel: &AtomicBool,
) -> Result<Option<generation::GenerationReader>, String> {
    let window = cell_window(pixel)?;
    match &target.read {
        TargetRead::Chunks => Ok(Some(generation::GenerationReader::Chunks(
            generation::GenerationChunkReader::new(&target.generation_id, generation::RESULT_ROLE),
        ))),
        TargetRead::Collection(manifest) => {
            let bounds = collection::ReadBounds {
                x0: window.x,
                y0: window.y,
                x1: window
                    .x
                    .checked_add(1)
                    .ok_or_else(|| "inspection window overflows".to_string())?,
                y1: window
                    .y
                    .checked_add(1)
                    .ok_or_else(|| "inspection window overflows".to_string())?,
            };
            let reader = collection::load_reader_within(
                library,
                &target.generation_id,
                manifest,
                Some(bounds),
                cancel,
            )?;
            Ok(Some(generation::GenerationReader::Collection(Box::new(
                reader,
            ))))
        }
    }
}

/// A one-cell window at a signed lattice coordinate.
fn cell_window(pixel: (i64, i64)) -> Result<generation::LatticeWindow, String> {
    // Reject the two coordinates whose own successor is not representable, so
    // the half-open window below can never wrap.
    if pixel.0 == i64::MAX || pixel.1 == i64::MAX {
        return Err("inspection coordinate is not representable".to_string());
    }
    Ok(generation::LatticeWindow {
        x: pixel.0,
        y: pixel.1,
        width: 1,
        height: 1,
    })
}

/// Sample one physical value for inspection.
///
/// Returns `Unavailable(StaleGeneration)` when the entity's head is not the
/// generation the caller aimed at, so a late answer can never be presented as
/// current. A point that reaches no valid member reads as `NoData`, matching the
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
    // against a cached head: a head that changed (or went away) between aim and
    // answer makes the answer stale rather than wrong.
    if target.generation_id != request.expected_generation_id {
        return Ok(LidarSampleOutcome::Unavailable {
            reason: LidarSampleUnavailableReason::StaleGeneration,
        });
    }
    #[cfg(test)]
    super::acceptance_hooks::after_target(library);
    let Some((x, y)) = transform_point(
        engine,
        cancel,
        &target.crs_wkt,
        request.longitude,
        request.latitude,
    )?
    else {
        return Ok(LidarSampleOutcome::Unavailable {
            reason: LidarSampleUnavailableReason::TransformFailed,
        });
    };
    // Out of every member's coverage is NoData, not an error: the point simply
    // holds nothing. The reader decides that, not the lattice rectangle.
    let Some(pixel) = containing_pixel(&target.grid, x, y) else {
        // Every successful Value/NoData exit rechecks currency, including this
        // early unrepresentable-index branch after the slow transform.
        return finish_sample_outcome(
            library,
            request,
            &target.generation_id,
            LidarSampleOutcome::NoData {
                generation_id: target.generation_id.clone(),
            },
        );
    };
    let window = cell_window(pixel)?;
    let Some(reader) = read_one_cell(library, &target, pixel, cancel)? else {
        return Ok(LidarSampleOutcome::Unavailable {
            reason: LidarSampleUnavailableReason::MissingGeneration,
        });
    };
    let resolved = reader.read_window(library, &target.grid, window, cancel)?;
    #[cfg(test)]
    super::acceptance_hooks::after_read(library);
    // Recheck currency after the slow read without holding the catalogue
    // across it: a concurrent head change makes Value/NoData stale before
    // delivery, and a disappeared target is missing rather than a stale success.
    match resolve_target(library, request)? {
        None => {
            return Ok(LidarSampleOutcome::Unavailable {
                reason: LidarSampleUnavailableReason::MissingGeneration,
            });
        }
        Some(current) => {
            if current.generation_id != request.expected_generation_id
                || current.generation_id != target.generation_id
            {
                return Ok(LidarSampleOutcome::Unavailable {
                    reason: LidarSampleUnavailableReason::StaleGeneration,
                });
            }
        }
    }
    if resolved.valid.first().copied().unwrap_or(0) == 0 {
        return finish_sample_outcome(
            library,
            request,
            &target.generation_id,
            LidarSampleOutcome::NoData {
                generation_id: target.generation_id.clone(),
            },
        );
    }
    let value = f64::from(resolved.samples.first().copied().unwrap_or(f32::NAN));
    if !value.is_finite() {
        return finish_sample_outcome(
            library,
            request,
            &target.generation_id,
            LidarSampleOutcome::NoData {
                generation_id: target.generation_id.clone(),
            },
        );
    }
    finish_sample_outcome(
        library,
        request,
        &target.generation_id,
        LidarSampleOutcome::Value {
            generation_id: target.generation_id.clone(),
            value,
            units: target.units.clone(),
        },
    )
}

/// Recheck currency before any successful Value/NoData delivery.
fn finish_sample_outcome(
    library: &LidarLibrary,
    request: &LidarSampleRequest,
    read_generation_id: &str,
    outcome: LidarSampleOutcome,
) -> Result<LidarSampleOutcome, String> {
    match resolve_target(library, request)? {
        None => Ok(LidarSampleOutcome::Unavailable {
            reason: LidarSampleUnavailableReason::MissingGeneration,
        }),
        Some(current) => {
            if current.generation_id != request.expected_generation_id
                || current.generation_id != read_generation_id
            {
                Ok(LidarSampleOutcome::Unavailable {
                    reason: LidarSampleUnavailableReason::StaleGeneration,
                })
            } else {
                Ok(outcome)
            }
        }
    }
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

    /// Web Mercator, derived independently of the engine.
    ///
    /// Written here rather than read from GDAL so the oracle cannot agree with a
    /// broken transform by sharing its source. The formula is the published one:
    /// `x = R * lambda`, `y = R * ln(tan(pi/4 + phi/2))` with the ellipsoid
    /// replaced by the sphere Web Mercator actually uses.
    fn web_mercator(longitude: f64, latitude: f64) -> (f64, f64) {
        const R: f64 = 6_378_137.0;
        let lambda = longitude.to_radians();
        let phi = latitude.to_radians();
        (
            R * lambda,
            R * (std::f64::consts::FRAC_PI_4 + phi / 2.0).tan().ln(),
        )
    }

    /// The real transform and the real pixel selection, against an independent
    /// oracle, at a non-equatorial latitude.
    ///
    /// The other tests in this module exercise the half-open convention in
    /// isolation. This one runs the actual `gdaltransform` call and then selects
    /// the containing pixel from the projected point, so a wrong `-t_srs` axis
    /// order, a swapped coordinate pair or an off-by-one in the row inversion
    /// would all surface here rather than passing as a plausible number. The
    /// grid is deliberately placed away from the equator: a transform that
    /// silently ignored latitude scaling would still land inside a
    /// Mercator-centred rectangle but not inside this one.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn the_real_transform_lands_in_the_expected_cell() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        // A 250-metre Web Mercator grid whose north-west corner is the
        // projection of (-0.6°, 48.9°), north and west of every sample below, so
        // every expected coordinate is derived from the oracle rather than from
        // the grid and every sample lands in the interior.
        let (origin_x, origin_y) = web_mercator(-0.6, 48.9);
        let cell = 250.0;
        let grid = RasterGrid {
            width: 1000,
            height: 1000,
            geotransform: [origin_x, cell, 0.0, origin_y, 0.0, -cell],
        };

        for (longitude, latitude) in [(0.2, 48.75), (0.0, 48.5), (-0.3, 48.2)] {
            let (projected_x, projected_y) = web_mercator(longitude, latitude);
            let expected_column = ((projected_x - origin_x) / cell).floor();
            let expected_row = ((projected_y - origin_y) / -cell).floor();
            assert!(
                (0.0..1000.0).contains(&expected_column) && (0.0..1000.0).contains(&expected_row),
                "the fixture must place ({longitude}, {latitude}) inside the grid"
            );

            let projected = transform_point(&engine, &cancel, "EPSG:3857", longitude, latitude)
                .expect("the transform runs")
                .expect("a finite WGS84 point projects");
            // A metre is far below the assertions that follow, and the two
            // implementations differ only by floating-point rounding.
            assert!(
                (projected.0 - projected_x).abs() < 1.0,
                "x for ({longitude}, {latitude}): {} vs oracle {projected_x}",
                projected.0
            );
            assert!(
                (projected.1 - projected_y).abs() < 1.0,
                "y for ({longitude}, {latitude}): {} vs oracle {projected_y}",
                projected.1
            );
            assert_eq!(
                containing_pixel(&grid, projected.0, projected.1),
                Some((expected_column as i64, expected_row as i64)),
                "cell for ({longitude}, {latitude})"
            );
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
        // The right and bottom edges belong to the neighbouring cell, which this
        // lattice does not cover, rather than being clamped into the last one.
        // The grid's north-west corner is (0, 10) with a -1 y resolution, so the
        // row index is `10 - y` and the bottom edge is row 10.
        assert_eq!(containing_pixel(&grid, 10.0, 5.0), Some((10, 5)));
        assert_eq!(containing_pixel(&grid, 5.0, 0.0), Some((5, 10)));
        assert_eq!(containing_pixel(&grid, -0.001, 5.0), Some((-1, 5)));
    }

    /// The lattice rectangle is not the composition's extent.
    ///
    /// An ordered collection keeps its original lattice while members appended
    /// later reach outside the first source's rectangle, negative indices
    /// included. Clipping here reported NoData for coverage the display and the
    /// readers both serve, so the index is returned and the reader answers
    /// coverage.
    #[test]
    fn cells_beyond_the_lattice_rectangle_keep_their_signed_coordinate() {
        let grid = grid();
        for (x, y, expected) in [
            (-4.5, 5.5, (-5, 4)),
            (25.5, 5.5, (25, 4)),
            (5.5, -12.25, (5, 22)),
            (-1000.5, -1000.5, (-1001, 1010)),
        ] {
            assert_eq!(
                containing_pixel(&grid, x, y),
                Some(expected),
                "point ({x}, {y})"
            );
        }
    }

    /// An index the window arithmetic cannot carry is refused, not wrapped.
    #[test]
    fn an_unrepresentable_lattice_index_is_refused() {
        let grid = grid();
        assert_eq!(containing_pixel(&grid, 1.0e18, 0.0), None);
        assert_eq!(containing_pixel(&grid, 0.0, -1.0e18), None);
        // Just inside the guard still yields a usable signed coordinate.
        assert!(containing_pixel(&grid, 1.0e15, 5.0).is_some());
        assert!(cell_window((i64::MAX, 0)).is_err());
        assert!(cell_window((i64::MIN, i64::MIN)).is_ok());
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

    /// A result's unit is its own parameter, not its source layer's.
    #[test]
    fn a_slope_result_reports_the_unit_it_was_computed_in() {
        assert_eq!(result_units(LidarSlopeUnit::Degrees), DEGREES_UNIT);
        assert_eq!(result_units(LidarSlopeUnit::Percent), PERCENT_UNIT);
    }
}
