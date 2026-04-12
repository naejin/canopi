mod builder;
mod columns;
mod cursor;
mod filters;

pub use builder::QueryBuilder;
pub(crate) use builder::build_count_query;
pub(crate) use builder::decode_relevance_offset;
pub(crate) use builder::sanitize_fts_text;
pub use columns::sort_column;
pub(crate) use columns::validated_column;
#[allow(unused_imports)]
pub use cursor::{decode_cursor, encode_cursor};

#[cfg(test)]
mod tests {
    use super::*;
    use common_types::species::{Sort, SpeciesFilter};
    use rusqlite::types::Value;

    fn default_filter() -> SpeciesFilter {
        SpeciesFilter::default()
    }

    #[test]
    fn test_cursor_round_trip() {
        let encoded = encode_cursor("Lamiaceae", "Lavandula angustifolia");
        let decoded = decode_cursor(&encoded).unwrap();
        assert_eq!(decoded.0, "Lamiaceae");
        assert_eq!(decoded.1, "Lavandula angustifolia");
    }

    #[test]
    fn test_cursor_invalid_returns_none() {
        assert!(decode_cursor("not-valid-base64!!!").is_none());
    }

    #[test]
    fn test_empty_query_produces_valid_sql() {
        let qb = QueryBuilder::new(
            None,
            default_filter(),
            None,
            Sort::Name,
            20,
            "en".to_owned(),
        );
        let (sql, params) = qb.build();
        assert!(sql.contains("FROM species s"));
        assert!(!sql.contains("species_search_fts"));
        // locale param + "en" fallback param + limit param
        assert_eq!(params.len(), 3);
    }

    #[test]
    fn test_text_search_includes_fts_join() {
        let qb = QueryBuilder::new(
            Some("lavender".to_owned()),
            default_filter(),
            None,
            Sort::Relevance,
            20,
            "en".to_owned(),
        );
        let (sql, _params) = qb.build();
        assert!(sql.contains("species_search_fts"));
        assert!(sql.contains("species_search_fts MATCH"));
    }

    #[test]
    fn test_fts_search_term_has_prefix_wildcard() {
        let qb = QueryBuilder::new(
            Some("lav".to_owned()),
            default_filter(),
            None,
            Sort::Relevance,
            20,
            "en".to_owned(),
        );
        let (_sql, params) = qb.build();
        // params[0] = locale, params[1] = "en" fallback, params[2] = search term
        let search_term = match &params[2] {
            Value::Text(s) => s.clone(),
            _ => panic!("expected text"),
        };
        assert_eq!(search_term, "lav*");
    }

    #[test]
    fn test_nitrogen_fixer_true_filter() {
        let mut f = default_filter();
        f.nitrogen_fixer = Some(true);
        let qb = QueryBuilder::new(None, f, None, Sort::Name, 20, "en".to_owned());
        let (sql, _) = qb.build();
        assert!(sql.contains("nitrogen_fixer = 1"));
    }

    #[test]
    fn test_nitrogen_fixer_false_is_noop() {
        let mut f = default_filter();
        f.nitrogen_fixer = Some(false);
        let qb = QueryBuilder::new(None, f, None, Sort::Name, 20, "en".to_owned());
        let (sql, _) = qb.build();
        assert!(!sql.contains("nitrogen_fixer"));
    }

    #[test]
    fn test_life_cycle_filter_maps_to_boolean_columns() {
        let mut f = default_filter();
        f.life_cycle = Some(vec!["Annual".to_owned(), "Perennial".to_owned()]);
        let qb = QueryBuilder::new(None, f, None, Sort::Name, 20, "en".to_owned());
        let (sql, _) = qb.build();
        assert!(sql.contains("is_annual = 1"));
        assert!(sql.contains("is_perennial = 1"));
        assert!(sql.contains(" OR "));
    }

    #[test]
    fn test_edible_filter() {
        let mut f = default_filter();
        f.edible = Some(true);
        let qb = QueryBuilder::new(None, f, None, Sort::Name, 20, "en".to_owned());
        let (sql, _) = qb.build();
        assert!(sql.contains("edibility_rating > 0"));
    }

    #[test]
    fn test_soil_tolerances_filter_uses_boolean_columns() {
        let mut f = default_filter();
        f.soil_tolerances = Some(vec!["light".to_owned(), "heavy_clay".to_owned()]);
        let qb = QueryBuilder::new(None, f, None, Sort::Name, 20, "en".to_owned());
        let (sql, _) = qb.build();
        assert!(sql.contains("tolerates_light_soil = 1"));
        assert!(sql.contains("heavy_clay = 1"));
        assert!(sql.contains(" OR "));
    }

    #[test]
    fn test_cursor_clause_name_sort() {
        let cursor = encode_cursor("Lavandula angustifolia", "Lavandula angustifolia");
        let qb = QueryBuilder::new(
            None,
            default_filter(),
            Some(cursor),
            Sort::Name,
            20,
            "en".to_owned(),
        );
        let (sql, _) = qb.build();
        assert!(sql.contains("s.canonical_name >"));
    }

    #[test]
    fn test_cursor_clause_family_sort_uses_row_value() {
        let cursor = encode_cursor("Lamiaceae", "Lavandula angustifolia");
        let qb = QueryBuilder::new(
            None,
            default_filter(),
            Some(cursor),
            Sort::Family,
            20,
            "en".to_owned(),
        );
        let (sql, _) = qb.build();
        assert!(sql.contains("(s.family, s.canonical_name) >"));
    }

    #[test]
    fn test_limit_is_incremented_by_one() {
        let qb = QueryBuilder::new(
            None,
            default_filter(),
            None,
            Sort::Name,
            20,
            "en".to_owned(),
        );
        let (_sql, params) = qb.build();
        let limit_val = match params.last().unwrap() {
            Value::Integer(n) => *n,
            _ => panic!("expected integer limit"),
        };
        assert_eq!(limit_val, 21);
    }

    #[test]
    fn test_newly_exposed_filter_fields_are_allowlisted() {
        for field in [
            "tolerates_nutritionally_poor",
            "raunkiaer_life_form",
            "photosynthesis_pathway",
            "ellenberg_light",
            "ellenberg_temperature",
            "ellenberg_moisture",
            "ellenberg_reaction",
            "ellenberg_nitrogen",
            "ellenberg_salt",
            "mating_system",
            "clonal_growth_form",
            "storage_organ",
        ] {
            assert!(
                validated_column(field).is_some(),
                "expected '{field}' to be allowlisted for dynamic filters"
            );
        }
    }

    #[test]
    fn test_relevance_sort_uses_offset_pagination() {
        let qb = QueryBuilder::new(
            Some("lavender".to_owned()),
            default_filter(),
            Some("offset:50".to_owned()),
            Sort::Relevance,
            20,
            "en".to_owned(),
        );
        let (sql, params) = qb.build();
        assert!(sql.contains("ORDER BY bm25("));
        assert!(sql.contains("OFFSET ?"));
        assert!(!sql.contains("s.canonical_name >"));
        let offset_val = match params.last().unwrap() {
            Value::Integer(n) => *n,
            _ => panic!("expected integer offset"),
        };
        assert_eq!(offset_val, 50);
    }

    #[test]
    fn test_count_query_no_text_no_filters() {
        let (sql, params) = build_count_query(None, &default_filter());
        assert!(sql.contains("SELECT COUNT(*)"));
        assert!(!sql.contains("species_search_fts"));
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn test_count_query_with_text() {
        let (sql, params) = build_count_query(Some("lavender"), &default_filter());
        assert!(sql.contains("SELECT COUNT(*)"));
        assert!(sql.contains("species_search_fts MATCH"));
        assert_eq!(params.len(), 1);
        match &params[0] {
            Value::Text(s) => assert_eq!(s, "lavender*"),
            _ => panic!("expected text param"),
        }
    }

    #[test]
    fn test_count_query_with_filters() {
        let mut f = default_filter();
        f.nitrogen_fixer = Some(true);
        let (sql, params) = build_count_query(None, &f);
        assert!(sql.contains("SELECT COUNT(*)"));
        assert!(sql.contains("nitrogen_fixer = 1"));
        assert!(!sql.contains("species_search_fts"));
        assert_eq!(params.len(), 0);
    }
}
