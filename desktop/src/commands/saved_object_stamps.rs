use crate::db::UserDb;
use common_types::design::CanopiFile;
use common_types::saved_object_stamps::SavedObjectStamp;

#[tauri::command]
pub fn get_saved_object_stamps(
    user_db: tauri::State<'_, UserDb>,
) -> Result<Vec<SavedObjectStamp>, String> {
    crate::services::saved_object_stamps::get_saved_object_stamps(&user_db)
}

#[tauri::command]
pub fn create_saved_object_stamp(
    user_db: tauri::State<'_, UserDb>,
    name: String,
    payload_json: String,
) -> Result<SavedObjectStamp, String> {
    crate::services::saved_object_stamps::create_saved_object_stamp(&user_db, name, payload_json)
}

#[tauri::command]
pub fn rename_saved_object_stamp(
    user_db: tauri::State<'_, UserDb>,
    id: String,
    name: String,
) -> Result<SavedObjectStamp, String> {
    crate::services::saved_object_stamps::rename_saved_object_stamp(&user_db, id, name)
}

#[tauri::command]
pub fn delete_saved_object_stamp(
    user_db: tauri::State<'_, UserDb>,
    id: String,
) -> Result<bool, String> {
    crate::services::saved_object_stamps::delete_saved_object_stamp(&user_db, id)
}

#[tauri::command]
pub fn reorder_saved_object_stamps(
    user_db: tauri::State<'_, UserDb>,
    ids: Vec<String>,
) -> Result<Vec<SavedObjectStamp>, String> {
    crate::services::saved_object_stamps::reorder_saved_object_stamps(&user_db, ids)
}

#[tauri::command]
pub fn export_saved_object_stamp_canopi_file(
    path: String,
    content: CanopiFile,
) -> Result<String, String> {
    crate::services::design_files::export_design_file(path, content)
}

#[tauri::command]
pub fn load_saved_object_stamp_canopi_file(path: String) -> Result<CanopiFile, String> {
    crate::services::design_files::load_design_file(path)
}
