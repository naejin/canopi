//! The engine comparison lane: the Rust engine against GDAL on the same
//! inputs, through the one seam both implement.
//!
//! Ignored by default and skipped cleanly when GDAL is not installed
//! (`CANOPI_LIDAR_GDAL_BIN`, then `PATH`). It is the standing accuracy proof
//! behind ADR 0014: probe facts, Float32 samples, the controlled and display
//! profiles, point transforms and statistics must agree within the
//! tolerances stated beside each assertion. Run with
//! `cargo test -p canopi-desktop --lib rust_engine::comparison -- --ignored --nocapture`.

use super::super::engine::{RasterEngine, RasterGeoref, RasterInput, RasterProbe};
use super::super::gdal_engine::{GdalEngine, GdalProgram};
use super::super::grid::RasterGrid;
use super::super::prepared_raster::PreparedRaster;
use super::RustRasterEngine;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

fn cancel() -> AtomicBool {
    AtomicBool::new(false)
}

/// One deviation, kept for the printed report.
struct Report {
    lines: Vec<String>,
}

impl Report {
    fn note(&mut self, line: String) {
        println!("{line}");
        self.lines.push(line);
    }
}

fn authored(x: u32, y: u32) -> f32 {
    match (x % 23, y % 17) {
        (0, 0) => -9999.0,
        (1, 1) => f32::NAN,
        (2, 2) => f32::INFINITY,
        (3, 3) => 0.0,
        (4, 4) => -12.5,
        _ => ((x as f32) * 0.75 - (y as f32) * 1.25).sin() * 500.0 + 150.0,
    }
}

fn valid(value: f32, nodata: Option<f32>) -> bool {
    value.is_finite() && nodata.is_none_or(|marker| value != marker)
}

/// Samples agree when both are NaN or within `tolerance`.
fn max_sample_deviation(a: &[f32], b: &[f32]) -> (f64, usize) {
    assert_eq!(a.len(), b.len(), "sample counts");
    let mut max = 0f64;
    let mut nan_mismatch = 0usize;
    for (x, y) in a.iter().zip(b) {
        match (x.is_nan(), y.is_nan()) {
            (true, true) => {}
            (false, false) => max = max.max((f64::from(*x) - f64::from(*y)).abs()),
            _ => nan_mismatch += 1,
        }
    }
    (max, nan_mismatch)
}

fn read_controlled(path: &Path, grid: &RasterGrid, nodata: Option<f32>) -> (Vec<f32>, Vec<u8>) {
    let mut reader =
        PreparedRaster::open_committed(path, grid, nodata).expect("controlled COG opens");
    let cells = grid.width as usize * grid.height as usize;
    let mut samples = vec![0f32; cells];
    let mut valid = vec![0u8; cells];
    reader
        .scan(&cancel(), |window, window_samples, window_valid| {
            for row in 0..window.height {
                for column in 0..window.width {
                    let target = ((window.y + row) as usize) * grid.width as usize
                        + (window.x + column) as usize;
                    let source = (row * window.width + column) as usize;
                    samples[target] = window_samples[source];
                    valid[target] = window_valid[source];
                }
            }
            Ok(())
        })
        .expect("controlled COG scans");
    (samples, valid)
}

/// Which probe facts a text format leaves to the driver: GDAL types AAIGrid
/// by inspecting the values and XYZ has no NoData notion at all.
#[derive(Clone, Copy)]
struct Facts {
    band_type: bool,
    nodata: bool,
}

const TIFF_FACTS: Facts = Facts {
    band_type: true,
    nodata: true,
};

fn assert_probe_facts(label: &str, gdal: &RasterProbe, rust: &RasterProbe, facts: Facts) {
    assert_eq!(
        (gdal.width, gdal.height),
        (rust.width, rust.height),
        "{label}: dims"
    );
    assert_eq!(gdal.band_count, rust.band_count, "{label}: bands");
    if facts.band_type {
        assert_eq!(gdal.band_type, rust.band_type, "{label}: band type");
    }
    if facts.nodata {
        assert_eq!(
            gdal.nodata.map(f32::to_bits),
            rust.nodata.map(f32::to_bits),
            "{label}: nodata"
        );
    }
    for (index, (a, b)) in gdal.geotransform.iter().zip(&rust.geotransform).enumerate() {
        assert!(
            (a - b).abs() <= 1e-9 * a.abs().max(1.0),
            "{label}: geotransform[{index}] {a} vs {b}"
        );
    }
    assert_eq!(
        gdal_crs_class(&gdal.crs_ref),
        super::super::analyses::crs_class(&rust.crs_ref),
        "{label}: CRS class ({} vs {})",
        gdal.crs_ref,
        rust.crs_ref
    );
    // A tiled file's block is a fact of the file; for strips GDAL reports its
    // own access block (one row for a single whole-image strip), so only the
    // width is compared.
    if gdal.block[0] != gdal.width {
        assert_eq!(gdal.block, rust.block, "{label}: block");
    } else {
        assert_eq!(gdal.block[0], rust.block[0], "{label}: strip width");
    }
    assert_eq!(gdal.compression, rust.compression, "{label}: compression");
    assert_eq!(
        gdal.overview_count, rust.overview_count,
        "{label}: overviews"
    );
    assert_eq!(gdal.scale, rust.scale, "{label}: scale");
    assert_eq!(gdal.offset, rust.offset, "{label}: offset");
}

/// Compare every operation on one georeferenced source both engines read.
fn compare_source(
    report: &mut Report,
    label: &str,
    source: &Path,
    dir: &Path,
    gdal: &GdalEngine,
    rust: &RustRasterEngine,
    facts: Facts,
) {
    let c = cancel();
    let gdal_probe = gdal.probe(source, &c).expect("GDAL probes");
    let rust_probe = rust.probe(source, &c).expect("the Rust engine probes");
    assert_probe_facts(label, &gdal_probe, &rust_probe, facts);
    let grid = RasterGrid {
        width: rust_probe.width,
        height: rust_probe.height,
        geotransform: rust_probe.geotransform,
    };
    let has_crs = !rust_probe.crs_ref.is_empty();

    if has_crs {
        let a = gdal.wgs84_extent(source, &c).expect("GDAL extent");
        let b = rust.wgs84_extent(source, &c).expect("Rust extent");
        let deviation = a
            .iter()
            .zip(&b)
            .map(|(x, y)| (x - y).abs())
            .fold(0f64, f64::max);
        report.note(format!(
            "{label}: WGS84 extent max deviation {deviation:.3e} deg"
        ));
        assert!(deviation <= 1e-6, "{label}: extent {a:?} vs {b:?}");
    }

    let gdal_samples = gdal
        .read_f32(source, grid.width, grid.height, &c)
        .expect("GDAL reads Float32");
    let rust_samples = rust
        .read_f32(source, grid.width, grid.height, &c)
        .expect("the Rust engine reads Float32");
    let (deviation, nan_mismatch) = max_sample_deviation(&gdal_samples, &rust_samples);
    report.note(format!(
        "{label}: Float32 samples max deviation {deviation:.3e}, NaN mismatches {nan_mismatch}"
    ));
    assert!(
        deviation <= 1e-4 && nan_mismatch == 0,
        "{label}: samples differ"
    );

    // GDAL counts ±inf as values (its max and mean become inf); Canopi's
    // validity rule is finite and not NoData, so statistics are compared only
    // on inputs without infinities.
    if rust_samples.iter().any(|value| value.is_infinite()) {
        report.note(format!(
            "{label}: statistics not compared (the fixture holds ±inf, which GDAL counts)"
        ));
    } else {
        let gdal_stats = gdal.statistics(source, &c).expect("GDAL statistics");
        let rust_stats = rust.statistics(source, &c).expect("Rust statistics");
        let relative = |a: f64, b: f64| (a - b).abs() / a.abs().max(1e-9);
        report.note(format!(
        "{label}: statistics min {:.3e} max {:.3e} mean {:.3e} std {:.3e} valid% {:.3e} (relative)",
        relative(gdal_stats.minimum, rust_stats.minimum),
        relative(gdal_stats.maximum, rust_stats.maximum),
        relative(gdal_stats.mean, rust_stats.mean),
        relative(gdal_stats.std_dev, rust_stats.std_dev),
        (gdal_stats.valid_percent - rust_stats.valid_percent).abs()
    ));
        // gdalinfo prints 14 significant digits of its double accumulators.
        assert!(
            relative(gdal_stats.minimum, rust_stats.minimum) <= 1e-9,
            "{label}: min"
        );
        assert!(
            relative(gdal_stats.maximum, rust_stats.maximum) <= 1e-9,
            "{label}: max"
        );
        assert!(
            relative(gdal_stats.mean, rust_stats.mean) <= 1e-9,
            "{label}: mean"
        );
        assert!(
            relative(gdal_stats.std_dev, rust_stats.std_dev) <= 1e-7,
            "{label}: std"
        );
        assert!(
            (gdal_stats.valid_percent - rust_stats.valid_percent).abs() <= 0.01,
            "{label}: valid%"
        );
    }

    // The controlled profile from each engine, read by the production reader.
    let crs = if has_crs {
        rust_probe.crs_ref.clone()
    } else {
        "EPSG:3857".to_string()
    };
    let georef = RasterGeoref {
        grid: &grid,
        crs: &crs,
    };
    let nodata = rust_probe.nodata;
    let gdal_cog = dir.join(format!("{label}-gdal-controlled.tif"));
    let rust_cog = dir.join(format!("{label}-rust-controlled.tif"));
    gdal.write_controlled_cog(
        RasterInput::File(source),
        &gdal_cog,
        Some(georef),
        nodata,
        &c,
    )
    .expect("GDAL writes the controlled COG");
    rust.write_controlled_cog(
        RasterInput::File(source),
        &rust_cog,
        Some(georef),
        nodata,
        &c,
    )
    .expect("the Rust engine writes the controlled COG");
    let (a, a_valid) = read_controlled(&gdal_cog, &grid, nodata);
    let (b, b_valid) = read_controlled(&rust_cog, &grid, nodata);
    let (deviation, nan_mismatch) = max_sample_deviation(&a, &b);
    assert!(
        deviation == 0.0 && nan_mismatch == 0 && a_valid == b_valid,
        "{label}: controlled COGs differ (max {deviation}, NaN mismatches {nan_mismatch})"
    );
    report.note(format!(
        "{label}: controlled COG samples identical, validity identical"
    ));
    // Each engine reads the other's controlled COG the same way.
    let cross = rust.probe(&gdal_cog, &c).expect("Rust probes GDAL's COG");
    let cross_back = gdal.probe(&rust_cog, &c).expect("GDAL probes the Rust COG");
    assert_probe_facts(
        &format!("{label} cross-probe"),
        &cross_back,
        &cross,
        TIFF_FACTS,
    );

    // The display profile: full resolution identical, overviews within tolerance.
    let gdal_display = dir.join(format!("{label}-gdal-display.tif"));
    let rust_display = dir.join(format!("{label}-rust-display.tif"));
    gdal.write_display_cog(
        RasterInput::File(&gdal_cog),
        &gdal_display,
        None,
        nodata,
        &c,
    )
    .expect("GDAL writes the display COG");
    rust.write_display_cog(
        RasterInput::File(&rust_cog),
        &rust_display,
        None,
        nodata,
        &c,
    )
    .expect("the Rust engine writes the display COG");
    let a = rust
        .read_f32(&gdal_display, grid.width, grid.height, &c)
        .expect("Rust reads GDAL's display COG");
    let b = gdal
        .read_f32(&rust_display, grid.width, grid.height, &c)
        .expect("GDAL reads the Rust display COG");
    let (deviation, nan_mismatch) = max_sample_deviation(&a, &b);
    assert!(
        deviation == 0.0 && nan_mismatch == 0,
        "{label}: display full-resolution samples differ"
    );
    let a_probe = gdal
        .probe(&rust_display, &c)
        .expect("GDAL probes the Rust display COG");
    let b_probe = rust
        .probe(&gdal_display, &c)
        .expect("Rust probes GDAL's display COG");
    assert_eq!(
        a_probe.overview_count, b_probe.overview_count,
        "{label}: overview count"
    );
    assert_eq!(a_probe.compression, "DEFLATE");
    assert_eq!(a_probe.block, [256, 256]);
    compare_overviews(
        report,
        label,
        &gdal_display,
        &rust_display,
        nodata,
        &rust_samples,
        &grid,
    );
}

/// Overview samples: both engines average the valid samples of each block in
/// double precision and store Float32, so cells agree bit for bit except
/// where the source block holds a NaN or ±inf. GDAL propagates a non-finite
/// sample into the average; Canopi averages the finite samples, which is the
/// display rule (`display-cog-deflate256-v1`). Those "poisoned" cells are
/// counted and reported; every other cell must agree within 1e-3.
fn compare_overviews(
    report: &mut Report,
    label: &str,
    gdal_display: &Path,
    rust_display: &Path,
    nodata: Option<f32>,
    full: &[f32],
    grid: &RasterGrid,
) {
    let level_samples = |path: &Path| -> Vec<(u32, u32, Vec<f32>)> {
        let bytes = std::fs::read(path).expect("display COG bytes");
        let layout = wbgeotiff::GeoTiff::parse_cog_layout(&bytes[..(4 << 20).min(bytes.len())])
            .expect("display COG layout");
        layout
            .levels
            .iter()
            .skip(1)
            .map(|level| {
                let mut samples = vec![f32::NAN; (level.width * level.height) as usize];
                for ty in 0..level.tiles_y {
                    for tx in 0..level.tiles_x {
                        let (offset, count) = level.tile_range(tx, ty).expect("tile range");
                        let tile = level
                            .decode_tile_f64(&bytes[offset as usize..(offset + count) as usize])
                            .expect("tile decodes");
                        for row in 0..level.tile_height {
                            let y = ty * level.tile_height + row;
                            if y >= level.height {
                                break;
                            }
                            for column in 0..level.tile_width {
                                let x = tx * level.tile_width + column;
                                if x >= level.width {
                                    break;
                                }
                                samples[(y * level.width + x) as usize] =
                                    tile[(row * level.tile_width + column) as usize] as f32;
                            }
                        }
                    }
                }
                (level.width, level.height, samples)
            })
            .collect()
    };
    let a = level_samples(gdal_display);
    let b = level_samples(rust_display);
    assert_eq!(a.len(), b.len(), "{label}: overview levels");
    // Cells whose source block holds a non-finite sample, level by level with
    // the writer's own block mapping.
    let mut poisoned: Vec<bool> = full.iter().map(|value| !value.is_finite()).collect();
    let (mut sw, mut sh) = (grid.width as usize, grid.height as usize);
    for (index, ((aw, ah, a), (bw, bh, b))) in a.iter().zip(&b).enumerate() {
        assert_eq!((aw, ah), (bw, bh), "{label}: overview {index} size");
        let (dw, dh) = (*aw as usize, *ah as usize);
        let mut next = vec![false; dw * dh];
        for dy in 0..dh {
            let y0 = dy * sh / dh;
            let y1 = ((dy + 1) * sh / dh).min(sh).max(y0 + 1);
            for dx in 0..dw {
                let x0 = dx * sw / dw;
                let x1 = ((dx + 1) * sw / dw).min(sw).max(x0 + 1);
                next[dy * dw + dx] = (y0..y1).any(|y| (x0..x1).any(|x| poisoned[y * sw + x]));
            }
        }
        poisoned = next;
        (sw, sh) = (dw, dh);
        let mut max = 0f64;
        let mut disagreements = 0usize;
        let mut poisoned_cells = 0usize;
        for (index, (x, y)) in a.iter().zip(b).enumerate() {
            if poisoned[index] {
                poisoned_cells += 1;
                continue;
            }
            match (valid(*x, nodata), valid(*y, nodata)) {
                (true, true) => {
                    let deviation = (f64::from(*x) - f64::from(*y)).abs();
                    if deviation > 1e-3 * f64::from(x.abs().max(1.0)) {
                        disagreements += 1;
                    }
                    max = max.max(deviation);
                }
                (false, false) => {}
                _ => disagreements += 1,
            }
        }
        report.note(format!(
            "{label}: overview {} ({aw}x{ah}) max deviation {max:.3e}, {disagreements} cells beyond tolerance, {poisoned_cells} cells with non-finite sources not compared",
            index + 1
        ));
        assert_eq!(
            disagreements,
            0,
            "{label}: overview {} disagrees",
            index + 1
        );
    }
}

/// The class of the WKT2 gdalinfo reports, in the catalogue's vocabulary.
fn gdal_crs_class(wkt: &str) -> &'static str {
    let wkt = wkt.trim_start();
    if wkt.starts_with("GEOGCRS[") {
        super::super::analyses::CRS_GEOGRAPHIC
    } else if wkt.contains("METHOD[\"Popular Visualisation Pseudo Mercator\"") {
        super::super::analyses::CRS_PROJECTED_OTHER
    } else if wkt.starts_with("PROJCRS[") && wkt.contains("LENGTHUNIT[\"metre\",1]") {
        super::super::analyses::CRS_PROJECTED_METRE
    } else {
        "unknown"
    }
}

/// Point transforms on a 9×9 lon/lat grid inside each table row's area of
/// use (its inner 80%), in both directions, GDAL given the row's own PROJ
/// definition, so the same Helmert shift whatever grids the machine's PROJ
/// holds: forward within 1e-3 m, inverse within 1e-7 deg. How far PROJ's own
/// choice of operation sits is the reference points' business
/// (`crs::tests`).
fn compare_transforms(report: &mut Report, gdal: &GdalEngine, rust: &RustRasterEngine) {
    let c = cancel();
    for row in super::crs_table::ROWS {
        let code = &format!("EPSG:{}", row.code);
        let [lon_min, lat_min, lon_max, lat_max] = row.area;
        let mut geographic = Vec::new();
        for i in 0..9 {
            for j in 0..9 {
                // Inset by a tenth, as the reference grids are: at an area's
                // corners PROJ may have no shift to take.
                let along = |n: i32| 0.1 + 0.8 * f64::from(n) / 8.0;
                geographic.push((
                    lon_min + (lon_max - lon_min) * along(i),
                    lat_min + (lat_max - lat_min) * along(j),
                ));
            }
        }
        let a = gdal
            .transform_points("EPSG:4326", row.proj, &geographic, &c)
            .expect("GDAL forward");
        let b = rust
            .transform_points("EPSG:4326", code, &geographic, &c)
            .expect("Rust forward");
        let mut forward = 0f64;
        let mut projected = Vec::new();
        for (index, (x, y)) in a.iter().zip(&b).enumerate() {
            let (Some(x), Some(y)) = (x, y) else {
                panic!("{code}: point {index} placed by one engine only ({x:?} vs {y:?})");
            };
            forward = forward.max((x.0 - y.0).abs().max((x.1 - y.1).abs()));
            projected.push(*x);
        }
        let a = gdal
            .transform_points(row.proj, "EPSG:4326", &projected, &c)
            .expect("GDAL inverse");
        let b = rust
            .transform_points(code, "EPSG:4326", &projected, &c)
            .expect("Rust inverse");
        let mut inverse = 0f64;
        for (x, y) in a.iter().zip(&b) {
            let (Some(x), Some(y)) = (x, y) else {
                panic!("{code}: inverse placed by one engine only");
            };
            inverse = inverse.max((x.0 - y.0).abs().max((x.1 - y.1).abs()));
        }
        report.note(format!(
            "{code}: forward max deviation {forward:.3e} m over {} points in [{lon_min}, {lon_max}]x[{lat_min}, {lat_max}], inverse {inverse:.3e} deg",
            geographic.len()
        ));
        assert!(forward <= 1e-3, "{code}: forward deviation {forward} m");
        assert!(inverse <= 1e-7, "{code}: inverse deviation {inverse} deg");
    }
    // Outside a UTM zone the transverse Mercator series diverges from PROJ's
    // extended algorithm; recorded, not asserted, so the ADR's caveat has numbers.
    let mut points = Vec::new();
    for offset in [0.0, 3.0, 6.0, 9.0, 12.0, 15.0] {
        points.push((9.0 + offset, 48.0));
    }
    let a = gdal
        .transform_points("EPSG:4326", "EPSG:32632", &points, &c)
        .expect("GDAL forward");
    let b = rust
        .transform_points("EPSG:4326", "EPSG:32632", &points, &c)
        .expect("Rust forward");
    for ((lon, _), (x, y)) in points.iter().zip(a.iter().zip(&b)) {
        let (Some(x), Some(y)) = (x, y) else { continue };
        report.note(format!(
            "EPSG:32632 at {:.0} deg from the central meridian: deviation {:.3e} m (not asserted)",
            lon - 9.0,
            (x.0 - y.0).abs().max((x.1 - y.1).abs())
        ));
    }
}

fn write_raw(dir: &Path, name: &str, width: u32, height: u32) -> PathBuf {
    let values: Vec<f32> = (0..height)
        .flat_map(|y| (0..width).map(move |x| authored(x, y)))
        .collect();
    let raw = dir.join(format!("{name}.raw"));
    super::super::import::write_f32_raw(&raw, &values).expect("raw fixture");
    std::fs::write(
        raw.with_extension("hdr"),
        format!(
            "ENVI\nsamples = {width}\nlines = {height}\nbands = 1\ndata type = 4\nbyte order = 0\nheader offset = 0\n"
        ),
    )
    .expect("ENVI header");
    raw
}

/// GDAL-authored fixtures: one Float32 base and its layout and type variants.
fn gdal_fixtures(dir: &Path, gdal: &GdalEngine) -> Vec<(String, PathBuf, Facts)> {
    let c = cancel();
    let (width, height) = (300u32, 260u32);
    let raw = write_raw(dir, "base", width, height);
    let base = dir.join("float32-tiled.tif");
    let placement = [
        "-a_srs",
        "EPSG:2154",
        "-a_ullr",
        "444999.75",
        "6806000.25",
        "445149.75",
        "6805870.25",
        "-a_nodata",
        "-9999",
    ];
    let translate = |extra: &[&str], input: &Path, output: &Path| {
        let mut args: Vec<String> = ["-q", "-of", "GTiff"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        args.extend(extra.iter().map(|s| s.to_string()));
        args.push(input.display().to_string());
        args.push(output.display().to_string());
        gdal.run(GdalProgram::Translate, &args, Some(&c))
            .unwrap_or_else(|error| panic!("{} converts: {error}", output.display()));
    };
    let mut args: Vec<&str> = placement.to_vec();
    args.extend([
        "-co",
        "TILED=YES",
        "-co",
        "COMPRESS=DEFLATE",
        "-co",
        "PREDICTOR=3",
    ]);
    translate(&args, &raw, &base);
    let mut fixtures = vec![("float32-tiled".to_string(), base.clone(), TIFF_FACTS)];
    let variants: [(&str, &[&str]); 6] = [
        (
            "float32-striped",
            &["-co", "TILED=NO", "-co", "BLOCKYSIZE=32"],
        ),
        (
            "int16-lzw-predictor2",
            &["-ot", "Int16", "-co", "COMPRESS=LZW", "-co", "PREDICTOR=2"],
        ),
        ("byte", &["-ot", "Byte", "-co", "TILED=YES"]),
        ("uint32-bigendian", &["-ot", "UInt32", "-co", "ENDIAN=BIG"]),
        (
            "float64-bigendian-deflate",
            &[
                "-ot",
                "Float64",
                "-co",
                "ENDIAN=BIG",
                "-co",
                "COMPRESS=DEFLATE",
                "-co",
                "TILED=YES",
            ],
        ),
        ("packbits", &["-co", "COMPRESS=PACKBITS"]),
    ];
    for (name, extra) in variants {
        let output = dir.join(format!("{name}.tif"));
        translate(extra, &base, &output);
        fixtures.push((name.to_string(), output, TIFF_FACTS));
    }
    // A user-defined Lambert CRS spelled out without a registry code, as IGN
    // tiles carry it.
    let user_defined = dir.join("user-defined-lambert.tif");
    translate(
        &[
            "-a_srs",
            "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs",
            "-co",
            "TILED=YES",
        ],
        &base,
        &user_defined,
    );
    fixtures.push(("user-defined-lambert".to_string(), user_defined, TIFF_FACTS));
    // Text formats: Esri ASCII and XYZ (which has no NoData notion in GDAL, so
    // its NoData fact is not compared). Neither carries a CRS: the Rust engine
    // reads one from GeoTIFF keys only (A8).
    let (aw, ah) = (6u32, 4u32);
    let mut ascii = format!(
        "ncols {aw}\nnrows {ah}\nxllcorner 600000\nyllcorner 6000000\ncellsize 25\nNODATA_value -1\n"
    );
    let mut xyz = String::new();
    for y in 0..ah {
        let mut row = Vec::new();
        for x in 0..aw {
            let value = if (x, y) == (2, 1) {
                -1.0
            } else {
                f32::from(x as u8) * 1.5 + f32::from(y as u8)
            };
            row.push(format!("{value}"));
            xyz.push_str(&format!(
                "{} {} {value}\n",
                600000.0 + 25.0 * (x as f64 + 0.5),
                6000000.0 + 25.0 * (ah as f64 - y as f64 - 0.5)
            ));
        }
        ascii.push_str(&row.join(" "));
        ascii.push('\n');
    }
    let asc = dir.join("grid.asc");
    std::fs::write(&asc, ascii).expect("asc fixture");
    fixtures.push((
        "esri-ascii".to_string(),
        asc,
        Facts {
            band_type: false,
            nodata: true,
        },
    ));
    let xyz_path = dir.join("grid.xyz");
    std::fs::write(&xyz_path, xyz).expect("xyz fixture");
    fixtures.push((
        "xyz".to_string(),
        xyz_path,
        Facts {
            band_type: false,
            nodata: false,
        },
    ));
    fixtures
}

fn ign_fixture() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("CANOPI_LIDAR_E2E_FIXTURE") {
        return Some(PathBuf::from(explicit)).filter(|path| path.is_file());
    }
    let downloads = std::env::var_os("HOME")
        .map(PathBuf::from)?
        .join("Downloads");
    let candidates = std::fs::read_dir(&downloads).ok()?;
    for entry in candidates.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("LHD_FXX_") && name.contains("_MNT_") {
            let file = entry.path().join(&name);
            if file.is_file() {
                return Some(file);
            }
        }
    }
    None
}

#[test]
#[ignore = "cross-checks the Rust engine against GDAL (gdalinfo, gdal_translate, gdaltransform on PATH or CANOPI_LIDAR_GDAL_BIN); skipped cleanly without GDAL"]
fn the_rust_engine_matches_gdal_on_the_same_inputs() {
    let dir = crate::test_scratch::TestScratch::new("engine-comparison");
    let gdal_logs = dir.join("gdal-logs");
    std::fs::create_dir_all(&gdal_logs).expect("GDAL log dir");
    let gdal = GdalEngine::in_dir(gdal_logs);
    let gdal_version = match gdal.version() {
        Ok(version) => version,
        Err(reason) => {
            println!("skipped: {reason}");
            return;
        }
    };
    let rust = RustRasterEngine;
    let mut report = Report { lines: Vec::new() };
    report.note(format!(
        "comparing {} with {gdal_version}",
        rust.version().expect("engine version")
    ));

    for (label, path, facts) in gdal_fixtures(&dir, &gdal) {
        compare_source(&mut report, &label, &path, &dir, &gdal, &rust, facts);
    }
    match ign_fixture() {
        Some(fixture) => {
            report.note(format!("IGN fixture: {}", fixture.display()));
            compare_source(
                &mut report,
                "ign-mnt",
                &fixture,
                &dir,
                &gdal,
                &rust,
                TIFF_FACTS,
            );
        }
        None => report.note("IGN fixture: not present, skipped".to_string()),
    }
    compare_transforms(&mut report, &gdal, &rust);

    println!("\n=== engine comparison report ===");
    for line in &report.lines {
        println!("{line}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}
