use common_types::design::DesignSummary;

use crate::db::UserDb;

#[tauri::command]
pub fn get_design_notebook_entries(
    user_db: tauri::State<'_, UserDb>,
) -> Result<Vec<DesignSummary>, String> {
    crate::services::design_notebook::get_design_notebook_entries(&user_db)
}
