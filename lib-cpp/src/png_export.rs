//! PNG export compatibility surface for Windows.
//!
//! Baseline PNG bytes pass through. Native high-DPI PNG scaling is supported
//! only by the Linux platform implementation, so higher DPI requests return an
//! explicit error instead of implying a future WIC/Direct2D implementation.

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

    Err("Windows native high-DPI PNG export is unavailable".into())
}
