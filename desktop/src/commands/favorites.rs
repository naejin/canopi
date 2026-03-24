use common_types::species::SpeciesListItem;

/// Toggle a species in the favorites list.
///
/// Returns `true` if the species is now a favorite, `false` if it was removed.
#[tauri::command]
pub fn toggle_favorite(
    user_db: tauri::State<'_, crate::db::UserDb>,
    canonical_name: String,
) -> Result<bool, String> {
    let conn = user_db.0.lock().unwrap_or_else(|e| e.into_inner());
    crate::db::user_db::toggle_favorite(&conn, &canonical_name)
        .map_err(|e| format!("Failed to toggle favorite for '{canonical_name}': {e}"))
}

/// Returns all favorited species, hydrated with plant data.
///
/// Lock ordering: UserDb first to get names, then PlantDb to hydrate — never simultaneously.
#[tauri::command]
pub fn get_favorites(
    user_db: tauri::State<'_, crate::db::UserDb>,
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    locale: String,
) -> Result<Vec<SpeciesListItem>, String> {
    // Step 1: get canonical names from user DB, then release.
    let names = {
        let conn = user_db.0.lock().unwrap_or_else(|e| e.into_inner());
        crate::db::user_db::get_favorite_names(&conn)
    };

    if names.is_empty() {
        return Ok(vec![]);
    }

    // Step 2: hydrate from plant DB.
    let conn = plant_db.0.lock().unwrap_or_else(|e| e.into_inner());
    let items = hydrate_species_list(&conn, &names, &locale, true)?;
    Ok(items)
}

/// Returns the most recently viewed species, hydrated with plant data.
///
/// Lock ordering: UserDb first to get names, then PlantDb to hydrate — never simultaneously.
#[tauri::command]
pub fn get_recently_viewed(
    user_db: tauri::State<'_, crate::db::UserDb>,
    plant_db: tauri::State<'_, crate::db::PlantDb>,
    locale: String,
    limit: u32,
) -> Result<Vec<SpeciesListItem>, String> {
    // Step 1: get recently viewed names from user DB, then release.
    let names = {
        let conn = user_db.0.lock().unwrap_or_else(|e| e.into_inner());
        crate::db::user_db::get_recently_viewed_names(&conn, limit)
    };

    if names.is_empty() {
        return Ok(vec![]);
    }

    // Step 2: hydrate from plant DB, then check favorites.
    let plant_conn = plant_db.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut items = hydrate_species_list(&plant_conn, &names, &locale, false)?;
    drop(plant_conn);

    // Step 3: mark favorites — plant lock is now released.
    {
        let user_conn = user_db.0.lock().unwrap_or_else(|e| e.into_inner());
        for item in &mut items {
            item.is_favorite =
                crate::db::user_db::is_favorite(&user_conn, &item.canonical_name);
        }
    }

    Ok(items)
}

/// Hydrates a list of canonical names into `SpeciesListItem` records by querying
/// the plant DB for each name. Names not found in the plant DB are silently skipped.
///
/// `all_favorites` — when true, `is_favorite` is set to `true` on every item
/// (used by `get_favorites` where all results are by definition favorites).
fn hydrate_species_list(
    conn: &rusqlite::Connection,
    names: &[String],
    locale: &str,
    all_favorites: bool,
) -> Result<Vec<SpeciesListItem>, String> {
    let mut items = Vec::with_capacity(names.len());

    for name in names {
        let row: Option<SpeciesListItem> = conn
            .query_row(
                "SELECT s.canonical_name,
                        s.slug,
                        s.common_name,
                        s.family,
                        s.genus,
                        s.height_max_m,
                        s.hardiness_zone_min,
                        s.hardiness_zone_max,
                        s.growth_rate,
                        s.stratum,
                        s.edibility_rating,
                        s.medicinal_rating,
                        s.width_max_m,
                        s.id
                 FROM species s
                 WHERE s.canonical_name = ?1
                 LIMIT 1",
                [name],
                |row| {
                    Ok((
                        SpeciesListItem {
                            canonical_name: row.get(0)?,
                            slug: row.get(1)?,
                            common_name: row.get(2)?,
                            family: row.get(3)?,
                            genus: row.get(4)?,
                            height_max_m: row.get(5)?,
                            hardiness_zone_min: row.get(6)?,
                            hardiness_zone_max: row.get(7)?,
                            growth_rate: row.get(8)?,
                            stratum: row.get(9)?,
                            edibility_rating: row.get(10)?,
                            medicinal_rating: row.get(11)?,
                            width_max_m: row.get(12)?,
                            is_favorite: all_favorites,
                        },
                        row.get::<_, String>(13)?, // species_id for common name lookup
                    ))
                },
            )
            .optional()
            .map_err(|e| format!("Failed to hydrate species '{name}': {e}"))?
            .map(|(mut item, species_id)| {
                // Override common_name with locale-aware lookup.
                item.common_name =
                    crate::db::plant_db::get_common_name(conn, &species_id, locale)
                        .or(item.common_name);
                item
            });

        if let Some(item) = row {
            items.push(item);
        }
    }

    Ok(items)
}

// rusqlite::OptionalExtension is required for .optional() above.
use rusqlite::OptionalExtension;
