use std::collections::HashMap;

use common_types::species::{
    CommonNameEntry, DynamicFilterOptions, FilterOptions, FlowerColorResolution, PaginatedResult,
    Relationship, SpeciesDetail, SpeciesExternalLink, SpeciesImage, SpeciesListItem,
    SpeciesSearchRequest,
};
use rusqlite::Connection;

mod common_names;
mod compatibility;
mod detail;
mod filters;
mod flower;
mod list_items;
mod media;
mod relationships;
mod replacement;
mod search;
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

    pub(crate) fn search(
        &self,
        request: SpeciesSearchRequest,
    ) -> Result<PaginatedResult<SpeciesListItem>, String> {
        search::read_projection(self.conn, request)
    }

    pub(crate) fn list_items_for_canonical_names(
        &self,
        canonical_names: &[String],
        locale: &str,
    ) -> Result<Vec<SpeciesListItem>, String> {
        list_items::read_projection(self.conn, canonical_names, locale)
    }

    pub(crate) fn detail_for_canonical_name(
        &self,
        canonical_name: &str,
        locale: &str,
    ) -> Result<SpeciesDetail, String> {
        detail::read_detail_projection(self.conn, canonical_name, locale)
    }

    pub(crate) fn details_for_canonical_names(
        &self,
        canonical_names: &[String],
        locale: &str,
    ) -> Result<Vec<SpeciesDetail>, String> {
        detail::read_detail_projections(self.conn, canonical_names, locale)
    }

    pub(crate) fn relationships_for_canonical_name(
        &self,
        canonical_name: &str,
    ) -> Result<Vec<Relationship>, String> {
        relationships::read_projection(self.conn, canonical_name)
    }

    pub(crate) fn common_names_for_canonical_names(
        &self,
        canonical_names: &[String],
        locale: &str,
    ) -> Result<HashMap<String, String>, String> {
        common_names::localized_names_for_canonical_names(self.conn, canonical_names, locale)
    }

    pub(crate) fn locale_common_names_for_canonical_name(
        &self,
        canonical_name: &str,
        locale: &str,
    ) -> Result<Vec<CommonNameEntry>, String> {
        common_names::locale_common_names_for_canonical_name(self.conn, canonical_name, locale)
    }

    pub(crate) fn flower_colors_for_canonical_names(
        &self,
        canonical_names: &[String],
    ) -> Result<Vec<FlowerColorResolution>, String> {
        flower::read_projection(self.conn, canonical_names)
    }

    pub(crate) fn filter_options(&self) -> Result<FilterOptions, String> {
        filters::read_filter_options(self.conn)
    }

    pub(crate) fn dynamic_filter_options(
        &self,
        fields: &[String],
        locale: &str,
    ) -> Result<Vec<DynamicFilterOptions>, String> {
        filters::read_dynamic_filter_options(self.conn, fields, locale)
    }

    pub(crate) fn images_for_canonical_name(
        &self,
        canonical_name: &str,
    ) -> Result<Vec<SpeciesImage>, String> {
        media::read_images_projection(self.conn, canonical_name)
    }

    pub(crate) fn external_links_for_canonical_name(
        &self,
        canonical_name: &str,
    ) -> Result<Vec<SpeciesExternalLink>, String> {
        media::read_external_links_projection(self.conn, canonical_name)
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
    use common_types::species::{Sort, SpeciesFilter};

    fn search_request() -> SpeciesSearchRequest {
        SpeciesSearchRequest {
            text: String::new(),
            filters: SpeciesFilter::default(),
            cursor: None,
            limit: 10,
            sort: Sort::Name,
            locale: "fr".to_owned(),
            include_total: true,
        }
    }

    #[test]
    fn search_projection_uses_structured_request_and_locale_names() {
        let conn = test_support::test_conn();
        let catalog = SpeciesCatalogRead::new(&conn);
        let result = catalog.search(search_request()).unwrap();

        assert_eq!(result.total_estimate, 6);
        assert_eq!(result.items[0].canonical_name, "Apple");
        assert_eq!(result.items[0].common_name.as_deref(), Some("Pommier"));
        assert!(!result.items[0].is_favorite);
    }

    #[test]
    fn list_item_projection_hydrates_locale_names_without_user_favorite_state() {
        let conn = test_support::test_conn();
        let catalog = SpeciesCatalogRead::new(&conn);
        let rows = catalog
            .list_items_for_canonical_names(&["Apple".to_owned(), "Missing".to_owned()], "fr")
            .unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].canonical_name, "Apple");
        assert_eq!(rows[0].common_name.as_deref(), Some("Pommier"));
        assert!(!rows[0].is_favorite);
    }

    #[test]
    fn filter_projection_reads_fixed_and_dynamic_options() {
        let conn = test_support::test_conn();
        let catalog = SpeciesCatalogRead::new(&conn);

        let fixed = catalog.filter_options().unwrap();
        assert!(fixed.families.contains(&"Rosaceae".to_owned()));
        assert!(fixed.sun_tolerances.contains(&"full_sun".to_owned()));

        let dynamic = catalog
            .dynamic_filter_options(&["height_max_m".to_owned()], "en")
            .unwrap();
        assert_eq!(dynamic.len(), 1);
        assert_eq!(dynamic[0].field, "height_max_m");
        assert_eq!(dynamic[0].range, Some((1.5, 20.0)));
    }

    #[test]
    fn media_and_common_name_projections_read_species_side_data() {
        let conn = test_support::test_conn();
        let catalog = SpeciesCatalogRead::new(&conn);

        let images = catalog.images_for_canonical_name("Apple").unwrap();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].url, "https://example.test/apple.jpg");

        let links = catalog.external_links_for_canonical_name("Apple").unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].link_type, "pfaf");

        let names = catalog
            .locale_common_names_for_canonical_name("Apple", "fr")
            .unwrap();
        assert_eq!(names[0].name, "Pommier");
    }

    #[test]
    fn relationship_projection_resolves_from_canonical_name() {
        let conn = test_support::test_conn();
        let catalog = SpeciesCatalogRead::new(&conn);
        let rows = catalog.relationships_for_canonical_name("Apple").unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].related_canonical_name, "Pear");
        assert_eq!(rows[0].relationship_type, "companion");
    }

    #[test]
    fn flower_color_projection_reads_direct_species_colors() {
        let conn = test_support::test_conn();
        let catalog = SpeciesCatalogRead::new(&conn);
        let rows = catalog
            .flower_colors_for_canonical_names(&["Apple".to_owned(), "Pear".to_owned()])
            .unwrap();

        let apple = rows
            .iter()
            .find(|row| row.canonical_name == "Apple")
            .unwrap();
        assert_eq!(apple.flower_color.as_deref(), Some("White"));
        assert_eq!(apple.source, "species");
    }

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

    #[test]
    fn service_callers_cross_species_catalog_read_seam() {
        let plant_browser_source = include_str!("plant_browser.rs");
        let species_catalog_source = include_str!("species_catalog.rs");

        assert!(!plant_browser_source.contains("crate::db::plant_db::"));
        assert!(!species_catalog_source.contains("crate::db::plant_db::"));
    }
}
