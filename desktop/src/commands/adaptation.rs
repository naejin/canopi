pub use crate::contracts::adaptation::{CompatibilityResult, ReplacementSuggestion};

/// Check a batch of species against a target hardiness zone.
///
/// A plant is compatible when the target zone falls within
/// `[hardiness_zone_min, hardiness_zone_max]`. Zone diff is the
/// minimum distance to the compatible range (0 when inside).
#[tauri::command]
pub fn check_plant_compatibility(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    canonical_names: Vec<String>,
    target_hardiness: i32,
    locale: String,
) -> Result<Vec<CompatibilityResult>, String> {
    crate::services::adaptation::check_plant_compatibility(
        &plant_db,
        canonical_names,
        target_hardiness,
        locale,
    )
}

/// Suggest replacement species for one that is incompatible at a target zone.
///
/// Finds species with the same stratum (if known) and similar height (within
/// +/- 50%) that are compatible with the target hardiness zone.
#[tauri::command]
pub fn suggest_replacements(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    canonical_name: String,
    target_hardiness: i32,
    limit: u32,
    locale: String,
) -> Result<Vec<ReplacementSuggestion>, String> {
    crate::services::adaptation::suggest_replacements(
        &plant_db,
        canonical_name,
        target_hardiness,
        limit,
        locale,
    )
}
