use crate::db::UserDb;
use common_types::settings::Settings;

#[tauri::command]
pub fn get_settings(user_db: tauri::State<'_, UserDb>) -> Result<Settings, String> {
    crate::services::settings::get_settings(&user_db)
}

#[tauri::command]
pub fn set_settings(user_db: tauri::State<'_, UserDb>, settings: Settings) -> Result<(), String> {
    crate::services::settings::set_settings(&user_db, settings)
}
