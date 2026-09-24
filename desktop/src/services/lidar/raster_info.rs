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
