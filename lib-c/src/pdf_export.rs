//! PDF export via Cairo PdfSurface.
//!
//! Layout:
//! ┌────────────────────────────────┐
//! │  title block (top)             │
//! ├────────────────────────────────┤
//! │                                │
//! │  canvas snapshot (center)      │
//! │                                │
//! ├────────────────────────────────┤
//! │  scale bar / legend (bottom)   │
//! └────────────────────────────────┘

use cairo::{Context, ImageSurface, PdfSurface};

/// Millimetres to Cairo's default unit (1 point = 1/72 inch ≈ 0.3528 mm).
const MM_TO_PT: f64 = 72.0 / 25.4;

/// Title block height in points.
const TITLE_BLOCK_PT: f64 = 36.0;

/// Footer (scale text + legend area) height in points.
const FOOTER_BLOCK_PT: f64 = 24.0;

#[derive(Debug, Clone, Copy)]
pub struct PdfPageLayout<'a> {
    pub page_width_mm: f32,
    pub page_height_mm: f32,
    pub margin_mm: f32,
    pub title: &'a str,
    pub scale_text: &'a str,
    pub include_legend: bool,
    pub include_plant_schedule: bool,
}

/// Render a PDF from the canvas snapshot and layout parameters.
///
/// Returns the raw PDF bytes.
pub fn render_pdf(
    png_data: &[u8],
    src_width: u32,
    src_height: u32,
    layout: PdfPageLayout<'_>,
) -> Result<Vec<u8>, String> {
    let page_w = layout.page_width_mm as f64 * MM_TO_PT;
    let page_h = layout.page_height_mm as f64 * MM_TO_PT;
    let margin = layout.margin_mm as f64 * MM_TO_PT;
    let _ = (layout.include_legend, layout.include_plant_schedule);

    // Usable content area.
    let content_w = page_w - 2.0 * margin;
    let content_h = page_h - 2.0 * margin - TITLE_BLOCK_PT - FOOTER_BLOCK_PT;

    if content_w <= 0.0 || content_h <= 0.0 {
        return Err("Page too small for the given margins".into());
    }

    // Decode the source PNG.
    let src_surface = {
        let mut cursor = std::io::Cursor::new(png_data);
        ImageSurface::create_from_png(&mut cursor)
            .map_err(|e| format!("Failed to decode source PNG for PDF: {e}"))?
    };

    // Create an in-memory PDF surface.
    let pdf_buf: Vec<u8> = Vec::new();
    let pdf_surface = PdfSurface::for_stream(page_w, page_h, pdf_buf)
        .map_err(|e| format!("Failed to create PDF surface: {e}"))?;

    let cr =
        Context::new(&pdf_surface).map_err(|e| format!("Failed to create Cairo context: {e}"))?;

    // ── Title block ─────────────────────────────────────────────────────
    cr.set_source_rgb(0.1, 0.1, 0.1);
    cr.set_font_size(14.0);
    cr.move_to(margin, margin + 18.0); // baseline offset
    cr.show_text(layout.title)
        .map_err(|e| format!("Failed to draw title: {e}"))?;

    // ── Canvas snapshot ─────────────────────────────────────────────────
    let image_y = margin + TITLE_BLOCK_PT;

    // Scale to fit while preserving aspect ratio.
    let img_aspect = src_width as f64 / src_height as f64;
    let area_aspect = content_w / content_h;

    let (draw_w, draw_h) = if img_aspect > area_aspect {
        // Width-constrained.
        (content_w, content_w / img_aspect)
    } else {
        // Height-constrained.
        (content_h * img_aspect, content_h)
    };

    // Centre the image horizontally.
    let image_x = margin + (content_w - draw_w) / 2.0;

    cr.save()
        .map_err(|e| format!("Failed to save state: {e}"))?;
    cr.translate(image_x, image_y);

    let sx = draw_w / src_width as f64;
    let sy = draw_h / src_height as f64;
    cr.scale(sx, sy);

    cr.set_source_surface(&src_surface, 0.0, 0.0)
        .map_err(|e| format!("Failed to set source surface: {e}"))?;
    cr.paint()
        .map_err(|e| format!("Failed to paint image: {e}"))?;
    cr.restore()
        .map_err(|e| format!("Failed to restore state: {e}"))?;

    // ── Footer: scale text ──────────────────────────────────────────────
    let footer_y = page_h - margin - FOOTER_BLOCK_PT + 16.0;
    cr.set_source_rgb(0.3, 0.3, 0.3);
    cr.set_font_size(10.0);
    cr.move_to(margin, footer_y);
    cr.show_text(layout.scale_text)
        .map_err(|e| format!("Failed to draw scale text: {e}"))?;

    // ── Finish ──────────────────────────────────────────────────────────
    cr.show_page()
        .map_err(|e| format!("Failed to finish PDF page: {e}"))?;

    // Drop the context before finishing the surface.
    drop(cr);

    let stream = pdf_surface
        .finish_output_stream()
        .map_err(|e| format!("Failed to finish PDF stream: {e}"))?;

    // The stream wraps our Vec<u8>.
    let pdf_bytes = stream
        .downcast::<Vec<u8>>()
        .map_err(|_| "Failed to extract PDF bytes from stream".to_string())?;

    Ok(*pdf_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cairo::Format;

    fn tiny_png() -> Vec<u8> {
        let surface = ImageSurface::create(Format::ARgb32, 100, 80).expect("create surface");
        let cr = Context::new(&surface).expect("context");
        cr.set_source_rgb(0.2, 0.6, 0.3);
        cr.paint().expect("paint");
        drop(cr);
        surface.flush();

        let mut buf = Vec::new();
        surface.write_to_png(&mut buf).expect("encode png");
        buf
    }

    #[test]
    fn generates_valid_pdf() {
        let png = tiny_png();
        let out = render_pdf(
            &png,
            100,
            80,
            PdfPageLayout {
                page_width_mm: 297.0,  // A4 landscape width
                page_height_mm: 210.0, // A4 landscape height
                margin_mm: 15.0,
                title: "Test Design",
                scale_text: "Scale: 1:100",
                include_legend: false,
                include_plant_schedule: false,
            },
        )
        .unwrap();

        // PDF starts with %PDF-
        assert!(out.starts_with(b"%PDF-"), "Output should be a valid PDF");
        assert!(out.len() > 100, "PDF should have meaningful content");
    }
}
