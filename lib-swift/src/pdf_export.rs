//! PDF export via macOS native APIs — stub.
//!
//! Will use Core Graphics (CGPDFContext) or PDFKit for layout-aware
//! PDF generation. For now, returns a stub error.

/// Render a PDF from the canvas snapshot and layout parameters.
///
/// Returns the raw PDF bytes.
pub fn render_pdf(
    _png_data: &[u8],
    _src_width: u32,
    _src_height: u32,
    _page_width_mm: f32,
    _page_height_mm: f32,
    _margin_mm: f32,
    _title: &str,
    _scale_text: &str,
    _include_legend: bool,
    _include_plant_schedule: bool,
) -> Result<Vec<u8>, String> {
    // TODO: Implement via CGPDFContext or PDFKit via swift-bridge.
    Err("macOS native PDF export not yet implemented — requires Core Graphics FFI".into())
}
