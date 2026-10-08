//! One bounded numeric lookup for pixel inspection.
//!
//! Inspection answers "what is the physical value here?" without going through
//! the display path: it transforms the requested WGS84 point into the
//! generation's own grid, picks the containing native pixel, and reads the
//! composed value through the same resolver display and analysis use. It never
//! decodes a colourised tile, never interpolates between pixels, and never
//! returns a value from a generation the caller did not ask for.
//!
//! Sources and derived items are different storage contracts, so they are
//! resolved separately: a source is an ordered collection described by
//! `import::GenerationManifest`, while a derived item is described by
//! `analyses::DerivedManifest` and always reads through resolved chunks. Units
//! come from the item that owns the bytes: a derived item reports the units its
//! analysis recorded (a slope in percent is not an elevation in metres).

use std::sync::atomic::AtomicBool;

use common_types::library::LibraryItemRole;
use common_types::lidar::{LidarSampleOutcome, LidarSampleRequest, LidarSampleUnavailableReason};

use super::analyses;
use super::engine::RasterEngine;
use super::grid::RasterGrid;
use super::{LidarLibrary, catalogue, collection, generation, import};

/// Which reader serves a target's numbers.
enum TargetRead {
    /// Published result chunks of a derived item.
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
    crs_ref: String,
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
        LibraryItemRole::Source => {
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
                crs_ref: manifest.crs_ref.clone(),
                units,
                read,
            }))
        }
        LibraryItemRole::Derived => {
            // The item owns its result, so an item that no longer exists has no
            // generation to sample even if a row survived.
            let Some(item) = catalogue::get_derived_item(&connection, &request.entity_id)? else {
                return Ok(None);
            };
            let Some(row) = catalogue::derived_head(&connection, &request.entity_id)? else {
                return Ok(None);
            };
            let manifest = analyses::read_derived_manifest(&row.manifest_json)?;
            Ok(Some(SampleTarget {
                generation_id: row.id,
                grid: manifest.grid,
                crs_ref: manifest.crs_ref,
                units: item.units,
                read: TargetRead::Chunks,
            }))
        }
    }
}

/// Transform one WGS84 point into the generation's CRS through the engine.
///
/// A point the transform cannot place is `None`, which the caller reports as
/// a failed transform rather than an error.
fn transform_point(
    engine: &dyn RasterEngine,
    cancel: &AtomicBool,
    crs_ref: &str,
    longitude: f64,
    latitude: f64,
) -> Result<Option<(f64, f64)>, String> {
    if crs_ref.trim().is_empty() {
        return Ok(None);
    }
    Ok(engine
        .transform_points("EPSG:4326", crs_ref, &[(longitude, latitude)], cancel)?
        .into_iter()
        .next()
        .flatten())
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
    engine: &dyn RasterEngine,
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
        &target.crs_ref,
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
    /// Written here rather than read from the engine so the oracle cannot agree with a
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
    /// isolation. This one runs the engine's real transform and then selects
    /// the containing pixel from the projected point, so a wrong axis
    /// order, a swapped coordinate pair or an off-by-one in the row inversion
    /// would all surface here rather than passing as a plausible number. The
    /// grid is deliberately placed away from the equator: a transform that
    /// silently ignored latitude scaling would still land inside a
    /// Mercator-centred rectangle but not inside this one.
    #[test]
    fn the_real_transform_lands_in_the_expected_cell() {
        let engine = crate::services::lidar::rust_engine::RustRasterEngine;
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
}

/// Stream C's latency probe (canopi-f47t.42): row values sample every shown
/// row at one point, so one hover is one point over 6–8 targets.
///
/// Budget: p95 ≤ 50 ms per 6-target point when idle and ≤ 150 ms during an
/// import. Run with the two IGN 0.5 m MNT tiles of the live-check master
/// (copied, never read in place) and the pinned GeoLibre CLI:
/// `CANOPI_LIDAR_SAMPLER_FIXTURE_DIR=<dir> CANOPI_GEOLIBRE_BIN=<geolibre>
/// cargo test -p canopi-desktop --lib --release -- --ignored sampler_latency --nocapture`
#[cfg(test)]
mod latency_probe {
    use super::super::{LidarLibrary, analyses, import};
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};

    const POINTS: usize = 500;

    /// The fixture tiles, copied into `work` so the master stays untouched.
    fn copied_tiles(work: &Path) -> Vec<PathBuf> {
        let dir = std::env::var_os("CANOPI_LIDAR_SAMPLER_FIXTURE_DIR")
            .map(PathBuf::from)
            .expect("CANOPI_LIDAR_SAMPLER_FIXTURE_DIR names the IGN MNT tiles");
        let mut tiles: Vec<PathBuf> = std::fs::read_dir(&dir)
            .expect("the fixture dir reads")
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "tif"))
            .collect();
        tiles.sort();
        assert!(tiles.len() >= 2, "two adjacent tiles are needed");
        let copies = work.join("tiles");
        std::fs::create_dir_all(&copies).unwrap();
        tiles
            .iter()
            .take(2)
            .map(|tile| {
                let copy = copies.join(tile.file_name().unwrap());
                std::fs::copy(tile, &copy).expect("the tile copies");
                copy
            })
            .collect()
    }

    /// Splits one tile into its west and east halves, so two tiles make a
    /// 4-member collection with real member boundaries to cross.
    fn halves(engine: &dyn RasterEngine, tile: &Path, out: &Path) -> [PathBuf; 2] {
        let cancel = AtomicBool::new(false);
        let probe = engine.probe(tile, &cancel).expect("the tile probes");
        let values = engine
            .read_f32(tile, probe.width, probe.height, &cancel)
            .expect("the tile reads");
        let half = probe.width / 2;
        let stem = tile.file_stem().unwrap().to_string_lossy().to_string();
        let nodata = probe.nodata.unwrap_or(-99_999.0);
        [(0, half), (half, probe.width - half)].map(|(x0, width)| {
            let mut part = Vec::with_capacity((width * probe.height) as usize);
            for row in 0..probe.height {
                let start = (row * probe.width + x0) as usize;
                part.extend_from_slice(&values[start..start + width as usize]);
            }
            let mut geotransform = probe.geotransform;
            geotransform[0] += f64::from(x0) * geotransform[1];
            let grid = RasterGrid {
                width,
                height: probe.height,
                geotransform,
            };
            let path = out.join(format!("{stem}-{x0}.tif"));
            engine
                .write_geotiff(
                    &path,
                    super::super::engine::RasterGeoref {
                        grid: &grid,
                        crs: &probe.crs_ref,
                    },
                    nodata,
                    &part,
                    &cancel,
                )
                .expect("the half writes");
            path
        })
    }

    fn import_source(library: &LidarLibrary, name: &str, paths: &[PathBuf]) -> String {
        let layer = library
            .create_layer(
                name,
                common_types::library::RasterQuantity::GroundElevation,
                None,
                false,
            )
            .expect("layer created");
        let job = library.record_import_job(&layer).expect("job recorded");
        import::stage_and_publish(library, &job, &layer, paths, &AtomicBool::new(false))
            .expect("the source publishes");
        library.finish_import_sources(&job, Ok(()));
        layer
    }

    fn head(library: &LidarLibrary, kind: LibraryItemRole, id: &str) -> String {
        let connection = library.catalogue().unwrap();
        match kind {
            LibraryItemRole::Source => catalogue::head_generation(&connection, id)
                .unwrap()
                .map(|row| row.id),
            LibraryItemRole::Derived => catalogue::derived_head(&connection, id)
                .unwrap()
                .map(|row| row.id),
        }
        .expect("the item is published")
    }

    /// `POINTS` deterministic points over the two tiles, in WGS84.
    fn points(engine: &dyn RasterEngine, tile: &Path) -> Vec<(f64, f64)> {
        let cancel = AtomicBool::new(false);
        let probe = engine.probe(tile, &cancel).unwrap();
        let gt = probe.geotransform;
        let (width, height) = (
            2.0 * f64::from(probe.width) * gt[1],
            f64::from(probe.height) * gt[5].abs(),
        );
        let mut state = 0x2545_f491_4f6c_dd1d_u64;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 11) as f64 / (1u64 << 53) as f64
        };
        let projected: Vec<(f64, f64)> = (0..POINTS)
            .map(|_| (gt[0] + next() * width, gt[3] - next() * height))
            .collect();
        engine
            .transform_points(&probe.crs_ref, "EPSG:4326", &projected, &cancel)
            .unwrap()
            .into_iter()
            .map(|point| point.expect("every fixture point places"))
            .collect()
    }

    fn percentile(sorted: &[Duration], p: f64) -> Duration {
        let index = ((sorted.len() as f64 - 1.0) * p).round() as usize;
        sorted[index]
    }

    /// One 6-target point per entry, timed; returns the sorted durations and
    /// how many values were found.
    fn sample_all(
        library: &LidarLibrary,
        targets: &[(LibraryItemRole, String, String)],
        points: &[(f64, f64)],
    ) -> (Vec<Duration>, usize) {
        let cancel = AtomicBool::new(false);
        let mut found = 0;
        let mut durations: Vec<Duration> = points
            .iter()
            .enumerate()
            .map(|(index, &(longitude, latitude))| {
                let started = Instant::now();
                for (kind, entity_id, generation) in targets {
                    let outcome = sample(
                        library,
                        library.inner.engine.as_ref(),
                        &cancel,
                        &LidarSampleRequest {
                            kind: *kind,
                            entity_id: entity_id.clone(),
                            expected_generation_id: generation.clone(),
                            request_id: format!("probe-{index}"),
                            longitude,
                            latitude,
                        },
                    )
                    .expect("the sample reads");
                    if matches!(outcome, LidarSampleOutcome::Value { .. }) {
                        found += 1;
                    }
                }
                started.elapsed()
            })
            .collect();
        durations.sort();
        (durations, found)
    }

    fn report(label: &str, durations: &[Duration], found: usize) -> Duration {
        let p95 = percentile(durations, 0.95);
        println!(
            "{label}: {} points x 6 targets, {found} values; p50 {:?}, p95 {p95:?}, max {:?}",
            durations.len(),
            percentile(durations, 0.5),
            durations.last().unwrap()
        );
        p95
    }

    #[test]
    #[ignore = "requires the IGN MNT tiles (CANOPI_LIDAR_SAMPLER_FIXTURE_DIR) and the pinned GeoLibre CLI"]
    fn sampler_latency_over_six_targets_idle_and_during_an_import() {
        let work = crate::test_scratch::TestScratch::new("lidar-sampler-latency");
        let tiles = copied_tiles(&work);
        let library = LidarLibrary::open(&work.join("app")).expect("library opens");
        let engine = crate::services::lidar::rust_engine::RustRasterEngine;
        let parts = work.join("parts");
        std::fs::create_dir_all(&parts).unwrap();
        let members: Vec<PathBuf> = tiles
            .iter()
            .flat_map(|tile| halves(&engine, tile, &parts))
            .collect();

        let collection = import_source(&library, "four members", &members);
        let pair = import_source(&library, "two tiles", &tiles);
        let west = import_source(&library, "west tile", &tiles[..1]);
        let east = import_source(&library, "east tile", &tiles[1..]);
        let slope_collection =
            analyses::test_support::run_slope(&library, &collection, "degrees", None).item_ids[0]
                .clone();
        let slope_west =
            analyses::test_support::run_slope(&library, &west, "degrees", None).item_ids[0].clone();
        let targets: Vec<(LibraryItemRole, String, String)> = [
            (LibraryItemRole::Source, collection),
            (LibraryItemRole::Source, pair),
            (LibraryItemRole::Source, west),
            (LibraryItemRole::Source, east),
            (LibraryItemRole::Derived, slope_collection),
            (LibraryItemRole::Derived, slope_west),
        ]
        .into_iter()
        .map(|(kind, id)| {
            let generation = head(&library, kind, &id);
            (kind, id, generation)
        })
        .collect();
        let points = points(&engine, &tiles[0]);

        let (idle, found) = sample_all(&library, &targets, &points);
        let idle_p95 = report("idle", &idle, found);

        // The same points again while an import of both tiles runs, over and
        // over, until the sampling ends.
        let stop = Arc::new(AtomicBool::new(false));
        let importer = {
            let library = library.clone();
            let tiles = tiles.clone();
            let stop = stop.clone();
            std::thread::spawn(move || {
                let mut imports = 0;
                while !stop.load(Ordering::Relaxed) {
                    import_source(&library, "busy import", &tiles);
                    imports += 1;
                }
                imports
            })
        };
        // Let the import reach its heavy phase first.
        std::thread::sleep(Duration::from_millis(500));
        let (busy, found) = sample_all(&library, &targets, &points);
        stop.store(true, Ordering::Relaxed);
        let imports = importer.join().expect("the importer finishes");
        let busy_p95 = report(&format!("during {imports} import(s)"), &busy, found);

        assert!(
            idle_p95 <= Duration::from_millis(50),
            "idle p95 {idle_p95:?} is over the 50 ms budget"
        );
        assert!(
            busy_p95 <= Duration::from_millis(150),
            "p95 during an import {busy_p95:?} is over the 150 ms budget"
        );
    }
}
