use printpdf::{
    FontId, LineDashPattern, Mm, Op, ParsedFont, PdfDocument, PdfFontHandle, PdfPage,
    PdfSaveOptions, Point, Pt, Rect, TextItem, serialize_pdf_into_bytes,
};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportInput {
    pub title: String,
    #[serde(default)]
    pub labels: DesignReportLabelsInput,
    pub metadata: DesignReportMetadataInput,
    pub canvas: DesignReportCanvasInput,
    #[serde(default)]
    pub timeline: Option<DesignReportTimelineInput>,
    #[serde(default)]
    pub budget: Option<DesignReportBudgetInput>,
    #[serde(default)]
    pub consortium: Option<DesignReportConsortiumInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportLabelsInput {
    pub overview: String,
    pub location: String,
    pub altitude: String,
    pub design: String,
    pub visible_layers: String,
    pub default_visible_layers: String,
    pub no_visible_canvas_objects: String,
    pub pinned: String,
    pub color_by: String,
    #[serde(default = "default_page_number_template")]
    pub page_number: String,
}

fn default_page_number_template() -> String {
    "Page {page} of {count}".to_string()
}

impl Default for DesignReportLabelsInput {
    fn default() -> Self {
        Self {
            overview: "Overview".to_string(),
            location: "Location".to_string(),
            altitude: "altitude".to_string(),
            design: "Design".to_string(),
            visible_layers: "Visible layers".to_string(),
            default_visible_layers: "default".to_string(),
            no_visible_canvas_objects: "No visible canvas objects".to_string(),
            pinned: "Pinned".to_string(),
            color_by: "Color by".to_string(),
            page_number: default_page_number_template(),
        }
    }
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
    #[serde(default)]
    pub measurement_guides: Vec<DesignReportMeasurementGuideInput>,
    #[serde(default)]
    pub legend: Option<DesignReportCanvasLegendInput>,
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

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportPlantInput {
    pub id: String,
    pub canonical_name: String,
    pub common_name: Option<String>,
    pub color: Option<String>,
    pub symbol: Option<String>,
    #[serde(default)]
    pub pinned_name_label: Option<String>,
    pub radius_m: Option<f64>,
    pub x: f64,
    pub y: f64,
}

#[allow(dead_code)]
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

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportAnnotationInput {
    pub id: String,
    pub text: String,
    pub x: f64,
    pub y: f64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportMeasurementGuideInput {
    pub id: String,
    pub start: DesignReportPointInput,
    pub end: DesignReportPointInput,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum DesignReportCanvasLegendInput {
    PinnedPlantNames {
        title: String,
        entries: Vec<DesignReportPinnedPlantNameLegendEntryInput>,
    },
    ColorBy {
        title: String,
        attribute: String,
        entries: Vec<DesignReportColorByLegendEntryInput>,
    },
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportPinnedPlantNameLegendEntryInput {
    pub label: String,
    pub color: String,
    pub symbol: String,
    pub count: u32,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportColorByLegendEntryInput {
    pub label: String,
    pub color: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportTimelineInput {
    pub title: String,
    pub overview_title: String,
    pub table_title: String,
    pub columns: DesignReportTimelineColumnsInput,
    pub overview_rows: Vec<DesignReportTimelineOverviewRowInput>,
    pub actions: Vec<DesignReportTimelineActionInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportTimelineColumnsInput {
    pub action_type: String,
    pub description: String,
    pub start_date: String,
    pub end_date: String,
    pub recurrence: String,
    pub target: String,
    pub dependencies: String,
    pub status: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportTimelineOverviewRowInput {
    pub action_type: String,
    pub label: String,
    pub color: String,
    pub count: u32,
    pub date_range: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportTimelineActionInput {
    pub action_type: String,
    pub action_type_label: String,
    pub description: String,
    pub start_date: String,
    pub end_date: String,
    pub recurrence: String,
    pub target: String,
    pub dependencies: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportBudgetInput {
    pub title: String,
    pub columns: DesignReportBudgetColumnsInput,
    pub rows: Vec<DesignReportBudgetRowInput>,
    pub totals: Vec<DesignReportBudgetTotalInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportBudgetColumnsInput {
    pub target: String,
    pub category: String,
    pub description: String,
    pub quantity: String,
    pub unit_cost: String,
    pub line_total: String,
    pub currency: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportBudgetRowInput {
    pub target: String,
    pub category: String,
    pub description: String,
    pub quantity: String,
    pub unit_cost: String,
    pub line_total: String,
    pub currency: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportBudgetTotalInput {
    pub label: String,
    pub currency: String,
    pub amount: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportConsortiumInput {
    pub title: String,
    pub chart_title: String,
    pub table_title: String,
    pub phases: Vec<String>,
    pub columns: DesignReportConsortiumColumnsInput,
    pub chart_rows: Vec<DesignReportConsortiumChartRowInput>,
    pub rows: Vec<DesignReportConsortiumRowInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportConsortiumColumnsInput {
    pub plant: String,
    pub canonical_name: String,
    pub stratum: String,
    pub start_phase: String,
    pub end_phase: String,
    pub count: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportConsortiumChartRowInput {
    pub stratum: String,
    pub cells: Vec<DesignReportConsortiumChartCellInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportConsortiumChartCellInput {
    pub entries: Vec<DesignReportConsortiumChartEntryInput>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportConsortiumChartEntryInput {
    pub label: String,
    pub color: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesignReportConsortiumRowInput {
    pub plant: String,
    pub canonical_name: Option<String>,
    pub stratum: String,
    pub start_phase: String,
    pub end_phase: String,
    pub count: String,
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
    Timeline {
        start_index: usize,
        end_index: usize,
        include_overview: bool,
    },
    Budget {
        start_index: usize,
        end_index: usize,
        include_totals: bool,
    },
    Consortium {
        start_index: usize,
        end_index: usize,
        include_chart: bool,
    },
}

const PAGE_TITLE_Y_OFFSET_MM: f32 = 16.0;
const PAGE_NUMBER_Y_MM: f32 = 8.0;
const CANVAS_TOP_GAP_MM: f32 = 34.0;
const POINT_MARK_RADIUS_MM: f32 = 1.3;
const REPORT_PORTRAIT_WIDTH_MM: f32 = 210.0;
const REPORT_PORTRAIT_HEIGHT_MM: f32 = 297.0;
const TIMELINE_ROW_VERTICAL_PADDING_MM: f32 = 4.0;
const TIMELINE_LINE_HEIGHT_MM: f32 = 4.2;
const TIMELINE_HEADER_HEIGHT_MM: f32 = 10.0;
const BUDGET_ROW_VERTICAL_PADDING_MM: f32 = 4.0;
const BUDGET_LINE_HEIGHT_MM: f32 = 4.2;
const BUDGET_HEADER_HEIGHT_MM: f32 = 10.0;
const CONSORTIUM_ROW_VERTICAL_PADDING_MM: f32 = 4.0;
const CONSORTIUM_LINE_HEIGHT_MM: f32 = 4.2;
const CONSORTIUM_HEADER_HEIGHT_MM: f32 = 10.0;
const REPORT_FONT_INDEX: usize = 0;
const REPORT_REGULAR_FONT: &[u8] = include_bytes!("fonts/NotoSans-Regular.ttf");
const REPORT_BOLD_FONT: &[u8] = include_bytes!("fonts/NotoSans-Bold.ttf");
const REPORT_CJK_FONT: &[u8] = include_bytes!("fonts/DroidSansFallbackFull.ttf");
const REPORT_HANGUL_FONT: &[u8] = include_bytes!("fonts/NotoSansCJK-Regular.ttc");

#[derive(Debug, Clone)]
struct ReportFonts {
    regular: FontId,
    bold: FontId,
    cjk: FontId,
    hangul: FontId,
}

#[derive(Debug, Clone, Copy)]
enum ReportFont {
    Regular,
    Bold,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReportFontFace {
    Regular,
    Bold,
    Cjk,
    Hangul,
}

impl ReportFonts {
    fn handle(&self, face: ReportFontFace) -> PdfFontHandle {
        match face {
            ReportFontFace::Regular => PdfFontHandle::External(self.regular.clone()),
            ReportFontFace::Bold => PdfFontHandle::External(self.bold.clone()),
            ReportFontFace::Cjk => PdfFontHandle::External(self.cjk.clone()),
            ReportFontFace::Hangul => PdfFontHandle::External(self.hangul.clone()),
        }
    }
}

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
    set_report_metadata(&mut document);
    let fonts = load_report_fonts(&mut document)?;

    for (page_index, page_layout) in layout.pages.iter().enumerate() {
        document
            .pages
            .push(render_page(input, page_layout, page_index, &fonts));
    }

    let mut warnings = Vec::new();
    let bytes = serialize_pdf_into_bytes(&document, &PdfSaveOptions::default(), &mut warnings);
    if bytes.is_empty() {
        return Err("Design Report renderer produced an empty PDF".to_string());
    }
    Ok(bytes)
}

fn set_report_metadata(document: &mut PdfDocument) {
    let now = printpdf::OffsetDateTime::now_utc();
    document.metadata.info.creation_date = now;
    document.metadata.info.modification_date = now;
    document.metadata.info.metadata_date = now;
    document.metadata.info.creator = "Canopi".to_string();
    document.metadata.info.producer = "Canopi Design Report".to_string();
}

fn load_report_fonts(document: &mut PdfDocument) -> Result<ReportFonts, String> {
    let regular = load_report_font(document, REPORT_REGULAR_FONT, "Noto Sans Regular")?;
    let bold = load_report_font(document, REPORT_BOLD_FONT, "Noto Sans Bold")?;
    let cjk = load_report_font(document, REPORT_CJK_FONT, "Droid Sans Fallback")?;
    let hangul = load_report_font(document, REPORT_HANGUL_FONT, "Noto Sans CJK Hangul")?;
    Ok(ReportFonts {
        regular,
        bold,
        cjk,
        hangul,
    })
}

fn load_report_font(
    document: &mut PdfDocument,
    bytes: &[u8],
    label: &'static str,
) -> Result<FontId, String> {
    let mut warnings = Vec::new();
    let font = ParsedFont::from_bytes(bytes, REPORT_FONT_INDEX, &mut warnings)
        .ok_or_else(|| format!("Failed to parse bundled Design Report font: {label}"))?;
    if !warnings.is_empty() {
        tracing::debug!(
            ?warnings,
            "Parsed bundled Design Report font with non-fatal warnings"
        );
    }
    Ok(document.add_font(&font))
}

pub(crate) fn build_design_report_layout(input: &DesignReportInput) -> DesignReportLayout {
    let mut sections = Vec::new();
    if has_metadata_section(&input.metadata) {
        sections.push(DesignReportSection::Metadata);
    }
    sections.push(DesignReportSection::Canvas);

    let mut pages = vec![DesignReportPageLayout {
        orientation: input.canvas.page.orientation,
        width_mm: input.canvas.page.width_mm,
        height_mm: input.canvas.page.height_mm,
        sections,
        page_number_label: String::new(),
    }];

    if let Some(timeline) = input.timeline.as_ref()
        && !timeline.actions.is_empty()
    {
        for chunk in build_timeline_page_chunks(timeline, input.canvas.page.margin_mm) {
            pages.push(DesignReportPageLayout {
                orientation: DesignReportPageOrientation::Portrait,
                width_mm: REPORT_PORTRAIT_WIDTH_MM,
                height_mm: REPORT_PORTRAIT_HEIGHT_MM,
                sections: vec![DesignReportSection::Timeline {
                    start_index: chunk.start_index,
                    end_index: chunk.end_index,
                    include_overview: chunk.include_overview,
                }],
                page_number_label: String::new(),
            });
        }
    }

    if let Some(budget) = input.budget.as_ref()
        && (!budget.rows.is_empty() || !budget.totals.is_empty())
    {
        for chunk in build_budget_page_chunks(budget, input.canvas.page.margin_mm) {
            pages.push(DesignReportPageLayout {
                orientation: DesignReportPageOrientation::Portrait,
                width_mm: REPORT_PORTRAIT_WIDTH_MM,
                height_mm: REPORT_PORTRAIT_HEIGHT_MM,
                sections: vec![DesignReportSection::Budget {
                    start_index: chunk.start_index,
                    end_index: chunk.end_index,
                    include_totals: chunk.include_totals,
                }],
                page_number_label: String::new(),
            });
        }
    }

    if let Some(consortium) = input.consortium.as_ref()
        && (!consortium.rows.is_empty() || !consortium.chart_rows.is_empty())
    {
        for chunk in build_consortium_page_chunks(consortium, input.canvas.page.margin_mm) {
            pages.push(DesignReportPageLayout {
                orientation: DesignReportPageOrientation::Portrait,
                width_mm: REPORT_PORTRAIT_WIDTH_MM,
                height_mm: REPORT_PORTRAIT_HEIGHT_MM,
                sections: vec![DesignReportSection::Consortium {
                    start_index: chunk.start_index,
                    end_index: chunk.end_index,
                    include_chart: chunk.include_chart,
                }],
                page_number_label: String::new(),
            });
        }
    }

    let page_count = pages.len();
    for (index, page) in pages.iter_mut().enumerate() {
        page.page_number_label =
            format_page_number_label(&input.labels.page_number, index + 1, page_count);
    }

    DesignReportLayout { pages }
}

fn format_page_number_label(template: &str, page_number: usize, page_count: usize) -> String {
    let trimmed = template.trim();
    if trimmed.is_empty() {
        return format!("Page {page_number} of {page_count}");
    }

    trimmed
        .replace("{page}", &page_number.to_string())
        .replace("{count}", &page_count.to_string())
}

#[derive(Debug, Clone, Copy)]
struct TimelinePageChunk {
    start_index: usize,
    end_index: usize,
    include_overview: bool,
}

fn build_timeline_page_chunks(
    timeline: &DesignReportTimelineInput,
    margin_mm: f32,
) -> Vec<TimelinePageChunk> {
    let mut chunks = Vec::new();
    let mut start_index = 0;
    let mut used_height = 0.0;
    let mut include_overview = true;
    let mut available_height = timeline_rows_available_height(timeline, margin_mm, true);

    for (index, action) in timeline.actions.iter().enumerate() {
        let row_height = estimate_timeline_row_height(action);
        if index > start_index && used_height + row_height > available_height {
            chunks.push(TimelinePageChunk {
                start_index,
                end_index: index,
                include_overview,
            });
            start_index = index;
            used_height = 0.0;
            include_overview = false;
            available_height = timeline_rows_available_height(timeline, margin_mm, false);
        }
        used_height += row_height;
    }

    chunks.push(TimelinePageChunk {
        start_index,
        end_index: timeline.actions.len(),
        include_overview,
    });
    chunks
}

fn timeline_rows_available_height(
    timeline: &DesignReportTimelineInput,
    margin_mm: f32,
    include_overview: bool,
) -> f32 {
    let page_body = REPORT_PORTRAIT_HEIGHT_MM - margin_mm - PAGE_NUMBER_Y_MM - 24.0;
    let overview_height = if include_overview {
        8.0 + timeline.overview_rows.len() as f32 * 4.8
    } else {
        0.0
    };
    (page_body - overview_height - TIMELINE_HEADER_HEIGHT_MM - 16.0).max(40.0)
}

fn estimate_timeline_row_height(action: &DesignReportTimelineActionInput) -> f32 {
    let wrapped_lines = [
        wrap_text(&action.description, 58).len(),
        wrap_text(&action.target, 24).len(),
        wrap_text(&action.dependencies, 24).len(),
        wrap_text(&action.recurrence, 24).len(),
    ]
    .into_iter()
    .max()
    .unwrap_or(1)
    .max(1);
    TIMELINE_ROW_VERTICAL_PADDING_MM + wrapped_lines as f32 * TIMELINE_LINE_HEIGHT_MM + 8.0
}

#[derive(Debug, Clone, Copy)]
struct BudgetPageChunk {
    start_index: usize,
    end_index: usize,
    include_totals: bool,
}

fn build_budget_page_chunks(
    budget: &DesignReportBudgetInput,
    margin_mm: f32,
) -> Vec<BudgetPageChunk> {
    if budget.rows.is_empty() {
        return vec![BudgetPageChunk {
            start_index: 0,
            end_index: 0,
            include_totals: true,
        }];
    }

    let available_height = budget_rows_available_height(budget, margin_mm);
    let mut chunks = Vec::new();
    let mut start_index = 0;
    let mut used_height = 0.0;

    for (index, row) in budget.rows.iter().enumerate() {
        let row_height = estimate_budget_row_height(row);
        if index > start_index && used_height + row_height > available_height {
            chunks.push(BudgetPageChunk {
                start_index,
                end_index: index,
                include_totals: false,
            });
            start_index = index;
            used_height = 0.0;
        }
        used_height += row_height;
    }

    chunks.push(BudgetPageChunk {
        start_index,
        end_index: budget.rows.len(),
        include_totals: true,
    });
    chunks
}

fn budget_rows_available_height(budget: &DesignReportBudgetInput, margin_mm: f32) -> f32 {
    let page_body = REPORT_PORTRAIT_HEIGHT_MM - margin_mm - PAGE_NUMBER_Y_MM - 24.0;
    let totals_height = 7.0 + budget.totals.len() as f32 * 4.8;
    (page_body - totals_height - BUDGET_HEADER_HEIGHT_MM - 16.0).max(40.0)
}

fn estimate_budget_row_height(row: &DesignReportBudgetRowInput) -> f32 {
    let wrapped_lines = [
        wrap_text(&row.target, 26).len(),
        wrap_text(&row.category, 18).len(),
        wrap_text(&row.description, 62).len(),
    ]
    .into_iter()
    .max()
    .unwrap_or(1)
    .max(1);
    BUDGET_ROW_VERTICAL_PADDING_MM + wrapped_lines as f32 * BUDGET_LINE_HEIGHT_MM + 8.0
}

#[derive(Debug, Clone, Copy)]
struct ConsortiumPageChunk {
    start_index: usize,
    end_index: usize,
    include_chart: bool,
}

fn build_consortium_page_chunks(
    consortium: &DesignReportConsortiumInput,
    margin_mm: f32,
) -> Vec<ConsortiumPageChunk> {
    if consortium.rows.is_empty() {
        return vec![ConsortiumPageChunk {
            start_index: 0,
            end_index: 0,
            include_chart: true,
        }];
    }

    let mut chunks = Vec::new();
    let mut start_index = 0;
    let mut used_height = 0.0;
    let mut include_chart = true;
    let mut available_height = consortium_rows_available_height(consortium, margin_mm, true);

    for (index, row) in consortium.rows.iter().enumerate() {
        let row_height = estimate_consortium_row_height(row);
        if index > start_index && used_height + row_height > available_height {
            chunks.push(ConsortiumPageChunk {
                start_index,
                end_index: index,
                include_chart,
            });
            start_index = index;
            used_height = 0.0;
            include_chart = false;
            available_height = consortium_rows_available_height(consortium, margin_mm, false);
        }
        used_height += row_height;
    }

    chunks.push(ConsortiumPageChunk {
        start_index,
        end_index: consortium.rows.len(),
        include_chart,
    });
    chunks
}

fn consortium_rows_available_height(
    consortium: &DesignReportConsortiumInput,
    margin_mm: f32,
    include_chart: bool,
) -> f32 {
    let page_body = REPORT_PORTRAIT_HEIGHT_MM - margin_mm - PAGE_NUMBER_Y_MM - 24.0;
    let chart_height = if include_chart {
        estimate_consortium_chart_height(consortium)
    } else {
        0.0
    };
    (page_body - chart_height - CONSORTIUM_HEADER_HEIGHT_MM - 16.0).max(40.0)
}

fn estimate_consortium_chart_height(consortium: &DesignReportConsortiumInput) -> f32 {
    if consortium.chart_rows.is_empty() {
        return 0.0;
    }
    15.0 + consortium.chart_rows.len() as f32 * 9.2
}

fn estimate_consortium_row_height(row: &DesignReportConsortiumRowInput) -> f32 {
    let canonical = row.canonical_name.as_deref().unwrap_or("-");
    let wrapped_lines = [
        wrap_text(&row.plant, 28).len(),
        wrap_text(canonical, 32).len(),
        wrap_text(&row.stratum, 16).len(),
        wrap_text(&row.start_phase, 18).len(),
        wrap_text(&row.end_phase, 18).len(),
    ]
    .into_iter()
    .max()
    .unwrap_or(1)
    .max(1);
    CONSORTIUM_ROW_VERTICAL_PADDING_MM + wrapped_lines as f32 * CONSORTIUM_LINE_HEIGHT_MM + 8.0
}

fn render_page(
    input: &DesignReportInput,
    layout: &DesignReportPageLayout,
    _: usize,
    fonts: &ReportFonts,
) -> PdfPage {
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
        fonts,
        margin,
        cursor_y,
        18.0,
        ReportFont::Bold,
        &input.title,
    );
    cursor_y -= 10.0;

    if let Some(DesignReportSection::Timeline {
        start_index,
        end_index,
        include_overview,
    }) = layout.sections.first()
    {
        if let Some(timeline) = input.timeline.as_ref() {
            render_timeline_section(
                &mut ops,
                fonts,
                timeline,
                TimelinePageChunk {
                    start_index: *start_index,
                    end_index: *end_index,
                    include_overview: *include_overview,
                },
                margin,
                cursor_y,
            );
        }
        text(
            &mut ops,
            fonts,
            margin,
            PAGE_NUMBER_Y_MM,
            8.0,
            ReportFont::Regular,
            &layout.page_number_label,
        );
        return PdfPage::new(Mm(layout.width_mm), Mm(layout.height_mm), ops);
    }

    if let Some(DesignReportSection::Budget {
        start_index,
        end_index,
        include_totals,
    }) = layout.sections.first()
    {
        if let Some(budget) = input.budget.as_ref() {
            render_budget_section(
                &mut ops,
                fonts,
                budget,
                BudgetPageChunk {
                    start_index: *start_index,
                    end_index: *end_index,
                    include_totals: *include_totals,
                },
                margin,
                cursor_y,
            );
        }
        text(
            &mut ops,
            fonts,
            margin,
            PAGE_NUMBER_Y_MM,
            8.0,
            ReportFont::Regular,
            &layout.page_number_label,
        );
        return PdfPage::new(Mm(layout.width_mm), Mm(layout.height_mm), ops);
    }

    if let Some(DesignReportSection::Consortium {
        start_index,
        end_index,
        include_chart,
    }) = layout.sections.first()
    {
        if let Some(consortium) = input.consortium.as_ref() {
            render_consortium_section(
                &mut ops,
                fonts,
                consortium,
                ConsortiumPageChunk {
                    start_index: *start_index,
                    end_index: *end_index,
                    include_chart: *include_chart,
                },
                margin,
                cursor_y,
            );
        }
        text(
            &mut ops,
            fonts,
            margin,
            PAGE_NUMBER_Y_MM,
            8.0,
            ReportFont::Regular,
            &layout.page_number_label,
        );
        return PdfPage::new(Mm(layout.width_mm), Mm(layout.height_mm), ops);
    }

    if layout.sections.contains(&DesignReportSection::Metadata) {
        text(
            &mut ops,
            fonts,
            margin,
            cursor_y,
            11.0,
            ReportFont::Bold,
            &input.labels.overview,
        );
        cursor_y -= 6.0;

        if let Some(description) = input.metadata.description.as_deref() {
            for line in wrap_text(description, 86) {
                text(
                    &mut ops,
                    fonts,
                    margin,
                    cursor_y,
                    9.0,
                    ReportFont::Regular,
                    &line,
                );
                cursor_y -= 5.0;
            }
        }

        if let Some(location) = &input.metadata.location {
            let altitude = location
                .altitude_m
                .map(|value| format!(", {} {value:.1} m", input.labels.altitude))
                .unwrap_or_default();
            text(
                &mut ops,
                fonts,
                margin,
                cursor_y,
                9.0,
                ReportFont::Regular,
                &format!(
                    "{}: {:.5}, {:.5}{altitude}",
                    input.labels.location, location.lat, location.lon
                ),
            );
            cursor_y -= 7.0;
        }
    }

    text(
        &mut ops,
        fonts,
        margin,
        cursor_y,
        11.0,
        ReportFont::Bold,
        &input.labels.design,
    );
    cursor_y -= 6.0;
    let visible_layers = if input.canvas.visible_layer_names.is_empty() {
        format!(
            "{}: {}",
            input.labels.visible_layers, input.labels.default_visible_layers
        )
    } else {
        format!(
            "{}: {}",
            input.labels.visible_layers,
            input.canvas.visible_layer_names.join(", ")
        )
    };
    text(
        &mut ops,
        fonts,
        margin,
        cursor_y,
        8.0,
        ReportFont::Regular,
        &visible_layers,
    );
    cursor_y -= 7.0;

    if let Some(legend) = &input.canvas.legend {
        cursor_y =
            render_canvas_legend(&mut ops, fonts, margin, cursor_y, legend, &input.labels) - 3.0;
    }

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
    render_canvas_objects(&mut ops, fonts, input, frame);
    text(
        &mut ops,
        fonts,
        margin,
        PAGE_NUMBER_Y_MM,
        8.0,
        ReportFont::Regular,
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

fn render_canvas_objects(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    input: &DesignReportInput,
    frame: CanvasFrame,
) {
    let Some(bounds) = input.canvas.bounds else {
        text(
            ops,
            fonts,
            frame.x_mm + 5.0,
            frame.y_mm + frame.height_mm - 8.0,
            9.0,
            ReportFont::Regular,
            &input.labels.no_visible_canvas_objects,
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
            if let Some(first) = points.first()
                && !zone.name.trim().is_empty()
            {
                text_at_point(
                    ops,
                    fonts,
                    first.x.0,
                    first.y.0 + 5.0,
                    7.0,
                    ReportFont::Regular,
                    &zone.name,
                );
            }
        }
    }

    for guide in &input.canvas.measurement_guides {
        render_measurement_guide(ops, fonts, guide, transform);
    }

    for plant in &input.canvas.plants {
        let point = transform.point(plant.x, plant.y);
        let radius_mm = plant
            .radius_m
            .map(|radius| (radius * transform.scale) as f32)
            .unwrap_or(POINT_MARK_RADIUS_MM)
            .clamp(POINT_MARK_RADIUS_MM, 6.0);
        draw_cross(ops, point, radius_mm);
        let label = plant
            .common_name
            .as_deref()
            .unwrap_or(plant.canonical_name.as_str())
            .to_string();
        text_at_point(
            ops,
            fonts,
            point.x.0 + 3.2,
            point.y.0 + 1.8,
            7.0,
            ReportFont::Regular,
            &label,
        );
        if let Some(pinned_label) = plant.pinned_name_label.as_deref() {
            text_at_point(
                ops,
                fonts,
                point.x.0 + 3.2,
                point.y.0 + 9.0,
                7.2,
                ReportFont::Bold,
                &format!("{}: {pinned_label}", input.labels.pinned),
            );
        }
    }

    for annotation in &input.canvas.annotations {
        let point = transform.point(annotation.x, annotation.y);
        text_at_point(
            ops,
            fonts,
            point.x.0,
            point.y.0,
            8.0,
            ReportFont::Regular,
            &annotation.text,
        );
    }
}

fn render_canvas_legend(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    x_mm: f32,
    mut y_mm: f32,
    legend: &DesignReportCanvasLegendInput,
    labels: &DesignReportLabelsInput,
) -> f32 {
    match legend {
        DesignReportCanvasLegendInput::PinnedPlantNames { title, entries } => {
            text(ops, fonts, x_mm, y_mm, 9.0, ReportFont::Bold, title);
            y_mm -= 5.0;
            for entry in entries {
                let count = if entry.count > 1 {
                    format!(" x{}", entry.count)
                } else {
                    String::new()
                };
                text(
                    ops,
                    fonts,
                    x_mm,
                    y_mm,
                    7.5,
                    ReportFont::Regular,
                    &format!("{}{}", entry.label, count),
                );
                y_mm -= 4.5;
            }
        }
        DesignReportCanvasLegendInput::ColorBy {
            title,
            attribute,
            entries,
        } => {
            text(ops, fonts, x_mm, y_mm, 9.0, ReportFont::Bold, title);
            y_mm -= 5.0;
            text(
                ops,
                fonts,
                x_mm,
                y_mm,
                7.5,
                ReportFont::Regular,
                &format!("{}: {attribute}", labels.color_by),
            );
            y_mm -= 4.5;
            for entry in entries {
                text(
                    ops,
                    fonts,
                    x_mm,
                    y_mm,
                    7.5,
                    ReportFont::Regular,
                    &entry.label,
                );
                y_mm -= 4.5;
            }
        }
    }
    y_mm
}

fn render_measurement_guide(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    guide: &DesignReportMeasurementGuideInput,
    transform: CanvasTransform,
) {
    let start = transform.point(guide.start.x, guide.start.y);
    let end = transform.point(guide.end.x, guide.end.y);
    let dx = end.x.0 - start.x.0;
    let dy = end.y.0 - start.y.0;
    let length = (dx * dx + dy * dy).sqrt();
    if length <= f32::EPSILON {
        return;
    }

    draw_dashed_polyline(ops, &[start, end]);

    let normal_x = -dy / length;
    let normal_y = dx / length;
    let tick_half = Mm(2.0).into_pt().0;
    draw_polyline(
        ops,
        &tick_points(start, normal_x, normal_y, tick_half),
        false,
    );
    draw_polyline(ops, &tick_points(end, normal_x, normal_y, tick_half), false);

    let label_offset = Mm(3.0).into_pt().0;
    let label = guide.label.trim();
    if label.is_empty() {
        return;
    }
    text_at_point(
        ops,
        fonts,
        (start.x.0 + end.x.0) / 2.0 + normal_x * label_offset,
        (start.y.0 + end.y.0) / 2.0 + normal_y * label_offset,
        7.0,
        ReportFont::Bold,
        label,
    );
}

fn render_timeline_section(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    timeline: &DesignReportTimelineInput,
    chunk: TimelinePageChunk,
    margin: f32,
    mut cursor_y: f32,
) -> f32 {
    text(
        ops,
        fonts,
        margin,
        cursor_y,
        12.0,
        ReportFont::Bold,
        &timeline.title,
    );
    cursor_y -= 8.0;

    if chunk.include_overview {
        text(
            ops,
            fonts,
            margin,
            cursor_y,
            9.0,
            ReportFont::Bold,
            &timeline.overview_title,
        );
        cursor_y -= 5.0;
        for row in &timeline.overview_rows {
            text(
                ops,
                fonts,
                margin,
                cursor_y,
                7.5,
                ReportFont::Regular,
                &format!("{} ({}) - {}", row.label, row.count, row.date_range),
            );
            cursor_y -= 4.8;
        }
        cursor_y -= 3.0;
    }

    text(
        ops,
        fonts,
        margin,
        cursor_y,
        9.0,
        ReportFont::Bold,
        &timeline.table_title,
    );
    cursor_y -= 5.0;
    cursor_y = render_timeline_table_header(ops, fonts, &timeline.columns, margin, cursor_y);

    for action in &timeline.actions[chunk.start_index..chunk.end_index] {
        cursor_y =
            render_timeline_action_row(ops, fonts, &timeline.columns, action, margin, cursor_y);
    }

    cursor_y
}

fn render_timeline_table_header(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    columns: &DesignReportTimelineColumnsInput,
    margin: f32,
    mut cursor_y: f32,
) -> f32 {
    text(
        ops,
        fonts,
        margin,
        cursor_y,
        7.5,
        ReportFont::Bold,
        &format!(
            "{} | {} | {} | {} | {}",
            columns.action_type,
            columns.start_date,
            columns.end_date,
            columns.target,
            columns.status
        ),
    );
    cursor_y -= 4.6;
    text(
        ops,
        fonts,
        margin,
        cursor_y,
        7.5,
        ReportFont::Bold,
        &format!(
            "{} | {} | {}",
            columns.description, columns.recurrence, columns.dependencies
        ),
    );
    cursor_y - 5.5
}

fn render_timeline_action_row(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    columns: &DesignReportTimelineColumnsInput,
    action: &DesignReportTimelineActionInput,
    margin: f32,
    mut cursor_y: f32,
) -> f32 {
    text(
        ops,
        fonts,
        margin,
        cursor_y,
        7.2,
        ReportFont::Regular,
        &format!(
            "{} | {} | {} | {} | {}",
            action.action_type_label,
            action.start_date,
            action.end_date,
            action.target,
            action.status
        ),
    );
    cursor_y -= 4.4;

    for line in wrap_text(
        &format!("{}: {}", columns.description, action.description),
        95,
    ) {
        text(
            ops,
            fonts,
            margin + 3.0,
            cursor_y,
            7.0,
            ReportFont::Regular,
            &line,
        );
        cursor_y -= TIMELINE_LINE_HEIGHT_MM;
    }

    for line in wrap_text(
        &format!(
            "{}: {} | {}: {}",
            columns.recurrence, action.recurrence, columns.dependencies, action.dependencies
        ),
        95,
    ) {
        text(
            ops,
            fonts,
            margin + 3.0,
            cursor_y,
            7.0,
            ReportFont::Regular,
            &line,
        );
        cursor_y -= TIMELINE_LINE_HEIGHT_MM;
    }

    cursor_y - 2.5
}

fn render_budget_section(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    budget: &DesignReportBudgetInput,
    chunk: BudgetPageChunk,
    margin: f32,
    mut cursor_y: f32,
) -> f32 {
    text(
        ops,
        fonts,
        margin,
        cursor_y,
        12.0,
        ReportFont::Bold,
        &budget.title,
    );
    cursor_y -= 8.0;
    cursor_y = render_budget_table_header(ops, fonts, &budget.columns, margin, cursor_y);

    for row in &budget.rows[chunk.start_index..chunk.end_index] {
        cursor_y = render_budget_row(ops, fonts, &budget.columns, row, margin, cursor_y);
    }

    if chunk.include_totals {
        cursor_y -= 2.0;
        for total in &budget.totals {
            text(
                ops,
                fonts,
                margin,
                cursor_y,
                8.0,
                ReportFont::Bold,
                &format!("{} ({}): {}", total.label, total.currency, total.amount),
            );
            cursor_y -= 4.8;
        }
    }

    cursor_y
}

fn render_budget_table_header(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    columns: &DesignReportBudgetColumnsInput,
    margin: f32,
    mut cursor_y: f32,
) -> f32 {
    text(
        ops,
        fonts,
        margin,
        cursor_y,
        7.5,
        ReportFont::Bold,
        &format!(
            "{} | {} | {} | {}",
            columns.target, columns.category, columns.quantity, columns.currency
        ),
    );
    cursor_y -= 4.6;
    text(
        ops,
        fonts,
        margin,
        cursor_y,
        7.5,
        ReportFont::Bold,
        &format!(
            "{} | {} | {}",
            columns.description, columns.unit_cost, columns.line_total
        ),
    );
    cursor_y - 5.5
}

fn render_budget_row(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    columns: &DesignReportBudgetColumnsInput,
    row: &DesignReportBudgetRowInput,
    margin: f32,
    mut cursor_y: f32,
) -> f32 {
    text(
        ops,
        fonts,
        margin,
        cursor_y,
        7.2,
        ReportFont::Regular,
        &format!(
            "{} | {} | {} | {} | {} | {}",
            row.target, row.category, row.quantity, row.unit_cost, row.line_total, row.currency
        ),
    );
    cursor_y -= 4.4;

    for line in wrap_text(&format!("{}: {}", columns.description, row.description), 95) {
        text(
            ops,
            fonts,
            margin + 3.0,
            cursor_y,
            7.0,
            ReportFont::Regular,
            &line,
        );
        cursor_y -= BUDGET_LINE_HEIGHT_MM;
    }

    cursor_y - 2.5
}

fn render_consortium_section(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    consortium: &DesignReportConsortiumInput,
    chunk: ConsortiumPageChunk,
    margin: f32,
    mut cursor_y: f32,
) -> f32 {
    text(
        ops,
        fonts,
        margin,
        cursor_y,
        12.0,
        ReportFont::Bold,
        &consortium.title,
    );
    cursor_y -= 8.0;

    if chunk.include_chart {
        cursor_y = render_consortium_chart(ops, fonts, consortium, margin, cursor_y);
        cursor_y -= 3.0;
    }

    text(
        ops,
        fonts,
        margin,
        cursor_y,
        9.0,
        ReportFont::Bold,
        &consortium.table_title,
    );
    cursor_y -= 5.0;
    cursor_y = render_consortium_table_header(ops, fonts, &consortium.columns, margin, cursor_y);

    for row in &consortium.rows[chunk.start_index..chunk.end_index] {
        cursor_y = render_consortium_row(ops, fonts, &consortium.columns, row, margin, cursor_y);
    }

    cursor_y
}

fn render_consortium_chart(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    consortium: &DesignReportConsortiumInput,
    margin: f32,
    mut cursor_y: f32,
) -> f32 {
    if consortium.chart_rows.is_empty() {
        return cursor_y;
    }

    text(
        ops,
        fonts,
        margin,
        cursor_y,
        9.0,
        ReportFont::Bold,
        &consortium.chart_title,
    );
    cursor_y -= 5.0;

    for line in wrap_text(
        &format!(
            "{} | {}",
            consortium.columns.stratum,
            consortium.phases.join(" | ")
        ),
        112,
    ) {
        text(ops, fonts, margin, cursor_y, 6.8, ReportFont::Bold, &line);
        cursor_y -= 4.0;
    }

    for row in &consortium.chart_rows {
        let cells = row
            .cells
            .iter()
            .map(|cell| {
                if cell.entries.is_empty() {
                    "-".to_string()
                } else {
                    cell.entries
                        .iter()
                        .map(|entry| entry.label.clone())
                        .collect::<Vec<_>>()
                        .join(", ")
                }
            })
            .collect::<Vec<_>>();
        for line in wrap_text(&format!("{} | {}", row.stratum, cells.join(" | ")), 112) {
            text(
                ops,
                fonts,
                margin,
                cursor_y,
                6.6,
                ReportFont::Regular,
                &line,
            );
            cursor_y -= CONSORTIUM_LINE_HEIGHT_MM;
        }
        cursor_y -= 1.5;
    }

    cursor_y
}

fn render_consortium_table_header(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    columns: &DesignReportConsortiumColumnsInput,
    margin: f32,
    mut cursor_y: f32,
) -> f32 {
    text(
        ops,
        fonts,
        margin,
        cursor_y,
        7.5,
        ReportFont::Bold,
        &format!(
            "{} | {} | {} | {}",
            columns.plant, columns.canonical_name, columns.stratum, columns.count
        ),
    );
    cursor_y -= 4.6;
    text(
        ops,
        fonts,
        margin,
        cursor_y,
        7.5,
        ReportFont::Bold,
        &format!("{} | {}", columns.start_phase, columns.end_phase),
    );
    cursor_y - 5.5
}

fn render_consortium_row(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    columns: &DesignReportConsortiumColumnsInput,
    row: &DesignReportConsortiumRowInput,
    margin: f32,
    mut cursor_y: f32,
) -> f32 {
    let canonical = row.canonical_name.as_deref().unwrap_or("-");
    for line in wrap_text(
        &format!(
            "{} | {} | {} | {}",
            row.plant, canonical, row.stratum, row.count
        ),
        112,
    ) {
        text(
            ops,
            fonts,
            margin,
            cursor_y,
            7.2,
            ReportFont::Regular,
            &line,
        );
        cursor_y -= CONSORTIUM_LINE_HEIGHT_MM;
    }

    for line in wrap_text(
        &format!(
            "{}: {} | {}: {}",
            columns.start_phase, row.start_phase, columns.end_phase, row.end_phase
        ),
        112,
    ) {
        text(
            ops,
            fonts,
            margin + 3.0,
            cursor_y,
            7.0,
            ReportFont::Regular,
            &line,
        );
        cursor_y -= CONSORTIUM_LINE_HEIGHT_MM;
    }

    cursor_y - 2.5
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

fn text(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    x_mm: f32,
    y_mm: f32,
    size_pt: f32,
    font: ReportFont,
    value: &str,
) {
    text_at_point(
        ops,
        fonts,
        Mm(x_mm).into_pt().0,
        Mm(y_mm).into_pt().0,
        size_pt,
        font,
        value,
    );
}

fn text_at_point(
    ops: &mut Vec<Op>,
    fonts: &ReportFonts,
    x_pt: f32,
    y_pt: f32,
    size_pt: f32,
    font: ReportFont,
    value: &str,
) {
    let mut cursor_x_pt = x_pt;
    for run in report_text_runs(value, font) {
        ops.push(Op::StartTextSection);
        ops.push(Op::SetFont {
            font: fonts.handle(run.face),
            size: Pt(size_pt),
        });
        ops.push(Op::SetTextCursor {
            pos: Point {
                x: Pt(cursor_x_pt),
                y: Pt(y_pt),
            },
        });
        ops.push(Op::ShowText {
            items: vec![TextItem::Text(run.text.clone())],
        });
        ops.push(Op::EndTextSection);
        cursor_x_pt += estimate_text_width_pt(&run.text, size_pt);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ReportTextRun {
    face: ReportFontFace,
    text: String,
}

fn report_text_runs(value: &str, font: ReportFont) -> Vec<ReportTextRun> {
    let mut runs = Vec::new();
    let mut current_face = None;
    let mut current_text = String::new();

    for character in value.chars() {
        let face = if character.is_whitespace() {
            current_face.unwrap_or_else(|| report_font_face(font))
        } else if is_hangul_report_character(character) {
            ReportFontFace::Hangul
        } else if is_cjk_report_character(character) {
            ReportFontFace::Cjk
        } else {
            report_font_face(font)
        };

        if current_face.is_some_and(|active| active != face) {
            runs.push(ReportTextRun {
                face: current_face.expect("face is set when flushing report text run"),
                text: std::mem::take(&mut current_text),
            });
        }
        current_face = Some(face);
        current_text.push(character);
    }

    if let Some(face) = current_face {
        runs.push(ReportTextRun {
            face,
            text: current_text,
        });
    }

    runs
}

fn report_font_face(font: ReportFont) -> ReportFontFace {
    match font {
        ReportFont::Regular => ReportFontFace::Regular,
        ReportFont::Bold => ReportFontFace::Bold,
    }
}

fn is_hangul_report_character(character: char) -> bool {
    matches!(
        character as u32,
        0x1100..=0x11FF | 0x3130..=0x318F | 0xA960..=0xA97F | 0xAC00..=0xD7AF
    )
}

fn is_cjk_report_character(character: char) -> bool {
    matches!(
        character as u32,
        0x2E80..=0x2FFF
            | 0x3000..=0x303F
            | 0x3040..=0x30FF
            | 0x3100..=0x312F
            | 0x31A0..=0x31BF
            | 0x31F0..=0x31FF
            | 0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0xFF00..=0xFFEF
            | 0x20000..=0x2FA1F
    )
}

fn estimate_text_width_pt(value: &str, size_pt: f32) -> f32 {
    value
        .chars()
        .map(|character| {
            if is_hangul_report_character(character) || is_cjk_report_character(character) {
                size_pt
            } else if character.is_whitespace() {
                size_pt * 0.3
            } else {
                size_pt * 0.55
            }
        })
        .sum()
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

fn draw_dashed_polyline(ops: &mut Vec<Op>, points: &[Point]) {
    ops.push(Op::SetLineDashPattern {
        dash: LineDashPattern {
            offset: 0,
            dash_1: Some(3),
            gap_1: Some(2),
            dash_2: None,
            gap_2: None,
            dash_3: None,
            gap_3: None,
        },
    });
    draw_polyline(ops, points, false);
    ops.push(Op::SetLineDashPattern {
        dash: LineDashPattern {
            offset: 0,
            dash_1: None,
            gap_1: None,
            dash_2: None,
            gap_2: None,
            dash_3: None,
            gap_3: None,
        },
    });
}

fn tick_points(point: Point, normal_x: f32, normal_y: f32, tick_half: f32) -> [Point; 2] {
    [
        Point {
            x: Pt(point.x.0 - normal_x * tick_half),
            y: Pt(point.y.0 - normal_y * tick_half),
        },
        Point {
            x: Pt(point.x.0 + normal_x * tick_half),
            y: Pt(point.y.0 + normal_y * tick_half),
        },
    ]
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
    if max_chars == 0 {
        return vec![value.to_string()];
    }

    let mut lines = Vec::new();
    let mut current = String::new();

    for word in value.split_whitespace() {
        for segment in split_text_token(word, max_chars) {
            let segment_len = segment.chars().count();
            let current_len = current.chars().count();
            if !current.is_empty() && current_len + 1 + segment_len > max_chars {
                lines.push(current);
                current = String::new();
            }

            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(&segment);

            if current.chars().count() >= max_chars {
                lines.push(current);
                current = String::new();
            }
        }
    }

    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

fn split_text_token(value: &str, max_chars: usize) -> Vec<String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    for character in value.chars() {
        if current.chars().count() >= max_chars {
            segments.push(current);
            current = String::new();
        }
        current.push(character);
    }
    if !current.is_empty() {
        segments.push(current);
    }
    segments
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
    use printpdf::PdfParseOptions;
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
        assert!(
            bytes.len() < 1_500_000,
            "small reports should subset bundled fonts instead of embedding every font in full"
        );
        assert_eq!(Path::new(&written_path), output_path.as_path());
    }

    #[test]
    fn renderer_serializes_supported_language_text_as_readable_unicode() {
        let supported_language_text = [
            "English report",
            "Planche Pérenne",
            "Diseño con olivo",
            "Entwurf mit Äpfeln",
            "Progettazione €",
            "Ontwerp met bessen",
            "Relatório com maçã",
            "Экспорт отчета",
            "デザインレポート",
            "디자인 보고서",
            "设计报告",
        ]
        .join(" | ");
        let input = DesignReportInput {
            title: supported_language_text.clone(),
            metadata: DesignReportMetadataInput {
                description: Some(supported_language_text.clone()),
                location: None,
            },
            ..report_input_without_metadata()
        };

        let bytes = render_design_report_pdf(&input).unwrap();
        let parsed = printpdf::PdfDocument::parse(
            &bytes,
            &PdfParseOptions {
                fail_on_error: false,
            },
            &mut Vec::new(),
        )
        .unwrap();
        let extracted = parsed
            .extract_text()
            .into_iter()
            .flatten()
            .collect::<String>();

        for sample in supported_language_text.split(" | ") {
            assert!(
                extracted.contains(sample),
                "expected extracted PDF text to contain {sample:?}, got {extracted:?}",
            );
        }
        assert_ne!(
            parsed.metadata.info.creation_date.unix_timestamp(),
            0,
            "PDF creation date should not use the printpdf epoch placeholder",
        );
        assert_ne!(
            parsed.metadata.info.modification_date.unix_timestamp(),
            0,
            "PDF modification date should not use the printpdf epoch placeholder",
        );
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

    #[test]
    fn renderer_includes_canvas_aids_and_legend_text() {
        let input = DesignReportInput {
            canvas: DesignReportCanvasInput {
                bounds: Some(DesignReportBounds {
                    min_x: 0.0,
                    min_y: 0.0,
                    max_x: 20.0,
                    max_y: 20.0,
                }),
                plants: vec![DesignReportPlantInput {
                    id: "plant-1".to_string(),
                    canonical_name: "Malus domestica".to_string(),
                    common_name: None,
                    color: Some("#112233".to_string()),
                    symbol: Some("tree".to_string()),
                    pinned_name_label: Some("Pommier".to_string()),
                    radius_m: Some(2.0),
                    x: 10.0,
                    y: 10.0,
                }],
                measurement_guides: vec![DesignReportMeasurementGuideInput {
                    id: "guide-1".to_string(),
                    start: DesignReportPointInput { x: 10.0, y: 10.0 },
                    end: DesignReportPointInput { x: 13.0, y: 14.0 },
                    label: "5 m".to_string(),
                }],
                legend: Some(DesignReportCanvasLegendInput::PinnedPlantNames {
                    title: "Legend".to_string(),
                    entries: vec![DesignReportPinnedPlantNameLegendEntryInput {
                        label: "Pommier".to_string(),
                        color: "#112233".to_string(),
                        symbol: "tree".to_string(),
                        count: 1,
                    }],
                }),
                ..report_input_without_metadata().canvas
            },
            ..report_input_without_metadata()
        };
        let layout = build_design_report_layout(&input);

        let page = render_test_page(&input, &layout.pages[0], 0);
        let text = page_text(&page).join("\n");

        assert!(text.contains("Pinned: Pommier"));
        assert!(text.contains("5 m"));
        assert!(text.contains("Legend"));
        assert!(text.contains("Pommier"));
        assert!(!text.contains("[tree]"));
        assert!(!text.contains("#112233"));
    }

    #[test]
    fn renderer_paginates_timeline_rows_with_repeated_headers() {
        let input = DesignReportInput {
            timeline: Some(timeline_input_with_actions(18)),
            ..report_input_without_metadata()
        };

        let layout = build_design_report_layout(&input);

        assert!(layout.pages.len() > 2);

        let first_timeline_page = render_test_page(&input, &layout.pages[1], 1);
        let first_text = page_text(&first_timeline_page).join("\n");
        assert!(first_text.contains("Timeline"));
        assert!(first_text.contains("Overview"));
        assert!(first_text.contains("Action type"));
        assert!(first_text.contains("Action 1"));
        assert!(first_text.contains("Long wrapped description"));

        let second_timeline_page = render_test_page(&input, &layout.pages[2], 2);
        let second_text = page_text(&second_timeline_page).join("\n");
        assert!(second_text.contains("Action type"));
        assert!(second_text.contains("Action 13"));
        assert!(second_text.contains("Page 3 of"));
    }

    #[test]
    fn renderer_omits_internal_ids_and_raw_implementation_values_from_report_text() {
        let input = DesignReportInput {
            canvas: DesignReportCanvasInput {
                bounds: Some(DesignReportBounds {
                    min_x: 0.0,
                    min_y: 0.0,
                    max_x: 20.0,
                    max_y: 20.0,
                }),
                zones: vec![DesignReportZoneInput {
                    name: "North bed".to_string(),
                    zone_type: "debug-zone-type".to_string(),
                    fill_color: Some("#AABBCC".to_string()),
                    points: vec![
                        DesignReportPointInput { x: 0.0, y: 0.0 },
                        DesignReportPointInput { x: 10.0, y: 0.0 },
                        DesignReportPointInput { x: 10.0, y: 10.0 },
                    ],
                }],
                plants: vec![DesignReportPlantInput {
                    id: "plant-uuid-123".to_string(),
                    canonical_name: "Malus domestica".to_string(),
                    common_name: Some("Pommier".to_string()),
                    color: Some("#112233".to_string()),
                    symbol: Some("tree".to_string()),
                    pinned_name_label: None,
                    radius_m: Some(2.0),
                    x: 5.0,
                    y: 5.0,
                }],
                annotations: vec![DesignReportAnnotationInput {
                    id: "annotation-uuid-456".to_string(),
                    text: "Irrigation note".to_string(),
                    x: 7.0,
                    y: 7.0,
                }],
                legend: Some(DesignReportCanvasLegendInput::ColorBy {
                    title: "Légende".to_string(),
                    attribute: "Strate".to_string(),
                    entries: vec![DesignReportColorByLegendEntryInput {
                        label: "Haut".to_string(),
                        color: "#00AA00".to_string(),
                    }],
                }),
                ..report_input_without_metadata().canvas
            },
            timeline: Some(DesignReportTimelineInput {
                overview_rows: vec![DesignReportTimelineOverviewRowInput {
                    action_type: "planting".to_string(),
                    label: "Plantation".to_string(),
                    color: "#7D6049".to_string(),
                    count: 1,
                    date_range: "1 mars 2026".to_string(),
                }],
                actions: vec![DesignReportTimelineActionInput {
                    action_type: "planting".to_string(),
                    action_type_label: "Plantation".to_string(),
                    description: "Installer les plants".to_string(),
                    start_date: "1 mars 2026".to_string(),
                    end_date: "1 mars 2026".to_string(),
                    recurrence: "Aucune".to_string(),
                    target: "Pommier".to_string(),
                    dependencies: "1 dépendance".to_string(),
                    status: "Terminé".to_string(),
                }],
                ..timeline_input_with_actions(0)
            }),
            consortium: Some(DesignReportConsortiumInput {
                chart_rows: vec![DesignReportConsortiumChartRowInput {
                    stratum: "Haut".to_string(),
                    cells: vec![DesignReportConsortiumChartCellInput {
                        entries: vec![DesignReportConsortiumChartEntryInput {
                            label: "Pommier".to_string(),
                            color: "#00AA00".to_string(),
                        }],
                    }],
                }],
                ..consortium_input_with_rows(0)
            }),
            ..report_input_without_metadata()
        };
        let layout = build_design_report_layout(&input);
        let text = layout
            .pages
            .iter()
            .enumerate()
            .map(|(index, page_layout)| {
                page_text(&render_test_page(&input, page_layout, index)).join("\n")
            })
            .collect::<Vec<_>>()
            .join("\n");

        assert!(text.contains("North bed"));
        assert!(text.contains("Pommier"));
        assert!(text.contains("Irrigation note"));
        assert!(text.contains("Color by: Strate"));
        assert!(text.contains("Plantation (1) - 1 mars 2026"));

        for leaked in [
            "debug-zone-type",
            "#AABBCC",
            "#112233",
            "#00AA00",
            "#7D6049",
            "[tree]",
            "plant-uuid-123",
            "annotation-uuid-456",
            "(planting)",
            "[planting",
        ] {
            assert!(
                !text.contains(leaked),
                "report text leaked implementation value {leaked:?}: {text:?}",
            );
        }
    }

    #[test]
    fn renderer_paginates_budget_rows_with_repeated_headers_and_totals() {
        let input = DesignReportInput {
            budget: Some(budget_input_with_rows(20)),
            ..report_input_without_metadata()
        };

        let layout = build_design_report_layout(&input);

        assert!(layout.pages.len() > 2);

        let first_budget_page = render_test_page(&input, &layout.pages[1], 1);
        let first_text = page_text(&first_budget_page).join("\n");
        assert!(first_text.contains("Budget"));
        assert!(first_text.contains("Target | Category"));
        assert!(first_text.contains("Bare-root tree 1"));

        let second_budget_page = render_test_page(&input, &layout.pages[2], 2);
        let second_text = page_text(&second_budget_page).join("\n");
        assert!(second_text.contains("Target | Category"));
        assert!(second_text.contains("Bare-root tree 14"));
        assert!(second_text.contains("Grand total"));
        assert!(second_text.contains("EUR 450.00"));
    }

    #[test]
    fn renderer_paginates_consortium_rows_with_chart_and_repeated_headers() {
        let input = DesignReportInput {
            consortium: Some(consortium_input_with_rows(24)),
            ..report_input_without_metadata()
        };

        let layout = build_design_report_layout(&input);

        assert!(layout.pages.len() > 2);

        let first_consortium_page = render_test_page(&input, &layout.pages[1], 1);
        let first_text = page_text(&first_consortium_page).join("\n");
        assert!(first_text.contains("Consortium"));
        assert!(first_text.contains("Succession chart"));
        assert!(first_text.contains("Placenta 1"));
        assert!(first_text.contains("High"));
        assert!(first_text.contains("Poirier"));
        assert!(first_text.contains("Plant | Canonical name"));
        assert!(first_text.contains("Consortium plant 1"));

        let rendered_pages = layout.pages[1..]
            .iter()
            .map(|page_layout| page_text(&render_test_page(&input, page_layout, 0)).join("\n"))
            .collect::<Vec<_>>();
        assert!(
            rendered_pages
                .iter()
                .filter(|text| text.contains("Plant | Canonical name"))
                .count()
                > 1
        );
        assert!(
            rendered_pages
                .iter()
                .any(|text| text.contains("Consortium plant 24"))
        );
    }

    #[test]
    fn renderer_localizes_document_labels_and_keeps_dense_report_text_printable() {
        let input = DesignReportInput {
            title: "Rapport complet".to_string(),
            labels: french_report_labels(),
            metadata: DesignReportMetadataInput {
                description: Some(
                    "Description avec un mot treslongtreslongtreslongtreslongtreslongtreslong pour verifier le retour a la ligne."
                        .to_string(),
                ),
                location: Some(DesignReportLocationInput {
                    lat: 48.8566,
                    lon: 2.3522,
                    altitude_m: Some(35.0),
                }),
            },
            canvas: DesignReportCanvasInput {
                bounds: None,
                visible_layer_names: vec![],
                plants: vec![],
                zones: vec![],
                annotations: vec![],
                measurement_guides: vec![],
                legend: Some(DesignReportCanvasLegendInput::ColorBy {
                    title: "Légende".to_string(),
                    attribute: "Strate".to_string(),
                    entries: vec![DesignReportColorByLegendEntryInput {
                        label: "Haut".to_string(),
                        color: "#00AA00".to_string(),
                    }],
                }),
                ..report_input_without_metadata().canvas
            },
            timeline: Some(timeline_input_with_actions(18)),
            budget: Some(budget_input_with_rows(20)),
            consortium: Some(consortium_input_with_rows(24)),
        };

        let layout = build_design_report_layout(&input);
        assert!(layout.pages.len() > 5);

        let first_page = render_test_page(&input, &layout.pages[0], 0);
        let first_text = page_text(&first_page).join("\n");
        assert!(first_text.contains("Vue d’ensemble"));
        assert!(first_text.contains("Emplacement: 48.85660, 2.35220"));
        assert!(first_text.contains("Calques visibles: par défaut"));
        assert!(first_text.contains("Colorier par: Strate"));
        assert!(first_text.contains("Aucun objet visible sur le canevas"));
        assert!(first_text.contains("Page 1 sur"));
        assert!(!first_text.contains("Visible layers"));
        assert!(!first_text.contains("Color by:"));

        for page_layout in &layout.pages {
            let page = render_test_page(&input, page_layout, 0);
            for positioned in page_text_positions(&page) {
                if positioned.text.starts_with("Page ") {
                    continue;
                }
                assert!(
                    positioned.y_pt >= Mm(12.0).into_pt().0,
                    "text below printable body: {:?}",
                    positioned
                );
                assert!(
                    positioned.y_pt <= Mm(page_layout.height_mm).into_pt().0,
                    "text above page: {:?}",
                    positioned
                );
                assert!(
                    positioned.text.chars().count() <= 128,
                    "text line too long to print cleanly: {:?}",
                    positioned
                );
            }
        }
    }

    #[test]
    fn wrap_text_splits_long_tokens_to_keep_pdf_lines_readable() {
        let lines = wrap_text("prefix abcdefghijklmnopqrstuvwxyz suffix", 8);

        assert!(lines.iter().all(|line| line.chars().count() <= 8));
        assert_eq!(
            lines,
            vec![
                "prefix".to_string(),
                "abcdefgh".to_string(),
                "ijklmnop".to_string(),
                "qrstuvwx".to_string(),
                "yz".to_string(),
                "suffix".to_string(),
            ]
        );
    }

    fn report_input_without_metadata() -> DesignReportInput {
        DesignReportInput {
            title: "Landscape report".to_string(),
            labels: DesignReportLabelsInput::default(),
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
                    pinned_name_label: None,
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
                measurement_guides: vec![],
                legend: None,
            },
            timeline: None,
            budget: None,
            consortium: None,
        }
    }

    fn french_report_labels() -> DesignReportLabelsInput {
        DesignReportLabelsInput {
            overview: "Vue d’ensemble".to_string(),
            location: "Emplacement".to_string(),
            altitude: "altitude".to_string(),
            design: "Design".to_string(),
            visible_layers: "Calques visibles".to_string(),
            default_visible_layers: "par défaut".to_string(),
            no_visible_canvas_objects: "Aucun objet visible sur le canevas".to_string(),
            pinned: "Épinglé".to_string(),
            color_by: "Colorier par".to_string(),
            page_number: "Page {page} sur {count}".to_string(),
        }
    }

    fn timeline_input_with_actions(count: usize) -> DesignReportTimelineInput {
        DesignReportTimelineInput {
            title: "Timeline".to_string(),
            overview_title: "Overview".to_string(),
            table_title: "Actions".to_string(),
            columns: DesignReportTimelineColumnsInput {
                action_type: "Action type".to_string(),
                description: "Description".to_string(),
                start_date: "Start".to_string(),
                end_date: "End".to_string(),
                recurrence: "Recurrence".to_string(),
                target: "Target".to_string(),
                dependencies: "Dependencies".to_string(),
                status: "Status".to_string(),
            },
            overview_rows: vec![DesignReportTimelineOverviewRowInput {
                action_type: "planting".to_string(),
                label: "Planting".to_string(),
                color: "#7D6049".to_string(),
                count: count as u32,
                date_range: "Mar 1, 2026 - Mar 18, 2026".to_string(),
            }],
            actions: (1..=count)
                .map(|index| DesignReportTimelineActionInput {
                    action_type: "planting".to_string(),
                    action_type_label: "Planting".to_string(),
                    description: format!(
                        "Action {index}: Long wrapped description with enough words to span more than one printable line."
                    ),
                    start_date: format!("Mar {index}, 2026"),
                    end_date: format!("Mar {index}, 2026"),
                    recurrence: "None".to_string(),
                    target: "Pommier".to_string(),
                    dependencies: "None".to_string(),
                    status: "Open".to_string(),
                })
                .collect(),
        }
    }

    fn budget_input_with_rows(count: usize) -> DesignReportBudgetInput {
        DesignReportBudgetInput {
            title: "Budget".to_string(),
            columns: DesignReportBudgetColumnsInput {
                target: "Target".to_string(),
                category: "Category".to_string(),
                description: "Description".to_string(),
                quantity: "Qty".to_string(),
                unit_cost: "Unit cost".to_string(),
                line_total: "Total".to_string(),
                currency: "Currency".to_string(),
            },
            rows: (1..=count)
                .map(|index| DesignReportBudgetRowInput {
                    target: "Pommier".to_string(),
                    category: "plants".to_string(),
                    description: format!(
                        "Bare-root tree {index} with a wrapped description for print layout"
                    ),
                    quantity: "2".to_string(),
                    unit_cost: "EUR 7.50".to_string(),
                    line_total: "EUR 15.00".to_string(),
                    currency: "EUR".to_string(),
                })
                .collect(),
            totals: vec![DesignReportBudgetTotalInput {
                label: "Grand total".to_string(),
                currency: "EUR".to_string(),
                amount: "EUR 450.00".to_string(),
            }],
        }
    }

    fn consortium_input_with_rows(count: usize) -> DesignReportConsortiumInput {
        DesignReportConsortiumInput {
            title: "Consortium".to_string(),
            chart_title: "Succession chart".to_string(),
            table_title: "Consortium entries".to_string(),
            phases: vec![
                "Placenta 1".to_string(),
                "Placenta 2".to_string(),
                "Placenta 3".to_string(),
                "Secondary 1".to_string(),
                "Secondary 2".to_string(),
                "Secondary 3".to_string(),
                "Climax".to_string(),
            ],
            columns: DesignReportConsortiumColumnsInput {
                plant: "Plant".to_string(),
                canonical_name: "Canonical name".to_string(),
                stratum: "Stratum".to_string(),
                start_phase: "Start".to_string(),
                end_phase: "End".to_string(),
                count: "Count".to_string(),
            },
            chart_rows: vec![DesignReportConsortiumChartRowInput {
                stratum: "High".to_string(),
                cells: vec![
                    DesignReportConsortiumChartCellInput {
                        entries: vec![DesignReportConsortiumChartEntryInput {
                            label: "Poirier".to_string(),
                            color: "#00AA00".to_string(),
                        }],
                    },
                    DesignReportConsortiumChartCellInput {
                        entries: vec![DesignReportConsortiumChartEntryInput {
                            label: "Poirier".to_string(),
                            color: "#00AA00".to_string(),
                        }],
                    },
                    DesignReportConsortiumChartCellInput { entries: vec![] },
                    DesignReportConsortiumChartCellInput { entries: vec![] },
                    DesignReportConsortiumChartCellInput { entries: vec![] },
                    DesignReportConsortiumChartCellInput { entries: vec![] },
                    DesignReportConsortiumChartCellInput { entries: vec![] },
                ],
            }],
            rows: (1..=count)
                .map(|index| DesignReportConsortiumRowInput {
                    plant: format!("Consortium plant {index}"),
                    canonical_name: Some(format!("Species canonical {index}")),
                    stratum: if index % 2 == 0 {
                        "High".to_string()
                    } else {
                        "Unassigned".to_string()
                    },
                    start_phase: "Placenta 1".to_string(),
                    end_phase: "Secondary 2".to_string(),
                    count: index.to_string(),
                })
                .collect(),
        }
    }

    fn render_test_page(
        input: &DesignReportInput,
        layout: &DesignReportPageLayout,
        page_index: usize,
    ) -> PdfPage {
        render_page(input, layout, page_index, &test_report_fonts())
    }

    fn test_report_fonts() -> ReportFonts {
        ReportFonts {
            regular: FontId("test-regular".to_string()),
            bold: FontId("test-bold".to_string()),
            cjk: FontId("test-cjk".to_string()),
            hangul: FontId("test-hangul".to_string()),
        }
    }

    fn page_text(page: &PdfPage) -> Vec<String> {
        page.ops
            .iter()
            .filter_map(|op| match op {
                Op::ShowText { items } => Some(
                    items
                        .iter()
                        .filter_map(|item| match item {
                            TextItem::Text(value) => Some(value.as_str()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join(""),
                ),
                _ => None,
            })
            .collect()
    }

    #[derive(Debug)]
    struct PositionedText {
        text: String,
        y_pt: f32,
    }

    fn page_text_positions(page: &PdfPage) -> Vec<PositionedText> {
        let mut cursor_y_pt = 0.0;
        let mut positions = Vec::new();
        for op in &page.ops {
            match op {
                Op::SetTextCursor { pos } => {
                    cursor_y_pt = pos.y.0;
                }
                Op::ShowText { items } => {
                    let text = items
                        .iter()
                        .filter_map(|item| match item {
                            TextItem::Text(value) => Some(value.as_str()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join("");
                    positions.push(PositionedText {
                        text,
                        y_pt: cursor_y_pt,
                    });
                }
                _ => {}
            }
        }
        positions
    }
}
