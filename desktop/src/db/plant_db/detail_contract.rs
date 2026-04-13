use std::sync::OnceLock;

const DETAIL_CONTRACT_COLUMNS: &[&str] = &[
    "id",
    "canonical_name",
    "common_name",
    "family",
    "genus",
    "taxonomic_order",
    "taxonomic_class",
    "is_hybrid",
    "match_confidence",
    "tnrs_taxonomic_status",
    "match_score",
    "source",
    "enriched_at",
    "enrichment_provenance",
    "height_min_m",
    "height_max_m",
    "width_max_m",
    "hardiness_zone_min",
    "hardiness_zone_max",
    "age_of_maturity_years",
    "growth_rate",
    "is_annual",
    "is_biennial",
    "is_perennial",
    "lifespan",
    "deciduous_evergreen",
    "leaf_retention",
    "active_growth_period",
    "habit",
    "growth_form_type",
    "growth_form_shape",
    "growth_habit",
    "woody",
    "canopy_position",
    "resprout_ability",
    "coppice_potential",
    "bloom_period",
    "flower_color",
    "pollinators",
    "tolerates_full_sun",
    "tolerates_semi_shade",
    "tolerates_full_shade",
    "frost_tender",
    "frost_free_days_min",
    "drought_tolerance",
    "precip_min_inches",
    "precip_max_inches",
    "soil_ph_min",
    "soil_ph_max",
    "well_drained",
    "heavy_clay",
    "tolerates_light_soil",
    "tolerates_medium_soil",
    "tolerates_heavy_soil",
    "tolerates_acid",
    "tolerates_alkaline",
    "tolerates_saline",
    "tolerates_wind",
    "tolerates_pollution",
    "tolerates_nutritionally_poor",
    "fertility_requirement",
    "moisture_use",
    "anaerobic_tolerance",
    "root_depth_min_cm",
    "salinity_tolerance",
    "stratum",
    "succession_stage",
    "stratum_confidence",
    "succession_confidence",
    "nitrogen_fixer",
    "ecological_system",
    "mycorrhizal_type",
    "grime_strategy",
    "raunkiaer_life_form",
    "cn_ratio",
    "allelopathic",
    "root_system_type",
    "taproot_persistent",
    "edibility_rating",
    "medicinal_rating",
    "other_uses_rating",
    "attracts_wildlife",
    "scented",
    "propagated_by_seed",
    "propagated_by_cuttings",
    "propagated_by_bare_root",
    "propagated_by_container",
    "propagated_by_sprigs",
    "propagated_by_bulb",
    "propagated_by_sod",
    "propagated_by_tubers",
    "propagated_by_corm",
    "cold_stratification_required",
    "vegetative_spread_rate",
    "seed_spread_rate",
    "propagation_method",
    "sowing_period",
    "harvest_period",
    "dormancy_conditions",
    "management_types",
    "fruit_type",
    "fruit_seed_color",
    "fruit_seed_period_begin",
    "fruit_seed_period_end",
    "fruit_seed_abundance",
    "fruit_seed_persistence",
    "seed_mass_mg",
    "seed_length_mm",
    "seed_germination_rate",
    "seed_dispersal_mechanism",
    "seed_storage_behaviour",
    "seed_dormancy_type",
    "seed_dormancy_depth",
    "serotinous",
    "seedbank_type",
    "leaf_type",
    "leaf_compoundness",
    "leaf_shape",
    "sla_mm2_mg",
    "ldmc_g_g",
    "leaf_nitrogen_mg_g",
    "leaf_carbon_mg_g",
    "leaf_phosphorus_mg_g",
    "leaf_dry_mass_mg",
    "pollination_syndrome",
    "sexual_system",
    "mating_system",
    "self_fertile",
    "reproductive_type",
    "clonal_growth_form",
    "storage_organ",
    "toxicity",
    "invasive_potential",
    "biogeographic_status",
    "noxious_status",
    "invasive_usda",
    "weed_potential",
    "fire_resistant",
    "fire_tolerance",
    "hedge_tolerance",
    "native_distribution",
    "introduced_distribution",
    "climate_zones",
    "conservation_status",
    "image_urls",
    "ellenberg_light",
    "ellenberg_temperature",
    "ellenberg_moisture",
    "ellenberg_reaction",
    "ellenberg_nitrogen",
    "ellenberg_salt",
    "classification_source",
    "model_version",
    "prompt_version",
    "classified_at",
    "validation_flags",
    "overall_confidence",
    "validation_flag_count",
    "data_quality_tier",
    "wood_density_g_cm3",
    "photosynthesis_pathway",
];

static DETAIL_QUERY_SQL: OnceLock<String> = OnceLock::new();

pub(super) fn detail_contract_columns() -> &'static [&'static str] {
    DETAIL_CONTRACT_COLUMNS
}

pub(super) fn detail_query_sql() -> &'static str {
    DETAIL_QUERY_SQL
        .get_or_init(|| {
            let select = DETAIL_CONTRACT_COLUMNS
                .iter()
                .map(|column| format!("s.{column}"))
                .collect::<Vec<_>>()
                .join(",\n                    ");
            format!(
                "SELECT {select}
             FROM species s
             WHERE s.canonical_name = ?1
             LIMIT 1"
            )
        })
        .as_str()
}

#[cfg(test)]
mod tests {
    use super::detail_contract_columns;
    use crate::db::test_support::load_schema_contract_fixture;
    use std::collections::HashSet;

    #[test]
    fn test_detail_projection_columns_exist_in_contract() {
        let contract = load_schema_contract_fixture();
        let contract_columns: HashSet<String> = contract
            .columns
            .into_iter()
            .map(|column| column.name)
            .collect();

        for column in detail_contract_columns() {
            assert!(
                contract_columns.contains(*column),
                "detail projection column '{column}' missing from schema contract"
            );
        }
    }
}
