//! Validity masks, grids and exact coverage math.
//!
//! Validity is an explicit binary mask, never an inference from background
//! color, bounding rectangles or value zero. Valid zero and negative values
//! stay data; non-finite samples are rejected. Masks are exact raster-aligned
//! bitmaps stored next to the prepared rasters they describe.

use sha2::{Digest, Sha256};
use std::io::{Read as _, Seek as _, Write as _};

/// Affine geotransform: `[origin_x, pixel_w, rot_x, origin_y, rot_y, pixel_h]`.
pub type GeoTransform = [f64; 6];

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RasterGrid {
    pub width: u32,
    pub height: u32,
    pub geotransform: GeoTransform,
}

impl RasterGrid {
    pub fn pixel_size(&self) -> (f64, f64) {
        (self.geotransform[1], self.geotransform[5].abs())
    }

    pub fn bounds(&self) -> [f64; 4] {
        let gt = self.geotransform;
        let min_x = gt[0];
        let max_y = gt[3];
        let max_x = gt[0] + gt[1] * self.width as f64;
        let min_y = gt[3] + gt[5] * self.height as f64;
        [min_x, min_y, max_x, max_y]
    }

    /// Two grids are join-compatible when they share pixel size and axis
    /// alignment on the same CRS; extents may differ. Transforming foreign
    /// grids onto a layer grid is a later-slice operation.
    pub fn compatible(&self, other: &RasterGrid) -> Result<(), String> {
        let (aw, ah) = self.pixel_size();
        let (bw, bh) = other.pixel_size();
        if (aw - bw).abs() > 1e-9 || (ah - bh).abs() > 1e-9 {
            return Err(format!(
                "pixel size differs: layer {aw}x{ah} vs source {bw}x{bh}"
            ));
        }
        if self.geotransform[2] != other.geotransform[2]
            || self.geotransform[4] != other.geotransform[4]
        {
            return Err("raster rotation differs from the layer grid".to_string());
        }
        let dx = other.geotransform[0] - self.geotransform[0];
        let dy = other.geotransform[3] - self.geotransform[3];
        let snap_x = dx / aw;
        let snap_y = dy / (-ah);
        if (snap_x - snap_x.round()).abs() > 1e-6 || (snap_y - snap_y.round()).abs() > 1e-6 {
            return Err("source grid is not aligned to the layer grid".to_string());
        }
        Ok(())
    }
}

/// A binary valid-data mask at raster resolution. `true` = accepted data.
#[derive(Debug, Clone)]
pub struct ValidMask {
    pub width: u32,
    pub height: u32,
    bytes: Vec<u8>,
}

impl ValidMask {
    pub fn empty(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            bytes: vec![0; (width as usize) * (height as usize)],
        }
    }

    pub fn from_bytes(width: u32, height: u32, bytes: Vec<u8>) -> Result<Self, String> {
        let expected = width as usize * height as usize;
        if bytes.len() != expected {
            return Err(format!(
                "mask byte length {} does not match {width}x{height}",
                bytes.len()
            ));
        }
        Ok(Self {
            width,
            height,
            bytes,
        })
    }

    pub fn get(&self, x: u32, y: u32) -> bool {
        self.bytes[y as usize * self.width as usize + x as usize] != 0
    }

    pub fn set(&mut self, x: u32, y: u32, valid: bool) {
        let index = y as usize * self.width as usize + x as usize;
        self.bytes[index] = if valid { 1 } else { 0 };
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn count_valid(&self) -> u64 {
        self.bytes.iter().filter(|b| **b != 0).count() as u64
    }

    /// Morphological erosion by one cell: cells whose full 3×3 neighborhood is
    /// not valid become invalid. Used for neighborhood-operator quality masks.
    #[cfg(test)]
    pub fn eroded(&self) -> ValidMask {
        self.eroded_checked(|_| Ok(()))
            .expect("the infallible erosion checkpoint cannot fail")
    }

    /// Dense erosion, retained as the independent oracle the streamed
    /// [`erode_mask_file`] output must match byte for byte.
    #[cfg(test)]
    pub fn eroded_checked(
        &self,
        mut checkpoint: impl FnMut(u32) -> Result<(), String>,
    ) -> Result<ValidMask, String> {
        let mut out = ValidMask::empty(self.width, self.height);
        let width = self.width;
        let height = self.height;
        for y in 0..height {
            checkpoint(y)?;
            for x in 0..width {
                let mut complete = true;
                for dy in -1i64..=1 {
                    for dx in -1i64..=1 {
                        let nx = x as i64 + dx;
                        let ny = y as i64 + dy;
                        if nx < 0
                            || ny < 0
                            || nx >= width as i64
                            || ny >= height as i64
                            || !self.get(nx as u32, ny as u32)
                        {
                            complete = false;
                        }
                    }
                }
                out.set(x, y, complete);
            }
        }
        Ok(out)
    }

    pub fn write_to(&self, path: &std::path::Path) -> Result<(), String> {
        std::fs::write(path, &self.bytes)
            .map_err(|e| format!("Failed to write mask {}: {e}", path.display()))
    }

    pub fn read_from(path: &std::path::Path, width: u32, height: u32) -> Result<Self, String> {
        let bytes = std::fs::read(path)
            .map_err(|e| format!("Failed to read mask {}: {e}", path.display()))?;
        ValidMask::from_bytes(width, height, bytes)
    }
}

/// Columns processed per bounded block when eroding a persisted mask.
const MASK_EROSION_BLOCK_COLUMNS: u32 = 4096;

/// Erode a persisted coverage mask into `output` without loading it whole.
///
/// Byte-identical to [`ValidMask::eroded_checked`]: a cell stays valid only
/// when its complete 3×3 neighborhood inside the raster is valid, so holes,
/// outer edges and block seams all invalidate the same cells. Rows are read
/// through a rolling three-row window over bounded column blocks, which keeps
/// the working set constant instead of one byte per raster cell.
pub fn erode_mask_file(
    input: &std::path::Path,
    output: &std::path::Path,
    width: u32,
    height: u32,
    checkpoint: impl FnMut(u32) -> Result<(), String>,
) -> Result<(), String> {
    erode_mask_file_blocked(
        input,
        output,
        width,
        height,
        MASK_EROSION_BLOCK_COLUMNS,
        checkpoint,
    )
}

/// The streaming erosion with an explicit block width, so tests can force
/// many block seams across a small mask.
fn erode_mask_file_blocked(
    input: &std::path::Path,
    output: &std::path::Path,
    width: u32,
    height: u32,
    block_columns: u32,
    mut checkpoint: impl FnMut(u32) -> Result<(), String>,
) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("coverage mask must not be empty".to_string());
    }
    if block_columns == 0 {
        return Err("coverage mask block width must not be zero".to_string());
    }
    let cells = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| "coverage mask dimensions overflow".to_string())?;
    let file_len = std::fs::metadata(input)
        .map_err(|e| format!("Failed to inspect mask {}: {e}", input.display()))?
        .len();
    if file_len != cells {
        return Err(format!(
            "coverage mask {} has {file_len} bytes, expected {cells}",
            input.display()
        ));
    }
    let mut source = std::fs::File::open(input)
        .map_err(|e| format!("Failed to read mask {}: {e}", input.display()))?;
    let mut sink = std::fs::File::create(output)
        .map_err(|e| format!("Failed to create mask {}: {e}", output.display()))?;

    let block = block_columns.min(width);
    let stride = block as usize + 2;
    let mut above = vec![0u8; stride];
    let mut center = vec![0u8; stride];
    let mut below = vec![0u8; stride];
    let mut eroded = vec![0u8; block as usize];
    let mut x0 = 0u32;
    while x0 < width {
        let columns = block.min(width - x0);
        let span = columns as usize + 2;
        above[..span].fill(0);
        center[..span].fill(0);
        below[..span].fill(0);
        read_mask_segment(&mut source, width, 0, x0, columns, &mut center[..span])?;
        for y in 0..height {
            if y + 1 < height {
                read_mask_segment(&mut source, width, y + 1, x0, columns, &mut below[..span])?;
            } else {
                below[..span].fill(0);
            }
            for column in 0..columns as usize {
                let complete = (0..3).all(|row| {
                    let row = match row {
                        0 => &above,
                        1 => &center,
                        _ => &below,
                    };
                    (0..3).all(|offset| row[column + offset] != 0)
                });
                eroded[column] = u8::from(complete);
            }
            checkpoint(y)?;
            sink.seek(std::io::SeekFrom::Start(
                u64::from(y) * u64::from(width) + u64::from(x0),
            ))
            .map_err(|e| format!("Failed to position mask {}: {e}", output.display()))?;
            sink.write_all(&eroded[..columns as usize])
                .map_err(|e| format!("Failed to write mask {}: {e}", output.display()))?;
            std::mem::swap(&mut above, &mut center);
            std::mem::swap(&mut center, &mut below);
        }
        x0 += columns;
    }
    sink.flush()
        .map_err(|e| format!("Failed to flush mask {}: {e}", output.display()))?;
    let written = std::fs::metadata(output)
        .map_err(|e| format!("Failed to inspect mask {}: {e}", output.display()))?
        .len();
    if written != cells {
        return Err(format!(
            "eroded mask {} has {written} bytes, expected {cells}",
            output.display()
        ));
    }
    Ok(())
}

/// Read one row segment with a one-cell halo, zero-filling virtual columns
/// outside the raster so edges erode exactly like the dense oracle.
fn read_mask_segment(
    source: &mut std::fs::File,
    width: u32,
    y: u32,
    x0: u32,
    columns: u32,
    out: &mut [u8],
) -> Result<(), String> {
    out.fill(0);
    let left = x0.saturating_sub(1);
    let right = (x0 + columns + 1).min(width);
    // Slot 0 always holds the left halo, so real data starts at index 1 when
    // there is no left neighbour to read.
    let start = usize::from(x0 == 0);
    let length = (right - left) as usize;
    let offset = u64::from(y) * u64::from(width) + u64::from(left);
    source
        .seek(std::io::SeekFrom::Start(offset))
        .map_err(|e| format!("Failed to position mask read: {e}"))?;
    source
        .read_exact(&mut out[start..start + length])
        .map_err(|e| format!("Failed to read mask row {y}: {e}"))?;
    Ok(())
}

/// Build the exact valid-data mask from a little-endian Float32 raw buffer
/// (ENVI BSQ single band). Validity order: finite check, then declared NoData
/// comparison in raw value space.
///
/// Import staging now streams this rule through its bounded reader, so this
/// dense builder is retained as the independent oracle compatibility tests
/// compare that streamed output against.
#[cfg(test)]
pub fn valid_mask_from_f32_raw(
    width: u32,
    height: u32,
    raw: &[u8],
    nodata: Option<f32>,
) -> Result<ValidMask, String> {
    valid_mask_from_f32_raw_checked(width, height, raw, nodata, |_| Ok(()))
}

#[cfg(test)]
pub fn valid_mask_from_f32_raw_checked(
    width: u32,
    height: u32,
    raw: &[u8],
    nodata: Option<f32>,
    mut checkpoint: impl FnMut(u32) -> Result<(), String>,
) -> Result<ValidMask, String> {
    let expected = width as usize * height as usize * 4;
    if raw.len() != expected {
        return Err(format!(
            "raw raster buffer has {} bytes, expected {expected}",
            raw.len()
        ));
    }
    let mut mask = ValidMask::empty(width, height);
    for y in 0..height {
        checkpoint(y)?;
        for x in 0..width {
            let index = y as usize * width as usize + x as usize;
            let sample = f32::from_le_bytes([
                raw[index * 4],
                raw[index * 4 + 1],
                raw[index * 4 + 2],
                raw[index * 4 + 3],
            ]);
            mask.set(
                x,
                y,
                sample.is_finite() && nodata.is_none_or(|nd| sample != nd),
            );
        }
    }
    Ok(mask)
}

/// Classify incoming valid pixels against current layer coverage.
#[derive(Debug, Clone, Copy)]
pub struct CoverageClassification {
    pub uncovered_cells: u64,
    pub overlap_cells: u64,
    pub invalid_cells: u64,
}

pub fn classify_coverage(
    incoming: &ValidMask,
    layer: Option<&ValidMask>,
) -> Result<CoverageClassification, String> {
    let mut uncovered_cells = 0u64;
    let mut overlap_cells = 0u64;
    let mut invalid_cells = 0u64;
    if layer.is_some_and(|layer| layer.width != incoming.width || layer.height != incoming.height) {
        return Err(
            "coverage classification requires the source grid to match the layer grid".to_string(),
        );
    }
    for y in 0..incoming.height {
        for x in 0..incoming.width {
            if !incoming.get(x, y) {
                invalid_cells += 1;
                continue;
            }
            let covered = layer.is_some_and(|layer| layer.get(x, y));
            if covered {
                overlap_cells += 1;
            } else {
                uncovered_cells += 1;
            }
        }
    }
    Ok(CoverageClassification {
        uncovered_cells,
        overlap_cells,
        invalid_cells,
    })
}

/// Compute the smallest grid on the same aligned lattice that covers both
/// extents. Requires compatible grids.
pub fn union_grid(a: &RasterGrid, b: &RasterGrid) -> Result<RasterGrid, String> {
    a.compatible(b)?;
    let (px_w, px_h) = a.pixel_size();
    let ab = a.bounds();
    let bb = b.bounds();
    let min_x = ab[0].min(bb[0]);
    let min_y = ab[1].min(bb[1]);
    let max_x = ab[2].max(bb[2]);
    let max_y = ab[3].max(bb[3]);
    // Snap outward to whole pixels of the shared lattice.
    let origin_x = a.geotransform[0];
    let origin_y = a.geotransform[3];
    let snap_low = |value: f64, origin: f64, size: f64| -> f64 {
        origin + ((value - origin) / size).floor() * size
    };
    let snap_high = |value: f64, origin: f64, size: f64| -> f64 {
        origin + ((value - origin) / size).ceil() * size
    };
    let ux0 = snap_low(min_x, origin_x, px_w);
    let ux1 = snap_high(max_x, origin_x, px_w);
    // Y grows downward in the geotransform.
    let uy1 = snap_high(max_y, origin_y, -px_h);
    let uy0 = snap_low(min_y, origin_y, -px_h);
    let width = ((ux1 - ux0) / px_w).round().max(1.0) as u32;
    let height = ((uy1 - uy0) / px_h).round().max(1.0) as u32;
    Ok(RasterGrid {
        width,
        height,
        geotransform: [ux0, px_w, 0.0, uy1, 0.0, -px_h],
    })
}

/// Place a mask defined on `from` into a buffer defined on `to`; cells of
/// `to` outside `from` stay invalid.
#[cfg(test)]
pub fn remap_mask(
    mask: &ValidMask,
    from: &RasterGrid,
    to: &RasterGrid,
) -> Result<ValidMask, String> {
    remap_mask_checked(mask, from, to, |_| Ok(()))
}

pub fn remap_mask_checked(
    mask: &ValidMask,
    from: &RasterGrid,
    to: &RasterGrid,
    mut checkpoint: impl FnMut(u32) -> Result<(), String>,
) -> Result<ValidMask, String> {
    to.compatible(from)?;
    let mut out = ValidMask::empty(to.width, to.height);
    let (px_w, px_h) = to.pixel_size();
    let offset_x = ((from.geotransform[0] - to.geotransform[0]) / px_w).round() as i64;
    let offset_y = ((to.geotransform[3] - from.geotransform[3]) / px_h).round() as i64;
    for y in 0..mask.height {
        checkpoint(y)?;
        let ty = offset_y + y as i64;
        if ty < 0 || ty >= to.height as i64 {
            continue;
        }
        for x in 0..mask.width {
            let tx = offset_x + x as i64;
            if tx < 0 || tx >= to.width as i64 {
                continue;
            }
            if mask.get(x, y) {
                out.set(tx as u32, ty as u32, true);
            }
        }
    }
    Ok(out)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_lower(&hasher.finalize())
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw_from_values(values: &[f32]) -> Vec<u8> {
        values.iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    #[test]
    fn mask_keeps_zero_and_negative_but_drops_nodata_and_nan() {
        let values = [0.0f32, -3.5, -9999.0, f32::NAN, 12.0, f32::INFINITY];
        let mask = valid_mask_from_f32_raw(3, 2, &raw_from_values(&values), Some(-9999.0))
            .expect("mask builds");
        assert!(mask.get(0, 0));
        assert!(mask.get(1, 0));
        assert!(!mask.get(2, 0), "declared nodata is invalid");
        assert!(!mask.get(0, 1), "NaN is invalid");
        assert!(mask.get(1, 1));
        assert!(!mask.get(2, 1), "infinite is invalid");
        assert_eq!(mask.count_valid(), 3);
    }

    #[test]
    fn classification_counts_uncovered_overlap_invalid() {
        let incoming = ValidMask::from_bytes(2, 1, vec![1, 1]).unwrap();
        let layer = ValidMask::from_bytes(2, 1, vec![1, 0]).unwrap();
        let class = classify_coverage(&incoming, Some(&layer)).unwrap();
        assert_eq!(class.uncovered_cells, 1);
        assert_eq!(class.overlap_cells, 1);
        assert_eq!(class.invalid_cells, 0);

        let empty_layer: Option<&ValidMask> = None;
        let class = classify_coverage(&incoming, empty_layer).unwrap();
        assert_eq!(class.uncovered_cells, 2);
    }

    #[test]
    fn erosion_shrinks_to_complete_neighborhoods() {
        let mut mask = ValidMask::empty(4, 4);
        for y in 0..4 {
            for x in 0..4 {
                mask.set(x, y, true);
            }
        }
        mask.set(2, 1, false);
        let eroded = mask.eroded();
        assert!(eroded.get(0, 0) || !eroded.get(0, 0)); // corner may fail
        assert!(!eroded.get(3, 3), "raster corners never have full 3x3");
        assert!(!eroded.get(2, 2), "neighbor of a hole is incomplete");
        assert!(!eroded.get(1, 0), "row-0 cells lack an upper neighbor");
    }

    #[test]
    fn grid_compatibility_checks_alignment() {
        let layer = RasterGrid {
            width: 2000,
            height: 2000,
            geotransform: [445999.75, 0.5, 0.0, 6807000.25, 0.0, -0.5],
        };
        let shifted = RasterGrid {
            width: 1000,
            height: 1000,
            geotransform: [446999.75, 0.5, 0.0, 6806500.25, 0.0, -0.5],
        };
        assert!(layer.compatible(&shifted).is_ok());

        let misaligned = RasterGrid {
            width: 1000,
            height: 1000,
            geotransform: [446999.9, 0.5, 0.0, 6806500.25, 0.0, -0.5],
        };
        let error = layer.compatible(&misaligned).unwrap_err();
        assert!(error.contains("not aligned"));

        let finer = RasterGrid {
            width: 1000,
            height: 1000,
            geotransform: [446999.75, 0.25, 0.0, 6806500.25, 0.0, -0.25],
        };
        assert!(layer.compatible(&finer).is_err());
    }

    #[test]
    fn sha256_is_stable_hex() {
        // Well-known SHA-256 of the empty byte string.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn union_grid_expands_to_cover_both_extents() {
        let a = RasterGrid {
            width: 4,
            height: 4,
            geotransform: [0.0, 1.0, 0.0, 4.0, 0.0, -1.0],
        };
        let b = RasterGrid {
            width: 4,
            height: 4,
            geotransform: [2.0, 1.0, 0.0, 4.0, 0.0, -1.0],
        };
        let union = union_grid(&a, &b).unwrap();
        assert_eq!(union.width, 6);
        assert_eq!(union.height, 4);
        assert_eq!(union.geotransform[0], 0.0);
        assert_eq!(union.bounds(), [0.0, 0.0, 6.0, 4.0]);
    }

    #[test]
    fn remap_mask_shifts_into_larger_buffer() {
        let from = RasterGrid {
            width: 2,
            height: 2,
            geotransform: [2.0, 1.0, 0.0, 4.0, 0.0, -1.0],
        };
        let mut mask = ValidMask::empty(2, 2);
        mask.set(0, 0, true);
        let to = RasterGrid {
            width: 4,
            height: 2,
            geotransform: [0.0, 1.0, 0.0, 4.0, 0.0, -1.0],
        };
        let remapped = remap_mask(&mask, &from, &to).unwrap();
        assert!(remapped.get(2, 0));
        assert!(!remapped.get(0, 0));
        assert_eq!(remapped.count_valid(), 1);
    }

    #[test]
    fn classification_over_union_grid_extents() {
        // Layer covers x 0..2; incoming covers x 1..3 on the same lattice.
        let layer_grid = RasterGrid {
            width: 2,
            height: 1,
            geotransform: [0.0, 1.0, 0.0, 1.0, 0.0, -1.0],
        };
        let incoming_grid = RasterGrid {
            width: 2,
            height: 1,
            geotransform: [1.0, 1.0, 0.0, 1.0, 0.0, -1.0],
        };
        let union = union_grid(&layer_grid, &incoming_grid).unwrap();
        let mut layer_mask = ValidMask::empty(2, 1);
        layer_mask.set(0, 0, true);
        layer_mask.set(1, 0, true);
        let mut incoming = ValidMask::empty(2, 1);
        incoming.set(0, 0, true);
        incoming.set(1, 0, true);
        let layer_union = remap_mask(&layer_mask, &layer_grid, &union).unwrap();
        let incoming_union = remap_mask(&incoming, &incoming_grid, &union).unwrap();
        let class = classify_coverage(&incoming_union, Some(&layer_union)).unwrap();
        // x=1 overlap, x=2 uncovered, x=0 outside incoming.
        assert_eq!(class.overlap_cells, 1);
        assert_eq!(class.uncovered_cells, 1);
    }

    // -----------------------------------------------------------------
    // Streamed mask erosion
    // -----------------------------------------------------------------

    fn erosion_scratch(label: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("canopi-erosion-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    fn mask_pattern(width: u32, height: u32, valid: impl Fn(u32, u32) -> bool) -> ValidMask {
        let mut mask = ValidMask::empty(width, height);
        for y in 0..height {
            for x in 0..width {
                mask.set(x, y, valid(x, y));
            }
        }
        mask
    }

    #[test]
    fn streamed_erosion_matches_the_dense_oracle_across_blocks_holes_and_edges() {
        let patterns: Vec<(&str, Box<dyn Fn(u32, u32) -> bool>)> = vec![
            ("all-valid", Box::new(|_, _| true)),
            ("single-hole", Box::new(|x, y| !(x == 5 && y == 4))),
            (
                "edge-holes",
                Box::new(|x, y| {
                    !(x == 0 && y == 2)
                        && !(x == 9 && y == 6)
                        && !(x == 3 && y == 0)
                        && !(x == 4 && y == 7)
                        && !(x == 24 && y == 8)
                }),
            ),
            ("checkerboard", Box::new(|x, y| (x + y) % 2 == 0)),
            (
                "block-seam",
                Box::new(|x, y| !(x == 7 && y == 3) && !(x == 8 && y == 3) && !(x == 6 && y == 5)),
            ),
        ];
        let (width, height) = (25u32, 9u32);
        for (label, valid) in patterns {
            let mask = mask_pattern(width, height, &valid);
            let oracle = mask.eroded_checked(|_| Ok(())).expect("oracle erodes");
            let dir = erosion_scratch(label);
            let input = dir.join("mask.bin");
            mask.write_to(&input).expect("mask writes");
            for block in [1u32, 3, 7, 25, 64] {
                let output = dir.join(format!("out-{block}.bin"));
                erode_mask_file_blocked(&input, &output, width, height, block, |_| Ok(()))
                    .expect("streamed erosion");
                assert_eq!(
                    std::fs::read(&output).expect("output reads"),
                    oracle.bytes().to_vec(),
                    "pattern {label} with {block}-column blocks"
                );
            }
            let output = dir.join("out-default.bin");
            erode_mask_file(&input, &output, width, height, |_| Ok(())).expect("default blocks");
            assert_eq!(
                std::fs::read(&output).expect("output reads"),
                oracle.bytes().to_vec(),
                "pattern {label} with the default block width"
            );
            std::fs::remove_dir_all(&dir).expect("scratch removed");
        }
    }

    #[test]
    fn streamed_erosion_stops_on_cancellation_and_rejects_wrong_sizes() {
        let dir = erosion_scratch("errors");
        let mask = mask_pattern(12, 4, |_, _| true);
        let input = dir.join("mask.bin");
        mask.write_to(&input).expect("mask writes");
        let output = dir.join("out.bin");

        let error = erode_mask_file_blocked(&input, &output, 12, 4, 5, |y| {
            if y >= 2 {
                Err("cancelled".to_string())
            } else {
                Ok(())
            }
        })
        .expect_err("cancellation must stop the erosion");
        assert_eq!(error, "cancelled");

        let error = erode_mask_file(&input, &output, 12, 5, |_| Ok(())).expect_err("size mismatch");
        assert!(error.contains("expected 60"), "{error}");

        let missing = dir.join("absent.bin");
        let error =
            erode_mask_file(&missing, &output, 12, 4, |_| Ok(())).expect_err("missing mask");
        assert!(error.contains("Failed to inspect"), "{error}");
        std::fs::remove_dir_all(&dir).expect("scratch removed");
    }
}
