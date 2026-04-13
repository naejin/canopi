mod detail;
mod detail_contract;
mod detail_row_map;
mod filters;
mod flower;
mod lookup;
mod search;

pub use detail::{get_detail, get_relationships, get_species_external_links, get_species_images};
pub use filters::{get_dynamic_filter_options, get_filter_options};
pub use flower::get_flower_color_batch;
#[allow(unused_imports)]
pub use lookup::translate_value;
pub use lookup::{
    get_common_name, get_common_names_batch, get_locale_best_common_name, get_locale_common_names,
    get_secondary_common_name,
};
pub use search::search;

#[cfg(test)]
mod tests {
    use super::*;
    use common_types::species::{Sort, SpeciesFilter};
    use rusqlite::Connection;
    use serde::Deserialize;
    use std::{collections::HashSet, fs, path::Path};

    #[derive(Deserialize)]
    struct SchemaContractFixture {
        schema_version: i32,
        columns: Vec<SchemaColumnFixture>,
        translations: serde_json::Map<String, serde_json::Value>,
    }

    #[derive(Deserialize)]
    struct SchemaColumnFixture {
        name: String,
    }

    fn load_schema_contract_fixture() -> SchemaContractFixture {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/schema-contract.json");
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE species (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL,
                canonical_name TEXT NOT NULL,
                common_name TEXT,
                family TEXT,
                genus TEXT,
                taxonomic_order TEXT,
                taxonomic_class TEXT,
                is_hybrid INTEGER,
                match_confidence TEXT,
                tnrs_taxonomic_status TEXT,
                match_score REAL,
                source TEXT,
                enriched_at TEXT,
                enrichment_provenance TEXT,
                height_min_m REAL,
                height_max_m REAL,
                width_max_m REAL,
                hardiness_zone_min INTEGER,
                hardiness_zone_max INTEGER,
                age_of_maturity_years REAL,
                growth_rate TEXT,
                is_annual INTEGER,
                is_biennial INTEGER,
                is_perennial INTEGER,
                lifespan TEXT,
                deciduous_evergreen TEXT,
                leaf_retention INTEGER,
                active_growth_period TEXT,
                habit TEXT,
                growth_form_type TEXT,
                growth_form_shape TEXT,
                growth_habit TEXT,
                woody INTEGER,
                canopy_position TEXT,
                resprout_ability INTEGER,
                coppice_potential INTEGER,
                bloom_period TEXT,
                flower_color TEXT,
                pollinators TEXT,
                tolerates_full_sun INTEGER,
                tolerates_semi_shade INTEGER,
                tolerates_full_shade INTEGER,
                frost_tender INTEGER,
                frost_free_days_min INTEGER,
                drought_tolerance TEXT,
                precip_min_inches REAL,
                precip_max_inches REAL,
                soil_ph_min REAL,
                soil_ph_max REAL,
                well_drained INTEGER,
                heavy_clay INTEGER,
                tolerates_light_soil INTEGER,
                tolerates_medium_soil INTEGER,
                tolerates_heavy_soil INTEGER,
                tolerates_acid INTEGER,
                tolerates_alkaline INTEGER,
                tolerates_saline INTEGER,
                tolerates_wind INTEGER,
                tolerates_pollution INTEGER,
                tolerates_nutritionally_poor INTEGER,
                fertility_requirement TEXT,
                moisture_use TEXT,
                anaerobic_tolerance TEXT,
                root_depth_min_cm REAL,
                salinity_tolerance TEXT,
                stratum TEXT,
                succession_stage TEXT,
                stratum_confidence REAL,
                succession_confidence REAL,
                nitrogen_fixer INTEGER,
                ecological_system TEXT,
                mycorrhizal_type TEXT,
                grime_strategy TEXT,
                raunkiaer_life_form TEXT,
                cn_ratio TEXT,
                allelopathic INTEGER,
                root_system_type TEXT,
                taproot_persistent INTEGER,
                edibility_rating INTEGER,
                medicinal_rating INTEGER,
                other_uses_rating INTEGER,
                attracts_wildlife INTEGER,
                scented INTEGER,
                propagated_by_seed INTEGER,
                propagated_by_cuttings INTEGER,
                propagated_by_bare_root INTEGER,
                propagated_by_container INTEGER,
                propagated_by_sprigs INTEGER,
                propagated_by_bulb INTEGER,
                propagated_by_sod INTEGER,
                propagated_by_tubers INTEGER,
                propagated_by_corm INTEGER,
                cold_stratification_required INTEGER,
                vegetative_spread_rate TEXT,
                seed_spread_rate TEXT,
                propagation_method TEXT,
                sowing_period TEXT,
                harvest_period TEXT,
                dormancy_conditions TEXT,
                management_types TEXT,
                fruit_type TEXT,
                fruit_seed_color TEXT,
                fruit_seed_period_begin TEXT,
                fruit_seed_period_end TEXT,
                fruit_seed_abundance TEXT,
                fruit_seed_persistence INTEGER,
                seed_mass_mg REAL,
                seed_length_mm REAL,
                seed_germination_rate REAL,
                seed_dispersal_mechanism TEXT,
                seed_storage_behaviour TEXT,
                seed_dormancy_type TEXT,
                seed_dormancy_depth TEXT,
                serotinous INTEGER,
                seedbank_type TEXT,
                leaf_type TEXT,
                leaf_compoundness TEXT,
                leaf_shape TEXT,
                sla_mm2_mg REAL,
                ldmc_g_g REAL,
                leaf_nitrogen_mg_g REAL,
                leaf_carbon_mg_g REAL,
                leaf_phosphorus_mg_g REAL,
                leaf_dry_mass_mg REAL,
                pollination_syndrome TEXT,
                sexual_system TEXT,
                mating_system TEXT,
                self_fertile INTEGER,
                reproductive_type TEXT,
                clonal_growth_form TEXT,
                storage_organ TEXT,
                toxicity TEXT,
                invasive_potential TEXT,
                biogeographic_status TEXT,
                noxious_status INTEGER,
                invasive_usda INTEGER,
                weed_potential INTEGER,
                fire_resistant INTEGER,
                fire_tolerance TEXT,
                hedge_tolerance TEXT,
                native_distribution TEXT,
                introduced_distribution TEXT,
                climate_zones TEXT,
                conservation_status TEXT,
                image_urls TEXT,
                ellenberg_light REAL,
                ellenberg_temperature REAL,
                ellenberg_moisture REAL,
                ellenberg_reaction REAL,
                ellenberg_nitrogen REAL,
                ellenberg_salt REAL,
                classification_source TEXT,
                model_version TEXT,
                prompt_version TEXT,
                classified_at TEXT,
                validation_flags TEXT,
                overall_confidence REAL,
                validation_flag_count INTEGER,
                data_quality_tier TEXT,
                wood_density_g_cm3 REAL,
                photosynthesis_pathway TEXT
            );
            CREATE VIRTUAL TABLE species_search_fts USING fts5(
                canonical_name, common_name,
                content='species', content_rowid='rowid'
            );
            CREATE TABLE species_common_names (
                id TEXT PRIMARY KEY,
                species_id TEXT NOT NULL,
                language TEXT NOT NULL,
                common_name TEXT NOT NULL,
                source TEXT,
                is_primary INTEGER DEFAULT 1
            );
            CREATE TABLE species_uses (
                id TEXT PRIMARY KEY,
                species_id TEXT NOT NULL,
                use_category TEXT NOT NULL,
                use_description TEXT,
                glossary_description TEXT
            );
            CREATE TABLE species_relationships (
                id TEXT PRIMARY KEY,
                species_id TEXT NOT NULL,
                related_species_slug TEXT NOT NULL,
                relationship_type TEXT NOT NULL,
                description TEXT
            );
            CREATE TABLE species_images (
                id TEXT PRIMARY KEY,
                species_id TEXT NOT NULL,
                url TEXT NOT NULL,
                source TEXT,
                sort_order INTEGER DEFAULT 0
            );
            CREATE TABLE species_external_links (
                id TEXT PRIMARY KEY,
                species_id TEXT NOT NULL,
                link_type TEXT NOT NULL,
                url TEXT NOT NULL
            );
            CREATE TABLE translated_values (
                id TEXT PRIMARY KEY,
                field_name TEXT NOT NULL,
                value_en TEXT NOT NULL,
                value_fr TEXT,
                value_es TEXT,
                value_pt TEXT,
                value_it TEXT,
                value_zh TEXT,
                value_de TEXT,
                value_ja TEXT,
                value_ko TEXT,
                value_nl TEXT,
                value_ru TEXT
            );
            CREATE TABLE best_common_names (
                species_id TEXT NOT NULL,
                language TEXT NOT NULL,
                common_name TEXT NOT NULL,
                PRIMARY KEY (species_id, language)
            );
            CREATE TABLE species_distributions (
                id TEXT PRIMARY KEY,
                species_id TEXT NOT NULL,
                distribution_type TEXT NOT NULL,
                region TEXT NOT NULL,
                source TEXT
            );
            CREATE TABLE species_climate_zones (
                id TEXT PRIMARY KEY,
                species_id TEXT NOT NULL,
                climate_zone TEXT NOT NULL,
                confidence REAL NOT NULL,
                source TEXT,
                UNIQUE(species_id, climate_zone)
            );

            INSERT INTO species (id, slug, canonical_name, common_name, family, genus,
                height_min_m, height_max_m, width_max_m, hardiness_zone_min, hardiness_zone_max,
                soil_ph_min, soil_ph_max, drought_tolerance, frost_tender, growth_rate,
                is_annual, is_biennial, is_perennial, lifespan, habit, deciduous_evergreen,
                bloom_period, flower_color, tolerates_full_sun, tolerates_semi_shade, tolerates_full_shade,
                well_drained, tolerates_light_soil, tolerates_medium_soil, tolerates_heavy_soil,
                nitrogen_fixer, stratum, edibility_rating, medicinal_rating,
                scented, toxicity,
                native_distribution, introduced_distribution, climate_zones)
            VALUES (
                'uuid-lav', 'lavandula-angustifolia', 'Lavandula angustifolia',
                'Lavender', 'Lamiaceae', 'Lavandula',
                0.3, 0.6, 0.9, 5, 9, 6.0, 8.0,
                'Medium', 0, 'Slow',
                0, 0, 1, 'Short-lived perennial', 'Shrub', 'Evergreen',
                'Summer', 'Purple', 1, 1, 0,
                1, 1, 1, 0,
                0, 'Low', 3, 2,
                1, NULL,
                '[]', 'Europe, Western Asia', '[\"Mediterranean\", \"Temperate\"]'
            );
            INSERT INTO species (id, slug, canonical_name, common_name, family, genus,
                height_min_m, height_max_m, width_max_m, hardiness_zone_min, hardiness_zone_max,
                soil_ph_min, soil_ph_max, growth_rate,
                is_annual, is_biennial, is_perennial, habit, deciduous_evergreen,
                bloom_period, flower_color,
                tolerates_full_sun, tolerates_semi_shade, tolerates_full_shade,
                nitrogen_fixer, stratum, edibility_rating, medicinal_rating,
                succession_stage, seed_dormancy_depth, serotinous, invasive_potential,
                biogeographic_status, native_distribution, climate_zones)
            VALUES (
                'uuid-ald', 'alnus-glutinosa', 'Alnus glutinosa',
                'Alder', 'Betulaceae', 'Alnus',
                5.0, 20.0, 8.0, 1, 8, 5.5, 7.5,
                'Fast',
                0, 0, 1, 'Tree', 'Deciduous',
                'Spring', 'Blue/Purple',
                1, 0, 0,
                1, 'Canopy', 0, 0,
                'secondary_i', 'Absolute', 1, 'Potentially Invasive',
                'Native', '[\"Asia\", \"Europe\"]', '[\"Temperate\", \"Continental\"]'
            );

            INSERT INTO species_common_names VALUES
                ('cn1', 'uuid-lav', 'en', 'Lavender', NULL, 1),
                ('cn2', 'uuid-lav', 'fr', 'Lavande', NULL, 1),
                ('cn3', 'uuid-ald', 'en', 'Common Alder', NULL, 1);

            INSERT INTO species_uses VALUES
                ('u1', 'uuid-lav', 'Medicinal', 'Used in aromatherapy', NULL),
                ('u2', 'uuid-lav', 'Culinary', 'Edible flowers', NULL);

            INSERT INTO species_relationships VALUES
                ('r1', 'uuid-lav', 'alnus-glutinosa', 'companion', 'Attracts pollinators');

            INSERT INTO species_images VALUES
                ('img1', 'uuid-lav', 'https://example.com/lavender.jpg', 'Wikimedia', 0);

            INSERT INTO species_external_links VALUES
                ('el1', 'uuid-lav', 'wikipedia', 'https://en.wikipedia.org/wiki/Lavandula_angustifolia');

            INSERT INTO translated_values VALUES
                ('t1', 'growth_rate', 'Slow', 'Lent', NULL, NULL, NULL, NULL, 'Langsam', NULL, NULL, NULL, NULL),
                ('t2', 'flower_color', 'Blue', 'Bleu', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
                ('t3', 'flower_color', 'Purple', 'Violet', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
                ('t4', 'seed_dormancy_depth', 'Absolute', 'Absolue', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
                ('t5', 'invasive_potential', 'Potentially Invasive', 'Potentiellement invasive', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
                ('t6', 'biogeographic_status', 'Native', 'Indigène', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
                ('t7', 'climate_zone', 'Mediterranean', 'Méditerranéen', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
                ('t8', 'climate_zone', 'Temperate', 'Tempéré', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
                ('t9', 'climate_zone', 'Continental', 'Continental', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

            INSERT INTO best_common_names VALUES
                ('uuid-lav', 'en', 'Lavender'),
                ('uuid-lav', 'fr', 'Lavande'),
                ('uuid-ald', 'en', 'Common Alder');

            INSERT INTO species_climate_zones VALUES
                ('cz1', 'uuid-lav', 'Mediterranean', 0.72, 'wcvp'),
                ('cz2', 'uuid-lav', 'Temperate', 0.28, 'wcvp'),
                ('cz3', 'uuid-ald', 'Temperate', 0.65, 'wcvp'),
                ('cz4', 'uuid-ald', 'Continental', 0.35, 'wcvp');
        ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_get_detail_returns_species() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "en").unwrap();
        assert_eq!(detail.canonical_name, "Lavandula angustifolia");
        assert_eq!(detail.family.as_deref(), Some("Lamiaceae"));
        assert_eq!(detail.common_name.as_deref(), Some("Lavender"));
        // Fields
        assert_eq!(detail.drought_tolerance.as_deref(), Some("Medium"));
        assert_eq!(detail.bloom_period.as_deref(), Some("Summer"));
        assert_eq!(detail.flower_color.as_deref(), Some("Purple"));
        assert_eq!(detail.scented, Some(true));
        assert_eq!(detail.well_drained, Some(true));
        // New soil tolerance booleans
        assert_eq!(detail.tolerates_light_soil, Some(true));
        assert_eq!(detail.tolerates_medium_soil, Some(true));
        assert_eq!(detail.tolerates_heavy_soil, Some(false));
        assert_eq!(
            detail.climate_zones.as_deref(),
            Some("Mediterranean, Temperate")
        );
    }

    #[test]
    fn test_get_detail_locale_fallback() {
        let conn = test_db();
        // 'de' has no best_common_names entry; should fall back to English "Lavender"
        let detail = get_detail(&conn, "Lavandula angustifolia", "de").unwrap();
        assert_eq!(detail.common_name.as_deref(), Some("Lavender"));
    }

    #[test]
    fn test_get_detail_locale_match() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "fr").unwrap();
        assert_eq!(detail.common_name.as_deref(), Some("Lavande"));
    }

    #[test]
    fn test_get_detail_uses() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "en").unwrap();
        assert_eq!(detail.uses.len(), 2);
        let categories: Vec<&str> = detail
            .uses
            .iter()
            .map(|u| u.use_category.as_str())
            .collect();
        assert!(categories.contains(&"Medicinal"));
        assert!(categories.contains(&"Culinary"));
    }

    #[test]
    fn test_get_detail_relationships() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "en").unwrap();
        assert_eq!(detail.relationships.len(), 1);
        assert_eq!(
            detail.relationships[0].related_canonical_name,
            "Alnus glutinosa"
        );
        assert_eq!(detail.relationships[0].relationship_type, "companion");
    }

    #[test]
    fn test_get_detail_nitrogen_fixer() {
        let conn = test_db();
        let detail = get_detail(&conn, "Alnus glutinosa", "en").unwrap();
        assert_eq!(detail.nitrogen_fixer, Some(true));
        assert_eq!(detail.is_perennial, Some(true));
        assert_eq!(detail.is_annual, Some(false));
        assert_eq!(detail.succession_stage.as_deref(), Some("secondary_i"));
    }

    #[test]
    fn test_get_detail_parses_distribution_json() {
        let conn = test_db();
        // JSON array → comma-separated
        let alder = get_detail(&conn, "Alnus glutinosa", "en").unwrap();
        assert_eq!(alder.native_distribution.as_deref(), Some("Asia, Europe"));
        assert_eq!(alder.introduced_distribution, None); // NULL in fixture

        // Empty JSON array → None (suppressed)
        let lav = get_detail(&conn, "Lavandula angustifolia", "en").unwrap();
        assert_eq!(lav.native_distribution, None);
        // Non-JSON plain text → passed through unchanged
        assert_eq!(
            lav.introduced_distribution.as_deref(),
            Some("Europe, Western Asia")
        );
    }

    #[test]
    fn test_get_detail_translates_categorical_fields() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "fr").unwrap();
        // growth_rate "Slow" should be translated to "Lent" in French
        assert_eq!(detail.growth_rate.as_deref(), Some("Lent"));
        // deciduous_evergreen has no French translation in test data,
        // so it stays as English
        assert_eq!(detail.deciduous_evergreen.as_deref(), Some("Evergreen"));
    }

    #[test]
    fn test_get_detail_translates_german() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "de").unwrap();
        // growth_rate "Slow" should be translated to "Langsam" in German
        assert_eq!(detail.growth_rate.as_deref(), Some("Langsam"));
    }

    #[test]
    fn test_get_detail_translates_climate_zones() {
        let conn = test_db();
        let detail = get_detail(&conn, "Alnus glutinosa", "fr").unwrap();
        assert_eq!(
            detail.climate_zones.as_deref(),
            Some("Tempéré, Continental")
        );
    }

    #[test]
    fn test_get_detail_maps_new_split_fields() {
        let conn = test_db();
        let detail = get_detail(&conn, "Alnus glutinosa", "fr").unwrap();
        assert_eq!(detail.flower_color.as_deref(), Some("Bleu/Violet"));
        assert_eq!(detail.seed_dormancy_depth.as_deref(), Some("Absolue"));
        assert_eq!(detail.serotinous, Some(true));
        assert_eq!(
            detail.invasive_potential.as_deref(),
            Some("Potentiellement invasive")
        );
        assert_eq!(detail.biogeographic_status.as_deref(), Some("Indigène"));
    }

    #[test]
    fn test_get_filter_options() {
        let conn = test_db();
        let opts = get_filter_options(&conn).unwrap();
        assert!(opts.families.contains(&"Lamiaceae".to_owned()));
        assert!(opts.families.contains(&"Betulaceae".to_owned()));
        // life_cycles is now a hardcoded list (boolean columns replaced the string column)
        assert!(opts.life_cycles.contains(&"Perennial".to_owned()));
        assert!(opts.life_cycles.contains(&"Annual".to_owned()));
        assert!(opts.life_cycles.contains(&"Biennial".to_owned()));
        // soil_tolerances is a hardcoded list
        assert!(opts.soil_tolerances.contains(&"light".to_owned()));
        assert!(opts.soil_tolerances.contains(&"medium".to_owned()));
        assert!(opts.soil_tolerances.contains(&"heavy".to_owned()));
        assert!(opts.soil_tolerances.contains(&"well_drained".to_owned()));
        assert!(opts.soil_tolerances.contains(&"heavy_clay".to_owned()));
        assert!(opts.sun_tolerances.contains(&"full_sun".to_owned()));
        assert_eq!(opts.climate_zones.len(), 7);
        assert!(opts.climate_zones.contains(&"Tropical".to_owned()));
        assert!(opts.climate_zones.contains(&"Boreal".to_owned()));
    }

    #[test]
    fn test_search_climate_zone_filter() {
        let conn = test_db();
        // Mediterranean filter should return only Lavandula (not Alnus)
        let filters = SpeciesFilter {
            climate_zones: Some(vec!["Mediterranean".to_owned()]),
            ..Default::default()
        };
        let result =
            search(&conn, None, filters, None, Sort::Name, 50, true, "en".to_owned()).unwrap();
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].canonical_name, "Lavandula angustifolia");

        // Temperate filter should return both species
        let filters = SpeciesFilter {
            climate_zones: Some(vec!["Temperate".to_owned()]),
            ..Default::default()
        };
        let result =
            search(&conn, None, filters, None, Sort::Name, 50, true, "en".to_owned()).unwrap();
        assert_eq!(result.items.len(), 2);

        // Continental filter should return only Alnus
        let filters = SpeciesFilter {
            climate_zones: Some(vec!["Continental".to_owned()]),
            ..Default::default()
        };
        let result =
            search(&conn, None, filters, None, Sort::Name, 50, true, "en".to_owned()).unwrap();
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].canonical_name, "Alnus glutinosa");
    }

    #[test]
    fn test_get_species_images() {
        let conn = test_db();
        let images = get_species_images(&conn, "Lavandula angustifolia").unwrap();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].url, "https://example.com/lavender.jpg");
        assert_eq!(images[0].source.as_deref(), Some("Wikimedia"));
    }

    #[test]
    fn test_get_species_external_links() {
        let conn = test_db();
        let links = get_species_external_links(&conn, "Lavandula angustifolia").unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].link_type, "wikipedia");
        assert!(links[0].url.contains("wikipedia.org"));
    }

    #[test]
    fn test_get_species_images_empty() {
        let conn = test_db();
        let images = get_species_images(&conn, "Alnus glutinosa").unwrap();
        assert_eq!(images.len(), 0);
    }

    #[test]
    fn test_get_species_external_links_empty() {
        let conn = test_db();
        let links = get_species_external_links(&conn, "Alnus glutinosa").unwrap();
        assert_eq!(links.len(), 0);
    }

    #[test]
    fn test_get_species_images_missing_species() {
        let conn = test_db();
        let images = get_species_images(&conn, "Nonexistent species").unwrap();
        assert_eq!(images.len(), 0);
    }

    #[test]
    fn test_get_common_name_locale() {
        let conn = test_db();
        assert_eq!(
            get_common_name(&conn, "uuid-lav", "fr"),
            Some("Lavande".to_owned())
        );
    }

    #[test]
    fn test_get_common_name_fallback_to_en() {
        let conn = test_db();
        assert_eq!(
            get_common_name(&conn, "uuid-lav", "de"),
            Some("Lavender".to_owned())
        );
    }

    #[test]
    fn test_get_common_name_missing_species() {
        let conn = test_db();
        assert_eq!(get_common_name(&conn, "uuid-nonexistent", "en"), None);
    }

    #[test]
    fn test_translate_value_found() {
        let conn = test_db();
        assert_eq!(translate_value(&conn, "growth_rate", "Slow", "fr"), "Lent");
    }

    #[test]
    fn test_translate_value_fallback() {
        let conn = test_db();
        // No Portuguese translation — returns the English value unchanged.
        assert_eq!(translate_value(&conn, "growth_rate", "Slow", "pt"), "Slow");
    }

    #[test]
    fn test_translate_value_new_languages() {
        let conn = test_db();
        // German translation exists
        assert_eq!(
            translate_value(&conn, "growth_rate", "Slow", "de"),
            "Langsam"
        );
        // Japanese has no translation — returns English
        assert_eq!(translate_value(&conn, "growth_rate", "Slow", "ja"), "Slow");
    }

    #[test]
    fn test_translate_composite_value_supports_canonical_and_legacy_separators() {
        let conn = test_db();
        assert_eq!(
            super::lookup::translate_composite_value(&conn, "flower_color", "Blue, Purple", "fr"),
            "Bleu, Violet"
        );
        assert_eq!(
            super::lookup::translate_composite_value(&conn, "flower_color", "Blue,Purple", "fr"),
            "Bleu, Violet"
        );
        assert_eq!(
            super::lookup::translate_composite_value(&conn, "flower_color", "Blue/Purple", "fr"),
            "Bleu/Violet"
        );
    }

    #[test]
    fn test_expected_schema_version_matches_contract() {
        let contract = load_schema_contract_fixture();
        assert_eq!(
            contract.schema_version,
            crate::db::schema_contract::EXPECTED_PLANT_SCHEMA_VERSION
        );
    }

    #[test]
    fn test_detail_projection_columns_exist_in_contract() {
        let contract = load_schema_contract_fixture();
        let contract_columns: HashSet<String> = contract
            .columns
            .into_iter()
            .map(|column| column.name)
            .collect();

        for column in super::detail_contract::detail_contract_columns() {
            assert!(
                contract_columns.contains(*column),
                "detail projection column '{column}' missing from schema contract"
            );
        }
    }

    #[test]
    fn test_required_app_translation_fields_exist_in_contract() {
        let contract = load_schema_contract_fixture();

        for field in crate::db::schema_contract::REQUIRED_APP_TRANSLATION_FIELDS {
            assert!(
                contract.translations.contains_key(*field),
                "required contract translation field '{field}' missing from schema contract"
            );
        }
    }

    #[test]
    fn test_get_detail_missing_species_returns_err() {
        let conn = test_db();
        let result = get_detail(&conn, "Nonexistent species", "en");
        assert!(result.is_err());
    }
}
