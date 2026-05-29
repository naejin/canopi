use common_types::species::{PaginatedResult, Sort, SpeciesFilter, SpeciesListItem};
use rusqlite::{Connection, params_from_iter};

use crate::db::query_builder::{SpeciesSearchPlan, SpeciesSearchRequest};

/// Searches species using FTS5, structured filters, or both.
///
/// Returns a paginated result. Pass the `next_cursor` from a previous result
/// to fetch the next page.
#[allow(
    clippy::too_many_arguments,
    reason = "Plant DB search mirrors the current flat species search request contract"
)]
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
        use_common_name_token_index: supports_common_name_token_index(conn),
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

fn supports_common_name_token_index(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master
         WHERE type = 'table' AND name = 'species_search_common_name_tokens'",
        [],
        |_| Ok(()),
    )
    .is_ok()
}

#[cfg(test)]
mod tests {
    use super::search;
    use crate::db::query_builder::{SpeciesSearchPlan, SpeciesSearchRequest};
    use common_types::species::{Sort, SpeciesFilter};
    use rusqlite::{Connection, OpenFlags, params_from_iter};
    use std::{env, path::PathBuf, time::Duration, time::Instant};

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

    fn relevance_fixture_db() -> Connection {
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
            CREATE TABLE species_search_text (
                species_rowid INTEGER PRIMARY KEY,
                canonical_name TEXT NOT NULL DEFAULT '',
                common_names TEXT NOT NULL DEFAULT '',
                family_genus TEXT NOT NULL DEFAULT '',
                uses_text TEXT NOT NULL DEFAULT '',
                other_text TEXT NOT NULL DEFAULT ''
            );
            CREATE VIRTUAL TABLE species_search_fts USING fts5(
                canonical_name,
                common_names,
                family_genus,
                uses_text,
                other_text,
                content='species_search_text',
                content_rowid='species_rowid',
                tokenize='unicode61 remove_diacritics 2'
            );
            CREATE TABLE species_search_common_name_tokens (
                species_id TEXT NOT NULL,
                language TEXT NOT NULL,
                token TEXT NOT NULL,
                first_token_position INTEGER NOT NULL,
                PRIMARY KEY (species_id, language, token)
            );
            CREATE INDEX idx_species_search_common_name_tokens_language_token
                ON species_search_common_name_tokens(language, token, species_id);
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
                id,
                canonical_name, slug, common_name, family, genus,
                height_max_m, hardiness_zone_min, hardiness_zone_max,
                growth_rate, stratum, edibility_rating, medicinal_rating, width_max_m
            ) VALUES
                ('linum-usitatissimum', 'Linum usitatissimum', 'linum-usitatissimum', 'Common flax', 'Linaceae', 'Linum', 1.2, 5, 9, 'Fast', 'Low', 4, 1, 0.3),
                ('linum-bienne', 'Linum bienne', 'linum-bienne', 'Pale flax', 'Linaceae', 'Linum', 0.8, 6, 9, 'Medium', 'Low', 1, 0, 0.2),
                ('linum-leonii', 'Linum leonii', 'linum-leonii', 'Leon flax', 'Linaceae', 'Linum', 0.5, 6, 9, 'Medium', 'Low', 1, 0, 0.2),
                ('linum-communis', 'Linum communis', 'linum-communis', 'False flax', 'Linaceae', 'Linum', 0.7, 6, 9, 'Medium', 'Low', 1, 0, 0.2),
                ('communia-linensis', 'Communia linensis', 'communia-linensis', 'Commun flax', 'Linaceae', 'Communia', 0.6, 6, 9, 'Medium', 'Low', 1, 0, 0.2),
                ('fallback-lin', 'Acmella fallback', 'acmella-fallback', 'Lin fallback', 'Asteraceae', 'Acmella', 0.4, 8, 10, 'Medium', 'Low', 1, 0, 0.2),
                ('lindleya-mespiloides', 'Lindleya mespiloides', 'lindleya-mespiloides', 'Lindleya', 'Rosaceae', 'Lindleya', 3.0, 7, 10, 'Medium', 'Shrub', 0, 0, 2.0),
                ('malus-domestica', 'Malus domestica', 'malus-domestica', 'Apple', 'Rosaceae', 'Malus', 4.0, 4, 8, 'Medium', 'Canopy', 5, 1, 3.0);

            INSERT INTO species_common_names VALUES
                ('linum-usitatissimum', 'Common flax', 'en', 1, 'test'),
                ('linum-usitatissimum', 'Lin commun', 'fr', 1, 'test'),
                ('linum-bienne', 'Pale flax', 'en', 1, 'test'),
                ('linum-bienne', 'Lin bisannuel', 'fr', 1, 'test'),
                ('linum-leonii', 'Leon flax', 'en', 1, 'test'),
                ('linum-leonii', 'Lin de Léon', 'fr', 1, 'test'),
                ('linum-communis', 'False flax', 'en', 1, 'test'),
                ('linum-communis', 'Faux lin', 'fr', 1, 'test'),
                ('communia-linensis', 'Commun flax', 'en', 1, 'test'),
                ('communia-linensis', 'Commun Lin', 'fr', 1, 'test'),
                ('fallback-lin', 'Lin fallback', 'en', 1, 'test'),
                ('lindleya-mespiloides', 'Lindleya', 'en', 1, 'test'),
                ('malus-domestica', 'Apple', 'en', 1, 'test'),
                ('malus-domestica', 'Pommier', 'fr', 1, 'test');

            INSERT INTO best_common_names VALUES
                ('linum-usitatissimum', 'en', 'Common flax'),
                ('linum-usitatissimum', 'fr', 'Lin commun'),
                ('linum-bienne', 'en', 'Pale flax'),
                ('linum-bienne', 'fr', 'Lin bisannuel'),
                ('linum-leonii', 'en', 'Leon flax'),
                ('linum-leonii', 'fr', 'Lin de Léon'),
                ('linum-communis', 'en', 'False flax'),
                ('linum-communis', 'fr', 'Faux lin'),
                ('communia-linensis', 'en', 'Commun flax'),
                ('communia-linensis', 'fr', 'Commun Lin'),
                ('fallback-lin', 'en', 'Lin fallback'),
                ('lindleya-mespiloides', 'en', 'Lindleya'),
                ('malus-domestica', 'en', 'Apple'),
                ('malus-domestica', 'fr', 'Pommier');

            INSERT INTO species_search_text (
                species_rowid, canonical_name, common_names, family_genus, uses_text, other_text
            )
            SELECT s.rowid,
                s.canonical_name,
                TRIM(COALESCE(s.common_name, '') || ' ' || COALESCE(cn.all_names, '')),
                TRIM(COALESCE(s.family, '') || ' ' || COALESCE(s.genus, '')),
                '',
                ''
            FROM species s
            LEFT JOIN (
                SELECT species_id, GROUP_CONCAT(common_name, ' ') AS all_names
                FROM species_common_names
                GROUP BY species_id
            ) cn ON cn.species_id = s.id;

            INSERT INTO species_search_fts(species_search_fts) VALUES('rebuild');

            INSERT INTO species_search_common_name_tokens VALUES
                ('linum-usitatissimum', 'en', 'common', 0),
                ('linum-usitatissimum', 'en', 'flax', 1),
                ('linum-usitatissimum', 'fr', 'lin', 0),
                ('linum-usitatissimum', 'fr', 'commun', 1),
                ('linum-bienne', 'en', 'pale', 0),
                ('linum-bienne', 'en', 'flax', 1),
                ('linum-bienne', 'fr', 'lin', 0),
                ('linum-bienne', 'fr', 'bisannuel', 1),
                ('linum-leonii', 'en', 'leon', 0),
                ('linum-leonii', 'en', 'flax', 1),
                ('linum-leonii', 'fr', 'lin', 0),
                ('linum-leonii', 'fr', 'de', 1),
                ('linum-leonii', 'fr', 'leon', 2),
                ('linum-communis', 'en', 'false', 0),
                ('linum-communis', 'en', 'flax', 1),
                ('linum-communis', 'fr', 'faux', 0),
                ('linum-communis', 'fr', 'lin', 1),
                ('communia-linensis', 'en', 'commun', 0),
                ('communia-linensis', 'en', 'flax', 1),
                ('communia-linensis', 'fr', 'commun', 0),
                ('communia-linensis', 'fr', 'lin', 1),
                ('fallback-lin', 'en', 'lin', 0),
                ('fallback-lin', 'en', 'fallback', 1),
                ('lindleya-mespiloides', 'en', 'lindleya', 0),
                ('malus-domestica', 'en', 'apple', 0),
                ('malus-domestica', 'fr', 'pommier', 0);",
        )
        .unwrap();
        conn
    }

    fn run_bundled_species_search_latency_harness() -> Result<(), String> {
        let Some(path) = bundled_species_search_db_path() else {
            eprintln!(
                "skipping species search latency harness: no bundled database found; \
                 run `python3 scripts/prepare-db.py` or set CANOPI_PLANT_DB_PATH"
            );
            return Ok(());
        };
        let conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| {
            format!(
                "Failed to open Species Catalog database at {}: {error}",
                path.display()
            )
        })?;

        eprintln!("species_search_latency db={}", path.display());
        for case in [
            ("fr-lin", "fr", "lin"),
            ("fr-lin-commun", "fr", "lin commun"),
            ("fr-lind", "fr", "lind"),
            ("en-apple", "en", "apple"),
            ("en-broad-a", "en", "a"),
        ] {
            report_species_search_latency_case(&conn, case)?;
        }

        Ok(())
    }

    fn bundled_species_search_db_path() -> Option<PathBuf> {
        if let Ok(path) = env::var("CANOPI_PLANT_DB_PATH") {
            let path = PathBuf::from(path);
            return path.exists().then_some(path);
        }

        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("canopi-core.db");
        path.exists().then_some(path)
    }

    fn report_species_search_latency_case(
        conn: &Connection,
        (label, locale, query): (&str, &str, &str),
    ) -> Result<(), String> {
        let plan = SpeciesSearchPlan::build(SpeciesSearchRequest {
            text: Some(query.to_owned()),
            filters: SpeciesFilter::default(),
            cursor: None,
            sort: Sort::Relevance,
            limit: 20,
            include_total: true,
            locale: locale.to_owned(),
            use_common_name_token_index: true,
        });

        let list_started = Instant::now();
        let list_rows = execute_species_search_list(conn, &plan)?;
        let list_elapsed = list_started.elapsed();

        let count_started = Instant::now();
        let total_estimate = execute_species_search_count(conn, &plan)?;
        let count_elapsed = count_started.elapsed();

        eprintln!(
            "species_search_latency case={label} locale={locale} query={query:?} \
             list_ms={} count_ms={} rows={} total_estimate={}",
            millis(list_elapsed),
            millis(count_elapsed),
            list_rows,
            total_estimate
        );
        Ok(())
    }

    fn execute_species_search_list(
        conn: &Connection,
        plan: &SpeciesSearchPlan,
    ) -> Result<usize, String> {
        let list = plan.list();
        let mut stmt = conn
            .prepare(list.sql())
            .map_err(|error| format!("Failed to prepare Species Catalog list query: {error}"))?;
        let mut rows = stmt
            .query(params_from_iter(list.params()))
            .map_err(|error| format!("Failed to execute Species Catalog list query: {error}"))?;
        let mut count = 0;
        while rows
            .next()
            .map_err(|error| format!("Failed to read Species Catalog list row: {error}"))?
            .is_some()
        {
            count += 1;
        }
        Ok(count)
    }

    fn execute_species_search_count(
        conn: &Connection,
        plan: &SpeciesSearchPlan,
    ) -> Result<u32, String> {
        let count = plan
            .count()
            .ok_or_else(|| "Species Catalog count plan was not built".to_owned())?;
        conn.query_row(count.sql(), params_from_iter(count.params()), |row| {
            row.get::<_, u32>(0)
        })
        .map_err(|error| format!("Failed to execute Species Catalog count query: {error}"))
    }

    fn millis(duration: Duration) -> String {
        format!("{:.3}", duration.as_secs_f64() * 1000.0)
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
    fn relevance_fixture_covers_common_name_search_examples() {
        let conn = relevance_fixture_db();

        for (locale, query, expected_names) in [
            (
                "fr",
                "lin",
                vec![
                    "Linum usitatissimum",
                    "Linum bienne",
                    "Lindleya mespiloides",
                ],
            ),
            ("fr", "lin commun", vec!["Linum usitatissimum"]),
            ("fr", "lind", vec!["Lindleya mespiloides"]),
            ("en", "apple", vec!["Malus domestica"]),
        ] {
            let result = search(
                &conn,
                Some(query.to_owned()),
                SpeciesFilter::default(),
                None,
                Sort::Relevance,
                10,
                true,
                locale.to_owned(),
            )
            .unwrap();

            for expected_name in expected_names {
                assert!(
                    result
                        .items
                        .iter()
                        .any(|item| item.canonical_name == expected_name),
                    "expected {locale} query {query:?} to include {expected_name}; got {:?}",
                    result
                        .items
                        .iter()
                        .map(|item| item.canonical_name.as_str())
                        .collect::<Vec<_>>()
                );
            }
        }
    }

    #[test]
    fn relevance_prefers_active_locale_common_name_whole_token() {
        let conn = relevance_fixture_db();

        let result = search(
            &conn,
            Some("lin".to_owned()),
            SpeciesFilter::default(),
            None,
            Sort::Relevance,
            10,
            true,
            "fr".to_owned(),
        )
        .unwrap();
        let names = result
            .items
            .iter()
            .map(|item| item.canonical_name.as_str())
            .collect::<Vec<_>>();

        assert!(names[..2].contains(&"Linum usitatissimum"));
        assert!(names[..2].contains(&"Linum bienne"));
        assert!(
            names
                .iter()
                .position(|name| *name == "Linum bienne")
                .unwrap()
                < names
                    .iter()
                    .position(|name| *name == "Lindleya mespiloides")
                    .unwrap(),
            "expected Linum bienne before Lindleya mespiloides; got {names:?}"
        );
    }

    #[test]
    fn relevance_places_fallback_common_names_after_active_locale_names() {
        let conn = relevance_fixture_db();

        let result = search(
            &conn,
            Some("lin".to_owned()),
            SpeciesFilter::default(),
            None,
            Sort::Relevance,
            10,
            true,
            "fr".to_owned(),
        )
        .unwrap();
        let names = result
            .items
            .iter()
            .map(|item| item.canonical_name.as_str())
            .collect::<Vec<_>>();
        let index_of = |needle: &str| {
            names
                .iter()
                .position(|name| *name == needle)
                .unwrap_or_else(|| panic!("expected {needle} in {names:?}"))
        };

        let fallback_index = index_of("Acmella fallback");
        for active_locale_match in [
            "Linum usitatissimum",
            "Linum bienne",
            "Linum leonii",
            "Linum communis",
            "Communia linensis",
        ] {
            assert!(
                index_of(active_locale_match) < fallback_index,
                "expected active-locale match {active_locale_match} before fallback match; got {names:?}"
            );
        }
        assert!(
            fallback_index < index_of("Lindleya mespiloides"),
            "expected fallback common-name match before taxonomy-only match; got {names:?}"
        );

        let fallback = result
            .items
            .iter()
            .find(|item| item.canonical_name == "Acmella fallback")
            .unwrap();
        assert_eq!(fallback.common_name.as_deref(), Some("Lin fallback"));
        assert!(fallback.is_name_fallback);
    }

    #[test]
    fn relevance_prefers_active_locale_common_name_exact_phrase() {
        let conn = relevance_fixture_db();

        let result = search(
            &conn,
            Some("lin commun".to_owned()),
            SpeciesFilter::default(),
            None,
            Sort::Relevance,
            10,
            true,
            "fr".to_owned(),
        )
        .unwrap();
        let names = result
            .items
            .iter()
            .map(|item| item.canonical_name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            names.first().copied(),
            Some("Linum usitatissimum"),
            "expected exact Common Name phrase before reversed all-token match; got {names:?}"
        );
        assert!(
            names
                .iter()
                .position(|name| *name == "Linum usitatissimum")
                .unwrap()
                < names
                    .iter()
                    .position(|name| *name == "Communia linensis")
                    .unwrap(),
            "expected exact phrase before all-token match; got {names:?}"
        );
        assert!(
            names
                .iter()
                .position(|name| *name == "Communia linensis")
                .unwrap()
                < names
                    .iter()
                    .position(|name| *name == "Linum communis")
                    .unwrap(),
            "expected all-token Common Name match before taxonomy-only prefix match; got {names:?}"
        );
    }

    #[test]
    fn relevance_common_name_tokens_match_diacritic_queries() {
        let conn = relevance_fixture_db();

        let result = search(
            &conn,
            Some("lin léon".to_owned()),
            SpeciesFilter::default(),
            None,
            Sort::Relevance,
            10,
            true,
            "fr".to_owned(),
        )
        .unwrap();

        assert_eq!(
            result
                .items
                .first()
                .map(|item| item.canonical_name.as_str()),
            Some("Linum leonii")
        );
    }

    #[test]
    #[ignore = "manual latency harness; run with --ignored --nocapture"]
    fn bundled_species_search_latency_harness_reports_list_and_count_timings() {
        run_bundled_species_search_latency_harness().unwrap();
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
