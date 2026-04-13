#[tauri::command]
pub fn toggle_favorite(
    user_db: tauri::State<'_, crate::db::UserDb>,
    canonical_name: String,
) -> Result<bool, String> {
    crate::services::plant_browser::toggle_favorite(&user_db, canonical_name)
}

#[tauri::command]
pub fn get_favorites(
    user_db: tauri::State<'_, crate::db::UserDb>,
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    locale: String,
) -> Result<Vec<common_types::species::SpeciesListItem>, String> {
    crate::services::plant_browser::get_favorites(&user_db, &plant_db, locale)
}

#[tauri::command]
pub fn get_recently_viewed(
    user_db: tauri::State<'_, crate::db::UserDb>,
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    locale: String,
    limit: u32,
) -> Result<Vec<common_types::species::SpeciesListItem>, String> {
    crate::services::plant_browser::get_recently_viewed(&user_db, &plant_db, locale, limit)
}
