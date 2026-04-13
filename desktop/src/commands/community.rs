pub use crate::services::community::TemplateMeta;

#[tauri::command]
pub fn get_template_catalog() -> Result<Vec<TemplateMeta>, String> {
    Ok(crate::services::community::get_template_catalog())
}

#[tauri::command]
pub fn get_template_preview(id: String) -> Result<TemplateMeta, String> {
    crate::services::community::get_template_preview(&id)
}

#[tauri::command]
pub async fn download_template(url: String) -> Result<String, String> {
    crate::blocking::run_blocking("template download", move || {
        crate::services::community::download_template_blocking(url)
    })
        .await
}
