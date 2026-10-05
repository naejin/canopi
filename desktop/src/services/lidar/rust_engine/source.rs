//! Reading source rasters: header probes, windowed GeoTIFF bands and
//! whole-band loads.
//!
//! A TIFF is probed from its directory and read window by window
//! ([`tiff::BandReader`]), so a conversion streams it whatever its size
//! unless one compressed chunk alone would decode above the streamed working
//! set. Such a file, and every other format `wbraster` knows (read whole, as
//! that library works), is loaded whole after the capacity limit.

use super::super::engine::RasterProbe;
use super::super::grid::RasterGrid;
use super::super::import::{raw_extraction_cells, validate_working_grid};
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

/// Header facts of any raster the engine reads.
pub(super) fn probe(path: &Path) -> Result<RasterProbe, String> {
    if tiff::is_tiff(path)? {
        let header = tiff::read_header(path)?;
        return probe_tiff(&header);
    }
    let raster = read_other(path)?;
    Ok(probe_other(path, &raster)?.0)
}

/// Band 1 of any raster the engine reads: a GeoTIFF is streamed when its
/// chunks allow, anything else is loaded whole after the capacity check
/// named `operation`.
pub(super) fn open(path: &Path, operation: &str, cancel: &AtomicBool) -> Result<Opened, String> {
    if tiff::is_tiff(path)? {
        let header = tiff::read_header(path)?;
        let probe = probe_tiff(&header)?;
        let grid = grid_of(&probe);
        let crs = match &header.geo_keys {
            Some(keys) => crs::from_geokeys(keys)?,
            None => None,
        };
        let nodata = probe.nodata;
        let mut reader = tiff::BandReader::open(path, header.band_format(), nodata.unwrap_or(0.0))?;
        let band = if reader.streams() {
            Band::Streamed(reader)
        } else {
            validate_working_grid(&grid, operation)?;
            Band::Whole(read_whole(&mut reader, &grid, cancel)?)
        };
        return Ok(Opened {
            grid,
            crs,
            nodata,
            band,
        });
    }
    let raster = read_other(path)?;
    let (probe, crs) = probe_other(path, &raster)?;
    let grid = grid_of(&probe);
    validate_working_grid(&grid, operation)?;
    let cells = grid.width as usize * grid.height as usize;
    let samples: Vec<f32> = match raster.data.as_f32_slice() {
        Some(values) => values[..cells.min(values.len())].to_vec(),
        None => (0..cells.min(raster.data.len()))
            .map(|index| raster.data.get_f64(index) as f32)
            .collect(),
    };
    if samples.len() != cells {
        return Err(format!(
            "{} holds {} samples for a {}x{} grid",
            path.display(),
            samples.len(),
            grid.width,
            grid.height
        ));
    }
    Ok(Opened {
        grid,
        crs,
        nodata: probe.nodata,
        band: Band::Whole(Cells::new(samples)),
    })
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

fn probe_tiff(header: &tiff::TiffHeader) -> Result<RasterProbe, String> {
    let geotransform = header
        .geotransform
        .ok_or_else(|| "raster is not georeferenced (missing geotransform)".to_string())?;
    if geotransform[1] == 0.0 || geotransform[5] == 0.0 {
        return Err("raster has degenerate pixel size (zero geotransform scale)".to_string());
    }
    let crs_ref = match &header.geo_keys {
        Some(keys) => crs::from_geokeys(keys)?
            .map(|resolved| resolved.wkt)
            .unwrap_or_default(),
        None => String::new(),
    };
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
    Ok(RasterProbe {
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
    })
}

/// Read a non-TIFF file whole. Its grid is not known until it is parsed, so
/// the file is first held to the capacity limit in Float32 bytes.
fn read_other(path: &Path) -> Result<wbraster::Raster, String> {
    let bytes = std::fs::metadata(path)
        .map_err(|e| format!("Failed to inspect {}: {e}", path.display()))?
        .len();
    let limit = raw_extraction_cells().saturating_mul(4);
    if bytes > limit {
        return Err(format!(
            "{} has {bytes} bytes; a whole-raster read of this format is limited to {limit}",
            path.display()
        ));
    }
    wbraster::Raster::read(path)
        .map_err(|e| format!("{} is not a readable raster: {e}", path.display()))
}

/// GDAL's short driver name for the formats `wbraster` detects by extension.
fn driver_name(path: &Path) -> String {
    let format = wbraster::RasterFormat::detect(&path.to_string_lossy());
    match format {
        Ok(wbraster::RasterFormat::EsriAscii) => "AAIGrid",
        Ok(wbraster::RasterFormat::EsriBinary) => "AIG",
        Ok(wbraster::RasterFormat::EsriFloat) => "EHdr",
        Ok(wbraster::RasterFormat::Xyz) => "XYZ",
        Ok(wbraster::RasterFormat::Envi) => "ENVI",
        Ok(wbraster::RasterFormat::GrassAscii) => "GRASSASCIIGrid",
        Ok(wbraster::RasterFormat::Dted) => "DTED",
        Ok(wbraster::RasterFormat::Jpeg2000) => "JP2OpenJPEG",
        Ok(wbraster::RasterFormat::GeoPackage) => "GPKG",
        Ok(wbraster::RasterFormat::Png) => "PNG",
        Ok(wbraster::RasterFormat::Jpeg) => "JPEG",
        Ok(wbraster::RasterFormat::HfaImg) => "HFA",
        Ok(wbraster::RasterFormat::Saga) => "SAGA",
        Ok(wbraster::RasterFormat::Idrisi) => "RST",
        Ok(wbraster::RasterFormat::ErMapper) => "ERS",
        Ok(wbraster::RasterFormat::Pcraster) => "PCRaster",
        Ok(wbraster::RasterFormat::Zarr) => "Zarr",
        Ok(wbraster::RasterFormat::SurferGrd) => "GSAG",
        Ok(other) => return other.name().to_string(),
        Err(_) => "unknown",
    }
    .to_string()
}

/// wbraster's native type in GDAL's vocabulary.
fn band_type_name(data_type: wbraster::raster::DataType) -> String {
    use wbraster::raster::DataType;
    match data_type {
        DataType::U8 => "Byte",
        DataType::I8 => "Int8",
        DataType::U16 => "UInt16",
        DataType::I16 => "Int16",
        DataType::U32 => "UInt32",
        DataType::I32 => "Int32",
        DataType::U64 => "UInt64",
        DataType::I64 => "Int64",
        DataType::F32 => "Float32",
        DataType::F64 => "Float64",
    }
    .to_string()
}

fn probe_other(
    path: &Path,
    raster: &wbraster::Raster,
) -> Result<(RasterProbe, Option<ResolvedCrs>), String> {
    let width = u32::try_from(raster.cols).map_err(|_| "raster width exceeds this platform")?;
    let height = u32::try_from(raster.rows).map_err(|_| "raster height exceeds this platform")?;
    if width == 0 || height == 0 {
        return Err(format!("{} declares an empty image", path.display()));
    }
    if raster.cell_size_x == 0.0 || raster.cell_size_y == 0.0 {
        return Err("raster has degenerate pixel size (zero geotransform scale)".to_string());
    }
    let crs = if let Some(code) = raster.crs.epsg {
        Some(crs::from_epsg(code)?)
    } else if let Some(wkt) = raster
        .crs
        .wkt
        .as_deref()
        .filter(|wkt| !wkt.trim().is_empty())
    {
        Some(crs::from_reference(wkt)?)
    } else if let Some(proj4) = raster.crs.proj4.as_deref().filter(|p| !p.trim().is_empty()) {
        let crs = wbprojection::from_proj_string(proj4)
            .map_err(|e| format!("unsupported PROJ definition: {e}"))?;
        Some(crs::from_reference(&crs.to_wkt())?)
    } else {
        None
    };
    let probe = RasterProbe {
        driver: driver_name(path),
        width,
        height,
        band_count: u32::try_from(raster.bands).unwrap_or(u32::MAX),
        band_type: band_type_name(raster.data_type),
        nodata: Some(raster.nodata as f32),
        scale: 1.0,
        offset: 0.0,
        unit: None,
        mask_flags: Vec::new(),
        geotransform: [
            raster.x_min,
            raster.cell_size_x,
            0.0,
            raster.y_max(),
            0.0,
            -raster.cell_size_y,
        ],
        crs_ref: crs.as_ref().map(|c| c.wkt.clone()).unwrap_or_default(),
        block: [width, 1],
        compression: "NONE".to_string(),
        overview_count: 0,
    };
    Ok((probe, crs))
}
