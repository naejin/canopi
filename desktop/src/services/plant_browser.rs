use common_types::species::{
    PaginatedResult, Sort, SpeciesDetail, SpeciesFilter, SpeciesListItem,
};

use crate::db::{self, PlantDb, UserDb};

#[allow(
    clippy::too_many_arguments,
    reason = "Service mirrors the current flat Tauri species search contract"
)]
pub fn search_species(
    plant_db: &PlantDb,
    user_db: &UserDb,
    text: String,
    filters: SpeciesFilter,
    cursor: Option<String>,
    limit: u32,
    sort: Sort,
    locale: String,
    include_total: Option<bool>,
) -> Result<PaginatedResult<SpeciesListItem>, String> {
    let text_opt = if text.trim().is_empty() {
        None
    } else {
        Some(text)
    };

    let mut result = {
        let conn = db::require_plant_db(plant_db)?;
        crate::db::plant_db::search(
            &conn,
            text_opt,
            filters,
            cursor,
            sort,
            limit,
            include_total.unwrap_or(true),
            locale,
        )?
    };

    {
        let conn = db::acquire(&user_db.0, "UserDb");
        for item in &mut result.items {
            item.is_favorite = crate::db::user_db::is_favorite(&conn, &item.canonical_name);
        }
    }

    Ok(result)
}

pub fn get_species_detail(
    plant_db: &PlantDb,
    user_db: &UserDb,
    canonical_name: String,
    locale: String,
) -> Result<SpeciesDetail, String> {
    let detail = {
        let conn = db::require_plant_db(plant_db)?;
        crate::db::plant_db::get_detail(&conn, &canonical_name, &locale)?
    };

    {
        let conn = db::acquire(&user_db.0, "UserDb");
        if let Err(error) = crate::db::user_db::record_recently_viewed(&conn, &canonical_name) {
            tracing::warn!(
                "Failed to record recently viewed for '{}': {error}",
                canonical_name
            );
        }
    }

    Ok(detail)
}

pub fn toggle_favorite(user_db: &UserDb, canonical_name: String) -> Result<bool, String> {
    let conn = db::acquire(&user_db.0, "UserDb");
    crate::db::user_db::toggle_favorite(&conn, &canonical_name)
        .map_err(|e| format!("Failed to toggle favorite for '{canonical_name}': {e}"))
}

pub fn get_favorites(
    user_db: &UserDb,
    plant_db: &PlantDb,
    locale: String,
) -> Result<Vec<SpeciesListItem>, String> {
    let names = {
        let conn = db::acquire(&user_db.0, "UserDb");
        crate::db::user_db::get_favorite_names(&conn)
            .map_err(|e| format!("Failed to read favorites: {e}"))?
    };

    if names.is_empty() {
        return Ok(vec![]);
    }

    let conn = db::require_plant_db(plant_db)?;
    crate::db::plant_db::hydrate_species_list_items(&conn, &names, &locale, true)
}

pub fn get_recently_viewed(
    user_db: &UserDb,
    plant_db: &PlantDb,
    locale: String,
    limit: u32,
) -> Result<Vec<SpeciesListItem>, String> {
    let names = {
        let conn = db::acquire(&user_db.0, "UserDb");
        crate::db::user_db::get_recently_viewed_names(&conn, limit)
            .map_err(|e| format!("Failed to read recently viewed: {e}"))?
    };

    if names.is_empty() {
        return Ok(vec![]);
    }

    let mut items = {
        let plant_conn = db::require_plant_db(plant_db)?;
        crate::db::plant_db::hydrate_species_list_items(&plant_conn, &names, &locale, false)?
    };

    {
        let user_conn = db::acquire(&user_db.0, "UserDb");
        for item in &mut items {
            item.is_favorite = crate::db::user_db::is_favorite(&user_conn, &item.canonical_name);
        }
    }

    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::{
        get_favorites, get_recently_viewed, search_species, toggle_favorite,
    };
    use crate::db::{self, PlantDb, UserDb};
    use common_types::species::{Sort, SpeciesFilter};
    use rusqlite::Connection;
    use std::sync::Mutex;

    fn test_plant_db() -> PlantDb {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE species (
                id TEXT PRIMARY KEY,
                canonical_name TEXT NOT NULL,
                slug TEXT NOT NULL,
                common_name TEXT,
                family TEXT,
                genus TEXT,
                height_max_m REAL,
                hardiness_zone_min INTEGER,
                hardiness_zone_max INTEGER,
                growth_rate TEXT,
                stratum TEXT,
                edibility_rating INTEGER,
                medicinal_rating INTEGER,
                width_max_m REAL
            );
            CREATE VIRTUAL TABLE species_search_fts USING fts5(
                canonical_name, common_name,
                content='species', content_rowid='rowid'
            );
            CREATE TABLE best_common_names (
                species_id TEXT NOT NULL,
                language TEXT NOT NULL,
                common_name TEXT NOT NULL,
                PRIMARY KEY (species_id, language)
            );
            CREATE TABLE species_common_names (
                species_id TEXT NOT NULL,
                common_name TEXT NOT NULL,
                language TEXT NOT NULL,
                is_primary INTEGER NOT NULL DEFAULT 0,
                source TEXT
            );

            INSERT INTO species (
                id, canonical_name, slug, common_name, family, genus,
                height_max_m, hardiness_zone_min, hardiness_zone_max,
                growth_rate, stratum, edibility_rating, medicinal_rating, width_max_m
            ) VALUES
                ('sp-1', 'Malus domestica', 'malus-domestica', 'Apple', 'Rosaceae', 'Malus', 4.0, 4, 8, 'Medium', 'Canopy', 5, 1, 3.0),
                ('sp-2', 'Lavandula angustifolia', 'lavandula-angustifolia', 'Lavender', 'Lamiaceae', 'Lavandula', 1.0, 5, 9, 'Slow', 'Low', 1, 1, 1.0);

            INSERT INTO best_common_names VALUES
                ('sp-1', 'fr', 'Pommier'),
                ('sp-2', 'fr', 'Lavande');

            INSERT INTO species_common_names VALUES
                ('sp-1', 'Apple', 'en', 1, 'test'),
                ('sp-1', 'Pommier', 'fr', 1, 'test'),
                ('sp-1', 'Pomme', 'fr', 0, 'test'),
                ('sp-2', 'Lavender', 'en', 1, 'test'),
                ('sp-2', 'Lavande', 'fr', 1, 'test');

            INSERT INTO species_search_fts(species_search_fts) VALUES('rebuild');",
        )
        .unwrap();
        PlantDb::available(conn)
    }

    fn test_user_db() -> UserDb {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE favorites (
                 canonical_name TEXT PRIMARY KEY,
                 added_at TEXT NOT NULL
             );
             CREATE TABLE recently_viewed (
                 canonical_name TEXT PRIMARY KEY,
                 viewed_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE TRIGGER IF NOT EXISTS limit_recently_viewed
             AFTER INSERT ON recently_viewed
             BEGIN
                 DELETE FROM recently_viewed WHERE canonical_name NOT IN (
                     SELECT canonical_name FROM recently_viewed ORDER BY viewed_at DESC LIMIT 50
                 );
             END;",
        )
        .unwrap();
        UserDb(Mutex::new(conn))
    }

    #[test]
    fn search_returns_explicit_error_when_plant_db_missing() {
        let plant_db = PlantDb::missing();
        let user_db = test_user_db();

        let error = search_species(
            &plant_db,
            &user_db,
            "Malus".to_owned(),
            SpeciesFilter::default(),
            None,
            10,
            Sort::Name,
            "en".to_owned(),
            Some(true),
        )
        .unwrap_err();

        assert!(error.contains("Plant database unavailable"));
    }

    #[test]
    fn search_marks_favorites_after_db_query() {
        let plant_db = test_plant_db();
        let user_db = test_user_db();

        toggle_favorite(&user_db, "Malus domestica".to_owned()).unwrap();

        let result = search_species(
            &plant_db,
            &user_db,
            "Malus".to_owned(),
            SpeciesFilter::default(),
            None,
            10,
            Sort::Name,
            "en".to_owned(),
            Some(true),
        )
        .unwrap();

        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].canonical_name, "Malus domestica");
        assert!(result.items[0].is_favorite);
    }

    #[test]
    fn favorites_hydration_skips_missing_species_and_uses_locale_names() {
        let plant_db = test_plant_db();
        let user_db = test_user_db();

        toggle_favorite(&user_db, "Malus domestica".to_owned()).unwrap();
        toggle_favorite(&user_db, "Missing species".to_owned()).unwrap();

        let items = get_favorites(&user_db, &plant_db, "fr".to_owned()).unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].canonical_name, "Malus domestica");
        assert_eq!(items[0].common_name.as_deref(), Some("Pommier"));
        assert_eq!(items[0].common_name_2.as_deref(), Some("Pomme"));
        assert!(items[0].is_favorite);
    }

    #[test]
    fn recently_viewed_hydration_marks_favorites_after_hydration() {
        let plant_db = test_plant_db();
        let user_db = test_user_db();

        {
            let conn = db::acquire(&user_db.0, "UserDb");
            crate::db::user_db::record_recently_viewed(&conn, "Malus domestica").unwrap();
            crate::db::user_db::record_recently_viewed(&conn, "Lavandula angustifolia").unwrap();
        }
        toggle_favorite(&user_db, "Lavandula angustifolia".to_owned()).unwrap();

        let items = get_recently_viewed(&user_db, &plant_db, "en".to_owned(), 10).unwrap();

        assert_eq!(items.len(), 2);
        let apple = items
            .iter()
            .find(|item| item.canonical_name == "Malus domestica")
            .unwrap();
        let lavender = items
            .iter()
            .find(|item| item.canonical_name == "Lavandula angustifolia")
            .unwrap();
        assert!(!apple.is_favorite);
        assert!(lavender.is_favorite);
    }
}
