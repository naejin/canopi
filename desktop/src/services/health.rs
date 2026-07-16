use crate::AppHealth;
use common_types::health::SubsystemHealth;

pub fn get_health(health: &AppHealth) -> SubsystemHealth {
    health.0.clone()
}
