//! PNG export with DPI scaling — Windows stub.
//!
//! Will use Windows Imaging Component (WIC) and Direct2D for high-quality
//! DPI-scaled PNG rendering. For now, returns a stub error.

/// Re-render `png_data` at the requested DPI.
///
/// - 72 DPI -> 1x (pass-through, no re-encoding)
/// - 150 DPI -> ~2.08x
/// - 300 DPI -> ~4.17x
///
/// `src_width` / `src_height` are the logical canvas dimensions in pixels
/// at the baseline 72 DPI.
pub fn render_png_at_dpi(
    png_data: &[u8],
    _src_width: u32,
    _src_height: u32,
    dpi: u32,
) -> Result<Vec<u8>, String> {
    // 72 DPI is baseline — return the source data unchanged.
    if dpi <= 72 {
        return Ok(png_data.to_vec());
    }

    // TODO: Implement via WIC (IWICImagingFactory) + Direct2D.
    Err("Windows native PNG export not yet implemented — requires WIC/Direct2D FFI".into())
}
