use crate::db::UserDb;
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
