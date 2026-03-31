use common_types::species::{
    Relationship, SpeciesDetail, SpeciesExternalLink, SpeciesImage, SpeciesUse,
};
use rusqlite::{Connection, OptionalExtension};

use super::lookup::{get_common_name, translate_composite_value, translate_value};

pub fn get_detail(
    conn: &Connection,
    canonical_name: &str,
    locale: &str,
) -> Result<SpeciesDetail, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id,
                    s.canonical_name,
                    s.family,
                    s.genus,
                    s.taxonomic_order,
                    s.taxonomic_class,
                    s.is_hybrid,
                    s.match_confidence,
                    s.tnrs_taxonomic_status,
                    s.match_score,
                    s.source,
                    s.enriched_at,
                    s.enrichment_provenance,
                    s.height_min_m,
                    s.height_max_m,
                    s.width_max_m,
                    s.hardiness_zone_min,
                    s.hardiness_zone_max,
                    s.age_of_maturity_years,
                    s.growth_rate,
                    s.is_annual,
                    s.is_biennial,
                    s.is_perennial,
                    s.lifespan,
                    s.deciduous_evergreen,
                    s.leaf_retention,
                    s.active_growth_period,
                    s.habit,
                    s.growth_form_type,
                    s.growth_form_shape,
                    s.growth_habit,
                    s.woody,
                    s.canopy_position,
                    s.resprout_ability,
                    s.coppice_potential,
                    s.bloom_period,
                    s.flower_color,
                    s.pollinators,
                    s.tolerates_full_sun,
                    s.tolerates_semi_shade,
                    s.tolerates_full_shade,
                    s.frost_tender,
                    s.frost_free_days_min,
                    s.drought_tolerance,
                    s.precip_min_inches,
                    s.precip_max_inches,
                    s.soil_ph_min,
                    s.soil_ph_max,
                    s.well_drained,
                    s.heavy_clay,
                    s.tolerates_light_soil,
                    s.tolerates_medium_soil,
                    s.tolerates_heavy_soil,
                    s.tolerates_acid,
                    s.tolerates_alkaline,
                    s.tolerates_saline,
                    s.tolerates_wind,
                    s.tolerates_pollution,
                    s.tolerates_nutritionally_poor,
                    s.fertility_requirement,
                    s.moisture_use,
                    s.anaerobic_tolerance,
                    s.root_depth_min_cm,
                    s.salinity_tolerance,
                    s.stratum,
                    s.succession_stage,
                    s.stratum_confidence,
                    s.succession_confidence,
                    s.nitrogen_fixer,
                    s.ecological_system,
                    s.mycorrhizal_type,
                    s.grime_strategy,
                    s.raunkiaer_life_form,
                    s.cn_ratio,
                    s.allelopathic,
                    s.root_system_type,
                    s.taproot_persistent,
                    s.edibility_rating,
                    s.medicinal_rating,
                    s.other_uses_rating,
                    s.edible_uses,
                    s.medicinal_uses,
                    s.other_uses,
                    s.special_uses,
                    s.attracts_wildlife,
                    s.scented,
                    s.propagated_by_seed,
                    s.propagated_by_cuttings,
                    s.propagated_by_bare_root,
                    s.propagated_by_container,
                    s.propagated_by_sprigs,
                    s.propagated_by_bulb,
                    s.propagated_by_sod,
                    s.propagated_by_tubers,
                    s.propagated_by_corm,
                    s.cold_stratification_required,
                    s.vegetative_spread_rate,
                    s.seed_spread_rate,
                    s.propagation_method,
                    s.sowing_period,
                    s.harvest_period,
                    s.dormancy_conditions,
                    s.management_types,
                    s.fruit_type,
                    s.fruit_seed_color,
                    s.fruit_seed_period_begin,
                    s.fruit_seed_period_end,
                    s.fruit_seed_abundance,
                    s.fruit_seed_persistence,
                    s.seed_mass_mg,
                    s.seed_length_mm,
                    s.seed_germination_rate,
                    s.seed_dispersal_mechanism,
                    s.seed_storage_behaviour,
                    s.seed_dormancy_type,
                    s.seedbank_type,
                    s.leaf_type,
                    s.leaf_compoundness,
                    s.leaf_shape,
                    s.sla_mm2_mg,
                    s.ldmc_g_g,
                    s.leaf_nitrogen_mg_g,
                    s.leaf_carbon_mg_g,
                    s.leaf_phosphorus_mg_g,
                    s.leaf_dry_mass_mg,
                    s.pollination_syndrome,
                    s.sexual_system,
                    s.mating_system,
                    s.self_fertile,
                    s.reproductive_type,
                    s.clonal_growth_form,
                    s.storage_organ,
                    s.toxicity,
                    s.known_hazards,
                    s.invasive_potential,
                    s.noxious_status,
                    s.invasive_usda,
                    s.weed_potential,
                    s.fire_resistant,
                    s.fire_tolerance,
                    s.hedge_tolerance,
                    s.pests_diseases,
                    s.native_range,
                    s.native_distribution,
                    s.introduced_distribution,
                    s.range_text,
                    s.conservation_status,
                    s.summary,
                    s.physical_characteristics,
                    s.cultivation_notes,
                    s.propagation_notes,
                    s.habitats,
                    s.carbon_farming,
                    s.image_urls,
                    s.ellenberg_light,
                    s.ellenberg_temperature,
                    s.ellenberg_moisture,
                    s.ellenberg_reaction,
                    s.ellenberg_nitrogen,
                    s.ellenberg_salt,
                    s.classification_source,
                    s.model_version,
                    s.prompt_version,
                    s.reasoning,
                    s.classified_at,
                    s.validation_flags,
                    s.overall_confidence,
                    s.validation_flag_count,
                    s.data_quality_tier,
                    s.wood_density_g_cm3,
                    s.photosynthesis_pathway,
                    s.common_name
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
                    taxonomic_order: row.get(4)?,
                    taxonomic_class: row.get(5)?,
                    is_hybrid: row.get::<_, Option<i32>>(6)?.map(|v| v != 0),
                    match_confidence: row.get(7)?,
                    tnrs_taxonomic_status: row.get(8)?,
                    match_score: row.get(9)?,
                    source: row.get(10)?,
                    enriched_at: row.get(11)?,
                    enrichment_provenance: row.get(12)?,
                    height_min_m: row.get(13)?,
                    height_max_m: row.get(14)?,
                    width_max_m: row.get(15)?,
                    hardiness_zone_min: row.get(16)?,
                    hardiness_zone_max: row.get(17)?,
                    age_of_maturity_years: row.get(18)?,
                    growth_rate: row.get(19)?,
                    is_annual: row.get::<_, Option<i32>>(20)?.map(|v| v != 0),
                    is_biennial: row.get::<_, Option<i32>>(21)?.map(|v| v != 0),
                    is_perennial: row.get::<_, Option<i32>>(22)?.map(|v| v != 0),
                    lifespan: row.get(23)?,
                    deciduous_evergreen: row.get(24)?,
                    leaf_retention: row.get::<_, Option<i32>>(25)?.map(|v| v != 0),
                    active_growth_period: row.get(26)?,
                    habit: row.get(27)?,
                    growth_form_type: row.get(28)?,
                    growth_form_shape: row.get(29)?,
                    growth_habit: row.get(30)?,
                    woody: row.get::<_, Option<i32>>(31)?.map(|v| v != 0),
                    canopy_position: row.get(32)?,
                    resprout_ability: row.get::<_, Option<i32>>(33)?.map(|v| v != 0),
                    coppice_potential: row.get::<_, Option<i32>>(34)?.map(|v| v != 0),
                    bloom_period: row.get(35)?,
                    flower_color: row.get(36)?,
                    pollinators: row.get(37)?,
                    tolerates_full_sun: row.get::<_, Option<i32>>(38)?.map(|v| v != 0),
                    tolerates_semi_shade: row.get::<_, Option<i32>>(39)?.map(|v| v != 0),
                    tolerates_full_shade: row.get::<_, Option<i32>>(40)?.map(|v| v != 0),
                    frost_tender: row.get::<_, Option<i32>>(41)?.map(|v| v != 0),
                    frost_free_days_min: row.get(42)?,
                    drought_tolerance: row.get(43)?,
                    precip_min_inches: row.get(44)?,
                    precip_max_inches: row.get(45)?,
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
                    leaf_type: row.get(116)?,
                    leaf_compoundness: row.get(117)?,
                    leaf_shape: row.get(118)?,
                    sla_mm2_mg: row.get(119)?,
                    ldmc_g_g: row.get(120)?,
                    leaf_nitrogen_mg_g: row.get(121)?,
                    leaf_carbon_mg_g: row.get(122)?,
                    leaf_phosphorus_mg_g: row.get(123)?,
                    leaf_dry_mass_mg: row.get(124)?,
                    pollination_syndrome: row.get(125)?,
                    sexual_system: row.get(126)?,
                    mating_system: row.get(127)?,
                    self_fertile: row.get::<_, Option<i32>>(128)?.map(|v| v != 0),
                    reproductive_type: row.get(129)?,
                    clonal_growth_form: row.get(130)?,
                    storage_organ: row.get(131)?,
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
                    native_range: row.get(142)?,
                    native_distribution: row.get(143)?,
                    introduced_distribution: row.get(144)?,
                    range_text: row.get(145)?,
                    conservation_status: row.get(146)?,
                    summary: row.get(147)?,
                    physical_characteristics: row.get(148)?,
                    cultivation_notes: row.get(149)?,
                    propagation_notes: row.get(150)?,
                    habitats: row.get(151)?,
                    carbon_farming: row.get(152)?,
                    image_urls: row.get(153)?,
                    ellenberg_light: row.get(154)?,
                    ellenberg_temperature: row.get(155)?,
                    ellenberg_moisture: row.get(156)?,
                    ellenberg_reaction: row.get(157)?,
                    ellenberg_nitrogen: row.get(158)?,
                    ellenberg_salt: row.get(159)?,
                    classification_source: row.get(160)?,
                    model_version: row.get(161)?,
                    prompt_version: row.get(162)?,
                    reasoning: row.get(163)?,
                    classified_at: row.get(164)?,
                    validation_flags: row.get(165)?,
                    overall_confidence: row.get(166)?,
                    validation_flag_count: row.get(167)?,
                    data_quality_tier: row.get(168)?,
                    wood_density_g_cm3: row.get(169)?,
                    photosynthesis_pathway: row.get(170)?,
                    relationships: vec![],
                },
            ))
        })
        .map_err(|e| format!("Failed to fetch species detail for '{canonical_name}': {e}"))?;

    detail.common_name = get_common_name(conn, &species_id, locale).or(detail.common_name);

    for (field, getter, setter) in [
        (
            "growth_rate",
            detail.growth_rate.clone(),
            &mut detail.growth_rate as &mut Option<String>,
        ),
        (
            "deciduous_evergreen",
            detail.deciduous_evergreen.clone(),
            &mut detail.deciduous_evergreen,
        ),
        (
            "drought_tolerance",
            detail.drought_tolerance.clone(),
            &mut detail.drought_tolerance,
        ),
        ("stratum", detail.stratum.clone(), &mut detail.stratum),
        (
            "succession_stage",
            detail.succession_stage.clone(),
            &mut detail.succession_stage,
        ),
        ("habit", detail.habit.clone(), &mut detail.habit),
        (
            "bloom_period",
            detail.bloom_period.clone(),
            &mut detail.bloom_period,
        ),
        (
            "flower_color",
            detail.flower_color.clone(),
            &mut detail.flower_color,
        ),
        (
            "active_growth_period",
            detail.active_growth_period.clone(),
            &mut detail.active_growth_period,
        ),
        ("lifespan", detail.lifespan.clone(), &mut detail.lifespan),
        ("toxicity", detail.toxicity.clone(), &mut detail.toxicity),
        (
            "anaerobic_tolerance",
            detail.anaerobic_tolerance.clone(),
            &mut detail.anaerobic_tolerance,
        ),
        (
            "canopy_position",
            detail.canopy_position.clone(),
            &mut detail.canopy_position,
        ),
        ("cn_ratio", detail.cn_ratio.clone(), &mut detail.cn_ratio),
        (
            "ecological_system",
            detail.ecological_system.clone(),
            &mut detail.ecological_system,
        ),
        (
            "fertility_requirement",
            detail.fertility_requirement.clone(),
            &mut detail.fertility_requirement,
        ),
        (
            "fire_tolerance",
            detail.fire_tolerance.clone(),
            &mut detail.fire_tolerance,
        ),
        (
            "fruit_seed_abundance",
            detail.fruit_seed_abundance.clone(),
            &mut detail.fruit_seed_abundance,
        ),
        (
            "grime_strategy",
            detail.grime_strategy.clone(),
            &mut detail.grime_strategy,
        ),
        (
            "growth_form_type",
            detail.growth_form_type.clone(),
            &mut detail.growth_form_type,
        ),
        (
            "growth_habit",
            detail.growth_habit.clone(),
            &mut detail.growth_habit,
        ),
        (
            "hedge_tolerance",
            detail.hedge_tolerance.clone(),
            &mut detail.hedge_tolerance,
        ),
        (
            "invasive_potential",
            detail.invasive_potential.clone(),
            &mut detail.invasive_potential,
        ),
        (
            "leaf_compoundness",
            detail.leaf_compoundness.clone(),
            &mut detail.leaf_compoundness,
        ),
        (
            "leaf_shape",
            detail.leaf_shape.clone(),
            &mut detail.leaf_shape,
        ),
        ("leaf_type", detail.leaf_type.clone(), &mut detail.leaf_type),
        (
            "moisture_use",
            detail.moisture_use.clone(),
            &mut detail.moisture_use,
        ),
        (
            "mycorrhizal_type",
            detail.mycorrhizal_type.clone(),
            &mut detail.mycorrhizal_type,
        ),
        (
            "pollination_syndrome",
            detail.pollination_syndrome.clone(),
            &mut detail.pollination_syndrome,
        ),
        (
            "raunkiaer_life_form",
            detail.raunkiaer_life_form.clone(),
            &mut detail.raunkiaer_life_form,
        ),
        (
            "reproductive_type",
            detail.reproductive_type.clone(),
            &mut detail.reproductive_type,
        ),
        (
            "root_system_type",
            detail.root_system_type.clone(),
            &mut detail.root_system_type,
        ),
        (
            "salinity_tolerance",
            detail.salinity_tolerance.clone(),
            &mut detail.salinity_tolerance,
        ),
        (
            "seed_dispersal_mechanism",
            detail.seed_dispersal_mechanism.clone(),
            &mut detail.seed_dispersal_mechanism,
        ),
        (
            "seed_dormancy_type",
            detail.seed_dormancy_type.clone(),
            &mut detail.seed_dormancy_type,
        ),
        (
            "seed_spread_rate",
            detail.seed_spread_rate.clone(),
            &mut detail.seed_spread_rate,
        ),
        (
            "seed_storage_behaviour",
            detail.seed_storage_behaviour.clone(),
            &mut detail.seed_storage_behaviour,
        ),
        (
            "seedbank_type",
            detail.seedbank_type.clone(),
            &mut detail.seedbank_type,
        ),
        (
            "sexual_system",
            detail.sexual_system.clone(),
            &mut detail.sexual_system,
        ),
        (
            "storage_organ",
            detail.storage_organ.clone(),
            &mut detail.storage_organ,
        ),
        (
            "vegetative_spread_rate",
            detail.vegetative_spread_rate.clone(),
            &mut detail.vegetative_spread_rate,
        ),
        (
            "classification_source",
            detail.classification_source.clone(),
            &mut detail.classification_source,
        ),
        (
            "data_quality_tier",
            detail.data_quality_tier.clone(),
            &mut detail.data_quality_tier,
        ),
        (
            "photosynthesis_pathway",
            detail.photosynthesis_pathway.clone(),
            &mut detail.photosynthesis_pathway,
        ),
        (
            "clonal_growth_form",
            detail.clonal_growth_form.clone(),
            &mut detail.clonal_growth_form,
        ),
        (
            "mating_system",
            detail.mating_system.clone(),
            &mut detail.mating_system,
        ),
        (
            "conservation_status",
            detail.conservation_status.clone(),
            &mut detail.conservation_status,
        ),
        (
            "fruit_type",
            detail.fruit_type.clone(),
            &mut detail.fruit_type,
        ),
        (
            "fruit_seed_color",
            detail.fruit_seed_color.clone(),
            &mut detail.fruit_seed_color,
        ),
        (
            "fruit_seed_period_begin",
            detail.fruit_seed_period_begin.clone(),
            &mut detail.fruit_seed_period_begin,
        ),
        (
            "fruit_seed_period_end",
            detail.fruit_seed_period_end.clone(),
            &mut detail.fruit_seed_period_end,
        ),
        (
            "growth_form_shape",
            detail.growth_form_shape.clone(),
            &mut detail.growth_form_shape,
        ),
        (
            "propagation_method",
            detail.propagation_method.clone(),
            &mut detail.propagation_method,
        ),
        (
            "sowing_period",
            detail.sowing_period.clone(),
            &mut detail.sowing_period,
        ),
        (
            "harvest_period",
            detail.harvest_period.clone(),
            &mut detail.harvest_period,
        ),
        (
            "dormancy_conditions",
            detail.dormancy_conditions.clone(),
            &mut detail.dormancy_conditions,
        ),
        (
            "management_types",
            detail.management_types.clone(),
            &mut detail.management_types,
        ),
        (
            "pollinators",
            detail.pollinators.clone(),
            &mut detail.pollinators,
        ),
    ] {
        if let Some(ref value) = getter {
            *setter = Some(translate_composite_value(conn, field, value, locale));
        }
    }

    detail.uses = load_uses(conn, &species_id, locale)?;
    detail.relationships = get_relationships(conn, &species_id)?;

    Ok(detail)
}

pub fn get_relationships(conn: &Connection, species_id: &str) -> Result<Vec<Relationship>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.canonical_name, sr.relationship_type
             FROM species_relationships sr
             JOIN species s ON s.slug = sr.related_species_slug
             WHERE sr.species_id = ?1
             ORDER BY sr.relationship_type, s.canonical_name",
        )
        .map_err(|e| format!("Failed to prepare relationships query: {e}"))?;

    Ok(stmt
        .query_map([species_id], |row| {
            Ok(Relationship {
                related_canonical_name: row.get(0)?,
                relationship_type: row.get(1)?,
                description: None,
            })
        })
        .map_err(|e| format!("Failed to fetch relationships: {e}"))?
        .filter_map(|result| match result {
            Ok(item) => Some(item),
            Err(error) => {
                tracing::warn!("Skipped relationship row: {error}");
                None
            }
        })
        .collect())
}

pub fn resolve_species_id(
    conn: &Connection,
    canonical_name: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT id FROM species WHERE canonical_name = ?1 LIMIT 1",
        [canonical_name],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Failed to look up species id for '{canonical_name}': {e}"))
}

pub fn get_species_images(
    conn: &Connection,
    canonical_name: &str,
) -> Result<Vec<SpeciesImage>, String> {
    let Some(species_id) = resolve_species_id(conn, canonical_name)? else {
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

    Ok(stmt
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
        .filter_map(|result| match result {
            Ok(item) => Some(item),
            Err(error) => {
                tracing::warn!("Skipped species image row: {error}");
                None
            }
        })
        .collect())
}

pub fn get_species_external_links(
    conn: &Connection,
    canonical_name: &str,
) -> Result<Vec<SpeciesExternalLink>, String> {
    let Some(species_id) = resolve_species_id(conn, canonical_name)? else {
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

    Ok(stmt
        .query_map([&species_id], |row| {
            Ok(SpeciesExternalLink {
                id: row.get(0)?,
                species_id: row.get(1)?,
                link_type: row.get(2)?,
                url: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to fetch species external links: {e}"))?
        .filter_map(|result| match result {
            Ok(item) => Some(item),
            Err(error) => {
                tracing::warn!("Skipped species external link row: {error}");
                None
            }
        })
        .collect())
}

fn load_uses(conn: &Connection, species_id: &str, locale: &str) -> Result<Vec<SpeciesUse>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT use_category, use_description
             FROM species_uses
             WHERE species_id = ?1
             ORDER BY use_category",
        )
        .map_err(|e| format!("Failed to prepare uses query: {e}"))?;

    let rows: Vec<SpeciesUse> = stmt
        .query_map([species_id], |row| {
            Ok(SpeciesUse {
                use_category: row.get(0)?,
                use_description: row.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to fetch uses: {e}"))?
        .filter_map(|result| match result {
            Ok(item) => Some(item),
            Err(error) => {
                tracing::warn!("Skipped uses row: {error}");
                None
            }
        })
        .collect();

    Ok(rows
        .into_iter()
        .map(|mut item| {
            let field = format!("use:{}", item.use_category.replace(' ', "_"));
            if let Some(ref description) = item.use_description {
                item.use_description = Some(translate_value(conn, &field, description, locale));
            }
            item
        })
        .collect())
}
