pub use crate::services::geocoding::GeoResult;

#[tauri::command]
pub async fn geocode_address(query: String) -> Result<Vec<GeoResult>, String> {
    crate::services::geocoding::geocode_address(query).await
}
