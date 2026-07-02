use common_types::design::{DesignNotebookSection, DesignNotebookSnapshot, DesignSummary};

use crate::db::UserDb;

#[tauri::command]
pub fn get_design_notebook_entries(
    user_db: tauri::State<'_, UserDb>,
) -> Result<Vec<DesignSummary>, String> {
    crate::services::design_notebook::get_design_notebook_entries(&user_db)
}

#[tauri::command]
pub fn get_design_notebook(
    user_db: tauri::State<'_, UserDb>,
) -> Result<DesignNotebookSnapshot, String> {
    crate::services::design_notebook::get_design_notebook(&user_db)
}

#[tauri::command]
pub fn create_notebook_section(
    user_db: tauri::State<'_, UserDb>,
    name: String,
) -> Result<DesignNotebookSection, String> {
    crate::services::design_notebook::create_notebook_section(&user_db, &name)
}

#[tauri::command]
pub fn rename_notebook_section(
    user_db: tauri::State<'_, UserDb>,
    section_id: String,
    name: String,
) -> Result<(), String> {
    crate::services::design_notebook::rename_notebook_section(&user_db, &section_id, &name)
}

#[tauri::command]
pub fn delete_notebook_section(
    user_db: tauri::State<'_, UserDb>,
    section_id: String,
) -> Result<(), String> {
    crate::services::design_notebook::delete_notebook_section(&user_db, &section_id)
}

#[tauri::command]
pub fn move_design_reference_to_section(
    user_db: tauri::State<'_, UserDb>,
    path: String,
    section_id: Option<String>,
) -> Result<(), String> {
    crate::services::design_notebook::move_design_reference_to_section(&user_db, &path, section_id)
}

#[tauri::command]
pub fn set_design_reference_pinned(
    user_db: tauri::State<'_, UserDb>,
    path: String,
    pinned: bool,
) -> Result<(), String> {
    crate::services::design_notebook::set_design_reference_pinned(&user_db, &path, pinned)
}

#[tauri::command]
pub fn remove_design_reference(
    user_db: tauri::State<'_, UserDb>,
    path: String,
) -> Result<(), String> {
    crate::services::design_notebook::remove_design_reference(&user_db, &path)
}

#[tauri::command]
pub fn reorder_notebook_sections(
    user_db: tauri::State<'_, UserDb>,
    section_ids: Vec<String>,
) -> Result<(), String> {
    crate::services::design_notebook::reorder_notebook_sections(&user_db, section_ids)
}

#[tauri::command]
pub fn reorder_design_references(
    user_db: tauri::State<'_, UserDb>,
    paths: Vec<String>,
) -> Result<(), String> {
    crate::services::design_notebook::reorder_design_references(&user_db, paths)
}
