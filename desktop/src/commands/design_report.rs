use crate::services::design_report::DesignReportInput;

#[tauri::command]
pub fn export_design_report_pdf(input: DesignReportInput, path: String) -> Result<String, String> {
    crate::services::design_report::export_design_report_pdf(&input, path)
}
