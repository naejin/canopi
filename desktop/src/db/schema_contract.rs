pub(crate) const EXPECTED_PLANT_SCHEMA_VERSION: i32 = 8;

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
    use std::collections::BTreeSet;

    use super::{EXPECTED_PLANT_SCHEMA_VERSION, REQUIRED_APP_TRANSLATION_FIELDS};
    use crate::db::test_support::load_schema_contract_fixture;

    #[test]
    fn test_expected_schema_version_matches_contract() {
        let contract = load_schema_contract_fixture();
        assert_eq!(contract.schema_version, EXPECTED_PLANT_SCHEMA_VERSION);
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
    fn test_climate_zone_translations_match_expected_labels() {
        let contract = load_schema_contract_fixture();
        let climate_zone_values = contract
            .translations
            .get("climate_zone")
            .expect("schema contract must define climate_zone translations");

        let expected: BTreeSet<&str> = [
            "Tropical",
            "Arid",
            "Mediterranean",
            "Subtropical",
            "Temperate",
            "Continental",
            "Boreal",
        ]
        .into_iter()
        .collect();

        let actual: BTreeSet<&str> = climate_zone_values
            .as_object()
            .expect("climate_zone translations must be an object map")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(actual, expected, "climate zone labels changed in schema contract");
    }
}
