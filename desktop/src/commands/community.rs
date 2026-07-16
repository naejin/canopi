pub use crate::services::community::TemplateMeta;
use common_types::design::CanopiFile;

#[tauri::command]
pub fn get_template_catalog() -> Result<Vec<TemplateMeta>, String> {
    Ok(crate::services::community::get_template_catalog())
}

#[tauri::command]
pub fn get_template_preview(id: String) -> Result<TemplateMeta, String> {
    crate::services::community::get_template_preview(&id)
}

#[tauri::command]
pub async fn acquire_design_template(id: String) -> Result<CanopiFile, String> {
    crate::blocking::run_blocking("template acquisition", move || {
        crate::services::community::acquire_template_blocking(id)
    })
    .await
}
