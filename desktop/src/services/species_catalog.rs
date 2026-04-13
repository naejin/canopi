use std::collections::HashMap;

use common_types::species::{
    CommonNameEntry, DynamicFilterOptions, FilterOptions, FlowerColorResolution, Relationship,
    SpeciesDetail, SpeciesExternalLink, SpeciesImage,
};

use crate::db::{self, PlantDb};

pub fn get_species_relationships(
    plant_db: &PlantDb,
    canonical_name: String,
) -> Result<Vec<Relationship>, String> {
    let conn = db::acquire(&plant_db.0, "PlantDb");

    let species_id: String = conn
        .query_row(
            "SELECT id FROM species WHERE canonical_name = ?1 LIMIT 1",
            [&canonical_name],
            |row| -> rusqlite::Result<_> { row.get(0) },
        )
        .map_err(|e| format!("Failed to look up species id for '{canonical_name}': {e}"))?;

    crate::db::plant_db::get_relationships(&conn, &species_id)
}

pub fn get_common_names(
    plant_db: &PlantDb,
    canonical_names: Vec<String>,
    locale: String,
) -> Result<HashMap<String, String>, String> {
    let conn = db::acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_common_names_batch(&conn, &canonical_names, &locale)
}

pub fn get_species_batch(
    plant_db: &PlantDb,
    canonical_names: Vec<String>,
    locale: String,
) -> Result<Vec<SpeciesDetail>, String> {
    let conn = db::acquire(&plant_db.0, "PlantDb");
    let mut results = Vec::with_capacity(canonical_names.len());
    for name in &canonical_names {
        match crate::db::plant_db::get_detail(&conn, name, &locale) {
            Ok(detail) => results.push(detail),
            Err(error) => {
                tracing::warn!("get_species_batch: skipping '{name}': {error}");
            }
        }
    }
    Ok(results)
}

pub fn get_flower_color_batch(
    plant_db: &PlantDb,
    canonical_names: Vec<String>,
) -> Result<Vec<FlowerColorResolution>, String> {
    let conn = db::acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_flower_color_batch(&conn, &canonical_names)
}

pub fn get_filter_options(plant_db: &PlantDb) -> Result<FilterOptions, String> {
    let conn = db::acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_filter_options(&conn)
}

pub fn get_dynamic_filter_options(
    plant_db: &PlantDb,
    fields: Vec<String>,
    locale: String,
) -> Result<Vec<DynamicFilterOptions>, String> {
    let conn = db::acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_dynamic_filter_options(&conn, &fields, &locale)
}

pub fn get_species_images(
    plant_db: &PlantDb,
    canonical_name: String,
) -> Result<Vec<SpeciesImage>, String> {
    let conn = db::acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_species_images(&conn, &canonical_name)
}

pub fn get_species_external_links(
    plant_db: &PlantDb,
    canonical_name: String,
) -> Result<Vec<SpeciesExternalLink>, String> {
    let conn = db::acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_species_external_links(&conn, &canonical_name)
}

pub fn get_locale_common_names(
    plant_db: &PlantDb,
    canonical_name: String,
    locale: String,
) -> Result<Vec<CommonNameEntry>, String> {
    let conn = db::acquire(&plant_db.0, "PlantDb");
    crate::db::plant_db::get_locale_common_names(&conn, &canonical_name, &locale)
}
