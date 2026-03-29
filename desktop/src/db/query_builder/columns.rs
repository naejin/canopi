use common_types::species::Sort;

/// Returns the SQL column expression for a given Sort variant.
pub fn sort_column(sort: &Sort) -> &'static str {
    match sort {
        Sort::Name | Sort::Relevance => "s.canonical_name",
        Sort::Family => "s.family",
        Sort::Height => "s.height_max_m",
        Sort::Hardiness => "s.hardiness_zone_min",
        Sort::GrowthRate => "s.growth_rate",
    }
}

/// Maps a frontend field name to a validated SQL column expression.
/// This is the security boundary — only allow-listed fields can be filtered dynamically.
pub(crate) fn validated_column(field: &str) -> Option<&'static str> {
    match field {
        // Growth & Form
        "woody" => Some("s.woody"),
        "habit" => Some("s.habit"),
        "growth_form_type" => Some("s.growth_form_type"),
        "growth_form_shape" => Some("s.growth_form_shape"),
        "growth_habit" => Some("s.growth_habit"),
        "canopy_position" => Some("s.canopy_position"),
        "deciduous_evergreen" => Some("s.deciduous_evergreen"),
        "resprout_ability" => Some("s.resprout_ability"),
        "coppice_potential" => Some("s.coppice_potential"),
        // Climate & Soil
        "frost_tender" => Some("s.frost_tender"),
        "drought_tolerance" => Some("s.drought_tolerance"),
        "soil_ph_min" => Some("s.soil_ph_min"),
        "soil_ph_max" => Some("s.soil_ph_max"),
        "tolerates_acid" => Some("s.tolerates_acid"),
        "tolerates_alkaline" => Some("s.tolerates_alkaline"),
        "tolerates_saline" => Some("s.tolerates_saline"),
        "tolerates_wind" => Some("s.tolerates_wind"),
        "tolerates_pollution" => Some("s.tolerates_pollution"),
        "tolerates_nutritionally_poor" => Some("s.tolerates_nutritionally_poor"),
        "fertility_requirement" => Some("s.fertility_requirement"),
        "moisture_use" => Some("s.moisture_use"),
        "anaerobic_tolerance" => Some("s.anaerobic_tolerance"),
        "root_depth_min_cm" => Some("s.root_depth_min_cm"),
        "frost_free_days_min" => Some("s.frost_free_days_min"),
        "precip_min_inches" => Some("s.precip_min_inches"),
        "precip_max_inches" => Some("s.precip_max_inches"),
        // Ecology
        "succession_stage" => Some("s.succession_stage"),
        "ecological_system" => Some("s.ecological_system"),
        "mycorrhizal_type" => Some("s.mycorrhizal_type"),
        "grime_strategy" => Some("s.grime_strategy"),
        "allelopathic" => Some("s.allelopathic"),
        "root_system_type" => Some("s.root_system_type"),
        "attracts_wildlife" => Some("s.attracts_wildlife"),
        "cn_ratio" => Some("s.cn_ratio"),
        // Reproduction
        "pollination_syndrome" => Some("s.pollination_syndrome"),
        "self_fertile" => Some("s.self_fertile"),
        "reproductive_type" => Some("s.reproductive_type"),
        "sexual_system" => Some("s.sexual_system"),
        "mating_system" => Some("s.mating_system"),
        "vegetative_spread_rate" => Some("s.vegetative_spread_rate"),
        "seed_spread_rate" => Some("s.seed_spread_rate"),
        // Fruit & Seed
        "fruit_type" => Some("s.fruit_type"),
        "seed_dispersal_mechanism" => Some("s.seed_dispersal_mechanism"),
        "seed_storage_behaviour" => Some("s.seed_storage_behaviour"),
        "fruit_seed_abundance" => Some("s.fruit_seed_abundance"),
        "seed_dormancy_type" => Some("s.seed_dormancy_type"),
        // Leaf
        "leaf_type" => Some("s.leaf_type"),
        "leaf_compoundness" => Some("s.leaf_compoundness"),
        "leaf_shape" => Some("s.leaf_shape"),
        // Bloom
        "bloom_period" => Some("s.bloom_period"),
        "flower_color" => Some("s.flower_color"),
        // Risk
        "toxicity" => Some("s.toxicity"),
        "invasive_potential" => Some("s.invasive_potential"),
        "noxious_status" => Some("s.noxious_status"),
        "invasive_usda" => Some("s.invasive_usda"),
        "weed_potential" => Some("s.weed_potential"),
        "fire_resistant" => Some("s.fire_resistant"),
        "fire_tolerance" => Some("s.fire_tolerance"),
        // Uses
        "medicinal_rating" => Some("s.medicinal_rating"),
        "other_uses_rating" => Some("s.other_uses_rating"),
        "scented" => Some("s.scented"),
        // Propagation
        "propagated_by_seed" => Some("s.propagated_by_seed"),
        "propagated_by_cuttings" => Some("s.propagated_by_cuttings"),
        "cold_stratification_required" => Some("s.cold_stratification_required"),
        // Data quality
        "active_growth_period" => Some("s.active_growth_period"),
        _ => None,
    }
}
