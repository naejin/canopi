use common_types::species::{PaginatedResult, Sort, SpeciesFilter, SpeciesListItem};
use rusqlite::{Connection, params_from_iter};

use crate::db::query_builder::{SpeciesSearchPlan, SpeciesSearchRequest};

/// Searches species using FTS5, structured filters, or both.
///
/// Returns a paginated result. Pass the `next_cursor` from a previous result
/// to fetch the next page.
pub fn search(
    conn: &Connection,
    text: Option<String>,
    filters: SpeciesFilter,
    cursor: Option<String>,
    sort: Sort,
    limit: u32,
    include_total: bool,
    locale: String,
) -> Result<PaginatedResult<SpeciesListItem>, String> {
    let plan = SpeciesSearchPlan::build(SpeciesSearchRequest {
        text,
        filters,
        cursor,
        sort,
        limit,
        include_total,
        locale,
    });

    let total_estimate = if let Some(count) = plan.count() {
        conn.query_row(count.sql(), params_from_iter(count.params()), |row| {
            row.get::<_, u32>(0)
        })
        .map_err(|e| format!("Failed to count species search results: {e}"))?
    } else {
        0
    };

    let list = plan.list();
    let mut stmt = conn
        .prepare(list.sql())
        .map_err(|e| format!("Failed to prepare species search: {e}"))?;

    let rows: Vec<SpeciesListItem> = stmt
        .query_map(params_from_iter(list.params()), |row| {
            Ok(SpeciesListItem {
                canonical_name: row.get(0)?,
                slug: row.get(1)?,
                common_name: row.get(2)?,
                common_name_2: row.get(3)?,
                is_name_fallback: row.get::<_, i32>(4).unwrap_or(0) == 1,
                family: row.get(5)?,
                genus: row.get(6)?,
                height_max_m: row.get(7)?,
                hardiness_zone_min: row.get(8)?,
                hardiness_zone_max: row.get(9)?,
                growth_rate: row.get(10)?,
                stratum: row.get(11)?,
                edibility_rating: row.get(12)?,
                medicinal_rating: row.get(13)?,
                width_max_m: row.get(14)?,
                is_favorite: false,
            })
        })
        .map_err(|e| format!("Failed to execute species search: {e}"))?
        .filter_map(|result| match result {
            Ok(item) => Some(item),
            Err(error) => {
                tracing::warn!("Skipped species search row: {error}");
                None
            }
        })
        .collect();

    let has_next = rows.len() as u32 > limit;
    let items: Vec<SpeciesListItem> = rows.into_iter().take(limit as usize).collect();
    let next_cursor = plan.next_cursor(&items, has_next);

    Ok(PaginatedResult {
        items,
        next_cursor,
        total_estimate,
    })
}

#[cfg(test)]
mod tests {
    use super::search;
    use common_types::species::{Sort, SpeciesFilter};
    use rusqlite::Connection;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE species (
                id INTEGER PRIMARY KEY,
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
                species_id INTEGER NOT NULL,
                language TEXT NOT NULL,
                common_name TEXT NOT NULL,
                PRIMARY KEY (species_id, language)
            );
            CREATE TABLE species_common_names (
                species_id INTEGER NOT NULL,
                common_name TEXT NOT NULL,
                language TEXT NOT NULL,
                is_primary INTEGER NOT NULL DEFAULT 0,
                source TEXT
            );

            INSERT INTO species (
                id,
                canonical_name, slug, common_name, family, genus,
                height_max_m, hardiness_zone_min, hardiness_zone_max,
                growth_rate, stratum, edibility_rating, medicinal_rating, width_max_m
            ) VALUES
                (1, 'Lavandula alpha', 'lavandula-alpha', 'Lavender Alpha', 'Lamiaceae', 'Lavandula', 1.0, 5, 9, 'Slow', 'Low', 1, 1, 1.0),
                (2, 'Lavandula beta', 'lavandula-beta', 'Lavender Beta', 'Lamiaceae', 'Lavandula', 1.2, 5, 9, 'Slow', 'Low', 1, 1, 1.1);

            INSERT INTO best_common_names VALUES
                (1, 'en', 'Lavender Alpha'),
                (2, 'en', 'Lavender Beta'),
                (1, 'fr', 'Lavande Alpha');

            INSERT INTO species_common_names VALUES
                (1, 'Lavandula alpha', 'fr', 1, 'test'),
                (1, 'Lavande Alpha', 'fr', 0, 'test'),
                (1, 'Lavande vraie', 'fr', 0, 'test');

            INSERT INTO species_search_fts(species_search_fts) VALUES('rebuild');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn relevance_pagination_uses_offset_cursor_without_duplicates() {
        let conn = test_db();

        let first = search(
            &conn,
            Some("lavender".to_owned()),
            SpeciesFilter::default(),
            None,
            Sort::Relevance,
            1,
            true,
            "en".to_owned(),
        )
        .unwrap();

        assert_eq!(first.items.len(), 1);
        assert_eq!(first.total_estimate, 2);
        assert_eq!(first.next_cursor.as_deref(), Some("offset:1"));

        let second = search(
            &conn,
            Some("lavender".to_owned()),
            SpeciesFilter::default(),
            first.next_cursor.clone(),
            Sort::Relevance,
            1,
            false,
            "en".to_owned(),
        )
        .unwrap();

        assert_eq!(second.items.len(), 1);
        assert_eq!(second.total_estimate, 0);
        assert_ne!(
            first.items[0].canonical_name,
            second.items[0].canonical_name
        );
        assert_eq!(second.next_cursor, None);
    }

    #[test]
    fn locale_common_names_and_fallback() {
        let conn = test_db();

        let result = search(
            &conn,
            None,
            SpeciesFilter::default(),
            None,
            Sort::Name,
            10,
            true,
            "fr".to_owned(),
        )
        .unwrap();

        assert_eq!(result.items.len(), 2);
        assert_eq!(result.total_estimate, 2);

        // Species 1 has French names -> locale name + secondary, no fallback
        let alpha = result
            .items
            .iter()
            .find(|i| i.canonical_name == "Lavandula alpha")
            .unwrap();
        assert_eq!(alpha.common_name.as_deref(), Some("Lavande Alpha"));
        assert_eq!(alpha.common_name_2.as_deref(), Some("Lavande vraie"));
        assert!(!alpha.is_name_fallback);

        // Species 2 has no French names -> English fallback, no secondary
        let beta = result
            .items
            .iter()
            .find(|i| i.canonical_name == "Lavandula beta")
            .unwrap();
        assert_eq!(beta.common_name.as_deref(), Some("Lavender Beta"));
        assert_eq!(beta.common_name_2, None);
        assert!(beta.is_name_fallback);
    }

    #[test]
    fn total_estimate_reflects_text_filter() {
        let conn = test_db();

        let result = search(
            &conn,
            Some("alpha".to_owned()),
            SpeciesFilter::default(),
            None,
            Sort::Name,
            10,
            true,
            "en".to_owned(),
        )
        .unwrap();

        assert_eq!(result.total_estimate, 1);
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].canonical_name, "Lavandula alpha");
    }

    #[test]
    fn blank_relevance_search_falls_back_to_name_cursor_pagination() {
        let conn = test_db();

        let first = search(
            &conn,
            Some("\" () + -".to_owned()),
            SpeciesFilter::default(),
            None,
            Sort::Relevance,
            1,
            true,
            "en".to_owned(),
        )
        .unwrap();

        assert_eq!(first.total_estimate, 2);
        assert_eq!(first.items.len(), 1);
        let next_cursor = first.next_cursor.clone().expect("expected cursor");
        assert!(!next_cursor.starts_with("offset:"));

        let second = search(
            &conn,
            Some("\" () + -".to_owned()),
            SpeciesFilter::default(),
            Some(next_cursor),
            Sort::Relevance,
            1,
            false,
            "en".to_owned(),
        )
        .unwrap();

        assert_eq!(second.items.len(), 1);
        assert_eq!(second.total_estimate, 0);
        assert_ne!(
            first.items[0].canonical_name,
            second.items[0].canonical_name
        );
        assert_eq!(second.next_cursor, None);
    }

    #[test]
    fn height_pagination_continues_after_null_sort_value() {
        let conn = test_db();
        conn.execute(
            "INSERT INTO species (
                id,
                canonical_name, slug, common_name, family, genus,
                height_max_m, hardiness_zone_min, hardiness_zone_max,
                growth_rate, stratum, edibility_rating, medicinal_rating, width_max_m
            ) VALUES (
                3,
                'Height unknown', 'height-unknown', 'Height Unknown', 'Rosaceae', 'Unknown',
                NULL, 5, 9,
                'Slow', 'Low', 1, 1, 1.0
            )",
            [],
        )
        .unwrap();

        let first = search(
            &conn,
            None,
            SpeciesFilter::default(),
            None,
            Sort::Height,
            1,
            true,
            "en".to_owned(),
        )
        .unwrap();

        assert_eq!(first.items.len(), 1);
        assert_eq!(first.items[0].canonical_name, "Height unknown");
        let next_cursor = first.next_cursor.clone().expect("expected cursor");

        let second = search(
            &conn,
            None,
            SpeciesFilter::default(),
            Some(next_cursor),
            Sort::Height,
            1,
            false,
            "en".to_owned(),
        )
        .unwrap();

        assert_eq!(second.items.len(), 1);
        assert_eq!(second.items[0].canonical_name, "Lavandula alpha");
    }

    #[test]
    fn count_query_errors_are_returned() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE species (
                id INTEGER PRIMARY KEY,
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
            CREATE TABLE best_common_names (
                species_id INTEGER NOT NULL,
                language TEXT NOT NULL,
                common_name TEXT NOT NULL,
                PRIMARY KEY (species_id, language)
            );
            CREATE TABLE species_common_names (
                species_id INTEGER NOT NULL,
                common_name TEXT NOT NULL,
                language TEXT NOT NULL,
                is_primary INTEGER NOT NULL DEFAULT 0,
                source TEXT
            );",
        )
        .unwrap();

        let error = search(
            &conn,
            Some("lavender".to_owned()),
            SpeciesFilter::default(),
            None,
            Sort::Relevance,
            10,
            true,
            "en".to_owned(),
        )
        .unwrap_err();

        assert!(error.contains("Failed to count species search results"));
    }
}
