use std::collections::HashMap;

use common_types::species::{
    CommonNameEntry, DynamicFilterOptions, FilterOptions, FlowerColorResolution, Relationship,
    SpeciesDetail, SpeciesExternalLink, SpeciesImage,
};

use crate::db::{self, PlantDb};
use crate::services::species_catalog_read::SpeciesCatalogRead;

pub fn get_species_relationships(
    plant_db: &PlantDb,
    canonical_name: String,
) -> Result<Vec<Relationship>, String> {
    let conn = db::require_plant_db(plant_db)?;
    SpeciesCatalogRead::new(&conn).relationships_for_canonical_name(&canonical_name)
}

pub fn get_common_names(
    plant_db: &PlantDb,
    canonical_names: Vec<String>,
    locale: String,
) -> Result<HashMap<String, String>, String> {
    let conn = db::require_plant_db(plant_db)?;
    SpeciesCatalogRead::new(&conn).common_names_for_canonical_names(&canonical_names, &locale)
}

pub fn get_species_batch(
    plant_db: &PlantDb,
    canonical_names: Vec<String>,
    locale: String,
) -> Result<Vec<SpeciesDetail>, String> {
    let conn = db::require_plant_db(plant_db)?;
    SpeciesCatalogRead::new(&conn).details_for_canonical_names(&canonical_names, &locale)
}

pub fn get_flower_color_batch(
    plant_db: &PlantDb,
    canonical_names: Vec<String>,
) -> Result<Vec<FlowerColorResolution>, String> {
    let conn = db::require_plant_db(plant_db)?;
    SpeciesCatalogRead::new(&conn).flower_colors_for_canonical_names(&canonical_names)
}

pub fn get_filter_options(plant_db: &PlantDb) -> Result<FilterOptions, String> {
    let conn = db::require_plant_db(plant_db)?;
    SpeciesCatalogRead::new(&conn).filter_options()
}

pub fn get_dynamic_filter_options(
    plant_db: &PlantDb,
    fields: Vec<String>,
    locale: String,
) -> Result<Vec<DynamicFilterOptions>, String> {
    let conn = db::require_plant_db(plant_db)?;
    SpeciesCatalogRead::new(&conn).dynamic_filter_options(&fields, &locale)
}

pub fn get_species_images(
    plant_db: &PlantDb,
    canonical_name: String,
) -> Result<Vec<SpeciesImage>, String> {
    let conn = db::require_plant_db(plant_db)?;
    SpeciesCatalogRead::new(&conn).images_for_canonical_name(&canonical_name)
}

pub fn get_species_external_links(
    plant_db: &PlantDb,
    canonical_name: String,
) -> Result<Vec<SpeciesExternalLink>, String> {
    let conn = db::require_plant_db(plant_db)?;
    SpeciesCatalogRead::new(&conn).external_links_for_canonical_name(&canonical_name)
}

pub fn get_locale_common_names(
    plant_db: &PlantDb,
    canonical_name: String,
    locale: String,
) -> Result<Vec<CommonNameEntry>, String> {
    let conn = db::require_plant_db(plant_db)?;
    SpeciesCatalogRead::new(&conn).locale_common_names_for_canonical_name(&canonical_name, &locale)
}

#[cfg(test)]
mod tests {
    use super::{get_filter_options, get_species_batch};
    use crate::db::PlantDb;
    use rusqlite::Connection;

    #[test]
    fn get_species_batch_skips_missing_species() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE species (
                id TEXT PRIMARY KEY,
                canonical_name TEXT NOT NULL
            );",
        )
        .unwrap();
        let plant_db = PlantDb::available(conn);

        let batch = get_species_batch(
            &plant_db,
            vec!["Missing species".to_owned()],
            "en".to_owned(),
        )
        .unwrap();

        assert!(batch.is_empty());
    }

    #[test]
    fn get_species_batch_propagates_detail_failures_for_present_species() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE species (
                id TEXT PRIMARY KEY,
                canonical_name TEXT NOT NULL
            );
            INSERT INTO species (id, canonical_name) VALUES ('sp-1', 'Broken species');",
        )
        .unwrap();
        let plant_db = PlantDb::available(conn);

        let error = get_species_batch(
            &plant_db,
            vec!["Broken species".to_owned()],
            "en".to_owned(),
        )
        .unwrap_err();

        assert!(error.contains("Failed to prepare species detail query"));
    }

    #[test]
    fn get_filter_options_returns_explicit_error_when_plant_db_corrupt() {
        let error = get_filter_options(&PlantDb::corrupt()).unwrap_err();
        assert!(error.contains("Plant database unavailable"));
    }
}
