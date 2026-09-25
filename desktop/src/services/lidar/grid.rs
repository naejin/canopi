//! Validity masks, grids and exact coverage math.
//!
//! Validity is an explicit binary mask, never an inference from background
//! color, bounding rectangles or value zero. Valid zero and negative values
//! stay data; non-finite samples are rejected. Masks are exact raster-aligned
//! bitmaps stored next to the prepared rasters they describe.

use sha2::{Digest, Sha256};

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
///
/// Test oracle only: production reads validity through bounded windows.
#[cfg(test)]
#[derive(Debug, Clone)]
pub struct ValidMask {
    pub width: u32,
    bytes: Vec<u8>,
}

#[cfg(test)]
impl ValidMask {
    pub fn empty(width: u32, height: u32) -> Self {
        Self {
            width,
            bytes: vec![0; (width as usize) * (height as usize)],
        }
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
}

/// Build a validity mask from a whole little-endian f32 raster
/// (ENVI BSQ single band). Validity order: finite check, then declared NoData
/// comparison in raw value space.
///
/// Import staging streams this rule through its bounded reader; this dense
/// builder is the independent oracle tests compare that output against.
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
}
