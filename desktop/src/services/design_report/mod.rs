use printpdf::{
    BuiltinFont, Mm, Op, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, Point, Pt, Rect,
    TextItem, serialize_pdf_into_bytes,
};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportInput {
    pub title: String,
    pub metadata: DesignReportMetadataInput,
    pub canvas: DesignReportCanvasInput,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct DesignReportMetadataInput {
    pub description: Option<String>,
    pub location: Option<DesignReportLocationInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportLocationInput {
    pub lat: f64,
    pub lon: f64,
    pub altitude_m: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportCanvasInput {
    pub page: DesignReportCanvasPageInput,
    pub bounds: Option<DesignReportBounds>,
    #[serde(default)]
    pub visible_layer_names: Vec<String>,
    #[serde(default)]
    pub plants: Vec<DesignReportPlantInput>,
    #[serde(default)]
    pub zones: Vec<DesignReportZoneInput>,
    #[serde(default)]
    pub annotations: Vec<DesignReportAnnotationInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportCanvasPageInput {
    pub orientation: DesignReportPageOrientation,
    pub width_mm: f32,
    pub height_mm: f32,
    pub margin_mm: f32,
    pub background: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DesignReportPageOrientation {
    Portrait,
    Landscape,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct DesignReportBounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportPlantInput {
    pub id: String,
    pub canonical_name: String,
    pub common_name: Option<String>,
    pub color: Option<String>,
    pub symbol: Option<String>,
    pub radius_m: Option<f64>,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportZoneInput {
    pub name: String,
    pub zone_type: String,
    pub fill_color: Option<String>,
    pub points: Vec<DesignReportPointInput>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct DesignReportPointInput {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportAnnotationInput {
    pub id: String,
    pub text: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DesignReportLayout {
    pages: Vec<DesignReportPageLayout>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DesignReportPageLayout {
    orientation: DesignReportPageOrientation,
    width_mm: f32,
    height_mm: f32,
    sections: Vec<DesignReportSection>,
    page_number_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DesignReportSection {
    Metadata,
    Canvas,
}

const PAGE_TITLE_Y_OFFSET_MM: f32 = 16.0;
const PAGE_NUMBER_Y_MM: f32 = 8.0;
const CANVAS_TOP_GAP_MM: f32 = 34.0;
const POINT_MARK_RADIUS_MM: f32 = 1.3;

pub fn export_design_report_pdf(input: &DesignReportInput, path: String) -> Result<String, String> {
    let bytes = render_design_report_pdf(input)?;
    write_bytes_to_path(&path, &bytes)?;
    tracing::info!(
        "Exported Design Report PDF ({} bytes) to {}",
        bytes.len(),
        path
    );
    Ok(path)
}

pub(crate) fn render_design_report_pdf(input: &DesignReportInput) -> Result<Vec<u8>, String> {
    let layout = build_design_report_layout(input);
    let mut document = PdfDocument::new(&input.title);

    for (page_index, page_layout) in layout.pages.iter().enumerate() {
        document
            .pages
            .push(render_page(input, page_layout, page_index));
    }

    let mut warnings = Vec::new();
    let bytes = serialize_pdf_into_bytes(&document, &PdfSaveOptions::default(), &mut warnings);
    if bytes.is_empty() {
        return Err("Design Report renderer produced an empty PDF".to_string());
    }
    Ok(bytes)
}

pub(crate) fn build_design_report_layout(input: &DesignReportInput) -> DesignReportLayout {
    let mut sections = Vec::new();
    if has_metadata_section(&input.metadata) {
        sections.push(DesignReportSection::Metadata);
    }
    sections.push(DesignReportSection::Canvas);

    DesignReportLayout {
        pages: vec![DesignReportPageLayout {
            orientation: input.canvas.page.orientation,
            width_mm: input.canvas.page.width_mm,
            height_mm: input.canvas.page.height_mm,
            sections,
            page_number_label: "Page 1 of 1".to_string(),
        }],
    }
}

fn render_page(input: &DesignReportInput, layout: &DesignReportPageLayout, _: usize) -> PdfPage {
    let mut ops = Vec::new();
    let page_width = layout.width_mm;
    let page_height = layout.height_mm;
    let margin = input.canvas.page.margin_mm;
    let mut cursor_y = page_height - PAGE_TITLE_Y_OFFSET_MM;
    if !input.canvas.page.background.eq_ignore_ascii_case("#FFFFFF") {
        tracing::warn!(
            "Design Report canvas background '{}' was forced to white for print export",
            input.canvas.page.background
        );
    }

    text(
        &mut ops,
        margin,
        cursor_y,
        18.0,
        BuiltinFont::HelveticaBold,
        &input.title,
    );
    cursor_y -= 10.0;

    if layout.sections.contains(&DesignReportSection::Metadata) {
        text(
            &mut ops,
            margin,
            cursor_y,
            11.0,
            BuiltinFont::HelveticaBold,
            "Overview",
        );
        cursor_y -= 6.0;

        if let Some(description) = input.metadata.description.as_deref() {
            for line in wrap_text(description, 86) {
                text(
                    &mut ops,
                    margin,
                    cursor_y,
                    9.0,
                    BuiltinFont::Helvetica,
                    &line,
                );
                cursor_y -= 5.0;
            }
        }

        if let Some(location) = &input.metadata.location {
            let altitude = location
                .altitude_m
                .map(|value| format!(", altitude {value:.1} m"))
                .unwrap_or_default();
            text(
                &mut ops,
                margin,
                cursor_y,
                9.0,
                BuiltinFont::Helvetica,
                &format!(
                    "Location: {:.5}, {:.5}{altitude}",
                    location.lat, location.lon
                ),
            );
            cursor_y -= 7.0;
        }
    }

    text(
        &mut ops,
        margin,
        cursor_y,
        11.0,
        BuiltinFont::HelveticaBold,
        "Design",
    );
    cursor_y -= 6.0;
    let visible_layers = if input.canvas.visible_layer_names.is_empty() {
        "Visible layers: default".to_string()
    } else {
        format!(
            "Visible layers: {}",
            input.canvas.visible_layer_names.join(", ")
        )
    };
    text(
        &mut ops,
        margin,
        cursor_y,
        8.0,
        BuiltinFont::Helvetica,
        &visible_layers,
    );

    let canvas_y = margin + 10.0;
    let canvas_height = (cursor_y - canvas_y - 8.0).max(60.0);
    let canvas_width = (page_width - margin * 2.0).max(60.0);
    let frame = CanvasFrame {
        x_mm: margin,
        y_mm: canvas_y,
        width_mm: canvas_width,
        height_mm: canvas_height.min(page_height - CANVAS_TOP_GAP_MM - canvas_y),
    };

    draw_rect(
        &mut ops,
        frame.x_mm,
        frame.y_mm,
        frame.width_mm,
        frame.height_mm,
    );
    render_canvas_objects(&mut ops, input, frame);
    text(
        &mut ops,
        margin,
        PAGE_NUMBER_Y_MM,
        8.0,
        BuiltinFont::Helvetica,
        &layout.page_number_label,
    );

    PdfPage::new(Mm(layout.width_mm), Mm(layout.height_mm), ops)
}

#[derive(Debug, Clone, Copy)]
struct CanvasFrame {
    x_mm: f32,
    y_mm: f32,
    width_mm: f32,
    height_mm: f32,
}

fn render_canvas_objects(ops: &mut Vec<Op>, input: &DesignReportInput, frame: CanvasFrame) {
    let Some(bounds) = input.canvas.bounds else {
        text(
            ops,
            frame.x_mm + 5.0,
            frame.y_mm + frame.height_mm - 8.0,
            9.0,
            BuiltinFont::Helvetica,
            "No visible canvas objects",
        );
        return;
    };

    let transform = CanvasTransform::new(bounds, frame);

    for zone in &input.canvas.zones {
        let points: Vec<Point> = zone
            .points
            .iter()
            .map(|point| transform.point(point.x, point.y))
            .collect();
        if points.len() >= 2 {
            draw_polyline(ops, &points, true);
            if let Some(first) = points.first() {
                let fill = zone
                    .fill_color
                    .as_deref()
                    .map(|value| format!(", {value}"))
                    .unwrap_or_default();
                text_at_point(
                    ops,
                    first.x.0,
                    first.y.0 + 5.0,
                    7.0,
                    BuiltinFont::Helvetica,
                    &format!("{} ({}){fill}", zone.name, zone.zone_type),
                );
            }
        }
    }

    for plant in &input.canvas.plants {
        let point = transform.point(plant.x, plant.y);
        let radius_mm = plant
            .radius_m
            .map(|radius| (radius * transform.scale) as f32)
            .unwrap_or(POINT_MARK_RADIUS_MM)
            .clamp(POINT_MARK_RADIUS_MM, 6.0);
        draw_cross(ops, point, radius_mm);
        let mut label = plant
            .common_name
            .as_deref()
            .unwrap_or(plant.canonical_name.as_str())
            .to_string();
        if let Some(symbol) = plant.symbol.as_deref() {
            label.push_str(&format!(" [{symbol}]"));
        }
        if let Some(color) = plant.color.as_deref() {
            label.push_str(&format!(" {color}"));
        }
        label.push_str(&format!(" #{id}", id = plant.id));
        text_at_point(
            ops,
            point.x.0 + 3.2,
            point.y.0 + 1.8,
            7.0,
            BuiltinFont::Helvetica,
            &label,
        );
    }

    for annotation in &input.canvas.annotations {
        let point = transform.point(annotation.x, annotation.y);
        text_at_point(
            ops,
            point.x.0,
            point.y.0,
            8.0,
            BuiltinFont::Helvetica,
            &format!("{} #{id}", annotation.text, id = annotation.id),
        );
    }
}

#[derive(Debug, Clone, Copy)]
struct CanvasTransform {
    bounds: DesignReportBounds,
    frame: CanvasFrame,
    scale: f64,
    offset_x_mm: f64,
    offset_y_mm: f64,
}

impl CanvasTransform {
    fn new(bounds: DesignReportBounds, frame: CanvasFrame) -> Self {
        let content_width = (bounds.max_x - bounds.min_x).abs().max(1.0);
        let content_height = (bounds.max_y - bounds.min_y).abs().max(1.0);
        let usable_width = (frame.width_mm as f64 * 0.9).max(1.0);
        let usable_height = (frame.height_mm as f64 * 0.9).max(1.0);
        let scale = (usable_width / content_width).min(usable_height / content_height);
        let drawn_width = content_width * scale;
        let drawn_height = content_height * scale;

        Self {
            bounds,
            frame,
            scale,
            offset_x_mm: (frame.width_mm as f64 - drawn_width) / 2.0,
            offset_y_mm: (frame.height_mm as f64 - drawn_height) / 2.0,
        }
    }

    fn point(self, x: f64, y: f64) -> Point {
        let px = self.frame.x_mm as f64 + self.offset_x_mm + (x - self.bounds.min_x) * self.scale;
        let py = self.frame.y_mm as f64 + self.offset_y_mm + (self.bounds.max_y - y) * self.scale;
        Point {
            x: Mm(px as f32).into(),
            y: Mm(py as f32).into(),
        }
    }
}

fn text(ops: &mut Vec<Op>, x_mm: f32, y_mm: f32, size_pt: f32, font: BuiltinFont, value: &str) {
    text_at_point(
        ops,
        Mm(x_mm).into_pt().0,
        Mm(y_mm).into_pt().0,
        size_pt,
        font,
        value,
    );
}

fn text_at_point(
    ops: &mut Vec<Op>,
    x_pt: f32,
    y_pt: f32,
    size_pt: f32,
    font: BuiltinFont,
    value: &str,
) {
    ops.push(Op::StartTextSection);
    ops.push(Op::SetFont {
        font: PdfFontHandle::Builtin(font),
        size: Pt(size_pt),
    });
    ops.push(Op::SetTextCursor {
        pos: Point {
            x: Pt(x_pt),
            y: Pt(y_pt),
        },
    });
    ops.push(Op::ShowText {
        items: vec![TextItem::Text(value.to_string())],
    });
    ops.push(Op::EndTextSection);
}

fn draw_rect(ops: &mut Vec<Op>, x_mm: f32, y_mm: f32, width_mm: f32, height_mm: f32) {
    let rect = Rect::from_xywh(
        Mm(x_mm).into(),
        Mm(y_mm).into(),
        Mm(width_mm).into(),
        Mm(height_mm).into(),
    );
    ops.push(Op::SetOutlineThickness { pt: Pt(0.8) });
    ops.push(Op::DrawLine {
        line: rect.to_line(),
    });
}

fn draw_polyline(ops: &mut Vec<Op>, points: &[Point], closed: bool) {
    let line = printpdf::Line {
        points: points
            .iter()
            .map(|point| printpdf::LinePoint {
                p: *point,
                bezier: false,
            })
            .collect(),
        is_closed: closed,
    };
    ops.push(Op::SetOutlineThickness { pt: Pt(0.6) });
    ops.push(Op::DrawLine { line });
}

fn draw_cross(ops: &mut Vec<Op>, point: Point, radius_mm: f32) {
    let radius = Mm(radius_mm).into_pt().0;
    let horizontal = [
        Point {
            x: Pt(point.x.0 - radius),
            y: point.y,
        },
        Point {
            x: Pt(point.x.0 + radius),
            y: point.y,
        },
    ];
    let vertical = [
        Point {
            x: point.x,
            y: Pt(point.y.0 - radius),
        },
        Point {
            x: point.x,
            y: Pt(point.y.0 + radius),
        },
    ];
    draw_polyline(ops, &horizontal, false);
    draw_polyline(ops, &vertical, false);
}

fn wrap_text(value: &str, max_chars: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();

    for word in value.split_whitespace() {
        if !current.is_empty() && current.len() + 1 + word.len() > max_chars {
            lines.push(current);
            current = String::new();
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }

    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

fn has_metadata_section(metadata: &DesignReportMetadataInput) -> bool {
    metadata
        .description
        .as_deref()
        .is_some_and(|description| !description.trim().is_empty())
        || metadata.location.is_some()
}

fn write_bytes_to_path(path: &str, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes)
        .map_err(|e| format!("Failed to write Design Report PDF to {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    struct TempTestDir {
        root: PathBuf,
    }

    impl TempTestDir {
        fn new(label: &str) -> Self {
            let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root =
                std::env::temp_dir().join(format!("canopi-design-report-{label}-{sequence}"));
            std::fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn file(&self, name: &str) -> PathBuf {
            self.root.join(name)
        }
    }

    impl Drop for TempTestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn report_layout_uses_canvas_orientation_and_omits_empty_metadata() {
        let input = report_input_without_metadata();

        let layout = build_design_report_layout(&input);

        assert_eq!(layout.pages.len(), 1);
        assert_eq!(
            layout.pages[0].orientation,
            DesignReportPageOrientation::Landscape
        );
        assert_eq!(layout.pages[0].width_mm, 297.0);
        assert_eq!(layout.pages[0].height_mm, 210.0);
        assert_eq!(layout.pages[0].sections, vec![DesignReportSection::Canvas]);
        assert_eq!(layout.pages[0].page_number_label, "Page 1 of 1");
    }

    #[test]
    fn report_layout_includes_metadata_section_only_when_metadata_has_content() {
        let input = DesignReportInput {
            metadata: DesignReportMetadataInput {
                description: Some("A mixed orchard plan".to_string()),
                location: Some(DesignReportLocationInput {
                    lat: 48.8566,
                    lon: 2.3522,
                    altitude_m: Some(35.0),
                }),
            },
            ..report_input_without_metadata()
        };

        let layout = build_design_report_layout(&input);

        assert_eq!(
            layout.pages[0].sections,
            vec![DesignReportSection::Metadata, DesignReportSection::Canvas]
        );
    }

    #[test]
    fn renderer_writes_pdf_bytes_to_requested_path() {
        let temp_dir = TempTestDir::new("write");
        let output_path = temp_dir.file("report.pdf");
        let input = report_input_without_metadata();

        let written_path =
            export_design_report_pdf(&input, output_path.display().to_string()).unwrap();

        let bytes = std::fs::read(&written_path).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(bytes.len() > 500);
        assert_eq!(Path::new(&written_path), output_path.as_path());
    }

    #[test]
    fn renderer_rejects_unwritable_output_paths() {
        let temp_dir = TempTestDir::new("error");
        let output_path = temp_dir.file("missing").join("report.pdf");

        let error = export_design_report_pdf(
            &report_input_without_metadata(),
            output_path.display().to_string(),
        )
        .unwrap_err();

        assert!(error.contains("Failed to write Design Report PDF"));
    }

    fn report_input_without_metadata() -> DesignReportInput {
        DesignReportInput {
            title: "Landscape report".to_string(),
            metadata: DesignReportMetadataInput {
                description: None,
                location: None,
            },
            canvas: DesignReportCanvasInput {
                page: DesignReportCanvasPageInput {
                    orientation: DesignReportPageOrientation::Landscape,
                    width_mm: 297.0,
                    height_mm: 210.0,
                    margin_mm: 14.0,
                    background: "#FFFFFF".to_string(),
                },
                bounds: Some(DesignReportBounds {
                    min_x: 0.0,
                    min_y: 0.0,
                    max_x: 120.0,
                    max_y: 35.0,
                }),
                visible_layer_names: vec!["plants".to_string(), "annotations".to_string()],
                plants: vec![DesignReportPlantInput {
                    id: "plant-1".to_string(),
                    canonical_name: "Malus domestica".to_string(),
                    common_name: Some("Apple".to_string()),
                    color: None,
                    symbol: None,
                    radius_m: Some(2.0),
                    x: 10.0,
                    y: 12.0,
                }],
                zones: vec![],
                annotations: vec![DesignReportAnnotationInput {
                    id: "annotation-1".to_string(),
                    text: "North edge".to_string(),
                    x: 90.0,
                    y: 20.0,
                }],
            },
        }
    }
}
