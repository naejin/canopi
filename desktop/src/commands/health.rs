use crate::AppHealth;
use common_types::health::SubsystemHealth;

#[tauri::command]
pub fn get_health(health: tauri::State<'_, AppHealth>) -> Result<SubsystemHealth, String> {
    let h = crate::db::acquire(&health.0, "AppHealth");
    Ok(h.clone())
}
