use crate::db::acquire;
use tauri::State;

use common_types::species::{
    CommonNameEntry, DynamicFilterOptions, FilterOptions, FlowerColorResolution, PaginatedResult,
    Relationship, Sort, SpeciesDetail, SpeciesExternalLink, SpeciesFilter, SpeciesImage,
    SpeciesListItem,
};

/// Search species with optional full-text and structured filters.
///
/// Lock ordering: PlantDb is locked first, released before UserDb is locked.
/// Both locks are never held simultaneously.
#[allow(
    clippy::too_many_arguments,
    reason = "Tauri IPC currently exposes species search as flat named arguments"
)]
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
        let conn = acquire(&plant_db.0, "PlantDb");
        crate::db::plant_db::search(&conn, text_opt, filters, cursor, sort, limit, locale)?
    };

    // Step 2: check favorites for each item — plant lock is now released.
    {
        let conn = acquire(&user_db.0, "UserDb");
        for item in &mut result.items {
            item.is_favorite = crate::db::user_db::is_favorite(&conn, &item.canonical_name);
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
        let conn = acquire(&plant_db.0, "PlantDb");
        crate::db::plant_db::get_detail(&conn, &canonical_name, &locale)?
    };

    // Step 2: record the view in user DB — plant lock is now released.
    {
        let conn = acquire(&user_db.0, "UserDb");
        if let Err(e) = crate::db::user_db::record_recently_viewed(&conn, &canonical_name) {
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
    let conn = acquire(&plant_db.0, "PlantDb");

    // Resolve the UUID for the given canonical name, then fetch relationships.
    let species_id: String = conn
        .query_row(
            "SELECT id FROM species WHERE canonical_name = ?1 LIMIT 1",
            [&canonical_name],
            |row| -> rusqlite::Result<_> { row.get(0) },
        )
        .map_err(|e| format!("Failed to look up species id for '{canonical_name}': {e}"))?;

    crate::db::plant_db::get_relationships(&conn, &species_id)
}

/// Batch lookup: returns common names for a list of canonical names in the given locale.
#[tauri::command]
pub fn get_common_names(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    canonical_names: Vec<String>,
    locale: String,
) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_common_names_batch(&conn, &canonical_names, &locale)
}

/// Batch-fetch detail records for multiple species by canonical name.
/// Used for thematic coloring (plant display modes) — one IPC call for all placed plants.
#[tauri::command]
pub fn get_species_batch(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    canonical_names: Vec<String>,
    locale: String,
) -> Result<Vec<SpeciesDetail>, String> {
    let conn = acquire(&plant_db.0, "PlantDb");
    let mut results = Vec::with_capacity(canonical_names.len());
    for name in &canonical_names {
        match crate::db::plant_db::get_detail(&conn, name, &locale) {
            Ok(detail) => results.push(detail),
            Err(e) => {
                tracing::warn!("get_species_batch: skipping '{name}': {e}");
            }
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn get_flower_color_batch(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    canonical_names: Vec<String>,
) -> Result<Vec<FlowerColorResolution>, String> {
    let conn = acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_flower_color_batch(&conn, &canonical_names)
}

/// Returns all distinct values for populating filter UI dropdowns.
#[tauri::command]
pub fn get_filter_options(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
) -> Result<FilterOptions, String> {
    let conn = acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_filter_options(&conn)
}

/// Returns dynamic filter options (distinct values, ranges) for requested fields.
#[tauri::command]
pub fn get_dynamic_filter_options(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    fields: Vec<String>,
    locale: String,
) -> Result<Vec<DynamicFilterOptions>, String> {
    let conn = acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_dynamic_filter_options(&conn, &fields, &locale)
}

/// Returns images for a species by canonical name.
#[tauri::command]
pub fn get_species_images(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    canonical_name: String,
) -> Result<Vec<SpeciesImage>, String> {
    let conn = acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_species_images(&conn, &canonical_name)
}

/// Returns external links for a species by canonical name.
#[tauri::command]
pub fn get_species_external_links(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    canonical_name: String,
) -> Result<Vec<SpeciesExternalLink>, String> {
    let conn = acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_species_external_links(&conn, &canonical_name)
}

/// Returns all common names for a species in the given locale.
#[tauri::command]
pub fn get_locale_common_names(
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    canonical_name: String,
    locale: String,
) -> Result<Vec<CommonNameEntry>, String> {
    let conn = acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_locale_common_names(&conn, &canonical_name, &locale)
}

/// Fetch an image from a URL, cache it to disk, and return as a base64 data URL.
/// Uses fetch_and_cache_bytes to avoid a redundant fs::read after download.
#[tauri::command]
pub fn get_cached_image_url(
    cache: State<'_, crate::image_cache::ImageCache>,
    url: String,
) -> Result<String, String> {
    use base64::Engine;
    let bytes = cache.fetch_and_cache_bytes(&url)?;
    // Infer MIME from URL extension
    let url_path = url.split('?').next().unwrap_or(&url);
    let mime = match url_path.rsplit('.').next().unwrap_or("") {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "image/jpeg",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}
