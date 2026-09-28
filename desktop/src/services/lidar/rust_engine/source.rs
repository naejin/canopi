//! Reading source rasters: header probes and whole-band loads.
//!
//! A TIFF is probed from its directory and decoded strip by strip; every
//! other format `wbraster` knows is read whole, as that library works. Both
//! routes end in the same [`Loaded`] band the engine converts, and every
//! whole load first passes the library's capacity limit.

use super::super::engine::RasterProbe;
use super::super::grid::RasterGrid;
use super::super::import::validate_working_grid;
use super::crs::{self, ResolvedCrs};
use super::tiff;
use std::path::Path;
use std::sync::atomic::AtomicBool;

/// Largest non-TIFF file read whole: the capacity limit in Float32 bytes,
/// checked before the file is parsed because its grid is not known until
/// then.
const MAX_OTHER_FORMAT_BYTES: u64 = super::super::import::MAX_RAW_EXTRACTION_CELLS * 4;

/// One band in memory with its placement.
pub(super) struct Loaded {
    pub grid: RasterGrid,
    pub crs: Option<ResolvedCrs>,
    pub nodata: Option<f32>,
    pub samples: Vec<f32>,
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

/// Band 1 of any raster the engine reads, after the capacity check named
/// `operation`.
pub(super) fn load(path: &Path, operation: &str, cancel: &AtomicBool) -> Result<Loaded, String> {
    if tiff::is_tiff(path)? {
        let header = tiff::read_header(path)?;
        let probe = probe_tiff(&header)?;
        let grid = grid_of(&probe);
        validate_working_grid(&grid, operation)?;
        let crs = match &header.geo_keys {
            Some(keys) => crs::from_geokeys(keys)?,
            None => None,
        };
        let nodata = probe.nodata;
        let fill = nodata.unwrap_or(0.0);
        let samples = tiff::read_band_f32(path, &header, fill, cancel)?;
        return Ok(Loaded {
            grid,
            crs,
            nodata,
            samples,
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
    Ok(Loaded {
        grid,
        crs,
        nodata: probe.nodata,
        samples,
    })
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
    let crs_wkt = match &header.geo_keys {
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
        crs_wkt,
        block,
        compression: tiff::compression_name(header.compression_tag),
        overview_count: header.overview_count,
    })
}

fn read_other(path: &Path) -> Result<wbraster::Raster, String> {
    let bytes = std::fs::metadata(path)
        .map_err(|e| format!("Failed to inspect {}: {e}", path.display()))?
        .len();
    if bytes > MAX_OTHER_FORMAT_BYTES {
        return Err(format!(
            "{} has {bytes} bytes; a whole-raster read of this format is limited to {MAX_OTHER_FORMAT_BYTES}",
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
        crs_wkt: crs.as_ref().map(|c| c.wkt.clone()).unwrap_or_default(),
        block: [width, 1],
        compression: "NONE".to_string(),
        overview_count: 0,
    };
    Ok((probe, crs))
}
