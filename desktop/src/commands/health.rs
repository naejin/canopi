use crate::AppHealth;
use common_types::health::SubsystemHealth;

#[tauri::command]
pub fn get_health(health: tauri::State<'_, AppHealth>) -> Result<SubsystemHealth, String> {
    Ok(crate::services::health::get_health(&health))
}
