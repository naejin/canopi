include!("schema_contract_generated.rs");

#[cfg(test)]
pub(crate) const REQUIRED_APP_TRANSLATION_FIELDS: &[&str] = &[
    "active_growth_period",
    "anaerobic_tolerance",
    "biogeographic_status",
    "bloom_period",
    "climate_zone",
    "deciduous_evergreen",
    "drought_tolerance",
    "fertility_requirement",
    "flower_color",
    "fruit_seed_abundance",
    "fruit_type",
    "habit",
    "invasive_potential",
    "moisture_use",
    "reproductive_type",
    "seed_dispersal_mechanism",
    "seed_dormancy_depth",
    "seed_dormancy_type",
    "toxicity",
];

#[cfg(test)]
mod tests {
    use super::{
        EXPECTED_PLANT_SCHEMA_VERSION, MINIMUM_EXPORT_SCHEMA_VERSION, PREPARED_STORAGE_COLUMNS,
        PREPARED_VIRTUAL_TABLE_OPTIONS, REQUIRED_APP_TRANSLATION_FIELDS, REQUIRED_PREPARED_TABLES,
        REQUIRED_STORAGE_INDEXES, REQUIRED_SUPPORTING_TABLES, SPECIES_STORAGE_COLUMNS,
        SPECIES_STORAGE_CONTRACT_FINGERPRINT, SUPPORTING_STORAGE_COLUMNS,
    };
    use crate::db::test_support::load_schema_contract_fixture;

    #[test]
    fn test_expected_schema_version_matches_contract() {
        let contract = load_schema_contract_fixture();
        assert_eq!(contract.schema_version, EXPECTED_PLANT_SCHEMA_VERSION);
        assert_eq!(
            contract.min_export_schema_version,
            MINIMUM_EXPORT_SCHEMA_VERSION
        );
        assert_eq!(contract.columns.len(), SPECIES_STORAGE_COLUMNS.len());
        assert_eq!(SPECIES_STORAGE_CONTRACT_FINGERPRINT.len(), 64);
        assert!(REQUIRED_SUPPORTING_TABLES.contains(&"species_common_names"));
        assert!(REQUIRED_PREPARED_TABLES.contains(&("species_search_fts", Some("fts5"))));
        assert!(PREPARED_VIRTUAL_TABLE_OPTIONS.contains(&(
            "species_search_fts",
            "tokenize",
            "unicode61 remove_diacritics 2 tokenchars '_'",
        )));
        assert!(
            PREPARED_STORAGE_COLUMNS
                .iter()
                .any(|(table, column, affinity, required)| {
                    *table == "best_common_names"
                        && *column == "common_name"
                        && *affinity == "TEXT"
                        && *required
                })
        );
        assert!(
            SUPPORTING_STORAGE_COLUMNS
                .iter()
                .any(
                    |(table, column, affinity, _)| *table == "species_climate_zones"
                        && *column == "climate_zone"
                        && *affinity == "TEXT"
                )
        );
        assert!(
            REQUIRED_STORAGE_INDEXES
                .iter()
                .any(|(_, name, _)| *name == "idx_species_id")
        );
    }

    #[test]
    fn test_required_app_translation_fields_exist_in_contract() {
        let contract = load_schema_contract_fixture();

        for field in REQUIRED_APP_TRANSLATION_FIELDS {
            assert!(
                contract.translations.contains_key(*field),
                "required contract translation field '{field}' missing from schema contract"
            );
        }
    }

    #[test]
    fn test_species_id_index_exists_for_search_hydration() {
        let contract = load_schema_contract_fixture();
        let species_indexes = contract
            .indexes
            .get("species")
            .expect("species indexes should be defined");

        assert!(
            species_indexes
                .iter()
                .any(|index| index.name == "idx_species_id" && index.columns == "id"),
            "generated Species Catalog search hydrates ranked ids through species.id"
        );
    }
}
