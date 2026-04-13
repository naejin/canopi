use crate::AppHealth;
use common_types::health::SubsystemHealth;

#[tauri::command]
pub fn get_health(health: tauri::State<'_, AppHealth>) -> Result<SubsystemHealth, String> {
    crate::services::health::get_health(&health)
}
