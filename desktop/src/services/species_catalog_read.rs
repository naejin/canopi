use std::collections::HashMap;

use rusqlite::Connection;

mod common_names;
mod compatibility;
mod replacement;
mod sql;

#[cfg(test)]
pub(crate) mod test_support;

pub(crate) use compatibility::SpeciesCompatibilityProjection;
pub(crate) use replacement::SpeciesReplacementProjection;

pub(crate) struct SpeciesCatalogRead<'conn> {
    conn: &'conn Connection,
}

impl<'conn> SpeciesCatalogRead<'conn> {
    pub(crate) fn new(conn: &'conn Connection) -> Self {
        Self { conn }
    }

    pub(crate) fn common_names_for_canonical_names(
        &self,
        canonical_names: &[String],
        locale: &str,
    ) -> Result<HashMap<String, String>, String> {
        common_names::localized_names_for_canonical_names(self.conn, canonical_names, locale)
    }

    pub(crate) fn compatibility_projection_for_canonical_names(
        &self,
        canonical_names: &[String],
        locale: &str,
    ) -> Result<Vec<SpeciesCompatibilityProjection>, String> {
        compatibility::read_projection(self.conn, canonical_names, locale)
    }

    pub(crate) fn replacement_projection_for_species(
        &self,
        canonical_name: &str,
        target_hardiness: i32,
        limit: u32,
        locale: &str,
    ) -> Result<Vec<SpeciesReplacementProjection>, String> {
        replacement::read_projection(self.conn, canonical_name, target_hardiness, limit, locale)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_projection_preserves_input_order_and_locale_names() {
        let conn = test_support::test_conn();
        let catalog = SpeciesCatalogRead::new(&conn);
        let rows = catalog
            .compatibility_projection_for_canonical_names(
                &["Pear".to_owned(), "Missing".to_owned(), "Apple".to_owned()],
                "fr",
            )
            .unwrap();

        let names: Vec<&str> = rows.iter().map(|row| row.canonical_name.as_str()).collect();

        assert_eq!(names, vec!["Pear", "Apple"]);
        assert_eq!(rows[0].species_id, "s2");
        assert_eq!(rows[0].common_name.as_deref(), Some("Poirier"));
        assert_eq!(rows[1].common_name.as_deref(), Some("Pommier"));
    }

    #[test]
    fn replacement_projection_owns_storage_query_ordering_and_hydration() {
        let conn = test_support::test_conn();
        let catalog = SpeciesCatalogRead::new(&conn);
        let rows = catalog
            .replacement_projection_for_species("Apple", 6, 99, "en")
            .unwrap();

        let names: Vec<&str> = rows.iter().map(|row| row.canonical_name.as_str()).collect();

        assert_eq!(names, vec!["Apricot", "Pear", "Plum"]);
        assert!(rows.len() <= 20);
        assert_eq!(rows[0].common_name.as_deref(), Some("Apricot"));
        assert_eq!(rows[0].hardiness_min, Some(6));
    }

    #[test]
    fn replacement_projection_caps_limit_and_falls_back_without_source_shape() {
        let conn = test_support::test_conn();
        let catalog = SpeciesCatalogRead::new(&conn);
        let rows = catalog
            .replacement_projection_for_species("Unknown", 6, 99, "en")
            .unwrap();

        let names: Vec<&str> = rows.iter().map(|row| row.canonical_name.as_str()).collect();

        assert!(rows.len() <= 20);
        assert_eq!(
            names,
            vec!["Apricot", "Quince", "Apple", "Currant", "Pear", "Plum"]
        );
    }
}
