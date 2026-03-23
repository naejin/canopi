use common_types::settings::Settings;
use crate::db::{self, UserDb};

#[tauri::command]
pub fn get_settings(user_db: tauri::State<'_, UserDb>) -> Result<Settings, String> {
    let conn = user_db.0.lock().map_err(|e| e.to_string())?;
    let json = db::user_db::get_setting(&conn, "settings")
        .map_err(|e| e.to_string())?;
    match json {
        Some(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        None => Ok(Settings::default()),
    }
}

#[tauri::command]
pub fn set_settings(
    user_db: tauri::State<'_, UserDb>,
    settings: Settings,
) -> Result<(), String> {
    let conn = user_db.0.lock().map_err(|e| e.to_string())?;
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    db::user_db::set_setting(&conn, "settings", &json).map_err(|e| e.to_string())
}
