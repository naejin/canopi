pub use crate::services::community::TemplateMeta;
use common_types::design::CanopiFile;
use tauri::State;

#[tauri::command]
pub fn get_template_catalog() -> Result<Vec<TemplateMeta>, String> {
    Ok(crate::services::community::get_template_catalog())
}

#[tauri::command]
pub fn get_template_preview(id: String) -> Result<TemplateMeta, String> {
    crate::services::community::get_template_preview(&id)
}

#[tauri::command]
pub async fn acquire_design_template(
    executor: State<'_, crate::native_operation::NativeOperationExecutor>,
    id: String,
) -> Result<CanopiFile, String> {
    executor
        .run(
            crate::native_operation::NativeOperationClass::Network,
            "template acquisition",
            move || crate::services::community::acquire_template_blocking(id),
        )
        .await
}
