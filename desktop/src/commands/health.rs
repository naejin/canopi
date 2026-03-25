use common_types::health::SubsystemHealth;
use crate::AppHealth;

#[tauri::command]
pub fn get_health(health: tauri::State<'_, AppHealth>) -> Result<SubsystemHealth, String> {
    let h = health.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(h.clone())
}
