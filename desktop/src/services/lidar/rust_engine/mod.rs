//! The pure-Rust raster engine (ADR 0014).
//!
//! In-process reading, conversion, statistics and reprojection on the
//! `whitebox_next_gen` crates: `wbgeotiff` for TIFF/COG primitives,
//! `wbraster` for the other raster formats and `wbprojection` for
//! coordinate reference systems. Nothing is bundled or discovered at run
//! time; the engine is always available and its version names the crates.
//!
//! Memory: a GeoTIFF converts through the one writer in row windows of at
//! most the library's capacity limit (`import::MAX_RAW_EXTRACTION_CELLS`),
//! whatever its size; each overview level is averaged from the level before
//! it, read back from the file being written. Beside the windows the writer
//! holds one output tile and the reader one decoded chunk of at most
//! `tiff::MAX_STREAMED_CHUNK_BYTES`. Other formats, and a GeoTIFF with a
//! larger compressed chunk, are loaded whole after the capacity check, with
//! the same named reason every whole-raster read gives. Cancellation is
//! honoured between windows, chunks and levels.

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
use super::import::{raw_extraction_cells, validate_working_grid};
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

/// Band samples a conversion holds outside its fixed working set (one output
/// tile and one decoded source chunk): row windows, halving windows and whole
/// loads. Tests read their high-water mark through [`high_water`];
/// production builds keep no count.
pub(super) struct Cells {
    samples: Vec<f32>,
}

impl Cells {
    pub(super) fn new(samples: Vec<f32>) -> Self {
        #[cfg(test)]
        high_water::add(samples.len() as u64);
        Self { samples }
    }

    pub(super) fn zeroed(len: usize) -> Self {
        Self::new(vec![0.0; len])
    }

    /// The samples, no longer counted as held by the conversion.
    pub(super) fn into_vec(mut self) -> Vec<f32> {
        // Drop counts what is left, which is nothing once taken.
        #[cfg(test)]
        high_water::remove(self.samples.len() as u64);
        std::mem::take(&mut self.samples)
    }
}

impl std::ops::Deref for Cells {
    type Target = [f32];

    fn deref(&self) -> &[f32] {
        &self.samples
    }
}

impl std::ops::DerefMut for Cells {
    fn deref_mut(&mut self) -> &mut [f32] {
        &mut self.samples
    }
}

#[cfg(test)]
impl Drop for Cells {
    fn drop(&mut self) {
        high_water::remove(self.samples.len() as u64);
    }
}

/// Test-only high-water mark of [`Cells`] on this thread.
#[cfg(test)]
pub(super) mod high_water {
    use std::cell::Cell;

    thread_local! {
        /// `(held now, most held since the last reset)`.
        static CELLS: Cell<(u64, u64)> = const { Cell::new((0, 0)) };
    }

    pub(super) fn add(cells: u64) {
        CELLS.with(|slot| {
            let (now, peak) = slot.get();
            slot.set((now + cells, peak.max(now + cells)));
        });
    }

    pub(super) fn remove(cells: u64) {
        CELLS.with(|slot| {
            let (now, peak) = slot.get();
            slot.set((now.saturating_sub(cells), peak));
        });
    }

    /// Start a new measurement from what is held now.
    pub(super) fn reset() {
        CELLS.with(|slot| {
            let (now, _) = slot.get();
            slot.set((now, now));
        });
    }

    pub(super) fn peak() -> u64 {
        CELLS.with(|slot| slot.get().1)
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RustRasterEngine;

/// A band ready to be written: its placement, CRS and validity rule.
struct Prepared<'a> {
    grid: RasterGrid,
    crs: crs::ResolvedCrs,
    nodata: Option<f32>,
    band: PreparedBand<'a>,
}

enum PreparedBand<'a> {
    Samples(&'a [f32]),
    Source(source::Band),
}

impl RustRasterEngine {
    fn prepare<'a>(
        input: RasterInput<'a>,
        georef: Option<RasterGeoref<'_>>,
        nodata: Option<f32>,
        operation: &str,
        cancel: &AtomicBool,
    ) -> Result<Prepared<'a>, String> {
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
                    band: PreparedBand::Samples(values),
                })
            }
            RasterInput::File(path) => {
                let opened = source::open(path, operation, cancel)?;
                check_cancel(cancel)?;
                let (grid, crs) = match georef {
                    Some(georef) => {
                        if georef.grid.width != opened.grid.width
                            || georef.grid.height != opened.grid.height
                        {
                            return Err(format!(
                                "the georeference is {}x{} but {} is {}x{}",
                                georef.grid.width,
                                georef.grid.height,
                                path.display(),
                                opened.grid.width,
                                opened.grid.height
                            ));
                        }
                        (georef.grid.clone(), crs::from_reference(georef.crs)?)
                    }
                    None => {
                        let crs = opened.crs.ok_or_else(|| {
                            format!(
                                "{} has no coordinate system; Canopi requires a horizontal CRS",
                                path.display()
                            )
                        })?;
                        (opened.grid, crs)
                    }
                };
                Ok(Prepared {
                    grid,
                    crs,
                    nodata: nodata.or(opened.nodata),
                    band: PreparedBand::Source(opened.band),
                })
            }
        }
    }

    /// Write a prepared band through the one writer, in row windows of at
    /// most the capacity limit.
    fn write(
        prepared: Prepared<'_>,
        output: &Path,
        profile: cog::CogProfile,
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        let geo_keys = crs::geokeys_for(&prepared.crs)?;
        let width = prepared.grid.width;
        let mut slice;
        let mut reader;
        let band: &mut dyn cog::BandSource = match prepared.band {
            PreparedBand::Samples(samples) => {
                slice = cog::SliceSource { samples, width };
                &mut slice
            }
            PreparedBand::Source(source::Band::Whole(ref samples)) => {
                slice = cog::SliceSource { samples, width };
                &mut slice
            }
            PreparedBand::Source(source::Band::Streamed(streamed)) => {
                reader = streamed;
                &mut reader
            }
        };
        cog::write(
            output,
            cog::CogGeoref {
                grid: &prepared.grid,
                geo_keys: Some(&geo_keys),
            },
            prepared.nodata,
            band,
            profile,
            raw_extraction_cells(),
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
        let nodata = loaded.nodata;
        let samples = loaded.into_samples(cancel)?;
        let valid = |value: &f32| value.is_finite() && nodata.is_none_or(|marker| *value != marker);
        let mut minimum = f64::INFINITY;
        let mut maximum = f64::NEG_INFINITY;
        let mut sum = 0f64;
        let mut count = 0u64;
        for value in samples.iter().filter(|value| valid(value)) {
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
        let squares: f64 = samples
            .iter()
            .filter(|value| valid(value))
            .map(|value| (f64::from(*value) - mean).powi(2))
            .sum();
        Ok(RasterStatistics {
            minimum,
            maximum,
            mean,
            std_dev: (squares / count as f64).sqrt(),
            valid_percent: count as f64 * 100.0 / samples.len() as f64,
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
        loaded.into_samples(cancel)
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
            prepared,
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
            prepared,
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
            prepared,
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

    /// How an authored source TIFF chunks its samples.
    #[derive(Clone, Copy)]
    enum Chunking {
        Strips(u32),
        Tiles(u32, u32),
    }

    /// Author a little-endian Float32 GeoTIFF the way GDAL writes elevation
    /// tiles: EPSG:2154 keys, a -9999 NoData tag and the test grid, chunked
    /// as asked, with `compression` (1 none, 8 Deflate) and `predictor`
    /// (1 none, 3 floating point). Edge tiles are padded with NoData.
    fn write_source_tiff(
        path: &Path,
        width: u32,
        height: u32,
        chunking: Chunking,
        compression: u16,
        predictor: u16,
        samples: &[f32],
    ) {
        let codec = Compression::from_tag(compression);
        let encode = |chunk: &[f32], columns: usize| -> Vec<u8> {
            let mut bytes: Vec<u8> = chunk.iter().flat_map(|v| v.to_le_bytes()).collect();
            if predictor == 3 {
                // TIFF Technical Note 3: per row, byte planes most significant
                // first, then byte-wise horizontal differencing.
                for row in bytes.chunks_mut(columns * 4) {
                    let planes: Vec<u8> = (0..4)
                        .flat_map(|plane| row.chunks(4).map(move |sample| sample[3 - plane]))
                        .collect();
                    row.copy_from_slice(&planes);
                    for index in (1..row.len()).rev() {
                        row[index] = row[index].wrapping_sub(row[index - 1]);
                    }
                }
            }
            wbgeotiff::compression::compress(codec, &bytes).unwrap()
        };
        let (w, h) = (width as usize, height as usize);
        let mut chunks = Vec::new();
        match chunking {
            Chunking::Strips(rows_per_strip) => {
                for first in (0..h).step_by(rows_per_strip as usize) {
                    let last = (first + rows_per_strip as usize).min(h);
                    chunks.push(encode(&samples[first * w..last * w], w));
                }
            }
            Chunking::Tiles(tile_width, tile_height) => {
                let (tw, th) = (tile_width as usize, tile_height as usize);
                for y0 in (0..h).step_by(th) {
                    for x0 in (0..w).step_by(tw) {
                        let mut tile = vec![-9999.0f32; tw * th];
                        for row in 0..th.min(h - y0) {
                            for column in 0..tw.min(w - x0) {
                                tile[row * tw + column] = samples[(y0 + row) * w + x0 + column];
                            }
                        }
                        chunks.push(encode(&tile, tw));
                    }
                }
            }
        }
        let mut file = vec![0u8; 8];
        file[..4].copy_from_slice(b"II\x2a\x00");
        let mut offsets = Vec::new();
        let mut counts = Vec::new();
        for chunk in &chunks {
            offsets.push(file.len() as u32);
            counts.push(chunk.len() as u32);
            file.extend_from_slice(chunk);
        }
        if file.len() % 2 == 1 {
            file.push(0);
        }
        let (key_words, key_doubles, key_text) =
            crs::geokeys_for(&crs::from_reference("EPSG:2154").unwrap())
                .unwrap()
                .encode();
        let geotransform = grid(width, height).geotransform;
        let shorts = |values: &[u16]| {
            (
                3u16,
                values.len(),
                values
                    .iter()
                    .flat_map(|v| v.to_le_bytes())
                    .collect::<Vec<u8>>(),
            )
        };
        let longs = |values: &[u32]| {
            (
                4u16,
                values.len(),
                values
                    .iter()
                    .flat_map(|v| v.to_le_bytes())
                    .collect::<Vec<u8>>(),
            )
        };
        let doubles = |values: &[f64]| {
            (
                12u16,
                values.len(),
                values
                    .iter()
                    .flat_map(|v| v.to_le_bytes())
                    .collect::<Vec<u8>>(),
            )
        };
        let ascii = |text: &str| {
            let mut bytes = text.as_bytes().to_vec();
            bytes.push(0);
            (2u16, bytes.len(), bytes)
        };
        let mut fields = vec![
            (256u16, longs(&[width])),
            (257, longs(&[height])),
            (258, shorts(&[32])),
            (259, shorts(&[compression])),
            (262, shorts(&[1])),
            (277, shorts(&[1])),
            (284, shorts(&[1])),
            (317, shorts(&[predictor])),
            (339, shorts(&[3])),
            (33550, doubles(&[geotransform[1], -geotransform[5], 0.0])),
            (
                33922,
                doubles(&[0.0, 0.0, 0.0, geotransform[0], geotransform[3], 0.0]),
            ),
            (34735, shorts(&key_words)),
            (42113, ascii("-9999")),
        ];
        if !key_doubles.is_empty() {
            fields.push((34736, doubles(&key_doubles)));
        }
        if !key_text.is_empty() {
            fields.push((34737, ascii(&key_text)));
        }
        match chunking {
            Chunking::Strips(rows_per_strip) => {
                fields.push((273, longs(&offsets)));
                fields.push((278, longs(&[rows_per_strip])));
                fields.push((279, longs(&counts)));
            }
            Chunking::Tiles(tile_width, tile_height) => {
                fields.push((322, longs(&[tile_width])));
                fields.push((323, longs(&[tile_height])));
                fields.push((324, longs(&offsets)));
                fields.push((325, longs(&counts)));
            }
        }
        fields.sort_by_key(|(tag, _)| *tag);
        let directory = file.len();
        file[4..8].copy_from_slice(&(directory as u32).to_le_bytes());
        let mut extra_at = directory + 2 + fields.len() * 12 + 4;
        let mut entries = (fields.len() as u16).to_le_bytes().to_vec();
        let mut extra = Vec::new();
        for (tag, (kind, count, payload)) in &fields {
            entries.extend_from_slice(&tag.to_le_bytes());
            entries.extend_from_slice(&kind.to_le_bytes());
            entries.extend_from_slice(&(*count as u32).to_le_bytes());
            if payload.len() <= 4 {
                let mut inline = [0u8; 4];
                inline[..payload.len()].copy_from_slice(payload);
                entries.extend_from_slice(&inline);
            } else {
                entries.extend_from_slice(&(extra_at as u32).to_le_bytes());
                extra.extend_from_slice(payload);
                if payload.len() % 2 == 1 {
                    extra.push(0);
                }
                extra_at = directory + 2 + fields.len() * 12 + 4 + extra.len();
            }
        }
        entries.extend_from_slice(&0u32.to_le_bytes());
        file.extend_from_slice(&entries);
        file.extend_from_slice(&extra);
        std::fs::write(path, file).unwrap();
    }

    /// canopi-dfc0: a GeoTIFF above the whole-raster limit converts in row
    /// windows that never hold more than the limit, into exactly the bytes
    /// the whole raster gives, for both profiles and every chunk layout.
    #[test]
    fn geotiff_sources_stream_under_the_limit_into_the_whole_raster_bytes() {
        const LIMIT: u64 = 100_000;
        let dir = scratch("streamed");
        let engine = RustRasterEngine;
        let (width, height) = (701u32, 599u32);
        assert!(u64::from(width * height) > 4 * LIMIT);
        let authored = values(width, height);
        let grid = grid(width, height);
        let georef = RasterGeoref {
            grid: &grid,
            crs: "EPSG:2154",
        };
        let sources = [
            ("striped", Chunking::Strips(7), 8, 3),
            ("tiled", Chunking::Tiles(160, 144), 8, 3),
            ("one-strip", Chunking::Strips(height), 1, 1),
        ];
        for (label, chunking, compression, predictor) in sources {
            let source = dir.join(format!("{label}.tif"));
            write_source_tiff(
                &source,
                width,
                height,
                chunking,
                compression,
                predictor,
                &authored,
            );
            let read = engine.read_f32(&source, width, height, &cancel()).unwrap();
            assert_same_samples(&read, &authored);
            for display in [false, true] {
                let convert = |input: RasterInput<'_>, output: &Path, nodata: Option<f32>| {
                    if display {
                        engine.write_display_cog(input, output, Some(georef), nodata, &cancel())
                    } else {
                        engine.write_controlled_cog(input, output, Some(georef), nodata, &cancel())
                    }
                };
                let whole = dir.join(format!("{label}-{display}-whole.tif"));
                convert(
                    RasterInput::Samples {
                        grid: &grid,
                        values: &authored,
                    },
                    &whole,
                    Some(-9999.0),
                )
                .unwrap();
                let streamed = dir.join(format!("{label}-{display}-streamed.tif"));
                let peak = {
                    let _limit = super::super::import::extraction_limit_probe::set(LIMIT);
                    high_water::reset();
                    convert(RasterInput::File(&source), &streamed, None)
                        .unwrap_or_else(|error| panic!("{label} display={display}: {error}"));
                    high_water::peak()
                };
                assert!(
                    peak > 0 && peak <= LIMIT,
                    "{label} display={display} held {peak} cells"
                );
                assert!(
                    std::fs::read(&whole).unwrap() == std::fs::read(&streamed).unwrap(),
                    "{label} display={display}: the streamed output differs from the whole one"
                );
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

    #[test]
    fn other_formats_keep_the_whole_raster_limit() {
        let dir = scratch("ascii-limit");
        let engine = RustRasterEngine;
        let path = dir.join("grid.asc");
        std::fs::write(
            &path,
            "ncols 3\nnrows 2\nxllcorner 100\nyllcorner 200\ncellsize 10\nNODATA_value -1\n1 2 -1\n4.5 5 6\n",
        )
        .unwrap();
        let grid = RasterGrid {
            width: 3,
            height: 2,
            geotransform: [100.0, 10.0, 0.0, 220.0, 0.0, -10.0],
        };
        let out = dir.join("grid.tif");
        let _limit = super::super::import::extraction_limit_probe::set(5);
        let error = engine
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
            .unwrap_err();
        assert!(error.contains("whole-raster read"), "{error}");
        assert!(!out.exists());
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
