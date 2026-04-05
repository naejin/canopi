pub(crate) const EXPECTED_PLANT_SCHEMA_VERSION: i32 = 6;

#[cfg(test)]
pub(crate) const REQUIRED_APP_TRANSLATION_FIELDS: &[&str] = &[
    "active_growth_period",
    "anaerobic_tolerance",
    "biogeographic_status",
    "bloom_period",
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
