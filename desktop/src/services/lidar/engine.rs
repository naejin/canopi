//! The raster engine seam of the Data library.
//!
//! Every numeric raster operation the library performs on files goes through
//! [`RasterEngine`]: header probes, exact statistics, whole-raster Float32
//! reads under the capacity limit, the two controlled output profiles
//! (numeric COG and display COG), the tiled GeoTIFF handed to the GeoLibre
//! sidecar, and point transforms between coordinate reference systems.
//! Production has one implementation, `rust_engine::RustRasterEngine`
//! (ADR 0014); the test-only GDAL oracle in `gdal_engine.rs` implements the
//! same trait so the comparison lane can hold both to the same contract.
//! Vocabulary (driver, band type, mask flags, compression names) stays
//! GDAL's, which the catalogue and admission rules were written against.
//!
//! Every operation takes the caller's cancellation flag and returns
//! `Err("cancelled")` when it is set between phases.

use super::grid::RasterGrid;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

/// Header facts of one raster, read without decoding samples wherever the
/// format allows. Persisted verbatim in the source manifest so provenance
/// survives reimports; no absolute path is ever part of it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RasterProbe {
    /// Format identity in GDAL's short-name vocabulary (`GTiff` for every
    /// TIFF), so admission has one name to check.
    pub driver: String,
    pub width: u32,
    pub height: u32,
    pub band_count: u32,
    /// Band 1's sample type in GDAL's vocabulary (`Float32`, `Int16`, ...).
    pub band_type: String,
    pub nodata: Option<f32>,
    pub scale: f64,
    pub offset: f64,
    pub unit: Option<String>,
    /// Validity mask flags in GDAL's vocabulary; anything but `ALL_VALID`
    /// names a dataset mask admission refuses.
    pub mask_flags: Vec<String>,
    /// `[origin_x, pixel_w, rot_x, origin_y, rot_y, pixel_h]`.
    pub geotransform: [f64; 6],
    /// The horizontal CRS as WKT, or empty when the file declares none.
    pub crs_ref: String,
    /// Band 1's native block: `[tile_w, tile_h]` or `[width, rows_per_strip]`.
    pub block: [u32; 2],
    /// Compression in GDAL's vocabulary (`NONE`, `DEFLATE`, `LZW`, ...).
    pub compression: String,
    /// Reduced-resolution levels stored with band 1.
    pub overview_count: u32,
}

/// Exact statistics over a raster's valid samples: finite and not the
/// declared NoData. Mean and standard deviation are the population values
/// over those samples, as `gdalinfo -stats` reports them (GDAL differs only
/// by counting `±inf`, which Canopi's validity rule never does).
///
/// Production never needs whole-raster statistics (facts are read in bounded
/// windows); the fixture and comparison lanes use them to prove outputs.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq)]
pub struct RasterStatistics {
    pub minimum: f64,
    pub maximum: f64,
    pub mean: f64,
    pub std_dev: f64,
    /// Valid samples as a percentage of all cells, `0.0..=100.0`.
    pub valid_percent: f64,
}

/// Where an output raster sits: its grid and horizontal CRS (`EPSG:n` or WKT).
#[derive(Debug, Clone, Copy)]
pub struct RasterGeoref<'a> {
    pub grid: &'a RasterGrid,
    pub crs: &'a str,
}

/// What a conversion reads.
#[derive(Debug, Clone, Copy)]
pub enum RasterInput<'a> {
    /// Any raster file the engine can read; band 1 is converted.
    File(&'a Path),
    /// Row-major Float32 samples of `grid`; the caller supplies the georef.
    Samples {
        grid: &'a RasterGrid,
        values: &'a [f32],
    },
}

/// The operations the Data library needs from a raster engine.
pub trait RasterEngine: Send + Sync + std::fmt::Debug {
    /// The engine's identity, recorded in manifests; an error names why the
    /// engine is unavailable.
    fn version(&self) -> Result<String, String>;

    /// Header facts of `raster`. Fails when the file is unreadable or not
    /// georeferenced; a missing CRS leaves `crs_ref` empty.
    fn probe(&self, raster: &Path, cancel: &AtomicBool) -> Result<RasterProbe, String>;

    /// Exact statistics over band 1's valid samples (test lanes only).
    #[cfg(test)]
    fn statistics(&self, raster: &Path, cancel: &AtomicBool) -> Result<RasterStatistics, String>;

    /// The WGS84 box `[west, south, east, north]` around the raster's corners.
    /// Never writes anything beside the file.
    fn wgs84_extent(&self, raster: &Path, cancel: &AtomicBool) -> Result<[f64; 4], String>;

    /// Band 1 of `raster` as row-major Float32, exactly `width * height`
    /// samples; integer and Float64 samples convert as a Float32 cast does.
    fn read_f32(
        &self,
        raster: &Path,
        width: u32,
        height: u32,
        cancel: &AtomicBool,
    ) -> Result<Vec<f32>, String>;

    /// Write a georeferenced, tiled, Deflate-compressed Float32 GeoTIFF with
    /// a NoData tag: the exchange format handed to the GeoLibre CLI and the
    /// authored fixture format.
    fn write_geotiff(
        &self,
        output: &Path,
        georef: RasterGeoref<'_>,
        nodata: f32,
        values: &[f32],
        cancel: &AtomicBool,
    ) -> Result<(), String>;

    /// Write the controlled numeric profile (`cog-f32-t256-raw-v1`): band 1
    /// as Float32, 256×256 tiles, uncompressed, no overviews, no mask.
    /// `georef` overrides the input's placement (required for samples);
    /// `nodata` overrides the input's tag, `None` keeps it (samples get none).
    fn write_controlled_cog(
        &self,
        input: RasterInput<'_>,
        output: &Path,
        georef: Option<RasterGeoref<'_>>,
        nodata: Option<f32>,
        cancel: &AtomicBool,
    ) -> Result<(), String>;

    /// Write the display profile (`display_cog::DISPLAY_PROFILE`): band 1
    /// warped to EPSG:3857 on the global Web Mercator lattice by nearest
    /// neighbour, each pixel whose centre falls inside the input's grid
    /// showing the native cell under it and every other pixel NoData (the
    /// input's tag, or [`DISPLAY_NODATA`] when it declares none); Float32,
    /// 256×256 tiles, Deflate, averaged valid-data overviews and the NoData
    /// tag readers compare samples against. Same override rules as
    /// [`RasterEngine::write_controlled_cog`].
    fn write_display_cog(
        &self,
        input: RasterInput<'_>,
        output: &Path,
        georef: Option<RasterGeoref<'_>>,
        nodata: Option<f32>,
        cancel: &AtomicBool,
    ) -> Result<(), String>;

    /// Transform `points` from `source_crs` to `target_crs` (`EPSG:n` or
    /// WKT). A point the transform cannot place is `None`, never an error.
    fn transform_points(
        &self,
        source_crs: &str,
        target_crs: &str,
        points: &[(f64, f64)],
        cancel: &AtomicBool,
    ) -> Result<Vec<Option<(f64, f64)>>, String>;
}

/// The NoData of a display derivative whose input declares none, and of the
/// cells a composed part leaves empty: -2^127, exactly representable in
/// Float32 and Float64 and written with a round-trip decimal, so every reader
/// that compares samples with the tag in either precision sees the same
/// value. No stored elevation, height or slope holds it.
pub(super) const DISPLAY_NODATA: f32 = -1.701_411_8e38;

/// `Err("cancelled")` once the caller's flag is set.
pub fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".to_string());
    }
    Ok(())
}

/// The WGS84 box around a set of transformed corners; `None` when no corner
/// could be placed.
pub(super) fn bounds_of(points: &[Option<(f64, f64)>]) -> Option<[f64; 4]> {
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for (x, y) in points.iter().flatten() {
        bounds[0] = bounds[0].min(*x);
        bounds[1] = bounds[1].min(*y);
        bounds[2] = bounds[2].max(*x);
        bounds[3] = bounds[3].max(*y);
    }
    bounds
        .iter()
        .all(|value| value.is_finite())
        .then_some(bounds)
}

/// The four corners of a grid in its own CRS, clockwise from the origin.
pub(super) fn grid_corners(grid: &RasterGrid) -> [(f64, f64); 4] {
    let [min_x, min_y, max_x, max_y] = grid.bounds();
    [
        (min_x, max_y),
        (max_x, max_y),
        (max_x, min_y),
        (min_x, min_y),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_cover_every_placed_corner_and_need_at_least_one() {
        assert_eq!(
            bounds_of(&[Some((1.0, 5.0)), None, Some((-2.0, 3.0))]),
            Some([-2.0, 3.0, 1.0, 5.0])
        );
        assert_eq!(bounds_of(&[None, None]), None);
        assert_eq!(bounds_of(&[]), None);
    }

    #[test]
    fn corners_walk_the_grid_clockwise_from_its_origin() {
        let grid = RasterGrid {
            width: 4,
            height: 2,
            geotransform: [10.0, 0.5, 0.0, 20.0, 0.0, -0.5],
        };
        assert_eq!(
            grid_corners(&grid),
            [(10.0, 20.0), (12.0, 20.0), (12.0, 19.0), (10.0, 19.0)]
        );
    }
}
