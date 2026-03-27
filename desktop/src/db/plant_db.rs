use rusqlite::{Connection, OptionalExtension, params_from_iter};
use common_types::species::{
    FilterOptions, PaginatedResult, Relationship, Sort, SpeciesDetail, SpeciesExternalLink,
    SpeciesFilter, SpeciesImage, SpeciesListItem, SpeciesUse,
};
use crate::db::query_builder::{encode_cursor, sort_column, QueryBuilder};

/// Searches species using FTS5, structured filters, or both.
///
/// Returns a paginated result. Pass the `next_cursor` from a previous result
/// to fetch the next page.
pub fn search(
    conn: &Connection,
    text: Option<String>,
    filters: SpeciesFilter,
    cursor: Option<String>,
    sort: Sort,
    limit: u32,
    locale: String,
) -> Result<PaginatedResult<SpeciesListItem>, String> {
    let sort_col = sort_column(&sort).to_owned();
    let qb = QueryBuilder::new(text, filters, cursor, sort, limit, locale.clone());
    let (sql, params) = qb.build();

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare species search: {e}"))?;

    let rows: Vec<SpeciesListItem> = stmt
        .query_map(params_from_iter(params.iter()), |row| {
            Ok(SpeciesListItem {
                canonical_name: row.get(0)?,
                slug: row.get(1)?,
                common_name: row.get(2)?,
                family: row.get(3)?,
                genus: row.get(4)?,
                height_max_m: row.get(5)?,
                hardiness_zone_min: row.get(6)?,
                hardiness_zone_max: row.get(7)?,
                growth_rate: row.get(8)?,
                stratum: row.get(9)?,
                edibility_rating: row.get(10)?,
                medicinal_rating: row.get(11)?,
                width_max_m: row.get(12)?,
                is_favorite: false,
            })
        })
        .map_err(|e| format!("Failed to execute species search: {e}"))?
        .filter_map(|r| match r {
            Ok(item) => Some(item),
            Err(e) => { tracing::warn!("Skipped species search row: {e}"); None }
        })
        .collect();

    // We fetched limit+1 rows to detect a next page.
    let has_next = rows.len() as u32 > limit;
    let items: Vec<SpeciesListItem> = rows.into_iter().take(limit as usize).collect();

    let next_cursor = if has_next {
        items.last().map(|last| {
            let sort_val = match sort_col.as_str() {
                "s.family" => last.family.clone().unwrap_or_default(),
                "s.height_max_m" => last
                    .height_max_m
                    .map(|h| h.to_string())
                    .unwrap_or_default(),
                "s.hardiness_zone_min" => last
                    .hardiness_zone_min
                    .map(|z| z.to_string())
                    .unwrap_or_default(),
                "s.growth_rate" => last.growth_rate.clone().unwrap_or_default(),
                _ => last.canonical_name.clone(),
            };
            encode_cursor(&sort_val, &last.canonical_name)
        })
    } else {
        None
    };

    // Approximate total: a COUNT(*) with the same WHERE would be expensive on
    // large FTS queries, so we return 0 as a sentinel meaning "unknown".
    // The frontend should use cursor presence to drive pagination, not this count.
    Ok(PaginatedResult {
        items,
        next_cursor,
        total_estimate: 0,
    })
}

/// Returns the full detail record for a species by canonical name.
pub fn get_detail(
    conn: &Connection,
    canonical_name: &str,
    locale: &str,
) -> Result<SpeciesDetail, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id,                              -- 0
                    s.canonical_name,                   -- 1
                    s.family,                           -- 2
                    s.genus,                            -- 3
                    -- Taxonomy
                    s.taxonomic_order,                  -- 4
                    s.taxonomic_class,                  -- 5
                    s.is_hybrid,                        -- 6
                    -- Match / provenance
                    s.match_confidence,                 -- 7
                    s.tnrs_taxonomic_status,            -- 8
                    s.match_score,                      -- 9
                    s.source,                           -- 10
                    s.enriched_at,                      -- 11
                    s.enrichment_provenance,            -- 12
                    -- Dimensions
                    s.height_min_m,                     -- 13
                    s.height_max_m,                     -- 14
                    s.width_max_m,                      -- 15
                    s.hardiness_zone_min,               -- 16
                    s.hardiness_zone_max,               -- 17
                    s.age_of_maturity_years,            -- 18
                    s.growth_rate,                      -- 19
                    -- Life cycle
                    s.is_annual,                        -- 20
                    s.is_biennial,                      -- 21
                    s.is_perennial,                     -- 22
                    s.lifespan,                         -- 23
                    s.deciduous_evergreen,              -- 24
                    s.leaf_retention,                   -- 25
                    s.active_growth_period,             -- 26
                    -- Growth form
                    s.habit,                            -- 27
                    s.growth_form_type,                 -- 28
                    s.growth_form_shape,                -- 29
                    s.growth_habit,                     -- 30
                    s.woody,                            -- 31
                    s.canopy_position,                  -- 32
                    s.resprout_ability,                 -- 33
                    s.coppice_potential,                -- 34
                    -- Bloom
                    s.bloom_period,                     -- 35
                    s.flower_color,                     -- 36
                    s.pollinators,                      -- 37
                    -- Light & climate
                    s.tolerates_full_sun,               -- 38
                    s.tolerates_semi_shade,             -- 39
                    s.tolerates_full_shade,             -- 40
                    s.frost_tender,                     -- 41
                    s.frost_free_days_min,              -- 42
                    s.drought_tolerance,                -- 43
                    s.precip_min_inches,                -- 44
                    s.precip_max_inches,                -- 45
                    -- Soil
                    s.soil_ph_min,                      -- 46
                    s.soil_ph_max,                      -- 47
                    s.well_drained,                     -- 48
                    s.heavy_clay,                       -- 49
                    s.tolerates_light_soil,             -- 50
                    s.tolerates_medium_soil,            -- 51
                    s.tolerates_heavy_soil,             -- 52
                    s.tolerates_acid,                   -- 53
                    s.tolerates_alkaline,               -- 54
                    s.tolerates_saline,                 -- 55
                    s.tolerates_wind,                   -- 56
                    s.tolerates_pollution,              -- 57
                    s.tolerates_nutritionally_poor,     -- 58
                    s.fertility_requirement,            -- 59
                    s.moisture_use,                     -- 60
                    s.anaerobic_tolerance,              -- 61
                    s.root_depth_min_cm,                -- 62
                    s.salinity_tolerance,               -- 63
                    -- Ecology
                    s.stratum,                          -- 64
                    s.succession_stage,                 -- 65
                    s.stratum_confidence,               -- 66
                    s.succession_confidence,            -- 67
                    s.nitrogen_fixer,                   -- 68
                    s.ecological_system,                -- 69
                    s.mycorrhizal_type,                 -- 70
                    s.grime_strategy,                   -- 71
                    s.raunkiaer_life_form,              -- 72
                    s.cn_ratio,                         -- 73
                    s.allelopathic,                     -- 74
                    s.root_system_type,                 -- 75
                    s.taproot_persistent,               -- 76
                    -- Uses & ratings
                    s.edibility_rating,                 -- 77
                    s.medicinal_rating,                 -- 78
                    s.other_uses_rating,                -- 79
                    s.edible_uses,                      -- 80
                    s.medicinal_uses,                   -- 81
                    s.other_uses,                       -- 82
                    s.special_uses,                     -- 83
                    s.attracts_wildlife,                -- 84
                    s.scented,                          -- 85
                    -- Propagation
                    s.propagated_by_seed,               -- 86
                    s.propagated_by_cuttings,           -- 87
                    s.propagated_by_bare_root,          -- 88
                    s.propagated_by_container,          -- 89
                    s.propagated_by_sprigs,             -- 90
                    s.propagated_by_bulb,               -- 91
                    s.propagated_by_sod,                -- 92
                    s.propagated_by_tubers,             -- 93
                    s.propagated_by_corm,               -- 94
                    s.cold_stratification_required,     -- 95
                    s.vegetative_spread_rate,           -- 96
                    s.seed_spread_rate,                 -- 97
                    s.propagation_method,               -- 98
                    s.sowing_period,                    -- 99
                    s.harvest_period,                   -- 100
                    s.dormancy_conditions,              -- 101
                    s.management_types,                 -- 102
                    -- Fruit & seed
                    s.fruit_type,                       -- 103
                    s.fruit_seed_color,                 -- 104
                    s.fruit_seed_period_begin,          -- 105
                    s.fruit_seed_period_end,            -- 106
                    s.fruit_seed_abundance,             -- 107
                    s.fruit_seed_persistence,           -- 108
                    s.seed_mass_mg,                     -- 109
                    s.seed_length_mm,                   -- 110
                    s.seed_germination_rate,            -- 111
                    s.seed_dispersal_mechanism,         -- 112
                    s.seed_storage_behaviour,           -- 113
                    s.seed_dormancy_type,               -- 114
                    s.seedbank_type,                    -- 115
                    -- Leaf
                    s.leaf_type,                        -- 116
                    s.leaf_compoundness,                -- 117
                    s.leaf_shape,                       -- 118
                    s.sla_mm2_mg,                       -- 119
                    s.ldmc_g_g,                         -- 120
                    s.leaf_nitrogen_mg_g,               -- 121
                    s.leaf_carbon_mg_g,                 -- 122
                    s.leaf_phosphorus_mg_g,             -- 123
                    s.leaf_dry_mass_mg,                 -- 124
                    -- Reproduction
                    s.pollination_syndrome,             -- 125
                    s.sexual_system,                    -- 126
                    s.mating_system,                    -- 127
                    s.self_fertile,                     -- 128
                    s.reproductive_type,                -- 129
                    s.clonal_growth_form,               -- 130
                    s.storage_organ,                    -- 131
                    -- Risk
                    s.toxicity,                         -- 132
                    s.known_hazards,                    -- 133
                    s.invasive_potential,               -- 134
                    s.noxious_status,                   -- 135
                    s.invasive_usda,                    -- 136
                    s.weed_potential,                   -- 137
                    s.fire_resistant,                   -- 138
                    s.fire_tolerance,                   -- 139
                    s.hedge_tolerance,                  -- 140
                    s.pests_diseases,                   -- 141
                    -- Distribution
                    s.native_range,                     -- 142
                    s.native_distribution,              -- 143
                    s.introduced_distribution,          -- 144
                    s.range_text,                       -- 145
                    s.conservation_status,              -- 146
                    -- Text / notes
                    s.summary,                          -- 147
                    s.physical_characteristics,         -- 148
                    s.cultivation_notes,                -- 149
                    s.propagation_notes,                -- 150
                    s.habitats,                         -- 151
                    s.carbon_farming,                   -- 152
                    -- Media
                    s.image_urls,                       -- 153
                    -- Ellenberg
                    s.ellenberg_light,                  -- 154
                    s.ellenberg_temperature,            -- 155
                    s.ellenberg_moisture,               -- 156
                    s.ellenberg_reaction,               -- 157
                    s.ellenberg_nitrogen,               -- 158
                    s.ellenberg_salt,                   -- 159
                    -- Classification / ML
                    s.classification_source,            -- 160
                    s.model_version,                    -- 161
                    s.prompt_version,                   -- 162
                    s.reasoning,                        -- 163
                    s.classified_at,                    -- 164
                    s.validation_flags,                 -- 165
                    s.overall_confidence,               -- 166
                    s.validation_flag_count,            -- 167
                    -- Science
                    s.data_quality_tier,                -- 168
                    s.wood_density_g_cm3,               -- 169
                    s.photosynthesis_pathway,           -- 170
                    -- Fallback common name
                    s.common_name                       -- 171
             FROM species s
             WHERE s.canonical_name = ?1
             LIMIT 1",
        )
        .map_err(|e| format!("Failed to prepare species detail query: {e}"))?;

    let (species_id, mut detail) = stmt
        .query_row([canonical_name], |row| {
            let id: String = row.get(0)?;
            let fallback_common: Option<String> = row.get(171)?;
            Ok((
                id,
                SpeciesDetail {
                    canonical_name: row.get(1)?,
                    common_name: fallback_common,
                    family: row.get(2)?,
                    genus: row.get(3)?,
                    // Taxonomy
                    taxonomic_order: row.get(4)?,
                    taxonomic_class: row.get(5)?,
                    is_hybrid: row.get::<_, Option<i32>>(6)?.map(|v| v != 0),
                    // Match / provenance
                    match_confidence: row.get(7)?,
                    tnrs_taxonomic_status: row.get(8)?,
                    match_score: row.get(9)?,
                    source: row.get(10)?,
                    enriched_at: row.get(11)?,
                    enrichment_provenance: row.get(12)?,
                    // Dimensions
                    height_min_m: row.get(13)?,
                    height_max_m: row.get(14)?,
                    width_max_m: row.get(15)?,
                    hardiness_zone_min: row.get(16)?,
                    hardiness_zone_max: row.get(17)?,
                    age_of_maturity_years: row.get(18)?,
                    growth_rate: row.get(19)?,
                    // Life cycle
                    is_annual: row.get::<_, Option<i32>>(20)?.map(|v| v != 0),
                    is_biennial: row.get::<_, Option<i32>>(21)?.map(|v| v != 0),
                    is_perennial: row.get::<_, Option<i32>>(22)?.map(|v| v != 0),
                    lifespan: row.get(23)?,
                    deciduous_evergreen: row.get(24)?,
                    leaf_retention: row.get::<_, Option<i32>>(25)?.map(|v| v != 0),
                    active_growth_period: row.get(26)?,
                    // Growth form
                    habit: row.get(27)?,
                    growth_form_type: row.get(28)?,
                    growth_form_shape: row.get(29)?,
                    growth_habit: row.get(30)?,
                    woody: row.get::<_, Option<i32>>(31)?.map(|v| v != 0),
                    canopy_position: row.get(32)?,
                    resprout_ability: row.get::<_, Option<i32>>(33)?.map(|v| v != 0),
                    coppice_potential: row.get::<_, Option<i32>>(34)?.map(|v| v != 0),
                    // Bloom
                    bloom_period: row.get(35)?,
                    flower_color: row.get(36)?,
                    pollinators: row.get(37)?,
                    // Light & climate
                    tolerates_full_sun: row.get::<_, Option<i32>>(38)?.map(|v| v != 0),
                    tolerates_semi_shade: row.get::<_, Option<i32>>(39)?.map(|v| v != 0),
                    tolerates_full_shade: row.get::<_, Option<i32>>(40)?.map(|v| v != 0),
                    frost_tender: row.get::<_, Option<i32>>(41)?.map(|v| v != 0),
                    frost_free_days_min: row.get(42)?,
                    drought_tolerance: row.get(43)?,
                    precip_min_inches: row.get(44)?,
                    precip_max_inches: row.get(45)?,
                    // Soil
                    soil_ph_min: row.get(46)?,
                    soil_ph_max: row.get(47)?,
                    well_drained: row.get::<_, Option<i32>>(48)?.map(|v| v != 0),
                    heavy_clay: row.get::<_, Option<i32>>(49)?.map(|v| v != 0),
                    tolerates_light_soil: row.get::<_, Option<i32>>(50)?.map(|v| v != 0),
                    tolerates_medium_soil: row.get::<_, Option<i32>>(51)?.map(|v| v != 0),
                    tolerates_heavy_soil: row.get::<_, Option<i32>>(52)?.map(|v| v != 0),
                    tolerates_acid: row.get::<_, Option<i32>>(53)?.map(|v| v != 0),
                    tolerates_alkaline: row.get::<_, Option<i32>>(54)?.map(|v| v != 0),
                    tolerates_saline: row.get::<_, Option<i32>>(55)?.map(|v| v != 0),
                    tolerates_wind: row.get::<_, Option<i32>>(56)?.map(|v| v != 0),
                    tolerates_pollution: row.get::<_, Option<i32>>(57)?.map(|v| v != 0),
                    tolerates_nutritionally_poor: row.get::<_, Option<i32>>(58)?.map(|v| v != 0),
                    fertility_requirement: row.get(59)?,
                    moisture_use: row.get(60)?,
                    anaerobic_tolerance: row.get(61)?,
                    root_depth_min_cm: row.get(62)?,
                    salinity_tolerance: row.get(63)?,
                    // Ecology
                    stratum: row.get(64)?,
                    succession_stage: row.get(65)?,
                    stratum_confidence: row.get(66)?,
                    succession_confidence: row.get(67)?,
                    nitrogen_fixer: row.get::<_, Option<i32>>(68)?.map(|v| v != 0),
                    ecological_system: row.get(69)?,
                    mycorrhizal_type: row.get(70)?,
                    grime_strategy: row.get(71)?,
                    raunkiaer_life_form: row.get(72)?,
                    cn_ratio: row.get(73)?,
                    allelopathic: row.get::<_, Option<i32>>(74)?.map(|v| v != 0),
                    root_system_type: row.get(75)?,
                    taproot_persistent: row.get::<_, Option<i32>>(76)?.map(|v| v != 0),
                    // Uses & ratings
                    edibility_rating: row.get(77)?,
                    medicinal_rating: row.get(78)?,
                    other_uses_rating: row.get(79)?,
                    edible_uses: row.get(80)?,
                    medicinal_uses: row.get(81)?,
                    other_uses: row.get(82)?,
                    special_uses: row.get(83)?,
                    attracts_wildlife: row.get::<_, Option<i32>>(84)?.map(|v| v != 0),
                    scented: row.get::<_, Option<i32>>(85)?.map(|v| v != 0),
                    uses: vec![],
                    // Propagation
                    propagated_by_seed: row.get::<_, Option<i32>>(86)?.map(|v| v != 0),
                    propagated_by_cuttings: row.get::<_, Option<i32>>(87)?.map(|v| v != 0),
                    propagated_by_bare_root: row.get::<_, Option<i32>>(88)?.map(|v| v != 0),
                    propagated_by_container: row.get::<_, Option<i32>>(89)?.map(|v| v != 0),
                    propagated_by_sprigs: row.get::<_, Option<i32>>(90)?.map(|v| v != 0),
                    propagated_by_bulb: row.get::<_, Option<i32>>(91)?.map(|v| v != 0),
                    propagated_by_sod: row.get::<_, Option<i32>>(92)?.map(|v| v != 0),
                    propagated_by_tubers: row.get::<_, Option<i32>>(93)?.map(|v| v != 0),
                    propagated_by_corm: row.get::<_, Option<i32>>(94)?.map(|v| v != 0),
                    cold_stratification_required: row.get::<_, Option<i32>>(95)?.map(|v| v != 0),
                    vegetative_spread_rate: row.get(96)?,
                    seed_spread_rate: row.get(97)?,
                    propagation_method: row.get(98)?,
                    sowing_period: row.get(99)?,
                    harvest_period: row.get(100)?,
                    dormancy_conditions: row.get(101)?,
                    management_types: row.get(102)?,
                    // Fruit & seed
                    fruit_type: row.get(103)?,
                    fruit_seed_color: row.get(104)?,
                    fruit_seed_period_begin: row.get(105)?,
                    fruit_seed_period_end: row.get(106)?,
                    fruit_seed_abundance: row.get(107)?,
                    fruit_seed_persistence: row.get::<_, Option<i32>>(108)?.map(|v| v != 0),
                    seed_mass_mg: row.get(109)?,
                    seed_length_mm: row.get(110)?,
                    seed_germination_rate: row.get(111)?,
                    seed_dispersal_mechanism: row.get(112)?,
                    seed_storage_behaviour: row.get(113)?,
                    seed_dormancy_type: row.get(114)?,
                    seedbank_type: row.get(115)?,
                    // Leaf
                    leaf_type: row.get(116)?,
                    leaf_compoundness: row.get(117)?,
                    leaf_shape: row.get(118)?,
                    sla_mm2_mg: row.get(119)?,
                    ldmc_g_g: row.get(120)?,
                    leaf_nitrogen_mg_g: row.get(121)?,
                    leaf_carbon_mg_g: row.get(122)?,
                    leaf_phosphorus_mg_g: row.get(123)?,
                    leaf_dry_mass_mg: row.get(124)?,
                    // Reproduction
                    pollination_syndrome: row.get(125)?,
                    sexual_system: row.get(126)?,
                    mating_system: row.get(127)?,
                    self_fertile: row.get::<_, Option<i32>>(128)?.map(|v| v != 0),
                    reproductive_type: row.get(129)?,
                    clonal_growth_form: row.get(130)?,
                    storage_organ: row.get(131)?,
                    // Risk
                    toxicity: row.get(132)?,
                    known_hazards: row.get(133)?,
                    invasive_potential: row.get(134)?,
                    noxious_status: row.get::<_, Option<i32>>(135)?.map(|v| v != 0),
                    invasive_usda: row.get::<_, Option<i32>>(136)?.map(|v| v != 0),
                    weed_potential: row.get::<_, Option<i32>>(137)?.map(|v| v != 0),
                    fire_resistant: row.get::<_, Option<i32>>(138)?.map(|v| v != 0),
                    fire_tolerance: row.get(139)?,
                    hedge_tolerance: row.get(140)?,
                    pests_diseases: row.get(141)?,
                    // Distribution
                    native_range: row.get(142)?,
                    native_distribution: row.get(143)?,
                    introduced_distribution: row.get(144)?,
                    range_text: row.get(145)?,
                    conservation_status: row.get(146)?,
                    // Text / notes
                    summary: row.get(147)?,
                    physical_characteristics: row.get(148)?,
                    cultivation_notes: row.get(149)?,
                    propagation_notes: row.get(150)?,
                    habitats: row.get(151)?,
                    carbon_farming: row.get(152)?,
                    // Media
                    image_urls: row.get(153)?,
                    // Ellenberg
                    ellenberg_light: row.get(154)?,
                    ellenberg_temperature: row.get(155)?,
                    ellenberg_moisture: row.get(156)?,
                    ellenberg_reaction: row.get(157)?,
                    ellenberg_nitrogen: row.get(158)?,
                    ellenberg_salt: row.get(159)?,
                    // Classification / ML
                    classification_source: row.get(160)?,
                    model_version: row.get(161)?,
                    prompt_version: row.get(162)?,
                    reasoning: row.get(163)?,
                    classified_at: row.get(164)?,
                    validation_flags: row.get(165)?,
                    overall_confidence: row.get(166)?,
                    validation_flag_count: row.get(167)?,
                    // Science
                    data_quality_tier: row.get(168)?,
                    wood_density_g_cm3: row.get(169)?,
                    photosynthesis_pathway: row.get(170)?,
                    // Relations (populated below)
                    relationships: vec![],
                },
            ))
        })
        .map_err(|e| format!("Failed to fetch species detail for '{canonical_name}': {e}"))?;

    // Override common_name with the locale-aware lookup.
    detail.common_name = get_common_name(conn, &species_id, locale).or(detail.common_name);

    // Translate categorical fields for the requested locale.
    // translate_value returns the English value unchanged if no translation exists.
    for (field, getter, setter) in [
        ("growth_rate", detail.growth_rate.clone(), &mut detail.growth_rate as &mut Option<String>),
        ("deciduous_evergreen", detail.deciduous_evergreen.clone(), &mut detail.deciduous_evergreen),
        ("drought_tolerance", detail.drought_tolerance.clone(), &mut detail.drought_tolerance),
        ("stratum", detail.stratum.clone(), &mut detail.stratum),
        ("succession_stage", detail.succession_stage.clone(), &mut detail.succession_stage),
        ("habit", detail.habit.clone(), &mut detail.habit),
        ("bloom_period", detail.bloom_period.clone(), &mut detail.bloom_period),
        ("flower_color", detail.flower_color.clone(), &mut detail.flower_color),
        ("active_growth_period", detail.active_growth_period.clone(), &mut detail.active_growth_period),
        ("lifespan", detail.lifespan.clone(), &mut detail.lifespan),
        ("toxicity", detail.toxicity.clone(), &mut detail.toxicity),
        // New v7 categorical fields
        ("anaerobic_tolerance", detail.anaerobic_tolerance.clone(), &mut detail.anaerobic_tolerance),
        ("canopy_position", detail.canopy_position.clone(), &mut detail.canopy_position),
        ("cn_ratio", detail.cn_ratio.clone(), &mut detail.cn_ratio),
        ("ecological_system", detail.ecological_system.clone(), &mut detail.ecological_system),
        ("fertility_requirement", detail.fertility_requirement.clone(), &mut detail.fertility_requirement),
        ("fire_tolerance", detail.fire_tolerance.clone(), &mut detail.fire_tolerance),
        ("fruit_seed_abundance", detail.fruit_seed_abundance.clone(), &mut detail.fruit_seed_abundance),
        ("grime_strategy", detail.grime_strategy.clone(), &mut detail.grime_strategy),
        ("growth_form_type", detail.growth_form_type.clone(), &mut detail.growth_form_type),
        ("growth_habit", detail.growth_habit.clone(), &mut detail.growth_habit),
        ("hedge_tolerance", detail.hedge_tolerance.clone(), &mut detail.hedge_tolerance),
        ("invasive_potential", detail.invasive_potential.clone(), &mut detail.invasive_potential),
        ("leaf_compoundness", detail.leaf_compoundness.clone(), &mut detail.leaf_compoundness),
        ("leaf_shape", detail.leaf_shape.clone(), &mut detail.leaf_shape),
        ("leaf_type", detail.leaf_type.clone(), &mut detail.leaf_type),
        ("moisture_use", detail.moisture_use.clone(), &mut detail.moisture_use),
        ("mycorrhizal_type", detail.mycorrhizal_type.clone(), &mut detail.mycorrhizal_type),
        ("pollination_syndrome", detail.pollination_syndrome.clone(), &mut detail.pollination_syndrome),
        ("raunkiaer_life_form", detail.raunkiaer_life_form.clone(), &mut detail.raunkiaer_life_form),
        ("reproductive_type", detail.reproductive_type.clone(), &mut detail.reproductive_type),
        ("root_system_type", detail.root_system_type.clone(), &mut detail.root_system_type),
        ("salinity_tolerance", detail.salinity_tolerance.clone(), &mut detail.salinity_tolerance),
        ("seed_dispersal_mechanism", detail.seed_dispersal_mechanism.clone(), &mut detail.seed_dispersal_mechanism),
        ("seed_dormancy_type", detail.seed_dormancy_type.clone(), &mut detail.seed_dormancy_type),
        ("seed_spread_rate", detail.seed_spread_rate.clone(), &mut detail.seed_spread_rate),
        ("seed_storage_behaviour", detail.seed_storage_behaviour.clone(), &mut detail.seed_storage_behaviour),
        ("seedbank_type", detail.seedbank_type.clone(), &mut detail.seedbank_type),
        ("sexual_system", detail.sexual_system.clone(), &mut detail.sexual_system),
        ("storage_organ", detail.storage_organ.clone(), &mut detail.storage_organ),
        ("vegetative_spread_rate", detail.vegetative_spread_rate.clone(), &mut detail.vegetative_spread_rate),
        ("classification_source", detail.classification_source.clone(), &mut detail.classification_source),
        ("data_quality_tier", detail.data_quality_tier.clone(), &mut detail.data_quality_tier),
        ("photosynthesis_pathway", detail.photosynthesis_pathway.clone(), &mut detail.photosynthesis_pathway),
        ("clonal_growth_form", detail.clonal_growth_form.clone(), &mut detail.clonal_growth_form),
        ("mating_system", detail.mating_system.clone(), &mut detail.mating_system),
        // Phase 3.1 — new/expanded sections
        ("conservation_status", detail.conservation_status.clone(), &mut detail.conservation_status),
        ("fruit_type", detail.fruit_type.clone(), &mut detail.fruit_type),
        ("fruit_seed_color", detail.fruit_seed_color.clone(), &mut detail.fruit_seed_color),
        ("fruit_seed_period_begin", detail.fruit_seed_period_begin.clone(), &mut detail.fruit_seed_period_begin),
        ("fruit_seed_period_end", detail.fruit_seed_period_end.clone(), &mut detail.fruit_seed_period_end),
        ("growth_form_shape", detail.growth_form_shape.clone(), &mut detail.growth_form_shape),
        ("propagation_method", detail.propagation_method.clone(), &mut detail.propagation_method),
        ("sowing_period", detail.sowing_period.clone(), &mut detail.sowing_period),
        ("harvest_period", detail.harvest_period.clone(), &mut detail.harvest_period),
        ("dormancy_conditions", detail.dormancy_conditions.clone(), &mut detail.dormancy_conditions),
        ("management_types", detail.management_types.clone(), &mut detail.management_types),
        ("pollinators", detail.pollinators.clone(), &mut detail.pollinators),
    ] {
        if let Some(ref v) = getter {
            *setter = Some(translate_value(conn, field, v, locale));
        }
    }

    // Fetch uses and translate descriptions for the requested locale.
    // translated_values uses "use:edible_uses" field names; species_uses has "edible uses" categories.
    detail.uses = {
        let mut s = conn
            .prepare(
                "SELECT DISTINCT use_category, use_description
                 FROM species_uses
                 WHERE species_id = ?1
                 ORDER BY use_category",
            )
            .map_err(|e| format!("Failed to prepare uses query: {e}"))?;
        let rows: Vec<SpeciesUse> = s.query_map([&species_id], |row| {
            Ok(SpeciesUse {
                use_category: row.get(0)?,
                use_description: row.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to fetch uses: {e}"))?
        .filter_map(|r| match r {
            Ok(item) => Some(item),
            Err(e) => { tracing::warn!("Skipped uses row: {e}"); None }
        })
        .collect();
        // Translate use descriptions: map category "edible uses" → field "use:edible_uses"
        rows.into_iter().map(|mut u| {
            let field = format!("use:{}", u.use_category.replace(' ', "_"));
            if let Some(ref desc) = u.use_description {
                u.use_description = Some(translate_value(conn, &field, desc, locale));
            }
            u
        }).collect()
    };

    // Fetch relationships.
    detail.relationships = get_relationships(conn, &species_id)?;

    Ok(detail)
}

/// Returns companion/antagonist relationships for a species by its UUID.
pub fn get_relationships(
    conn: &Connection,
    species_id: &str,
) -> Result<Vec<Relationship>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.canonical_name, sr.relationship_type
             FROM species_relationships sr
             JOIN species s ON s.slug = sr.related_species_slug
             WHERE sr.species_id = ?1
             ORDER BY sr.relationship_type, s.canonical_name",
        )
        .map_err(|e| format!("Failed to prepare relationships query: {e}"))?;

    let relationships = stmt
        .query_map([species_id], |row| {
            Ok(Relationship {
                related_canonical_name: row.get(0)?,
                relationship_type: row.get(1)?,
                description: None,
            })
        })
        .map_err(|e| format!("Failed to fetch relationships: {e}"))?
        .filter_map(|r| match r {
            Ok(item) => Some(item),
            Err(e) => { tracing::warn!("Skipped relationship row: {e}"); None }
        })
        .collect();

    Ok(relationships)
}

/// Returns images for a species by canonical name.
/// Returns an empty list if the species is not found (e.g., renamed after DB rebuild).
pub fn get_species_images(
    conn: &Connection,
    canonical_name: &str,
) -> Result<Vec<SpeciesImage>, String> {
    let species_id: Option<String> = conn
        .query_row(
            "SELECT id FROM species WHERE canonical_name = ?1 LIMIT 1",
            [canonical_name],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to look up species id for '{canonical_name}': {e}"))?;

    let Some(species_id) = species_id else {
        return Ok(vec![]);
    };

    let mut stmt = conn
        .prepare(
            "SELECT id, species_id, url, source, sort_order
             FROM species_images
             WHERE species_id = ?1
             ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare species images query: {e}"))?;

    let images = stmt
        .query_map([&species_id], |row| {
            Ok(SpeciesImage {
                id: row.get(0)?,
                species_id: row.get(1)?,
                url: row.get(2)?,
                source: row.get(3)?,
                sort_order: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to fetch species images: {e}"))?
        .filter_map(|r| match r {
            Ok(item) => Some(item),
            Err(e) => { tracing::warn!("Skipped species image row: {e}"); None }
        })
        .collect();

    Ok(images)
}

/// Returns external links for a species by canonical name.
/// Returns an empty list if the species is not found (e.g., renamed after DB rebuild).
pub fn get_species_external_links(
    conn: &Connection,
    canonical_name: &str,
) -> Result<Vec<SpeciesExternalLink>, String> {
    let species_id: Option<String> = conn
        .query_row(
            "SELECT id FROM species WHERE canonical_name = ?1 LIMIT 1",
            [canonical_name],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to look up species id for '{canonical_name}': {e}"))?;

    let Some(species_id) = species_id else {
        return Ok(vec![]);
    };

    let mut stmt = conn
        .prepare(
            "SELECT id, species_id, link_type, url
             FROM species_external_links
             WHERE species_id = ?1
             ORDER BY link_type",
        )
        .map_err(|e| format!("Failed to prepare species external links query: {e}"))?;

    let links = stmt
        .query_map([&species_id], |row| {
            Ok(SpeciesExternalLink {
                id: row.get(0)?,
                species_id: row.get(1)?,
                link_type: row.get(2)?,
                url: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to fetch species external links: {e}"))?
        .filter_map(|r| match r {
            Ok(item) => Some(item),
            Err(e) => { tracing::warn!("Skipped species external link row: {e}"); None }
        })
        .collect();

    Ok(links)
}

/// Returns all distinct values used to populate filter UI dropdowns.
pub fn get_filter_options(conn: &Connection) -> Result<FilterOptions, String> {
    let families: Vec<String> = {
        let mut s = conn
            .prepare(
                "SELECT DISTINCT family FROM species WHERE family IS NOT NULL ORDER BY family",
            )
            .map_err(|e| format!("Failed to prepare families query: {e}"))?;
        s.query_map([], |row| row.get(0))
            .map_err(|e| format!("Failed to fetch families: {e}"))?
            .filter_map(|r| match r {
                Ok(item) => Some(item),
                Err(e) => { tracing::warn!("Skipped family row: {e}"); None }
            })
            .collect()
    };

    let growth_rates: Vec<String> = {
        let mut s = conn
            .prepare(
                "SELECT DISTINCT growth_rate FROM species WHERE growth_rate IS NOT NULL ORDER BY growth_rate",
            )
            .map_err(|e| format!("Failed to prepare growth rates query: {e}"))?;
        s.query_map([], |row| row.get(0))
            .map_err(|e| format!("Failed to fetch growth rates: {e}"))?
            .filter_map(|r| match r {
                Ok(item) => Some(item),
                Err(e) => { tracing::warn!("Skipped growth rate row: {e}"); None }
            })
            .collect()
    };

    let strata: Vec<String> = {
        let mut s = conn
            .prepare(
                "SELECT DISTINCT stratum FROM species WHERE stratum IS NOT NULL ORDER BY stratum",
            )
            .map_err(|e| format!("Failed to prepare strata query: {e}"))?;
        s.query_map([], |row| row.get(0))
            .map_err(|e| format!("Failed to fetch strata: {e}"))?
            .filter_map(|r| match r {
                Ok(item) => Some(item),
                Err(e) => { tracing::warn!("Skipped stratum row: {e}"); None }
            })
            .collect()
    };

    // Life cycles are now boolean columns (is_annual, is_biennial, is_perennial).
    // Return a fixed list — the frontend renders these as checkboxes and the
    // query builder maps them to the boolean column checks.
    let life_cycles: Vec<String> = vec![
        "Annual".to_owned(),
        "Biennial".to_owned(),
        "Perennial".to_owned(),
    ];

    // Soil tolerances are now boolean columns on the species table.
    // Return a hardcoded list — no species_soil_types table to query.
    let soil_tolerances: Vec<String> = vec![
        "light".to_owned(),
        "medium".to_owned(),
        "heavy".to_owned(),
        "well_drained".to_owned(),
        "heavy_clay".to_owned(),
    ];

    let sun_tolerances: Vec<String> = {
        // These are synthesized from boolean columns rather than a DISTINCT query.
        let mut result = Vec::new();
        let has_full_sun: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM species WHERE tolerates_full_sun = 1)",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        let has_semi_shade: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM species WHERE tolerates_semi_shade = 1)",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        let has_full_shade: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM species WHERE tolerates_full_shade = 1)",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if has_full_sun {
            result.push("full_sun".to_owned());
        }
        if has_semi_shade {
            result.push("semi_shade".to_owned());
        }
        if has_full_shade {
            result.push("full_shade".to_owned());
        }
        result
    };

    let hardiness_range: (i32, i32) = conn
        .query_row(
            "SELECT COALESCE(MIN(hardiness_zone_min), 1), COALESCE(MAX(hardiness_zone_max), 13)
             FROM species",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Failed to fetch hardiness range: {e}"))?;

    Ok(FilterOptions {
        families,
        growth_rates,
        strata,
        hardiness_range,
        life_cycles,
        sun_tolerances,
        soil_tolerances,
    })
}

/// Returns the best available common name for a species, preferring the
/// requested locale and falling back to English.
/// Uses `best_common_names` (pre-aggregated by prepare-db.py) first, then
/// falls back to `species_common_names` for broader coverage.
pub fn get_common_name(conn: &Connection, species_id: &str, locale: &str) -> Option<String> {
    // Try best_common_names first (most reliable, one entry per species+language).
    let best: Option<String> = conn
        .query_row(
            "SELECT common_name FROM best_common_names
             WHERE species_id = ?1 AND language = ?2
             LIMIT 1",
            [species_id, locale],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();

    if best.is_some() {
        return best;
    }

    // Fall back to best_common_names English.
    let best_en: Option<String> = conn
        .query_row(
            "SELECT common_name FROM best_common_names
             WHERE species_id = ?1 AND language = 'en'
             LIMIT 1",
            [species_id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();

    if best_en.is_some() {
        return best_en;
    }

    // Final fallback to species_common_names.
    conn.query_row(
        "SELECT common_name FROM species_common_names
         WHERE species_id = ?1 AND language = 'en' AND is_primary = 1
         LIMIT 1",
        [species_id],
        |row| row.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

/// Batch lookup: given a list of canonical names and a locale, return a map
/// of canonical_name -> common_name. One SQL query using JOIN + IN clause.
/// Falls back to English if the requested locale has no entry.
pub fn get_common_names_batch(
    conn: &Connection,
    canonical_names: &[String],
    locale: &str,
) -> Result<std::collections::HashMap<String, String>, String> {
    if canonical_names.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    if canonical_names.len() > 500 {
        return Err("Batch size exceeds maximum of 500 names".into());
    }

    // Params: ?1 = locale, ?2..?N+1 = canonical names
    let name_placeholders: Vec<String> = (2..=canonical_names.len() + 1)
        .map(|i| format!("?{i}"))
        .collect();
    let in_clause = name_placeholders.join(", ");

    let sql = format!(
        "SELECT s.canonical_name,
                COALESCE(bcn_loc.common_name, bcn_en.common_name, scn_loc.common_name, scn_en.common_name, s.common_name) AS resolved_name
         FROM species s
         LEFT JOIN best_common_names bcn_loc
           ON bcn_loc.species_id = s.id AND bcn_loc.language = ?1
         LEFT JOIN best_common_names bcn_en
           ON bcn_en.species_id = s.id AND bcn_en.language = 'en'
         LEFT JOIN species_common_names scn_loc
           ON scn_loc.species_id = s.id AND scn_loc.language = ?1 AND scn_loc.is_primary = 1
         LEFT JOIN species_common_names scn_en
           ON scn_en.species_id = s.id AND scn_en.language = 'en' AND scn_en.is_primary = 1
         WHERE s.canonical_name IN ({in_clause})",
    );

    let mut stmt = conn.prepare(&sql)
        .map_err(|e| format!("Failed to prepare batch common name query: {e}"))?;

    // Build params: locale first, then all canonical names
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::with_capacity(canonical_names.len() + 1);
    params.push(Box::new(locale.to_string()));
    for name in canonical_names {
        params.push(Box::new(name.clone()));
    }
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(&*param_refs, |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }).map_err(|e| format!("Batch common name query failed: {e}"))?;

    let mut result = std::collections::HashMap::new();
    for row in rows {
        if let Ok((canonical, Some(name))) = row {
            if !name.is_empty() {
                result.insert(canonical, name);
            }
        }
    }
    Ok(result)
}

/// Looks up a translated display value from the `translated_values` table.
/// The table uses a wide format: field_name, value_en, value_fr, value_es, etc.
/// Returns the original English value if no translation is found.
pub fn translate_value(
    conn: &Connection,
    field: &str,
    value_en: &str,
    locale: &str,
) -> String {
    // Validate locale to prevent SQL injection — only known locale columns allowed
    let col = match locale {
        "fr" => "value_fr",
        "es" => "value_es",
        "pt" => "value_pt",
        "it" => "value_it",
        "zh" => "value_zh",
        "de" => "value_de",
        "ja" => "value_ja",
        "ko" => "value_ko",
        "nl" => "value_nl",
        "ru" => "value_ru",
        _ => return value_en.to_owned(), // "en" or unknown -> return English
    };
    let sql = format!(
        "SELECT COALESCE({col}, value_en) FROM translated_values \
         WHERE field_name = ?1 AND value_en = ?2 LIMIT 1"
    );
    // prepare_cached reuses the statement handle across calls with the same SQL,
    // avoiding repeated parsing for the ~57 fields translated per detail load.
    conn.prepare_cached(&sql)
        .and_then(|mut stmt| stmt.query_row([field, value_en], |row| row.get::<_, String>(0)).optional())
        .ok()
        .flatten()
        .unwrap_or_else(|| value_en.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

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
                edible_uses TEXT,
                medicinal_uses TEXT,
                other_uses TEXT,
                special_uses TEXT,
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
                known_hazards TEXT,
                invasive_potential TEXT,
                noxious_status INTEGER,
                invasive_usda INTEGER,
                weed_potential INTEGER,
                fire_resistant INTEGER,
                fire_tolerance TEXT,
                hedge_tolerance TEXT,
                pests_diseases TEXT,
                native_range TEXT,
                native_distribution TEXT,
                introduced_distribution TEXT,
                range_text TEXT,
                conservation_status TEXT,
                summary TEXT,
                physical_characteristics TEXT,
                cultivation_notes TEXT,
                propagation_notes TEXT,
                habitats TEXT,
                carbon_farming TEXT,
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
                reasoning TEXT,
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

            INSERT INTO species (id, slug, canonical_name, common_name, family, genus,
                height_min_m, height_max_m, width_max_m, hardiness_zone_min, hardiness_zone_max,
                soil_ph_min, soil_ph_max, drought_tolerance, frost_tender, growth_rate,
                is_annual, is_biennial, is_perennial, lifespan, habit, deciduous_evergreen,
                bloom_period, flower_color, tolerates_full_sun, tolerates_semi_shade, tolerates_full_shade,
                well_drained, tolerates_light_soil, tolerates_medium_soil, tolerates_heavy_soil,
                nitrogen_fixer, stratum, edibility_rating, medicinal_rating,
                scented, toxicity, known_hazards, summary)
            VALUES (
                'uuid-lav', 'lavandula-angustifolia', 'Lavandula angustifolia',
                'Lavender', 'Lamiaceae', 'Lavandula',
                0.3, 0.6, 0.9, 5, 9, 6.0, 8.0,
                'Medium', 0, 'Slow',
                0, 0, 1, 'Short-lived perennial', 'Shrub', 'Evergreen',
                'Summer', 'Purple', 1, 1, 0,
                1, 1, 1, 0,
                0, 'Low', 3, 2,
                1, NULL, NULL, 'A popular aromatic herb'
            );
            INSERT INTO species (id, slug, canonical_name, common_name, family, genus,
                height_min_m, height_max_m, width_max_m, hardiness_zone_min, hardiness_zone_max,
                soil_ph_min, soil_ph_max, growth_rate,
                is_annual, is_biennial, is_perennial, habit, deciduous_evergreen,
                tolerates_full_sun, tolerates_semi_shade, tolerates_full_shade,
                nitrogen_fixer, stratum, edibility_rating, medicinal_rating,
                succession_stage, known_hazards)
            VALUES (
                'uuid-ald', 'alnus-glutinosa', 'Alnus glutinosa',
                'Alder', 'Betulaceae', 'Alnus',
                5.0, 20.0, 8.0, 1, 8, 5.5, 7.5,
                'Fast',
                0, 0, 1, 'Tree', 'Deciduous',
                1, 0, 0,
                1, 'Canopy', 0, 0,
                'secondary_i', 'None known'
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
                ('t1', 'growth_rate', 'Slow', 'Lent', NULL, NULL, NULL, NULL, 'Langsam', NULL, NULL, NULL, NULL);

            INSERT INTO best_common_names VALUES
                ('uuid-lav', 'en', 'Lavender'),
                ('uuid-lav', 'fr', 'Lavande'),
                ('uuid-ald', 'en', 'Common Alder');
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
        assert_eq!(detail.summary.as_deref(), Some("A popular aromatic herb"));
        // New soil tolerance booleans
        assert_eq!(detail.tolerates_light_soil, Some(true));
        assert_eq!(detail.tolerates_medium_soil, Some(true));
        assert_eq!(detail.tolerates_heavy_soil, Some(false));
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
        let categories: Vec<&str> = detail.uses.iter().map(|u| u.use_category.as_str()).collect();
        assert!(categories.contains(&"Medicinal"));
        assert!(categories.contains(&"Culinary"));
    }

    #[test]
    fn test_get_detail_relationships() {
        let conn = test_db();
        let detail = get_detail(&conn, "Lavandula angustifolia", "en").unwrap();
        assert_eq!(detail.relationships.len(), 1);
        assert_eq!(detail.relationships[0].related_canonical_name, "Alnus glutinosa");
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
        assert_eq!(detail.known_hazards.as_deref(), Some("None known"));
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
        assert!(opts.hardiness_range.0 <= 1);
        assert!(opts.hardiness_range.1 >= 9);
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
        assert_eq!(translate_value(&conn, "growth_rate", "Slow", "de"), "Langsam");
        // Japanese has no translation — returns English
        assert_eq!(translate_value(&conn, "growth_rate", "Slow", "ja"), "Slow");
    }

    #[test]
    fn test_get_detail_missing_species_returns_err() {
        let conn = test_db();
        let result = get_detail(&conn, "Nonexistent species", "en");
        assert!(result.is_err());
    }
}
