//! Reading source rasters: header probes, windowed GeoTIFF bands and
//! whole-band loads.
//!
//! The engine reads GeoTIFF only: any other file is refused from its
//! signature before it is parsed. A TIFF is probed from its directory and
//! read window by window ([`tiff::BandReader`]), so a conversion streams it
//! whatever its size unless one compressed chunk alone would decode above the
//! streamed working set; such a file is loaded whole after the capacity
//! limit. Its keys name its CRS (`crs::from_geokeys`).

use super::super::engine::RasterProbe;
use super::super::grid::RasterGrid;
use super::super::import::validate_working_grid;
use super::super::prepared_raster::RasterWindow;
use super::crs::{self, ResolvedCrs};
use super::{Cells, tiff};
use std::path::Path;
use std::sync::atomic::AtomicBool;

/// One band with its placement: streamed from its file, or held whole.
pub(super) struct Opened {
    pub grid: RasterGrid,
    pub crs: Option<ResolvedCrs>,
    pub nodata: Option<f32>,
    pub band: Band,
}

pub(super) enum Band {
    Streamed(tiff::BandReader),
    Whole(Cells),
}

impl Opened {
    /// The whole band, row-major; a streamed band is read whole only after
    /// the capacity check named `operation`.
    pub fn into_samples(self, operation: &str, cancel: &AtomicBool) -> Result<Vec<f32>, String> {
        match self.band {
            Band::Whole(samples) => Ok(samples.into_vec()),
            Band::Streamed(mut reader) => {
                validate_working_grid(&self.grid, operation)?;
                Ok(read_whole(&mut reader, &self.grid, cancel)?.into_vec())
            }
        }
    }
}

/// Header facts of a GeoTIFF.
pub(super) fn probe(path: &Path) -> Result<RasterProbe, String> {
    Ok(probe_tiff(&read_header(path)?)?.0)
}

/// Band 1 of a GeoTIFF: streamed when its chunks allow, otherwise loaded
/// whole after the capacity check named `operation`.
pub(super) fn open(path: &Path, operation: &str, cancel: &AtomicBool) -> Result<Opened, String> {
    let header = read_header(path)?;
    let (probe, crs) = probe_tiff(&header)?;
    let grid = grid_of(&probe);
    let nodata = probe.nodata;
    let mut reader = tiff::BandReader::open(path, header.band_format(), nodata.unwrap_or(0.0))?;
    let band = if reader.streams() {
        Band::Streamed(reader)
    } else {
        validate_working_grid(&grid, operation)?;
        Band::Whole(read_whole(&mut reader, &grid, cancel)?)
    };
    Ok(Opened {
        grid,
        crs,
        nodata,
        band,
    })
}

/// The directory of a file with a TIFF signature; any other file is refused
/// before it is parsed.
fn read_header(path: &Path) -> Result<tiff::TiffHeader, String> {
    if !tiff::is_tiff(path)? {
        return Err(format!("{} is not a GeoTIFF", path.display()));
    }
    tiff::read_header(path)
}

fn read_whole(
    reader: &mut tiff::BandReader,
    grid: &RasterGrid,
    cancel: &AtomicBool,
) -> Result<Cells, String> {
    let cells = usize::try_from(u64::from(grid.width) * u64::from(grid.height))
        .map_err(|_| "raster cell count overflows".to_string())?;
    let mut samples = Cells::zeroed(cells);
    reader.read(
        RasterWindow {
            x: 0,
            y: 0,
            width: grid.width,
            height: grid.height,
        },
        &mut samples,
        cancel,
    )?;
    Ok(samples)
}

pub(super) fn grid_of(probe: &RasterProbe) -> RasterGrid {
    RasterGrid {
        width: probe.width,
        height: probe.height,
        geotransform: probe.geotransform,
    }
}

/// The header facts and the CRS they name, resolved once.
fn probe_tiff(header: &tiff::TiffHeader) -> Result<(RasterProbe, Option<ResolvedCrs>), String> {
    let geotransform = header
        .geotransform
        .ok_or_else(|| "raster is not georeferenced (missing geotransform)".to_string())?;
    if geotransform[1] == 0.0 || geotransform[5] == 0.0 {
        return Err("raster has degenerate pixel size (zero geotransform scale)".to_string());
    }
    let crs = match &header.geo_keys {
        Some(keys) => crs::from_geokeys(keys)?,
        None => None,
    };
    let crs_ref = crs.map(|resolved| resolved.reference()).unwrap_or_default();
    let mut mask_flags = Vec::new();
    if header.has_mask {
        mask_flags.push("PER_DATASET".to_string());
    }
    if header.has_alpha {
        mask_flags.push("ALPHA".to_string());
    }
    let block = match &header.layout {
        tiff::Layout::Tiles { width, height, .. } => [*width, *height],
        tiff::Layout::Strips { rows_per_strip, .. } => [header.width, *rows_per_strip],
    };
    let probe = RasterProbe {
        driver: "GTiff".to_string(),
        width: header.width,
        height: header.height,
        band_count: u32::from(header.bands),
        band_type: tiff::band_type_name(header.format, header.bits),
        nodata: header.nodata.map(|value| value as f32),
        scale: header.scale,
        offset: header.offset,
        unit: header.unit.clone(),
        mask_flags,
        geotransform,
        crs_ref,
        block,
        compression: tiff::compression_name(header.compression_tag),
        overview_count: header.overview_count,
    };
    Ok((probe, crs))
}
