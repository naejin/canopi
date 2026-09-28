//! The pure-Rust raster engine (ADR 0014).
//!
//! In-process reading, conversion, statistics and reprojection on the
//! `whitebox_next_gen` crates: `wbgeotiff` for TIFF/COG primitives,
//! `wbraster` for the other raster formats and `wbprojection` for
//! coordinate reference systems. Nothing is bundled or discovered at run
//! time; the engine is always available and its version names the crates.
//!
//! Memory: every conversion holds one Float32 band and, for the display
//! profile, its overview cascade. The library's capacity limit
//! (`import::MAX_RAW_EXTRACTION_CELLS`) is checked before any band is loaded,
//! with the same named reason every whole-raster read gives. Cancellation is
//! honoured between strips, tiles and levels.

mod cog;
#[cfg(test)]
mod comparison;
mod crs;
mod laea;
mod source;
mod swiss;
mod tiff;

#[cfg(test)]
use super::engine::RasterStatistics;
use super::engine::{
    RasterEngine, RasterGeoref, RasterInput, RasterProbe, bounds_of, check_cancel, grid_corners,
};
use super::grid::RasterGrid;
use super::import::validate_working_grid;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use wbgeotiff::tags::Compression;

/// The crate versions this build compiles in; `tests` pins them to `Cargo.lock`.
pub(super) const WBGEOTIFF_VERSION: &str = "0.1.2";
pub(super) const WBGEOTIFF_REVISION: &str = "9c0ff4fdf3513f27b89c78e294610c3b418b3a4f";
pub(super) const WBPROJECTION_VERSION: &str = "0.3.3";
pub(super) const WBRASTER_VERSION: &str = "0.2.1";

/// What a manifest records as the engine that produced a numeric output.
pub(super) fn engine_version() -> String {
    format!(
        "canopi-raster-engine (wbgeotiff {WBGEOTIFF_VERSION}@{}, wbprojection {WBPROJECTION_VERSION}, wbraster {WBRASTER_VERSION})",
        &WBGEOTIFF_REVISION[..7]
    )
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RustRasterEngine;

/// A band ready to be written: its placement, CRS and validity rule.
struct Prepared {
    grid: RasterGrid,
    crs: crs::ResolvedCrs,
    nodata: Option<f32>,
    samples: Vec<f32>,
}

impl RustRasterEngine {
    fn prepare(
        input: RasterInput<'_>,
        georef: Option<RasterGeoref<'_>>,
        nodata: Option<f32>,
        operation: &str,
        cancel: &AtomicBool,
    ) -> Result<Prepared, String> {
        check_cancel(cancel)?;
        match input {
            RasterInput::Samples { grid, values } => {
                let georef = georef
                    .ok_or_else(|| "samples need a georeference to become a raster".to_string())?;
                if georef.grid != grid {
                    return Err("the samples' grid and their georeference disagree".to_string());
                }
                validate_working_grid(grid, operation)?;
                let cells = usize::try_from(u64::from(grid.width) * u64::from(grid.height))
                    .map_err(|_| "raster is too large for this platform".to_string())?;
                if values.len() != cells {
                    return Err(format!(
                        "{} samples do not fill a {}x{} grid",
                        values.len(),
                        grid.width,
                        grid.height
                    ));
                }
                Ok(Prepared {
                    grid: grid.clone(),
                    crs: crs::from_reference(georef.crs)?,
                    nodata,
                    samples: values.to_vec(),
                })
            }
            RasterInput::File(path) => {
                let loaded = source::load(path, operation, cancel)?;
                check_cancel(cancel)?;
                let (grid, crs) = match georef {
                    Some(georef) => {
                        if georef.grid.width != loaded.grid.width
                            || georef.grid.height != loaded.grid.height
                        {
                            return Err(format!(
                                "the georeference is {}x{} but {} is {}x{}",
                                georef.grid.width,
                                georef.grid.height,
                                path.display(),
                                loaded.grid.width,
                                loaded.grid.height
                            ));
                        }
                        (georef.grid.clone(), crs::from_reference(georef.crs)?)
                    }
                    None => {
                        let crs = loaded.crs.ok_or_else(|| {
                            format!(
                                "{} has no coordinate system; Canopi requires a horizontal CRS",
                                path.display()
                            )
                        })?;
                        (loaded.grid, crs)
                    }
                };
                Ok(Prepared {
                    grid,
                    crs,
                    nodata: nodata.or(loaded.nodata),
                    samples: loaded.samples,
                })
            }
        }
    }

    fn write(
        prepared: &Prepared,
        output: &Path,
        profile: cog::CogProfile,
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        let geo_keys = crs::geokeys_for(&prepared.crs)?;
        cog::write(
            output,
            cog::CogGeoref {
                grid: &prepared.grid,
                geo_keys: Some(&geo_keys),
            },
            prepared.nodata,
            &prepared.samples,
            profile,
            cancel,
        )
    }
}

impl RasterEngine for RustRasterEngine {
    fn version(&self) -> Result<String, String> {
        Ok(engine_version())
    }

    fn probe(&self, raster: &Path, cancel: &AtomicBool) -> Result<RasterProbe, String> {
        check_cancel(cancel)?;
        source::probe(raster)
    }

    #[cfg(test)]
    fn statistics(&self, raster: &Path, cancel: &AtomicBool) -> Result<RasterStatistics, String> {
        let loaded = source::load(raster, "raster statistics", cancel)?;
        check_cancel(cancel)?;
        let valid =
            |value: &f32| value.is_finite() && loaded.nodata.is_none_or(|marker| *value != marker);
        let mut minimum = f64::INFINITY;
        let mut maximum = f64::NEG_INFINITY;
        let mut sum = 0f64;
        let mut count = 0u64;
        for value in loaded.samples.iter().filter(|value| valid(value)) {
            let value = f64::from(*value);
            minimum = minimum.min(value);
            maximum = maximum.max(value);
            sum += value;
            count += 1;
        }
        if count == 0 {
            return Ok(RasterStatistics {
                minimum: 0.0,
                maximum: 0.0,
                mean: 0.0,
                std_dev: 0.0,
                valid_percent: 0.0,
            });
        }
        let mean = sum / count as f64;
        let squares: f64 = loaded
            .samples
            .iter()
            .filter(|value| valid(value))
            .map(|value| (f64::from(*value) - mean).powi(2))
            .sum();
        Ok(RasterStatistics {
            minimum,
            maximum,
            mean,
            std_dev: (squares / count as f64).sqrt(),
            valid_percent: count as f64 * 100.0 / loaded.samples.len() as f64,
        })
    }

    fn wgs84_extent(&self, raster: &Path, cancel: &AtomicBool) -> Result<[f64; 4], String> {
        let probe = self.probe(raster, cancel)?;
        if probe.crs_wkt.is_empty() {
            return Err("the raster has no geographic extent".to_string());
        }
        let placed = self.transform_points(
            &probe.crs_wkt,
            "EPSG:4326",
            &grid_corners(&source::grid_of(&probe)),
            cancel,
        )?;
        bounds_of(&placed).ok_or_else(|| "the raster has no geographic extent".to_string())
    }

    fn read_f32(
        &self,
        raster: &Path,
        width: u32,
        height: u32,
        cancel: &AtomicBool,
    ) -> Result<Vec<f32>, String> {
        let loaded = source::load(raster, "raw raster extraction", cancel)?;
        if loaded.grid.width != width || loaded.grid.height != height {
            return Err(format!(
                "raw raster buffer has {} bytes, expected {}",
                u64::from(loaded.grid.width) * u64::from(loaded.grid.height) * 4,
                u64::from(width) * u64::from(height) * 4
            ));
        }
        Ok(loaded.samples)
    }

    fn write_geotiff(
        &self,
        output: &Path,
        georef: RasterGeoref<'_>,
        nodata: f32,
        values: &[f32],
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        let prepared = Self::prepare(
            RasterInput::Samples {
                grid: georef.grid,
                values,
            },
            Some(georef),
            Some(nodata),
            "the raster output",
            cancel,
        )?;
        Self::write(
            &prepared,
            output,
            cog::CogProfile {
                compression: Compression::Deflate,
                overviews: false,
            },
            cancel,
        )
    }

    fn write_controlled_cog(
        &self,
        input: RasterInput<'_>,
        output: &Path,
        georef: Option<RasterGeoref<'_>>,
        nodata: Option<f32>,
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        let prepared = Self::prepare(input, georef, nodata, "the raster conversion", cancel)?;
        Self::write(
            &prepared,
            output,
            cog::CogProfile {
                compression: Compression::None,
                overviews: false,
            },
            cancel,
        )
    }

    fn write_display_cog(
        &self,
        input: RasterInput<'_>,
        output: &Path,
        georef: Option<RasterGeoref<'_>>,
        nodata: Option<f32>,
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        let prepared = Self::prepare(input, georef, nodata, "the display derivative", cancel)?;
        Self::write(
            &prepared,
            output,
            cog::CogProfile {
                compression: Compression::Deflate,
                overviews: true,
            },
            cancel,
        )
    }

    fn transform_points(
        &self,
        source_crs: &str,
        target_crs: &str,
        points: &[(f64, f64)],
        cancel: &AtomicBool,
    ) -> Result<Vec<Option<(f64, f64)>>, String> {
        check_cancel(cancel)?;
        let source = crs::from_reference(source_crs)?;
        let target = crs::from_reference(target_crs)?;
        Ok(points
            .iter()
            .map(|(x, y)| {
                source
                    .transform_to(*x, *y, &target)
                    .ok()
                    .filter(|(x, y)| x.is_finite() && y.is_finite())
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::super::prepared_raster::{PreparedRaster, RasterWindow};
    use super::*;
    use std::sync::atomic::Ordering;

    fn scratch(label: &str) -> crate::test_scratch::TestScratch {
        crate::test_scratch::TestScratch::new(&format!("rust-engine-{label}"))
    }

    fn cancel() -> AtomicBool {
        AtomicBool::new(false)
    }

    /// Authored values with every special Float32 case.
    fn value(x: u32, y: u32) -> f32 {
        match (x % 23, y % 17) {
            (0, 0) => -9999.0,
            (1, 1) => f32::NAN,
            (2, 2) => f32::INFINITY,
            (3, 3) => 0.0,
            (4, 4) => -12.5,
            _ => (x as f32) * 0.5 - (y as f32) * 0.25,
        }
    }

    fn values(width: u32, height: u32) -> Vec<f32> {
        (0..height)
            .flat_map(|y| (0..width).map(move |x| value(x, y)))
            .collect()
    }

    fn grid(width: u32, height: u32) -> RasterGrid {
        RasterGrid {
            width,
            height,
            geotransform: [444_999.75, 0.5, 0.0, 6_806_000.25, 0.0, -0.5],
        }
    }

    fn assert_same_samples(got: &[f32], expected: &[f32]) {
        assert_eq!(got.len(), expected.len());
        for (index, (got, expected)) in got.iter().zip(expected).enumerate() {
            if expected.is_nan() {
                assert!(got.is_nan(), "sample {index} must stay NaN, got {got}");
            } else {
                assert_eq!(got.to_bits(), expected.to_bits(), "sample {index}");
            }
        }
    }

    #[test]
    fn a_written_geotiff_probes_and_reads_back_exactly() {
        let dir = scratch("geotiff");
        let engine = RustRasterEngine;
        let (width, height) = (300u32, 260u32);
        let authored = values(width, height);
        let grid = grid(width, height);
        let path = dir.join("fixture.tif");
        engine
            .write_geotiff(
                &path,
                RasterGeoref {
                    grid: &grid,
                    crs: "EPSG:2154",
                },
                -9999.0,
                &authored,
                &cancel(),
            )
            .unwrap();

        let probe = engine.probe(&path, &cancel()).unwrap();
        assert_eq!(probe.driver, "GTiff");
        assert_eq!((probe.width, probe.height), (width, height));
        assert_eq!(probe.band_count, 1);
        assert_eq!(probe.band_type, "Float32");
        assert_eq!(probe.nodata, Some(-9999.0));
        assert_eq!(probe.geotransform, grid.geotransform);
        assert_eq!(probe.block, [256, 256]);
        assert_eq!(probe.compression, "DEFLATE");
        assert_eq!(probe.overview_count, 0);
        assert!(probe.mask_flags.is_empty());
        assert!(probe.crs_wkt.contains("2154"), "{}", probe.crs_wkt);
        assert_eq!(
            super::super::analyses::crs_class(&probe.crs_wkt),
            super::super::analyses::CRS_PROJECTED_METRE
        );

        let read = engine.read_f32(&path, width, height, &cancel()).unwrap();
        assert_same_samples(&read, &authored);
        assert!(
            engine
                .read_f32(&path, width, height + 1, &cancel())
                .is_err()
        );

        let stats = engine.statistics(&path, &cancel()).unwrap();
        let valid: Vec<f64> = authored
            .iter()
            .filter(|v| v.is_finite() && **v != -9999.0)
            .map(|v| f64::from(*v))
            .collect();
        let mean = valid.iter().sum::<f64>() / valid.len() as f64;
        assert!((stats.mean - mean).abs() < 1e-9);
        assert_eq!(
            stats.minimum,
            valid.iter().cloned().fold(f64::INFINITY, f64::min)
        );
        assert!(
            (stats.valid_percent - valid.len() as f64 * 100.0 / authored.len() as f64).abs() < 1e-9
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_controlled_profile_is_what_the_bounded_reader_accepts() {
        let dir = scratch("controlled");
        let engine = RustRasterEngine;
        let (width, height) = (300u32, 260u32);
        let authored = values(width, height);
        let grid = grid(width, height);
        let from_samples = dir.join("samples.tif");
        engine
            .write_controlled_cog(
                RasterInput::Samples {
                    grid: &grid,
                    values: &authored,
                },
                &from_samples,
                Some(RasterGeoref {
                    grid: &grid,
                    crs: "EPSG:2154",
                }),
                Some(-9999.0),
                &cancel(),
            )
            .unwrap();
        let probe = engine.probe(&from_samples, &cancel()).unwrap();
        assert_eq!(probe.compression, "NONE");
        assert_eq!(probe.overview_count, 0);
        let mut reader = PreparedRaster::open_committed(&from_samples, &grid, Some(-9999.0))
            .expect("the controlled profile opens through the production reader");
        let window = reader
            .read_window(
                RasterWindow {
                    x: 0,
                    y: 0,
                    width,
                    height,
                },
                &cancel(),
            )
            .unwrap();
        assert_same_samples(window.samples(), &authored);
        let expected_valid: Vec<u8> = authored
            .iter()
            .map(|v| u8::from(v.is_finite() && *v != -9999.0))
            .collect();
        assert_eq!(window.valid(), expected_valid.as_slice());
        drop(reader);

        // From a file: a relocated georef and a NoData override, keeping samples.
        let moved = RasterGrid {
            geotransform: [0.0, 1.0, 0.0, f64::from(height), 0.0, -1.0],
            ..grid.clone()
        };
        let from_file = dir.join("file.tif");
        engine
            .write_controlled_cog(
                RasterInput::File(&from_samples),
                &from_file,
                Some(RasterGeoref {
                    grid: &moved,
                    crs: "EPSG:3857",
                }),
                None,
                &cancel(),
            )
            .unwrap();
        let probe = engine.probe(&from_file, &cancel()).unwrap();
        assert_eq!(probe.geotransform, moved.geotransform);
        assert_eq!(probe.nodata, Some(-9999.0), "the input's tag is kept");
        assert!(probe.crs_wkt.contains("3857"));
        let mut reader = PreparedRaster::open_committed(&from_file, &moved, Some(-9999.0)).unwrap();
        let window = reader
            .read_window(
                RasterWindow {
                    x: 0,
                    y: 0,
                    width,
                    height,
                },
                &cancel(),
            )
            .unwrap();
        assert_same_samples(window.samples(), &authored);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_display_profile_carries_averaged_valid_overviews_and_the_tag() {
        let dir = scratch("display");
        let engine = RustRasterEngine;
        let (width, height) = (600u32, 400u32);
        // An x-ramp with a NoData hole, so overviews must average around it.
        let mut authored = Vec::with_capacity((width * height) as usize);
        for row in 0..height {
            for column in 0..width {
                let hole = (100..140).contains(&row) && (100..160).contains(&column);
                authored.push(if hole { -9999.0 } else { column as f32 * 0.5 });
            }
        }
        let grid = grid(width, height);
        let path = dir.join("display.tif");
        engine
            .write_display_cog(
                RasterInput::Samples {
                    grid: &grid,
                    values: &authored,
                },
                &path,
                Some(RasterGeoref {
                    grid: &grid,
                    crs: "EPSG:2154",
                }),
                Some(-9999.0),
                &cancel(),
            )
            .unwrap();
        let probe = engine.probe(&path, &cancel()).unwrap();
        assert_eq!(probe.compression, "DEFLATE");
        assert_eq!(
            probe.overview_count, 2,
            "600x400 halves to 300x200 and 150x100"
        );
        assert_eq!(probe.nodata, Some(-9999.0));
        assert_eq!(probe.block, [256, 256]);

        let bytes = std::fs::read(&path).unwrap();
        let layout = wbgeotiff::GeoTiff::parse_cog_layout(&bytes[..(64 << 10).min(bytes.len())])
            .expect("the directories sit in the file's first 64 KiB");
        assert_eq!(layout.levels.len(), 3);
        assert_eq!(
            (layout.levels[1].width, layout.levels[1].height),
            (300, 200)
        );
        assert_eq!(layout.no_data, Some(-9999.0));
        // The first overview averages valid cells only: beside the hole the
        // value is the ramp's mean, inside it the sentinel.
        let level = &layout.levels[1];
        let tile = |x: u32, y: u32| {
            let (offset, count) = level.tile_range(x / 256, y / 256).unwrap();
            let samples = level
                .decode_tile_f64(&bytes[offset as usize..(offset + count) as usize])
                .unwrap();
            samples[((y % 256) * 256 + x % 256) as usize] as f32
        };
        assert_eq!(
            tile(60, 20),
            60.25,
            "the mean of columns 120 and 121 at half scale"
        );
        assert_eq!(
            tile(60, 60),
            -9999.0,
            "a block inside the hole stays NoData"
        );
        assert_eq!(
            tile(49, 50),
            49.25,
            "beside the hole's edge the valid half counts"
        );
        let full = engine.read_f32(&path, width, height, &cancel()).unwrap();
        assert_same_samples(&full, &authored);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn transforms_match_the_registry_and_place_nothing_they_cannot() {
        let engine = RustRasterEngine;
        let placed = engine
            .transform_points(
                "EPSG:2154",
                "EPSG:4326",
                &[(700_000.0, 6_600_000.0), (f64::NAN, 1.0)],
                &cancel(),
            )
            .unwrap();
        let (lon, lat) = placed[0].unwrap();
        assert!((lon - 3.0).abs() < 1e-9 && (lat - 46.5).abs() < 1e-9);
        assert_eq!(placed[1], None);
        let back = engine
            .transform_points("EPSG:4326", "EPSG:2154", &[(3.0, 46.5)], &cancel())
            .unwrap()[0]
            .unwrap();
        assert!((back.0 - 700_000.0).abs() < 1e-3 && (back.1 - 6_600_000.0).abs() < 1e-3);
        assert!(
            engine
                .transform_points("EPSG:999999", "EPSG:4326", &[(0.0, 0.0)], &cancel())
                .is_err()
        );
        assert_eq!(
            engine
                .transform_points("EPSG:3857", "EPSG:4326", &[], &cancel())
                .unwrap(),
            Vec::<Option<(f64, f64)>>::new()
        );
    }

    #[test]
    fn the_extent_of_a_lambert_tile_lands_where_the_ign_places_it() {
        let dir = scratch("extent");
        let engine = RustRasterEngine;
        let grid = grid(2000, 2000);
        let path = dir.join("tile.tif");
        engine
            .write_geotiff(
                &path,
                RasterGeoref {
                    grid: &grid,
                    crs: "EPSG:2154",
                },
                -9999.0,
                &vec![1.0; 4_000_000],
                &cancel(),
            )
            .unwrap();
        let [west, south, east, north] = engine.wgs84_extent(&path, &cancel()).unwrap();
        // gdalinfo's wgs84Extent for LHD_FXX_0445_6806.
        assert!((west - -0.4400076).abs() < 1e-6, "{west}");
        assert!((south - 48.2953405).abs() < 1e-6, "{south}");
        assert!((east - -0.4259494).abs() < 1e-6, "{east}");
        assert!((north - 48.3047203).abs() < 1e-6, "{north}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn whole_raster_work_honours_the_capacity_limit_by_name() {
        let dir = scratch("capacity");
        let engine = RustRasterEngine;
        let oversized = RasterGrid {
            width: 5_001,
            height: 5_000,
            geotransform: [0.0, 1.0, 0.0, 5_000.0, 0.0, -1.0],
        };
        let error = engine
            .write_controlled_cog(
                RasterInput::Samples {
                    grid: &oversized,
                    values: &[],
                },
                &dir.join("never.tif"),
                Some(RasterGeoref {
                    grid: &oversized,
                    crs: "EPSG:3857",
                }),
                None,
                &cancel(),
            )
            .unwrap_err();
        assert!(error.contains("whole-raster read is limited"), "{error}");
        assert!(!dir.join("never.tif").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_set_flag_cancels_before_any_output_exists() {
        let dir = scratch("cancel");
        let engine = RustRasterEngine;
        let grid = grid(64, 64);
        let flag = cancel();
        flag.store(true, Ordering::Relaxed);
        let error = engine
            .write_display_cog(
                RasterInput::Samples {
                    grid: &grid,
                    values: &vec![1.0; 64 * 64],
                },
                &dir.join("cancelled.tif"),
                Some(RasterGeoref {
                    grid: &grid,
                    crs: "EPSG:3857",
                }),
                None,
                &flag,
            )
            .unwrap_err();
        assert_eq!(error, "cancelled");
        assert!(!dir.join("cancelled.tif").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn stripped_integer_sources_convert_like_a_float32_cast() {
        let dir = scratch("stripped");
        let engine = RustRasterEngine;
        let (width, height) = (70u32, 45u32);
        let authored: Vec<i16> = (0..width * height)
            .map(|index| (index as i32 % 5000 - 2500) as i16)
            .collect();
        let path = dir.join("int16.tif");
        wbgeotiff::GeoTiffWriter::new(width, height, 1)
            .layout(wbgeotiff::WriteLayout::Stripped { rows_per_strip: 7 })
            .compression(wbgeotiff::Compression::Lzw)
            .geo_transform(wbgeotiff::GeoTransform::north_up(10.0, 1.0, 55.0, -1.0))
            .epsg(3857)
            .no_data(-2500.0)
            .write_i16(&path, &authored)
            .unwrap();
        let probe = engine.probe(&path, &cancel()).unwrap();
        assert_eq!(probe.band_type, "Int16");
        assert_eq!(probe.compression, "LZW");
        assert_eq!(probe.block, [width, 7]);
        assert_eq!(probe.nodata, Some(-2500.0));
        assert_eq!(probe.geotransform, [10.0, 1.0, 0.0, 55.0, 0.0, -1.0]);
        let read = engine.read_f32(&path, width, height, &cancel()).unwrap();
        let expected: Vec<f32> = authored.iter().map(|v| f32::from(*v)).collect();
        assert_eq!(read, expected);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn other_formats_are_read_whole_through_wbraster() {
        let dir = scratch("ascii");
        let engine = RustRasterEngine;
        let path = dir.join("grid.asc");
        std::fs::write(
            &path,
            "ncols 3\nnrows 2\nxllcorner 100\nyllcorner 200\ncellsize 10\nNODATA_value -1\n1 2 -1\n4.5 5 6\n",
        )
        .unwrap();
        let probe = engine.probe(&path, &cancel()).unwrap();
        assert_eq!(probe.driver, "AAIGrid");
        assert_eq!((probe.width, probe.height), (3, 2));
        assert_eq!(probe.nodata, Some(-1.0));
        assert_eq!(probe.geotransform, [100.0, 10.0, 0.0, 220.0, 0.0, -10.0]);
        assert_eq!(probe.crs_wkt, "", "an ASCII grid declares no CRS");
        let read = engine.read_f32(&path, 3, 2, &cancel()).unwrap();
        assert_eq!(read, vec![1.0, 2.0, -1.0, 4.5, 5.0, 6.0]);
        // Without a CRS a conversion needs a georeference; with one it works.
        let grid = RasterGrid {
            width: 3,
            height: 2,
            geotransform: probe.geotransform,
        };
        let out = dir.join("grid.tif");
        assert!(
            engine
                .write_controlled_cog(RasterInput::File(&path), &out, None, None, &cancel())
                .unwrap_err()
                .contains("no coordinate system")
        );
        engine
            .write_controlled_cog(
                RasterInput::File(&path),
                &out,
                Some(RasterGeoref {
                    grid: &grid,
                    crs: "EPSG:3857",
                }),
                None,
                &cancel(),
            )
            .unwrap();
        assert_eq!(engine.probe(&out, &cancel()).unwrap().nodata, Some(-1.0));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The recorded crate versions are the ones the lockfile pins, so a bump
    /// cannot ship under a stale engine version.
    #[test]
    fn the_engine_version_names_the_locked_crates() {
        let lock = include_str!("../../../../../Cargo.lock");
        let pinned = |name: &str| -> Vec<(String, String)> {
            let mut found = Vec::new();
            let mut blocks = lock.split("[[package]]");
            blocks.next();
            for block in blocks {
                let field = |key: &str| {
                    block
                        .lines()
                        .find_map(|line| line.strip_prefix(&format!("{key} = \"")))
                        .map(|rest| rest.trim_end_matches('"').to_string())
                };
                if field("name").as_deref() == Some(name) {
                    found.push((
                        field("version").unwrap_or_default(),
                        field("source").unwrap_or_default(),
                    ));
                }
            }
            found
        };
        let geotiff = pinned("wbgeotiff");
        assert_eq!(
            geotiff.len(),
            1,
            "one wbgeotiff serves every dependant: {geotiff:?}"
        );
        assert_eq!(geotiff[0].0, WBGEOTIFF_VERSION);
        assert!(
            geotiff[0].1.ends_with(&format!("#{WBGEOTIFF_REVISION}")),
            "{}",
            geotiff[0].1
        );
        assert_eq!(pinned("wbprojection")[0].0, WBPROJECTION_VERSION);
        assert_eq!(pinned("wbraster")[0].0, WBRASTER_VERSION);
        assert!(engine_version().contains("wbgeotiff 0.1.2@9c0ff4f"));
    }
}
