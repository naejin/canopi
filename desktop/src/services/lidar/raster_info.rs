//! Raster metadata read through `gdalinfo`.

use super::engine::{GdalEngine, GdalProgram};
use std::path::Path;
use std::sync::atomic::AtomicBool;

pub fn gdalinfo_json(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    raster: &Path,
) -> Result<serde_json::Value, String> {
    let output = engine.run(
        GdalProgram::Info,
        &["-json".to_string(), raster.display().to_string()],
        Some(cancel),
    )?;
    serde_json::from_str(&output.stdout).map_err(|e| format!("gdalinfo returned invalid JSON: {e}"))
}

pub fn band_nodata(info: &serde_json::Value) -> Option<f32> {
    info.get("bands")
        .and_then(|bands| bands.get(0))
        .and_then(|band| band.get("noDataValue"))
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
}

/// A raster's footprint in WGS84 `[west, south, east, north]`, from
/// `gdalinfo`'s geographic extent.
pub(crate) fn wgs84_extent(
    engine: &GdalEngine,
    path: &Path,
    cancel: &AtomicBool,
) -> Result<[f64; 4], String> {
    let output = engine.run(
        GdalProgram::Info,
        &[
            "-json".to_string(),
            "--config".to_string(),
            "GDAL_PAM_ENABLED".to_string(),
            "NO".to_string(),
            path.display().to_string(),
        ],
        Some(cancel),
    )?;
    let info: serde_json::Value = serde_json::from_str(&output.stdout)
        .map_err(|e| format!("Unreadable raster metadata: {e}"))?;
    let ring = info
        .pointer("/wgs84Extent/coordinates/0")
        .and_then(|ring| ring.as_array())
        .ok_or_else(|| "the raster has no geographic extent".to_string())?;
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for point in ring {
        let (Some(lon), Some(lat)) = (
            point.get(0).and_then(|value| value.as_f64()),
            point.get(1).and_then(|value| value.as_f64()),
        ) else {
            continue;
        };
        bounds[0] = bounds[0].min(lon);
        bounds[1] = bounds[1].min(lat);
        bounds[2] = bounds[2].max(lon);
        bounds[3] = bounds[3].max(lat);
    }
    if !bounds.iter().all(|value| value.is_finite()) {
        return Err("the raster has no geographic extent".to_string());
    }
    Ok(bounds)
}
