use crate::AppHealth;
use common_types::health::SubsystemHealth;

pub fn get_health(health: &AppHealth) -> Result<SubsystemHealth, String> {
    let current = crate::db::acquire(&health.0, "AppHealth");
    Ok(current.clone())
}
