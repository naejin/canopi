//! Bounded display tile pyramids rendered from published numeric rasters.
//!
//! Display generation is a presentation concern: it reads published numeric
//! authority and produces XYZ PNG tiles in Web Mercator plus a fixed style.
//! Numeric results stay untouched; styles can be re-rendered later without
//! recomputing analyses.

use super::engine::{GdalEngine, GdalProgram};
use super::grid::GeoTransform;
use std::path::Path;
use std::sync::atomic::AtomicBool;

const WEB_MERCATOR_WORLD: f64 = 40075016.68557849;
const WEB_MERCATOR_HALF: f64 = 20037508.342789244;
/// Web Mercator meters-per-pixel at zoom 0 for 256px tiles.
const WEB_MERCATOR_Z0_PIXEL: f64 = WEB_MERCATOR_WORLD / 256.0;
const TILE_PIXELS: u32 = 256;
const MAX_ZOOM_CEILING: u32 = 22;
/// Bounded pyramid depth per tileset; deeper coverage arrives with the
/// scale slice.
const PYRAMID_LEVELS: u32 = 5;

#[derive(Debug, Clone)]
pub struct DisplayPyramid {
    pub path_template: String,
    pub min_zoom: u32,
    pub max_zoom: u32,
    pub bounds_3857: [f64; 4],
    pub tile_count: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DisplayProgress {
    pub completed_steps: u64,
    pub total_steps: u64,
}

fn report_progress(
    progress: Option<&dyn Fn(DisplayProgress)>,
    completed_steps: u64,
    total_steps: u64,
) {
    if let Some(report) = progress {
        report(DisplayProgress {
            completed_steps,
            total_steps,
        });
    }
}

/// A color ramp rendered by `gdaldem color-relief`.
#[derive(Debug, Clone)]
pub struct ColorRamp {
    pub style: &'static str,
    /// `(value, red, green, blue)` stops in ascending value order.
    pub stops: Vec<(f64, u8, u8, u8)>,
}

impl ColorRamp {
    pub fn style_name(&self) -> &str {
        self.style
    }

    pub fn elevation_range(min: f64, max: f64) -> Self {
        let (min, max) = if max > min {
            (min, max)
        } else {
            (min, min + 1.0)
        };
        let span = max - min;
        let stops = [
            (0.00, (222, 235, 247)),
            (0.15, (168, 198, 160)),
            (0.35, (214, 190, 120)),
            (0.55, (196, 148, 86)),
            (0.75, (150, 90, 52)),
            (1.00, (108, 56, 36)),
        ];
        Self {
            style: "elevation",
            stops: stops
                .into_iter()
                .map(|(t, rgb)| (min + t * span, rgb.0, rgb.1, rgb.2))
                .collect(),
        }
    }

    /// Fixed slope ramp in degrees; slope never uses the elevation range.
    pub fn slope_degrees() -> Self {
        Self {
            style: "slope",
            stops: vec![
                (0.0, 240, 240, 226),
                (5.0, 214, 226, 188),
                (15.0, 190, 204, 130),
                (30.0, 222, 168, 92),
                (45.0, 190, 104, 56),
                (60.0, 140, 62, 40),
                (90.0, 92, 38, 30),
            ],
        }
    }

    fn write_color_file(&self, path: &Path) -> Result<(), String> {
        let mut content = String::from("nv 0 0 0 0\n");
        for (value, r, g, b) in &self.stops {
            content.push_str(&format!("{value} {r} {g} {b}\n"));
        }
        std::fs::write(path, content)
            .map_err(|e| format!("Failed to write color ramp {}: {e}", path.display()))
    }
}

/// Render an XYZ PNG pyramid for one numeric raster into `out_dir`.
pub fn generate_pyramid(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    numeric_raster: &Path,
    nodata: Option<f32>,
    ramp: &ColorRamp,
    out_dir: &Path,
    progress: Option<&dyn Fn(DisplayProgress)>,
) -> Result<DisplayPyramid, String> {
    std::fs::create_dir_all(out_dir)
        .map_err(|e| format!("Failed to create display dir {}: {e}", out_dir.display()))?;
    let scratch = out_dir.join("scratch");
    std::fs::create_dir_all(&scratch).map_err(|e| format!("Failed to create scratch dir: {e}"))?;

    let warped = scratch.join("warped-3857.tif");
    let mut warp_args = vec![
        "-q".to_string(),
        "-t_srs".to_string(),
        "EPSG:3857".to_string(),
        "-r".to_string(),
        "bilinear".to_string(),
        "-ot".to_string(),
        "Float32".to_string(),
        "-co".to_string(),
        "TILED=YES".to_string(),
        "-co".to_string(),
        "COMPRESS=DEFLATE".to_string(),
        numeric_raster.display().to_string(),
        warped.display().to_string(),
    ];
    if let Some(nodata) = nodata {
        warp_args.push("-dstnodata".to_string());
        warp_args.push(format!("{nodata}"));
    }
    engine.run(GdalProgram::Warp, &warp_args, Some(cancel))?;

    let info = gdalinfo_json(engine, cancel, &warped)?;
    let (width, height) = raster_size(&info)?;
    let geotransform = geotransform(&info)?;
    let nodata = nodata.or_else(|| band_nodata(&info));

    let px_w = geotransform[1].abs();
    let max_zoom = if px_w > 0.0 {
        let zoom = (WEB_MERCATOR_Z0_PIXEL / px_w).log2().floor();
        zoom.clamp(0.0, MAX_ZOOM_CEILING as f64) as u32
    } else {
        0
    };
    let min_zoom = max_zoom.saturating_sub(PYRAMID_LEVELS - 1);

    let bounds = raster_bounds(&geotransform, width, height);
    let color_file = scratch.join("ramp.txt");
    ramp.write_color_file(&color_file)?;

    let zoom_grids = (min_zoom..=max_zoom)
        .map(|zoom| (zoom, ZoomGrid::for_bounds(bounds, zoom)))
        .collect::<Vec<_>>();
    let total_steps = 2 + zoom_grids
        .iter()
        .map(|(_, grid)| {
            2 + u64::from(grid.max_tx - grid.min_tx + 1) * u64::from(grid.max_ty - grid.min_ty + 1)
        })
        .sum::<u64>();
    let mut completed_steps = 2;
    report_progress(progress, completed_steps, total_steps);

    let mut tile_count = 0u64;
    let mut bytes = 0u64;
    for (zoom, grid) in zoom_grids {
        let level_png = scratch.join(format!("level-{zoom}.png"));
        // Reproject the colorized surface onto the exact XYZ tile grid so
        // tiles slice losslessly without edge stretching.
        let aligned = scratch.join(format!("aligned-{zoom}.tif"));
        engine.run(
            GdalProgram::Warp,
            &[
                "-q".to_string(),
                "-t_srs".to_string(),
                "EPSG:3857".to_string(),
                "-te".to_string(),
                format!("{}", grid.min_x),
                format!("{}", grid.min_y),
                format!("{}", grid.max_x),
                format!("{}", grid.max_y),
                "-ts".to_string(),
                format!("{}", grid.pixels_x()),
                format!("{}", grid.pixels_y()),
                "-r".to_string(),
                "bilinear".to_string(),
                "-ot".to_string(),
                "Float32".to_string(),
                "-dstnodata".to_string(),
                format!("{}", nodata.unwrap_or(-99999.0)),
                warped.display().to_string(),
                aligned.display().to_string(),
            ],
            Some(cancel),
        )?;
        completed_steps += 1;
        report_progress(progress, completed_steps, total_steps);
        engine.run(
            GdalProgram::Dem,
            &[
                "color-relief".to_string(),
                "-alpha".to_string(),
                "-q".to_string(),
                aligned.display().to_string(),
                color_file.display().to_string(),
                level_png.display().to_string(),
                "-of".to_string(),
                "PNG".to_string(),
            ],
            Some(cancel),
        )?;
        completed_steps += 1;
        report_progress(progress, completed_steps, total_steps);

        for ty in grid.min_ty..=grid.max_ty {
            for tx in grid.min_tx..=grid.max_tx {
                let tile = out_dir.join(format!("{zoom}_{tx}_{ty}.png"));
                engine.run(
                    GdalProgram::Translate,
                    &[
                        "-q".to_string(),
                        "-srcwin".to_string(),
                        format!("{}", (tx - grid.min_tx) * TILE_PIXELS),
                        format!("{}", (ty - grid.min_ty) * TILE_PIXELS),
                        format!("{TILE_PIXELS}"),
                        format!("{TILE_PIXELS}"),
                        level_png.display().to_string(),
                        tile.display().to_string(),
                    ],
                    Some(cancel),
                )?;
                tile_count += 1;
                bytes += std::fs::metadata(&tile).map(|m| m.len()).unwrap_or(0);
                completed_steps += 1;
                report_progress(progress, completed_steps, total_steps);
            }
        }
        let _ = std::fs::remove_file(&level_png);
        let _ = std::fs::remove_file(&aligned);
    }

    let _ = std::fs::remove_file(&warped);
    let _ = std::fs::remove_file(&color_file);
    let _ = std::fs::remove_dir_all(&scratch);

    Ok(DisplayPyramid {
        path_template: out_dir.join("{z}_{x}_{y}.png").display().to_string(),
        min_zoom,
        max_zoom,
        bounds_3857: bounds,
        tile_count,
        bytes,
    })
}

/// Render one small fixed-style preview PNG for the import review surface.
pub fn generate_preview(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    numeric_raster: &Path,
    nodata: Option<f32>,
    ramp: &ColorRamp,
    out_png: &Path,
) -> Result<(), String> {
    if let Some(parent) = out_png.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create preview dir: {e}"))?;
    }
    let scratch = out_png.with_extension("scratch");
    std::fs::create_dir_all(&scratch)
        .map_err(|e| format!("Failed to create preview scratch: {e}"))?;
    let warped = scratch.join("preview.tif");
    let mut warp_args = vec![
        "-q".to_string(),
        "-t_srs".to_string(),
        "EPSG:3857".to_string(),
        "-ts".to_string(),
        "512".to_string(),
        "0".to_string(),
        "-r".to_string(),
        "bilinear".to_string(),
        "-ot".to_string(),
        "Float32".to_string(),
        numeric_raster.display().to_string(),
        warped.display().to_string(),
    ];
    if let Some(nodata) = nodata {
        warp_args.push("-dstnodata".to_string());
        warp_args.push(format!("{nodata}"));
    }
    engine.run(GdalProgram::Warp, &warp_args, Some(cancel))?;
    let color_file = scratch.join("ramp.txt");
    ramp.write_color_file(&color_file)?;
    engine.run(
        GdalProgram::Dem,
        &[
            "color-relief".to_string(),
            "-alpha".to_string(),
            "-q".to_string(),
            warped.display().to_string(),
            color_file.display().to_string(),
            out_png.display().to_string(),
            "-of".to_string(),
            "PNG".to_string(),
        ],
        Some(cancel),
    )?;
    let _ = std::fs::remove_dir_all(&scratch);
    Ok(())
}

struct ZoomGrid {
    min_tx: u32,
    max_tx: u32,
    min_ty: u32,
    max_ty: u32,
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl ZoomGrid {
    fn for_bounds(bounds: [f64; 4], zoom: u32) -> Self {
        let tiles = 1u64 << zoom;
        let tile_size = WEB_MERCATOR_WORLD / tiles as f64;
        let min_tx = (((bounds[0] + WEB_MERCATOR_HALF) / tile_size).floor() as i64)
            .clamp(0, tiles as i64 - 1) as u32;
        let max_tx = (((bounds[2] + WEB_MERCATOR_HALF) / tile_size).floor() as i64)
            .clamp(0, tiles as i64 - 1) as u32;
        // XYZ Y counts from the top (north) edge of the map.
        let min_ty = (((WEB_MERCATOR_HALF - bounds[3]) / tile_size).floor() as i64)
            .clamp(0, tiles as i64 - 1) as u32;
        let max_ty = (((WEB_MERCATOR_HALF - bounds[1]) / tile_size).floor() as i64)
            .clamp(0, tiles as i64 - 1) as u32;
        let min_x = -WEB_MERCATOR_HALF + (min_tx as f64) * tile_size;
        let max_x = -WEB_MERCATOR_HALF + ((max_tx as u64 + 1) as f64) * tile_size;
        let max_y = WEB_MERCATOR_HALF - (min_ty as f64) * tile_size;
        let min_y = WEB_MERCATOR_HALF - ((max_ty as u64 + 1) as f64) * tile_size;
        Self {
            min_tx,
            max_tx,
            min_ty,
            max_ty,
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }

    fn pixels_x(&self) -> u32 {
        (self.max_tx - self.min_tx + 1) * TILE_PIXELS
    }

    fn pixels_y(&self) -> u32 {
        (self.max_ty - self.min_ty + 1) * TILE_PIXELS
    }
}

// GDAL metadata helpers remain beside their consumers below these grid tests.
#[allow(clippy::items_after_test_module)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xyz_grid_uses_the_standard_world_extent_and_origin() {
        let world = ZoomGrid::for_bounds(
            [
                -WEB_MERCATOR_HALF,
                -WEB_MERCATOR_HALF,
                WEB_MERCATOR_HALF,
                WEB_MERCATOR_HALF,
            ],
            0,
        );
        assert_eq!(
            (world.min_tx, world.max_tx, world.min_ty, world.max_ty),
            (0, 0, 0, 0)
        );
        assert!((world.min_x + WEB_MERCATOR_HALF).abs() < 0.001);
        assert!((world.max_x - WEB_MERCATOR_HALF).abs() < 0.001);

        let northwest = ZoomGrid::for_bounds([-10.0, 10.0, -1.0, 20.0], 1);
        assert_eq!((northwest.min_tx, northwest.max_tx), (0, 0));
        assert_eq!((northwest.min_ty, northwest.max_ty), (0, 0));
        assert!(northwest.min_x < 0.0);
        assert!(northwest.max_y > 0.0);
    }
}

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

fn raster_size(info: &serde_json::Value) -> Result<(u32, u32), String> {
    let size = info
        .get("size")
        .and_then(|v| v.as_array())
        .ok_or("gdalinfo JSON missing size")?;
    let width = size.first().and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let height = size.get(1).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    Ok((width, height))
}

fn geotransform(info: &serde_json::Value) -> Result<GeoTransform, String> {
    let values = info
        .get("geoTransform")
        .and_then(|v| v.as_array())
        .ok_or("gdalinfo JSON missing geoTransform")?;
    let mut gt = [0.0f64; 6];
    for (index, value) in values.iter().take(6).enumerate() {
        gt[index] = value.as_f64().unwrap_or(0.0);
    }
    Ok(gt)
}

pub fn band_nodata(info: &serde_json::Value) -> Option<f32> {
    info.get("bands")
        .and_then(|bands| bands.get(0))
        .and_then(|band| band.get("noDataValue"))
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
}

fn raster_bounds(gt: &GeoTransform, width: u32, height: u32) -> [f64; 4] {
    let min_x = gt[0];
    let max_y = gt[3];
    let max_x = gt[0] + gt[1] * width as f64;
    let min_y = gt[3] + gt[5] * height as f64;
    [
        min_x.min(max_x),
        min_y.min(max_y),
        min_x.max(max_x),
        min_y.max(max_y),
    ]
}
