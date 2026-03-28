//! PNG export with DPI scaling via Cairo.
//!
//! The frontend provides a raw PNG at screen resolution (≈72 DPI).
//! For higher DPI exports we decode the source, paint it onto a larger
//! Cairo surface at the target scale, and re-encode as PNG.

use cairo::{Context, Format, ImageSurface};

/// Re-render `png_data` at the requested DPI.
///
/// - 72 DPI → 1x (pass-through, no re-encoding)
/// - 150 DPI → ~2.08x
/// - 300 DPI → ~4.17x
///
/// `src_width` / `src_height` are the logical canvas dimensions in pixels
/// at the baseline 72 DPI.
pub fn render_png_at_dpi(
    png_data: &[u8],
    src_width: u32,
    src_height: u32,
    dpi: u32,
) -> Result<Vec<u8>, String> {
    // 72 DPI is baseline — return the source data unchanged.
    if dpi <= 72 {
        return Ok(png_data.to_vec());
    }

    let scale = dpi as f64 / 72.0;

    // Decode the source PNG into a Cairo ImageSurface.
    let src_surface = {
        let mut cursor = std::io::Cursor::new(png_data);
        ImageSurface::create_from_png(&mut cursor)
            .map_err(|e| format!("Failed to decode source PNG: {e}"))?
    };

    // Destination dimensions.
    let dst_width = (src_width as f64 * scale).ceil() as i32;
    let dst_height = (src_height as f64 * scale).ceil() as i32;

    // Create the destination surface.
    let dst_surface = ImageSurface::create(Format::ARgb32, dst_width, dst_height)
        .map_err(|e| format!("Failed to create target surface: {e}"))?;

    // Paint the source scaled up.
    let cr = Context::new(&dst_surface)
        .map_err(|e| format!("Failed to create Cairo context: {e}"))?;
    cr.scale(scale, scale);
    cr.set_source_surface(&src_surface, 0.0, 0.0)
        .map_err(|e| format!("Failed to set source surface: {e}"))?;

    // Use BEST filter for high-quality upscale.
    cr.source().set_filter(cairo::Filter::Best);
    cr.paint().map_err(|e| format!("Failed to paint: {e}"))?;

    // Flush and encode to PNG bytes.
    drop(cr);
    dst_surface.flush();

    let mut out = Vec::new();
    dst_surface
        .write_to_png(&mut out)
        .map_err(|e| format!("Failed to encode PNG: {e}"))?;

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal valid 1x1 PNG for testing.
    fn tiny_png() -> Vec<u8> {
        let surface = ImageSurface::create(Format::ARgb32, 4, 4)
            .expect("create 4x4 surface");
        let cr = Context::new(&surface).expect("context");
        cr.set_source_rgb(1.0, 0.0, 0.0);
        cr.paint().expect("paint");
        drop(cr);
        surface.flush();

        let mut buf = Vec::new();
        surface.write_to_png(&mut buf).expect("write png");
        buf
    }

    #[test]
    fn passthrough_at_72dpi() {
        let png = tiny_png();
        let out = render_png_at_dpi(&png, 4, 4, 72).unwrap();
        assert_eq!(out, png, "72 DPI should return identical bytes");
    }

    #[test]
    fn upscale_at_300dpi() {
        let png = tiny_png();
        let out = render_png_at_dpi(&png, 4, 4, 300).unwrap();
        // Verify it's a valid PNG (starts with PNG magic bytes).
        assert_eq!(&out[1..4], b"PNG");
        // At 300 DPI (~4.17x), the output should be larger.
        assert!(out.len() > png.len());
    }
}
