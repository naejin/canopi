use common_types::species::{
    Relationship, SpeciesDetail, SpeciesExternalLink, SpeciesImage, SpeciesUse,
};
use rusqlite::{Connection, OptionalExtension, Row, types::FromSql};
use std::sync::OnceLock;

use super::lookup::{get_common_name, translate_composite_value, translate_value};

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
    "edible_uses",
    "medicinal_uses",
    "other_uses",
    "special_uses",
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
    "known_hazards",
    "invasive_potential",
    "biogeographic_status",
    "noxious_status",
    "invasive_usda",
    "weed_potential",
    "fire_resistant",
    "fire_tolerance",
    "hedge_tolerance",
    "pests_diseases",
    "native_range",
    "native_distribution",
    "introduced_distribution",
    "range_text",
    "conservation_status",
    "summary",
    "physical_characteristics",
    "cultivation_notes",
    "propagation_notes",
    "habitats",
    "carbon_farming",
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
    "reasoning",
    "classified_at",
    "validation_flags",
    "overall_confidence",
    "validation_flag_count",
    "data_quality_tier",
    "wood_density_g_cm3",
    "photosynthesis_pathway",
];

static DETAIL_QUERY_SQL: OnceLock<String> = OnceLock::new();

struct DetailCursor<'row, 'stmt> {
    row: &'row Row<'stmt>,
    index: usize,
}

impl<'row, 'stmt> DetailCursor<'row, 'stmt> {
    fn new(row: &'row Row<'stmt>) -> Self {
        Self { row, index: 0 }
    }

    fn read<T: FromSql>(&mut self) -> rusqlite::Result<T> {
        let value = self.row.get(self.index)?;
        self.index += 1;
        Ok(value)
    }

    fn read_bool(&mut self) -> rusqlite::Result<Option<bool>> {
        self.read::<Option<i32>>()
            .map(|value| value.map(|v| v != 0))
    }

    fn finish(self) {
        debug_assert_eq!(self.index, DETAIL_CONTRACT_COLUMNS.len());
    }
}

fn detail_query_sql() -> &'static str {
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

fn map_detail_row(row: &Row<'_>) -> rusqlite::Result<(String, SpeciesDetail)> {
    let mut cursor = DetailCursor::new(row);

    let species_id: String = cursor.read()?;
    let canonical_name = cursor.read()?;
    let fallback_common = cursor.read()?;

    let detail = SpeciesDetail {
        canonical_name,
        common_name: fallback_common,
        family: cursor.read()?,
        genus: cursor.read()?,
        taxonomic_order: cursor.read()?,
        taxonomic_class: cursor.read()?,
        is_hybrid: cursor.read_bool()?,
        match_confidence: cursor.read()?,
        tnrs_taxonomic_status: cursor.read()?,
        match_score: cursor.read()?,
        source: cursor.read()?,
        enriched_at: cursor.read()?,
        enrichment_provenance: cursor.read()?,
        height_min_m: cursor.read()?,
        height_max_m: cursor.read()?,
        width_max_m: cursor.read()?,
        hardiness_zone_min: cursor.read()?,
        hardiness_zone_max: cursor.read()?,
        age_of_maturity_years: cursor.read()?,
        growth_rate: cursor.read()?,
        is_annual: cursor.read_bool()?,
        is_biennial: cursor.read_bool()?,
        is_perennial: cursor.read_bool()?,
        lifespan: cursor.read()?,
        deciduous_evergreen: cursor.read()?,
        leaf_retention: cursor.read_bool()?,
        active_growth_period: cursor.read()?,
        habit: cursor.read()?,
        growth_form_type: cursor.read()?,
        growth_form_shape: cursor.read()?,
        growth_habit: cursor.read()?,
        woody: cursor.read_bool()?,
        canopy_position: cursor.read()?,
        resprout_ability: cursor.read_bool()?,
        coppice_potential: cursor.read_bool()?,
        bloom_period: cursor.read()?,
        flower_color: cursor.read()?,
        pollinators: cursor.read()?,
        tolerates_full_sun: cursor.read_bool()?,
        tolerates_semi_shade: cursor.read_bool()?,
        tolerates_full_shade: cursor.read_bool()?,
        frost_tender: cursor.read_bool()?,
        frost_free_days_min: cursor.read()?,
        drought_tolerance: cursor.read()?,
        precip_min_inches: cursor.read()?,
        precip_max_inches: cursor.read()?,
        soil_ph_min: cursor.read()?,
        soil_ph_max: cursor.read()?,
        well_drained: cursor.read_bool()?,
        heavy_clay: cursor.read_bool()?,
        tolerates_light_soil: cursor.read_bool()?,
        tolerates_medium_soil: cursor.read_bool()?,
        tolerates_heavy_soil: cursor.read_bool()?,
        tolerates_acid: cursor.read_bool()?,
        tolerates_alkaline: cursor.read_bool()?,
        tolerates_saline: cursor.read_bool()?,
        tolerates_wind: cursor.read_bool()?,
        tolerates_pollution: cursor.read_bool()?,
        tolerates_nutritionally_poor: cursor.read_bool()?,
        fertility_requirement: cursor.read()?,
        moisture_use: cursor.read()?,
        anaerobic_tolerance: cursor.read()?,
        root_depth_min_cm: cursor.read()?,
        salinity_tolerance: cursor.read()?,
        stratum: cursor.read()?,
        succession_stage: cursor.read()?,
        stratum_confidence: cursor.read()?,
        succession_confidence: cursor.read()?,
        nitrogen_fixer: cursor.read_bool()?,
        ecological_system: cursor.read()?,
        mycorrhizal_type: cursor.read()?,
        grime_strategy: cursor.read()?,
        raunkiaer_life_form: cursor.read()?,
        cn_ratio: cursor.read()?,
        allelopathic: cursor.read_bool()?,
        root_system_type: cursor.read()?,
        taproot_persistent: cursor.read_bool()?,
        edibility_rating: cursor.read()?,
        medicinal_rating: cursor.read()?,
        other_uses_rating: cursor.read()?,
        edible_uses: cursor.read()?,
        medicinal_uses: cursor.read()?,
        other_uses: cursor.read()?,
        special_uses: cursor.read()?,
        attracts_wildlife: cursor.read_bool()?,
        scented: cursor.read_bool()?,
        uses: vec![],
        propagated_by_seed: cursor.read_bool()?,
        propagated_by_cuttings: cursor.read_bool()?,
        propagated_by_bare_root: cursor.read_bool()?,
        propagated_by_container: cursor.read_bool()?,
        propagated_by_sprigs: cursor.read_bool()?,
        propagated_by_bulb: cursor.read_bool()?,
        propagated_by_sod: cursor.read_bool()?,
        propagated_by_tubers: cursor.read_bool()?,
        propagated_by_corm: cursor.read_bool()?,
        cold_stratification_required: cursor.read_bool()?,
        vegetative_spread_rate: cursor.read()?,
        seed_spread_rate: cursor.read()?,
        propagation_method: cursor.read()?,
        sowing_period: cursor.read()?,
        harvest_period: cursor.read()?,
        dormancy_conditions: cursor.read()?,
        management_types: cursor.read()?,
        fruit_type: cursor.read()?,
        fruit_seed_color: cursor.read()?,
        fruit_seed_period_begin: cursor.read()?,
        fruit_seed_period_end: cursor.read()?,
        fruit_seed_abundance: cursor.read()?,
        fruit_seed_persistence: cursor.read_bool()?,
        seed_mass_mg: cursor.read()?,
        seed_length_mm: cursor.read()?,
        seed_germination_rate: cursor.read()?,
        seed_dispersal_mechanism: cursor.read()?,
        seed_storage_behaviour: cursor.read()?,
        seed_dormancy_type: cursor.read()?,
        seed_dormancy_depth: cursor.read()?,
        serotinous: cursor.read_bool()?,
        seedbank_type: cursor.read()?,
        leaf_type: cursor.read()?,
        leaf_compoundness: cursor.read()?,
        leaf_shape: cursor.read()?,
        sla_mm2_mg: cursor.read()?,
        ldmc_g_g: cursor.read()?,
        leaf_nitrogen_mg_g: cursor.read()?,
        leaf_carbon_mg_g: cursor.read()?,
        leaf_phosphorus_mg_g: cursor.read()?,
        leaf_dry_mass_mg: cursor.read()?,
        pollination_syndrome: cursor.read()?,
        sexual_system: cursor.read()?,
        mating_system: cursor.read()?,
        self_fertile: cursor.read_bool()?,
        reproductive_type: cursor.read()?,
        clonal_growth_form: cursor.read()?,
        storage_organ: cursor.read()?,
        toxicity: cursor.read()?,
        known_hazards: cursor.read()?,
        invasive_potential: cursor.read()?,
        biogeographic_status: cursor.read()?,
        noxious_status: cursor.read_bool()?,
        invasive_usda: cursor.read_bool()?,
        weed_potential: cursor.read_bool()?,
        fire_resistant: cursor.read_bool()?,
        fire_tolerance: cursor.read()?,
        hedge_tolerance: cursor.read()?,
        pests_diseases: cursor.read()?,
        native_range: cursor.read()?,
        native_distribution: cursor.read()?,
        introduced_distribution: cursor.read()?,
        range_text: cursor.read()?,
        conservation_status: cursor.read()?,
        summary: cursor.read()?,
        physical_characteristics: cursor.read()?,
        cultivation_notes: cursor.read()?,
        propagation_notes: cursor.read()?,
        habitats: cursor.read()?,
        carbon_farming: cursor.read()?,
        image_urls: cursor.read()?,
        ellenberg_light: cursor.read()?,
        ellenberg_temperature: cursor.read()?,
        ellenberg_moisture: cursor.read()?,
        ellenberg_reaction: cursor.read()?,
        ellenberg_nitrogen: cursor.read()?,
        ellenberg_salt: cursor.read()?,
        classification_source: cursor.read()?,
        model_version: cursor.read()?,
        prompt_version: cursor.read()?,
        reasoning: cursor.read()?,
        classified_at: cursor.read()?,
        validation_flags: cursor.read()?,
        overall_confidence: cursor.read()?,
        validation_flag_count: cursor.read()?,
        data_quality_tier: cursor.read()?,
        wood_density_g_cm3: cursor.read()?,
        photosynthesis_pathway: cursor.read()?,
        relationships: vec![],
    };

    cursor.finish();
    Ok((species_id, detail))
}

#[cfg(test)]
pub(super) fn detail_contract_columns() -> &'static [&'static str] {
    DETAIL_CONTRACT_COLUMNS
}

pub fn get_detail(
    conn: &Connection,
    canonical_name: &str,
    locale: &str,
) -> Result<SpeciesDetail, String> {
    let mut stmt = conn
        .prepare(detail_query_sql())
        .map_err(|e| format!("Failed to prepare species detail query: {e}"))?;

    let (species_id, mut detail) = stmt
        .query_row([canonical_name], map_detail_row)
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
            "biogeographic_status",
            detail.biogeographic_status.clone(),
            &mut detail.biogeographic_status,
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
            "seed_dormancy_depth",
            detail.seed_dormancy_depth.clone(),
            &mut detail.seed_dormancy_depth,
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
