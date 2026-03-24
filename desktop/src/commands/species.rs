use common_types::species::{
    FilterOptions, PaginatedResult, Relationship, Sort, SpeciesDetail, SpeciesFilter,
    SpeciesListItem,
};

/// Search species with optional full-text and structured filters.
///
/// Lock ordering: PlantDb is locked first, released before UserDb is locked.
/// Both locks are never held simultaneously.
#[tauri::command]
pub fn search_species(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    user_db: tauri::State<'_, crate::db::UserDb>,
    text: String,
    filters: SpeciesFilter,
    cursor: Option<String>,
    limit: u32,
    sort: Sort,
    locale: String,
) -> Result<PaginatedResult<SpeciesListItem>, String> {
    // Step 1: query plant DB, then release the lock before touching user DB.
    let text_opt = if text.trim().is_empty() {
        None
    } else {
        Some(text)
    };

    let mut result = {
        let conn = plant_db.0.lock().unwrap_or_else(|e| e.into_inner());
        crate::db::plant_db::search(&conn, text_opt, filters, cursor, sort, limit, locale)?
    };

    // Step 2: check favorites for each item — plant lock is now released.
    {
        let conn = user_db.0.lock().unwrap_or_else(|e| e.into_inner());
        for item in &mut result.items {
            item.is_favorite =
                crate::db::user_db::is_favorite(&conn, &item.canonical_name);
        }
    }

    Ok(result)
}

/// Fetch the full detail record for a species and record it in recently viewed.
///
/// Lock ordering: PlantDb first, then UserDb — never simultaneously.
#[tauri::command]
pub fn get_species_detail(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    user_db: tauri::State<'_, crate::db::UserDb>,
    canonical_name: String,
    locale: String,
) -> Result<SpeciesDetail, String> {
    // Step 1: fetch detail from plant DB.
    let detail = {
        let conn = plant_db.0.lock().unwrap_or_else(|e| e.into_inner());
        crate::db::plant_db::get_detail(&conn, &canonical_name, &locale)?
    };

    // Step 2: record the view in user DB — plant lock is now released.
    {
        let conn = user_db.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Err(e) =
            crate::db::user_db::record_recently_viewed(&conn, &canonical_name)
        {
            tracing::warn!(
                "Failed to record recently viewed for '{}': {e}",
                canonical_name
            );
        }
    }

    Ok(detail)
}

/// Returns companion/antagonist relationships for a species.
#[tauri::command]
pub fn get_species_relationships(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    canonical_name: String,
) -> Result<Vec<Relationship>, String> {
    let conn = plant_db.0.lock().unwrap_or_else(|e| e.into_inner());

    // Resolve the UUID for the given canonical name, then fetch relationships.
    let species_id: String = conn
        .query_row(
            "SELECT id FROM species WHERE canonical_name = ?1 LIMIT 1",
            [&canonical_name],
            |row| row.get(0),
        )
        .map_err(|e| {
            format!("Failed to look up species id for '{canonical_name}': {e}")
        })?;

    crate::db::plant_db::get_relationships(&conn, &species_id)
}

/// Batch lookup: returns common names for a list of canonical names in the given locale.
#[tauri::command]
pub fn get_common_names(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    canonical_names: Vec<String>,
    locale: String,
) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = plant_db.0.lock().unwrap_or_else(|e| e.into_inner());
    crate::db::plant_db::get_common_names_batch(&conn, &canonical_names, &locale)
}

/// Returns all distinct values for populating filter UI dropdowns.
#[tauri::command]
pub fn get_filter_options(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
) -> Result<FilterOptions, String> {
    let conn = plant_db.0.lock().unwrap_or_else(|e| e.into_inner());
    crate::db::plant_db::get_filter_options(&conn)
}
